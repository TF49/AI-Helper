import { useCallback, useEffect, useState } from "react";
import { getTokenKey, getUserTokens } from "./api";
import { useAuth } from "./useAuth";
import type { TokenItem } from "../types";

export type BoundTokenInfo = {
  id: number;
  name: string;
  group?: string | null;
};

const ALL_TOOL_IDS = ["chatgpt", "claude", "workbuddy", "acciowork", "default"];

export function normalizeApiKey(k?: string | null): string {
  if (!k) return "";
  const trimmed = k.trim();
  return trimmed.startsWith("sk-") ? trimmed.slice(3) : trimmed;
}

export function isKeyMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const normA = normalizeApiKey(a);
  const normB = normalizeApiKey(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 10 && normB.length >= 10) {
    const preA = normA.slice(0, 6);
    const sufA = normA.slice(-4);
    const preB = normB.slice(0, 6);
    const sufB = normB.slice(-4);
    return preA === preB && sufA === sufB;
  }
  return false;
}

export function normalizeGroup(group: unknown): string | null {
  return typeof group === "string" && group.trim() ? group.trim() : null;
}

function readBoundFromStorage(toolId: string): BoundTokenInfo | null {
  try {
    const saved = localStorage.getItem(`bound_token_${toolId}`);
    if (!saved) return null;
    return JSON.parse(saved) as BoundTokenInfo;
  } catch {
    return null;
  }
}

function writeBoundToStorage(toolId: string, info: BoundTokenInfo) {
  try {
    localStorage.setItem(`bound_token_${toolId}`, JSON.stringify(info));
  } catch {}
}

export function toBoundInfo(token: Pick<TokenItem, "id" | "name" | "group">): BoundTokenInfo {
  return {
    id: token.id,
    name: token.name,
    group: token.group?.trim() || "default",
  };
}

function matchTokenByKey(tokens: TokenItem[], apiKey: string): TokenItem | null {
  const val = apiKey.trim();
  if (!val) return null;

  return tokens.find((t) => isKeyMatch(t.key, val)) ?? null;
}

/** 复用其他工具已绑定的同一 Key（Accio 有绑定、Claude 无绑定时的关键路径） */
async function matchViaOtherToolBindings(
  toolId: string,
  apiKey: string,
  tokens: TokenItem[],
): Promise<BoundTokenInfo | null> {
  const val = apiKey.trim();
  const seen = new Set<number>();

  for (const otherId of ALL_TOOL_IDS) {
    if (otherId === toolId) continue;
    const other = readBoundFromStorage(otherId);
    if (!other?.id || seen.has(other.id)) continue;
    seen.add(other.id);

    try {
      const plain = (await getTokenKey(other.id)).trim();
      if (!plain || !isKeyMatch(plain, val)) continue;

      const cloud = tokens.find((t) => t.id === other.id);
      return toBoundInfo({
        id: other.id,
        name: cloud?.name || other.name,
        group: cloud?.group ?? other.group,
      });
    } catch {
      // 继续尝试其它工具绑定
    }
  }
  return null;
}

/** 列表未带回完整 Key 时，逐个拉取明文比对 */
async function matchTokenByFetchingKeys(
  tokens: TokenItem[],
  apiKey: string,
): Promise<TokenItem | null> {
  const val = apiKey.trim();
  if (!val) return null;

  for (const token of tokens) {
    if (token.key && normalizeApiKey(token.key).length >= 10) {
      if (!isKeyMatch(token.key, val)) {
        continue;
      }
    }

    try {
      const plain = (await getTokenKey(token.id)).trim();
      if (plain && isKeyMatch(plain, val)) return token;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 读取并跟踪当前工具绑定 API Key 所属分组。
 * 传入 apiKey 后，即使未挂载 ApiKeyInput（概览/确认页），也会按 Key 自动匹配云端分组。
 */
export function useBoundTokenGroup(toolId: string, apiKey?: string) {
  const { authState } = useAuth();
  const [group, setGroup] = useState<string | null>(() =>
    normalizeGroup(readBoundFromStorage(toolId)?.group),
  );

  const refreshFromStorage = useCallback(() => {
    setGroup(normalizeGroup(readBoundFromStorage(toolId)?.group));
  }, [toolId]);

  // 仅接受有效绑定；避免 ApiKeyInput 初次挂载 null 把已解析分组清空
  const onBoundTokenChange = useCallback((info: BoundTokenInfo | null) => {
    if (!info) return;
    setGroup(normalizeGroup(info.group));
  }, []);

  useEffect(() => {
    refreshFromStorage();

    const handleGroupUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ toolId?: string; group?: string }>)
        .detail;
      if (detail?.toolId && detail.toolId !== toolId) return;
      refreshFromStorage();
    };

    const handleSync = () => refreshFromStorage();

    window.addEventListener("ai_helper_group_updated", handleGroupUpdated);
    window.addEventListener("ai_helper_sync_all_tokens", handleSync);
    return () => {
      window.removeEventListener("ai_helper_group_updated", handleGroupUpdated);
      window.removeEventListener("ai_helper_sync_all_tokens", handleSync);
    };
  }, [toolId, refreshFromStorage]);

  useEffect(() => {
    const key = apiKey?.trim() ?? "";
    if (!key) {
      setGroup(null);
      return;
    }
    if (!authState.is_logged_in) return;

    let alive = true;

    (async () => {
      try {
        const tokens = await getUserTokens();
        if (!alive || !tokens?.length) return;

        // 1) 列表明文 / 前后缀匹配
        let matched = matchTokenByKey(tokens, key);
        if (matched) {
          const info = toBoundInfo(matched);
          writeBoundToStorage(toolId, info);
          if (alive) setGroup(normalizeGroup(info.group));
          return;
        }

        // 2) 复用其它工具已绑定的同一 Key（Claude 缺绑定、Accio 已有时）
        const fromOther = await matchViaOtherToolBindings(toolId, key, tokens);
        if (!alive) return;
        if (fromOther) {
          writeBoundToStorage(toolId, fromOther);
          setGroup(normalizeGroup(fromOther.group));
          return;
        }

        // 3) 账号当前选中 Token
        if (authState.selected_token_id) {
          const selected = tokens.find(
            (t) => t.id === authState.selected_token_id,
          );
          if (selected) {
            try {
              const plain = (await getTokenKey(selected.id)).trim();
              if (alive && plain && isKeyMatch(plain, key)) {
                const info = toBoundInfo(selected);
                writeBoundToStorage(toolId, info);
                setGroup(normalizeGroup(info.group));
                return;
              }
            } catch {
              // fall through
            }
          }
        }

        // 4) 逐个拉取明文比对
        matched = await matchTokenByFetchingKeys(tokens, key);
        if (!alive) return;
        if (matched) {
          const info = toBoundInfo(matched);
          writeBoundToStorage(toolId, info);
          setGroup(normalizeGroup(info.group));
          return;
        }

        // 5) 回退本地绑定 id
        const existing = readBoundFromStorage(toolId);
        if (!existing) return;
        const byId = tokens.find((t) => t.id === existing.id);
        if (!byId) return;
        const info = toBoundInfo(byId);
        writeBoundToStorage(toolId, info);
        setGroup(normalizeGroup(info.group));
      } catch {
        // 保留本地缓存
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    authState.is_logged_in,
    authState.selected_token_id,
    apiKey,
    toolId,
  ]);

  return { group, onBoundTokenChange };
}

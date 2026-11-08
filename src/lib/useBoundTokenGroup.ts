import { useCallback, useEffect, useRef, useState } from "react";
import { getTokenKey, getUserTokens } from "./api";
import { useAuth } from "./useAuth";
import type { TokenItem } from "../types";

const KNOWN_TOOL_IDS = ["chatgpt", "claude", "workbuddy", "acciowork", "cursor", "default"];

export type BoundTokenInfo = {
  id: number;
  name: string;
  group?: string | null;
};

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

/**
 * 限流（HTTP 429）和网络故障只说明这次没查到，不能证明绑定分组已失效。
 * Tauri 命令错误以字符串形式到达前端，后端对 429 统一附带 "HTTP 429" 标记。
 */
export function isTransientLookupError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /429|请求受限|网络|响应失败|network|timed? ?out|error sending request|connection|dns error|failed to fetch/i.test(
    text,
  );
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

/** Reuse only keys already bound by a tool; never fan out over the whole list. */
async function matchViaKnownBindings(
  toolId: string,
  apiKey: string,
  tokens: TokenItem[],
  isCurrent: () => boolean,
): Promise<BoundTokenInfo | null> {
  const seen = new Set<number>();
  for (const otherToolId of KNOWN_TOOL_IDS) {
    if (!isCurrent()) return null;
    if (otherToolId === toolId) continue;
    const bound = readBoundFromStorage(otherToolId);
    if (!bound?.id || seen.has(bound.id)) continue;
    seen.add(bound.id);
    const cloudToken = tokens.find((token) => token.id === bound.id);
    if (!cloudToken) continue;
    try {
      const plain = (await getTokenKey(bound.id)).trim();
      if (!isCurrent()) return null;
      if (plain && isKeyMatch(plain, apiKey)) return toBoundInfo(cloudToken);
    } catch {
      // Keep resolving from the current tool's own binding below.
    }
  }
  return null;
}

/**
 * 读取并跟踪当前工具绑定 API Key 所属分组。
 * 传入 apiKey 后，即使未挂载 ApiKeyInput（概览/确认页），也会按 Key 自动匹配云端分组。
 */
export function useBoundTokenGroup(
  toolId: string,
  apiKey?: string,
  options?: {
    /** 云端解析期间保留本地缓存分组，避免卡片在重新挂载时出现「有 → 无 → 有」的闪烁；Key 变化时仍会清空 */
    preserveWhileResolving?: boolean;
  },
) {
  const preserveWhileResolving = options?.preserveWhileResolving ?? false;
  const resolvedKeyRef = useRef(apiKey?.trim() ?? "");
  const { authState, authSessionGeneration } = useAuth();
  const userId = authState.is_logged_in ? authState.user?.id ?? null : null;
  const key = apiKey?.trim() ?? "";
  const context = { userId, session: authSessionGeneration, toolId, key };
  const contextRef = useRef(context);
  contextRef.current = context;
  const mounted = useRef(true);
  const lifecycle = useRef(0);
  const requestSequence = useRef(0);
  const [group, setGroup] = useState<string | null>(() =>
    normalizeGroup(readBoundFromStorage(toolId)?.group),
  );
  // 上一次解析时展示的分组及其上下文；仅同一账号、会话、工具和 Key 下才可沿用
  const shownRef = useRef<{ context: typeof context; group: string | null } | null>(null);
  shownRef.current = { context: shownRef.current?.context ?? context, group };
  const isContextCurrent = useCallback((snapshot: typeof context) => {
    const current = contextRef.current;
    return mounted.current && snapshot.userId === current.userId &&
      snapshot.session === current.session && snapshot.toolId === current.toolId && snapshot.key === current.key;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const invalidate = (event: Event) => {
      lifecycle.current += 1;
      requestSequence.current += 1;
      const detail = (event as CustomEvent<{ userId?: number | null; sessionGeneration?: number }>).detail;
      contextRef.current = { ...contextRef.current,
        userId: detail?.userId ?? null,
        session: detail?.sessionGeneration ?? contextRef.current.session + 1 };
      setGroup(null);
    };
    window.addEventListener("ai_helper_auth_changed", invalidate);
    return () => {
      mounted.current = false;
      lifecycle.current += 1;
      requestSequence.current += 1;
      window.removeEventListener("ai_helper_auth_changed", invalidate);
    };
  }, []);

  const refreshFromStorage = useCallback(() => {
    const snapshot = { userId, session: authSessionGeneration, toolId, key };
    if (!isContextCurrent(snapshot) || userId === null) return;
    const saved = readBoundFromStorage(toolId);
    if (isContextCurrent(snapshot)) setGroup(normalizeGroup(saved?.group));
  }, [toolId, key, userId, authSessionGeneration, isContextCurrent]);

  // 仅接受有效绑定；避免 ApiKeyInput 初次挂载 null 把已解析分组清空
  const onBoundTokenChange = useCallback((info: BoundTokenInfo | null) => {
    if (!info || userId === null || !isContextCurrent({ userId, session: authSessionGeneration, toolId, key })) return;
    setGroup(normalizeGroup(info.group));
  }, [userId, authSessionGeneration, toolId, key, isContextCurrent]);

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
    const snapshot = { userId, session: authSessionGeneration, toolId, key };
    const generation = lifecycle.current;
    const sequence = ++requestSequence.current;
    let alive = true;
    const isCurrent = () => alive && isContextCurrent(snapshot) &&
      generation === lifecycle.current && sequence === requestSequence.current;
    const commit = (info: BoundTokenInfo) => {
      if (!isCurrent()) return;
      writeBoundToStorage(toolId, info);
      if (isCurrent()) setGroup(normalizeGroup(info.group));
    };
    const keyChanged = resolvedKeyRef.current !== key;
    resolvedKeyRef.current = key;
    const shown = shownRef.current;
    // 限流或网络错误时保留解析前已展示的分组，不因一次失败把卡片清空
    const previousGroup =
      shown &&
      !keyChanged &&
      shown.context.userId === userId &&
      shown.context.session === authSessionGeneration &&
      shown.context.toolId === toolId &&
      shown.context.key === key
        ? shown.group
        : null;
    shownRef.current = { context: snapshot, group: shown?.group ?? null };
    const keepOnTransient = (error: unknown) => {
      if (isCurrent()) setGroup(isTransientLookupError(error) ? previousGroup : null);
    };
    const loggedIn = authState.is_logged_in && userId !== null;
    // 默认每次重新解析都先清空；保留模式下仅在 Key 变化、无 Key 或未登录时清空
    if (isCurrent() && (!preserveWhileResolving || keyChanged || !key || !loggedIn)) {
      setGroup(null);
    }
    if (!key) {
      return;
    }
    if (!loggedIn) return;

    (async () => {
      try {
        if (!isCurrent()) return;
        const tokens = await getUserTokens();
        if (!isCurrent()) return;
        if (!tokens?.length) {
          setGroup(null);
          return;
        }

        // 1) 列表明文 / 前后缀匹配
        let matched = matchTokenByKey(tokens, key);
        if (matched) {
          const info = toBoundInfo(matched);
          commit(info);
          return;
        }

        // 2) Check previously bound tool IDs, not every Key in the account.
        const fromKnownBinding = await matchViaKnownBindings(toolId, key, tokens, isCurrent);
        if (!isCurrent()) return;
        if (fromKnownBinding) {
          commit(fromKnownBinding);
          return;
        }

        // 3) Check the one selected token rather than retrieving every Key.
        if (authState.selected_token_id) {
          const selected = tokens.find(
            (t) => t.id === authState.selected_token_id,
          );
          if (selected) {
            try {
              const plain = (await getTokenKey(selected.id)).trim();
              if (!isCurrent()) return;
              if (plain && isKeyMatch(plain, key)) {
                const info = toBoundInfo(selected);
                commit(info);
                return;
              }
            } catch {
              // fall through
            }
          }
        }

        // 4) Fall back to this tool's stored binding only.
        if (!isCurrent()) return;
        const existing = readBoundFromStorage(toolId);
        if (!existing) return;
        const byId = tokens.find((t) => t.id === existing.id);
        if (!byId) {
          // An incomplete list cannot validate the cached group. Avoid showing
          // stale metadata until the bound token can be confirmed again.
          if (isCurrent()) setGroup(null);
          return;
        }
        try {
          const plain = (await getTokenKey(byId.id)).trim();
          if (!isCurrent()) return;
          if (plain && isKeyMatch(plain, key)) {
            commit(toBoundInfo(byId));
            return;
          }
          try {
            localStorage.removeItem(`bound_token_${toolId}`);
          } catch {}
          if (isCurrent()) setGroup(null);
        } catch (error) {
          // A failed Key read is not proof that the saved group is still valid,
          // unless it failed only because of a rate limit or the network.
          keepOnTransient(error);
        }
      } catch (error) {
        // A completed failure cannot validate stale metadata from local
        // storage; a rate limit or network failure keeps what was shown.
        keepOnTransient(error);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    authState.is_logged_in,
    userId,
    authSessionGeneration,
    authState.selected_token_id,
    key,
    toolId,
    preserveWhileResolving,
    isContextCurrent,
  ]);

  return { group, onBoundTokenChange };
}

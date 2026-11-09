import { useCallback, useEffect, useRef, useState } from "react";
import { getTokenKey, getUserTokens } from "./api";
import { useAuth } from "./useAuth";
import type { TokenItem } from "../types";
import {
  keyFingerprint,
  knownFingerprint,
  matchTokenByFingerprint,
  normalizeApiKey,
  rememberTokenKeyFingerprint,
} from "./tokenKeyFingerprint";

const KNOWN_TOOL_IDS = ["chatgpt", "claude", "workbuddy", "acciowork", "cursor", "default"];

export type BoundTokenInfo = {
  id: number;
  name: string;
  group?: string | null;
};

export { normalizeApiKey, rememberTokenKeyFingerprint };

/** 打码 Key 至少要露出这么多字符，才足以和本地明文做前后缀比对 */
const MIN_MASKED_VISIBLE_CHARS = 6;

/** 解析 Bob API 列表返回的打码 Key（如 `abcd**********wxyz`），返回可见的前后缀 */
function maskedKeyParts(key: string): { prefix: string; suffix: string } | null {
  const first = key.indexOf("*");
  if (first < 0) return null;
  const last = key.lastIndexOf("*");
  return { prefix: key.slice(0, first), suffix: key.slice(last + 1) };
}

export function isKeyMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const normA = normalizeApiKey(a);
  const normB = normalizeApiKey(b);
  if (!normA || !normB) return false;
  const maskA = maskedKeyParts(normA);
  const maskB = maskedKeyParts(normB);
  if (maskA && maskB) return false;
  if (maskA || maskB) {
    // 列表接口只返回打码 Key：用可见前后缀在本地比对，无需请求明文接口
    const mask = (maskA ?? maskB)!;
    const plain = maskA ? normB : normA;
    const visible = mask.prefix.length + mask.suffix.length;
    return (
      visible >= MIN_MASKED_VISIBLE_CHARS &&
      plain.length > visible &&
      plain.startsWith(mask.prefix) &&
      plain.endsWith(mask.suffix)
    );
  }
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
  const val = normalizeApiKey(apiKey);
  if (!val) return null;

  const exact = tokens.find((t) => normalizeApiKey(t.key) === val);
  if (exact) return exact;
  // 打码前后缀比对只在唯一命中时采用，避免把 Key 误归到另一个令牌
  const candidates = tokens.filter((t) => isKeyMatch(t.key, val));
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * 读取某个令牌的明文并与当前 Key 比对。
 * 本地已有该令牌的指纹时直接给出结论（此时指纹必然不等于当前 Key，否则前面已命中），
 * 只有从未读过的令牌才会请求一次明文。
 */
async function verifyTokenKey(
  tokenId: number,
  apiKey: string,
  fingerprint: string | null,
): Promise<boolean> {
  const known = knownFingerprint(tokenId);
  if (fingerprint && known) return known === fingerprint;
  const plain = (await getTokenKey(tokenId)).trim();
  void rememberTokenKeyFingerprint(tokenId, plain);
  return Boolean(plain) && isKeyMatch(plain, apiKey);
}

/** Reuse only keys already bound by a tool; never fan out over the whole list. */
async function matchViaKnownBindings(
  toolId: string,
  apiKey: string,
  fingerprint: string | null,
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
      const matched = await verifyTokenKey(bound.id, apiKey, fingerprint);
      if (!isCurrent()) return null;
      if (matched) return toBoundInfo(cloudToken);
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

        // 1) 列表明文 / 打码前后缀匹配（纯本地）
        let matched = matchTokenByKey(tokens, key);
        const fingerprint = await keyFingerprint(key);
        if (!isCurrent()) return;
        if (matched) {
          void rememberTokenKeyFingerprint(matched.id, key);
          commit(toBoundInfo(matched));
          return;
        }

        // 2) 本地明文指纹匹配（之前读过明文的令牌，纯本地）
        matched = matchTokenByFingerprint(tokens, fingerprint, readBoundFromStorage(toolId)?.id);
        if (matched) {
          commit(toBoundInfo(matched));
          return;
        }

        // 3) Check previously bound tool IDs, not every Key in the account.
        const fromKnownBinding = await matchViaKnownBindings(toolId, key, fingerprint, tokens, isCurrent);
        if (!isCurrent()) return;
        if (fromKnownBinding) {
          commit(fromKnownBinding);
          return;
        }

        // 4) Check the one selected token rather than retrieving every Key.
        if (authState.selected_token_id) {
          const selected = tokens.find(
            (t) => t.id === authState.selected_token_id,
          );
          if (selected) {
            try {
              const selectedMatches = await verifyTokenKey(selected.id, key, fingerprint);
              if (!isCurrent()) return;
              if (selectedMatches) {
                const info = toBoundInfo(selected);
                commit(info);
                return;
              }
            } catch {
              // fall through
            }
          }
        }

        // 5) Fall back to this tool's stored binding only.
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
          const boundMatches = await verifyTokenKey(byId.id, key, fingerprint);
          if (!isCurrent()) return;
          if (boundMatches) {
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

import { useEffect, useState } from "react";
import { fetchDshModels, getUserTokens } from "./api";
import { useAuth } from "./useAuth";
import { keyFingerprint, matchTokenByFingerprint } from "./tokenKeyFingerprint";
import { matchTokenByKey, normalizeGroup } from "./useBoundTokenGroup";

export interface DshKeyTarget {
  url: string;
  apiKey: string;
}

export interface DshKeyStatus {
  /** 该 Key 所属的 bob-api 分组；识别不到时为 null（不猜测，避免张冠李戴） */
  group: string | null;
  /** 该 Key 当前分组在中转站可用的对话模型；拉取失败或尚未返回时为 null */
  available: string[] | null;
  /** 可用模型的查询已结束（无论成功与否） */
  checked: boolean;
}

export function dshKeyStatusId(target: DshKeyTarget): string {
  return `${target.url}::${target.apiKey.trim()}`;
}

/**
 * 只读地查询多个 Key 各自的分组与当前可用模型，用于概览逐条路由展示。
 * 分组只做本地比对（令牌列表的打码前后缀 + 已知指纹），不请求明文 Key，也不改写任何工具的绑定记录；
 * 用户在 bob-api 网页或 AI Helper 中切换分组后，可通过 refresh 或 ai_helper_group_updated 事件重新查询。
 */
export function useDshKeyStatus(targets: DshKeyTarget[], refresh = 0): Record<string, DshKeyStatus> {
  const { authState, authSessionGeneration } = useAuth();
  const loggedIn = authState.is_logged_in;
  const [statuses, setStatuses] = useState<Record<string, DshKeyStatus>>({});
  const [groupVersion, setGroupVersion] = useState(0);

  const unique = Array.from(
    new Map(
      targets.filter((t) => t.apiKey.trim()).map((t) => [dshKeyStatusId(t), t] as const),
    ).values(),
  );
  const signature = unique.map(dshKeyStatusId).join("|");

  useEffect(() => {
    const bump = () => setGroupVersion((v) => v + 1);
    window.addEventListener("ai_helper_group_updated", bump);
    window.addEventListener("ai_helper_sync_all_tokens", bump);
    return () => {
      window.removeEventListener("ai_helper_group_updated", bump);
      window.removeEventListener("ai_helper_sync_all_tokens", bump);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setStatuses({});
    if (unique.length === 0) return;

    void (async () => {
      const tokens = loggedIn ? await getUserTokens().catch(() => []) : [];
      await Promise.all(
        unique.map(async (target) => {
          const id = dshKeyStatusId(target);
          const key = target.apiKey.trim();
          let group: string | null = null;
          if (tokens.length > 0) {
            const matched =
              matchTokenByKey(tokens, key) ??
              matchTokenByFingerprint(tokens, await keyFingerprint(key).catch(() => null));
            group = matched ? normalizeGroup(matched.group?.trim() || "default") : null;
          }
          if (!alive) return;
          setStatuses((prev) => ({
            ...prev,
            [id]: { group, available: prev[id]?.available ?? null, checked: prev[id]?.checked ?? false },
          }));

          const available = await fetchDshModels(target.url, key).catch(() => null);
          if (!alive) return;
          setStatuses((prev) => ({
            ...prev,
            [id]: {
              group: prev[id]?.group ?? group,
              available: available?.length ? available : null,
              checked: true,
            },
          }));
        }),
      );
    })();

    return () => {
      alive = false;
    };
    // signature 已涵盖 targets 的内容；数组本身每次渲染都是新引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, loggedIn, authSessionGeneration, refresh, groupVersion]);

  return statuses;
}

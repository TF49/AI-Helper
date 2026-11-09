import type { TokenItem } from "../types";

// ── 明文 Key 指纹缓存 ──
// 读取明文（POST /api/token/:id/key）会进入 Bob API 审计并计入限流。令牌的明文不会变化，
// 因此只要读过一次，就把「令牌 ID → Key 的 SHA-256 指纹」记在本地，之后启动、切页
// 都在本地比对，不再重复请求。这里只保存不可逆的哈希，不保存明文。

const KEY_FINGERPRINT_STORAGE = "ai_helper_token_key_fp_v1";
const MAX_KEY_FINGERPRINTS = 64;

export function normalizeApiKey(k?: string | null): string {
  if (!k) return "";
  const trimmed = k.trim();
  return trimmed.startsWith("sk-") ? trimmed.slice(3) : trimmed;
}

export async function keyFingerprint(apiKey?: string | null): Promise<string | null> {
  const normalized = normalizeApiKey(apiKey);
  // 打码 Key 不是明文，不能生成指纹
  if (!normalized || normalized.includes("*")) return null;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === "undefined") return null;
  try {
    const data = new TextEncoder().encode(`ai-helper:token-key:v1:${normalized}`);
    const digest = new Uint8Array(await subtle.digest("SHA-256", data));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function readKeyFingerprints(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY_FINGERPRINT_STORAGE);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** 登录状态清除时调用 */
export function clearTokenKeyFingerprints() {
  try {
    localStorage.removeItem(KEY_FINGERPRINT_STORAGE);
  } catch {}
}

export function knownFingerprint(tokenId: number): string | null {
  return readKeyFingerprints()[String(tokenId)] ?? null;
}

/** 记录某个令牌明文 Key 的指纹；凡是已经读到明文的地方都应调用，避免之后再次读取 */
export async function rememberTokenKeyFingerprint(tokenId: number, plainKey?: string | null) {
  if (!tokenId) return;
  const fingerprint = await keyFingerprint(plainKey);
  if (!fingerprint) return;
  try {
    const map = readKeyFingerprints();
    if (map[String(tokenId)] === fingerprint) return;
    delete map[String(tokenId)];
    map[String(tokenId)] = fingerprint;
    const ids = Object.keys(map);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_KEY_FINGERPRINTS))) delete map[id];
    localStorage.setItem(KEY_FINGERPRINT_STORAGE, JSON.stringify(map));
  } catch {}
}

/** 按本地指纹找出当前 Key 对应的云端令牌，完全不发网络请求 */
export function matchTokenByFingerprint(
  tokens: TokenItem[],
  fingerprint: string | null,
  preferredId?: number | null,
): TokenItem | null {
  if (!fingerprint) return null;
  const map = readKeyFingerprints();
  const matches = tokens.filter((token) => map[String(token.id)] === fingerprint);
  return matches.find((token) => token.id === preferredId) ?? matches[0] ?? null;
}

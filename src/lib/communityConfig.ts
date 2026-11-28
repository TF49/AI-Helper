// 社群入口（QQ 群 / 微信群 / 抖音）的名称、账号和二维码全部由管理员在后台配置，
// 应用联网读取并缓存，自身不内置任何渠道：后台一个二维码都没有时，
// 列表为空，「加入社群」的入口整体不显示。
import { useEffect, useState } from "react";

export type CommunityChannelId = "qq" | "wechat" | "douyin";

export interface CommunityChannel {
  id: CommunityChannelId;
  /** 群名称或抖音名称 */
  name: string;
  /** 群号、微信号或抖音号；可为空 */
  account: string;
  /** 二维码下方的一句说明；为空时用默认文案 */
  hint: string;
  /** 二维码图片：后台下发的 data:image 内嵌图片 */
  qrImage: string;
}

export const COMMUNITY_CHANNEL_META: Record<
  CommunityChannelId,
  { title: string; accountLabel: string; defaultHint: string }
> = {
  qq: { title: "QQ 群", accountLabel: "群号", defaultHint: "使用手机 QQ 扫一扫，加入售后服务群" },
  wechat: { title: "微信群", accountLabel: "微信号", defaultHint: "使用微信扫一扫，加入交流群" },
  douyin: { title: "抖音", accountLabel: "抖音号", defaultHint: "使用抖音扫一扫，关注我们" },
};

const CHANNEL_ORDER: CommunityChannelId[] = ["qq", "wechat", "douyin"];
const CACHE_KEY = "ai_helper_community_config";
const TELEMETRY_SERVER_URL_KEY = "ai_helper_telemetry_server_url";
const REPORT_PATH = /\/api\/telemetry\/report\/?$/;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const TEXT_LIMITS = { name: 40, account: 60, hint: 80 } as const;
// 与后台的校验一致：只接受内嵌的 PNG / JPEG / WebP，不加载任何外链图片
const IMAGE_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_MAX_CHARS = 600_000;

function configEndpoint(): string {
  let reportUrl = "";
  try {
    reportUrl = localStorage.getItem(TELEMETRY_SERVER_URL_KEY) ?? "";
  } catch {}
  const envBase = import.meta.env?.VITE_TELEMETRY_SERVER_URL as string | undefined;
  const base = reportUrl
    ? reportUrl.replace(REPORT_PATH, "")
    : (envBase ?? "https://monitor.bob-api.com");
  return `${base.replace(/\/+$/, "")}/api/app-config/community`;
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  // 只当纯文字展示：去掉控制字符并截断
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit);
}

/**
 * 把后台返回的内容规整成可展示的渠道列表。后台内容不可信：
 * 字段只取文字，图片只取符合格式的内嵌图片。
 * 显示规则只有一条：渠道已启用且有二维码才显示，没有二维码就不显示。
 */
export function parseCommunityChannels(payload: unknown): CommunityChannel[] {
  const raw = (payload as { channels?: unknown } | null)?.channels;
  if (!Array.isArray(raw)) return [];
  const channels: CommunityChannel[] = [];
  for (const id of CHANNEL_ORDER) {
    const item = raw.find((entry) => (entry as { id?: unknown } | null)?.id === id) as
      | Record<string, unknown>
      | undefined;
    if (!item || item.enabled !== true) continue;
    const image = typeof item.qr_image === "string" ? item.qr_image : "";
    if (!image || image.length > IMAGE_MAX_CHARS || !IMAGE_PATTERN.test(image)) continue;
    channels.push({
      id,
      // 没填名称时用渠道名（「微信群」「抖音」）顶上
      name: cleanText(item.name, TEXT_LIMITS.name) || COMMUNITY_CHANNEL_META[id].title,
      account: cleanText(item.account, TEXT_LIMITS.account),
      hint: cleanText(item.hint, TEXT_LIMITS.hint),
      qrImage: image,
    });
  }
  return channels;
}

interface CachedConfig {
  fetchedAt: number;
  config: unknown;
}

function readCache(): CachedConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedConfig;
    return typeof parsed?.fetchedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function channelsFromCache(): CommunityChannel[] {
  return parseCommunityChannels(readCache()?.config);
}

let inFlight: Promise<CommunityChannel[]> | null = null;

/** 联网读取最新配置；失败时保留已有缓存。并发调用共用同一次请求。 */
export function refreshCommunityChannels(): Promise<CommunityChannel[]> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch(configEndpoint(), {
        // 公开接口：不带任何凭据
        credentials: "omit",
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timer));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { success?: boolean; config?: unknown };
      if (!body.success) throw new Error("unexpected response");
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ fetchedAt: Date.now(), config: body.config } satisfies CachedConfig),
        );
      } catch {
        // 缓存写不进去（例如空间不足）不影响本次展示
      }
      return parseCommunityChannels(body.config);
    } catch (error) {
      console.warn("读取社群配置失败，沿用已有内容:", error);
      return channelsFromCache();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * 社群渠道列表：先用缓存立即展示；挂载时以及 `refreshKey` 变化时
 * （例如打开弹窗），如果缓存已过期就联网刷新。列表为空表示后台没有可显示的渠道。
 */
export function useCommunityChannels(refreshKey: unknown): CommunityChannel[] {
  const [channels, setChannels] = useState<CommunityChannel[]>(channelsFromCache);

  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS) return;
    let cancelled = false;
    void refreshCommunityChannels().then((next) => {
      if (!cancelled) setChannels(next);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return channels;
}

import type { PricingResponse } from "../types";

export const GROUP_PRICING_MAX_AGE_MS = 5 * 60 * 1000;

export interface GroupPricingSnapshot {
  groupRatio: Record<string, number>;
  usableGroup: Record<string, string>;
  loadedAt: number | null;
}

export function emptyGroupPricing(): GroupPricingSnapshot {
  return { groupRatio: {}, usableGroup: {}, loadedAt: null };
}

export function createGroupPricing(
  pricing: PricingResponse | null,
  now = Date.now(),
): GroupPricingSnapshot {
  if (!pricing?.success || !Number.isFinite(now)) return emptyGroupPricing();
  const groupRatio: Record<string, number> = {};
  const ratios = { ...pricing.group_ratio, ...pricing.svip_group_ratio };
  for (const [group, ratio] of Object.entries(ratios)) {
    if (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0) {
      groupRatio[group] = ratio;
    }
  }
  return {
    groupRatio,
    usableGroup: pricing.usable_group || {},
    loadedAt: Object.keys(groupRatio).length > 0 ? now : null,
  };
}

export function getValidGroupRatio(
  pricing: GroupPricingSnapshot,
  group: string,
  now = Date.now(),
): number | null {
  const ratio = pricing.groupRatio[group];
  const age = pricing.loadedAt === null ? NaN : now - pricing.loadedAt;
  if (
    !Number.isFinite(age) || age < 0 || age >= GROUP_PRICING_MAX_AGE_MS ||
    typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0
  ) return null;
  return ratio;
}

export function getGroupSwitchError(
  pricing: GroupPricingSnapshot,
  group: string,
  highRateConfirmed: boolean,
  now = Date.now(),
): string | null {
  const ratio = getValidGroupRatio(pricing, group, now);
  if (ratio === null) return "目标分组费率未知、正在刷新或已过期，请刷新费率后再提交";
  if (ratio >= 2 && !highRateConfirmed) return "高倍率通道需要显式确认后才能切换";
  return null;
}

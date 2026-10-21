// Currency conversion stays unavailable until its server contract is confirmed.
export const QUOTA_CONVERSION_UNAVAILABLE = "换算不可用";

export function isPlatformQuota(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function formatPlatformQuota(value: unknown): string {
  return isPlatformQuota(value) ? value.toLocaleString("zh-CN") : "未知";
}

export function sumPlatformQuota(values: unknown[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!isPlatformQuota(value)) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function quotaUsageRatio(remaining: unknown, used: unknown): number | null {
  if (!isPlatformQuota(remaining) || !isPlatformQuota(used) || remaining < 0 || used < 0) return null;
  const total = remaining + used;
  return Number.isSafeInteger(total) && total > 0 ? used / total * 100 : null;
}

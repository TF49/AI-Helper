let pendingTimer: number | undefined;
let expectedValue: string | undefined;

export function scheduleClipboardClear(copied: string, delayMs = 60_000) {
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
  }
  expectedValue = copied;
  pendingTimer = window.setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (expectedValue !== undefined && current === expectedValue) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // 无剪贴板权限时静默跳过
      }
    })();
    pendingTimer = undefined;
    expectedValue = undefined;
  }, delayMs);
}
let pendingTimer: number | undefined;
let clearGeneration = 0;

export function scheduleClipboardClear(copied: string, delayMs = 60_000) {
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
  }
  const generation = ++clearGeneration;
  pendingTimer = window.setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (generation === clearGeneration && current === copied) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // 无剪贴板权限时静默跳过
      }
    })();
    if (generation === clearGeneration) {
      pendingTimer = undefined;
    }
  }, delayMs);
}

// 轻量跨平台检测工具库
export const isMac = (): boolean => {
  if (typeof navigator === "undefined") return false;
  try {
    const ua = navigator.userAgent || "";
    const plat = (navigator.platform || "").toLowerCase();
    return /mac/i.test(ua) || plat.includes("mac");
  } catch {
    return false;
  }
};

export const isWindows = (): boolean => {
  if (typeof navigator === "undefined") return true;
  try {
    const ua = navigator.userAgent || "";
    return /windows|win32|win64/i.test(ua);
  } catch {
    return true;
  }
};

export const modifierKey = (): string => {
  return isMac() ? "⌘" : "Ctrl";
};

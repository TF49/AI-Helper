import { useCallback, useSyncExternalStore } from "react";

/**
 * 用户自定义头像（本地存储）
 *
 * bob-api.com 账户体系不提供头像接口，因此头像仅保存在本机：
 * 图片在前端居中裁剪为正方形并压缩为 256×256，以 data URL 形式按账号 ID 存入 localStorage。
 */

const STORAGE_PREFIX = "ai_helper_user_avatar:";
const CHANGE_EVENT = "ai-helper-avatar-change";

export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const ACCEPTED_TYPES = new Set(AVATAR_ACCEPT.split(","));
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 原始文件上限 10MB
const OUTPUT_SIZE = 256;

function storageKey(userId: number | string | null | undefined) {
  return userId == null ? null : `${STORAGE_PREFIX}${userId}`;
}

function readAvatar(key: string | null): string | null {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解析失败，请换一张图片试试"));
    };
    img.src = url;
  });
}

/** 校验、居中裁剪并压缩图片，返回 data URL */
export async function processAvatarFile(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG / JPG / WEBP / GIF 格式的图片");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("图片不能超过 10MB");
  }

  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error("图片尺寸无效");

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持图片处理");

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  const webp = canvas.toDataURL("image/webp", 0.88);
  if (webp.startsWith("data:image/webp")) return webp;

  // macOS (WKWebView) / Linux (WebKitGTK) 不支持导出 webp，回退为 jpeg 控制体积；
  // jpeg 无透明通道，先在图像下方铺白底，避免透明 PNG 的透明区域变成黑色
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export function useAvatar(userId: number | string | null | undefined) {
  const key = storageKey(userId);
  const avatar = useSyncExternalStore(
    subscribe,
    () => readAvatar(key),
    () => null
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      if (!key) throw new Error("请先登录账号后再设置头像");
      const dataUrl = await processAvatarFile(file);
      try {
        localStorage.setItem(key, dataUrl);
      } catch {
        throw new Error("本地存储空间不足，头像保存失败");
      }
      notify();
    },
    [key]
  );

  const removeAvatar = useCallback(() => {
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    notify();
  }, [key]);

  return { avatar, uploadAvatar, removeAvatar };
}

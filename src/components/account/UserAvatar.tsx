import React, { useRef, useState } from "react";
import { Camera, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import { AVATAR_ACCEPT, useAvatar } from "../../lib/useAvatar";
import { cn } from "../../lib/utils";
import type { UserInfo } from "../../types";

/** 根据用户名生成头像占位文字：CJK 取 1 个字，拉丁字母取前 2 位；纯数字账号返回 null（显示图标） */
export function getAvatarInitials(user?: UserInfo | null): string | null {
  const name = (user?.display_name || user?.username || "").trim();
  if (!name || /^\d/.test(name)) return null;
  const first = Array.from(name)[0];
  if (/\p{Script=Han}/u.test(first)) return first;
  return name.slice(0, 2).toUpperCase();
}

export interface UserAvatarProps {
  user?: UserInfo | null;
  /** 头像边长 (px) */
  size?: number;
  className?: string;
  /** 开启后点击头像可上传 / 更换自定义头像 */
  editable?: boolean;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  size = 32,
  className,
  editable = false,
}) => {
  const { avatar, uploadAvatar } = useAvatar(user?.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const initials = getAvatarInitials(user);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await uploadAvatar(file);
      toast.success("头像已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      setUploading(false);
    }
  };

  const face = (
    <span
      className={cn(
        "relative flex items-center justify-center rounded-full overflow-hidden flex-shrink-0 select-none",
        "bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {avatar ? (
        <img src={avatar} alt="头像" className="w-full h-full object-cover" draggable={false} />
      ) : initials ? (
        <span className="leading-none">{initials}</span>
      ) : (
        <User size={Math.round(size * 0.5)} className="text-current" />
      )}

      {editable && (
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity",
            uploading ? "opacity-100" : "opacity-0 group-hover/avatar:opacity-100"
          )}
        >
          {uploading ? (
            <Loader2 size={Math.round(size * 0.38)} className="animate-spin" />
          ) : (
            <Camera size={Math.round(size * 0.38)} />
          )}
        </span>
      )}
    </span>
  );

  if (!editable) return face;

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group/avatar relative rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900"
        title={avatar ? "点击更换头像" : "点击上传头像"}
        aria-label={avatar ? "更换头像" : "上传头像"}
      >
        {face}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={(e) => void handleFile(e)}
      />
    </>
  );
};

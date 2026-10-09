import { useState, useEffect } from "react";
import {
  Eye,
  EyeOff,
  Clipboard,
  Copy,
  X,
  KeyRound,
  ChevronDown,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/useAuth";
import { TokenSelectModal } from "./auth/TokenSelectModal";
import { ChannelGroupMonitor } from "./ChannelGroupMonitor";
import { getUserTokens } from "../lib/api";
import type { TokenItem } from "../types";

export interface ApiKeyInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  envVarName?: string;
  hintText?: string;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  toolName?: string;
  toolId?: string;
  title?: string;
  badgeText?: string;
  storageLocation?: string;
  configKey?: string;
  securityNote?: React.ReactNode;
  hideHeader?: boolean;
  hideFooter?: boolean;
  hideGroupMonitor?: boolean;
  compact?: boolean;
  className?: string;
}

export function ApiKeyInput({
  value,
  onChange,
  placeholder = "sk-...",
  envVarName,
  hintText,
  accentColor = "blue",
  toolName = "当前工具",
  toolId,
  title,
  badgeText,
  storageLocation,
  configKey,
  securityNote,
  hideHeader = false,
  hideFooter = false,
  hideGroupMonitor = false,
  compact = false,
  className,
}: ApiKeyInputProps) {
  const [show, setShow] = useState(false);
  const [localTokenModalOpen, setLocalTokenModalOpen] = useState(false);

  const { authState, setLoginModalOpen } = useAuth();

  const effectiveToolId =
    toolId || toolName.toLowerCase().replace(/[^a-z0-9]/g, "") || "default";
  const storageKey = `bound_token_${effectiveToolId}`;

  const [boundToken, setBoundToken] = useState<{
    id: number;
    name: string;
    group?: string | null;
  } | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // 当外部 value 被手动清空时，同步解除绑定
  useEffect(() => {
    if (!value.trim() && boundToken) {
      setBoundToken(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }
  }, [value, boundToken, storageKey]);

  // 当处于已登录状态且 boundToken 缺少 group 或尚未绑定时，尝试通过 API 补充匹配关联
  useEffect(() => {
    if (!authState.is_logged_in || !value.trim()) return;

    // 如果 boundToken 已经完整（有 id 也有 group），无需重复匹配
    if (boundToken && boundToken.group) return;

    let isMounted = true;
    getUserTokens()
      .then((tokens) => {
        if (!isMounted || !tokens || tokens.length === 0) return;

        // 1. 如果已有 boundToken 但缺少 group 字段，通过 id 查找
        if (boundToken && !boundToken.group) {
          const match = tokens.find((t) => t.id === boundToken.id);
          if (match && match.group) {
            const updated = { ...boundToken, group: match.group };
            setBoundToken(updated);
            try {
              localStorage.setItem(storageKey, JSON.stringify(updated));
            } catch {}
          }
          return;
        }

        // 2. 如果 boundToken 为 null，通过当前输入框中的 Key 明文比对匹配
        const val = value.trim();
        const exactMatch = tokens.find((t) => t.key && t.key === val);
        if (exactMatch) {
          const info = {
            id: exactMatch.id,
            name: exactMatch.name,
            group: exactMatch.group ?? undefined,
          };
          setBoundToken(info);
          try {
            localStorage.setItem(storageKey, JSON.stringify(info));
          } catch {}
          return;
        }

        // 若为脱敏 key，尝试基于前缀+后缀匹配
        if (val.length >= 12) {
          const prefix = val.slice(0, 7);
          const suffix = val.slice(-4);
          const partialMatch = tokens.find(
            (t) =>
              t.key &&
              t.key.startsWith(prefix) &&
              t.key.endsWith(suffix),
          );
          if (partialMatch) {
            const info = {
              id: partialMatch.id,
              name: partialMatch.name,
              group: partialMatch.group ?? undefined,
            };
            setBoundToken(info);
            try {
              localStorage.setItem(storageKey, JSON.stringify(info));
            } catch {}
          }
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [authState.is_logged_in, value, boundToken, storageKey]);

  // 监听全套同步事件 (仅在明确点击全套同步时联动)
  useEffect(() => {
    const handleSyncEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        id: number;
        name: string;
        key: string;
        group?: string | null;
      }>;
      if (customEvent.detail) {
        const info = {
          id: customEvent.detail.id,
          name: customEvent.detail.name,
          group: customEvent.detail.group,
        };
        setBoundToken(info);
        try {
          localStorage.setItem(storageKey, JSON.stringify(info));
        } catch {}
      }
    };
    window.addEventListener("ai_helper_sync_all_tokens", handleSyncEvent);
    return () => {
      window.removeEventListener("ai_helper_sync_all_tokens", handleSyncEvent);
    };
  }, [storageKey]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text.trim());
        toast.success("已从剪贴板粘贴 API Key");
      } else {
        toast.info("剪贴板为空");
      }
    } catch {
      toast.error("读取剪贴板失败，请手动按 Ctrl+V 粘贴");
    }
  };

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制 API Key 到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleClear = () => {
    onChange("");
    toast.info("已清空");
  };

  const isEmerald = accentColor === "emerald";
  const isPurple = accentColor === "purple";
  const isOrange = accentColor === "orange";
  const isBlue = !isEmerald && !isPurple && !isOrange;

  const handleKeySelected = (plainKey: string, token: TokenItem) => {
    onChange(plainKey);
    const info = { id: token.id, name: token.name, group: token.group ?? undefined };
    setBoundToken(info);
    try {
      localStorage.setItem(storageKey, JSON.stringify(info));
    } catch {}
  };

  return (
    <div className={cn("flex flex-col justify-between h-full space-y-2.5", className)}>
      <div className="space-y-2.5">
        {/* 顶部标题与快捷操作栏 */}
        {title ? (
          <div className="flex items-center justify-between gap-2.5 mb-1 flex-wrap sm:flex-nowrap">
            {/* 左侧：标题与存储位置标识 */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors shadow-2xs border",
                  isPurple &&
                    "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
                  isEmerald &&
                    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                  isOrange &&
                    "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
                  isBlue &&
                    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
                )}
              >
                <KeyRound size={13} />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 truncate tracking-tight">
                  {title}
                </span>
                {badgeText && (
                  <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border border-slate-200/60 dark:border-white/5 shadow-2xs">
                    {badgeText}
                  </span>
                )}
              </div>
            </div>

            {/* 右侧：选择已有 Key 按钮与登录账号状态 */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {authState.is_logged_in ? (
                <>
                  <button
                    type="button"
                    onClick={() => setLocalTokenModalOpen(true)}
                    className={cn(
                      "group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer shadow-xs active:scale-[0.97] hover:scale-[1.01]",
                      isEmerald
                        ? "bg-emerald-50/90 hover:bg-emerald-100/90 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200 border border-emerald-200/90 dark:border-emerald-500/35 hover:shadow-emerald-500/15"
                        : isPurple
                          ? "bg-purple-50/90 hover:bg-purple-100/90 text-purple-800 dark:bg-purple-500/15 dark:text-purple-200 border border-purple-200/90 dark:border-purple-500/35 hover:shadow-purple-500/15"
                          : isOrange
                            ? "bg-orange-50/90 hover:bg-orange-100/90 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200 border border-orange-200/90 dark:border-orange-500/35 hover:shadow-orange-500/15"
                            : "bg-blue-50/90 hover:bg-blue-100/90 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200 border border-blue-200/90 dark:border-blue-500/35 hover:shadow-blue-500/15",
                    )}
                    title={`为当前「${toolName}」选择或关联 API Key`}
                  >
                    {boundToken ? (
                      <>
                        <span className="relative flex h-2 w-2 mr-0.5">
                          <span
                            className={cn(
                              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                              isEmerald
                                ? "bg-emerald-400"
                                : isPurple
                                  ? "bg-purple-400"
                                  : isOrange
                                    ? "bg-orange-400"
                                    : "bg-blue-400",
                            )}
                          />
                          <span
                            className={cn(
                              "relative inline-flex rounded-full h-2 w-2",
                              isEmerald
                                ? "bg-emerald-500"
                                : isPurple
                                  ? "bg-purple-500"
                                  : isOrange
                                    ? "bg-orange-500"
                                    : "bg-blue-500",
                            )}
                          />
                        </span>
                        <KeyRound
                          size={11}
                          className="opacity-90 group-hover:rotate-12 transition-transform duration-200"
                        />
                        <span className="font-semibold tracking-wide truncate max-w-[90px] sm:max-w-[120px]">
                          已关联: {boundToken.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <KeyRound
                          size={11}
                          className="opacity-80 group-hover:rotate-12 transition-transform duration-200"
                        />
                        <span>选择已有 Key</span>
                      </>
                    )}
                    <ChevronDown
                      size={11}
                      className={cn(
                        "opacity-60 transition-transform duration-300",
                        localTokenModalOpen ? "rotate-180" : "group-hover:translate-y-0.5",
                      )}
                    />
                  </button>

                  <div
                    className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-mono bg-slate-100/70 dark:bg-white/5 px-2 py-1 rounded-lg border border-slate-200/60 dark:border-white/5"
                    title={`当前已登录账号: ${authState.user?.username}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                    <span className="max-w-[80px] truncate">{authState.user?.username}</span>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-all cursor-pointer active:scale-98 shadow-xs"
                  title="登录 bob-api.com 账号即可直接从列表中勾选 API Key"
                >
                  <ShieldCheck size={12} className="text-blue-500" />
                  <span>一键选 Key</span>
                  <Sparkles size={11} className="text-amber-500" />
                </button>
              )}
            </div>
          </div>
        ) : !hideHeader ? (
          /* 没有传入 title 时的兼容回退头部 (如单独使用或在弹窗中使用) */
          <div className="flex items-center justify-between px-0.5 text-xs mb-1">
            <div className="flex items-center gap-2">
              {authState.is_logged_in ? (
                <button
                  type="button"
                  onClick={() => setLocalTokenModalOpen(true)}
                  className={cn(
                    "group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer shadow-xs active:scale-[0.97] hover:scale-[1.01]",
                    isEmerald
                      ? "bg-emerald-50/90 hover:bg-emerald-100/90 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200 border border-emerald-200/90 dark:border-emerald-500/35 hover:shadow-emerald-500/15"
                      : isPurple
                        ? "bg-purple-50/90 hover:bg-purple-100/90 text-purple-800 dark:bg-purple-500/15 dark:text-purple-200 border border-purple-200/90 dark:border-purple-500/35 hover:shadow-purple-500/15"
                        : isOrange
                          ? "bg-orange-50/90 hover:bg-orange-100/90 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200 border border-orange-200/90 dark:border-orange-500/35 hover:shadow-orange-500/15"
                          : "bg-blue-50/90 hover:bg-blue-100/90 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200 border border-blue-200/90 dark:border-blue-500/35 hover:shadow-blue-500/15",
                  )}
                  title={`为当前「${toolName}」选择或关联 API Key`}
                >
                  {boundToken ? (
                    <>
                      <span className="relative flex h-2 w-2 mr-0.5">
                        <span
                          className={cn(
                            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                            isEmerald
                              ? "bg-emerald-400"
                              : isPurple
                                ? "bg-purple-400"
                                : isOrange
                                  ? "bg-orange-400"
                                  : "bg-blue-400",
                          )}
                        />
                        <span
                          className={cn(
                            "relative inline-flex rounded-full h-2 w-2",
                            isEmerald
                              ? "bg-emerald-500"
                              : isPurple
                                ? "bg-purple-500"
                                : isOrange
                                  ? "bg-orange-500"
                                  : "bg-blue-500",
                          )}
                        />
                      </span>
                      <KeyRound
                        size={11}
                        className="opacity-90 group-hover:rotate-12 transition-transform duration-200"
                      />
                      <span className="font-semibold tracking-wide">
                        已关联: {boundToken.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <KeyRound
                        size={11}
                        className="opacity-80 group-hover:rotate-12 transition-transform duration-200"
                      />
                      <span>选择已有 API Key</span>
                    </>
                  )}
                  <ChevronDown
                    size={11}
                    className={cn(
                      "opacity-60 transition-transform duration-300",
                      localTokenModalOpen ? "rotate-180" : "group-hover:translate-y-0.5",
                    )}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-all cursor-pointer active:scale-98 shadow-xs"
                  title="登录 bob-api.com 账号即可直接从列表中勾选 API Key"
                >
                  <ShieldCheck size={12} className="text-blue-500" />
                  <span>登录 bob-api 账号一键选 Key</span>
                  <Sparkles size={11} className="text-amber-500 ml-0.5" />
                </button>
              )}
            </div>

            {authState.is_logged_in && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-mono bg-slate-100/70 dark:bg-white/5 px-2 py-0.5 rounded-lg border border-slate-200/60 dark:border-white/5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{authState.user?.username}</span>
              </div>
            )}
          </div>
        ) : null}

        {/* API Key 输入框主体 */}
        <div className="relative group">
          <div
            className={cn(
              "absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-gray-500 transition-colors duration-200",
              isEmerald
                ? "group-focus-within:text-emerald-500"
                : isPurple
                  ? "group-focus-within:text-purple-500"
                  : isOrange
                    ? "group-focus-within:text-orange-500"
                    : "group-focus-within:text-blue-500",
            )}
          >
            <KeyRound size={15} />
          </div>

          <Input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
              "pl-10 pr-24 font-mono text-xs tracking-wider rounded-xl h-10.5",
              "bg-slate-50/80 dark:bg-[#141724]/80 border-slate-200 dark:border-white/10 text-slate-900 dark:text-gray-200",
              "transition-all duration-200 placeholder:text-slate-400 dark:placeholder:text-gray-600 shadow-2xs",
              isEmerald
                ? "focus:bg-white dark:focus:bg-[#141724] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                : isPurple
                  ? "focus:bg-white dark:focus:bg-[#141724] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                  : isOrange
                    ? "focus:bg-white dark:focus:bg-[#141724] focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                    : "focus:bg-white dark:focus:bg-[#141724] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
            )}
          />

          {/* 右侧快捷操作按钮组 */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {value ? (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  title="复制 API Key"
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
                  title="清空"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handlePaste}
                className={cn(
                  "flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border font-medium transition-colors cursor-pointer shadow-2xs",
                  isEmerald
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : isPurple
                      ? "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-400"
                      : isOrange
                        ? "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-400"
                        : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400",
                )}
                title="一键粘贴剪贴板内容"
              >
                <Clipboard size={11} />
                <span>粘贴</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              title={show ? "隐藏内容" : "显示内容"}
              tabIndex={-1}
            >
              {show ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* 底部存储位置与隐私安全提示条 */}
      {!hideFooter && (
        <div
          className={cn(
            "mt-3 flex items-center justify-between gap-2.5 rounded-xl border text-xs transition-colors",
            compact ? "p-2 text-[11px]" : "p-2.5 text-xs",
            "bg-slate-50/70 border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-slate-500 dark:text-gray-400",
          )}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ShieldCheck
              size={compact ? 13 : 14}
              className={cn(
                "flex-shrink-0",
                isEmerald
                  ? "text-emerald-500 dark:text-emerald-400"
                  : isPurple
                    ? "text-purple-500 dark:text-purple-400"
                    : isOrange
                      ? "text-orange-500 dark:text-orange-400"
                      : "text-blue-500 dark:text-blue-400",
              )}
            />
            <div className="leading-relaxed truncate sm:whitespace-normal">
              {securityNote ? (
                securityNote
              ) : storageLocation && configKey ? (
                <span>
                  写入本地{" "}
                  <code
                    className={cn(
                      "px-1 py-0.5 rounded font-mono text-[11px] font-medium",
                      isPurple && "bg-purple-500/10 text-purple-700 dark:text-purple-300",
                      isEmerald && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      isOrange && "bg-orange-500/10 text-orange-700 dark:text-orange-300",
                      isBlue && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    {storageLocation}
                  </code>{" "}
                  (
                  <code className="font-mono text-[11px] font-semibold text-slate-700 dark:text-gray-200">
                    {configKey}
                  </code>
                  )，终端启动自动读取，绝不上报云端。
                </span>
              ) : storageLocation ? (
                <span>
                  保存在本地{" "}
                  <code
                    className={cn(
                      "px-1 py-0.5 rounded font-mono text-[11px] font-medium",
                      isPurple && "bg-purple-500/10 text-purple-700 dark:text-purple-300",
                      isEmerald && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      isOrange && "bg-orange-500/10 text-orange-700 dark:text-orange-300",
                      isBlue && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    {storageLocation}
                  </code>
                  {hintText ? `，${hintText}` : "，直连服务商网关，绝不上报云端。"}
                </span>
              ) : envVarName ? (
                <span>
                  写入当前用户系统环境变量{" "}
                  <code
                    className={cn(
                      "px-1 py-0.5 rounded font-mono text-[11px] font-medium",
                      isPurple && "bg-purple-500/10 text-purple-700 dark:text-purple-300",
                      isEmerald && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      isOrange && "bg-orange-500/10 text-orange-700 dark:text-orange-300",
                      isBlue && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    {envVarName}
                  </code>
                  ，本地直连专线通信。
                </span>
              ) : hintText ? (
                <span>{hintText}</span>
              ) : (
                <span>凭据仅储存于本地配置与当前环境，直接与所选专线通信，绝不上报云端。</span>
              )}
            </div>
          </div>

          {/* 右侧：字符数标签或状态提示 */}
          <div className="flex-shrink-0 flex items-center">
            {value ? (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-white dark:bg-white/5 border border-slate-200/70 dark:border-white/10 text-slate-500 dark:text-gray-400 shadow-2xs font-medium">
                {value.length} 字符
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-md font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 shadow-2xs">
                待配置
              </span>
            )}
          </div>
        </div>
      )}

      {/* 底部通道分组健康稳定性监控面板 (在四个工具中均在此配置 Key 下方复用呈现) */}
      {!hideGroupMonitor && !compact && (
        <div className="mt-3.5">
          <ChannelGroupMonitor
            currentGroupName={boundToken?.group}
            toolName={toolName}
            toolId={effectiveToolId}
            accentColor={accentColor}
            onOpenTokenSelect={() => setLocalTokenModalOpen(true)}
          />
        </div>
      )}

      {/* 当前工具专用的令牌选择弹窗（带有流畅 GSAP & React-Bits 动效） */}
      <TokenSelectModal
        open={localTokenModalOpen}
        selectedTokenId={boundToken?.id ?? null}
        onSelectKey={handleKeySelected}
        onClose={() => setLocalTokenModalOpen(false)}
        toolName={toolName}
        accentColor={accentColor}
      />
    </div>
  );
}

export default ApiKeyInput;

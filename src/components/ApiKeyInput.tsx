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
import { getUserTokens, getTokenKey } from "../lib/api";
import type { TokenItem } from "../types";
import { isKeyMatch, type BoundTokenInfo } from "../lib/useBoundTokenGroup";
import { scheduleClipboardClear } from "../lib/secureClipboard";

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
  /** 绑定 Token（含分组）变更时回传，供确认页等展示 */
  onBoundTokenChange?: (info: BoundTokenInfo | null) => void;
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
  onBoundTokenChange,
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

  // 向父组件同步绑定信息（含分组）；仅在有绑定时回传，避免挂载时 null 清空已解析分组
  useEffect(() => {
    if (boundToken) {
      onBoundTokenChange?.(boundToken);
    }
  }, [boundToken, onBoundTokenChange]);

  // 当处于已登录状态且 boundToken 存在时，通过 API 校验并同步最新 group；或未绑定时尝试自动匹配
  useEffect(() => {
    if (!authState.is_logged_in || !value.trim()) return;

    let isMounted = true;
    getUserTokens()
      .then((tokens) => {
        if (!isMounted || !tokens || tokens.length === 0) return;

        const val = value.trim();

        // 1. 如果已有 boundToken，核对该绑定是否依然与当前输入框的 Key 匹配
        if (boundToken) {
          const match = tokens.find((t) => t.id === boundToken.id);
          const isStillMatch = match
            ? !match.key || isKeyMatch(match.key, val)
            : false;

          if (match && isStillMatch) {
            const resolvedGroup = match.group?.trim() || "default";
            if (resolvedGroup !== boundToken.group) {
              const updated = {
                ...boundToken,
                group: resolvedGroup,
              };
              setBoundToken(updated);
              try {
                localStorage.setItem(storageKey, JSON.stringify(updated));
              } catch {}
            }
            return;
          }

          // 已不匹配当前输入的 Key（或已在云端被删除），解除旧绑定并重新向下比对
          setBoundToken(null);
          try {
            localStorage.removeItem(storageKey);
          } catch {}
        }

        // 2. 如果 boundToken 为 null 或已解绑，通过当前输入框中的 Key 明文比对匹配
        const matched = tokens.find((t) => isKeyMatch(t.key, val));
        if (matched) {
          const info = {
            id: matched.id,
            name: matched.name,
            group: matched.group?.trim() || "default",
          };
          setBoundToken(info);
          try {
            localStorage.setItem(storageKey, JSON.stringify(info));
          } catch {}
          return;
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [authState.is_logged_in, value, boundToken, storageKey]);

  // 监听全套同步与分组变更事件
  useEffect(() => {
    const handleSyncEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        id: number;
        name: string;
        group?: string | null;
      }>;
      if (customEvent.detail) {
        if (customEvent.detail.id) {
          void getTokenKey(customEvent.detail.id)
            .then((key) => {
              if (key) onChange(key);
            })
            .catch(() => {});
        }
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

    const handleGroupUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        toolId?: string;
        tokenId?: number;
        group: string;
      }>;
      if (customEvent.detail) {
        setBoundToken((prev) => {
          if (!prev) return prev;
          // 若指定了 tokenId 且当前绑定不匹配，则不更新
          if (
            customEvent.detail.tokenId &&
            prev.id &&
            prev.id !== customEvent.detail.tokenId
          ) {
            return prev;
          }
          // 若指定了 toolId 且与当前工具不匹配，则不更新
          if (
            customEvent.detail.toolId &&
            customEvent.detail.toolId !== effectiveToolId
          ) {
            return prev;
          }
          const updated = { ...prev, group: customEvent.detail.group };
          try {
            localStorage.setItem(storageKey, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
    };

    window.addEventListener("ai_helper_sync_all_tokens", handleSyncEvent);
    window.addEventListener("ai_helper_group_updated", handleGroupUpdated);
    return () => {
      window.removeEventListener("ai_helper_sync_all_tokens", handleSyncEvent);
      window.removeEventListener("ai_helper_group_updated", handleGroupUpdated);
    };
  }, [storageKey, effectiveToolId, onChange]);

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
      scheduleClipboardClear(value);
      toast.success("已复制 API Key 到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleClear = () => {
    onChange("");
    toast.info("已清空");
  };

  const handleKeySelected = (plainKey: string, token: TokenItem) => {
    onChange(plainKey);
    const info = {
      id: token.id,
      name: token.name,
      group: token.group?.trim() || "default",
    };
    setBoundToken(info);
    try {
      localStorage.setItem(storageKey, JSON.stringify(info));
    } catch {}
    onBoundTokenChange?.(info);
  };

  return (
    <div
      className={cn(
        "flex flex-col justify-between h-full space-y-2.5",
        className,
      )}
    >
      <div className="space-y-2.5">
        {/* 顶部标题与快捷操作栏 */}
        {title ? (
          <div className="flex items-center justify-between gap-2.5 mb-1 flex-wrap sm:flex-nowrap">
            {/* 左侧：标题与存储位置标识 */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors shadow-2xs border bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800"
              >
                <KeyRound size={13} />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate tracking-tight">
                  {title}
                </span>
                {badgeText && (
                  <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800 shadow-2xs">
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
                    className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer shadow-xs active:scale-[0.97] hover:scale-[1.01] bg-neutral-100 hover:bg-neutral-200 text-neutral-900 dark:bg-neutral-900 dark:hover:bg-neutral-800 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-800"
                    title={`为当前「${toolName}」选择或关联 API Key`}
                  >
                    {boundToken ? (
                      <>
                        <span className="relative flex h-2 w-2 mr-0.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
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
                        localTokenModalOpen
                          ? "rotate-180"
                          : "group-hover:translate-y-0.5",
                      )}
                    />
                  </button>

                  <div
                    className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-mono bg-slate-100/70 dark:bg-white/5 px-2 py-1 rounded-lg border border-slate-200/60 dark:border-white/5"
                    title={`当前已登录账号: ${authState.user?.username}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                    <span className="max-w-[80px] truncate">
                      {authState.user?.username}
                    </span>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-all cursor-pointer active:scale-98 shadow-xs"
                  title="登录 bob-api.com 账号即可直接从列表中勾选 API Key"
                >
                  <ShieldCheck size={12} className="text-black dark:text-white" />
                  <span>一键选 Key</span>
                  <Sparkles size={11} className="text-neutral-400 dark:text-neutral-500" />
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
                  className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer shadow-xs active:scale-[0.97] hover:scale-[1.01] bg-neutral-100 hover:bg-neutral-200 text-neutral-900 dark:bg-neutral-900 dark:hover:bg-neutral-800 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-800"
                  title={`为当前「${toolName}」选择或关联 API Key`}
                >
                  {boundToken ? (
                    <>
                      <span className="relative flex h-2 w-2 mr-0.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
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
                      localTokenModalOpen
                        ? "rotate-180"
                        : "group-hover:translate-y-0.5",
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
                  <ShieldCheck size={12} className="text-black dark:text-white" />
                  <span>登录 bob-api 账号一键选 Key</span>
                  <Sparkles size={11} className="text-neutral-400 dark:text-neutral-500 ml-0.5" />
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
            className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400 dark:text-neutral-500 group-focus-within:text-black dark:group-focus-within:text-white transition-colors duration-200"
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
              "bg-neutral-50/80 dark:bg-[#0a0a0a] border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100",
              "transition-all duration-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 shadow-2xs",
              "focus:bg-white dark:focus:bg-black focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/20 dark:focus:ring-white/30",
            )}
          />

          {/* 右侧快捷操作按钮组 */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {value ? (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-black dark:text-neutral-500 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  title="复制 API Key"
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-500 dark:text-neutral-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
                  title="清空"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handlePaste}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border font-medium transition-colors cursor-pointer shadow-2xs border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
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
              className="flex-shrink-0 text-neutral-600 dark:text-neutral-400"
            />
            <div className="leading-relaxed truncate sm:whitespace-normal">
              {securityNote ? (
                securityNote
              ) : storageLocation && configKey ? (
                <span>
                  写入本地{" "}
                  <code
                    className="px-1 py-0.5 rounded font-mono text-[11px] font-medium bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-neutral-200/80 dark:border-neutral-800"
                  >
                    {storageLocation}
                  </code>{" "}
                  (
                  <code className="font-mono text-[11px] font-semibold text-neutral-900 dark:text-neutral-100">
                    {configKey}
                  </code>
                  )，终端启动自动读取，绝不上报云端。
                </span>
              ) : storageLocation ? (
                <span>
                  保存在本地{" "}
                  <code
                    className="px-1 py-0.5 rounded font-mono text-[11px] font-medium bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-neutral-200/80 dark:border-neutral-800"
                  >
                    {storageLocation}
                  </code>
                  {hintText
                    ? `，${hintText}`
                    : "，直连服务商网关，绝不上报云端。"}
                </span>
              ) : envVarName ? (
                <span>
                  写入当前用户系统环境变量{" "}
                  <code
                    className="px-1 py-0.5 rounded font-mono text-[11px] font-medium bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-neutral-200/80 dark:border-neutral-800"
                  >
                    {envVarName}
                  </code>
                  ，本地直连专线通信。
                </span>
              ) : hintText ? (
                <span>{hintText}</span>
              ) : (
                <span>
                  凭据仅储存于本地配置与当前环境，直接与所选专线通信，绝不上报云端。
                </span>
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
              <span className="text-[10px] px-2 py-0.5 rounded-md font-medium text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xs">
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
            hasConfiguredKey={Boolean(value?.trim())}
            configuredKey={value}
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

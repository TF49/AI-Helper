import { useState } from "react";
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
import type { TokenItem } from "../types";

export interface ApiKeyInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  envVarName?: string;
  hintText?: string;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  toolName?: string;
}

export function ApiKeyInput({
  value,
  onChange,
  placeholder = "sk-...",
  envVarName,
  hintText,
  accentColor = "blue",
  toolName = "当前工具",
}: ApiKeyInputProps) {
  const [show, setShow] = useState(false);
  const [localTokenModalOpen, setLocalTokenModalOpen] = useState(false);

  const { authState, setLoginModalOpen, onTokenSelected } = useAuth();

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

  const handleKeySelected = (plainKey: string, token: TokenItem) => {
    onChange(plainKey);
    onTokenSelected(plainKey, token);
  };

  return (
    <div className="space-y-2">
      {/* 顶部：快捷关联选择按钮与用户状态 */}
      <div className="flex items-center justify-between px-0.5 text-xs">
        <div className="flex items-center gap-2">
          {authState.is_logged_in ? (
            <button
              type="button"
              onClick={() => setLocalTokenModalOpen(true)}
              className={cn(
                "group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer shadow-xs active:scale-[0.97] hover:scale-[1.01]",
                isEmerald
                  ? "bg-emerald-50/90 hover:bg-emerald-100/90 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200 border border-emerald-200/90 dark:border-emerald-500/35 hover:shadow-emerald-500/15"
                  : isPurple
                    ? "bg-purple-50/90 hover:bg-purple-100/90 text-purple-800 dark:bg-purple-500/15 dark:text-purple-200 border border-purple-200/90 dark:border-purple-500/35 hover:shadow-purple-500/15"
                    : isOrange
                      ? "bg-orange-50/90 hover:bg-orange-100/90 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200 border border-orange-200/90 dark:border-orange-500/35 hover:shadow-orange-500/15"
                      : "bg-blue-50/90 hover:bg-blue-100/90 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200 border border-blue-200/90 dark:border-blue-500/35 hover:shadow-blue-500/15",
              )}
              title="查看并在弹窗中选择、切换或新建您的 API Key"
            >
              {authState.selected_token_name ? (
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
                  <KeyRound size={12} className="opacity-90 group-hover:rotate-12 transition-transform duration-200" />
                  <span className="font-semibold tracking-wide">
                    已关联: {authState.selected_token_name}
                  </span>
                </>
              ) : (
                <>
                  <KeyRound size={12} className="opacity-80 group-hover:rotate-12 transition-transform duration-200" />
                  <span>选择已有 API Key</span>
                </>
              )}
              <ChevronDown
                size={12}
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-all cursor-pointer active:scale-98 shadow-xs"
              title="登录 bob-api.com 账号即可直接从列表中勾选 API Key"
            >
              <ShieldCheck size={13} className="text-blue-500" />
              <span>登录 bob-api 账号一键选 Key</span>
              <Sparkles size={11} className="text-amber-500 ml-0.5" />
            </button>
          )}
        </div>

        {/* 右侧微标：已登录账号 */}
        {authState.is_logged_in && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-mono bg-slate-100/70 dark:bg-white/5 px-2 py-0.5 rounded-lg border border-slate-200/60 dark:border-white/5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{authState.user?.username}</span>
          </div>
        )}
      </div>

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
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
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

      {/* 底部环境变量与长度提示 */}
      <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-gray-400">
        <span>
          {hintText ? (
            <span>{hintText}</span>
          ) : envVarName ? (
            <>
              写入环境变量{" "}
              <code className="text-slate-700 dark:text-gray-300 font-mono font-medium">
                {envVarName}
              </code>
            </>
          ) : null}
        </span>
        {value && (
          <span className="font-mono text-[10px] text-slate-400 dark:text-gray-500">
            {value.length} 字符
          </span>
        )}
      </div>

      {/* 当前工具专用的令牌选择弹窗（带有流畅 GSAP & React-Bits 动效） */}
      <TokenSelectModal
        open={localTokenModalOpen}
        selectedTokenId={authState.selected_token_id}
        onSelectKey={handleKeySelected}
        onClose={() => setLocalTokenModalOpen(false)}
        toolName={toolName}
        accentColor={accentColor}
      />
    </div>
  );
}

export default ApiKeyInput;

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
}

export function ApiKeyInput({
  value,
  onChange,
  placeholder = "sk-...",
  envVarName,
  hintText,
  accentColor = "blue",
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
    <div className="space-y-1.5">
      {/* 顶部：bob-api.com 快捷选择与状态胶囊 */}
      <div className="flex items-center justify-between px-0.5 text-xs">
        <div className="flex items-center gap-1.5">
          {authState.is_logged_in ? (
            <button
              type="button"
              onClick={() => setLocalTokenModalOpen(true)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer shadow-2xs",
                isEmerald
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30"
                  : isPurple
                    ? "bg-purple-50 hover:bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30"
                    : isOrange
                      ? "bg-orange-50 hover:bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 border border-orange-200 dark:border-orange-500/30"
                      : "bg-blue-50 hover:bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30",
              )}
              title="查看并选择您在 bob-api.com 上的全部 API Key"
            >
              <KeyRound size={12} className="opacity-80" />
              <span>
                {authState.selected_token_name
                  ? `已关联: ${authState.selected_token_name}`
                  : "从 bob-api 账号选择 Key"}
              </span>
              <ChevronDown size={11} className="opacity-60" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setLoginModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-colors cursor-pointer"
              title="登录 bob-api.com 账号即可直接从列表中勾选 API Key"
            >
              <ShieldCheck size={12} className="text-blue-500" />
              <span>登录 bob-api 账号一键选 Key</span>
            </button>
          )}
        </div>

        {/* 右侧微标 */}
        {authState.is_logged_in && (
          <span className="text-[11px] text-slate-400 dark:text-gray-500 flex items-center gap-1 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {authState.user?.username}
          </span>
        )}
      </div>

      <div className="relative group">
        <div
          className={cn(
            "absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-gray-500 transition-colors",
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
            "pl-10 pr-24 font-mono text-xs tracking-wider rounded-xl h-10",
            "bg-slate-50/80 dark:bg-[#141724]/80 border-slate-200 dark:border-white/10 text-slate-900 dark:text-gray-200",
            "transition-all duration-200 placeholder:text-slate-400 dark:placeholder:text-gray-600",
            isEmerald
              ? "focus:bg-white dark:focus:bg-[#141724] focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
              : isPurple
                ? "focus:bg-white dark:focus:bg-[#141724] focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
                : isOrange
                  ? "focus:bg-white dark:focus:bg-[#141724] focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
                  : "focus:bg-white dark:focus:bg-[#141724] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30",
          )}
        />

        {/* 右侧快捷操作按钮组 */}
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                title="复制 API Key"
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded-md text-slate-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                title="清空"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handlePaste}
              className={cn(
                "flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-medium transition-colors cursor-pointer",
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
              <Clipboard size={12} />
              粘贴
            </button>
          )}

          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title={show ? "隐藏内容" : "显示内容"}
            tabIndex={-1}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
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

      {/* 当前组件专用的令牌选择弹窗 */}
      <TokenSelectModal
        open={localTokenModalOpen}
        selectedTokenId={authState.selected_token_id}
        onSelectKey={handleKeySelected}
        onClose={() => setLocalTokenModalOpen(false)}
      />
    </div>
  );
}

export default ApiKeyInput;

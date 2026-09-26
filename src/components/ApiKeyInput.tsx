import { useState } from "react";
import { Eye, EyeOff, Clipboard, Copy, X, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

export interface ApiKeyInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  envVarName?: string;
  hintText?: string;
  accentColor?: "blue" | "purple" | "emerald";
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

  return (
    <div className="space-y-1.5">
      <div className="relative group">
        <div
          className={cn(
            "absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-gray-500 transition-colors",
            isEmerald
              ? "group-focus-within:text-emerald-500"
              : isPurple
                ? "group-focus-within:text-purple-500"
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
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                title="复制 API Key"
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded-md text-slate-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
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
                "flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-medium transition-colors",
                isEmerald
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : isPurple
                    ? "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-400"
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
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
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
    </div>
  );
}

export default ApiKeyInput;

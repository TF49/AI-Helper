import { useState } from "react";
import {
  FileCode,
  Check,
  Copy,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";

interface StatusBadgeProps {
  exists: boolean;
  path: string;
  onReload?: () => void;
  accentColor?: "blue" | "purple" | "emerald";
  className?: string;
}

export function StatusBadge({
  exists,
  path,
  onReload,
  accentColor = "blue",
  className,
}: StatusBadgeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      toast.success("已复制配置文件路径");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs transition-colors",
        "bg-slate-100/80 border-slate-200/90 text-slate-700",
        "dark:bg-[#121524]/80 dark:border-white/10 dark:text-gray-300",
        className,
      )}
    >
      {/* 路径与图标 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
            accentColor === "blue"
              ? "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
              : accentColor === "emerald"
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                : "bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400",
          )}
        >
          <FileCode size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className="font-mono text-xs text-slate-800 dark:text-gray-200 block truncate select-all"
            title={path}
          >
            {path || "未检测到安装或配置文件"}
          </span>
        </div>
      </div>

      {/* 状态徽章与操作按钮 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* 状态指示 */}
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border",
            exists
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400"
              : path
                ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400"
                : "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400",
          )}
        >
          {exists ? (
            <>
              <CheckCircle2 size={12} className="text-emerald-500" />
              <span>已检测到配置</span>
            </>
          ) : path ? (
            <>
              <AlertCircle size={12} className="text-amber-500" />
              <span>待初始化</span>
            </>
          ) : (
            <>
              <AlertCircle size={12} className="text-rose-500" />
              <span>未检测到环境</span>
            </>
          )}
        </div>

        {/* 复制路径按钮 */}
        {path && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
            title="复制完整路径"
          >
            {copied ? (
              <Check size={13} className="text-emerald-500" />
            ) : (
              <Copy size={13} />
            )}
          </button>
        )}

        {/* 重新读取配置按钮 */}
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
            title="重新检测配置文件"
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export default StatusBadge;

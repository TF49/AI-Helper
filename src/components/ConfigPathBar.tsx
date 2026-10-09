import { useState } from "react";
import { FileCode, FolderOpen, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { openConfigFile } from "../lib/api";

export interface ConfigPathBarProps {
  path?: string;
  shortPath: string;
  exists: boolean;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  className?: string;
}

export function ConfigPathBar({
  path,
  shortPath,
  exists,
  accentColor = "blue",
  className,
}: ConfigPathBarProps) {
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);

  const handleCopy = async () => {
    const textToCopy = path || shortPath;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success("已复制配置文件路径");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleOpen = async () => {
    if (!exists) {
      toast.warning("配置文件尚未创建，请先点击保存配置以生成文件");
      return;
    }
    const target = path || shortPath;
    if (!target) return;
    setOpening(true);
    try {
      const ok = await openConfigFile(target);
      if (ok) {
        toast.success("已打开配置文件");
      }
    } finally {
      setOpening(false);
    }
  };

  const accentBtnStyle = {
    blue: "text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-500/10",
    purple: "text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-500/10",
    emerald: "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-500/10",
    orange: "text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:text-orange-300 dark:hover:bg-orange-500/10",
  }[accentColor];

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs shadow-2xs transition-colors",
        "bg-white border-slate-200 text-slate-700",
        "dark:bg-white/5 dark:border-white/10 dark:text-gray-300",
        className
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          exists ? "bg-emerald-500" : "bg-amber-400"
        )}
        title={exists ? "配置文件已就绪" : "配置文件尚未创建"}
      />
      <FileCode size={13} className="text-slate-400 dark:text-gray-400 shrink-0" />
      <span
        className="font-mono text-xs text-slate-600 dark:text-gray-300 truncate max-w-[170px] sm:max-w-[240px] select-all"
        title={path || shortPath}
      >
        {shortPath}
      </span>

      <button
        type="button"
        onClick={handleCopy}
        className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
        title="复制配置文件路径"
      >
        {copied ? (
          <Check size={12} className="text-emerald-500" />
        ) : (
          <Copy size={12} />
        )}
      </button>

      <span className="w-px h-3 bg-slate-200 dark:bg-white/10 mx-0.5 shrink-0" />

      <button
        type="button"
        onClick={handleOpen}
        disabled={opening}
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer shrink-0",
          accentBtnStyle,
          opening && "opacity-50 cursor-wait"
        )}
        title={exists ? "在默认文本编辑器中打开" : "配置文件尚未创建，请先保存配置"}
      >
        <FolderOpen size={12} />
        <span>打开</span>
      </button>
    </div>
  );
}

export default ConfigPathBar;

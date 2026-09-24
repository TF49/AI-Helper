import { Server, Check, Zap } from "lucide-react";
import { PRESET_URLS } from "../types";
import { cn } from "../lib/utils";

interface NodeCardSelectorProps {
  value: string;
  customUrl?: string;
  onChange: (url: string) => void;
  accentColor?: "blue" | "purple";
  className?: string;
}

const NODE_META: Record<
  string,
  { name: string; tag: string; description: string; latency?: string }
> = {
  "https://bob-api.com/": {
    name: "BobAPI 官方节点",
    tag: "推荐首选",
    description: "官方主力线路，稳定低延迟，全模型高可用",
  },
  "https://taijiai.online/": {
    name: "TaijiAI 加速节点",
    tag: "备用专线",
    description: "国内高速直连专线，备用容灾与快速响应",
  },
};

export function NodeCardSelector({
  value,
  onChange,
  accentColor = "blue",
  className,
}: NodeCardSelectorProps) {
  const isBlue = accentColor === "blue";

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", className)}>
      {PRESET_URLS.map((url) => {
        const selected = value === url;
        const meta = NODE_META[url] || {
          name: "API 节点",
          tag: "专线",
          description: url,
        };

        return (
          <button
            key={url}
            type="button"
            onClick={() => onChange(url)}
            className={cn(
              "group relative w-full h-full flex flex-col justify-between p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer",
              selected
                ? isBlue
                  ? "border-blue-500 bg-blue-50/90 dark:bg-blue-500/10 dark:border-blue-500/80 shadow-xs dark:shadow-[0_0_20px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/30"
                  : "border-purple-500 bg-purple-50/90 dark:bg-purple-500/10 dark:border-purple-500/80 shadow-xs dark:shadow-[0_0_20px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/30"
                : "border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-[#141724]/60 hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50/80 dark:hover:bg-[#191c2b]/80",
            )}
          >
            {/* 顶栏：图标、名称、标签与选中勾选 */}
            <div className="flex items-start justify-between w-full gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                    selected
                      ? isBlue
                        ? "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                        : "bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300"
                      : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 group-hover:text-slate-700 dark:group-hover:text-gray-300",
                  )}
                >
                  <Server size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        "text-xs font-semibold transition-colors truncate",
                        selected
                          ? "text-slate-900 dark:text-white"
                          : "text-slate-700 dark:text-gray-300 group-hover:text-slate-900 dark:group-hover:text-white",
                      )}
                    >
                      {meta.name}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.2 rounded font-mono font-medium",
                        selected
                          ? isBlue
                            ? "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30"
                            : "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30"
                          : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-white/10",
                      )}
                    >
                      {meta.tag}
                    </span>
                  </div>
                </div>
              </div>

              {/* 选中指示圆圈 */}
              <div
                className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center border transition-all flex-shrink-0 mt-0.5",
                  selected
                    ? isBlue
                      ? "border-blue-600 dark:border-blue-500 bg-blue-600 dark:bg-blue-500 text-white"
                      : "border-purple-600 dark:border-purple-500 bg-purple-600 dark:border-purple-500 text-white"
                    : "border-slate-300 dark:border-white/20 bg-transparent group-hover:border-slate-400 dark:group-hover:border-white/40",
                )}
              >
                {selected && <Check size={10} strokeWidth={3} />}
              </div>
            </div>

            {/* 描述与 URL */}
            <div className="mt-2 text-left w-full">
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed line-clamp-1">
                {meta.description}
              </p>
              <div className="flex items-center gap-1 mt-1 text-[11px] font-mono text-slate-400 dark:text-gray-500">
                <Zap size={11} className={selected ? (isBlue ? "text-blue-500" : "text-purple-500") : "opacity-60"} />
                <span className="truncate">{url}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default NodeCardSelector;

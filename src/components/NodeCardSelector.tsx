import { Server, Check } from "lucide-react";
import { PRESET_URLS } from "../types";
import { cn } from "../lib/utils";

interface NodeCardSelectorProps {
  value: string;
  customUrl?: string;
  onChange: (url: string) => void;
  accentColor?: "blue" | "purple";
}

const NODE_META: Record<
  string,
  { name: string; tag: string; description: string }
> = {
  "https://bob-api.com/": {
    name: "BobAPI 官方节点",
    tag: "推荐",
    description: "官方主力线路，稳定低延迟",
  },
  "https://taijiai.online/": {
    name: "TaijiAI 加速节点",
    tag: "备用专线",
    description: "国内高速直连，全协议兼容",
  },
};

export function NodeCardSelector({
  value,
  onChange,
  accentColor = "blue",
}: NodeCardSelectorProps) {
  const isBlue = accentColor === "blue";

  return (
    <div className="space-y-2.5">
      {/* 预设节点卡片列表 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                "group relative w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all duration-200",
                selected
                  ? isBlue
                    ? "border-blue-500 bg-blue-50/80 dark:bg-blue-500/10 dark:border-blue-500/80 shadow-sm dark:shadow-[0_0_20px_rgba(10,132,255,0.15)]"
                    : "border-purple-500 bg-purple-50/80 dark:bg-purple-500/10 dark:border-purple-500/80 shadow-sm dark:shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                  : "border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-[#141724]/60 hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-[#191c2b]/80",
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* 节点图标 */}
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                    selected
                      ? isBlue
                        ? "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                        : "bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300"
                      : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 group-hover:text-slate-700 dark:group-hover:text-gray-300",
                  )}
                >
                  <Server size={18} />
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium transition-colors",
                        selected
                          ? "text-slate-900 dark:text-white font-semibold"
                          : "text-slate-700 dark:text-gray-300 group-hover:text-slate-900 dark:group-hover:text-white",
                      )}
                    >
                      {meta.name}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-mono font-medium",
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
                  <span className="text-xs font-mono text-slate-500 dark:text-gray-400 block truncate mt-0.5">
                    {url}
                  </span>
                </div>
              </div>

              {/* 选中指示圆点 */}
              <div
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center border transition-all flex-shrink-0 ml-3",
                  selected
                    ? isBlue
                      ? "border-blue-600 dark:border-blue-500 bg-blue-600 dark:bg-blue-500 text-white"
                      : "border-purple-600 dark:border-purple-500 bg-purple-600 dark:border-purple-500 text-white"
                    : "border-slate-300 dark:border-white/20 bg-transparent group-hover:border-slate-400 dark:group-hover:border-white/40",
                )}
              >
                {selected && <Check size={12} strokeWidth={3} />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default NodeCardSelector;

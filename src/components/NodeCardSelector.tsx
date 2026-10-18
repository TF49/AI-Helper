import { Server, Check, Zap } from "lucide-react";
import { PRESET_URLS } from "../types";
import { cn } from "../lib/utils";

interface NodeCardSelectorProps {
  value: string;
  customUrl?: string;
  onChange: (url: string) => void;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
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
  customUrl,
  onChange,
  className,
}: NodeCardSelectorProps) {
  const activeCustomUrl =
    customUrl ||
    (!(PRESET_URLS as readonly string[]).includes(value) && value
      ? value
      : undefined);
  const showCustomOption = Boolean(
    activeCustomUrl &&
      !(PRESET_URLS as readonly string[]).includes(activeCustomUrl),
  );

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
              "group relative w-full flex flex-col p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer",
              selected
                ? "border-black bg-neutral-50 dark:border-white dark:bg-neutral-900 shadow-xs ring-1 ring-black/20 dark:ring-white/30"
                : "border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-[#0a0a0a] hover:border-neutral-400 dark:hover:border-neutral-700 hover:bg-neutral-50/80 dark:hover:bg-neutral-900/50",
            )}
          >
            {/* 顶栏：图标、名称、标签与选中勾选 */}
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                    selected
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white",
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
                          ? "text-black dark:text-white"
                          : "text-neutral-700 dark:text-neutral-300 group-hover:text-black dark:group-hover:text-white",
                      )}
                    >
                      {meta.name}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-mono font-medium",
                        selected
                          ? "bg-black/10 text-black border border-black/20 dark:bg-white/10 dark:text-white dark:border-white/20"
                          : "bg-neutral-100 text-neutral-500 border border-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:border-neutral-800",
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
                  "w-4 h-4 rounded-full flex items-center justify-center border transition-all flex-shrink-0",
                  selected
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-neutral-300 dark:border-neutral-700 bg-transparent group-hover:border-neutral-400 dark:group-hover:border-neutral-500",
                )}
              >
                {selected && <Check size={10} strokeWidth={3} />}
              </div>
            </div>

            {/* 描述与 URL */}
            <div className="mt-2.5 text-left w-full">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed line-clamp-1">
                {meta.description}
              </p>
              <div className="flex items-center gap-1 mt-1 text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
                <Zap
                  size={11}
                  className={
                    selected
                      ? "text-black dark:text-white"
                      : "opacity-60"
                  }
                />
                <span className="truncate">{url}</span>
              </div>
            </div>
          </button>
        );
      })}

      {showCustomOption && activeCustomUrl && (
        <button
          key={activeCustomUrl}
          type="button"
          onClick={() => onChange(activeCustomUrl)}
          className={cn(
            "group relative w-full flex flex-col p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer sm:col-span-2",
            value === activeCustomUrl
              ? "border-black bg-neutral-50 dark:border-white dark:bg-neutral-900 shadow-xs ring-1 ring-black/20 dark:ring-white/30"
              : "border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-[#0a0a0a] hover:border-neutral-400 dark:hover:border-neutral-700 hover:bg-neutral-50/80 dark:hover:bg-neutral-900/50",
          )}
        >
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                  value === activeCustomUrl
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white",
                )}
              >
                <Server size={16} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={cn(
                      "text-xs font-semibold transition-colors truncate",
                      value === activeCustomUrl
                        ? "text-black dark:text-white"
                        : "text-neutral-700 dark:text-neutral-300 group-hover:text-black dark:group-hover:text-white",
                    )}
                  >
                    自定义服务网关
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-mono font-medium",
                      value === activeCustomUrl
                        ? "bg-black/10 text-black border border-black/20 dark:bg-white/10 dark:text-white dark:border-white/20"
                        : "bg-neutral-100 text-neutral-500 border border-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:border-neutral-800",
                    )}
                  >
                    当前自定义
                  </span>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "w-4 h-4 rounded-full flex items-center justify-center border transition-all flex-shrink-0",
                value === activeCustomUrl
                  ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-neutral-300 dark:border-neutral-700 bg-transparent group-hover:border-neutral-400 dark:group-hover:border-neutral-500",
              )}
            >
              {value === activeCustomUrl && <Check size={10} strokeWidth={3} />}
            </div>
          </div>

          <div className="mt-2.5 text-left w-full">
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed line-clamp-1">
              本地配置文件中保存的自定义 API 网关地址
            </p>
            <div className="flex items-center gap-1 mt-1 text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
              <Zap
                size={11}
                className={
                  value === activeCustomUrl
                    ? "text-black dark:text-white"
                    : "opacity-60"
                }
              />
              <span className="truncate">{activeCustomUrl}</span>
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

export default NodeCardSelector;

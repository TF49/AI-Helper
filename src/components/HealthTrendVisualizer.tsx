import { useState, useRef, useMemo } from "react";
import {
  Activity,
  Clock,
  BarChart2,
  TrendingUp,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { ChannelTrendPoint } from "../types";

export type TrendChartMode = "ribbon" | "area" | "bar";

export interface HealthTrendVisualizerProps {
  trendPoints?: ChannelTrendPoint[];
  groupName: string;
  successRate: number;
  avgLatency: number;
  totalRequests?: number;
  failedRequests?: number;
  hours?: number;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  compact?: boolean;
  className?: string;
  defaultChartType?: TrendChartMode;
}

export function HealthTrendVisualizer({
  trendPoints = [],
  groupName,
  successRate,
  avgLatency,
  totalRequests,
  failedRequests,
  hours = 1,
  accentColor = "blue",
  compact = false,
  className,
  defaultChartType,
}: HealthTrendVisualizerProps) {
  const accentHex =
    accentColor === "purple"
      ? "#a855f7"
      : accentColor === "emerald"
        ? "#10b981"
        : accentColor === "orange"
          ? "#f97316"
          : "#3b82f6";

  // 模式偏好：分段健康条 (ribbon, 默认官方风) | 平滑波形曲线 (area) | 宽幅遥测柱 (bar)
  const [chartMode, setChartMode] = useState<TrendChartMode>(() => {
    if (defaultChartType) return defaultChartType;
    try {
      const saved = localStorage.getItem("ai_helper_trend_chart_mode");
      if (saved === "ribbon" || saved === "area" || saved === "bar") {
        return saved as TrendChartMode;
      }
    } catch {}
    return "ribbon"; // 默认首选连续分段健康条 (GitHub Status / Cloudflare 风格，饱满连续无空隙)
  });

  const handleSwitchMode = (mode: TrendChartMode) => {
    setChartMode(mode);
    try {
      localStorage.setItem("ai_helper_trend_chart_mode", mode);
    } catch {}
  };

  const [activeTooltip, setActiveTooltip] = useState<{
    point: ChannelTrendPoint;
    index: number;
    xPercent: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // 格式化时间戳 (时:分)
  const formatTime = (ts: number) => {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // 格式化时间区间 (5分钟桶)
  const formatTimeRange = (ts: number) => {
    if (!ts) return "";
    const start = formatTime(ts);
    const end = formatTime(ts + 5 * 60);
    return `${start} ~ ${end}`;
  };

  // 格式化耗时
  const formatLatency = (ms: number) => {
    if (ms <= 0) return "0ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // 生成专属于当前实例的安全英数 SVG ID (彻底根除由于中文/空格导致的纯黑渲染 Bug)
  const safeId = useMemo(() => {
    const clean = groupName.replace(/[^a-zA-Z0-9]/g, "");
    const rand = Math.random().toString(36).substring(2, 8);
    return `trend_${clean || "grp"}_${rand}`;
  }, [groupName]);

  const gradientId = `grad_${safeId}`;
  const glowId = `glow_${safeId}`;

  // 统计总失败数
  const totalFailedInTrend = useMemo(() => {
    return trendPoints.reduce((acc, p) => acc + (p.failed_requests || 0), 0);
  }, [trendPoints]);

  // 生成 SVG 平滑贝塞尔曲线路径 (超轻通透渐变波形)
  const curvePaths = useMemo(() => {
    if (!trendPoints || trendPoints.length === 0) return null;

    const width = 640;
    const height = compact ? 62 : 74;
    const padX = 14;
    const padTop = 10;
    const padBottom = 16;
    const plotW = width - padX * 2;
    const plotH = height - padTop - padBottom;
    const n = trendPoints.length;

    const coords = trendPoints.map((pt, i) => {
      const x = n === 1 ? width / 2 : padX + (i / (n - 1)) * plotW;
      const rate = pt.has_data || pt.total_requests > 0 ? pt.success_rate : 0;
      // 成功率映射到 y 轴 (100% 在 padTop, 0% 在 padTop + plotH)
      const y = padTop + plotH - (Math.max(0, Math.min(100, rate)) / 100) * plotH;
      return { x, y, pt, i };
    });

    if (coords.length === 1) {
      const p = coords[0];
      return {
        lineD: `M ${p.x - 30} ${p.y} L ${p.x + 30} ${p.y}`,
        areaD: `M ${p.x - 30} ${p.y} L ${p.x + 30} ${p.y} L ${p.x + 30} ${height - padBottom} L ${p.x - 30} ${height - padBottom} Z`,
        coords,
        width,
        height,
        baselineY: height - padBottom,
        padTop,
      };
    }

    // 绘制光滑三次方贝塞尔曲线 (Catmull-Rom 贝塞尔平滑)
    let lineD = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[Math.max(0, i - 1)];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[Math.min(coords.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      lineD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    const baselineY = height - padBottom;
    const areaD = `${lineD} L ${coords[coords.length - 1].x.toFixed(1)} ${baselineY} L ${coords[0].x.toFixed(1)} ${baselineY} Z`;

    return { lineD, areaD, coords, width, height, baselineY, padTop };
  }, [trendPoints, compact]);

  if (!trendPoints || trendPoints.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-slate-400">
        该分组暂无周期走势采样数据
      </div>
    );
  }

  const firstPt = trendPoints[0];
  const lastPt = trendPoints[trendPoints.length - 1];

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative rounded-xl border border-slate-200/70 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 p-3 space-y-2.5 transition-all select-none",
        className,
      )}
    >
      {/* 走势图顶部信息与三模态切换药丸 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-gray-200">
            <Activity size={13} className="text-emerald-500 animate-pulse" />
            <span>近 {hours} 小时健康走势</span>
          </div>

          <span className="text-[10px] font-mono text-slate-400 dark:text-gray-500 bg-white/70 dark:bg-white/5 px-1.5 py-0.2 rounded border border-slate-200/50 dark:border-white/5">
            {trendPoints.length} 采样周期 · 5m/桶
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 时间跨度 */}
          <span className="text-[10px] font-mono text-slate-400 dark:text-gray-500 hidden sm:inline-block">
            {formatTime(firstPt.timestamp)} → {formatTime(lastPt.timestamp)}
          </span>

          {/* 模式切换器：分段条 (默认) | 丝滑曲线 | 遥测柱 */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-200/60 dark:bg-white/10 border border-slate-200/80 dark:border-white/10 text-[10px]">
            <button
              type="button"
              onClick={() => handleSwitchMode("ribbon")}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                chartMode === "ribbon"
                  ? "bg-white dark:bg-white/20 text-slate-900 dark:text-white shadow-2xs font-semibold"
                  : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
              )}
              title="连续分段健康条 (GitHub / Statuspage 官方标准风格，饱满连续)"
            >
              <Layers size={10} />
              <span>分段条</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode("area")}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                chartMode === "area"
                  ? "bg-white dark:bg-white/20 text-slate-900 dark:text-white shadow-2xs font-semibold"
                  : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
              )}
              title="平滑渐变波形曲线 (通透空灵)"
            >
              <TrendingUp size={10} />
              <span>平滑曲线</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode("bar")}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                chartMode === "bar"
                  ? "bg-white dark:bg-white/20 text-slate-900 dark:text-white shadow-2xs font-semibold"
                  : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
              )}
              title="宽幅遥测立柱 (Grafana 饱满自适应槽道柱)"
            >
              <BarChart2 size={10} />
              <span>遥测柱</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── 图表主呈现区 ── */}
      <div className="relative">
        {chartMode === "ribbon" ? (
          /* ── 模式 1：连续分段健康条 (GitHub Status / Cloudflare 官方经典风，彻底解决空隙与稀疏问题) ── */
          <div className="py-1">
            <div className={cn("flex items-stretch gap-[3px] w-full", compact ? "h-7" : "h-9")}>
              {trendPoints.map((pt, idx) => {
                const hasData = pt.has_data ?? pt.total_requests > 0;
                const rate = pt.success_rate;
                const isHovered = activeTooltip?.index === idx;

                let segmentColor = "bg-slate-200/90 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700";
                let glowShadow = "";
                if (hasData) {
                  if (rate >= 95) {
                    segmentColor = "bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-500 dark:hover:bg-emerald-400";
                    glowShadow = "shadow-[0_0_10px_rgba(16,185,129,0.45)]";
                  } else if (rate >= 80) {
                    segmentColor = "bg-teal-500 hover:bg-teal-400 dark:bg-teal-500 dark:hover:bg-teal-400";
                    glowShadow = "shadow-[0_0_10px_rgba(20,184,166,0.45)]";
                  } else if (rate >= 50) {
                    segmentColor = "bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400";
                    glowShadow = "shadow-[0_0_10px_rgba(245,158,11,0.45)]";
                  } else {
                    segmentColor = "bg-rose-500 hover:bg-rose-400 dark:bg-rose-500 dark:hover:bg-rose-400";
                    glowShadow = "shadow-[0_0_10px_rgba(239,68,68,0.45)]";
                  }
                }

                const isFirst = idx === 0;
                const isLast = idx === trendPoints.length - 1;

                return (
                  <div
                    key={pt.timestamp || idx}
                    className={cn(
                      "relative flex-1 cursor-pointer transition-all duration-150 select-none overflow-hidden group",
                      isFirst && "rounded-l-md",
                      isLast && "rounded-r-md",
                      !isFirst && !isLast && "rounded-[2px]",
                      segmentColor,
                      isHovered && `scale-y-115 -translate-y-0.5 z-20 ${glowShadow} brightness-110`,
                    )}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      const elemRect = e.currentTarget.getBoundingClientRect();
                      const xPct = rect
                        ? ((elemRect.left + elemRect.width / 2 - rect.left) / rect.width) * 100
                        : (idx / (trendPoints.length - 1 || 1)) * 100;
                      setActiveTooltip({ point: pt, index: idx, xPercent: xPct });
                    }}
                    onMouseLeave={() => setActiveTooltip(null)}
                  >
                    {/* 顶部微高光细线，营造精致玻璃切片质感 */}
                    <div className="absolute inset-x-0 top-0 h-[1.5px] bg-white/25 pointer-events-none" />

                    {/* 如果该时段有失败，底部微红色警示条 */}
                    {hasData && pt.failed_requests > 0 && rate >= 80 && (
                      <div className="absolute inset-x-0 bottom-0 h-[2.5px] bg-rose-400/90 pointer-events-none" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : chartMode === "bar" ? (
          /* ── 模式 2：宽幅遥测立柱 (Grafana / Cloudflare Analytics 自适应饱满柱状图) ── */
          <div className="py-1">
            <div className={cn("flex items-end gap-1.5 w-full px-0.5", compact ? "h-11" : "h-14")}>
              {trendPoints.map((pt, idx) => {
                const hasData = pt.has_data ?? pt.total_requests > 0;
                const rate = pt.success_rate;
                const isHovered = activeTooltip?.index === idx;

                // 槽道填充高度 (根据成功率计算，最低保持 20% 以便美感与触控)
                const heightPct = hasData
                  ? Math.max(22, Math.round((rate / 100) * 100))
                  : 12;

                let barGradient = "from-slate-300 to-slate-200 dark:from-white/10 dark:to-white/5";
                if (hasData) {
                  if (rate >= 90) barGradient = "from-emerald-600 to-emerald-400";
                  else if (rate >= 70) barGradient = "from-teal-600 to-teal-400";
                  else if (rate >= 50) barGradient = "from-amber-600 to-amber-400";
                  else barGradient = "from-rose-600 to-rose-400";
                }

                return (
                  <div
                    key={pt.timestamp || idx}
                    className="relative flex-1 h-full flex flex-col justify-end cursor-pointer group"
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      const elemRect = e.currentTarget.getBoundingClientRect();
                      const xPct = rect
                        ? ((elemRect.left + elemRect.width / 2 - rect.left) / rect.width) * 100
                        : (idx / (trendPoints.length - 1 || 1)) * 100;
                      setActiveTooltip({ point: pt, index: idx, xPercent: xPct });
                    }}
                    onMouseLeave={() => setActiveTooltip(null)}
                  >
                    {/* 槽道背景 (Groove Track) */}
                    <div className="w-full h-full rounded-md bg-slate-100/90 dark:bg-white/[0.04] p-0.5 flex flex-col justify-end items-stretch overflow-hidden border border-slate-200/50 dark:border-white/5 group-hover:border-slate-300 dark:group-hover:border-white/15 transition-all">
                      {/* 柱体内填充 */}
                      <div
                        className={cn(
                          "w-full rounded-[3px] bg-gradient-to-t transition-all duration-300 relative",
                          barGradient,
                          isHovered && "brightness-115 shadow-sm scale-y-[1.02]",
                        )}
                        style={{ height: `${heightPct}%` }}
                      >
                        {/* 顶部微高光 */}
                        <div className="absolute inset-x-0 top-0 h-[1.5px] bg-white/40 rounded-t-[3px]" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── 模式 3：通透丝滑折线 (Silk Sparkline，彻底杜绝黑底，超轻通透) ── */
          <div className="relative py-1">
            {curvePaths && (
              <div className="relative w-full overflow-hidden">
                <svg
                  viewBox={`0 0 ${curvePaths.width} ${curvePaths.height}`}
                  className={cn("w-full overflow-visible", compact ? "h-14" : "h-16")}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accentHex} stopOpacity="0.25" />
                      <stop offset="60%" stopColor={accentHex} stopOpacity="0.05" />
                      <stop offset="100%" stopColor={accentHex} stopOpacity="0.0" />
                    </linearGradient>
                    <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor={accentHex} floodOpacity="0.35" />
                    </filter>
                  </defs>

                  {/* 参考虚线 (顶部基准线与底部基准线) */}
                  <line
                    x1="14"
                    y1={curvePaths.padTop}
                    x2={curvePaths.width - 14}
                    y2={curvePaths.padTop}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-white/5"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                  />
                  <line
                    x1="14"
                    y1={curvePaths.baselineY}
                    x2={curvePaths.width - 14}
                    y2={curvePaths.baselineY}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-white/5"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                  />

                  {/* 丝滑轻盈面积填充 (安全透明渐变，绝不出现纯黑) */}
                  <path d={curvePaths.areaD} fill={`url(#${gradientId})`} />

                  {/* 丝滑主折线 */}
                  <path
                    d={curvePaths.lineD}
                    fill="none"
                    stroke={accentHex}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={`url(#${glowId})`}
                  />

                  {/* 数据点与悬停触控区 */}
                  {curvePaths.coords.map(({ x, y, pt, i }) => {
                    const isHovered = activeTooltip?.index === i;
                    const hasData = pt.has_data ?? pt.total_requests > 0;
                    return (
                      <g
                        key={pt.timestamp || i}
                        className="cursor-pointer"
                        onMouseEnter={(e) => {
                          const rect = containerRef.current?.getBoundingClientRect();
                          const elemRect = e.currentTarget.getBoundingClientRect();
                          const xPct = rect
                            ? ((elemRect.left + elemRect.width / 2 - rect.left) / rect.width) * 100
                            : (i / (trendPoints.length - 1 || 1)) * 100;
                          setActiveTooltip({ point: pt, index: i, xPercent: xPct });
                        }}
                        onMouseLeave={() => setActiveTooltip(null)}
                      >
                        <circle cx={x} cy={y} r="8" fill="transparent" />
                        <circle
                          cx={x}
                          cy={y}
                          r={isHovered ? 4 : hasData ? 2.5 : 1.5}
                          className={cn(
                            "transition-all duration-150",
                            isHovered
                              ? "fill-white stroke-emerald-500 stroke-2"
                              : hasData
                                ? "fill-emerald-500"
                                : "fill-slate-300 dark:fill-white/20",
                          )}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        )}

        {/* ── 动态跟随悬停 Tooltip (精致玻璃拟态卡片) ── */}
        {activeTooltip && (
          <div
            className="absolute -top-2 pointer-events-none z-30 px-3 py-2 rounded-xl bg-slate-900/95 dark:bg-zinc-900/95 text-white text-[11px] shadow-2xl border border-white/10 whitespace-nowrap transition-all duration-75 flex flex-col gap-1 backdrop-blur-md"
            style={{
              left: `${Math.max(12, Math.min(88, activeTooltip.xPercent))}%`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="flex items-center justify-between gap-3 pb-1 border-b border-white/10">
              <div className="flex items-center gap-1.5 font-sans font-medium text-slate-200">
                <Clock size={11} className="text-slate-400" />
                <span className="font-mono text-[10px]">{formatTimeRange(activeTooltip.point.timestamp)}</span>
              </div>
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded text-[10px] font-bold font-mono",
                  activeTooltip.point.has_data || activeTooltip.point.total_requests > 0
                    ? activeTooltip.point.success_rate >= 90
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : activeTooltip.point.success_rate >= 70
                        ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-white/10 text-slate-300 border border-white/10",
                )}
              >
                {activeTooltip.point.has_data || activeTooltip.point.total_requests > 0
                  ? `${activeTooltip.point.success_rate.toFixed(1)}%`
                  : "无调用"}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[10px] text-slate-300 pt-0.5 font-mono">
              <span>调用: <strong className="text-white">{activeTooltip.point.total_requests} 次</strong></span>
              {activeTooltip.point.failed_requests > 0 ? (
                <span className="text-rose-400">失败: <strong>{activeTooltip.point.failed_requests} 次</strong></span>
              ) : (
                <span className="text-emerald-400">0 失败</span>
              )}
              {activeTooltip.point.avg_response_time > 0 && (
                <span className="text-slate-300">耗时: <strong className="text-white">{formatLatency(activeTooltip.point.avg_response_time)}</strong></span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部时间刻度与健康度结论标尺 */}
      <div className="flex items-center justify-between pt-1 px-1 text-[10px] font-mono text-slate-400 dark:text-gray-500">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-white/20" />
          <span>{hours} 小时前 ({formatTime(firstPt.timestamp)})</span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] font-medium font-sans">
          {totalFailedInTrend > 0 ? (
            <>
              <AlertTriangle size={11} className="text-amber-500" />
              <span className="text-amber-600 dark:text-amber-400">
                周期内含 {totalFailedInTrend} 次失败调用
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={11} className="text-emerald-500" />
              <span className="text-slate-600 dark:text-gray-300">
                全周期运行平稳 ({trendPoints.length} 个周期)
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span>刚刚 ({formatTime(lastPt.timestamp)})</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        </div>
      </div>

      {/* 非 compact 模式下的扩展指标信息 */}
      {!compact && totalRequests !== undefined && (
        <div className="pt-1.5 border-t border-slate-200/60 dark:border-white/5 flex items-center justify-between text-[10px] text-slate-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>实时健康率:</span>
              <strong className="text-slate-800 dark:text-gray-200 font-mono font-semibold">
                {successRate.toFixed(1)}%
              </strong>
            </span>

            <span className="flex items-center gap-1">
              <Clock size={10} className="text-slate-400" />
              <span>均延迟:</span>
              <strong className="text-slate-800 dark:text-gray-200 font-mono font-semibold">
                {formatLatency(avgLatency)}
              </strong>
            </span>
          </div>

          <div className="font-mono text-[10px] text-slate-400">
            总请求: {totalRequests} 次 {failedRequests ? `(失败 ${failedRequests})` : "(0 异常)"}
          </div>
        </div>
      )}
    </div>
  );
}

export default HealthTrendVisualizer;

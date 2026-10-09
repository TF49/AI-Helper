import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Clock,
  Zap,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Layers,
  Search,
  Info,
  ShieldCheck,
  Check,
  Sparkles,
  KeyRound,
  RotateCcw,
  Maximize2,
  LayoutList,
  LayoutGrid,
  ArrowUpDown,
  X,
  Eye,
} from "lucide-react";
import gsap from "gsap";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/useAuth";
import { getChannelGroupOverview, openUrl } from "../lib/api";
import type { ChannelGroupOverview } from "../types";
import { HealthTrendVisualizer } from "./HealthTrendVisualizer";

export interface ChannelGroupMonitorProps {
  currentGroupName?: string | null;
  toolName?: string;
  toolId?: string;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  onSelectGroup?: (groupName: string) => void;
  onOpenTokenSelect?: () => void;
  className?: string;
}

export interface ToolExclusiveGuide {
  title: string;
  tag: string;
  desc: string;
  technicalNote: string;
  recommendedKeywords: string[];
}

export const TOOL_EXCLUSIVE_GUIDES: Record<string, ToolExclusiveGuide> = {
  chatgpt: {
    title: "ChatGPT (Codex) 专属分组与密钥规则",
    tag: "Codex 流式专用",
    desc: "Codex 命令行终端深度依赖高并发流式代码补全与特定上游模型（如 gpt-5-codex、gpt-4o、o3-mini）。必须关联拥有 Codex 专项通道权限的分组。",
    technicalNote: "若关联普通低频或非代码分组，可能因上游并发限频或缺少 Codex 路由权限导致补全超时。配置将写入系统环境变量 CUSTOM_OPENAI_API_KEY 直连网关。",
    recommendedKeywords: ["codex", "svip-codex", "openai", "gpt"],
  },
  claude: {
    title: "Claude Code 专属分组与密钥规则",
    tag: "Anthropic 深度推理",
    desc: "Claude Code CLI 深度依赖 Anthropic 原生流式协议、Extended Thinking（思考链推理）与 Prompt Caching 特性。必须确保 Key 归属于 Claude 专属通道分组（如 ClaudeCode Kiro-1）。",
    technicalNote: "若绑定普通分组或纯 OpenAI 格式分组，CLI 启动初始化及代码交互时将直接报 404/400 invalid model 错误。凭据写入 ~/.claude/settings.json 的 env.ANTHROPIC_AUTH_TOKEN。",
    recommendedKeywords: ["claude", "kiro", "anthropic"],
  },
  workbuddy: {
    title: "WorkBuddy 专属分组与密钥规则",
    tag: "多模型聚合通道",
    desc: "WorkBuddy 本地注册管理多种异构模型（如 DeepSeek、Claude、GPT-4o 等）。绑定的 Key 所属分组必须完整覆盖 models.json 中所配置目标模型的路由与额度权限。",
    technicalNote: "建议关联全模型覆盖或高权限多渠道分组，确保切换不同助手模型时通道持续可用。配置将直接持久化于 ~/.workbuddy-ai/models.json。",
    recommendedKeywords: ["workbuddy", "all", "svip", "default"],
  },
  acciowork: {
    title: "Accio Work 专属分组与密钥规则",
    tag: "企业级 Bridge 桥接",
    desc: "Accio Work 专为企业级多 Agent 复杂长链路协作设计，通过本地 Bridge 桥接服务中转请求。绑定的 Key 分组直接决定了 Bridge 转发时的上游链路质量与负载能力。",
    technicalNote: "建议优先选用平均响应时延低于 1.5s 且近 3 小时成功率维持在 99%+ 的专属稳定分组，保障长时间工作流不中断。配置保存于 ~/.ai-helper/accio_config.json。",
    recommendedKeywords: ["accio", "bridge", "enterprise", "svip", "default"],
  },
};

function formatLatency(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 1) {
    const ms = Math.round(seconds * 1000);
    return ms > 0 ? `${ms}ms` : "<1s";
  }
  return `${seconds.toFixed(2)}s`;
}

export function ChannelGroupMonitor({
  currentGroupName,
  toolName = "当前工具",
  toolId,
  accentColor = "blue",
  onSelectGroup,
  onOpenTokenSelect,
  className,
}: ChannelGroupMonitorProps) {
  const { authState, setLoginModalOpen } = useAuth();

  const [hours, setHours] = useState<number>(1);
  const [groups, setGroups] = useState<ChannelGroupOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [selectedGroupOverride, setSelectedGroupOverride] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filterTab, setFilterTab] = useState<"all" | "recommended" | "high">("all");
  const [sortBy, setSortBy] = useState<"default" | "rate_desc" | "latency_asc" | "requests_desc">("default");
  const [compareModalOpen, setCompareModalOpen] = useState(false);

  const refreshIconRef = useRef<SVGSVGElement>(null);

  // 计算归一化的 tool 标识
  const effectiveToolId = useMemo(() => {
    if (toolId) return toolId.toLowerCase();
    const tname = toolName.toLowerCase();
    if (tname.includes("chatgpt") || tname.includes("codex")) return "chatgpt";
    if (tname.includes("claude")) return "claude";
    if (tname.includes("workbuddy")) return "workbuddy";
    if (tname.includes("accio")) return "acciowork";
    return "default";
  }, [toolId, toolName]);

  // 从本地存储中尝试回退读取绑定的 group（若父组件未显式传递 currentGroupName）
  const resolvedCurrentGroup = useMemo(() => {
    if (currentGroupName) return currentGroupName;
    try {
      const storageKey = `bound_token_${effectiveToolId}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.group === "string" && parsed.group.trim()) {
          return parsed.group.trim();
        }
      }
    } catch {}
    return null;
  }, [currentGroupName, effectiveToolId]);

  // 专属工具指南说明
  const guide = useMemo(() => {
    return TOOL_EXCLUSIVE_GUIDES[effectiveToolId] || null;
  }, [effectiveToolId]);

  // 主题配色系统
  const theme = useMemo(() => {
    switch (accentColor) {
      case "purple":
        return {
          bannerBg: "bg-purple-50/80 dark:bg-purple-950/25 border-purple-200/70 dark:border-purple-900/30 text-purple-900 dark:text-purple-200",
          bannerIcon: "text-purple-600 dark:text-purple-400",
          bannerTitle: "text-purple-950 dark:text-purple-100",
          bannerTag: "bg-purple-100/90 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300 border-purple-200 dark:border-purple-500/30",
          topIconBg: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
          btnPrimary: "bg-purple-600 hover:bg-purple-700 text-white shadow-purple-500/20",
          boundBadge: "bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300 border-purple-200/60 dark:border-purple-500/30",
          accentText: "text-purple-600 dark:text-purple-400",
          accentIconColor: "text-purple-500",
          focusRing: "focus:ring-purple-500",
          drawerActive: "border-purple-500/80 bg-purple-50/80 dark:bg-purple-500/15 shadow-2xs font-semibold",
          drawerCheck: "text-purple-500",
        };
      case "emerald":
        return {
          bannerBg: "bg-emerald-50/80 dark:bg-emerald-950/25 border-emerald-200/70 dark:border-emerald-900/30 text-emerald-900 dark:text-emerald-200",
          bannerIcon: "text-emerald-600 dark:text-emerald-400",
          bannerTitle: "text-emerald-950 dark:text-emerald-100",
          bannerTag: "bg-emerald-100/90 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
          topIconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
          btnPrimary: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20",
          boundBadge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-500/30",
          accentText: "text-emerald-600 dark:text-emerald-400",
          accentIconColor: "text-emerald-500",
          focusRing: "focus:ring-emerald-500",
          drawerActive: "border-emerald-500/80 bg-emerald-50/80 dark:bg-emerald-500/15 shadow-2xs font-semibold",
          drawerCheck: "text-emerald-500",
        };
      case "orange":
        return {
          bannerBg: "bg-orange-50/80 dark:bg-orange-950/25 border-orange-200/70 dark:border-orange-900/30 text-orange-900 dark:text-orange-200",
          bannerIcon: "text-orange-600 dark:text-orange-400",
          bannerTitle: "text-orange-950 dark:text-orange-100",
          bannerTag: "bg-orange-100/90 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300 border-orange-200 dark:border-orange-500/30",
          topIconBg: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
          btnPrimary: "bg-orange-600 hover:bg-orange-700 text-white shadow-orange-500/20",
          boundBadge: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 border-orange-200/60 dark:border-orange-500/30",
          accentText: "text-orange-600 dark:text-orange-400",
          accentIconColor: "text-orange-500",
          focusRing: "focus:ring-orange-500",
          drawerActive: "border-orange-500/80 bg-orange-50/80 dark:bg-orange-500/15 shadow-2xs font-semibold",
          drawerCheck: "text-orange-500",
        };
      case "blue":
      default:
        return {
          bannerBg: "bg-blue-50/80 dark:bg-blue-950/25 border-blue-200/70 dark:border-blue-900/30 text-blue-900 dark:text-blue-200",
          bannerIcon: "text-blue-600 dark:text-blue-400",
          bannerTitle: "text-blue-950 dark:text-blue-100",
          bannerTag: "bg-blue-100/90 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
          topIconBg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
          btnPrimary: "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20",
          boundBadge: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 border-blue-200/60 dark:border-blue-500/30",
          accentText: "text-blue-600 dark:text-blue-400",
          accentIconColor: "text-blue-500",
          focusRing: "focus:ring-blue-500",
          drawerActive: "border-blue-500/80 bg-blue-50/80 dark:bg-blue-500/15 shadow-2xs font-semibold",
          drawerCheck: "text-blue-500",
        };
    }
  }, [accentColor]);

  // 加载监控数据
  const loadData = useCallback(
    async (silent = false) => {
      if (!authState.is_logged_in) {
        return;
      }
      if (!silent) setLoading(true);
      setErrorMsg(null);
      try {
        const data = await getChannelGroupOverview(hours);
        setGroups(data || []);
        setLastUpdated(
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );
      } catch (err: unknown) {
        const msg =
          typeof err === "string" ? err : "加载分组监控数据失败，请确认网络或登录态";
        setErrorMsg(msg);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [authState.is_logged_in, hours],
  );

  useEffect(() => {
    if (!authState.is_logged_in) return;
    void loadData();
    const interval = setInterval(() => {
      void loadData(true);
    }, 90000);
    return () => clearInterval(interval);
  }, [loadData, authState.is_logged_in]);

  // 点击刷新按钮触发旋转
  const handleRefresh = () => {
    if (refreshIconRef.current) {
      gsap.to(refreshIconRef.current, {
        rotation: "+=360",
        duration: 0.6,
        ease: "power2.inOut",
      });
    }
    void loadData();
  };

  // 根据工具关键词优先计算推荐的默认分组
  const recommendedDefaultGroup = useMemo(() => {
    if (groups.length === 0) return null;
    if (guide?.recommendedKeywords) {
      for (const kw of guide.recommendedKeywords) {
        const found = groups.find((g) => g.group_name.toLowerCase().includes(kw));
        if (found) return found.group_name;
      }
    }
    return groups[0]?.group_name || null;
  }, [groups, guide]);

  // 计算当前聚焦的目标分组名称
  const effectiveGroupName = useMemo(() => {
    if (selectedGroupOverride) return selectedGroupOverride;
    if (resolvedCurrentGroup) return resolvedCurrentGroup;
    return recommendedDefaultGroup;
  }, [selectedGroupOverride, resolvedCurrentGroup, recommendedDefaultGroup]);

  const activeGroup = useMemo(() => {
    if (!effectiveGroupName) return null;
    return (
      groups.find(
        (g) => g.group_name.toLowerCase() === effectiveGroupName.toLowerCase(),
      ) ||
      groups.find((g) =>
        g.group_name.toLowerCase().includes(effectiveGroupName.toLowerCase()),
      ) ||
      groups[0] ||
      null
    );
  }, [effectiveGroupName, groups]);

  // 状态识别判断
  const isInspectingOverride = Boolean(
    selectedGroupOverride &&
      selectedGroupOverride.toLowerCase() !== (resolvedCurrentGroup || "").toLowerCase(),
  );

  const isCurrentKeyGroup = Boolean(
    !isInspectingOverride &&
      resolvedCurrentGroup &&
      activeGroup &&
      activeGroup.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase(),
  );

  const isUnboundRecommended = Boolean(!resolvedCurrentGroup && !selectedGroupOverride);

  // 健康度状态判定
  const getHealthStatus = (rate: number) => {
    if (rate >= 90) {
      return {
        label: "极佳",
        colorText: "text-emerald-600 dark:text-emerald-400",
        bgBadge:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
        dotColor: "bg-emerald-500",
        barColor: "#10b981",
        Icon: CheckCircle2,
      };
    }
    if (rate >= 50) {
      return {
        label: "波动",
        colorText: "text-amber-600 dark:text-amber-400",
        bgBadge:
          "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
        dotColor: "bg-amber-500",
        barColor: "#f59e0b",
        Icon: AlertTriangle,
      };
    }
    return {
      label: "告警",
      colorText: "text-rose-600 dark:text-rose-400",
      bgBadge:
        "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
      dotColor: "bg-rose-500",
      barColor: "#ef4444",
      Icon: AlertCircle,
    };
  };

  const currentHealth = activeGroup ? getHealthStatus(activeGroup.success_rate) : null;

  // 检查某个分组是否属于此工具推荐
  const isGroupRecommended = useCallback(
    (groupName: string) => {
      if (!guide?.recommendedKeywords) return false;
      const lower = groupName.toLowerCase();
      return guide.recommendedKeywords.some((kw) => lower.includes(kw));
    },
    [guide],
  );

  // 统计信息
  const recommendedCount = useMemo(() => {
    return groups.filter((g) => isGroupRecommended(g.group_name)).length;
  }, [groups, isGroupRecommended]);

  const highHealthCount = useMemo(() => {
    return groups.filter((g) => g.success_rate >= 90).length;
  }, [groups]);

  // 过滤与排序后的全部分组列表
  const filteredAndSortedGroups = useMemo(() => {
    let result = [...groups];

    // 1. 过滤搜索词
    if (groupSearch.trim()) {
      const q = groupSearch.toLowerCase().trim();
      result = result.filter((g) => g.group_name.toLowerCase().includes(q));
    }

    // 2. 选项卡过滤
    if (filterTab === "recommended") {
      result = result.filter((g) => isGroupRecommended(g.group_name));
    } else if (filterTab === "high") {
      result = result.filter((g) => g.success_rate >= 90);
    }

    // 3. 排序
    if (sortBy === "rate_desc") {
      result.sort((a, b) => b.success_rate - a.success_rate);
    } else if (sortBy === "latency_asc") {
      result.sort((a, b) => (a.avg_response_time || 999) - (b.avg_response_time || 999));
    } else if (sortBy === "requests_desc") {
      result.sort((a, b) => b.total_requests - a.total_requests);
    }

    return result;
  }, [groups, groupSearch, filterTab, sortBy, isGroupRecommended]);

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-300 overflow-hidden",
        "bg-white/70 dark:bg-[#101322]/70 backdrop-blur-md",
        "border-slate-200/90 dark:border-white/10 shadow-xs",
        className,
      )}
    >
      {/* ── 顶部栏：功能标题、时间范围切换、刷新与外链 ── */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap bg-slate-50/50 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border shadow-2xs",
              theme.topIconBg,
            )}
          >
            <Activity size={14} className="animate-pulse" />
          </div>

          <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-800 dark:text-gray-100 tracking-tight">
              通道分组健康监控
            </span>
            {toolName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-white/5 truncate max-w-[140px]">
                {toolName}
              </span>
            )}
            <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded-md font-mono bg-slate-200/60 dark:bg-white/5 text-slate-500 dark:text-gray-400 border border-slate-200/40 dark:border-white/5">
              Channel Monitor
            </span>
          </div>
        </div>

        {/* 右侧控制项 */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {/* 时间粒度选择 (1h / 2h / 3h) */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 text-[10px]">
            {[1, 2, 3].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={cn(
                  "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                  hours === h
                    ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                    : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
                )}
                title={`查看过去 ${h} 小时监控数据`}
              >
                {h}h
              </button>
            ))}
          </div>

          {/* 刷新按钮 */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || !authState.is_logged_in}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-200/60 dark:hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
            title={lastUpdated ? `最后更新于 ${lastUpdated}，点击刷新` : "刷新监控数据"}
          >
            <RefreshCw
              ref={refreshIconRef}
              size={13}
              className={loading ? cn("animate-spin", theme.accentText) : ""}
            />
          </button>

          {/* 官方监控网页外链 */}
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com/channel-monitor")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white bg-slate-100/80 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 transition-all cursor-pointer shadow-2xs"
            title="前往 bob-api.com/channel-monitor 查看网页端完整大盘"
          >
            <span>网页大盘</span>
            <ExternalLink size={11} className="opacity-70" />
          </button>
        </div>
      </div>

      {/* ── 核心说明横幅：针对各工具深度定制的专属分组与密钥规则 ── */}
      <div
        className={cn(
          "px-4 py-3 border-b flex items-start gap-2.5 text-xs leading-relaxed transition-colors",
          theme.bannerBg,
        )}
      >
        <Info size={15} className={cn("flex-shrink-0 mt-0.5", theme.bannerIcon)} />
        <div className="flex-1 space-y-1 text-[11px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-bold text-xs", theme.bannerTitle)}>
              {guide ? guide.title : "通道分组与 API Key 对应规则"}
            </span>
            {guide && (
              <span
                className={cn(
                  "text-[10px] px-2 py-0.2 rounded-full font-semibold border shadow-2xs",
                  theme.bannerTag,
                )}
              >
                {guide.tag}
              </span>
            )}
          </div>

          <p className="opacity-90 leading-relaxed">
            {guide
              ? guide.desc
              : `在统一服务网关中，每个分组严格对应每一个专属 Key。不同的分组映射到不同的上游通道、模型配额与并发集群。此处为「${toolName}」呈现所属通道的健康度走势。`}
          </p>

          <p className="opacity-80 text-[10px] flex items-center gap-1 pt-0.5 font-mono">
            <Sparkles size={11} className="flex-shrink-0 opacity-70" />
            <span>
              {guide
                ? guide.technicalNote
                : "每个分组由专属 Key 承载通信，建议优先选用健康度 95% 以上的通道。"}
            </span>
          </p>
        </div>
      </div>

      {/* ── 监控核心展示区 ── */}
      <div className="p-4 space-y-3.5">
        {!authState.is_logged_in ? (
          /* 未登录状态下的引导卡片 */
          <div className="py-6 px-4 rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.015] flex flex-col items-center justify-center text-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shadow-xs",
                theme.topIconBg,
              )}
            >
              <ShieldCheck size={20} />
            </div>
            <div className="max-w-md space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                登录 Bob API 账号开启当前 Key 专属分组监控
              </p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                登录后即可自动读取当前配置 Key 所属的分组通道（如 SVIP-codex、ClaudeCode Kiro-1
                等）并实时展示可用性走势。
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs active:scale-95 transition-all cursor-pointer",
                  theme.btnPrimary,
                )}
              >
                立即登录账号
              </button>
              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/channel-monitor")}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-medium transition-all cursor-pointer flex items-center gap-1"
              >
                <span>公开监控页面</span>
                <ExternalLink size={11} />
              </button>
            </div>
          </div>
        ) : loading && groups.length === 0 ? (
          /* 加载中状态 */
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-gray-500">
            <Activity size={22} className={cn("animate-spin", theme.accentText)} />
            <span className="text-xs">正在实时同步通道分组健康度数据...</span>
          </div>
        ) : errorMsg && groups.length === 0 ? (
          /* 出错状态 */
          <div className="py-5 px-4 rounded-xl bg-rose-50/70 dark:bg-rose-500/10 border border-rose-200/80 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="flex-shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 active:scale-95 transition-all cursor-pointer"
            >
              重试
            </button>
          </div>
        ) : activeGroup ? (
          /* 活跃分组指标展示 */
          <div className="space-y-3">
            {/* 分组基本信息头部 */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-gray-400">
                  {isInspectingOverride
                    ? "正在对比预览分组:"
                    : isCurrentKeyGroup
                      ? "当前 Key 绑定分组:"
                      : "推荐监控分组:"}
                </span>

                <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-white border border-slate-200/60 dark:border-white/5 truncate max-w-[200px]">
                  {activeGroup.group_name}
                </span>

                {/* 状态指示徽标 */}
                {isCurrentKeyGroup && (
                  <span
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded font-semibold border flex items-center gap-1",
                      theme.boundBadge,
                    )}
                  >
                    <Check size={11} className="stroke-[3]" />
                    当前 Key 专属绑定
                  </span>
                )}

                {isInspectingOverride && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                      临时对比预览
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGroupOverride(null);
                        if (onSelectGroup && resolvedCurrentGroup) {
                          onSelectGroup(resolvedCurrentGroup);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-white underline cursor-pointer"
                    >
                      <RotateCcw size={10} />
                      <span>恢复查看 Key 绑定分组</span>
                    </button>
                  </div>
                )}

                {isUnboundRecommended && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-gray-400 border border-slate-200 dark:border-white/10">
                    工具推荐默认 (未绑定专属 Key)
                  </span>
                )}
              </div>

              {/* 健康度徽标 */}
              {currentHealth && (
                <div
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs",
                    currentHealth.bgBadge,
                  )}
                >
                  <currentHealth.Icon size={12} className="stroke-[2.5]" />
                  <span>健康度 {currentHealth.label}</span>
                  <span className="font-mono ml-0.5 font-bold">
                    ({activeGroup.success_rate.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>

            {/* 核心指标卡片四宫格 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* 成功率 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium">
                  实时成功率
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span
                    className={cn(
                      "text-base font-bold font-mono tracking-tight",
                      currentHealth ? currentHealth.colorText : "text-slate-800 dark:text-white",
                    )}
                  >
                    {activeGroup.success_rate.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* 平均时延 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium flex items-center gap-1">
                  <Zap size={10} className="text-amber-500" />
                  平均响应时延
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-base font-bold font-mono tracking-tight text-slate-800 dark:text-gray-100">
                    {formatLatency(activeGroup.avg_response_time)}
                  </span>
                </div>
              </div>

              {/* 请求量 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium flex items-center gap-1">
                  <BarChart3 size={10} className={theme.accentIconColor} />
                  近 {hours}h 总请求数
                </span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-base font-bold font-mono tracking-tight text-slate-800 dark:text-gray-100">
                    {activeGroup.total_requests}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">次</span>
                </div>
              </div>

              {/* 异常失败 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium flex items-center gap-1">
                  <Clock size={10} className="text-slate-400" />
                  失败请求数
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span
                    className={cn(
                      "text-base font-bold font-mono tracking-tight",
                      activeGroup.failed_requests > 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-600 dark:text-gray-300",
                    )}
                  >
                    {activeGroup.failed_requests}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">次</span>
                </div>
              </div>
            </div>

            {/* 现代化高颜值趋势走势可视化大盘 (带微光脉冲胶囊与平滑面积曲线双模式) */}
            {activeGroup.trend_points && activeGroup.trend_points.length > 0 && (
              <HealthTrendVisualizer
                trendPoints={activeGroup.trend_points}
                groupName={activeGroup.group_name}
                successRate={activeGroup.success_rate}
                avgLatency={activeGroup.avg_response_time}
                totalRequests={activeGroup.total_requests}
                failedRequests={activeGroup.failed_requests}
                hours={hours}
                accentColor={accentColor}
              />
            )}
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-slate-400">
            暂未获取到分组监控数据，请稍后刷新重试。
          </div>
        )}

        {/* ── 底部抽屉切换：查看与对比全部分组 ── */}
        {groups.length > 1 && (
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowAllGroups((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors cursor-pointer py-1"
              >
                <Layers size={13} className={theme.accentIconColor} />
                <span>
                  {showAllGroups ? "收起全部分组列表" : `对比平台全部 ${groups.length} 个通道分组健康度`}
                </span>
                {showAllGroups ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              <div className="flex items-center gap-2">
                {/* 弹窗全景大盘对比按钮 */}
                <button
                  type="button"
                  onClick={() => setCompareModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-white/10 transition-colors cursor-pointer"
                  title="在新弹窗中全屏查看所有通道详细对比与排序"
                >
                  <Maximize2 size={10} />
                  <span>弹窗大盘对比</span>
                </button>

                {onOpenTokenSelect && (
                  <button
                    type="button"
                    onClick={onOpenTokenSelect}
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-semibold transition-colors cursor-pointer",
                      theme.accentText,
                    )}
                  >
                    <KeyRound size={11} />
                    <span>选择账号 Key</span>
                  </button>
                )}

                {lastUpdated && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    更新: {lastUpdated}
                  </span>
                )}
              </div>
            </div>

            {/* 折叠展开的全部分组精细列表（优化布局：支持紧凑单行流式排版、快捷分类与弹窗大盘） */}
            {showAllGroups && (
              <div className="mt-2 space-y-2.5 pt-2.5 border-t border-slate-100/80 dark:border-white/5">
                {/* 搜索与过滤控制条 */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {/* 搜索框 */}
                  <div className="relative flex-1 min-w-[180px]">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="过滤分组名称 (如 SVIP, Claude, Codex)..."
                      className={cn(
                        "w-full h-7 pl-7 pr-7 text-xs rounded-lg bg-slate-50 dark:bg-black/30 border border-slate-200/80 dark:border-white/10 text-slate-800 dark:text-gray-200 placeholder:text-slate-400 focus:outline-none focus:ring-1",
                        theme.focusRing,
                      )}
                    />
                    {groupSearch && (
                      <button
                        type="button"
                        onClick={() => setGroupSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {/* 过滤分类标签 */}
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFilterTab("all")}
                      className={cn(
                        "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                        filterTab === "all"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                          : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
                      )}
                    >
                      全部 ({groups.length})
                    </button>
                    {recommendedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setFilterTab("recommended")}
                        className={cn(
                          "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                          filterTab === "recommended"
                            ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                            : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
                        )}
                      >
                        推荐 ({recommendedCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFilterTab("high")}
                      className={cn(
                        "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                        filterTab === "high"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                          : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
                      )}
                    >
                      极佳 ≥90% ({highHealthCount})
                    </button>
                  </div>

                  {/* 视图切换 (紧凑单行列表 vs 双列卡片网格) */}
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      className={cn(
                        "p-1 rounded-md transition-all cursor-pointer",
                        viewMode === "list"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-gray-200",
                      )}
                      title="紧凑单行流式排版 (推荐)"
                    >
                      <LayoutList size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      className={cn(
                        "p-1 rounded-md transition-all cursor-pointer",
                        viewMode === "grid"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-gray-200",
                      )}
                      title="双列卡片网格"
                    >
                      <LayoutGrid size={12} />
                    </button>
                  </div>
                </div>

                {/* 分组列表呈现区：采用紧凑舒适的布局，绝不发生文字截断或元素切半 */}
                {filteredAndSortedGroups.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    未找到匹配的通道分组
                  </div>
                ) : viewMode === "list" ? (
                  /* ── 模式 1：紧凑单行流式列表 (点击预览可直接向下就地展开详情大盘) ── */
                  <div className="space-y-1.5 pb-1">
                    {filteredAndSortedGroups.map((g) => {
                      const isCur = g.group_name === activeGroup?.group_name;
                      const isBound =
                        resolvedCurrentGroup &&
                        g.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase();
                      const isRec = isGroupRecommended(g.group_name);
                      const st = getHealthStatus(g.success_rate);
                      const isExpanded = expandedGroup === g.group_name;

                      const handleToggleExpand = (e?: React.MouseEvent) => {
                        if (e) e.stopPropagation();
                        const next = isExpanded ? null : g.group_name;
                        setExpandedGroup(next);
                        setSelectedGroupOverride(g.group_name);
                        if (onSelectGroup) onSelectGroup(g.group_name);
                      };

                      return (
                        <div key={g.group_name} className="flex flex-col">
                          {/* 单行主要卡片 */}
                          <div
                            onClick={handleToggleExpand}
                            className={cn(
                              "flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer group",
                              isExpanded
                                ? "border-blue-500/70 bg-blue-50/80 dark:bg-blue-500/15 shadow-xs"
                                : isCur
                                  ? theme.drawerActive
                                  : "border-slate-200/70 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.015] hover:border-slate-300 dark:hover:border-white/15 hover:bg-slate-100/60 dark:hover:bg-white/[0.04]",
                            )}
                          >
                            {/* 左侧：健康圆点、分组名称与状态标签 */}
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full flex-shrink-0 shadow-2xs",
                                  st.dotColor,
                                )}
                              />

                              <span
                                className="font-mono text-xs font-semibold text-slate-800 dark:text-gray-200 truncate max-w-[260px] sm:max-w-[320px]"
                                title={g.group_name}
                              >
                                {g.group_name}
                              </span>

                              {isBound && (
                                <span
                                  className={cn(
                                    "text-[10px] px-1.5 py-0.2 rounded font-semibold border flex-shrink-0",
                                    theme.boundBadge,
                                  )}
                                >
                                  当前绑定
                                </span>
                              )}

                              {isCur && !isBound && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex-shrink-0">
                                  对比预览中
                                </span>
                              )}

                              {isRec && !isBound && (
                                <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.2 rounded font-mono bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border border-blue-200/50 dark:border-blue-500/20 flex-shrink-0">
                                  推荐通道
                                </span>
                              )}
                            </div>

                            {/* 右侧：指标数值与展开按钮 */}
                            <div className="flex items-center gap-3.5 flex-shrink-0 text-slate-500 dark:text-gray-400 font-mono text-[11px]">
                              <span className="hidden md:inline-flex items-center gap-1 text-slate-400">
                                <Clock size={10} />
                                <span>{formatLatency(g.avg_response_time)}</span>
                              </span>

                              <span className="hidden sm:inline-block text-slate-400">
                                {g.total_requests} 次
                              </span>

                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex-shrink-0 shadow-2xs",
                                  st.bgBadge,
                                )}
                              >
                                {g.success_rate.toFixed(1)}% {st.label}
                              </span>

                              <button
                                type="button"
                                onClick={handleToggleExpand}
                                className={cn(
                                  "px-2 py-0.5 rounded-md text-[10px] font-medium transition-all flex items-center gap-1 cursor-pointer",
                                  isExpanded
                                    ? "bg-blue-600 text-white shadow-2xs font-semibold"
                                    : isCur
                                      ? "bg-slate-200/80 text-slate-800 dark:bg-white/15 dark:text-gray-100"
                                      : "bg-slate-100 hover:bg-slate-200/80 text-slate-600 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-400",
                                )}
                                title={isExpanded ? "收起此分组详情" : "向下展开此分组健康走势详情"}
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp size={11} />
                                    <span>收起</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye size={11} />
                                    <span>预览</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* ── 向下展开的健康状态详情抽屉卡片 ── */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                <div className="mt-1 mb-2 p-3.5 rounded-xl border border-blue-500/30 dark:border-blue-500/20 bg-white/95 dark:bg-[#111320]/95 shadow-sm space-y-3">
                                  {/* 顶部标题栏与快速切换 */}
                                  <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-100 dark:border-white/5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                                        {g.group_name}
                                      </span>
                                      <span
                                        className={cn(
                                          "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-2xs",
                                          st.bgBadge,
                                        )}
                                      >
                                        健康度: {g.success_rate.toFixed(1)}% {st.label}
                                      </span>
                                      {isBound && (
                                        <span
                                          className={cn(
                                            "text-[10px] px-1.5 py-0.2 rounded font-semibold border",
                                            theme.boundBadge,
                                          )}
                                        >
                                          当前 Key 绑定
                                        </span>
                                      )}
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => setExpandedGroup(null)}
                                      className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 flex items-center gap-1 cursor-pointer transition-colors"
                                    >
                                      <ChevronUp size={12} />
                                      <span>收起详情</span>
                                    </button>
                                  </div>

                                  {/* 四宫格核心指标 */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">实时成功率</div>
                                      <div className={cn("text-sm font-bold font-mono mt-0.5", st.colorText)}>
                                        {g.success_rate.toFixed(1)}%
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">平均耗时</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {formatLatency(g.avg_response_time)}
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">总调用次数</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {g.total_requests} 次
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">异常失败</div>
                                      <div
                                        className={cn(
                                          "text-sm font-bold font-mono mt-0.5",
                                          g.failed_requests > 0
                                            ? "text-rose-600 dark:text-rose-400"
                                            : "text-slate-600 dark:text-gray-300",
                                        )}
                                      >
                                        {g.failed_requests} 次
                                      </div>
                                    </div>
                                  </div>

                                  {/* 全新高颜值健康状态走势大盘 */}
                                  <HealthTrendVisualizer
                                    trendPoints={g.trend_points}
                                    groupName={g.group_name}
                                    successRate={g.success_rate}
                                    avgLatency={g.avg_response_time}
                                    totalRequests={g.total_requests}
                                    failedRequests={g.failed_requests}
                                    hours={hours}
                                    accentColor={accentColor}
                                    compact
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* ── 模式 2：双列卡片网格 (支持展开跨列查看详情) ── */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-1">
                    {filteredAndSortedGroups.map((g) => {
                      const isCur = g.group_name === activeGroup?.group_name;
                      const isBound =
                        resolvedCurrentGroup &&
                        g.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase();
                      const st = getHealthStatus(g.success_rate);
                      const isExpanded = expandedGroup === g.group_name;

                      const handleToggleExpand = (e?: React.MouseEvent) => {
                        if (e) e.stopPropagation();
                        const next = isExpanded ? null : g.group_name;
                        setExpandedGroup(next);
                        setSelectedGroupOverride(g.group_name);
                        if (onSelectGroup) onSelectGroup(g.group_name);
                      };

                      return (
                        <div
                          key={g.group_name}
                          className={cn(
                            "flex flex-col transition-all",
                            isExpanded && "sm:col-span-2",
                          )}
                        >
                          <div
                            onClick={handleToggleExpand}
                            className={cn(
                              "p-2.5 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-2.5",
                              isExpanded
                                ? "border-blue-500/70 bg-blue-50/80 dark:bg-blue-500/15 shadow-xs"
                                : isCur
                                  ? theme.drawerActive
                                  : "border-slate-200/70 dark:border-white/5 bg-slate-50/40 dark:bg-white/[0.015] hover:border-slate-300 dark:hover:border-white/15",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="truncate font-mono font-semibold text-slate-800 dark:text-gray-200">
                                  {g.group_name}
                                </span>
                                {isBound && (
                                  <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                    绑定
                                  </span>
                                )}
                                {isCur && <Check size={11} className={cn("stroke-[3]", theme.drawerCheck)} />}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                                <span>请求: {g.total_requests}次</span>
                                <span>·</span>
                                <span>时延: {formatLatency(g.avg_response_time)}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-mono font-bold flex-shrink-0",
                                  st.bgBadge,
                                )}
                              >
                                {g.success_rate.toFixed(0)}%
                              </span>

                              <button
                                type="button"
                                onClick={handleToggleExpand}
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-0.5 cursor-pointer",
                                  isExpanded
                                    ? "bg-blue-600 text-white shadow-2xs font-semibold"
                                    : "bg-slate-100 hover:bg-slate-200/80 text-slate-600 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-400",
                                )}
                              >
                                {isExpanded ? <ChevronUp size={10} /> : <Eye size={10} />}
                                <span>{isExpanded ? "收起" : "预览"}</span>
                              </button>
                            </div>
                          </div>

                          {/* 向下展开的健康状态抽屉详情卡片 */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                <div className="mt-1 mb-2 p-3.5 rounded-xl border border-blue-500/30 dark:border-blue-500/20 bg-white/95 dark:bg-[#111320]/95 shadow-sm space-y-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">实时成功率</div>
                                      <div className={cn("text-sm font-bold font-mono mt-0.5", st.colorText)}>
                                        {g.success_rate.toFixed(1)}%
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">平均耗时</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {formatLatency(g.avg_response_time)}
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">总调用次数</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {g.total_requests} 次
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">异常失败</div>
                                      <div
                                        className={cn(
                                          "text-sm font-bold font-mono mt-0.5",
                                          g.failed_requests > 0
                                            ? "text-rose-600 dark:text-rose-400"
                                            : "text-slate-600 dark:text-gray-300",
                                        )}
                                      >
                                        {g.failed_requests} 次
                                      </div>
                                    </div>
                                  </div>

                                  <HealthTrendVisualizer
                                    trendPoints={g.trend_points}
                                    groupName={g.group_name}
                                    successRate={g.success_rate}
                                    avgLatency={g.avg_response_time}
                                    totalRequests={g.total_requests}
                                    failedRequests={g.failed_requests}
                                    hours={hours}
                                    accentColor={accentColor}
                                    compact
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 全景对比大盘弹窗 (CompareModal) ── */}
      {compareModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 top-11 z-[85] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-md select-none animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCompareModalOpen(false);
            }}
          >
            <div className="relative w-full max-w-[840px] max-h-[88vh] bg-white dark:bg-[#111320] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-gray-200">
              {/* 弹窗顶部栏 */}
              <div className="px-6 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-white/[0.02] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-xs",
                      theme.topIconBg,
                    )}
                  >
                    <Layers size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>通道分组健康度全景大盘对比</span>
                      <span className="text-xs font-mono font-normal text-slate-400 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5">
                        共 {groups.length} 个通道
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                      实时比对平台全部上游通道成功率、平均时延及总负载，点击可直接激活预览
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCompareModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 弹窗检索与排序控制栏 */}
              <div className="px-6 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap bg-white/40 dark:bg-white/[0.01]">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="过滤通道名称 (如 SVIP, Claude, Codex)..."
                    className={cn(
                      "w-full h-8 pl-8 pr-3 text-xs rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-gray-200 placeholder:text-slate-400 focus:outline-none focus:ring-1",
                      theme.focusRing,
                    )}
                  />
                </div>

                {/* 排序器 */}
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
                  <ArrowUpDown size={12} className="opacity-70" />
                  <span className="text-[11px]">排序:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="h-8 px-2 text-xs rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-gray-200 focus:outline-none cursor-pointer font-mono"
                  >
                    <option value="default">默认排列</option>
                    <option value="rate_desc">成功率从高到低</option>
                    <option value="latency_asc">平均时延从低到高</option>
                    <option value="requests_desc">总请求量从多到少</option>
                  </select>
                </div>
              </div>

              {/* 弹窗内容大盘列表 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-2">
                {filteredAndSortedGroups.map((g) => {
                  const isCur = g.group_name === activeGroup?.group_name;
                  const isBound =
                    resolvedCurrentGroup &&
                    g.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase();
                  const isRec = isGroupRecommended(g.group_name);
                  const st = getHealthStatus(g.success_rate);

                  return (
                    <div
                      key={g.group_name}
                      onClick={() => {
                        setSelectedGroupOverride(g.group_name);
                        if (onSelectGroup) onSelectGroup(g.group_name);
                        setCompareModalOpen(false);
                      }}
                      className={cn(
                        "p-3 rounded-2xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-4 group",
                        isCur
                          ? theme.drawerActive
                          : "border-slate-200/80 dark:border-white/5 bg-slate-50/40 dark:bg-white/[0.015] hover:border-slate-300 dark:hover:border-white/15 hover:bg-slate-100/50 dark:hover:bg-white/[0.03]",
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-xs", st.dotColor)} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-bold text-slate-900 dark:text-white truncate">
                              {g.group_name}
                            </span>
                            {isBound && (
                              <span
                                className={cn(
                                  "text-[10px] px-2 py-0.2 rounded-md font-semibold border",
                                  theme.boundBadge,
                                )}
                              >
                                当前 Key 绑定
                              </span>
                            )}
                            {isCur && !isBound && (
                              <span className="text-[10px] px-2 py-0.2 rounded-md font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                正在对比预览
                              </span>
                            )}
                            {isRec && (
                              <span className="text-[10px] px-2 py-0.2 rounded-md font-mono bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border border-blue-200/50 dark:border-blue-500/20">
                                此工具推荐
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-gray-400 font-mono mt-1 flex items-center gap-3">
                            <span>请求数: {g.total_requests} 次</span>
                            <span>·</span>
                            <span>平均响应: {formatLatency(g.avg_response_time)}</span>
                            {g.failed_requests > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-rose-500 font-semibold">
                                  异常: {g.failed_requests} 次
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-mono font-bold shadow-2xs",
                            st.bgBadge,
                          )}
                        >
                          {g.success_rate.toFixed(1)}% {st.label}
                        </span>

                        <button
                          type="button"
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer",
                            isCur
                              ? "bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-200"
                              : theme.btnPrimary,
                          )}
                        >
                          {isCur ? "当前监控中" : "切换为此分组"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default ChannelGroupMonitor;

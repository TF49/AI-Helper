import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  Coins,
  Cpu,
  Clock,
  RefreshCw,
  ExternalLink,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
  KeyRound,
  Boxes,
  Search,
  X,
  Download,
  RotateCcw,
  Zap,
  Eye,
  Copy,
  Check,
  AlertCircle,
  FileCode2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../lib/useAuth";
import {
  getUserUsageLogs,
  getUserUsageStat,
  openUrl,
} from "../../lib/api";
import type {
  UsageLogItem,
  UsageStatData,
  UsageLogQueryParams,
} from "../../types";
import {
  ClaudeIcon,
  OpenAIIcon,
  GeminiIcon,
  GrokIcon,
} from "../BrandIcons";
import { cn } from "../../lib/utils";

export interface UsageLogsPanelProps {
  className?: string;
}

// ── 格式化相对时间 ──
function getRelativeTimeString(timestampSec: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - timestampSec;
  if (diffSec < 45) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 172800) return "昨天";
  if (diffSec < 259200) return "前天";
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// ── 模型品牌图标与配色判定 ──
function getModelBrandBadge(modelName: string) {
  const name = (modelName || "").toLowerCase();

  if (name.includes("claude")) {
    return {
      family: "Anthropic",
      icon: <ClaudeIcon size={14} useOfficialColor />,
      colorClass: "text-[#D97757]",
      badgeClass:
        "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    };
  }
  if (
    name.includes("gpt") ||
    name.includes("o1") ||
    name.includes("o3") ||
    name.includes("codex") ||
    name.includes("chatgpt")
  ) {
    return {
      family: "OpenAI",
      icon: <OpenAIIcon size={13} className="text-emerald-500" />,
      colorClass: "text-emerald-600 dark:text-emerald-400",
      badgeClass:
        "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    };
  }
  if (name.includes("gemini")) {
    return {
      family: "Google",
      icon: <GeminiIcon size={13} />,
      colorClass: "text-blue-500",
      badgeClass:
        "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
    };
  }
  if (name.includes("grok")) {
    return {
      family: "xAI",
      icon: <GrokIcon size={13} />,
      colorClass: "text-slate-800 dark:text-gray-200",
      badgeClass:
        "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
    };
  }
  if (name.includes("deepseek")) {
    return {
      family: "DeepSeek",
      icon: <Boxes size={13} className="text-indigo-500" />,
      colorClass: "text-indigo-600 dark:text-indigo-400",
      badgeClass:
        "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
    };
  }
  return {
    family: "AI Model",
    icon: <Cpu size={13} className="text-slate-400" />,
    colorClass: "text-slate-700 dark:text-slate-300",
    badgeClass:
      "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  };
}

// ── 耗时等级与样式判定 ──
function getLatencyBadge(useTimeMs: number) {
  const sec = useTimeMs / 1000;
  if (sec < 0.1) {
    return {
      label: `${sec.toFixed(2)}s`,
      badgeClass:
        "bg-emerald-50 text-emerald-600 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
      tag: "极速",
    };
  }
  if (sec < 1.0) {
    return {
      label: `${sec.toFixed(2)}s`,
      badgeClass:
        "bg-blue-50 text-blue-600 border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
      tag: "正常",
    };
  }
  if (sec < 3.0) {
    return {
      label: `${sec.toFixed(2)}s`,
      badgeClass:
        "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-gray-300 dark:border-white/10",
      tag: "标准",
    };
  }
  return {
    label: `${sec.toFixed(2)}s`,
    badgeClass:
      "bg-amber-50 text-amber-600 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    tag: "长耗时",
  };
}

// ── 快速过滤热门模型标签 ──
const POPULAR_MODEL_FILTERS = [
  { label: "全部模型", value: "" },
  { label: "Claude Sonnet", value: "sonnet" },
  { label: "Claude 3.7", value: "3-7" },
  { label: "GPT-4o", value: "gpt-4o" },
  { label: "DeepSeek", value: "deepseek" },
];

export const UsageLogsPanel: React.FC<UsageLogsPanelProps> = ({ className }) => {
  const { authState, authSessionGeneration, wallet, setLoginModalOpen } = useAuth();

  // 日志列表状态
  const [logs, setLogs] = useState<UsageLogItem[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  // 聚合统计数据
  const [statData, setStatData] = useState<UsageStatData | null>(null);

  // 筛选器
  const [timePreset, setTimePreset] = useState<"today" | "7d" | "30d" | "all">("7d");
  const [filterModel, setFilterModel] = useState("");
  const [filterToken, setFilterToken] = useState("");

  // 防抖筛选词
  const [debouncedModel, setDebouncedModel] = useState("");
  const [debouncedToken, setDebouncedToken] = useState("");

  // 单条日志详情模态框
  const [selectedLog, setSelectedLog] = useState<UsageLogItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedModel(filterModel);
      setDebouncedToken(filterToken);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterModel, filterToken]);

  // 计算筛选时间戳
  const timeRange = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    switch (timePreset) {
      case "today": {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        return { start: Math.floor(startOfToday.getTime() / 1000), end: now };
      }
      case "7d":
        return { start: now - 7 * 86400, end: now };
      case "30d":
        return { start: now - 30 * 86400, end: now };
      case "all":
      default:
        return { start: undefined, end: undefined };
    }
  }, [timePreset]);

  // 拉取个人日志与统计数据
  const fetchLogsAndStat = useCallback(
    async (showSuccessToast = false) => {
      if (!authState.is_logged_in) return;
      const request = ++requestGeneration.current;
      const isCurrent = () => request === requestGeneration.current;
      setLoadingLogs(true);
      setErrorMsg(null);

      const queryParams: UsageLogQueryParams = {
        p: page,
        page_size: pageSize,
        model_name: debouncedModel.trim() || undefined,
        token_name: debouncedToken.trim() || undefined,
        start_timestamp: timeRange.start,
        end_timestamp: timeRange.end,
      };

      try {
        const [logsRes, statRes] = await Promise.all([
          getUserUsageLogs(queryParams),
          getUserUsageStat(queryParams).catch(() => null),
        ]);
        if (!isCurrent()) return;
        setLogs(logsRes.items || []);
        setTotalLogs(logsRes.total || 0);
        setStatData(statRes);
        if (showSuccessToast) {
          toast.success("使用日志数据已刷新");
        }
      } catch (err) {
        if (!isCurrent()) return;
        setErrorMsg(typeof err === "string" ? err : "拉取使用日志失败，请稍后重试");
      } finally {
        if (isCurrent()) setLoadingLogs(false);
      }
    },
    [
      authState.is_logged_in,
      authSessionGeneration,
      page,
      pageSize,
      debouncedModel,
      debouncedToken,
      timeRange,
    ],
  );

  useEffect(() => {
    void fetchLogsAndStat();
    return () => {
      requestGeneration.current += 1;
    };
  }, [fetchLogsAndStat]);

  // 动态基于当前页日志汇总统计指标
  const computedStats = useMemo(() => {
    const pagePromptTokens = logs.reduce((acc, cur) => acc + (cur.prompt_tokens || 0), 0);
    const pageCompTokens = logs.reduce((acc, cur) => acc + (cur.completion_tokens || 0), 0);
    const pageTotalTokens = pagePromptTokens + pageCompTokens;
    const pageTotalUseTime = logs.reduce((acc, cur) => acc + (cur.use_time || 0), 0);
    const pageAvgUseTime = logs.length > 0 ? pageTotalUseTime / logs.length : 0;
    const pageTotalQuota = logs.reduce((acc, cur) => acc + (cur.quota || 0), 0);

    return {
      pagePromptTokens,
      pageCompTokens,
      pageTotalTokens,
      pageAvgUseTime,
      pageTotalQuota,
    };
  }, [logs]);

  // 导出 CSV
  const handleExportCsv = () => {
    if (!logs.length) {
      toast.error("当前无日志可导出");
      return;
    }
    const headers = [
      "ID",
      "调用时间",
      "模型名称",
      "令牌密钥",
      "消耗额度(USD)",
      "折合人民币(CNY)",
      "提问Token",
      "回答Token",
      "总Token",
      "耗时(秒)",
      "渠道分组",
      "流式传输",
    ];
    const rows = logs.map((item) => {
      const usd = (((item.quota || 0) as number) / 500000).toFixed(4);
      const cny = (((item.quota || 0) as number) / 2000000).toFixed(4);
      const timeStr = item.created_at
        ? new Date(item.created_at * 1000).toLocaleString()
        : "";
      return [
        item.id,
        `"${timeStr}"`,
        `"${item.model_name || ""}"`,
        `"${item.token_name || ""}"`,
        usd,
        cny,
        item.prompt_tokens || 0,
        item.completion_tokens || 0,
        (item.prompt_tokens || 0) + (item.completion_tokens || 0),
        ((item.use_time || 0) / 1000).toFixed(3),
        `"${item.group || ""}"`,
        item.is_stream ? "是" : "否",
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const nowStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `ai-helper-usage-logs-${nowStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`已导出第 ${page} 页共 ${logs.length} 条记录为 CSV 文件`);
  };

  // 重置筛选
  const handleResetFilters = () => {
    setFilterModel("");
    setFilterToken("");
    setTimePreset("7d");
    setPage(1);
  };

  const hasActiveFilters = Boolean(filterModel || filterToken || timePreset !== "7d");

  // 未登录提示卡片
  if (!authState.is_logged_in) {
    return (
      <div className={cn("space-y-6 select-none", className)}>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <span>使用日志与调用审计</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-gray-400 font-normal">
              Usage Logs
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            实时调用明细、模型消耗核算与 Token 吞吐审计
          </p>
        </div>

        <div className="p-10 rounded-3xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-xs flex flex-col items-center justify-center text-center space-y-5">
          <div className="w-16 h-16 rounded-3xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-inner">
            <Clock size={32} />
          </div>
          <div className="space-y-1.5 max-w-md">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              登录以同步 Bob API 使用明细
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
              登录后可实时检索云端 Token 使用记录、单次请求成本、提问与回答比例、响应端到端延迟及审计报表。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLoginModalOpen(true)}
            className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md hover:shadow-blue-500/20 transition-all cursor-pointer flex items-center gap-2"
          >
            <User size={15} />
            <span>立即登录 Bob API 账号</span>
          </button>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));

  // 聚合指标计算
  const displayRequestCount = totalLogs > 0 ? totalLogs : (statData?.request_count || 0);

  const totalQuotaPoints =
    statData && typeof statData.quota === "number" && statData.quota > 0
      ? statData.quota
      : computedStats.pageTotalQuota;

  const totalCostUsd = ((totalQuotaPoints || 0) as number) / 500000;
  const totalCostCny = totalCostUsd / 4.0;

  // Token 吞吐与比例
  const promptTokensNum =
    statData && statData.prompt_tokens > 0
      ? statData.prompt_tokens
      : computedStats.pagePromptTokens;

  const completionTokensNum =
    statData && statData.completion_tokens > 0
      ? statData.completion_tokens
      : computedStats.pageCompTokens;

  const totalTokensNum = promptTokensNum + completionTokensNum;
  const promptPercent =
    totalTokensNum > 0 ? (promptTokensNum / totalTokensNum) * 100 : 0;
  const completionPercent =
    totalTokensNum > 0 ? (completionTokensNum / totalTokensNum) * 100 : 0;

  // 平均延迟
  const avgLatencySec =
    statData && statData.avg_use_time > 0
      ? statData.avg_use_time / 1000
      : computedStats.pageAvgUseTime > 0
        ? computedStats.pageAvgUseTime / 1000
        : 0;

  return (
    <div className={cn("space-y-4 select-none", className)}>
      {/* ── 顶部操作栏与用户信息 ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#121524] p-3.5 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-2xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              使用日志与审计
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              @{authState.user?.username || "user"}
            </span>
            {wallet?.group && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20 uppercase font-mono">
                {wallet.group}
              </span>
            )}
          </div>
          <span className="hidden md:inline-block text-xs text-slate-400 dark:text-gray-500">
            · 云端 Token 调用审计
          </span>
        </div>

        {/* 右侧动作按钮组 */}
        <div className="flex items-center gap-2">
          {/* 导出 CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loadingLogs || logs.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-300 disabled:opacity-40 transition-colors cursor-pointer"
            title="导出当前列表到 CSV 电子表格"
          >
            <Download size={13} className="text-slate-500 dark:text-gray-400" />
            <span className="hidden sm:inline">导出数据</span>
          </button>

          {/* 官网日志链接 */}
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com/usage-logs/common")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-300 transition-colors cursor-pointer"
            title="在默认浏览器中打开 Bob API 官网日志"
          >
            <span>网页端</span>
            <ExternalLink size={12} className="opacity-70" />
          </button>

          {/* 刷新 */}
          <button
            type="button"
            onClick={() => void fetchLogsAndStat(true)}
            disabled={loadingLogs}
            className="p-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-gray-300 transition-colors cursor-pointer"
            title="刷新日志"
          >
            <RefreshCw
              size={13}
              className={cn(loadingLogs && "animate-spin text-blue-500")}
            />
          </button>
        </div>
      </div>

      {/* ── 4 大核心指标卡片 (Bento 网格 + 悬停微光) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 指标 1：累计调用次数 */}
        <div className="group relative p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 hover:border-blue-500/40 dark:hover:border-blue-500/30 transition-all shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-gray-400 uppercase tracking-wider">
              累计调用次数
            </span>
            <div className="w-7 h-7 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <Activity size={14} />
            </div>
          </div>
          <div className="text-xl font-mono font-bold text-slate-900 dark:text-white mt-1.5">
            {displayRequestCount.toLocaleString()}
          </div>
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 dark:border-white/5 text-[10px] text-slate-400">
            <span>个人请求明细</span>
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              正常活跃
            </span>
          </div>
        </div>

        {/* 指标 2：消耗金额 */}
        <div className="group relative p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 hover:border-indigo-500/40 dark:hover:border-indigo-500/30 transition-all shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-gray-400 uppercase tracking-wider">
              {statData && statData.quota && statData.quota > 0
                ? "当前筛选消耗额度"
                : "当前页消耗额度"}
            </span>
            <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
              <Coins size={14} />
            </div>
          </div>
          <div className="text-xl font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-1.5">
            ${totalCostUsd.toFixed(4)}
          </div>
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 dark:border-white/5 text-[10px] text-slate-400">
            <span>折合人民币 ≈ ¥{totalCostCny.toFixed(4)}</span>
            <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-white/5">
              1￥=4$
            </span>
          </div>
        </div>

        {/* 指标 3：Token 吞吐量与比例进度条 */}
        <div className="group relative p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 hover:border-emerald-500/40 dark:hover:border-emerald-500/30 transition-all shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-gray-400 uppercase tracking-wider">
              累计 Token 吞吐
            </span>
            <div className="w-7 h-7 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <Cpu size={14} />
            </div>
          </div>
          <div className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-1.5">
            {totalTokensNum > 1000000
              ? (totalTokensNum / 1000000).toFixed(2) + "M"
              : totalTokensNum > 1000
                ? (totalTokensNum / 1000).toFixed(1) + "k"
                : totalTokensNum}
          </div>

          {/* 提问 vs 回答比例微型进度条 */}
          <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden flex mt-2">
            <div
              style={{ width: `${promptPercent}%` }}
              className="bg-indigo-500 h-full rounded-l-full"
              title={`提问: ${promptPercent.toFixed(1)}%`}
            />
            <div
              style={{ width: `${completionPercent}%` }}
              className="bg-emerald-500 h-full rounded-r-full"
              title={`回答: ${completionPercent.toFixed(1)}%`}
            />
          </div>

          <div className="flex items-center justify-between mt-1.5 text-[9px] text-slate-400 font-mono">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
              提问:{" "}
              {promptTokensNum > 1000
                ? (promptTokensNum / 1000).toFixed(1) + "k"
                : promptTokensNum}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              回答:{" "}
              {completionTokensNum > 1000
                ? (completionTokensNum / 1000).toFixed(1) + "k"
                : completionTokensNum}
            </span>
          </div>
        </div>

        {/* 指标 4：平均端到端响应耗时 */}
        <div className="group relative p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 hover:border-amber-500/40 dark:hover:border-amber-500/30 transition-all shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-gray-400 uppercase tracking-wider">
              平均响应耗时
            </span>
            <div className="w-7 h-7 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
              <Zap size={14} />
            </div>
          </div>
          <div className="text-xl font-mono font-bold text-amber-600 dark:text-amber-400 mt-1.5">
            {avgLatencySec > 0 ? avgLatencySec.toFixed(2) + "s" : "< 0.01s"}
          </div>
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 dark:border-white/5 text-[10px] text-slate-400">
            <span>端到端网络与推理延时</span>
            <span className="text-slate-500 dark:text-gray-400 font-mono text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-white/5">
              {avgLatencySec < 0.2 ? "极速" : "标准"}
            </span>
          </div>
        </div>
      </div>

      {/* ── 筛选控制栏 (周期选择 + 模型搜索 + 密钥搜索 + 快速标签) ── */}
      <div className="p-3 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs space-y-2.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          {/* 左侧：时间预设分段切换 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400 dark:text-gray-400 flex items-center gap-1 mr-1">
              <Calendar size={13} />
              <span>周期:</span>
            </span>
            <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10">
              {(["today", "7d", "30d", "all"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTimePreset(t);
                    setPage(1);
                  }}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                    timePreset === t
                      ? "bg-white text-slate-900 shadow-xs dark:bg-white/15 dark:text-white"
                      : "text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200",
                  )}
                >
                  {t === "today"
                    ? "今日"
                    : t === "7d"
                      ? "近7天"
                      : t === "30d"
                        ? "近30天"
                        : "全部"}
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：模型与密钥搜索输入框 */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 模型搜索框 */}
            <div className="relative flex items-center">
              <Boxes
                size={13}
                className="absolute left-2.5 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={filterModel}
                onChange={(e) => {
                  setFilterModel(e.target.value);
                  setPage(1);
                }}
                placeholder="按模型筛选 (如 sonnet)..."
                className="w-44 h-8 pl-8 pr-7 rounded-xl text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              />
              {filterModel && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterModel("");
                    setPage(1);
                  }}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 密钥搜索框 */}
            <div className="relative flex items-center">
              <KeyRound
                size={13}
                className="absolute left-2.5 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={filterToken}
                onChange={(e) => {
                  setFilterToken(e.target.value);
                  setPage(1);
                }}
                placeholder="按密钥筛选..."
                className="w-36 h-8 pl-8 pr-7 rounded-xl text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              />
              {filterToken && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterToken("");
                    setPage(1);
                  }}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-200"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 重置筛选按钮 */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1 h-8 px-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 hover:bg-slate-200/70 dark:bg-white/5 dark:hover:bg-white/10 text-xs text-slate-600 dark:text-gray-300 transition-colors cursor-pointer"
                title="重置所有筛选"
              >
                <RotateCcw size={11} />
                <span>重置</span>
              </button>
            )}
          </div>
        </div>

        {/* 热门模型快速筛选标签 */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100 dark:border-white/5 text-[11px]">
          <span className="text-slate-400 dark:text-gray-500 text-[10px] mr-1">
            快捷筛选:
          </span>
          {POPULAR_MODEL_FILTERS.map((item) => {
            const isSelected =
              item.value === ""
                ? filterModel === ""
                : filterModel.toLowerCase() === item.value.toLowerCase();
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setFilterModel(item.value);
                  setPage(1);
                }}
                className={cn(
                  "px-2 py-0.5 rounded-lg border text-[11px] transition-all cursor-pointer",
                  isSelected
                    ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20 font-medium"
                    : "bg-slate-50 text-slate-600 border-slate-200/80 dark:bg-white/5 dark:text-gray-400 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 日志明细列表表格 ── */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#121524] shadow-2xs overflow-hidden flex flex-col">
        {errorMsg && (
          <div className="p-3 text-xs bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-b border-red-200 dark:border-red-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchLogsAndStat()}
              className="underline hover:opacity-80 cursor-pointer"
            >
              点击重试
            </button>
          </div>
        )}

        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/5 text-slate-400 select-none">
              <tr>
                <th className="py-3 px-3.5 font-semibold whitespace-nowrap">
                  调用时间
                </th>
                <th className="py-3 px-3 font-semibold whitespace-nowrap">
                  模型规格
                </th>
                <th className="py-3 px-3 font-semibold whitespace-nowrap">
                  令牌密钥
                </th>
                <th className="py-3 px-3 font-semibold whitespace-nowrap">
                  消耗额度
                </th>
                <th className="py-3 px-3 font-semibold whitespace-nowrap">
                  Token 构成 (提问 / 回答)
                </th>
                <th className="py-3 px-3 font-semibold whitespace-nowrap">
                  耗时
                </th>
                <th className="py-3 px-3 font-semibold whitespace-nowrap">
                  渠道分组
                </th>
                <th className="py-3 px-3 font-semibold text-right whitespace-nowrap">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {loadingLogs ? (
                // 骨架屏加载状态
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`skeleton-${idx}`} className="animate-pulse">
                    <td className="py-3.5 px-3.5">
                      <div className="h-3.5 w-28 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="h-3.5 w-32 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="h-3.5 w-20 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="h-3.5 w-24 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="h-3.5 w-36 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="h-3.5 w-14 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="h-3.5 w-24 bg-slate-200 dark:bg-white/10 rounded-md" />
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <div className="h-3.5 w-10 bg-slate-200 dark:bg-white/10 rounded-md ml-auto" />
                    </td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                // 空数据状态
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2.5 max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400">
                        <Search size={22} />
                      </div>
                      <p className="text-xs font-medium text-slate-700 dark:text-gray-300">
                        暂无符合条件的调用日志
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-gray-500">
                        当前筛选条件下未检索到任何 API 请求记录，您可以尝试更换周期或清除搜索关键词。
                      </p>
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="mt-1 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer"
                        >
                          清除筛选条件
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const dateObj = log.created_at
                    ? new Date(log.created_at * 1000)
                    : null;
                  const dateStr = dateObj ? dateObj.toLocaleDateString() : "-";
                  const timeStr = dateObj ? dateObj.toLocaleTimeString() : "-";
                  const relativeTime = log.created_at
                    ? getRelativeTimeString(log.created_at)
                    : "";

                  const brandBadge = getModelBrandBadge(log.model_name);
                  const latencyBadge = getLatencyBadge(log.use_time);

                  const usdCost = (((log.quota || 0) as number) / 500000).toFixed(4);
                  const cnyCost = (((log.quota || 0) as number) / 2000000).toFixed(4);

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="group hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                      {/* 时间 */}
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-gray-200">
                            {timeStr}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                            <span>{dateStr}</span>
                            <span>·</span>
                            <span>{relativeTime}</span>
                            {log.is_stream && (
                              <span className="px-1 py-0.2 rounded bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300 font-mono text-[9px]">
                                流式
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 模型 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-slate-100 dark:bg-white/5 flex-shrink-0">
                            {brandBadge.icon}
                          </div>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {log.model_name}
                          </span>
                        </div>
                      </td>

                      {/* 密钥名称 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-100/80 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 text-slate-700 dark:text-gray-300 font-mono text-[11px]">
                          <KeyRound size={11} className="text-slate-400" />
                          <span>{log.token_name || "默认密钥"}</span>
                        </div>
                      </td>

                      {/* 消耗额度 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            ${usdCost}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            ≈ ¥{cnyCost}
                          </span>
                        </div>
                      </td>

                      {/* Token 细分 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-indigo-600 dark:text-indigo-400">
                              提问 {log.prompt_tokens?.toLocaleString() || 0}
                            </span>
                            <span className="text-slate-300 dark:text-gray-600">
                              /
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              回答 {log.completion_tokens?.toLocaleString() || 0}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            总计 {(log.prompt_tokens + log.completion_tokens).toLocaleString()} Tokens
                          </span>
                        </div>
                      </td>

                      {/* 耗时 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full border text-[11px] font-mono",
                            latencyBadge.badgeClass,
                          )}
                        >
                          {latencyBadge.label}
                        </span>
                      </td>

                      {/* 渠道分组 */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-400 font-mono border border-slate-200/50 dark:border-white/5">
                          {log.group || "default"}
                        </span>
                      </td>

                      {/* 操作 */}
                      <td className="py-3 px-3 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                          className="px-2 py-1 rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-white/10 hover:bg-white dark:hover:bg-white/10 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer text-xs flex items-center gap-1 ml-auto"
                        >
                          <Eye size={12} />
                          <span>详情</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分页控制栏 */}
        <div className="p-3 border-t border-slate-100 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>
              显示第 {(page - 1) * pageSize + (logs.length > 0 ? 1 : 0)} -{" "}
              {(page - 1) * pageSize + logs.length} 条，共 {totalLogs} 条记录
            </span>
            <span className="text-slate-300 dark:text-gray-600">|</span>
            <div className="flex items-center gap-1">
              <span>每页</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-6 px-1.5 rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-gray-300 text-xs focus:outline-none cursor-pointer"
              >
                <option value={20}>20 条</option>
                <option value={50}>50 条</option>
                <option value={100}>100 条</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="p-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 cursor-pointer"
              title="第一页"
            >
              <ChevronsLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 cursor-pointer"
              title="上一页"
            >
              <ChevronLeft size={13} />
            </button>

            <span className="px-2 font-mono text-xs text-slate-700 dark:text-gray-300">
              {page} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 cursor-pointer"
              title="下一页"
            >
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="p-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 cursor-pointer"
              title="最后一页"
            >
              <ChevronsRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── 日志明细抽屉/模态框 ── */}
      <AnimatePresence>
        {selectedLog && (
          <UsageLogDetailModal
            log={selectedLog}
            onClose={() => setSelectedLog(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ── 单条日志详情模态框组件 ──
interface UsageLogDetailModalProps {
  log: UsageLogItem;
  onClose: () => void;
}

const UsageLogDetailModal: React.FC<UsageLogDetailModalProps> = ({
  log,
  onClose,
}) => {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const brand = getModelBrandBadge(log.model_name);
  const usdCost = (((log.quota || 0) as number) / 500000).toFixed(4);
  const cnyCost = (((log.quota || 0) as number) / 2000000).toFixed(4);
  const totalTokens = (log.prompt_tokens || 0) + (log.completion_tokens || 0);

  const copyRequestId = async () => {
    try {
      await navigator.clipboard.writeText(String(log.id));
      setCopiedId(true);
      toast.success("已复制请求 ID");
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const copyRawJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopiedJson(true);
      toast.success("已将完整 JSON 数据复制到剪贴板");
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      toast.error("复制 JSON 失败");
    }
  };

  return (
    <div className="fixed inset-0 top-11 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm select-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#121524] border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* 模态框顶部 */}
        <div className="p-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between bg-slate-50/70 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-white/10 flex items-center justify-center">
              {brand.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                  {log.model_name}
                </h3>
                {log.is_stream && (
                  <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300 font-mono text-[10px]">
                    流式传输
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {log.created_at
                  ? new Date(log.created_at * 1000).toLocaleString()
                  : "-"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* 模态框内容区 */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* 4 块 Bento 数据 */}
          <div className="grid grid-cols-2 gap-3">
            {/* 费用明细 */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">
                额度消费核算
              </span>
              <div className="text-base font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                ${usdCost}
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                ≈ ¥{cnyCost} · 点数: {(log.quota || 0).toLocaleString()}
              </div>
            </div>

            {/* Token 构成 */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">
                Token 吞吐结构
              </span>
              <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {totalTokens.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                提问: {log.prompt_tokens?.toLocaleString() || 0} · 回答:{" "}
                {log.completion_tokens?.toLocaleString() || 0}
              </div>
            </div>

            {/* 耗时分析 */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">
                响应时间
              </span>
              <div className="text-base font-bold font-mono text-slate-900 dark:text-white mt-1">
                {((log.use_time || 0) / 1000).toFixed(3)}s
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                原始毫秒数: {log.use_time || 0} ms
              </div>
            </div>

            {/* 路由与鉴权 */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">
                渠道与密钥
              </span>
              <div className="text-sm font-bold font-mono text-slate-900 dark:text-white truncate mt-1">
                {log.token_name || "默认密钥"}
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                分组: {log.group || "default"}
              </div>
            </div>
          </div>

          {/* 属性列表 */}
          <div className="rounded-xl border border-slate-200/60 dark:border-white/5 divide-y divide-slate-100 dark:divide-white/5 overflow-hidden">
            <div className="p-2.5 px-3 flex items-center justify-between">
              <span className="text-slate-400">调用记录 ID</span>
              <div className="flex items-center gap-1.5 font-mono text-slate-800 dark:text-gray-200">
                <span>#{log.id}</span>
                <button
                  type="button"
                  onClick={copyRequestId}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title="复制 ID"
                >
                  {copiedId ? (
                    <Check size={12} className="text-emerald-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            </div>

            <div className="p-2.5 px-3 flex items-center justify-between">
              <span className="text-slate-400">用户账号</span>
              <span className="font-mono text-slate-800 dark:text-gray-200">
                @{log.username} (UID: {log.user_id})
              </span>
            </div>

            <div className="p-2.5 px-3 flex items-center justify-between">
              <span className="text-slate-400">时间戳</span>
              <span className="font-mono text-slate-800 dark:text-gray-200">
                {log.created_at} ({new Date(log.created_at * 1000).toISOString()})
              </span>
            </div>

            {log.channel_id != null && (
              <div className="p-2.5 px-3 flex items-center justify-between">
                <span className="text-slate-400">上游渠道 Channel ID</span>
                <span className="font-mono text-slate-800 dark:text-gray-200">
                  {log.channel_id}
                </span>
              </div>
            )}
          </div>

          {/* 开发者原始 JSON 展开查看 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <FileCode2 size={13} />
                <span>原始记录 JSON 载荷</span>
              </span>
              <button
                type="button"
                onClick={copyRawJson}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copiedJson ? (
                  <Check size={11} className="text-emerald-500" />
                ) : (
                  <Copy size={11} />
                )}
                <span>复制 JSON</span>
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-slate-900 text-slate-200 font-mono text-[10px] overflow-x-auto max-h-40 leading-relaxed border border-slate-800">
              {JSON.stringify(log, null, 2)}
            </pre>
          </div>
        </div>

        {/* 模态框底部 */}
        <div className="p-3 px-4 border-t border-slate-100 dark:border-white/10 flex items-center justify-end bg-slate-50/70 dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900 text-xs font-medium transition-colors cursor-pointer"
          >
            完成
          </button>
        </div>
      </motion.div>
    </div>
  );
};

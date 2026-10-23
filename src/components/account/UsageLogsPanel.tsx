import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Clock,
  RefreshCw,
  ExternalLink,
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  KeyRound,
  Boxes,
} from "lucide-react";
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
import { CircleToSearchBar } from "../ui/CircleToSearchBar";
import { cn } from "../../lib/utils";

export interface UsageLogsPanelProps {
  className?: string;
}

export const UsageLogsPanel: React.FC<UsageLogsPanelProps> = ({
  className,
}) => {
  const { authState, authSessionGeneration, wallet, setLoginModalOpen } = useAuth();

  // 使用日志状态 (仅保留个人使用情况)
  const [logs, setLogs] = useState<UsageLogItem[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  // 聚合统计数据
  const [statData, setStatData] = useState<UsageStatData | null>(null);

  // 筛选器
  const [timePreset, setTimePreset] = useState<"today" | "7d" | "30d" | "all">("7d");
  const [filterModel, setFilterModel] = useState("");
  const [filterToken, setFilterToken] = useState("");

  // 防抖延迟筛选词
  const [debouncedModel, setDebouncedModel] = useState("");
  const [debouncedToken, setDebouncedToken] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedModel(filterModel);
      setDebouncedToken(filterToken);
    }, 350);
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
  const fetchLogsAndStat = useCallback(async () => {
    if (!authState.is_logged_in) return;
    const request = ++requestGeneration.current;
    const isCurrent = () => request === requestGeneration.current;
    setLoadingLogs(true);
    setErrorMsg(null);
    setLogs([]);
    setStatData(null);

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
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(typeof err === "string" ? err : "拉取使用日志失败");
    } finally {
      if (isCurrent()) setLoadingLogs(false);
    }
  }, [
    authState.is_logged_in,
    authState.user?.id,
    authSessionGeneration,
    page,
    pageSize,
    debouncedModel,
    debouncedToken,
    timeRange,
  ]);

  useEffect(() => {
    setLogs([]);
    setStatData(null);
    void fetchLogsAndStat();
    return () => { requestGeneration.current += 1; };
  }, [fetchLogsAndStat]);

  // 动态根据返回日志计算备用指标 (当统计接口不带 token/latency 详细聚合时自适应)
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

  // 未登录占位卡片
  if (!authState.is_logged_in) {
    return (
      <div className={cn("space-y-5 select-none", className)}>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            使用日志
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            实时调用明细、模型消耗与 Token 吞吐分析 (bob-api.com/usage-logs/common)
          </p>
        </div>

        <div className="p-8 rounded-3xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/10 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Clock size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              登录 Bob API 账号以同步使用记录
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md">
              登录后可实时检索云端 Token 使用日志、单次请求成本、Token 消耗细分与平均延迟。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLoginModalOpen(true)}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-2"
          >
            <User size={14} />
            <span>立即登录 Bob API</span>
          </button>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));

  // 累计调用次数展示逻辑：优先使用当前筛选下的 totalLogs；若未开启特定搜索且有钱包总数也可参考
  const displayRequestCount = totalLogs > 0 ? totalLogs : (statData?.request_count || 0);

  // 累计消耗额度点数
  const totalQuotaPoints =
    statData && typeof statData.quota === "number" && statData.quota > 0
      ? statData.quota
      : computedStats.pageTotalQuota;

  const totalCostUsd = ((totalQuotaPoints || 0) as number) / 500000;
  const totalCostCny = totalCostUsd / 4.0;

  // 累计 Token 吞吐
  const totalTokensNum =
    statData && (statData.prompt_tokens + statData.completion_tokens > 0)
      ? statData.prompt_tokens + statData.completion_tokens
      : computedStats.pageTotalTokens;

  // 平均响应耗时
  const avgLatencySec =
    statData && statData.avg_use_time > 0
      ? statData.avg_use_time / 1000
      : computedStats.pageAvgUseTime > 0
        ? computedStats.pageAvgUseTime / 1000
        : 0;

  return (
    <div className={cn("space-y-5 select-none", className)}>
      {/* ── 顶部标题与个人概要 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              使用日志 (Usage Logs)
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20">
              @{authState.user?.username || "user"}
            </span>
            {wallet?.group && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20 uppercase font-mono">
                {wallet.group}
              </span>
            )}
          </div>
        </div>

        {/* 右侧：官网直达与刷新 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com/usage-logs/common")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/60 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-300 transition-colors cursor-pointer"
            title="在浏览器中打开 Bob API 官网使用日志页面"
          >
            <span>网页端日志</span>
            <ExternalLink size={12} className="opacity-70" />
          </button>

          <button
            type="button"
            onClick={() => void fetchLogsAndStat()}
            disabled={loadingLogs}
            className="p-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/60 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-gray-300 transition-colors cursor-pointer"
            title="刷新日志"
          >
            <RefreshCw size={13} className={cn(loadingLogs && "animate-spin text-blue-500")} />
          </button>
        </div>
      </div>

      {/* ── 4 大聚合指标看板 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 总请求数 */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            累计调用次数
          </span>
          <div className="text-lg font-mono font-bold text-slate-900 dark:text-white mt-1">
            {displayRequestCount.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400">
            个人请求记录数
          </span>
        </div>

        {/* 累计消耗金额 */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {statData && statData.quota && statData.quota > 0 ? "当前筛选消耗额度" : "当前页消耗额度"}
          </span>
          <div className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 mt-1">
            ${totalCostUsd.toFixed(4)}
          </div>
          <span className="text-[10px] text-slate-400">
            个人消耗 · ≈ ¥{totalCostCny.toFixed(4)} (1￥=4$)
          </span>
        </div>

        {/* 消耗总 Tokens */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            累计 Token 吞吐
          </span>
          <div className="text-lg font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {totalTokensNum > 1000 ? (totalTokensNum / 1000).toFixed(1) + "k" : totalTokensNum}
          </div>
          <span className="text-[10px] text-slate-400">
            {statData && (statData.prompt_tokens > 0 || statData.completion_tokens > 0)
              ? `提问: ${statData.prompt_tokens.toLocaleString()} · 回答: ${statData.completion_tokens.toLocaleString()}`
              : `当前页: 提问 ${computedStats.pagePromptTokens.toLocaleString()} · 回答 ${computedStats.pageCompTokens.toLocaleString()}`}
          </span>
        </div>

        {/* 平均延迟 */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            平均响应耗时
          </span>
          <div className="text-lg font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-1">
            {avgLatencySec > 0 ? avgLatencySec.toFixed(2) + "s" : "< 0.01s"}
          </div>
          <span className="text-[10px] text-slate-400">
            个人请求端到端响应耗时
          </span>
        </div>
      </div>

      {/* ── 筛选与时间范围控制栏 ── */}
      <div className="p-3 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 flex flex-col md:flex-row items-center justify-between gap-3 shadow-2xs">
        {/* 时间预设 */}
        <div className="flex items-center gap-1 w-full md:w-auto">
          <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
            <Calendar size={13} />
            <span>周期:</span>
          </span>
          {(["today", "7d", "30d", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTimePreset(t);
                setPage(1);
              }}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                timePreset === t
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/5",
              )}
            >
              {t === "today" ? "今日" : t === "7d" ? "近7天" : t === "30d" ? "近30天" : "全部"}
            </button>
          ))}
        </div>

        {/* 模型与密钥搜索：圆形图标按钮 -> 搜索框 (CircleToSearchBar) */}
        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
          <CircleToSearchBar
            value={filterModel}
            onChange={(val) => {
              setFilterModel(val);
              setPage(1);
            }}
            placeholder="按模型筛选..."
            title="按模型筛选 (点击展开)"
            icon={<Boxes size={12} className="text-emerald-500" />}
            size={32}
            expandedWidth={160}
          />
          <CircleToSearchBar
            value={filterToken}
            onChange={(val) => {
              setFilterToken(val);
              setPage(1);
            }}
            placeholder="按密钥筛选..."
            title="按密钥筛选 (点击展开)"
            icon={<KeyRound size={12} className="text-amber-500" />}
            size={32}
            expandedWidth={160}
          />
        </div>
      </div>

      {/* ── 日志明细列表表格 ── */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#121524] shadow-2xs overflow-hidden">
        {errorMsg && (
          <div className="p-3 text-xs bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-b border-red-200 dark:border-red-500/20">
            {errorMsg}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/5 text-slate-400">
              <tr>
                <th className="py-2.5 px-3 font-semibold">时间</th>
                <th className="py-2.5 px-3 font-semibold">模型</th>
                <th className="py-2.5 px-3 font-semibold">令牌名称</th>
                <th className="py-2.5 px-3 font-semibold">消耗额度</th>
                <th className="py-2.5 px-3 font-semibold">Token 细分</th>
                <th className="py-2.5 px-3 font-semibold">耗时</th>
                <th className="py-2.5 px-3 font-semibold">渠道分组</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {loadingLogs ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-slate-400"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw size={14} className="animate-spin text-blue-500" />
                      <span>正在拉取 Bob API 使用日志...</span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-slate-400"
                  >
                    暂无调用记录
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const dateStr = log.created_at
                    ? new Date(log.created_at * 1000).toLocaleString()
                    : "-";

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-white/[0.01] transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {log.model_name}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-gray-300">
                        {log.token_name || "默认密钥"}
                      </td>
                      <td className="py-2.5 px-3 text-blue-600 dark:text-blue-400 whitespace-nowrap">
                        ${(((log.quota || 0) as number) / 500000).toFixed(4)}
                        <span className="text-[10px] text-slate-400 ml-1">
                          (¥{(((log.quota || 0) as number) / 2000000).toFixed(4)})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                        提问 {log.prompt_tokens} / 回答 {log.completion_tokens}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                        {(log.use_time / 1000).toFixed(2)}s
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-400 font-mono">
                          {log.group || "default"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分页控制条 */}
        <div className="p-3 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-xs text-slate-500">
          <span>
            第 {page} / {totalPages} 页 (共 {totalLogs} 条)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

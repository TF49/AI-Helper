import React, { useState, useEffect, useCallback } from "react";
import {
  User,
  Wallet,
  ExternalLink,
  CreditCard,
  LogOut,
  Clock,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Crown,
  Activity,
  Check,
  Copy,
  ArrowRight,
  Lock,
  Zap,
  BookOpen,
  Wrench,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { getVersion } from "@tauri-apps/api/app";
import { useAuth } from "../../lib/useAuth";
import { openUrl, checkBobApiNetwork, isTauri } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { MainNav, NetworkStatus } from "../../types";
import { ButtonToLoaderToSuccess } from "../ui/ButtonToLoaderToSuccess";

export interface PersonalCenterPanelProps {
  className?: string;
  onNavigate?: (nav: MainNav) => void;
}

export const PersonalCenterPanel: React.FC<PersonalCenterPanelProps> = ({
  className,
  onNavigate,
}) => {
  const { authState, wallet, setLoginModalOpen, logout, refreshWallet, refreshState } =
    useAuth();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [appVersion, setAppVersion] = useState("1.0.72");

  useEffect(() => {
    if (isTauri) {
      void getVersion()
        .then((v) => setAppVersion(v))
        .catch(() => setAppVersion("1.0.72"));
    }
  }, []);

  // 检测节点网络延迟
  const runNetworkCheck = useCallback(async () => {
    setCheckingNetwork(true);
    try {
      const res = await checkBobApiNetwork();
      setNetworkStatus(res);
    } catch {
      setNetworkStatus({ reachable: false, error_message: "连接超时" });
    } finally {
      setCheckingNetwork(false);
    }
  }, []);

  useEffect(() => {
    if (authState.is_logged_in) {
      void runNetworkCheck();
    }
  }, [authState.is_logged_in, runNetworkCheck]);

  // 手动刷新资产与状态
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [walletUpdated, , netRes] = await Promise.all([
        refreshWallet(),
        refreshState(),
        checkBobApiNetwork(),
      ]);
      setNetworkStatus(netRes);
      if (!walletUpdated || !netRes.reachable) {
        throw new Error(netRes.error_message || "连接超时");
      }
      toast.success("账号资产与状态已同步最新");
    } catch (err) {
      toast.error("刷新同步失败，请检查网络连接");
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  };

  // 复制文本辅助函数
  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(label);
      toast.success(`已复制 ${label}`);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      toast.error("复制失败");
    }
  };

  // ── 未登录状态引导 ──
  if (!authState.is_logged_in) {
    return (
      <div className={cn("w-full max-w-5xl mx-auto space-y-6 select-none py-6", className)}>
        <div className="p-8 sm:p-12 rounded-3xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-sm relative overflow-hidden flex flex-col items-center text-center space-y-6">
          <div className="absolute -top-24 -right-24 w-72 h-72 bg-blue-500/10 dark:bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/10 dark:bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />

          <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/25 relative">
            <User size={30} />
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-amber-400 border-2 border-white dark:border-[#121524]" />
          </div>

          <div className="space-y-2 max-w-md">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              登录 Bob API 账号，掌控全景资产
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
              登录后可实时同步账户额度、查看会员权益分组与费率折扣、一键分发 API Key
              至各大 AI 开发工具并审计消费日志。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-xl text-left">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-gray-200">
                <Wallet size={14} className="text-blue-500" />
                <span>实时资产看板</span>
              </div>
              <p className="text-[11px] text-slate-400">
                精确到小数点后 4 位的美元与人民币余额实时展示。
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-gray-200">
                <Crown size={14} className="text-amber-500" />
                <span>专属会员通道</span>
              </div>
              <p className="text-[11px] text-slate-400">
                SVIP/VIP 专属高速并发与优惠倍率模型调度。
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-gray-200">
                <Clock size={14} className="text-emerald-500" />
                <span>全链路审计</span>
              </div>
              <p className="text-[11px] text-slate-400">
                每一次调用的耗时、Token 消耗与金额明细可查。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setLoginModalOpen(true)}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center gap-2"
            >
              <User size={15} />
              <span>立即登录 Bob API</span>
            </button>
            <button
              type="button"
              onClick={() => void openUrl("https://bob-api.com/register")}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>前往官网注册</span>
              <ExternalLink size={12} className="opacity-70" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 已登录状态 ──
  const user = authState.user;
  const isSuperAdmin = Boolean(user?.role && user.role >= 100);
  const isSysAdmin = Boolean(user?.role && user.role >= 10);
  const isVip = Boolean(wallet?.group && wallet.group.toLowerCase().includes("vip"));

  const roleName = isSuperAdmin
    ? "超级管理员"
    : isSysAdmin
      ? "系统管理员"
      : isVip
        ? "VIP 会员用户"
        : "标准用户";

  // 额度与计算
  const quotaUsd = wallet && typeof wallet.quota_usd === "number" ? wallet.quota_usd : 0;
  const quotaCny = wallet && typeof wallet.quota_cny === "number" ? wallet.quota_cny : 0;
  const usedUsd = wallet && typeof wallet.used_quota_usd === "number" ? wallet.used_quota_usd : 0;
  const usedCny = wallet && typeof wallet.used_quota_cny === "number" ? wallet.used_quota_cny : 0;
  const requestCount = wallet && typeof wallet.request_count === "number" ? wallet.request_count : 0;

  // 资金总池与百分比进度
  const totalPoolUsd = quotaUsd + usedUsd;
  const usedRatio = totalPoolUsd > 0 ? Math.min(100, (usedUsd / totalPoolUsd) * 100) : 0;
  const remainRatio = Math.max(0, 100 - usedRatio);

  return (
    <div className={cn("w-full max-w-7xl mx-auto space-y-6 select-none pb-8", className)}>
      {/* ── 顶部个人基础资料横幅 (Profile Hero Banner) ── */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-sm relative overflow-hidden flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        {/* 背景微晶极光晕染 */}
        <div className="absolute -right-16 -top-16 w-80 h-80 bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-transparent dark:from-blue-600/15 dark:via-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* 左侧个人信息 */}
        <div className="flex items-center gap-4 relative z-10 min-w-0 flex-1">
          {/* 头像 */}
          <div className="relative flex-shrink-0">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 text-white flex items-center justify-center font-extrabold text-2xl shadow-md ring-4 ring-white/60 dark:ring-white/5">
              {user?.display_name
                ? user.display_name.slice(0, 1).toUpperCase()
                : user?.username.slice(0, 1).toUpperCase() || "U"}
            </div>
            {/* 在线指示小标 */}
            <span
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-[#121524] shadow-xs"
              title="当前账号已成功联机鉴权"
            />
          </div>

          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                {user?.display_name || user?.username}
              </h2>

              {/* 用户名徽章 (支持一键复制) */}
              <button
                type="button"
                onClick={() => user?.username && void handleCopy(user.username, "用户名")}
                className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-mono text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-white/5 transition-colors cursor-pointer flex items-center gap-1"
                title="点击复制用户名"
              >
                <span>@{user?.username}</span>
                {copiedKey === "用户名" ? (
                  <Check size={11} className="text-emerald-500" />
                ) : (
                  <Copy size={11} className="opacity-60" />
                )}
              </button>

              {/* 身份特权徽章 */}
              <span
                className={cn(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1",
                  isSuperAdmin || isSysAdmin
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : isVip
                      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                      : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                )}
              >
                {isSuperAdmin || isSysAdmin ? (
                  <ShieldCheck size={11} />
                ) : isVip ? (
                  <Crown size={11} />
                ) : (
                  <User size={11} />
                )}
                <span>{roleName}</span>
              </span>

              {/* 用户分组 (如有) */}
              {wallet?.group && (
                <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/15 to-purple-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 font-mono uppercase tracking-wide flex items-center gap-1">
                  <Zap size={10} className="text-indigo-500" />
                  <span>分组: {wallet.group}</span>
                </span>
              )}
            </div>

            {/* 附加元信息行 */}
            <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-gray-400 flex-wrap">
              {user?.id && (
                <button
                  type="button"
                  onClick={() => void handleCopy(String(user.id), "用户 ID")}
                  className="hover:text-slate-700 dark:hover:text-gray-200 transition-colors cursor-pointer flex items-center gap-1 font-mono"
                  title="点击复制用户 ID"
                >
                  <span>用户 ID: #{user.id}</span>
                  {copiedKey === "用户 ID" ? (
                    <Check size={11} className="text-emerald-500" />
                  ) : (
                    <Copy size={11} className="opacity-50" />
                  )}
                </button>
              )}

              <span className="inline-block w-1 h-1 rounded-full bg-slate-300 dark:bg-white/20" />

              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>服务节点: Bob API 官方高速通道</span>
              </div>

              {networkStatus?.latency_ms !== undefined && (
                <>
                  <span className="inline-block w-1 h-1 rounded-full bg-slate-300 dark:bg-white/20" />
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                    延迟 {networkStatus.latency_ms}ms
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 右侧操作工具栏 (严格在同一水平线，不换行) */}
        <div className="flex items-center gap-2 sm:gap-2.5 relative z-10 flex-shrink-0 flex-nowrap self-start lg:self-center">
          {/* 刷新资产（状态形变链） */}
          <ButtonToLoaderToSuccess
            accent="blue"
            disabled={isRefreshing}
            className="px-3.5 py-1.5 min-w-[102px] h-8 rounded-xl text-xs font-medium whitespace-nowrap"
            idleLabel={
              <>
                <RefreshCw size={12} />
                <span>同步数据</span>
              </>
            }
            successLabel="数据已同步"
            resetAfterMs={2000}
            holdMs={700}
            onAction={async () => {
              await handleRefresh();
            }}
          />

          {/* 官网控制台 */}
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com/console")}
            className="h-8 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100/80 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            title="在浏览器中打开 Bob API 网页控制台"
          >
            <ExternalLink size={13} className="opacity-70" />
            <span>官方控制台</span>
          </button>

          {/* 退出登录 */}
          <button
            type="button"
            onClick={() => void logout()}
            className="h-8 px-3.5 py-1.5 rounded-xl border border-red-200/80 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            title="退出当前账号登录"
          >
            <LogOut size={13} />
            <span>退出登录</span>
          </button>
        </div>
      </div>

      {/* ── 核心内容主体：响应式双栏黄金布局 (左侧主力区自适应 + 右侧辅助区固定宽) ── */}
      <div className="flex flex-col xl:flex-row gap-6 items-start w-full">
        {/* ── 左侧主力区：资产总览大卡与快捷功能流转 ── */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* 1. Bob API 资产钱包全景看板 */}
          <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-indigo-50/90 via-blue-50/60 to-purple-50/70 dark:from-indigo-500/10 dark:via-blue-500/10 dark:to-purple-500/5 border border-indigo-200/80 dark:border-indigo-500/20 shadow-md space-y-5 relative overflow-hidden">
            {/* 顶栏标题与充值入口 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 flex-shrink-0">
                  <Wallet size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Bob API 资产钱包</span>
                    <span className="text-[10px] font-semibold font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                      LIVE
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    实时云端余额、已消耗资产与用量统计
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/console/topup")}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 active:scale-[0.98] text-white text-xs font-semibold shadow-md shadow-indigo-500/20 flex items-center gap-1.5 transition-all cursor-pointer self-start sm:self-auto flex-shrink-0"
              >
                <CreditCard size={14} />
                <span>前往官网充值额度</span>
                <ExternalLink size={12} className="opacity-80" />
              </button>
            </div>

            {/* 核心 3 大指标卡 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {/* 剩余可用额度 */}
              <div className="p-4 rounded-2xl bg-white/90 dark:bg-white/[0.04] border border-white/80 dark:border-white/10 shadow-xs space-y-1 relative group">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    剩余可用额度
                  </span>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-medium">
                    充沛
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400 tracking-tight pt-0.5 truncate">
                  ${quotaUsd.toFixed(4)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-gray-400 font-mono flex items-center justify-between">
                  <span>≈ ¥{quotaCny.toFixed(4)}</span>
                  <span className="text-[10px] text-slate-400 opacity-80">1¥ = $4.00</span>
                </div>
              </div>

              {/* 已消耗额度 */}
              <div className="p-4 rounded-2xl bg-white/90 dark:bg-white/[0.04] border border-white/80 dark:border-white/10 shadow-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    已消耗额度
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-500/10 px-1.5 py-0.5 rounded">
                    历史累计
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono text-slate-800 dark:text-gray-100 tracking-tight pt-0.5 truncate">
                  ${usedUsd.toFixed(4)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-gray-400 font-mono">
                  ≈ ¥{usedCny.toFixed(4)}
                </div>
              </div>

              {/* 累计请求数 */}
              <div className="p-4 rounded-2xl bg-white/90 dark:bg-white/[0.04] border border-white/80 dark:border-white/10 shadow-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    账号累计请求数
                  </span>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    调用总量
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 tracking-tight pt-0.5 truncate">
                  {requestCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-gray-400">
                  全生命周期总请求记录
                </div>
              </div>
            </div>

            {/* 额度利用比例与使用健康度进度条 */}
            <div className="p-4 rounded-2xl bg-white/70 dark:bg-white/[0.03] border border-white/60 dark:border-white/5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-gray-200">
                  <TrendingUp size={14} className="text-indigo-500" />
                  <span>额度使用健康度</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                  剩余可用 <span className="font-semibold text-indigo-600 dark:text-indigo-400">{remainRatio.toFixed(1)}%</span>
                  {" · "}
                  已使用 <span className="font-semibold text-slate-700 dark:text-gray-300">{usedRatio.toFixed(1)}%</span>
                </div>
              </div>

              {/* 双色渐变进度条 */}
              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden flex shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-500"
                  style={{ width: `${remainRatio}%` }}
                  title={`剩余可用: ${remainRatio.toFixed(1)}%`}
                />
                <div
                  className="h-full bg-slate-400/60 dark:bg-slate-600 transition-all duration-500"
                  style={{ width: `${usedRatio}%` }}
                  title={`已消耗: ${usedRatio.toFixed(1)}%`}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>总额度池: ${totalPoolUsd.toFixed(4)} USD</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ 额度充沛，支持高并发生产调用
                </span>
              </div>
            </div>

            {/* 额度换算比例与权益说明 */}
            <div className="p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.03] border border-white/40 dark:border-white/5 text-xs space-y-1.5 text-slate-600 dark:text-gray-300">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-gray-200">
                <Sparkles size={14} className="text-amber-500 flex-shrink-0" />
                <span>额度与兑换比例说明</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                Bob API 采用 1 元人民币 (¥1) = 4 美元额度 ($4.00) 充值结算机制 (500,000 点数 = $1)。所消耗额度根据不同模型 (如 Claude 3.7 / GPT-5 / DeepSeek) 的实际倍率按 Token 精确扣费，超高性价比。
              </p>
            </div>
          </div>

          {/* 2. 快捷功能流转矩阵 (4 宫格卡片，严格保证对称与内边距) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-3.5 rounded-full bg-blue-500" />
                <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider">
                  功能快捷入口 (Quick Access)
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">点击直达对应工作区</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-stretch">
              {/* 查看使用日志 */}
              <div
                onClick={() => onNavigate?.("logs")}
                className="p-4 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-xs hover:border-blue-500/50 hover:bg-blue-50/20 dark:hover:bg-blue-500/5 hover:shadow-md transition-all cursor-pointer group flex items-center justify-between gap-3 min-w-0 h-full min-h-[76px]"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-xs">
                    <Clock size={20} />
                  </div>
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      <span>使用日志与审计</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-snug line-clamp-2 group-hover:text-slate-600 dark:group-hover:text-gray-300 transition-colors">
                      查看每一次调用的耗时、Token 与消费金额明细
                    </p>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100/70 dark:bg-white/5 text-slate-400 group-hover:text-blue-500 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/15 group-hover:translate-x-0.5 transition-all flex-shrink-0">
                  <ArrowRight size={14} />
                </div>
              </div>

              {/* 工具与环境 */}
              <div
                onClick={() => onNavigate?.("tools")}
                className="p-4 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-xs hover:border-emerald-500/50 hover:bg-emerald-50/20 dark:hover:bg-emerald-500/5 hover:shadow-md transition-all cursor-pointer group flex items-center justify-between gap-3 min-w-0 h-full min-h-[76px]"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-xs">
                    <Wrench size={20} />
                  </div>
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      <span>工具与运行环境</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-snug line-clamp-2 group-hover:text-slate-600 dark:group-hover:text-gray-300 transition-colors">
                      管理 Claude Code、Codex、WorkBuddy 本地运行环境
                    </p>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100/70 dark:bg-white/5 text-slate-400 group-hover:text-emerald-500 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/15 group-hover:translate-x-0.5 transition-all flex-shrink-0">
                  <ArrowRight size={14} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 右侧辅助区：特权权益、官方生态与服务健康 (固定优雅宽度，防止压窄变形) ── */}
        <div className="w-full xl:w-[350px] 2xl:w-[380px] flex-shrink-0 space-y-6">
          {/* 1. 会员特权与分组权益卡 */}
          <div className="p-5 rounded-3xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-xs hover:shadow-sm transition-all space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Crown size={16} className="text-amber-500 flex-shrink-0" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  会员权益与分组
                </h3>
              </div>
              <span className="text-[10px] font-semibold font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase">
                {wallet?.group || "DEFAULT"}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2.5 p-2 rounded-xl -mx-2 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <h5 className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                    全球多节点官方极速通道
                  </h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                    智能就近调度，海外与境内双向极速传输。
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl -mx-2 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <h5 className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                    专属模型费率与折扣
                  </h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                    当前分组享受定制倍率优惠，计费透明公开。
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl -mx-2 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <h5 className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                    多端 AI 助手一键同步
                  </h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                    支持一键将密钥写入本地 Codex、Claude Code、Accio。
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl -mx-2 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <h5 className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                    高并发 SLA 稳定保障
                  </h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                    高优先级排队通道，避免高峰期拥堵。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 2. 官方控制台快捷入口 (Web Portals) */}
          <div className="p-5 rounded-3xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-xs hover:shadow-sm transition-all space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <ExternalLink size={15} className="text-blue-500 flex-shrink-0" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  官方 Web 控制台
                </h3>
              </div>
              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/console")}
                className="text-[10px] text-blue-500 hover:underline font-mono cursor-pointer"
              >
                bob-api.com
              </button>
            </div>

            <div className="space-y-1">
              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/console/topup")}
                className="w-full px-3 py-2.5 rounded-xl hover:bg-indigo-50/50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300 text-xs font-medium transition-colors cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                    <CreditCard size={13} />
                  </div>
                  <span className="truncate">在线充值中心</span>
                </div>
                <ChevronRight size={13} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2" />
              </button>

              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/usage-logs/common")}
                className="w-full px-3 py-2.5 rounded-xl hover:bg-emerald-50/50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300 text-xs font-medium transition-colors cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                    <Clock size={13} />
                  </div>
                  <span className="truncate">网页端使用明细日志</span>
                </div>
                <ChevronRight size={13} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2" />
              </button>

              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/console/profile")}
                className="w-full px-3 py-2.5 rounded-xl hover:bg-amber-50/50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300 text-xs font-medium transition-colors cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                    <Lock size={13} />
                  </div>
                  <span className="truncate">账号设置与密码修改</span>
                </div>
                <ChevronRight size={13} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2" />
              </button>

              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/docs")}
                className="w-full px-3 py-2.5 rounded-xl hover:bg-purple-50/50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300 text-xs font-medium transition-colors cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                    <BookOpen size={13} />
                  </div>
                  <span className="truncate">官方 API 接入文档</span>
                </div>
                <ChevronRight size={13} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2" />
              </button>
            </div>
          </div>

          {/* 3. 服务节点与网络健康卡 */}
          <div className="p-5 rounded-3xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-xs hover:shadow-sm transition-all space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-emerald-500 flex-shrink-0" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  服务节点诊断
                </h3>
              </div>
              <ButtonToLoaderToSuccess
                accent="blue"
                disabled={checkingNetwork}
                className="px-2.5 py-1 min-w-[70px] rounded-lg text-[11px] font-medium"
                idleLabel={
                  <>
                    <RefreshCw size={11} />
                    <span>测速</span>
                  </>
                }
                successLabel="检测完成"
                resetAfterMs={2500}
                holdMs={600}
                onAction={async () => {
                  setCheckingNetwork(true);
                  try {
                    const res = await checkBobApiNetwork();
                    setNetworkStatus(res);
                    if (!res.reachable) {
                      toast.error(res.error_message || "服务节点连接超时");
                      throw new Error(res.error_message || "网络不可达");
                    }
                  } catch (err) {
                    setNetworkStatus({ reachable: false, error_message: "连接超时" });
                    throw err;
                  } finally {
                    setCheckingNetwork(false);
                  }
                }}
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-400">服务网关</span>
                <span className="font-mono font-medium text-slate-700 dark:text-gray-300">
                  bob-api.com
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-400">通信协议</span>
                <span className="font-mono text-slate-700 dark:text-gray-300">
                  HTTPS / TLS 1.3
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-400">连通状态</span>
                <div className="flex items-center gap-1.5 font-medium">
                  {networkStatus?.reachable !== false ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                        连通正常 {networkStatus?.latency_ms ? `(${networkStatus.latency_ms}ms)` : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-red-500">连接异常</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-400">客户端环境</span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-gray-400">
                  AI Helper v{appVersion}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

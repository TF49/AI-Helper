import React from "react";
import {
  Wallet,
  RefreshCw,
  ExternalLink,
  Loader2,
  AlertCircle,
  Coins,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/useAuth";
import { openUrl } from "../lib/api";
import { cn } from "../lib/utils";

export interface AccountBalanceCardProps {
  className?: string;
}

export const AccountBalanceCard: React.FC<AccountBalanceCardProps> = ({
  className,
}) => {
  const {
    authState,
    wallet,
    isLoadingWallet,
    walletError,
    refreshWallet,
    setLoginModalOpen,
  } = useAuth();

  const handleManualRefresh = async () => {
    try {
      await refreshWallet();
      toast.success("账号额度已更新");
    } catch {
      toast.error("刷新账号额度失败");
    }
  };

  // 若未登录，展示极简引导登录卡片或提供便捷入口
  if (!authState.is_logged_in) {
    return (
      <div
        className={cn(
          "p-2.5 rounded-xl border text-xs transition-all",
          "bg-slate-50/70 border-slate-200/80 text-slate-600 dark:bg-white/5 dark:border-white/10 dark:text-gray-400",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className="flex items-center gap-1.5">
            <Wallet size={12} className="opacity-60" />
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">
              账号额度余额
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-slate-400 dark:text-gray-500">
            登录后查看余额
          </span>
          <button
            type="button"
            onClick={() => setLoginModalOpen(true)}
            className="text-[10px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "p-2.5 rounded-xl border text-xs transition-all",
        "bg-indigo-50/60 border-indigo-200/70 text-slate-800 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:text-slate-200",
        className,
      )}
    >
      {/* 头部：标题、用户分组与刷新/钱包外链按钮 */}
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Wallet size={12} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-900 dark:text-indigo-300 opacity-90 truncate">
            账号额度余额
          </span>
          {wallet?.group && (
            <span
              className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-200/60 text-indigo-800 dark:bg-indigo-400/20 dark:text-indigo-300 uppercase tracking-tight flex-shrink-0"
              title={`当前所属分组: ${wallet.group}`}
            >
              {wallet.group}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 刷新按钮 */}
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            disabled={isLoadingWallet}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 text-slate-500 dark:text-gray-400"
            title="刷新账号余额"
          >
            <RefreshCw
              size={11}
              className={isLoadingWallet ? "animate-spin text-indigo-600" : ""}
            />
          </button>

          {/* 充值 / 钱包直达外链 */}
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com/wallet")}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-white/10 transition-colors cursor-pointer shadow-2xs"
            title="前往 Bob API 钱包页面 (https://bob-api.com/wallet) 充值或查看明细"
          >
            <span>充值</span>
            <ExternalLink size={9} />
          </button>
        </div>
      </div>

      {/* 核心数值展示区域 */}
      {isLoadingWallet && !wallet ? (
        <div className="flex items-center gap-2 py-1">
          <Loader2 size={13} className="animate-spin text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
          <span className="text-[11px] text-slate-500 dark:text-gray-400">
            正在查询当前额度...
          </span>
        </div>
      ) : walletError && !wallet ? (
        <div className="flex items-center justify-between gap-1 py-0.5">
          <div className="flex items-center gap-1.5 min-w-0 text-amber-600 dark:text-amber-400">
            <AlertCircle size={12} className="flex-shrink-0" />
            <span className="text-[11px] truncate">{walletError}</span>
          </div>
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0 cursor-pointer"
          >
            重试
          </button>
        </div>
      ) : wallet ? (
        <div>
          {/* 主金额与折算人民币 (按照站点 1￥ = 4$ 比例计算) */}
          <div className="flex items-baseline justify-between gap-1.5 mt-0.5">
            <div className="flex items-baseline gap-1.5">
              {wallet.quota < 0 ? (
                <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                  无限额度 ♾️
                </span>
              ) : (
                <>
                  <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white tracking-tight">
                    ${wallet.quota_usd.toFixed(2)}
                  </span>
                  <span
                    className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold"
                    title="按照站点充值比例 1￥ = 4$ 折算"
                  >
                    ≈ ¥{wallet.quota_cny.toFixed(2)}
                  </span>
                </>
              )}
            </div>

            <div
              className="flex items-center gap-1 text-[10px] font-mono text-slate-400 dark:text-gray-400"
              title={`站点充值比例 1￥ = 4$ | 原始点数: ${wallet.quota < 0 ? "无限" : wallet.quota.toLocaleString() + " 点"}`}
            >
              <Coins size={10} className="text-amber-500" />
              <span>1￥=4$</span>
            </div>
          </div>

          {/* 辅助指标栏：已消耗与充值跳转 */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-gray-500 font-mono mt-1 pt-1 border-t border-indigo-200/50 dark:border-white/5">
            <span
              className="truncate mr-1"
              title={`已消耗 ${wallet.used_quota_usd.toFixed(2)} 美元额度 (按 1￥=4$ 折合约 ¥${wallet.used_quota_cny.toFixed(2)})`}
            >
              已耗 ${wallet.used_quota_usd.toFixed(2)} (约¥{wallet.used_quota_cny.toFixed(2)})
            </span>
            <button
              type="button"
              onClick={() => void openUrl("https://bob-api.com/wallet")}
              className="hover:text-indigo-600 dark:hover:text-indigo-300 text-indigo-600/80 dark:text-indigo-400/80 transition-colors flex items-center gap-0.5 cursor-pointer font-sans shrink-0"
              title="在浏览器中打开 Bob API 充值与钱包中心 (https://bob-api.com/wallet)"
            >
              <span>钱包中心</span>
              <ExternalLink size={9} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 py-1 text-slate-400 dark:text-gray-500 text-[11px]">
          <span>暂无额度数据</span>
        </div>
      )}
    </div>
  );
};

export default AccountBalanceCard;

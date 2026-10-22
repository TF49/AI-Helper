import React from "react";
import {
  Wallet,
  RefreshCw,
  Coins,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/useAuth";
import { openUrl } from "../lib/api";
import { cn } from "../lib/utils";
import { formatPlatformQuota, isPlatformQuota, QUOTA_CONVERSION_UNAVAILABLE } from "../lib/quotaDisplay";

export interface AccountBalanceCardProps {
  className?: string;
}

export const AccountBalanceCard: React.FC<AccountBalanceCardProps> = ({
  className,
}) => {
  const {
    authState,
    wallet,
    walletError,
    isLoadingWallet,
    refreshWallet,
    setLoginModalOpen,
  } = useAuth();

  const handleManualRefresh = async () => {
    try {
      if (!await refreshWallet()) throw new Error("余额尚未确认");
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
        "p-3 rounded-2xl border text-xs transition-all",
        "bg-white/80 dark:bg-white/5 border-slate-200/80 dark:border-white/10 shadow-2xs",
        className,
      )}
    >
      {/* 平台原始额度与复制/刷新 */}
      <div className="flex items-center justify-between text-slate-400 dark:text-gray-500 mb-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold tracking-wider">
            账户平台额度
          </span>
          <button
            type="button"
            onClick={async () => {
              if (!isPlatformQuota(wallet?.quota)) return;
              try {
                await navigator.clipboard.writeText(String(wallet.quota));
                toast.success("已复制原始平台额度");
              } catch { toast.error("复制失败"); }
            }}
            disabled={!isPlatformQuota(wallet?.quota)}
            className="p-0.5 hover:text-slate-700 dark:hover:text-gray-300 transition-colors cursor-pointer"
            title="复制原始平台额度"
          >
            <Coins size={11} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleManualRefresh()}
          disabled={isLoadingWallet}
          className="p-0.5 hover:text-slate-700 dark:hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
          title="刷新额度"
        >
          <RefreshCw size={10} className={isLoadingWallet ? "animate-spin text-blue-500" : ""} />
        </button>
      </div>

      {/* 核心数值与蓝色充值胶囊按钮 (对齐参考图排版) */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div>
          <div className="text-lg font-bold font-mono text-slate-900 dark:text-white tracking-tight leading-none">
            {formatPlatformQuota(wallet?.quota)}
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400 mt-1">
            平台额度 · {QUOTA_CONVERSION_UNAVAILABLE}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-gray-500 mt-1 leading-relaxed">
            💡 无权威转换契约时显示原始额度，避免推测币值误导
          </div>
          {walletError && <div className="text-[10px] text-amber-600 mt-1">余额未确认，请重试刷新</div>}
        </div>

        <button
          type="button"
          onClick={() => void openUrl("https://bob-api.com/wallet")}
          className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-xs cursor-pointer flex-shrink-0"
          title="前往 Bob API 钱包页面充值"
        >
          充值
        </button>
      </div>
    </div>
  );
};

export default AccountBalanceCard;

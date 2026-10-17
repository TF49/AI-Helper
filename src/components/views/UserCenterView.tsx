import { PersonalCenterPanel } from "../account/PersonalCenterPanel";
import type { MainNav } from "../../types";

export interface UserCenterViewProps {
  onNavigate?: (nav: MainNav) => void;
}

export function UserCenterView({ onNavigate }: UserCenterViewProps) {
  return (
    <div className="w-full flex-1 flex flex-col min-h-0 select-none">
      {/* 顶部面包屑 */}
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
          个人中心
        </span>
        <span className="text-slate-400 dark:text-gray-500 text-xs">/</span>
        <span className="text-xs text-slate-500 dark:text-gray-400">
          账号概览、钱包资产与安全管理
        </span>
      </div>

      <PersonalCenterPanel onNavigate={onNavigate} />
    </div>
  );
}

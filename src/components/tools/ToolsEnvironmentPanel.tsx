import React from "react";
import { Wrench, ShieldCheck, MessageSquare } from "lucide-react";
import { AppPathsPanel } from "../AppPathsPanel";
import { cn } from "../../lib/utils";

export interface ToolsEnvironmentPanelProps {
  onOpenInitModal: () => void;
  onOpenQuickTools: () => void;
  onOpenFeedback?: () => void;
  className?: string;
}

export const ToolsEnvironmentPanel: React.FC<ToolsEnvironmentPanelProps> = ({
  onOpenInitModal,
  onOpenQuickTools,
  onOpenFeedback,
  className,
}) => {
  return (
    <div className={cn("space-y-5 select-none", className)}>
      {/* 顶部标题与快速诊断卡片 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            工具与环境
          </h1>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            本地 AI Agent 运行环境检测、CLI 执行路径管理与诊断工具箱
          </p>
        </div>

        {/* 快速诊断小入口 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenInitModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer border border-blue-200/60 dark:border-blue-500/20 shadow-2xs"
          >
            <ShieldCheck size={13} />
            <span>环境初始化向导</span>
          </button>

          <button
            type="button"
            onClick={onOpenQuickTools}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors cursor-pointer border border-amber-200/60 dark:border-amber-500/20 shadow-2xs"
          >
            <Wrench size={13} />
            <span>快速诊断工具箱</span>
          </button>

          {onOpenFeedback && (
            <button
              type="button"
              onClick={onOpenFeedback}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors cursor-pointer border border-emerald-200/60 dark:border-emerald-500/20 shadow-2xs"
            >
              <MessageSquare size={13} />
              <span>问题反馈</span>
            </button>
          )}
        </div>
      </div>

      {/* 嵌入完整的 AppPathsPanel */}
      <div className="mt-2">
        <AppPathsPanel />
      </div>
    </div>
  );
};

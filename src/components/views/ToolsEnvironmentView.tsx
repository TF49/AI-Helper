import { ShieldCheck, Wrench } from "lucide-react";
import { AppPathsPanel } from "../AppPathsPanel";

interface ToolsEnvironmentViewProps {
  onOpenInitModal: () => void;
  onOpenToolsModal: () => void;
}

export function ToolsEnvironmentView({
  onOpenInitModal,
  onOpenToolsModal,
}: ToolsEnvironmentViewProps) {
  return (
    <div className="w-full flex-1 flex flex-col min-h-0 select-none">
      {/* 顶部面包屑与工具箱入口 */}
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
            工具与环境
          </span>
          <span className="text-slate-400 dark:text-gray-500 text-xs">/</span>
          <span className="text-xs text-slate-500 dark:text-gray-400">
            环境检测与应用管理
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenInitModal}
            className="h-8 px-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ShieldCheck size={13} />
            <span>环境初始化向导</span>
          </button>

          <button
            type="button"
            onClick={onOpenToolsModal}
            className="h-8 px-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Wrench size={13} />
            <span>快速诊断工具箱</span>
          </button>
        </div>
      </div>

      {/* 应用与 CLI 路径管理展台 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <AppPathsPanel />
      </div>
    </div>
  );
}

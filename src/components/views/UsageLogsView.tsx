import { UsageLogsPanel } from "../account/UsageLogsPanel";

export function UsageLogsView() {
  return (
    <div className="w-full flex-1 flex flex-col min-h-0 select-none pb-6">
      {/* 顶部面包屑导航 */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
          使用日志
        </span>
        <span className="text-slate-400 dark:text-gray-500 text-xs">/</span>
        <span className="text-xs text-slate-500 dark:text-gray-400">
          调用记录与消费明细审计
        </span>
      </div>

      <UsageLogsPanel />
    </div>
  );
}

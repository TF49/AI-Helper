import React from "react";
import {
  RefreshCw,
  Moon,
  Sun,
  Laptop,
} from "lucide-react";
import { useSettings } from "../../lib/useSettings";
import { useTheme } from "../theme-provider";
import { isTauri } from "../../lib/api";
import type { MainNav } from "../../types";
import { cn } from "../../lib/utils";
import { ButtonToLoaderToSuccess } from "../ui/ButtonToLoaderToSuccess";

export interface SettingsPanelProps {
  appVersion: string;
  onCheckUpdate: () => void | Promise<unknown>;
  isCheckingUpdate: boolean;
  className?: string;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  appVersion,
  onCheckUpdate,
  isCheckingUpdate,
  className,
}) => {
  const { settings, updateSetting, loadingAutoStart } = useSettings();
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn("space-y-6 select-none max-w-3xl", className)}>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
          应用设置
        </h1>
        <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
          配置 AI Helper 客户端运行偏好、启动模式与外观
        </p>
      </div>

      <div className="space-y-4">
        {/* 系统与运行偏好 */}
        <div className="p-4 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs space-y-4">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider text-slate-400">
            系统与启动偏好
          </h2>

          {/* 开机自启 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                开机自动启动
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                计算机登录时自动在后台启动 AI Helper 并守护 Bridge 网关
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoStart}
              disabled={loadingAutoStart || !isTauri}
              onChange={(e) => void updateSetting("autoStart", e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
            />
          </div>

          <div className="w-full h-[1px] bg-slate-100 dark:bg-white/5" />

          {/* 启动默认页面 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                启动默认着陆页
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                每次启动客户端时默认聚焦的导航标签页
              </div>
            </div>
            <select
              value={settings.startupPage}
              onChange={(e) => void updateSetting("startupPage", e.target.value as MainNav)}
              className="text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161a2e] py-1.5 px-3 text-slate-800 dark:text-gray-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="workspace" className="bg-white dark:bg-[#161a2e] text-slate-900 dark:text-gray-100">工作台 (AI Agent 配置)</option>
              <option value="logs" className="bg-white dark:bg-[#161a2e] text-slate-900 dark:text-gray-100">使用日志 (调用明细与额度消耗)</option>
              <option value="account" className="bg-white dark:bg-[#161a2e] text-slate-900 dark:text-gray-100">个人中心 (账号与钱包资产)</option>
              <option value="tools" className="bg-white dark:bg-[#161a2e] text-slate-900 dark:text-gray-100">工具与环境 (CLI 路径与检测)</option>
            </select>
          </div>

          <div className="w-full h-[1px] bg-slate-100 dark:bg-white/5" />

          {/* 背景极光动效 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                背景柔光动效 (Aurora Effect)
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                开启现代毛玻璃流光背景效果，关闭可进一步降低 GPU 负载
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.enableAurora}
              onChange={(e) => void updateSetting("enableAurora", e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </div>
        </div>

        {/* 外观与主题 */}
        <div className="p-4 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs space-y-4">
          <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider text-slate-400">
            界面外观主题
          </h2>

          <div className="grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={cn(
                "p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5",
                theme === "light"
                  ? "border-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold shadow-xs"
                  : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300",
              )}
            >
              <Sun size={18} className="text-amber-500" />
              <span className="text-xs">明亮浅色</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={cn(
                "p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5",
                theme === "dark"
                  ? "border-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold shadow-xs"
                  : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300",
              )}
            >
              <Moon size={18} className="text-blue-400" />
              <span className="text-xs">沉浸深色</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme("system")}
              className={cn(
                "p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5",
                theme === "system"
                  ? "border-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold shadow-xs"
                  : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300",
              )}
            >
              <Laptop size={18} className="text-slate-400" />
              <span className="text-xs">跟随系统</span>
            </button>
          </div>
        </div>

        {/* 版本与检查更新 */}
        <div className="p-4 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200/80 dark:border-white/10 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>AI Helper 桌面客户端</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-gray-300">
                  v{appVersion}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                基于 Tauri 2.0 原生架构驱动 · 高性能跨平台 AI Agent 连接管理器
              </p>
            </div>

            <ButtonToLoaderToSuccess
              accent="blue"
              disabled={isCheckingUpdate}
              className="px-3 py-1.5 min-w-[110px]"
              idleLabel={
                <>
                  <RefreshCw size={12} />
                  <span>检查新版本</span>
                </>
              }
              successLabel="已完成检查"
              resetAfterMs={2000}
              holdMs={800}
              onAction={async () => {
                await onCheckUpdate();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

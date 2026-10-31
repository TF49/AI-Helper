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
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../ui/card";
import { Switch } from "../ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";

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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs uppercase tracking-wider text-slate-400">
              系统与启动偏好
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
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
              <Switch
                checked={settings.autoStart}
                disabled={loadingAutoStart || !isTauri}
                onCheckedChange={(checked) => void updateSetting("autoStart", checked)}
              />
            </div>

            <div className="w-full h-px bg-slate-100 dark:bg-white/5" />

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
              <div className="w-56">
                <Select
                  value={settings.startupPage}
                  onValueChange={(val) => void updateSetting("startupPage", val as MainNav)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择着陆页" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace">工作台 (AI Agent 配置)</SelectItem>
                    <SelectItem value="logs">使用日志 (调用明细与额度消耗)</SelectItem>
                    <SelectItem value="account">个人中心 (账号与钱包资产)</SelectItem>
                    <SelectItem value="tools">工具与环境 (CLI 路径与检测)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="w-full h-px bg-slate-100 dark:bg-white/5" />

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
              <Switch
                checked={settings.enableAurora}
                onCheckedChange={(checked) => void updateSetting("enableAurora", checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* 外观与主题 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs uppercase tracking-wider text-slate-400">
              界面外观主题
            </CardTitle>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={cn(
                  "p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5",
                  theme === "light"
                    ? "border-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold shadow-2xs"
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
                    ? "border-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold shadow-2xs"
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
                    ? "border-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200 font-semibold shadow-2xs"
                    : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-gray-300",
                )}
              >
                <Laptop size={18} className="text-slate-400" />
                <span className="text-xs">跟随系统</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* 版本与检查更新 */}
        <Card>
          <CardContent className="p-4">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

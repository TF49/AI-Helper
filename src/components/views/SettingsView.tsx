import { useState } from "react";
import {
  Power,
  Minimize2,
  LayoutGrid,
  Bell,
  Globe,
  HelpCircle,
  Sun,
  Moon,
  Laptop,
  Sparkles,
  RefreshCw,
  MessageSquare,
  ExternalLink,
  Check,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "../../lib/useSettings";
import { useTheme } from "../theme-provider";
import { BrandLogo } from "../BrandIcons";
import { openUrl } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { MainNav } from "../../types";
import { ButtonToLoaderToSuccess } from "../ui/ButtonToLoaderToSuccess";

type SettingsTab = "general" | "appearance" | "about";

interface SettingsViewProps {
  appVersion: string;
  onOpenFeedback: () => void;
  onCheckUpdates: () => void | Promise<unknown>;
  isCheckingUpdates: boolean;
}

const LANGUAGES = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "英语" },
  { id: "fr-FR", label: "法语" },
  { id: "ru-RU", label: "俄语" },
  { id: "ja-JP", label: "日语" },
  { id: "vi-VN", label: "越南语" },
  { id: "zh-TW", label: "繁体中文" },
];

const STARTUP_PAGES: { id: MainNav; label: string }[] = [
  { id: "workspace", label: "工作台" },
  { id: "logs", label: "使用日志" },
  { id: "account", label: "个人中心" },
  { id: "tools", label: "工具与环境" },
];

export function SettingsView({
  appVersion,
  onOpenFeedback,
  onCheckUpdates,
  isCheckingUpdates,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { settings, loadingAutoStart, updateSetting } = useSettings();
  const { theme, setTheme } = useTheme();

  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [startupMenuOpen, setStartupMenuOpen] = useState(false);

  const currentLangLabel =
    LANGUAGES.find((l) => l.id === settings.language)?.label || "简体中文";
  const currentStartupLabel =
    STARTUP_PAGES.find((p) => p.id === settings.startupPage)?.label || "工作台";

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 select-none">
      {/* 外部点击关闭下拉遮罩 */}
      {(langMenuOpen || startupMenuOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setLangMenuOpen(false);
            setStartupMenuOpen(false);
          }}
        />
      )}

      {/* ── 顶部面包屑 ── */}
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
          设置
        </span>
        <span className="text-slate-400 dark:text-gray-500 text-xs">/</span>
        <span className="text-xs text-slate-500 dark:text-gray-400">
          外观与使用偏好 (开机自启 · 主题模式 · 启动页面 · 极光动效)
        </span>
      </div>

      {/* ── 居中内容容器 (解决大屏宽屏下严重靠左偏置、右侧空白失衡问题) ── */}
      <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col min-h-0">
        {/* 顶部标题与右上角选项卡 */}
        <div className="flex items-start justify-between pb-5 mb-5 border-b border-slate-200/60 dark:border-white/5 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              偏好设置
            </h1>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
              管理 AI 助手客户端的运行模式、外观主题与系统行为。
            </p>
          </div>

          {/* 右上角选项卡 */}
          <div className="flex items-center p-1 rounded-xl bg-slate-100/90 dark:bg-white/5 border border-slate-200/70 dark:border-white/10 shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setActiveTab("general");
                setLangMenuOpen(false);
                setStartupMenuOpen(false);
              }}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer",
                activeTab === "general"
                  ? "bg-white dark:bg-[#1a1f33] text-slate-900 dark:text-white shadow-xs border border-slate-200/60 dark:border-white/10"
                  : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
              )}
            >
              常规
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("appearance");
                setLangMenuOpen(false);
                setStartupMenuOpen(false);
              }}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer",
                activeTab === "appearance"
                  ? "bg-white dark:bg-[#1a1f33] text-slate-900 dark:text-white shadow-xs border border-slate-200/60 dark:border-white/10"
                  : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
              )}
            >
              外观
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("about");
                setLangMenuOpen(false);
                setStartupMenuOpen(false);
              }}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer",
                activeTab === "about"
                  ? "bg-white dark:bg-[#1a1f33] text-slate-900 dark:text-white shadow-xs border border-slate-200/60 dark:border-white/10"
                  : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
              )}
            >
              关于
            </button>
          </div>
        </div>

        {/* ── 标签页内容 ── */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4">
          {/* 1. 常规设置 (应用设置) */}
          {activeTab === "general" && (
            <div className="space-y-6 animate-in fade-in-50 duration-200 relative">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3 px-1">
                  应用设置
                </h2>

              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-[#121626]/70 backdrop-blur-md divide-y divide-slate-100 dark:divide-white/5 overflow-visible">
                {/* 1. 开机自动启动 */}
                <div className="flex items-center justify-between p-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start gap-3.5 min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Power size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                        <span>开机自动启动</span>
                        <div
                          className="text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help"
                          title="登录 Windows 系统后，AI 助手将自动在后台静默启动"
                        >
                          <HelpCircle size={13} />
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        登录系统后，AI助手会自动启动
                      </p>
                    </div>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={settings.autoStart}
                      disabled={loadingAutoStart}
                      onChange={(e) =>
                        void updateSetting("autoStart", e.target.checked)
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* 2. 关闭时最小化到托盘 */}
                <div className="flex items-center justify-between p-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start gap-3.5 min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Minimize2 size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                        <span>关闭时最小化到托盘</span>
                        <div
                          className="text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help"
                          title="点击窗口关闭按钮时隐藏至任务栏托盘保持后台运行，若关闭则彻底退出程序"
                        >
                          <HelpCircle size={13} />
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        关闭主窗口后，在托盘中继续运行。
                      </p>
                    </div>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={settings.minimizeToTray}
                      onChange={(e) =>
                        void updateSetting("minimizeToTray", e.target.checked)
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* 3. 启动页 */}
                <div className="flex items-center justify-between p-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors relative">
                  <div className="flex items-start gap-3.5 min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <LayoutGrid size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        启动页
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        下次启动时默认打开的页面。
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setStartupMenuOpen(!startupMenuOpen);
                        setLangMenuOpen(false);
                      }}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 flex items-center gap-2 cursor-pointer shadow-2xs"
                    >
                      <span>{currentStartupLabel}</span>
                      <ChevronDown size={13} className="text-slate-400" />
                    </button>

                    {startupMenuOpen && (
                      <div className="absolute right-0 top-full mt-1.5 w-36 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#181c30] shadow-xl py-1 z-50">
                        {STARTUP_PAGES.map((page) => (
                          <button
                            key={page.id}
                            type="button"
                            onClick={() => {
                              void updateSetting("startupPage", page.id);
                              setStartupMenuOpen(false);
                              toast.success(`已设置默认启动页为「${page.label}」`);
                            }}
                            className={cn(
                              "w-full px-3 py-1.5 text-xs text-left flex items-center justify-between hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer",
                              settings.startupPage === page.id
                                ? "text-blue-600 dark:text-blue-400 font-semibold"
                                : "text-slate-700 dark:text-gray-300",
                            )}
                          >
                            <span>{page.label}</span>
                            {settings.startupPage === page.id && (
                              <Check size={12} />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. 新公告弹窗框 */}
                <div className="flex items-center justify-between p-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start gap-3.5 min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bell size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        新公告弹窗框
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        关闭后，您仍可通过小铃铛查看公告历史。
                      </p>
                    </div>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={settings.showAnnouncementModal}
                      onChange={(e) =>
                        void updateSetting(
                          "showAnnouncementModal",
                          e.target.checked,
                        )
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* 5. 界面语言 (复刻图二下拉列表) */}
                <div className="flex items-center justify-between p-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors relative">
                  <div className="flex items-start gap-3.5 min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Globe size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        界面语言
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        切换后立即生效，下次启动时将保持您的选择。
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setLangMenuOpen(!langMenuOpen);
                        setStartupMenuOpen(false);
                      }}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 flex items-center gap-2 cursor-pointer shadow-2xs"
                    >
                      <span>{currentLangLabel}</span>
                      <ChevronDown size={13} className="text-slate-400" />
                    </button>

                    {langMenuOpen && (
                      <div className="absolute right-0 top-full mt-1.5 w-36 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#181c30] shadow-xl py-1 z-50">
                        {LANGUAGES.map((lang) => (
                          <button
                            key={lang.id}
                            type="button"
                            onClick={() => {
                              void updateSetting("language", lang.id);
                              setLangMenuOpen(false);
                              toast.success(`已切换语言为「${lang.label}」`);
                            }}
                            className={cn(
                              "w-full px-3 py-1.5 text-xs text-left flex items-center justify-between hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer",
                              settings.language === lang.id
                                ? "text-blue-600 dark:text-blue-400 font-semibold"
                                : "text-slate-700 dark:text-gray-300",
                            )}
                          >
                            <span>{lang.label}</span>
                            {settings.language === lang.id && (
                              <Check size={12} />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. 外观偏好 */}
        {activeTab === "appearance" && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3 px-1">
                主题模式
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={cn(
                    "p-4 rounded-2xl border text-center flex flex-col items-center gap-2 transition-all cursor-pointer",
                    theme === "light"
                      ? "border-blue-500 bg-blue-50/60 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20"
                      : "border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5 text-slate-700 dark:text-gray-300 hover:border-slate-300",
                  )}
                >
                  <Sun size={20} />
                  <span className="text-xs font-semibold">浅色模式</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "p-4 rounded-2xl border text-center flex flex-col items-center gap-2 transition-all cursor-pointer",
                    theme === "dark"
                      ? "border-blue-500 bg-blue-50/60 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20"
                      : "border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5 text-slate-700 dark:text-gray-300 hover:border-slate-300",
                  )}
                >
                  <Moon size={20} />
                  <span className="text-xs font-semibold">深色模式</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={cn(
                    "p-4 rounded-2xl border text-center flex flex-col items-center gap-2 transition-all cursor-pointer",
                    theme === "system"
                      ? "border-blue-500 bg-blue-50/60 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20"
                      : "border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5 text-slate-700 dark:text-gray-300 hover:border-slate-300",
                  )}
                >
                  <Laptop size={20} />
                  <span className="text-xs font-semibold">跟随系统</span>
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3 px-1">
                动效与渲染
              </h2>
              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-[#121626]/70 backdrop-blur-md p-4 flex items-center justify-between">
                <div className="flex items-start gap-3.5 min-w-0 pr-4">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Sparkles size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      动态极光流动背景
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                      开启后在主窗口渲染平滑的光晕色彩流转，关闭可最大化降低显卡能耗。
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.enableAurora}
                    onChange={(e) =>
                      void updateSetting("enableAurora", e.target.checked)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 3. 关于 */}
        {activeTab === "about" && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-[#121626]/70 backdrop-blur-md p-6 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center mb-3 shadow-sm">
                <BrandLogo size={36} />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                AI Helper
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-sm">
                面向开发者与极客的 AI Agent 配置管理桌面工具
              </p>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-gray-300 text-xs font-mono font-medium mt-3 border border-slate-200 dark:border-white/10">
                <span>版本</span>
                <span>v{appVersion}</span>
              </div>

              <div className="flex items-center gap-3 mt-6">
                <ButtonToLoaderToSuccess
                  accent="blue"
                  disabled={isCheckingUpdates}
                  className="px-4 py-2 min-w-[120px]"
                  idleLabel={
                    <>
                      <RefreshCw size={13} />
                      <span>检查更新</span>
                    </>
                  }
                  successLabel="已完成检查"
                  resetAfterMs={2000}
                  holdMs={800}
                  onAction={async () => {
                    await onCheckUpdates();
                  }}
                />

                <button
                  type="button"
                  onClick={onOpenFeedback}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors border border-slate-200/80 dark:border-white/10 cursor-pointer"
                >
                  <MessageSquare size={13} className="text-cyan-500" />
                  <span>意见反馈</span>
                </button>

                <button
                  type="button"
                  onClick={() => void openUrl("https://bob-api.com")}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors border border-slate-200/80 dark:border-white/10 cursor-pointer"
                >
                  <ExternalLink size={13} className="text-slate-400" />
                  <span>访问官网</span>
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

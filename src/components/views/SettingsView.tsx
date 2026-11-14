import { useState } from "react";
import {
  Power,
  Minimize2,
  LayoutGrid,
  Bell,
  Globe,
  HelpCircle,
  Sparkles,
  RefreshCw,
  MessageSquare,
  ExternalLink,
  Check,
  ChevronDown,
  AlertTriangle,
  Trash2,
  Loader2,
  Monitor,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "../../lib/useSettings";
import { useTheme } from "../theme-provider";
import { BrandLogo } from "../BrandIcons";
import { isTauri, openUrl, previewClientReset, resetAllClientConfigs } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { MainNav } from "../../types";
import type { ResetPreview, ResetResult } from "../../types";
import { ButtonToLoaderToSuccess } from "../ui/ButtonToLoaderToSuccess";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

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
  const { theme, resolvedTheme, setTheme } = useTheme();

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

        {activeTab === "general" && <ClientResetSection />}

        {/* 2. 外观偏好 */}
        {activeTab === "appearance" && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-3 px-1">
                主题模式
              </h2>
              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-[#121626]/70 backdrop-blur-md p-4 flex items-center justify-between">
                <div className="flex items-start gap-3.5 min-w-0 pr-4">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Monitor size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      跟随系统外观
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                      开启后自动匹配操作系统的浅色 / 深色模式；手动切换可使用右上角的主题开关。
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={theme === "system"}
                    onChange={(e) =>
                      setTheme(e.target.checked ? "system" : resolvedTheme)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
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

const CLIENT_RESET_ACTION_LABELS: Record<string, string> = {
  restore_snapshot: "恢复首次接管前的快照",
  clean_managed_fields: "只清理受管字段",
  remove_owned: "删除 AI Helper 专用配置",
  restore_cursor_patch: "还原 Cursor 补丁并删除专用配置",
  skip: "不处理",
};

const FILE_RESET_ACTION_LABELS: Record<string, string> = {
  restore_snapshot: "整文件恢复快照",
  clean_managed_fields: "只清理受管字段",
  delete: "删除",
  skip: "不处理",
};

function ClientResetSection() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 先读取只读预览再打开确认框；预览失败仍可确认，实际执行会重新判断，结果以返回值为准
  const openConfirm = async () => {
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await previewClientReset());
    } catch (error) {
      setPreviewError(String(error));
    } finally {
      setPreviewing(false);
      setOpen(true);
    }
  };

  const runReset = async () => {
    setRunning(true);
    try {
      const next = await resetAllClientConfigs();
      setResult(next);
      const storageKeys: Record<string, string> = {
        "Codex / ChatGPT": "chatgpt",
        "Claude Code": "claude",
        WorkBuddy: "workbuddy",
        "Accio Work": "acciowork",
        Cursor: "cursor",
      };
      if (isTauri) {
        for (const item of next.clients) {
          if (item.status !== "failed") {
            const key = storageKeys[item.client];
            if (key) localStorage.removeItem(`bound_token_${key}`);
          }
        }
      }
      setOpen(false);
      if (!isTauri) {
        toast.info("当前是浏览器预览，本机配置未被修改");
      } else if (next.clients.some((item) => item.status === "failed")) {
        toast.warning("部分客户端未能清除，请根据结果重试");
      } else {
        toast.success("客户端配置已恢复为原生状态");
      }
    } catch (error) {
      toast.error(`清除配置失败：${String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="space-y-3 animate-in fade-in-50 duration-200">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 px-1">
          客户端配置
        </h2>
        <div className="rounded-2xl border border-red-200/80 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.06] p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Trash2 size={16} />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                恢复所有客户端原生配置
              </div>
              <p className="text-[11px] text-slate-600 dark:text-gray-400 mt-0.5">
                清除 AI Helper 写入的地址、密钥、模型和本地 Bridge 设置。首次接管前的配置会优先恢复。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void openConfirm()}
            disabled={running || previewing}
            className="flex-shrink-0 px-3 py-2 rounded-xl border border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/15 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
          >
            {previewing && <Loader2 size={13} className="animate-spin" />}
            清除配置
          </button>
        </div>
        {result && (
          <div className="rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] p-3 space-y-1.5">
            {result.clients.map((item) => (
              <div
                key={item.client}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]"
              >
                <span className="text-slate-700 dark:text-gray-300">
                  {item.client}
                </span>
                <span
                  className={
                    item.status === "failed"
                      ? "text-red-600 dark:text-red-400"
                      : item.status === "skipped"
                        ? "text-slate-500 dark:text-gray-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {item.message}
                </span>
              </div>
            ))}
            {result.warnings.map((warning) => (
              <p
                key={warning}
                className="text-[11px] text-amber-600 dark:text-amber-400 pt-1"
              >
                {warning}
              </p>
            ))}
            {result.requires_restart && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">
                请重新启动相关客户端，使原生配置完全生效。
              </p>
            )}
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-red-500" size={18} />
              确认清除所有客户端配置？
            </DialogTitle>
            <DialogDescription>
              此操作会停止本地 Bridge、还原 Cursor 补丁，并移除 AI Helper 管理的客户端凭据。还原补丁时将强制关闭正在运行的 Cursor，请先保存各客户端中的未完成工作。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {previewError && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                无法读取清除预览：{previewError}。仍可继续，实际处理结果以执行后的返回为准。
              </div>
            )}
            {preview?.clients.map((plan) => (
              <div
                key={plan.client}
                className="rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] p-3 space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {plan.client}
                  </span>
                  <span
                    className={
                      plan.action === "skip"
                        ? "text-slate-500 dark:text-gray-400"
                        : plan.action === "clean_managed_fields"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400"
                    }
                  >
                    {CLIENT_RESET_ACTION_LABELS[plan.action] ?? plan.action}
                  </span>
                </div>
                {plan.reason && (
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">{plan.reason}</p>
                )}
                {plan.files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-start justify-between gap-3 text-[11px]"
                  >
                    <span className="font-mono break-all text-slate-600 dark:text-gray-300">
                      {file.path}
                    </span>
                    <span className="flex-shrink-0 text-slate-500 dark:text-gray-400">
                      {FILE_RESET_ACTION_LABELS[file.action] ?? file.action}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-xs text-red-700 dark:text-red-300">
            接管后被外部修改过的文件只清理 AI Helper 管理的字段，其他修改保留；没有首次接管快照的旧版本配置只能清理明确识别的 AI Helper 项，无法还原被覆盖的原值。确认后会按执行时的文件状态重新判断。
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={running}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void runReset()}
              disabled={running}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {running && <Loader2 size={13} className="animate-spin" />}
              确认清除
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

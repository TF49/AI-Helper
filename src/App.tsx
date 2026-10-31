import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  Minus,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  RefreshCw,
  ShieldCheck,
  User,
  Radio,
  MessageSquare,
  SlidersHorizontal,
  Bell,
  Clock,
  Users,
  Cast,
  HelpCircle,
  Sun,
  Moon,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { BrandLogo } from "./components/BrandIcons";
import { WorkspaceView } from "./components/views/WorkspaceView";
import { UsageLogsView } from "./components/views/UsageLogsView";
import { UserCenterView } from "./components/views/UserCenterView";
import { ToolsEnvironmentView } from "./components/views/ToolsEnvironmentView";
import { SettingsView } from "./components/views/SettingsView";
import { AnnouncementModal, LATEST_ANNOUNCEMENT_ID } from "./components/AnnouncementModal";
import { QuickToolsModal } from "./components/QuickToolsModal";
import { FeedbackModal } from "./components/FeedbackModal";
import {
  QqGroupModal,
  QQ_GROUP_DISMISSED_KEY,
} from "./components/QqGroupModal";
import { InitializationModal } from "./components/InitializationModal";
import { LoginModal } from "./components/auth/LoginModal";
import { TokenSelectModal } from "./components/auth/TokenSelectModal";
import { AccountBalanceCard } from "./components/AccountBalanceCard";
import { AuthProvider, useAuth } from "./lib/useAuth";
import { TooltipProvider } from "./components/ui/tooltip";
import { useTheme } from "./components/theme-provider";
import { AuroraBackground } from "./components/react-bits/AuroraBackground";
import { cn } from "./lib/utils";
import { checkBobApiNetwork, openUrl, isTauri, exitApp } from "./lib/api";
import { isMac } from "./lib/platform";
import { ForceUpdateModal, useAppUpdater } from "./components/ForceUpdateModal";
import { useSettings } from "./lib/useSettings";
import type { MainNav, AgentTool, UserInfo } from "./types";

type NetworkState = "checking" | "reachable" | "unreachable";

const mockWindow = {
  isMaximized: async () => false,
  toggleMaximize: async () => {},
  minimize: async () => {},
  close: async () => {},
  hide: async () => {},
  onResized: async (_cb: () => void) => () => {},
  show: async () => {},
  setFocus: async () => {},
};

const appWindow = isTauri ? getCurrentWindow() : mockWindow;

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={200}>
        <AppContent />
      </TooltipProvider>
    </AuthProvider>
  );
}

function AppContent() {
  const { settings } = useSettings();

  const [mainNav, setMainNav] = useState<MainNav>(() => {
    const startup = settings.startupPage;
    if (startup === ("models" as unknown) || startup === ("keys" as unknown)) {
      return "workspace";
    }
    return startup || "workspace";
  });

  const [activeTool, setActiveTool] = useState<AgentTool>(() => {
    const saved = localStorage.getItem("ai_helper_active_agent_tool");
    return (saved as AgentTool) || "chatgpt";
  });

  const [networkState, setNetworkState] = useState<NetworkState>("checking");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [initModalOpen, setInitModalOpen] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [qqGroupModalOpen, setQqGroupModalOpen] = useState(false);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [hasUnreadAnnouncement, setHasUnreadAnnouncement] = useState<boolean>(() => {
    return localStorage.getItem("ai_helper_read_announcement_id") !== LATEST_ANNOUNCEMENT_ID;
  });

  const handleOpenAnnouncement = () => {
    setAnnouncementModalOpen(true);
    localStorage.setItem("ai_helper_read_announcement_id", LATEST_ANNOUNCEMENT_ID);
    setHasUnreadAnnouncement(false);
  };

  const handleCloseAnnouncement = () => {
    setAnnouncementModalOpen(false);
    localStorage.setItem("ai_helper_read_announcement_id", LATEST_ANNOUNCEMENT_ID);
    setHasUnreadAnnouncement(false);
  };

  const handleOpenQqGroup = () => {
    setQqGroupModalOpen(true);
  };

  const handleCloseQqGroup = () => {
    setQqGroupModalOpen(false);
    localStorage.setItem(QQ_GROUP_DISMISSED_KEY, "true");
  };
  const [appVersion, setAppVersion] = useState("...");
  const { resolvedTheme, toggleTheme } = useTheme();
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const win = appWindow;

  const {
    authState,
    isAuthReady,
    wallet,
    refreshWallet,
    refreshState,
    loginModalOpen,
    setLoginModalOpen,
    tokenModalOpen,
    setTokenModalOpen,
    onLoginSuccess,
  } = useAuth();

  const [isInitialized, setIsInitialized] = useState<boolean>(() => {
    return Boolean(
      localStorage.getItem("ai_helper_init_completed") ||
        localStorage.getItem("bobapi_init_completed"),
    );
  });

  const handleSelectNav = (nav: MainNav) => {
    setMainNav(nav);
  };

  const handleSelectTool = (tool: AgentTool) => {
    setActiveTool(tool);
    localStorage.setItem("ai_helper_active_agent_tool", tool);
  };



  const {
    phase: updatePhase,
    backendInfo: updateBackendInfo,
    currentSource: updateCurrentSource,
    downloadProgress: updateDownloadProgress,
    progressBytes: updateProgressBytes,
    totalBytes: updateTotalBytes,
    errorMessage: updateErrorMessage,
    isManualChecking,
    isBootCheckComplete,
    checkForUpdates,
    handleRetry: handleUpdateRetry,
    handleRestart: handleUpdateRestart,
    handleClose: handleUpdateClose,
    handleExit: handleUpdateExit,
  } = useAppUpdater();

  const checkNetwork = async () => {
    setNetworkState("checking");
    try {
      const { reachable } = await checkBobApiNetwork();
      setNetworkState(reachable ? "reachable" : "unreachable");
      if (reachable && authState.is_logged_in && !wallet) {
        void refreshWallet();
      }
    } catch {
      setNetworkState("unreachable");
    }
  };

  useEffect(() => {
    void checkNetwork();
    if (isTauri) {
      void win.show();
      void win.setFocus();
    }
  }, []);

  // 全局拦截外部链接点击，在系统默认浏览器中打开
  useEffect(() => {
    const handleAnchorClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;

      const anchor = (event.target as HTMLElement)?.closest("a");
      if (!anchor || !anchor.href) return;

      const href = anchor.href;
      if (!href.startsWith("http://") && !href.startsWith("https://")) return;

      const isExternal =
        anchor.target === "_blank" || anchor.origin !== window.location.origin;

      if (isExternal) {
        event.preventDefault();
        void openUrl(href);
      }
    };

    document.addEventListener("click", handleAnchorClick);
    return () => {
      document.removeEventListener("click", handleAnchorClick);
    };
  }, []);

  // 读取真实版本号
  useEffect(() => {
    if (isTauri) {
      void getVersion()
        .then((v) => setAppVersion(v))
        .catch(() => setAppVersion("1.0.72"));
    } else {
      setAppVersion("1.0.72 (Web Preview)");
    }
  }, []);

  // ── 严格按序执行启动流水线：1. 检查更新 ➔ 2. 强制登录 ➔ 3. 环境初始化 ➔ 4. 就绪 ──
  useEffect(() => {
    if (!isBootCheckComplete) return;
    if (
      updatePhase === "downloading" ||
      updatePhase === "installing" ||
      updatePhase === "ready"
    ) {
      setLoginModalOpen(false);
      setInitModalOpen(false);
      setTokenModalOpen(false);
      setQqGroupModalOpen(false);
      return;
    }

    if (!isAuthReady) return;

    // 阶段 2：环境初始化向导 (已登录且未完成初始化时引导)
    if (authState.is_logged_in && !isInitialized) {
      setInitModalOpen(true);
      return;
    }
  }, [
    isBootCheckComplete,
    updatePhase,
    isAuthReady,
    authState.is_logged_in,
    isInitialized,
    setLoginModalOpen,
    setTokenModalOpen,
  ]);

  // 兜底保护：确保启动检测过渡遮罩最多停留 2.5 秒，超时后无论任何网络情况均放行
  useEffect(() => {
    if (isBootCheckComplete) return;
    const safety = setTimeout(() => {
      handleUpdateClose();
    }, 2500);
    return () => clearTimeout(safety);
  }, [isBootCheckComplete, handleUpdateClose]);

  const handleLoginSuccess = (user: UserInfo) => {
    onLoginSuccess(user);
  };

  const handleInitFinish = () => {
    localStorage.setItem("ai_helper_init_completed", "true");
    sessionStorage.setItem("ai_helper_init_completed", "true");
    setIsInitialized(true);
    setInitModalOpen(false);
  };

  const handleInitClose = () => {
    localStorage.setItem("ai_helper_init_completed", "true");
    setIsInitialized(true);
    setInitModalOpen(false);
  };

  // 初始化完成后自动提示售后 QQ 群；用户关闭后写入 localStorage，不再自动弹出
  useEffect(() => {
    if (!isBootCheckComplete || !isAuthReady) return;
    if (
      updatePhase === "downloading" ||
      updatePhase === "installing" ||
      updatePhase === "ready"
    ) {
      return;
    }
    if (initModalOpen || !isInitialized) return;
    if (localStorage.getItem(QQ_GROUP_DISMISSED_KEY) === "true") return;

    const timer = window.setTimeout(() => {
      setQqGroupModalOpen(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    isBootCheckComplete,
    isAuthReady,
    updatePhase,
    initModalOpen,
    isInitialized,
  ]);

  const isDark = resolvedTheme === "dark";

  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  // 监听并同步窗口最大化/还原状态
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const updateMaximized = async () => {
      try {
        const isMax = await win.isMaximized();
        setIsWindowMaximized(isMax);
      } catch (err) {
        console.error("Failed to check window maximized state:", err);
      }
    };
    void updateMaximized();

    const setupListener = async () => {
      try {
        unlisten = await win.onResized(() => {
          void updateMaximized();
        });
      } catch (err) {
        console.error("Failed to listen to window resize:", err);
      }
    };
    void setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [win]);

  const handleToggleMaximize = async () => {
    try {
      await win.toggleMaximize();
      const isMax = await win.isMaximized();
      setIsWindowMaximized(isMax);
    } catch (err) {
      console.error("Failed to toggle maximize:", err);
    }
  };

  return (
    <AuroraBackground
      theme={
        !settings.enableAurora
          ? "chatgpt"
          : mainNav === "workspace"
            ? activeTool
            : "chatgpt"
      }
      className="text-slate-800 dark:text-gray-200 transition-colors duration-200 h-screen w-screen overflow-hidden flex flex-col"
    >
      {/* ── 顶部透明沉浸式拖动栏 (Windows 标准窗口控制 + 右上角帮助/日夜切换) ── */}
      <div className="w-full h-10 px-3.5 flex items-center justify-between flex-shrink-0 z-50 select-none cursor-default">
        {/* 左侧：Windows 应用程序品牌标识 (macOS 原生使用左上角红绿灯) */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {!isMac() ? (
            <div className="flex items-center gap-2 select-none">
              <BrandLogo size={18} className="w-[18px] h-[18px]" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold tracking-wide text-slate-800 dark:text-white">
                  AI Helper
                </span>
                <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-gray-400 border border-slate-200/60 dark:border-white/10">
                  v{appVersion}
                </span>
              </div>
            </div>
          ) : (
            <div className="pl-20" />
          )}
        </div>

        {/* 中间自由拖拽区域 (双击切换窗口最大化/向下还原) */}
        <div
          className="flex-1 h-full cursor-default"
          data-tauri-drag-region
          onDoubleClick={() => void handleToggleMaximize()}
        />

        {/* 右侧：帮助支持 Popover + 日夜主题切换 + Windows 窗口控制按钮 */}
        <div className="flex items-center gap-1.5 pr-1 pointer-events-auto">
          {/* 帮助中心快捷菜单 (含公告、售后群、反馈、更新、后台运行) */}
          <Popover.Root open={helpMenuOpen} onOpenChange={setHelpMenuOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer relative"
                title="帮助与常用支持"
              >
                <HelpCircle size={15} />
                {hasUnreadAnnouncement && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-black" />
                )}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={8}
                className="z-[110] w-52 p-2 rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/10 shadow-xl select-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider border-b border-slate-100 dark:border-white/5 mb-1 flex items-center justify-between">
                  <span>帮助与服务</span>
                  <span className="font-mono text-[9px]">v{appVersion}</span>
                </div>
                <div className="space-y-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      handleOpenAnnouncement();
                      setHelpMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                  >
                    <Bell size={14} className="text-amber-500" />
                    <span>公告历史与版本日志</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleOpenQqGroup();
                      setHelpMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                  >
                    <Users size={14} className="text-sky-500" />
                    <span>官方售后 QQ 群</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFeedbackModalOpen(true);
                      setHelpMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                  >
                    <MessageSquare size={14} className="text-emerald-500" />
                    <span>意见反馈与工单</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void checkForUpdates(true);
                      setHelpMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                  >
                    <RefreshCw size={14} className="text-purple-500" />
                    <span>检查软件版本更新</span>
                  </button>
                  <div className="h-[1px] bg-slate-100 dark:bg-white/5 my-1" />
                  <button
                    type="button"
                    onClick={async () => {
                      setHelpMenuOpen(false);
                      if (isTauri) {
                        try {
                          await win.hide();
                        } catch {
                          await win.close();
                        }
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                  >
                    <Radio size={14} className="text-indigo-500 animate-pulse" />
                    <span>转入后台托盘运行</span>
                  </button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* 日夜主题切换微控件 (复刻图一：黑圆日标 + 弯月) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title={`切换为${isDark ? "浅色" : "深色"}主题`}
          >
            <div
              className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center transition-all shadow-2xs",
                !isDark ? "bg-black text-white" : "bg-transparent text-slate-400"
              )}
            >
              <Sun size={11} className="text-current" />
            </div>
            <div
              className={cn(
                "w-4 h-4 flex items-center justify-center transition-all",
                isDark ? "text-white" : "text-slate-800"
              )}
            >
              <Moon size={12} className="text-current" />
            </div>
          </button>

          {/* Windows / Linux 专属窗口控制三联键 (最小化、最大化/向下还原、关闭) */}
          {!isMac() && (
            <div className="flex items-center gap-0.5 ml-1 pl-1.5 border-l border-slate-200/80 dark:border-white/10">
              <button
                type="button"
                onClick={() => win.minimize()}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-white transition-colors cursor-pointer"
                title="最小化"
              >
                <Minus size={13} />
              </button>
              <button
                type="button"
                onClick={() => void handleToggleMaximize()}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-white transition-colors cursor-pointer"
                title={isWindowMaximized ? "向下还原" : "最大化"}
              >
                {isWindowMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (isTauri) {
                      if (!settings.minimizeToTray) {
                        await exitApp();
                        return;
                      }
                      toast.info("已最小化至后台托盘，Bridge 网关持续为您守护", {
                        duration: 3500,
                      });
                      try {
                        await win.hide();
                      } catch (hideErr) {
                        console.warn("win.hide() failed, fallback to win.close():", hideErr);
                        await win.close();
                      }
                    } else {
                      await win.close();
                    }
                  } catch (err) {
                    console.error("Failed to close/hide window:", err);
                  }
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500 hover:text-white text-slate-500 dark:text-gray-400 dark:hover:text-white transition-colors cursor-pointer"
                title={
                  settings.minimizeToTray
                    ? "关闭窗口 (转入系统托盘保持后台常驻守护)"
                    : "关闭并彻底退出 AI Helper"
                }
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 桌面主工作区双栏布局 (左侧超窄微图标侧边栏 + 右侧主内容展台) ── */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative z-10">
        {/* ── 左侧窄图标导航 (100% 对齐图一：宽度 ~82px，仅保留“接入”与“设备管理”及底部头像) ── */}
        <aside className="w-[82px] flex-shrink-0 flex flex-col justify-between items-center py-2 px-2.5 select-none z-20">
          {/* 上半部分：接入与设备管理导航键 */}
          <div className="w-full flex flex-col items-center space-y-4 pt-1">
            {/* 1. 接入按钮 (主工作台 Agent 矩阵) */}
            <button
              type="button"
              onClick={() => handleSelectNav("workspace")}
              className={cn(
                "w-[58px] h-[58px] rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer select-none",
                mainNav === "workspace"
                  ? "bg-white text-slate-900 shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:bg-white/15 dark:text-white"
                  : "text-slate-400 hover:text-slate-700 hover:bg-white/40 dark:text-gray-400 dark:hover:text-white"
              )}
              title="接入 (一键配置与 Agent 矩阵)"
            >
              <div className="flex items-center justify-center">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4" y="3" width="16" height="18" rx="4" />
                  <path d="M13 7l-3 5h4l-2 5" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <span className="text-[11px] font-bold leading-none">接入</span>
            </button>

            {/* 2. 设备管理按钮 */}
            <button
              type="button"
              onClick={() => handleSelectNav("tools")}
              className={cn(
                "w-[58px] h-[58px] rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer select-none",
                mainNav === "tools"
                  ? "bg-white text-slate-900 shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:bg-white/15 dark:text-white"
                  : "text-slate-400 hover:text-slate-700 hover:bg-white/40 dark:text-gray-400 dark:hover:text-white"
              )}
              title="设备管理 (环境检测与应用管理)"
            >
              <div className="flex items-center justify-center">
                <Cast size={19} />
              </div>
              <span className="text-[11px] font-medium leading-none">设备管理</span>
            </button>
          </div>

          {/* 下半部分：用户头像 GX + 名字 (完全复刻图一，点击展开个人资产与功能抽屉) */}
          <div className="w-full flex justify-center pb-2">
            <Popover.Root open={userMenuOpen} onOpenChange={setUserMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center justify-center gap-1.5 p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer select-none w-full"
                  title={`${authState.user?.display_name || authState.user?.username || "用户中心与资产"} - 点击查看`}
                >
                  <div className="w-6 h-6 rounded-full bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-bold text-[9px] flex-shrink-0 shadow-xs">
                    {authState.user?.username && !/^\d/.test(authState.user.username) ? (
                      authState.user.username.slice(0, 2).toUpperCase()
                    ) : (
                      <User size={12} className="text-current" />
                    )}
                  </div>
                  <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate max-w-[46px]">
                    {authState.user?.display_name ||
                      (authState.user?.username
                        ? /^\d{11}$/.test(authState.user.username)
                          ? authState.user.username.slice(0, 3) + "..."
                          : authState.user.username
                        : "未登录")}
                  </span>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="right"
                  align="end"
                  sideOffset={12}
                  className="z-[110] w-64 p-3 rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/10 shadow-2xl select-none animate-in fade-in-0 zoom-in-95"
                >
                  {/* 用户信息卡片 */}
                  <div className="flex items-center gap-3 pb-2.5 mb-2.5 border-b border-slate-100 dark:border-white/5">
                    <div className="w-10 h-10 rounded-full bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0">
                      {authState.user?.username && !/^\d/.test(authState.user.username) ? (
                        authState.user.username.slice(0, 2).toUpperCase()
                      ) : (
                        <User size={18} className="text-current" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {authState.user?.display_name || authState.user?.username || "高相健"}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate mt-0.5">
                        {authState.is_logged_in ? "bob-api.com 授权账号" : "未登录 (本地模式)"}
                      </div>
                    </div>
                  </div>

                  {/* 账户额度卡片 */}
                  <div className="mb-2.5">
                    <AccountBalanceCard />
                  </div>

                  {/* 网络连通性 */}
                  <div className="mb-2.5 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {networkState === "reachable" ? (
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                      )}
                      <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                        {networkState === "reachable" ? "官方网络正常" : "网络异常"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void checkNetwork()}
                      disabled={networkState === "checking"}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                      title="重新检测"
                    >
                      <RefreshCw size={11} className={networkState === "checking" ? "animate-spin" : ""} />
                    </button>
                  </div>

                  {/* 功能入口列表 */}
                  <div className="space-y-0.5 text-xs font-medium border-t border-slate-100 dark:border-white/5 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectNav("account");
                        setUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                    >
                      <User size={14} className="text-slate-500" />
                      <span>个人中心与钱包</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleSelectNav("logs");
                        setUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                    >
                      <Clock size={14} className="text-slate-500" />
                      <span>使用日志与统计</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleSelectNav("settings");
                        setUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-left"
                    >
                      <SlidersHorizontal size={14} className="text-slate-500" />
                      <span>系统设置与偏好</span>
                    </button>

                    {!authState.is_logged_in && (
                      <button
                        type="button"
                        onClick={() => {
                          setLoginModalOpen(true);
                          setUserMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 cursor-pointer text-left font-semibold border-t border-slate-100 dark:border-white/5 mt-1 pt-2"
                      >
                        <User size={14} />
                        <span>登录 bob-api.com 账号</span>
                      </button>
                    )}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </aside>

        {/* ── 右侧主展台内容区 (根据当前主导航动态渲染) ── */}
        <main className="flex-1 min-w-0 h-full overflow-hidden px-5 py-3 lg:px-7 lg:py-4 flex flex-col">
          <div className="w-full h-full flex flex-col">
            <AnimatePresence mode="wait">
              {mainNav === "workspace" ? (
                <motion.div
                  key="workspace"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full flex-1 flex flex-col min-h-0 h-full"
                >
                  <WorkspaceView
                    activeTool={activeTool}
                    onSelectTool={handleSelectTool}
                    onOpenEnvironmentCheck={() => setInitModalOpen(true)}
                  />
                </motion.div>
              ) : mainNav === "logs" ? (
                <motion.div
                  key="logs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto"
                >
                  <UsageLogsView />
                </motion.div>
              ) : mainNav === "account" ? (
                <motion.div
                  key="account"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto"
                >
                  <UserCenterView
                    onNavigate={(targetNav) => handleSelectNav(targetNav)}
                  />
                </motion.div>
              ) : mainNav === "tools" ? (
                <motion.div
                  key="tools"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto"
                >
                  <ToolsEnvironmentView
                    onOpenInitModal={() => setInitModalOpen(true)}
                    onOpenToolsModal={() => setToolsOpen(true)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto"
                >
                  <SettingsView
                    appVersion={appVersion}
                    onOpenFeedback={() => setFeedbackModalOpen(true)}
                    onCheckUpdates={() => void checkForUpdates(true)}
                    isCheckingUpdates={isManualChecking}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ── 模态框与工具箱 ── */}
      <QuickToolsModal
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        activeTab={activeTool}
        currentUrl="https://bob-api.com/"
        currentKey=""
        currentModel={
          activeTool === "claude"
            ? "claude-sonnet-5-5"
            : activeTool === "workbuddy"
              ? "gpt-5.6-sol"
              : activeTool === "acciowork"
                ? "claude-3-7-sonnet"
                : "gpt-4o"
        }
      />

      <FeedbackModal
        open={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
        appVersion={appVersion}
        activeTab={activeTool}
        networkState={networkState}
        currentUser={authState.user}
        onRefreshAuth={refreshState}
      />

      <QqGroupModal open={qqGroupModalOpen} onClose={handleCloseQqGroup} />

      <AnnouncementModal
        open={announcementModalOpen}
        onClose={handleCloseAnnouncement}
        appVersion={appVersion}
      />

      <ForceUpdateModal
        phase={updatePhase}
        backendInfo={updateBackendInfo}
        currentSource={updateCurrentSource}
        downloadProgress={updateDownloadProgress}
        progressBytes={updateProgressBytes}
        totalBytes={updateTotalBytes}
        errorMessage={updateErrorMessage}
        onRetry={handleUpdateRetry}
        onRestart={handleUpdateRestart}
        onClose={handleUpdateClose}
        onExit={handleUpdateExit}
      />

      <InitializationModal
        open={initModalOpen}
        onClose={handleInitClose}
        onFinish={handleInitFinish}
      />

      {/* ── bob-api.com 登录弹窗 (非强制模式，允许自由关闭) ── */}
      <LoginModal
        open={loginModalOpen}
        mandatory={false}
        onSuccess={handleLoginSuccess}
        onClose={() => setLoginModalOpen(false)}
      />

      {/* ── API Key 资产与关联弹窗 ── */}
      <TokenSelectModal
        open={tokenModalOpen}
        toolId={activeTool}
        onSelectKey={(_plainKey, token) => {
          const tid = activeTool;
          const targetGroup = token.group?.trim() || "default";
          try {
            localStorage.setItem(
              `bound_token_${tid}`,
              JSON.stringify({ id: token.id, name: token.name, group: targetGroup }),
            );
          } catch {}
          window.dispatchEvent(
            new CustomEvent("ai_helper_sync_all_tokens", {
              detail: { id: token.id, name: token.name, group: targetGroup, toolIds: [tid] },
            }),
          );
          toast.success(
            `已为当前工具「${
              activeTool === "claude"
                ? "Claude Code"
                : activeTool === "workbuddy"
                  ? "WorkBuddy"
                  : activeTool === "acciowork"
                    ? "Accio Work"
                    : "ChatGPT (Codex)"
            }」成功关联 API Key：${token.name}`,
          );
        }}
        onClose={() => setTokenModalOpen(false)}
        toolName={
          activeTool === "claude"
            ? "Claude Code"
            : activeTool === "workbuddy"
              ? "WorkBuddy"
              : activeTool === "acciowork"
                ? "Accio Work"
                : "ChatGPT (Codex)"
        }
        accentColor={
          activeTool === "claude"
            ? "purple"
            : activeTool === "workbuddy"
              ? "emerald"
              : activeTool === "acciowork"
                ? "orange"
                : "blue"
        }
      />

      {/* ── 阶段 1：启动检查更新阶段过渡层 ── */}
      {!isBootCheckComplete && updatePhase === "idle" && (
        <div className="fixed inset-0 top-11 z-50 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-md select-none p-4">
          <div className="max-w-sm w-full p-6 rounded-2xl bg-white dark:bg-black border border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center shadow-sm mb-3.5">
              <RefreshCw className="w-5 h-5 text-black dark:text-white animate-spin" />
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white tracking-wide">
              正在检查版本与环境...
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 leading-relaxed">
              优先确认最新版本与运行依赖，请稍候
            </p>
            <div className="flex items-center gap-2 mt-5 w-full">
              <button
                type="button"
                onClick={() => {
                  handleUpdateClose();
                  setInitModalOpen(true);
                }}
                className="flex-1 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-black hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck size={14} />
                <span>配置引导向导</span>
              </button>
              <button
                type="button"
                onClick={handleUpdateClose}
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-colors cursor-pointer"
              >
                直接进入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 阶段 2：启动凭据初次校验恢复微过渡 ── */}
      {isBootCheckComplete && updatePhase === "idle" && !isAuthReady && (
        <div className="fixed inset-0 top-11 z-50 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-md select-none">
          <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-700 flex items-center justify-center shadow-lg mb-3">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
          <p className="text-xs text-slate-300 font-medium tracking-wide">
            正在校验用户登录状态...
          </p>
        </div>
      )}

      {/* ── 全局 Toast 通知 ── */}
      <Toaster
        position="top-center"
        toastOptions={{
          style: isDark
            ? {
                background: "rgba(18, 21, 34, 0.95)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                backdropFilter: "blur(16px)",
                color: "#f1f5f9",
                fontSize: "12px",
                borderRadius: "12px",
                boxShadow: "0 10px 35px -5px rgba(0,0,0,0.5)",
              }
            : {
                background: "rgba(255, 255, 255, 0.95)",
                border: "1px solid rgba(226, 232, 240, 0.9)",
                backdropFilter: "blur(16px)",
                color: "#0f172a",
                fontSize: "12px",
                borderRadius: "12px",
                boxShadow: "0 10px 35px -5px rgba(0,0,0,0.1)",
              },
        }}
      />
    </AuroraBackground>
  );
}

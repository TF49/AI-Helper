import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  Minus,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
  Wrench,
  ShieldCheck,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Radio,
  Wallet,
  MessageSquare,
  LayoutGrid,
  SlidersHorizontal,
  Bell,
  Clock,
  Users,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import {
  BrandLogo,
  OpenAIIcon,
  ClaudeIcon,
  WorkbuddyIcon,
  AccioWorkIcon,
} from "./components/BrandIcons";
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
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./components/theme-provider";
import { AuroraBackground } from "./components/react-bits/AuroraBackground";
import { cn } from "./lib/utils";
import { formatPlatformQuota } from "./lib/quotaDisplay";
import { checkBobApiNetwork, openUrl, isTauri, exitApp } from "./lib/api";
import { isMac, modifierKey } from "./lib/platform";
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

const NAV_ITEMS: {
  id: MainNav;
  title: string;
  subtitle: string;
  icon: React.ElementType;
}[] = [
  {
    id: "workspace",
    title: "工作台",
    subtitle: "连接与配置 AI 工具",
    icon: LayoutGrid,
  },
  {
    id: "logs",
    title: "使用日志",
    subtitle: "调用记录与额度统计",
    icon: Clock,
  },
  {
    id: "account",
    title: "个人中心",
    subtitle: "账号概览与钱包资产",
    icon: User,
  },
  {
    id: "tools",
    title: "工具与环境",
    subtitle: "环境检测与应用管理",
    icon: Wrench,
  },
  {
    id: "settings",
    title: "设置",
    subtitle: "外观与使用偏好",
    icon: SlidersHorizontal,
  },
];

const WORKBENCH_TOOLS: {
  id: AgentTool;
  name: string;
  icon: React.ElementType;
  activeColor: string;
}[] = [
  {
    id: "chatgpt",
    name: "Codex",
    icon: OpenAIIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "claude",
    name: "Claude Code",
    icon: ClaudeIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    icon: WorkbuddyIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "acciowork",
    name: "Accio Work",
    icon: AccioWorkIcon,
    activeColor: "text-black dark:text-white",
  },
];

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
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

  // 工作台下拉二级菜单展开状态
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("ai_helper_workspace_menu_open");
    return saved !== null ? saved === "true" : true;
  });

  const [compactWorkspaceOpen, setCompactWorkspaceOpen] = useState(false);

  const toggleWorkspaceMenu = () => {
    setWorkspaceMenuOpen((prev) => {
      const next = !prev;
      localStorage.setItem("ai_helper_workspace_menu_open", String(next));
      return next;
    });
  };

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
  const { resolvedTheme } = useTheme();
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

  // ── 侧边栏整体折叠状态持久化 ──
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("ai_helper_sidebar_collapsed") === "true";
  });

  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("ai_helper_sidebar_collapsed", String(next));
      return next;
    });
  };

  // 全局快捷键 Ctrl+B / Cmd+B 切换左侧栏收起/展开
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        const active = document.activeElement;
        const isInput =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            (active as HTMLElement).isContentEditable);
        if (!isInput) {
          e.preventDefault();
          toggleSidebarCollapsed();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        .catch(() => setAppVersion("1.0.65"));
    } else {
      setAppVersion("1.0.65 (Web Preview)");
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
      {/* ── 顶部无缝桌面标题栏 (始终置顶 z-[100]，确保窗口控制随时可用) ── */}
      <div
        className="flex items-center justify-between h-11 px-3 border-b flex-shrink-0 z-[100] backdrop-blur-xl transition-colors duration-200 bg-white/90 border-slate-200/90 dark:bg-black/90 dark:border-white/10 select-none cursor-default"
        data-tauri-drag-region
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement;
          if (
            !target.closest("button") &&
            !target.closest("input") &&
            !target.closest("a")
          ) {
            void handleToggleMaximize();
          }
        }}
      >
        {/* 左侧：Logo + 标题与版本 + 侧边栏折叠收起开关 (macOS 预留红绿灯间距) */}
        <div className={cn("flex items-center gap-2", isMac() ? "pl-20" : "pl-1")}>
          <div className="flex items-center gap-2.5 pointer-events-none">
            <BrandLogo size={22} className="w-[22px] h-[22px] drop-shadow-sm" />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 leading-none">
                <span className="text-xs font-bold tracking-wider text-slate-900 dark:text-white">
                  AI
                </span>
                <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">
                  Helper
                </span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/5 dark:text-gray-400 dark:border-white/10">
                v{appVersion}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="w-7 h-7 ml-1 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer pointer-events-auto"
            title={
              isSidebarCollapsed
                ? `展开侧边栏 (${modifierKey()}+B)`
                : `收起侧边栏 (${modifierKey()}+B)`
            }
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen size={14} />
            ) : (
              <PanelLeftClose size={14} />
            )}
          </button>
        </div>

        {/* 中间留白可拖动区域 */}
        <div className="flex-1 h-full" data-tauri-drag-region />

        {/* 右侧：功能按钮与窗口控制按钮 (包含公告铃铛、主题切换与后台运行按钮) */}
        <div className="flex items-center gap-1.5">
          {/* 小铃铛公告通知按钮 (对应图一、图二公告历史入口) */}
          <button
            type="button"
            onClick={handleOpenAnnouncement}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer relative"
            title="查看公告历史与版本更新"
          >
            <Bell size={13} />
            {hasUnreadAnnouncement && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-black dark:bg-white ring-2 ring-white dark:ring-black" />
            )}
          </button>

          <ThemeToggle />

          {/* 售后 QQ 群入口 */}
          <button
            type="button"
            onClick={handleOpenQqGroup}
            className="h-7 px-2 flex items-center gap-1.5 rounded-lg text-xs font-medium border border-transparent hover:border-slate-200 dark:hover:border-white/10 bg-slate-100/60 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 dark:hover:text-white transition-colors cursor-pointer"
            title="加入售后服务 QQ 群"
          >
            <Users size={12} className="text-sky-600 dark:text-sky-400" />
            <span className="text-[11px] font-normal">售后群</span>
          </button>

          {/* 意见反馈按钮 */}
          <button
            type="button"
            onClick={() => setFeedbackModalOpen(true)}
            className="h-7 px-2 flex items-center gap-1.5 rounded-lg text-xs font-medium border border-transparent hover:border-slate-200 dark:hover:border-white/10 bg-slate-100/60 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 dark:hover:text-white transition-colors cursor-pointer"
            title="意见反馈 (BUG反馈、功能建议与工单)"
          >
            <MessageSquare size={12} className="text-black dark:text-white" />
            <span className="text-[11px] font-normal">反馈</span>
          </button>

          <div className="h-3.5 w-[1px] bg-slate-200 dark:bg-white/10 mx-1" />

          {/* 明确的“后台运行”按钮 (转入系统托盘常驻守护，无需快捷键) */}
          <button
            type="button"
            onClick={async () => {
              try {
                if (isTauri) {
                  toast.info(
                    "已转入系统托盘后台常驻，可在任务栏右下角随时唤醒",
                    {
                      duration: 3000,
                    },
                  );
                  try {
                    await win.hide();
                  } catch {
                    await win.close();
                  }
                } else {
                  toast.info("Web 预览：已模拟转入后台托盘");
                }
              } catch (err) {
                console.error("Failed to hide to tray:", err);
              }
            }}
            className="h-7 px-2 flex items-center gap-1.5 rounded-lg text-xs font-medium border border-transparent hover:border-slate-200 dark:hover:border-white/10 bg-slate-100/60 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 dark:hover:text-white transition-colors cursor-pointer"
            title="转入系统托盘后台运行 (Bridge 网关保持在后台常驻)"
          >
            <Radio size={12} className="text-emerald-500 animate-pulse" />
            <span className="text-[11px] font-normal">后台运行</span>
          </button>

          {/* Windows / Linux 专属窗口控制按钮 (macOS 采用左上角原生红绿灯) */}
          {!isMac() && (
            <>
              {/* 最小化 */}
              <button
                type="button"
                onClick={() => win.minimize()}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
                title="最小化到任务栏"
              >
                <Minus size={13} />
              </button>
              {/* 最大化/还原 */}
              <button
                type="button"
                onClick={() => void handleToggleMaximize()}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
                title={isWindowMaximized ? "向下还原" : "最大化"}
              >
                {isWindowMaximized ? (
                  <Minimize2 size={13} />
                ) : (
                  <Maximize2 size={13} />
                )}
              </button>
              {/* 关闭/转入后台托盘守护 (响应设置中的 minimizeToTray) */}
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
                        console.warn(
                          "win.hide() failed, fallback to win.close():",
                          hideErr,
                        );
                        await win.close();
                      }
                    } else {
                      await win.close();
                    }
                  } catch (err) {
                    console.error("Failed to close/hide window:", err);
                  }
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-red-500 hover:text-white text-slate-500 dark:hover:bg-red-500/90 dark:text-gray-400 dark:hover:text-white cursor-pointer"
                title={
                  settings.minimizeToTray
                    ? "关闭窗口 (转入系统托盘保持后台常驻守护)"
                    : "关闭并彻底退出 AI Helper"
                }
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 桌面主工作区双栏布局 (左侧全新导航 + 右侧主内容展台) ── */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative z-10 transition-all duration-300">
        {/* ── 全新左侧边栏导航 (严格复刻图一 6 大板块，保留底部资产卡片不动) ── */}
        <aside
          className={cn(
            "flex-shrink-0 flex flex-col justify-between border-r border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-black/80 backdrop-blur-xl transition-all duration-300 select-none overflow-y-auto overflow-x-hidden scrollbar-none",
            isSidebarCollapsed ? "w-[68px] p-2" : "w-64 p-3.5",
          )}
        >
          {isSidebarCollapsed ? (
            /* ── 收起紧凑图标栏 (Compact Rail Mode) ── */
            <div className="flex flex-col h-full justify-between items-center w-full">
              <div className="w-full flex flex-col items-center space-y-2.5">
                {/* 展开侧边栏按钮 */}
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className="w-10 h-8 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/5 transition-colors cursor-pointer"
                  title="展开侧边栏 (Ctrl+B)"
                >
                  <PanelLeftOpen size={16} />
                </button>

                {/* 6 大一级导航图标 */}
                <div className="space-y-1.5 w-full flex flex-col items-center">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = mainNav === item.id;
                    const isWorkspace = item.id === "workspace";

                    if (isWorkspace) {
                      return (
                        <Popover.Root
                          key={item.id}
                          open={compactWorkspaceOpen}
                          onOpenChange={setCompactWorkspaceOpen}
                        >
                          <Popover.Trigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectNav("workspace");
                                setCompactWorkspaceOpen((prev) => !prev);
                              }}
                              className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer relative",
                                isActive
                                  ? "border border-black bg-neutral-100 text-black dark:border-white dark:bg-white/10 dark:text-white shadow-2xs"
                                  : "border border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                              )}
                              title={`${item.title} (点击展开工具二级菜单)`}
                            >
                              {isActive && (
                                <span className="absolute -left-1 top-2.5 bottom-2.5 w-1 rounded-r-full bg-black dark:bg-white" />
                              )}
                              <div
                                className={cn(
                                  "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                                  isActive
                                    ? "bg-black text-white dark:bg-white dark:text-black"
                                    : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                                )}
                              >
                                <Icon size={15} />
                              </div>
                            </button>
                          </Popover.Trigger>
                          <Popover.Portal>
                            <Popover.Content
                              side="right"
                              sideOffset={12}
                              align="start"
                              className="z-[110] w-48 p-1.5 rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/10 shadow-xl animate-in fade-in-0 zoom-in-95 select-none"
                            >
                              <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider border-b border-slate-100 dark:border-white/5 mb-1">
                                工作台工具
                              </div>
                              <div className="space-y-0.5">
                                {WORKBENCH_TOOLS.map((tool) => {
                                  const isToolActive =
                                    mainNav === "workspace" &&
                                    activeTool === tool.id;
                                  const ToolIcon = tool.icon;
                                  return (
                                    <button
                                      key={tool.id}
                                      type="button"
                                      onClick={() => {
                                        handleSelectNav("workspace");
                                        handleSelectTool(tool.id);
                                        setCompactWorkspaceOpen(false);
                                      }}
                                      className={cn(
                                        "w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left",
                                        isToolActive
                                          ? "bg-neutral-100 text-black dark:bg-white/10 dark:text-white font-semibold"
                                          : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5",
                                      )}
                                    >
                                      <div className="flex items-center gap-2">
                                        <ToolIcon
                                          size={14}
                                          className={
                                            isToolActive
                                              ? tool.activeColor
                                              : "opacity-75"
                                          }
                                        />
                                        <span>{tool.name}</span>
                                      </div>
                                      {isToolActive && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-white" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </Popover.Content>
                          </Popover.Portal>
                        </Popover.Root>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectNav(item.id)}
                        className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer relative",
                          isActive
                            ? "border border-black bg-neutral-100 text-black dark:border-white dark:bg-white/10 dark:text-white shadow-2xs"
                            : "border border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                        )}
                        title={`${item.title} (${item.subtitle})`}
                      >
                        {isActive && (
                          <span className="absolute -left-1 top-2.5 bottom-2.5 w-1 rounded-r-full bg-black dark:bg-white" />
                        )}
                        <div
                          className={cn(
                            "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                            isActive
                              ? "bg-black text-white dark:bg-white dark:text-black"
                              : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                          )}
                        >
                          <Icon size={15} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 紧凑底部：账号与资产 */}
              <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-white/10 w-full flex flex-col items-center">
                {authState.is_logged_in ? (
                  <button
                    type="button"
                    onClick={() => handleSelectNav("account")}
                    className="w-9 h-9 rounded-xl bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black flex items-center justify-center font-bold text-xs relative transition-transform hover:scale-105 shadow-2xs cursor-pointer group"
                    title={`${authState.user?.display_name || authState.user?.username || "用户"} - 点击进入个人中心`}
                  >
                    <span>
                      {authState.user?.username?.slice(0, 1).toUpperCase() ||
                        "U"}
                    </span>
                    <span
                      className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-black"
                      title="已就绪"
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLoginModalOpen(true)}
                    className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-white/10 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
                    title="登录 bob-api.com"
                  >
                    <User size={15} />
                  </button>
                )}

                {/* 账号额度余额指示 (Compact Rail 模式) */}
                {authState.is_logged_in && (
                  <button
                    type="button"
                    onClick={() => handleSelectNav("account")}
                    className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-white/10 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer relative shadow-2xs"
                    title={
                      wallet
                        ? `账号原始平台额度: ${formatPlatformQuota(wallet.quota)}\n换算不可用 - 展示服务端原始数据，不推测币值\n点击前往个人中心`
                        : "账号额度未知 - 点击前往个人中心刷新"
                    }
                  >
                    <Wallet size={15} />
                  </button>
                )}

                {/* 网络状态指示灯 */}
                <button
                  type="button"
                  onClick={() => void checkNetwork()}
                  disabled={networkState === "checking"}
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer disabled:opacity-60",
                    networkState === "reachable" &&
                      "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
                    networkState === "unreachable" &&
                      "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10",
                    networkState === "checking" &&
                      "text-black dark:text-white hover:bg-slate-100 dark:hover:bg-white/5",
                  )}
                  title={
                    networkState === "checking"
                      ? "正在检测网络..."
                      : networkState === "reachable"
                        ? "bob-api.com 官方网络正常 (点击重新检测)"
                        : "无法连接官方线路 (点击重新检测)"
                  }
                >
                  {networkState === "checking" ? (
                    <Loader2 size={15} className="animate-spin text-black dark:text-white" />
                  ) : networkState === "reachable" ? (
                    <Wifi size={15} />
                  ) : (
                    <WifiOff size={15} />
                  )}
                </button>

                {/* Tauri 引擎 / 检查更新 (Compact Rail 模式) */}
                <button
                  type="button"
                  onClick={() => void checkForUpdates(true)}
                  disabled={isManualChecking}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-800 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-60"
                  title={
                    isManualChecking
                      ? "正在检查更新..."
                      : "Tauri Engine - 点击检查更新"
                  }
                >
                  <RefreshCw
                    size={12}
                    className={
                      isManualChecking ? "animate-spin text-black dark:text-white" : ""
                    }
                  />
                </button>
              </div>
            </div>
          ) : (
            /* ── 完整展开模式 (Full Sidebar Mode，复刻图一排版) ── */
            <div className="flex flex-col h-full justify-between">
              <div className="space-y-4">
                {/* 顶部 Brand 标题区 (复刻图一) */}
                <div className="px-2 pt-1 pb-1 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black tracking-widest text-black dark:text-white uppercase">
                      AI HELPER
                    </div>
                    <div className="text-[11px] font-medium text-slate-400 dark:text-gray-500 mt-0.5">
                      你的 AI 工作空间
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleSidebarCollapsed}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-gray-300 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    title="收起侧边栏 (Ctrl+B)"
                  >
                    <PanelLeftClose size={13} />
                  </button>
                </div>

                {/* 6 大一级导航列表 */}
                <div className="space-y-1.5">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = mainNav === item.id;
                    const isWorkspace = item.id === "workspace";

                    if (isWorkspace) {
                      return (
                        <div key={item.id} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (mainNav !== "workspace") {
                                handleSelectNav("workspace");
                                setWorkspaceMenuOpen(true);
                                localStorage.setItem("ai_helper_workspace_menu_open", "true");
                              } else {
                                toggleWorkspaceMenu();
                              }
                            }}
                            className={cn(
                              "relative w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition-all cursor-pointer select-none",
                              isActive
                                ? "border-black/60 bg-neutral-100 text-black dark:bg-white/10 dark:border-white/40 dark:text-white shadow-xs"
                                : "border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                            )}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                                  isActive
                                    ? "bg-black text-white dark:bg-white dark:text-black shadow-xs"
                                    : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                                )}
                              >
                                <Icon size={16} />
                              </div>
                              <div className="min-w-0">
                                <div
                                  className={cn(
                                    "text-xs font-bold truncate leading-tight",
                                    isActive
                                      ? "text-black dark:text-white"
                                      : "text-slate-800 dark:text-gray-200",
                                  )}
                                >
                                  {item.title}
                                </div>
                                <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate mt-0.5">
                                  {item.subtitle}
                                </div>
                              </div>
                            </div>

                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWorkspaceMenu();
                              }}
                              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                              title={workspaceMenuOpen ? "收起工作台二级菜单" : "展开工作台二级菜单"}
                            >
                              <ChevronRight
                                size={14}
                                className={cn(
                                  "transition-transform duration-200 flex-shrink-0",
                                  workspaceMenuOpen ? "rotate-90" : "rotate-0",
                                  isActive
                                    ? "text-black dark:text-white"
                                    : "text-slate-400 dark:text-gray-500",
                                )}
                              />
                            </div>
                          </button>

                          {/* ── 工作台下拉二级菜单 ── */}
                          <AnimatePresence initial={false}>
                            {workspaceMenuOpen && (
                              <motion.div
                                key="workspace-submenu"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: "easeInOut" }}
                                className="overflow-hidden"
                              >
                                <div className="ml-4 pl-3 py-1 space-y-1 border-l-2 border-slate-200/80 dark:border-white/10">
                                  {WORKBENCH_TOOLS.map((tool) => {
                                    const isToolActive =
                                      mainNav === "workspace" &&
                                      activeTool === tool.id;
                                    const ToolIcon = tool.icon;

                                    return (
                                      <button
                                        key={tool.id}
                                        type="button"
                                        onClick={() => {
                                          handleSelectNav("workspace");
                                          handleSelectTool(tool.id);
                                        }}
                                        className={cn(
                                          "relative w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer group text-left select-none",
                                          isToolActive
                                            ? "bg-neutral-100 text-black dark:bg-white/10 dark:text-white font-semibold border border-black/20 dark:border-white/20 shadow-2xs"
                                            : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent",
                                        )}
                                      >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <div
                                            className={cn(
                                              "w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                                              isToolActive
                                                ? "bg-white/80 dark:bg-white/10 " +
                                                    tool.activeColor
                                                : "text-slate-400 group-hover:text-slate-600 dark:text-gray-500 dark:group-hover:text-gray-300",
                                            )}
                                          >
                                            <ToolIcon size={14} />
                                          </div>
                                          <span className="truncate">
                                            {tool.name}
                                          </span>
                                        </div>

                                        {isToolActive && (
                                          <span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-white flex-shrink-0 ml-1 shadow-2xs" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectNav(item.id)}
                        className={cn(
                          "relative w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition-all cursor-pointer select-none",
                          isActive
                            ? "border-black/60 bg-neutral-100 text-black dark:bg-white/10 dark:border-white/40 dark:text-white shadow-xs"
                            : "border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                              isActive
                                ? "bg-black text-white dark:bg-white dark:text-black shadow-xs"
                                : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                            )}
                          >
                            <Icon size={16} />
                          </div>
                          <div className="min-w-0">
                            <div
                              className={cn(
                                "text-xs font-bold truncate leading-tight",
                                isActive
                                  ? "text-black dark:text-white"
                                  : "text-slate-800 dark:text-gray-200",
                              )}
                            >
                              {item.title}
                            </div>
                            <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate mt-0.5">
                              {item.subtitle}
                            </div>
                          </div>
                        </div>

                        {isActive && (
                          <ChevronRight
                            size={14}
                            className="text-black dark:text-white flex-shrink-0 ml-1"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 侧边栏底部：保持不变的资产卡片 + 网络状态 */}
              <div className="space-y-2.5 pt-3 border-t border-slate-200/80 dark:border-white/10">
                {/* 底部资产卡片不动，保持原有组件不变 */}
                <AccountBalanceCard />

                {/* 网络状态卡片 */}
                <div
                  className={cn(
                    "p-2.5 rounded-xl border text-xs transition-all",
                    networkState === "reachable" &&
                      "bg-emerald-50/70 border-emerald-200/80 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300",
                    networkState === "unreachable" &&
                      "bg-amber-50/70 border-amber-200/80 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-300",
                    networkState === "checking" &&
                      "bg-slate-100/70 border-slate-200/80 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-400",
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">
                      网络连通性
                    </span>
                    <button
                      type="button"
                      onClick={() => void checkNetwork()}
                      disabled={networkState === "checking"}
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                      title="重新检测连通性"
                    >
                      <RefreshCw
                        size={11}
                        className={
                          networkState === "checking" ? "animate-spin" : ""
                        }
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {networkState === "checking" ? (
                      <Loader2
                        size={13}
                        className="animate-spin text-black dark:text-white flex-shrink-0"
                      />
                    ) : networkState === "reachable" ? (
                      <div className="relative flex items-center justify-center flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-60" />
                        <Wifi
                          size={13}
                          className="text-emerald-600 dark:text-emerald-400"
                        />
                      </div>
                    ) : (
                      <WifiOff
                        size={13}
                        className="text-amber-600 dark:text-amber-400 flex-shrink-0"
                      />
                    )}
                    <span className="text-[11px] truncate font-medium">
                      {networkState === "checking" && "正在检测网络..."}
                      {networkState === "reachable" &&
                        "bob-api.com 官方网络正常"}
                      {networkState === "unreachable" && "无法连接官方线路"}
                    </span>
                  </div>
                </div>

                {/* 引擎与更新 */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-gray-500 px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>Tauri Engine</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void checkForUpdates(true)}
                    disabled={isManualChecking}
                    className="hover:text-slate-800 dark:hover:text-gray-200 transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-60"
                    title="检查新版本"
                  >
                    <RefreshCw
                      size={10}
                      className={
                        isManualChecking ? "animate-spin text-black dark:text-white" : ""
                      }
                    />
                    <span>{isManualChecking ? "检查中" : "检查更新"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ── 右侧主展台内容区 (根据 6 大主导航动态渲染) ── */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto p-5 lg:p-6 xl:p-8 flex flex-col">
          <div className="w-full min-h-full flex flex-col">
            <AnimatePresence mode="wait">
              {mainNav === "workspace" ? (
                <motion.div
                  key="workspace"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="w-full flex-1 flex flex-col min-h-0"
                >
                  <WorkspaceView
                    activeTool={activeTool}
                    onSelectTool={handleSelectTool}
                  />
                </motion.div>
              ) : mainNav === "logs" ? (
                <motion.div
                  key="logs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="w-full flex-1 flex flex-col min-h-0"
                >
                  <UsageLogsView />
                </motion.div>
              ) : mainNav === "account" ? (
                <motion.div
                  key="account"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="w-full flex-1 flex flex-col min-h-0"
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
                  transition={{ duration: 0.16 }}
                  className="w-full flex-1 flex flex-col min-h-0"
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
                  transition={{ duration: 0.16 }}
                  className="w-full flex-1 flex flex-col min-h-0"
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
            ? "claude-3-7-sonnet-20250219"
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

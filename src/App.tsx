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
  Layers,
  FolderGit2,
  User,
  KeyRound,
  Radio,
} from "lucide-react";
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
import { ChatGPTPanel } from "./components/ChatGPTPanel";
import { ClaudePanel } from "./components/ClaudePanel";
import { WorkbuddyPanel } from "./components/WorkbuddyPanel";
import { AccioWorkPanel } from "./components/AccioWorkPanel";
import { AppPathsPanel } from "./components/AppPathsPanel";
import { QuickToolsModal } from "./components/QuickToolsModal";
import { InitializationModal } from "./components/InitializationModal";
import { LoginModal } from "./components/auth/LoginModal";
import { TokenSelectModal } from "./components/auth/TokenSelectModal";
import { AuthProvider, useAuth } from "./lib/useAuth";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./components/theme-provider";
import { AuroraBackground } from "./components/react-bits/AuroraBackground";
import { cn } from "./lib/utils";
import { checkBobApiNetwork, openUrl, isTauri } from "./lib/api";
import { ForceUpdateModal, useAppUpdater } from "./components/ForceUpdateModal";
import type { UserInfo } from "./types";

type Tab = "chatgpt" | "claude" | "workbuddy" | "acciowork" | "paths";
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
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const [tab, setTab] = useState<Tab>("chatgpt");
  const [lastAgentTab, setLastAgentTab] = useState<
    "chatgpt" | "claude" | "workbuddy" | "acciowork"
  >("chatgpt");
  const [networkState, setNetworkState] = useState<NetworkState>("checking");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [initModalOpen, setInitModalOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("...");
  const { resolvedTheme } = useTheme();
  const win = appWindow;

  const {
    authState,
    isAuthReady,
    loginModalOpen,
    setLoginModalOpen,
    tokenModalOpen,
    setTokenModalOpen,
    logout,
    onLoginSuccess,
  } = useAuth();

  const [isInitialized, setIsInitialized] = useState<boolean>(() => {
    return Boolean(
      localStorage.getItem("ai_helper_init_completed") ||
        localStorage.getItem("bobapi_init_completed"),
    );
  });

  const switchTab = (newTab: Tab) => {
    setTab(newTab);
    if (
      newTab === "chatgpt" ||
      newTab === "claude" ||
      newTab === "workbuddy" ||
      newTab === "acciowork"
    ) {
      setLastAgentTab(newTab);
    }
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
        .catch(() => setAppVersion("1.0.32"));
    } else {
      setAppVersion("1.0.32 (Web Preview)");
    }
  }, []);

  // ── 严格按序执行启动流水线：1. 检查更新 ➔ 2. 强制登录 ➔ 3. 环境初始化 ➔ 4. 就绪 ──
  useEffect(() => {
    // 阶段 1：启动检查更新尚未结束，或正处于更新流程（下载中、安装中、就绪重启），严禁进入后续阶段
    if (!isBootCheckComplete) return;
    if (
      updatePhase === "downloading" ||
      updatePhase === "installing" ||
      updatePhase === "ready"
    ) {
      setLoginModalOpen(false);
      setInitModalOpen(false);
      setTokenModalOpen(false);
      return;
    }

    // 阶段 1 已完成，若本地身份凭据校验尚未完成（如正在读取本地 session），等待其就绪以防界面闪烁
    if (!isAuthReady) return;

    // 阶段 2：强制登录判定（必须登录才能使用客户端）
    if (!authState.is_logged_in) {
      setLoginModalOpen(true);
      setInitModalOpen(false);
      setTokenModalOpen(false);
      return;
    }

    // 已登录：关闭强制登录弹窗
    setLoginModalOpen(false);

    // 阶段 3：环境初始化向导（仅在已成功登录后，且属于首次使用未初始化时唤起）
    if (!isInitialized) {
      setInitModalOpen(true);
      return;
    }

    // 阶段 4：已更新、已登录、已初始化，主工作区就绪
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
    // 关闭时无论是否走完全部向导，都持久化标记已处理，防止后续重启重复弹窗打扰
    localStorage.setItem("ai_helper_init_completed", "true");
    setIsInitialized(true);
    setInitModalOpen(false);
  };

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
        tab === "claude"
          ? "claude"
          : tab === "workbuddy"
            ? "workbuddy"
            : tab === "acciowork"
              ? "acciowork"
              : "chatgpt"
      }
      className="text-slate-800 dark:text-gray-200 transition-colors duration-200 h-screen w-screen overflow-hidden flex flex-col"
    >
      {/* ── 顶部无缝桌面标题栏 (始终置顶 z-[100]，确保窗口控制随时可用) ── */}
      <div
        className="flex items-center justify-between h-11 px-3 border-b flex-shrink-0 z-[100] backdrop-blur-xl transition-colors duration-200 bg-white/90 border-slate-200/90 dark:bg-[#0c0e18]/90 dark:border-white/10 select-none cursor-default"
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
        {/* 左侧：Logo + 标题与版本 */}
        <div className="flex items-center gap-2.5 pointer-events-none pl-1">
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

        {/* 中间留白可拖动区域 */}
        <div className="flex-1 h-full" data-tauri-drag-region />

        {/* 右侧：主题切换与窗口控制按钮 (包含明确的后台运行按钮) */}
        <div className="flex items-center gap-1.5">
          <ThemeToggle />

          <div className="h-3.5 w-[1px] bg-slate-200 dark:bg-white/10 mx-1" />

          {/* 明确的“后台运行”按钮 (转入系统托盘常驻守护，无需快捷键) */}
          <button
            type="button"
            onClick={async () => {
              try {
                if (isTauri) {
                  toast.info("已转入系统托盘后台常驻，可在任务栏右下角随时唤醒", {
                    duration: 3000,
                  });
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
          {/* 关闭/转入后台托盘守护 */}
          <button
            type="button"
            onClick={async () => {
              try {
                if (isTauri) {
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
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-red-500 hover:text-white text-slate-500 dark:hover:bg-red-500/90 dark:text-gray-400 dark:hover:text-white cursor-pointer"
            title="关闭窗口 (转入系统托盘保持后台常驻守护)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── 桌面主工作区双栏布局 (左侧边栏导航 + 右侧宽阔配置展台) ── */}
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-row overflow-hidden relative z-10 transition-all duration-300",
          !authState.is_logged_in &&
            "pointer-events-none select-none filter blur-[1.5px] opacity-40",
        )}
      >
        {/* ── 左侧固定侧边栏 (Navigation Sidebar) ── */}
        <aside className="w-64 flex-shrink-0 flex flex-col justify-between p-3.5 border-r border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-[#0c0e18]/70 backdrop-blur-xl transition-all">
          <div className="space-y-4">
            {/* 分组 1: Agent 配置目标 */}
            <div>
              <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 flex items-center gap-1.5">
                <Layers size={12} />
                <span>配置目标 (Targets)</span>
              </div>
              <div className="space-y-1.5">
                {/* ChatGPT (Codex) 选项 */}
                <button
                  type="button"
                  onClick={() => switchTab("chatgpt")}
                  className={cn(
                    "relative w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    tab === "chatgpt"
                      ? "border-blue-500/70 bg-blue-50/80 text-blue-900 dark:bg-blue-500/15 dark:border-blue-500/50 dark:text-blue-100 shadow-xs"
                      : "border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                        tab === "chatgpt"
                          ? "bg-blue-600 text-white dark:bg-blue-500 dark:text-white"
                          : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                      )}
                    >
                      <OpenAIIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate leading-tight">
                        ChatGPT (Codex)
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate mt-0.5">
                        config.toml
                      </div>
                    </div>
                  </div>
                  {tab === "chatgpt" && (
                    <ChevronRight
                      size={14}
                      className="text-blue-600 dark:text-blue-400 flex-shrink-0"
                    />
                  )}
                </button>

                {/* Claude Code 选项 */}
                <button
                  type="button"
                  onClick={() => switchTab("claude")}
                  className={cn(
                    "relative w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    tab === "claude"
                      ? "border-purple-500/70 bg-purple-50/80 text-purple-900 dark:bg-purple-500/15 dark:border-purple-500/50 dark:text-purple-100 shadow-xs"
                      : "border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                        tab === "claude"
                          ? "bg-purple-600 text-white dark:bg-purple-500 dark:text-white"
                          : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                      )}
                    >
                      <ClaudeIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate leading-tight">
                        Claude Code
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate mt-0.5">
                        settings.json
                      </div>
                    </div>
                  </div>
                  {tab === "claude" && (
                    <ChevronRight
                      size={14}
                      className="text-purple-600 dark:text-purple-400 flex-shrink-0"
                    />
                  )}
                </button>

                {/* WorkBuddy 选项 */}
                <button
                  type="button"
                  onClick={() => switchTab("workbuddy")}
                  className={cn(
                    "relative w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    tab === "workbuddy"
                      ? "border-emerald-500/70 bg-emerald-50/80 text-emerald-900 dark:bg-emerald-500/15 dark:border-emerald-500/50 dark:text-emerald-100 shadow-xs"
                      : "border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                        tab === "workbuddy"
                          ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white"
                          : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                      )}
                    >
                      <WorkbuddyIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate leading-tight">
                        WorkBuddy
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate mt-0.5">
                        models.json
                      </div>
                    </div>
                  </div>
                  {tab === "workbuddy" && (
                    <ChevronRight
                      size={14}
                      className="text-emerald-600 dark:text-emerald-400 flex-shrink-0"
                    />
                  )}
                </button>

                {/* Accio Work 选项 */}
                <button
                  type="button"
                  onClick={() => switchTab("acciowork")}
                  className={cn(
                    "relative w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    tab === "acciowork"
                      ? "border-orange-500/70 bg-orange-50/80 text-orange-900 dark:bg-orange-500/15 dark:border-orange-500/50 dark:text-orange-100 shadow-xs"
                      : "border-transparent text-slate-600 dark:text-gray-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-gray-200",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                        tab === "acciowork"
                          ? "bg-orange-600 text-white dark:bg-orange-500 dark:text-white"
                          : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                      )}
                    >
                      <AccioWorkIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate leading-tight">
                        Accio Work
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate mt-0.5">
                        accio_config.json
                      </div>
                    </div>
                  </div>
                  {tab === "acciowork" && (
                    <ChevronRight
                      size={14}
                      className="text-orange-600 dark:text-orange-400 flex-shrink-0"
                    />
                  )}
                </button>
              </div>
            </div>

            {/* 分组 2: 辅助与诊断工具 */}
            <div>
              <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 flex items-center gap-1.5">
                <Wrench size={12} />
                <span>辅助与诊断 (Tools)</span>
              </div>
              <div className="space-y-1">
                {/* 环境初始化向导 */}
                <button
                  type="button"
                  onClick={() => setInitModalOpen(true)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-transparent text-left text-xs font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                >
                  <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 leading-tight">
                      <span>环境初始化向导</span>
                      <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                        新手向导
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
                      检测并一键修复环境
                    </div>
                  </div>
                </button>

                {/* 快速诊断工具箱 */}
                <button
                  type="button"
                  onClick={() => setToolsOpen(true)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-transparent text-left text-xs font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                >
                  <div className="w-6 h-6 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                    <Wrench size={13} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="leading-tight">快速诊断工具箱</div>
                    <div className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
                      cURL 脚本与在线文档
                    </div>
                  </div>
                </button>

                {/* 应用与 CLI 路径选项 */}
                <button
                  type="button"
                  onClick={() => switchTab("paths")}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-2 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer group",
                    tab === "paths"
                      ? "border-teal-500/70 bg-teal-50/80 text-teal-900 dark:bg-teal-500/15 dark:border-teal-500/50 dark:text-teal-100 shadow-xs"
                      : "border-transparent text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
                        tab === "paths"
                          ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-white"
                          : "bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400",
                      )}
                    >
                      <FolderGit2 size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="leading-tight">应用与 CLI 路径</div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate mt-0.5">
                        app_paths.json
                      </div>
                    </div>
                  </div>
                  {tab === "paths" && (
                    <ChevronRight
                      size={14}
                      className="text-teal-600 dark:text-teal-400 flex-shrink-0"
                    />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 侧边栏底部：账号凭据与网络健康 */}
          <div className="space-y-2.5 pt-3 border-t border-slate-200/80 dark:border-white/10">
            {/* ── bob-api.com 账号与 API Key 管理 ── */}
            <div>
              <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 flex items-center justify-between">
                <span>bob-api 账号</span>
                {authState.is_logged_in && (
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="text-[10px] text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer"
                  >
                    退出
                  </button>
                )}
              </div>

              {authState.is_logged_in ? (
                <div className="p-2.5 rounded-xl border border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {authState.user?.username?.slice(0, 1).toUpperCase() || "U"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate text-slate-900 dark:text-white leading-tight">
                          {authState.user?.display_name || authState.user?.username}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-gray-500 truncate font-mono">
                          @{authState.user?.username}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                      已就绪
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setTokenModalOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg text-xs font-medium bg-white dark:bg-white/10 hover:bg-slate-50 dark:hover:bg-white/15 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-white/10 transition-colors shadow-2xs cursor-pointer"
                    title="查看并管理云端 API Key 资产"
                  >
                    <KeyRound size={12} />
                    <span className="truncate">
                      管理 API Key 资产
                    </span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginModalOpen(true)}
                  className="w-full p-2.5 rounded-xl border border-blue-200/90 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-500/10 hover:bg-blue-100/80 dark:hover:bg-blue-500/20 text-left transition-all cursor-pointer group shadow-2xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                      <User size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-blue-900 dark:text-blue-200 leading-tight">
                        登录 bob-api.com
                      </div>
                      <div className="text-[10px] text-blue-600/70 dark:text-blue-400/70 truncate mt-0.5">
                        同步并挑选 API Key
                      </div>
                    </div>
                  </div>
                </button>
              )}
            </div>

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
                    className="animate-spin text-blue-500 flex-shrink-0"
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
                  {networkState === "reachable" && "bob-api.com 官方网络正常"}
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
                    isManualChecking ? "animate-spin text-blue-500" : ""
                  }
                />
                <span>{isManualChecking ? "检查中" : "检查更新"}</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ── 右侧主工作台内容区 (占满右侧全部屏幕，作为唯一全局滚动条容器) ── */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto p-5 lg:p-6 xl:p-8 flex flex-col">
          <div className="w-full min-h-full flex flex-col">
            <AnimatePresence mode="wait">
              {tab === "chatgpt" ? (
                <motion.div
                  key="chatgpt"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full min-h-full flex flex-col"
                >
                  <ChatGPTPanel />
                </motion.div>
              ) : tab === "claude" ? (
                <motion.div
                  key="claude"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full min-h-full flex flex-col"
                >
                  <ClaudePanel />
                </motion.div>
              ) : tab === "workbuddy" ? (
                <motion.div
                  key="workbuddy"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full min-h-full flex flex-col"
                >
                  <WorkbuddyPanel />
                </motion.div>
              ) : tab === "acciowork" ? (
                <motion.div
                  key="acciowork"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full min-h-full flex flex-col"
                >
                  <AccioWorkPanel />
                </motion.div>
              ) : (
                <motion.div
                  key="paths"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full min-h-full flex flex-col"
                >
                  <AppPathsPanel />
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
        activeTab={
          lastAgentTab === "claude"
            ? "claude"
            : lastAgentTab === "workbuddy"
              ? "workbuddy"
              : lastAgentTab === "acciowork"
                ? "acciowork"
                : "chatgpt"
        }
        currentUrl="https://bob-api.com/"
        currentKey=""
        currentModel={
          lastAgentTab === "claude"
            ? "claude-3-7-sonnet-20250219"
            : lastAgentTab === "workbuddy"
              ? "gpt-5.6-sol"
              : lastAgentTab === "acciowork"
                ? "claude-3-7-sonnet"
                : "gpt-4o"
        }
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

      {/* ── bob-api.com 登录弹窗 (未登录时启用强制锁定模式) ── */}
      <LoginModal
        open={loginModalOpen}
        mandatory={!authState.is_logged_in}
        onSuccess={handleLoginSuccess}
        onClose={() => {
          if (authState.is_logged_in) {
            setLoginModalOpen(false);
          }
        }}
      />

      {/* ── API Key 资产与关联弹窗 ── */}
      <TokenSelectModal
        open={tokenModalOpen}
        onSelectKey={(_plainKey, token) => {
          const tid = lastAgentTab;
          try {
            localStorage.setItem(
              `bound_token_${tid}`,
              JSON.stringify({ id: token.id, name: token.name }),
            );
          } catch {}
          toast.success(`已为当前目标「${
            lastAgentTab === "claude"
              ? "Claude Code"
              : lastAgentTab === "workbuddy"
                ? "WorkBuddy"
                : lastAgentTab === "acciowork"
                  ? "Accio Work"
                  : "ChatGPT (Codex)"
          }」成功关联 API Key：${token.name}`);
        }}
        onClose={() => setTokenModalOpen(false)}
        toolName={
          lastAgentTab === "claude"
            ? "Claude Code"
            : lastAgentTab === "workbuddy"
              ? "WorkBuddy"
              : lastAgentTab === "acciowork"
                ? "Accio Work"
                : "ChatGPT (Codex)"
        }
        accentColor={
          lastAgentTab === "claude"
            ? "purple"
            : lastAgentTab === "workbuddy"
              ? "emerald"
              : lastAgentTab === "acciowork"
                ? "orange"
                : "blue"
        }
      />

      {/* ── 阶段 1：启动检查更新阶段过渡层 (置于标题栏下方，保留窗口控制并提供引导入口) ── */}
      {!isBootCheckComplete && updatePhase === "idle" && (
        <div className="fixed inset-0 top-11 z-50 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-md select-none p-4">
          <div className="max-w-sm w-full p-6 rounded-2xl bg-white dark:bg-[#121524] border border-slate-200 dark:border-white/10 shadow-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 flex items-center justify-center shadow-sm mb-3.5">
              <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
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
                className="flex-1 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
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
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shadow-lg shadow-blue-500/10 mb-3">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
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

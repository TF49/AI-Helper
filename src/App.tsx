import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import {
  Minus,
  Maximize2,
  Minimize2,
  X,
  Bot,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
  Sparkles,
  Wrench,
  ShieldCheck,
  ChevronRight,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { ChatGPTPanel } from "./components/ChatGPTPanel";
import { ClaudePanel } from "./components/ClaudePanel";
import { QuickToolsModal } from "./components/QuickToolsModal";
import { InitializationModal } from "./components/InitializationModal";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./components/theme-provider";
import { AuroraBackground } from "./components/react-bits/AuroraBackground";
import { DecryptedText } from "./components/react-bits/DecryptedText";
import { ShinyText } from "./components/react-bits/ShinyText";
import { cn } from "./lib/utils";
import { checkBobApiNetwork, openUrl } from "./lib/api";
import { ForceUpdateModal, useAppUpdater } from "./components/ForceUpdateModal";

type Tab = "chatgpt" | "claude";
type NetworkState = "checking" | "reachable" | "unreachable";

export default function App() {
  return <AppContent />;
}

function AppContent() {
  const [tab, setTab] = useState<Tab>("chatgpt");
  const [networkState, setNetworkState] = useState<NetworkState>("checking");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [initModalOpen, setInitModalOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("...");
  const { resolvedTheme } = useTheme();
  const win = getCurrentWindow();

  const {
    phase: updatePhase,
    backendInfo: updateBackendInfo,
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

  const isInitialized = Boolean(
    localStorage.getItem("ai_helper_init_completed") ||
      localStorage.getItem("bobapi_init_completed"),
  );

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
    void getVersion().then((v) => setAppVersion(v));
  }, []);

  // 严格执行启动时序：优先更新检查与自动更新，当更新检查结束且未处于更新重启中时，再判定并弹出初始化向导
  useEffect(() => {
    // 1. 若启动检查更新尚未结束，不进行初始化判定
    if (!isBootCheckComplete) return;

    // 2. 若当前正处于更新流程（下载中、安装中、安装完毕等待重启），决不唤起初始化
    if (
      updatePhase === "downloading" ||
      updatePhase === "installing" ||
      updatePhase === "ready"
    ) {
      return;
    }

    // 3. 检查更新确认无可用更新（或用户选择跳过），且未初始化过，此时才正式唤起初始化向导
    const hasInit =
      localStorage.getItem("ai_helper_init_completed") ||
      localStorage.getItem("bobapi_init_completed");
    if (!hasInit) {
      setInitModalOpen(true);
    }
  }, [isBootCheckComplete, updatePhase]);

  const handleInitFinish = () => {
    localStorage.setItem("ai_helper_init_completed", "true");
    sessionStorage.setItem("ai_helper_init_completed", "true");
  };

  const handleInitClose = () => {
    // 关闭时无论是否走完全部向导，都持久化标记已处理，防止后续重启重复弹窗打扰
    localStorage.setItem("ai_helper_init_completed", "true");
    setInitModalOpen(false);
  };

  const isChatGPT = tab === "chatgpt";
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
      theme={tab}
      className="select-none text-slate-800 dark:text-gray-200 transition-colors duration-200 h-screen w-screen overflow-hidden flex flex-col"
    >
      {/* ── 顶部无缝桌面标题栏 ── */}
      <div
        className="flex items-center justify-between h-11 px-3 border-b flex-shrink-0 z-30 backdrop-blur-xl transition-colors duration-200 bg-white/80 border-slate-200/90 dark:bg-[#0c0e18]/85 dark:border-white/10 select-none cursor-default"
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
          <div
            className={cn(
              "w-6 h-6 rounded-lg flex items-center justify-center transition-all shadow-xs",
              isChatGPT
                ? "bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30"
                : "bg-purple-100 text-purple-600 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30",
            )}
          >
            {isChatGPT ? <Bot size={14} /> : <Sparkles size={13} />}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 leading-none">
              <DecryptedText
                text="AI"
                className="text-xs font-bold tracking-wider text-slate-900 dark:text-white"
                encryptedClassName="text-xs font-bold tracking-wider text-blue-600 dark:text-blue-400"
                speed={35}
                animateOn="hover"
              />
              <ShinyText
                text="Helper"
                className="text-xs font-semibold text-slate-500 dark:text-gray-400"
                color={isDark ? "#94a3b8" : "#475569"}
                shineColor={isDark ? "#ffffff" : "#0284c7"}
                speed={3}
              />
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/5 dark:text-gray-400 dark:border-white/10">
              v{appVersion}
            </span>
          </div>
        </div>

        {/* 中间留白可拖动区域 */}
        <div className="flex-1 h-full" data-tauri-drag-region />

        {/* 右侧：深浅色切换与窗口控制按钮 */}
        <div className="flex items-center gap-1.5">
          <ThemeToggle />

          <div className="h-3.5 w-[1px] bg-slate-200 dark:bg-white/10 mx-1" />

          {/* 最小化 */}
          <button
            type="button"
            onClick={() => win.minimize()}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
            title="最小化"
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
          {/* 关闭 */}
          <button
            type="button"
            onClick={() => win.close()}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-red-500 hover:text-white text-slate-500 dark:hover:bg-red-500/90 dark:text-gray-400 dark:hover:text-white cursor-pointer"
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── 桌面主工作区双栏布局 (左侧边栏导航 + 右侧宽阔配置展台) ── */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative z-10">
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
                  onClick={() => setTab("chatgpt")}
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
                      <Bot size={16} />
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
                    <ChevronRight size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  )}
                </button>

                {/* Claude Code 选项 */}
                <button
                  type="button"
                  onClick={() => setTab("claude")}
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
                      <Sparkles size={15} />
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
                    <ChevronRight size={14} className="text-purple-600 dark:text-purple-400 flex-shrink-0" />
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
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                >
                  <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                    <ShieldCheck size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="leading-tight">环境初始化向导</div>
                    <div className="text-[10px] text-slate-400 dark:text-gray-500">检测并修复运行环境</div>
                  </div>
                </button>

                {/* 快速诊断工具箱 */}
                <button
                  type="button"
                  onClick={() => setToolsOpen(true)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                >
                  <div className="w-6 h-6 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                    <Wrench size={13} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="leading-tight">快速诊断工具箱</div>
                    <div className="text-[10px] text-slate-400 dark:text-gray-500">cURL 脚本与在线文档</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* 侧边栏底部：网络健康与系统状态 */}
          <div className="space-y-3 pt-3 border-t border-slate-200/80 dark:border-white/10">
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
                    className={networkState === "checking" ? "animate-spin" : ""}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2">
                {networkState === "checking" ? (
                  <Loader2 size={13} className="animate-spin text-blue-500 flex-shrink-0" />
                ) : networkState === "reachable" ? (
                  <div className="relative flex items-center justify-center flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-60" />
                    <Wifi size={13} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                ) : (
                  <WifiOff size={13} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
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
                  className={isManualChecking ? "animate-spin text-blue-500" : ""}
                />
                <span>{isManualChecking ? "检查中" : "检查更新"}</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ── 右侧主工作台内容区 (占满右侧全部屏幕) ── */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto p-5 lg:p-6 xl:p-8 flex flex-col">
          <div className="w-full flex-1 flex flex-col min-h-0">
            <AnimatePresence mode="wait">
              {tab === "chatgpt" ? (
                <motion.div
                  key="chatgpt"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="w-full flex-1 flex flex-col min-h-0"
                >
                  <ChatGPTPanel />
                </motion.div>
              ) : (
                <motion.div
                  key="claude"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="w-full flex-1 flex flex-col min-h-0"
                >
                  <ClaudePanel />
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
        activeTab={tab}
        currentUrl="https://bob-api.com/"
        currentKey=""
        currentModel={
          tab === "chatgpt" ? "gpt-4o" : "claude-3-7-sonnet-20250219"
        }
      />

      <ForceUpdateModal
        phase={updatePhase}
        backendInfo={updateBackendInfo}
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

      {/* ── 首次使用未初始化时，启动检查更新阶段的全屏过渡层 ── */}
      {!isInitialized && !isBootCheckComplete && updatePhase === "idle" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xl select-none">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-blue-500/40 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <RefreshCw className="w-7 h-7 text-blue-400 animate-spin" />
          </div>
          <h2 className="text-sm font-semibold text-white tracking-wide">
            正在检查软件版本与更新...
          </h2>
          <p className="text-xs text-slate-400 mt-1.5">
            优先确认最新版本与运行环境，请稍候
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

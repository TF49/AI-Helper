import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import {
  Minus,
  X,
  Bot,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
  Sparkles,
  Wrench,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { ChatGPTPanel } from "./components/ChatGPTPanel";
import { ClaudePanel } from "./components/ClaudePanel";
import { QuickToolsModal } from "./components/QuickToolsModal";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./components/theme-provider";
import { AuroraBackground } from "./components/react-bits/AuroraBackground";
import { DecryptedText } from "./components/react-bits/DecryptedText";
import { ShinyText } from "./components/react-bits/ShinyText";
import { cn } from "./lib/utils";
import { checkBobApiNetwork } from "./lib/api";
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
  }, []);

  // 读取真实版本号
  useEffect(() => {
    void getVersion().then((v) => setAppVersion(v));
  }, []);

  const isChatGPT = tab === "chatgpt";
  const isDark = resolvedTheme === "dark";

  return (
    <AuroraBackground
      theme={tab}
      className="select-none text-slate-800 dark:text-gray-200 transition-colors duration-200"
    >
      {/* ── 现代高颜值标题栏 ── */}
      <div
        className="flex items-center justify-between h-12 px-4 border-b flex-shrink-0 z-20 backdrop-blur-xl transition-colors duration-200 bg-white/80 border-slate-200/90 dark:bg-[#0e101a]/80 dark:border-white/10"
        data-tauri-drag-region
      >
        {/* Logo + 解密动效标题 */}
        <div className="flex items-center gap-2.5 pointer-events-none">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center transition-all shadow-xs",
              isChatGPT
                ? "bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30"
                : "bg-purple-100 text-purple-600 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30",
            )}
          >
            {isChatGPT ? <Bot size={16} /> : <Sparkles size={15} />}
          </div>
          <div className="flex flex-col leading-none">
            <div className="flex items-center gap-1.5">
              <DecryptedText
                text="BobAPI"
                className="text-xs font-bold tracking-wider text-slate-900 dark:text-white"
                encryptedClassName="text-xs font-bold tracking-wider text-blue-600 dark:text-blue-400"
                speed={35}
                animateOn="hover"
              />
              <ShinyText
                text="Console"
                className="text-xs font-semibold text-slate-500 dark:text-gray-400"
                color={isDark ? "#94a3b8" : "#475569"}
                shineColor={isDark ? "#ffffff" : "#0284c7"}
                speed={3}
              />
            </div>
            <span className="text-[9px] text-slate-400 dark:text-gray-400 font-mono tracking-wider pt-0.5">
              AI AGENT CONFIG TOOL
            </span>
          </div>
        </div>

        {/* 右侧：深浅色切换、工具箱与窗口控制按钮 */}
        <div className="flex items-center gap-1.5">
          {/* 亮色/暗色快速切换按钮 (cc-switch 风格) */}
          <ThemeToggle />

          {/* 工具箱入口 */}
          <button
            onClick={() => setToolsOpen(true)}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg border text-xs transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-400 dark:hover:text-white"
            title="环境诊断与工具箱"
          >
            <Wrench size={13} />
            <span className="text-[11px]">工具箱</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-200 dark:bg-white/10 mx-0.5" />

          {/* 窗口最小化 */}
          <button
            onClick={() => win.minimize()}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-gray-200"
            title="最小化"
          >
            <Minus size={13} />
          </button>
          {/* 窗口关闭 */}
          <button
            onClick={() => win.close()}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-red-500 hover:text-white text-slate-500 dark:hover:bg-red-500/90 dark:text-gray-400 dark:hover:text-white"
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── 胶囊 Tab 切换栏 ── */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0 z-10">
        <div className="flex p-1 rounded-xl border backdrop-blur-md transition-colors bg-slate-200/70 border-slate-200/90 dark:bg-[#121524]/80 dark:border-white/10">
          {(
            [
              { key: "chatgpt", label: "ChatGPT (Codex)", icon: Bot },
              { key: "claude", label: "Claude Code", icon: Sparkles },
            ] as const
          ).map(({ key, label, icon: Icon }) => {
            const isActive = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "relative flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors z-10",
                  isActive
                    ? key === "chatgpt"
                      ? "text-blue-700 dark:text-blue-100 font-semibold"
                      : "text-purple-700 dark:text-purple-100 font-semibold"
                    : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200",
                )}
              >
                {/* 活跃指示滑块 (Framer Motion layoutId) */}
                {isActive && (
                  <motion.div
                    layoutId="activeTabPill"
                    className={cn(
                      "absolute inset-0 rounded-lg shadow-sm border",
                      key === "chatgpt"
                        ? "bg-white border-slate-200 dark:bg-gradient-to-r dark:from-blue-600/40 dark:to-blue-500/30 dark:border-blue-500/50 dark:shadow-blue-500/20"
                        : "bg-white border-slate-200 dark:bg-gradient-to-r dark:from-purple-600/40 dark:to-purple-500/30 dark:border-purple-500/50 dark:shadow-purple-500/20",
                    )}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon
                  size={14}
                  className={cn(
                    "relative z-10 transition-colors",
                    isActive
                      ? key === "chatgpt"
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-purple-600 dark:text-purple-400"
                      : "text-slate-400 dark:text-gray-500",
                  )}
                />
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 网络环境诊断横条 ── */}
      <div className="px-4 py-1 flex-shrink-0 z-10">
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs border backdrop-blur-sm transition-all duration-300",
            networkState === "reachable" &&
              "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300",
            networkState === "unreachable" &&
              "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-300",
            networkState === "checking" &&
              "bg-slate-100 border-slate-200 text-slate-600 dark:bg-white/5 dark:border-white/10 dark:text-gray-400",
          )}
        >
          {/* 状态图标 */}
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

          {/* 状态文案 */}
          <span className="flex-1 text-[11px] truncate">
            {networkState === "checking" &&
              "正在检测 bob-api.com 网络环境连通性..."}
            {networkState === "reachable" &&
              "已连接至 bob-api.com 官方网络（正常）"}
            {networkState === "unreachable" &&
              "无法连接 bob-api.com，请检查网络或开启科学代理"}
          </span>

          {/* 刷新检测 */}
          <button
            type="button"
            onClick={() => void checkNetwork()}
            disabled={networkState === "checking"}
            className="p-1 rounded-md transition-colors flex-shrink-0 hover:bg-slate-200/60 text-slate-500 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
            title="重新检测网络"
          >
            <RefreshCw
              size={12}
              className={networkState === "checking" ? "animate-spin" : ""}
            />
          </button>
        </div>
      </div>

      {/* ── 内容区 (带流畅切换动效) ── */}
      <div className="flex-1 overflow-y-auto px-4 py-2 relative z-10">
        <AnimatePresence mode="wait">
          {tab === "chatgpt" ? (
            <motion.div
              key="chatgpt"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <ChatGPTPanel />
            </motion.div>
          ) : (
            <motion.div
              key="claude"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <ClaudePanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── 底部状态栏 ── */}
      <div className="flex-shrink-0 px-4 py-2 border-t flex items-center justify-between text-[11px] z-20 backdrop-blur-md transition-colors bg-white/80 border-slate-200/90 text-slate-500 dark:bg-[#0c0e17]/80 dark:border-white/10 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Tauri v2 Desktop Engine</span>
        </div>
        <div className="flex items-center gap-3">
          {/* 检查更新按钮：手动点击触发检查；仅在点击后检查过程中转圈，平时为静态按钮 */}
          <button
            onClick={() => void checkForUpdates(true)}
            disabled={isManualChecking}
            className="hover:text-slate-800 dark:hover:text-white transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-60"
            title="检查新版本"
          >
            <RefreshCw
              size={11}
              className={isManualChecking ? "animate-spin text-blue-500" : ""}
            />
            <span>{isManualChecking ? "检查中..." : "检查更新"}</span>
          </button>
          <span className="text-slate-300 dark:text-white/20">|</span>
          <button
            onClick={() => setToolsOpen(true)}
            className="hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            使用帮助
          </button>
          <span className="font-mono text-slate-400 dark:text-gray-500">
            v{appVersion}
          </span>
        </div>
      </div>

      {/* ── 工具箱诊断弹窗 ── */}
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

      {/* ── 自动更新模态框 ── */}
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

      {/* ── Toast 通知 ── */}
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

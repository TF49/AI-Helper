/**
 * ForceUpdateModal — 自动更新组件
 *
 * 完全复用 Antigravity-Manager (https://github.com/lbjlaq/Antigravity-Manager) 升级更新逻辑：
 *   1. 应用启动静默检测（延时 1.5 秒不阻塞启动渲染）
 *   2. 无更新 → 完全静默，不弹窗、不打扰用户
 *   3. 发现更新 → 立即展示更新卡片，并通过代理 (info.proxy_url) 自动调用 Tauri 原生 downloadAndInstall
 *   4. 下载进度实时显示（百分比 + 已下载字节 / 总字节）
 *   5. 安装完成 → 提示"更新已准备就绪"，提供"立即重启生效"（或 1.5s 后自动重启）
 *   6. 异常处理 → 显示错误信息，支持"重试"和"手动前往 GitHub 下载"
 *   7. 状态栏手动触发 → 点击"检查更新"若已是最新版则通过 Toast 明确提示
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  DownloadCloud,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Power,
  Sparkles,
  CheckCircle2,
  X,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  check as tauriCheck,
  type DownloadEvent,
} from "@tauri-apps/plugin-updater";
import { relaunch, exit } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { openUrl } from "../lib/api";

// ── 类型定义 ─────────────────────────────────────────────────────────────────

export interface BackendUpdateInfo {
  has_update: boolean;
  latest_version: string;
  current_version: string;
  download_url: string;
  release_notes: string;
  published_at: string;
  source?: string;
  proxy_url?: string;
}

export type UpdatePhase =
  | "idle" // 无更新/未激活
  | "checking" // 检查版本中
  | "downloading" // 正在下载更新
  | "installing" // 下载完成，正在安装
  | "ready" // 安装就绪，等待重启
  | "error" // 更新失败
  | "manual"; // 资产未就绪，需手动前往 GitHub 下载

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const GITHUB_RELEASES_URL = "https://github.com/TF49/AI-Helper/releases/latest";

function getAcceleratedDownloadUrl(version?: string): string {
  if (!version) return GITHUB_RELEASES_URL;
  const cleanVer = version.replace(/^v/, "");
  return `https://ghfast.top/https://github.com/TF49/AI-Helper/releases/download/v${cleanVer}/AI-Helper-v${cleanVer}-Windows-x64-Setup.exe`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [backendInfo, setBackendInfo] = useState<BackendUpdateInfo | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [progressBytes, setProgressBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [isManualChecking, setIsManualChecking] = useState(false);
  const [isBootCheckComplete, setIsBootCheckComplete] = useState(false);

  const downloadStarted = useRef(false);
  const hasBootChecked = useRef(false);

  /**
   * 执行检查与下载流程（复用 Antigravity-Manager checkAndDownload）
   * @param manual 是否为用户手动点击检查更新
   */
  const checkForUpdates = useCallback(async (manual = false) => {
    if (downloadStarted.current) return;

    if (manual) {
      setIsManualChecking(true);
    }
    setErrorMessage("");

    try {
      // Step 1: 调用 Rust 后端多源版本检测（updater.json -> GitHub API -> Raw -> jsDelivr）
      const info = await invoke<BackendUpdateInfo>("check_for_updates");

      if (!info.has_update) {
        setPhase("idle");
        setIsBootCheckComplete(true);
        if (manual) {
          setIsManualChecking(false);
          toast.success(
            `当前已是最新版本 (v${info.current_version})，无需更新`,
          );
        }
        return;
      }

      // 发现新版本！
      setBackendInfo(info);
      if (manual) {
        setIsManualChecking(false);
      }

      if (downloadStarted.current) return;
      downloadStarted.current = true;

      setPhase("downloading");
      setDownloadProgress(0);
      setProgressBytes(0);
      setTotalBytes(0);

      // Step 2: 调用 Tauri 原生 check，支持 upstream 代理
      const update = await tauriCheck(
        info.proxy_url ? { proxy: info.proxy_url } : undefined,
      );

      if (!update) {
        // updater.json 资产尚未同步完成，降级为提示手动下载
        setPhase("manual");
        downloadStarted.current = false;
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      // Step 3: 下载与静默安装
      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setTotalBytes(contentLength);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgressBytes(downloaded);
            if (contentLength > 0) {
              setDownloadProgress(
                Math.round((downloaded / contentLength) * 100),
              );
            }
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });

      // Step 4: 安装完成，准备重启
      setPhase("ready");
    } catch (err: unknown) {
      downloadStarted.current = false;
      if (manual) {
        setIsManualChecking(false);
      }
      const msg = err instanceof Error ? err.message : String(err);

      // 启动时的静默检查如果只是网络不通且无更新，不打扰用户并放行后续初始化
      if (!downloadStarted.current && !manual) {
        console.warn("Silent update check skipped:", msg);
        setPhase("idle");
        setIsBootCheckComplete(true);
        return;
      }

      setErrorMessage(msg || "更新下载失败，请检查网络或配置代理");
      setPhase("error");
    }
  }, []);

  // 应用启动时快速执行静默检测，确保先检查更新，再决定是否进入初始化
  useEffect(() => {
    if (hasBootChecked.current) return;
    hasBootChecked.current = true;

    // 100ms 轻微延时，等待首帧挂载后立即开始检测
    const timer = setTimeout(() => {
      void checkForUpdates(false);
    }, 100);

    // 6秒超时兜底：即使极端网络环境卡住检测请求，也确保超时后放行进入主界面/初始化
    const safetyTimer = setTimeout(() => {
      setIsBootCheckComplete((prev) => {
        if (!prev) {
          console.warn(
            "Boot update check safety timeout reached, unlocking init/dashboard.",
          );
          return true;
        }
        return prev;
      });
    }, 6000);

    return () => {
      clearTimeout(timer);
      clearTimeout(safetyTimer);
    };
  }, [checkForUpdates]);

  const handleRetry = useCallback(() => {
    downloadStarted.current = false;
    void checkForUpdates(true);
  }, [checkForUpdates]);

  const handleRestart = useCallback(async () => {
    try {
      await relaunch();
    } catch {
      await exit(0);
    }
  }, []);

  const handleClose = useCallback(() => {
    setPhase("idle");
    setIsBootCheckComplete(true);
  }, []);

  const handleExit = useCallback(async () => {
    try {
      await exit(0);
    } catch {
      window.close();
    }
  }, []);

  return {
    phase,
    backendInfo,
    downloadProgress,
    progressBytes,
    totalBytes,
    errorMessage,
    isManualChecking,
    isBootCheckComplete,
    checkForUpdates,
    handleRetry,
    handleRestart,
    handleClose,
    handleExit,
  };
}

// ── UI 模态框组件 ─────────────────────────────────────────────────────────────

interface ForceUpdateModalProps {
  phase: UpdatePhase;
  backendInfo: BackendUpdateInfo | null;
  downloadProgress: number;
  progressBytes: number;
  totalBytes: number;
  errorMessage: string;
  onRetry: () => void;
  onRestart: () => void;
  onClose: () => void;
  onExit: () => void;
}

export function ForceUpdateModal({
  phase,
  backendInfo,
  downloadProgress,
  progressBytes,
  totalBytes,
  errorMessage,
  onRetry,
  onRestart,
  onClose,
  onExit,
}: ForceUpdateModalProps) {
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);

  // 当更新安装完毕就绪时，启动 2 秒倒计时自动重启应用生效（亦可点击立即重启或选择稍后）
  useEffect(() => {
    if (phase === "ready") {
      setRestartCountdown(2);
      const interval = setInterval(() => {
        setRestartCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            onRestart();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setRestartCountdown(null);
    }
  }, [phase, onRestart]);

  const visible =
    phase === "downloading" ||
    phase === "installing" ||
    phase === "ready" ||
    phase === "error" ||
    phase === "manual";

  if (!visible) return null;

  const pct = totalBytes > 0 ? Math.min(100, downloadProgress) : 0;

  return (
    <AnimatePresence>
      <motion.div
        key="update-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 350, damping: 28 }}
          className="relative w-full max-w-md rounded-2xl border border-blue-500/30 bg-[#0f1322] text-slate-100 shadow-[0_20px_60px_-15px_rgba(30,58,138,0.5)] overflow-hidden"
        >
          {/* 顶部流光色条 */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

          {/* 右上角关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors z-20 cursor-pointer"
            title="稍后处理"
          >
            <X size={15} />
          </button>

          {/* 头部图标与版本展示 */}
          <div className="p-6 pb-4 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-blue-500/40 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-3">
              {phase === "ready" ? (
                <CheckCircle2 className="w-7 h-7 text-emerald-400 animate-bounce" />
              ) : phase === "error" ? (
                <AlertTriangle className="w-7 h-7 text-amber-400" />
              ) : (
                <DownloadCloud className="w-7 h-7 text-blue-400 animate-pulse" />
              )}
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide bg-blue-500/10 border border-blue-500/30 text-blue-400 mb-2">
              <Sparkles size={12} />
              {phase === "ready" ? "更新已就绪" : "发现新版本"}
            </div>

            <h2 className="text-lg font-bold text-white tracking-tight">
              {phase === "ready"
                ? "新版本已安装完成"
                : phase === "manual"
                  ? "发现新版本（需手动下载）"
                  : "正在自动下载新版本"}
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              {phase === "ready"
                ? restartCountdown !== null && restartCountdown > 0
                  ? `客户端将在 ${restartCountdown} 秒后自动重启生效...`
                  : "正在重启客户端生效..."
                : "系统正在通过高速通道获取更新资源，稍候即可完成。"}
            </p>

            {/* 版本号对比 */}
            {backendInfo && (
              <div className="flex items-center justify-center gap-2 mt-3 font-mono text-xs bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl">
                <span className="text-slate-400">
                  v{backendInfo.current_version}
                </span>
                <span className="text-slate-600">→</span>
                <span className="text-emerald-400 font-bold">
                  v{backendInfo.latest_version}
                </span>
              </div>
            )}
          </div>

          {/* 更新日志 */}
          {backendInfo?.release_notes && (
            <div className="px-6 py-2">
              <div className="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-black/40 border border-white/5 p-2.5 rounded-xl whitespace-pre-wrap leading-relaxed">
                <span className="font-semibold text-slate-300 block mb-0.5">
                  更新内容：
                </span>
                {backendInfo.release_notes}
              </div>
            </div>
          )}

          {/* 进度 / 操作按钮区 */}
          <div className="p-6 pt-3 space-y-4">
            {/* 下载中进度条 */}
            {phase === "downloading" && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    <RefreshCw
                      size={13}
                      className="animate-spin text-blue-400"
                    />
                    正在下载更新资源...
                  </span>
                  <span className="font-mono text-blue-400 font-semibold">
                    {pct > 0 ? `${pct}%` : "连接中..."}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                    style={{ width: `${Math.max(pct, 5)}%` }}
                    transition={{ ease: "easeOut", duration: 0.2 }}
                  />
                </div>
                <div className="flex justify-between items-center text-[11px] text-slate-500 font-mono">
                  <span>已下载: {formatBytes(progressBytes)}</span>
                  <span>总大小: {formatBytes(totalBytes)}</span>
                </div>
                <div className="flex justify-end pt-0.5">
                  <button
                    onClick={onClose}
                    className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer py-1 px-2.5 rounded-lg hover:bg-white/5"
                  >
                    稍后更新（后台放行）
                  </button>
                </div>
              </div>
            )}

            {/* 校验与安装中 */}
            {phase === "installing" && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-indigo-300 font-medium bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                <RefreshCw size={14} className="animate-spin text-indigo-400" />
                更新包下载完成，正在校验并安装...
              </div>
            )}

            {/* 安装就绪，提供重启按钮 */}
            {phase === "ready" && (
              <div className="flex gap-2">
                <button
                  onClick={onRestart}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-medium text-xs shadow-lg shadow-green-500/25 transition-all active:scale-95 cursor-pointer"
                >
                  <RotateCcw size={14} />
                  <span>
                    立即重启生效
                    {restartCountdown !== null && restartCountdown > 0
                      ? ` (${restartCountdown}s)`
                      : ""}
                  </span>
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 text-xs transition-colors cursor-pointer"
                >
                  稍后
                </button>
              </div>
            )}

            {/* 手动下载分支 */}
            {phase === "manual" && (
              <div className="space-y-3">
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-left">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-1">
                    <AlertTriangle size={14} />
                    自动安装包暂未就绪
                  </div>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    最新版本安装包可直接通过国内高速通道或前往 GitHub Releases
                    下载。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={getAcceleratedDownloadUrl(
                      backendInfo?.latest_version,
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      void openUrl(
                        getAcceleratedDownloadUrl(backendInfo?.latest_version),
                      );
                    }}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                    title="通过国内镜像加速下载安装包"
                  >
                    <ExternalLink size={13} />
                    国内高速下载
                  </a>
                  <a
                    href={backendInfo?.download_url ?? GITHUB_RELEASES_URL}
                    onClick={(e) => {
                      e.preventDefault();
                      void openUrl(
                        backendInfo?.download_url ?? GITHUB_RELEASES_URL,
                      );
                    }}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs transition-colors cursor-pointer"
                    title="在 GitHub Releases 页面查看"
                  >
                    <ExternalLink size={13} />
                    GitHub
                  </a>
                  <button
                    onClick={onClose}
                    className="px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 text-xs transition-colors cursor-pointer"
                  >
                    稍后
                  </button>
                </div>
              </div>
            )}

            {/* 失败重试分支 */}
            {phase === "error" && (
              <div className="space-y-3">
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-left">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400 mb-1">
                    <AlertTriangle size={14} />
                    更新下载失败
                  </div>
                  <p className="text-[11px] text-red-300/80 leading-relaxed break-words">
                    {errorMessage ||
                      "网络连接超时或无法直连 GitHub，请检查网络或配置代理"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onRetry}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all active:scale-95 cursor-pointer"
                  >
                    <RefreshCw size={13} />
                    重试下载
                  </button>
                  <a
                    href={getAcceleratedDownloadUrl(
                      backendInfo?.latest_version,
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      void openUrl(
                        getAcceleratedDownloadUrl(backendInfo?.latest_version),
                      );
                    }}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-xs transition-colors cursor-pointer"
                    title="通过国内镜像加速下载安装包"
                  >
                    <ExternalLink size={13} />
                    国内高速下载
                  </a>
                  <button
                    onClick={onClose}
                    className="px-3 py-2.5 rounded-xl text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 text-xs transition-colors cursor-pointer"
                  >
                    稍后
                  </button>
                  <button
                    onClick={onExit}
                    className="flex items-center justify-center p-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-300 border border-white/10 text-slate-400 transition-colors cursor-pointer"
                    title="退出软件"
                  >
                    <Power size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

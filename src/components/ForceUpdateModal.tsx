import { useState, useEffect, useCallback, useRef } from "react";
import {
  DownloadCloud,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Power,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch, exit } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  updateObj: Update | null;
  version: string;
  currentVersion: string;
  notes: string;
  status: "idle" | "checking" | "downloading" | "installing" | "restarting" | "error";
  progressBytes: number;
  totalBytes: number;
  errorMessage: string;
}

const GITHUB_RELEASES_URL = "https://github.com/TF49/Bobapi-Tool/releases/latest";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function useAppUpdater() {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    hasUpdate: false,
    updateObj: null,
    version: "",
    currentVersion: "",
    notes: "",
    status: "idle",
    progressBytes: 0,
    totalBytes: 0,
    errorMessage: "",
  });

  const isDownloadingRef = useRef(false);

  const startDownloadAndInstall = useCallback(async (updateInstance: Update) => {
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;

    setState((prev) => ({
      ...prev,
      status: "downloading",
      progressBytes: 0,
      totalBytes: 0,
      errorMessage: "",
    }));

    try {
      let downloaded = 0;
      let total = 0;

      await updateInstance.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
          setState((prev) => ({
            ...prev,
            status: "downloading",
            totalBytes: total,
          }));
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState((prev) => ({
            ...prev,
            status: "downloading",
            progressBytes: downloaded,
          }));
        } else if (event.event === "Finished") {
          setState((prev) => ({
            ...prev,
            status: "installing",
          }));
        }
      });

      setState((prev) => ({
        ...prev,
        status: "restarting",
      }));

      // Give user 1.2s visual feedback before relaunch
      setTimeout(async () => {
        try {
          await relaunch();
        } catch {
          await exit(0);
        }
      }, 1200);
    } catch (err: unknown) {
      isDownloadingRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: msg || "更新包下载或安装失败，可能是网络问题",
      }));
    }
  }, []);

  const checkForUpdates = useCallback(
    async (manual = false) => {
      if (state.isChecking || state.status === "downloading" || state.status === "installing") {
        return;
      }

      setState((prev) => ({
        ...prev,
        isChecking: true,
        errorMessage: "",
      }));

      try {
        const update = await check();

        if (update) {
          setState({
            isChecking: false,
            hasUpdate: true,
            updateObj: update,
            version: update.version,
            currentVersion: update.currentVersion,
            notes: update.body || "",
            status: "downloading",
            progressBytes: 0,
            totalBytes: 0,
            errorMessage: "",
          });

          // Mandatory auto-update: automatically begin downloading & installing
          void startDownloadAndInstall(update);
        } else {
          setState((prev) => ({
            ...prev,
            isChecking: false,
            hasUpdate: false,
            updateObj: null,
            status: "idle",
          }));
          if (manual) {
            toast.success("已是最新版本，无需更新");
          }
        }
      } catch (err: unknown) {
        setState((prev) => ({
          ...prev,
          isChecking: false,
        }));
        if (manual) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`检查更新失败: ${msg}`);
        }
      }
    },
    [state.isChecking, state.status, startDownloadAndInstall],
  );

  // Automatically check on mount
  useEffect(() => {
    void checkForUpdates(false);
  }, [checkForUpdates]);

  const handleRetry = useCallback(() => {
    if (state.updateObj) {
      void startDownloadAndInstall(state.updateObj);
    } else {
      void checkForUpdates(true);
    }
  }, [state.updateObj, startDownloadAndInstall, checkForUpdates]);

  const handleExit = useCallback(async () => {
    try {
      await exit(0);
    } catch {
      window.close();
    }
  }, []);

  return {
    state,
    checkForUpdates,
    handleRetry,
    handleExit,
  };
}

export function ForceUpdateModal({
  state,
  onRetry,
  onExit,
}: {
  state: UpdateState;
  onRetry: () => void;
  onExit: () => void;
}) {
  if (!state.hasUpdate) return null;

  const percent =
    state.totalBytes > 0
      ? Math.min(100, Math.round((state.progressBytes / state.totalBytes) * 100))
      : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl select-none"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 350, damping: 28 }}
          className="relative w-full max-w-md rounded-2xl border border-blue-500/30 bg-[#0f1322] text-slate-100 shadow-[0_20px_60px_-15px_rgba(30,58,138,0.5)] overflow-hidden"
        >
          {/* Top subtle glow decoration */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

          {/* Modal Header */}
          <div className="p-6 pb-4 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-blue-500/40 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-3">
              {state.status === "restarting" ? (
                <CheckCircle2 className="w-7 h-7 text-emerald-400 animate-bounce" />
              ) : state.status === "error" ? (
                <AlertTriangle className="w-7 h-7 text-amber-400" />
              ) : (
                <DownloadCloud className="w-7 h-7 text-blue-400 animate-pulse" />
              )}
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide bg-blue-500/10 border border-blue-500/30 text-blue-400 mb-2">
              <Sparkles size={12} />
              发现强制性更新
            </div>

            <h2 className="text-lg font-bold text-white tracking-tight">
              客户端正在自动更新
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              为了保障软件正常运行，新版本必须下载安装完成后方可继续使用。
            </p>

            {/* Version Badge Comparison */}
            <div className="flex items-center justify-center gap-2 mt-3 font-mono text-xs bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl">
              <span className="text-slate-400">v{state.currentVersion || "1.0.1"}</span>
              <span className="text-slate-600">→</span>
              <span className="text-emerald-400 font-bold">v{state.version}</span>
            </div>
          </div>

          {/* Release Notes */}
          {state.notes && (
            <div className="px-6 py-2">
              <div className="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-black/40 border border-white/5 p-2.5 rounded-xl whitespace-pre-wrap leading-relaxed">
                <span className="font-semibold text-slate-300 block mb-0.5">更新内容：</span>
                {state.notes}
              </div>
            </div>
          )}

          {/* Progress / Status Area */}
          <div className="p-6 pt-3 space-y-4">
            {state.status === "downloading" && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    <RefreshCw size={13} className="animate-spin text-blue-400" />
                    正在下载更新资源...
                  </span>
                  <span className="font-mono text-blue-400 font-semibold">
                    {percent > 0 ? `${percent}%` : "连接中..."}
                  </span>
                </div>

                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative">
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                    style={{ width: `${Math.max(percent, 5)}%` }}
                    transition={{ ease: "easeOut", duration: 0.2 }}
                  />
                </div>

                <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                  <span>已下载: {formatBytes(state.progressBytes)}</span>
                  <span>总大小: {formatBytes(state.totalBytes)}</span>
                </div>
              </div>
            )}

            {state.status === "installing" && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-indigo-300 font-medium bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                <RefreshCw size={14} className="animate-spin text-indigo-400" />
                更新包下载完成，正在校验并安装...
              </div>
            )}

            {state.status === "restarting" && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-emerald-300 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle2 size={15} className="text-emerald-400" />
                安装完成，客户端即将自动重启...
              </div>
            )}

            {state.status === "error" && (
              <div className="space-y-3">
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-left">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400 mb-1">
                    <AlertTriangle size={14} />
                    更新下载失败
                  </div>
                  <p className="text-[11px] text-red-300/80 leading-relaxed break-words">
                    {state.errorMessage || "网络连接超时或无法直连 GitHub，请检查网络或开启科学代理"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onRetry}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all active:scale-95"
                  >
                    <RefreshCw size={13} />
                    重试下载
                  </button>

                  <a
                    href={GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs transition-colors"
                    title="在浏览器中手动下载新版安装包"
                  >
                    <ExternalLink size={13} />
                    手动下载
                  </a>

                  <button
                    onClick={onExit}
                    className="flex items-center justify-center p-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-300 border border-white/10 text-slate-400 transition-colors"
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

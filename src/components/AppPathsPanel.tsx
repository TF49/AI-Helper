import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FolderGit2,
  RefreshCw,
  Search,
  FolderOpen,
  Play,
  Save,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Terminal,
  Loader2,
  Bot,
} from "lucide-react";
import {
  browseAppPath,
  checkAppProcessStatus,
  detectAllAppPaths,
  detectAppPath,
  getAppPaths,
  restartTargetApp,
  saveAppPaths,
} from "../lib/api";
import type { AppPathsConfig, DetectedPathInfo } from "../types";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";

export function AppPathsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detectingAll, setDetectingAll] = useState(false);

  // 路径状态
  const [claudePath, setClaudePath] = useState("");
  const [codexPath, setCodexPath] = useState("");
  const [chatgptPath, setChatgptPath] = useState("");

  // 运行与探测状态
  const [claudeInfo, setClaudeInfo] = useState<DetectedPathInfo | null>(null);
  const [codexInfo, setCodexInfo] = useState<DetectedPathInfo | null>(null);
  const [chatgptInfo, setChatgptInfo] = useState<DetectedPathInfo | null>(null);

  const [claudeRunning, setClaudeRunning] = useState(false);
  const [codexRunning, setCodexRunning] = useState(false);
  const [chatgptRunning, setChatgptRunning] = useState(false);

  const [detectingType, setDetectingType] = useState<string | null>(null);
  const [launchingType, setLaunchingType] = useState<string | null>(null);

  const refreshTimersRef = useRef<Record<string, number>>({});

  // 加载已保存配置与探测运行状态
  const loadInitialData = async () => {
    setLoading(true);
    try {
      const saved = await getAppPaths();
      setClaudePath(saved.claude_cli_path || "");
      setCodexPath(saved.codex_cli_path || "");
      setChatgptPath(saved.chatgpt_client_path || "");

      // 并发检查当前运行状态
      const [cRun, xRun, gRun] = await Promise.all([
        checkAppProcessStatus("claude").catch(() => false),
        checkAppProcessStatus("codex").catch(() => false),
        checkAppProcessStatus("chatgpt").catch(() => false),
      ]);
      setClaudeRunning(cRun);
      setCodexRunning(xRun);
      setChatgptRunning(gRun);
    } catch (err) {
      toast.error(`读取路径配置失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInitialData();
    return () => {
      Object.values(refreshTimersRef.current).forEach((id) => clearTimeout(id));
      refreshTimersRef.current = {};
    };
  }, []);

  // 单项自动探测
  const handleDetectSingle = async (type: "claude" | "codex" | "chatgpt") => {
    setDetectingType(type);
    try {
      const info = await detectAppPath(type);
      if (type === "claude") {
        setClaudeInfo(info);
        if (info.path) setClaudePath(info.path);
        setClaudeRunning(info.is_running);
      } else if (type === "codex") {
        setCodexInfo(info);
        if (info.path) setCodexPath(info.path);
        setCodexRunning(info.is_running);
      } else if (type === "chatgpt") {
        setChatgptInfo(info);
        if (info.path) setChatgptPath(info.path);
        setChatgptRunning(info.is_running);
      }

      if (info.exists && info.path) {
        toast.success(
          `成功探测到 ${type.toUpperCase()} 路径: ${info.extra_info || "已就绪"}`,
        );
      } else {
        toast.warning(`未在标准路径或环境变量中自动检测到 ${type.toUpperCase()}`);
      }
    } catch (err) {
      toast.error(`探测失败: ${err}`);
    } finally {
      setDetectingType(null);
    }
  };

  // 全量一键自动探测
  const handleDetectAll = async () => {
    setDetectingAll(true);
    try {
      const results = await detectAllAppPaths();
      for (const info of results) {
        if (info.app_type === "claude") {
          setClaudeInfo(info);
          if (info.path) setClaudePath(info.path);
          setClaudeRunning(info.is_running);
        } else if (info.app_type === "codex") {
          setCodexInfo(info);
          if (info.path) setCodexPath(info.path);
          setCodexRunning(info.is_running);
        } else if (info.app_type === "chatgpt") {
          setChatgptInfo(info);
          if (info.path) setChatgptPath(info.path);
          setChatgptRunning(info.is_running);
        }
      }
      toast.success("已完成全部应用与 CLI 路径深度探测！");
    } catch (err) {
      toast.error(`全量探测失败: ${err}`);
    } finally {
      setDetectingAll(false);
    }
  };

  // 浏览选择文件
  const handleBrowse = async (type: "claude" | "codex" | "chatgpt") => {
    try {
      const selected = await browseAppPath(type);
      if (selected) {
        if (type === "claude") setClaudePath(selected);
        if (type === "codex") setCodexPath(selected);
        if (type === "chatgpt") setChatgptPath(selected);
        toast.success(`已选择路径: ${selected}`);
      }
    } catch (err) {
      toast.error(`选择文件失败: ${err}`);
    }
  };

  // 保存所有路径配置
  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const cfg: AppPathsConfig = {
        claude_cli_path: claudePath.trim() || null,
        codex_cli_path: codexPath.trim() || null,
        chatgpt_client_path: chatgptPath.trim() || null,
      };
      await saveAppPaths(cfg);
      toast.success("安装路径配置已保存至 ~/.ai-helper/app_paths.json");
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  // 测试启动 / 重启目标
  const handleLaunchOrRestart = async (type: "claude" | "codex" | "chatgpt") => {
    setLaunchingType(type);
    try {
      const custom =
        type === "claude"
          ? claudePath
          : type === "codex"
            ? codexPath
            : chatgptPath;

      const result = await restartTargetApp(type, custom || undefined);
      toast.success(result);

      // 清理旧计时器并稍后刷新运行状态
      if (refreshTimersRef.current[type]) {
        clearTimeout(refreshTimersRef.current[type]);
      }

      refreshTimersRef.current[type] = window.setTimeout(async () => {
        const isRun = await checkAppProcessStatus(type).catch(() => false);
        if (type === "claude") setClaudeRunning(isRun);
        if (type === "codex") setCodexRunning(isRun);
        if (type === "chatgpt") setChatgptRunning(isRun);
        delete refreshTimersRef.current[type];
      }, 1000);
    } catch (err) {
      toast.error(`启动/重启失败: ${err}`);
    } finally {
      setLaunchingType(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-blue-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取应用与 CLI 路径信息...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col justify-between min-h-0 gap-5 pb-2">
      {/* ── 顶部面板标题栏与快速概览 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-600 border border-teal-200 dark:bg-teal-500/20 dark:text-teal-400 dark:border-teal-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <FolderGit2 size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                应用与 CLI 安装路径管理
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30">
                Process & Path Discovery
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              自动探测、指定与验证 Claude CLI、Codex CLI 及 ChatGPT 桌面端可执行程序路径，保障重启与唤醒顺畅
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDetectAll}
            disabled={detectingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-teal-50 hover:bg-teal-100/80 border-teal-200 text-teal-700 dark:bg-teal-500/10 dark:hover:bg-teal-500/20 dark:border-teal-500/30 dark:text-teal-300 shadow-2xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title="一键全局深度探测所有已安装客户端"
          >
            <Search size={13} className={detectingAll ? "animate-spin" : ""} />
            <span>{detectingAll ? "深度扫描中..." : "一键全量探测"}</span>
          </button>
          <button
            type="button"
            onClick={loadInitialData}
            disabled={loading || detectingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title="重新载入本地保存的路径配置"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "载入中..." : "重新载入"}</span>
          </button>
        </div>
      </div>

      {/* ── 主配置列表 ── */}
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-1 min-h-0">
        {/* 卡片 1: Claude Code CLI */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
          spotlightColor="rgba(168, 85, 247, 0.12)"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Claude Code CLI 启动路径
                    </span>
                    {claudeRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.2 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        运行中
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500 font-mono">
                    npm 全局脚本 (claude.cmd / claude)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {claudePath ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={13} />
                    <span>已就绪</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle size={13} />
                    <span>待配置</span>
                  </span>
                )}
              </div>
            </div>

            {/* 路径输入框与操作按键 */}
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={claudePath}
                  onChange={(e) => setClaudePath(e.target.value)}
                  placeholder="例如: C:\Users\Administrator\AppData\Roaming\npm\claude.cmd"
                  className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => void handleDetectSingle("claude")}
                  disabled={detectingType === "claude"}
                  className="px-2.5 py-1.5 rounded-lg border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="自动探测 Claude CLI 路径"
                >
                  <Search size={12} className={detectingType === "claude" ? "animate-spin" : ""} />
                  <span>探测</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleBrowse("claude")}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  title="通过文件管理器浏览路径"
                >
                  <FolderOpen size={12} />
                  <span>浏览</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleLaunchOrRestart("claude")}
                  disabled={launchingType === "claude"}
                  className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="在独立终端窗口启动/重启测试"
                >
                  <Play size={12} className={launchingType === "claude" ? "animate-spin" : ""} />
                  <span>测试启动</span>
                </button>
              </div>
            </div>

            {claudeInfo?.extra_info && (
              <div className="text-[11px] text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-100 dark:border-purple-500/20">
                💡 {claudeInfo.extra_info}
              </div>
            )}
          </div>
        </SpotlightCard>

        {/* 卡片 2: Codex CLI */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
          spotlightColor="rgba(59, 130, 246, 0.12)"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                  <Terminal size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Codex CLI 启动路径
                    </span>
                    {codexRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.2 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        运行中
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500 font-mono">
                    npm 全局脚本 (codex.cmd / codex)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {codexPath ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={13} />
                    <span>已就绪</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle size={13} />
                    <span>待配置</span>
                  </span>
                )}
              </div>
            </div>

            {/* 路径输入框与操作按键 */}
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={codexPath}
                  onChange={(e) => setCodexPath(e.target.value)}
                  placeholder="例如: C:\Users\Administrator\AppData\Roaming\npm\codex.cmd"
                  className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => void handleDetectSingle("codex")}
                  disabled={detectingType === "codex"}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="自动探测 Codex CLI 路径"
                >
                  <Search size={12} className={detectingType === "codex" ? "animate-spin" : ""} />
                  <span>探测</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleBrowse("codex")}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  title="通过文件管理器浏览路径"
                >
                  <FolderOpen size={12} />
                  <span>浏览</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleLaunchOrRestart("codex")}
                  disabled={launchingType === "codex"}
                  className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="在独立终端窗口启动/重启测试"
                >
                  <Play size={12} className={launchingType === "codex" ? "animate-spin" : ""} />
                  <span>测试启动</span>
                </button>
              </div>
            </div>

            {codexInfo?.extra_info && (
              <div className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-500/10 px-2.5 py-1 rounded-lg border border-blue-100 dark:border-blue-500/20">
                💡 {codexInfo.extra_info}
              </div>
            )}
          </div>
        </SpotlightCard>

        {/* 卡片 3: ChatGPT 桌面客户端 */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
          spotlightColor="rgba(16, 185, 129, 0.12)"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <Bot size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      ChatGPT 桌面客户端路径
                    </span>
                    {chatgptRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        运行中
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500 font-mono">
                    WindowsApps (OpenAI.Codex) / Win32 可执行程序 (ChatGPT.exe)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {chatgptPath ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={13} />
                    <span>已就绪</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle size={13} />
                    <span>待配置</span>
                  </span>
                )}
              </div>
            </div>

            {/* 路径输入框与操作按键 */}
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={chatgptPath}
                  onChange={(e) => setChatgptPath(e.target.value)}
                  placeholder="例如: C:\Program Files\WindowsApps\OpenAI.Codex_...\app\ChatGPT.exe"
                  className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => void handleDetectSingle("chatgpt")}
                  disabled={detectingType === "chatgpt"}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="自动探测 ChatGPT 客户端安装路径"
                >
                  <Search size={12} className={detectingType === "chatgpt" ? "animate-spin" : ""} />
                  <span>探测</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleBrowse("chatgpt")}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  title="通过文件管理器浏览路径"
                >
                  <FolderOpen size={12} />
                  <span>浏览</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleLaunchOrRestart("chatgpt")}
                  disabled={launchingType === "chatgpt"}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="静默重启或拉起客户端"
                >
                  <Play size={12} className={launchingType === "chatgpt" ? "animate-spin" : ""} />
                  <span>{chatgptRunning ? "重启客户端" : "启动客户端"}</span>
                </button>
              </div>
            </div>

            {chatgptInfo?.extra_info && (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-100 dark:border-emerald-500/20">
                💡 {chatgptInfo.extra_info}
              </div>
            )}
          </div>
        </SpotlightCard>
      </div>

      {/* ── 底部保存栏 ── */}
      <div className="pt-2 flex-shrink-0">
        <StarBorder
          className="w-full shadow-md"
          color="#0d9488"
          speed="3.5s"
          onClick={handleSaveAll}
          disabled={saving}
          innerClassName="bg-teal-600 hover:bg-teal-700 text-white dark:bg-[#0c1a1a] dark:text-teal-100 py-3 cursor-pointer"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            {saving ? (
              <Loader2 size={18} className="animate-spin text-white" />
            ) : (
              <Save size={18} className="text-white dark:text-teal-300" />
            )}
            <span className="text-sm">保存应用与 CLI 路径设置</span>
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          保存后在完成模型连通性测试并应用配置时，系统将使用上述路径进行针对性的重启与拉起
        </p>
      </div>
    </div>
  );
}

export default AppPathsPanel;

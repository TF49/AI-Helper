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
  Terminal,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  DownloadCloud,
} from "lucide-react";
import { ClaudeIcon, OpenAIIcon, WorkbuddyIcon } from "./BrandIcons";
import {
  browseAppPath,
  checkAppProcessStatus,
  detectAllAppPaths,
  detectAppPath,
  executeInTerminal,
  getAppPaths,
  openUrl,
  restartTargetApp,
  saveAppPaths,
} from "../lib/api";
import { cn } from "../lib/utils";
import type { AppPathsConfig, DetectedPathInfo } from "../types";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";

export interface CliInstallOption {
  id: string;
  name: string;
  badge?: string;
  command: string;
  desc: string;
  recommended?: boolean;
}

export const CLAUDE_INSTALL_OPTIONS: CliInstallOption[] = [
  {
    id: "npm_latest",
    name: "npm 官方推荐",
    badge: "推荐",
    command: "npm i -g @anthropic-ai/claude-code",
    desc: "Anthropic 官方推荐全局安装命令 (要求系统已配置 Node.js 18+ 环境)",
    recommended: true,
  },
  {
    id: "curl_native",
    name: "macOS/Linux 原生脚本",
    command: "curl -fsSL https://claude.ai/install.sh | bash",
    desc: "Anthropic 官方针对 Unix/macOS/Linux 的一键安装脚本 (macOS 也可使用 brew install claude-code)",
  },
];

export const CODEX_INSTALL_OPTIONS: CliInstallOption[] = [
  {
    id: "npm_latest",
    name: "npm 官方推荐",
    badge: "推荐",
    command: "npm i -g @openai/codex",
    desc: "OpenAI 官方 Codex CLI 全局安装命令 (要求系统已配置 Node.js 18+ 环境)",
    recommended: true,
  },
  {
    id: "brew_mac",
    name: "macOS Homebrew",
    command: "brew install codex",
    desc: "macOS 环境下使用 Homebrew 官方包管理器进行安装与管理",
  },
];

export const NODE_CHECK_COMMANDS = [
  {
    id: "node_version",
    name: "检查 Node.js 版本 (要求 >= 18 LTS)",
    command: "node -v",
    desc: "验证系统中是否已安装 Node.js 运行环境及其版本号",
  },
  {
    id: "npm_version",
    name: "检查 npm 包管理器",
    command: "npm -v",
    desc: "验证 npm 全局包管理工具是否可用",
  },
];

export function AppPathsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detectingAll, setDetectingAll] = useState(false);

  // 路径状态
  const [claudePath, setClaudePath] = useState("");
  const [codexPath, setCodexPath] = useState("");
  const [chatgptPath, setChatgptPath] = useState("");
  const [workbuddyPath, setWorkbuddyPath] = useState("");

  // 运行与探测状态
  const [claudeInfo, setClaudeInfo] = useState<DetectedPathInfo | null>(null);
  const [codexInfo, setCodexInfo] = useState<DetectedPathInfo | null>(null);
  const [chatgptInfo, setChatgptInfo] = useState<DetectedPathInfo | null>(null);
  const [workbuddyInfo, setWorkbuddyInfo] = useState<DetectedPathInfo | null>(
    null,
  );

  const [claudeRunning, setClaudeRunning] = useState(false);
  const [codexRunning, setCodexRunning] = useState(false);
  const [chatgptRunning, setChatgptRunning] = useState(false);
  const [workbuddyRunning, setWorkbuddyRunning] = useState(false);

  const [detectingType, setDetectingType] = useState<string | null>(null);
  const [launchingType, setLaunchingType] = useState<string | null>(null);

  // 手动安装与命令管理状态
  const [showManualInstallGuide, setShowManualInstallGuide] = useState(false);
  const [guideActiveTab, setGuideActiveTab] = useState<
    "claude" | "codex" | "nodejs"
  >("claude");
  const [expandedCardInstall, setExpandedCardInstall] = useState<
    "claude" | "codex" | null
  >(null);
  const [claudeSelectedInstallOption, setClaudeSelectedInstallOption] =
    useState("npm_latest");
  const [codexSelectedInstallOption, setCodexSelectedInstallOption] =
    useState("npm_latest");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [runningCmd, setRunningCmd] = useState<string | null>(null);

  const refreshTimersRef = useRef<Record<string, number>>({});
  const topGuideRef = useRef<HTMLDivElement>(null);
  const claudeDrawerRef = useRef<HTMLDivElement>(null);
  const codexDrawerRef = useRef<HTMLDivElement>(null);

  // 展开抽屉时自动平滑滚动以确保完整命令面板可见，避免被视口截断
  useEffect(() => {
    if (expandedCardInstall === "claude") {
      requestAnimationFrame(() => {
        claudeDrawerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    } else if (expandedCardInstall === "codex") {
      requestAnimationFrame(() => {
        codexDrawerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }
  }, [expandedCardInstall]);

  useEffect(() => {
    if (showManualInstallGuide) {
      requestAnimationFrame(() => {
        topGuideRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }
  }, [showManualInstallGuide]);

  // 加载已保存配置与探测运行状态
  const loadInitialData = async () => {
    setLoading(true);
    try {
      const saved = await getAppPaths();
      setClaudePath(saved.claude_cli_path || "");
      setCodexPath(saved.codex_cli_path || "");
      setChatgptPath(saved.chatgpt_client_path || "");
      setWorkbuddyPath(saved.workbuddy_client_path || "");

      // 并发检查当前运行状态
      const [cRun, xRun, gRun, wbRun] = await Promise.all([
        checkAppProcessStatus("claude").catch(() => false),
        checkAppProcessStatus("codex").catch(() => false),
        checkAppProcessStatus("chatgpt").catch(() => false),
        checkAppProcessStatus("workbuddy").catch(() => false),
      ]);
      setClaudeRunning(cRun);
      setCodexRunning(xRun);
      setChatgptRunning(gRun);
      setWorkbuddyRunning(wbRun);
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
  const handleDetectSingle = async (
    type: "claude" | "codex" | "chatgpt" | "workbuddy",
  ) => {
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
      } else if (type === "workbuddy") {
        setWorkbuddyInfo(info);
        if (info.path) setWorkbuddyPath(info.path);
        setWorkbuddyRunning(info.is_running);
      }

      if (info.exists && info.path) {
        toast.success(
          `成功探测到 ${type.toUpperCase()} 路径: ${info.extra_info || "已就绪"}`,
        );
      } else {
        toast.warning(
          `未在标准路径或环境变量中自动检测到 ${type.toUpperCase()}`,
        );
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
        } else if (info.app_type === "workbuddy") {
          setWorkbuddyInfo(info);
          if (info.path) setWorkbuddyPath(info.path);
          setWorkbuddyRunning(info.is_running);
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
  const handleBrowse = async (
    type: "claude" | "codex" | "chatgpt" | "workbuddy",
  ) => {
    try {
      const selected = await browseAppPath(type);
      if (selected) {
        if (type === "claude") setClaudePath(selected);
        if (type === "codex") setCodexPath(selected);
        if (type === "chatgpt") setChatgptPath(selected);
        if (type === "workbuddy") setWorkbuddyPath(selected);
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
        workbuddy_client_path: workbuddyPath.trim() || null,
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
  const handleLaunchOrRestart = async (
    type: "claude" | "codex" | "chatgpt" | "workbuddy",
  ) => {
    setLaunchingType(type);
    try {
      const custom =
        type === "claude"
          ? claudePath
          : type === "codex"
            ? codexPath
            : type === "workbuddy"
              ? workbuddyPath
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
        if (type === "workbuddy") setWorkbuddyRunning(isRun);
        delete refreshTimersRef.current[type];
      }, 1000);
    } catch (err) {
      toast.error(`启动/重启失败: ${err}`);
    } finally {
      setLaunchingType(null);
    }
  };

  // 复制安装命令至剪贴板
  const handleCopyCommand = async (text: string, id: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(`已复制 ${label} 命令到剪贴板！`);
      setTimeout(() => {
        setCopiedId((curr) => (curr === id ? null : curr));
      }, 2000);
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  // 在独立终端窗口中自动运行安装命令
  const handleRunInTerminal = async (command: string, label: string) => {
    setRunningCmd(command);
    try {
      toast.info(`正在打开终端执行 ${label}...`);
      const res = await executeInTerminal(command);
      toast.success(res);
    } catch (err) {
      toast.error(`终端执行失败: ${err}`);
    } finally {
      setRunningCmd(null);
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
              自动探测、指定与验证 Claude CLI、Codex CLI 及 ChatGPT
              桌面端可执行程序路径，保障重启与唤醒顺畅
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowManualInstallGuide((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shadow-2xs cursor-pointer",
              showManualInstallGuide
                ? "bg-purple-600 text-white border-purple-600 dark:bg-purple-600"
                : "bg-purple-50 hover:bg-purple-100/80 border-purple-200 text-purple-700 dark:bg-purple-500/10 dark:hover:bg-purple-500/20 dark:border-purple-500/30 dark:text-purple-300",
            )}
            title="展开/折叠 CLI 手动安装与更新命令中心"
          >
            <Terminal size={13} />
            <span>手动安装命令</span>
            {showManualInstallGuide ? (
              <ChevronUp size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>
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
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-1 pb-2 min-h-0 scroll-smooth">
        {/* ── CLI 手动安装与更新命令中心 ── */}
        {showManualInstallGuide && (
          <div ref={topGuideRef} className="flex-shrink-0 min-h-fit">
            <SpotlightCard
              className="p-5 rounded-2xl border border-purple-300/80 dark:border-purple-500/30 bg-purple-50/30 dark:bg-[#15132a]/80 shadow-md animate-fade-in flex-shrink-0 min-h-fit"
              spotlightColor="rgba(168, 85, 247, 0.15)"
            >
              <div className="flex flex-col gap-4">
                {/* 标题栏 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-purple-200/60 dark:border-purple-500/20">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                      <Terminal size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          CLI 手动安装与更新命令中心
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        支持官方 CLI
                        推荐安装命令一键复制及在终端直接运行安装与版本更新
                      </p>
                    </div>
                  </div>

                  {/* 选项卡切换: Claude / Codex / Node.js 运行环境 */}
                  <div className="flex items-center gap-1 p-0.5 rounded-xl bg-purple-100/60 dark:bg-black/40 border border-purple-200/60 dark:border-white/10 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setGuideActiveTab("claude")}
                      className={cn(
                        "px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                        guideActiveTab === "claude"
                          ? "bg-purple-600 text-white shadow-xs"
                          : "text-slate-700 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-white/5",
                      )}
                    >
                      Claude Code
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuideActiveTab("codex")}
                      className={cn(
                        "px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                        guideActiveTab === "codex"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-700 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-white/5",
                      )}
                    >
                      Codex CLI
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuideActiveTab("nodejs")}
                      className={cn(
                        "px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                        guideActiveTab === "nodejs"
                          ? "bg-teal-600 text-white shadow-xs"
                          : "text-slate-700 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-white/5",
                      )}
                    >
                      运行环境检测
                    </button>
                  </div>
                </div>

                {/* 选项卡内容: Claude Code */}
                {guideActiveTab === "claude" && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-gray-400">
                      <span>
                        官方包名:{" "}
                        <code className="font-mono text-purple-600 dark:text-purple-400 select-text">
                          @anthropic-ai/claude-code
                        </code>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDetectSingle("claude")}
                        disabled={detectingType === "claude"}
                        className="text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-60"
                      >
                        <Search
                          size={11}
                          className={
                            detectingType === "claude" ? "animate-spin" : ""
                          }
                        />
                        <span>检测本地是否已就绪</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {CLAUDE_INSTALL_OPTIONS.map((opt) => (
                        <div
                          key={opt.id}
                          className="p-2.5 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-black/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {opt.name}
                              </span>
                              {opt.badge && (
                                <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30">
                                  {opt.badge}
                                </span>
                              )}
                              <span className="text-[11px] text-slate-500 dark:text-gray-400 truncate">
                                {opt.desc}
                              </span>
                            </div>
                            <div className="px-2 py-1 rounded-lg bg-slate-900 dark:bg-black/70 text-purple-300 font-mono text-xs overflow-x-auto select-text">
                              <code>{opt.command}</code>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0 justify-end self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyCommand(
                                  opt.command,
                                  `guide_claude_${opt.id}`,
                                  "Claude Code 安装命令",
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 flex items-center gap-1 transition-colors cursor-pointer"
                              title="复制完整命令到剪贴板"
                            >
                              {copiedId === `guide_claude_${opt.id}` ? (
                                <>
                                  <Check
                                    size={12}
                                    className="text-emerald-500"
                                  />
                                  <span className="text-emerald-500">
                                    已复制
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} />
                                  <span>复制</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleRunInTerminal(
                                  opt.command,
                                  "Claude Code 安装命令",
                                )
                              }
                              disabled={runningCmd === opt.command}
                              className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                              title="在独立控制台终端中拉起并自动执行"
                            >
                              <Play
                                size={11}
                                className={
                                  runningCmd === opt.command
                                    ? "animate-spin"
                                    : ""
                                }
                              />
                              <span>在终端运行</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 选项卡内容: Codex CLI */}
                {guideActiveTab === "codex" && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-gray-400">
                      <span>
                        官方包名:{" "}
                        <code className="font-mono text-blue-600 dark:text-blue-400 select-text">
                          @openai/codex
                        </code>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDetectSingle("codex")}
                        disabled={detectingType === "codex"}
                        className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-60"
                      >
                        <Search
                          size={11}
                          className={
                            detectingType === "codex" ? "animate-spin" : ""
                          }
                        />
                        <span>检测本地是否已就绪</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {CODEX_INSTALL_OPTIONS.map((opt) => (
                        <div
                          key={opt.id}
                          className="p-2.5 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-black/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {opt.name}
                              </span>
                              {opt.badge && (
                                <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30">
                                  {opt.badge}
                                </span>
                              )}
                              <span className="text-[11px] text-slate-500 dark:text-gray-400 truncate">
                                {opt.desc}
                              </span>
                            </div>
                            <div className="px-2 py-1 rounded-lg bg-slate-900 dark:bg-black/70 text-blue-300 font-mono text-xs overflow-x-auto select-text">
                              <code>{opt.command}</code>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0 justify-end self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyCommand(
                                  opt.command,
                                  `guide_codex_${opt.id}`,
                                  "Codex CLI 安装命令",
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 flex items-center gap-1 transition-colors cursor-pointer"
                              title="复制完整命令到剪贴板"
                            >
                              {copiedId === `guide_codex_${opt.id}` ? (
                                <>
                                  <Check
                                    size={12}
                                    className="text-emerald-500"
                                  />
                                  <span className="text-emerald-500">
                                    已复制
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} />
                                  <span>复制</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleRunInTerminal(
                                  opt.command,
                                  "Codex CLI 安装命令",
                                )
                              }
                              disabled={runningCmd === opt.command}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                              title="在独立控制台终端中拉起并自动执行"
                            >
                              <Play
                                size={11}
                                className={
                                  runningCmd === opt.command
                                    ? "animate-spin"
                                    : ""
                                }
                              />
                              <span>在终端运行</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 选项卡内容: Node.js 运行环境 */}
                {guideActiveTab === "nodejs" && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl border border-teal-200 dark:border-teal-500/20 bg-teal-50/40 dark:bg-teal-950/20 text-xs text-slate-700 dark:text-gray-300 space-y-1.5">
                      <div className="font-semibold text-teal-800 dark:text-teal-300 flex items-center gap-1.5">
                        <span>📌 Node.js 运行环境要求</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        Claude Code 与 Codex CLI 基于 Node.js
                        全局模块运行，系统必须预先安装{" "}
                        <strong>Node.js 18.0.0 LTS 或更高版本</strong>。
                        安装完成后即可在终端直接执行 npm 全局安装命令。
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {NODE_CHECK_COMMANDS.map((item) => (
                        <div
                          key={item.id}
                          className="p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/30 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-900 dark:text-white">
                              {item.name}
                            </div>
                            <code className="text-xs font-mono text-teal-600 dark:text-teal-400 select-text">
                              {item.command}
                            </code>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyCommand(
                                  item.command,
                                  item.id,
                                  item.name,
                                )
                              }
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-gray-300 cursor-pointer"
                              title="复制检查命令"
                            >
                              {copiedId === item.id ? (
                                <Check size={12} className="text-emerald-500" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleRunInTerminal(
                                  item.command,
                                  item.name,
                                )
                              }
                              className="p-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white cursor-pointer"
                              title="在终端运行测试命令"
                            >
                              <Play size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-slate-500 dark:text-gray-400">
                        尚未安装 Node.js？建议直接前往 Node.js 官方网站下载安装
                        LTS 稳定版
                      </span>
                      <button
                        type="button"
                        onClick={() => void openUrl("https://nodejs.org/")}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium transition-colors cursor-pointer"
                      >
                        <span>下载 Node.js LTS 官网安装包</span>
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </SpotlightCard>
          </div>
        )}

        {/* 卡片 1: Claude Code CLI */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-shrink-0 min-h-fit"
          spotlightColor="rgba(168, 85, 247, 0.12)"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                  <ClaudeIcon size={16} />
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
                  onClick={() =>
                    setExpandedCardInstall((v) =>
                      v === "claude" ? null : "claude",
                    )
                  }
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors",
                    expandedCardInstall === "claude"
                      ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                      : "border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300",
                  )}
                  title="查看/展开 Claude Code 手动安装与更新命令"
                >
                  <DownloadCloud size={12} />
                  <span>安装命令</span>
                  {expandedCardInstall === "claude" ? (
                    <ChevronUp size={11} />
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void handleDetectSingle("claude")}
                  disabled={detectingType === "claude"}
                  className="px-2.5 py-1.5 rounded-lg border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="自动探测 Claude CLI 路径"
                >
                  <Search
                    size={12}
                    className={detectingType === "claude" ? "animate-spin" : ""}
                  />
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
                  <Play
                    size={12}
                    className={launchingType === "claude" ? "animate-spin" : ""}
                  />
                  <span>测试启动</span>
                </button>
              </div>
            </div>

            {/* Claude 卡片专属手动安装命令抽屉 */}
            {expandedCardInstall === "claude" && (
              <div
                ref={claudeDrawerRef}
                className="p-3.5 rounded-xl border border-purple-200/80 dark:border-purple-500/20 bg-purple-50/40 dark:bg-purple-950/20 space-y-3 animate-fade-in"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-900 dark:text-purple-300">
                    <Terminal
                      size={13}
                      className="text-purple-600 dark:text-purple-400"
                    />
                    <span>Claude Code 手动安装与版本更新</span>
                  </div>
                </div>

                {/* 安装方式切换胶囊 */}
                <div className="flex flex-wrap gap-1.5">
                  {CLAUDE_INSTALL_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setClaudeSelectedInstallOption(opt.id)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1",
                        claudeSelectedInstallOption === opt.id
                          ? "bg-purple-600 text-white shadow-xs"
                          : "bg-white/80 dark:bg-white/5 border border-purple-200/60 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-purple-100/50 dark:hover:bg-white/10",
                      )}
                    >
                      <span>{opt.name}</span>
                      {opt.badge && (
                        <span
                          className={cn(
                            "text-[9px] px-1 py-0.2 rounded",
                            claudeSelectedInstallOption === opt.id
                              ? "bg-purple-700 text-white"
                              : "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
                          )}
                        >
                          {opt.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* 选中的命令展示与终端执行 */}
                {(() => {
                  const selected =
                    CLAUDE_INSTALL_OPTIONS.find(
                      (o) => o.id === claudeSelectedInstallOption,
                    ) || CLAUDE_INSTALL_OPTIONS[0];
                  return (
                    <div className="space-y-2">
                      <p className="text-[11px] text-slate-600 dark:text-gray-400">
                        {selected.desc}
                      </p>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 rounded-xl bg-slate-900 dark:bg-black/60 border border-slate-700/60 text-slate-100">
                        <div className="flex-1 font-mono text-xs overflow-x-auto py-1 px-1.5 text-purple-300 select-text">
                          <code>{selected.command}</code>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0 justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyCommand(
                                selected.command,
                                `card_claude_${selected.id}`,
                                "Claude Code 安装命令",
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                            title="复制命令至剪贴板"
                          >
                            {copiedId === `card_claude_${selected.id}` ? (
                              <>
                                <Check size={12} className="text-emerald-400" />
                                <span className="text-emerald-400">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy size={12} />
                                <span>复制</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void handleRunInTerminal(
                                selected.command,
                                "Claude Code 安装命令",
                              )
                            }
                            disabled={runningCmd === selected.command}
                            className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                            title="在独立 CMD 窗口中运行此安装命令"
                          >
                            <Play
                              size={11}
                              className={
                                runningCmd === selected.command
                                  ? "animate-spin"
                                  : ""
                              }
                            />
                            <span>在终端运行</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDetectSingle("claude")}
                            disabled={detectingType === "claude"}
                            className="px-2.5 py-1 rounded-lg border border-purple-400/40 hover:bg-purple-500/20 text-purple-300 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                            title="安装完成后立即重新探测路径"
                          >
                            <Search
                              size={11}
                              className={
                                detectingType === "claude" ? "animate-spin" : ""
                              }
                            />
                            <span>探测就绪</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {claudeInfo?.extra_info && (
              <div className="text-[11px] text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-100 dark:border-purple-500/20">
                💡 {claudeInfo.extra_info}
              </div>
            )}
          </div>
        </SpotlightCard>

        {/* 卡片 2: Codex CLI */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-shrink-0 min-h-fit"
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
                  onClick={() =>
                    setExpandedCardInstall((v) =>
                      v === "codex" ? null : "codex",
                    )
                  }
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors",
                    expandedCardInstall === "codex"
                      ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                      : "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
                  )}
                  title="查看/展开 Codex CLI 手动安装与更新命令"
                >
                  <DownloadCloud size={12} />
                  <span>安装命令</span>
                  {expandedCardInstall === "codex" ? (
                    <ChevronUp size={11} />
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void handleDetectSingle("codex")}
                  disabled={detectingType === "codex"}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="自动探测 Codex CLI 路径"
                >
                  <Search
                    size={12}
                    className={detectingType === "codex" ? "animate-spin" : ""}
                  />
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
                  <Play
                    size={12}
                    className={launchingType === "codex" ? "animate-spin" : ""}
                  />
                  <span>测试启动</span>
                </button>
              </div>
            </div>

            {/* Codex 卡片专属手动安装命令抽屉 */}
            {expandedCardInstall === "codex" && (
              <div
                ref={codexDrawerRef}
                className="p-3.5 rounded-xl border border-blue-200/80 dark:border-blue-500/20 bg-blue-50/40 dark:bg-blue-950/20 space-y-3 animate-fade-in"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 dark:text-blue-300">
                    <Terminal
                      size={13}
                      className="text-blue-600 dark:text-blue-400"
                    />
                    <span>Codex CLI 手动安装与版本更新</span>
                  </div>
                </div>

                {/* 安装方式切换胶囊 */}
                <div className="flex flex-wrap gap-1.5">
                  {CODEX_INSTALL_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCodexSelectedInstallOption(opt.id)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1",
                        codexSelectedInstallOption === opt.id
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-white/80 dark:bg-white/5 border border-blue-200/60 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-blue-100/50 dark:hover:bg-white/10",
                      )}
                    >
                      <span>{opt.name}</span>
                      {opt.badge && (
                        <span
                          className={cn(
                            "text-[9px] px-1 py-0.2 rounded",
                            codexSelectedInstallOption === opt.id
                              ? "bg-blue-700 text-white"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
                          )}
                        >
                          {opt.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* 选中的命令展示与终端执行 */}
                {(() => {
                  const selected =
                    CODEX_INSTALL_OPTIONS.find(
                      (o) => o.id === codexSelectedInstallOption,
                    ) || CODEX_INSTALL_OPTIONS[0];
                  return (
                    <div className="space-y-2">
                      <p className="text-[11px] text-slate-600 dark:text-gray-400">
                        {selected.desc}
                      </p>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 rounded-xl bg-slate-900 dark:bg-black/60 border border-slate-700/60 text-slate-100">
                        <div className="flex-1 font-mono text-xs overflow-x-auto py-1 px-1.5 text-blue-300 select-text">
                          <code>{selected.command}</code>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0 justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyCommand(
                                selected.command,
                                `card_codex_${selected.id}`,
                                "Codex CLI 安装命令",
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                            title="复制命令至剪贴板"
                          >
                            {copiedId === `card_codex_${selected.id}` ? (
                              <>
                                <Check size={12} className="text-emerald-400" />
                                <span className="text-emerald-400">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy size={12} />
                                <span>复制</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void handleRunInTerminal(
                                selected.command,
                                "Codex CLI 安装命令",
                              )
                            }
                            disabled={runningCmd === selected.command}
                            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                            title="在独立 CMD 窗口中运行此安装命令"
                          >
                            <Play
                              size={11}
                              className={
                                runningCmd === selected.command
                                  ? "animate-spin"
                                  : ""
                              }
                            />
                            <span>在终端运行</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDetectSingle("codex")}
                            disabled={detectingType === "codex"}
                            className="px-2.5 py-1 rounded-lg border border-blue-400/40 hover:bg-blue-500/20 text-blue-300 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                            title="安装完成后立即重新探测路径"
                          >
                            <Search
                              size={11}
                              className={
                                detectingType === "codex" ? "animate-spin" : ""
                              }
                            />
                            <span>探测就绪</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {codexInfo?.extra_info && (
              <div className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-500/10 px-2.5 py-1 rounded-lg border border-blue-100 dark:border-blue-500/20">
                💡 {codexInfo.extra_info}
              </div>
            )}

            <div className="text-[11px] text-slate-500 dark:text-gray-400 bg-slate-50/60 dark:bg-white/[0.03] px-2.5 py-1.5 rounded-lg border border-slate-200/60 dark:border-white/5 flex items-start gap-1.5">
              <span className="text-blue-500 font-bold">ℹ️</span>
              <span>
                Windows 提示：若在管理员终端中手动运行 Codex CLI，请使用{" "}
                <code className="px-1 py-0.5 rounded bg-slate-200/60 dark:bg-white/10 font-mono text-[10px] text-blue-600 dark:text-blue-400">
                  codex --no-daemon
                </code>
                （本软件“测试启动”已自动附带该参数）。
              </span>
            </div>
          </div>
        </SpotlightCard>

        {/* 卡片 3: ChatGPT 桌面客户端 */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-shrink-0 min-h-fit"
          spotlightColor="rgba(16, 185, 129, 0.12)"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <OpenAIIcon size={16} />
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
                  <Search
                    size={12}
                    className={
                      detectingType === "chatgpt" ? "animate-spin" : ""
                    }
                  />
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
                  <Play
                    size={12}
                    className={
                      launchingType === "chatgpt" ? "animate-spin" : ""
                    }
                  />
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

        {/* 卡片 4: WorkBuddy 客户端 */}
        <SpotlightCard
          className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-shrink-0 min-h-fit"
          spotlightColor="rgba(16, 185, 129, 0.12)"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <WorkbuddyIcon size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      WorkBuddy 客户端路径
                    </span>
                    {workbuddyRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        运行中
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500 font-mono">
                    Win32 可执行程序 (WorkBuddyAI.exe)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {workbuddyPath ? (
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
                  value={workbuddyPath}
                  onChange={(e) => setWorkbuddyPath(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => void handleDetectSingle("workbuddy")}
                  disabled={detectingType === "workbuddy"}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="自动探测 WorkBuddy 客户端安装路径"
                >
                  <Search
                    size={12}
                    className={
                      detectingType === "workbuddy" ? "animate-spin" : ""
                    }
                  />
                  <span>探测</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleBrowse("workbuddy")}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  title="通过文件管理器浏览路径"
                >
                  <FolderOpen size={12} />
                  <span>浏览</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleLaunchOrRestart("workbuddy")}
                  disabled={launchingType === "workbuddy"}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title="静默重启或拉起客户端"
                >
                  <Play
                    size={12}
                    className={
                      launchingType === "workbuddy" ? "animate-spin" : ""
                    }
                  />
                  <span>{workbuddyRunning ? "重启客户端" : "启动客户端"}</span>
                </button>
              </div>
            </div>

            {workbuddyInfo?.extra_info && (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-100 dark:border-emerald-500/20">
                💡 {workbuddyInfo.extra_info}
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

import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Check,
  Copy,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  Clock,
  RotateCcw,
} from "lucide-react";
import { OpenAIIcon, ClaudeIcon, WorkbuddyIcon } from "./BrandIcons";
import { toast } from "sonner";
import {
  setCodexConfig,
  setClaudeConfig,
  setWorkbuddyConfig,
  testCodexStream,
  testClaudeStream,
  testWorkbuddyStream,
  checkAppProcessStatus,
  restartTargetApp,
} from "../lib/api";
import type { TestStreamEvent, WorkbuddySavePayload } from "../types";

export interface TerminalTestModalProps {
  open: boolean;
  onClose: () => void;
  type: "codex" | "claude" | "workbuddy";
  url: string;
  apiKey: string;
  model: string;
  workbuddyPayload?: WorkbuddySavePayload;
  onSuccess?: () => void;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warn" | "error" | "response" | "dim";
  text: string;
}

export function TerminalTestModal({
  open,
  onClose,
  type,
  url,
  apiKey,
  model,
  workbuddyPayload,
  onSuccess,
}: TerminalTestModalProps) {
  const [status, setStatus] = useState<"running" | "success" | "error">(
    "running",
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // 重启与进程检测状态
  const [chatgptRunning, setChatgptRunning] = useState(false);
  const [codexRunning, setCodexRunning] = useState(false);
  const [claudeRunning, setClaudeRunning] = useState(false);
  const [workbuddyRunning, setWorkbuddyRunning] = useState(false);
  const [restartingTarget, setRestartingTarget] = useState<string | null>(null);
  const [showRestartCard, setShowRestartCard] = useState(false);

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const getNowTime = () => {
    const now = new Date();
    return now.toTimeString().split(" ")[0];
  };

  const addLog = (
    text: string,
    level: "info" | "success" | "warn" | "error" | "response" | "dim" = "info",
  ) => {
    setLogs((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: getNowTime(),
        level,
        text,
      },
    ]);
  };

  // 自动滚动到终端底部
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, streamingText]);

  // 倒计时自动关闭逻辑
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      onClose();
      return;
    }
    countdownTimerRef.current = window.setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearTimeout(countdownTimerRef.current);
      }
    };
  }, [countdown, onClose]);

  const handleRestart = async (
    target: "chatgpt" | "codex" | "claude" | "workbuddy",
  ) => {
    setRestartingTarget(target);
    const targetName =
      target === "chatgpt"
        ? "ChatGPT 桌面客户端"
        : target === "codex"
          ? "Codex CLI"
          : target === "workbuddy"
            ? "WorkBuddy 客户端"
            : "Claude Code CLI";

    addLog(`🚀 正在执行 ${targetName} 重启/拉起流程...`, "info");
    try {
      const result = await restartTargetApp(target);
      addLog(`✓ ${result}`, "success");
      addLog(
        `💡 目标应用已拉起，您可以继续测试重启其他应用或点击下方“完成”退出`,
        "dim",
      );
      if (target === "chatgpt") setChatgptRunning(true);
      if (target === "codex") setCodexRunning(true);
      if (target === "claude") setClaudeRunning(true);
      if (target === "workbuddy") setWorkbuddyRunning(true);
      toast.success(`${targetName} 操作成功！`);
      setCountdown(5);
    } catch (err) {
      addLog(`❌ 重启失败: ${err}`, "error");
      toast.error(`重启失败: ${err}`);
    } finally {
      setRestartingTarget(null);
    }
  };

  const runTestAndSave = async () => {
    hasStartedRef.current = true;
    // 重置状态
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
    setStatus("running");
    setShowRestartCard(false);
    setRestartingTarget(null);
    setLogs([]);
    setStreamingText("");
    setLatency(null);
    setStatusCode(null);

    const platformName =
      type === "codex"
        ? "ChatGPT (Codex)"
        : type === "workbuddy"
          ? "WorkBuddy"
          : "Claude Code";
    const protocolName =
      type === "codex"
        ? "OpenAI Responses Protocol"
        : type === "workbuddy"
          ? "OpenAI Chat Completions Protocol"
          : "Anthropic Messages Protocol";

    addLog(`🚀 启动 ${platformName} 连通性测试与配置流程...`, "info");
    addLog(`目标协议: ${protocolName}`, "dim");
    addLog(`服务端点: ${url}`, "dim");
    addLog(`指定模型: ${model}`, "dim");

    try {
      let testSuccess = false;

      const handleEvent = (event: TestStreamEvent) => {
        if (event.type === "log") {
          addLog(event.data.text, event.data.level);
        } else if (event.type === "chunk") {
          setStreamingText((prev) => prev + event.data.delta);
        } else if (event.type === "finish") {
          testSuccess = event.data.success;
          setLatency(event.data.latency_ms);
          if (event.data.status_code) {
            setStatusCode(event.data.status_code);
          }
        }
      };

      let testResult;
      if (type === "codex") {
        testResult = await testCodexStream(
          url,
          apiKey.trim(),
          model.trim(),
          handleEvent,
        );
      } else if (type === "workbuddy") {
        testResult = await testWorkbuddyStream(
          url,
          apiKey.trim(),
          model.trim(),
          handleEvent,
        );
      } else {
        testResult = await testClaudeStream(
          url,
          apiKey.trim(),
          model.trim(),
          handleEvent,
        );
      }

      if (testResult.latencyMs !== undefined && testResult.latencyMs !== null) {
        setLatency(testResult.latencyMs);
      }
      if (
        testResult.statusCode !== undefined &&
        testResult.statusCode !== null
      ) {
        setStatusCode(testResult.statusCode);
      }
      testSuccess = testResult.success;

      if (testSuccess) {
        // 保存配置
        if (type === "codex") {
          addLog(`💾 正在将配置写入本地配置文件与系统环境变量...`, "info");
          await setCodexConfig(url, apiKey.trim(), model.trim());
          addLog(`✓ 配置文件 ~/.codex/config.toml 已成功写入`, "success");
          addLog(`✓ 系统环境变量 CUSTOM_OPENAI_API_KEY 已更新`, "success");
        } else if (type === "workbuddy") {
          addLog(
            `💾 正在将配置保存至本地 models.json (多模型拼接保存)...`,
            "info",
          );
          if (workbuddyPayload) {
            await setWorkbuddyConfig(workbuddyPayload);
          } else {
            await setWorkbuddyConfig({
              url,
              api_key: apiKey.trim(),
              model: model.trim(),
              supports_tool_call: true,
              supports_images: true,
              supports_reasoning: true,
              only_reasoning: false,
              can_disable_thinking: true,
              use_custom_protocol: false,
              default_effort: null,
              supported_efforts: ["medium"],
              max_input_tokens: 32768,
              max_output_tokens: 32768,
            });
          }
          addLog(
            `✓ 配置文件 ~/.workbuddy-ai/models.json 已成功写入 (支持多模型共存，自动拼接追加)`,
            "success",
          );
          addLog(`💡 WorkBuddy 已通过内部热重载机制自动感知新模型`, "info");
        } else {
          addLog(`💾 正在将配置写入本地配置文件与系统环境变量...`, "info");
          await setClaudeConfig(url, apiKey.trim(), model.trim());
          addLog(`✓ 配置文件 ~/.claude/settings.json 已成功写入`, "success");
          addLog(
            `✓ 系统环境变量 ANTHROPIC_BASE_URL 与 Token 已更新`,
            "success",
          );
        }

        // 探测目标客户端运行状态
        addLog(`🔍 正在检查目标应用与 CLI 运行状态...`, "dim");
        let anyRunning = false;
        if (type === "codex") {
          const [gRun, xRun] = await Promise.all([
            checkAppProcessStatus("chatgpt").catch(() => false),
            checkAppProcessStatus("codex").catch(() => false),
          ]);
          setChatgptRunning(gRun);
          setCodexRunning(xRun);
          anyRunning = gRun || xRun;
          if (gRun) addLog(`💡 检测到 ChatGPT 桌面客户端正在运行中`, "info");
          if (xRun) addLog(`💡 检测到 Codex CLI 正在运行中`, "info");
          if (!gRun && !xRun)
            addLog(
              `💡 当前未检测到运行中的 ChatGPT 客户端或 Codex 进程`,
              "dim",
            );
        } else if (type === "workbuddy") {
          const wbRun = await checkAppProcessStatus("workbuddy").catch(
            () => false,
          );
          setWorkbuddyRunning(wbRun);
          anyRunning = wbRun;
          if (wbRun)
            addLog(
              `💡 检测到 WorkBuddy 正在运行中 (新模型已实时热重载)`,
              "info",
            );
          else addLog(`💡 当前未检测到运行中的 WorkBuddy 进程`, "dim");
        } else {
          const cRun = await checkAppProcessStatus("claude").catch(() => false);
          setClaudeRunning(cRun);
          anyRunning = cRun;
          if (cRun) addLog(`💡 检测到 Claude Code CLI 正在运行中`, "info");
          else addLog(`💡 当前未检测到运行中的 Claude Code 进程`, "dim");
        }

        if (!openRef.current) return;

        if (!anyRunning) {
          // 当前未在运行客户端，无需强制重启，8秒后自动关闭
          setCountdown(8);
        }

        addLog(`👉 配置部署成功！请在下方确认是否立即重启客户端生效`, "info");
        setStatus("success");
        setShowRestartCard(true);
        onSuccess?.();
        toast.success(`${platformName} 连通性测试通过，配置已成功保存！`);
      } else {
        if (!openRef.current) return;
        setStatus("error");
        addLog(
          `✗ 连通性测试未通过，本地配置未修改。请根据提示调整配置后重试。`,
          "error",
        );
        toast.error(`连通性测试失败，未保存配置`);
      }
    } catch (err) {
      if (!openRef.current) return;
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ 执行过程发生异常: ${msg}`, "error");
      addLog(`✗ 本地配置未更改。`, "error");
      toast.error(`测试异常: ${msg}`);
    }
  };

  useEffect(() => {
    if (open) {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        void runTestAndSave();
      }
    } else {
      hasStartedRef.current = false;
      setShowRestartCard(false);
      setRestartingTarget(null);
      setCountdown(null);
      setLogs([]);
      setStreamingText("");
      setLatency(null);
      setStatusCode(null);
      if (countdownTimerRef.current) {
        clearTimeout(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCopyLogs = async () => {
    try {
      const fullText = logs
        .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.text}`)
        .join("\n");
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast.success("已复制完整终端测试日志");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/80 dark:border-white/10 bg-[#0d1117] text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-slide-up">
        {/* ── 顶部终端装饰标题栏 (macOS 风格) ── */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-[#30363d] flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* macOS 红黄绿圆点 */}
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e]/60 shadow-xs inline-block" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]/60 shadow-xs inline-block" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]/60 shadow-xs inline-block" />
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
              <Terminal size={14} className="text-blue-400" />
              <span className="font-semibold text-slate-200">
                {type === "codex"
                  ? "Codex"
                  : type === "workbuddy"
                    ? "WorkBuddy"
                    : "Claude Code"}{" "}
                连通性测试与配置部署终端
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {latency !== null && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Clock size={11} />
                <span>{latency}ms</span>
              </span>
            )}
            {statusCode !== null && (
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                  statusCode >= 200 && statusCode < 300
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                }`}
              >
                HTTP {statusCode}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="关闭窗口"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── 终端输出面板 ── */}
        <div className="relative flex-1 bg-[#090d13] p-4 overflow-hidden flex flex-col min-h-[260px]">
          {/* 一键复制浮动按钮 */}
          <button
            type="button"
            onClick={handleCopyLogs}
            className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-slate-300 hover:text-white text-xs font-mono border border-[#30363d] shadow-sm transition-all"
            title="一键复制终端完整输出"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-400" />
                <span className="text-emerald-400">已复制</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>复制日志</span>
              </>
            )}
          </button>

          {/* 终端滚屏区 */}
          <div
            ref={terminalRef}
            className="flex-1 overflow-y-auto pr-2 font-mono text-xs sm:text-[13px] leading-relaxed select-text space-y-1"
          >
            {logs.map((log) => {
              let colorClass = "text-slate-300";
              if (log.level === "info") colorClass = "text-[#58a6ff]";
              else if (log.level === "success")
                colorClass = "text-[#3fb950] font-medium";
              else if (log.level === "warn") colorClass = "text-[#d29922]";
              else if (log.level === "error")
                colorClass = "text-[#f85149] font-medium";
              else if (log.level === "response") colorClass = "text-[#a5d6ff]";
              else if (log.level === "dim") colorClass = "text-[#8b949e]";

              return (
                <div
                  key={log.id}
                  className="flex items-start gap-2.5 break-all"
                >
                  <span className="text-[#484f58] select-none text-[11px] shrink-0 pt-0.5">
                    [{log.timestamp}]
                  </span>
                  <span className={colorClass}>{log.text}</span>
                </div>
              );
            })}

            {/* 流式增量内容预览 */}
            {streamingText && (
              <div className="flex items-start gap-2.5 break-all text-[#3fb950] bg-emerald-950/20 p-2 rounded border border-emerald-900/40 my-1">
                <span className="text-[#484f58] select-none text-[11px] shrink-0 pt-0.5">
                  [{getNowTime()}]
                </span>
                <div className="whitespace-pre-wrap flex-1">
                  <span>{streamingText}</span>
                  {status === "running" && (
                    <span className="inline-block w-2 h-3.5 ml-1 bg-emerald-400 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            )}

            {/* 运行中终端光标 */}
            {status === "running" && !streamingText && (
              <div className="flex items-center gap-2 pt-1 text-[#8b949e]">
                <span className="text-[#484f58] text-[11px]">
                  [{getNowTime()}]
                </span>
                <span className="text-yellow-400">正在与服务节点通信中</span>
                <span className="inline-block w-2 h-3.5 bg-yellow-400 animate-pulse align-middle" />
              </div>
            )}
          </div>
        </div>

        {/* ── 客户端重启确认引导面板 ── */}
        {status === "success" && showRestartCard && (
          <div className="bg-[#161b22] border-t border-[#30363d] px-5 py-3.5 flex flex-col gap-2.5 flex-shrink-0 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw size={14} className="text-amber-400" />
                <span className="text-xs font-semibold text-slate-200">
                  配置已部署成功，是否立即重启客户端应用新配置？
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                {type === "codex"
                  ? chatgptRunning || codexRunning
                    ? "检测到客户端/CLI 运行中"
                    : "当前未运行"
                  : type === "workbuddy"
                    ? workbuddyRunning
                      ? "检测到 WorkBuddy 运行中 (新模型已热重载生效)"
                      : "当前未运行"
                    : claudeRunning
                      ? "检测到 CLI 运行中"
                      : "当前未运行"}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
              <div className="flex items-center gap-2 flex-wrap">
                {type === "codex" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRestart("chatgpt")}
                      disabled={restartingTarget !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                      title="安全终止并重新拉起 ChatGPT 客户端"
                    >
                      {restartingTarget === "chatgpt" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <OpenAIIcon size={13} />
                      )}
                      <span>
                        {chatgptRunning
                          ? "重启 ChatGPT 客户端"
                          : "启动 ChatGPT 客户端"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleRestart("codex")}
                      disabled={restartingTarget !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                      title="在独立终端窗口启动/重启 Codex CLI"
                    >
                      {restartingTarget === "codex" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Terminal size={13} />
                      )}
                      <span>
                        {codexRunning
                          ? "重启 Codex CLI 终端"
                          : "启动 Codex CLI 终端"}
                      </span>
                    </button>
                  </>
                ) : type === "workbuddy" ? (
                  <button
                    type="button"
                    onClick={() => void handleRestart("workbuddy")}
                    disabled={restartingTarget !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                    title="重启 WorkBuddy 客户端"
                  >
                    {restartingTarget === "workbuddy" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <WorkbuddyIcon size={13} />
                    )}
                    <span>
                      {workbuddyRunning
                        ? "重启 WorkBuddy 客户端"
                        : "启动 WorkBuddy 客户端"}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRestart("claude")}
                    disabled={restartingTarget !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                    title="在独立终端窗口启动/重启 Claude Code"
                  >
                    {restartingTarget === "claude" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <ClaudeIcon size={13} />
                    )}
                    <span>
                      {claudeRunning
                        ? "重启 Claude Code 终端"
                        : "启动 Claude Code 终端"}
                    </span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  toast.info("已保存配置，请稍后手动重启客户端生效");
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                稍后自行重启
              </button>
            </div>
          </div>
        )}

        {/* ── 底部操作与状态状态栏 ── */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#161b22] border-t border-[#30363d] flex-shrink-0">
          <div className="flex items-center gap-2 text-xs">
            {status === "running" && (
              <>
                <Loader2 size={16} className="animate-spin text-blue-400" />
                <span className="text-slate-300">
                  正在发送探测请求并验证网络握手...
                </span>
              </>
            )}
            {status === "success" && (
              <>
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span className="text-emerald-400 font-medium">
                  测试通过，配置已生效！
                </span>
              </>
            )}
            {status === "error" && (
              <>
                <XCircle size={16} className="text-rose-400" />
                <span className="text-rose-400 font-medium">
                  测试未通过，请检查错误提示
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {status === "error" && (
              <button
                type="button"
                onClick={runTestAndSave}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors shadow-sm"
              >
                <RefreshCw size={13} />
                <span>重新测试</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[#21262d] hover:bg-[#30363d] text-slate-300 hover:text-white border border-[#30363d] cursor-pointer"
            >
              {status === "success"
                ? countdown !== null
                  ? `完成 (${countdown}s)`
                  : "完成"
                : status === "running"
                  ? "取消"
                  : "关闭"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TerminalTestModal;

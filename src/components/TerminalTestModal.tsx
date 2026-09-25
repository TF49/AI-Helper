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
} from "lucide-react";
import { toast } from "sonner";
import {
  setCodexConfig,
  setClaudeConfig,
  testCodexStream,
  testClaudeStream,
} from "../lib/api";
import type { TestStreamEvent } from "../types";

export interface TerminalTestModalProps {
  open: boolean;
  onClose: () => void;
  type: "codex" | "claude";
  url: string;
  apiKey: string;
  model: string;
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
  onSuccess,
}: TerminalTestModalProps) {
  const [status, setStatus] = useState<"running" | "success" | "error">("running");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

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

  const runTestAndSave = async () => {
    // 重置状态
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
    setStatus("running");
    setLogs([]);
    setStreamingText("");
    setLatency(null);
    setStatusCode(null);

    const platformName = type === "codex" ? "ChatGPT (Codex)" : "Claude Code";
    const protocolName =
      type === "codex" ? "OpenAI Responses Protocol" : "Anthropic Messages Protocol";

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

      if (type === "codex") {
        await testCodexStream(url, apiKey.trim(), model.trim(), handleEvent);
      } else {
        await testClaudeStream(url, apiKey.trim(), model.trim(), handleEvent);
      }

      if (testSuccess) {
        // 保存配置
        addLog(`💾 正在将配置写入本地配置文件与系统环境变量...`, "info");

        if (type === "codex") {
          await setCodexConfig(url, apiKey.trim(), model.trim());
          addLog(`✓ 配置文件 ~/.codex/config.toml 已成功写入`, "success");
          addLog(`✓ 系统环境变量 CUSTOM_OPENAI_API_KEY 已更新`, "success");
          addLog(`🎉 Codex 配置部署成功！请重启 VS Code / Codex 终端生效`, "success");
        } else {
          await setClaudeConfig(url, apiKey.trim(), model.trim());
          addLog(`✓ 配置文件 ~/.claude/settings.json 已成功写入`, "success");
          addLog(`✓ 系统环境变量 ANTHROPIC_BASE_URL 与 Token 已更新`, "success");
          addLog(`🎉 Claude Code 配置部署成功！请重启 Claude 终端生效`, "success");
        }

        setStatus("success");
        onSuccess?.();
        toast.success(
          `${platformName} 连通性测试通过，配置已成功保存！`,
        );
        // 4秒后自动倒计时关闭
        setCountdown(4);
      } else {
        setStatus("error");
        addLog(`✗ 连通性测试未通过，本地配置未修改。请根据提示调整配置后重试。`, "error");
        toast.error(`连通性测试失败，未保存配置`);
      }
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ 执行过程发生异常: ${msg}`, "error");
      addLog(`✗ 本地配置未更改。`, "error");
      toast.error(`测试异常: ${msg}`);
    }
  };

  useEffect(() => {
    if (open) {
      runTestAndSave();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in select-none">
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
                {type === "codex" ? "Codex" : "Claude Code"} 连通性测试与配置部署终端
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
              else if (log.level === "success") colorClass = "text-[#3fb950] font-medium";
              else if (log.level === "warn") colorClass = "text-[#d29922]";
              else if (log.level === "error") colorClass = "text-[#f85149] font-medium";
              else if (log.level === "response") colorClass = "text-[#a5d6ff]";
              else if (log.level === "dim") colorClass = "text-[#8b949e]";

              return (
                <div key={log.id} className="flex items-start gap-2.5 break-all">
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
                <span className="text-[#484f58] text-[11px]">[{getNowTime()}]</span>
                <span className="text-yellow-400">正在与服务节点通信中</span>
                <span className="inline-block w-2 h-3.5 bg-yellow-400 animate-pulse align-middle" />
              </div>
            )}
          </div>
        </div>

        {/* ── 底部操作与状态状态栏 ── */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#161b22] border-t border-[#30363d] flex-shrink-0">
          <div className="flex items-center gap-2 text-xs">
            {status === "running" && (
              <>
                <Loader2 size={16} className="animate-spin text-blue-400" />
                <span className="text-slate-300">正在发送探测请求并验证网络握手...</span>
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
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                status === "success"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  : "bg-[#21262d] hover:bg-[#30363d] text-slate-300 hover:text-white border border-[#30363d]"
              }`}
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

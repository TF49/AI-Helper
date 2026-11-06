import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Check,
  Copy,
  RotateCcw,
  Loader2,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  OpenAIIcon,
  ClaudeIcon,
  WorkbuddyIcon,
  AccioWorkIcon,
  CursorIcon,
} from "../BrandIcons";
import {
  setCodexConfig,
  setClaudeConfig,
  setWorkbuddyConfig,
  setAccioConfig,
  setCursorConfig,
  testCodexStream,
  testClaudeStream,
  testWorkbuddyStream,
  testAccioStream,
  testCursorStream,
  startAccioBridge,
  startCursorBridge,
  patchCursorClient,
  checkAppProcessStatus,
  restartTargetApp,
  getCursorConfig,
  getAccioConfig,
} from "../../lib/api";
import type {
  TestStreamEvent,
  TokenItem,
  CursorConfig,
  AccioConfig,
  WorkbuddySavePayload,
} from "../../types";
import { maskApiKey } from "./AgentCard";

export type BatchApplyTarget =
  | "claude"
  | "chatgpt"
  | "cursor"
  | "workbuddy"
  | "acciowork";

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warn" | "error" | "response" | "dim";
  text: string;
}

export interface BatchTerminalModalProps {
  open: boolean;
  onClose: () => void;
  targets: BatchApplyTarget[];
  onResolveKey: (
    target: BatchApplyTarget,
  ) => Promise<{ key: string; token: TokenItem | null } | null>;
  onSuccess?: () => void;
}

const TARGET_DISPLAY_NAMES: Record<BatchApplyTarget, string> = {
  claude: "Claude Code",
  chatgpt: "Codex",
  cursor: "Cursor IDE",
  workbuddy: "WorkBuddy",
  acciowork: "Accio Work",
};

const TARGET_MODELS: Record<BatchApplyTarget, string> = {
  claude: "claude-sonnet-5-5",
  chatgpt: "gpt-5.6-sol",
  cursor: "glm-5.3",
  workbuddy: "glm-5.3",
  acciowork: "glm-5.3",
};

const TARGET_GROUPS: Record<BatchApplyTarget, string> = {
  claude: "CC-Kiro-Max",
  chatgpt: "Codex-不降质",
  cursor: "国产Token计划",
  workbuddy: "国产Token计划",
  acciowork: "国产Token计划",
};

export function BatchTerminalModal({
  open,
  onClose,
  targets,
  onResolveKey,
  onSuccess,
}: BatchTerminalModalProps) {
  const [status, setStatus] = useState<"running" | "success" | "error">(
    "running",
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [currentTarget, setCurrentTarget] = useState<BatchApplyTarget | null>(
    null,
  );
  const [progressIndex, setProgressIndex] = useState(0);

  // 运行中的客户端状态
  const [runningApps, setRunningApps] = useState<{
    chatgpt: boolean;
    codex: boolean;
    claude: boolean;
    cursor: boolean;
    workbuddy: boolean;
    acciowork: boolean;
  }>({
    chatgpt: false,
    codex: false,
    claude: false,
    cursor: false,
    workbuddy: false,
    acciowork: false,
  });
  const [restartingTarget, setRestartingTarget] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

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
      onCloseRef.current();
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
  }, [countdown]);

  const handleRestart = async (
    target: "chatgpt" | "codex" | "claude" | "workbuddy" | "acciowork" | "cursor",
  ) => {
    setRestartingTarget(target);
    const targetName =
      target === "chatgpt"
        ? "ChatGPT 桌面客户端"
        : target === "codex"
          ? "Codex CLI"
          : target === "workbuddy"
            ? "WorkBuddy 客户端"
            : target === "acciowork"
              ? "Accio Work 客户端"
              : target === "cursor"
                ? "Cursor 客户端"
                : "Claude Code CLI";

    // 用户已选择立即重启：停止自动关闭倒计时，避免重启进行中弹窗被卸载
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);

    addLog(`🚀 正在执行 ${targetName} 重启/拉起流程...`, "info");
    try {
      const result = await restartTargetApp(target);
      addLog(`✓ ${result}`, "success");
      setRunningApps((prev) => ({ ...prev, [target]: true }));
      toast.success(`${targetName} 操作成功！`);
      setCountdown(6);
    } catch (err) {
      addLog(`❌ 重启失败: ${err}`, "error");
      toast.error(`重启失败: ${err}`);
    } finally {
      setRestartingTarget(null);
    }
  };

  const runBatchTestAndDeploy = async () => {
    hasStartedRef.current = true;
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
    setStatus("running");
    setLogs([]);
    setStreamingText("");
    setCurrentTarget(null);
    setProgressIndex(0);

    addLog("🚀 启动 AI Helper Agent 矩阵批量一键配置与连通性测试流程...", "info");
    addLog(
      `📋 待配置客户端共 ${targets.length} 席: ${targets.map((t) => TARGET_DISPLAY_NAMES[t]).join("、")}`,
      "dim",
    );
    addLog("----------------------------------------------------------------", "dim");

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i++) {
      if (!openRef.current) return;
      const target = targets[i];
      const targetName = TARGET_DISPLAY_NAMES[target];
      const model = TARGET_MODELS[target];
      const group = TARGET_GROUPS[target];
      let defaultUrl =
        target === "workbuddy" ? "https://bob-api.com/v1" : "https://bob-api.com/";

      if (target === "cursor") {
        const cur = await getCursorConfig().catch(() => null);
        if (cur?.base_url?.trim()) defaultUrl = cur.base_url.trim();
      } else if (target === "acciowork") {
        const acc = await getAccioConfig().catch(() => null);
        if (acc?.base_url?.trim()) defaultUrl = acc.base_url.trim();
      }

      setCurrentTarget(target);
      setProgressIndex(i + 1);

      addLog(`\n[${i + 1}/${targets.length}] 正在为 ${targetName} 解析专属分组令牌...`, "info");

      let resolved;
      try {
        resolved = await onResolveKey(target);
      } catch (err) {
        addLog(`❌ 获取令牌失败: ${err}`, "error");
        failCount++;
        continue;
      }

      if (!openRef.current) return;

      if (!resolved || !resolved.key) {
        addLog(`❌ 未能获取或创建 ${targetName} 对应「${group}」分组可用令牌`, "error");
        failCount++;
        continue;
      }

      addLog(`✓ 专属令牌已就绪: ${maskApiKey(resolved.key)} (分组: ${group})`, "dim");
      addLog(`目标协议端点: ${defaultUrl} | 指定模型: ${model}`, "dim");
      addLog(`正在向网关发起握手连通性探测...`, "info");

      let testSuccess = false;
      const handleEvent = (event: TestStreamEvent) => {
        if (!openRef.current) return;
        if (event.type === "log") {
          addLog(event.data.text, event.data.level);
        } else if (event.type === "chunk") {
          setStreamingText((prev) => prev + event.data.delta);
        } else if (event.type === "finish") {
          testSuccess = event.data.success;
        }
      };

      try {
        setStreamingText("");
        let testResult;
        if (target === "claude") {
          testResult = await testClaudeStream(
            defaultUrl,
            resolved.key.trim(),
            model.trim(),
            handleEvent,
          );
        } else if (target === "chatgpt") {
          testResult = await testCodexStream(
            defaultUrl,
            resolved.key.trim(),
            model.trim(),
            handleEvent,
          );
        } else if (target === "workbuddy") {
          testResult = await testWorkbuddyStream(
            defaultUrl,
            resolved.key.trim(),
            model.trim(),
            handleEvent,
          );
        } else if (target === "acciowork") {
          testResult = await testAccioStream(
            defaultUrl,
            resolved.key.trim(),
            model.trim(),
            handleEvent,
          );
        } else {
          testResult = await testCursorStream(
            defaultUrl,
            resolved.key.trim(),
            model.trim(),
            handleEvent,
          );
        }

        testSuccess = testResult.success;
      } catch (err) {
        addLog(`❌ 连通性测试请求异常: ${err}`, "error");
        testSuccess = false;
      }

      setStreamingText("");

      if (!openRef.current) return;

      if (testSuccess) {
        addLog(`✓ ${targetName} 连通性测试通过！正在写入配置文件...`, "success");

        try {
          if (target === "claude") {
            await setClaudeConfig(defaultUrl, resolved.key.trim(), model.trim());
            addLog(`✓ ~/.claude/settings.json 配置已更新`, "success");
          } else if (target === "chatgpt") {
            await setCodexConfig(defaultUrl, resolved.key.trim(), model.trim());
            addLog(`✓ ~/.codex/config.toml 配置已更新`, "success");
          } else if (target === "workbuddy") {
            const payload: WorkbuddySavePayload = {
              url: defaultUrl,
              api_key: resolved.key.trim(),
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
            };
            await setWorkbuddyConfig(payload);
            addLog(`✓ ~/.workbuddy/models.json 推荐模型已提升首项`, "success");
          } else if (target === "acciowork") {
            const accCfg = await getAccioConfig().catch(() => null);
            const payload: AccioConfig = {
              base_url: accCfg?.base_url?.trim() || defaultUrl,
              api_key: resolved.key.trim(),
              model: model.trim(),
              bridge_port: accCfg?.bridge_port || 8787,
              official_gateway:
                accCfg?.official_gateway || "https://phoenix-gw.alibaba.com",
              fallback_official: accCfg?.fallback_official ?? false,
              prevent_official_leak: accCfg?.prevent_official_leak ?? true,
            };
            await setAccioConfig(payload);
            try {
              const port = await startAccioBridge(payload.bridge_port);
              addLog(`✓ Accio Work 本地中继已启动 (端口: ${port})`, "success");
            } catch (bErr) {
              addLog(`⚠️ Accio Bridge 告警: ${bErr}`, "warn");
            }
          } else if (target === "cursor") {
            const curCfg = await getCursorConfig().catch(() => null);
            const payload: CursorConfig = {
              base_url: curCfg?.base_url?.trim() || defaultUrl,
              api_key: resolved.key.trim(),
              model: model.trim(),
              bridge_port: curCfg?.bridge_port || 8969,
              auto_start_bridge: true,
              cursor_path: curCfg?.cursor_path || null,
            };
            await setCursorConfig(payload);
            try {
              const port = await startCursorBridge(payload.bridge_port);
              addLog(`✓ Cursor Connect-RPC Bridge 已启动 (端口: ${port})`, "success");
              await patchCursorClient(payload.cursor_path || undefined, port);
              addLog(`✓ Cursor 客户端已自动接入 AI Helper 补丁`, "success");
            } catch (bErr) {
              addLog(`⚠️ Cursor Bridge/Patch 告警: ${bErr}`, "warn");
            }
          }

          // 记录本地绑定
          if (resolved.token) {
            const bound = JSON.stringify({
              id: resolved.token.id,
              name: resolved.token.name,
              group: resolved.token.group ?? undefined,
            });
            try {
              localStorage.setItem(`bound_token_${target}`, bound);
            } catch {}
          }

          successCount++;
          addLog(`✓ ${targetName} 配置落盘与部署圆满成功！`, "success");
        } catch (saveErr) {
          addLog(`❌ 保存 ${targetName} 配置失败: ${saveErr}`, "error");
          failCount++;
        }
      } else {
        addLog(`✗ ${targetName} 连通性测试未通过，保留原配置`, "error");
        failCount++;
      }
    }

    if (!openRef.current) return;

    addLog("\n----------------------------------------------------------------", "dim");
    if (failCount === 0) {
      addLog(`🎉 全部 ${successCount} 席 Agent 矩阵配置部署与连通性测试圆满完成！`, "success");
      setStatus("success");
      toast.success(`已为全部 ${successCount} 个 Agent 完成一键配置与连通性测试`);
    } else if (successCount > 0) {
      addLog(
        `⚠️ 批量配置完成：成功 ${successCount} 席，失败 ${failCount} 席`,
        "warn",
      );
      setStatus("success");
      toast.warning(`部分 Agent 配置完成 (${successCount}/${targets.length})`);
    } else {
      addLog(`❌ 全部 Agent 连通性测试均失败，请检查网络或令牌`, "error");
      setStatus("error");
      toast.error("所有 Agent 配置写入均未成功");
    }

    // 探测正在运行的客户端进程
    try {
      const [cRun, xRun, gRun, curRun, wbRun, aRun] = await Promise.all([
        checkAppProcessStatus("claude").catch(() => false),
        checkAppProcessStatus("codex").catch(() => false),
        checkAppProcessStatus("chatgpt").catch(() => false),
        checkAppProcessStatus("cursor").catch(() => false),
        checkAppProcessStatus("workbuddy").catch(() => false),
        checkAppProcessStatus("acciowork").catch(() => false),
      ]);
      setRunningApps({
        claude: cRun,
        codex: xRun,
        chatgpt: gRun,
        cursor: curRun,
        workbuddy: wbRun,
        acciowork: aRun,
      });

      const anyRun = cRun || xRun || gRun || curRun || wbRun || aRun;
      if (!anyRun) {
        setCountdown(8);
      }
    } catch {
      setCountdown(8);
    }

    // 触发全局 token 同步事件并通知父组件
    window.dispatchEvent(
      new CustomEvent("ai_helper_sync_all_tokens", {
        detail: { toolIds: targets },
      }),
    );
    onSuccess?.();
  };

  useEffect(() => {
    if (open) {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        void runBatchTestAndDeploy();
      }
    } else {
      hasStartedRef.current = false;
      setCountdown(null);
      setLogs([]);
      setStreamingText("");
      setCurrentTarget(null);
      setProgressIndex(0);
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
      toast.success("已复制完整矩阵终端测试日志");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  if (!open) return null;

  const hasAnyRunning =
    runningApps.claude ||
    runningApps.codex ||
    runningApps.chatgpt ||
    runningApps.cursor ||
    runningApps.workbuddy ||
    runningApps.acciowork;

  return (
    <div className="fixed inset-0 top-11 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in">
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
              <Terminal size={14} className="text-purple-400" />
              <span className="font-semibold text-slate-200">
                Agent 矩阵批量连通性测试与配置终端
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status === "running" && progressIndex > 0 && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30 flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" />
                <span>
                  进度 {progressIndex} / {targets.length}
                </span>
              </span>
            )}
            {status === "success" && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Check size={11} />
                <span>批量就绪</span>
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
        <div className="relative flex-1 bg-[#090d13] p-4 overflow-hidden flex flex-col min-h-[300px]">
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
                <span className="text-[#484f58] text-[11px]">
                  [{getNowTime()}]
                </span>
                <span className="text-yellow-400">
                  {currentTarget
                    ? `正在与 ${TARGET_DISPLAY_NAMES[currentTarget]} 服务节点握手探测通信`
                    : "正在初始化批量部署流程"}
                </span>
                <span className="inline-block w-2 h-3.5 bg-yellow-400 animate-pulse align-middle" />
              </div>
            )}
          </div>
        </div>

        {/* ── 底部客户端重启面板 (测试通过后展示) ── */}
        {status === "success" && hasAnyRunning && (
          <div className="bg-[#161b22] border-t border-[#30363d] px-5 py-3 flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <RotateCcw size={13} className="text-amber-400" />
                <span>已检测到运行中的客户端，可点击一键重启应用新配置：</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {runningApps.claude && (
                <button
                  type="button"
                  disabled={restartingTarget !== null}
                  onClick={() => handleRestart("claude")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-slate-200 transition-colors disabled:opacity-50"
                >
                  <ClaudeIcon size={12} />
                  <span>重启 Claude CLI</span>
                </button>
              )}
              {runningApps.cursor && (
                <button
                  type="button"
                  disabled={restartingTarget !== null}
                  onClick={() => handleRestart("cursor")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-slate-200 transition-colors disabled:opacity-50"
                >
                  <CursorIcon size={12} />
                  <span>重启 Cursor</span>
                </button>
              )}
              {runningApps.workbuddy && (
                <button
                  type="button"
                  disabled={restartingTarget !== null}
                  onClick={() => handleRestart("workbuddy")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-slate-200 transition-colors disabled:opacity-50"
                >
                  <WorkbuddyIcon size={12} />
                  <span>重启 WorkBuddy</span>
                </button>
              )}
              {runningApps.acciowork && (
                <button
                  type="button"
                  disabled={restartingTarget !== null}
                  onClick={() => handleRestart("acciowork")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-slate-200 transition-colors disabled:opacity-50"
                >
                  <AccioWorkIcon size={12} />
                  <span>重启 Accio Work</span>
                </button>
              )}
              {runningApps.codex && (
                <button
                  type="button"
                  disabled={restartingTarget !== null}
                  onClick={() => handleRestart("codex")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-slate-200 transition-colors disabled:opacity-50"
                >
                  <Terminal size={12} />
                  <span>重启 Codex CLI</span>
                </button>
              )}
              {runningApps.chatgpt && (
                <button
                  type="button"
                  disabled={restartingTarget !== null}
                  onClick={() => handleRestart("chatgpt")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-medium text-slate-200 transition-colors disabled:opacity-50"
                >
                  <OpenAIIcon size={12} />
                  <span>重启 ChatGPT 桌面端</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── 底部状态操作栏 ── */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#161b22] border-t border-[#30363d] flex-shrink-0">
          <div className="flex items-center gap-2 text-xs">
            {status === "running" ? (
              <>
                <Loader2 size={13} className="text-blue-400 animate-spin" />
                <span className="text-slate-300">
                  {currentTarget
                    ? `正在为 ${TARGET_DISPLAY_NAMES[currentTarget]} 发送探测请求并验证网络握手...`
                    : "正在执行矩阵部署与连通性验证..."}
                </span>
              </>
            ) : status === "success" ? (
              <>
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-emerald-300 font-medium">
                  矩阵连通性测试与配置部署完成！
                </span>
                {countdown !== null && (
                  <span className="text-[11px] text-slate-400 font-mono">
                    ({countdown}s 后自动关闭)
                  </span>
                )}
              </>
            ) : (
              <>
                <XCircle size={14} className="text-rose-400" />
                <span className="text-rose-300 font-medium">
                  部分连通性测试未通过，请检查报错日志
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {status === "running" ? (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-slate-300 hover:text-white border border-[#30363d] transition-colors"
              >
                取消
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Check size={13} />
                <span>完成</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

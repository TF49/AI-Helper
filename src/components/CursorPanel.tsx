import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Server,
  Power,
  RotateCcw,
  Sparkles,
  Radio,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  KeyRound,
  Cpu,
  Wrench,
  FolderOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  getCursorConfig,
  setCursorConfig,
  startCursorBridge,
  stopCursorBridge,
  getCursorBridgeStatus,
  getCursorPatchStatus,
  patchCursorClient,
  restoreCursorClient,
  fetchCodexModels,
  checkAppProcessStatus,
  restartTargetApp,
  browseAppPath,
} from "../lib/api";
import { ConfigPathBar } from "./ConfigPathBar";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ChannelGroupMonitor } from "./ChannelGroupMonitor";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import {
  PRESET_URLS,
  type CursorConfig,
  type CursorBridgeStatus,
  type CursorPatchInfo,
} from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { useBoundTokenGroup } from "../lib/useBoundTokenGroup";
import { TerminalTestModal } from "./TerminalTestModal";
import { StepIndicator, type StepDef } from "./StepIndicator";
import { ConfigConfirmStep } from "./ConfigConfirmStep";

const stepVariants = {
  enter: (dir: number) => ({ x: dir * 32, opacity: 0 }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.22, ease: "easeOut" as const },
  },
  exit: (dir: number) => ({
    x: -dir * 32,
    opacity: 0,
    transition: { duration: 0.18, ease: "easeIn" as const },
  }),
};

const TOTAL_STEPS = 5;

export function CursorPanel() {
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-3-7-sonnet");
  const [bridgePort, setBridgePort] = useState<number>(8969);
  const [autoStartBridge, setAutoStartBridge] = useState(true);
  const [cursorPath, setCursorPath] = useState<string>("");

  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");

  const [loading, setLoading] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState<CursorBridgeStatus>({
    is_running: false,
    port: null,
  });
  const [bridgeActionLoading, setBridgeActionLoading] = useState(false);

  const [patchInfo, setPatchInfo] = useState<CursorPatchInfo | null>(null);
  const [patchActionLoading, setPatchActionLoading] = useState(false);

  const [clientRunning, setClientRunning] = useState(false);
  const [restartingClient, setRestartingClient] = useState(false);

  const [testModalOpen, setTestModalOpen] = useState(false);

  // ── 步骤化 UI 状态 ──
  const [currentStep, setCurrentStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [configConfirmed, setConfigConfirmed] = useState(false);

  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchCodexModels,
  );
  const { group: apiKeyGroup, onBoundTokenChange } = useBoundTokenGroup(
    "cursor",
    apiKey,
  );

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const cfg = await getCursorConfig();
      setConfigExists(cfg.config_exists ?? false);
      setConfigPath(cfg.config_path ?? "");

      if (!silent) {
        if (cfg.base_url?.trim()) {
          setUrl(cfg.base_url.trim());
        } else {
          setUrl(PRESET_URLS[0]);
        }
        setApiKey(cfg.api_key || "");
        setModel(cfg.model || "claude-3-7-sonnet");
        setBridgePort(cfg.bridge_port || 8969);
        setAutoStartBridge(cfg.auto_start_bridge ?? true);
        setCursorPath(cfg.cursor_path || "");
      }

      // 刷新 Bridge 状态、修补状态与客户端运行状态
      const [bs, patch, running] = await Promise.all([
        getCursorBridgeStatus().catch(() => ({
          is_running: false,
          port: null,
        })),
        getCursorPatchStatus(cfg.cursor_path || undefined).catch(() => null),
        checkAppProcessStatus("cursor").catch(() => false),
      ]);
      setBridgeStatus(bs);
      setPatchInfo(patch);
      setClientRunning(running);

      if (!silent && (cfg.config_exists ?? false)) {
        setShowSummary(true);
        setMaxStepReached(TOTAL_STEPS - 1);
      }
    } catch (e) {
      toast.error(`读取 Cursor 配置失败: ${e}`);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setConfigConfirmed(false);
  }, [url, apiKey, model, bridgePort, autoStartBridge, cursorPath]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void getCursorBridgeStatus()
        .then(setBridgeStatus)
        .catch(() => {});
      void checkAppProcessStatus("cursor")
        .then(setClientRunning)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleBridge = async () => {
    setBridgeActionLoading(true);
    try {
      if (bridgeStatus.is_running) {
        await stopCursorBridge();
        setBridgeStatus({ is_running: false, port: null });
        toast.success("Cursor Bridge 网关已停止");
      } else {
        const port = await startCursorBridge(bridgePort);
        setBridgeStatus({ is_running: true, port });
        toast.success(`Cursor Bridge 网关已在端口 ${port} 启动`);
      }
    } catch (e) {
      toast.error(`切换 Bridge 状态失败: ${e}`);
    } finally {
      setBridgeActionLoading(false);
    }
  };

  const handleApplyPatch = async () => {
    setPatchActionLoading(true);
    try {
      const msg = await patchCursorClient(cursorPath || undefined, bridgePort);
      toast.success(msg);
      const patch = await getCursorPatchStatus(cursorPath || undefined);
      setPatchInfo(patch);
    } catch (e) {
      toast.error(`修补 Cursor 失败: ${e}`);
    } finally {
      setPatchActionLoading(false);
    }
  };

  const handleRestorePatch = async () => {
    setPatchActionLoading(true);
    try {
      const msg = await restoreCursorClient(cursorPath || undefined);
      toast.success(msg);
      const patch = await getCursorPatchStatus(cursorPath || undefined);
      setPatchInfo(patch);
    } catch (e) {
      toast.error(`还原 Cursor 失败: ${e}`);
    } finally {
      setPatchActionLoading(false);
    }
  };

  const handleBrowsePath = async () => {
    try {
      const selected = await browseAppPath("cursor");
      if (selected) {
        setCursorPath(selected);
        const patch = await getCursorPatchStatus(selected);
        setPatchInfo(patch);
        toast.success("已选择 Cursor 路径");
      }
    } catch (e) {
      toast.error(`选择路径失败: ${e}`);
    }
  };

  const handleRestartClient = async () => {
    setRestartingClient(true);
    try {
      const msg = await restartTargetApp("cursor", cursorPath || undefined);
      toast.success(msg);
      setClientRunning(true);
    } catch (e) {
      toast.error(`启动/重启 Cursor 失败: ${e}`);
    } finally {
      setRestartingClient(false);
    }
  };

  const handleSave = async (andStartBridge = false) => {
    if (!apiKey.trim()) {
      toast.error("请输入或绑定 API Key");
      return;
    }
    const payload: CursorConfig = {
      base_url: url.trim(),
      api_key: apiKey.trim(),
      model: model.trim() || "claude-3-7-sonnet",
      bridge_port: bridgePort,
      auto_start_bridge: autoStartBridge,
      cursor_path: cursorPath.trim() || null,
    };
    try {
      await setCursorConfig(payload);
      toast.success("Cursor 配置已成功保存！");
      setConfigExists(true);
      setConfigConfirmed(true);

      if (andStartBridge && !bridgeStatus.is_running) {
        const port = await startCursorBridge(bridgePort);
        setBridgeStatus({ is_running: true, port });
        toast.success(`Bridge 网关已在端口 ${port} 启动！`);
      }

      await load(true);
      setShowSummary(true);
    } catch (e) {
      toast.error(`保存配置失败: ${e}`);
    }
  };

  const goToStep = (target: number) => {
    if (target < 0 || target >= TOTAL_STEPS) return;
    setDirection(target > currentStep ? 1 : -1);
    setCurrentStep(target);
    setMaxStepReached((prev) => Math.max(prev, target));
  };

  const steps: StepDef[] = [
    { label: "服务与密钥" },
    { label: "模型配置" },
    { label: "Bridge网关" },
    { label: "客户端修补" },
    { label: "确认完成" },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // ── 概览/摘要视图 (已配置状态直接呈现) ──
  if (showSummary) {
    return (
      <div className="space-y-6">
        <ConfigPathBar
          path={configPath}
          shortPath={configPath || "~/.ai-helper/cursor_config.json"}
          exists={configExists}
        />

        {/* 核心状态总览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bridge 状态卡片 */}
          <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/30 backdrop-blur-md shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-slate-700 dark:text-gray-300" />
                <span className="text-xs font-semibold text-slate-800 dark:text-white">
                  本地 Bridge 网关服务
                </span>
              </div>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1",
                  bridgeStatus.is_running
                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-gray-400",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    bridgeStatus.is_running
                      ? "bg-emerald-500 animate-pulse"
                      : "bg-slate-400",
                  )}
                />
                {bridgeStatus.is_running
                  ? `运行中 (端口 ${bridgeStatus.port || bridgePort})`
                  : "已停止"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-gray-400">
              在本地 127.0.0.1 监听并接收 Cursor Agent 与 Composer 的流式代码请求，将其自动转译并安全分发至自有站点。
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleToggleBridge}
                disabled={bridgeActionLoading}
                className={cn(
                  "h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60",
                  bridgeStatus.is_running
                    ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                    : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20",
                )}
              >
                {bridgeActionLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Power className="w-3.5 h-3.5" />
                )}
                {bridgeStatus.is_running ? "停止网关" : "启动网关"}
              </button>
            </div>
          </div>

          {/* Cursor 客户端修补状态 */}
          <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/30 backdrop-blur-md shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-slate-700 dark:text-gray-300" />
                <span className="text-xs font-semibold text-slate-800 dark:text-white">
                  Cursor 客户端挂接状态
                </span>
              </div>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1",
                  patchInfo?.is_patched
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
                    : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
                )}
              >
                {patchInfo?.is_patched ? "已挂接本地网关" : "原生官方连接"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 truncate" title={patchInfo?.cursor_app_path || "未检测到路径"}>
              路径: {patchInfo?.cursor_app_path || "未检测到 Cursor 安装路径"}
            </p>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {!patchInfo?.is_patched ? (
                <button
                  onClick={handleApplyPatch}
                  disabled={patchActionLoading || !patchInfo?.is_installed}
                  className="h-8 px-3 rounded-xl bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-semibold flex items-center gap-1.5 transition-transform hover:scale-102 cursor-pointer disabled:opacity-60"
                >
                  {patchActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  一键修补挂接
                </button>
              ) : (
                <button
                  onClick={handleRestorePatch}
                  disabled={patchActionLoading}
                  className="h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {patchActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  还原原生连接
                </button>
              )}

              <button
                onClick={handleRestartClient}
                disabled={restartingClient || !patchInfo?.is_installed}
                className="h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
              >
                {restartingClient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {clientRunning ? "重启 Cursor" : "启动 Cursor"}
              </button>
            </div>
          </div>
        </div>

        {/* 实时通道分组健康监控面板 */}
        <ChannelGroupMonitor
          toolId="cursor"
          toolName="Cursor IDE"
          hasConfiguredKey={Boolean(apiKey?.trim())}
          configuredKey={apiKey}
          currentGroupName={apiKeyGroup}
        />

        {/* 快捷操作条 */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => {
              setShowSummary(false);
              goToStep(0);
            }}
            className="h-9 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            修改配置
          </button>
          <button
            onClick={() => setTestModalOpen(true)}
            className="h-9 px-4 rounded-xl bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-semibold flex items-center gap-1.5 transition-transform hover:scale-102 cursor-pointer shadow-2xs"
          >
            <Radio className="w-3.5 h-3.5" />
            测试流式连通性
          </button>
        </div>

        <TerminalTestModal
          open={testModalOpen}
          onClose={() => setTestModalOpen(false)}
          type="cursor"
          url={url}
          apiKey={apiKey}
          model={model}
        />
      </div>
    );
  }

  // ── 向导模式 UI ──
  return (
    <div className="space-y-6">
      <ConfigPathBar
        path={configPath}
        shortPath={configPath || "~/.ai-helper/cursor_config.json"}
        exists={configExists}
      />

      <StepIndicator
        steps={steps}
        currentStep={currentStep}
        maxStepReached={maxStepReached}
        onStepClick={goToStep}
      />

      <div className="relative overflow-hidden min-h-[380px]">
        <AnimatePresence mode="wait" custom={direction}>
          {currentStep === 0 && (
            <motion.div
              key="step-0"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-6"
            >
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  选择服务站点
                </Label>
                <NodeCardSelector value={url} onChange={setUrl} />
              </div>

              <div className="space-y-2">
                <ApiKeyInput
                  title="API Key"
                  badgeText="cursor_config.json"
                  value={apiKey}
                  destinationUrl={url}
                  onChange={setApiKey}
                  toolId="cursor"
                  toolName="Cursor IDE"
                  onBoundTokenChange={onBoundTokenChange}
                />
              </div>

              <ChannelGroupMonitor
                toolId="cursor"
                toolName="Cursor IDE"
                hasConfiguredKey={Boolean(apiKey?.trim())}
                configuredKey={apiKey}
                currentGroupName={apiKeyGroup}
              />
            </motion.div>
          )}

          {currentStep === 1 && (
            <motion.div
              key="step-1"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-6"
            >
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  默认代理模型 (Cursor Agent / Composer)
                </Label>
                <ModelInput
                  id="cursor-model"
                  value={model}
                  onChange={setModel}
                  models={models}
                  refreshing={refreshingModels}
                  onRefresh={refreshModels}
                  placeholder="如 claude-3-7-sonnet 或 deepseek-chat"
                />
                <p className="text-[11px] text-slate-500 dark:text-gray-400">
                  当 Cursor 请求未明确指定模型或使用默认路由时，网关将自动中继转发至该模型。
                </p>
              </div>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step-2"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-6"
            >
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  本地反向代理端口 (Bridge Port)
                </Label>
                <input
                  type="number"
                  value={bridgePort}
                  onChange={(e) => setBridgePort(Number(e.target.value) || 8969)}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 text-xs text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs font-mono"
                  placeholder="8969"
                />
                <p className="text-[11px] text-slate-500 dark:text-gray-400">
                  本地网关服务监听端口，默认推荐 8969。Cursor 将通过修补重定向向该端口发送 Agent 交互请求。
                </p>
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/30">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-slate-800 dark:text-white">
                    应用启动时自动拉起 Bridge 网关
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    AI Helper 开启时自动在后台静默恢复 Cursor 本地代理网关。
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={autoStartBridge}
                  onChange={(e) => setAutoStartBridge(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step-3"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-6"
            >
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  Cursor 安装路径
                </Label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cursorPath || patchInfo?.cursor_app_path || ""}
                    onChange={(e) => setCursorPath(e.target.value)}
                    className="flex-1 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 text-xs text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs font-mono"
                    placeholder="自动探测中或手动浏览指定 Cursor.exe"
                  />
                  <button
                    onClick={handleBrowsePath}
                    className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-slate-700 dark:text-gray-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    浏览
                  </button>
                </div>
              </div>

              {/* 修补卡片 */}
              <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-white">
                    核心工作区修补状态
                  </span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-semibold",
                      patchInfo?.is_patched
                        ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
                        : "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-gray-400",
                    )}
                  >
                    {patchInfo?.is_patched ? "已挂接 Bridge" : "原生官方"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-gray-400">
                  {patchInfo?.message || "正在检测 Cursor 状态..."}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  {!patchInfo?.is_patched ? (
                    <button
                      onClick={handleApplyPatch}
                      disabled={patchActionLoading || !patchInfo?.is_installed}
                      className="h-8 px-3 rounded-xl bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-semibold flex items-center gap-1.5 transition-transform hover:scale-102 cursor-pointer disabled:opacity-60"
                    >
                      {patchActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      一键修补挂接
                    </button>
                  ) : (
                    <button
                      onClick={handleRestorePatch}
                      disabled={patchActionLoading}
                      className="h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {patchActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      还原原生状态
                    </button>
                  )}
                  <button
                    onClick={handleRestartClient}
                    disabled={restartingClient || !patchInfo?.is_installed}
                    className="h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {restartingClient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    {clientRunning ? "重启 Cursor" : "启动 Cursor"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div
              key="step-4"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-6"
            >
              <ConfigConfirmStep
                totalSteps={TOTAL_STEPS}
                confirmed={configConfirmed}
                onConfirmedChange={setConfigConfirmed}
                onEditStep={goToStep}
                items={[
                  { label: "服务节点", value: url, stepIndex: 0, icon: <Server className="w-4 h-4" /> },
                  {
                    label: "API Key",
                    value: apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : "未填写",
                    badge: apiKeyGroup || undefined,
                    stepIndex: 0,
                    icon: <KeyRound className="w-4 h-4" />,
                  },
                  { label: "代理模型", value: model, stepIndex: 1, icon: <Cpu className="w-4 h-4" /> },
                  { label: "Bridge 端口", value: `127.0.0.1:${bridgePort}`, stepIndex: 2, icon: <Radio className="w-4 h-4" /> },
                  { label: "挂接状态", value: patchInfo?.is_patched ? "已挂接" : "未挂接", stepIndex: 3, icon: <Wrench className="w-4 h-4" /> },
                ]}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 底部导航条 */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200/80 dark:border-white/10">
        <button
          onClick={() => goToStep(currentStep - 1)}
          disabled={currentStep === 0}
          className="h-9 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          上一步
        </button>

        {currentStep < TOTAL_STEPS - 1 ? (
          <button
            onClick={() => goToStep(currentStep + 1)}
            className="h-9 px-4 rounded-xl bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-semibold flex items-center gap-1 transition-transform hover:scale-102 cursor-pointer shadow-2xs"
          >
            下一步
            <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => handleSave(true)}
            className="h-9 px-4 rounded-xl bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-semibold flex items-center gap-1.5 transition-transform hover:scale-102 cursor-pointer shadow-2xs"
          >
            <CheckCircle2 className="w-4 h-4" />
            完成配置
          </button>
        )}
      </div>

      <TerminalTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        type="cursor"
        url={url}
        apiKey={apiKey}
        model={model}
      />
    </div>
  );
}

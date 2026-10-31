import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  Server,
  Radio,
  Power,
  RotateCcw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  KeyRound,
  Cpu,
  FolderOpen,
  AlertCircle,
  Sliders,
  ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CursorIcon } from "./BrandIcons";
import {
  getCursorConfig,
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
  detectAppPath,
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
import { SpotlightCard } from "./react-bits/SpotlightCard";
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
  const [model, setModel] = useState("");
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
  const [detectingPath, setDetectingPath] = useState(false);

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
        setModel(cfg.model || "");
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
        .then((s) => {
          setBridgeStatus((prev) => {
            if (prev.is_running === s.is_running && prev.port === s.port) {
              return prev;
            }
            return s;
          });
        })
        .catch(() => {});
      void checkAppProcessStatus("cursor")
        .then((running) => {
          setClientRunning((prev) => (prev === running ? prev : running));
        })
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
        toast.info("已停止 Cursor 本地 Bridge 网关");
      } else {
        const port = await startCursorBridge(bridgePort);
        const actualStatus = await getCursorBridgeStatus().catch(() => ({
          is_running: true,
          port,
        }));
        setBridgeStatus(actualStatus);
        if (actualStatus.port) {
          setBridgePort(actualStatus.port);
        }
        toast.success(
          `Cursor Bridge 已成功启动，监听端口: ${actualStatus.port || port}`,
        );
      }
    } catch (e) {
      const errMsg = String(e);
      if (
        errMsg.includes("无法绑定本地端口") ||
        errMsg.includes("Address already in use") ||
        errMsg.includes("bind")
      ) {
        toast.error(
          `端口 ${bridgePort} 已被占用，请在配置中更换端口号（建议 8000-65535）或关闭占用该端口的程序`,
          { duration: 6000 },
        );
      } else {
        toast.error(`Bridge 网关操作失败: ${e}`);
      }
    } finally {
      setBridgeActionLoading(false);
    }
  };

  const handleRestartBridge = async () => {
    setBridgeActionLoading(true);
    try {
      await stopCursorBridge().catch(() => {});
      const boundPort = await startCursorBridge(bridgePort);
      setBridgeStatus({ is_running: true, port: boundPort });
      toast.success(`Cursor Bridge 已重启，监听端口: ${boundPort}`);
    } catch (e) {
      toast.error(`重启 Bridge 失败: ${e}`);
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
        toast.success(`已选择 Cursor 路径: ${selected}`);
      }
    } catch (e) {
      toast.error(`选择路径失败: ${e}`);
    }
  };

  const handleDetectPath = async () => {
    setDetectingPath(true);
    try {
      const detected = await detectAppPath("cursor");
      if (detected.path) {
        setCursorPath(detected.path);
        setClientRunning(detected.is_running);
        const patch = await getCursorPatchStatus(detected.path);
        setPatchInfo(patch);
        toast.success(`成功探测到 Cursor 客户端: ${detected.path}`);
      } else {
        toast.warning("未检测到已安装的 Cursor 客户端，请手动浏览指定");
      }
    } catch (e) {
      toast.error(`探测失败: ${e}`);
    } finally {
      setDetectingPath(false);
    }
  };

  const handleRestartClient = async () => {
    setRestartingClient(true);
    try {
      // 启动前确保 Bridge 在运行
      if (!bridgeStatus.is_running) {
        const port = await startCursorBridge(bridgePort);
        setBridgeStatus({ is_running: true, port });
      }
      const msg = await restartTargetApp("cursor", cursorPath || undefined);
      toast.success(msg || "已拉起 Cursor 客户端");
      setClientRunning(true);
    } catch (e) {
      toast.error(`启动/重启 Cursor 失败: ${e}`);
    } finally {
      setRestartingClient(false);
    }
  };

  const currentModel = model.trim();
  const fetchedIds = models.map((m) => m.id.trim()).filter(Boolean);
  const customModelsList = Array.from(
    new Set([currentModel, ...fetchedIds].filter(Boolean)),
  );

  const currentPayload: CursorConfig = {
    base_url: url.trim(),
    api_key: apiKey.trim(),
    model: currentModel || (fetchedIds[0] ?? ""),
    bridge_port: Number(bridgePort) || 8969,
    auto_start_bridge: autoStartBridge,
    cursor_path: cursorPath.trim() || null,
    custom_models: customModelsList,
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (!model.trim()) {
      toast.warning("请选择或输入代理模型");
      return;
    }
    if (!showSummary && (currentStep !== TOTAL_STEPS - 1 || !configConfirmed)) {
      toast.warning("请先勾选确认配置无误");
      if (currentStep !== TOTAL_STEPS - 1) {
        goToStep(TOTAL_STEPS - 1);
      }
      return;
    }
    setTestModalOpen(true);
  };

  // ── 步骤导航 ──
  const goToStep = (step: number) => {
    if (step > 1 && !apiKey.trim()) {
      toast.warning("请先在第 2 步输入 API Key");
      setDirection(1 > currentStep ? 1 : -1);
      setCurrentStep(1);
      setShowSummary(false);
      setConfigConfirmed(false);
      return;
    }
    if (step > 2 && !model.trim()) {
      toast.warning("请先在第 3 步选择或输入代理模型");
      setDirection(2 > currentStep ? 1 : -1);
      setCurrentStep(2);
      setShowSummary(false);
      setConfigConfirmed(false);
      return;
    }
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
    setMaxStepReached((prev) => Math.max(prev, step));
    setShowSummary(false);
    if (step !== TOTAL_STEPS - 1) {
      setConfigConfirmed(false);
    }
  };

  const goNext = () => {
    if (currentStep === 1 && !apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (currentStep === 2 && !model.trim()) {
      toast.warning("请选择或输入代理模型");
      return;
    }
    if (currentStep < TOTAL_STEPS - 1) goToStep(currentStep + 1);
  };

  const goPrev = () => {
    if (currentStep > 0) goToStep(currentStep - 1);
  };

  // ── 摘要计算 ──
  const urlSummary = url
    ? url
        .replace(/https?:\/\//, "")
        .replace(/\/$/, "")
        .split("/")[0]
    : undefined;
  const keySummary =
    apiKey.length > 8
      ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
      : apiKey
        ? "已填写"
        : undefined;

  const STEPS: StepDef[] = [
    { label: "接入节点", summary: urlSummary },
    { label: "API Key", summary: keySummary },
    { label: "选择模型", summary: model || undefined },
    {
      label: "Bridge 网关",
      summary: bridgeStatus.is_running
        ? `在线 :${bridgeStatus.port || bridgePort}`
        : "未启动",
    },
    { label: "确认配置", summary: configConfirmed ? "已确认" : undefined },
  ];

  // ── 各步骤内容渲染 ──
  const renderStep = (step: number) => {
    switch (step) {
      case 0:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm dark:shadow-none flex flex-col"
              spotlightColor="rgba(255, 255, 255, 0.08)"
            >
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Server size={14} className="text-black dark:text-white" />
                  API 服务网关节点
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  支持多线路故障切换
                </span>
              </div>
              <NodeCardSelector value={url} onChange={setUrl} />
            </SpotlightCard>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 text-center px-2">
              选择一个距离最近或延迟最低的接入节点，Cursor Bridge
              网关将通过此节点转译并中继分发请求。
            </p>
          </div>
        );

      case 1:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm dark:shadow-none"
              spotlightColor="rgba(255, 255, 255, 0.08)"
            >
              <ApiKeyInput
                title="API Key"
                badgeText="cursor_config.json"
                value={apiKey}
                destinationUrl={url}
                onChange={setApiKey}
                placeholder="sk-... (填入所选服务商的 API 密钥)"
                storageLocation="~/.ai-helper/cursor_config.json"
                hintText="用于向中转节点发起大模型请求认证"
                toolName="Cursor IDE"
                toolId="cursor"
                onBoundTokenChange={onBoundTokenChange}
              />
            </SpotlightCard>
          </div>
        );

      case 2:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm dark:shadow-none"
              spotlightColor="rgba(255, 255, 255, 0.08)"
            >
              <ModelInput
                value={model}
                onChange={setModel}
                models={models}
                placeholder="选择或输入测试模型名称 (如 claude-3-7-sonnet 或 deepseek-chat)"
                id="cursor-models"
                onRefresh={() => void refreshModels()}
                refreshing={refreshingModels}
              />
            </SpotlightCard>

            <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed flex items-start gap-2">
              <Sparkles size={13} className="text-black dark:text-white shrink-0 mt-0.5" />
              <span>
                Cursor 发送的内部 Connect-RPC 模型调用将由本地 Bridge
                网关透明转译为您在此选定的通用大模型，并实时支持流式输出与代码补全。
              </span>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm dark:shadow-none flex flex-col"
              spotlightColor="rgba(255, 255, 255, 0.08)"
            >
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Sliders size={14} className="text-black dark:text-white" />
                  本地 Bridge 网关与客户端集成
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  Connect-RPC 转译守护
                </span>
              </div>

              {/* 核心架构说明横幅：为什么必须开启 Bridge */}
              <div className="p-3 rounded-xl border border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-white/5 mb-3.5 flex items-start gap-2.5">
                <AlertCircle
                  size={15}
                  className="text-black dark:text-white shrink-0 mt-0.5"
                />
                <div className="space-y-0.5 text-[11px]">
                  <span className="font-semibold text-black dark:text-white">
                    核心说明：必须挂接 Bridge 才能在 Cursor 中使用自定义大模型
                  </span>
                  <p className="text-slate-600 dark:text-gray-300 leading-relaxed">
                    Cursor 客户端通过专有的 Connect-RPC / HTTP2 协议通信，不支持直接配置第三方 API。通过一键修补挂接本地 Bridge 网关，实现透明转译分发，无缝兼容各类通用大模型。AI Helper 支持托盘守护，关闭主窗口时网关不中断。
                  </p>
                </div>
              </div>

              {/* 随 AI Helper 自动拉起 Bridge 开关 */}
              <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/60 dark:border-white/10 dark:bg-white/[0.03] mb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Radio size={14} className="text-black dark:text-white" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        随 AI Helper 自动拉起 Bridge (后台常驻)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                      开启后，AI Helper 启动时将自动在后台保持 Bridge 在线。关闭主窗口时将自动最小化至系统托盘，避免 Bridge 中断退出。
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={autoStartBridge}
                      onChange={(e) => setAutoStartBridge(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black dark:peer-checked:bg-white dark:peer-checked:after:bg-black" />
                  </label>
                </div>
              </div>

              {/* 网关端口配置 */}
              <div className="space-y-1.5 mb-3.5">
                <label className="text-xs font-medium text-slate-700 dark:text-gray-300 flex items-center justify-between">
                  <span>本地网关端口 (Port)</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    8000..=65535 (默认 8969)
                  </span>
                </label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={bridgePort}
                  onChange={(e) =>
                    setBridgePort(Number(e.target.value) || 8969)
                  }
                  className="w-full h-9 px-3 rounded-lg font-mono text-xs bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-gray-200 focus:bg-white dark:focus:bg-black focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20 outline-none"
                  placeholder="8969"
                />
              </div>

              {/* Cursor 安装路径探测与选择 */}
              <div className="space-y-1.5 mb-3.5">
                <label className="text-xs font-medium text-slate-700 dark:text-gray-300 flex items-center justify-between">
                  <span>Cursor 客户端安装路径</span>
                  <span className="text-[10px] text-slate-400">自动探测或手动浏览</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cursorPath || patchInfo?.cursor_app_path || ""}
                    onChange={(e) => setCursorPath(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-lg font-mono text-xs bg-slate-50/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-gray-200 focus:bg-white dark:focus:bg-black focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20 outline-none"
                    placeholder="自动探测中或指定 Cursor.exe 完整路径"
                  />
                  <button
                    type="button"
                    onClick={() => void handleDetectPath()}
                    disabled={detectingPath}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white hover:bg-slate-50 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {detectingPath ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RotateCcw size={13} />
                    )}
                    <span>探测</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleBrowsePath()}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white hover:bg-slate-50 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-medium text-slate-700 dark:text-gray-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FolderOpen size={13} />
                    <span>浏览</span>
                  </button>
                </div>
              </div>

              {/* 核心工作区修补状态卡片 */}
              <div className="p-3.5 rounded-xl border border-neutral-200/80 bg-neutral-100/50 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={15} className="text-black dark:text-white" />
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      核心工作区修补状态
                    </span>
                  </div>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                      patchInfo?.is_patched
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                        : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-gray-400 dark:border-white/10",
                    )}
                  >
                    {patchInfo?.is_patched ? "已挂接 Bridge" : "原生官方直连"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed mb-3">
                  {patchInfo?.message || "正在检测 Cursor 客户端完整性与挂接状态..."}
                </p>
                <div className="flex items-center gap-2">
                  {!patchInfo?.is_patched ? (
                    <button
                      type="button"
                      onClick={() => void handleApplyPatch()}
                      disabled={patchActionLoading || !patchInfo?.is_installed}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-transform hover:scale-[1.02] cursor-pointer disabled:opacity-60"
                    >
                      {patchActionLoading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      <span>一键修补挂接</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRestorePatch()}
                      disabled={patchActionLoading}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {patchActionLoading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RotateCcw size={12} />
                      )}
                      <span>还原原生状态</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleRestartClient()}
                    disabled={restartingClient || !patchInfo?.is_installed}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {restartingClient ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <CursorIcon size={12} />
                    )}
                    <span>{clientRunning ? "重启 Cursor" : "启动 Cursor"}</span>
                  </button>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-white/5 text-[11px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
                <span>本地网关: http://127.0.0.1:{bridgePort}</span>
                <span className="text-[10px] font-mono">Connect-RPC 透明代理</span>
              </div>
            </SpotlightCard>
          </div>
        );

      case 4:
        return (
          <div className="p-4 flex flex-col gap-4">
            <ConfigConfirmStep
              spotlightColor="rgba(255, 255, 255, 0.08)"
              totalSteps={TOTAL_STEPS}
              confirmed={configConfirmed}
              onConfirmedChange={setConfigConfirmed}
              onEditStep={goToStep}
              items={[
                {
                  label: "接入节点",
                  value: urlSummary || url,
                  detail: url,
                  icon: <Server size={14} />,
                  stepIndex: 0,
                },
                {
                  label: "API Key",
                  value: keySummary || "未配置",
                  badge: apiKeyGroup || undefined,
                  icon: <KeyRound size={14} />,
                  stepIndex: 1,
                },
                {
                  label: "代理模型",
                  value: model || "未配置",
                  icon: <Cpu size={14} />,
                  stepIndex: 2,
                },
                {
                  label: "Bridge 网关",
                  value: `端口 :${bridgePort} · ${autoStartBridge ? "自动拉起" : "手动启动"}`,
                  detail: [
                    patchInfo?.is_patched ? "已挂接 Bridge" : "原生官方直连",
                    `http://127.0.0.1:${bridgePort}`,
                  ].join(" · "),
                  icon: <Radio size={14} />,
                  stepIndex: 3,
                },
              ]}
            />
          </div>
        );

      default:
        return null;
    }
  };

  // ── 摘要视图 ──
  const renderSummarySection = () => (
    <div className="w-full flex flex-col gap-4">
      <SpotlightCard
        className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm"
        spotlightColor="rgba(255, 255, 255, 0.08)"
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              当前配置概览
            </span>
          </div>
          <span className="text-[11px] font-mono text-neutral-800 dark:text-neutral-200 bg-neutral-100 dark:bg-white/10 px-2 py-0.5 rounded-full border border-neutral-200 dark:border-white/10">
            {bridgeStatus.is_running ? "Bridge 运行中" : "网关就绪"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <Server size={13} className="text-black dark:text-white" />
              <span>服务网关节点</span>
            </div>
            <div
              className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate"
              title={url}
            >
              {urlSummary || url}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 min-w-0">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <KeyRound size={13} className="text-black dark:text-white shrink-0" />
              <span>API Key 凭据</span>
            </div>
            {apiKeyGroup ? (
              <div className="mb-1 min-w-0">
                <span
                  className="inline-block max-w-full px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-snug break-words bg-neutral-100 text-neutral-800 border-neutral-200 dark:bg-white/10 dark:text-neutral-200 dark:border-white/10"
                  title={`所属分组：${apiKeyGroup}`}
                >
                  {apiKeyGroup}
                </span>
              </div>
            ) : null}
            <div className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate">
              {keySummary || "未配置"}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <Cpu size={13} className="text-black dark:text-white" />
              <span>目标代理模型</span>
            </div>
            <div className="text-xs font-mono font-medium text-black dark:text-white truncate">
              {model || "未配置"}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <Radio size={13} className="text-black dark:text-white" />
              <span>Bridge 网关端口</span>
            </div>
            <div className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate">
              :{bridgeStatus.port || bridgePort} (
              {bridgeStatus.is_running ? "在线" : "未启动"})
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-white/5">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/5 text-xs">
            <div className="flex items-center gap-2 truncate pr-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  clientRunning
                    ? "bg-emerald-500 animate-pulse"
                    : patchInfo?.is_installed || Boolean(cursorPath)
                      ? "bg-neutral-500"
                      : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              />
              <span className="text-slate-700 dark:text-gray-300 truncate">
                {clientRunning
                  ? "Cursor 客户端运行中"
                  : patchInfo?.is_installed || Boolean(cursorPath)
                    ? "客户端已安装就绪"
                    : "未检测到默认安装路径"}
              </span>
            </div>
            {cursorPath || patchInfo?.cursor_app_path ? (
              <span
                className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate max-w-[200px]"
                title={cursorPath || patchInfo?.cursor_app_path || ""}
              >
                {cursorPath || patchInfo?.cursor_app_path}
              </span>
            ) : (
              <span className="text-[10px] text-amber-500">
                可在分步配置第 4 步中指定路径
              </span>
            )}
          </div>
        </div>
      </SpotlightCard>

      {/* 实时通道分组健康监控面板（概览模式直接呈现） */}
      <ChannelGroupMonitor
        toolName="Cursor IDE"
        toolId="cursor"
        hasConfiguredKey={Boolean(apiKey?.trim())}
        configuredKey={apiKey}
        currentGroupName={apiKeyGroup}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-black dark:text-white" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Cursor 本地配置与网关状态...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full min-h-full flex flex-col justify-between gap-5 pb-2">
      {/* ── 标题栏 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-100 text-black border border-neutral-200 dark:bg-white/10 dark:text-white dark:border-white/10 flex items-center justify-center flex-shrink-0 shadow-xs">
            <CursorIcon size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                Cursor 接入配置
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-800 border border-neutral-200 dark:bg-white/10 dark:text-neutral-200 dark:border-white/10">
                Connect-RPC / Bridge
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 Cursor 客户端提供智能转译网关与流式中继，一键修补挂接自有大模型
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Bridge 网关运行状态微胶囊 */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border ${
              bridgeStatus.is_running
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-white/10"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus.is_running
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-slate-400"
              }`}
            />
            <span>
              {bridgeStatus.is_running
                ? `Bridge 在线 (:${bridgeStatus.port || bridgePort})`
                : "Bridge 未启动"}
            </span>
          </div>

          {showSummary && (
            <button
              type="button"
              onClick={() => goToStep(0)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-neutral-100 hover:bg-neutral-200 border-neutral-200 text-black dark:bg-white/10 dark:hover:bg-white/20 dark:border-white/20 dark:text-white shadow-2xs cursor-pointer"
              title="切换到分步配置向导引导模式"
            >
              <Sparkles size={12} />
              <span>分步向导</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="重新载入本地配置"
          >
            <RefreshCw size={12} />
            <span>重新载入</span>
          </button>
          <ConfigPathBar
            path={configPath}
            shortPath="~/.ai-helper/cursor_config.json"
            exists={configExists}
          />
        </div>
      </div>

      {/* ── 步骤指示器（非摘要模式下显示）── */}
      {!showSummary && (
        <div className="flex-shrink-0 px-2 py-4 border-b border-slate-100/80 dark:border-white/5">
          <StepIndicator
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={goToStep}
            maxStepReached={maxStepReached}
          />
        </div>
      )}

      {/* ── 主内容区 ── */}
      <div className="w-full flex-1 flex flex-col gap-4">
        {showSummary ? (
          renderSummarySection()
        ) : (
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="w-full flex flex-col gap-4"
            >
              {renderStep(currentStep)}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── 底部导航栏 (苹果风毛玻璃悬浮 Dock 栏) ── */}
      <div className="sticky bottom-0 z-20 mt-auto py-2.5 px-4 rounded-2xl bg-white/45 dark:bg-black/60 backdrop-blur-xl backdrop-saturate-150 border border-white/60 dark:border-white/10 shadow-[0_4px_24px_-2px_rgba(0,0,0,0.06),inset_0_1px_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_4px_24px_-2px_rgba(0,0,0,0.3),inset_0_1px_1px_0_rgba(255,255,255,0.08)] flex-shrink-0 transition-all">
        {showSummary ? (
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：辅助动作与状态指示 */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => goToStep(0)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs backdrop-blur-xs cursor-pointer"
                title="重新启动分步配置向导"
              >
                <RefreshCw
                  size={13}
                  className="text-slate-500 dark:text-gray-400"
                />
                <span>重新配置向导</span>
              </button>
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Cursor 配置已生效 (cursor_config.json)</span>
              </div>
            </div>

            {/* 右侧：主保存操作 */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSave}
                disabled={testModalOpen}
                className="flex items-center justify-center gap-2 px-6 py-2.5 min-w-[190px] rounded-xl text-xs font-semibold bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                <span>保存并应用 Cursor 配置</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            {/* 左侧：上一步与进度 */}
            <div className="flex items-center gap-2">
              {currentStep > 0 ? (
                <button
                  type="button"
                  onClick={goPrev}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs backdrop-blur-xs cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>上一步</span>
                </button>
              ) : null}
              <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium px-2">
                步骤 {currentStep + 1} / {TOTAL_STEPS}
              </span>
            </div>

            {/* 右侧：返回概览与推进/保存 */}
            <div className="flex items-center gap-2.5">
              {configExists && (
                <button
                  type="button"
                  onClick={() => setShowSummary(true)}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  返回概览
                </button>
              )}

              {currentStep < TOTAL_STEPS - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="flex items-center gap-1.5 px-6 py-2 rounded-xl text-xs font-medium bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-colors shadow-xs cursor-pointer"
                >
                  <span>下一步</span>
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={testModalOpen || !configConfirmed}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-6 py-2 min-w-[190px] rounded-xl text-xs font-semibold text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                    configConfirmed
                      ? "bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black"
                      : "bg-neutral-400 text-white dark:bg-white/30 dark:text-neutral-400",
                  )}
                >
                  <Save size={14} />
                  <span>确认并保存 Cursor 配置</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Bridge 控制固定浮层（始终可见）── */}
      <div className="flex-shrink-0 mt-2 pt-2.5 border-t border-slate-200/80 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Bridge 在线/离线状态胶囊 */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border ${
                bridgeStatus.is_running
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-white/10"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${bridgeStatus.is_running ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`}
              />
              <span>
                {bridgeStatus.is_running
                  ? `Bridge 在线 (:${bridgeStatus.port || bridgePort})`
                  : "Bridge 未启动"}
              </span>
            </div>
            {/* 启动/停止 */}
            <button
              onClick={() => void handleToggleBridge()}
              disabled={bridgeActionLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors shadow-2xs cursor-pointer disabled:opacity-60 ${
                bridgeStatus.is_running
                  ? "bg-neutral-100 border-neutral-300 text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  : "bg-black border-transparent text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              }`}
            >
              {bridgeActionLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : bridgeStatus.is_running ? (
                <Power size={12} />
              ) : (
                <Radio size={12} />
              )}
              <span>{bridgeStatus.is_running ? "停止" : "启动"} Bridge</span>
            </button>
            {/* 重启（仅在线时显示） */}
            {bridgeStatus.is_running && (
              <button
                onClick={() => void handleRestartBridge()}
                disabled={bridgeActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
              >
                <RotateCcw size={12} /> 重启
              </button>
            )}
            {/* 挂接修补 / 还原 */}
            <button
              onClick={() => void (patchInfo?.is_patched ? handleRestorePatch() : handleApplyPatch())}
              disabled={patchActionLoading || (!patchInfo?.is_patched && !patchInfo?.is_installed)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
            >
              {patchActionLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : patchInfo?.is_patched ? (
                <RotateCcw size={12} />
              ) : (
                <Sparkles size={12} />
              )}
              <span>{patchInfo?.is_patched ? "还原原生" : "修补挂接"}</span>
            </button>
            {/* 启动客户端 */}
            <button
              onClick={() => void handleRestartClient()}
              disabled={restartingClient || !patchInfo?.is_installed}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {restartingClient ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CursorIcon size={13} />
              )}
              <span>{clientRunning ? "重启客户端" : "启动客户端"}</span>
            </button>
          </div>
          <span
            className={`text-[11px] font-mono ${bridgeStatus.is_running ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}
          >
            {bridgeStatus.is_running
              ? `http://127.0.0.1:${bridgeStatus.port || bridgePort}`
              : "⚠️ Bridge 未运行"}
          </span>
        </div>
      </div>

      <TerminalTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        type="cursor"
        url={url}
        apiKey={apiKey}
        model={model}
        cursorPayload={currentPayload}
        onSuccess={() => {
          setConfigExists(true);
          setShowSummary(true);
          setMaxStepReached(TOTAL_STEPS - 1);
          setConfigConfirmed(false);
          void load(true);
        }}
      />
    </div>
  );
}

export default CursorPanel;

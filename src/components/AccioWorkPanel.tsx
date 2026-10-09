import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  Server,
  ShieldCheck,
  Sliders,
  Power,
  RotateCcw,
  Sparkles,
  Radio,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  KeyRound,
  Cpu,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { AccioWorkIcon } from "./BrandIcons";
import {
  getAccioConfig,
  startAccioBridge,
  stopAccioBridge,
  getAccioBridgeStatus,
  fetchCodexModels,
  checkAppProcessStatus,
  restartTargetApp,
} from "../lib/api";
import { ConfigPathBar } from "./ConfigPathBar";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ChannelGroupMonitor } from "./ChannelGroupMonitor";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import {
  PRESET_URLS,
  type AccioConfig,
  type AccioBridgeStatus,
} from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { TerminalTestModal } from "./TerminalTestModal";
import { StepIndicator, type StepDef } from "./StepIndicator";

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

const TOTAL_STEPS = 4;

export function AccioWorkPanel() {
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [bridgePort, setBridgePort] = useState<number>(8787);
  const [officialGateway, setOfficialGateway] = useState(
    "https://phoenix-gw.alibaba.com",
  );
  const [fallbackOfficial, setFallbackOfficial] = useState(false);
  const [preventOfficialLeak, setPreventOfficialLeak] = useState(true);
  const [autoStartBridge, setAutoStartBridge] = useState(true);

  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [isInstalled, setIsInstalled] = useState(false);
  const [appPath, setAppPath] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState<AccioBridgeStatus>({
    is_running: false,
    port: null,
  });
  const [bridgeActionLoading, setBridgeActionLoading] = useState(false);

  const [clientRunning, setClientRunning] = useState(false);
  const [restartingClient, setRestartingClient] = useState(false);

  const [testModalOpen, setTestModalOpen] = useState(false);

  // ── 步骤化 UI 状态 ──
  const [currentStep, setCurrentStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [maxStepReached, setMaxStepReached] = useState(0);

  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchCodexModels,
  );

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const cfg = await getAccioConfig();
      setConfigExists(cfg.config_exists ?? false);
      setConfigPath(cfg.config_path ?? "");
      setIsInstalled(cfg.is_installed ?? false);
      setAppPath(cfg.app_path ?? null);

      if (!silent) {
        if (cfg.base_url?.trim()) {
          setUrl(cfg.base_url.trim());
        } else {
          setUrl(PRESET_URLS[0]);
        }
        setApiKey(cfg.api_key || "");
        setModel(cfg.model || "");
        setBridgePort(cfg.bridge_port || 8787);
        setOfficialGateway(
          cfg.official_gateway || "https://phoenix-gw.alibaba.com",
        );
        setFallbackOfficial(cfg.fallback_official ?? false);
        setPreventOfficialLeak(cfg.prevent_official_leak ?? true);
        setAutoStartBridge(cfg.auto_start_bridge ?? true);
      }

      // 刷新 Bridge 状态与客户端运行状态
      const [bs, running] = await Promise.all([
        getAccioBridgeStatus().catch(() => ({
          is_running: false,
          port: null,
        })),
        checkAppProcessStatus("acciowork").catch(() => false),
      ]);
      setBridgeStatus(bs);
      setClientRunning(running);

      // 如果配置已存在，进入摘要视图
      if (!silent && (cfg.config_exists ?? false)) {
        setShowSummary(true);
        setMaxStepReached(TOTAL_STEPS - 1);
      }
    } catch (e) {
      toast.error(`读取 Accio Work 配置失败: ${e}`);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void getAccioBridgeStatus()
        .then(setBridgeStatus)
        .catch(() => {});
      void checkAppProcessStatus("acciowork")
        .then(setClientRunning)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleBridge = async () => {
    setBridgeActionLoading(true);
    try {
      if (bridgeStatus.is_running) {
        await stopAccioBridge();
        setBridgeStatus({ is_running: false, port: null });
        toast.info("已停止 Accio Work 本地 Bridge 网关");
      } else {
        const boundPort = await startAccioBridge(bridgePort);
        const actualStatus = await getAccioBridgeStatus().catch(() => ({
          is_running: true,
          port: boundPort,
        }));
        setBridgeStatus(actualStatus);
        if (actualStatus.port) {
          setBridgePort(actualStatus.port);
        }
        toast.success(
          `Accio Work Bridge 已成功启动，监听端口: ${actualStatus.port || boundPort}`,
        );
      }
    } catch (e) {
      toast.error(`Bridge 网关操作失败: ${e}`);
    } finally {
      setBridgeActionLoading(false);
    }
  };

  const handleRestartBridge = async () => {
    setBridgeActionLoading(true);
    try {
      await stopAccioBridge().catch(() => {});
      const boundPort = await startAccioBridge(bridgePort);
      setBridgeStatus({ is_running: true, port: boundPort });
      toast.success(`Accio Work Bridge 已重启，监听端口: ${boundPort}`);
    } catch (e) {
      toast.error(`重启 Bridge 失败: ${e}`);
    } finally {
      setBridgeActionLoading(false);
    }
  };

  const handleLaunchClient = async () => {
    setRestartingClient(true);
    try {
      // 启动前确保 Bridge 在运行
      if (!bridgeStatus.is_running) {
        const boundPort = await startAccioBridge(bridgePort);
        setBridgeStatus({ is_running: true, port: boundPort });
      }
      const msg = await restartTargetApp("acciowork");
      toast.success(msg || "已拉起 Accio Work 客户端 (自动注入本地网关环境)");
      setClientRunning(true);
    } catch (e) {
      toast.error(`拉起 Accio Work 客户端失败: ${e}`);
    } finally {
      setRestartingClient(false);
    }
  };

  const currentPayload: AccioConfig = {
    base_url: url,
    api_key: apiKey,
    model: model,
    bridge_port: Number(bridgePort) || 8787,
    official_gateway: officialGateway.trim(),
    fallback_official: fallbackOfficial,
    prevent_official_leak: preventOfficialLeak,
    auto_start_bridge: autoStartBridge,
    cached_models: models.map((m) => m.id),
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (!model.trim()) {
      toast.warning("请选择或输入测试模型");
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
      return;
    }
    if (step > 2 && !model.trim()) {
      toast.warning("请先在第 3 步选择或输入测试模型");
      setDirection(2 > currentStep ? 1 : -1);
      setCurrentStep(2);
      setShowSummary(false);
      return;
    }
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
    setMaxStepReached((prev) => Math.max(prev, step));
    setShowSummary(false);
  };
  const goNext = () => {
    if (currentStep === 1 && !apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (currentStep === 2 && !model.trim()) {
      toast.warning("请选择或输入测试模型");
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
  ];

  // ── 各步骤内容渲染 ──
  const renderStep = (step: number) => {
    switch (step) {
      case 0:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col"
              spotlightColor="rgba(255, 106, 0, 0.12)"
            >
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Server size={14} className="text-orange-500" />
                  API 服务网关节点
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  支持多线路故障切换
                </span>
              </div>
              <NodeCardSelector
                value={url}
                onChange={setUrl}
                accentColor="orange"
              />
            </SpotlightCard>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 text-center px-2">
              选择一个距离最近或延迟最低的接入节点，Bridge
              网关将通过此节点转发请求。
            </p>
          </div>
        );

      case 1:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
              spotlightColor="rgba(255, 106, 0, 0.12)"
            >
              <ApiKeyInput
                title="API Key"
                badgeText="accio_config.json"
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-... (填入所选服务商的 API 密钥)"
                storageLocation="~/.ai-helper/accio_config.json"
                hintText="用于向中转节点发起大模型请求认证"
                accentColor="orange"
                toolName="Accio Work"
                toolId="acciowork"
              />
            </SpotlightCard>
          </div>
        );

      case 2:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
              spotlightColor="rgba(255, 106, 0, 0.12)"
            >
              <ModelInput
                value={model}
                onChange={setModel}
                models={models}
                placeholder="选择或输入测试模型名称"
                id="accio-models"
                onRefresh={() => void refreshModels()}
                refreshing={refreshingModels}
                accentColor="orange"
              />
            </SpotlightCard>

            <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed flex items-start gap-2">
              <Sparkles size={13} className="text-orange-500 shrink-0 mt-0.5" />
              <span>
                Accio Work 发送的内部 RLab 模型调用将由本地 Bridge
                网关透明转译为您在此选定的通用大模型，并实时模拟 15 秒心跳保活。
              </span>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="p-4 flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col"
              spotlightColor="rgba(255, 106, 0, 0.12)"
            >
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Sliders size={14} className="text-orange-500" />
                  本地 Bridge 网关与熔断防护
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  进程安全守护
                </span>
              </div>

              {/* 核心架构说明横幅：为什么必须开启 Bridge */}
              <div className="p-3 rounded-xl border border-amber-200/80 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10 mb-3.5 flex items-start gap-2.5">
                <AlertCircle
                  size={15}
                  className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                />
                <div className="space-y-0.5 text-[11px]">
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    核心说明：必须开启 Bridge 才能在 Accio Work 中使用自定义模型
                  </span>
                  <p className="text-slate-600 dark:text-gray-300 leading-relaxed">
                    Accio Work 桌面端通过专有的阿里巴巴 RLab ADK
                    协议通信，不支持直接配置第三方 API。必须保持本地 Bridge
                    网关在后台常驻运行，才能实时转译请求。AI Helper
                    支持托盘守护，关闭主窗口时网关不中断。
                  </p>
                </div>
              </div>

              {/* 随 AI Helper 自动拉起 Bridge 开关 */}
              <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/60 dark:border-white/10 dark:bg-white/[0.03] mb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Radio size={14} className="text-orange-500" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        随 AI Helper 自动拉起 Bridge (后台常驻)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                      开启后，AI Helper 启动时将自动在后台保持 Bridge
                      在线。关闭主窗口时将自动最小化至系统托盘，避免 Bridge
                      中断退出。
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={autoStartBridge}
                      onChange={(e) => setAutoStartBridge(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500" />
                  </label>
                </div>
              </div>

              {/* 防耗豆熔断开关 */}
              <div className="p-3 rounded-xl border border-orange-200/80 bg-orange-50/50 dark:border-orange-500/20 dark:bg-orange-500/5 mb-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck
                        size={15}
                        className="text-orange-600 dark:text-orange-400"
                      />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        防官方直连熔断 (保护 i 豆余额)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
                      启动客户端时自动注入专属网关，并在后台严密守护。一旦检测到未路由的直连请求，将自动阻断，杜绝意外消耗阿里巴巴国际站官方
                      i 豆。
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={preventOfficialLeak}
                      onChange={(e) => setPreventOfficialLeak(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500" />
                  </label>
                </div>
              </div>

              {/* 网关端口与透明代理配置 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-gray-300 flex items-center justify-between">
                    <span>本地网关端口 (Port)</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      8787..=8807
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={bridgePort}
                    onChange={(e) =>
                      setBridgePort(Number(e.target.value) || 8787)
                    }
                    className="w-full h-9 px-3 rounded-lg font-mono text-xs bg-slate-50/80 dark:bg-[#141724]/80 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-gray-200 focus:bg-white dark:focus:bg-[#141724] focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 outline-none"
                    placeholder="8787"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    透明代理官方网关
                  </label>
                  <div className="flex items-center justify-between h-9 px-3 rounded-lg bg-slate-50/80 dark:bg-[#141724]/80 border border-slate-200 dark:border-white/10">
                    <span className="text-xs text-slate-600 dark:text-gray-300">
                      业务接口透传
                    </span>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={fallbackOfficial}
                        onChange={(e) => setFallbackOfficial(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-500" />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-white/5 text-[11px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
                <span>官方网关: {officialGateway}</span>
                <span className="text-[10px] font-mono">动态端口自动顺延</span>
              </div>
            </SpotlightCard>
          </div>
        );

      default:
        return null;
    }
  };

  // ── 摘要视图 ──
  const SummarySection = () => (
    <div className="w-full flex flex-col gap-4">
      <SpotlightCard
        className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm"
        spotlightColor="rgba(255, 106, 0, 0.12)"
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              当前配置概览
            </span>
          </div>
          <span className="text-[11px] font-mono text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-2 py-0.5 rounded-full border border-orange-200 dark:border-orange-500/20">
            {bridgeStatus.is_running ? "Bridge 运行中" : "网关就绪"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <Server size={13} className="text-orange-500" />
              <span>服务网关节点</span>
            </div>
            <div
              className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate"
              title={url}
            >
              {urlSummary || url}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <KeyRound size={13} className="text-orange-500" />
              <span>API Key 凭据</span>
            </div>
            <div className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate">
              {keySummary || "未配置"}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <Cpu size={13} className="text-orange-500" />
              <span>目标映射模型</span>
            </div>
            <div className="text-xs font-mono font-medium text-orange-600 dark:text-orange-400 truncate">
              {model || "未配置"}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
              <Radio size={13} className="text-orange-500" />
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
                    : isInstalled
                      ? "bg-blue-400"
                      : "bg-slate-400"
                }`}
              />
              <span className="text-slate-700 dark:text-gray-300 truncate">
                {clientRunning
                  ? "Accio Work 客户端运行中"
                  : isInstalled
                    ? "客户端已安装就绪"
                    : "未检测到默认安装路径"}
              </span>
            </div>
            {appPath ? (
              <span
                className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate max-w-[160px]"
                title={appPath}
              >
                {appPath}
              </span>
            ) : (
              <span className="text-[10px] text-amber-500">
                可在【路径管理】中指定
              </span>
            )}
          </div>
        </div>
      </SpotlightCard>

      {/* 实时通道分组健康监控面板（概览模式直接呈现） */}
      <ChannelGroupMonitor
        toolName="Accio Work"
        toolId="acciowork"
        accentColor="orange"
      />
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-orange-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Accio Work 本地配置与网关状态...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full min-h-full flex flex-col justify-between gap-5 pb-2">
      {/* ── 标题栏 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 border border-orange-200 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <AccioWorkIcon size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                Accio Work 接入配置
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30">
                Alibaba International / RLab Bridge
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为阿里巴巴国际站 Accio Work 桌面客户端提供智能转译网关，零耗 i
              豆对接任意第三方大模型
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
              onClick={() => {
                setShowSummary(false);
                setCurrentStep(0);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:hover:bg-orange-500/20 dark:border-orange-500/30 dark:text-orange-300 shadow-2xs cursor-pointer"
              title="切换到 4 步配置向导引导模式"
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
            shortPath="~/.ai-helper/accio_config.json"
            exists={configExists}
            accentColor="orange"
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
            accentColor="orange"
            maxStepReached={maxStepReached}
          />
        </div>
      )}

      {/* ── 主内容区 ── */}
      <div className="w-full flex-1 flex flex-col gap-4">
        {showSummary ? (
          <SummarySection />
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

      {/* ── 底部导航栏 (统一优化设计：布局均衡、去除过度拉伸与动态光晕) ── */}
      <div className="sticky bottom-0 z-20 py-2.5 px-1 flex-shrink-0 bg-white/95 dark:bg-[#0c0e18]/95 backdrop-blur-md border-t border-slate-200/80 dark:border-white/10 mt-auto">
        {showSummary ? (
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：辅助动作与状态指示 */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowSummary(false);
                  setCurrentStep(0);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 transition-colors shadow-2xs cursor-pointer"
                title="重新启动 3 步分步配置向导"
              >
                <RefreshCw size={13} className="text-slate-500 dark:text-gray-400" />
                <span>重新配置向导</span>
              </button>
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                <span>Accio 配置已生效 (accio_config.json)</span>
              </div>
            </div>

            {/* 右侧：主保存操作 */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSave}
                disabled={testModalOpen}
                className="flex items-center justify-center gap-2 px-6 py-2.5 min-w-[190px] rounded-xl text-xs font-semibold bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                <span>保存并应用 Accio 配置</span>
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
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 transition-colors shadow-2xs cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>上一步</span>
                </button>
              ) : null}
              <span className="text-[11px] text-slate-400 dark:text-gray-500 font-medium px-2">
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
                  className="flex items-center gap-1.5 px-6 py-2 rounded-xl text-xs font-medium bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white transition-colors shadow-xs cursor-pointer"
                >
                  <span>下一步</span>
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={testModalOpen}
                  className="flex items-center justify-center gap-1.5 px-6 py-2 min-w-[190px] rounded-xl text-xs font-semibold bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={14} />
                  <span>保存并应用 Accio 配置</span>
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
                  ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400"
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
            {/* 启动客户端 */}
            <button
              onClick={() => void handleLaunchClient()}
              disabled={restartingClient}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {restartingClient ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <AccioWorkIcon size={13} />
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
        type="acciowork"
        url={url}
        apiKey={apiKey}
        model={model}
        accioPayload={currentPayload}
        onSuccess={() => {
          setConfigExists(true);
          setShowSummary(true);
          setMaxStepReached(TOTAL_STEPS - 1);
          void load(true);
        }}
      />
    </div>
  );
}

export default AccioWorkPanel;

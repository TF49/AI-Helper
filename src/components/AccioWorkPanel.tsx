import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  Server,
  KeyRound,
  ShieldCheck,
  Sliders,
  Power,
  RotateCcw,
  Sparkles,
  Layers,
  FolderOpen,
  Radio,
  AlertCircle,
} from "lucide-react";
import { AccioWorkIcon } from "./BrandIcons";
import {
  getAccioConfig,
  startAccioBridge,
  stopAccioBridge,
  getAccioBridgeStatus,
  fetchCodexModels,
  checkAppProcessStatus,
  restartTargetApp,
  openConfigFile,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import {
  PRESET_URLS,
  type AccioConfig,
  type AccioBridgeStatus,
} from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";
import { TerminalTestModal } from "./TerminalTestModal";

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
        setBridgeStatus({ is_running: true, port: boundPort });
        toast.success(`Accio Work Bridge 已启动，监听端口: ${boundPort}`);
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
    <div className="w-full flex-1 flex flex-col justify-between min-h-0 gap-5 pb-2">
      {/* ── 顶部面板标题栏与快速概览 ── */}
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
              为阿里巴巴国际站 Accio Work 桌面客户端提供智能转译网关，零耗 i 豆对接任意第三方大模型
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

          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="重新载入本地配置"
          >
            <RefreshCw size={12} />
            <span>重新载入</span>
          </button>
        </div>
      </div>

      {/* ── 双列栅格配置区域 ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-0 overflow-y-auto pr-1">
        {/* ── 左列：路由网络与本地安全网关 ── */}
        <div className="flex flex-col gap-5 flex-1 min-h-0">
          {/* 卡片 1: API 服务节点选择 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
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
            <div className="flex-1 flex flex-col justify-center min-h-0">
              <NodeCardSelector
                value={url}
                onChange={setUrl}
                accentColor="orange"
                className="h-full"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 2: 本地 Bridge 网关 & 防耗豆安全熔断 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(255, 106, 0, 0.12)"
          >
            <div>
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
                <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-[11px]">
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    核心说明：必须开启 Bridge 才能在 Accio Work 中使用自定义模型
                  </span>
                  <p className="text-slate-600 dark:text-gray-300 leading-relaxed">
                    Accio Work 桌面端通过专有的阿里巴巴 RLab ADK 协议通信，不支持直接配置第三方 API。必须保持本地 Bridge 网关在后台常驻运行，才能实时转译请求。AI Helper 支持托盘守护，关闭主窗口时网关不中断。
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
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500" />
                  </label>
                </div>
              </div>

              {/* 防耗豆熔断开关 */}
              <div className="p-3 rounded-xl border border-orange-200/80 bg-orange-50/50 dark:border-orange-500/20 dark:bg-orange-500/5 mb-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={15} className="text-orange-600 dark:text-orange-400" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        防官方直连熔断 (保护 i 豆余额)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
                      启动客户端时自动注入专属网关，并在后台严密守护。一旦检测到未路由的直连请求，将自动阻断，杜绝意外消耗阿里巴巴国际站官方 i 豆。
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
                    onChange={(e) => setBridgePort(Number(e.target.value) || 8787)}
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
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-white/5 text-[11px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
              <span>官方网关: {officialGateway}</span>
              <span className="text-[10px] font-mono">动态端口自动顺延</span>
            </div>
          </SpotlightCard>

          {/* 卡片 3: 配置文件与客户端检测 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-shrink-0"
            spotlightColor="rgba(255, 106, 0, 0.12)"
          >
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                <Layers size={14} className="text-orange-500" />
                客户端与配置状态
              </Label>
              {configPath && (
                <button
                  type="button"
                  onClick={() => void openConfigFile(configPath)}
                  className="flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 cursor-pointer"
                  title="在默认文本编辑器中打开"
                >
                  <FolderOpen size={12} />
                  <span>打开配置</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              <StatusBadge
                exists={configExists}
                path={configPath}
                accentColor="orange"
              />

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
        </div>

        {/* ── 右列：认证密钥与测试模型 ── */}
        <div className="flex flex-col gap-5 flex-1 min-h-0">
          {/* 卡片 4: API Key */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(255, 106, 0, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <KeyRound size={14} className="text-orange-500" />
                  API Key 凭据
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  第三方认证
                </span>
              </div>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-... (填入所选服务商的 API 密钥)"
                hintText="用于向中转节点发起大模型请求认证"
                accentColor="orange"
                toolName="Accio"
              />
            </div>

            <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
              <ShieldCheck
                size={14}
                className="text-orange-500 dark:text-orange-400 flex-shrink-0"
              />
              <span className="leading-relaxed">
                密钥仅保存在本地 ~/.ai-helper/accio_config.json 中，绝不上报云端。
              </span>
            </div>
          </SpotlightCard>

          {/* 卡片 5: 模型路由映射与测试 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(255, 106, 0, 0.12)"
          >
            <div>
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
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed flex items-start gap-2">
              <Sparkles size={13} className="text-orange-500 shrink-0 mt-0.5" />
              <span>
                Accio Work 发送的内部 RLab 模型调用将由本地 Bridge 网关透明转译为您在此选定的通用大模型，并实时模拟 15 秒心跳保活。
              </span>
            </div>
          </SpotlightCard>
        </div>
      </div>

      {/* ── 底部操作栏 ── */}
      <div className="pt-2 flex-shrink-0 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 左侧控制按钮群：网关控制 & 拉起客户端 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void handleToggleBridge()}
              disabled={bridgeActionLoading}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors shadow-2xs cursor-pointer disabled:opacity-60 ${
                bridgeStatus.is_running
                  ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400"
              }`}
            >
              {bridgeActionLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : bridgeStatus.is_running ? (
                <Power size={13} />
              ) : (
                <Radio size={13} />
              )}
              <span>
                {bridgeStatus.is_running ? "停止 Bridge 网关" : "启动 Bridge 网关"}
              </span>
            </button>

            {bridgeStatus.is_running && (
              <button
                type="button"
                onClick={() => void handleRestartBridge()}
                disabled={bridgeActionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10 transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
                title="重启本地 Bridge 网关"
              >
                <RotateCcw size={13} />
                <span>重启网关</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleLaunchClient()}
              disabled={restartingClient}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              title="拉起 Accio Work 客户端并注入网关环境"
            >
              {restartingClient ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <AccioWorkIcon size={14} />
              )}
              <span>
                {clientRunning
                  ? "重启 Accio Work 客户端"
                  : "启动 Accio Work 客户端"}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus.is_running
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-rose-500"
              }`}
            />
            <span className="text-[11px] font-mono">
              {bridgeStatus.is_running ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  网关就绪: http://127.0.0.1:{bridgeStatus.port || bridgePort} (Accio Work 自定义模型生效中)
                </span>
              ) : (
                <span className="text-rose-500 dark:text-rose-400">
                  ⚠️ Bridge 未运行 (Accio Work 暂无法连接自定义模型，请点击启动网关)
                </span>
              )}
            </span>
          </div>
        </div>

        {/* 主保存按钮 */}
        <StarBorder
          className="w-full shadow-md"
          color="#FF6A00"
          speed="3.5s"
          onClick={handleSave}
          disabled={testModalOpen}
          innerClassName="bg-orange-600 hover:bg-orange-700 text-white dark:bg-[#1a120c] dark:text-orange-100 py-3 cursor-pointer"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            <Save
              size={18}
              className="text-white dark:text-orange-400 group-hover:scale-110 transition-transform"
            />
            <span className="text-sm">保存并测试 Accio Work 连通性</span>
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400">
          点击将唤起终端进行流式调用与协议转译测试，测试通过后自动更新本地配置并启动网关
        </p>
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
          void load(true);
        }}
      />
    </div>
  );
}

export default AccioWorkPanel;

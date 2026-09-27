import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  RotateCcw,
  Server,
  KeyRound,
  FileCode,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Sliders,
  Plus,
  Trash2,
  Sparkles,
  Layers,
  Info,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { TraeWorkIcon } from "./BrandIcons";
import {
  deleteTraeWorkModel,
  fetchCodexModels,
  getTraeWorkConfig,
  openConfigFile,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import type {
  TraeWorkModelItem,
  TraeApiFormat,
} from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";
import { TerminalTestModal } from "./TerminalTestModal";

const API_FORMAT_OPTIONS: {
  id: TraeApiFormat;
  label: string;
  badge: string;
  placeholder: string;
  fullPlaceholder: string;
  hint: string;
}[] = [
  {
    id: "custom_responses_compatible",
    label: "OpenAI Responses API 格式",
    badge: "responses",
    placeholder: "例如 https://bob-api.com/v1",
    fullPlaceholder: "例如 https://bob-api.com/v1/responses",
    hint: "兼容 OpenAI Responses API 服务端点，留空自动补全 /responses。",
  },
  {
    id: "custom_openai_compatible",
    label: "OpenAI Chat Completions 格式",
    badge: "chat/completions",
    placeholder: "例如 https://api.openai.com/v1",
    fullPlaceholder: "例如 https://api.openai.com/v1/chat/completions",
    hint: "兼容 OpenAI 标准 API 服务端点，留空自动补全 /chat/completions。",
  },
  {
    id: "custom_anthropic_compatible",
    label: "Anthropic Messages 格式",
    badge: "messages",
    placeholder: "例如 https://api.anthropic.com",
    fullPlaceholder: "例如 https://api.anthropic.com/v1/messages",
    hint: "兼容 Claude API 服务端点，留空自动补全 /v1/messages。",
  },
];

const INPUT_TOKEN_PRESETS = [
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
  { label: "200K", value: 200000 },
  { label: "256K", value: 262144 },
  { label: "1M", value: 1048576 },
];

const OUTPUT_TOKEN_PRESETS = [
  { label: "4K", value: 4096 },
  { label: "8K", value: 8192 },
  { label: "16K", value: 16384 },
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
];

export function extractGatewayBase(rawUrl: string): string {
  if (!rawUrl) return "https://bob-api.com";
  let u = rawUrl.trim().replace(/\/+$/, "");
  u = u.replace(/\/(chat\/completions|responses|messages)$/i, "").replace(/\/+$/, "");
  while (u.endsWith("/v1")) {
    u = u.slice(0, -3).replace(/\/+$/, "");
  }
  return u || "https://bob-api.com";
}

export function buildTraeUrl(
  rawBaseOrUrl: string,
  format: TraeApiFormat,
  _fullUrl: boolean = true,
): string {
  if (!rawBaseOrUrl) {
    if (format === "custom_responses_compatible") {
      return "https://bob-api.com/v1/responses";
    } else if (format === "custom_anthropic_compatible") {
      return "https://bob-api.com/v1/messages";
    } else {
      return "https://bob-api.com/v1/chat/completions";
    }
  }

  let u = rawBaseOrUrl.trim().replace(/\/+$/, "");
  u = u.replace(/\/(chat\/completions|responses|messages)$/i, "").replace(/\/+$/, "");

  if (format === "custom_anthropic_compatible") {
    if (u.endsWith("/v1")) {
      return `${u}/messages`;
    }
    return `${u}/v1/messages`;
  } else if (format === "custom_responses_compatible") {
    if (u.endsWith("/v1")) {
      return `${u}/responses`;
    }
    return `${u}/v1/responses`;
  } else {
    const lastSeg = u.split("/").pop() || "";
    if (/^v\d+$/i.test(lastSeg)) {
      return `${u}/chat/completions`;
    }
    return `${u}/v1/chat/completions`;
  }
}

export function TraeWorkPanel() {
  const [url, setUrl] = useState<string>("https://bob-api.com/v1/responses");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-5.6-sol");
  const [displayName, setDisplayName] = useState("gpt-5.6-sol");
  const [apiFormat, setApiFormat] = useState<TraeApiFormat>(
    "custom_responses_compatible",
  );
  const isFullUrl = true;

  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [configuredModels, setConfiguredModels] = useState<TraeWorkModelItem[]>(
    [],
  );
  const [deletingModelName, setDeletingModelName] = useState<string | null>(
    null,
  );
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // 高级能力配置
  const [supportsImages, setSupportsImages] = useState(true);
  const [thinkingMode, setThinkingMode] = useState<"default" | "on" | "off">(
    "default",
  );
  const [maxTurn, setMaxTurn] = useState<number>(500);

  // 上下文 Token 限制
  const [tokenInput, setTokenInput] = useState<number | "">("");
  const [tokenOutput, setTokenOutput] = useState<number | "">("");

  // 采样超参
  const [temperature, setTemperature] = useState<number | "">("");
  const [topP, setTopP] = useState<number | "">("");
  const [topK, setTopK] = useState<number | "">("");

  const { models, refreshingModels, refreshModels } = useModelFetch(
    extractGatewayBase(url),
    apiKey,
    fetchCodexModels,
  );

  const currentFormatMeta =
    API_FORMAT_OPTIONS.find((f) => f.id === apiFormat) ||
    API_FORMAT_OPTIONS[0];

  const applyModelConfig = (item: TraeWorkModelItem) => {
    const rawModel = item.name.includes("//")
      ? item.name.split("//").pop() || item.name
      : item.name;
    setModel(rawModel);
    setDisplayName(item.display_name || rawModel);

    let nextFormat: TraeApiFormat = "custom_responses_compatible";
    if (
      item.provider === "custom_openai_compatible" ||
      item.provider === "custom_responses_compatible" ||
      item.provider === "custom_anthropic_compatible"
    ) {
      nextFormat = item.provider as TraeApiFormat;
      setApiFormat(nextFormat);
    }

    if (item.base_url) {
      setUrl(buildTraeUrl(item.base_url, nextFormat, true));
    } else {
      setUrl(buildTraeUrl(url, nextFormat, true));
    }

    setSupportsImages(item.multimodal ?? true);
    if (item.thinking_enable === 1) {
      setThinkingMode("on");
    } else if (item.thinking_enable === 2) {
      setThinkingMode("off");
    } else {
      setThinkingMode("default");
    }

    if (item.ak) {
      setApiKey(item.ak);
    } else {
      setApiKey("");
    }

    setMaxTurn(item.max_turn && item.max_turn > 0 ? item.max_turn : 500);
    setTokenInput(item.prompt_max_tokens ?? "");
    setTokenOutput(item.max_tokens ?? "");
    setTemperature(item.temperature ?? "");
    setTopP(item.top_p ?? "");
    setTopK(item.top_k ?? "");

    toast.info(`已载入模型配置: ${item.display_name || rawModel}`);
  };

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const cfg = await getTraeWorkConfig();
      setConfigExists(cfg.config_exists);
      setConfigPath(cfg.config_path);
      setConfiguredModels(cfg.configured_models || []);

      if (!silent) {
        let loadedFormat: TraeApiFormat = "custom_responses_compatible";
        if (
          cfg.api_format &&
          (cfg.api_format === "custom_openai_compatible" ||
            cfg.api_format === "custom_responses_compatible" ||
            cfg.api_format === "custom_anthropic_compatible")
        ) {
          loadedFormat = cfg.api_format as TraeApiFormat;
          setApiFormat(loadedFormat);
        }

        if (cfg.base_url) {
          setUrl(buildTraeUrl(cfg.base_url, loadedFormat, true));
        } else {
          setUrl(buildTraeUrl("https://bob-api.com", loadedFormat, true));
        }

        if (cfg.api_key) {
          setApiKey(cfg.api_key);
        }
        if (cfg.model) {
          setModel(cfg.model);
        }
        if (cfg.display_name) {
          setDisplayName(cfg.display_name);
        }

        setSupportsImages(cfg.supports_images);
        if (cfg.thinking_mode === "on" || cfg.thinking_mode === "off") {
          setThinkingMode(cfg.thinking_mode);
        } else {
          setThinkingMode("default");
        }
        setMaxTurn(cfg.max_turn || 500);
        setTokenInput(cfg.token_input ?? "");
        setTokenOutput(cfg.token_output ?? "");
        setTemperature(cfg.temperature ?? "");
        setTopP(cfg.top_p ?? "");
        setTopK(cfg.top_k ?? "");
      }
    } catch (err) {
      console.error("Failed to load Trae Work config:", err);
      toast.error(`读取 Trae Work 配置失败: ${String(err)}`);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleReset = () => {
    setUrl("https://bob-api.com/v1/responses");
    setApiKey("");
    setModel("gpt-5.6-sol");
    setDisplayName("gpt-5.6-sol");
    setApiFormat("custom_responses_compatible");
    setSupportsImages(true);
    setThinkingMode("default");
    setMaxTurn(500);
    setTokenInput("");
    setTokenOutput("");
    setTemperature("");
    setTopP("");
    setTopK("");
    toast.info("已重置为最佳预设配置");
  };

  const handleCopyParams = () => {
    const paramsText = JSON.stringify(
      {
        provider: apiFormat,
        baseUrl: url,
        isFullUrl,
        modelId: model,
        displayName: displayName || model,
        apiKey: apiKey ? "******" : "",
        supportsImages,
        thinkingMode,
        maxTurn,
        tokenInput: tokenInput || undefined,
        tokenOutput: tokenOutput || undefined,
        temperature: temperature !== "" ? temperature : undefined,
        topP: topP !== "" ? topP : undefined,
        topK: topK !== "" ? topK : undefined,
      },
      null,
      2,
    );
    navigator.clipboard.writeText(paramsText);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2000);
    toast.success("模型配置参数已复制到剪贴板！");
  };

  const handleAddNewModel = () => {
    setModel("");
    setDisplayName("");
    if (apiKey.includes("•")) {
      setApiKey("");
    }
    toast.info("已切换至新增模型模式，请输入新模型 ID 与展示名称后保存");
  };

  const handleDeleteModel = async (
    targetName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (!window.confirm(`确定要从 Trae 中移除模型 "${targetName}" 吗？`)) {
      return;
    }
    setDeletingModelName(targetName);
    try {
      const remaining = await deleteTraeWorkModel(targetName);
      setConfiguredModels(remaining);
      toast.success(`已从 Trae 成功移除模型 "${targetName}"`);
      const rawCurrent = model.includes("//")
        ? model.split("//").pop() || model
        : model;
      if (rawCurrent && (targetName.endsWith(rawCurrent) || targetName === rawCurrent)) {
        if (remaining.length > 0) {
          applyModelConfig(remaining[0]);
        } else {
          setModel("");
          setDisplayName("");
        }
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
      toast.error(`删除模型失败: ${String(err)}`);
    } finally {
      setDeletingModelName(null);
    }
  };

  const handleSave = () => {
    if (!model.trim()) {
      toast.error("请输入模型 ID");
      return;
    }
    if (!url.trim()) {
      toast.error("请输入自定义请求地址");
      return;
    }
    if (!apiKey.trim()) {
      toast.error("请先输入 API 密钥凭证后再进行保存与测试");
      return;
    }
    if (apiKey.includes("•")) {
      toast.warning(
        "当前检测到本地数据库安全加密密文，无法直接用于网络请求。如需发起测试并保存，请输入明文 API Key 后再操作。",
      );
      return;
    }
    setTestModalOpen(true);
  };

  const isExistingModel = configuredModels.some((item) => {
    const rawId = item.name.includes("//")
      ? item.name.split("//").pop() || item.name
      : item.name;
    return (
      rawId.trim().toLowerCase() === model.trim().toLowerCase() ||
      item.display_name.trim().toLowerCase() ===
        displayName.trim().toLowerCase()
    );
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-sky-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Trae Work 本地数据库配置...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col justify-between min-h-0 gap-5 pb-2">
      {/* ── 顶部面板标题栏与快速概览 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 border border-sky-200 dark:bg-sky-500/20 dark:text-sky-400 dark:border-sky-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <TraeWorkIcon size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                Trae Work 接入配置
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30">
                SQLite 存储模式 (state.vscdb)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 Trae Work (Trae Solo) IDE
              深度配置高可用反代节点、API 协议与自定义模型参数
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={handleCopyParams}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="复制完整模型 JSON 配置参数"
          >
            {copiedSuccess ? (
              <>
                <Check size={12} className="text-emerald-500" />
                <span className="text-emerald-500">已复制</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>复制参数</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="重置为默认预设配置"
          >
            <RotateCcw size={12} />
            <span>重置预设</span>
          </button>

          <button
            type="button"
            onClick={() => void load(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="重新载入本地数据库配置"
          >
            <RefreshCw size={12} />
            <span>重新载入</span>
          </button>
        </div>
      </div>

      {/* ── 双列栅格配置区域 ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-0 overflow-y-auto pr-1.5 pb-2">
        {/* ── 左列：路由网络、本地数据库状态与高级协议特性 ── */}
        <div className="flex flex-col gap-5">
          {/* 卡片 1: API 服务节点选择 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between shrink-0"
            spotlightColor="rgba(2, 132, 199, 0.12)"
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                <Server size={14} className="text-sky-500" />
                API 服务网关节点
              </Label>
              <span className="text-[11px] text-slate-400 dark:text-gray-500">
                支持多线路故障切换
              </span>
            </div>
            <div className="flex-1 flex flex-col justify-center min-h-0">
              <NodeCardSelector
                value={extractGatewayBase(url) + "/"}
                onChange={(selected: string) => {
                  setUrl(buildTraeUrl(selected, apiFormat, isFullUrl));
                }}
                accentColor="blue"
                className="h-full"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 2: 本地数据库路径管理 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none space-y-3 shrink-0"
            spotlightColor="rgba(2, 132, 199, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <FileCode size={14} className="text-sky-500" />
                  本地状态数据库路径
                </Label>
                <button
                  type="button"
                  onClick={() => openConfigFile(configPath)}
                  className="text-[11px] font-mono text-slate-400 dark:text-gray-500 hover:text-sky-600 dark:hover:text-sky-400 flex items-center gap-1 transition-colors cursor-pointer"
                  title="打开数据库所在目录"
                >
                  <span>state.vscdb</span>
                  <ExternalLink size={10} />
                </button>
              </div>

              <StatusBadge
                exists={configExists}
                path={configPath}
                onReload={() => void load(false)}
                accentColor="blue"
              />
            </div>

            <div className="mt-3">
              {!configExists ? (
                <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    未检测到 Trae 本地数据库文件，请确认已安装并首次运行 Trae
                    (TRAE SOLO)。
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-500 flex-shrink-0" />
                  <span className="leading-relaxed">
                    当前数据库已检测到{" "}
                    <strong className="text-sky-600 dark:text-sky-400 font-mono">
                      {configuredModels.length}
                    </strong>{" "}
                    个自定义模型。Trae 支持配置热同步，保存后即时生效。
                  </span>
                </div>
              )}
            </div>
          </SpotlightCard>

          {/* 卡片 3: API 协议与高级模型特性 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none space-y-4 shrink-0"
            spotlightColor="rgba(2, 132, 199, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Cpu size={14} className="text-sky-500" />
                  API 协议格式
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  Provider Protocol
                </span>
              </div>

              {/* 3 个协议格式选择按钮 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {API_FORMAT_OPTIONS.map((opt) => {
                  const active = apiFormat === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setApiFormat(opt.id);
                        setUrl(buildTraeUrl(url, opt.id, isFullUrl));
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        active
                          ? "bg-sky-500/15 border-sky-500/60 text-sky-800 dark:text-sky-300 font-medium shadow-2xs ring-1 ring-sky-500/30"
                          : "bg-slate-50/50 dark:bg-white/[0.02] border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:border-slate-300 dark:hover:border-white/20"
                      }`}
                    >
                      <div className="text-xs font-semibold truncate leading-snug">
                        {opt.label.replace(" 格式", "")}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-gray-500 mt-1">
                        /{opt.badge}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 模型特性与能力开关 */}
            <div className="pt-3 border-t border-slate-100 dark:border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                  模型行为特性与能力:
                </span>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  Feature Switches
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {/* 图片输入 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={supportsImages}
                    onChange={(e) => setSupportsImages(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none">
                    支持图片输入 (多模态)
                  </span>
                </label>

                {/* 工具调用轮数 */}
                <div className="flex items-center gap-2 p-1.5 px-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
                  <span className="text-xs text-slate-700 dark:text-gray-300 flex-shrink-0">
                    工具轮数:
                  </span>
                  <input
                    type="number"
                    value={maxTurn}
                    onChange={(e) => setMaxTurn(Number(e.target.value) || 500)}
                    placeholder="500"
                    className="w-full text-xs font-mono bg-white dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded px-1.5 py-0.5 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* 思考模式选项 */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] text-slate-500 dark:text-gray-400">
                  思考模式 (Reasoning Mode):
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "default", label: "跟随默认" },
                    { id: "on", label: "强制开启" },
                    { id: "off", label: "强制关闭" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setThinkingMode(item.id as "default" | "on" | "off")
                      }
                      className={`text-xs py-1.5 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                        thinkingMode === item.id
                          ? "bg-sky-500/15 border-sky-500/60 text-sky-700 dark:text-sky-300 font-medium"
                          : "bg-slate-50/50 dark:bg-white/[0.02] border-slate-200/80 dark:border-white/10 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-white/20"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 采样超参 */}
              <div className="pt-2 border-t border-slate-100 dark:border-white/5">
                <span className="text-[11px] text-slate-500 dark:text-gray-400 block mb-1.5">
                  采样参数 (留空使用模型最佳预设):
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">
                      Temperature
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={temperature}
                      onChange={(e) =>
                        setTemperature(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                      placeholder="0.0 ~ 2.0"
                      className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">Top P</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={topP}
                      onChange={(e) =>
                        setTopP(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                      placeholder="0.0 ~ 1.0"
                      className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400">Top K</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={topK}
                      onChange={(e) =>
                        setTopK(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                      placeholder="1 ~ 100"
                      className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </SpotlightCard>
        </div>

        {/* ── 右列：密钥凭证、多模型管理与配置、上下文窗口与 Token 限制 ── */}
        <div className="flex flex-col gap-5">
          {/* 卡片 4: API 密钥凭据 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none space-y-3.5 shrink-0"
            spotlightColor="rgba(2, 132, 199, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <KeyRound size={14} className="text-sky-500" />
                  API 密钥凭证
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  认证凭据
                </span>
              </div>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-... (填入 API Key)"
                hintText={
                  apiKey.includes("•")
                    ? "检测到已存储在本地 state.vscdb 的加密密钥凭证，若无需更换可直接保留"
                    : "新密钥将安全加密存储至本地 Trae 状态数据库 (state.vscdb) 中"
                }
                accentColor="blue"
              />
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
              <ShieldCheck
                size={14}
                className="text-sky-500 dark:text-sky-400 flex-shrink-0"
              />
              <span className="leading-relaxed">
                凭据将安全加密写入本地 Trae
                状态数据库，通过本地端点与服务网关直连通信。
              </span>
            </div>
          </SpotlightCard>

          {/* 卡片 5: 模型管理与自定义配置 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none space-y-4 shrink-0"
            spotlightColor="rgba(2, 132, 199, 0.12)"
          >
            {/* 已配置模型标签组与切换 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Layers size={14} className="text-sky-500" />
                  已配置模型列表 ({configuredModels.length})
                </Label>
                <button
                  type="button"
                  onClick={handleAddNewModel}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded-md transition-colors cursor-pointer"
                  title="清空当前输入，准备新增模型"
                >
                  <Plus size={12} />
                  <span>新增模型</span>
                </button>
              </div>

              {configuredModels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50/70 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/5 max-h-[110px] overflow-y-auto">
                  {configuredModels.map((item) => {
                    const rawId = item.name.includes("//")
                      ? item.name.split("//").pop() || item.name
                      : item.name;
                    const isSelected =
                      rawId.trim().toLowerCase() ===
                        model.trim().toLowerCase() ||
                      item.display_name.trim().toLowerCase() ===
                        displayName.trim().toLowerCase();
                    const isDeleting = deletingModelName === item.name;
                    return (
                      <div
                        key={item.name}
                        onClick={() => applyModelConfig(item)}
                        className={`group relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs cursor-pointer border transition-all ${
                          isSelected
                            ? "bg-sky-500/15 border-sky-500/60 text-sky-800 dark:text-sky-300 font-semibold shadow-2xs"
                            : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:border-slate-300 dark:hover:border-white/20"
                        }`}
                        title={`点击查看并编辑 ${item.display_name || rawId} 的配置参数`}
                      >
                        <span className="truncate max-w-[130px] font-mono">
                          {item.display_name || rawId}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => void handleDeleteModel(item.name, e)}
                          disabled={isDeleting}
                          className="opacity-40 group-hover:opacity-100 hover:text-red-500 transition-opacity p-0.5 rounded ml-0.5 cursor-pointer"
                          title={`从 Trae 中移除模型 ${rawId}`}
                        >
                          {isDeleting ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Trash2 size={11} />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 dark:text-gray-500 py-1 italic">
                  尚未配置自定义模型，点击下方保存即可新增首个模型。
                </div>
              )}
            </div>

            {/* 当前目标模型输入与请求地址配置 */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-3">
              {/* 模型 ID 输入（已完全移除下方的硬编码示例模型） */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1">
                  <span className="text-destructive">*</span> 模型 ID (Model ID)
                </Label>
                <ModelInput
                  value={model}
                  onChange={(newModel: string) => {
                    setModel(newModel);
                    if (!displayName || displayName === model) {
                      setDisplayName(newModel);
                    }
                    if (newModel.toLowerCase().includes("sol")) {
                      setApiFormat("custom_responses_compatible");
                      setUrl(
                        buildTraeUrl(
                          url,
                          "custom_responses_compatible",
                          isFullUrl,
                        ),
                      );
                    } else if (newModel.toLowerCase().includes("claude")) {
                      setApiFormat("custom_anthropic_compatible");
                      setUrl(
                        buildTraeUrl(
                          url,
                          "custom_anthropic_compatible",
                          isFullUrl,
                        ),
                      );
                    }
                  }}
                  models={models}
                  placeholder="选择或输入模型名称 (如 gpt-5.6-sol / claude-3-7-sonnet)"
                  id="traework-models"
                  onRefresh={() => void refreshModels()}
                  refreshing={refreshingModels}
                  accentColor="blue"
                />
              </div>

              {/* 模型展示名称 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                    模型展示名称
                  </Label>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500">
                    {displayName.length}/64
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={64}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="在 Trae 列表中展示的名称，未设置时默认使用 Model ID"
                  disabled={testModalOpen}
                  className="w-full text-xs bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              {/* 自定义请求地址与完整 URL 切换 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1">
                    <span className="text-destructive">*</span> 自定义请求地址
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-sky-600 dark:text-sky-400 font-medium">
                      完整 URL (已锁定)
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={true}
                      disabled
                      className="relative inline-flex h-4 w-7 flex-shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-sky-500 opacity-90 transition-colors"
                      title="已强制开启完整 URL 端点，根据所选协议自动显示完整路径"
                    >
                      <span className="pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm translate-x-3 transition duration-200" />
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  value={url}
                  readOnly
                  placeholder={currentFormatMeta.fullPlaceholder}
                  className="w-full text-xs font-mono bg-slate-100/80 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-gray-300 cursor-not-allowed select-all focus:outline-none"
                  title="自定义请求地址不可直接手动编辑，已根据所选节点与协议自动生成完整端点"
                />

                <div className="text-[11px] text-slate-400 dark:text-gray-500 break-all">
                  当前协议请求端点：{url || currentFormatMeta.fullPlaceholder}
                </div>
              </div>

              {/* 动态模式指示条 */}
              <div className="pt-1">
                {isExistingModel ? (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs">
                    <Info size={13} className="flex-shrink-0" />
                    <span>
                      当前模型已存在于 Trae
                      中，保存将更新此模型的各项配置参数。
                    </span>
                  </div>
                ) : model.trim() ? (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-300 text-xs">
                    <Sparkles size={13} className="flex-shrink-0" />
                    <span>
                      新增模型模式：保存将作为新模型追加至 Trae
                      自定义模型列表。
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </SpotlightCard>

          {/* 卡片 6: 上下文窗口与 Token 限制 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none space-y-4 shrink-0"
            spotlightColor="rgba(2, 132, 199, 0.12)"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Sliders size={14} className="text-sky-500" />
                  上下文窗口与 Token 限制
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  Context & Tokens
                </span>
              </div>

              {/* 输入 Token 上限 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    输入 Token 上限 (Prompt Context):
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-gray-500">
                    留空使用模型最佳默认
                  </span>
                </div>
                <input
                  type="number"
                  value={tokenInput}
                  onChange={(e) =>
                    setTokenInput(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  placeholder="留空使用最佳默认值 (例如 131072, 200000)"
                  className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <div className="flex flex-wrap gap-1">
                  {INPUT_TOKEN_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setTokenInput(p.value)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                        Number(tokenInput) === p.value
                          ? "bg-sky-500/20 border-sky-500/40 text-sky-700 dark:text-sky-300 font-semibold"
                          : "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                  {tokenInput !== "" && (
                    <button
                      type="button"
                      onClick={() => setTokenInput("")}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
                      title="清除数值"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>

              {/* 输出 Token 上限 */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    输出 Token 上限 (Max Completion):
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-gray-500">
                    留空使用模型最佳默认
                  </span>
                </div>
                <input
                  type="number"
                  value={tokenOutput}
                  onChange={(e) =>
                    setTokenOutput(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  placeholder="留空使用最佳默认值 (例如 8192, 16384, 32768)"
                  className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <div className="flex flex-wrap gap-1">
                  {OUTPUT_TOKEN_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setTokenOutput(p.value)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                        Number(tokenOutput) === p.value
                          ? "bg-sky-500/20 border-sky-500/40 text-sky-700 dark:text-sky-300 font-semibold"
                          : "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                  {tokenOutput !== "" && (
                    <button
                      type="button"
                      onClick={() => setTokenOutput("")}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
                      title="清除数值"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-1 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-gray-500">
              <Info size={12} className="text-sky-500 flex-shrink-0" />
              <span>
                数值将作为 prompt_max_tokens 与 max_tokens 写入 Trae 数据库，留空则由上游模型原生限制决定。
              </span>
            </div>
          </SpotlightCard>
        </div>
      </div>

      {/* ── 底部保存与联机验证操作栏 ── */}
      <div className="pt-2 flex-shrink-0">
        <StarBorder
          className="w-full shadow-md"
          color="#0284c7"
          speed="3.5s"
          onClick={handleSave}
          disabled={testModalOpen}
          innerClassName="bg-sky-600 hover:bg-sky-700 text-white dark:bg-[#0c1829] dark:text-sky-100 py-3 cursor-pointer"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            {isExistingModel ? (
              <>
                <Save
                  size={18}
                  className="text-white dark:text-sky-400 group-hover:scale-110 transition-transform"
                />
                <span className="text-sm">
                  保存并更新 Trae 模型配置 ({displayName || model})
                </span>
              </>
            ) : (
              <>
                <Plus
                  size={18}
                  className="text-white dark:text-sky-400 group-hover:scale-110 transition-transform"
                />
                <span className="text-sm">
                  保存并新增模型至 Trae ({displayName || model || "新模型"})
                </span>
              </>
            )}
          </div>
        </StarBorder>

        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          点击将唤起终端进行连通性测试，验证通过后自动写入本地 Trae 状态数据库 (state.vscdb)
        </p>
      </div>

      {/* 流式终端连通性测试模态框 */}
      <TerminalTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        type="traework"
        url={url}
        apiKey={apiKey}
        model={model}
        apiFormat={apiFormat}
        isFullUrl={isFullUrl}
        traeworkPayload={{
          api_format: apiFormat,
          base_url: buildTraeUrl(url, apiFormat, isFullUrl),
          is_full_url: isFullUrl,
          model: model.trim(),
          display_name: displayName.trim() || model.trim(),
          api_key: apiKey.trim(),
          supports_images: supportsImages,
          thinking_mode: thinkingMode,
          max_turn: Number(maxTurn) || 500,
          token_input: tokenInput === "" ? null : Number(tokenInput),
          token_output: tokenOutput === "" ? null : Number(tokenOutput),
          temperature: temperature === "" ? null : Number(temperature),
          top_p: topP === "" ? null : Number(topP),
          top_k: topK === "" ? null : Number(topK),
        }}
        onSuccess={() => {
          setConfigExists(true);
          void load(true);
        }}
      />
    </div>
  );
}

export default TraeWorkPanel;

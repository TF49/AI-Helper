import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Sliders,
  Trash2,
  Sparkles,
  Layers,
  Info,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { TraeWorkIcon } from "./BrandIcons";
import {
  deleteTraeWorkModel,
  fetchCodexModels,
  getTraeWorkConfig,
  setTraeWorkConfig,
  openConfigFile,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import {
  TRAEWORK_MODEL_SUGGESTIONS,
  type TraeWorkModelItem,
  type TraeWorkSavePayload,
  type TraeApiFormat,
} from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { TerminalTestModal } from "./TerminalTestModal";

const API_FORMAT_OPTIONS: { id: TraeApiFormat; label: string; placeholder: string; fullPlaceholder: string; hint: string }[] = [
  {
    id: "custom_openai_compatible",
    label: "OpenAI Chat Completions 格式",
    placeholder: "例如 https://api.openai.com/v1",
    fullPlaceholder: "例如 https://api.openai.com/v1/chat/completions",
    hint: "请输入兼容 OpenAI API 的服务端点地址，不要以斜杠结尾。/chat/completions 将会被补充到你填写的地址末尾。",
  },
  {
    id: "custom_responses_compatible",
    label: "OpenAI Responses API 格式",
    placeholder: "例如 https://api.openai.com/v1",
    fullPlaceholder: "例如 https://bob-api.com/v1/responses",
    hint: "请输入兼容 OpenAI Responses API 的服务端点地址，不要以斜杠结尾。/responses 将会被补充到你填写的地址末尾。",
  },
  {
    id: "custom_anthropic_compatible",
    label: "Anthropic Messages 格式",
    placeholder: "例如 https://api.anthropic.com",
    fullPlaceholder: "例如 https://api.anthropic.com/v1/messages",
    hint: "请输入兼容 Claude API 的服务端点地址，不要以斜杠结尾。/v1/messages 将会被补充到你填写的地址末尾。",
  },
];

const INPUT_TOKEN_CHIPS = [
  { label: "128k", value: 131072 },
  { label: "256k", value: 262144 },
  { label: "512k", value: 524288 },
  { label: "1M", value: 1048576 },
];

const OUTPUT_TOKEN_CHIPS = [
  { label: "4k", value: 4096 },
  { label: "16k", value: 16384 },
  { label: "32k", value: 32768 },
  { label: "128k", value: 131072 },
];

export function TraeWorkPanel() {
  const [url, setUrl] = useState<string>("https://bob-api.com/v1/responses");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-5.6-sol");
  const [displayName, setDisplayName] = useState("gpt-5.6-sol");
  const [apiFormat, setApiFormat] = useState<TraeApiFormat>("custom_responses_compatible");
  const [isFullUrl, setIsFullUrl] = useState(true);

  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [configuredModels, setConfiguredModels] = useState<TraeWorkModelItem[]>([]);
  const [deletingModelName, setDeletingModelName] = useState<string | null>(null);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // 高级能力配置
  const [supportsImages, setSupportsImages] = useState(true);
  const [thinkingMode, setThinkingMode] = useState<"default" | "on" | "off">("default");
  const [maxTurn, setMaxTurn] = useState<number>(500);

  // 上下文 Token 限制
  const [tokenInput, setTokenInput] = useState<number | "">("");
  const [tokenOutput, setTokenOutput] = useState<number | "">("");

  // 采样超参
  const [temperature, setTemperature] = useState<number | "">("");
  const [topP, setTopP] = useState<number | "">("");
  const [topK, setTopK] = useState<number | "">("");

  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchCodexModels,
  );

  const currentFormatMeta =
    API_FORMAT_OPTIONS.find((f) => f.id === apiFormat) || API_FORMAT_OPTIONS[0];

  const applyModelConfig = (item: TraeWorkModelItem) => {
    const rawModel = item.name.includes("//")
      ? item.name.split("//").pop() || item.name
      : item.name;
    setModel(rawModel);
    setDisplayName(item.display_name || rawModel);

    if (
      item.provider === "custom_openai_compatible" ||
      item.provider === "custom_responses_compatible" ||
      item.provider === "custom_anthropic_compatible"
    ) {
      setApiFormat(item.provider as TraeApiFormat);
    }

    if (item.base_url) {
      setUrl(item.base_url);
      setIsFullUrl(
        item.base_url.endsWith("/chat/completions") ||
          item.base_url.endsWith("/responses") ||
          item.base_url.endsWith("/v1/messages"),
      );
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
      setApiKey("••••••••••••••••");
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
        if (cfg.base_url) {
          setUrl(cfg.base_url);
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
        if (cfg.api_format && (
          cfg.api_format === "custom_openai_compatible" ||
          cfg.api_format === "custom_responses_compatible" ||
          cfg.api_format === "custom_anthropic_compatible"
        )) {
          setApiFormat(cfg.api_format as TraeApiFormat);
        }
        setIsFullUrl(cfg.is_full_url);
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
    setIsFullUrl(true);
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

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error("请输入模型 ID");
      return;
    }
    if (!url.trim()) {
      toast.error("请输入自定义请求地址");
      return;
    }

    setSaving(true);
    try {
      const payload: TraeWorkSavePayload = {
        api_format: apiFormat,
        base_url: url.trim(),
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
      };

      await setTraeWorkConfig(payload);
      toast.success("Trae Work 模型配置已成功保存并同步！");
      await load(true);
    } catch (err) {
      console.error("Failed to save Trae Work config:", err);
      toast.error(`保存失败: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (targetName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingModelName(targetName);
    try {
      const remaining = await deleteTraeWorkModel(targetName);
      setConfiguredModels(remaining);
      toast.success(`已移除模型: ${targetName}`);
    } catch (err) {
      console.error("Failed to delete model:", err);
      toast.error(`删除模型失败: ${String(err)}`);
    } finally {
      setDeletingModelName(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部应用状态栏 */}
      <StatusBadge
        exists={configExists}
        path={configPath}
        onReload={() => void load()}
        accentColor="blue"
      />

      {/* 已配置的自定义模型列表 */}
      {configuredModels.length > 0 && (
        <SpotlightCard className="p-5 border border-primary/20 bg-card/60 backdrop-blur-sm rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold tracking-wide">
                Trae 中已配置的模型 ({configuredModels.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => openConfigFile(configPath)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              title="打开 SQLite 状态库位置"
            >
              <ExternalLink className="h-3 w-3" />
              <span>数据存储</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {configuredModels.map((item) => {
              const rawId = item.name.includes("//")
                ? item.name.split("//").pop() || item.name
                : item.name;
              const isCurrent =
                rawId.toLowerCase() === model.toLowerCase() ||
                item.display_name.toLowerCase() === displayName.toLowerCase();

              return (
                <div
                  key={item.name}
                  onClick={() => applyModelConfig(item)}
                  className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between group ${
                    isCurrent
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/60 hover:border-primary/50 bg-background/50 hover:bg-background/80"
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs truncate text-foreground">
                        {item.display_name || rawId}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.2 bg-primary text-primary-foreground rounded-full">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground truncate">
                      <span>{item.provider.replace("custom_", "").replace("_compatible", "")}</span>
                      <span>•</span>
                      <span className="truncate max-w-[150px]">{rawId}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => handleDeleteModel(item.name, e)}
                      disabled={deletingModelName === item.name}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                      title="删除此模型"
                    >
                      {deletingModelName === item.name ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SpotlightCard>
      )}

      {/* 预设节点选择 */}
      <SpotlightCard className="p-6 border border-border/50 bg-card/50 backdrop-blur-sm rounded-xl">
        <NodeCardSelector
          value={url}
          onChange={(selected: string) => {
            const stripped = selected.replace(/\/+$/, "");
            if (isFullUrl) {
              if (apiFormat === "custom_responses_compatible") {
                setUrl(`${stripped}/v1/responses`);
              } else if (apiFormat === "custom_anthropic_compatible") {
                setUrl(`${stripped}/v1/messages`);
              } else {
                setUrl(`${stripped}/v1/chat/completions`);
              }
            } else {
              setUrl(`${stripped}/v1`);
            }
          }}
          accentColor="blue"
        />
      </SpotlightCard>

      {/* 自定义模型配置主表单 (1:1 还原 Trae 官方界面) */}
      <SpotlightCard className="p-6 border border-border/50 bg-card/50 backdrop-blur-sm rounded-xl space-y-6">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <TraeWorkIcon size={20} className="text-primary" />
            <h3 className="font-semibold text-base text-foreground tracking-wide">
              自定义模型配置
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCopyParams}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
          >
            {copiedSuccess ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-500">已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>复制参数</span>
              </>
            )}
          </button>
        </div>

        {/* 1. API 格式 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold flex items-center gap-1 text-foreground">
            <span className="text-destructive">*</span> API 格式
          </Label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {API_FORMAT_OPTIONS.map((opt) => {
              const active = apiFormat === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setApiFormat(opt.id);
                    // 智能同步推荐后缀
                    const stripped = url.replace(/\/(chat\/completions|responses|v1\/messages)$/, "").replace(/\/+$/, "");
                    if (isFullUrl) {
                      if (opt.id === "custom_responses_compatible") {
                        setUrl(`${stripped}/v1/responses`);
                      } else if (opt.id === "custom_anthropic_compatible") {
                        setUrl(`${stripped}/v1/messages`);
                      } else {
                        setUrl(`${stripped}/v1/chat/completions`);
                      }
                    }
                  }}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    active
                      ? "border-primary bg-primary/10 text-primary font-medium ring-1 ring-primary/40 shadow-sm"
                      : "border-border/60 hover:border-border text-muted-foreground hover:bg-background/80"
                  }`}
                >
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-1 opacity-80">
                    {opt.id.replace("custom_", "")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. 自定义请求地址 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold flex items-center gap-1 text-foreground">
              <span className="text-destructive">*</span> 自定义请求地址
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">完整 URL</span>
              <button
                type="button"
                role="switch"
                aria-checked={isFullUrl}
                onClick={() => setIsFullUrl(!isFullUrl)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isFullUrl ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
                    isFullUrl ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground">
            {isFullUrl ? (
              <span>请输入完整的 API 请求地址，包括路径端点。例如：{currentFormatMeta.fullPlaceholder}</span>
            ) : (
              <span>{currentFormatMeta.hint}</span>
            )}
          </div>

          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={isFullUrl ? currentFormatMeta.fullPlaceholder : currentFormatMeta.placeholder}
            disabled={saving}
            className="w-full h-10 px-3.5 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all font-mono"
          />
        </div>

        {/* 3. 模型 ID */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold flex items-center gap-1 text-foreground">
            <span className="text-destructive">*</span> 模型 ID
          </Label>
          <ModelInput
            value={model}
            onChange={(newModel: string) => {
              setModel(newModel);
              if (!displayName || displayName === model) {
                setDisplayName(newModel);
              }
              // 针对 gpt-5.6-sol 等智能适配格式
              if (newModel.toLowerCase().includes("sol")) {
                setApiFormat("custom_responses_compatible");
              } else if (newModel.toLowerCase().includes("claude")) {
                setApiFormat("custom_anthropic_compatible");
              }
            }}
            models={models}
            placeholder="请输入模型 ID (例如 gpt-5.6-sol, gpt-4o)"
            id="traework-models"
            onRefresh={() => void refreshModels()}
            refreshing={refreshingModels}
            accentColor="blue"
          />

          <div className="flex flex-wrap gap-1.5 pt-1">
            {TRAEWORK_MODEL_SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setModel(item);
                  if (!displayName || displayName === model) {
                    setDisplayName(item);
                  }
                  if (item.toLowerCase().includes("sol")) {
                    setApiFormat("custom_responses_compatible");
                  } else if (item.toLowerCase().includes("claude")) {
                    setApiFormat("custom_anthropic_compatible");
                  }
                }}
                className={`text-[11px] font-mono px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                  model === item
                    ? "bg-sky-100 border-sky-300 text-sky-700 dark:bg-sky-500/20 dark:border-sky-500/40 dark:text-sky-300 font-semibold"
                    : "bg-muted/50 border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {/* 4. 模型展示名称 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-foreground">
              模型展示名称
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {displayName.length}/64
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            在模型列表中展示的名称，未设置时默认显示 Model ID。
          </div>
          <input
            type="text"
            maxLength={64}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="请输入模型展示名称"
            disabled={saving}
            className="w-full h-10 px-3.5 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
          />
        </div>

        {/* 5. API 密钥 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold flex items-center gap-1 text-foreground">
            <span className="text-destructive">*</span> API 密钥
          </Label>
          <ApiKeyInput
            value={apiKey}
            onChange={setApiKey}
            placeholder="请输入 API Key (例如 sk-...)"
            accentColor="blue"
          />
          <div className="text-[11px] text-muted-foreground">
            {apiKey.includes("•")
              ? "🔒 检测到已存储的加密密钥凭证。若无需更换密钥，直接点击保存将自动保留；如需更改请输入新密钥。"
              : "输入的新密钥将以安全凭证存储在本地 Trae 状态数据库 (state.vscdb) 中。"}
          </div>
        </div>

        {/* 6. 高级配置折叠面板 */}
        <div className="border border-border/50 rounded-xl overflow-hidden bg-background/30 transition-all">
          <button
            type="button"
            onClick={() => setAdvancedExpanded(!advancedExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/40 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">高级配置</span>
              {!advancedExpanded && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  (上下文窗口、工具轮数、图片输入、思考模式与采样参数)
                </span>
              )}
            </div>
            {advancedExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {advancedExpanded && (
            <div className="p-4 border-t border-border/40 space-y-5 bg-background/50">
              {/* 上下文窗口 Token */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-foreground">
                  上下文窗口 (Token)
                </Label>

                {/* 输入 Token */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">输入</span>
                    <div className="flex gap-1">
                      {INPUT_TOKEN_CHIPS.map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => setTokenInput(chip.value)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            tokenInput === chip.value
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border/60 hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="number"
                    value={tokenInput}
                    onChange={(e) =>
                      setTokenInput(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="请输入数值，留空则使用最佳默认值"
                    className="w-full h-9 px-3 text-xs bg-background border border-border/80 rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>

                {/* 输出 Token */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">输出</span>
                    <div className="flex gap-1">
                      {OUTPUT_TOKEN_CHIPS.map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => setTokenOutput(chip.value)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            tokenOutput === chip.value
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border/60 hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="number"
                    value={tokenOutput}
                    onChange={(e) =>
                      setTokenOutput(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="请输入数值，留空则使用最佳默认值"
                    className="w-full h-9 px-3 text-xs bg-background border border-border/80 rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>
              </div>

              {/* 工具调用轮数 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  工具调用轮数
                </Label>
                <input
                  type="number"
                  value={maxTurn}
                  onChange={(e) => setMaxTurn(Number(e.target.value) || 500)}
                  placeholder="500"
                  className="w-full h-9 px-3 text-xs bg-background border border-border/80 rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>

              {/* 支持图片输入 */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground">
                  支持图片输入
                </Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="imageInput"
                      checked={supportsImages}
                      onChange={() => setSupportsImages(true)}
                      className="text-primary focus:ring-primary"
                    />
                    <span>支持</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="imageInput"
                      checked={!supportsImages}
                      onChange={() => setSupportsImages(false)}
                      className="text-primary focus:ring-primary"
                    />
                    <span>不支持</span>
                  </label>
                </div>
              </div>

              {/* 思考模式 */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground">
                  思考模式
                </Label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="thinkingMode"
                      checked={thinkingMode === "default"}
                      onChange={() => setThinkingMode("default")}
                      className="text-primary focus:ring-primary"
                    />
                    <span>跟随模型默认配置</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="thinkingMode"
                      checked={thinkingMode === "on"}
                      onChange={() => setThinkingMode("on")}
                      className="text-primary focus:ring-primary"
                    />
                    <span>开启</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="thinkingMode"
                      checked={thinkingMode === "off"}
                      onChange={() => setThinkingMode("off")}
                      className="text-primary focus:ring-primary"
                    />
                    <span>关闭</span>
                  </label>
                </div>
              </div>

              {/* 采样参数 */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <Label className="text-xs font-semibold text-foreground">
                  采样参数
                </Label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Temperature</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={temperature}
                      onChange={(e) =>
                        setTemperature(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      placeholder="0 ~ 2 (留空使用最佳)"
                      className="w-full h-8 px-2.5 text-xs bg-background border border-border/80 rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Top P</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={topP}
                      onChange={(e) =>
                        setTopP(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      placeholder="0 ~ 1 (留空使用最佳)"
                      className="w-full h-8 px-2.5 text-xs bg-background border border-border/80 rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Top K</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={topK}
                      onChange={(e) =>
                        setTopK(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      placeholder="1 ~ 100 (留空最佳)"
                      className="w-full h-8 px-2.5 text-xs bg-background border border-border/80 rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作与连通性测试提示 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border/40">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span>连通性测试会发起一次真实请求，消耗极少量模型 Token。</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
            >
              重置
            </button>

            <button
              type="button"
              onClick={() => {
                if (!apiKey.trim()) {
                  toast.error("请先输入 API 密钥后再进行测试");
                  return;
                }
                if (apiKey.includes("•")) {
                  toast.warning(
                    "当前检测到本地数据库安全加密密文，无法直接用于网络请求。如需在线测试连通性，请重新输入明文 API Key 后再测。",
                  );
                  return;
                }
                setTestModalOpen(true);
              }}
              disabled={saving}
              className="px-4 py-2 text-xs rounded-lg border border-primary/50 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5 font-medium"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>连通性测试</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 font-medium shadow-sm"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在保存...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>添加模型 / 同步至 Trae</span>
                </>
              )}
            </button>
          </div>
        </div>
      </SpotlightCard>

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
          base_url: url.trim(),
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

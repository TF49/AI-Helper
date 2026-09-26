import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  Server,
  KeyRound,
  FileCode,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Sliders,
  HelpCircle,
  Plus,
  Trash2,
  Sparkles,
  Layers,
  Info,
} from "lucide-react";
import { WorkbuddyIcon } from "./BrandIcons";
import {
  deleteWorkbuddyModel,
  fetchCodexModels,
  getWorkbuddyConfig,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import {
  PRESET_URLS,
  type WorkbuddyModelItem,
  type WorkbuddySavePayload,
} from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";
import { TerminalTestModal } from "./TerminalTestModal";

const EFFORT_OPTIONS = [
  { id: "low", label: "低 (low)" },
  { id: "medium", label: "中 (medium)" },
  { id: "high", label: "高 (high)" },
  { id: "xhigh", label: "超高 (xhigh)" },
  { id: "max", label: "极致 (max)" },
] as const;

const INPUT_TOKEN_PRESETS = [
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
  { label: "256K", value: 262144 },
];

const OUTPUT_TOKEN_PRESETS = [
  { label: "8K", value: 8192 },
  { label: "16K", value: 16384 },
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
];

export function WorkbuddyPanel() {
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-5.6-sol");
  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [configuredModels, setConfiguredModels] = useState<
    WorkbuddyModelItem[]
  >([]);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  // 高级能力开关
  const [supportsToolCall, setSupportsToolCall] = useState(true);
  const [supportsImages, setSupportsImages] = useState(true);
  const [supportsReasoning, setSupportsReasoning] = useState(true);
  const [onlyReasoning, setOnlyReasoning] = useState(false);
  const [canDisableThinking, setCanDisableThinking] = useState(true);
  const [useCustomProtocol, setUseCustomProtocol] = useState(false);

  // 思考强度设置
  const [defaultEffort, setDefaultEffort] = useState<string>("");
  const [supportedEfforts, setSupportedEfforts] = useState<string[]>([
    "medium",
  ]);

  // Token 限制
  const [maxInputTokens, setMaxInputTokens] = useState<number | "">(32768);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | "">(32768);

  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchCodexModels,
  );

  const applyModelConfig = (item: WorkbuddyModelItem) => {
    setModel(item.id);
    if (item.apiKey) {
      setApiKey(item.apiKey);
    }
    if (item.url) {
      const rawUrl = item.url.replace(/\/+$/, "");
      const stripped = rawUrl.endsWith("/v1") ? rawUrl.slice(0, -3) : rawUrl;
      if (stripped.startsWith("https://bob-api.com")) {
        setUrl("https://bob-api.com/");
      } else if (stripped.startsWith("https://taijiai.online")) {
        setUrl("https://taijiai.online/");
      } else if (stripped) {
        setUrl(`${stripped}/`);
      }
    }
    setSupportsToolCall(item.supportsToolCall ?? true);
    setSupportsImages(item.supportsImages ?? true);
    setSupportsReasoning(item.supportsReasoning ?? true);
    setOnlyReasoning(item.onlyReasoning ?? false);
    setUseCustomProtocol(item.useCustomProtocol ?? false);
    setCanDisableThinking(item.reasoning?.canDisableThinking ?? true);
    setDefaultEffort(item.reasoning?.defaultEffort ?? "");
    setSupportedEfforts(
      item.reasoning?.supportedEfforts &&
        item.reasoning.supportedEfforts.length > 0
        ? item.reasoning.supportedEfforts
        : ["medium"],
    );
    setMaxInputTokens(item.maxInputTokens ?? 32768);
    setMaxOutputTokens(item.maxOutputTokens ?? 32768);
  };

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const cfg = await getWorkbuddyConfig();
      setConfigExists(cfg.config_exists);
      setConfigPath(cfg.config_path);
      setConfiguredModels(cfg.configured_models || []);

      // 仅在非静默模式（初次载入或用户手动重新载入）下才覆盖当前表单中的模型与参数
      if (!silent) {
        const loadedUrl = cfg.base_url?.trim();
        if (loadedUrl) {
          setUrl(loadedUrl);
        } else {
          setUrl(PRESET_URLS[0]);
        }
        setApiKey(cfg.api_key || "");
        setModel(cfg.model || "gpt-5.6-sol");

        setSupportsToolCall(cfg.supports_tool_call);
        setSupportsImages(cfg.supports_images);
        setSupportsReasoning(cfg.supports_reasoning);
        setOnlyReasoning(cfg.only_reasoning);
        setCanDisableThinking(cfg.can_disable_thinking);
        setUseCustomProtocol(cfg.use_custom_protocol);

        setDefaultEffort(cfg.default_effort || "");
        setSupportedEfforts(
          cfg.supported_efforts.length > 0 ? cfg.supported_efforts : ["medium"],
        );

        setMaxInputTokens(cfg.max_input_tokens ?? 32768);
        setMaxOutputTokens(cfg.max_output_tokens ?? 32768);
      }
    } catch (e) {
      toast.error(`读取 WorkBuddy 配置失败: ${e}`);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleReload = () => {
    void load(false);
  };

  const toggleEffort = (effortId: string) => {
    setSupportedEfforts((prev) =>
      prev.includes(effortId)
        ? prev.filter((id) => id !== effortId)
        : [...prev, effortId],
    );
  };

  const handleAddNewModel = () => {
    setModel("");
    toast.info("已切换至新增模型模式，请选择或输入新模型名称后保存并新增");
  };

  const handleDeleteModel = async (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    if (!window.confirm(`确定要从 WorkBuddy 中移除模型 "${modelId}" 吗？`)) {
      return;
    }
    setDeletingModelId(modelId);
    try {
      const updated = await deleteWorkbuddyModel(modelId);
      setConfiguredModels(updated);
      toast.success(`已从 WorkBuddy 成功移除模型 "${modelId}"`);
      if (model.trim() === modelId.trim()) {
        if (updated.length > 0) {
          applyModelConfig(updated[0]);
        } else {
          setModel("");
        }
      }
    } catch (err) {
      toast.error(`删除模型失败: ${err}`);
    } finally {
      setDeletingModelId(null);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (!model.trim()) {
      toast.warning("请选择或输入模型名称");
      return;
    }
    setTestModalOpen(true);
  };

  const isExistingModel = configuredModels.some(
    (m) => m.id.trim().toLowerCase() === model.trim().toLowerCase(),
  );

  const currentPayload: WorkbuddySavePayload = {
    url,
    api_key: apiKey.trim(),
    model: model.trim(),
    supports_tool_call: supportsToolCall,
    supports_images: supportsImages,
    supports_reasoning: supportsReasoning,
    only_reasoning: onlyReasoning,
    can_disable_thinking: canDisableThinking,
    use_custom_protocol: useCustomProtocol,
    default_effort: defaultEffort || null,
    supported_efforts: supportedEfforts,
    max_input_tokens: maxInputTokens === "" ? null : Number(maxInputTokens),
    max_output_tokens: maxOutputTokens === "" ? null : Number(maxOutputTokens),
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-emerald-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 WorkBuddy 本地配置文件...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col justify-between min-h-0 gap-5 pb-2">
      {/* ── 顶部面板标题栏与快速概览 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <WorkbuddyIcon size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                WorkBuddy 接入配置
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                多模型拼接模式 (Array Config)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 WorkBuddy
              自定义服务商以数组形式拼接追加多个模型，支持独立路由节点与认证凭据
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleReload}
          className="self-start md:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs"
          title="重新载入本地配置"
        >
          <RefreshCw size={12} />
          <span>重新载入</span>
        </button>
      </div>

      {/* ── 双列栅格配置区域 ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-0 overflow-y-auto pr-1">
        {/* ── 左列：路由网络、本地配置与高级能力开关 ── */}
        <div className="flex flex-col gap-5 flex-1 min-h-0">
          {/* 卡片 1: API 服务节点选择 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                <Server size={14} className="text-emerald-500" />
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
                accentColor="emerald"
                className="h-full"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 2: 本地配置文件管理 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <FileCode size={14} className="text-emerald-500" />
                  本地配置文件路径
                </Label>
                <span className="text-[11px] font-mono text-slate-400 dark:text-gray-500">
                  ~/.workbuddy-ai/models.json
                </span>
              </div>

              <StatusBadge
                exists={configExists}
                path={configPath}
                onReload={handleReload}
                accentColor="emerald"
              />
            </div>

            <div className="mt-3">
              {!configExists ? (
                <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    未检测到 WorkBuddy models.json
                    文件，保存新模型后将自动创建。
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">
                    当前 models.json 已存储{" "}
                    <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                      {configuredModels.length}
                    </strong>{" "}
                    个独立模型。WorkBuddy 支持内部热重载，无需重启即可感知。
                  </span>
                </div>
              )}
            </div>
          </SpotlightCard>

          {/* 卡片 3: 高级能力复选框配置 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Cpu size={14} className="text-emerald-500" />
                  高级配置与能力开关
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  当前模型特性
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                {/* 工具调用 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={supportsToolCall}
                    onChange={(e) => setSupportsToolCall(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none">
                    工具调用
                  </span>
                </label>

                {/* 图片输入 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={supportsImages}
                    onChange={(e) => setSupportsImages(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none">
                    图片输入
                  </span>
                </label>

                {/* 思考模式 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={supportsReasoning}
                    onChange={(e) => setSupportsReasoning(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none">
                    思考模式
                  </span>
                </label>

                {/* 仅思考模式 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={onlyReasoning}
                    onChange={(e) => setOnlyReasoning(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none">
                    仅思考模式
                  </span>
                </label>

                {/* 允许关闭思考 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors">
                  <input
                    type="checkbox"
                    checked={canDisableThinking}
                    onChange={(e) => setCanDisableThinking(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none">
                    允许关闭思考
                  </span>
                </label>

                {/* 自定义协议 */}
                <label
                  className="flex items-center gap-2 p-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors"
                  title="为 true 时原样请求该 URL；为 false (推荐) 时自动规整并追加 /chat/completions"
                >
                  <input
                    type="checkbox"
                    checked={useCustomProtocol}
                    onChange={(e) => setUseCustomProtocol(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 select-none flex items-center gap-1">
                    自定义协议
                    <HelpCircle size={11} className="text-slate-400" />
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-gray-500">
              <span>
                * 保持“自定义协议”未选中状态可使 WorkBuddy 自动适配标准
                /v1/chat/completions 端点。
              </span>
            </div>
          </SpotlightCard>
        </div>

        {/* ── 右列：密钥、模型管理与拼接、思考强度与 Token 限制 ── */}
        <div className="flex flex-col gap-5 flex-1 min-h-0">
          {/* 卡片 4: OpenAI API Key */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <KeyRound size={14} className="text-emerald-500" />
                  OpenAI API Key
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  认证凭据
                </span>
              </div>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-... (填入 API Key)"
                hintText="明文储存至 ~/.workbuddy-ai/models.json (无需环境变量)"
                accentColor="emerald"
              />
            </div>

            <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
              <ShieldCheck
                size={14}
                className="text-emerald-500 dark:text-emerald-400 flex-shrink-0"
              />
              <span className="leading-relaxed">
                凭据将以明文形式直接保存在本地 models.json，直连服务商网关。
              </span>
            </div>
          </SpotlightCard>

          {/* 卡片 5: 模型管理与多模型列表 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none space-y-4"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            {/* 已配置模型标签组与切换 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Layers size={14} className="text-emerald-500" />
                  已配置模型列表 ({configuredModels.length})
                </Label>
                <button
                  type="button"
                  onClick={handleAddNewModel}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-colors cursor-pointer"
                  title="清空当前输入，准备新增模型"
                >
                  <Plus size={12} />
                  <span>新增模型</span>
                </button>
              </div>

              {configuredModels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50/70 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/5 max-h-[110px] overflow-y-auto">
                  {configuredModels.map((item) => {
                    const isSelected =
                      item.id.trim().toLowerCase() ===
                      model.trim().toLowerCase();
                    const isDeleting = deletingModelId === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => applyModelConfig(item)}
                        className={`group relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs cursor-pointer border transition-all ${
                          isSelected
                            ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-800 dark:text-emerald-300 font-semibold shadow-xs"
                            : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:border-slate-300 dark:hover:border-white/20"
                        }`}
                        title={`点击查看并编辑 ${item.id} 的配置参数`}
                      >
                        <span className="truncate max-w-[140px] font-mono">
                          {item.id}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => void handleDeleteModel(e, item.id)}
                          disabled={isDeleting}
                          className="opacity-40 group-hover:opacity-100 hover:text-red-500 transition-opacity p-0.5 rounded ml-0.5"
                          title={`从 WorkBuddy 中移除模型 ${item.id}`}
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
                  尚未配置模型，点击下方保存即可新增首个模型。
                </div>
              )}
            </div>

            {/* 当前目标模型输入与选择 */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/5">
              <ModelInput
                value={model}
                onChange={setModel}
                models={models}
                placeholder="选择或输入模型名称 (如 gpt-5.6-sol / gpt-6-sol)"
                id="workbuddy-models"
                onRefresh={() => void refreshModels()}
                refreshing={refreshingModels}
                accentColor="emerald"
              />

              {/* 动态模式指示条 */}
              <div className="mt-2.5">
                {isExistingModel ? (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs">
                    <Info size={13} className="flex-shrink-0" />
                    <span>
                      当前模型已存在于 models.json
                      中，保存将更新此模型的各项配置参数。
                    </span>
                  </div>
                ) : model.trim() ? (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs">
                    <Sparkles size={13} className="flex-shrink-0" />
                    <span>
                      新增模型模式：保存将作为新模型追加（拼接）至 models.json
                      末尾，不覆盖现有模型。
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </SpotlightCard>

          {/* 卡片 6: 思考强度与 Token 上限设置 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Sliders size={14} className="text-emerald-500" />
                  思考强度与 Token 上限
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  Reasoning & Tokens
                </span>
              </div>

              {/* 默认思考强度与支持档位 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    默认思考强度:
                  </span>
                  <select
                    value={defaultEffort}
                    onChange={(e) => setDefaultEffort(e.target.value)}
                    className="text-xs bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">自动（使用请求层默认值）</option>
                    <option value="low">低 (low)</option>
                    <option value="medium">中 (medium)</option>
                    <option value="high">高 (high)</option>
                    <option value="xhigh">超高 (xhigh)</option>
                    <option value="max">极致 (max)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-gray-400">
                    支持的思考强度档位:
                  </span>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {EFFORT_OPTIONS.map((item) => {
                      const checked = supportedEfforts.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleEffort(item.id)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                            checked
                              ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 font-medium"
                              : "bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-white/20"
                          }`}
                        >
                          <span
                            className={`w-3 h-3 rounded flex items-center justify-center border text-[9px] ${
                              checked
                                ? "bg-emerald-500 border-emerald-600 text-white"
                                : "border-slate-300 dark:border-white/20"
                            }`}
                          >
                            {checked ? "✓" : ""}
                          </span>
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 输入/输出 Token 限制网格 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-white/5">
                {/* 输入 Token */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    输入 Token 上限:
                  </span>
                  <input
                    type="number"
                    value={maxInputTokens}
                    onChange={(e) =>
                      setMaxInputTokens(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="默认 32768"
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex gap-1">
                    {INPUT_TOKEN_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setMaxInputTokens(p.value)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                          maxInputTokens === p.value
                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold"
                            : "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 输出 Token */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    输出 Token 上限:
                  </span>
                  <input
                    type="number"
                    value={maxOutputTokens}
                    onChange={(e) =>
                      setMaxOutputTokens(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="默认 32768"
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-[#181b2a] border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex gap-1">
                    {OUTPUT_TOKEN_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setMaxOutputTokens(p.value)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                          maxOutputTokens === p.value
                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold"
                            : "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SpotlightCard>
        </div>
      </div>

      {/* ── 底部保存与联机验证操作栏 ── */}
      <div className="pt-2 flex-shrink-0">
        <StarBorder
          className="w-full shadow-md"
          color="#10b981"
          speed="3.5s"
          onClick={handleSave}
          disabled={testModalOpen}
          innerClassName="bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-[#0c1c18] dark:text-emerald-100 py-3 cursor-pointer"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            {isExistingModel ? (
              <Save
                size={18}
                className="text-white dark:text-emerald-400 group-hover:scale-110 transition-transform"
              />
            ) : (
              <Plus
                size={18}
                className="text-white dark:text-emerald-400 group-hover:scale-110 transition-transform"
              />
            )}
            <span className="text-sm">
              {isExistingModel
                ? `保存并更新模型配置 (${model})`
                : `保存并新增到 WorkBuddy (${model.trim() || "新模型"})`}
            </span>
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          {isExistingModel
            ? `点击将唤起终端进行连通性测试，验证通过后更新本地 ~/.workbuddy-ai/models.json 中模型 "${model}" 的配置`
            : `点击将唤起终端进行连通性测试，验证通过后以数组格式自动拼接追加至本地 ~/.workbuddy-ai/models.json 并即时生效`}
        </p>
      </div>

      <TerminalTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        type="workbuddy"
        url={url}
        apiKey={apiKey}
        model={model}
        workbuddyPayload={currentPayload}
        onSuccess={() => {
          setConfigExists(true);
          void load(true);
        }}
      />
    </div>
  );
}

export default WorkbuddyPanel;

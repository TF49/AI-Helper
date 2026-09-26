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
} from "lucide-react";
import { WorkbuddyIcon } from "./BrandIcons";
import { fetchCodexModels, getWorkbuddyConfig } from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import {
  PRESET_URLS,
  WORKBUDDY_MODEL_SUGGESTIONS,
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

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await getWorkbuddyConfig();
      const loadedUrl = cfg.base_url?.trim();
      if (loadedUrl) {
        setUrl(loadedUrl);
      } else {
        setUrl(PRESET_URLS[0]);
      }
      setApiKey(cfg.api_key || "");
      setModel(cfg.model || "gpt-5.6-sol");
      setConfigExists(cfg.config_exists);
      setConfigPath(cfg.config_path);

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
    } catch (e) {
      toast.error(`读取 WorkBuddy 配置失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleEffort = (effortId: string) => {
    setSupportedEfforts((prev) =>
      prev.includes(effortId)
        ? prev.filter((id) => id !== effortId)
        : [...prev, effortId],
    );
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
                Custom Provider (OpenAI Protocol)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 WorkBuddy 自定义服务商配置高可用反代节点、认证凭据、思考模式与
              Token 上限
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
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
                onReload={load}
                accentColor="emerald"
              />
            </div>

            <div className="mt-3">
              {!configExists ? (
                <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    未检测到 WorkBuddy models.json 文件，点击保存后将自动创建。
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">
                    WorkBuddy
                    内置实时文件监听，保存修改后将自动热重载，无需手动重启。
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
                  自定义服务商特性
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

        {/* ── 右列：密钥、模型参数、思考强度与 Token 限制 ── */}
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
                凭据将以明文形式直接保存在本地
                models.json，无需配置系统环境变量，直连服务商网关。
              </span>
            </div>
          </SpotlightCard>

          {/* 卡片 5: 测试模型与快捷选项 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex flex-col justify-between"
            spotlightColor="rgba(16, 185, 129, 0.12)"
          >
            <div>
              <ModelInput
                value={model}
                onChange={setModel}
                models={models}
                placeholder="选择或输入模型名称 (如 gpt-5.6-sol)"
                id="workbuddy-models"
                onRefresh={() => void refreshModels()}
                refreshing={refreshingModels}
                accentColor="emerald"
              />
            </div>

            {/* 常用模型快捷填充芯片 */}
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
              <span className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wider block mb-1.5 font-medium">
                常用模型推荐:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {WORKBUDDY_MODEL_SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setModel(item)}
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                      model === item
                        ? "bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-300 font-semibold"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                    }`}
                  >
                    {item}
                  </button>
                ))}
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
            <Save
              size={18}
              className="text-white dark:text-emerald-400 group-hover:scale-110 transition-transform"
            />
            <span className="text-sm">保存并应用 WorkBuddy 配置</span>
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          点击将唤起终端进行连通性测试，验证通过后自动写入本地
          ~/.workbuddy-ai/models.json 并即时生效
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
        }}
      />
    </div>
  );
}

export default WorkbuddyPanel;

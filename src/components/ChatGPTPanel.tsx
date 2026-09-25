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
  Bot,
} from "lucide-react";
import {
  fetchCodexModels,
  getCodexConfig,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import { PRESET_URLS } from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";
import { TerminalTestModal } from "./TerminalTestModal";

const QUICK_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o3-mini",
  "chatgpt-4o-latest",
];

export function ChatGPTPanel() {
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchCodexModels,
  );

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await getCodexConfig();
      const loadedUrl = cfg.base_url;
      if (loadedUrl && (PRESET_URLS as readonly string[]).includes(loadedUrl)) {
        setUrl(loadedUrl);
      } else {
        setUrl(PRESET_URLS[0]);
      }
      setApiKey(cfg.api_key || "");
      if (cfg.model) {
        setModel(cfg.model);
      }
      setConfigExists(cfg.config_exists);
      setConfigPath(cfg.config_path);
    } catch (e) {
      toast.error(`读取配置失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
        <Loader2 className="animate-spin text-blue-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Codex 本地配置文件...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col justify-between min-h-0 gap-5 pb-2">
      {/* ── 顶部面板标题栏与快速概览 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <Bot size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                ChatGPT (Codex) 接入配置
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30">
                OpenAI Protocol
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 Codex 终端插件及 VS Code 扩展配置高可用反代节点、认证凭据与模型
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

      {/* ── 双列栅格配置区域 (垂直水平均匀铺满) ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-0">
        {/* ── 左列：路由网络与本地配置文件 ── */}
        <div className="flex flex-col gap-5 flex-1 min-h-0">
          {/* 卡片 1: API 服务节点选择 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between min-h-[160px]"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                <Server size={14} className="text-blue-500" />
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
                accentColor="blue"
                className="h-full"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 2: 本地配置文件管理 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between min-h-[160px]"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <FileCode size={14} className="text-blue-500" />
                  本地配置文件路径
                </Label>
                <span className="text-[11px] font-mono text-slate-400 dark:text-gray-500">
                  ~/.codex/config.toml
                </span>
              </div>

              <StatusBadge
                exists={configExists}
                path={configPath}
                onReload={load}
                accentColor="blue"
              />
            </div>

            <div className="mt-3">
              {!configExists ? (
                <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <span>未检测到 Codex 配置文件，点击保存将自动在用户主目录中创建。</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">
                    Codex 会在每次启动时自动加载此文件。更新配置后重启相应 IDE 或终端即可生效。
                  </span>
                </div>
              )}
            </div>
          </SpotlightCard>
        </div>

        {/* ── 右列：认证密钥与测试模型 ── */}
        <div className="flex flex-col gap-5 flex-1 min-h-0">
          {/* 卡片 3: OpenAI API Key */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between min-h-[160px]"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <KeyRound size={14} className="text-blue-500" />
                  OpenAI API Key
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  认证凭证
                </span>
              </div>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-... (填入 BobAPI 密钥)"
                envVarName="CUSTOM_OPENAI_API_KEY"
                accentColor="blue"
              />
            </div>

            <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
              <ShieldCheck size={14} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
              <span className="leading-relaxed">
                凭据仅加密储存于本地配置与当前环境，直接与所选专线通信，绝不中转第三方。
              </span>
            </div>
          </SpotlightCard>

          {/* 卡片 4: 测试模型与快捷选项 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between min-h-[160px]"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div>
              <ModelInput
                value={model}
                onChange={setModel}
                models={models}
                placeholder="选择或输入测试模型名称 (如 gpt-4o)"
                id="codex-models"
                onRefresh={() => void refreshModels()}
                refreshing={refreshingModels}
                accentColor="blue"
              />
            </div>

            {/* 常用模型快捷填充芯片 */}
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
              <span className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wider block mb-1.5 font-medium">
                常用模型推荐:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_MODELS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setModel(item)}
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                      model === item
                        ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-500/20 dark:border-blue-500/40 dark:text-blue-300 font-semibold"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:bg-white/5 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </SpotlightCard>
        </div>
      </div>

      {/* ── 底部保存与联机验证操作栏 ── */}
      <div className="pt-2 flex-shrink-0">
        <StarBorder
          className="w-full shadow-md"
          color="#3b82f6"
          speed="3.5s"
          onClick={handleSave}
          disabled={testModalOpen}
          innerClassName="bg-blue-600 hover:bg-blue-700 text-white dark:bg-[#0e1726] dark:text-blue-100 py-3 cursor-pointer"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            <Save
              size={18}
              className="text-white dark:text-blue-400 group-hover:scale-110 transition-transform"
            />
            <span className="text-sm">保存并应用 Codex 配置</span>
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          点击将唤起终端进行连通性测试，验证通过后自动写入本地 ~/.codex/config.toml 并设置环境变量
        </p>
      </div>

      <TerminalTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        type="codex"
        url={url}
        apiKey={apiKey}
        model={model}
        onSuccess={() => {
          setConfigExists(true);
        }}
      />
    </div>
  );
}

export default ChatGPTPanel;


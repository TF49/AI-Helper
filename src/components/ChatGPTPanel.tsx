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
  Bot,
} from "lucide-react";
import {
  fetchCodexModels,
  getCodexConfig,
  setCodexConfig,
  testCodexConfig,
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
  const [saving, setSaving] = useState(false);
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

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (!model.trim()) {
      toast.warning("请选择或输入测试模型");
      return;
    }
    setSaving(true);
    try {
      const testResult = await testCodexConfig(
        url,
        apiKey.trim(),
        model.trim(),
      );
      if (!testResult.success) {
        toast.error(`测试失败: ${testResult.message}`);
        return;
      }
      await setCodexConfig(url, apiKey.trim(), model.trim());
      setConfigExists(true);
      toast.success("测试通过，ChatGPT 配置已保存，请重启 Codex 生效");
    } catch (e) {
      toast.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-3">
        <Loader2 className="animate-spin text-blue-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Codex 本地配置文件...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-6">
      {/* ── 顶部面板标题栏与快速概览 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-white/10">
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

      {/* ── 双列栅格配置区域 (宽屏下优雅舒展，彻底告别单列拥挤) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── 左列：路由网络与本地配置文件 ── */}
        <div className="flex flex-col gap-5">
          {/* 卡片 1: API 服务节点选择 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Server size={14} className="text-blue-500" />
                  API 服务网关节点
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  支持多线路故障切换
                </span>
              </div>
              <NodeCardSelector
                value={url}
                onChange={setUrl}
                accentColor="blue"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 2: 本地配置文件管理 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
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

              {!configExists ? (
                <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <span>未检测到 Codex 配置文件，点击保存将自动在用户主目录中创建。</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 dark:text-gray-500 leading-relaxed">
                  Codex 会在每次启动时自动加载此文件。更新配置后重启相应 IDE 或终端即可生效。
                </p>
              )}
            </div>
          </SpotlightCard>
        </div>

        {/* ── 右列：认证密钥与测试模型 ── */}
        <div className="flex flex-col gap-5">
          {/* 卡片 3: OpenAI API Key */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
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
          </SpotlightCard>

          {/* 卡片 4: 测试模型与快捷选项 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between"
            spotlightColor="rgba(59, 130, 246, 0.12)"
          >
            <div className="space-y-3">
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

              {/* 常用模型快捷填充芯片 */}
              <div>
                <span className="text-[10px] text-slate-400 dark:text-gray-500 uppercase tracking-wider block mb-1.5">
                  常用模型推荐:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_MODELS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setModel(item)}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded-md border transition-all ${
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
            </div>
          </SpotlightCard>
        </div>
      </div>

      {/* ── 底部保存与联机验证操作栏 ── */}
      <div className="pt-2">
        <StarBorder
          className="w-full shadow-md"
          color="#3b82f6"
          speed="3.5s"
          onClick={handleSave}
          disabled={saving}
          innerClassName="bg-blue-600 hover:bg-blue-700 text-white dark:bg-[#0e1726] dark:text-blue-100 py-3"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            {saving ? (
              <>
                <Loader2
                  className="animate-spin text-white dark:text-blue-400"
                  size={18}
                />
                <span>正在联机验证并保存配置...</span>
              </>
            ) : (
              <>
                <Save
                  size={18}
                  className="text-white dark:text-blue-400 group-hover:scale-110 transition-transform"
                />
                <span className="text-sm">保存并应用 Codex 配置</span>
              </>
            )}
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2.5">
          保存前将发送一次轻量测试请求，验证通过后自动写入本地 ~/.codex/config.toml 并设置环境变量
        </p>
      </div>
    </div>
  );
}

export default ChatGPTPanel;

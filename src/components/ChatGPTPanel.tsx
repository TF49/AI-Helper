import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, RefreshCw, Sparkles, ShieldAlert } from "lucide-react";
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
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="animate-spin text-blue-500" size={32} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Codex 配置文件...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      {/* 配置文件状态卡片 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(59, 130, 246, 0.1)"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <Sparkles size={13} className="text-blue-500" />
              Codex 配置文件
            </Label>
            <button
              onClick={load}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
              title="重新读取配置"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <StatusBadge exists={configExists} path={configPath} />
          {!configExists && (
            <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400/90 pt-0.5">
              <ShieldAlert size={12} className="flex-shrink-0" />
              未检测到 ChatGPT Codex 配置文件，首次保存将自动创建。
            </p>
          )}
        </div>
      </SpotlightCard>

      {/* API 节点卡片 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(59, 130, 246, 0.1)"
      >
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
            API 服务节点
          </Label>
          <NodeCardSelector value={url} onChange={setUrl} accentColor="blue" />
        </div>
      </SpotlightCard>

      {/* API Key 卡片 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(59, 130, 246, 0.1)"
      >
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
            OpenAI API Key
          </Label>
          <ApiKeyInput
            value={apiKey}
            onChange={setApiKey}
            placeholder="CUSTOM_OPENAI_API_KEY (sk-...)"
            envVarName="CUSTOM_OPENAI_API_KEY"
            accentColor="blue"
          />
        </div>
      </SpotlightCard>

      {/* 测试模型卡片 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(59, 130, 246, 0.1)"
      >
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
      </SpotlightCard>

      {/* 保存配置按钮 (带 StarBorder 流光动效) */}
      <div className="pt-1">
        <StarBorder
          className="w-full shadow-md"
          color="#3b82f6"
          speed="3.5s"
          onClick={handleSave}
          disabled={saving}
          innerClassName="bg-blue-600 hover:bg-blue-700 text-white dark:bg-[#0e1726] dark:text-blue-100"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide py-0.5">
            {saving ? (
              <>
                <Loader2
                  className="animate-spin text-white dark:text-blue-400"
                  size={16}
                />
                <span>正在联机验证并保存...</span>
              </>
            ) : (
              <>
                <Save
                  size={16}
                  className="text-white dark:text-blue-400 group-hover:scale-110 transition-transform"
                />
                <span>保存并应用 Codex 配置</span>
              </>
            )}
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          保存前将发送一次轻量测试请求，验证通过后自动写入环境变量
        </p>
      </div>
    </div>
  );
}

export default ChatGPTPanel;

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, RefreshCw, Sparkles, ShieldAlert } from "lucide-react";
import {
  fetchClaudeModels,
  getClaudeConfig,
  setClaudeConfig,
  testClaudeConfig,
} from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import { PRESET_URLS, CLAUDE_MODEL_SUGGESTIONS } from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";

const EXTENDED_CLAUDE_PRESETS = [
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  ...CLAUDE_MODEL_SUGGESTIONS,
] as const;

export function ClaudePanel() {
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-3-7-sonnet-20250219");
  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchClaudeModels,
  );

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await getClaudeConfig();
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
      const testResult = await testClaudeConfig(
        url,
        apiKey.trim(),
        model.trim(),
      );
      if (!testResult.success) {
        toast.error(`测试失败: ${testResult.message}`);
        return;
      }
      await setClaudeConfig(url, apiKey.trim(), model.trim());
      setConfigExists(true);
      toast.success(
        "测试通过，Claude Code 配置已保存，重启 Claude Code 后生效",
      );
    } catch (e) {
      toast.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="animate-spin text-purple-500" size={32} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Claude 配置文件...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2">
      {/* 配置文件状态 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(168, 85, 247, 0.1)"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <Sparkles size={13} className="text-purple-500" />
              Claude Code 配置文件
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
              未检测到 Claude Code 配置文件，首次保存将自动创建。
            </p>
          )}
        </div>
      </SpotlightCard>

      {/* API 节点选择 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(168, 85, 247, 0.1)"
      >
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
            API 服务节点
          </Label>
          <NodeCardSelector
            value={url}
            onChange={setUrl}
            accentColor="purple"
          />
        </div>
      </SpotlightCard>

      {/* API Key */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(168, 85, 247, 0.1)"
      >
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700 dark:text-gray-300">
            Anthropic Auth Token / API Key
          </Label>
          <ApiKeyInput
            value={apiKey}
            onChange={setApiKey}
            placeholder="ANTHROPIC_AUTH_TOKEN (sk-ant-...)"
            envVarName="~/.claude/settings.json (env.ANTHROPIC_AUTH_TOKEN)"
            accentColor="purple"
          />
        </div>
      </SpotlightCard>

      {/* 测试模型 */}
      <SpotlightCard
        className="p-4 rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none"
        spotlightColor="rgba(168, 85, 247, 0.1)"
      >
        <ModelInput
          value={model}
          onChange={setModel}
          models={models}
          placeholder="选择或输入测试模型名称 (如 claude-3-7-sonnet)"
          id="claude-models"
          onRefresh={() => void refreshModels()}
          refreshing={refreshingModels}
          presetSuggestions={EXTENDED_CLAUDE_PRESETS}
          accentColor="purple"
        />
      </SpotlightCard>

      {/* 保存按钮 (带 StarBorder 流光动效) */}
      <div className="pt-1">
        <StarBorder
          className="w-full shadow-md"
          color="#a855f7"
          speed="3.5s"
          onClick={handleSave}
          disabled={saving}
          innerClassName="bg-purple-600 hover:bg-purple-700 text-white dark:bg-[#190e28] dark:text-purple-100"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide py-0.5">
            {saving ? (
              <>
                <Loader2
                  className="animate-spin text-white dark:text-purple-400"
                  size={16}
                />
                <span>正在联机验证并保存...</span>
              </>
            ) : (
              <>
                <Save
                  size={16}
                  className="text-white dark:text-purple-400 group-hover:scale-110 transition-transform"
                />
                <span>保存并应用 Claude Code 配置</span>
              </>
            )}
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2">
          保存前将发送一次轻量测试请求，验证通过后写入本地设置文件
        </p>
      </div>
    </div>
  );
}

export default ClaudePanel;

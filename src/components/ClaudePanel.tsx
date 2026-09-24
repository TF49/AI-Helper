import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  Sparkles,
  Server,
  KeyRound,
  FileCode,
  ShieldAlert,
} from "lucide-react";
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
import { PRESET_URLS } from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { StarBorder } from "./react-bits/StarBorder";

const QUICK_MODELS = [
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
];

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
      <div className="flex flex-col items-center justify-center h-80 gap-3">
        <Loader2 className="animate-spin text-purple-500" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 Claude Code 本地配置文件...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-6">
      {/* ── 顶部面板标题栏与快速概览 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <Sparkles size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                Claude Code 终端配置
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30">
                Anthropic Protocol
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 Claude Code 终端命令行工具配置反向代理网关、Auth Token 与默认模型
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── 左列：路由网络与本地配置文件 ── */}
        <div className="flex flex-col gap-5">
          {/* 卡片 1: API 服务节点选择 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between"
            spotlightColor="rgba(168, 85, 247, 0.12)"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <Server size={14} className="text-purple-500" />
                  API 服务网关节点
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  支持多线路故障切换
                </span>
              </div>
              <NodeCardSelector
                value={url}
                onChange={setUrl}
                accentColor="purple"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 2: 本地配置文件管理 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none"
            spotlightColor="rgba(168, 85, 247, 0.12)"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <FileCode size={14} className="text-purple-500" />
                  本地配置文件路径
                </Label>
                <span className="text-[11px] font-mono text-slate-400 dark:text-gray-500">
                  ~/.claude/settings.json
                </span>
              </div>

              <StatusBadge
                exists={configExists}
                path={configPath}
                onReload={load}
                accentColor="purple"
              />

              {!configExists ? (
                <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                  <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                  <span>未检测到 Claude 配置文件，点击保存将自动在用户主目录中创建。</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 dark:text-gray-500 leading-relaxed">
                  Claude Code 启动时将读取此文件设置 ANTHROPIC_AUTH_TOKEN 与 API URL。
                </p>
              )}
            </div>
          </SpotlightCard>
        </div>

        {/* ── 右列：认证密钥与测试模型 ── */}
        <div className="flex flex-col gap-5">
          {/* 卡片 3: Anthropic Auth Token / API Key */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none"
            spotlightColor="rgba(168, 85, 247, 0.12)"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                  <KeyRound size={14} className="text-purple-500" />
                  Anthropic Auth Token / API Key
                </Label>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">
                  认证凭证
                </span>
              </div>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-ant-... (填入 BobAPI 密钥)"
                envVarName="ANTHROPIC_AUTH_TOKEN"
                accentColor="purple"
              />
            </div>
          </SpotlightCard>

          {/* 卡片 4: 测试模型与快捷选项 */}
          <SpotlightCard
            className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm dark:shadow-none flex-1 flex flex-col justify-between"
            spotlightColor="rgba(168, 85, 247, 0.12)"
          >
            <div className="space-y-3">
              <ModelInput
                value={model}
                onChange={setModel}
                models={models}
                placeholder="选择或输入测试模型名称 (如 claude-3-7-sonnet-20250219)"
                id="claude-models"
                onRefresh={() => void refreshModels()}
                refreshing={refreshingModels}
                accentColor="purple"
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
                          ? "bg-purple-100 border-purple-300 text-purple-700 dark:bg-purple-500/20 dark:border-purple-500/40 dark:text-purple-300 font-semibold"
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
          color="#a855f7"
          speed="3.5s"
          onClick={handleSave}
          disabled={saving}
          innerClassName="bg-purple-600 hover:bg-purple-700 text-white dark:bg-[#190e28] dark:text-purple-100 py-3"
        >
          <div className="flex items-center justify-center gap-2 font-semibold tracking-wide">
            {saving ? (
              <>
                <Loader2
                  className="animate-spin text-white dark:text-purple-400"
                  size={18}
                />
                <span>正在联机验证并保存配置...</span>
              </>
            ) : (
              <>
                <Save
                  size={18}
                  className="text-white dark:text-purple-400 group-hover:scale-110 transition-transform"
                />
                <span className="text-sm">保存并应用 Claude Code 配置</span>
              </>
            )}
          </div>
        </StarBorder>
        <p className="text-[11px] text-center text-slate-500 dark:text-gray-400 pt-2.5">
          保存前将发送一次轻量测试请求，验证通过后写入本地 ~/.claude/settings.json
        </p>
      </div>
    </div>
  );
}

export default ClaudePanel;

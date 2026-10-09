import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  RefreshCw,
  Server,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  KeyRound,
  Cpu,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { OpenAIIcon } from "./BrandIcons";
import { fetchCodexModels, getCodexConfig } from "../lib/api";
import { ConfigPathBar } from "./ConfigPathBar";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ChannelGroupMonitor } from "./ChannelGroupMonitor";
import { ModelInput } from "./ModelInput";
import { Label } from "./ui/label";
import { PRESET_URLS } from "../types";
import { useModelFetch } from "../lib/useModelFetch";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { TerminalTestModal } from "./TerminalTestModal";
import { StepIndicator, type StepDef } from "./StepIndicator";

const stepVariants = {
  enter: (dir: number) => ({ x: dir * 32, opacity: 0 }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.22, ease: "easeOut" as const },
  },
  exit: (dir: number) => ({
    x: -dir * 32,
    opacity: 0,
    transition: { duration: 0.18, ease: "easeIn" as const },
  }),
};

const TOTAL_STEPS = 3;

export function ChatGPTPanel() {
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [configExists, setConfigExists] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [testModalOpen, setTestModalOpen] = useState(false);

  // ── 步骤化导航状态 ──
  const [currentStep, setCurrentStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [maxStepReached, setMaxStepReached] = useState(0);

  const { models, refreshingModels, refreshModels } = useModelFetch(
    url,
    apiKey,
    fetchCodexModels,
  );

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await getCodexConfig();
      const loadedUrl = cfg.base_url?.trim();
      if (loadedUrl) {
        setUrl(loadedUrl);
      } else {
        setUrl(PRESET_URLS[0]);
      }
      setApiKey(cfg.api_key || "");
      setModel(cfg.model || "");
      setConfigExists(cfg.config_exists);
      setConfigPath(cfg.config_path);

      if (cfg.config_exists) {
        setShowSummary(true);
        setMaxStepReached(TOTAL_STEPS - 1);
      }
    } catch (e) {
      toast.error(`读取配置失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const goToStep = (step: number) => {
    if (step > 1 && !apiKey.trim()) {
      toast.warning("请先在第 2 步输入 API Key");
      setDirection(1 > currentStep ? 1 : -1);
      setCurrentStep(1);
      setShowSummary(false);
      return;
    }
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
    setMaxStepReached((prev) => Math.max(prev, step));
    setShowSummary(false);
  };

  const handleNext = () => {
    if (currentStep === 1 && !apiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    if (currentStep < TOTAL_STEPS - 1) {
      goToStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
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

  const urlSummary = url
    ? url
        .replace(/https?:\/\//, "")
        .replace(/\/$/, "")
        .split("/")[0]
    : undefined;
  const keySummary =
    apiKey.length > 8
      ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
      : apiKey
        ? "已填写"
        : undefined;

  const STEPS: StepDef[] = [
    { label: "接入节点", summary: urlSummary },
    { label: "API Key", summary: keySummary },
    { label: "选择模型", summary: model || undefined },
  ];

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
    <div className="w-full min-h-full flex flex-col justify-between gap-5 pb-2">
      {/* ── 顶部面板标题栏 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30 flex items-center justify-center flex-shrink-0 shadow-xs">
            <OpenAIIcon size={22} />
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

        <div className="self-start md:self-auto flex flex-wrap items-center gap-2">
          {showSummary && (
            <button
              type="button"
              onClick={() => {
                setShowSummary(false);
                setCurrentStep(0);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 dark:border-blue-500/30 dark:text-blue-300 shadow-2xs cursor-pointer"
              title="切换到 3 步配置向导引导模式"
            >
              <Sparkles size={12} />
              <span>分步向导</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="重新载入本地配置"
          >
            <RefreshCw size={12} />
            <span>重新载入</span>
          </button>
          <ConfigPathBar
            path={configPath}
            shortPath="~/.codex/config.toml"
            exists={configExists}
            accentColor="blue"
          />
        </div>
      </div>

      {/* ── 步骤指示条（非摘要模式下显示） ── */}
      {!showSummary && (
        <div className="flex-shrink-0 px-1 py-2 border-b border-slate-100 dark:border-white/5">
          <StepIndicator
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={goToStep}
            accentColor="blue"
            maxStepReached={maxStepReached}
          />
        </div>
      )}

      {/* ── 主内容工作区 ── */}
      <div className="w-full flex-1 flex flex-col gap-4">
        {showSummary ? (
          /* ── 摘要视图（已有配置时默认呈现） ── */
          <div className="w-full flex flex-col gap-4">
            <SpotlightCard
              className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm"
              spotlightColor="rgba(59, 130, 246, 0.12)"
            >
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-500" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    当前配置概览
                  </span>
                </div>
                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">
                  已就绪
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
                    <Server size={13} className="text-blue-500" />
                    <span>服务网关节点</span>
                  </div>
                  <div
                    className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate"
                    title={url}
                  >
                    {urlSummary || url}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
                    <KeyRound size={13} className="text-blue-500" />
                    <span>API Key 凭据</span>
                  </div>
                  <div className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate">
                    {keySummary || "未配置"}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
                    <Cpu size={13} className="text-blue-500" />
                    <span>当前测试模型</span>
                  </div>
                  <div className="text-xs font-mono font-medium text-blue-600 dark:text-blue-400 truncate">
                    {model || "未配置"}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-xs text-slate-500 dark:text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="leading-relaxed">
                    Codex 会在每次启动时自动加载此配置文件。如需调整参数可点击下方「重新配置」。
                  </span>
                </div>
              </div>
            </SpotlightCard>

            {/* 实时通道分组健康监控面板（概览模式直接呈现） */}
            <ChannelGroupMonitor
              toolName="ChatGPT (Codex)"
              toolId="chatgpt"
              accentColor="blue"
            />
          </div>
        ) : (
          /* ── 步骤化引导视图 ── */
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="w-full flex flex-col gap-4"
            >
              {currentStep === 0 && (
                <SpotlightCard
                  className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm"
                  spotlightColor="rgba(59, 130, 246, 0.12)"
                >
                  <div className="flex items-center justify-between mb-3 flex-shrink-0">
                    <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                      <Server size={14} className="text-blue-500" />
                      API 服务网关节点
                    </Label>
                    <span className="text-[11px] text-slate-400 dark:text-gray-500">
                      第 1 步 / 共 3 步
                    </span>
                  </div>
                  <NodeCardSelector
                    value={url}
                    onChange={setUrl}
                    accentColor="blue"
                  />
                  <p className="mt-3 text-[11px] text-slate-500 dark:text-gray-400">
                    请选择目标 API 路由节点，支持 BobAPI
                    官方高速线路与备用加速节点。
                  </p>
                </SpotlightCard>
              )}

              {currentStep === 1 && (
                <SpotlightCard
                  className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm"
                  spotlightColor="rgba(59, 130, 246, 0.12)"
                >
                  <ApiKeyInput
                    title="OpenAI API Key"
                    badgeText="环境变量"
                    value={apiKey}
                    onChange={setApiKey}
                    placeholder="sk-... (填入 BobAPI 密钥)"
                    envVarName="CUSTOM_OPENAI_API_KEY"
                    accentColor="blue"
                    toolName="ChatGPT (Codex)"
                    toolId="chatgpt"
                  />
                </SpotlightCard>
              )}

              {currentStep === 2 && (
                <SpotlightCard
                  className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#121524]/60 shadow-sm"
                  spotlightColor="rgba(59, 130, 246, 0.12)"
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

                  <div className="mt-4 p-3 rounded-xl bg-blue-50/60 dark:bg-blue-500/10 border border-blue-200/60 dark:border-blue-500/20 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
                    <Sparkles size={14} className="flex-shrink-0 mt-0.5" />
                    <span>
                      在此选定或输入的模型将作为 Codex
                      终端工具的默认会话模型，保存后将即时生效。
                    </span>
                  </div>
                </SpotlightCard>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── 底部操作栏 (苹果风毛玻璃悬浮 Dock 栏) ── */}
      <div className="sticky bottom-0 z-20 mt-auto py-2.5 px-4 rounded-2xl bg-white/45 dark:bg-[#0c0e18]/45 backdrop-blur-xl backdrop-saturate-150 border border-white/60 dark:border-white/10 shadow-[0_4px_24px_-2px_rgba(0,0,0,0.06),inset_0_1px_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_4px_24px_-2px_rgba(0,0,0,0.3),inset_0_1px_1px_0_rgba(255,255,255,0.08)] flex-shrink-0 transition-all">
        {showSummary ? (
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：辅助动作与状态指示 */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowSummary(false);
                  setCurrentStep(0);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs backdrop-blur-xs cursor-pointer"
                title="重新启动 3 步分步配置向导"
              >
                <RefreshCw size={13} className="text-slate-500 dark:text-gray-400" />
                <span>重新配置向导</span>
              </button>
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Codex 配置已生效 (config.toml)</span>
              </div>
            </div>

            {/* 右侧：主保存操作 */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSave}
                disabled={testModalOpen}
                className="flex items-center justify-center gap-2 px-6 py-2.5 min-w-[190px] rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                <span>保存并应用 Codex 配置</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            {/* 左侧：上一步与进度 */}
            <div className="flex items-center gap-2">
              {currentStep > 0 ? (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs backdrop-blur-xs cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>上一步</span>
                </button>
              ) : null}
              <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium px-2">
                步骤 {currentStep + 1} / {TOTAL_STEPS}
              </span>
            </div>

            {/* 右侧：返回概览与推进/保存 */}
            <div className="flex items-center gap-2.5">
              {configExists && (
                <button
                  type="button"
                  onClick={() => setShowSummary(true)}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  返回概览
                </button>
              )}

              {currentStep < TOTAL_STEPS - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="flex items-center gap-1.5 px-6 py-2 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-colors shadow-xs cursor-pointer"
                >
                  <span>下一步</span>
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={testModalOpen}
                  className="flex items-center justify-center gap-1.5 px-6 py-2 min-w-[190px] rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={14} />
                  <span>保存并应用 Codex 配置</span>
                </button>
              )}
            </div>
          </div>
        )}
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
          setShowSummary(true);
          setMaxStepReached(TOTAL_STEPS - 1);
        }}
      />
    </div>
  );
}

export default ChatGPTPanel;

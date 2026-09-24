import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Wifi,
  WifiOff,
  FolderCheck,
  FileCode,
  Key,
  Eye,
  EyeOff,
  Cpu,
  Globe,
  RefreshCw,
  Edit3,
  Copy,
  Check,
  ShieldCheck,
  ArrowRight,
  Bot,
  Sparkles,
  Save,
  Power,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { exit } from "@tauri-apps/plugin-process";
import {
  checkBobApiNetwork,
  getCodexConfig,
  getClaudeConfig,
  setCodexConfig,
  setClaudeConfig,
} from "../lib/api";
import type { AgentConfig, NetworkStatus, StepStatus } from "../types";
import { cn } from "../lib/utils";

interface InitializationModalProps {
  open: boolean;
  onClose: () => void;
  onFinish: () => void;
}

interface StepConfigData {
  codex: AgentConfig | null;
  claude: AgentConfig | null;
}

export function InitializationModal({
  open,
  onClose,
  onFinish,
}: InitializationModalProps) {
  // ── 步骤状态 ──
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [step1Status, setStep1Status] = useState<StepStatus>("pending");
  const [step2Status, setStep2Status] = useState<StepStatus>("pending");
  const [step3Status, setStep3Status] = useState<StepStatus>("pending");
  const [step4Status, setStep4Status] = useState<StepStatus>("pending");

  // ── 环节数据 ──
  const [networkData, setNetworkData] = useState<NetworkStatus | null>(null);
  const [networkError, setNetworkError] = useState<string>("");

  const [pathError, setPathError] = useState<string>("");
  const [configData, setConfigData] = useState<StepConfigData>({
    codex: null,
    claude: null,
  });
  const [parseError, setParseError] = useState<string>("");

  // ── 环节 3 & 4 展示控制 ──
  const [activeConfigTab, setActiveConfigTab] = useState<"chatgpt" | "claude">("chatgpt");
  const [showCodexKey, setShowCodexKey] = useState<boolean>(false);
  const [showClaudeKey, setShowClaudeKey] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string>("");

  // ── 环节 4 确认与快速修改模式 ──
  const [confirmationDecision, setConfirmationDecision] = useState<"none" | "confirmed" | "editing">("none");
  const [editTab, setEditTab] = useState<"chatgpt" | "claude">("chatgpt");
  const [editUrl, setEditUrl] = useState<string>("");
  const [editApiKey, setEditApiKey] = useState<string>("");
  const [editModel, setEditModel] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const isRunningRef = useRef<boolean>(false);

  const copyToClipboard = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    toast.success(`已复制 ${label} 到剪贴板`);
    setTimeout(() => setCopiedKey(""), 2000);
  };

  // ── 环节 1: 网络环境检测 ──
  const runStep1 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(1);
    setStep1Status("running");
    setNetworkError("");
    setNetworkData(null);

    try {
      const status = await checkBobApiNetwork();
      setNetworkData(status);

      if (status.reachable) {
        setStep1Status("success");
        return true;
      } else {
        setStep1Status("error");
        setNetworkError(
          status.error_message ||
            "无法连接至指定站点 https://bob-api.com/，请检查本机网络或代理设置。",
        );
        return false;
      }
    } catch (err) {
      setStep1Status("error");
      const msg = err instanceof Error ? err.message : String(err);
      setNetworkError(`网络检测执行异常: ${msg}`);
      return false;
    }
  }, []);

  // ── 环节 2: 配置文件路径获取 ──
  const runStep2 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(2);
    setStep2Status("running");
    setPathError("");

    try {
      await new Promise((res) => setTimeout(res, 350));

      const [codex, claude] = await Promise.all([
        getCodexConfig().catch((e) => {
          throw new Error(`Codex 路径获取失败: ${e}`);
        }),
        getClaudeConfig().catch((e) => {
          throw new Error(`Claude 路径获取失败: ${e}`);
        }),
      ]);

      setConfigData({ codex, claude });

      // 验证路径是否成功识别
      if (!codex.config_path && !claude.config_path) {
        setStep2Status("error");
        setPathError("未能准确定位系统中的配置文件路径，请检查用户主目录权限。");
        return false;
      }

      setStep2Status("success");
      return true;
    } catch (err) {
      setStep2Status("error");
      const msg = err instanceof Error ? err.message : String(err);
      setPathError(msg);
      return false;
    }
  }, []);

  // ── 环节 3: 配置信息读取与展示 ──
  const runStep3 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(3);
    setStep3Status("running");
    setParseError("");

    try {
      await new Promise((res) => setTimeout(res, 350));

      // 重新读取一次以确保解析最新配置内容
      const [codex, claude] = await Promise.all([
        getCodexConfig(),
        getClaudeConfig(),
      ]);

      setConfigData({ codex, claude });

      // 初始化编辑表单数据为当前 Codex 默认值
      setEditUrl(codex.base_url || "https://bob-api.com/");
      setEditApiKey(codex.api_key || "");
      setEditModel(codex.model || "gpt-4o");

      setStep3Status("success");
      return true;
    } catch (err) {
      setStep3Status("error");
      const msg = err instanceof Error ? err.message : String(err);
      setParseError(`配置文件读取或解析失败: ${msg}`);
      return false;
    }
  }, []);

  // ── 环节 4: 配置信息确认环节 ──
  const runStep4 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(4);
    setStep4Status("running");
    return true;
  }, []);

  // ── 顺序执行编排管线 ──
  const runPipeline = useCallback(
    async (fromStep = 1) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      try {
        if (fromStep <= 1) {
          const s1Ok = await runStep1();
          if (!s1Ok) {
            isRunningRef.current = false;
            return;
          }
        }

        if (fromStep <= 2) {
          const s2Ok = await runStep2();
          if (!s2Ok) {
            isRunningRef.current = false;
            return;
          }
        }

        if (fromStep <= 3) {
          const s3Ok = await runStep3();
          if (!s3Ok) {
            isRunningRef.current = false;
            return;
          }
        }

        if (fromStep <= 4) {
          await runStep4();
        }
      } finally {
        isRunningRef.current = false;
      }
    },
    [runStep1, runStep2, runStep3, runStep4],
  );

  // 弹窗展示或关闭时
  useEffect(() => {
    if (open) {
      void runPipeline(1);
    } else {
      setCurrentStep(1);
      setStep1Status("pending");
      setStep2Status("pending");
      setStep3Status("pending");
      setStep4Status("pending");
      setConfirmationDecision("none");
    }
  }, [open, runPipeline]);

  // 切换编辑 Tab 时同步表单数据
  const handleSwitchEditTab = (tab: "chatgpt" | "claude") => {
    setEditTab(tab);
    if (tab === "chatgpt") {
      setEditUrl(configData.codex?.base_url || "https://bob-api.com/");
      setEditApiKey(configData.codex?.api_key || "");
      setEditModel(configData.codex?.model || "gpt-4o");
    } else {
      setEditUrl(configData.claude?.base_url || "https://bob-api.com/");
      setEditApiKey(configData.claude?.api_key || "");
      setEditModel(configData.claude?.model || "claude-3-7-sonnet-20250219");
    }
  };

  // 保存快速修改
  const handleSaveEdit = async () => {
    if (!editApiKey.trim()) {
      toast.warning("请输入 API Key");
      return;
    }
    setSavingEdit(true);
    try {
      if (editTab === "chatgpt") {
        await setCodexConfig(editUrl.trim(), editApiKey.trim(), editModel.trim());
        toast.success("ChatGPT (Codex) 配置已保存更新");
      } else {
        await setClaudeConfig(editUrl.trim(), editApiKey.trim(), editModel.trim());
        toast.success("Claude Code 配置已保存更新");
      }

      // 重新读取并刷新展示
      const [newCodex, newClaude] = await Promise.all([
        getCodexConfig(),
        getClaudeConfig(),
      ]);
      setConfigData({ codex: newCodex, claude: newClaude });
      setConfirmationDecision("confirmed");
      setStep4Status("success");
    } catch (err) {
      toast.error(`保存修改失败: ${err}`);
    } finally {
      setSavingEdit(false);
    }
  };

  // 用户直接确认无需修改
  const handleConfirmNoChange = () => {
    setConfirmationDecision("confirmed");
    setStep4Status("success");
    toast.success("已确认当前配置信息有效");
  };

  // 点击底部【完成初始化并进入软件】按钮
  const handleCompleteInitialization = () => {
    if (step4Status !== "success") {
      toast.warning("请先在步骤 4 完成配置信息的检查与确认");
      return;
    }
    toast.success("软件初始化流程圆满完成，欢迎使用 BobAPI Tool！");
    onFinish();
    onClose();
  };

  // 进度计算 (0% - 100%)
  const calculateOverallProgress = (): number => {
    let completed = 0;
    if (step1Status === "success") completed += 25;
    if (step2Status === "success") completed += 25;
    if (step3Status === "success") completed += 25;
    if (step4Status === "success") completed += 25;
    return completed;
  };

  const currentCodex = configData.codex;
  const currentClaude = configData.claude;
  const activeCfg = activeConfigTab === "chatgpt" ? currentCodex : currentClaude;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md transition-all duration-300">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden backdrop-blur-2xl bg-white/95 border-slate-200/90 text-slate-800 dark:bg-[#0f111a]/95 dark:border-white/10 dark:text-gray-100"
          >
            {/* ── 弹窗顶栏 ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0 bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
                    软件启动初始化向导
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                      冷启动自检
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    按顺序校验网络连通性、配置文件定位、核心参数读取与配置确认
                  </p>
                </div>
              </div>
              {/* 右上角进度标识 */}
              <div className="text-right">
                <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                  {calculateOverallProgress()}%
                </span>
                <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-1">
                  完成度
                </span>
              </div>
            </div>

            {/* ── 主体区域 (左侧竖直向下进度条 + 右侧环节详情卡片) ── */}
            <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-12">
              {/* ── 左侧: 竖直向下进度条步进器 ── */}
              <div className="col-span-4 p-5 border-r border-slate-200/80 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.01] flex flex-col justify-between">
                <div className="space-y-6 relative">
                  {/* 竖直导轨背景线 */}
                  <div className="absolute left-[17px] top-4 bottom-4 w-0.5 bg-slate-200 dark:bg-white/10 z-0" />

                  {/* 竖直动态进度高亮填充线 (随着环节完成向下延伸) */}
                  <div
                    className="absolute left-[17px] top-4 w-0.5 bg-gradient-to-b from-blue-500 via-indigo-500 to-emerald-500 z-0 transition-all duration-500"
                    style={{
                      height:
                        step4Status === "success"
                          ? "100%"
                          : step3Status === "success"
                            ? "75%"
                            : step2Status === "success"
                              ? "50%"
                              : step1Status === "success"
                                ? "25%"
                                : "0%",
                    }}
                  />

                  {/* 步骤 1 */}
                  <StepIndicatorNode
                    stepNumber={1}
                    title="网络环境检测"
                    subtitle="验证指定站点连通性"
                    status={step1Status}
                    isActive={currentStep === 1}
                    onClick={() => setCurrentStep(1)}
                  />

                  {/* 步骤 2 */}
                  <StepIndicatorNode
                    stepNumber={2}
                    title="配置文件路径获取"
                    subtitle="自动定位本地配置路径"
                    status={step2Status}
                    isActive={currentStep === 2}
                    onClick={() => {
                      if (step1Status === "success") setCurrentStep(2);
                    }}
                  />

                  {/* 步骤 3 */}
                  <StepIndicatorNode
                    stepNumber={3}
                    title="配置信息读取与展示"
                    subtitle="解析 url、apikey、model"
                    status={step3Status}
                    isActive={currentStep === 3}
                    onClick={() => {
                      if (step2Status === "success") setCurrentStep(3);
                    }}
                  />

                  {/* 步骤 4 */}
                  <StepIndicatorNode
                    stepNumber={4}
                    title="配置信息确认"
                    subtitle="核对并确认是否需修改"
                    status={step4Status}
                    isActive={currentStep === 4}
                    onClick={() => {
                      if (step3Status === "success") setCurrentStep(4);
                    }}
                  />
                </div>

                {/* 左下角小贴士 */}
                <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-800 dark:bg-blue-950/30 dark:border-blue-500/20 dark:text-blue-300 text-[11px] leading-relaxed">
                  <p className="font-semibold flex items-center gap-1.5 mb-0.5">
                    <Sparkles size={12} className="text-blue-500" /> 初始化流程要求
                  </p>
                  各环节严格按先后顺序执行，单点验证失败即终止；待完成全部核对并点击底部确认后完成初始化。
                </div>
              </div>

              {/* ── 右侧: 当前环节详情展示与交互区 ── */}
              <div className="col-span-8 p-6 overflow-y-auto max-h-[580px]">
                {/* 环节 1: 网络环境检测详情 */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        {step1Status === "error" ? (
                          <WifiOff size={16} className="text-red-500" />
                        ) : (
                          <Wifi size={16} className="text-blue-500" />
                        )}
                        环节 1：本机网络连通性精准检测
                      </h3>
                      {step1Status === "running" && (
                        <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                          <Loader2 size={13} className="animate-spin" /> 检测中...
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      通过向官方指定站点发送实际 HTTP 请求，精准检验本机真实网络环境能否正常建立连接。
                    </p>

                    {/* 目标站点卡片 */}
                    <div className="p-4 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-gray-400">
                          检测目标站点：
                        </span>
                        <span className="font-mono font-medium text-slate-800 dark:text-gray-200">
                          https://bob-api.com/
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-gray-400">
                          判定依据：
                        </span>
                        <span className="text-slate-700 dark:text-gray-300">
                          本机网络真实 HTTP GET 状态与响应
                        </span>
                      </div>

                      {networkData && (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 dark:text-gray-400">
                              响应状态码：
                            </span>
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded font-mono font-bold text-[11px]",
                                networkData.status_code === 200
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                  : "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
                              )}
                            >
                              {networkData.status_code
                                ? `${networkData.status_code} OK`
                                : "无响应"}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 dark:text-gray-400">
                              网络请求延时：
                            </span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                              {networkData.latency_ms ?? 0} ms
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* 状态与错误反馈 */}
                    {step1Status === "success" && (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                        <span>网络连通性检测通过！本机能够成功访问指定站点。已自动推进至下一环节。</span>
                      </div>
                    )}

                    {step1Status === "error" && (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold">
                            <XCircle size={15} className="text-red-600" />
                            网络连通性检测未通过，初始化流程已终止
                          </div>
                          <p className="text-[11px] leading-relaxed text-red-700 dark:text-red-400">
                            {networkError}
                          </p>
                        </div>

                        <button
                          onClick={() => void runPipeline(1)}
                          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition shadow-sm"
                        >
                          <RefreshCw size={13} />
                          重新检测网络环境
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 环节 2: 配置文件路径获取详情 */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <FolderCheck size={16} className="text-blue-500" />
                        环节 2：配置文件路径自动识别与定位
                      </h3>
                      {step2Status === "running" && (
                        <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                          <Loader2 size={13} className="animate-spin" /> 定位中...
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      自动识别并准确定位系统环境中当前由 BobAPI Tool 管理的 Agent 配置文件位置。
                    </p>

                    {/* 路径识别列表 */}
                    <div className="space-y-3">
                      {/* Codex 路径卡片 */}
                      <div className="p-3.5 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                            <Bot size={14} className="text-blue-500" />
                            ChatGPT (Codex) 配置文件
                          </span>
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-semibold",
                              configData.codex?.config_exists
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                            )}
                          >
                            {configData.codex?.config_exists ? "已就绪" : "待初始化"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-black/30 border border-slate-200/60 dark:border-white/5">
                          <code className="text-[11px] font-mono text-slate-700 dark:text-gray-300 break-all select-all">
                            {configData.codex?.config_path || "未定位到路径"}
                          </code>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                configData.codex?.config_path || "",
                                "Codex 路径",
                              )
                            }
                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 flex-shrink-0"
                            title="复制路径"
                          >
                            {copiedKey === "Codex 路径" ? (
                              <Check size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Claude 路径卡片 */}
                      <div className="p-3.5 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                            <Sparkles size={14} className="text-purple-500" />
                            Claude Code 配置文件
                          </span>
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-semibold",
                              configData.claude?.config_exists
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                            )}
                          >
                            {configData.claude?.config_exists ? "已就绪" : "待初始化"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-black/30 border border-slate-200/60 dark:border-white/5">
                          <code className="text-[11px] font-mono text-slate-700 dark:text-gray-300 break-all select-all">
                            {configData.claude?.config_path || "未定位到路径"}
                          </code>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                configData.claude?.config_path || "",
                                "Claude 路径",
                              )
                            }
                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 flex-shrink-0"
                            title="复制路径"
                          >
                            {copiedKey === "Claude 路径" ? (
                              <Check size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {step2Status === "success" && (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                        <span>配置文件路径准确定位完成，系统准备读取核心配置。</span>
                      </div>
                    )}

                    {step2Status === "error" && (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold">
                            <XCircle size={15} className="text-red-600" />
                            配置文件路径获取失败，流程已中断
                          </div>
                          <p className="text-[11px] leading-relaxed text-red-700 dark:text-red-400">
                            {pathError}
                          </p>
                        </div>
                        <button
                          onClick={() => void runPipeline(2)}
                          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition shadow-sm"
                        >
                          <RefreshCw size={13} />
                          重新获取配置路径
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 环节 3: 配置信息读取与展示详情 */}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <FileCode size={16} className="text-blue-500" />
                        环节 3：核心配置信息读取与解析展示
                      </h3>
                      {step3Status === "running" && (
                        <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                          <Loader2 size={13} className="animate-spin" /> 解析中...
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      成功解析配置文件内容，以下清晰展示核心三大参数：接口地址 (url)、认证密钥 (apikey) 及默认模型 (model)。
                    </p>

                    {/* 切换展示 ChatGPT 或 Claude */}
                    <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 w-fit">
                      <button
                        onClick={() => {
                          setActiveConfigTab("chatgpt");
                          setEditTab("chatgpt");
                        }}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition",
                          activeConfigTab === "chatgpt"
                            ? "bg-white text-blue-600 shadow-sm dark:bg-blue-500/20 dark:text-blue-300 font-bold"
                            : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white",
                        )}
                      >
                        <Bot size={13} />
                        ChatGPT (Codex)
                      </button>
                      <button
                        onClick={() => {
                          setActiveConfigTab("claude");
                          setEditTab("claude");
                        }}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition",
                          activeConfigTab === "claude"
                            ? "bg-white text-purple-600 shadow-sm dark:bg-purple-500/20 dark:text-purple-300 font-bold"
                            : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white",
                        )}
                      >
                        <Sparkles size={13} />
                        Claude Code
                      </button>
                    </div>

                    {/* 核心配置展示卡片 (url, apikey, model) */}
                    <div className="p-4 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-3.5">
                      {/* 1. URL */}
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-500 dark:text-gray-400 flex items-center gap-1.5 w-24 flex-shrink-0">
                          <Globe size={13} className="text-blue-500" />
                          接口地址 (url):
                        </span>
                        <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-slate-200/80 dark:border-white/10 font-mono text-[11px]">
                          <span className="truncate">
                            {activeCfg?.base_url || "未配置 (默认: https://bob-api.com/)"}
                          </span>
                          <button
                            onClick={() =>
                              copyToClipboard(activeCfg?.base_url || "", "接口 URL")
                            }
                            className="ml-2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                            title="复制"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>

                      {/* 2. API Key */}
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-500 dark:text-gray-400 flex items-center gap-1.5 w-24 flex-shrink-0">
                          <Key size={13} className="text-amber-500" />
                          认证密钥 (apikey):
                        </span>
                        <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-slate-200/80 dark:border-white/10 font-mono text-[11px]">
                          <span className="truncate">
                            {activeCfg?.api_key
                              ? activeConfigTab === "chatgpt"
                                ? showCodexKey
                                  ? activeCfg.api_key
                                  : `${activeCfg.api_key.slice(0, 6)}••••••••••••${activeCfg.api_key.slice(-4)}`
                                : showClaudeKey
                                  ? activeCfg.api_key
                                  : `${activeCfg.api_key.slice(0, 6)}••••••••••••${activeCfg.api_key.slice(-4)}`
                              : "未配置密钥 (空)"}
                          </span>
                          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                            <button
                              onClick={() => {
                                if (activeConfigTab === "chatgpt") {
                                  setShowCodexKey(!showCodexKey);
                                } else {
                                  setShowClaudeKey(!showClaudeKey);
                                }
                              }}
                              className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                              title="切换可见性"
                            >
                              {(activeConfigTab === "chatgpt" ? showCodexKey : showClaudeKey) ? (
                                <EyeOff size={13} />
                              ) : (
                                <Eye size={13} />
                              )}
                            </button>
                            <button
                              onClick={() =>
                                copyToClipboard(activeCfg?.api_key || "", "API Key")
                              }
                              className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                              title="复制"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* 3. Model */}
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-500 dark:text-gray-400 flex items-center gap-1.5 w-24 flex-shrink-0">
                          <Cpu size={13} className="text-purple-500" />
                          核心模型 (model):
                        </span>
                        <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-slate-200/80 dark:border-white/10 font-mono text-[11px]">
                          <span className="font-semibold text-purple-700 dark:text-purple-300">
                            {activeCfg?.model || "默认预设"}
                          </span>
                          <button
                            onClick={() =>
                              copyToClipboard(activeCfg?.model || "", "模型名称")
                            }
                            className="ml-2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                            title="复制"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {step3Status === "success" && (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                          <span>三大核心参数（url、apikey、model）已成功读取并呈现。</span>
                        </div>
                        <button
                          onClick={() => setCurrentStep(4)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white font-medium text-[11px] hover:bg-emerald-700 transition"
                        >
                          前往确认环节
                          <ArrowRight size={11} />
                        </button>
                      </div>
                    )}

                    {step3Status === "error" && (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold">
                            <XCircle size={15} className="text-red-600" />
                            配置读取解析中断
                          </div>
                          <p className="text-[11px] leading-relaxed text-red-700 dark:text-red-400">
                            {parseError}
                          </p>
                        </div>
                        <button
                          onClick={() => void runPipeline(3)}
                          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition shadow-sm"
                        >
                          <RefreshCw size={13} />
                          重试解析配置
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 环节 4: 配置信息确认环节详情 */}
                {currentStep === 4 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <ShieldCheck size={16} className="text-blue-500" />
                        环节 4：配置信息检查与操作确认对话框
                      </h3>
                      {step4Status === "success" && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 text-[11px] font-bold">
                          <CheckCircle2 size={12} /> 已确认
                        </span>
                      )}
                    </div>

                    <div className="p-4 rounded-xl border border-blue-200/80 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-500/30 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <AlertCircle size={18} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                            请检查并确认已展示的配置参数
                          </h4>
                          <p className="text-[11px] text-slate-600 dark:text-gray-300 mt-1">
                            系统已完成当前运行环境核心参数（url、apikey、model）的抓取。请核实上述配置是否符合您的使用需求，并从下方操作选项中做出选择：
                          </p>
                        </div>
                      </div>

                      {/* 核心操作选项 */}
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <button
                          onClick={handleConfirmNoChange}
                          className={cn(
                            "p-3 rounded-xl border text-left transition relative flex flex-col justify-between",
                            confirmationDecision === "confirmed"
                              ? "bg-emerald-50/90 border-emerald-400 text-emerald-900 dark:bg-emerald-500/20 dark:border-emerald-500 dark:text-emerald-200 shadow-sm"
                              : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-blue-400 dark:hover:border-blue-500",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold flex items-center gap-1.5">
                              <CheckCircle2 size={14} className="text-emerald-500" />
                              选项 A：配置无误
                            </span>
                            {confirmationDecision === "confirmed" && (
                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">
                            无需修改，以当前已读取的配置继续运行并完成初始化。
                          </p>
                        </button>

                        <button
                          onClick={() => {
                            setConfirmationDecision("editing");
                            handleSwitchEditTab(editTab);
                          }}
                          className={cn(
                            "p-3 rounded-xl border text-left transition relative flex flex-col justify-between",
                            confirmationDecision === "editing"
                              ? "bg-blue-50/90 border-blue-400 text-blue-900 dark:bg-blue-500/20 dark:border-blue-500 dark:text-blue-200 shadow-sm"
                              : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-blue-400 dark:hover:border-blue-500",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold flex items-center gap-1.5">
                              <Edit3 size={14} className="text-blue-500" />
                              选项 B：需要修改配置
                            </span>
                            {confirmationDecision === "editing" && (
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">
                            立即在此对话框中对 url、apikey 或 model 进行快速修改并保存。
                          </p>
                        </button>
                      </div>
                    </div>

                    {/* 快速修改表单 (当用户选择选项 B 时展开) */}
                    {confirmationDecision === "editing" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800 dark:text-gray-200">
                            正在修改配置：
                          </span>
                          <div className="flex p-0.5 rounded-lg bg-slate-200 dark:bg-black/30 text-[11px]">
                            <button
                              onClick={() => handleSwitchEditTab("chatgpt")}
                              className={cn(
                                "px-2.5 py-1 rounded font-medium transition",
                                editTab === "chatgpt"
                                  ? "bg-white text-blue-600 shadow-xs dark:bg-blue-600 dark:text-white"
                                  : "text-slate-600 dark:text-gray-400",
                              )}
                            >
                              ChatGPT
                            </button>
                            <button
                              onClick={() => handleSwitchEditTab("claude")}
                              className={cn(
                                "px-2.5 py-1 rounded font-medium transition",
                                editTab === "claude"
                                  ? "bg-white text-purple-600 shadow-xs dark:bg-purple-600 dark:text-white"
                                  : "text-slate-600 dark:text-gray-400",
                              )}
                            >
                              Claude Code
                            </button>
                          </div>
                        </div>

                        {/* URL 输入 */}
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                            接口地址 (URL)
                          </label>
                          <input
                            type="text"
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border text-xs font-mono bg-white dark:bg-black/40 border-slate-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="https://bob-api.com/"
                          />
                        </div>

                        {/* API Key 输入 */}
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                            认证密钥 (API Key)
                          </label>
                          <input
                            type="password"
                            value={editApiKey}
                            onChange={(e) => setEditApiKey(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border text-xs font-mono bg-white dark:bg-black/40 border-slate-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="sk-..."
                          />
                        </div>

                        {/* Model 输入 */}
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">
                            核心模型 (Model)
                          </label>
                          <input
                            type="text"
                            value={editModel}
                            onChange={(e) => setEditModel(e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border text-xs font-mono bg-white dark:bg-black/40 border-slate-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder={
                              editTab === "chatgpt"
                                ? "gpt-4o / gpt-5.6-sol"
                                : "claude-3-7-sonnet-20250219"
                            }
                          />
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            onClick={() => void handleSaveEdit()}
                            disabled={savingEdit}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 shadow-sm"
                          >
                            {savingEdit ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Save size={13} />
                            )}
                            保存修改并确认生效
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── 弹窗底部操作确认栏 ── */}
            <div className="px-6 py-4 border-t border-slate-200/80 dark:border-white/10 flex items-center justify-between flex-shrink-0 bg-slate-50/60 dark:bg-white/[0.01]">
              {/* 左侧状态文案提示 */}
              <div className="text-xs text-slate-500 dark:text-gray-400">
                {step4Status === "success" ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                    <CheckCircle2 size={14} /> 所有初始化环节检验通过，可点击右侧按钮进入主界面
                  </span>
                ) : step1Status === "error" || step2Status === "error" || step3Status === "error" ? (
                  <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5">
                    <AlertCircle size={14} /> 初始化异常中断，请解决当前环节错误后重试
                  </span>
                ) : (
                  <span>初始化进行中：当前正在执行第 {currentStep} 环节...</span>
                )}
              </div>

              {/* 右侧主操作按钮 */}
              <div className="flex items-center gap-3">
                {(step1Status === "error" ||
                  step2Status === "error" ||
                  step3Status === "error") && (
                  <button
                    onClick={() => void exit(0)}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 dark:border-red-500/20 dark:text-red-400 dark:bg-red-500/10 dark:hover:bg-red-500/20 transition cursor-pointer"
                    title="终止初始化并退出程序"
                  >
                    <Power size={13} />
                    退出软件
                  </button>
                )}

                <button
                  onClick={handleCompleteInitialization}
                  disabled={step4Status !== "success"}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md",
                    step4Status === "success"
                      ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white shadow-blue-500/20 hover:shadow-emerald-500/20 cursor-pointer"
                      : "bg-slate-200 text-slate-400 dark:bg-white/10 dark:text-gray-500 cursor-not-allowed",
                  )}
                >
                  <CheckCircle2 size={15} />
                  完成初始化并进入软件
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ── 竖直进度条单节点展示组件 ──
function StepIndicatorNode({
  stepNumber,
  title,
  subtitle,
  status,
  isActive,
  onClick,
}: {
  stepNumber: number;
  title: string;
  subtitle: string;
  status: StepStatus;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 relative z-10 cursor-pointer group transition-all",
        isActive ? "opacity-100" : "opacity-80 hover:opacity-100",
      )}
    >
      {/* 节点圆形徽标 */}
      <div
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all duration-300 shadow-sm",
          status === "success" &&
            "bg-emerald-500 text-white ring-4 ring-emerald-500/20",
          status === "running" &&
            "bg-blue-600 text-white ring-4 ring-blue-500/25 animate-pulse",
          status === "error" &&
            "bg-red-500 text-white ring-4 ring-red-500/20",
          status === "pending" &&
            "bg-white border-2 border-slate-300 text-slate-500 dark:bg-[#161926] dark:border-white/20 dark:text-gray-400",
        )}
      >
        {status === "success" ? (
          <CheckCircle2 size={16} />
        ) : status === "running" ? (
          <Loader2 size={15} className="animate-spin" />
        ) : status === "error" ? (
          <XCircle size={16} />
        ) : (
          <span>{stepNumber}</span>
        )}
      </div>

      {/* 节点文案 */}
      <div className="flex flex-col pt-0.5">
        <span
          className={cn(
            "text-xs font-bold transition-colors leading-tight",
            isActive
              ? "text-blue-600 dark:text-blue-400"
              : status === "success"
                ? "text-slate-800 dark:text-gray-200"
                : "text-slate-600 dark:text-gray-400",
          )}
        >
          {title}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
          {subtitle}
        </span>
      </div>
    </div>
  );
}

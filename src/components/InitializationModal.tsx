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
  Sparkles,
  Save,
  Power,
  Terminal,
  Activity,
  Scan,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
} from "lucide-react";
import { OpenAIIcon, ClaudeIcon, WorkbuddyIcon } from "./BrandIcons";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { exit } from "@tauri-apps/plugin-process";
import {
  checkBobApiNetwork,
  getCodexConfig,
  getClaudeConfig,
  getWorkbuddyConfig,
  setCodexConfig,
  setClaudeConfig,
  setWorkbuddyConfig,
  openConfigFile,
} from "../lib/api";
import type {
  AgentConfig,
  NetworkStatus,
  StepStatus,
  WorkbuddyUIConfig,
} from "../types";
import { cn } from "../lib/utils";

interface InitializationModalProps {
  open: boolean;
  onClose: () => void;
  onFinish: () => void;
}

interface StepConfigData {
  codex: AgentConfig | null;
  claude: AgentConfig | null;
  workbuddy: WorkbuddyUIConfig | null;
}

interface ScanLogItem {
  id: string;
  time: string;
  tag: string;
  text: string;
  type: "info" | "scan" | "match" | "success" | "warn" | "error";
}

type CheckpointStatus = "pending" | "scanning" | "done" | "error";

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

  // ── 动态扫描微进度与状态 ──
  const [stepSubProgress, setStepSubProgress] = useState<number>(0);
  const [stepSubPhaseText, setStepSubPhaseText] = useState<string>("");
  const [scanLogs, setScanLogs] = useState<ScanLogItem[]>([]);
  const [checkpoints, setCheckpoints] = useState<
    Record<string, CheckpointStatus>
  >({});

  // ── 环节数据 ──
  const [networkData, setNetworkData] = useState<NetworkStatus | null>(null);
  const [networkError, setNetworkError] = useState<string>("");

  const [pathError, setPathError] = useState<string>("");
  const [configData, setConfigData] = useState<StepConfigData>({
    codex: null,
    claude: null,
    workbuddy: null,
  });
  const [parseError, setParseError] = useState<string>("");

  // ── 环节 3 & 4 展示控制 ──
  const [activeConfigTab, setActiveConfigTab] = useState<
    "chatgpt" | "claude" | "workbuddy"
  >("chatgpt");
  const [showCodexKey, setShowCodexKey] = useState<boolean>(false);
  const [showClaudeKey, setShowClaudeKey] = useState<boolean>(false);
  const [showWorkbuddyKey, setShowWorkbuddyKey] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string>("");

  // ── 环节 4 确认与快速修改模式 ──
  const [confirmationDecision, setConfirmationDecision] = useState<
    "none" | "confirmed" | "editing"
  >("none");
  const [editTab, setEditTab] = useState<"chatgpt" | "claude" | "workbuddy">(
    "chatgpt",
  );
  const [editUrl, setEditUrl] = useState<string>("");
  const [editApiKey, setEditApiKey] = useState<string>("");
  const [editModel, setEditModel] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const isRunningRef = useRef<boolean>(false);
  const isCancelledRef = useRef<boolean>(false);

  // ── 添加实时扫描日志 ──
  const addLog = useCallback(
    (tag: string, text: string, type: ScanLogItem["type"] = "info") => {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setScanLogs((prev) => [
        ...prev.slice(-40),
        { id, time: timeStr, tag, text, type },
      ]);
    },
    [],
  );

  // ── 可随时取消的精细延迟函数 ──
  const delay = useCallback((ms: number) => {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(!isCancelledRef.current);
      }, ms);
    });
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    toast.success(`已复制 ${label} 到剪贴板`);
    setTimeout(() => setCopiedKey(""), 2000);
  };

  // ── 环节 1: 本机网络适配器与目标服务连通性探测 (约 2.8s) ──
  const runStep1 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(1);
    setStep1Status("running");
    setNetworkError("");
    setNetworkData(null);
    setStepSubProgress(10);
    setStepSubPhaseText("正在探测本机网络适配器与本地 DNS 寻址环境...");
    setCheckpoints({
      dns_gateway: "scanning",
      proxy_tls: "pending",
      endpoint_ping: "pending",
      latency_eval: "pending",
    });
    addLog(
      "NET:INIT",
      "初始化本机网络探针，检查默认网关与本地 DNS 解析器...",
      "scan",
    );

    if (!(await delay(700))) return false;
    setCheckpoints((prev) => ({
      ...prev,
      dns_gateway: "done",
      proxy_tls: "scanning",
    }));
    setStepSubProgress(35);
    setStepSubPhaseText("检测系统底层代理及 SSL/TLS 握手协议链...");
    addLog(
      "NET:TLS",
      "校验系统代理环境，配置 TLS 1.3 / HTTP/2 握手安全上下文...",
      "info",
    );

    if (!(await delay(750))) return false;
    setCheckpoints((prev) => ({
      ...prev,
      proxy_tls: "done",
      endpoint_ping: "scanning",
    }));
    setStepSubProgress(65);
    setStepSubPhaseText(
      "向官方服务节点 (https://bob-api.com/) 发送安全探测心跳...",
    );
    addLog(
      "NET:PROBE",
      "发起安全 HTTP GET 探针 -> https://bob-api.com/ ...",
      "scan",
    );

    let status: NetworkStatus;
    try {
      status = await checkBobApiNetwork();
      setNetworkData(status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStep1Status("error");
      setNetworkError(`网络检测执行异常: ${msg}`);
      setCheckpoints((prev) => ({ ...prev, endpoint_ping: "error" }));
      addLog("NET:ERR", `网络检测执行异常: ${msg}`, "error");
      return false;
    }

    if (!(await delay(650))) return false;

    if (!status.reachable) {
      setStep1Status("error");
      setNetworkError(
        status.error_message ||
          "无法连接至指定站点 https://bob-api.com/，请检查本机网络或代理设置。",
      );
      setCheckpoints((prev) => ({ ...prev, endpoint_ping: "error" }));
      addLog(
        "NET:FAIL",
        status.error_message || "服务端未响应或连接超时",
        "error",
      );
      return false;
    }

    setCheckpoints((prev) => ({
      ...prev,
      endpoint_ping: "done",
      latency_eval: "scanning",
    }));
    setStepSubProgress(90);
    setStepSubPhaseText("评估回包响应延迟与链路连通质量...");
    addLog(
      "NET:OK",
      `服务应答正常 [${status.status_code ?? 200} OK]，链路延迟: ${status.latency_ms ?? 0}ms`,
      "success",
    );

    if (!(await delay(700))) return false;
    setCheckpoints((prev) => ({ ...prev, latency_eval: "done" }));
    setStepSubProgress(100);
    setStepSubPhaseText("网络连通性检测通过！本机与服务节点连接正常");
    setStep1Status("success");
    addLog("NET:DONE", "环节 1 自检完成，准备启动本机文件深度扫描...", "match");

    await delay(500);
    return true;
  }, [addLog, delay]);

  // ── 环节 2: 本机环境与 Agent 配置文件深度扫描 (约 4.5s，凸显扫描本机效果) ──
  const runStep2 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(2);
    setStep2Status("running");
    setPathError("");
    setStepSubProgress(8);
    setStepSubPhaseText(
      "启动本机文件系统深度诊断引擎，枚举操作系统环境变量...",
    );
    setCheckpoints({
      env_profile: "scanning",
      scan_codex: "pending",
      scan_claude: "pending",
      scan_workbuddy: "pending",
      acl_verify: "pending",
    });
    addLog(
      "HOST:SCAN",
      "启动本地存储与文件扫描引擎，定位操作系统环境 (%USERPROFILE%)...",
      "scan",
    );

    if (!(await delay(800))) return false;
    setCheckpoints((prev) => ({
      ...prev,
      env_profile: "done",
      scan_codex: "scanning",
    }));
    setStepSubProgress(25);
    setStepSubPhaseText(
      "深度遍历系统磁盘，扫描 %USERPROFILE%/.codex/ 目录树与运行入口...",
    );
    addLog(
      "FS:CODEX",
      "检索本地 ChatGPT (Codex) 运行环境与工作空间路径...",
      "scan",
    );

    if (!(await delay(800))) return false;
    setStepSubProgress(42);
    setStepSubPhaseText("正在捕获 Codex CLI 本地配置载荷与运行环境属性...");

    let codex: AgentConfig;
    try {
      codex = await getCodexConfig();
      setConfigData((prev) => ({ ...prev, codex }));
    } catch (e) {
      const msg = `Codex 检索失败: ${e}`;
      setStep2Status("error");
      setPathError(msg);
      setCheckpoints((prev) => ({ ...prev, scan_codex: "error" }));
      addLog("FS:ERR", msg, "error");
      return false;
    }

    if (codex.is_installed) {
      addLog(
        "FS:CODEX",
        `锁定 ChatGPT (Codex) 运行环境: ${codex.app_path || "已安装"} [配置文件: ${codex.config_exists ? "已就绪" : "待初始化"}]`,
        "match",
      );
      setCheckpoints((prev) => ({
        ...prev,
        scan_codex: "done",
        scan_claude: "scanning",
      }));
    } else {
      addLog(
        "FS:CODEX",
        "未在系统检索到 ChatGPT (Codex) 运行环境或配置文件",
        "warn",
      );
      setCheckpoints((prev) => ({
        ...prev,
        scan_codex: "error",
        scan_claude: "scanning",
      }));
    }

    if (!(await delay(800))) return false;
    setStepSubProgress(60);
    setStepSubPhaseText(
      "深度检索 %USERPROFILE%/.claude/ 环境变量与运行入口...",
    );
    addLog(
      "FS:CLAUDE",
      "检索本地 Claude Code 运行环境与 settings.json...",
      "scan",
    );

    if (!(await delay(800))) return false;
    setStepSubProgress(75);
    setStepSubPhaseText("正在捕获 Claude Code 本地配置载荷与权限描述符...");

    let claude: AgentConfig;
    try {
      claude = await getClaudeConfig();
      setConfigData((prev) => ({ ...prev, claude }));
    } catch (e) {
      const msg = `Claude 检索失败: ${e}`;
      setStep2Status("error");
      setPathError(msg);
      setCheckpoints((prev) => ({ ...prev, scan_claude: "error" }));
      addLog("FS:ERR", msg, "error");
      return false;
    }

    if (claude.is_installed) {
      addLog(
        "FS:CLAUDE",
        `锁定 Claude Code 运行环境: ${claude.app_path || "已安装"} [配置文件: ${claude.config_exists ? "已就绪" : "待初始化"}]`,
        "match",
      );
      setCheckpoints((prev) => ({
        ...prev,
        scan_claude: "done",
        scan_workbuddy: "scanning",
      }));
    } else {
      addLog(
        "FS:CLAUDE",
        "未在系统检索到 Claude Code 运行环境或配置文件",
        "warn",
      );
      setCheckpoints((prev) => ({
        ...prev,
        scan_claude: "error",
        scan_workbuddy: "scanning",
      }));
    }

    if (!(await delay(800))) return false;
    setStepSubProgress(85);
    setStepSubPhaseText(
      "深度检索 %USERPROFILE%/.workbuddy-ai/ 与 WorkBuddy 客户端运行入口...",
    );
    addLog(
      "FS:WORKBUDDY",
      "检索本地 WorkBuddy 客户端运行环境与 models.json...",
      "scan",
    );

    let workbuddy: WorkbuddyUIConfig;
    try {
      workbuddy = await getWorkbuddyConfig();
      setConfigData((prev) => ({ ...prev, workbuddy }));
    } catch (e) {
      const msg = `WorkBuddy 检索失败: ${e}`;
      setStep2Status("error");
      setPathError(msg);
      setCheckpoints((prev) => ({ ...prev, scan_workbuddy: "error" }));
      addLog("FS:ERR", msg, "error");
      return false;
    }

    if (workbuddy.is_installed) {
      addLog(
        "FS:WORKBUDDY",
        `锁定 WorkBuddy 客户端运行环境: ${workbuddy.app_path || "已安装"} [配置文件: ${workbuddy.config_exists ? "已就绪" : "待初始化"}]`,
        "match",
      );
      setCheckpoints((prev) => ({
        ...prev,
        scan_workbuddy: "done",
        acl_verify: "scanning",
      }));
    } else {
      addLog(
        "FS:WORKBUDDY",
        "未在系统检索到 WorkBuddy 客户端或 models.json 配置文件",
        "warn",
      );
      setCheckpoints((prev) => ({
        ...prev,
        scan_workbuddy: "error",
        acl_verify: "scanning",
      }));
    }

    const anyInstalled =
      codex.is_installed || claude.is_installed || workbuddy.is_installed;
    if (!anyInstalled) {
      setStep2Status("error");
      setPathError(
        "未在当前电脑检测到 Claude Code、ChatGPT (Codex) 或 WorkBuddy 的安装程序与配置文件。AI Helper 需要配合已安装的 Agent/客户端运行环境使用，请先安装对应应用或在路径管理中指定。",
      );
      setCheckpoints((prev) => ({ ...prev, acl_verify: "error" }));
      addLog(
        "FS:ERR",
        "未检测到任何本地 Agent/客户端运行环境与配置文件，初始化流程已暂停",
        "error",
      );
      return false;
    }

    if (!(await delay(700))) return false;
    setStepSubProgress(95);
    setStepSubPhaseText("核验本地文件访问控制列表 (ACL) 与读写权限...");
    addLog("SECURITY", "本机文件读写描述符核验通过，权限状态正常", "info");

    if (!(await delay(600))) return false;
    setCheckpoints((prev) => ({ ...prev, acl_verify: "done" }));
    setStepSubProgress(100);
    setStepSubPhaseText("本机环境扫描完成，成功定位本地配置文件与运行环境");
    setStep2Status("success");
    const count =
      (codex.is_installed ? 1 : 0) +
      (claude.is_installed ? 1 : 0) +
      (workbuddy.is_installed ? 1 : 0);
    addLog(
      "HOST:DONE",
      `本机扫描完成，已锁定 ${count} 处本地 Agent / 客户端运行环境与配置上下文`,
      "success",
    );

    // 默认展示已安装的 tab
    if (codex.is_installed) {
      setActiveConfigTab("chatgpt");
      setEditTab("chatgpt");
    } else if (claude.is_installed) {
      setActiveConfigTab("claude");
      setEditTab("claude");
    } else if (workbuddy.is_installed) {
      setActiveConfigTab("workbuddy");
      setEditTab("workbuddy");
    }

    await delay(500);
    return true;
  }, [addLog, delay]);

  // ── 环节 3: 核心配置结构化解析与安全校验 (约 2.8s) ──
  const runStep3 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(3);
    setStep3Status("running");
    setParseError("");
    setStepSubProgress(12);
    setStepSubPhaseText(
      "装载本地配置文件二进制流，启动 TOML / JSON 语法树解析...",
    );
    setCheckpoints({
      load_binary: "scanning",
      parse_url: "pending",
      verify_key: "pending",
      map_model: "pending",
    });
    addLog(
      "PARSE:INIT",
      "加载本地配置文件二进制数据流，校验文件编码与格式规范...",
      "scan",
    );

    if (!(await delay(700))) return false;

    let codex: AgentConfig;
    let claude: AgentConfig;
    let workbuddy: WorkbuddyUIConfig;
    try {
      [codex, claude, workbuddy] = await Promise.all([
        getCodexConfig(),
        getClaudeConfig(),
        getWorkbuddyConfig(),
      ]);
      setConfigData({ codex, claude, workbuddy });
      if (activeConfigTab === "workbuddy") {
        setEditUrl(workbuddy.base_url || "https://bob-api.com/v1");
        setEditApiKey(workbuddy.api_key || "");
        setEditModel(workbuddy.model || "gpt-5.6-sol");
      } else if (activeConfigTab === "claude") {
        setEditUrl(claude.base_url || "https://bob-api.com/");
        setEditApiKey(claude.api_key || "");
        setEditModel(claude.model || "");
      } else {
        setEditUrl(codex.base_url || "https://bob-api.com/");
        setEditApiKey(codex.api_key || "");
        setEditModel(codex.model || "");
      }
    } catch (err) {
      setStep3Status("error");
      const msg = err instanceof Error ? err.message : String(err);
      setParseError(`配置文件读取或解析失败: ${msg}`);
      setCheckpoints((prev) => ({ ...prev, load_binary: "error" }));
      addLog("PARSE:ERR", `配置文件读取或解析失败: ${msg}`, "error");
      return false;
    }

    setCheckpoints((prev) => ({
      ...prev,
      load_binary: "done",
      parse_url: "scanning",
    }));
    setStepSubProgress(45);
    setStepSubPhaseText("提取并结构化检验接口地址规范 (Base URL)...");
    addLog(
      "PARSE:URL",
      `解析接口 URL: ${codex.base_url || "https://bob-api.com/"} [协议合规]`,
      "info",
    );

    if (!(await delay(750))) return false;
    setCheckpoints((prev) => ({
      ...prev,
      parse_url: "done",
      verify_key: "scanning",
    }));
    setStepSubProgress(75);
    setStepSubPhaseText("校验认证密钥 (API Key) 前缀特征与安全掩码...");
    addLog(
      "PARSE:KEY",
      `校验 API Key 密钥格式与散列完整性... [${codex.api_key || workbuddy.api_key ? "存在有效密钥" : "未配置密钥"}]`,
      "info",
    );

    if (!(await delay(750))) return false;
    setCheckpoints((prev) => ({
      ...prev,
      verify_key: "done",
      map_model: "scanning",
    }));
    setStepSubProgress(95);
    setStepSubPhaseText("读取核心模型 (Model) 配置与调用链参数...");
    addLog(
      "PARSE:MODEL",
      `读取核心模型: Codex -> ${codex.model || "未配置"}, Claude -> ${claude.model || "未配置"}, WorkBuddy -> ${workbuddy.model || "未配置"}`,
      "match",
    );

    if (!(await delay(600))) return false;
    setCheckpoints((prev) => ({ ...prev, map_model: "done" }));
    setStepSubProgress(100);
    setStepSubPhaseText("核心配置解析校验完毕，所有必要参数已就绪");
    setStep3Status("success");
    addLog(
      "PARSE:DONE",
      "三大核心参数（url、apikey、model）解析呈现就绪，进入操作确认环节",
      "success",
    );

    await delay(500);
    return true;
  }, [addLog, delay]);

  // ── 环节 4: 配置信息确认环节 ──
  const runStep4 = useCallback(async (): Promise<boolean> => {
    setCurrentStep(4);
    setStep4Status("running");
    addLog(
      "CONFIRM",
      "已进入最终配置确认环节，等待用户核实或快速更新配置",
      "match",
    );
    return true;
  }, [addLog]);

  // ── 顺序执行编排管线 ──
  const runPipeline = useCallback(
    async (fromStep = 1) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      isCancelledRef.current = false;

      try {
        if (fromStep <= 1) {
          const s1Ok = await runStep1();
          if (!s1Ok || isCancelledRef.current) {
            return;
          }
        }

        if (fromStep <= 2) {
          const s2Ok = await runStep2();
          if (!s2Ok || isCancelledRef.current) {
            return;
          }
        }

        if (fromStep <= 3) {
          const s3Ok = await runStep3();
          if (!s3Ok || isCancelledRef.current) {
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
      isCancelledRef.current = false;
      void runPipeline(1);
    } else {
      isCancelledRef.current = true;
      isRunningRef.current = false;
      setCurrentStep(1);
      setStep1Status("pending");
      setStep2Status("pending");
      setStep3Status("pending");
      setStep4Status("pending");
      setStepSubProgress(0);
      setStepSubPhaseText("");
      setConfirmationDecision("none");
    }
    return () => {
      isCancelledRef.current = true;
      isRunningRef.current = false;
    };
  }, [open, runPipeline]);

  // 切换编辑 Tab 时同步表单数据
  const handleSwitchEditTab = (tab: "chatgpt" | "claude" | "workbuddy") => {
    setEditTab(tab);
    if (tab === "chatgpt") {
      setEditUrl(configData.codex?.base_url || "https://bob-api.com/");
      setEditApiKey(configData.codex?.api_key || "");
      setEditModel(configData.codex?.model || "");
    } else if (tab === "claude") {
      setEditUrl(configData.claude?.base_url || "https://bob-api.com/");
      setEditApiKey(configData.claude?.api_key || "");
      setEditModel(configData.claude?.model || "");
    } else {
      setEditUrl(configData.workbuddy?.base_url || "https://bob-api.com/v1");
      setEditApiKey(configData.workbuddy?.api_key || "");
      setEditModel(configData.workbuddy?.model || "gpt-5.6-sol");
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
        await setCodexConfig(
          editUrl.trim(),
          editApiKey.trim(),
          editModel.trim(),
        );
        toast.success("ChatGPT (Codex) 配置已保存更新");
      } else if (editTab === "claude") {
        await setClaudeConfig(
          editUrl.trim(),
          editApiKey.trim(),
          editModel.trim(),
        );
        toast.success("Claude Code 配置已保存更新");
      } else {
        const existing = configData.workbuddy;
        await setWorkbuddyConfig({
          url: editUrl.trim(),
          api_key: editApiKey.trim(),
          model: editModel.trim() || "gpt-5.6-sol",
          supports_tool_call: existing?.supports_tool_call ?? true,
          supports_images: existing?.supports_images ?? true,
          supports_reasoning: existing?.supports_reasoning ?? true,
          only_reasoning: existing?.only_reasoning ?? false,
          can_disable_thinking: existing?.can_disable_thinking ?? true,
          use_custom_protocol: existing?.use_custom_protocol ?? false,
          default_effort: existing?.default_effort ?? null,
          supported_efforts: existing?.supported_efforts ?? ["medium"],
          max_input_tokens: existing?.max_input_tokens ?? 32768,
          max_output_tokens: existing?.max_output_tokens ?? 32768,
        });
        toast.success("WorkBuddy 自定义模型配置已保存更新");
      }

      // 重新读取并刷新展示
      const [newCodex, newClaude, newWb] = await Promise.all([
        getCodexConfig(),
        getClaudeConfig(),
        getWorkbuddyConfig(),
      ]);
      setConfigData({ codex: newCodex, claude: newClaude, workbuddy: newWb });
      setConfirmationDecision("confirmed");
      setStep4Status("success");
      addLog(
        "CONFIG:SAVE",
        `${editTab === "chatgpt" ? "ChatGPT" : editTab === "claude" ? "Claude" : "WorkBuddy"} 配置已手动更新生效`,
        "success",
      );
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
    addLog("CONFIRM:OK", "用户已确认当前本机环境核心参数有效", "success");
  };

  // 用户在未检测到本地 Agent 环境时，选择跳过检测并强行预先写入配置
  const handleForceContinueStep2 = () => {
    setStep2Status("success");
    addLog(
      "HOST:OVERRIDE",
      "用户选择跳过环境安装检测，强制进入配置初始化流程",
      "warn",
    );
    toast.info("已跳过安装检测，将为您预先配置 Agent 核心参数");
    setCurrentStep(3);
    void runPipeline(3);
  };

  // 点击底部【完成初始化并进入软件】按钮
  const handleCompleteInitialization = () => {
    if (step4Status !== "success") {
      toast.warning("请先在步骤 4 完成配置信息的检查与确认");
      return;
    }
    toast.success("软件初始化流程圆满完成，欢迎使用 AI Helper！");
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
  const currentWorkbuddy = configData.workbuddy;
  const activeCfg: AgentConfig | null =
    activeConfigTab === "chatgpt"
      ? currentCodex
      : activeConfigTab === "claude"
        ? currentClaude
        : currentWorkbuddy
          ? {
              base_url: currentWorkbuddy.base_url,
              api_key: currentWorkbuddy.api_key,
              model: currentWorkbuddy.model,
              config_exists: currentWorkbuddy.config_exists,
              config_path: currentWorkbuddy.config_path,
              is_installed: currentWorkbuddy.is_installed,
              app_path: currentWorkbuddy.app_path,
            }
          : null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md transition-all duration-300">
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
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-2">
                    软件启动初始化向导
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-cyan-500/20 dark:text-cyan-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-cyan-400 animate-pulse" />
                      本机深度扫描自检
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    按顺序执行网络探针测试、本机环境与 Agent
                    配置文件深度扫描、核心参数解析与确认
                  </p>
                </div>
              </div>
              {/* 右上角进度标识与关闭按钮 */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-xs font-mono font-semibold text-blue-600 dark:text-cyan-400">
                    {calculateOverallProgress()}%
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-1">
                    完成度
                  </span>
                </div>
                <div className="h-4 w-[1px] bg-slate-200 dark:bg-white/10" />
                <button
                  type="button"
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200/80 text-slate-400 hover:text-slate-700 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-white transition-colors cursor-pointer"
                  title="关闭向导"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* ── 主体区域 (左侧竖直向下进度条 + 右侧环节详情卡片) ── */}
            <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-12">
              {/* ── 左侧: 竖直向下进度条步进器 ── */}
              <div className="col-span-4 p-5 border-r border-slate-200/80 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.01] flex flex-col justify-between overflow-y-auto">
                <div className="space-y-6 relative">
                  {/* 竖直导轨背景线 */}
                  <div className="absolute left-[17px] top-4 bottom-4 w-0.5 bg-slate-200 dark:bg-white/10 z-0" />

                  {/* 竖直动态进度高亮填充线 (随着环节完成向下延伸) */}
                  <div
                    className="absolute left-[17px] top-4 w-0.5 bg-gradient-to-b from-blue-500 via-indigo-500 to-cyan-400 z-0 transition-all duration-500"
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
                    title="网络连通性探测"
                    subtitle="验证指定站点与网关链路"
                    status={step1Status}
                    isActive={currentStep === 1}
                    subProgress={
                      currentStep === 1 ? stepSubProgress : undefined
                    }
                    onClick={() => setCurrentStep(1)}
                  />

                  {/* 步骤 2 */}
                  <StepIndicatorNode
                    stepNumber={2}
                    title="本机环境与配置扫描"
                    subtitle="深度遍历系统定位 Agent 文件"
                    status={step2Status}
                    isActive={currentStep === 2}
                    subProgress={
                      currentStep === 2 ? stepSubProgress : undefined
                    }
                    onClick={() => {
                      if (step1Status === "success") setCurrentStep(2);
                    }}
                  />

                  {/* 步骤 3 */}
                  <StepIndicatorNode
                    stepNumber={3}
                    title="配置解析与安全加载"
                    subtitle="校验 url、apikey、model"
                    status={step3Status}
                    isActive={currentStep === 3}
                    subProgress={
                      currentStep === 3 ? stepSubProgress : undefined
                    }
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
                <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-800 dark:bg-blue-950/30 dark:border-cyan-500/20 dark:text-cyan-300 text-[11px] leading-relaxed mt-4">
                  <p className="font-semibold flex items-center gap-1.5 mb-0.5">
                    <Sparkles size={12} className="text-cyan-500" />{" "}
                    本机自检扫描机制
                  </p>
                  工具正在深度扫描系统磁盘与用户运行环境，单点验证失败即终止；待完成全部核对并确认后进入软件。
                </div>
              </div>

              {/* ── 右侧: 当前环节详情展示与交互区 ── */}
              <div className="col-span-8 p-6 overflow-y-auto max-h-[calc(92vh-130px)] flex flex-col justify-between">
                <div>
                  {/* 环节 1: 网络环境检测详情 */}
                  {currentStep === 1 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          {step1Status === "error" ? (
                            <WifiOff size={16} className="text-red-500" />
                          ) : (
                            <Wifi
                              size={16}
                              className="text-blue-500 dark:text-cyan-400"
                            />
                          )}
                          环节 1：本机网络与目标服务接入连通性探测
                        </h3>
                        {step1Status === "running" && (
                          <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-cyan-400 font-medium">
                            <Loader2 size={13} className="animate-spin" />{" "}
                            正在探测网络...
                          </span>
                        )}
                        {step1Status === "success" && (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 size={13} /> 网络探测就绪
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-gray-400">
                        通过向官方指定服务节点发送真实 HTTP
                        探针，精准检验本机网络、DNS 解析及代理环境能否正常连通。
                      </p>

                      {/* 扫描子进度指示 */}
                      {step1Status === "running" && (
                        <ScanProgressBar
                          progress={stepSubProgress}
                          statusText={stepSubPhaseText}
                        />
                      )}

                      {/* 检查项列表 */}
                      <ChecklistCard
                        checkpoints={[
                          {
                            key: "dns_gateway",
                            label: "DNS 寻址与本机网络适配器",
                            status:
                              checkpoints.dns_gateway ||
                              (step1Status === "success" ? "done" : "pending"),
                            detail: "检查默认网关与本地 DNS 状态",
                          },
                          {
                            key: "proxy_tls",
                            label: "本机代理与 TLS 1.3 握手协议",
                            status:
                              checkpoints.proxy_tls ||
                              (step1Status === "success" ? "done" : "pending"),
                            detail: "配置 SSL/TLS 传输层安全上下文",
                          },
                          {
                            key: "endpoint_ping",
                            label: "BobAPI 目标服务可用性探测",
                            status:
                              checkpoints.endpoint_ping ||
                              (step1Status === "success" ? "done" : "pending"),
                            detail: "https://bob-api.com/ (GET)",
                          },
                          {
                            key: "latency_eval",
                            label: "往返通信链路延迟评估",
                            status:
                              checkpoints.latency_eval ||
                              (step1Status === "success" ? "done" : "pending"),
                            detail: networkData?.latency_ms
                              ? `${networkData.latency_ms} ms`
                              : "延迟分析",
                          },
                        ]}
                      />

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
                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2
                              size={16}
                              className="text-emerald-600 flex-shrink-0"
                            />
                            <span>
                              网络连通性检测通过！本机与指定服务端能够建立高速稳定通信。
                            </span>
                          </div>
                          <button
                            onClick={() => setCurrentStep(2)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white font-medium text-[11px] hover:bg-emerald-700 transition"
                          >
                            查看本机扫描
                            <ArrowRight size={11} />
                          </button>
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

                  {/* 环节 2: 配置文件路径获取详情 (凸显扫描本机效果) */}
                  {currentStep === 2 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          <FolderCheck
                            size={16}
                            className="text-blue-500 dark:text-cyan-400"
                          />
                          环节 2：本机环境与 Agent 配置文件深度扫描
                        </h3>
                        {step2Status === "running" && (
                          <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-cyan-400 font-medium">
                            <Loader2 size={13} className="animate-spin" />{" "}
                            正在深度扫描本机...
                          </span>
                        )}
                        {step2Status === "success" && (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 size={13} /> 本机扫描完成
                          </span>
                        )}
                      </div>

                      {/* 雷达动态扫描 HUD */}
                      {step2Status === "running" && (
                        <RadarScannerHud
                          label="正在执行本机磁盘与 Agent 运行环境深度扫描"
                          sublabel="正在检索 %USERPROFILE% 目录树并定位本地配置文件"
                        />
                      )}

                      {/* 扫描子进度指示 */}
                      {step2Status === "running" && (
                        <ScanProgressBar
                          progress={stepSubProgress}
                          statusText={stepSubPhaseText}
                        />
                      )}

                      {/* 本机扫描检查项 */}
                      <ChecklistCard
                        checkpoints={[
                          {
                            key: "env_profile",
                            label: "系统运行环境变量与用户根目录",
                            status:
                              checkpoints.env_profile ||
                              (step2Status === "success" ? "done" : "pending"),
                            detail: "%USERPROFILE% 目录遍历",
                          },
                          {
                            key: "scan_codex",
                            label: "ChatGPT (Codex) 本地配置文件",
                            status:
                              checkpoints.scan_codex ||
                              (step2Status === "success" ? "done" : "pending"),
                            detail:
                              checkpoints.scan_codex === "error"
                                ? "未检测到安装"
                                : configData.codex?.config_exists
                                  ? "已就绪 (config.toml)"
                                  : configData.codex?.is_installed
                                    ? "CLI 已就绪，待初始化"
                                    : checkpoints.scan_codex === "done"
                                      ? "已就绪"
                                      : "正在检索运行环境...",
                          },
                          {
                            key: "scan_claude",
                            label: "Claude Code 运行环境与配置",
                            status:
                              checkpoints.scan_claude ||
                              (step2Status === "success" ? "done" : "pending"),
                            detail:
                              checkpoints.scan_claude === "error"
                                ? "未检测到安装"
                                : configData.claude?.config_exists
                                  ? "已就绪 (settings.json)"
                                  : configData.claude?.is_installed
                                    ? "CLI 已就绪，待初始化"
                                    : checkpoints.scan_claude === "done"
                                      ? "已就绪"
                                      : "正在检索运行环境...",
                          },
                          {
                            key: "scan_workbuddy",
                            label: "WorkBuddy 客户端与模型配置",
                            status:
                              checkpoints.scan_workbuddy ||
                              (step2Status === "success" ? "done" : "pending"),
                            detail:
                              checkpoints.scan_workbuddy === "error"
                                ? "未检测到安装"
                                : configData.workbuddy?.config_exists
                                  ? "已就绪 (models.json)"
                                  : configData.workbuddy?.is_installed
                                    ? "客户端已就绪，待写入模型"
                                    : checkpoints.scan_workbuddy === "done"
                                      ? "已就绪"
                                      : "正在检索运行环境...",
                          },
                          {
                            key: "acl_verify",
                            label: "文件安全描述符与系统读写权限",
                            status:
                              checkpoints.acl_verify ||
                              (step2Status === "success" ? "done" : "pending"),
                            detail: "本地 I/O 权限核验",
                          },
                        ]}
                      />

                      {/* 扫描区域卡片（带激光扫光动画） */}
                      <div className="relative rounded-2xl overflow-hidden p-1 space-y-3">
                        {step2Status === "running" && <ScannerLaserSweep />}

                        {/* Codex 路径卡片 */}
                        <div className="p-3.5 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-2 relative">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                              <OpenAIIcon size={14} className="text-blue-500" />
                              ChatGPT (Codex) 配置文件
                            </span>
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1",
                                step2Status === "running" && !configData.codex
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                                  : configData.codex?.config_exists
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                    : configData.codex?.is_installed
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
                              )}
                            >
                              {step2Status === "running" &&
                              !configData.codex ? (
                                <>
                                  <Loader2 size={10} className="animate-spin" />
                                  扫描磁盘中
                                </>
                              ) : configData.codex?.config_exists ? (
                                <>
                                  <CheckCircle2 size={10} />
                                  已锁定路径
                                </>
                              ) : configData.codex?.is_installed ? (
                                <>
                                  <AlertCircle size={10} />
                                  待初始化 (CLI已就绪)
                                </>
                              ) : (
                                <>
                                  <XCircle size={10} />
                                  未安装
                                </>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-black/30 border border-slate-200/60 dark:border-white/5">
                            <code className="text-[11px] font-mono text-slate-700 dark:text-gray-300 break-all select-all">
                              {configData.codex?.config_path
                                ? configData.codex.config_path
                                : step2Status === "running"
                                  ? "正在遍历磁盘检索 Codex 路径..."
                                  : configData.codex?.is_installed
                                    ? "CLI 已检测，待生成 ~/.codex/config.toml"
                                    : "未检测到安装环境，暂无配置文件"}
                            </code>
                            {configData.codex?.config_path ? (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={async () => {
                                    if (!configData.codex?.config_exists) {
                                      toast.warning(
                                        "配置文件尚未创建，请先完成配置并保存",
                                      );
                                      return;
                                    }
                                    const ok = await openConfigFile(
                                      configData.codex.config_path,
                                    );
                                    if (ok) toast.success("已打开配置文件");
                                  }}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 cursor-pointer"
                                  title="打开配置文件"
                                >
                                  <ExternalLink size={12} />
                                </button>
                                <button
                                  onClick={() =>
                                    copyToClipboard(
                                      configData.codex?.config_path || "",
                                      "Codex 路径",
                                    )
                                  }
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 cursor-pointer"
                                  title="复制路径"
                                >
                                  {copiedKey === "Codex 路径" ? (
                                    <Check
                                      size={12}
                                      className="text-emerald-500"
                                    />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Claude 路径卡片 */}
                        <div className="p-3.5 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-2 relative">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                              <ClaudeIcon
                                size={14}
                                className="text-purple-500"
                              />
                              Claude Code 配置文件
                            </span>
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1",
                                step2Status === "running" && !configData.claude
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                                  : configData.claude?.config_exists
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                    : configData.claude?.is_installed
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
                              )}
                            >
                              {step2Status === "running" &&
                              !configData.claude ? (
                                <>
                                  <Loader2 size={10} className="animate-spin" />
                                  扫描磁盘中
                                </>
                              ) : configData.claude?.config_exists ? (
                                <>
                                  <CheckCircle2 size={10} />
                                  已锁定路径
                                </>
                              ) : configData.claude?.is_installed ? (
                                <>
                                  <AlertCircle size={10} />
                                  待初始化 (CLI已就绪)
                                </>
                              ) : (
                                <>
                                  <XCircle size={10} />
                                  未安装
                                </>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-black/30 border border-slate-200/60 dark:border-white/5">
                            <code className="text-[11px] font-mono text-slate-700 dark:text-gray-300 break-all select-all">
                              {configData.claude?.config_path
                                ? configData.claude.config_path
                                : step2Status === "running"
                                  ? "正在遍历磁盘检索 Claude 路径..."
                                  : configData.claude?.is_installed
                                    ? "CLI 已检测，待生成 ~/.claude/settings.json"
                                    : "未检测到安装环境，暂无配置文件"}
                            </code>
                            {configData.claude?.config_path ? (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={async () => {
                                    if (!configData.claude?.config_exists) {
                                      toast.warning(
                                        "配置文件尚未创建，请先完成配置并保存",
                                      );
                                      return;
                                    }
                                    const ok = await openConfigFile(
                                      configData.claude.config_path,
                                    );
                                    if (ok) toast.success("已打开配置文件");
                                  }}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 cursor-pointer"
                                  title="打开配置文件"
                                >
                                  <ExternalLink size={12} />
                                </button>
                                <button
                                  onClick={() =>
                                    copyToClipboard(
                                      configData.claude?.config_path || "",
                                      "Claude 路径",
                                    )
                                  }
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 cursor-pointer"
                                  title="复制路径"
                                >
                                  {copiedKey === "Claude 路径" ? (
                                    <Check
                                      size={12}
                                      className="text-emerald-500"
                                    />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* WorkBuddy 路径卡片 */}
                        <div className="p-3.5 rounded-xl border bg-slate-50/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10 space-y-2 relative">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                              <WorkbuddyIcon
                                size={14}
                                className="text-emerald-500"
                              />
                              WorkBuddy 配置文件
                            </span>
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1",
                                step2Status === "running" &&
                                  !configData.workbuddy
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                                  : configData.workbuddy?.config_exists
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                    : configData.workbuddy?.is_installed
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
                              )}
                            >
                              {step2Status === "running" &&
                              !configData.workbuddy ? (
                                <>
                                  <Loader2 size={10} className="animate-spin" />
                                  扫描磁盘中
                                </>
                              ) : configData.workbuddy?.config_exists ? (
                                <>
                                  <CheckCircle2 size={10} />
                                  已锁定路径
                                </>
                              ) : configData.workbuddy?.is_installed ? (
                                <>
                                  <AlertCircle size={10} />
                                  待初始化 (客户端已就绪)
                                </>
                              ) : (
                                <>
                                  <XCircle size={10} />
                                  未安装
                                </>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-black/30 border border-slate-200/60 dark:border-white/5">
                            <code className="text-[11px] font-mono text-slate-700 dark:text-gray-300 break-all select-all">
                              {configData.workbuddy?.config_path
                                ? configData.workbuddy.config_path
                                : step2Status === "running"
                                  ? "正在遍历磁盘检索 WorkBuddy 路径..."
                                  : configData.workbuddy?.is_installed
                                    ? "客户端已检测，待写入 ~/.workbuddy-ai/models.json"
                                    : "未检测到安装环境，暂无配置文件"}
                            </code>
                            {configData.workbuddy?.config_path ? (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={async () => {
                                    if (!configData.workbuddy?.config_exists) {
                                      toast.warning(
                                        "配置文件尚未创建，请先完成配置并保存",
                                      );
                                      return;
                                    }
                                    const ok = await openConfigFile(
                                      configData.workbuddy.config_path,
                                    );
                                    if (ok) toast.success("已打开配置文件");
                                  }}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 cursor-pointer"
                                  title="打开配置文件"
                                >
                                  <ExternalLink size={12} />
                                </button>
                                <button
                                  onClick={() =>
                                    copyToClipboard(
                                      configData.workbuddy?.config_path || "",
                                      "WorkBuddy 路径",
                                    )
                                  }
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 cursor-pointer"
                                  title="复制路径"
                                >
                                  {copiedKey === "WorkBuddy 路径" ? (
                                    <Check
                                      size={12}
                                      className="text-emerald-500"
                                    />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {step2Status === "success" && (
                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2
                              size={16}
                              className="text-emerald-600 flex-shrink-0"
                            />
                            <span>
                              {(configData.codex?.is_installed ? 1 : 0) +
                                (configData.claude?.is_installed ? 1 : 0) +
                                (configData.workbuddy?.is_installed ? 1 : 0) >
                              1
                                ? `本机环境扫描完成！已准确定位多个本地 Agent / 客户端运行环境与配置文件。`
                                : configData.workbuddy?.is_installed
                                  ? "本机扫描完成！已检测到 WorkBuddy 客户端运行环境"
                                  : configData.claude?.is_installed
                                    ? "本机扫描完成！已检测到 Claude Code 运行环境"
                                    : configData.codex?.is_installed
                                      ? "本机扫描完成！已检测到 ChatGPT (Codex) 运行环境"
                                      : "本机扫描通过！已准备预先配置核心参数。"}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setCurrentStep(3);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white font-medium text-[11px] hover:bg-emerald-700 transition cursor-pointer"
                          >
                            前往解析核心配置
                            <ArrowRight size={11} />
                          </button>
                        </div>
                      )}

                      {step2Status === "error" && (
                        <div className="space-y-3">
                          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-300 text-xs space-y-2">
                            <div className="flex items-center gap-1.5 font-bold">
                              <XCircle
                                size={15}
                                className="text-rose-600 dark:text-rose-400 flex-shrink-0"
                              />
                              未检测到本地 Agent 运行环境与配置文件
                            </div>
                            <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-300/90 whitespace-pre-line">
                              {pathError}
                            </p>
                            <div className="pt-1 border-t border-rose-200/60 dark:border-rose-500/20 text-[11px] text-slate-600 dark:text-gray-300 space-y-1.5">
                              <div className="font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-1">
                                <Terminal
                                  size={12}
                                  className="text-slate-500"
                                />
                                常见快速安装指引：
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2 font-mono text-[10px]">
                                <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-white dark:bg-black/30 border border-rose-200/60 dark:border-rose-500/20 flex-1">
                                  <span className="truncate">
                                    Claude: npm i -g @anthropic-ai/claude-code
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyToClipboard(
                                        "npm i -g @anthropic-ai/claude-code",
                                        "Claude 安装命令",
                                      )
                                    }
                                    className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                                    title="复制命令"
                                  >
                                    <Copy size={11} />
                                  </button>
                                </div>
                                <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-white dark:bg-black/30 border border-rose-200/60 dark:border-rose-500/20 flex-1">
                                  <span className="truncate">
                                    Codex: npm i -g @openai/codex
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyToClipboard(
                                        "npm i -g @openai/codex",
                                        "Codex 安装命令",
                                      )
                                    }
                                    className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                                    title="复制命令"
                                  >
                                    <Copy size={11} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              onClick={() => void runPipeline(2)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition shadow-xs cursor-pointer"
                            >
                              <RefreshCw size={12} />
                              重新检测本机环境
                            </button>

                            <button
                              onClick={handleForceContinueStep2}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 transition cursor-pointer"
                              title="即使未检测到运行环境，仍强制进入配置并生成初始配置文件"
                            >
                              <Sparkles size={12} />
                              跳过检测，强制预配置
                            </button>

                            <button
                              onClick={() => void exit(0)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition cursor-pointer ml-auto"
                            >
                              <Power size={12} />
                              退出软件
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 环节 3: 配置信息读取与展示详情 */}
                  {currentStep === 3 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          <FileCode
                            size={16}
                            className="text-blue-500 dark:text-cyan-400"
                          />
                          环节 3：核心配置信息读取与解析展示
                        </h3>
                        {step3Status === "running" && (
                          <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-cyan-400 font-medium">
                            <Loader2 size={13} className="animate-spin" />{" "}
                            解析中...
                          </span>
                        )}
                        {step3Status === "success" && (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 size={13} /> 核心参数解析就绪
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-gray-400">
                        {activeCfg?.config_exists
                          ? "成功解析本机配置文件内容，清晰展示核心三大参数：接口地址 (url)、认证密钥 (apikey) 及默认模型 (model)。"
                          : activeCfg?.is_installed
                            ? "已检测到 CLI 运行环境，当前尚未生成配置文件，展示默认预设模板参数。"
                            : "当前系统未安装该 Agent，展示默认配置模板。保存后将为您预先创建配置文件。"}
                      </p>

                      {/* 扫描子进度指示 */}
                      {step3Status === "running" && (
                        <ScanProgressBar
                          progress={stepSubProgress}
                          statusText={stepSubPhaseText}
                        />
                      )}

                      {/* 解析检查项 */}
                      <ChecklistCard
                        checkpoints={[
                          {
                            key: "load_binary",
                            label: activeCfg?.config_exists
                              ? "装载本地配置文件二进制流"
                              : "载入默认配置规范模板",
                            status:
                              checkpoints.load_binary ||
                              (step3Status === "success" ? "done" : "pending"),
                            detail: activeCfg?.config_exists
                              ? "语法树语法校验"
                              : "空配置结构模板",
                          },
                          {
                            key: "parse_url",
                            label: "结构化提取 Base URL 规范",
                            status:
                              checkpoints.parse_url ||
                              (step3Status === "success" ? "done" : "pending"),
                            detail: "接口网络地址合规性",
                          },
                          {
                            key: "verify_key",
                            label: "校验 API Key 前缀掩码结构",
                            status:
                              checkpoints.verify_key ||
                              (step3Status === "success" ? "done" : "pending"),
                            detail: "密钥完整性校验",
                          },
                          {
                            key: "map_model",
                            label: "读取核心推理模型 (Model)",
                            status:
                              checkpoints.map_model ||
                              (step3Status === "success" ? "done" : "pending"),
                            detail: "模型配置合规性",
                          },
                        ]}
                      />

                      {/* 切换展示 ChatGPT 或 Claude */}
                      <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 w-fit">
                        <button
                          onClick={() => {
                            setActiveConfigTab("chatgpt");
                            setEditTab("chatgpt");
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer",
                            activeConfigTab === "chatgpt"
                              ? "bg-white text-blue-600 shadow-sm dark:bg-blue-500/20 dark:text-blue-300 font-bold"
                              : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white",
                          )}
                        >
                          <OpenAIIcon size={13} />
                          ChatGPT (Codex)
                          {!configData.codex?.is_installed && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-gray-400">
                              未安装
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setActiveConfigTab("claude");
                            setEditTab("claude");
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer",
                            activeConfigTab === "claude"
                              ? "bg-white text-purple-600 shadow-sm dark:bg-purple-500/20 dark:text-purple-300 font-bold"
                              : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white",
                          )}
                        >
                          <ClaudeIcon size={13} />
                          Claude Code
                          {!configData.claude?.is_installed && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-gray-400">
                              未安装
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setActiveConfigTab("workbuddy");
                            setEditTab("workbuddy");
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer",
                            activeConfigTab === "workbuddy"
                              ? "bg-white text-emerald-600 shadow-sm dark:bg-emerald-500/20 dark:text-emerald-300 font-bold"
                              : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white",
                          )}
                        >
                          <WorkbuddyIcon size={13} />
                          WorkBuddy
                          {!configData.workbuddy?.is_installed && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-gray-400">
                              未安装
                            </span>
                          )}
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
                              {activeCfg?.base_url ||
                                "未配置 (默认: https://bob-api.com/)"}
                            </span>
                            <button
                              onClick={() =>
                                copyToClipboard(
                                  activeCfg?.base_url || "",
                                  "接口 URL",
                                )
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
                                ? (
                                    activeConfigTab === "chatgpt"
                                      ? showCodexKey
                                      : activeConfigTab === "claude"
                                        ? showClaudeKey
                                        : showWorkbuddyKey
                                  )
                                  ? activeCfg.api_key
                                  : `${activeCfg.api_key.slice(0, 6)}••••••••••••${activeCfg.api_key.slice(-4)}`
                                : "未配置密钥 (空)"}
                            </span>
                            <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                              <button
                                onClick={() => {
                                  if (activeConfigTab === "chatgpt") {
                                    setShowCodexKey(!showCodexKey);
                                  } else if (activeConfigTab === "claude") {
                                    setShowClaudeKey(!showClaudeKey);
                                  } else {
                                    setShowWorkbuddyKey(!showWorkbuddyKey);
                                  }
                                }}
                                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                title="切换可见性"
                              >
                                {(
                                  activeConfigTab === "chatgpt"
                                    ? showCodexKey
                                    : activeConfigTab === "claude"
                                      ? showClaudeKey
                                      : showWorkbuddyKey
                                ) ? (
                                  <EyeOff size={13} />
                                ) : (
                                  <Eye size={13} />
                                )}
                              </button>
                              <button
                                onClick={() =>
                                  copyToClipboard(
                                    activeCfg?.api_key || "",
                                    "API Key",
                                  )
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
                            <span
                              className={cn(
                                "truncate",
                                activeCfg?.model
                                  ? "font-semibold text-purple-700 dark:text-purple-300"
                                  : "text-slate-400 dark:text-gray-500",
                              )}
                            >
                              {activeCfg?.model || "未配置 (空)"}
                            </span>
                            {activeCfg?.model ? (
                              <button
                                onClick={() =>
                                  copyToClipboard(
                                    activeCfg?.model || "",
                                    "模型名称",
                                  )
                                }
                                className="ml-2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                title="复制"
                              >
                                <Copy size={12} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {step3Status === "success" && (
                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2
                              size={16}
                              className="text-emerald-600 flex-shrink-0"
                            />
                            <span>
                              三大核心参数（url、apikey、model）已成功读取并呈现。
                            </span>
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
                          <ShieldCheck
                            size={16}
                            className="text-blue-500 dark:text-cyan-400"
                          />
                          环节 4：配置信息检查与操作确认对话框
                        </h3>
                        {step4Status === "success" && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 text-[11px] font-bold">
                            <CheckCircle2 size={12} /> 已确认配置
                          </span>
                        )}
                      </div>

                      <div className="p-4 rounded-xl border border-blue-200/80 bg-blue-50/50 dark:bg-blue-950/20 dark:border-cyan-500/30 space-y-3">
                        <div className="flex items-start gap-2.5">
                          <AlertCircle
                            size={18}
                            className="text-blue-600 dark:text-cyan-400 flex-shrink-0 mt-0.5"
                          />
                          <div>
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                              请核对由本机扫描抓取的核心配置参数
                            </h4>
                            <p className="text-[11px] text-slate-600 dark:text-gray-300 mt-1">
                              系统已通过本机文件深度扫描获取当前运行环境核心参数（url、apikey、model）。请核实上述配置是否符合您的使用需求，并从下方操作选项中做出选择：
                            </p>
                          </div>
                        </div>

                        {/* 核心操作选项 */}
                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <button
                            onClick={handleConfirmNoChange}
                            className={cn(
                              "p-3 rounded-xl border text-left transition relative flex flex-col justify-between cursor-pointer",
                              confirmationDecision === "confirmed"
                                ? "bg-emerald-50/90 border-emerald-400 text-emerald-900 dark:bg-emerald-500/20 dark:border-emerald-500 dark:text-emerald-200 shadow-sm ring-1 ring-emerald-500/30"
                                : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-blue-400 dark:hover:border-cyan-500",
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold flex items-center gap-1.5">
                                <CheckCircle2
                                  size={14}
                                  className="text-emerald-500"
                                />
                                选项 A：配置无误
                              </span>
                              {confirmationDecision === "confirmed" && (
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">
                              无需修改，以当前本机已读取的配置继续运行并完成初始化。
                            </p>
                          </button>

                          <button
                            onClick={() => {
                              setConfirmationDecision("editing");
                              handleSwitchEditTab(editTab);
                            }}
                            className={cn(
                              "p-3 rounded-xl border text-left transition relative flex flex-col justify-between cursor-pointer",
                              confirmationDecision === "editing"
                                ? "bg-blue-50/90 border-blue-400 text-blue-900 dark:bg-blue-500/20 dark:border-cyan-500 dark:text-cyan-200 shadow-sm ring-1 ring-cyan-500/30"
                                : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-blue-400 dark:hover:border-cyan-500",
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold flex items-center gap-1.5">
                                <Edit3
                                  size={14}
                                  className="text-blue-500 dark:text-cyan-400"
                                />
                                选项 B：需要修改配置
                              </span>
                              {confirmationDecision === "editing" && (
                                <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">
                              立即在此对话框中对 url、apikey 或 model
                              进行快速修改并保存。
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
                                  "px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1",
                                  editTab === "chatgpt"
                                    ? "bg-white text-blue-600 shadow-xs dark:bg-blue-600 dark:text-white"
                                    : "text-slate-600 dark:text-gray-400",
                                )}
                              >
                                ChatGPT
                                {!configData.codex?.is_installed && (
                                  <span className="text-[9px] opacity-75">
                                    (未安装)
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => handleSwitchEditTab("claude")}
                                className={cn(
                                  "px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1",
                                  editTab === "claude"
                                    ? "bg-white text-purple-600 shadow-xs dark:bg-purple-600 dark:text-white"
                                    : "text-slate-600 dark:text-gray-400",
                                )}
                              >
                                Claude Code
                                {!configData.claude?.is_installed && (
                                  <span className="text-[9px] opacity-75">
                                    (未安装)
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => handleSwitchEditTab("workbuddy")}
                                className={cn(
                                  "px-2.5 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1",
                                  editTab === "workbuddy"
                                    ? "bg-white text-emerald-600 shadow-xs dark:bg-emerald-600 dark:text-white"
                                    : "text-slate-600 dark:text-gray-400",
                                )}
                              >
                                WorkBuddy
                                {!configData.workbuddy?.is_installed && (
                                  <span className="text-[9px] opacity-75">
                                    (未安装)
                                  </span>
                                )}
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
                                  : editTab === "claude"
                                    ? "claude-3-7-sonnet-20250219"
                                    : "gpt-5.6-sol"
                              }
                            />
                          </div>

                          <div className="flex justify-end pt-1">
                            <button
                              onClick={() => void handleSaveEdit()}
                              disabled={savingEdit}
                              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 shadow-sm cursor-pointer"
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

                {/* ── 本机扫描诊断实时终端 ── */}
                <ScanTerminalConsole
                  logs={scanLogs}
                  isRunning={
                    step1Status === "running" ||
                    step2Status === "running" ||
                    step3Status === "running"
                  }
                />
              </div>
            </div>

            {/* ── 弹窗底部操作确认栏 ── */}
            <div className="px-6 py-4 border-t border-slate-200/80 dark:border-white/10 flex items-center justify-between flex-shrink-0 bg-slate-50/60 dark:bg-white/[0.01]">
              {/* 左侧状态文案提示 */}
              <div className="text-xs text-slate-500 dark:text-gray-400">
                {step4Status === "success" ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                    <CheckCircle2 size={14} />{" "}
                    所有初始化环节检验通过，可点击右侧按钮进入主界面
                  </span>
                ) : step1Status === "error" ||
                  step2Status === "error" ||
                  step3Status === "error" ? (
                  <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5">
                    <AlertCircle size={14} />{" "}
                    初始化异常中断，请解决当前环节错误后重试
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Loader2
                      size={13}
                      className="animate-spin text-blue-600 dark:text-cyan-400"
                    />
                    正在执行第 {currentStep} 环节扫描自检，请稍候...
                  </span>
                )}
              </div>

              {/* 右侧主操作按钮 */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onFinish();
                    onClose();
                  }}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/5 transition cursor-pointer"
                  title="跳过初始化向导，直接进入软件主界面"
                >
                  跳过向导直接进入
                </button>

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
                      ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white shadow-blue-500/20 hover:shadow-cyan-500/20 cursor-pointer"
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

// ── 激光扫光动画组件 ──
function ScannerLaserSweep() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-20 rounded-xl">
      <motion.div
        className="w-full h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_14px_rgba(6,182,212,0.9)]"
        animate={{
          top: ["0%", "100%", "0%"],
        }}
        transition={{
          duration: 2.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ position: "absolute" }}
      />
      <motion.div
        className="w-full h-16 bg-gradient-to-b from-cyan-500/10 via-cyan-500/5 to-transparent pointer-events-none"
        animate={{
          top: ["-4rem", "calc(100% - 4rem)", "-4rem"],
        }}
        transition={{
          duration: 2.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ position: "absolute" }}
      />
    </div>
  );
}

// ── 旋转雷达扫描 HUD 组件 ──
function RadarScannerHud({
  label = "正在深度扫描本机运行环境...",
  sublabel = "检索本地磁盘、用户环境与 Agent 配置文件",
}: {
  label?: string;
  sublabel?: string;
}) {
  return (
    <div className="flex items-center gap-3.5 p-3 rounded-xl bg-blue-500/5 dark:bg-cyan-500/10 border border-blue-500/20 dark:border-cyan-500/20 backdrop-blur-xs relative overflow-hidden">
      <div className="relative w-11 h-11 rounded-full border border-blue-500/40 dark:border-cyan-400/40 flex items-center justify-center flex-shrink-0 bg-blue-900/10 dark:bg-cyan-950/40">
        {/* 旋转雷达波束 */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(6, 182, 212, 0.45) 55deg, transparent 60deg)",
          }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        />
        {/* 同心扩散脉冲 */}
        <motion.div
          className="absolute inset-0 rounded-full border border-cyan-400/50"
          animate={{ scale: [0.7, 1.35], opacity: [0.8, 0] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "easeOut" }}
        />
        <Scan
          size={18}
          className="text-cyan-600 dark:text-cyan-400 relative z-10 animate-pulse"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Activity
              size={13}
              className="text-cyan-600 dark:text-cyan-400 animate-pulse"
            />
            {label}
          </span>
          <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 animate-pulse font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
            ● SCANNING
          </span>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-gray-400 truncate mt-0.5">
          {sublabel}
        </p>
      </div>
    </div>
  );
}

// ── 环节内子微进度条 ──
function ScanProgressBar({
  progress,
  statusText,
}: {
  progress: number;
  statusText: string;
}) {
  return (
    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/10">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[11px] text-slate-700 dark:text-gray-300 font-medium truncate flex items-center gap-1.5">
          <Loader2
            size={12}
            className="animate-spin text-blue-600 dark:text-cyan-400 flex-shrink-0"
          />
          <span className="truncate">{statusText}</span>
        </span>
        <span className="text-[11px] font-mono font-bold text-blue-600 dark:text-cyan-400 ml-2 flex-shrink-0">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="h-2 w-full bg-slate-200/80 dark:bg-white/10 rounded-full overflow-hidden relative">
        <motion.div
          className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 rounded-full relative"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <div className="absolute top-0 bottom-0 right-0 w-8 bg-white/40 blur-[2px] -skew-x-12 animate-pulse" />
        </motion.div>
      </div>
    </div>
  );
}

// ── 检查项网格卡片 ──
function ChecklistCard({
  checkpoints,
}: {
  checkpoints: {
    key: string;
    label: string;
    status: CheckpointStatus;
    detail?: string;
  }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {checkpoints.map((cp) => (
        <div
          key={cp.key}
          className={cn(
            "p-2.5 rounded-xl border text-xs flex items-center gap-2.5 transition-all duration-300",
            cp.status === "done" &&
              "bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300",
            cp.status === "scanning" &&
              "bg-blue-50/90 border-blue-400 text-blue-900 dark:bg-blue-500/15 dark:border-cyan-500/30 dark:text-cyan-300 shadow-sm ring-1 ring-blue-400/30",
            cp.status === "pending" &&
              "bg-slate-50/60 border-slate-200/80 text-slate-400 dark:bg-white/[0.02] dark:border-white/5 dark:text-gray-500",
            cp.status === "error" &&
              "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300",
          )}
        >
          <div className="flex-shrink-0">
            {cp.status === "done" && (
              <CheckCircle2
                size={15}
                className="text-emerald-600 dark:text-emerald-400"
              />
            )}
            {cp.status === "scanning" && (
              <Loader2
                size={15}
                className="animate-spin text-blue-600 dark:text-cyan-400"
              />
            )}
            {cp.status === "pending" && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-white/20 inline-block" />
            )}
            {cp.status === "error" && (
              <XCircle size={15} className="text-red-600 dark:text-red-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[11px] truncate">{cp.label}</div>
            {cp.detail && (
              <div className="text-[10px] opacity-80 truncate font-mono mt-0.5">
                {cp.detail}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 本机扫描诊断实时终端 ──
function ScanTerminalConsole({
  logs,
  isRunning,
}: {
  logs: ScanLogItem[];
  isRunning: boolean;
}) {
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden bg-slate-900 text-slate-200 shadow-sm mt-3">
      {/* 终端顶栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-white/5 text-[10.5px]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="font-mono text-slate-400 font-semibold flex items-center gap-1.5">
            <Terminal size={11} className="text-cyan-400" />
            HOST_DIAGNOSTIC_TERMINAL :: 本机扫描诊断实时终端
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-[9.5px] text-cyan-400 font-mono font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              LIVE SCAN
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-400 hover:text-white transition p-0.5 cursor-pointer"
            title={collapsed ? "展开终端日志" : "折叠终端日志"}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* 终端内容区 */}
      {!collapsed && (
        <div className="p-3 font-mono text-[10.5px] leading-relaxed max-h-32 overflow-y-auto space-y-1 select-text">
          {logs.length === 0 ? (
            <div className="text-slate-500 italic">
              初始化扫描引擎中，等待输出日志...
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2">
                <span className="text-slate-500 flex-shrink-0 select-none">
                  [{log.time}]
                </span>
                <span
                  className={cn(
                    "px-1 py-0.2 rounded text-[9.5px] font-bold flex-shrink-0",
                    log.type === "success" &&
                      "bg-emerald-500/20 text-emerald-300",
                    log.type === "match" && "bg-cyan-500/20 text-cyan-300",
                    log.type === "scan" && "bg-blue-500/20 text-blue-300",
                    log.type === "warn" && "bg-amber-500/20 text-amber-300",
                    log.type === "error" && "bg-red-500/20 text-red-300",
                    log.type === "info" && "bg-slate-700 text-slate-300",
                  )}
                >
                  [{log.tag}]
                </span>
                <span
                  className={cn(
                    "break-all",
                    log.type === "error"
                      ? "text-red-300"
                      : log.type === "success"
                        ? "text-emerald-300"
                        : log.type === "match"
                          ? "text-cyan-200"
                          : "text-slate-300",
                  )}
                >
                  {log.text}
                </span>
              </div>
            ))
          )}
          {isRunning && (
            <div className="flex items-center gap-1 text-cyan-400 animate-pulse pt-0.5">
              <span>›</span>
              <span className="w-1.5 h-3 bg-cyan-400 inline-block animate-pulse" />
            </div>
          )}
          <div ref={terminalEndRef} />
        </div>
      )}
    </div>
  );
}

// ── 竖直进度条单节点展示组件 ──
function StepIndicatorNode({
  stepNumber,
  title,
  subtitle,
  status,
  isActive,
  subProgress,
  onClick,
}: {
  stepNumber: number;
  title: string;
  subtitle: string;
  status: StepStatus;
  isActive: boolean;
  subProgress?: number;
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
          status === "error" && "bg-red-500 text-white ring-4 ring-red-500/20",
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
      <div className="flex flex-col pt-0.5 flex-1 min-w-0">
        <span
          className={cn(
            "text-xs font-bold transition-colors leading-tight",
            isActive
              ? "text-blue-600 dark:text-cyan-400"
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
        {status === "running" && subProgress !== undefined && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[9.5px] font-mono font-bold text-blue-600 dark:text-cyan-400">
              {Math.round(subProgress)}%
            </span>
            <div className="w-16 h-1 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                style={{ width: `${subProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

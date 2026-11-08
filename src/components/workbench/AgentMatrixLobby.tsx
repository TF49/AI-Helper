import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  FileText,
  ShieldCheck,
  RefreshCw,
  Cpu,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { VoxelMorphHero } from "./VoxelMorphHero";
import { AgentCard, type AgentCardItem } from "./AgentCard";
import { TerminalTestModal } from "../TerminalTestModal";
import { BatchTerminalModal, type BatchApplyTarget } from "./BatchTerminalModal";
import {
  ClaudeCliIcon,
  CodexCliIcon,
  ChatGPTDesktopIcon,
  CursorIcon,
  WorkbuddyIcon,
  AccioWorkIcon,
} from "../BrandIcons";
import {
  detectAllAppPaths,
  getAppPaths,
  getClaudeConfig,
  getCodexConfig,
  getCursorConfig,
  getWorkbuddyConfig,
  getAccioConfig,
  startAccioBridge,
  startCursorBridge,
  getCursorPatchStatus,
  patchCursorClient,
  ensureUserToken,
  restartTargetApp,
} from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import type {
  AgentTool,
  TokenItem,
  CursorConfig,
  AccioConfig,
  WorkbuddySavePayload,
} from "../../types";

interface AgentMatrixLobbyProps {
  onSelectTool: (tool: AgentTool) => void;
  onOpenEnvironmentCheck: () => void;
  onOpenAppInstaller?: (appName: string) => void;
}

// 缓存已探测到的客户端状态与配置，跨页面切换时直接复用，消除由于初始态不一致导致的异步闪烁
let cachedAgentsStatusMap: Record<string, AgentCardItem["status"]> | null = null;
let cachedAgentsConfigMap: Record<
  string,
  { key: string | null; model: string | null }
> | null = null;

// 卡片 → 后端 apply_api_key_to_agents 的写入目标（ChatGPT 桌面端无需写配置，不在此列）
type ApplyTarget = "claude" | "chatgpt" | "cursor" | "workbuddy" | "acciowork";
type RestartTarget =
  | "claude"
  | "codex"
  | "chatgpt"
  | "cursor"
  | "workbuddy"
  | "acciowork";

const APPLY_TARGET_BY_CARD: Record<string, ApplyTarget> = {
  "claude-cli": "claude",
  "codex-cli": "chatgpt",
  "cursor-ide": "cursor",
  "workbuddy-app": "workbuddy",
  "accio-work": "acciowork",
};

const RESTART_TARGET_BY_CARD: Record<string, RestartTarget> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "chatgpt-app": "chatgpt",
  "cursor-ide": "cursor",
  "workbuddy-app": "workbuddy",
  "accio-work": "acciowork",
};

// 各客户端默认分组与推荐模型配置
const TARGET_DEFAULT_GROUP: Record<ApplyTarget, string> = {
  claude: "CC-Kiro-Max",
  chatgpt: "Codex-不降质",
  cursor: "国产Token计划",
  workbuddy: "国产Token计划",
  acciowork: "国产Token计划",
};

const TARGET_DEFAULT_MODEL: Record<ApplyTarget, string> = {
  claude: "claude-sonnet-5-5",
  chatgpt: "gpt-5.6-sol",
  cursor: "glm-5.3",
  workbuddy: "glm-5.3",
  acciowork: "glm-5.3",
};

const GROUP_DEFAULT_TOKEN_NAMES: Record<string, string> = {
  "CC-Kiro-Max": "Claude Code 专属令牌 (CC-Kiro-Max)",
  "Codex-不降质": "Codex 专属令牌 (Codex-不降质)",
  "国产Token计划": "国产模型专属令牌 (国产Token计划)",
};

type ResolvedKey = { key: string; token: TokenItem | null };

function readBoundTokenId(toolId: string): number | null {
  try {
    const saved = localStorage.getItem(`bound_token_${toolId}`);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as { id?: unknown };
    return typeof parsed.id === "number" ? parsed.id : null;
  } catch {
    return null;
  }
}

export const AgentMatrixLobby: React.FC<AgentMatrixLobbyProps> = ({
  onSelectTool,
  onOpenEnvironmentCheck,
  onOpenAppInstaller,
}) => {
  const [restartingAgentId, setRestartingAgentId] = useState<string | null>(null);

  // 单卡片类终端连通性测试模态框状态
  const [activeTerminalTarget, setActiveTerminalTarget] = useState<{
    type: "codex" | "claude" | "workbuddy" | "acciowork" | "cursor";
    target: ApplyTarget;
    url: string;
    apiKey: string;
    model: string;
    token: TokenItem | null;
    session: number;
    cursorPayload?: CursorConfig;
    accioPayload?: AccioConfig;
    workbuddyPayload?: WorkbuddySavePayload;
  } | null>(null);

  // 矩阵批量连通性测试终端模态框状态
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchTargets, setBatchTargets] = useState<BatchApplyTarget[]>([]);
  // 批量终端打开时的会话；之后切换账号或会话，未完成的批量写入即视为过期
  const [batchSession, setBatchSession] = useState<number | null>(null);

  const { authState, authSessionGeneration, setLoginModalOpen } = useAuth();
  // 防止重复点击并发写入；会话切换或卸载后不再写入本地绑定记录
  const actionInFlight = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef(authSessionGeneration);
  const observedSessionRef = useRef(authSessionGeneration);
  sessionRef.current = authSessionGeneration;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (observedSessionRef.current === authSessionGeneration) return;
    observedSessionRef.current = authSessionGeneration;
    setActiveTerminalTarget((current) =>
      current && current.session !== authSessionGeneration ? null : current,
    );
    setBatchModalOpen(false);
  }, [authSessionGeneration]);

  // 严格基于 AI-Helper 真实可接入的 6 席原生客户端矩阵 (2 列 × 3 行)
  const [agents, setAgents] = useState<AgentCardItem[]>(() => [
    {
      id: "claude-cli",
      name: "Claude Code",
      subtitle: "Anthropic 命令行开发",
      category: "cli",
      icon: ClaudeCliIcon,
      status: cachedAgentsStatusMap?.["claude-cli"] ?? "unconfigured",
      toolKey: "claude",
      configuredKey: cachedAgentsConfigMap?.["claude-cli"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["claude-cli"]?.model ?? null,
    },
    {
      id: "codex-cli",
      name: "Codex",
      subtitle: "OpenAI 命令行开发",
      category: "cli",
      icon: CodexCliIcon,
      status: cachedAgentsStatusMap?.["codex-cli"] ?? "unconfigured",
      toolKey: "chatgpt",
      configuredKey: cachedAgentsConfigMap?.["codex-cli"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["codex-cli"]?.model ?? null,
    },
    {
      id: "chatgpt-app",
      name: "ChatGPT",
      subtitle: "OpenAI 官方桌面客户端",
      category: "desktop",
      icon: ChatGPTDesktopIcon,
      status: cachedAgentsStatusMap?.["chatgpt-app"] ?? "unconfigured",
      toolKey: "chatgpt",
      actionLabel: "打开客户端",
      configuredKey: cachedAgentsConfigMap?.["chatgpt-app"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["chatgpt-app"]?.model ?? null,
    },
    {
      id: "cursor-ide",
      name: "Cursor",
      subtitle: "AI First 现代化代码编辑器",
      category: "ide",
      icon: CursorIcon,
      status: cachedAgentsStatusMap?.["cursor-ide"] ?? "unconfigured",
      toolKey: "cursor",
      configuredKey: cachedAgentsConfigMap?.["cursor-ide"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["cursor-ide"]?.model ?? null,
    },
    {
      id: "workbuddy-app",
      name: "WorkBuddy",
      subtitle: "企业级多模型协同工作流",
      category: "desktop",
      icon: WorkbuddyIcon,
      status: cachedAgentsStatusMap?.["workbuddy-app"] ?? "unconfigured",
      toolKey: "workbuddy",
      configuredKey: cachedAgentsConfigMap?.["workbuddy-app"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["workbuddy-app"]?.model ?? null,
    },
    {
      id: "accio-work",
      name: "Accio Work",
      subtitle: "阿里巴巴企业级 Agent",
      category: "desktop",
      icon: AccioWorkIcon,
      status: cachedAgentsStatusMap?.["accio-work"] ?? "unconfigured",
      toolKey: "acciowork",
      configuredKey: cachedAgentsConfigMap?.["accio-work"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["accio-work"]?.model ?? null,
    },
  ]);

  // 初始化探测各个真实本地 AI 工具的安装与配置状态
  const refreshAgentStatuses = async () => {
    try {
      const [
        allPathsRes,
        savedPathsRes,
        claudeCfgRes,
        codexCfgRes,
        cursorCfgRes,
        workbuddyCfgRes,
        accioCfgRes,
      ] = await Promise.allSettled([
        detectAllAppPaths(),
        getAppPaths(),
        getClaudeConfig(),
        getCodexConfig(),
        getCursorConfig(),
        getWorkbuddyConfig(),
        getAccioConfig(),
      ]);

      const pathMap: Record<string, { exists: boolean; path: string }> = {};
      if (allPathsRes.status === "fulfilled" && Array.isArray(allPathsRes.value)) {
        for (const p of allPathsRes.value) {
          pathMap[p.app_type] = { exists: p.exists, path: p.path };
        }
      }

      const savedPaths = savedPathsRes.status === "fulfilled" ? savedPathsRes.value : null;
      const claudeCfg = claudeCfgRes.status === "fulfilled" ? claudeCfgRes.value : null;
      const codexCfg = codexCfgRes.status === "fulfilled" ? codexCfgRes.value : null;
      const cursorCfg = cursorCfgRes.status === "fulfilled" ? cursorCfgRes.value : null;
      const workbuddyCfg = workbuddyCfgRes.status === "fulfilled" ? workbuddyCfgRes.value : null;
      const accioCfg = accioCfgRes.status === "fulfilled" ? accioCfgRes.value : null;

      setAgents((prev) => {
        const next = prev.map((item) => {
          if (item.id === "claude-cli") {
            const hasKey = Boolean(claudeCfg?.api_key && claudeCfg.api_key.trim());
            const exists = Boolean(pathMap["claude"]?.exists || claudeCfg?.is_installed);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              configuredKey: claudeCfg?.api_key?.trim() || null,
              configuredModel: claudeCfg?.model?.trim() || null,
            };
          }
          if (item.id === "codex-cli") {
            const hasKey = Boolean(codexCfg?.api_key && codexCfg.api_key.trim());
            const exists = Boolean(pathMap["codex"]?.exists || codexCfg?.is_installed);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              configuredKey: codexCfg?.api_key?.trim() || null,
              configuredModel: codexCfg?.model?.trim() || null,
            };
          }
          if (item.id === "chatgpt-app") {
            const savedChatgpt = savedPaths?.chatgpt_client_path;
            const exists = Boolean(
              pathMap["chatgpt"]?.exists || (savedChatgpt && savedChatgpt.trim())
            );
            return {
              ...item,
              status: (exists ? "installed" : "uninstalled") as AgentCardItem["status"],
              // ChatGPT 桌面端与 Codex 共享 OpenAI 配置
              configuredKey: codexCfg?.api_key?.trim() || null,
              configuredModel: codexCfg?.model?.trim() || null,
            };
          }
          if (item.id === "cursor-ide") {
            const hasKey = Boolean(cursorCfg?.api_key && cursorCfg.api_key.trim());
            const exists = Boolean(pathMap["cursor"]?.exists || cursorCfg?.is_installed);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              configuredKey: cursorCfg?.api_key?.trim() || null,
              configuredModel: cursorCfg?.model?.trim() || null,
            };
          }
          if (item.id === "workbuddy-app") {
            const hasKey = Boolean(workbuddyCfg?.api_key && workbuddyCfg.api_key.trim());
            const exists = Boolean(pathMap["workbuddy"]?.exists || workbuddyCfg?.config_exists);
            const wbModel =
              workbuddyCfg?.model?.trim() ||
              workbuddyCfg?.configured_models?.[0]?.name ||
              workbuddyCfg?.configured_models?.[0]?.id ||
              null;
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              configuredKey: workbuddyCfg?.api_key?.trim() || null,
              configuredModel: wbModel,
            };
          }
          if (item.id === "accio-work") {
            const hasKey = Boolean(accioCfg?.api_key && accioCfg.api_key.trim());
            const exists = Boolean(pathMap["acciowork"]?.exists);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              configuredKey: accioCfg?.api_key?.trim() || null,
              configuredModel: accioCfg?.model?.trim() || null,
            };
          }
          return item;
        });

        // 写入缓存供跨视图切页秒级无感复用
        const map: Record<string, AgentCardItem["status"]> = {};
        const configMap: Record<string, { key: string | null; model: string | null }> = {};
        for (const it of next) {
          map[it.id] = it.status;
          configMap[it.id] = {
            key: it.configuredKey ?? null,
            model: it.configuredModel ?? null,
          };
        }
        cachedAgentsStatusMap = map;
        cachedAgentsConfigMap = configMap;

        return next;
      });
    } catch (e) {
      console.warn("探测 Agent 状态轻微异常:", e);
    }
  };

  useEffect(() => {
    void refreshAgentStatuses();

    // 监听窗口聚焦与外部 Token 同步事件，实时对齐已配置参数
    const handleSync = () => {
      void refreshAgentStatuses();
    };
    window.addEventListener("focus", handleSync);
    window.addEventListener("ai_helper_sync_all_tokens", handleSync);

    return () => {
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("ai_helper_sync_all_tokens", handleSync);
    };
  }, []);

  // 记忆用户未登录时触发的一键配置意图，登录成功后自动无缝断点续传
  type PendingConfig =
    | { type: "single"; agent: AgentCardItem }
    | { type: "all" };

  const pendingConfigRef = useRef<PendingConfig | null>(null);

  // 监听登录状态：一旦用户在弹窗中完成登录，自动恢复之前挂起的配置动作
  useEffect(() => {
    if (authState.is_logged_in && pendingConfigRef.current) {
      const pending = pendingConfigRef.current;
      pendingConfigRef.current = null;
      toast.success("已成功登录 Bob API，正在为您自动执行一键配置...");
      if (pending.type === "single") {
        void handleCardAction(pending.agent);
      } else if (pending.type === "all") {
        void handleConfigureAll();
      }
    }
  }, [authState.is_logged_in, authSessionGeneration]);

  // 执行单卡片动作 (一键配置连通性测试或安装引导)
  const handleCardAction = async (agent: AgentCardItem) => {
    if (agent.status === "uninstalled") {
      if (agent.id === "chatgpt-app") {
        if (onOpenAppInstaller) {
          onOpenAppInstaller("chatgpt");
        } else {
          onOpenEnvironmentCheck();
        }
      } else if (agent.toolKey) {
        onSelectTool(agent.toolKey);
      } else {
        onOpenEnvironmentCheck();
      }
      return;
    }

    if (agent.id === "chatgpt-app") {
      try {
        const res = await restartTargetApp("chatgpt");
        toast.success("已调起 ChatGPT 桌面客户端", { description: res });
        return;
      } catch {
        onSelectTool("chatgpt");
        return;
      }
    }

    const target = APPLY_TARGET_BY_CARD[agent.id];
    if (!target) {
      if (agent.toolKey) onSelectTool(agent.toolKey);
      return;
    }

    // 必须使用 Bob API：若未登录则记录意图并直接唤起登录窗，引导新用户注册/登录
    if (!authState.is_logged_in) {
      pendingConfigRef.current = { type: "single", agent };
      toast.info("一键配置需要绑定您的 Bob API 账号，新用户登录立享体验额度", {
        description: `将自动为您匹配并配置 ${agent.name}（分组: ${TARGET_DEFAULT_GROUP[target]}）`,
      });
      setLoginModalOpen(true);
      return;
    }

    if (actionInFlight.current || activeTerminalTarget || batchModalOpen) return;
    const requestSession = sessionRef.current;
    actionInFlight.current = true;
    const toastId = toast.loading(`正在为 ${agent.name} 匹配专属令牌并准备连通性测试...`);

    try {
      const resolved = await resolveApiKeyForTarget(target);
      if (!mountedRef.current || requestSession !== sessionRef.current) return;
      if (!resolved) {
        toast.dismiss(toastId);
        toast.info("未能获取或创建可用令牌，请在配置面板中查看");
        onSelectTool(target);
        return;
      }

      toast.dismiss(toastId);

      // 映射到 TerminalTestModal 对应的 target type
      const modalType: "codex" | "claude" | "workbuddy" | "acciowork" | "cursor" =
        target === "chatgpt" ? "codex" : target;
      const defaultModel = TARGET_DEFAULT_MODEL[target];

      let targetUrl =
        target === "workbuddy" ? "https://bob-api.com/v1" : "https://bob-api.com/";

      let cursorPayload: CursorConfig | undefined;
      let accioPayload: AccioConfig | undefined;
      let workbuddyPayload: WorkbuddySavePayload | undefined;

      if (modalType === "cursor") {
        const curCfg = await getCursorConfig().catch(() => null);
        if (curCfg?.base_url?.trim()) {
          targetUrl = curCfg.base_url.trim();
        }
        cursorPayload = {
          base_url: targetUrl,
          api_key: resolved.key.trim(),
          model: defaultModel,
          bridge_port: curCfg?.bridge_port || 8969,
          auto_start_bridge: true,
          cursor_path: curCfg?.cursor_path || null,
        };
      } else if (modalType === "acciowork") {
        const accCfg = await getAccioConfig().catch(() => null);
        if (accCfg?.base_url?.trim()) {
          targetUrl = accCfg.base_url.trim();
        }
        accioPayload = {
          base_url: targetUrl,
          api_key: resolved.key.trim(),
          model: defaultModel,
          bridge_port: accCfg?.bridge_port || 8787,
          official_gateway:
            accCfg?.official_gateway || "https://phoenix-gw.alibaba.com",
          fallback_official: accCfg?.fallback_official ?? false,
          prevent_official_leak: accCfg?.prevent_official_leak ?? true,
        };
      } else if (modalType === "workbuddy") {
        const wbCfg = await getWorkbuddyConfig().catch(() => null);
        if (wbCfg?.base_url?.trim()) {
          targetUrl = wbCfg.base_url.trim();
        }
        workbuddyPayload = {
          url: targetUrl,
          api_key: resolved.key.trim(),
          model: defaultModel,
          supports_tool_call: true,
          supports_images: true,
          supports_reasoning: true,
          only_reasoning: false,
          can_disable_thinking: true,
          use_custom_protocol: false,
          default_effort: null,
          supported_efforts: ["medium"],
          max_input_tokens: 32768,
          max_output_tokens: 32768,
        };
      } else if (modalType === "claude") {
        const cCfg = await getClaudeConfig().catch(() => null);
        if (cCfg?.base_url?.trim()) {
          targetUrl = cCfg.base_url.trim();
        }
      } else if (modalType === "codex") {
        const xCfg = await getCodexConfig().catch(() => null);
        if (xCfg?.base_url?.trim()) {
          targetUrl = xCfg.base_url.trim();
        }
      }

      if (!mountedRef.current || requestSession !== sessionRef.current) return;

      // 打开类终端连通性测试模态框
      setActiveTerminalTarget({
        type: modalType,
        target,
        url: targetUrl,
        apiKey: resolved.key,
        model: defaultModel,
        token: resolved.token,
        session: requestSession,
        cursorPayload,
        accioPayload,
        workbuddyPayload,
      });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`${agent.name} 准备连通性测试失败: ${String(err)}`);
      onSelectTool(target);
    } finally {
      actionInFlight.current = false;
    }
  };

  /**
   * 解析指定目标 Agent 一键配置所用的 API Key。
   * 按照专属分组规则进行匹配：
   * - Claude Code: CC-Kiro-Max (模型: claude-sonnet-5-5)
   * - Codex / ChatGPT: Codex-不降质 (模型: gpt-5.6-sol)
   * - Cursor / WorkBuddy / Accio: 国产Token计划 (模型: glm-5.3)
   *
   * 若用户账号下暂无对应分组的有效 Token，将自动在 Bob API 创建对应分组的专属令牌。
   */
  const resolveApiKeyForTarget = async (target: ApplyTarget): Promise<ResolvedKey | null> => {
    if (!authState.is_logged_in) {
      return null;
    }

    const requestSession = sessionRef.current;
    const targetGroup = TARGET_DEFAULT_GROUP[target];
    const tokenName = GROUP_DEFAULT_TOKEN_NAMES[targetGroup] || `${targetGroup} 专属令牌`;
    try {
      // Backend refreshes the list before deciding whether to create. A lookup
      // or key-read failure is surfaced instead of turning into a duplicate POST.
      const token = await ensureUserToken(tokenName, targetGroup, readBoundTokenId(target));
      if (!mountedRef.current || requestSession !== sessionRef.current) {
        throw new Error("会话已切换，已丢弃旧令牌结果");
      }
      const key = token.key?.trim() || "";
      if (!key) throw new Error("服务器返回的令牌没有明文 Key");
      return { key, token };
    } catch (err) {
      console.error(`解析 ${targetGroup} 分组令牌失败:`, err);
      throw new Error(`获取「${targetGroup}」分组令牌失败: ${String(err)}`);
    }
  };

  /** 首页卡片仅重启当前客户端，不影响其他工具。 */
  const handleRestartAgent = async (agent: AgentCardItem) => {
    if (
      agent.status === "uninstalled" ||
      restartingAgentId ||
      actionInFlight.current
    ) {
      return;
    }
    const appType = RESTART_TARGET_BY_CARD[agent.id];
    if (!appType) return;

    actionInFlight.current = true;
    setRestartingAgentId(agent.id);
    const toastId = toast.loading(`正在重启 ${agent.name}...`);
    try {
      let customPath: string | undefined;
      if (agent.id === "cursor-ide") {
        const cfg = await getCursorConfig();
        // cfg.app_path 是补丁模块返回的安装根目录，并非 Cursor.exe。
        // 未手动指定可执行文件时交给后端路径管理器解析已保存的 Cursor.exe。
        customPath = cfg.cursor_path || undefined;
        if (cfg.api_key.trim()) {
          const port = await startCursorBridge(cfg.bridge_port);
          // 已接入的 Cursor 若曾自动换端口，重启当前客户端前同步实际地址。
          const patch = await getCursorPatchStatus(customPath);
          if (
            patch.is_patched &&
            patch.current_bridge_target !== `http://127.0.0.1:${port}`
          ) {
            await patchCursorClient(customPath, port);
          }
        }
      } else if (agent.id === "accio-work") {
        const cfg = await getAccioConfig();
        if (cfg.api_key.trim()) await startAccioBridge(cfg.bridge_port);
      }

      const result = await restartTargetApp(appType, customPath);
      toast.success(`${agent.name} 已完成一键重启`, { description: result });
    } catch (error) {
      console.warn(`重启 ${agent.name} 失败`, error);
      toast.error(`${agent.name} 重启失败`, { description: String(error) });
    } finally {
      toast.dismiss(toastId);
      actionInFlight.current = false;
      if (mountedRef.current) setRestartingAgentId(null);
    }
  };

  // 一键配置所有：唤起矩阵批量连通性测试与配置终端
  const handleConfigureAll = async () => {
    if (actionInFlight.current) return;
    const targets = Array.from(
      new Set(
        agents
          .filter((a) => a.status !== "uninstalled")
          .map((a) => APPLY_TARGET_BY_CARD[a.id])
          .filter((t): t is BatchApplyTarget => Boolean(t)),
      ),
    );
    if (targets.length === 0) {
      toast.warning("未检测到已安装的 Agent，已为您打开环境检测");
      onOpenEnvironmentCheck();
      return;
    }

    // 必须使用 Bob API：未登录时记录意图并引导登录
    if (!authState.is_logged_in) {
      pendingConfigRef.current = { type: "all" };
      toast.info("一键配置所有 Agent 需要绑定您的 Bob API 账号，新用户登录立享体验额度", {
        description: "登录后将自动为各 Agent 分别写入专属分组令牌与推荐模型",
      });
      setLoginModalOpen(true);
      return;
    }

    // 打开矩阵批量连通性测试与部署终端
    setBatchSession(sessionRef.current);
    setBatchTargets(targets);
    setBatchModalOpen(true);
  };

  const installedCount = agents.filter((a) => a.status === "installed").length;
  const isConfiguringAny = Boolean(activeTerminalTarget) || batchModalOpen;

  return (
    // 窄窗口（< 900px）上下堆叠时整体可纵向滚动；≥ 900px 左右并排，由内部网格自行适配高度
    <div className="w-full h-full flex items-start [@media(min-width:900px)]:items-center justify-center min-h-0 select-none py-1 lg:py-2 px-1 sm:px-2 overflow-x-hidden overflow-y-auto">
      {/* ── 主视口全屏自适应画布：自适应居中对齐，高度严格 1:1 平齐 ── */}
      <div className="w-full [@media(min-width:900px)]:h-full max-w-[1360px] 2xl:max-w-[1480px] [@media(min-width:900px)]:max-h-[860px] flex flex-col [@media(min-width:900px)]:flex-row items-stretch gap-5 [@media(min-width:900px)_and_(max-width:1023px)]:gap-4 lg:gap-6 xl:gap-8 min-h-0 mx-auto">
        {/* ──── 左侧：通透沉浸 Hero 展台 (保留上方全部元素，无外层白底卡片托起) ──── */}
        <div className="w-full [@media(min-width:900px)_and_(max-width:1023px)]:w-[300px] lg:w-[380px] xl:w-[410px] 2xl:w-[440px] flex-shrink-0 flex flex-col justify-between gap-4 [@media(min-width:900px)]:h-full py-1.5 lg:py-2.5 select-none">
          {/* 上半部：3D 全息品牌 Logo 展台 + 核心标题 + 描述 + 特性微卡片 */}
          <div className="flex flex-col space-y-3.5 xl:space-y-4">
            {/* 3D 丝滑四形态相变全息体素展台 + 动态状态徽章 */}
            <VoxelMorphHero />

            {/* 主标题与描述 */}
            <div className="space-y-1 xl:space-y-1.5">
              <h1 className="text-2xl lg:text-[27px] xl:text-[29px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                一键接入你的 Agent
              </h1>
              <p className="text-xs xl:text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                原生打通主流 AI 客户端与模型网关，保持开发工作区会话连贯。
              </p>
            </div>

            {/* 核心特性交互微卡片 */}
            {/* 窗口高度 ≤ 640px 时隐藏这两张宣传卡片，把空间让给 Hero 与操作按钮 */}
            <div className="space-y-2.5 xl:space-y-3 pt-1 [@media(max-height:640px)]:hidden">
              {/* 特性 1：自动凭证与 Key 管理 */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                transition={{ duration: 0.18 }}
                className="group/item flex items-center gap-3 p-3 xl:p-3.5 rounded-2xl bg-white/75 dark:bg-slate-900/60 backdrop-blur-md border border-white/90 dark:border-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:border-sky-300/60 dark:hover:border-sky-400/30 transition-all cursor-default"
              >
                <div className="w-8 h-8 xl:w-9 xl:h-9 rounded-xl bg-sky-50 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0 group-hover/item:scale-105 transition-transform">
                  <FileText size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs xl:text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    自动注入账号令牌
                  </div>
                  <div className="text-[11px] xl:text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    读取已绑定的 Bob API 令牌写入各工具，免去手动复制
                  </div>
                </div>
              </motion.div>

              {/* 特性 2：原生工作区无损保留 */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                transition={{ duration: 0.18 }}
                className="group/item flex items-center gap-3 p-3 xl:p-3.5 rounded-2xl bg-white/75 dark:bg-slate-900/60 backdrop-blur-md border border-white/90 dark:border-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:border-purple-300/60 dark:hover:border-purple-400/30 transition-all cursor-default"
              >
                <div className="w-8 h-8 xl:w-9 xl:h-9 rounded-xl bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0 group-hover/item:scale-105 transition-transform">
                  <ShieldCheck size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs xl:text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    无损保留原工作区与历史会话
                  </div>
                  <div className="text-[11px] xl:text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    保障上下文连续性与安全隔离，即配即用
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* 下半部：矩阵就绪概览状态与操作按键组 (直接位于背景上，无外层白底托盘) */}
          <div className="space-y-3 pt-3">
            <div className="flex items-center justify-between text-[11px] xl:text-xs text-slate-500 dark:text-slate-400 px-1">
              <div className="flex items-center gap-1.5">
                <Cpu size={14} className="text-slate-400" />
                <span>已接入 {installedCount} / 6 席 Agent</span>
              </div>
              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 size={13} />
                <span>端侧沙盒加密</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleConfigureAll}
                disabled={isConfiguringAny || restartingAgentId !== null}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 xl:py-3 px-4 rounded-full bg-[#111827] hover:bg-black text-white text-xs xl:text-[13px] font-bold shadow-md shadow-black/15 transition-all duration-200 active:scale-95 cursor-pointer dark:bg-white dark:hover:bg-slate-100 dark:text-black disabled:opacity-50 group/btn"
              >
                {batchModalOpen ? (
                  <RefreshCw size={13} className="animate-spin text-white dark:text-black" />
                ) : (
                  <Sparkles size={13} className="text-white fill-white dark:text-black dark:fill-black group-hover/btn:rotate-12 transition-transform" />
                )}
                <span>一键配置所有</span>
              </button>

              <button
                type="button"
                onClick={onOpenEnvironmentCheck}
                className="px-5 xl:px-6 py-2.5 xl:py-3 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-700/80 dark:border-white/10 text-slate-800 dark:text-slate-200 text-xs xl:text-[13px] font-bold shadow-2xs transition-all duration-200 active:scale-95 cursor-pointer"
              >
                环境检测
              </button>
            </div>
          </div>
        </div>

        {/* ──── 右侧：2 列 × 3 行 纯白高质感 Agent 矩阵网格 (全屏大屏舒展对齐) ──── */}
        {/* 容器高度不足以容纳 3 行卡片（每行最小 160px）时，卡片区自身纵向滚动，保证按钮始终可达；
            p-2/-m-2 为卡片阴影与悬停位移预留空间，避免被滚动容器裁切 */}
        <div className="flex-1 min-w-0 min-h-0 p-2 -m-2 [@media(min-width:900px)]:overflow-y-auto">
          <div className="grid grid-cols-2 gap-3.5 xl:gap-4 w-full auto-rows-[minmax(160px,auto)] [@media(min-width:900px)]:h-full [@media(min-width:900px)]:min-h-[512px] [@media(min-width:900px)]:grid-rows-[repeat(3,minmax(160px,1fr))]">
            {agents.map((agent, idx) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={idx}
                onAction={handleCardAction}
                onRestart={(target) => void handleRestartAgent(target)}
                actionDisabled={
                  isConfiguringAny || restartingAgentId !== null
                }
                restartDisabled={isConfiguringAny || restartingAgentId !== null}
                restarting={restartingAgentId === agent.id}
                onOpenDetail={(target) => {
                  if (target.toolKey) {
                    onSelectTool(target.toolKey);
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── 单客户端连通性测试与配置终端模态框 ── */}
      {activeTerminalTarget && (
        <TerminalTestModal
          open={Boolean(activeTerminalTarget)}
          onClose={() => setActiveTerminalTarget(null)}
          type={activeTerminalTarget.type}
          url={activeTerminalTarget.url}
          apiKey={activeTerminalTarget.apiKey}
          model={activeTerminalTarget.model}
          cursorPayload={activeTerminalTarget.cursorPayload}
          accioPayload={activeTerminalTarget.accioPayload}
          workbuddyPayload={activeTerminalTarget.workbuddyPayload}
          isSessionCurrent={() =>
            mountedRef.current &&
            activeTerminalTarget.session === sessionRef.current
          }
          onSuccess={async () => {
            if (
              !activeTerminalTarget ||
              activeTerminalTarget.session !== sessionRef.current
            ) {
              return;
            }
            if (activeTerminalTarget.token) {
              const { token, target } = activeTerminalTarget;
              const bound = JSON.stringify({
                id: token.id,
                name: token.name,
                group: token.group ?? undefined,
              });
              try {
                localStorage.setItem(`bound_token_${target}`, bound);
              } catch {}
              window.dispatchEvent(
                new CustomEvent("ai_helper_sync_all_tokens", {
                  detail: {
                    id: token.id,
                    name: token.name,
                    group: token.group ?? undefined,
                    toolIds: [target],
                  },
                }),
              );
            }
            if (activeTerminalTarget?.target === "cursor") {
              try {
                const cfg = await getCursorConfig().catch(() => null);
                await patchCursorClient(
                  cfg?.cursor_path || undefined,
                  cfg?.bridge_port || 8969,
                );
              } catch (e) {
                console.warn("Cursor 自动补丁告警:", e);
              }
            }
            await refreshAgentStatuses();
          }}
        />
      )}

      {/* ── 矩阵批量一键配置与连通性测试终端模态框 ── */}
      {batchModalOpen && (
        <BatchTerminalModal
          open={batchModalOpen}
          onClose={() => setBatchModalOpen(false)}
          targets={batchTargets}
          onResolveKey={resolveApiKeyForTarget}
          isSessionCurrent={() =>
            mountedRef.current && batchSession !== null && batchSession === sessionRef.current
          }
          onSuccess={async () => {
            await refreshAgentStatuses();
          }}
        />
      )}
    </div>
  );
};

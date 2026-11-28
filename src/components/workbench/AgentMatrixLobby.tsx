import React, { useState, useEffect, useRef } from "react";
import { MousePointerClick, ShieldCheck, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { VoxelMorphHero } from "./VoxelMorphHero";
import { AgentCard, type AgentCardItem, type CardPhase } from "./AgentCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { TerminalTestModal } from "../TerminalTestModal";
import { BatchTerminalModal, type BatchApplyTarget } from "./BatchTerminalModal";
import {
  ClaudeCliIcon,
  CodexCliIcon,
  CursorIcon,
  WorkbuddyIcon,
  AccioWorkIcon,
  DeepSeekHarnessIcon,
} from "../BrandIcons";
import {
  detectAllAppPaths,
  getAppPaths,
  getClaudeConfig,
  getCodexConfig,
  getCursorConfig,
  getWorkbuddyConfig,
  getAccioConfig,
  getDshConfig,
  startAccioBridge,
  startCursorBridge,
  getAccioBridgeStatus,
  checkAppProcessStatus,
  getCursorBridgeStatus,
  getCursorPatchStatus,
  patchCursorClient,
  ensureUserToken,
  restartTargetApp,
  openUrl,
  previewClientRestore,
  restoreClientToOfficial,
  type ResetClient,
} from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import type {
  AgentTool,
  TokenItem,
  CursorConfig,
  AccioConfig,
  WorkbuddySavePayload,
  DshSavePayload,
} from "../../types";
import {
  buildDshQuickPayload,
  dshBindingToolId,
  DSH_QUICK_GROUP,
  DSH_QUICK_MODEL,
} from "../../lib/dshQuickPayload";

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

// 首屏主推的两款软件；其余收在「更多软件」里
const PRIMARY_CARD_IDS = ["workbuddy-app", "accio-work"];
const MORE_EXPANDED_KEY = "ai_helper_more_apps_expanded";
const LAST_CONFIGURED_KEY = "ai_helper_last_configured_card";

// 卡片 → 后端恢复模块的客户端名称
const RESET_CLIENT_BY_CARD: Record<string, ResetClient> = {
  "claude-cli": "Claude Code",
  "codex-cli": "Codex / ChatGPT",
  "cursor-ide": "Cursor",
  "workbuddy-app": "WorkBuddy",
  "accio-work": "Accio Work",
  "dsh-app": "DeepSeek Harness",
};

// 未安装时直接跳到官网下载的软件；其余沿用应用内的安装引导
const OFFICIAL_DOWNLOAD_URL: Record<string, string> = {
  "workbuddy-app": "https://www.workbuddy.cn/",
  "accio-work": "https://www.accio.com/work",
  "cursor-ide": "https://cursor.com/download",
};

// 恢复为官方时，确认框里用一句话说清楚会清理什么、保留什么
const RESTORE_SUMMARY: Record<string, string> = {
  "workbuddy-app": "会移除 AI Helper 添加的模型，你自己添加的模型会保留。",
  "accio-work":
    "会停止本地连接服务，并删除 AI Helper 为它保存的设置。Accio Work 的账号、会话和技能不受影响。",
  "cursor-ide":
    "会还原 Cursor 的接入、停止本地连接服务，并删除 AI Helper 为它保存的设置。Cursor 自己的设置不受影响。",
  "claude-cli": "会移除 AI Helper 写入的服务地址、认证和模型，其他偏好会保留。之后需要用 /login 登录。",
  "codex-cli":
    "会移除 AI Helper 写入的服务商、密钥和模型，账号、会话和项目会保留。之后需要用 ChatGPT 账号登录。",
  "dsh-app": "会移除 AI Helper 管理的模型路由和密钥，官方账号和你自建的路由会保留。",
};

function readLastConfiguredCard(): string | null {
  try {
    return localStorage.getItem(LAST_CONFIGURED_KEY);
  } catch {
    return null;
  }
}

// 卡片 → 后端 apply_api_key_to_agents 的写入目标（ChatGPT 桌面端无需写配置，不在此列）
type ApplyTarget = "claude" | "chatgpt" | "cursor" | "workbuddy" | "acciowork" | "dsh";
type RestartTarget =
  | "claude"
  | "codex"
  | "chatgpt"
  | "cursor"
  | "workbuddy"
  | "acciowork"
  | "dsh";

const APPLY_TARGET_BY_CARD: Record<string, ApplyTarget> = {
  "claude-cli": "claude",
  "codex-cli": "chatgpt",
  "cursor-ide": "cursor",
  "workbuddy-app": "workbuddy",
  "accio-work": "acciowork",
  "dsh-app": "dsh",
};

const RESTART_TARGET_BY_CARD: Record<string, RestartTarget> = {
  "claude-cli": "claude",
  // ChatGPT 桌面端与 Codex 合为一张卡：装了桌面端就打开桌面端，否则打开命令行
  "codex-cli": "codex",
  "cursor-ide": "cursor",
  "workbuddy-app": "workbuddy",
  "accio-work": "acciowork",
  "dsh-app": "dsh",
};

// 各客户端默认分组与推荐模型配置
const TARGET_DEFAULT_GROUP: Record<ApplyTarget, string> = {
  claude: "CC-Kiro-Max",
  chatgpt: "Codex-不降质",
  cursor: "国产Token计划",
  workbuddy: "国产Token计划",
  acciowork: "国产Token计划",
  // DeepSeek Harness 一键配置自动挑选令牌的推荐分组；写入该 Key 可用的全部模型
  dsh: DSH_QUICK_GROUP,
};

const TARGET_DEFAULT_MODEL: Record<ApplyTarget, string> = {
  claude: "claude-sonnet-5-5",
  chatgpt: "gpt-5.6-sol",
  cursor: "glm-5.3",
  workbuddy: "glm-5.3",
  acciowork: "glm-5.3",
  dsh: DSH_QUICK_MODEL,
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
  const [openingAgentId, setOpeningAgentId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // 每张卡片当前配置任务的进度（进行中 / 失败待重试）
  const [cardPhase, setCardPhase] = useState<Record<string, CardPhase | undefined>>({});
  // 是否展开本次配置的完整技术日志
  const [detailsVisible, setDetailsVisible] = useState(false);
  const detailsVisibleRef = useRef(false);
  detailsVisibleRef.current = detailsVisible;
  const runIdRef = useRef(0);
  const isWorkingRef = useRef(false);
  isWorkingRef.current = Object.values(cardPhase).some((phase) => phase?.kind === "working");
  const chatgptAppExistsRef = useRef(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    note?: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);
  // null = 用户没有手动展开或收起过，按是否已有配置决定
  const [moreExpanded, setMoreExpanded] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(MORE_EXPANDED_KEY);
      return saved === null ? null : saved === "true";
    } catch {
      return null;
    }
  });

  // 单卡片类终端连通性测试模态框状态
  const [activeTerminalTarget, setActiveTerminalTarget] = useState<{
    type: "codex" | "claude" | "workbuddy" | "acciowork" | "cursor" | "dsh";
    target: ApplyTarget;
    /** 发起这次配置的卡片，用于在卡片内显示进度与结果 */
    cardId: string;
    cardName: string;
    /** 每次配置递增，保证重试时重新执行测试 */
    runId: number;
    url: string;
    apiKey: string;
    model: string;
    token: TokenItem | null;
    session: number;
    cursorPayload?: CursorConfig;
    accioPayload?: AccioConfig;
    workbuddyPayload?: WorkbuddySavePayload;
    dshPayload?: DshSavePayload;
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
    // 账号或会话已切换：旧会话的配置进度不再有效
    setCardPhase({});
    setBatchModalOpen(false);
  }, [authSessionGeneration]);

  // 首页软件卡片：WorkBuddy 与 Accio Work 是首屏主卡，其余收在「更多软件」
  const [agents, setAgents] = useState<AgentCardItem[]>(() => [
    {
      id: "workbuddy-app",
      name: "WorkBuddy",
      subtitle: "腾讯的办公 AI 助手",
      category: "desktop",
      icon: WorkbuddyIcon,
      status: cachedAgentsStatusMap?.["workbuddy-app"] ?? "unconfigured",
      toolKey: "workbuddy",
      modelFamily: "国产",
      doneHint: "在输入框的模型列表里，从自定义模型分组选它",
      configuredKey: cachedAgentsConfigMap?.["workbuddy-app"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["workbuddy-app"]?.model ?? null,
    },
    {
      id: "accio-work",
      name: "Accio Work",
      subtitle: "阿里国际站的跨境生意助手",
      category: "desktop",
      icon: AccioWorkIcon,
      status: cachedAgentsStatusMap?.["accio-work"] ?? "unconfigured",
      toolKey: "acciowork",
      modelFamily: "国产",
      doneHint: "要用国产模型，请从这里打开 Accio Work",
      configuredKey: cachedAgentsConfigMap?.["accio-work"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["accio-work"]?.model ?? null,
    },
    {
      id: "claude-cli",
      installLabel: "查看安装方法",
      name: "Claude Code",
      subtitle: "Anthropic 的命令行编程助手",
      category: "cli",
      icon: ClaudeCliIcon,
      status: cachedAgentsStatusMap?.["claude-cli"] ?? "unconfigured",
      toolKey: "claude",
      modelFamily: "Claude",
      configuredKey: cachedAgentsConfigMap?.["claude-cli"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["claude-cli"]?.model ?? null,
    },
    {
      id: "codex-cli",
      installLabel: "查看安装方法",
      name: "ChatGPT（含 Codex）",
      subtitle: "OpenAI 的桌面端与命令行",
      category: "desktop",
      icon: CodexCliIcon,
      status: cachedAgentsStatusMap?.["codex-cli"] ?? "unconfigured",
      toolKey: "chatgpt",
      modelFamily: "GPT",
      configuredKey: cachedAgentsConfigMap?.["codex-cli"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["codex-cli"]?.model ?? null,
    },
    {
      id: "cursor-ide",
      name: "Cursor",
      subtitle: "AI 代码编辑器",
      category: "ide",
      icon: CursorIcon,
      status: cachedAgentsStatusMap?.["cursor-ide"] ?? "unconfigured",
      toolKey: "cursor",
      modelFamily: "国产",
      configuredKey: cachedAgentsConfigMap?.["cursor-ide"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["cursor-ide"]?.model ?? null,
    },
    {
      id: "dsh-app",
      installLabel: "查看安装方法",
      name: "DeepSeek Harness",
      subtitle: "DeepSeek 的桌面工作台",
      category: "desktop",
      icon: DeepSeekHarnessIcon,
      status: cachedAgentsStatusMap?.["dsh-app"] ?? "unconfigured",
      toolKey: "dsh",
      modelFamily: "国产",
      configuredKey: cachedAgentsConfigMap?.["dsh-app"]?.key ?? null,
      configuredModel: cachedAgentsConfigMap?.["dsh-app"]?.model ?? null,
    },
  ]);

  // 初始化探测各个真实本地 AI 工具的安装与配置状态
  // 返回仍「差一步」的卡片 id，供配置完成后判断能否报告成功
  const refreshAgentStatuses = async (): Promise<string[]> => {
    try {
      const [
        allPathsRes,
        savedPathsRes,
        claudeCfgRes,
        codexCfgRes,
        cursorCfgRes,
        workbuddyCfgRes,
        accioCfgRes,
        dshCfgRes,
      ] = await Promise.allSettled([
        detectAllAppPaths(),
        getAppPaths(),
        getClaudeConfig(),
        getCodexConfig(),
        getCursorConfig(),
        getWorkbuddyConfig(),
        getAccioConfig(),
        getDshConfig(),
      ]);

      const pathMap: Record<string, { exists: boolean; path: string; running: boolean }> = {};
      if (allPathsRes.status === "fulfilled" && Array.isArray(allPathsRes.value)) {
        for (const p of allPathsRes.value) {
          pathMap[p.app_type] = { exists: p.exists, path: p.path, running: Boolean(p.is_running) };
        }
      }
      const isRunning = (appType: string) => Boolean(pathMap[appType]?.running);

      const savedPaths = savedPathsRes.status === "fulfilled" ? savedPathsRes.value : null;
      const claudeCfg = claudeCfgRes.status === "fulfilled" ? claudeCfgRes.value : null;
      const codexCfg = codexCfgRes.status === "fulfilled" ? codexCfgRes.value : null;
      const cursorCfg = cursorCfgRes.status === "fulfilled" ? cursorCfgRes.value : null;
      const workbuddyCfg = workbuddyCfgRes.status === "fulfilled" ? workbuddyCfgRes.value : null;
      const accioCfg = accioCfgRes.status === "fulfilled" ? accioCfgRes.value : null;
      const dshCfg = dshCfgRes.status === "fulfilled" ? dshCfgRes.value : null;

      // 配置已保存、但本地连接没有就绪时，卡片如实提示并给出重试入口，
      // 不能只显示「已配置」。读不到状态时不下结论。
      let cursorAttention: AgentCardItem["attention"] = null;
      if (cursorCfg?.api_key?.trim()) {
        const [bridge, patch] = await Promise.all([
          getCursorBridgeStatus().catch(() => null),
          getCursorPatchStatus(cursorCfg.cursor_path || undefined).catch(() => null),
        ]);
        if (bridge && patch?.is_installed && (!bridge.is_running || !patch.is_patched)) {
          cursorAttention = {
            text: "模型已保存，但 Cursor 的连接还没有就绪",
            actionLabel: "重试连接",
          };
        }
      }
      let accioAttention: AgentCardItem["attention"] = null;
      if (accioCfg?.api_key?.trim() && pathMap["acciowork"]?.exists) {
        const bridge = await getAccioBridgeStatus().catch(() => null);
        if (bridge && !bridge.is_running) {
          accioAttention = {
            text: "连接服务没有开着，Accio Work 暂时用不了国产模型",
            actionLabel: "重试连接",
          };
        }
      }

      setAgents((prev) => {
        const next = prev.map((item) => {
          if (item.id === "claude-cli") {
            const hasKey = Boolean(claudeCfg?.api_key && claudeCfg.api_key.trim());
            const exists = Boolean(pathMap["claude"]?.exists || claudeCfg?.is_installed);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              appExists: exists,
              running: isRunning("claude"),
              configuredKey: claudeCfg?.api_key?.trim() || null,
              configuredModel: claudeCfg?.model?.trim() || null,
            };
          }
          if (item.id === "codex-cli") {
            // ChatGPT 桌面端与 Codex 命令行共用同一份 Codex 配置，合为一张卡
            const hasKey = Boolean(codexCfg?.api_key && codexCfg.api_key.trim());
            const savedChatgpt = savedPaths?.chatgpt_client_path;
            chatgptAppExistsRef.current = Boolean(
              pathMap["chatgpt"]?.exists || (savedChatgpt && savedChatgpt.trim()),
            );
            const exists = Boolean(
              pathMap["chatgpt"]?.exists ||
                (savedChatgpt && savedChatgpt.trim()) ||
                pathMap["codex"]?.exists ||
                codexCfg?.is_installed,
            );
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
              appExists: exists,
              running: isRunning("chatgpt") || isRunning("codex"),
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
              appExists: exists,
              running: isRunning("cursor"),
              attention: cursorAttention,
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
              appExists: exists,
              running: isRunning("workbuddy"),
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
              appExists: exists,
              running: isRunning("acciowork"),
              attention: accioAttention,
              configuredKey: accioCfg?.api_key?.trim() || null,
              configuredModel: accioCfg?.model?.trim() || null,
            };
          }
          if (item.id === "dsh-app") {
            // 任一 AI Helper 分组路由已写入即视为已接入；卡片优先展示一键配置所写的国产分组 Key
            const routes = dshCfg?.routes ?? [];
            const configured = routes.filter((r) => r.configured && r.api_key.trim());
            const primary = configured.find((r) => r.kind === "domestic") ?? configured[0];
            const exists = Boolean(pathMap["dsh"]?.exists || dshCfg?.is_installed);
            const managedDefault = dshCfg?.default_model?.provider.startsWith("aihelper-")
              ? dshCfg.default_model.model
              : null;
            return {
              ...item,
              status: (configured.length > 0
                ? "installed"
                : exists
                  ? "unconfigured"
                  : "uninstalled") as AgentCardItem["status"],
              appExists: exists,
              running: isRunning("dsh"),
              configuredKey: primary?.api_key?.trim() || null,
              configuredModel: managedDefault || primary?.models[0] || null,
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
      return [
        ...(cursorAttention ? ["cursor-ide"] : []),
        ...(accioAttention ? ["accio-work"] : []),
      ];
    } catch (e) {
      console.warn("探测软件状态异常:", e);
      return [];
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
      toast.success("登录成功，正在接着配置…");
      if (pending.type === "single") {
        void handleCardAction(pending.agent);
      } else if (pending.type === "all") {
        void handleConfigureAll();
      }
    }
  }, [authState.is_logged_in, authSessionGeneration]);

  // 点卡片上的「一键配置模型」：选定这款软件，其余全部自动完成
  const handleCardAction = async (agent: AgentCardItem) => {
    const target = APPLY_TARGET_BY_CARD[agent.id];
    if (!target) {
      if (agent.toolKey) onSelectTool(agent.toolKey);
      return;
    }

    // 需要 Bob API 账号：未登录时记下意图，登录完成后自动接着配置这款软件
    if (!authState.is_logged_in) {
      pendingConfigRef.current = { type: "single", agent };
      toast.info("先登录 Bob API 账号", {
        description: `登录后会自动接着配置 ${agent.name}`,
      });
      setLoginModalOpen(true);
      return;
    }

    if (actionInFlight.current || isWorkingRef.current || batchModalOpen) return;
    const requestSession = sessionRef.current;
    actionInFlight.current = true;
    // 上一次任务的技术日志随之丢弃，其他卡片残留的失败提示也一并清掉
    setDetailsVisible(false);
    setActiveTerminalTarget(null);
    setCardPhase({ [agent.id]: { kind: "working", text: "正在准备…" } });
    const clearPhase = () => setCardPhase((prev) => ({ ...prev, [agent.id]: undefined }));

    try {
      const resolved = await resolveApiKeyForTarget(target);
      if (!mountedRef.current || requestSession !== sessionRef.current) {
        clearPhase();
        return;
      }
      if (!resolved) {
        setCardPhase((prev) => ({
          ...prev,
          [agent.id]: { kind: "failed", text: "没能从你的账号准备好密钥，请稍后重试" },
        }));
        return;
      }


      // 映射到 TerminalTestModal 对应的 target type
      const modalType: "codex" | "claude" | "workbuddy" | "acciowork" | "cursor" | "dsh" =
        target === "chatgpt" ? "codex" : target;
      const defaultModel = TARGET_DEFAULT_MODEL[target];

      let targetUrl =
        target === "workbuddy" ? "https://bob-api.com/v1" : "https://bob-api.com/";

      let cursorPayload: CursorConfig | undefined;
      let accioPayload: AccioConfig | undefined;
      let workbuddyPayload: WorkbuddySavePayload | undefined;
      let dshPayload: DshSavePayload | undefined;

      if (modalType === "dsh") {
        const built = await buildDshQuickPayload(resolved.key, defaultModel);
        targetUrl = built.url;
        dshPayload = built.payload;
        if (built.fetchError) {
          toast.warning("没能获取可用的模型列表，将沿用已有模型", {
            description: built.fetchError,
          });
        }
        if (built.keptDefault) {
          toast.info("已保留 DeepSeek Harness 当前的默认模型", {
            description: `${built.keptDefault}；新写入的模型可在模型选择器中随时切换使用`,
          });
        }
      } else if (modalType === "cursor") {
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
          max_input_tokens: 262144,
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

      if (!mountedRef.current || requestSession !== sessionRef.current) {
        clearPhase();
        return;
      }

      // 测试与写入在后台安静执行，卡片显示一句进度
      runIdRef.current += 1;
      setDetailsVisible(false);
      setCardPhase((prev) => ({
        ...prev,
        [agent.id]: { kind: "working", text: "正在检查模型能不能用…" },
      }));
      setActiveTerminalTarget({
        type: modalType,
        target,
        cardId: agent.id,
        cardName: agent.name,
        runId: runIdRef.current,
        url: targetUrl,
        apiKey: resolved.key,
        model: defaultModel,
        token: resolved.token,
        session: requestSession,
        cursorPayload,
        accioPayload,
        workbuddyPayload,
        dshPayload,
      });
    } catch (err) {
      // 原始错误含技术细节，只进日志；卡片上用白话
      console.warn(`${agent.name} 配置准备失败`, err);
      if (!mountedRef.current || requestSession !== sessionRef.current) {
        clearPhase();
      } else {
        setCardPhase((prev) => ({
          ...prev,
          [agent.id]: { kind: "failed", text: "没能从你的账号准备好密钥，请稍后重试" },
        }));
      }
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
   * - DeepSeek Harness: 国产Token计划 (默认模型: deepseek-v4.1-flash，写入该分组全部可对话模型)
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
      const token = await ensureUserToken(
        tokenName,
        targetGroup,
        readBoundTokenId(dshBindingToolId(target)),
      );
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

  /** 这张卡片实际会打开的程序：合并卡装了桌面端就开桌面端，否则开命令行。 */
  const restartTargetFor = (agent: AgentCardItem): RestartTarget | undefined =>
    agent.id === "codex-cli"
      ? chatgptAppExistsRef.current
        ? "chatgpt"
        : "codex"
      : RESTART_TARGET_BY_CARD[agent.id];

  /** 打开（或重新打开）这款软件，不影响其他软件。 */
  const openApp = async (agent: AgentCardItem) => {
    if (openingAgentId || actionInFlight.current) return;
    const appType = restartTargetFor(agent);
    if (!appType) return;

    actionInFlight.current = true;
    setOpeningAgentId(agent.id);
    try {
      let customPath: string | undefined;
      if (agent.id === "cursor-ide") {
        const cfg = await getCursorConfig();
        // cfg.app_path 是安装根目录，并非可执行文件；未手动指定时交给后端解析
        customPath = cfg.cursor_path || undefined;
        if (cfg.api_key.trim()) {
          const port = await startCursorBridge(cfg.bridge_port);
          // 连接服务若曾自动换端口，打开前同步实际地址
          const patch = await getCursorPatchStatus(customPath);
          if (patch.is_patched && patch.current_bridge_target !== `http://127.0.0.1:${port}`) {
            await patchCursorClient(customPath, port);
          }
        }
      } else if (agent.id === "accio-work") {
        const cfg = await getAccioConfig();
        if (cfg.api_key.trim()) await startAccioBridge(cfg.bridge_port);
      }

      await restartTargetApp(appType, customPath);
      toast.success(`已打开 ${agent.name}`);
    } catch (error) {
      console.warn(`打开 ${agent.name} 失败`, error);
      toast.error(`${agent.name} 没能打开`, { description: String(error) });
    } finally {
      actionInFlight.current = false;
      if (mountedRef.current) {
        setOpeningAgentId(null);
        void refreshAgentStatuses();
      }
    }
  };

  /** 软件正开着时，重新打开会先关闭它：先让用户确认，避免丢失手头的工作。 */
  const handleOpenApp = async (agent: AgentCardItem) => {
    const appType = restartTargetFor(agent);
    if (!appType || openingAgentId || actionInFlight.current) return;
    // 卡片上的运行状态可能已过期（只在窗口聚焦后刷新），点击时现查一次；
    // 查的是实际会被重启的那个程序（合并卡可能是桌面端，也可能是命令行）
    const running = await checkAppProcessStatus(appType).catch(() => Boolean(agent.running));
    if (!mountedRef.current) return;
    if (!running) {
      void openApp(agent);
      return;
    }
    const label =
      agent.id === "codex-cli" ? (appType === "chatgpt" ? "ChatGPT 桌面端" : "Codex") : agent.name;
    setConfirm({
      title: `重新打开 ${label}？`,
      body: `会先关闭正在运行的 ${label}，再重新打开。请先保存手头的工作。`,
      confirmLabel: "重新打开",
      run: () => void openApp(agent),
    });
  };

  /** 未安装：主推软件直接去官网下载，其余沿用应用内的安装引导。 */
  const handleInstall = async (agent: AgentCardItem) => {
    const url = OFFICIAL_DOWNLOAD_URL[agent.id];
    if (url) {
      const opened = await openUrl(url).catch(() => false);
      if (!opened) {
        toast.error("没能打开浏览器", { description: `请手动访问 ${url}` });
      }
      return;
    }
    if (agent.id === "codex-cli" && onOpenAppInstaller) {
      onOpenAppInstaller("chatgpt");
    } else if (agent.toolKey) {
      onSelectTool(agent.toolKey);
    } else {
      onOpenEnvironmentCheck();
    }
  };

  /** 配置已保存、但本地连接没有就绪：重新启动连接服务并接入。 */
  const handleResolveAttention = async (agent: AgentCardItem) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setOpeningAgentId(agent.id);
    try {
      if (agent.id === "cursor-ide") {
        const cfg = await getCursorConfig();
        const port = await startCursorBridge(cfg.bridge_port);
        await patchCursorClient(cfg.cursor_path || undefined, port);
      } else if (agent.id === "accio-work") {
        const cfg = await getAccioConfig();
        await startAccioBridge(cfg.bridge_port);
      }
      toast.success(`${agent.name} 的连接已就绪`);
    } catch (error) {
      toast.error(`${agent.name} 还是没连上`, { description: String(error) });
    } finally {
      actionInFlight.current = false;
      if (mountedRef.current) {
        setOpeningAgentId(null);
        void refreshAgentStatuses();
      }
    }
  };

  /** 只把这一款软件恢复为官方。先预览，再让用户确认一次。 */
  const restoreToOfficial = async (agent: AgentCardItem, client: ResetClient) => {
    // 恢复与配置不能并发：两者都会改同一款软件的设置
    if (restoringId || actionInFlight.current || isWorkingRef.current) return;
    setRestoringId(agent.id);
    try {
      const result = await restoreClientToOfficial(client);
      const outcome = result.clients.find((item) => item.client === client);
      if (!outcome || outcome.status === "failed") {
        toast.error(`${agent.name} 没能恢复为官方`, {
          description: outcome?.message ?? "没有收到恢复结果，原来的设置没有变",
        });
      } else {
        toast.success(`${agent.name} 已恢复为官方`, { description: outcome.message });
        // 设置确已清理后才解除本地记录的密钥绑定；失败时配置原样保留
        try {
          localStorage.removeItem(
            `bound_token_${dshBindingToolId(APPLY_TARGET_BY_CARD[agent.id])}`,
          );
        } catch {}
      }
      for (const warning of result.warnings.slice(0, 2)) {
        toast.warning(warning);
      }
    } catch (error) {
      toast.error(`${agent.name} 没能恢复为官方`, { description: String(error) });
    } finally {
      if (mountedRef.current) {
        setRestoringId(null);
        setCardPhase((prev) => ({ ...prev, [agent.id]: undefined }));
        void refreshAgentStatuses();
      }
    }
  };

  const handleRestore = async (agent: AgentCardItem) => {
    const client = RESET_CLIENT_BY_CARD[agent.id];
    if (!client || restoringId || actionInFlight.current || isWorkingRef.current) return;
    let note: string | undefined;
    // 预览期间占住操作标记，避免此时又点了「一键配置」
    actionInFlight.current = true;
    try {
      const preview = await previewClientRestore(client);
      const plan = preview.clients.find((item) => item.client === client);
      if (plan?.action === "skip") note = plan.reason;
    } catch (error) {
      toast.error("没能检查要恢复的内容", { description: String(error) });
      return;
    } finally {
      actionInFlight.current = false;
    }
    if (!mountedRef.current) return;
    setConfirm({
      title: `把 ${agent.name} 恢复为官方？`,
      body: RESTORE_SUMMARY[agent.id] ?? "会移除 AI Helper 为它写入的设置。",
      note,
      confirmLabel: "恢复为官方",
      run: () => void restoreToOfficial(agent, client),
    });
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
      toast.warning("没有检测到已安装的软件，已打开电脑环境检查");
      onOpenEnvironmentCheck();
      return;
    }

    // 必须使用 Bob API：未登录时记录意图并引导登录
    if (!authState.is_logged_in) {
      pendingConfigRef.current = { type: "all" };
      toast.info("先登录 Bob API 账号", {
        description: "登录后会自动接着配置已安装的全部软件",
      });
      setLoginModalOpen(true);
      return;
    }

    // 打开矩阵批量连通性测试与部署终端
    setBatchSession(sessionRef.current);
    setBatchTargets(targets);
    setBatchModalOpen(true);
  };

  const configuredCount = agents.filter((a) => a.status === "installed").length;
  const isWorking = Object.values(cardPhase).some((phase) => phase?.kind === "working");
  const isBusy = isWorking || batchModalOpen || openingAgentId !== null || restoringId !== null;

  // 主卡排序：本机已安装的在前；都已安装时，最近配置过的在前
  const lastConfigured = readLastConfiguredCard();
  const rank = (agent: AgentCardItem) =>
    (agent.appExists ? 0 : 2) + (agent.id === lastConfigured ? 0 : 1);
  const primaryAgents = agents
    .filter((agent) => PRIMARY_CARD_IDS.includes(agent.id))
    .sort((a, b) => rank(a) - rank(b));
  const moreAgents = agents.filter((agent) => !PRIMARY_CARD_IDS.includes(agent.id));
  // 「更多软件」默认收起；其中已有配置好的软件时默认展开，避免老用户找不到
  const moreOpen = moreExpanded ?? moreAgents.some((agent) => agent.status === "installed");

  const openAdvanced = (target: AgentCardItem) => {
    if (target.toolKey) onSelectTool(target.toolKey);
  };

  const renderCard = (agent: AgentCardItem, idx: number, size: "primary" | "compact") => (
    <AgentCard
      key={agent.id}
      agent={agent}
      index={idx}
      size={size}
      phase={cardPhase[agent.id] ?? null}
      disabled={isBusy}
      opening={openingAgentId === agent.id}
      restoring={restoringId === agent.id}
      onConfigure={(target) => void handleCardAction(target)}
      onOpenApp={(target) => void handleOpenApp(target)}
      onInstall={(target) => void handleInstall(target)}
      onRestore={(target) => void handleRestore(target)}
      onResolveAttention={(target) => void handleResolveAttention(target)}
      onShowDetails={
        activeTerminalTarget?.cardId === agent.id ? () => setDetailsVisible(true) : undefined
      }
      // 配置进行中不进入高级设置：离开首页会让正在执行的任务失去界面
      onOpenAdvanced={isWorking ? undefined : openAdvanced}
    />
  );

  return (
    // 窄窗口（< 900px）上下堆叠时整体可纵向滚动；≥ 900px 左右并排
    <div className="w-full h-full flex items-start [@media(min-width:900px)]:items-center justify-center min-h-0 select-none py-1 lg:py-2 px-1 sm:px-2 overflow-x-hidden overflow-y-auto">
      <div className="w-full [@media(min-width:900px)]:h-full max-w-[1360px] 2xl:max-w-[1480px] [@media(min-width:900px)]:max-h-[860px] flex flex-col [@media(min-width:900px)]:flex-row items-stretch gap-5 [@media(min-width:900px)_and_(max-width:1023px)]:gap-4 lg:gap-6 xl:gap-8 min-h-0 mx-auto">
        {/* ──── 左侧：一句话说明这款工具做什么 ──── */}
        <div className="w-full [@media(min-width:900px)_and_(max-width:1023px)]:w-[300px] lg:w-[380px] xl:w-[410px] 2xl:w-[440px] flex-shrink-0 flex flex-col justify-between gap-4 [@media(min-width:900px)]:h-full py-1.5 lg:py-2.5 select-none">
          <div className="flex flex-col space-y-3.5 xl:space-y-4">
            <VoxelMorphHero />

            <div className="space-y-1 xl:space-y-1.5">
              <h1 className="text-2xl lg:text-[27px] xl:text-[29px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                你想在哪个软件里用模型？
              </h1>
              <p className="text-xs xl:text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                在右边选一款软件，点一次就配好。配好后回到你常用的软件里直接用。
              </p>
            </div>

            {/* 窗口高度 ≤ 640px 时隐藏这两张说明卡片，把空间让给卡片区 */}
            <div className="space-y-2.5 xl:space-y-3 pt-1 [@media(max-height:640px)]:hidden">
              <div className="flex items-center gap-3 p-3 xl:p-3.5 rounded-2xl bg-white/75 dark:bg-slate-900/60 backdrop-blur-md border border-white/90 dark:border-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.02)]">
                <div className="w-8 h-8 xl:w-9 xl:h-9 rounded-xl bg-sky-50 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
                  <MousePointerClick size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs xl:text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    不用填任何东西
                  </div>
                  <div className="text-[11px] xl:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    用你的 Bob API 账号自动完成，先检查能用再保存
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 xl:p-3.5 rounded-2xl bg-white/75 dark:bg-slate-900/60 backdrop-blur-md border border-white/90 dark:border-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.02)]">
                <div className="w-8 h-8 xl:w-9 xl:h-9 rounded-xl bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs xl:text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    随时可以恢复为官方
                  </div>
                  <div className="text-[11px] xl:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    修改前会先备份，每款软件都能单独恢复
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 高级入口：批量配置与环境检查不再占据首页主操作 */}
          <div className="flex items-center justify-between gap-3 text-[11px] xl:text-xs text-slate-500 dark:text-slate-400 px-1 pt-3">
            <span>已配置 {configuredCount} 款软件</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleConfigureAll}
                disabled={isBusy}
                className="hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                全部配置
              </button>
              <button
                type="button"
                onClick={onOpenEnvironmentCheck}
                className="hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-2 cursor-pointer"
              >
                检查电脑环境
              </button>
            </div>
          </div>
        </div>

        {/* ──── 右侧：两张主卡 + 「更多软件」 ──── */}
        {/* p-2/-m-2 为卡片阴影预留空间；放不下时卡片区自身纵向滚动，按钮不会被裁切 */}
        <div className="flex-1 min-w-0 min-h-0 p-2 -m-2 [@media(min-width:900px)]:overflow-y-auto flex flex-col gap-3.5 xl:gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 xl:gap-4 w-full">
            {primaryAgents.map((agent, idx) => renderCard(agent, idx, "primary"))}
          </div>

          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => {
              const next = !moreOpen;
              setMoreExpanded(next);
              try {
                localStorage.setItem(MORE_EXPANDED_KEY, String(next));
              } catch {}
            }}
            className="flex items-center gap-1.5 self-start px-1 text-xs xl:text-[13px] font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer transition-colors"
          >
            <ChevronDown
              size={14}
              className={moreOpen ? "transition-transform" : "-rotate-90 transition-transform"}
            />
            <span>更多软件（{moreAgents.length}）</span>
          </button>

          {moreOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 xl:gap-4 w-full">
              {moreAgents.map((agent, idx) =>
                renderCard(agent, idx + primaryAgents.length, "compact"),
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 单款软件的测试与写入：默认在后台安静执行，卡片显示一句进度；
          「查看详情」时才展开完整技术日志 ── */}
      {activeTerminalTarget && (
        <TerminalTestModal
          key={activeTerminalTarget.runId}
          open
          quiet={!detailsVisible}
          onClose={() => {
            setDetailsVisible(false);
            setActiveTerminalTarget(null);
          }}
          type={activeTerminalTarget.type}
          url={activeTerminalTarget.url}
          apiKey={activeTerminalTarget.apiKey}
          model={activeTerminalTarget.model}
          cursorPayload={activeTerminalTarget.cursorPayload}
          accioPayload={activeTerminalTarget.accioPayload}
          workbuddyPayload={activeTerminalTarget.workbuddyPayload}
          dshPayload={activeTerminalTarget.dshPayload}
          // 只判断账号会话是否仍是发起时的那个。用户中途切到别的页面时任务照常
          // 完成写入与连接服务启动，回到首页即可看到结果；不能因为页面卸载就静默中止
          isSessionCurrent={() => activeTerminalTarget.session === sessionRef.current}
          onFailure={(message) => {
            const { cardId } = activeTerminalTarget;
            setCardPhase((prev) => ({
              ...prev,
              [cardId]: { kind: "failed", text: message },
            }));
          }}
          onSuccess={async () => {
            if (activeTerminalTarget.session !== sessionRef.current) return;
            const { cardId, cardName, token } = activeTerminalTarget;
            if (token) {
              const target = dshBindingToolId(activeTerminalTarget.target);
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
            try {
              localStorage.setItem(LAST_CONFIGURED_KEY, cardId);
            } catch {}

            let connected = true;
            if (activeTerminalTarget.target === "cursor") {
              try {
                const cfg = await getCursorConfig().catch(() => null);
                await patchCursorClient(cfg?.cursor_path || undefined, cfg?.bridge_port || 8969);
              } catch (e) {
                // 接入失败不能当作成功：模型已保存，但 Cursor 还用不上
                connected = false;
                console.warn("Cursor 接入失败:", e);
                toast.error("模型已保存，但 Cursor 的连接还没有就绪", {
                  description: `点卡片上的「重试连接」再试一次。${String(e)}`,
                });
              }
            }
            // 首次配置成功即视为完成初始化（原先由启动向导写入，售后群提示依赖它）
            try {
              localStorage.setItem("ai_helper_init_completed", "true");
            } catch {}
            const needsAttention = await refreshAgentStatuses();
            // 本地连接服务没起来时不能报告成功：卡片会显示「差一步」
            if (needsAttention.includes(cardId)) {
              if (connected) {
                toast.warning(`${cardName} 的模型已保存，但连接还没有就绪`, {
                  description: "点卡片上的「重试连接」再试一次。",
                });
              }
            } else if (connected) {
              toast.success(`${cardName} 已配置好`);
            }
            if (!mountedRef.current) return;
            setCardPhase((prev) => ({ ...prev, [cardId]: undefined }));
            // 用户正在看技术日志时保留窗口，否则任务结束即收起
            if (!detailsVisibleRef.current) setActiveTerminalTarget(null);
          }}
        />
      )}

      {/* ── 批量配置（高级入口）── */}
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

      {/* ── 需要用户确认的两种操作：恢复为官方、重新打开正在运行的软件 ── */}
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription className="pt-1 leading-relaxed">{confirm?.body}</DialogDescription>
          </DialogHeader>
          {confirm?.note && (
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              {confirm.note}
            </p>
          )}
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                const run = confirm?.run;
                setConfirm(null);
                run?.();
              }}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[#111827] hover:bg-black text-white dark:bg-white dark:hover:bg-slate-100 dark:text-black cursor-pointer"
            >
              {confirm?.confirmLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {openingAgentId && (
        <div className="sr-only" role="status">
          <Loader2 className="animate-spin" /> 正在打开软件
        </div>
      )}
    </div>
  );
};

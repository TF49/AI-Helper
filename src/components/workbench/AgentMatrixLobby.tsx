import React, { useState, useEffect, useRef } from "react";
import { Sparkles, FileText, ShieldCheck, RefreshCw, Cpu, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { HolographicBrandLogo } from "../react-bits/HolographicBrandLogo";
import { AgentCard, type AgentCardItem } from "./AgentCard";
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
  getUserTokens,
  getTokenKey,
  createUserToken,
  applyApiKeyToAgents,
  restartTargetApp,
} from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import type { AgentTool, TokenItem } from "../../types";

interface AgentMatrixLobbyProps {
  onSelectTool: (tool: AgentTool) => void;
  onOpenEnvironmentCheck: () => void;
  onOpenAppInstaller?: (appName: string) => void;
}

// 缓存已探测到的客户端状态，跨页面切换时直接复用，消除由于初始态不一致导致的异步闪烁
let cachedAgentsStatusMap: Record<string, AgentCardItem["status"]> | null = null;

// 卡片 → 后端 apply_api_key_to_agents 的写入目标（ChatGPT 桌面端无需写配置，不在此列）
type ApplyTarget = "claude" | "chatgpt" | "cursor" | "workbuddy" | "acciowork";
const APPLY_TARGET_BY_CARD: Record<string, ApplyTarget> = {
  "claude-cli": "claude",
  "codex-cli": "chatgpt",
  "cursor-ide": "cursor",
  "workbuddy-app": "workbuddy",
  "accio-work": "acciowork",
};
const TARGET_LABELS: Record<ApplyTarget, string> = {
  claude: "Claude Code",
  chatgpt: "Codex",
  cursor: "Cursor",
  workbuddy: "WorkBuddy",
  acciowork: "Accio Work",
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
  const [configuringAll, setConfiguringAll] = useState(false);
  const { authState, authSessionGeneration, setLoginModalOpen } = useAuth();
  // 防止重复点击并发写入；会话切换或卸载后不再写入本地绑定记录
  const actionInFlight = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef(authSessionGeneration);
  sessionRef.current = authSessionGeneration;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    },
    {
      id: "codex-cli",
      name: "Codex",
      subtitle: "OpenAI 命令行开发",
      category: "cli",
      icon: CodexCliIcon,
      status: cachedAgentsStatusMap?.["codex-cli"] ?? "unconfigured",
      toolKey: "chatgpt",
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
    },
    {
      id: "cursor-ide",
      name: "Cursor",
      subtitle: "AI First 现代化代码编辑器",
      category: "ide",
      icon: CursorIcon,
      status: cachedAgentsStatusMap?.["cursor-ide"] ?? "unconfigured",
      toolKey: "cursor",
    },
    {
      id: "workbuddy-app",
      name: "WorkBuddy",
      subtitle: "企业级多模型协同工作流",
      category: "desktop",
      icon: WorkbuddyIcon,
      status: cachedAgentsStatusMap?.["workbuddy-app"] ?? "unconfigured",
      toolKey: "workbuddy",
    },
    {
      id: "accio-work",
      name: "Accio Work",
      subtitle: "阿里巴巴企业级 Agent",
      category: "desktop",
      icon: AccioWorkIcon,
      status: cachedAgentsStatusMap?.["accio-work"] ?? "unconfigured",
      toolKey: "acciowork",
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
            };
          }
          if (item.id === "codex-cli") {
            const hasKey = Boolean(codexCfg?.api_key && codexCfg.api_key.trim());
            const exists = Boolean(pathMap["codex"]?.exists || codexCfg?.is_installed);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
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
            };
          }
          if (item.id === "cursor-ide") {
            const hasKey = Boolean(cursorCfg?.api_key && cursorCfg.api_key.trim());
            const exists = Boolean(pathMap["cursor"]?.exists || cursorCfg?.is_installed);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
            };
          }
          if (item.id === "workbuddy-app") {
            const hasKey = Boolean(workbuddyCfg?.api_key && workbuddyCfg.api_key.trim());
            const exists = Boolean(pathMap["workbuddy"]?.exists || workbuddyCfg?.config_exists);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
            };
          }
          if (item.id === "accio-work") {
            const hasKey = Boolean(accioCfg?.api_key && accioCfg.api_key.trim());
            const exists = Boolean(pathMap["acciowork"]?.exists);
            return {
              ...item,
              status: (hasKey ? "installed" : exists ? "unconfigured" : "uninstalled") as AgentCardItem["status"],
            };
          }
          return item;
        });

        // 写入缓存供跨视图切页秒级无感复用
        const map: Record<string, AgentCardItem["status"]> = {};
        for (const it of next) {
          map[it.id] = it.status;
        }
        cachedAgentsStatusMap = map;

        return next;
      });
    } catch (e) {
      console.warn("探测 Agent 状态轻微异常:", e);
    }
  };

  useEffect(() => {
    void refreshAgentStatuses();
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

  // 执行单卡片动作 (一键配置或安装引导)
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

    if (actionInFlight.current || configuringAll) return;
    actionInFlight.current = true;
    const toastId = toast.loading(`正在为 ${agent.name} 写入 API Key 与模型配置...`);

    try {
      const resolved = await resolveApiKeyForTarget(target);
      if (!mountedRef.current) return;
      if (!resolved) {
        toast.dismiss(toastId);
        toast.info("未能获取或创建可用令牌，请在配置面板中查看");
        onSelectTool(target);
        return;
      }

      const { ok } = await applyAndRecord(resolved, [target]);
      if (!mountedRef.current) return;
      toast.dismiss(toastId);
      if (ok.length > 0) {
        toast.success(`${agent.name} 已配置完成`, {
          description: describeKeySource(resolved, target),
        });
      } else {
        toast.error(`${agent.name} 写入失败，已打开配置面板`, {
          description: "请检查该工具当前的接口地址是否为 Bob API，以及 Key 是否有效",
        });
        onSelectTool(target);
      }
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`${agent.name} 配置失败: ${String(err)}`);
      onSelectTool(target);
    } finally {
      toast.dismiss(toastId);
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

    const targetGroup = TARGET_DEFAULT_GROUP[target];
    let tokens: TokenItem[] = [];
    try {
      tokens = await getUserTokens();
    } catch (err) {
      console.warn("获取令牌列表失败:", err);
    }

    const isGroupMatch = (g?: string | null) => {
      if (!g) return false;
      const clean = g.trim();
      return clean === targetGroup || clean.toLowerCase() === targetGroup.toLowerCase();
    };

    // 1. 优先检查该工具是否已经绑定过该分组的有效令牌
    const boundId = readBoundTokenId(target);
    if (boundId !== null) {
      const boundToken = tokens.find((t) => t.id === boundId && t.status === 1);
      if (boundToken && isGroupMatch(boundToken.group)) {
        try {
          const key = (await getTokenKey(boundToken.id)).trim();
          if (key) return { key, token: boundToken };
        } catch (err) {
          console.warn(`读取已绑定令牌 ${boundToken.name} 失败:`, err);
        }
      }
    }

    // 2. 在用户所有可用令牌中查找属于 targetGroup 的正常令牌 (status === 1)
    const matchingToken = tokens.find(
      (t) => t.status === 1 && isGroupMatch(t.group)
    );
    if (matchingToken) {
      try {
        const key = (await getTokenKey(matchingToken.id)).trim();
        if (key) return { key, token: matchingToken };
      } catch (err) {
        console.warn(`读取令牌 ${matchingToken.name} 失败:`, err);
      }
    }

    // 3. 用户账号下无对应分组的有效令牌：自动在 Bob API 创建专属令牌！
    try {
      const tokenName = GROUP_DEFAULT_TOKEN_NAMES[targetGroup] || `${targetGroup} 专属令牌`;
      const created = await createUserToken(tokenName, targetGroup);
      let key = created.key?.trim() || "";
      if (!key || !key.startsWith("sk-")) {
        key = (await getTokenKey(created.id)).trim();
      }
      if (key) {
        return { key, token: created };
      }
    } catch (err) {
      console.error(`自动创建 ${targetGroup} 分组令牌失败:`, err);
      throw new Error(`自动创建「${targetGroup}」分组令牌失败: ${String(err)}`);
    }

    return null;
  };

  /** 调用后端统一写入，并仅为写入成功的工具记录令牌绑定 */
  const applyAndRecord = async (resolved: ResolvedKey, targets: ApplyTarget[]) => {
    const session = sessionRef.current;
    const results = await applyApiKeyToAgents(resolved.key, targets);
    const ok = targets.filter((t) => results[t]);
    const failed = targets.filter((t) => !results[t]);

    const { token } = resolved;
    if (token && ok.length > 0 && mountedRef.current && session === sessionRef.current) {
      const bound = JSON.stringify({ id: token.id, name: token.name, group: token.group ?? undefined });
      for (const tid of ok) {
        try {
          localStorage.setItem(`bound_token_${tid}`, bound);
        } catch {}
      }
      // 只广播元数据，不在 DOM 事件中携带明文 Key
      window.dispatchEvent(
        new CustomEvent("ai_helper_sync_all_tokens", {
          detail: { id: token.id, name: token.name, group: token.group ?? undefined, toolIds: ok },
        }),
      );
    }

    if (mountedRef.current) await refreshAgentStatuses();
    return { ok, failed };
  };

  const describeKeySource = (resolved: ResolvedKey, target?: ApplyTarget) => {
    const group = target ? TARGET_DEFAULT_GROUP[target] : resolved.token?.group || "专属分组";
    const model = target ? TARGET_DEFAULT_MODEL[target] : undefined;
    const modelDesc = model ? `，默认模型为 ${model}` : "";
    return resolved.token
      ? `已写入「${resolved.token.name}」（分组: ${group}），接口为 Bob API${modelDesc}`
      : `已写入 Bob API 专属令牌（分组: ${group}）${modelDesc}`;
  };

  // 一键配置所有：按各客户端所属分组分发配置
  const handleConfigureAll = async () => {
    if (actionInFlight.current) return;
    const targets = Array.from(
      new Set(
        agents
          .filter((a) => a.status !== "uninstalled")
          .map((a) => APPLY_TARGET_BY_CARD[a.id])
          .filter((t): t is ApplyTarget => Boolean(t)),
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

    actionInFlight.current = true;
    setConfiguringAll(true);
    const toastId = toast.loading("正在为已安装的 Agent 写入专属 API Key 与推荐模型...");

    try {
      // 按目标分组对 targets 进行归类 (CC-Kiro-Max / Codex-不降质 / 国产Token计划)
      const targetsByGroup = new Map<string, ApplyTarget[]>();
      for (const t of targets) {
        const g = TARGET_DEFAULT_GROUP[t];
        const list = targetsByGroup.get(g) || [];
        list.push(t);
        targetsByGroup.set(g, list);
      }

      const allOk: ApplyTarget[] = [];
      const allFailed: ApplyTarget[] = [];
      const groupSummaries: string[] = [];

      for (const [groupName, groupTargets] of targetsByGroup.entries()) {
        const representativeTarget = groupTargets[0];
        try {
          const resolved = await resolveApiKeyForTarget(representativeTarget);
          if (!mountedRef.current) return;
          if (!resolved) {
            allFailed.push(...groupTargets);
            continue;
          }

          const { ok, failed } = await applyAndRecord(resolved, groupTargets);
          allOk.push(...ok);
          allFailed.push(...failed);
          if (ok.length > 0) {
            const names = ok.map((t) => TARGET_LABELS[t]).join("、");
            groupSummaries.push(`${names}（${groupName}）`);
          }
        } catch (err) {
          console.error(`写入分组 ${groupName} 失败:`, err);
          allFailed.push(...groupTargets);
        }
      }

      if (!mountedRef.current) return;
      toast.dismiss(toastId);

      if (allFailed.length === 0) {
        toast.success(`已为 ${allOk.length} 个 Agent 完成一键配置`, {
          description: groupSummaries.join("；"),
          duration: 5000,
        });
      } else if (allOk.length > 0) {
        const failedNames = allFailed.map((t) => TARGET_LABELS[t]).join("、");
        toast.warning(`部分 Agent 配置完成 (${allOk.length}/${targets.length})`, {
          description: `成功：${groupSummaries.join("；")}。失败：${failedNames}`,
          duration: 6000,
        });
      } else {
        toast.error("所有 Agent 写入均失败，请检查网络或进入环境检测修复");
      }
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("一键配置遇到问题，建议进入环境检测向导修复", {
        description: String(err),
      });
    } finally {
      toast.dismiss(toastId);
      actionInFlight.current = false;
      if (mountedRef.current) setConfiguringAll(false);
    }
  };

  const installedCount = agents.filter((a) => a.status === "installed").length;

  return (
    <div className="w-full h-full flex items-center justify-center min-h-0 select-none py-1 lg:py-2 px-1 sm:px-2">
      {/* ── 主视口全屏自适应画布：自适应居中对齐，高度严格 1:1 平齐 ── */}
      <div className="w-full h-full max-w-[1360px] 2xl:max-w-[1480px] max-h-[860px] flex flex-col lg:flex-row items-stretch gap-5 lg:gap-6 xl:gap-8 min-h-0 mx-auto">
        {/* ──── 左侧：通透沉浸 Hero 展台 (保留上方全部元素，无外层白底卡片托起) ──── */}
        <div className="w-full lg:w-[380px] xl:w-[410px] 2xl:w-[440px] flex-shrink-0 flex flex-col justify-between h-full py-1.5 lg:py-2.5 select-none">
          {/* 上半部：3D 全息品牌 Logo 展台 + 核心标题 + 描述 + 特性微卡片 */}
          <div className="flex flex-col space-y-3.5 xl:space-y-4">
            {/* 3D 全息精细交互 Logo */}
            <div className="flex items-center justify-start -ml-1 py-0.5">
              <HolographicBrandLogo size={142} />
            </div>

            {/* 主标题与微状态标签 */}
            <div className="space-y-1 xl:space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/10 border border-sky-200/60 dark:border-sky-400/20 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                <span>AI-Helper Engine Ready</span>
              </div>
              <h1 className="text-2xl lg:text-[27px] xl:text-[29px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                一键接入你的 Agent
              </h1>
              <p className="text-xs xl:text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                原生打通主流 AI 客户端与模型网关，保持开发工作区会话连贯。
              </p>
            </div>

            {/* 核心特性交互微卡片 */}
            <div className="space-y-2.5 xl:space-y-3 pt-1">
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
                disabled={configuringAll}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 xl:py-3 px-4 rounded-full bg-[#111827] hover:bg-black text-white text-xs xl:text-[13px] font-bold shadow-md shadow-black/15 transition-all duration-200 active:scale-95 cursor-pointer dark:bg-white dark:hover:bg-slate-100 dark:text-black disabled:opacity-50 group/btn"
              >
                {configuringAll ? (
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
        <div className="flex-1 min-w-0 h-full flex flex-col justify-between">
          <div className="grid grid-cols-2 grid-rows-3 gap-3.5 xl:gap-4 w-full h-full">
            {agents.map((agent, idx) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={idx}
                onAction={handleCardAction}
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
    </div>
  );
};

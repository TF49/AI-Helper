import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Clock,
  Zap,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Layers,
  Info,
  ShieldCheck,
  Check,
  Sparkles,
  KeyRound,
  RotateCcw,
  Maximize2,
  LayoutList,
  LayoutGrid,
  ArrowUpDown,
  X,
  Eye,
  Loader2,
} from "lucide-react";
import gsap from "gsap";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/useAuth";
import { normalizeApiKey } from "../lib/useBoundTokenGroup";
import {
  getChannelGroupOverview,
  openUrl,
  getUserTokens,
  updateUserTokenGroup,
  getTokenKey,
  applyApiKeyToAgents,
  getPricingData,
} from "../lib/api";
import type { ChannelGroupOverview, TokenItem } from "../types";
import { HealthTrendVisualizer } from "./HealthTrendVisualizer";
import { CircleToSearchBar } from "./ui/CircleToSearchBar";
import { ButtonToLoaderToSuccess } from "./ui/ButtonToLoaderToSuccess";
import {
  createGroupPricing,
  emptyGroupPricing,
  getGroupSwitchError,
  getValidGroupRatio,
  GROUP_PRICING_MAX_AGE_MS,
} from "../lib/groupPricing";

interface GroupSwitchModalState {
  open: boolean;
  targetGroupName: string;
  targetGroupItem?: ChannelGroupOverview | null;
  selectedTokenId?: number;
  tokensList: TokenItem[];
  loadingTokens: boolean;
  syncToAllAgents: boolean;
  isSubmitting: boolean;
  ackHighRatio: boolean;
  errorMessage?: string | null;
}

function emptySwitchModal(): GroupSwitchModalState {
  return {
    open: false, targetGroupName: "", targetGroupItem: null, selectedTokenId: undefined,
    tokensList: [], loadingTokens: false, syncToAllAgents: false,
    isSubmitting: false, ackHighRatio: false, errorMessage: null,
  };
}

interface ToolTokenBinding {
  id?: number;
  name?: string;
  group?: string | null;
}

function readToolBinding(toolId: string): ToolTokenBinding | null {
  try {
    const saved = localStorage.getItem(`bound_token_${toolId}`);
    return saved ? JSON.parse(saved) as ToolTokenBinding : null;
  } catch {
    return null;
  }
}

export interface ChannelGroupMonitorProps {
  currentGroupName?: string | null;
  hasConfiguredKey?: boolean;
  configuredKey?: string | null;
  defaultShowDetails?: boolean;
  toolName?: string;
  toolId?: string;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  onSelectGroup?: (groupName: string) => void;
  onOpenTokenSelect?: () => void;
  className?: string;
}

export interface ToolExclusiveGuide {
  title: string;
  tag: string;
  desc: string;
  technicalNote: string;
  recommendedKeywords: string[];
}

export const TOOL_EXCLUSIVE_GUIDES: Record<string, ToolExclusiveGuide> = {
  chatgpt: {
    title: "ChatGPT (Codex) 专属分组与密钥规则",
    tag: "Codex 流式专用",
    desc: "Codex 命令行终端深度依赖高并发流式代码补全与特定上游模型（如 gpt-5-codex、gpt-4o、o3-mini）。必须关联拥有 Codex 专项通道权限的分组。",
    technicalNote: "若关联普通低频或非代码分组，可能因上游并发限频或缺少 Codex 路由权限导致补全超时。网关地址与对应 Key 将一起保存到当前用户私有的 ~/.codex/config.toml，CLI 重新加载后生效。",
    recommendedKeywords: ["codex", "svip-codex", "openai", "gpt"],
  },
  claude: {
    title: "Claude Code 专属分组与密钥规则",
    tag: "Anthropic 深度推理",
    desc: "Claude Code CLI 深度依赖 Anthropic 原生流式协议、Extended Thinking（思考链推理）与 Prompt Caching 特性。必须确保 Key 归属于 Claude 专属通道分组（如 ClaudeCode Kiro-1）。",
    technicalNote: "若绑定普通分组或纯 OpenAI 格式分组，CLI 启动初始化及代码交互时将直接报 404/400 invalid model 错误。凭据写入 ~/.claude/settings.json 的 env.ANTHROPIC_AUTH_TOKEN。",
    recommendedKeywords: ["claude", "kiro", "anthropic"],
  },
  workbuddy: {
    title: "WorkBuddy 专属分组与密钥规则",
    tag: "多模型聚合通道",
    desc: "WorkBuddy 本地注册管理多种异构模型（如 DeepSeek、Claude、GPT-4o 等）。绑定的 Key 所属分组必须完整覆盖 models.json 中所配置目标模型的路由与额度权限。",
    technicalNote: "建议关联全模型覆盖或高权限多渠道分组，确保切换不同助手模型时通道持续可用。配置将直接持久化于 ~/.workbuddy/models.json (并自动兼容 ~/.workbuddy-ai/models.json)。",
    recommendedKeywords: ["workbuddy", "all", "svip", "default"],
  },
  acciowork: {
    title: "Accio Work 专属分组与密钥规则",
    tag: "企业级 Bridge 桥接",
    desc: "Accio Work 专为企业级多 Agent 复杂长链路协作设计，通过本地 Bridge 桥接服务中转请求。绑定的 Key 分组直接决定了 Bridge 转发时的上游链路质量与负载能力。",
    technicalNote: "建议优先选用平均响应时延低于 1.5s 且近 3 小时成功率维持在 99%+ 的专属稳定分组，保障长时间工作流不中断。配置保存于 ~/.ai-helper/accio_config.json。",
    recommendedKeywords: ["accio", "bridge", "enterprise", "svip", "default"],
  },
  cursor: {
    title: "Cursor IDE 专属分组与密钥规则",
    tag: "Composer / Agent 桥接",
    desc: "Cursor IDE 深度依赖高并发流式代码补全与 Agent 工具调用（如 Claude 3.7、DeepSeek-V3/R1、GPT-4o）。绑定的 Key 所属分组必须具备充足并发与代码模型权限。",
    technicalNote: "建议关联高并发低延迟代码专属分组或 SVIP 分组。配置保存于 ~/.ai-helper/cursor_config.json 并通过本地 Bridge 自动转译提供给 Cursor。",
    recommendedKeywords: ["cursor", "code", "svip", "default", "claude"],
  },
};

function formatLatency(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 1) {
    const ms = Math.round(seconds * 1000);
    return ms > 0 ? `${ms}ms` : "<1s";
  }
  return `${seconds.toFixed(2)}s`;
}

export interface GroupRatioBadgeInfo {
  text: string;
  className: string;
  ratio: number;
  isHigh: boolean;
  isVeryHigh: boolean;
}

export function getGroupRatioBadge(ratio?: number | null): GroupRatioBadgeInfo | null {
  if (ratio === undefined || ratio === null) return null;
  const num = Number(ratio);
  if (!Number.isFinite(num) || num <= 0) return null;

  if (num < 1.0) {
    return {
      text: `${num}x 优惠`,
      className:
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-500/30",
      ratio: num,
      isHigh: false,
      isVeryHigh: false,
    };
  }
  if (num === 1.0) {
    return {
      text: "1.0x 标准",
      className:
        "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-gray-300 border-slate-200/60 dark:border-white/10",
      ratio: num,
      isHigh: false,
      isVeryHigh: false,
    };
  }
  if (num <= 1.5) {
    return {
      text: `${num}x 较高`,
      className:
        "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200/60 dark:border-amber-500/30 font-medium",
      ratio: num,
      isHigh: true,
      isVeryHigh: false,
    };
  }
  return {
    text: `${num}x 高倍率`,
    className:
      "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border-rose-200/60 dark:border-rose-500/30 font-bold",
      ratio: num,
      isHigh: true,
      isVeryHigh: true,
    };
}

/**
 * 多因子稳定性与健康度评估，选取最健康、最稳定的分组
 * 1. 优先在当前工具推荐关键词（如 Codex 专属、Claude 专属）分组中寻找
 * 2. 综合多因子排序：
 *    - 成功率降序（success_rate 越高越好，极佳 >= 90）
 *    - 流量验证优先（total_requests > 0 优先于 0 流量空通道）
 *    - 平均响应时延升序（响应越低越好）
 *    - 总请求量降序（调用量大说明高并发下依然稳定）
 * 3. 若专属通道全部不可用或成功率极低（< 85%），则全局寻找最优健康稳定通道兜底
 */
export function findHealthiestAndStableGroup(
  allGroups: ChannelGroupOverview[],
  guide: ToolExclusiveGuide | null,
): ChannelGroupOverview | null {
  if (!allGroups || allGroups.length === 0) return null;

  const sortStability = (list: ChannelGroupOverview[]) => {
    return [...list].sort((a, b) => {
      // 1. 成功率对比（差值 >= 0.5% 视为主导差异）
      if (Math.abs(b.success_rate - a.success_rate) >= 0.5) {
        return b.success_rate - a.success_rate;
      }
      // 2. 真实流量验证（有真实成功请求 > 0 优先于 0 流量空通道）
      const aTraffic = (a.total_requests || 0) > 0 ? 1 : 0;
      const bTraffic = (b.total_requests || 0) > 0 ? 1 : 0;
      if (bTraffic !== aTraffic) return bTraffic - aTraffic;
      // 3. 响应时延（均值越低越优）
      const aLat = a.avg_response_time > 0 ? a.avg_response_time : 999;
      const bLat = b.avg_response_time > 0 ? b.avg_response_time : 999;
      if (Math.abs(aLat - bLat) >= 0.05) return aLat - bLat;
      // 4. 承载请求量（流量越大代表越经受考验）
      return (b.total_requests || 0) - (a.total_requests || 0);
    });
  };

  // 1. 优先在当前工具推荐关键词中挑选最稳通道
  if (guide?.recommendedKeywords && guide.recommendedKeywords.length > 0) {
    const matched = allGroups.filter((g) => {
      const lower = g.group_name.toLowerCase();
      return guide.recommendedKeywords.some((kw) => lower.includes(kw.toLowerCase()));
    });
    if (matched.length > 0) {
      const sortedMatched = sortStability(matched);
      // 如果工具专属分组中最佳者成功率达到 85% 以上，优先推荐当前工具专属通道
      if (sortedMatched[0].success_rate >= 85) {
        return sortedMatched[0];
      }
    }
  }

  // 2. 若无专属关键词或专属分组健康度较低，全局寻找最健康稳定的通道
  const sortedGlobal = sortStability(allGroups);
  return sortedGlobal[0] || null;
}

export function ChannelGroupMonitor({
  currentGroupName,
  hasConfiguredKey,
  configuredKey,
  defaultShowDetails,
  toolName = "当前工具",
  toolId,
  accentColor = "blue",
  onSelectGroup,
  onOpenTokenSelect,
  className,
}: ChannelGroupMonitorProps) {
  const { authState, authSessionGeneration, setLoginModalOpen } = useAuth();
  const userId = authState.is_logged_in ? authState.user?.id ?? null : null;

  const [hours, setHours] = useState<number>(1);
  const [showDetails, setShowDetails] = useState<boolean>(defaultShowDetails ?? false);
  const [groups, setGroups] = useState<ChannelGroupOverview[]>([]);
  const [pricingInfo, setPricingInfo] = useState(emptyGroupPricing);
  const pricingRef = useRef(pricingInfo);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [switchModalState, setSwitchModalState] = useState(emptySwitchModal);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [selectedGroupOverride, setSelectedGroupOverride] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filterTab, setFilterTab] = useState<"all" | "recommended" | "high">("all");
  const [sortBy, setSortBy] = useState<"default" | "rate_desc" | "latency_asc" | "requests_desc">("default");
  const [compareModalOpen, setCompareModalOpen] = useState(false);

  const refreshIconRef = useRef<SVGSVGElement>(null);
  const mounted = useRef(true);
  const lifecycleGeneration = useRef(0);
  const dataRequest = useRef(0);
  const modalRequest = useRef(0);
  const modalOpen = useRef(false);

  // 计算归一化的 tool 标识
  const effectiveToolId = useMemo(() => {
    if (toolId) return toolId.toLowerCase();
    const tname = toolName.toLowerCase();
    if (tname.includes("chatgpt") || tname.includes("codex")) return "chatgpt";
    if (tname.includes("claude")) return "claude";
    if (tname.includes("workbuddy")) return "workbuddy";
    if (tname.includes("accio")) return "acciowork";
    if (tname.includes("cursor")) return "cursor";
    return "default";
  }, [toolId, toolName]);

  const contextRef = useRef({ userId, session: authSessionGeneration, toolId: effectiveToolId });
  contextRef.current = { userId, session: authSessionGeneration, toolId: effectiveToolId };
  const captureContext = useCallback(() => ({
    ...contextRef.current, generation: lifecycleGeneration.current,
  }), []);
  const isContextCurrent = useCallback((request: ReturnType<typeof captureContext>) => {
    const current = contextRef.current;
    return mounted.current && current.userId !== null && request.userId === current.userId &&
      request.session === current.session && request.toolId === current.toolId &&
      request.generation === lifecycleGeneration.current;
  }, []);
  const setCurrentPricing = useCallback((snapshot: ReturnType<typeof emptyGroupPricing>) => {
    pricingRef.current = snapshot;
    setPricingInfo(snapshot);
    setSwitchModalState((previous) => ({ ...previous, ackHighRatio: false }));
  }, []);
  const handleCloseSwitchModal = useCallback(() => {
    modalOpen.current = false;
    modalRequest.current += 1;
    setSwitchModalState(emptySwitchModal());
  }, []);

  // 从本地存储中尝试读取当前工具绑定的 token 记录
  const [boundTokenInfo, setBoundTokenInfo] = useState<ToolTokenBinding | null>(
    () => readToolBinding(effectiveToolId),
  );
  const bindingIdentity = useRef({ userId, session: authSessionGeneration, toolId: effectiveToolId });
  const configuredKeyRef = useRef(configuredKey?.trim() ?? "");
  configuredKeyRef.current = configuredKey?.trim() ?? "";

  useEffect(() => {
    mounted.current = true;
    const clearAccountState = (clearBinding = true) => {
      lifecycleGeneration.current += 1;
      dataRequest.current += 1;
      handleCloseSwitchModal();
      setCurrentPricing(emptyGroupPricing());
      setPricingLoading(false);
      setGroups([]);
      if (clearBinding) setBoundTokenInfo(null);
      setSelectedGroupOverride(null);
      setLastUpdated("");
      setErrorMsg(null);
      setLoading(false);
      setExpandedGroup(null);
      setCompareModalOpen(false);
    };
    const previousIdentity = bindingIdentity.current;
    const sameIdentity = previousIdentity.userId === userId &&
      previousIdentity.session === authSessionGeneration && previousIdentity.toolId === effectiveToolId;
    bindingIdentity.current = { userId, session: authSessionGeneration, toolId: effectiveToolId };
    // Initial mount and StrictMode's effect replay keep the same identity's
    // binding. An actual account/session/tool change invalidates it.
    clearAccountState(!sameIdentity);
    const handleAuthChange = () => clearAccountState();
    window.addEventListener("ai_helper_auth_changed", handleAuthChange);
    return () => {
      window.removeEventListener("ai_helper_auth_changed", handleAuthChange);
      mounted.current = false;
      lifecycleGeneration.current += 1;
      modalRequest.current += 1;
      modalOpen.current = false;
    };
  }, [userId, authSessionGeneration, effectiveToolId, handleCloseSwitchModal, setCurrentPricing]);

  useEffect(() => {
    handleCloseSwitchModal();
  }, [configuredKey, handleCloseSwitchModal]);

  useEffect(() => {
    if (pricingInfo.loadedAt === null) return;
    const timer = window.setTimeout(() => setCurrentPricing(emptyGroupPricing()),
      Math.max(0, pricingInfo.loadedAt + GROUP_PRICING_MAX_AGE_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pricingInfo.loadedAt, setCurrentPricing]);

  // 监听并同步全局全套同步与分组变更事件
  useEffect(() => {
    const handleSyncEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        id: number;
        name: string;
        key?: string;
        group?: string | null;
        toolIds?: string[];
      }>;
      if (customEvent.detail) {
        if (customEvent.detail.toolIds && !customEvent.detail.toolIds.includes(effectiveToolId)) return;
        setBoundTokenInfo({
          id: customEvent.detail.id,
          name: customEvent.detail.name,
          group: customEvent.detail.group,
        });
      }
    };
    const handleGroupUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        toolId?: string;
        tokenId?: number;
        group: string;
      }>;
      if (customEvent.detail) {
        setBoundTokenInfo((prev) => {
          if (!prev) return prev;
          if (customEvent.detail.tokenId && prev.id && prev.id !== customEvent.detail.tokenId) {
            return prev;
          }
          if (customEvent.detail.toolId && customEvent.detail.toolId !== effectiveToolId) {
            return prev;
          }
          const updated = { ...prev, group: customEvent.detail.group };
          try {
            localStorage.setItem(`bound_token_${effectiveToolId}`, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
    };
    window.addEventListener("ai_helper_sync_all_tokens", handleSyncEvent);
    window.addEventListener("ai_helper_group_updated", handleGroupUpdated);
    return () => {
      window.removeEventListener("ai_helper_sync_all_tokens", handleSyncEvent);
      window.removeEventListener("ai_helper_group_updated", handleGroupUpdated);
    };
  }, [effectiveToolId]);

  // 计算当前工具绑定的生效分组
  const resolvedCurrentGroup = useMemo(() => {
    if (currentGroupName && currentGroupName.trim()) return currentGroupName.trim();
    if (boundTokenInfo?.group && boundTokenInfo.group.trim()) return boundTokenInfo.group.trim();
    if (boundTokenInfo?.id) return "default";
    return null;
  }, [currentGroupName, boundTokenInfo]);

  // 专属工具指南说明
  const guide = useMemo(() => {
    return TOOL_EXCLUSIVE_GUIDES[effectiveToolId] || null;
  }, [effectiveToolId]);

  // 主题配色系统 (统一极简纯黑白)
  const theme = useMemo(() => {
    return {
      bannerBg:
        "bg-neutral-100/80 dark:bg-white/[0.04] border-neutral-200/70 dark:border-white/10 text-neutral-900 dark:text-neutral-200",
      bannerIcon: "text-black dark:text-white",
      bannerTitle: "text-black dark:text-white",
      bannerTag:
        "bg-neutral-200/90 text-neutral-800 dark:bg-white/15 dark:text-white border-neutral-300 dark:border-white/20",
      topIconBg:
        "bg-neutral-100 text-black dark:bg-white/10 dark:text-white border-neutral-200 dark:border-white/10",
      btnPrimary:
        "bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black shadow-xs",
      boundBadge:
        "bg-neutral-100 text-black dark:bg-white/15 dark:text-white border-neutral-200 dark:border-white/20",
      accentText: "text-black dark:text-white",
      accentIconColor: "text-black dark:text-white",
      focusRing: "focus:ring-black dark:focus:ring-white",
      drawerActive:
        "border-black bg-neutral-100 text-black dark:border-white dark:bg-white/10 dark:text-white shadow-2xs font-semibold",
      drawerCheck: "text-black dark:text-white",
    };
  }, []);

  // 加载监控数据
  const loadData = useCallback(
    async (silent = false) => {
      const request = captureContext();
      const sequence = ++dataRequest.current;
      const isCurrent = () => isContextCurrent(request) && sequence === dataRequest.current;
      if (!isCurrent()) return;
      if (!silent) setLoading(true);
      setErrorMsg(null);
      setCurrentPricing(emptyGroupPricing());
      setPricingLoading(true);
      try {
        const [dataResult, pricingResult] = await Promise.allSettled([
          getChannelGroupOverview(hours),
          getPricingData(),
        ]);
        if (!isCurrent()) return;
        setCurrentPricing(createGroupPricing(pricingResult.status === "fulfilled" ? pricingResult.value : null));
        if (dataResult.status === "rejected") throw dataResult.reason;
        setGroups(dataResult.value || []);
        setLastUpdated(
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );
      } catch (err: unknown) {
        if (!isCurrent()) return;
        const rawMsg =
          typeof err === "string" ? err : "加载分组监控数据失败，请确认网络或登录态";
        const msg = rawMsg.includes("Unauthorized") || rawMsg.includes("登录")
          ? "登录状态已过期，请重新登录"
          : rawMsg;
        setErrorMsg(msg);
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setPricingLoading(false);
        }
      }
    },
    [userId, authSessionGeneration, effectiveToolId, hours, captureContext, isContextCurrent, setCurrentPricing],
  );

  useEffect(() => {
    if (!authState.is_logged_in) return;
    void loadData();
    const interval = setInterval(() => {
      void loadData(true);
    }, 90000);
    return () => clearInterval(interval);
  }, [loadData, authState.is_logged_in]);

  // 点击刷新按钮触发旋转
  const handleRefresh = () => {
    if (refreshIconRef.current) {
      gsap.to(refreshIconRef.current, {
        rotation: "+=360",
        duration: 0.6,
        ease: "power2.inOut",
      });
    }
    void loadData();
  };

  // ── 改分组弹窗状态与核心操作逻辑 ──
  const handleInitiateSwitchGroup = async (groupName: string) => {
    if (!authState.is_logged_in) {
      toast.info("请先登录 bob-api 账号以管理 API Key 分组");
      setLoginModalOpen(true);
      return;
    }
    const request = renderedContext;
    if (!isContextCurrent(request)) return;
    const sequence = ++modalRequest.current;
    modalOpen.current = true;
    const requestedKey = configuredKeyRef.current;
    const isCurrent = () => isContextCurrent(request) && modalOpen.current && sequence === modalRequest.current &&
      requestedKey === configuredKeyRef.current;
    if (!isCurrent()) return;

    const targetItem = groups.find((g) => g.group_name === groupName) || null;

    setSwitchModalState({
      ...emptySwitchModal(),
      open: true,
      targetGroupName: groupName,
      targetGroupItem: targetItem,
      loadingTokens: true,
      errorMessage: null,
      isSubmitting: false,
      ackHighRatio: false,
    });
    void loadData(true);

    try {
      const userTokens = await getUserTokens();
      if (!isCurrent()) return;
      const binding = boundTokenInfo ?? readToolBinding(effectiveToolId);
      const normalizedKey = normalizeApiKey(requestedKey);
      let matchingToken = normalizedKey
        ? userTokens.find((token) => normalizeApiKey(token.key) === normalizedKey)
        : undefined;
      const boundToken = userTokens.find((token) => token.id === binding?.id);
      if (!matchingToken && boundToken) {
        if (!normalizedKey) {
          matchingToken = boundToken;
        } else {
          try {
            const plainKey = await getTokenKey(boundToken.id);
            if (!isCurrent()) return;
            if (normalizeApiKey(plainKey) === normalizedKey) matchingToken = boundToken;
          } catch {
            if (!isCurrent()) return;
          }
        }
      }
      let defaultId = matchingToken?.id;
      let bindingError: string | null = null;
      if (matchingToken) {
        setBoundTokenInfo({ id: matchingToken.id, name: matchingToken.name, group: matchingToken.group });
      } else if (requestedKey || hasConfiguredKey || binding?.id) {
        bindingError = "当前工具的密钥未匹配到此账号的凭据，请明确选择要修改的 Key，或重新关联当前工具";
      } else {
        if (
          authState.selected_token_id &&
          userTokens.some((t) => t.id === authState.selected_token_id)
        ) {
          defaultId = authState.selected_token_id;
        } else if (userTokens.length > 0) {
          defaultId = userTokens[0].id;
        }
      }

      setSwitchModalState((prev) => ({
        ...prev,
        tokensList: userTokens,
        selectedTokenId: defaultId,
        loadingTokens: false,
        errorMessage: bindingError,
      }));
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setSwitchModalState((prev) => ({
        ...prev,
        loadingTokens: false,
        errorMessage: typeof err === "string" ? err : "获取账号 API Key 列表失败",
      }));
    }
  };

  const handleConfirmSwitchGroup = async () => {
    const request = renderedContext;
    const sequence = renderedModalRequest;
    const requestedKey = configuredKey?.trim() ?? "";
    const isCurrent = () => isContextCurrent(request) && modalOpen.current && sequence === modalRequest.current &&
      requestedKey === configuredKeyRef.current;
    if (!isCurrent()) throw new Error("窗口或登录状态已变化，请重新打开");
    const { targetGroupName, selectedTokenId, tokensList, syncToAllAgents } = switchModalState;
    if (!selectedTokenId) {
      toast.error("请选择要切换分组的 API Key");
      throw new Error("请选择要切换分组的 API Key");
    }

    const tokenToUpdate = tokensList.find((t) => t.id === selectedTokenId);
    if (!tokenToUpdate) throw new Error("该凭据不在当前账号列表中，请重新打开");
    const tokenName = tokenToUpdate?.name || "当前 API Key";

    setSwitchModalState((prev) => ({ ...prev, errorMessage: null }));

    const pricingError = pricingInfo !== pricingRef.current
      ? "费率正在刷新，请确认最新费率后再提交"
      : getGroupSwitchError(pricingRef.current, targetGroupName, switchModalState.ackHighRatio);
    if (pricingError) {
      const message = pricingError;
      setSwitchModalState((prev) => ({ ...prev, errorMessage: message }));
      toast.error(message);
      throw new Error(message);
    }

    let updated: TokenItem;
    try {
      updated = await updateUserTokenGroup(selectedTokenId, targetGroupName);
    } catch (err: unknown) {
      if (isCurrent()) {
        const msg = typeof err === "string" ? err : "切换分组失败，请检查账号权限";
        setSwitchModalState((prev) => ({ ...prev, errorMessage: msg }));
      }
      throw err;
    }
    // The cloud mutation has completed. Window invalidation only stops local follow-up work.
    if (!isCurrent()) return;

    const newBound = { id: updated.id, name: updated.name, group: targetGroupName };
    if (boundTokenInfo?.id === updated.id) {
      try {
        localStorage.setItem(`bound_token_${effectiveToolId}`, JSON.stringify(newBound));
      } catch {}
      setBoundTokenInfo(newBound);
      setSelectedGroupOverride(null);
      if (onSelectGroup) onSelectGroup(targetGroupName);
    }
    window.dispatchEvent(new CustomEvent("ai_helper_group_updated", {
      detail: { tokenId: updated.id, group: targetGroupName },
    }));

    if (syncToAllAgents) {
      try {
        if (!isCurrent()) return;
        const plainKey = await getTokenKey(selectedTokenId);
        if (!isCurrent()) return;
        const results = await applyApiKeyToAgents(plainKey);
        if (!isCurrent()) return;
        const toolIds = ["chatgpt", "claude", "workbuddy", "acciowork", "cursor"].filter((id) => results[id]);

        toolIds.forEach((tid) => {
          try {
            localStorage.setItem(`bound_token_${tid}`, JSON.stringify(newBound));
          } catch {}
        });
        if (toolIds.length > 0) {
          try { localStorage.setItem("bound_token_default", JSON.stringify(newBound)); } catch {}
          window.dispatchEvent(new CustomEvent("ai_helper_sync_all_tokens", {
            detail: { ...newBound, toolIds },
          }));
          if (toolIds.includes(effectiveToolId) && onSelectGroup) onSelectGroup(targetGroupName);
        }
        if (toolIds.length < 4) {
          toast.warning(`云端分组已修改；本地同步成功 ${toolIds.length}/4，请检查其余工具配置`);
          return;
        }
      } catch {
        if (isCurrent()) toast.warning("云端分组已修改，本地 Agent 同步失败，请单独重试同步");
        return;
      }
    }
    if (isCurrent()) toast.success(`已成功将「${tokenName}」切换至「${targetGroupName}」分组！即时生效！`);
  };

  // 判定当前工具是否已配置 Key
  const isKeyConfigured = useMemo(() => {
    if (typeof hasConfiguredKey === "boolean") return hasConfiguredKey;
    if (configuredKey && configuredKey.trim()) return true;
    if (boundTokenInfo?.id || boundTokenInfo?.group) return true;
    if (currentGroupName && currentGroupName.trim()) return true;
    return false;
  }, [hasConfiguredKey, configuredKey, boundTokenInfo, currentGroupName]);

  // 计算健康监控下最稳定、最健康的分组
  const healthiestGroup = useMemo(() => {
    return findHealthiestAndStableGroup(groups, guide);
  }, [groups, guide]);

  // 计算当前聚焦的目标分组名称：
  // 1. 若用户正在对比预览，优先展示预览分组
  // 2. 若用户已配置 Key，且解析到了绑定分组，展示当前 Key 绑定分组
  // 3. 若用户未配置 Key（或未解析到分组），展示健康监控下最稳定最健康的分组
  const effectiveGroupName = useMemo(() => {
    if (selectedGroupOverride) return selectedGroupOverride;
    if (isKeyConfigured && resolvedCurrentGroup) return resolvedCurrentGroup;
    return healthiestGroup?.group_name || groups[0]?.group_name || null;
  }, [selectedGroupOverride, isKeyConfigured, resolvedCurrentGroup, healthiestGroup, groups]);

  const activeGroup = useMemo(() => {
    if (!effectiveGroupName) return null;
    return (
      groups.find(
        (g) => g.group_name.toLowerCase() === effectiveGroupName.toLowerCase(),
      ) ||
      groups.find((g) =>
        g.group_name.toLowerCase().includes(effectiveGroupName.toLowerCase()),
      ) ||
      groups[0] ||
      null
    );
  }, [effectiveGroupName, groups]);

  // 状态识别判断
  const isInspectingOverride = Boolean(
    selectedGroupOverride &&
      selectedGroupOverride.toLowerCase() !== (resolvedCurrentGroup || "").toLowerCase(),
  );

  const isCurrentKeyGroup = Boolean(
    !isInspectingOverride &&
      isKeyConfigured &&
      resolvedCurrentGroup &&
      activeGroup &&
      activeGroup.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase(),
  );

  const isUnboundRecommended = Boolean(
    !isInspectingOverride &&
      (!isKeyConfigured || !resolvedCurrentGroup),
  );

  // 健康度状态判定
  const getHealthStatus = (rate: number) => {
    if (rate >= 90) {
      return {
        label: "极佳",
        colorText: "text-emerald-600 dark:text-emerald-400",
        bgBadge:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
        dotColor: "bg-emerald-500",
        barColor: "#10b981",
        Icon: CheckCircle2,
      };
    }
    if (rate >= 50) {
      return {
        label: "波动",
        colorText: "text-amber-600 dark:text-amber-400",
        bgBadge:
          "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
        dotColor: "bg-amber-500",
        barColor: "#f59e0b",
        Icon: AlertTriangle,
      };
    }
    return {
      label: "告警",
      colorText: "text-rose-600 dark:text-rose-400",
      bgBadge:
        "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
      dotColor: "bg-rose-500",
      barColor: "#ef4444",
      Icon: AlertCircle,
    };
  };

  const currentHealth = activeGroup ? getHealthStatus(activeGroup.success_rate) : null;

  // 检查某个分组是否属于此工具推荐
  const isGroupRecommended = useCallback(
    (groupName: string) => {
      if (!guide?.recommendedKeywords) return false;
      const lower = groupName.toLowerCase();
      return guide.recommendedKeywords.some((kw) => lower.includes(kw));
    },
    [guide],
  );

  // 统计信息
  const recommendedCount = useMemo(() => {
    return groups.filter((g) => isGroupRecommended(g.group_name)).length;
  }, [groups, isGroupRecommended]);

  const highHealthCount = useMemo(() => {
    return groups.filter((g) => g.success_rate >= 90).length;
  }, [groups]);

  // 过滤与排序后的全部分组列表
  const filteredAndSortedGroups = useMemo(() => {
    let result = [...groups];

    // 1. 过滤搜索词
    if (groupSearch.trim()) {
      const q = groupSearch.toLowerCase().trim();
      result = result.filter((g) => g.group_name.toLowerCase().includes(q));
    }

    // 2. 选项卡过滤
    if (filterTab === "recommended") {
      result = result.filter((g) => isGroupRecommended(g.group_name));
    } else if (filterTab === "high") {
      result = result.filter((g) => g.success_rate >= 90);
    }

    // 3. 排序
    if (sortBy === "rate_desc") {
      result.sort((a, b) => b.success_rate - a.success_rate);
    } else if (sortBy === "latency_asc") {
      result.sort((a, b) => (a.avg_response_time || 999) - (b.avg_response_time || 999));
    } else if (sortBy === "requests_desc") {
      result.sort((a, b) => b.total_requests - a.total_requests);
    }

    return result;
  }, [groups, groupSearch, filterTab, sortBy, isGroupRecommended]);

  const renderedContext = captureContext();
  const renderedModalRequest = modalRequest.current;
  const isRenderedModalCurrent = () => isContextCurrent(renderedContext) && modalOpen.current &&
    renderedModalRequest === modalRequest.current;
  const switchTargetRatio = getValidGroupRatio(pricingInfo, switchModalState.targetGroupName);

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-300 overflow-hidden",
        "bg-white/70 dark:bg-[#101322]/70 backdrop-blur-md",
        "border-slate-200/90 dark:border-white/10 shadow-xs",
        className,
      )}
    >
      {/* ── 顶部极简概览栏（默认呈现，~52px 高度） ── */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap bg-slate-50/50 dark:bg-white/[0.02]">
        {/* 左侧：健康圆点、分组名称与状态标签 */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border shadow-2xs",
              theme.topIconBg,
            )}
          >
            <Activity size={14} className="animate-pulse" />
          </div>

          <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-800 dark:text-gray-100 tracking-tight flex-shrink-0">
              通道健康监控
            </span>

            {toolName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-white/5 truncate max-w-[130px]">
                {toolName}
              </span>
            )}

            {/* 活跃分组及状态指示 */}
            {activeGroup && (
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span
                  className="text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-white border border-slate-200/60 dark:border-white/5 truncate max-w-[170px]"
                  title={activeGroup.group_name}
                >
                  {activeGroup.group_name}
                </span>

                {(() => {
                  const badge = getGroupRatioBadge(pricingInfo.groupRatio[activeGroup.group_name]);
                  if (!badge) return null;
                  return (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-mono font-medium border flex items-center gap-0.5 flex-shrink-0 shadow-2xs",
                        badge.className,
                      )}
                      title={`通道费率倍率: ${pricingInfo.groupRatio[activeGroup.group_name]}x`}
                    >
                      {badge.isHigh && <AlertTriangle size={10} className="stroke-[2.5]" />}
                      {badge.text}
                    </span>
                  );
                })()}

                {isCurrentKeyGroup && (
                  <span
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded font-semibold border flex items-center gap-1 flex-shrink-0 shadow-2xs",
                      theme.boundBadge,
                    )}
                  >
                    <Check size={11} className="stroke-[3]" />
                    当前 Key 绑定
                  </span>
                )}

                {isInspectingOverride && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex-shrink-0">
                    临时对比预览
                  </span>
                )}

                {isUnboundRecommended && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-1 flex-shrink-0 shadow-2xs">
                    <Sparkles size={11} className="text-emerald-500" />
                    {isKeyConfigured ? "未关联分组 · 推荐最优通道" : "未配置 Key · 推荐最优通道"}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 中间：指标微型徽章（屏幕适中及宽屏下可见，一眼看穿健康与时延） */}
        {activeGroup && currentHealth && (
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0 font-mono text-[11px]">
            <div
              className={cn(
                "flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs",
                currentHealth.bgBadge,
              )}
            >
              <currentHealth.Icon size={12} className="stroke-[2.5]" />
              <span>健康度 {currentHealth.label}</span>
              <span className="font-bold">({activeGroup.success_rate.toFixed(1)}%)</span>
            </div>

            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-white/5">
              时延: {formatLatency(activeGroup.avg_response_time)}
            </span>

            {activeGroup.failed_requests > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-bold">
                异常 {activeGroup.failed_requests}次
              </span>
            )}
          </div>
        )}

        {/* 右侧控制项：刷新、网页大盘、核心「详情」展开按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {/* 移动端/小屏下的精炼健康胶囊 */}
          {activeGroup && currentHealth && (
            <div
              className="flex lg:hidden items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shadow-2xs font-mono"
              style={{ borderColor: currentHealth.barColor + "40" }}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", currentHealth.dotColor)} />
              <span>{activeGroup.success_rate.toFixed(0)}%</span>
            </div>
          )}

          {/* 刷新按钮 */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || !authState.is_logged_in}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-200/60 dark:hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
            title={lastUpdated ? `最后更新于 ${lastUpdated}，点击刷新` : "刷新监控数据"}
          >
            <RefreshCw
              ref={refreshIconRef}
              size={13}
              className={loading ? cn("animate-spin", theme.accentText) : ""}
            />
          </button>

          {/* 官方监控网页外链 */}
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com/channel-monitor")}
            className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white bg-slate-100/80 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 transition-all cursor-pointer shadow-2xs"
            title="前往 bob-api.com/channel-monitor 查看网页端完整大盘"
          >
            <span>网页大盘</span>
            <ExternalLink size={11} className="opacity-70" />
          </button>

          {/* 核心：「详情 / 收起」切换按钮 */}
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-95",
              showDetails
                ? "bg-slate-200/80 dark:bg-white/15 text-slate-800 dark:text-gray-100"
                : cn("text-white", theme.btnPrimary),
            )}
            title={showDetails ? "收起监控图表与全部分组详情" : "展开健康走势图表与全部分组对比"}
          >
            <span>{showDetails ? "收起" : "详情"}</span>
            {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* ── 核心展开详情区域（带流畅动画滑出） ── */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: "easeInOut" }}
            className="overflow-hidden border-t border-slate-100 dark:border-white/5"
          >
            {/* ── 针对各工具深度定制的专属分组与密钥规则 ── */}
            {guide && (
              <div
                className={cn(
                  "px-4 py-3 border-b flex items-start gap-2.5 text-xs leading-relaxed transition-colors",
                  theme.bannerBg,
                )}
              >
                <Info size={15} className={cn("flex-shrink-0 mt-0.5", theme.bannerIcon)} />
                <div className="flex-1 space-y-1 text-[11px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("font-bold text-xs", theme.bannerTitle)}>
                      {guide.title}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.2 rounded-full font-semibold border shadow-2xs",
                        theme.bannerTag,
                      )}
                    >
                      {guide.tag}
                    </span>
                  </div>

                  <p className="opacity-90 leading-relaxed">{guide.desc}</p>

                  <p className="opacity-80 text-[10px] flex items-center gap-1 pt-0.5 font-mono">
                    <Sparkles size={11} className="flex-shrink-0 opacity-70" />
                    <span>{guide.technicalNote}</span>
                  </p>
                </div>
              </div>
            )}
            {/* ── 监控核心展示区 ── */}
            <div className="p-4 space-y-3.5">
        {!authState.is_logged_in ? (
          /* 未登录状态下的引导卡片 */
          <div className="py-6 px-4 rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.015] flex flex-col items-center justify-center text-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shadow-xs",
                theme.topIconBg,
              )}
            >
              <ShieldCheck size={20} />
            </div>
            <div className="max-w-md space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                登录 Bob API 账号开启当前 Key 专属分组监控
              </p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                登录后即可自动读取当前配置 Key 所属的分组通道（如 SVIP-codex、ClaudeCode Kiro-1
                等）并实时展示可用性走势。
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs active:scale-95 transition-all cursor-pointer",
                  theme.btnPrimary,
                )}
              >
                立即登录账号
              </button>
              <button
                type="button"
                onClick={() => void openUrl("https://bob-api.com/channel-monitor")}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-white/10 text-xs font-medium transition-all cursor-pointer flex items-center gap-1"
              >
                <span>公开监控页面</span>
                <ExternalLink size={11} />
              </button>
            </div>
          </div>
        ) : loading && groups.length === 0 ? (
          /* 加载中状态 */
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-gray-500">
            <Activity size={22} className={cn("animate-spin", theme.accentText)} />
            <span className="text-xs">正在实时同步通道分组健康度数据...</span>
          </div>
        ) : errorMsg && groups.length === 0 ? (
          /* 出错状态 */
          <div className="py-5 px-4 rounded-xl bg-rose-50/70 dark:bg-rose-500/10 border border-rose-200/80 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="flex-shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
            {errorMsg.includes("登录") || errorMsg.includes("Unauthorized") ? (
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className="px-3 py-1 rounded-lg bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 font-medium active:scale-95 transition-all cursor-pointer"
              >
                去登录
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void loadData()}
                className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 active:scale-95 transition-all cursor-pointer"
              >
                重试
              </button>
            )}
          </div>
        ) : activeGroup ? (
          /* 活跃分组指标展示 */
          <div className="space-y-3">
            {/* 分组基本信息头部 */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-gray-400">
                  {isInspectingOverride
                    ? "正在对比预览分组:"
                    : isCurrentKeyGroup
                      ? "当前 Key 绑定分组:"
                      : "推荐监控分组:"}
                </span>

                <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-white border border-slate-200/60 dark:border-white/5 truncate max-w-[200px]">
                  {activeGroup.group_name}
                </span>

                {(() => {
                  const badge = getGroupRatioBadge(pricingInfo.groupRatio[activeGroup.group_name]);
                  if (!badge) return null;
                  return (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-mono font-medium border flex items-center gap-0.5 flex-shrink-0 shadow-2xs",
                        badge.className,
                      )}
                      title={`通道费率倍率: ${pricingInfo.groupRatio[activeGroup.group_name]}x`}
                    >
                      {badge.isHigh && <AlertTriangle size={10} className="stroke-[2.5]" />}
                      {badge.text}
                    </span>
                  );
                })()}

                {/* 状态指示徽标 */}
                {isCurrentKeyGroup && (
                  <span
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded font-semibold border flex items-center gap-1",
                      theme.boundBadge,
                    )}
                  >
                    <Check size={11} className="stroke-[3]" />
                    当前 Key 专属绑定
                  </span>
                )}

                {isInspectingOverride && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                      临时对比预览
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleInitiateSwitchGroup(activeGroup.group_name)}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 shadow-2xs cursor-pointer transition-colors active:scale-95"
                      title="直接将当前 API Key 切换至此预览分组"
                    >
                      <Zap size={10} className="fill-current" />
                      <span>切为此组</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGroupOverride(null);
                        if (onSelectGroup && resolvedCurrentGroup) {
                          onSelectGroup(resolvedCurrentGroup);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-white underline cursor-pointer"
                    >
                      <RotateCcw size={10} />
                      <span>恢复当前绑定</span>
                    </button>
                  </div>
                )}

                {isUnboundRecommended && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-gray-400 border border-slate-200 dark:border-white/10">
                    {isKeyConfigured ? "未关联专属分组 (推荐优质通道)" : "工具推荐默认 (未绑定专属 Key)"}
                  </span>
                )}
              </div>

              {/* 右侧：时间粒度与健康徽标 */}
              <div className="flex items-center gap-2">
                {/* 时间粒度选择 (1h / 2h / 3h) */}
                <div className="flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 text-[10px]">
                  {[1, 2, 3].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHours(h)}
                      className={cn(
                        "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                        hours === h
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                          : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
                      )}
                      title={`查看过去 ${h} 小时监控数据`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>

                {currentHealth && (
                  <div
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs",
                      currentHealth.bgBadge,
                    )}
                  >
                    <currentHealth.Icon size={12} className="stroke-[2.5]" />
                    <span>健康度 {currentHealth.label}</span>
                    <span className="font-mono ml-0.5 font-bold">
                      ({activeGroup.success_rate.toFixed(1)}%)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 核心指标卡片四宫格 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* 成功率 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium">
                  实时成功率
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span
                    className={cn(
                      "text-base font-bold font-mono tracking-tight",
                      currentHealth ? currentHealth.colorText : "text-slate-800 dark:text-white",
                    )}
                  >
                    {activeGroup.success_rate.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* 平均时延 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium flex items-center gap-1">
                  <Zap size={10} className="text-amber-500" />
                  平均响应时延
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-base font-bold font-mono tracking-tight text-slate-800 dark:text-gray-100">
                    {formatLatency(activeGroup.avg_response_time)}
                  </span>
                </div>
              </div>

              {/* 请求量 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium flex items-center gap-1">
                  <BarChart3 size={10} className={theme.accentIconColor} />
                  近 {hours}h 总请求数
                </span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-base font-bold font-mono tracking-tight text-slate-800 dark:text-gray-100">
                    {activeGroup.total_requests}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">次</span>
                </div>
              </div>

              {/* 异常失败 */}
              <div className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-white/[0.025] border border-slate-200/60 dark:border-white/5 flex flex-col justify-between">
                <span className="text-[10px] text-slate-400 dark:text-gray-400 font-medium flex items-center gap-1">
                  <Clock size={10} className="text-slate-400" />
                  失败请求数
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span
                    className={cn(
                      "text-base font-bold font-mono tracking-tight",
                      activeGroup.failed_requests > 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-600 dark:text-gray-300",
                    )}
                  >
                    {activeGroup.failed_requests}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">次</span>
                </div>
              </div>
            </div>

            {/* 现代化高颜值趋势走势可视化大盘 (带微光脉冲胶囊与平滑面积曲线双模式) */}
            {activeGroup.trend_points && activeGroup.trend_points.length > 0 && (
              <HealthTrendVisualizer
                trendPoints={activeGroup.trend_points}
                groupName={activeGroup.group_name}
                successRate={activeGroup.success_rate}
                avgLatency={activeGroup.avg_response_time}
                totalRequests={activeGroup.total_requests}
                failedRequests={activeGroup.failed_requests}
                hours={hours}
                accentColor={accentColor}
              />
            )}
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-slate-400">
            暂未获取到分组监控数据，请稍后刷新重试。
          </div>
        )}

        {/* ── 底部抽屉切换：查看与对比全部分组 ── */}
        {groups.length > 1 && (
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowAllGroups((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors cursor-pointer py-1"
              >
                <Layers size={13} className={theme.accentIconColor} />
                <span>
                  {showAllGroups ? "收起全部分组列表" : `对比平台全部 ${groups.length} 个通道分组健康度`}
                </span>
                {showAllGroups ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              <div className="flex items-center gap-2">
                {/* 弹窗全景大盘对比按钮 */}
                <button
                  type="button"
                  onClick={() => setCompareModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-white/10 transition-colors cursor-pointer"
                  title="在新弹窗中全屏查看所有通道详细对比与排序"
                >
                  <Maximize2 size={10} />
                  <span>弹窗大盘对比</span>
                </button>

                {onOpenTokenSelect && (
                  <button
                    type="button"
                    onClick={onOpenTokenSelect}
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-semibold transition-colors cursor-pointer",
                      theme.accentText,
                    )}
                  >
                    <KeyRound size={11} />
                    <span>选择账号 Key</span>
                  </button>
                )}

                {lastUpdated && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    更新: {lastUpdated}
                  </span>
                )}
              </div>
            </div>

            {/* 折叠展开的全部分组精细列表（优化布局：支持紧凑单行流式排版、快捷分类与弹窗大盘） */}
            {showAllGroups && (
              <div className="mt-2 space-y-2.5 pt-2.5 border-t border-slate-100/80 dark:border-white/5">
                {/* 搜索与过滤控制条 */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {/* 搜索框：圆形图标按钮 -> 搜索框 (CircleToSearchBar) */}
                  <CircleToSearchBar
                    value={groupSearch}
                    onChange={setGroupSearch}
                    placeholder="过滤分组名称 (如 SVIP, Claude, Codex)..."
                    title="过滤分组 (点击展开)"
                    size={28}
                    expandedWidth="full"
                    className="flex-1 min-w-[28px]"
                  />

                  {/* 过滤分类标签 */}
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFilterTab("all")}
                      className={cn(
                        "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                        filterTab === "all"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                          : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
                      )}
                    >
                      全部 ({groups.length})
                    </button>
                    {recommendedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setFilterTab("recommended")}
                        className={cn(
                          "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                          filterTab === "recommended"
                            ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                            : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
                        )}
                      >
                        推荐 ({recommendedCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFilterTab("high")}
                      className={cn(
                        "px-2 py-0.5 rounded-md font-medium transition-all cursor-pointer",
                        filterTab === "high"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                          : "text-slate-500 hover:text-slate-800 dark:text-gray-400",
                      )}
                    >
                      极佳 ≥90% ({highHealthCount})
                    </button>
                  </div>

                  {/* 视图切换 (紧凑单行列表 vs 双列卡片网格) */}
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      className={cn(
                        "p-1 rounded-md transition-all cursor-pointer",
                        viewMode === "list"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-gray-200",
                      )}
                      title="紧凑单行流式排版 (推荐)"
                    >
                      <LayoutList size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      className={cn(
                        "p-1 rounded-md transition-all cursor-pointer",
                        viewMode === "grid"
                          ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-gray-200",
                      )}
                      title="双列卡片网格"
                    >
                      <LayoutGrid size={12} />
                    </button>
                  </div>
                </div>

                {/* 分组列表呈现区：采用紧凑舒适的布局，绝不发生文字截断或元素切半 */}
                {filteredAndSortedGroups.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    未找到匹配的通道分组
                  </div>
                ) : viewMode === "list" ? (
                  /* ── 模式 1：紧凑单行流式列表 (点击预览可直接向下就地展开详情大盘) ── */
                  <div className="space-y-1.5 pb-1">
                    {filteredAndSortedGroups.map((g) => {
                      const isCur = g.group_name === activeGroup?.group_name;
                      const isBound =
                        resolvedCurrentGroup &&
                        g.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase();
                      const isRec = isGroupRecommended(g.group_name);
                      const st = getHealthStatus(g.success_rate);
                      const isExpanded = expandedGroup === g.group_name;

                      const handleToggleExpand = (e?: React.MouseEvent) => {
                        if (e) e.stopPropagation();
                        const next = isExpanded ? null : g.group_name;
                        setExpandedGroup(next);
                        setSelectedGroupOverride(g.group_name);
                        if (onSelectGroup) onSelectGroup(g.group_name);
                      };

                      return (
                        <div key={g.group_name} className="flex flex-col">
                          {/* 单行主要卡片 */}
                          <div
                            onClick={handleToggleExpand}
                            className={cn(
                              "flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer group",
                              isExpanded
                                ? "border-neutral-900 bg-neutral-100 dark:border-white dark:bg-white/10 shadow-xs"
                                : isCur
                                  ? theme.drawerActive
                                  : "border-slate-200/70 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.015] hover:border-slate-300 dark:hover:border-white/15 hover:bg-slate-100/60 dark:hover:bg-white/[0.04]",
                            )}
                          >
                            {/* 左侧：健康圆点、分组名称与状态标签 */}
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full flex-shrink-0 shadow-2xs",
                                  st.dotColor,
                                )}
                              />

                              <span
                                className="font-mono text-xs font-semibold text-slate-800 dark:text-gray-200 truncate max-w-[260px] sm:max-w-[320px]"
                                title={g.group_name}
                              >
                                {g.group_name}
                              </span>

                              {isBound && (
                                <span
                                  className={cn(
                                    "text-[10px] px-1.5 py-0.2 rounded font-semibold border flex-shrink-0",
                                    theme.boundBadge,
                                  )}
                                >
                                  当前绑定
                                </span>
                              )}

                              {isCur && !isBound && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex-shrink-0">
                                  对比预览中
                                </span>
                              )}

                              {isRec && !isBound && (
                                <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.2 rounded font-mono bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-800 flex-shrink-0">
                                  推荐通道
                                </span>
                              )}

                              {(() => {
                                const badge = getGroupRatioBadge(pricingInfo.groupRatio[g.group_name]);
                                if (!badge) return null;
                                return (
                                  <span
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.2 rounded font-mono border flex-shrink-0 flex items-center gap-0.5",
                                      badge.className,
                                    )}
                                    title={`通道计费倍率: ${pricingInfo.groupRatio[g.group_name]}x`}
                                  >
                                    {badge.isHigh && <AlertTriangle size={9} />}
                                    {badge.text}
                                  </span>
                                );
                              })()}
                            </div>

                            {/* 右侧：指标数值、改分组与展开按钮 */}
                            <div className="flex items-center gap-2.5 sm:gap-3 flex-shrink-0 text-slate-500 dark:text-gray-400 font-mono text-[11px]">
                              <span className="hidden md:inline-flex items-center gap-1 text-slate-400">
                                <Clock size={10} />
                                <span>{formatLatency(g.avg_response_time)}</span>
                              </span>

                              <span className="hidden sm:inline-block text-slate-400">
                                {g.total_requests} 次
                              </span>

                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex-shrink-0 shadow-2xs",
                                  st.bgBadge,
                                )}
                              >
                                {g.success_rate.toFixed(1)}% {st.label}
                              </span>

                              {/* 快捷改分组按钮 vs 当前使用指示 */}
                              {isBound ? (
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded-md text-[10px] font-semibold border flex items-center gap-1 flex-shrink-0 shadow-2xs",
                                    theme.boundBadge,
                                  )}
                                  title="当前所使用的 API Key 正在此通道生效"
                                >
                                  <Check size={11} className="stroke-[3]" />
                                  <span>当前使用</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleInitiateSwitchGroup(g.group_name);
                                  }}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 transition-all flex items-center gap-1 cursor-pointer shadow-2xs active:scale-95 flex-shrink-0"
                                  title={`将当前 API Key 直接切换到「${g.group_name}」分组`}
                                >
                                  <Zap size={10} className="fill-current" />
                                  <span>改用此组</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={handleToggleExpand}
                                className={cn(
                                  "px-2 py-0.5 rounded-md text-[10px] font-medium transition-all flex items-center gap-1 cursor-pointer",
                                  isExpanded
                                    ? "bg-slate-200/80 text-slate-800 dark:bg-white/20 dark:text-gray-100"
                                    : isCur
                                      ? "bg-slate-200/80 text-slate-800 dark:bg-white/15 dark:text-gray-100"
                                      : "bg-slate-100 hover:bg-slate-200/80 text-slate-600 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-400",
                                )}
                                title={isExpanded ? "收起此分组详情" : "向下展开此分组健康走势详情"}
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp size={11} />
                                    <span>收起</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye size={11} />
                                    <span>预览</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* ── 向下展开的健康状态详情抽屉卡片 ── */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                <div className="mt-1 mb-2 p-3.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/95 dark:bg-black/95 shadow-sm space-y-3">
                                  {/* 顶部标题栏与快速切换 */}
                                  <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-100 dark:border-white/5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                                        {g.group_name}
                                      </span>
                                      <span
                                        className={cn(
                                          "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-2xs",
                                          st.bgBadge,
                                        )}
                                      >
                                        健康度: {g.success_rate.toFixed(1)}% {st.label}
                                      </span>
                                      {isBound && (
                                        <span
                                          className={cn(
                                            "text-[10px] px-1.5 py-0.2 rounded font-semibold border",
                                            theme.boundBadge,
                                          )}
                                        >
                                          当前 Key 绑定
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {!isBound ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleInitiateSwitchGroup(g.group_name)}
                                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95"
                                        >
                                          <Zap size={12} className="fill-current" />
                                          <span>设为当前生效通道</span>
                                        </button>
                                      ) : (
                                        <span
                                          className={cn(
                                            "text-xs px-2.5 py-1 rounded-lg font-semibold border flex items-center gap-1.5",
                                            theme.boundBadge,
                                          )}
                                        >
                                          <Check size={12} className="stroke-[3]" />
                                          <span>当前 Key 正在此通道生效</span>
                                        </span>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => setExpandedGroup(null)}
                                        className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 flex items-center gap-1 cursor-pointer transition-colors ml-1"
                                      >
                                        <ChevronUp size={12} />
                                        <span>收起详情</span>
                                      </button>
                                    </div>
                                  </div>

                                  {/* 四宫格核心指标 */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">实时成功率</div>
                                      <div className={cn("text-sm font-bold font-mono mt-0.5", st.colorText)}>
                                        {g.success_rate.toFixed(1)}%
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">平均耗时</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {formatLatency(g.avg_response_time)}
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">总调用次数</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {g.total_requests} 次
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">异常失败</div>
                                      <div
                                        className={cn(
                                          "text-sm font-bold font-mono mt-0.5",
                                          g.failed_requests > 0
                                            ? "text-rose-600 dark:text-rose-400"
                                            : "text-slate-600 dark:text-gray-300",
                                        )}
                                      >
                                        {g.failed_requests} 次
                                      </div>
                                    </div>
                                  </div>

                                  {/* 全新高颜值健康状态走势大盘 */}
                                  <HealthTrendVisualizer
                                    trendPoints={g.trend_points}
                                    groupName={g.group_name}
                                    successRate={g.success_rate}
                                    avgLatency={g.avg_response_time}
                                    totalRequests={g.total_requests}
                                    failedRequests={g.failed_requests}
                                    hours={hours}
                                    accentColor={accentColor}
                                    compact
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* ── 模式 2：双列卡片网格 (支持展开跨列查看详情) ── */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-1">
                    {filteredAndSortedGroups.map((g) => {
                      const isCur = g.group_name === activeGroup?.group_name;
                      const isBound =
                        resolvedCurrentGroup &&
                        g.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase();
                      const st = getHealthStatus(g.success_rate);
                      const isExpanded = expandedGroup === g.group_name;

                      const handleToggleExpand = (e?: React.MouseEvent) => {
                        if (e) e.stopPropagation();
                        const next = isExpanded ? null : g.group_name;
                        setExpandedGroup(next);
                        setSelectedGroupOverride(g.group_name);
                        if (onSelectGroup) onSelectGroup(g.group_name);
                      };

                      return (
                        <div
                          key={g.group_name}
                          className={cn(
                            "flex flex-col transition-all",
                            isExpanded && "sm:col-span-2",
                          )}
                        >
                          <div
                            onClick={handleToggleExpand}
                            className={cn(
                              "p-2.5 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-2.5",
                              isExpanded
                                ? "border-neutral-900 bg-neutral-100 dark:border-white dark:bg-white/10 shadow-xs"
                                : isCur
                                  ? theme.drawerActive
                                  : "border-slate-200/70 dark:border-white/5 bg-slate-50/40 dark:bg-white/[0.015] hover:border-slate-300 dark:hover:border-white/15",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="truncate font-mono font-semibold text-slate-800 dark:text-gray-200">
                                  {g.group_name}
                                </span>
                                {isBound && (
                                  <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-neutral-200 text-neutral-800 dark:bg-white/20 dark:text-neutral-200">
                                    绑定
                                  </span>
                                )}
                                {isCur && <Check size={11} className={cn("stroke-[3]", theme.drawerCheck)} />}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                                <span>请求: {g.total_requests}次</span>
                                <span>·</span>
                                <span>时延: {formatLatency(g.avg_response_time)}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-mono font-bold flex-shrink-0",
                                  st.bgBadge,
                                )}
                              >
                                {g.success_rate.toFixed(0)}%
                              </span>

                              {/* 快捷改分组按钮 vs 当前使用指示 */}
                              {isBound ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-neutral-200 text-neutral-800 dark:bg-white/20 dark:text-neutral-200 flex items-center gap-0.5">
                                  <Check size={10} className="stroke-[3]" />
                                  使用中
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleInitiateSwitchGroup(g.group_name);
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 flex items-center gap-0.5 cursor-pointer shadow-2xs active:scale-95"
                                  title={`将当前 API Key 直接切换到「${g.group_name}」分组`}
                                >
                                  <Zap size={9} className="fill-current" />
                                  <span>改用</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={handleToggleExpand}
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-0.5 cursor-pointer",
                                  isExpanded
                                    ? "bg-slate-200/80 text-slate-800 dark:bg-white/20 dark:text-gray-100"
                                    : "bg-slate-100 hover:bg-slate-200/80 text-slate-600 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-400",
                                )}
                              >
                                {isExpanded ? <ChevronUp size={10} /> : <Eye size={10} />}
                                <span>{isExpanded ? "收起" : "预览"}</span>
                              </button>
                            </div>
                          </div>

                          {/* 向下展开的健康状态抽屉详情卡片 */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                <div className="mt-1 mb-2 p-3.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/95 dark:bg-black/95 shadow-sm space-y-3">
                                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5">
                                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate">
                                      {g.group_name}
                                    </span>
                                    {!isBound ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleInitiateSwitchGroup(g.group_name)}
                                        className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                                      >
                                        <Zap size={10} className="fill-current" />
                                        <span>设为当前生效通道</span>
                                      </button>
                                    ) : (
                                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1">
                                        <Check size={11} className="stroke-[3]" />
                                        <span>当前正在使用</span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">实时成功率</div>
                                      <div className={cn("text-sm font-bold font-mono mt-0.5", st.colorText)}>
                                        {g.success_rate.toFixed(1)}%
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">平均耗时</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {formatLatency(g.avg_response_time)}
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">总调用次数</div>
                                      <div className="text-sm font-bold font-mono text-slate-800 dark:text-gray-200 mt-0.5">
                                        {g.total_requests} 次
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5">
                                      <div className="text-[10px] text-slate-400">异常失败</div>
                                      <div
                                        className={cn(
                                          "text-sm font-bold font-mono mt-0.5",
                                          g.failed_requests > 0
                                            ? "text-rose-600 dark:text-rose-400"
                                            : "text-slate-600 dark:text-gray-300",
                                        )}
                                      >
                                        {g.failed_requests} 次
                                      </div>
                                    </div>
                                  </div>

                                  <HealthTrendVisualizer
                                    trendPoints={g.trend_points}
                                    groupName={g.group_name}
                                    successRate={g.success_rate}
                                    avgLatency={g.avg_response_time}
                                    totalRequests={g.total_requests}
                                    failedRequests={g.failed_requests}
                                    hours={hours}
                                    accentColor={accentColor}
                                    compact
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 全景对比大盘弹窗 (CompareModal) ── */}
      {compareModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 top-11 z-[85] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-md select-none animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCompareModalOpen(false);
            }}
          >
            <div className="relative w-full max-w-[840px] max-h-[88vh] bg-white dark:bg-black border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-neutral-800 dark:text-neutral-200">
              {/* 弹窗顶部栏 */}
              <div className="px-6 py-4 border-b border-slate-100 dark:border-white/10 flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-white/[0.02] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-xs",
                      theme.topIconBg,
                    )}
                  >
                    <Layers size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>通道分组健康度全景大盘对比</span>
                      <span className="text-xs font-mono font-normal text-slate-400 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5">
                        共 {groups.length} 个通道
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                      实时比对平台全部上游通道成功率、平均时延及总负载，点击可直接激活预览
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCompareModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 弹窗检索与排序控制栏 */}
              <div className="px-6 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap bg-white/40 dark:bg-white/[0.01]">
                <CircleToSearchBar
                  value={groupSearch}
                  onChange={setGroupSearch}
                  placeholder="过滤通道名称 (如 SVIP, Claude, Codex)..."
                  title="过滤通道 (点击展开)"
                  size={32}
                  expandedWidth="full"
                  className="flex-1 min-w-[32px]"
                />

                {/* 排序器 */}
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
                  <ArrowUpDown size={12} className="opacity-70" />
                  <span className="text-[11px]">排序:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="h-8 px-2 text-xs rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-gray-200 focus:outline-none cursor-pointer font-mono"
                  >
                    <option value="default">默认排列</option>
                    <option value="rate_desc">成功率从高到低</option>
                    <option value="latency_asc">平均时延从低到高</option>
                    <option value="requests_desc">总请求量从多到少</option>
                  </select>
                </div>
              </div>

              {/* 弹窗内容大盘列表 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-2">
                {filteredAndSortedGroups.map((g) => {
                  const isCur = g.group_name === activeGroup?.group_name;
                  const isBound =
                    resolvedCurrentGroup &&
                    g.group_name.toLowerCase() === resolvedCurrentGroup.toLowerCase();
                  const isRec = isGroupRecommended(g.group_name);
                  const st = getHealthStatus(g.success_rate);

                  return (
                    <div
                      key={g.group_name}
                      onClick={() => {
                        setSelectedGroupOverride(g.group_name);
                        if (onSelectGroup) onSelectGroup(g.group_name);
                        setCompareModalOpen(false);
                      }}
                      className={cn(
                        "p-3 rounded-2xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-4 group",
                        isCur
                          ? theme.drawerActive
                          : "border-slate-200/80 dark:border-white/5 bg-slate-50/40 dark:bg-white/[0.015] hover:border-slate-300 dark:hover:border-white/15 hover:bg-slate-100/50 dark:hover:bg-white/[0.03]",
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-xs", st.dotColor)} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-bold text-slate-900 dark:text-white truncate">
                              {g.group_name}
                            </span>
                            {isBound && (
                              <span
                                className={cn(
                                  "text-[10px] px-2 py-0.2 rounded-md font-semibold border",
                                  theme.boundBadge,
                                )}
                              >
                                当前 Key 绑定
                              </span>
                            )}
                            {isCur && !isBound && (
                              <span className="text-[10px] px-2 py-0.2 rounded-md font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                正在对比预览
                              </span>
                            )}
                            {isRec && (
                              <span className="text-[10px] px-2 py-0.2 rounded-md font-mono bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-800">
                                此工具推荐
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-gray-400 font-mono mt-1 flex items-center gap-3">
                            <span>请求数: {g.total_requests} 次</span>
                            <span>·</span>
                            <span>平均响应: {formatLatency(g.avg_response_time)}</span>
                            {g.failed_requests > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-rose-500 font-semibold">
                                  异常: {g.failed_requests} 次
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-mono font-bold shadow-2xs",
                            st.bgBadge,
                          )}
                        >
                          {g.success_rate.toFixed(1)}% {st.label}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareModalOpen(false);
                            void handleInitiateSwitchGroup(g.group_name);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs active:scale-95",
                            isBound
                              ? "bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-200"
                              : theme.btnPrimary,
                          )}
                        >
                          {isBound ? (
                            <>
                              <Check size={13} className="stroke-[3]" />
                              <span>当前正在使用</span>
                            </>
                          ) : (
                            <>
                              <Zap size={13} className="fill-current" />
                              <span>切换为此分组</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ── 核心改造：一键切换分组确认弹窗 (SwitchGroupModal) ── */}
      {switchModalState.open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 top-11 z-[90] flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-md select-none animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget && !switchModalState.isSubmitting) {
                handleCloseSwitchModal();
              }
            }}
          >
            <div className="relative w-full max-w-[500px] bg-white dark:bg-black border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-neutral-800 dark:text-neutral-200 animate-in zoom-in-95 duration-200">
              {/* 弹窗头部 */}
              <div className="px-6 py-4 border-b border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between gap-3 bg-neutral-50/60 dark:bg-neutral-900/40">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center font-bold shadow-xs",
                      theme.topIconBg,
                    )}
                  >
                    <Zap size={16} className="fill-current text-black dark:text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span>切换 API Key 分组</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-normal bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-800">
                        无需回网站
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400">
                      将云端 API Key 绑定的路由通道直接拨动至新分组
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={switchModalState.isSubmitting}
                  onClick={handleCloseSwitchModal}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 弹窗内容 */}
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className={switchTargetRatio === null ? "text-amber-700 dark:text-amber-300" : "text-slate-500"}>
                    {switchTargetRatio === null ? "费率未知、正在刷新或已过期，暂不可提交" : "已取得有效费率（有效期 5 分钟）"}
                  </span>
                  <button type="button" disabled={pricingLoading || switchModalState.isSubmitting}
                    onClick={() => void loadData(true)} className="text-blue-500 whitespace-nowrap disabled:opacity-50">
                    {pricingLoading ? "刷新中…" : "刷新费率"}
                  </button>
                </div>
                {/* 目标分组预览卡片 */}
                <div className="p-3.5 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wider block mb-0.5">
                      目标新分组通道
                    </span>
                    <span className="text-sm font-bold font-mono text-slate-900 dark:text-white truncate block">
                      {switchModalState.targetGroupName}
                    </span>
                    {switchModalState.targetGroupItem && (
                      <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-500 dark:text-gray-400">
                        <span>平均时延: {formatLatency(switchModalState.targetGroupItem.avg_response_time)}</span>
                        <span>·</span>
                        <span>调用量: {switchModalState.targetGroupItem.total_requests}次</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {switchModalState.targetGroupItem && (
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-mono font-bold shadow-2xs",
                          getHealthStatus(switchModalState.targetGroupItem.success_rate).bgBadge,
                        )}
                      >
                        {switchModalState.targetGroupItem.success_rate.toFixed(1)}% {getHealthStatus(switchModalState.targetGroupItem.success_rate).label}
                      </span>
                    )}
                    {(() => {
                      const badge = getGroupRatioBadge(switchTargetRatio ?? undefined);
                      if (!badge) return null;
                      return (
                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-mono border", badge.className)}>
                          计费 {badge.text}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* 费率与额度风险警告条 */}
                {(() => {
                  const targetRatio = switchTargetRatio;
                  if (typeof targetRatio !== "number" || !Number.isFinite(targetRatio) || targetRatio <= 1.0) return null;
                  const isVeryHigh = targetRatio >= 2.0;
                  return (
                    <div
                      className={cn(
                        "p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-200",
                        isVeryHigh
                          ? "bg-rose-50/90 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/40 text-rose-900 dark:text-rose-200"
                          : "bg-amber-50/90 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200",
                      )}
                    >
                      <AlertTriangle
                        size={17}
                        className={cn(
                          "flex-shrink-0 mt-0.5",
                          isVeryHigh ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
                        )}
                      />
                      <div className="space-y-1">
                        <div className="font-bold flex items-center gap-1.5">
                          <span>高费率通道预警：计费倍率 {targetRatio}x</span>
                          <span
                            className={cn(
                              "text-[10px] px-1.5 py-0.2 rounded font-normal",
                              isVeryHigh
                                ? "bg-rose-200/60 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300"
                                : "bg-amber-200/60 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300",
                            )}
                          >
                            消耗加速
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed opacity-90">
                          该通道为高费率/独立算力通道，模型调用的额度消耗将是标准通道的 <strong>{targetRatio} 倍</strong>。请确认您的账户余额充裕，避免短时间内被快速扣尽。
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* 选择要更改分组的 API Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center justify-between">
                    <span>生效的 API Key 凭据</span>
                    {switchModalState.tokensList.length > 0 && (
                      <span className="text-[10px] font-mono text-slate-400">
                        共 {switchModalState.tokensList.length} 个 Key
                      </span>
                    )}
                  </label>

                  {switchModalState.loadingTokens ? (
                    <div className="py-4 flex items-center justify-center gap-2 text-xs text-slate-400">
                      <Loader2 size={14} className="animate-spin text-black dark:text-white" />
                      <span>正在获取您的 API Key 资产...</span>
                    </div>
                  ) : switchModalState.tokensList.length === 0 ? (
                    <div className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-700 dark:text-neutral-300">
                      未找到可用的 API Key，请先前往 bob-api 网页端创建。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={switchModalState.selectedTokenId || ""}
                        onChange={(e) =>
                          setSwitchModalState((prev) => ({
                            ...prev,
                            selectedTokenId: Number(e.target.value),
                          }))
                        }
                        className="w-full h-9 px-3 text-xs rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white font-mono cursor-pointer"
                      >
                        {switchModalState.tokensList.map((token) => (
                          <option key={token.id} value={token.id}>
                            {token.name} (当前分组: {token.group || "默认"})
                          </option>
                        ))}
                      </select>

                      {/* 当前选中的 Token 变更指引 */}
                      {(() => {
                        const curToken = switchModalState.tokensList.find(
                          (t) => t.id === switchModalState.selectedTokenId,
                        );
                        if (!curToken) return null;
                        return (
                          <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[11px] font-mono flex items-center justify-between">
                            <span className="text-neutral-500">分组变更路径:</span>
                            <div className="flex items-center gap-1.5 font-semibold">
                              <span className="text-neutral-600 dark:text-neutral-400">
                                {curToken.group || "默认"}
                              </span>
                              <span className="text-neutral-400">➔</span>
                              <span className="text-black dark:text-white font-bold">
                                {switchModalState.targetGroupName}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* 同步选项复选框 */}
                <div className="pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-gray-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={switchModalState.syncToAllAgents}
                      onChange={(e) =>
                        setSwitchModalState((prev) => ({
                          ...prev,
                          syncToAllAgents: e.target.checked,
                        }))
                      }
                      className="rounded border-neutral-300 dark:border-neutral-700 text-black dark:text-white focus:ring-black dark:focus:ring-white cursor-pointer"
                    />
                    <span>同时将此生效 Key 同步至全部 4 大本地 Agent (Codex, Claude, Workbuddy, Accio)</span>
                  </label>
                </div>

                {/* 超高倍率通道强制二次确认勾选 */}
                {(() => {
                  const targetRatio = switchTargetRatio;
                  if (typeof targetRatio !== "number" || !Number.isFinite(targetRatio) || targetRatio < 2.0) return null;
                  return (
                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50/80 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/30 text-xs text-rose-950 dark:text-rose-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={switchModalState.ackHighRatio}
                        onChange={(e) =>
                          setSwitchModalState((prev) => ({
                            ...prev,
                            ackHighRatio: e.target.checked,
                          }))
                        }
                        className="rounded border-rose-400 text-rose-600 focus:ring-rose-500 cursor-pointer mt-0.5"
                      />
                      <span className="font-semibold leading-snug">
                        我已知晓「{switchModalState.targetGroupName}」通道费率为 {targetRatio}x（扣费速度为标准通道 {targetRatio} 倍），确认切换
                      </span>
                    </label>
                  );
                })()}

                {/* 即时生效温馨提示 */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed flex items-start gap-2">
                  <Sparkles size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>瞬时无感生效：</strong>修改由服务端 API 直接更新 Key 的路由表，无需在本地配置文件中替换 Key 字符串，下一次发起请求将自动走新分组。
                  </span>
                </div>

                {/* 错误警告条 */}
                {switchModalState.errorMessage && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-xs text-rose-700 dark:text-rose-300 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-rose-500" />
                      <span>{switchModalState.errorMessage}</span>
                    </div>
                    {switchModalState.errorMessage.includes("权限") || switchModalState.errorMessage.includes("无权") ? (
                      <button
                        type="button"
                        onClick={() => void openUrl("https://bob-api.com")}
                        className="underline text-[11px] font-semibold text-rose-700 dark:text-rose-300 flex-shrink-0 hover:text-rose-900 cursor-pointer"
                      >
                        前往官网开通
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              {/* 弹窗底部操作 */}
              <div className="overflow-visible px-6 py-3.5 border-t border-slate-100 dark:border-white/10 flex items-center justify-end gap-2.5 bg-slate-50/50 dark:bg-white/[0.02]">
                <button
                  type="button"
                  disabled={switchModalState.isSubmitting}
                  onClick={handleCloseSwitchModal}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                >
                  取消
                </button>

                <ButtonToLoaderToSuccess
                  key={renderedModalRequest}
                  accent="mono"
                  disabled={
                    switchModalState.isSubmitting || pricingLoading ||
                    switchModalState.tokensList.length === 0 ||
                    getGroupSwitchError(pricingInfo, switchModalState.targetGroupName, switchModalState.ackHighRatio) !== null
                  }
                  className="px-5 py-2 min-w-[180px]"
                  idleLabel={
                    <>
                      <Zap size={13} className="fill-current" />
                      <span>确认切换并即时生效</span>
                    </>
                  }
                  successLabel="分组已切换"
                  resetAfterMs={null}
                  holdMs={800}
                  onAction={handleConfirmSwitchGroup}
                  onBusyChange={(busy) => {
                    if (isRenderedModalCurrent()) setSwitchModalState((prev) => ({ ...prev, isSubmitting: busy }));
                  }}
                  onComplete={() => { if (isRenderedModalCurrent()) handleCloseSwitchModal(); }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default ChannelGroupMonitor;

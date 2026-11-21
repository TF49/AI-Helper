import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  Route,
  Save,
  Server,
  Star,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DeepSeekHarnessIcon } from "./BrandIcons";
import { classifyDshModels, fetchDshModels, getDshConfig } from "../lib/api";
import { ConfigPathBar } from "./ConfigPathBar";
import { NodeCardSelector } from "./NodeCardSelector";
import { ApiKeyInput } from "./ApiKeyInput";
import { ChannelGroupMonitor } from "./ChannelGroupMonitor";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import {
  PRESET_URLS,
  type DshModelRoute,
  type DshRouteKind,
  type DshSavePayload,
  type DshUIConfig,
} from "../types";
import { useBoundTokenGroup } from "../lib/useBoundTokenGroup";
import { dshKeyStatusId, useDshKeyStatus } from "../lib/useDshKeyStatus";
import { SpotlightCard } from "./react-bits/SpotlightCard";
import { TerminalTestModal } from "./TerminalTestModal";
import { StepIndicator, type StepDef } from "./StepIndicator";
import { ConfigConfirmStep } from "./ConfigConfirmStep";
import {
  DSH_BINDING_TOOL_ID,
  DSH_QUICK_MODEL,
  dshCurrentSelection,
  dshNodeUrl,
} from "../lib/dshQuickPayload";

/** 模型按协议自动写入的路由在界面上的名称；aihelper-* 路由名只在「详细信息」中展示 */
const ROUTE_LABELS: Record<DshRouteKind, string> = {
  domestic: "国产模型",
  claude: "Claude 模型",
  codex: "GPT 模型",
};

const ROUTE_ORDER: DshRouteKind[] = ["domestic", "claude", "codex"];

/** AI Helper 管理的路由在 DeepSeek Harness 配置中的名称 */
const ROUTE_IDS: Record<DshRouteKind, string> = {
  domestic: "aihelper-cn",
  claude: "aihelper-claude",
  codex: "aihelper-codex",
};

const KEEP_DEFAULT = "__keep__";

/** 文件路径、路由名、官方路由说明等技术细节，默认折叠 */
function DetailsFold({ children, attention }: { children: React.ReactNode; attention?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Info size={12} />
          详细信息
          {attention && !open && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              有提醒
            </span>
          )}
        </span>
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

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

const TOTAL_STEPS = 4;

function maskKey(key: string): string | undefined {
  if (!key) return undefined;
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "已填写";
}

/** 默认模型所在的路由类型：AI Helper 路由 / 官方路由 / 用户自建路由 / 未设置 / 指向不存在的路由 */
type DefaultRouteKind = "managed" | "official" | "external" | "builtin" | "missing";

function defaultRouteOf(cfg: DshUIConfig | null | undefined): DefaultRouteKind {
  const provider = cfg?.default_model?.provider;
  if (!provider) return "builtin";
  if ((cfg?.routes ?? []).some((r) => r.configured && r.route === provider)) return "managed";
  if (cfg?.official?.default_is_official) return "official";
  if ((cfg?.external_routes ?? []).some((r) => r.name === provider)) return "external";
  return "missing";
}

/** 默认模型的展示文案：模型名 + 所在路由的友好名称 */
function defaultLabelOf(cfg: DshUIConfig | null | undefined): string {
  const current = cfg?.default_model;
  if (!current) return "DeepSeek Harness 内置默认";
  const kind = defaultRouteOf(cfg);
  if (kind === "managed") {
    const route = (cfg?.routes ?? []).find((r) => r.configured && r.route === current.provider);
    return route ? `${current.model}（${ROUTE_LABELS[route.kind]}）` : current.model;
  }
  if (kind === "official") return `${current.model}（DeepSeek 官方）`;
  if (kind === "external") return `${current.model}（自建路由 ${current.provider}）`;
  return `${current.model}（路由已失效）`;
}

export function DshPanel() {
  const [config, setConfig] = useState<DshUIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState<string>(PRESET_URLS[0]);
  const [apiKey, setApiKey] = useState("");
  /** 已勾选写入 DeepSeek Harness 的模型 */
  const [models, setModels] = useState<string[]>([]);
  /** 可供勾选的模型（中转站拉取结果 + 已配置 + 手动添加） */
  const [available, setAvailable] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  /** 已用当前 Key / 节点拉取过模型列表 */
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  /** 当前勾选列表对应的 Key：换成另一个 Key 时按该 Key 重新挑选模型 */
  const [modelsKey, setModelsKey] = useState("");
  const [customModel, setCustomModel] = useState("");
  /** 上次拉取时已不在该 Key 当前分组中的模型（分组在 bob-api 网页被切换后常见） */
  const [unavailable, setUnavailable] = useState<string[]>([]);
  /** 本次手动添加的模型：用户明确要求，拉取时不因不在列表中而被取消勾选 */
  const [manualModels, setManualModels] = useState<string[]>([]);
  /** 概览中各 Key 分组 / 可用模型的重新查询计数 */
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [defaultChoice, setDefaultChoice] = useState<string>(KEEP_DEFAULT);
  /**
   * 默认模型是 AI Helper 自动预选的（非用户手动选择）：预选模型不在该 Key 的模型中时，
   * 改用该 Key 可用的模型，而不是退回 DeepSeek Harness 内置默认（通常需要官方账号）
   */
  const [autoDefault, setAutoDefault] = useState(false);
  /**
   * replace：更换当前 Key，新 Key 接管被替换 Key 的路由；
   * add：添加其它分组的 Key，与已接入的 Key 并存
   */
  const [keyMode, setKeyMode] = useState<"replace" | "add">("replace");
  /** 本次向导中被替换的 Key（进入向导时的 Key）；添加模式或首次接入时为空 */
  const [replaceKey, setReplaceKey] = useState("");
  const [routing, setRouting] = useState<DshModelRoute[]>([]);
  const [testModalOpen, setTestModalOpen] = useState(false);

  const [currentStep, setCurrentStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [configConfirmed, setConfigConfirmed] = useState(false);

  const { group: apiKeyGroup, onBoundTokenChange } = useBoundTokenGroup(
    DSH_BINDING_TOOL_ID,
    apiKey,
  );

  const profile = config?.selected_profile || "";
  const configuredRoutes = (config?.routes ?? []).filter((r) => r.configured);
  const anyConfigured = configuredRoutes.length > 0;
  const fetchKey = `${url}::${apiKey.trim()}`;
  // 每个已接入的 Key 各自所属的分组与当前可用模型（只读，不改写绑定）
  const keyStatus = useDshKeyStatus(
    configuredRoutes.map((r) => ({ url: dshNodeUrl(r.base_url), apiKey: r.api_key })),
    statusRefresh,
  );

  // AI Helper 只配置 DeepSeek Harness 桌面版，固定读写 desktop 档案
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const cfg = await getDshConfig(null);
      setConfig(cfg);
      if (cfg.read_error) {
        toast.warning(`DeepSeek Harness 配置读取不完整: ${cfg.read_error}`);
      }
      const current = dshCurrentSelection(cfg);
      setUrl(current?.url ?? PRESET_URLS[0]);
      setApiKey(current?.apiKey ?? "");
      setModels(current?.models ?? []);
      setAvailable(current?.models ?? []);
      setModelsKey(current?.apiKey.trim() ?? "");
      setKeyMode("replace");
      setReplaceKey(current?.apiKey.trim() ?? "");
      setFetchedFor(null);
      setCustomModel("");
      setUnavailable([]);
      setManualModels([]);
      setStatusRefresh((n) => n + 1);

      const managedDefault =
        cfg.default_model && cfg.default_model.provider.startsWith("aihelper-")
          ? cfg.default_model.model
          : null;
      // 默认模型指向的路由已不存在（如被删掉的自建路由）时，若同名模型在本 Key 下可用就预选它，避免保持失效的默认值
      const orphanDefault =
        cfg.default_model && defaultRouteOf(cfg) === "missing" && current?.models.includes(cfg.default_model.model)
          ? cfg.default_model.model
          : null;
      // 用户明确选择的 DeepSeek 官方默认模型不被覆盖；首次接入时优先 deepseek-v4.1-flash
      const autoPick = !managedDefault && !orphanDefault && !current && !cfg.official?.default_is_official;
      setDefaultChoice(managedDefault ?? orphanDefault ?? (autoPick ? DSH_QUICK_MODEL : KEEP_DEFAULT));
      setAutoDefault(autoPick);

      setShowSummary(Boolean(current));
      setMaxStepReached(current ? TOTAL_STEPS - 1 : 0);
      if (!current) setCurrentStep(0);
    } catch (e) {
      toast.error(`读取 DeepSeek Harness 配置失败: ${e}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConfigConfirmed(false);
  }, [url, apiKey, models, defaultChoice]);

  // 模型会按协议写入哪条路由由后端判定，这里只取回来展示
  useEffect(() => {
    let alive = true;
    if (models.length === 0) {
      setRouting([]);
      return;
    }
    classifyDshModels(models)
      .then((result) => alive && setRouting(result))
      .catch(() => alive && setRouting([]));
    return () => {
      alive = false;
    };
  }, [models]);

  const handleFetchModels = async (silent = false) => {
    const key = apiKey.trim();
    if (!key) {
      if (!silent) toast.warning("请先填写 API Key");
      return;
    }
    // 首次接入时默认勾选该 Key 可用的全部模型；同一 Key 再次拉取时保留用户原有勾选
    const selectAll = !anyConfigured;
    const keyChanged = anyConfigured && key !== modelsKey;
    setFetching(true);
    try {
      const ids = await fetchDshModels(url, key);
      let base: string[];
      if (keyChanged) {
        // 已用此 Key 接入的路由沿用原勾选
        base = configuredRoutes.filter((r) => r.api_key === key).flatMap((r) => r.models);
        if (base.length === 0 && ids.length > 0) {
          // 更换 Key：新 Key 接管被替换 Key 的路由，只避开其它 Key 仍在使用的协议（只有一个 Key 时即全选）；
          // 添加其它分组的 Key：只预选尚未被已接入 Key 占用的协议的模型，避免顶掉已配好的分组（如 Claude）
          const replaced = keyMode === "replace" && replaceKey ? replaceKey : null;
          const taken = new Set(configuredRoutes.filter((r) => r.api_key !== replaced).map((r) => r.kind));
          const classified = await classifyDshModels(ids).catch(() => []);
          base = classified.filter((c) => !taken.has(c.kind)).map((c) => c.model);
          // 默认模型在被替换 Key 的路由上时，新 Key 若没有同名模型就改用它可用的模型，避免默认模型失效
          const currentDefault = config?.default_model;
          if (
            replaced &&
            currentDefault &&
            configuredRoutes.some((r) => r.api_key === replaced && r.route === currentDefault.provider)
          ) {
            setAutoDefault(true);
          }
        }
      } else {
        base = selectAll ? [...models, ...ids] : models;
      }
      // 中转站按 Key 当前所属分组返回模型。分组在 bob-api 网页被切换后，原先勾选的模型可能已无可用渠道，
      // 保存后会在 DeepSeek Harness 中报 model_not_found，因此取消勾选并标记；手动添加的模型除外。
      // 列表为空时无法判断，保持原样
      const listed = new Set(ids);
      const isUnavailable = (m: string) => ids.length > 0 && !listed.has(m) && !manualModels.includes(m);
      const unique = Array.from(new Set(base));
      const stale = unique.filter(isUnavailable);
      const kept = unique.filter((m) => !isUnavailable(m));
      setModels(kept);
      setUnavailable(stale);
      setAvailable(Array.from(new Set([...kept, ...ids, ...stale])));
      if (keyChanged || selectAll) setModelsKey(key);
      setFetchedFor(`${url}::${key}`);
      if (stale.length > 0) {
        toast.warning(
          `${stale.length} 个模型已不在该 Key 当前分组${apiKeyGroup ? `（${apiKeyGroup}）` : ""}中，已取消勾选：${stale.join("、")}`,
          { duration: 8000 },
        );
      } else if (!silent || ids.length === 0) {
        toast.success(
          selectAll
            ? `已拉取并勾选 ${ids.length} 个可用模型`
            : keyChanged
              ? `已拉取 ${ids.length} 个可用模型，已为此 Key 勾选 ${kept.length} 个`
              : `已拉取 ${ids.length} 个可用模型，新模型可点击「全选」加入`,
        );
      }
    } catch (e) {
      setFetchedFor(`${url}::${key}`);
      toast.error(`拉取模型列表失败: ${e}`);
    } finally {
      setFetching(false);
    }
  };

  const toggleModel = (model: string) =>
    setModels((prev) => (prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]));

  const addCustomModel = () => {
    const model = customModel.trim();
    if (!model) return;
    setAvailable((prev) => (prev.includes(model) ? prev : [...prev, model]));
    setModels((prev) => (prev.includes(model) ? prev : [...prev, model]));
    setManualModels((prev) => (prev.includes(model) ? prev : [...prev, model]));
    setUnavailable((prev) => prev.filter((m) => m !== model));
    setCustomModel("");
  };

  // 进入「选择模型」步骤时自动用当前 Key 拉取一次可用模型（含从概览「编辑此 Key」进入）
  useEffect(() => {
    if (showSummary || currentStep !== 2 || fetching || !apiKey.trim() || fetchedFor === fetchKey) return;
    void handleFetchModels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSummary, currentStep, fetchKey]);

  /** 从概览进入向导，编辑使用该 Key 的路由（其它 Key 的路由保持不变） */
  const editKey = (key: string, nodeUrl: string, preferredDefault?: string) => {
    const same = Array.from(
      new Set(configuredRoutes.filter((r) => r.api_key === key).flatMap((r) => r.models)),
    );
    setUrl(nodeUrl);
    setApiKey(key);
    setModels(same);
    setAvailable(same);
    setModelsKey(key);
    setKeyMode("replace");
    setReplaceKey(key);
    setUnavailable([]);
    setManualModels([]);
    setFetchedFor(null);
    setCustomModel("");
    if (preferredDefault) {
      setDefaultChoice(preferredDefault);
      setAutoDefault(false);
    }
    setDirection(1);
    setCurrentStep(2);
    setMaxStepReached(TOTAL_STEPS - 1);
    setShowSummary(false);
  };

  /** 从概览添加其它分组的 Key：与已接入的 Key 并存，默认模型保持不变 */
  const startAddKey = () => {
    setApiKey("");
    setModels([]);
    setAvailable([]);
    setModelsKey("");
    setKeyMode("add");
    setReplaceKey("");
    setUnavailable([]);
    setManualModels([]);
    setFetchedFor(null);
    setCustomModel("");
    setDefaultChoice(KEEP_DEFAULT);
    setAutoDefault(false);
    setDirection(1);
    setCurrentStep(1);
    setMaxStepReached(1);
    setShowSummary(false);
  };

  // 所选默认模型被取消勾选时视为保持现状（重新勾选后自动恢复）；
  // 自动预选的模型不在勾选中时，改用勾选中的国产模型（没有则第一个），不退回内置默认
  const fallbackDefault =
    routing.find((r) => r.kind === "domestic" && models.includes(r.model))?.model ?? models[0];
  const effectiveDefault = models.includes(defaultChoice)
    ? defaultChoice
    : autoDefault && fallbackDefault
      ? fallbackDefault
      : KEEP_DEFAULT;

  const currentDefaultLabel = defaultLabelOf(config);

  // 概览逐条路由：所属分组、模型是否仍在该 Key 当前分组中
  const routeHealth = configuredRoutes.map((route) => {
    const nodeUrl = dshNodeUrl(route.base_url);
    const status = keyStatus[dshKeyStatusId({ url: nodeUrl, apiKey: route.api_key })];
    const listed = status?.available ? new Set(status.available) : null;
    return {
      route,
      nodeUrl,
      group: status?.group ?? (route.api_key === apiKey.trim() ? apiKeyGroup : null),
      checked: status?.checked ?? false,
      missing: listed ? route.models.filter((m) => !listed.has(m)) : [],
    };
  });
  const defaultModel = config?.default_model ?? null;
  const defaultKind = defaultRouteOf(config);
  const defaultRoute =
    defaultKind === "managed" ? routeHealth.find((h) => h.route.route === defaultModel?.provider) : undefined;
  const defaultUnavailable = Boolean(
    defaultRoute &&
      defaultModel &&
      (!defaultRoute.route.models.includes(defaultModel.model) || defaultRoute.missing.includes(defaultModel.model)),
  );
  // 默认模型失效时，找一条仍提供同名模型的路由，可一键进入向导改到该路由上
  const defaultFixRoute =
    defaultModel && (defaultKind === "missing" || defaultUnavailable)
      ? routeHealth.find(
          (h) => h.route.models.includes(defaultModel.model) && !h.missing.includes(defaultModel.model),
        )
      : undefined;
  const defaultBroken = defaultKind === "missing" || defaultUnavailable;
  const staleRouteCount = routeHealth.filter((h) => h.missing.length > 0).length;
  // 已勾选但上次拉取时不在该 Key 当前分组中的模型（用户手动重新勾选的）
  const selectedUnavailable = models.filter((m) => unavailable.includes(m));

  // 默认模型排在首位，DeepSeek Harness 的模型列表按此顺序展示
  const orderedModels =
    effectiveDefault === KEEP_DEFAULT
      ? models
      : [effectiveDefault, ...models.filter((m) => m !== effectiveDefault)];

  const payload: DshSavePayload = {
    profile: profile || null,
    api_key: apiKey.trim(),
    base_url: url,
    models: orderedModels,
    default_model: effectiveDefault === KEEP_DEFAULT ? null : effectiveDefault,
  };

  const routeCounts = useMemo(() => {
    const counts: Record<DshRouteKind, number> = { domestic: 0, claude: 0, codex: 0 };
    for (const item of routing) counts[item.kind] += 1;
    return counts;
  }, [routing]);
  const routingSummary = ROUTE_ORDER.filter((kind) => routeCounts[kind] > 0)
    .map((kind) => `${ROUTE_LABELS[kind]} ${routeCounts[kind]}`)
    .join(" · ");
  // 只有使用同一 Key 的路由才受本次保存影响：没有模型了会被移除；
  // 其它 Key 的路由若本次也有模型会改用此 Key，否则保持不变
  const routingReady = routing.length === models.length;
  const trimmedKey = apiKey.trim();
  const routeNames = (routes: typeof configuredRoutes) => routes.map((r) => ROUTE_LABELS[r.kind]).join("、");
  // 更换 Key 时被替换的 Key（与本次 Key 相同则不算替换）
  const replacedKey = keyMode === "replace" && replaceKey && replaceKey !== trimmedKey ? replaceKey : null;
  const routesToRemove = routingReady
    ? configuredRoutes.filter((r) => r.api_key === trimmedKey && routeCounts[r.kind] === 0)
    : [];
  const rekeyed = routingReady
    ? configuredRoutes.filter((r) => r.api_key !== trimmedKey && routeCounts[r.kind] > 0)
    : [];
  // 被替换 Key 的路由由新 Key 接管属于预期，不作警告；其它 Key 的路由被改用此 Key 才提醒
  const routesTakenOver = rekeyed.filter((r) => r.api_key === replacedKey);
  const routesToRekey = rekeyed.filter((r) => r.api_key !== replacedKey);
  const kept = configuredRoutes.filter(
    (r) => r.api_key !== trimmedKey && (!routingReady || routeCounts[r.kind] === 0),
  );
  const routesKeptOld = kept.filter((r) => r.api_key === replacedKey);
  const routesKept = kept.filter((r) => r.api_key !== replacedKey);

  const validate = (upTo: number): { step: number; message: string } | null => {
    if (upTo >= 1 && !profile) {
      return { step: 0, message: "未找到 DeepSeek Harness 桌面版配置，请先启动一次 DeepSeek Harness" };
    }
    if (upTo >= 2 && !apiKey.trim()) {
      return { step: 1, message: "请先在第 2 步输入 API Key" };
    }
    if (upTo >= 3 && models.length === 0) {
      return { step: 2, message: "请至少勾选一个模型" };
    }
    return null;
  };

  const goToStep = (step: number) => {
    const problem = validate(step);
    const target = problem ? problem.step : step;
    if (problem) toast.warning(problem.message);
    setDirection(target > currentStep ? 1 : -1);
    setCurrentStep(target);
    setMaxStepReached((prev) => Math.max(prev, target));
    setShowSummary(false);
    if (target !== TOTAL_STEPS - 1) setConfigConfirmed(false);
  };

  const handleSave = () => {
    const problem = validate(TOTAL_STEPS - 1);
    if (problem) {
      toast.warning(problem.message);
      goToStep(problem.step);
      return;
    }
    if (currentStep !== TOTAL_STEPS - 1 || !configConfirmed) {
      toast.warning("请先勾选确认配置无误");
      if (currentStep !== TOTAL_STEPS - 1) goToStep(TOTAL_STEPS - 1);
      return;
    }
    setTestModalOpen(true);
  };

  const urlSummary = url
    ? url.replace(/https?:\/\//, "").replace(/\/$/, "").split("/")[0]
    : undefined;
  const keySummary = maskKey(apiKey);

  const STEPS: StepDef[] = [
    { label: "接入节点", summary: urlSummary },
    { label: "API Key", summary: keySummary },
    { label: "选择模型", summary: models.length ? `${models.length} 个模型` : undefined },
    { label: "确认配置", summary: configConfirmed ? "已确认" : undefined },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[300px] gap-3">
        <Loader2 className="animate-spin text-black dark:text-white" size={36} />
        <span className="text-xs text-slate-500 dark:text-gray-400 animate-pulse">
          正在读取 DeepSeek Harness 本地配置...
        </span>
      </div>
    );
  }

  const cardClass =
    "p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm";
  const tileClass =
    "p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 min-w-0";
  const externalRoutes = config?.external_routes ?? [];

  const official = config?.official;
  const officialNotice = official &&
    (official.account_signed_in || official.default_is_official || official.api_key_route_redirected_to) && (
    <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
      {(official.account_signed_in || official.default_is_official) && (
        <div className="flex items-start gap-2">
          <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-emerald-500" />
          <span>
            {official.account_signed_in ? "已检测到 DeepSeek 官方账号登录。" : ""}
            官方路由 <code className="font-mono text-black dark:text-white">deepseek-account</code> /{" "}
            <code className="font-mono text-black dark:text-white">deepseek-official</code> 与 AI Helper 的{" "}
            <code className="font-mono">aihelper-*</code> 路由并存，账号登录、官方 API Key 均不会被改动
            {official.default_is_official ? "；您选择的官方默认模型也会保留" : ""}。
          </span>
        </div>
      )}
      {official.api_key_route_redirected_to && (
        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            官方 API Key 路由 <code className="font-mono">llm-deepseek</code> 的地址被改成了{" "}
            <code className="font-mono">{official.api_key_route_redirected_to}</code>
            ，使用 DeepSeek 官方 API Key 时请求不会发往官方。如需直连官方可将该地址改回
            https://api.deepseek.com（AI Helper 不会修改此条目）。
          </span>
        </div>
      )}
    </div>
  );

  const externalNotice = externalRoutes.length > 0 && (
    <div className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400">
      <Route size={13} className="mt-0.5 flex-shrink-0" />
      <span className="leading-relaxed">
        检测到您自建的路由{" "}
        {externalRoutes.map((r, index) => (
          <span key={r.name}>
            {index > 0 ? "、" : ""}
            <code className="font-mono text-black dark:text-white">{r.name}</code>
            {r.api ? <span className="opacity-70"> ({r.api})</span> : null}
          </span>
        ))}
        ，AI Helper 只管理 <code className="font-mono">aihelper-*</code> 路由，不会改动它们。
      </span>
    </div>
  );

  const detailsContent = (
    <>
      <div className="flex flex-col gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
        <div className="flex flex-wrap items-center gap-2">
          <span>配置档案</span>
          <ConfigPathBar
            path={config?.patch_path || undefined}
            shortPath="~/.dsh/profiles/desktop/cordis.patch.yml"
            exists={Boolean(config?.patch_path)}
          />
        </div>
        <span>
          AI Helper 写入的配置条目为 <code className="font-mono text-black dark:text-white">llm-pi-ai</code>，API Key 以{" "}
          <code className="font-mono">AIHELPER_*</code> 引用保存在{" "}
          <code className="font-mono break-all">{config?.credentials_path || "~/.dsh/.credentials.yaml"}</code>。
        </span>
        <span>
          路由对应：
          {ROUTE_ORDER.map((kind, index) => (
            <span key={kind}>
              {index > 0 ? "；" : ""}
              {ROUTE_LABELS[kind]} → <code className="font-mono text-black dark:text-white">{ROUTE_IDS[kind]}</code>
            </span>
          ))}
        </span>
      </div>
      {officialNotice}
      {externalNotice}
    </>
  );
  const detailsAttention = Boolean(official?.api_key_route_redirected_to);

  const configuredModelCount = new Set(configuredRoutes.flatMap((r) => r.models)).size;

  return (
    <div className="w-full min-h-full flex flex-col justify-between gap-5 pb-2">
      {/* ── 顶部面板标题栏 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-100 text-black border border-neutral-200 dark:bg-white/10 dark:text-white dark:border-white/20 flex items-center justify-center flex-shrink-0 shadow-xs">
            <DeepSeekHarnessIcon size={22} />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white">
              DeepSeek Harness 接入配置
            </h1>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              为 DeepSeek Harness 桌面版配置接入节点、API Key 与可用模型，不影响官方账号与您自建的路由
            </p>
          </div>
        </div>

        <div className="self-start md:self-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 shadow-2xs cursor-pointer"
            title="重新载入本地配置"
          >
            <RefreshCw size={12} />
            <span>重新载入</span>
          </button>
        </div>
      </div>

      {!showSummary && (
        <div className="flex-shrink-0 px-1 py-2 border-b border-slate-100 dark:border-white/5">
          <StepIndicator
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={goToStep}
            maxStepReached={maxStepReached}
          />
        </div>
      )}

      <div className="w-full flex-1 flex flex-col gap-4">
        {showSummary ? (
          <div className="w-full flex flex-col gap-4">
            <SpotlightCard className={cardClass} spotlightColor="rgba(255, 255, 255, 0.08)">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-500" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    当前配置概览
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-800 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-900 px-2.5 py-0.5 rounded-full border border-neutral-200 dark:border-neutral-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  桌面版 ({profile || "未初始化"})
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className={tileClass}>
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
                    <Server size={13} className="text-black dark:text-white" />
                    <span>服务网关节点</span>
                  </div>
                  <div className="text-xs font-mono font-medium text-slate-800 dark:text-gray-200 truncate" title={url}>
                    {urlSummary || url}
                  </div>
                </div>

                <div className={tileClass}>
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
                    <Cpu size={13} className="text-black dark:text-white" />
                    <span>新会话默认模型</span>
                  </div>
                  <div
                    className="text-xs font-mono font-medium text-black dark:text-white truncate"
                    title={currentDefaultLabel}
                  >
                    {defaultModel?.model || "DeepSeek Harness 内置默认"}
                  </div>
                  {defaultModel && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400 min-w-0">
                      {defaultKind === "managed" && defaultRoute ? (
                        <>
                          <span>所在路由</span>
                          <span className="text-black dark:text-white">{ROUTE_LABELS[defaultRoute.route.kind]}</span>
                          {defaultRoute.group && (
                            <span className="px-1 rounded border border-neutral-200/80 dark:border-white/20 bg-neutral-100 dark:bg-white/10 text-black dark:text-white">
                              {defaultRoute.group}
                            </span>
                          )}
                        </>
                      ) : defaultKind === "official" ? (
                        <span>DeepSeek 官方路由</span>
                      ) : defaultKind === "external" ? (
                        <span>
                          自建路由 <code className="font-mono">{defaultModel.provider}</code>
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className={tileClass}>
                  <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-[11px] mb-1">
                    <Route size={13} className="text-black dark:text-white" />
                    <span>已接入</span>
                  </div>
                  <div className="text-xs font-medium text-slate-800 dark:text-gray-200">
                    {configuredRoutes.length} 条路由 · {configuredModelCount} 个模型
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-gray-400">
                    {new Set(configuredRoutes.map((r) => r.api_key)).size} 个 API Key，各路由独立使用自己分组的 Key
                  </div>
                </div>
              </div>

              {defaultBroken && defaultModel && (
                <div className="mt-3 flex items-start justify-between gap-3 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/80 dark:bg-amber-500/10 dark:border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300">
                  <span className="flex items-start gap-2 leading-relaxed">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>
                      {defaultKind === "missing" ? (
                        <>
                          默认模型 <code className="font-mono">{defaultModel.model}</code>{" "}
                          所在的路由已不在当前配置中，新会话可能无法使用该模型。
                        </>
                      ) : (
                        <>
                          默认模型 <code className="font-mono">{defaultModel.model}</code> 已不在
                          {defaultRoute ? `${ROUTE_LABELS[defaultRoute.route.kind]}路由` : ""}的 Key 当前分组中，新会话会请求失败。
                        </>
                      )}
                      {defaultFixRoute
                        ? ` 可改用${ROUTE_LABELS[defaultFixRoute.route.kind]}路由上的同名模型。`
                        : " 请重新选择默认模型。"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      defaultFixRoute
                        ? editKey(defaultFixRoute.route.api_key, defaultFixRoute.nodeUrl, defaultModel.model)
                        : defaultRoute
                          ? editKey(defaultRoute.route.api_key, defaultRoute.nodeUrl)
                          : goToStep(2)
                    }
                    className="flex-shrink-0 px-2 py-1 rounded-lg border border-amber-300/80 dark:border-amber-500/30 bg-white/70 dark:bg-white/5 hover:bg-white text-[11px] font-medium cursor-pointer"
                  >
                    {defaultFixRoute ? "改用此路由" : "重新选择"}
                  </button>
                </div>
              )}

              {routeHealth.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {routeHealth.map(({ route: r, nodeUrl, group, checked, missing }) => {
                    const isDefault = defaultKind === "managed" && defaultModel?.provider === r.route;
                    return (
                      <div
                        key={r.route}
                        className={cn(
                          "flex flex-col gap-1.5 px-3 py-2 rounded-lg border text-[11px]",
                          missing.length > 0
                            ? "bg-amber-50/60 border-amber-200/80 dark:bg-amber-500/5 dark:border-amber-500/20"
                            : "bg-slate-50/80 dark:bg-white/[0.02] border-slate-200/60 dark:border-white/5",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <Route size={12} className="flex-shrink-0" />
                            <span className="font-medium text-black dark:text-white">{ROUTE_LABELS[r.kind]}</span>
                            <span className="text-slate-400 dark:text-gray-500">
                              {r.models.length} 个模型
                            </span>
                            {group && (
                              <span
                                className="px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-none bg-neutral-100 text-black border-neutral-200/80 dark:bg-white/10 dark:text-white dark:border-white/20"
                                title={`该路由的 Key 所属分组：${group}`}
                              >
                                {group}
                              </span>
                            )}
                            {isDefault && (
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium leading-none bg-black text-white dark:bg-white dark:text-black">
                                默认
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span className="font-mono text-slate-500 dark:text-gray-400">
                              {maskKey(r.api_key) || "未找到密钥"}
                            </span>
                            {r.api_key && (
                              <button
                                type="button"
                                onClick={() => editKey(r.api_key, nodeUrl)}
                                className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-600 dark:text-gray-300 cursor-pointer"
                                title="用这条路由的 Key 进入配置向导；使用其它 Key 的路由不受影响"
                              >
                                编辑
                              </button>
                            )}
                          </span>
                        </div>
                        {missing.length > 0 ? (
                          <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300 leading-relaxed">
                            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                            <span>
                              {missing.length} 个模型已不在该 Key 当前分组中（分组可能已在 bob-api 网页切换），使用时会报
                              model_not_found：<code className="font-mono">{missing.join("、")}</code>。点击「编辑」将自动取消勾选这些模型。
                            </span>
                          </div>
                        ) : !checked && r.api_key ? (
                          <span className="text-slate-400 dark:text-gray-500">正在核对该 Key 当前分组的可用模型...</span>
                        ) : null}
                      </div>
                    );
                  })}
                  {staleRouteCount === 0 && routeHealth.every((h) => h.checked) && (
                    <button
                      type="button"
                      onClick={() => setStatusRefresh((n) => n + 1)}
                      className="self-end flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer"
                      title="在 bob-api 网页切换分组后，可重新核对各路由的模型是否仍可用"
                    >
                      <RefreshCw size={10} />
                      重新核对分组与可用模型
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-white/5 flex flex-col gap-2">
                {config?.is_running && (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/80 dark:bg-amber-500/10 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={13} />
                    <span>DeepSeek Harness 正在运行，修改配置后需重启才能加载新模型。</span>
                  </div>
                )}
                <DetailsFold attention={detailsAttention}>{detailsContent}</DetailsFold>
              </div>
            </SpotlightCard>

            <ChannelGroupMonitor
              toolName="DeepSeek Harness"
              toolId={DSH_BINDING_TOOL_ID}
              hasConfiguredKey={Boolean(apiKey.trim())}
              configuredKey={apiKey}
              currentGroupName={apiKeyGroup}
            />
          </div>
        ) : (
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
                <SpotlightCard className={cardClass} spotlightColor="rgba(255, 255, 255, 0.08)">
                  <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Monitor size={14} className="flex-shrink-0 text-slate-700 dark:text-gray-200" />
                      <span className="text-xs font-semibold text-slate-800 dark:text-gray-200">
                        DeepSeek Harness 桌面版
                      </span>
                      <span
                        className="text-[11px] font-mono text-slate-500 dark:text-gray-400 truncate"
                        title={config?.app_path || undefined}
                      >
                        {config?.app_path || "未检测到安装路径"}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "flex-shrink-0 px-2 py-0.5 rounded-md border text-[10px] leading-4",
                        profile
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
                          : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
                      )}
                    >
                      {profile ? "已就绪" : "未初始化"}
                    </span>
                  </div>
                  {!profile && (
                    <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 dark:bg-amber-500/10 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>
                        未在 {config?.dsh_home || "~/.dsh"} 下找到桌面版配置。请先启动一次 DeepSeek Harness 完成初始化。
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-xs font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                      <Server size={14} className="text-black dark:text-white" />
                      API 服务网关节点
                    </Label>
                    <span className="text-[11px] text-slate-400 dark:text-gray-500">
                      第 1 步 / 共 {TOTAL_STEPS} 步
                    </span>
                  </div>
                  <NodeCardSelector value={url} onChange={setUrl} />
                </SpotlightCard>
              )}

              {currentStep === 1 && (
                <SpotlightCard className={cardClass} spotlightColor="rgba(255, 255, 255, 0.08)">
                  <ApiKeyInput
                    title="API Key"
                    value={apiKey}
                    destinationUrl={url}
                    onChange={setApiKey}
                    placeholder="sk-... (填入 BobAPI 密钥)"
                    hintText={
                      keyMode === "add"
                        ? "填入其它分组的 Key，与已接入的 Key 并存：默认只勾选尚未接入的模型类型，已配好的分组不会被覆盖"
                        : anyConfigured
                          ? "更换 Key 后，新 Key 将接管当前 Key 的模型；如需与其它分组的 Key 并存，请在概览中点击「添加其它分组的 Key」"
                          : "填入 BobAPI 密钥，下一步将自动拉取该 Key 可用的模型"
                    }
                    toolName="DeepSeek Harness"
                    toolId={DSH_BINDING_TOOL_ID}
                    onBoundTokenChange={onBoundTokenChange}
                  />
                </SpotlightCard>
              )}

              {currentStep === 2 && (
                <>
                  <SpotlightCard className={cardClass} spotlightColor="rgba(255, 255, 255, 0.08)">
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-xs font-semibold leading-4 text-slate-800 dark:text-gray-200 flex items-center gap-2">
                        <Layers size={14} className="flex-shrink-0" />
                        可用模型 (已选 {models.length})
                        {apiKeyGroup && (
                          <span className="px-1.5 py-0.5 rounded-md border text-[10px] font-medium bg-neutral-100 text-black border-neutral-200/80 dark:bg-white/10 dark:text-white dark:border-white/20">
                            {apiKeyGroup}
                          </span>
                        )}
                      </Label>
                      <button
                        type="button"
                        onClick={() => void handleFetchModels()}
                        disabled={fetching}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300 cursor-pointer disabled:opacity-50"
                      >
                        {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        <span>拉取可用模型</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-[220px] overflow-y-auto">
                      {available.length === 0 && (
                        <span className="text-[11px] text-slate-400 dark:text-gray-500">
                          {fetching ? "正在拉取该 Key 可用的模型..." : "点击「拉取可用模型」，或在下方手动添加模型 ID"}
                        </span>
                      )}
                      {available.map((model) => {
                        const selected = models.includes(model);
                        const stale = unavailable.includes(model);
                        return (
                          <button
                            key={model}
                            type="button"
                            onClick={() => toggleModel(model)}
                            title={stale ? "该模型已不在此 Key 当前分组中，保存后使用会报 model_not_found" : undefined}
                            className={cn(
                              "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono border transition-all cursor-pointer",
                              stale
                                ? selected
                                  ? "bg-amber-50 dark:bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-300 font-semibold"
                                  : "bg-white dark:bg-white/5 border-dashed border-amber-300 dark:border-amber-500/40 text-amber-600/80 dark:text-amber-300/70"
                                : selected
                                  ? "bg-neutral-100 dark:bg-white/15 border-black dark:border-white text-black dark:text-white font-semibold"
                                  : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400",
                            )}
                          >
                            {stale ? <AlertTriangle size={11} /> : selected ? <CheckCircle2 size={11} /> : <Plus size={11} />}
                            <span className={stale && !selected ? "line-through" : undefined}>{model}</span>
                            {stale && <span className="text-[10px] font-sans">分组不可用</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addCustomModel();
                        }}
                        placeholder="手动添加模型 ID"
                        className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-xs font-mono border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-gray-200 outline-none focus:border-black dark:focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={addCustomModel}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 cursor-pointer"
                      >
                        添加
                      </button>
                      {available.some((m) => !models.includes(m) && !unavailable.includes(m)) && (
                        <button
                          type="button"
                          onClick={() =>
                            setModels(Array.from(new Set([...models, ...available.filter((m) => !unavailable.includes(m))])))
                          }
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-white cursor-pointer"
                        >
                          <CheckCircle2 size={11} />
                          全选
                        </button>
                      )}
                      {models.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setModels([])}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-white cursor-pointer"
                        >
                          <X size={11} />
                          清空
                        </button>
                      )}
                    </div>
                    <p className="mt-3 text-[11px] text-slate-500 dark:text-gray-400">
                      列表为该 Key 当前分组在中转站可用的对话模型；保存时按模型协议自动写入对应路由
                      {routingSummary ? `（${routingSummary}）` : ""}。不同分组的 Key 可分别保存，
                      已用其它 Key 接入的路由不会被覆盖。
                    </p>
                    {unavailable.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                        标记「分组不可用」的模型是此前配置过、但已不在该 Key 当前分组中的模型（分组可能已在 bob-api
                        网页切换），已自动取消勾选。
                      </p>
                    )}
                  </SpotlightCard>

                  <SpotlightCard className={cardClass} spotlightColor="rgba(255, 255, 255, 0.08)">
                    <Label className="text-xs font-semibold leading-4 text-slate-800 dark:text-gray-200 flex items-center gap-2 mb-3">
                      <Star size={14} className="flex-shrink-0" />
                      新会话默认模型
                    </Label>
                    <select
                      value={effectiveDefault}
                      onChange={(e) => {
                        setDefaultChoice(e.target.value);
                        setAutoDefault(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-xs font-mono border border-slate-200 dark:border-white/10 bg-white dark:bg-black text-slate-800 dark:text-gray-200 cursor-pointer"
                    >
                      <option value={KEEP_DEFAULT}>
                        保持当前默认（{currentDefaultLabel}）{defaultBroken ? " · 已失效" : ""}
                      </option>
                      {models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-gray-400">
                      只影响新会话的默认选择，在 DeepSeek Harness 中仍可随时切换其它模型。
                    </p>
                  </SpotlightCard>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <ConfigConfirmStep
                    spotlightColor="rgba(255, 255, 255, 0.08)"
                    totalSteps={TOTAL_STEPS}
                    confirmed={configConfirmed}
                    onConfirmedChange={setConfigConfirmed}
                    onEditStep={goToStep}
                    items={[
                      {
                        label: "接入节点",
                        value: urlSummary || url,
                        detail: url,
                        icon: <Server size={14} />,
                        stepIndex: 0,
                      },
                      {
                        label: "API Key",
                        value: keySummary || "未配置",
                        badge: apiKeyGroup || undefined,
                        icon: <KeyRound size={14} />,
                        stepIndex: 1,
                      },
                      {
                        label: "选择模型",
                        value: `${models.length} 个模型`,
                        detail: routingSummary || undefined,
                        icon: <Layers size={14} />,
                        stepIndex: 2,
                      },
                      {
                        label: "默认模型",
                        value: payload.default_model || `保持 ${currentDefaultLabel}`,
                        icon: <Cpu size={14} />,
                        stepIndex: 2,
                      },
                    ]}
                  />
                  {(routesTakenOver.length > 0 || routesKeptOld.length > 0 || routesKept.length > 0) && (
                    <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/80 dark:bg-white/[0.03] dark:border-white/5 text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                      {routesTakenOver.length > 0 && (
                        <div className="flex items-start gap-2">
                          <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                          <span>
                            更换 Key：<span className="text-black dark:text-white">{routeNames(routesTakenOver)}</span>{" "}
                            将改用新 Key，并替换为本次勾选的模型。
                          </span>
                        </div>
                      )}
                      {routesKeptOld.length > 0 && (
                        <div className="flex items-start gap-2">
                          <Info size={13} className="mt-0.5 flex-shrink-0" />
                          <span>
                            新 Key 本次没有勾选{" "}
                            <span className="text-black dark:text-white">{routeNames(routesKeptOld)}</span>，这部分继续使用原 Key。
                          </span>
                        </div>
                      )}
                      {routesKept.length > 0 && (
                        <div className="flex items-start gap-2">
                          <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                          <span>
                            使用其它 API Key 接入的{" "}
                            <span className="text-black dark:text-white">{routeNames(routesKept)}</span>{" "}
                            保持不变，可与本次配置并存。
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {(routesToRemove.length > 0 || routesToRekey.length > 0 || selectedUnavailable.length > 0) && (
                    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 dark:bg-amber-500/10 dark:border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                      {selectedUnavailable.length > 0 && (
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                          <span>
                            以下模型不在此 Key 当前分组中，保存前的连通性测试会因此不通过：{" "}
                            <code className="font-mono">{selectedUnavailable.join("、")}</code>
                            。请回到「选择模型」取消勾选，或先在 bob-api 网页把 Key 切回包含它们的分组。
                          </span>
                        </div>
                      )}
                      {routesToRekey.length > 0 && (
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                          <span>
                            <span className="font-medium">{routeNames(routesToRekey)}</span>{" "}
                            原先使用其它 API Key，保存后将改用此 Key 并替换为本次勾选的模型。
                          </span>
                        </div>
                      )}
                      {routesToRemove.length > 0 && (
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                          <span>
                            本次没有勾选 <span className="font-medium">{routeNames(routesToRemove)}</span>
                            ，保存后将从 DeepSeek Harness 中移除这部分模型及其密钥引用。
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <DetailsFold attention={detailsAttention}>{detailsContent}</DetailsFold>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── 底部操作栏 ── */}
      <div className="sticky bottom-0 z-20 mt-auto py-2.5 px-4 rounded-2xl bg-white/70 dark:bg-black/80 backdrop-blur-xl backdrop-saturate-150 border border-white/60 dark:border-white/10 shadow-[0_4px_24px_-2px_rgba(0,0,0,0.06),inset_0_1px_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_4px_24px_-2px_rgba(0,0,0,0.3),inset_0_1px_1px_0_rgba(255,255,255,0.08)] flex-shrink-0">
        {showSummary ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToStep(0)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs cursor-pointer"
                title="修改节点、更换 Key 或调整模型"
              >
                <RefreshCw size={13} />
                <span>重新配置向导</span>
              </button>
              <button
                type="button"
                onClick={startAddKey}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs cursor-pointer"
                title="再接入一个其它分组的 Key（如 Claude 分组），与当前 Key 并存"
              >
                <Plus size={13} />
                <span>添加其它分组的 Key</span>
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>DeepSeek Harness 配置已写入</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  type="button"
                  onClick={() => goToStep(currentStep - 1)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-white/80 dark:border-white/10 bg-white/60 hover:bg-white/90 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 transition-all shadow-2xs cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>上一步</span>
                </button>
              )}
              <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium px-2">
                步骤 {currentStep + 1} / {TOTAL_STEPS}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {anyConfigured && (
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                  title="放弃未保存的修改并返回概览"
                >
                  返回概览
                </button>
              )}
              {currentStep < TOTAL_STEPS - 1 ? (
                <button
                  type="button"
                  onClick={() => goToStep(currentStep + 1)}
                  className="flex items-center gap-1.5 px-6 py-2 rounded-xl text-xs font-medium bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-colors shadow-xs cursor-pointer"
                >
                  <span>下一步</span>
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={testModalOpen || !configConfirmed}
                  className="flex items-center justify-center gap-1.5 px-6 py-2 min-w-[190px] rounded-xl text-xs font-semibold bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={14} />
                  <span>测试并保存到 DeepSeek Harness</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <TerminalTestModal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        type="dsh"
        url={url}
        apiKey={apiKey.trim()}
        model={payload.default_model || orderedModels[0] || ""}
        dshPayload={payload}
        onSuccess={() => {
          setConfigConfirmed(false);
          void load(true);
        }}
      />
    </div>
  );
}

export default DshPanel;

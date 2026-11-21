import {
  classifyDshModels,
  fetchDshModels,
  getDshConfig,
  testClaudeStream,
  testCodexStream,
  testWorkbuddyStream,
} from "./api";
import type {
  ApiTestResult,
  DshRouteKind,
  DshSavePayload,
  DshUIConfig,
  TestStreamEvent,
} from "../types";

/** 大厅一键配置 / 批量配置为 DeepSeek Harness 自动挑选令牌时的推荐分组与首选默认模型 */
export const DSH_QUICK_GROUP = "国产Token计划";
export const DSH_QUICK_URL = "https://bob-api.com/";
export const DSH_QUICK_MODEL = "deepseek-v4.1-flash";

/** DeepSeek Harness 只绑定一个令牌；沿用历史 ID，已有的绑定记录不会丢失 */
export const DSH_BINDING_TOOL_ID = "dsh-cn";

export function dshBindingToolId(target: string): string {
  return target === "dsh" ? DSH_BINDING_TOOL_ID : target;
}

/** 后端存的是协议化地址（Claude 带尾斜杠，OpenAI 带 /v1），统一还原为节点根地址 */
export function dshNodeUrl(baseUrl: string | null | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return trimmed ? `${trimmed}/` : DSH_QUICK_URL;
}

/**
 * 已接入的 aihelper-* 路由中当前使用的 Key / 节点 / 模型（国产路由优先）。
 * 不同分组的 Key 可并存（如 Claude 分组 Key + GPT 分组 Key），这里只汇总与主 Key 相同的路由的模型，
 * 其它 Key 的路由保存时保持不变。
 */
export function dshCurrentSelection(config: DshUIConfig | null | undefined): {
  apiKey: string;
  url: string;
  models: string[];
} | null {
  const configured = (config?.routes ?? []).filter((r) => r.configured);
  if (configured.length === 0) return null;
  const primary = configured.find((r) => r.kind === "domestic") ?? configured[0];
  return {
    apiKey: primary.api_key,
    url: dshNodeUrl(primary.base_url),
    models: Array.from(
      new Set(configured.filter((r) => r.api_key === primary.api_key).flatMap((r) => r.models)),
    ),
  };
}

export interface DshQuickPayload {
  payload: DshSavePayload;
  url: string;
  /** 本次写入的默认模型；保留官方默认模型时为 null */
  defaultModel: string | null;
  /** 本次保留不改的默认模型：DeepSeek 官方路由，或另一个 Key 已接入的 aihelper-* 路由（如 Claude 分组） */
  keptDefault: string | null;
  /** 本次从中转站拉取到的可对话模型数；拉取失败时为 null */
  fetchedCount: number | null;
  /** 拉取失败的原因（此时沿用已有模型列表） */
  fetchError: string | null;
}

/**
 * 一键配置：用该 Key 拉取中转站上它可用的全部对话模型并全部写入，
 * 后端按模型协议自动拆分到 aihelper-* 路由；其它 Key 已接入的 aihelper-* 路由与用户自建路由保持原样。
 * 拉取失败时沿用已有模型列表并在日志中提示。
 *
 * 与 DeepSeek 官方并存：官方账号 / 官方 API Key 路由及其凭据从不改动；
 * 用户明确选过的官方默认模型也保留，否则默认模型优先 deepseek-v4.1-flash。
 */
export async function buildDshQuickPayload(
  apiKey: string,
  model: string = DSH_QUICK_MODEL,
): Promise<DshQuickPayload> {
  const key = apiKey.trim();
  const config = await getDshConfig().catch(() => null);
  const current = dshCurrentSelection(config);
  const url = current?.url ?? DSH_QUICK_URL;

  let fetched: string[] | null = null;
  let fetchError: string | null = null;
  try {
    fetched = await fetchDshModels(url, key);
  } catch (e) {
    fetchError = String(e);
  }
  if (fetched && fetched.length === 0) {
    fetchError = "中转站未返回该 Key 可用的对话模型";
    fetched = null;
  }

  // 拉取成功时只写中转站确认可用的模型；失败时沿用已有列表并保证首选模型在内
  const preferred = model.trim();
  const sameKeyModels = (config?.routes ?? [])
    .filter((r) => r.configured && r.api_key === key)
    .flatMap((r) => r.models);
  const base = fetched ?? [preferred, ...sameKeyModels];
  const models = Array.from(new Set(base.map((m) => m.trim()).filter(Boolean)));
  const chosen = models.includes(preferred) ? preferred : models[0] ?? preferred;
  // 默认模型排在首位，DeepSeek Harness 的模型列表按此顺序展示
  const ordered = [chosen, ...models.filter((m) => m !== chosen)];

  const officialDefault = config?.official?.default_is_official ? config.default_model : null;
  // 默认模型在另一个 Key 的 aihelper-* 路由上（如已配好的 Claude 分组），新增其它分组时不改动它
  const otherKeyDefault =
    config?.default_model &&
    (config.routes ?? []).some(
      (r) =>
        r.configured &&
        r.route === config.default_model?.provider &&
        r.api_key !== key &&
        r.models.includes(config.default_model.model),
    )
      ? config.default_model
      : null;
  const keptDefault = officialDefault ?? otherKeyDefault;

  return {
    url,
    defaultModel: keptDefault ? null : chosen,
    keptDefault: keptDefault ? `${keptDefault.provider} / ${keptDefault.model}` : null,
    fetchedCount: fetched ? fetched.length : null,
    fetchError,
    payload: {
      profile: config?.selected_profile ?? null,
      api_key: key,
      base_url: url,
      models: ordered,
      default_model: keptDefault ? null : chosen,
    },
  };
}

const DSH_ROUTE_LABELS: Record<DshRouteKind, string> = {
  claude: "aihelper-claude (Anthropic Messages)",
  codex: "aihelper-codex (OpenAI Responses)",
  domestic: "aihelper-cn (OpenAI Chat Completions)",
};

/**
 * 保存前的连通性测试：模型按协议会落到哪几条路由，就各测一个代表模型
 * （优先默认模型，其次 deepseek-v4.1-flash，再次该路由第一个模型），任一失败即返回失败。
 */
export async function runDshConnectivityTests(
  payload: DshSavePayload,
  onEvent: (event: TestStreamEvent) => void,
  log: (text: string, level: "info" | "success" | "error") => void,
  isCurrent: () => boolean = () => true,
): Promise<ApiTestResult> {
  const url = payload.base_url || DSH_QUICK_URL;
  const key = payload.api_key.trim();

  // 中转站按 Key 当前所属分组返回可用模型。分组在 bob-api 网页被切换后，原先的模型可能已无渠道，
  // 写入后 DeepSeek Harness 会报 model_not_found；代表模型测试只覆盖每条路由的一个模型，因此先逐个核对。
  // 拉取失败或返回为空时无法判断，交给后面的连通性测试
  const listed = await fetchDshModels(url, key).catch(() => null);
  if (!isCurrent()) return { success: false, message: "已取消" };
  if (listed && listed.length > 0) {
    const missing = payload.models.filter((m) => !listed.includes(m));
    if (missing.length > 0) {
      log(`✗ 以下模型不在此 API Key 当前分组中：${missing.join("、")}`, "error");
      log(
        "分组可能已在 bob-api 网页切换。请在配置向导「选择模型」中重新拉取并取消勾选这些模型，或把 Key 切回包含它们的分组。",
        "error",
      );
      return { success: false, message: `${missing.length} 个模型不在 Key 当前分组中` };
    }
  }

  const classified = await classifyDshModels(payload.models);
  const kinds = (["domestic", "claude", "codex"] as DshRouteKind[]).filter((kind) =>
    classified.some((c) => c.kind === kind),
  );
  if (kinds.length === 0) return { success: false, message: "没有可测试的模型" };

  let last: ApiTestResult = { success: false, message: "未执行测试" };
  for (const kind of kinds) {
    const models = classified.filter((c) => c.kind === kind).map((c) => c.model);
    const model =
      models.find((m) => m === payload.default_model) ??
      models.find((m) => m === DSH_QUICK_MODEL) ??
      models[0];
    log(`▶ 测试 ${DSH_ROUTE_LABELS[kind]} · 模型 ${model}`, "info");
    const runner =
      kind === "claude" ? testClaudeStream : kind === "codex" ? testCodexStream : testWorkbuddyStream;
    last = await runner(url, key, model, onEvent);
    if (!isCurrent()) return { ...last, success: false };
    if (!last.success) {
      log(`✗ ${DSH_ROUTE_LABELS[kind]} 测试未通过`, "error");
      return { ...last, success: false };
    }
    log(`✓ ${DSH_ROUTE_LABELS[kind]} 测试通过`, "success");
  }
  return last;
}

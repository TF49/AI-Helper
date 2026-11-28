// WorkBuddy 一键配置：默认把这把密钥所在分组能用的全部对话模型都写进去，
// 用户在 WorkBuddy 的模型列表里可以直接挑，不用回来再配。
import { fetchDshModels, setWorkbuddyConfig } from "./api";
import type { WorkbuddySavePayload } from "../types";

/** 一键配置写入每个模型时使用的统一能力参数 */
export function workbuddyQuickPayload(
  url: string,
  apiKey: string,
  model: string,
): WorkbuddySavePayload {
  return {
    url,
    api_key: apiKey.trim(),
    model: model.trim(),
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
}

export interface WorkbuddyQuickModels {
  /** 先做连接检查、并作为默认项写入的模型 */
  defaultModel: string;
  /** 检查通过后一并写入的其余模型 */
  extraModels: string[];
  /** 模型列表没拉到时的原因（此时只配置默认模型） */
  fetchError: string | null;
}

/**
 * 取这把密钥可用的全部对话模型。首选模型在列表里就用它做默认项，
 * 否则用列表里的第一个。列表拉不到时退回只配置首选模型。
 */
export async function resolveWorkbuddyQuickModels(
  url: string,
  apiKey: string,
  preferred: string,
): Promise<WorkbuddyQuickModels> {
  const fallback = preferred.trim();
  let models: string[];
  try {
    models = await fetchDshModels(url, apiKey.trim());
  } catch (error) {
    return { defaultModel: fallback, extraModels: [], fetchError: String(error) };
  }
  const unique = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
  if (unique.length === 0) {
    return { defaultModel: fallback, extraModels: [], fetchError: "没有拿到可用的模型列表" };
  }
  const defaultModel = unique.includes(fallback) ? fallback : unique[0];
  return {
    defaultModel,
    extraModels: unique.filter((model) => model !== defaultModel),
    fetchError: null,
  };
}

/**
 * 默认模型已通过检查并写入后，把其余模型逐个写入。
 * 单个模型写入失败不影响其他模型；`isCurrent` 为假（账号已切换）时立即停止。
 */
export async function saveWorkbuddyExtraModels(
  base: WorkbuddySavePayload,
  models: string[],
  isCurrent: () => boolean = () => true,
): Promise<{ saved: number; failed: string[] }> {
  let saved = 0;
  const failed: string[] = [];
  for (const model of models) {
    if (!isCurrent()) break;
    try {
      await setWorkbuddyConfig({ ...base, model });
      saved += 1;
    } catch (error) {
      console.warn(`WorkBuddy 模型 ${model} 写入失败`, error);
      failed.push(model);
    }
  }
  return { saved, failed };
}

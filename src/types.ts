export interface AgentConfig {
  base_url: string;
  api_key: string;
  model: string;
  config_exists: boolean;
  config_path: string;
  is_installed: boolean;
  app_path?: string | null;
}

export interface NetworkStatus {
  reachable: boolean;
  target_url?: string;
  status_code?: number;
  latency_ms?: number;
  error_message?: string;
}

export interface AppPathsConfig {
  claude_cli_path?: string | null;
  codex_cli_path?: string | null;
  chatgpt_client_path?: string | null;
  workbuddy_client_path?: string | null;
  traework_client_path?: string | null;
}

export interface DetectedPathInfo {
  app_type: "claude" | "codex" | "chatgpt" | "workbuddy" | "traework";
  path: string;
  exists: boolean;
  source: string;
  is_running: boolean;
  extra_info?: string | null;
}

export type InitStepId = "network" | "paths" | "config" | "confirm";
export type StepStatus = "pending" | "running" | "success" | "error";

export interface InitStepInfo {
  id: InitStepId;
  title: string;
  description: string;
  status: StepStatus;
  error?: string;
}

export interface ApiTestResult {
  success: boolean;
  message: string;
  statusCode?: number;
  latencyMs?: number;
  responsePreview?: string;
}

export type TestStreamEvent =
  | {
      type: "log";
      data: {
        text: string;
        level: "info" | "success" | "warn" | "error" | "response" | "dim";
      };
    }
  | {
      type: "chunk";
      data: {
        delta: string;
      };
    }
  | {
      type: "finish";
      data: {
        success: boolean;
        message: string;
        latency_ms: number;
        status_code?: number;
      };
    };

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

export const PRESET_URLS = [
  "https://bob-api.com/",
  "https://taijiai.online/",
] as const;

export type PresetUrl = (typeof PRESET_URLS)[number];

export const CODEX_MODEL_SUGGESTIONS = [
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5-codex",
  "gpt-4.1",
] as const;

export const CLAUDE_MODEL_SUGGESTIONS = [
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
] as const;

export const WORKBUDDY_MODEL_SUGGESTIONS = [
  "gpt-5.6-sol",
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o3-mini",
  "chatgpt-4o-latest",
] as const;

export interface WorkbuddyModelItem {
  id: string;
  name: string;
  vendor: string;
  url: string;
  api?: string;
  apiKey?: string;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  onlyReasoning?: boolean;
  useCustomProtocol?: boolean;
  reasoning?: {
    supportedEfforts?: string[];
    defaultEffort?: string;
    canDisableThinking?: boolean;
  };
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  temperature?: number | null;
  disabled?: boolean;
}

export interface WorkbuddyUIConfig extends AgentConfig {
  supports_tool_call: boolean;
  supports_images: boolean;
  supports_reasoning: boolean;
  only_reasoning: boolean;
  can_disable_thinking: boolean;
  use_custom_protocol: boolean;
  default_effort: string;
  supported_efforts: string[];
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  configured_models: WorkbuddyModelItem[];
}

export interface WorkbuddySavePayload {
  url: string;
  api_key: string;
  model: string;
  supports_tool_call: boolean;
  supports_images: boolean;
  supports_reasoning: boolean;
  only_reasoning: boolean;
  can_disable_thinking: boolean;
  use_custom_protocol: boolean;
  default_effort?: string | null;
  supported_efforts: string[];
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
}

export type TraeApiFormat =
  | "custom_openai_compatible"
  | "custom_responses_compatible"
  | "custom_anthropic_compatible";

export const TRAEWORK_MODEL_SUGGESTIONS = [
  "gpt-5.6-sol",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "deepseek-v3.1",
  "deepseek-r1",
] as const;

export interface TraeWorkModelItem {
  name: string;
  display_name: string;
  provider: string;
  base_url?: string | null;
  is_custom_base_url?: boolean | null;
  custom_model_id?: string | null;
  model_type?: string | null;
  builder?: boolean | null;
  is_preset?: boolean | null;
  client_connect?: boolean | null;
  status?: boolean | null;
  ak?: string | null;
  multimodal?: boolean | null;
  config_source?: number | null;
  selectable?: boolean | null;
  auth_type?: number | null;
  thinking_enable?: number | null;
  max_turn?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  max_tokens?: number | null;
  prompt_max_tokens?: number | null;
}

export interface TraeWorkUIConfig {
  base_url: string;
  api_key: string;
  model: string;
  api_format: string;
  display_name: string;
  config_exists: boolean;
  config_path: string;
  is_installed: boolean;
  app_path?: string | null;
  is_full_url: boolean;

  supports_images: boolean;
  thinking_mode: string;
  max_turn: number;
  token_input?: number | null;
  token_output?: number | null;

  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;

  configured_models: TraeWorkModelItem[];
}

export interface TraeWorkSavePayload {
  api_format: string;
  base_url: string;
  is_full_url: boolean;
  model: string;
  display_name?: string | null;
  api_key: string;

  supports_images: boolean;
  thinking_mode: string;
  max_turn: number;
  token_input?: number | null;
  token_output?: number | null;

  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
}

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
}

export interface DetectedPathInfo {
  app_type: "claude" | "codex" | "chatgpt" | "workbuddy";
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

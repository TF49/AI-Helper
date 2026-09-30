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
  accio_client_path?: string | null;
}

export interface DetectedPathInfo {
  app_type: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork";
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

export const ACCIO_MODEL_SUGGESTIONS = [
  "claude-3-7-sonnet",
  "claude-3-5-sonnet",
  "gpt-4o",
  "gpt-4.1-mini",
  "deepseek-r1",
  "deepseek-v3",
  "qwen-2.5-max",
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

export interface AccioConfig {
  base_url: string;
  api_key: string;
  model: string;
  bridge_port: number;
  official_gateway: string;
  fallback_official: boolean;
  prevent_official_leak: boolean;
  config_exists?: boolean;
  config_path?: string;
  is_installed?: boolean;
  app_path?: string | null;
  bridge_running?: boolean;
  actual_port?: number | null;
}

export interface AccioBridgeStatus {
  is_running: boolean;
  port?: number | null;
}

// ── 用户认证与 API Key 凭据类型定义 (PRD 桌面登录方案 B) ──

export interface SiteStatus {
  password_login_enabled: boolean;
  password_login_encryption_enabled: boolean;
  captcha_enabled: boolean;
  captcha_type?: string | null;
  slide_captcha_check: boolean;
}

export interface EncryptionKeyData {
  enabled: boolean;
  kid: string;
  public_key: string;
}

export interface CaptchaGenerateData {
  captcha_id: string;
  master_image: string;
  tile_image: string;
  master_width: number;
  master_height: number;
  tile_width: number;
  tile_height: number;
  thumb_display_x: number;
  thumb_display_y: number;
}

export interface UserInfo {
  id: number;
  username: string;
  display_name?: string | null;
}

export interface LoginPayload {
  username: string;
  password?: string | null;
  password_encrypted?: string | null;
  encryption_key_id?: string | null;
}

export interface TwoFaRequirement {
  require_2fa: boolean;
  flow_token: string;
  expires_at: number;
}

export interface LoginSuccessData {
  user: UserInfo;
  access_token: string;
  access_expires_at: number;
  session_sid?: string | null;
}

export type LoginResult =
  | {
      type: "success";
      user: UserInfo;
      access_token: string;
      access_expires_at: number;
      session_sid?: string | null;
    }
  | {
      type: "require_2fa";
      require_2fa: boolean;
      flow_token: string;
      expires_at: number;
    };

export interface TokenItem {
  id: number;
  name: string;
  key: string;
  status: number; // 1: 正常可用, 2: 已禁用, 3: 已过期, 4: 额度耗尽
  expired_time: number;
  unlimited_quota: boolean;
  remain_quota: number;
  group?: string | null;
}

export interface CurrentAuthState {
  is_logged_in: boolean;
  user?: UserInfo | null;
  selected_token_id?: number | null;
  selected_token_name?: string | null;
  access_token_expires_at?: number | null;
}



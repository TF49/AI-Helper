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
  cursor_client_path?: string | null;
}

export interface DetectedPathInfo {
  app_type: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork" | "cursor";
  path: string;
  exists: boolean;
  source: string;
  is_running: boolean;
  extra_info?: string | null;
}

export interface AppInstallerInfo {
  app_type: "chatgpt" | "workbuddy" | "acciowork" | "cursor";
  app_name: string;
  version: string;
  download_url: string;
  file_name: string;
  size_bytes?: number | null;
  is_external_store: boolean;
  store_uri?: string | null;
  winget_command?: string | null;
  official_web_url?: string | null;
}

export type AppDownloadEvent =
  | { event: "Started"; data: { totalBytes?: number; fileName: string } }
  | { event: "Progress"; data: { downloaded: number; totalBytes: number; percent: number } }
  | { event: "Finished"; data: { filePath: string; recordId: string } }
  | { event: "Error"; data: { message: string } };

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
  "gpt-6.1-sol",
  "gpt-5.6-sol",
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o3-mini",
  "chatgpt-4o-latest",
] as const;

export const ACCIO_MODEL_SUGGESTIONS = [
  "gpt-6.1-sol",
  "claude-3-7-sonnet",
  "claude-3-5-sonnet",
  "gpt-4o",
  "gpt-4.1-mini",
  "deepseek-r1",
  "deepseek-v3",
  "qwen-2.5-max",
] as const;

export const CURSOR_MODEL_SUGGESTIONS = [
  "claude-3-7-sonnet",
  "claude-3-5-sonnet",
  "deepseek-chat",
  "deepseek-reasoner",
  "gpt-4o",
  "o3-mini",
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
  auto_start_bridge?: boolean;
  cached_models?: string[];
  image_model?: string;
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

export interface CursorConfig {
  base_url: string;
  api_key: string;
  model: string;
  bridge_port: number;
  auto_start_bridge?: boolean;
  custom_models?: string[];
  cursor_path?: string | null;
  config_exists?: boolean;
  config_path?: string;
  is_installed?: boolean;
  app_path?: string | null;
  bridge_running?: boolean;
  actual_port?: number | null;
  is_patched?: boolean;
  patch_detail?: string | null;
  is_process_running?: boolean;
}

export interface CursorBridgeStatus {
  is_running: boolean;
  port?: number | null;
}

export interface CursorPatchInfo {
  is_installed: boolean;
  cursor_app_path?: string | null;
  workbench_js_path?: string | null;
  product_json_path?: string | null;
  is_patched: boolean;
  current_bridge_target?: string | null;
  backup_exists: boolean;
  message: string;
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
  role?: number;
  email?: string | null;
}

export function isUserAdmin(user?: UserInfo | null): boolean {
  return Boolean(user && typeof user.role === "number" && user.role >= 10);
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
  remain_quota: number | null;
  group?: string | null;
  user_id?: number | null;
}

export interface CurrentAuthState {
  is_logged_in: boolean;
  user?: UserInfo | null;
  selected_token_id?: number | null;
  selected_token_name?: string | null;
  access_token_expires_at?: number | null;
  session_restore_error?: string | null;
}

export interface ChannelTrendPoint {
  timestamp: number;
  success_rate: number;
  avg_response_time: number;
  has_data: boolean;
  total_requests: number;
  failed_requests: number;
}

export interface ChannelGroupOverview {
  group_name: string;
  success_rate: number;
  avg_response_time: number;
  has_successful_requests: boolean;
  total_requests: number;
  failed_requests: number;
  trend_points: ChannelTrendPoint[];
}

export interface UserWalletInfo {
  quota: number;              // 剩余额度点数 (500000 = $1)
  used_quota: number;         // 已用额度点数
  quota_usd: number;          // 美元余额 ($)
  quota_cny: number;          // 人民币余额 (按 1￥ = 4$ 计算，即 ￥ = $ / 4)
  used_quota_usd: number;     // 已消耗美元 ($)
  used_quota_cny: number;     // 已消耗人民币 (￥)
  request_count: number;      // 请求次数
  group?: string | null;      // 用户分组 (如 "svip", "default")
  quota_per_unit: number;     // 每单位额度 (500000)
  rmb_to_usd_rate: number;    // 充值比例 (默认 4，即 1￥ = 4$)
}

// ── 意见反馈相关类型定义 ──

export type FeedbackType = "bug" | "feature" | "other";

export interface FeishuFeedbackPayload {
  feedback_type: FeedbackType;
  content: string;
  email: string;
  app_version: string;
  os_info: string;
  active_target: string;
  network_status: string;
  logged_in_user?: string;
  webhook_url?: string;
}

export interface FeedbackSubmitResult {
  success: boolean;
  message: string;
}

// ── 全新一级导航与应用偏好设置类型定义 ──

export type MainNav =
  | "workspace"
  | "logs"
  | "account"
  | "tools"
  | "settings";

export type AgentTool = "chatgpt" | "claude" | "workbuddy" | "acciowork" | "cursor";

export interface AppSettings {
  autoStart: boolean;
  minimizeToTray: boolean;
  startupPage: MainNav;
  showAnnouncementModal: boolean;
  language: string;
  enableAurora: boolean;
}

// ── 使用日志模型 ──

export interface UsageLogItem {
  id: number;
  created_at: number;
  user_id: number;
  username: string;
  token_name: string;
  model_name: string;
  quota: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  is_stream: boolean;
  group: string;
  channel_id?: number | null;
  content?: string | null;
  log_type?: number | null;
}

export interface UsageLogsResponse {
  items: UsageLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface UsageLogQueryParams {
  p?: number;
  page_size?: number;
  token_name?: string;
  model_name?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  log_type?: number;
  username?: string;
  all?: boolean;
}

export interface UsageStatData {
  quota: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  request_count: number;
  avg_use_time: number;
}

// ── 模型与定价模型 ──

export interface PricingModelItem {
  model_name: string;
  vendor_id?: number | null;
  quota_type: number;
  model_ratio: number;
  model_price: number;
  owner_by: string;
  completion_ratio: number;
  cache_ratio?: number | null;
  create_cache_ratio?: number | null;
  enable_groups: string[];
  supported_endpoint_types: string[];
  billing_mode?: string;
  billing_expr?: string;
}

export interface VendorInfo {
  id: number;
  name: string;
  icon: string;
}

export interface PricingResponse {
  success: boolean;
  pricing_version: string;
  svip_group_ratio?: Record<string, number>;
  data: PricingModelItem[];
  group_ratio: Record<string, number>;
  usable_group: Record<string, string>;
  vendors: VendorInfo[];
  auto_groups: string[];
  user_group?: string | null;
  user_available_groups?: string[];
}

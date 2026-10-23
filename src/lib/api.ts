import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  AgentConfig,
  ApiTestResult,
  AppPathsConfig,
  DetectedPathInfo,
  FetchedModel,
  NetworkStatus,
  TestStreamEvent,
  WorkbuddyUIConfig,
  WorkbuddySavePayload,
  WorkbuddyModelItem,
  AccioConfig,
  AccioBridgeStatus,
  CursorConfig,
  CursorBridgeStatus,
  CursorPatchInfo,
  SiteStatus,
  EncryptionKeyData,
  CaptchaGenerateData,
  LoginPayload,
  LoginSuccessData,
  LoginResult,
  TokenItem,
  CurrentAuthState,
  ChannelGroupOverview,
  UserWalletInfo,
  AppInstallerInfo,
  AppDownloadEvent,
  FeishuFeedbackPayload,
  FeedbackSubmitResult,
  UsageLogsResponse,
  UsageLogQueryParams,
  UsageStatData,
  PricingResponse,
} from "../types";

export const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export interface CredentialStatus {
  source: "managed" | "external" | "unknown";
  authorized: boolean;
  can_confirm: boolean;
  origin: string;
  message: string | null;
}

export function getCredentialStatus(apiKey: string, destination: string): Promise<CredentialStatus> {
  return invoke<CredentialStatus>("get_credential_status", { apiKey, destination });
}

export function confirmCredentialDestination(apiKey: string, destination: string): Promise<CredentialStatus> {
  return invoke<CredentialStatus>("confirm_credential_destination", { apiKey, destination });
}

function getMockResponse<T>(cmd: string, _args?: Record<string, unknown>): T {
  switch (cmd) {
    case "get_credential_status":
    case "confirm_credential_destination":
      return { source: "external", authorized: true, can_confirm: false, origin: String(_args?.destination ?? ""), message: null } as unknown as T;
    case "check_bob_api_network":
      return { reachable: true, latency_ms: 45, checked_at: Date.now() } as unknown as T;
    case "get_codex_config":
      return {
        config_exists: true,
        config_path: "~/.codex/config.toml",
        url: "https://bob-api.com",
        api_key: "",
        model: "gpt-5.6-sol",
      } as unknown as T;
    case "get_claude_config":
      return {
        config_exists: true,
        config_path: "~/.claude/settings.json",
        url: "https://bob-api.com",
        api_key: "",
        model: "claude-3-7-sonnet",
      } as unknown as T;
    case "get_workbuddy_config":
      return {
        config_exists: true,
        config_path: "~/.workbuddy/models.json",
        configured_models: [],
      } as unknown as T;
    case "get_accio_config":
      return {
        config_exists: true,
        config_path: "~/.ai-helper/accio_config.json",
        base_url: "https://bob-api.com/",
        api_key: "",
        model: "claude-3-7-sonnet",
        bridge_port: 8787,
        official_gateway: "https://phoenix-gw.alibaba.com",
        fallback_official: false,
        prevent_official_leak: true,
        is_installed: false,
        bridge_running: false,
      } as unknown as T;
    case "get_accio_bridge_status":
      return { is_running: false, port: 8787 } as unknown as T;
    case "start_accio_bridge":
      return 8787 as unknown as T;
    case "stop_accio_bridge":
      return undefined as unknown as T;
    case "get_app_paths":
      return { claude: null, codex: null, chatgpt: null, workbuddy: null, accio: null } as unknown as T;
    case "detect_all_app_paths":
      return [] as unknown as T;
    case "fetch_codex_models":
    case "fetch_claude_models":
      return [
        { id: "gpt-5.6-sol", name: "gpt-5.6-sol" },
        { id: "claude-3-7-sonnet", name: "claude-3-7-sonnet" },
      ] as unknown as T;
    case "get_site_status":
      return {
        password_login_enabled: true,
        password_login_encryption_enabled: false,
        captcha_enabled: true,
        captcha_type: "slide",
        slide_captcha_check: true,
      } as unknown as T;
    case "get_encryption_key":
      return {
        enabled: false,
        kid: "",
        public_key: "",
      } as unknown as T;
    case "generate_captcha":
      return {
        captcha_id: "mock-captcha-id",
        master_image:
          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='220'><rect width='300' height='220' fill='%231e293b'/><circle cx='100' cy='100' r='50' fill='%2338bdf8'/><text x='150' y='120' font-size='18' fill='white' text-anchor='middle'>Mock Captcha</text></svg>",
        tile_image:
          "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='70' height='70'><rect width='70' height='70' fill='%2338bdf8' rx='8'/></svg>",
        master_width: 300,
        master_height: 220,
        tile_width: 70,
        tile_height: 70,
        thumb_display_x: 0,
        thumb_display_y: 65,
      } as unknown as T;
    case "verify_captcha":
      return undefined as unknown as T;
    case "login_account":
      return {
        type: "success",
        user: {
          id: 1,
          username: (_args?.payload as LoginPayload)?.username || "mock_user",
          display_name: "Mock User",
          email: "mock_user@example.com",
        },
        access_token: "mock-token",
        access_expires_at: Math.floor(Date.now() / 1000) + 86400,
        session_sid: "mock-sid",
      } as unknown as T;
    case "refresh_auth_session":
      return {
        user: {
          id: 1,
          username: "mock_user",
          display_name: "Mock User",
          email: "mock_user@example.com",
        },
        access_token: "mock-token",
        access_expires_at: Math.floor(Date.now() / 1000) + 86400,
        session_sid: "mock-sid",
      } as unknown as T;
    case "get_auth_state":
      return {
        is_logged_in: false,
        user: null,
      } as unknown as T;
    case "get_user_tokens":
      return [
        {
          id: 101,
          name: "默认全功能 Key",
          key: "sk-mock***101",
          status: 1,
          expired_time: -1,
          unlimited_quota: true,
          remain_quota: 0,
          group: "default",
        },
        {
          id: 102,
          name: "项目专用 Key",
          key: "sk-mock***102",
          status: 1,
          expired_time: -1,
          unlimited_quota: true,
          remain_quota: 0,
          group: "vip",
        },
      ] as unknown as T;
    case "get_token_key":
      return "sk-mock-plain-key-for-preview" as unknown as T;
    case "update_user_token_group": {
      const tokenId = (_args?.tokenId as number) || 101;
      const newGroup = (_args?.newGroup as string) || "default";
      return {
        id: tokenId,
        name: "Mock Key",
        key: "sk-mock***" + tokenId,
        status: 1,
        expired_time: -1,
        unlimited_quota: true,
        remain_quota: 0,
        group: newGroup,
      } as unknown as T;
    }
    case "get_channel_group_overview":
      return [
        {
          group_name: "SVIP-codex",
          success_rate: 100,
          avg_response_time: 1.25,
          has_successful_requests: true,
          total_requests: 120,
          failed_requests: 0,
          trend_points: Array.from({ length: 12 }, (_, i) => ({
            timestamp: Math.floor(Date.now() / 1000) - (11 - i) * 300,
            success_rate: 100,
            avg_response_time: 1.2,
            has_data: true,
            total_requests: 10,
            failed_requests: 0,
          })),
        },
        {
          group_name: "ClaudeCode Kiro-1",
          success_rate: 98.5,
          avg_response_time: 2.1,
          has_successful_requests: true,
          total_requests: 85,
          failed_requests: 1,
          trend_points: Array.from({ length: 12 }, (_, i) => ({
            timestamp: Math.floor(Date.now() / 1000) - (11 - i) * 300,
            success_rate: 98.5,
            avg_response_time: 2.1,
            has_data: true,
            total_requests: 7,
            failed_requests: 0,
          })),
        },
      ] as unknown as T;
    case "get_user_wallet": {
      const quota = 227002749;
      const used_quota = 302207438;
      const quota_usd = quota / 500000;
      const quota_cny = quota_usd / 4.0;
      const used_quota_usd = used_quota / 500000;
      const used_quota_cny = used_quota_usd / 4.0;
      return {
        quota,
        used_quota,
        quota_usd,
        quota_cny,
        used_quota_usd,
        used_quota_cny,
        request_count: 20540,
        group: "svip",
        quota_per_unit: 500000,
        rmb_to_usd_rate: 4.0,
      } as unknown as T;
    }
    case "open_url":
      if (_args && typeof _args.url === "string") {
        window.open(_args.url, "_blank");
      }
      return true as unknown as T;
    case "fetch_latest_installer_info": {
      const appType = (_args?.appType as string) || "acciowork";
      if (appType === "chatgpt") {
        return {
          app_type: "chatgpt",
          app_name: "ChatGPT",
          version: "Microsoft Store 官方最新版",
          download_url: "https://apps.microsoft.com/detail/9NT1R1C2HH7J",
          file_name: "ChatGPT (Microsoft Store)",
          size_bytes: null,
          is_external_store: true,
          store_uri: "ms-windows-store://pdp/?productid=9NT1R1C2HH7J",
          winget_command:
            "winget install --id=9NT1R1C2HH7J --source=msstore --accept-package-agreements --accept-source-agreements",
          official_web_url: "https://chatgpt.com/download",
        } as unknown as T;
      } else if (appType === "workbuddy") {
        return {
          app_type: "workbuddy",
          app_name: "WorkBuddy",
          version: "v5.7.6",
          download_url:
            "https://download.codebuddy.cn/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.7.6.40409493-306add2a.exe",
          file_name: "WorkBuddy-win32-x64-user-5.7.6.exe",
          size_bytes: 125000000,
          is_external_store: false,
          official_web_url: "https://www.workbuddy.cn",
        } as unknown as T;
      } else {
        return {
          app_type: "acciowork",
          app_name: "Accio Work",
          version: "v0.34.5",
          download_url:
            "https://work-download.accio.com/package/v0.34.5/Accio-0.34.5-20261013-0010-win.exe?dl_name=Accio-0.34.5-20261013-0010-win_ec130b61.exe",
          file_name: "Accio-0.34.5-Setup.exe",
          size_bytes: 156000000,
          is_external_store: false,
          official_web_url: "https://www.accio.com/work",
        } as unknown as T;
      }
    }
    case "run_installer_file":
    case "show_file_in_folder":
    case "open_system_uri":
      return undefined as unknown as T;
    case "get_system_diagnostic_info":
      return (typeof navigator !== "undefined" ? `${navigator.platform} (Web Preview)` : "Windows 10 x64") as unknown as T;
    case "submit_feishu_feedback":
      return {
        success: true,
        message: "【Web 预览模式】模拟已向飞书发送反馈卡片",
      } as unknown as T;
    case "get_auto_start_status":
      return false as unknown as T;
    case "set_auto_start_status":
    case "exit_app":
    case "delete_user_token":
    case "update_user_token_status":
      return undefined as unknown as T;
    case "get_token_auto_groups":
    case "get_user_available_groups":
      return ["default", "svip", "SVIP-codex", "ClaudeCode Kiro-1", "Azure Gpt"] as unknown as T;
    case "get_user_usage_logs":
      return {
        items: [
          {
            id: 1,
            created_at: Math.floor(Date.now() / 1000) - 360,
            user_id: 1,
            username: "current_user",
            token_name: "默认全功能 Key",
            model_name: "gpt-5.6-sol",
            quota: 2500,
            prompt_tokens: 380,
            completion_tokens: 120,
            use_time: 850,
            is_stream: true,
            group: "svip",
            channel_id: 1,
            content: "生成代码架构设计",
            log_type: 1,
          },
          {
            id: 2,
            created_at: Math.floor(Date.now() / 1000) - 1800,
            user_id: 1,
            username: "current_user",
            token_name: "项目专用 Key",
            model_name: "claude-3-7-sonnet",
            quota: 4800,
            prompt_tokens: 650,
            completion_tokens: 240,
            use_time: 1420,
            is_stream: true,
            group: "ClaudeCode Kiro-1",
            channel_id: 2,
            content: "重构前端组件样式",
            log_type: 1,
          },
        ],
        total: 2,
        page: 1,
        page_size: 20,
      } as unknown as T;
    case "get_user_usage_stat":
      return {
        quota: 7300,
        prompt_tokens: 1030,
        completion_tokens: 360,
        request_count: 2,
        avg_use_time: 1135,
      } as unknown as T;
    case "get_pricing_data":
      return {
        success: true,
        pricing_version: "mock-local-v1",
        data: [
          {
            model_name: "gpt-5.6-sol",
            vendor_id: 8,
            quota_type: 0,
            model_ratio: 1.0,
            model_price: 0,
            owner_by: "OpenAI",
            completion_ratio: 3.0,
            cache_ratio: 0.1,
            enable_groups: ["default", "svip", "SVIP-codex"],
            supported_endpoint_types: ["openai"],
          },
          {
            model_name: "claude-3-7-sonnet",
            vendor_id: 4,
            quota_type: 0,
            model_ratio: 1.5,
            model_price: 0,
            owner_by: "Anthropic",
            completion_ratio: 5.0,
            cache_ratio: 0.1,
            enable_groups: ["default", "svip", "ClaudeCode Kiro-1"],
            supported_endpoint_types: ["anthropic", "openai"],
          },
          {
            model_name: "deepseek-v3",
            vendor_id: 1,
            quota_type: 0,
            model_ratio: 0.2,
            model_price: 0,
            owner_by: "DeepSeek",
            completion_ratio: 4.0,
            cache_ratio: 0.05,
            enable_groups: ["default", "svip", "SVIP专属国产福利"],
            supported_endpoint_types: ["openai"],
          },
          {
            model_name: "deepseek-r1",
            vendor_id: 1,
            quota_type: 0,
            model_ratio: 0.4,
            model_price: 0,
            owner_by: "DeepSeek",
            completion_ratio: 4.0,
            cache_ratio: 0.05,
            enable_groups: ["default", "svip", "SVIP专属国产福利"],
            supported_endpoint_types: ["openai"],
          },
          {
            model_name: "gpt-4o",
            vendor_id: 8,
            quota_type: 0,
            model_ratio: 1.25,
            model_price: 0,
            owner_by: "OpenAI",
            completion_ratio: 4.0,
            cache_ratio: 0.5,
            enable_groups: ["default", "Azure Gpt", "svip"],
            supported_endpoint_types: ["openai"],
          },
        ],
        group_ratio: {
          default: 1.0,
          svip: 0.8,
          "SVIP-codex": 0.8,
          "SVIP专属GPT": 0.5,
          "ClaudeCode Kiro-1": 0.8,
          "Azure Gpt": 8.0,
        },
        usable_group: {
          default: "默认基础分组 (1.0倍率)",
          svip: "SVIP 专属活动全功能分组 (0.8倍率)",
          "SVIP-codex": "Codex 专属高可用通道 (0.8倍率)",
          "SVIP专属GPT": "SVIP 限时活动低价号池 (0.5倍率)",
          "ClaudeCode Kiro-1": "Kiro 逆向限时福利分组 (0.8倍率)",
          "Azure Gpt": "微软独立高可用资源 (8.0倍率)",
        },
        vendors: [
          { id: 8, name: "OpenAI", icon: "OpenAI" },
          { id: 4, name: "Anthropic", icon: "Claude.Color" },
          { id: 1, name: "DeepSeek", icon: "DeepSeek.Color" },
          { id: 5, name: "Google", icon: "Gemini.Color" },
        ],
        auto_groups: ["default", "svip", "SVIP-codex", "ClaudeCode Kiro-1", "Azure Gpt"],
        user_group: "svip",
        user_available_groups: ["default", "svip", "SVIP-codex", "ClaudeCode Kiro-1"],
      } as unknown as T;
    default:
      return undefined as unknown as T;
  }
}
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    return getMockResponse<T>(cmd, args);
  }
  return tauriInvoke<T>(cmd, args);
}

export async function getAppPaths(): Promise<AppPathsConfig> {
  return invoke<AppPathsConfig>("get_app_paths");
}

export async function saveAppPaths(config: AppPathsConfig): Promise<void> {
  return invoke("save_app_paths", { config });
}

export async function detectAppPath(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork" | "cursor",
): Promise<DetectedPathInfo> {
  return invoke<DetectedPathInfo>("detect_app_path", { appType });
}

export async function detectAllAppPaths(): Promise<DetectedPathInfo[]> {
  return invoke<DetectedPathInfo[]>("detect_all_app_paths");
}

export async function browseAppPath(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork" | "cursor",
): Promise<string | null> {
  return invoke<string | null>("browse_app_path", { appType });
}

export async function checkAppProcessStatus(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork" | "cursor",
): Promise<boolean> {
  return invoke<boolean>("check_app_process_status", { appType });
}

export async function restartTargetApp(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork" | "cursor",
  customPath?: string,
): Promise<string> {
  return invoke<string>("restart_target_app", { appType, customPath });
}

export async function getCodexConfig(): Promise<AgentConfig> {
  return invoke<AgentConfig>("get_codex_config");
}

export async function setCodexConfig(
  url: string,
  apiKey: string,
  model?: string,
): Promise<void> {
  return invoke("set_codex_config", { url, apiKey, model });
}

export async function getClaudeConfig(): Promise<AgentConfig> {
  return invoke<AgentConfig>("get_claude_config");
}

export async function setClaudeConfig(
  url: string,
  apiKey: string,
  model?: string,
): Promise<void> {
  return invoke("set_claude_config", { url, apiKey, model });
}

export async function getWorkbuddyConfig(): Promise<WorkbuddyUIConfig> {
  return invoke<WorkbuddyUIConfig>("get_workbuddy_config");
}

export async function setWorkbuddyConfig(
  payload: WorkbuddySavePayload,
): Promise<void> {
  return invoke("set_workbuddy_config", { payload });
}

export async function deleteWorkbuddyModel(
  modelId: string,
): Promise<WorkbuddyModelItem[]> {
  return invoke<WorkbuddyModelItem[]>("delete_workbuddy_model", { modelId });
}

export async function checkBobApiNetwork(): Promise<NetworkStatus> {
  return invoke<NetworkStatus>("check_bob_api_network");
}

export async function testCodexConfig(
  url: string,
  apiKey: string,
  model: string,
): Promise<ApiTestResult> {
  return invoke<ApiTestResult>("test_codex_config", {
    url,
    apiKey,
    model,
  });
}

export async function testClaudeConfig(
  url: string,
  apiKey: string,
  model: string,
): Promise<ApiTestResult> {
  return invoke<ApiTestResult>("test_claude_config", {
    url,
    apiKey,
    model,
  });
}

export async function testCodexStream(
  url: string,
  apiKey: string,
  model: string,
  onEvent: (event: TestStreamEvent) => void,
): Promise<ApiTestResult> {
  if (!isTauri) {
    onEvent({ type: "log", data: { text: "[Web Preview] 模拟发起 Codex 连接测试...", level: "info" } });
    onEvent({ type: "finish", data: { success: true, message: "测试连接成功", latency_ms: 60, status_code: 200 } });
    return { success: true, message: "测试连接成功", latencyMs: 60, statusCode: 200 };
  }
  const channel = new Channel<TestStreamEvent>(onEvent);
  return invoke<ApiTestResult>("test_codex_stream", {
    url,
    apiKey,
    model,
    onEvent: channel,
  });
}

export async function testClaudeStream(
  url: string,
  apiKey: string,
  model: string,
  onEvent: (event: TestStreamEvent) => void,
): Promise<ApiTestResult> {
  if (!isTauri) {
    onEvent({ type: "log", data: { text: "[Web Preview] 模拟发起 Claude 连接测试...", level: "info" } });
    onEvent({ type: "finish", data: { success: true, message: "测试连接成功", latency_ms: 60, status_code: 200 } });
    return { success: true, message: "测试连接成功", latencyMs: 60, statusCode: 200 };
  }
  const channel = new Channel<TestStreamEvent>(onEvent);
  return invoke<ApiTestResult>("test_claude_stream", {
    url,
    apiKey,
    model,
    onEvent: channel,
  });
}

export async function testWorkbuddyStream(
  url: string,
  apiKey: string,
  model: string,
  onEvent: (event: TestStreamEvent) => void,
): Promise<ApiTestResult> {
  if (!isTauri) {
    onEvent({ type: "log", data: { text: "[Web Preview] 模拟发起 WorkBuddy 连接测试...", level: "info" } });
    onEvent({ type: "finish", data: { success: true, message: "测试连接成功", latency_ms: 60, status_code: 200 } });
    return { success: true, message: "测试连接成功", latencyMs: 60, statusCode: 200 };
  }
  const channel = new Channel<TestStreamEvent>(onEvent);
  return invoke<ApiTestResult>("test_workbuddy_stream", {
    url,
    apiKey,
    model,
    onEvent: channel,
  });
}

export async function getAccioConfig(): Promise<AccioConfig> {
  return invoke<AccioConfig>("get_accio_config");
}

export async function setAccioConfig(config: AccioConfig): Promise<void> {
  return invoke("set_accio_config", { config });
}

export async function startAccioBridge(port?: number): Promise<number> {
  return invoke<number>("start_accio_bridge", { port });
}

export async function stopAccioBridge(): Promise<void> {
  return invoke<void>("stop_accio_bridge");
}

export async function getAccioBridgeStatus(): Promise<AccioBridgeStatus> {
  return invoke<AccioBridgeStatus>("get_accio_bridge_status");
}

export async function testAccioStream(
  url: string,
  apiKey: string,
  model: string,
  onEvent: (event: TestStreamEvent) => void,
): Promise<ApiTestResult> {
  if (!isTauri) {
    onEvent({ type: "log", data: { text: "[Web Preview] 模拟发起 Accio Work 连接测试...", level: "info" } });
    onEvent({ type: "finish", data: { success: true, message: "测试连接成功", latency_ms: 60, status_code: 200 } });
    return { success: true, message: "测试连接成功", latencyMs: 60, statusCode: 200 };
  }
  const channel = new Channel<TestStreamEvent>(onEvent);
  return invoke<ApiTestResult>("test_accio_stream", {
    url,
    apiKey,
    model,
    onEvent: channel,
  });
}

export async function testCursorStream(
  url: string,
  apiKey: string,
  model: string,
  onEvent: (event: TestStreamEvent) => void,
): Promise<ApiTestResult> {
  if (!isTauri) {
    onEvent({ type: "log", data: { text: "[Web Preview] 模拟发起 Cursor 连接测试...", level: "info" } });
    onEvent({ type: "finish", data: { success: true, message: "测试连接成功", latency_ms: 60, status_code: 200 } });
    return { success: true, message: "测试连接成功", latencyMs: 60, statusCode: 200 };
  }
  const channel = new Channel<TestStreamEvent>(onEvent);
  return invoke<ApiTestResult>("test_cursor_stream", {
    url,
    apiKey,
    model,
    onEvent: channel,
  });
}

export async function getCursorConfig(): Promise<CursorConfig> {
  return invoke<CursorConfig>("get_cursor_config");
}

export async function setCursorConfig(config: CursorConfig): Promise<void> {
  return invoke("set_cursor_config", { config });
}

export async function startCursorBridge(port?: number): Promise<number> {
  return invoke<number>("start_cursor_bridge", { port });
}

export async function stopCursorBridge(): Promise<void> {
  return invoke<void>("stop_cursor_bridge");
}

export async function getCursorBridgeStatus(): Promise<CursorBridgeStatus> {
  return invoke<CursorBridgeStatus>("get_cursor_bridge_status");
}

export async function getCursorPatchStatus(customPath?: string): Promise<CursorPatchInfo> {
  return invoke<CursorPatchInfo>("get_cursor_patch_status", { customPath });
}

export async function patchCursorClient(
  customPath?: string,
  bridgePort?: number,
): Promise<string> {
  return invoke<string>("patch_cursor_client", { customPath, bridgePort });
}

export async function restoreCursorClient(customPath?: string): Promise<string> {
  return invoke<string>("restore_cursor_client", { customPath });
}

export async function fetchCodexModels(
  url: string,
  apiKey: string,
): Promise<FetchedModel[]> {
  return invoke<FetchedModel[]>("fetch_codex_models", { url, apiKey });
}

export async function fetchClaudeModels(
  url: string,
  apiKey: string,
): Promise<FetchedModel[]> {
  return invoke<FetchedModel[]>("fetch_claude_models", { url, apiKey });
}

let lastOpenTime = 0;
let lastOpenUrl = "";

export async function openUrl(url: string): Promise<boolean> {
  const trimmed = url.trim();
  const now = Date.now();
  if (trimmed === lastOpenUrl && now - lastOpenTime < 800) {
    return true;
  }
  lastOpenTime = now;
  lastOpenUrl = trimmed;

  try {
    await invoke("open_url", { url: trimmed });
    return true;
  } catch (err) {
    console.error("Failed to open URL in browser:", err);
    toast.error(`无法打开外部浏览器: ${String(err)}`);
    return false;
  }
}

let lastOpenConfigTime = 0;
let lastOpenConfigPath = "";

export async function openConfigFile(path: string): Promise<boolean> {
  const trimmed = path.trim();
  if (!trimmed) {
    toast.error("配置文件路径为空");
    return false;
  }
  const now = Date.now();
  if (trimmed === lastOpenConfigPath && now - lastOpenConfigTime < 800) {
    return true;
  }
  lastOpenConfigTime = now;
  lastOpenConfigPath = trimmed;

  try {
    await invoke("open_config_file", { path: trimmed });
    return true;
  } catch (err) {
    console.error("Failed to open config file:", err);
    toast.error(`无法打开配置文件: ${String(err)}`);
    return false;
  }
}

export async function executeInTerminal(operationId: string): Promise<string> {
  return invoke<string>("execute_in_terminal", { operationId });
}

export interface CandidateMirror {
  name: string;
  url: string;
}

export type UpdateDownloadEvent =
  | {
      event: "Started";
      data: {
        contentLength?: number;
        source: string;
      };
    }
  | {
      event: "Progress";
      data: {
        chunkLength: number;
        downloaded: number;
        totalBytes: number;
      };
    }
  | {
      event: "SwitchSource";
      data: {
        fromSource: string;
        toSource: string;
        reason: string;
      };
    }
  | {
      event: "Finished";
    };

export async function downloadAndInstallUpdate(
  version: string,
  onEvent: (event: UpdateDownloadEvent) => void,
): Promise<void> {
  if (!isTauri) {
    onEvent({
      event: "Started",
      data: { contentLength: 5000000, source: "Web Preview (模拟高速通道)" },
    });
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 200));
      onEvent({
        event: "Progress",
        data: {
          chunkLength: 1000000,
          downloaded: i * 1000000,
          totalBytes: 5000000,
        },
      });
    }
    onEvent({ event: "Finished" });
    return;
  }

  const channel = new Channel<UpdateDownloadEvent>(onEvent);
  return tauriInvoke<void>("download_and_install_update", {
    version,
    onEvent: channel,
  });
}

// ── 用户认证与 API Key 凭据管理接口 (PRD 桌面登录方案 B) ──

/**
 * 使用 Web Crypto API 实现符合 PRD 第 6.1 节规范的 RSA-OAEP (SHA-256) 密码加密
 */
export async function encryptPasswordWithRsa(
  password: string,
  publicKeyPem: string,
): Promise<string> {
  const b64 = publicKeyPem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const cryptoKey = await window.crypto.subtle.importKey(
    "spki",
    binaryDer.buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"],
  );

  const enc = new TextEncoder();
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoKey,
    enc.encode(password),
  );

  return btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));
}

export async function getSiteStatus(): Promise<SiteStatus> {
  return invoke<SiteStatus>("get_site_status");
}

export async function getEncryptionKey(): Promise<EncryptionKeyData> {
  return invoke<EncryptionKeyData>("get_encryption_key");
}

export async function generateCaptcha(): Promise<CaptchaGenerateData> {
  return invoke<CaptchaGenerateData>("generate_captcha");
}

export async function verifyCaptcha(
  captchaId: string,
  x: number,
  y: number,
): Promise<void> {
  return invoke<void>("verify_captcha", { captchaId, x, y });
}

export async function loginAccount(payload: LoginPayload): Promise<LoginResult> {
  return invoke<LoginResult>("login_account", { payload });
}

export async function login2fa(
  flowToken: string,
  code: string,
): Promise<LoginSuccessData> {
  return invoke<LoginSuccessData>("login_2fa", { flowToken, code });
}

export async function getAuthState(): Promise<CurrentAuthState> {
  return invoke<CurrentAuthState>("get_auth_state");
}

export async function refreshAuthSession(): Promise<LoginSuccessData> {
  return invoke<LoginSuccessData>("refresh_auth_session");
}

export async function logoutAccount(): Promise<void> {
  return invoke<void>("logout_account");
}

export async function getUserTokens(all?: boolean): Promise<TokenItem[]> {
  return invoke<TokenItem[]>("get_user_tokens", { all });
}

export async function getTokenKey(tokenId: number): Promise<string> {
  return invoke<string>("get_token_key", { tokenId });
}

export async function updateUserTokenGroup(
  tokenId: number,
  newGroup: string,
): Promise<TokenItem> {
  return invoke<TokenItem>("update_user_token_group", {
    tokenId,
    newGroup,
  });
}

export async function setSelectedToken(
  tokenId?: number | null,
  tokenName?: string | null,
): Promise<void> {
  return invoke<void>("set_selected_token", {
    tokenId: tokenId ?? null,
    tokenName: tokenName ?? null,
  });
}

export async function applyApiKeyToAgents(
  apiKey: string,
  targets: string[] = ["chatgpt", "claude", "workbuddy", "acciowork", "cursor"],
): Promise<Record<string, boolean>> {
  return invoke<Record<string, boolean>>("apply_api_key_to_agents", {
    apiKey,
    targets,
  });
}

export async function getChannelGroupOverview(
  hours: number = 1,
): Promise<ChannelGroupOverview[]> {
  return invoke<ChannelGroupOverview[]>("get_channel_group_overview", { hours });
}

export async function getUserWallet(): Promise<UserWalletInfo> {
  return invoke<UserWalletInfo>("get_user_wallet");
}

export async function fetchLatestInstallerInfo(appType: string): Promise<AppInstallerInfo> {
  return invoke<AppInstallerInfo>("fetch_latest_installer_info", { appType });
}

export async function downloadInstallerFile(
  appType: string,
  onEvent: (event: AppDownloadEvent) => void,
): Promise<string> {
  if (!isTauri) {
    onEvent({ event: "Started", data: { totalBytes: 156000000, fileName: `${appType}-setup.exe` } });
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      onEvent({
        event: "Progress",
        data: { downloaded: i * 31200000, totalBytes: 156000000, percent: i * 20 },
      });
    }
    const mockPath = `C:\\Users\\User\\Downloads\\${appType}-setup.exe`;
    onEvent({
      event: "Finished",
      data: { filePath: mockPath, recordId: `mock-${appType}` },
    });
    return `mock-${appType}`;
  }

  const channel = new Channel<AppDownloadEvent>();
  channel.onmessage = (event) => {
    onEvent(event);
  };
  return tauriInvoke<string>("download_installer_file", { appType, onEvent: channel });
}

export async function runInstallerFile(recordId: string): Promise<void> {
  return invoke("run_installer_file", { recordId });
}

export async function showFileInFolder(filePath: string): Promise<void> {
  return invoke("show_file_in_folder", { filePath });
}

export async function openSystemUri(uriId: string): Promise<void> {
  return invoke("open_system_uri", { uriId });
}

export async function getSystemDiagnosticInfo(): Promise<string> {
  return invoke<string>("get_system_diagnostic_info");
}

export async function submitFeishuFeedback(
  payload: FeishuFeedbackPayload,
): Promise<FeedbackSubmitResult> {
  return invoke<FeedbackSubmitResult>("submit_feishu_feedback", { payload });
}

export async function getAutoStartStatus(): Promise<boolean> {
  return invoke<boolean>("get_auto_start_status");
}

export async function setAutoStartStatus(enabled: boolean): Promise<void> {
  return invoke<void>("set_auto_start_status", { enabled });
}

export async function exitApp(): Promise<void> {
  return invoke<void>("exit_app");
}

export async function deleteUserToken(tokenId: number): Promise<void> {
  return invoke("delete_user_token", { tokenId });
}

export async function updateUserTokenStatus(
  tokenId: number,
  status: number,
): Promise<void> {
  return invoke("update_user_token_status", { tokenId, status });
}

export async function getTokenAutoGroups(): Promise<string[]> {
  return invoke<string[]>("get_token_auto_groups");
}

export async function getUserAvailableGroups(): Promise<string[]> {
  return invoke<string[]>("get_user_available_groups");
}

export async function getUserUsageLogs(
  params: UsageLogQueryParams,
): Promise<UsageLogsResponse> {
  return invoke<UsageLogsResponse>("get_user_usage_logs", { params });
}

export async function getUserUsageStat(
  params: UsageLogQueryParams,
): Promise<UsageStatData> {
  return invoke<UsageStatData>("get_user_usage_stat", { params });
}

export async function getPricingData(): Promise<PricingResponse> {
  return invoke<PricingResponse>("get_pricing_data");
}

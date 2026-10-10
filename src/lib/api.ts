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
  SiteStatus,
  EncryptionKeyData,
  CaptchaGenerateData,
  LoginPayload,
  LoginSuccessData,
  LoginResult,
  TokenItem,
  CurrentAuthState,
  ChannelGroupOverview,
} from "../types";

export const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

function getMockResponse<T>(cmd: string, _args?: Record<string, unknown>): T {
  switch (cmd) {
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
        config_path: "~/.workbuddy-ai/models.json",
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
    case "open_url":
      if (_args && typeof _args.url === "string") {
        window.open(_args.url, "_blank");
      }
      return true as unknown as T;
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
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork",
): Promise<DetectedPathInfo> {
  return invoke<DetectedPathInfo>("detect_app_path", { appType });
}

export async function detectAllAppPaths(): Promise<DetectedPathInfo[]> {
  return invoke<DetectedPathInfo[]>("detect_all_app_paths");
}

export async function browseAppPath(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork",
): Promise<string | null> {
  return invoke<string | null>("browse_app_path", { appType });
}

export async function checkAppProcessStatus(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork",
): Promise<boolean> {
  return invoke<boolean>("check_app_process_status", { appType });
}

export async function restartTargetApp(
  appType: "claude" | "codex" | "chatgpt" | "workbuddy" | "acciowork",
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

export async function executeInTerminal(command: string): Promise<string> {
  return invoke<string>("execute_in_terminal", { command });
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

export async function getUserTokens(): Promise<TokenItem[]> {
  return invoke<TokenItem[]>("get_user_tokens");
}

export async function getTokenKey(tokenId: number): Promise<string> {
  return invoke<string>("get_token_key", { tokenId });
}

export async function createUserToken(name: string): Promise<TokenItem> {
  return invoke<TokenItem>("create_user_token", { name });
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
  targets: string[] = ["chatgpt", "claude", "workbuddy", "acciowork"],
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




import { invoke, Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  AgentConfig,
  ApiTestResult,
  AppPathsConfig,
  DetectedPathInfo,
  FetchedModel,
  NetworkStatus,
  TestStreamEvent,
} from "../types";

export async function getAppPaths(): Promise<AppPathsConfig> {
  return invoke<AppPathsConfig>("get_app_paths");
}

export async function saveAppPaths(config: AppPathsConfig): Promise<void> {
  return invoke("save_app_paths", { config });
}

export async function detectAppPath(
  appType: "claude" | "codex" | "chatgpt",
): Promise<DetectedPathInfo> {
  return invoke<DetectedPathInfo>("detect_app_path", { appType });
}

export async function detectAllAppPaths(): Promise<DetectedPathInfo[]> {
  return invoke<DetectedPathInfo[]>("detect_all_app_paths");
}

export async function browseAppPath(
  appType: "claude" | "codex" | "chatgpt",
): Promise<string | null> {
  return invoke<string | null>("browse_app_path", { appType });
}

export async function checkAppProcessStatus(
  appType: "claude" | "codex" | "chatgpt",
): Promise<boolean> {
  return invoke<boolean>("check_app_process_status", { appType });
}

export async function restartTargetApp(
  appType: "claude" | "codex" | "chatgpt",
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
  const channel = new Channel<TestStreamEvent>(onEvent);
  return invoke<ApiTestResult>("test_claude_stream", {
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

export async function executeInTerminal(command: string): Promise<string> {
  return invoke<string>("execute_in_terminal", { command });
}




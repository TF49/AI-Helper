import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  AgentConfig,
  ApiTestResult,
  FetchedModel,
  NetworkStatus,
} from "../types";

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



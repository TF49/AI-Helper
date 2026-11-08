use std::time::{Duration, Instant};

use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::Channel;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_CURSOR_PROBE_RESPONSE_BYTES: usize = 1024 * 1024;

fn test_http_client() -> Client {
    Client::builder()
        .redirect(crate::credential_policy::credentialed_redirect_policy())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("failed to build test HTTP client")
}

fn reject_unsafe_test_target(url: &str, api_key: &str) -> Option<ApiTestResult> {
    if let Err(err) = crate::credential_policy::validate_key_destination(
        api_key,
        url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    ) {
        return Some(ApiTestResult {
            success: false,
            message: err.to_string(),
            status_code: None,
            latency_ms: None,
            response_preview: None,
        });
    }
    None
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ApiTestResult {
    pub success: bool,
    pub message: String,
    pub status_code: Option<u16>,
    pub latency_ms: Option<u64>,
    pub response_preview: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", content = "data")]
pub enum TestStreamEvent {
    #[serde(rename = "log")]
    Log {
        text: String,
        level: String, // "info" | "success" | "warn" | "error" | "response" | "dim"
    },
    #[serde(rename = "chunk")]
    Chunk { delta: String },
    #[serde(rename = "finish")]
    Finish {
        success: bool,
        message: String,
        latency_ms: u64,
        status_code: Option<u16>,
    },
}

fn handle_stream_request_error(
    err: &reqwest::Error,
    latency_ms: u64,
    on_event: &Channel<TestStreamEvent>,
) -> ApiTestResult {
    let msg = if err.is_timeout() {
        "请求超时 (超过 60 秒未收到响应)".to_string()
    } else if err.is_connect() {
        "网络连接失败: 无法连接至服务节点".to_string()
    } else {
        format!("请求异常: {}", err)
    };

    let _ = on_event.send(TestStreamEvent::Log {
        text: msg.clone(),
        level: "error".to_string(),
    });
    if err.is_timeout() {
        let _ = on_event.send(TestStreamEvent::Log {
            text: "建议: 请检查网络环境或开启VPN进行重试。".to_string(),
            level: "warn".to_string(),
        });
    }
    let _ = on_event.send(TestStreamEvent::Log {
        text: "建议: 请检查服务节点 URL 是否拼写正确、本地网络连通性及代理设置。".to_string(),
        level: "warn".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Finish {
        success: false,
        message: msg.clone(),
        latency_ms,
        status_code: None,
    });

    ApiTestResult {
        success: false,
        message: msg,
        status_code: None,
        latency_ms: Some(latency_ms),
        response_preview: None,
    }
}

pub async fn test_codex_config(url: String, api_key: String, model: String) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let endpoint = format!("{}/v1/responses", api_root(&url));
    let client = test_http_client();
    let request = client.post(&endpoint).bearer_auth(&api_key).json(&json!({
        "model": model,
        "input": "Hi",
        "max_output_tokens": 16,
    }));

    send_test_request(request).await
}

pub async fn test_claude_config(url: String, api_key: String, model: String) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let endpoint = format!("{}/v1/messages", api_root(&url));
    let client = test_http_client();
    let request = client
        .post(&endpoint)
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header(header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "Hi" }],
        }));

    send_test_request(request).await
}

pub async fn test_codex_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: Channel<TestStreamEvent>,
) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let root = api_root(&url);
    let endpoint = format!("{root}/v1/responses");
    let masked_key = mask_api_key(&api_key);

    let _ = on_event.send(TestStreamEvent::Log {
        text: "正在初始化测试连接 (OpenAI Responses 协议)...".to_string(),
        level: "info".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("目标端点: {}", endpoint),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("测试模型: {} | 密钥凭证: {}", model, masked_key),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: "发送轻量握手消息: [POST /v1/responses] payload: \"Hi\" (max_output_tokens: 16)..."
            .to_string(),
        level: "info".to_string(),
    });

    let client = test_http_client();
    let request = client.post(&endpoint).bearer_auth(&api_key).json(&json!({
        "model": model,
        "input": "Hi",
        "max_output_tokens": 16,
    }));

    let start = Instant::now();
    let send_result = request.timeout(REQUEST_TIMEOUT).send().await;
    let latency_ms = start.elapsed().as_millis() as u64;

    match send_result {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();

            if status.is_success() {
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} OK - 连接成功 (往返延迟: {}ms)",
                        status_code, latency_ms
                    ),
                    level: "success".to_string(),
                });

                // 尝试解析返回内容
                let body_text = response.text().await.unwrap_or_default();
                let reply_preview = extract_response_text(&body_text);

                if let Some(ref reply) = reply_preview {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: "上游模型响应:".to_string(),
                        level: "response".to_string(),
                    });
                    let _ = on_event.send(TestStreamEvent::Chunk {
                        delta: reply.clone(),
                    });
                }

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: true,
                    message: "测试通过".to_string(),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: true,
                    message: "测试成功".to_string(),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: reply_preview,
                }
            } else {
                let body = response.text().await.unwrap_or_default();
                let cleaned_body = sanitize_error(&body, &api_key);
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} {} - 服务端返回异常 (耗时: {}ms)",
                        status_code,
                        status.canonical_reason().unwrap_or(""),
                        latency_ms
                    ),
                    level: "error".to_string(),
                });
                if !cleaned_body.is_empty() {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: format!("错误详情: {}", cleaned_body),
                        level: "error".to_string(),
                    });
                }

                // 针对不同状态码给出指引
                let hint = match status {
                    StatusCode::UNAUTHORIZED => "建议: 身份认证失败，请检查 API Key 是否正确填写或是否已被吊销。",
                    StatusCode::FORBIDDEN => "建议: 访问被拒绝，可能当前账号没有权限访问该模型，或 IP 属地受限。",
                    StatusCode::NOT_FOUND => "建议: 端点 404 未找到，请确认 Base URL 填写是否正确（Codex 原生使用 /v1/responses 端点）。",
                    StatusCode::TOO_MANY_REQUESTS => "建议: 上游返回 429 请求过多，可能是触发了频控限制或余额不足。",
                    _ if status.is_server_error() => "建议: 上游服务器内部错误 (5xx)，请稍后重试或切换备用节点。",
                    _ => "建议: 请检查填写的 Base URL、API Key 与 Model 名称是否匹配。",
                };
                let _ = on_event.send(TestStreamEvent::Log {
                    text: hint.to_string(),
                    level: "warn".to_string(),
                });

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: None,
                }
            }
        }
        Err(err) => handle_stream_request_error(&err, latency_ms, &on_event),
    }
}

pub async fn test_claude_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: Channel<TestStreamEvent>,
) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let root = api_root(&url);
    let endpoint = format!("{root}/v1/messages");
    let masked_key = mask_api_key(&api_key);

    let _ = on_event.send(TestStreamEvent::Log {
        text: "正在初始化测试连接 (Anthropic Messages 协议)...".to_string(),
        level: "info".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("目标端点: {}", endpoint),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("测试模型: {} | 密钥凭证: {}", model, masked_key),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: "发送轻量探测消息: [POST /v1/messages] max_tokens: 16...".to_string(),
        level: "info".to_string(),
    });

    let client = test_http_client();
    let request = client
        .post(&endpoint)
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header(header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "Hi" }],
        }));

    let start = Instant::now();
    let send_result = request.timeout(REQUEST_TIMEOUT).send().await;
    let latency_ms = start.elapsed().as_millis() as u64;

    match send_result {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();

            if status.is_success() {
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} OK - 连接成功 (往返延迟: {}ms)",
                        status_code, latency_ms
                    ),
                    level: "success".to_string(),
                });

                let body_text = response.text().await.unwrap_or_default();
                let reply_preview = extract_claude_response_text(&body_text);

                if let Some(ref reply) = reply_preview {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: "上游 Claude 响应:".to_string(),
                        level: "response".to_string(),
                    });
                    let _ = on_event.send(TestStreamEvent::Chunk {
                        delta: reply.clone(),
                    });
                }

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: true,
                    message: "测试通过".to_string(),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: true,
                    message: "测试成功".to_string(),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: reply_preview,
                }
            } else {
                let body = response.text().await.unwrap_or_default();
                let cleaned_body = sanitize_error(&body, &api_key);
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} {} - 服务端返回异常 (耗时: {}ms)",
                        status_code,
                        status.canonical_reason().unwrap_or(""),
                        latency_ms
                    ),
                    level: "error".to_string(),
                });
                if !cleaned_body.is_empty() {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: format!("错误详情: {}", cleaned_body),
                        level: "error".to_string(),
                    });
                }

                let hint = match status {
                    StatusCode::UNAUTHORIZED => {
                        "建议: 身份认证失败，请检查 x-api-key / ANTHROPIC_AUTH_TOKEN 是否正确。"
                    }
                    StatusCode::FORBIDDEN => {
                        "建议: 访问受限，可能当前账号权限不足或节点进行了访问管控。"
                    }
                    StatusCode::NOT_FOUND => "建议: 端点 404 未找到，请检查 Base URL 配置。",
                    StatusCode::TOO_MANY_REQUESTS => "建议: 触发速率限制或配额耗尽，请稍后再试。",
                    _ if status.is_server_error() => {
                        "建议: 上游 Anthropic 服务端或代理节点异常 (5xx)，请稍后重试。"
                    }
                    _ => "建议: 请检查 Base URL、API Key 与 Model 配置。",
                };
                let _ = on_event.send(TestStreamEvent::Log {
                    text: hint.to_string(),
                    level: "warn".to_string(),
                });

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: None,
                }
            }
        }
        Err(err) => handle_stream_request_error(&err, latency_ms, &on_event),
    }
}

pub async fn test_workbuddy_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: Channel<TestStreamEvent>,
) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let root = api_root(&url);
    let endpoint = format!("{root}/v1/chat/completions");
    let masked_key = mask_api_key(&api_key);

    let _ = on_event.send(TestStreamEvent::Log {
        text: "正在初始化测试连接 (WorkBuddy OpenAI Chat Completions 协议)...".to_string(),
        level: "info".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("目标端点: {}", endpoint),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("测试模型: {} | 密钥凭证: {}", model, masked_key),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: "发送握手消息: [POST /v1/chat/completions] payload: \"Hi\"...".to_string(),
        level: "info".to_string(),
    });

    let client = test_http_client();
    let request = client.post(&endpoint).bearer_auth(&api_key).json(&json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{ "role": "user", "content": "Hi" }],
    }));

    let start = Instant::now();
    let send_result = request.timeout(REQUEST_TIMEOUT).send().await;
    let latency_ms = start.elapsed().as_millis() as u64;

    match send_result {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();

            if status.is_success() {
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} OK - 连接成功 (往返延迟: {}ms)",
                        status_code, latency_ms
                    ),
                    level: "success".to_string(),
                });

                let body_text = response.text().await.unwrap_or_default();
                let reply_preview = extract_response_text(&body_text);

                if let Some(ref reply) = reply_preview {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: "上游模型响应:".to_string(),
                        level: "response".to_string(),
                    });
                    let _ = on_event.send(TestStreamEvent::Chunk {
                        delta: reply.clone(),
                    });
                }

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: true,
                    message: "测试通过".to_string(),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: true,
                    message: "测试成功".to_string(),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: reply_preview,
                }
            } else {
                let body = response.text().await.unwrap_or_default();
                let cleaned_body = sanitize_error(&body, &api_key);
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} {} - 服务端返回异常 (耗时: {}ms)",
                        status_code,
                        status.canonical_reason().unwrap_or(""),
                        latency_ms
                    ),
                    level: "error".to_string(),
                });
                if !cleaned_body.is_empty() {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: format!("错误详情: {}", cleaned_body),
                        level: "error".to_string(),
                    });
                }

                let hint = match status {
                    StatusCode::UNAUTHORIZED => "建议: 身份认证失败，请检查 API Key 是否正确填写或是否已被吊销。",
                    StatusCode::FORBIDDEN => "建议: 访问被拒绝，可能当前账号没有权限访问该模型，或 IP 属地受限。",
                    StatusCode::NOT_FOUND => "建议: 端点 404 未找到，请确认 Base URL 填写是否正确（WorkBuddy 默认请求 /v1/chat/completions）。",
                    StatusCode::TOO_MANY_REQUESTS => "建议: 上游返回 429 请求过多，可能是触发了频控限制或余额不足。",
                    _ if status.is_server_error() => "建议: 上游服务器内部错误 (5xx)，请稍后重试或切换备用节点。",
                    _ => "建议: 请检查 Base URL、API Key 与 Model 配置。",
                };
                let _ = on_event.send(TestStreamEvent::Log {
                    text: hint.to_string(),
                    level: "warn".to_string(),
                });

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: None,
                }
            }
        }
        Err(err) => handle_stream_request_error(&err, latency_ms, &on_event),
    }
}

fn mask_api_key(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return "(未填写)".to_string();
    }
    if trimmed.len() <= 8 {
        return "sk-****".to_string();
    }
    let prefix = &trimmed[..3.min(trimmed.len())];
    let suffix = &trimmed[trimmed.len() - 4..];
    format!("{}...{}", prefix, suffix)
}

fn extract_response_text(body: &str) -> Option<String> {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(body) {
        // 尝试从 responses API 提取: output[0].content[0].text
        if let Some(text) = val
            .pointer("/output/0/content/0/text")
            .and_then(|v| v.as_str())
        {
            return Some(text.trim().to_string());
        }
        // 尝试从 chat completions 提取: choices[0].message.content
        if let Some(text) = val
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
        {
            return Some(text.trim().to_string());
        }
    }
    // 如果不是标准结构但长度适中
    let trimmed = body.trim();
    if !trimmed.is_empty() && trimmed.len() <= 200 {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn extract_claude_response_text(body: &str) -> Option<String> {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(text) = val.pointer("/content/0/text").and_then(|v| v.as_str()) {
            return Some(text.trim().to_string());
        }
    }
    let trimmed = body.trim();
    if !trimmed.is_empty() && trimmed.len() <= 200 {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn sanitize_error(body: &str, api_key: &str) -> String {
    let mut cleaned = if !api_key.is_empty() {
        body.replace(api_key, "[REDACTED]")
    } else {
        body.to_string()
    };
    if cleaned.len() > 300 {
        cleaned.truncate(300);
        cleaned.push_str("... (截断)");
    }
    cleaned
}

fn api_root(url: &str) -> &str {
    let trimmed = url.trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

fn cursor_probe_endpoint(root: &str, responses: bool) -> String {
    if responses {
        format!("{root}/v1/responses")
    } else {
        format!("{root}/v1/chat/completions")
    }
}

fn cursor_probe_body(model: &str, responses: bool) -> serde_json::Value {
    const NAME: &str = "ai_helper_tool_probe";
    const DESCRIPTION: &str =
        "Verify that the upstream supports function calling. Do not access external resources.";
    // Reasoning models spend part of the budget before emitting the call; 16
    // tokens made them stop early and look like they lack tool support.
    const MAX_OUTPUT: u32 = 256;
    let parameters = json!({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false});
    if responses {
        json!({
            "model": model,
            "input": [{"role":"user","content":[{"type":"input_text","text":"调用探测函数并返回结果，不要只回复文本。"}]}],
            "stream": false,
            "tools": [{
                "type": "function",
                "name": NAME,
                "description": DESCRIPTION,
                "parameters": parameters,
                "strict": false
            }],
            "tool_choice": {"type": "function", "name": NAME},
            "max_output_tokens": MAX_OUTPUT
        })
    } else {
        json!({
            "model": model,
            "max_tokens": MAX_OUTPUT,
            "stream": false,
            "messages": [{ "role": "user", "content": "调用探测函数并返回结果，不要只回复文本。" }],
            "tools": [{
                "type": "function",
                "function": {"name": NAME, "description": DESCRIPTION, "parameters": parameters}
            }],
            "tool_choice": {"type": "function", "function": {"name": NAME}}
        })
    }
}

fn cursor_probe_has_tool_call(value: &serde_json::Value, responses: bool) -> bool {
    if responses {
        value
            .get("output")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .any(|item| {
                item.get("type").and_then(serde_json::Value::as_str) == Some("function_call")
                    && item.get("name").and_then(serde_json::Value::as_str)
                        == Some("ai_helper_tool_probe")
            })
    } else {
        value
            .pointer("/choices/0/message/tool_calls")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .any(|call| {
                call.pointer("/function/name")
                    .and_then(serde_json::Value::as_str)
                    == Some("ai_helper_tool_probe")
            })
    }
}

async fn read_cursor_probe_response(mut response: reqwest::Response) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CURSOR_PROBE_RESPONSE_BYTES as u64)
    {
        return Err("上游探测响应超过 1MB 限制".into());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取上游探测响应失败: {error}"))?
    {
        if chunk.len() > MAX_CURSOR_PROBE_RESPONSE_BYTES.saturating_sub(bytes.len()) {
            return Err("上游探测响应超过 1MB 限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

async fn send_test_request(request: reqwest::RequestBuilder) -> ApiTestResult {
    let start = Instant::now();
    match request.timeout(REQUEST_TIMEOUT).send().await {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let latency = start.elapsed().as_millis() as u64;
            if status.is_success() {
                ApiTestResult {
                    success: true,
                    message: "测试成功".to_string(),
                    status_code: Some(status_code),
                    latency_ms: Some(latency),
                    response_preview: None,
                }
            } else {
                ApiTestResult {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    status_code: Some(status_code),
                    latency_ms: Some(latency),
                    response_preview: None,
                }
            }
        }
        Err(err) => {
            let latency = start.elapsed().as_millis() as u64;
            let message = if err.is_timeout() {
                "请求超时 (超过 60 秒未收到响应，请检查网络环境或开启VPN进行重试)".to_string()
            } else if err.is_connect() {
                "网络连接失败: 无法连接至服务节点".to_string()
            } else {
                format!("连接失败或请求异常: {}", err)
            };
            ApiTestResult {
                success: false,
                message,
                status_code: None,
                latency_ms: Some(latency),
                response_preview: None,
            }
        }
    }
}

/// 根据模型名称推断应使用的 API 端点协议
///
/// - `claude-*`                                           → Anthropic Messages   (/v1/messages)
/// - `gpt-*` / `o1-*` / `o3-*` / `o4-*` / `codex-*` /
///   `chatgpt-*`                                         → OpenAI Responses     (/v1/responses)
/// - 其他（国产模型：deepseek, qwen, glm, moonshot 等）   → OpenAI Chat Completions (/v1/chat/completions)
#[derive(Debug, PartialEq)]
enum AccioModelProtocol {
    AnthropicMessages,
    OpenAIResponses,
    OpenAIChatCompletions,
}

fn detect_accio_model_protocol(model: &str) -> AccioModelProtocol {
    let lower = model.trim().to_lowercase();

    if lower.starts_with("claude") {
        return AccioModelProtocol::AnthropicMessages;
    }

    let openai_responses_prefixes = [
        "gpt-4o", "gpt-4", "gpt-3.5", "gpt-5", "o1-", "o3-", "o4-", "codex-", "chatgpt-",
    ];
    for prefix in &openai_responses_prefixes {
        if lower.starts_with(prefix) {
            return AccioModelProtocol::OpenAIResponses;
        }
    }

    // deepseek / qwen / glm / ernie / moonshot / yi / minimax / baichuan / hunyuan 等
    AccioModelProtocol::OpenAIChatCompletions
}

pub async fn test_accio_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: Channel<TestStreamEvent>,
) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let root = api_root(&url);
    let masked_key = mask_api_key(&api_key);

    // 根据模型名称自动选择端点与请求体格式
    let protocol = detect_accio_model_protocol(&model);
    let (endpoint, protocol_label, request_body) = match protocol {
        AccioModelProtocol::AnthropicMessages => (
            format!("{root}/v1/messages"),
            "Anthropic Messages 协议",
            json!({
                "model": model,
                "max_tokens": 16,
                "messages": [{ "role": "user", "content": "Hi" }],
            }),
        ),
        AccioModelProtocol::OpenAIResponses => (
            format!("{root}/v1/responses"),
            "OpenAI Responses 协议",
            json!({
                "model": model,
                "input": "Hi",
                "max_output_tokens": 16,
            }),
        ),
        AccioModelProtocol::OpenAIChatCompletions => (
            format!("{root}/v1/chat/completions"),
            "OpenAI Chat Completions 协议",
            json!({
                "model": model,
                "max_tokens": 16,
                "messages": [{ "role": "user", "content": "Hi" }],
            }),
        ),
    };

    let _ = on_event.send(TestStreamEvent::Log {
        text: format!(
            "正在初始化测试连接 ({} → Accio Gemini Bridge)...",
            protocol_label
        ),
        level: "info".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("目标端点: {}", endpoint),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("测试模型: {} | 密钥凭证: {}", model, masked_key),
        level: "dim".to_string(),
    });
    // 从 endpoint 提取路径部分用于日志展示
    let path_part = endpoint.strip_prefix(root).unwrap_or(&endpoint);
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("发送握手测试消息: [POST {}] payload: \"Hi\"...", path_part),
        level: "info".to_string(),
    });

    let client = test_http_client();

    // Claude 协议需要 x-api-key + anthropic-version 头；其余使用 Bearer
    let request = if matches!(protocol, AccioModelProtocol::AnthropicMessages) {
        client
            .post(&endpoint)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header(header::CONTENT_TYPE, "application/json")
            .json(&request_body)
    } else {
        client
            .post(&endpoint)
            .bearer_auth(&api_key)
            .json(&request_body)
    };

    let start = Instant::now();
    let send_result = request.timeout(REQUEST_TIMEOUT).send().await;
    let latency_ms = start.elapsed().as_millis() as u64;

    match send_result {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();

            if status.is_success() {
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} OK - 连接成功 (往返延迟: {}ms)",
                        status_code, latency_ms
                    ),
                    level: "success".to_string(),
                });

                let body_text = response.text().await.unwrap_or_default();
                let reply_preview = match protocol {
                    AccioModelProtocol::AnthropicMessages => {
                        extract_claude_response_text(&body_text)
                    }
                    _ => extract_response_text(&body_text),
                };

                if let Some(ref reply) = reply_preview {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: "上游模型响应:".to_string(),
                        level: "response".to_string(),
                    });
                    let _ = on_event.send(TestStreamEvent::Chunk {
                        delta: reply.clone(),
                    });
                }

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: true,
                    message: "测试通过".to_string(),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: true,
                    message: "测试成功".to_string(),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: reply_preview,
                }
            } else {
                let body = response.text().await.unwrap_or_default();
                let cleaned_body = sanitize_error(&body, &api_key);
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} {} - 服务端返回异常 (耗时: {}ms)",
                        status_code,
                        status.canonical_reason().unwrap_or(""),
                        latency_ms
                    ),
                    level: "error".to_string(),
                });
                if !cleaned_body.is_empty() {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: format!("错误详情: {}", cleaned_body),
                        level: "error".to_string(),
                    });
                }

                let hint = match status {
                    StatusCode::UNAUTHORIZED => "建议: 身份认证失败，请检查 API Key 是否正确填写或是否已被吊销。",
                    StatusCode::FORBIDDEN => "建议: 访问被拒绝，可能当前账号没有权限访问该模型，或 IP 属地受限。",
                    StatusCode::NOT_FOUND => match protocol {
                        AccioModelProtocol::AnthropicMessages =>
                            "建议: 端点 404 未找到，请确认 Base URL 正确（Claude 模型使用 /v1/messages 端点）。",
                        AccioModelProtocol::OpenAIResponses =>
                            "建议: 端点 404 未找到，请确认 Base URL 正确（OpenAI 原生模型使用 /v1/responses 端点）。",
                        AccioModelProtocol::OpenAIChatCompletions =>
                            "建议: 端点 404 未找到，请确认 Base URL 正确（国产模型使用 /v1/chat/completions 端点）。",
                    },
                    StatusCode::TOO_MANY_REQUESTS => "建议: 上游返回 429 请求过多，可能是触发了频控限制或余额不足。",
                    _ if status.is_server_error() => "建议: 上游服务器内部错误 (5xx)，请稍后重试或切换备用节点。",
                    _ => "建议: 请检查填写的 Base URL、API Key 与 Model 名称是否匹配。",
                };
                let _ = on_event.send(TestStreamEvent::Log {
                    text: hint.to_string(),
                    level: "warn".to_string(),
                });

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: None,
                }
            }
        }
        Err(err) => handle_stream_request_error(&err, latency_ms, &on_event),
    }
}

pub async fn test_cursor_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: Channel<TestStreamEvent>,
) -> ApiTestResult {
    if let Some(rejected) = reject_unsafe_test_target(&url, &api_key) {
        return rejected;
    }
    let root = api_root(&url);
    let mut use_responses = crate::cursor::agent::prefers_responses(&model);
    let mut endpoint = cursor_probe_endpoint(root, use_responses);
    let masked_key = mask_api_key(&api_key);

    let _ = on_event.send(TestStreamEvent::Log {
        text: "正在初始化测试连接 (Cursor Connect-RPC / OpenAI 桥接协议)...".to_string(),
        level: "info".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("目标端点: {}", endpoint),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: format!("测试模型: {} | 密钥凭证: {}", model, masked_key),
        level: "dim".to_string(),
    });
    let _ = on_event.send(TestStreamEvent::Log {
        text: "发送工具调用能力探测: 要求模型调用只读探测函数，验证 Cursor 项目工具所需的 Function Calling...".to_string(),
        level: "info".to_string(),
    });

    let client = test_http_client();
    let start = Instant::now();
    let mut send_result = client
        .post(&endpoint)
        .bearer_auth(&api_key)
        .json(&cursor_probe_body(&model, use_responses))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await;
    let fallback = use_responses
        && send_result.as_ref().ok().is_some_and(|response| {
            matches!(
                response.status(),
                StatusCode::NOT_FOUND
                    | StatusCode::METHOD_NOT_ALLOWED
                    | StatusCode::NOT_IMPLEMENTED
            )
        });
    if fallback {
        let _ = on_event.send(TestStreamEvent::Log {
            text: "上游未提供 Responses 端点，按 Cursor Agent 的兼容路径改测 Chat Completions 工具调用。".into(),
            level: "warn".into(),
        });
        use_responses = false;
        endpoint = cursor_probe_endpoint(root, false);
        send_result = client
            .post(&endpoint)
            .bearer_auth(&api_key)
            .json(&cursor_probe_body(&model, use_responses))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await;
    }
    let latency_ms = start.elapsed().as_millis() as u64;

    match send_result {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();

            if status.is_success() {
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} OK - 连接成功 (往返延迟: {}ms)",
                        status_code, latency_ms
                    ),
                    level: "success".to_string(),
                });

                let body_text = match read_cursor_probe_response(response).await {
                    Ok(body) => body,
                    Err(error) => {
                        let _ = on_event.send(TestStreamEvent::Log {
                            text: error.clone(),
                            level: "error".to_string(),
                        });
                        let _ = on_event.send(TestStreamEvent::Finish {
                            success: false,
                            message: error.clone(),
                            latency_ms,
                            status_code: Some(status_code),
                        });
                        return ApiTestResult {
                            success: false,
                            message: error,
                            status_code: Some(status_code),
                            latency_ms: Some(latency_ms),
                            response_preview: None,
                        };
                    }
                };
                let parsed: serde_json::Value =
                    serde_json::from_str(&body_text).unwrap_or_default();
                let tool_call = cursor_probe_has_tool_call(&parsed, use_responses);
                let reply_preview = extract_response_text(&body_text);

                if let Some(ref reply) = reply_preview {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: "上游模型响应:".to_string(),
                        level: "response".to_string(),
                    });
                    let _ = on_event.send(TestStreamEvent::Chunk {
                        delta: reply.clone(),
                    });
                }

                let success = tool_call;
                let message = if success {
                    "连接成功，且已验证工具调用能力".to_string()
                } else {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: "上游可连接，但没有返回被要求的工具调用；Cursor 将无法使用项目文件与 Agent 工具。请切换支持 OpenAI Function Calling 的模型或中转站。".to_string(),
                        level: "error".to_string(),
                    });
                    "连接成功，但未验证工具调用能力".to_string()
                };
                let _ = on_event.send(TestStreamEvent::Finish {
                    success,
                    message: message.clone(),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success,
                    message,
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: reply_preview,
                }
            } else {
                let body = read_cursor_probe_response(response)
                    .await
                    .unwrap_or_else(|error| error);
                let cleaned_body = sanitize_error(&body, &api_key);
                let _ = on_event.send(TestStreamEvent::Log {
                    text: format!(
                        "HTTP {} {} - 服务端返回异常 (耗时: {}ms)",
                        status_code,
                        status.canonical_reason().unwrap_or(""),
                        latency_ms
                    ),
                    level: "error".to_string(),
                });
                if !cleaned_body.is_empty() {
                    let _ = on_event.send(TestStreamEvent::Log {
                        text: format!("错误详情: {}", cleaned_body),
                        level: "error".to_string(),
                    });
                }

                let hint = match status {
                    StatusCode::UNAUTHORIZED => "建议: 身份认证失败，请检查 API Key 是否正确填写或是否已被吊销。",
                    StatusCode::FORBIDDEN => "建议: 访问被拒绝，可能当前账号没有权限访问该模型，或 IP 属地受限。",
                    StatusCode::NOT_FOUND => "建议: 端点 404 未找到，请确认 Base URL 填写是否正确（Cursor Bridge 默认请求 /v1/chat/completions）。",
                    StatusCode::TOO_MANY_REQUESTS => "建议: 上游返回 429 请求过多，可能是触发了频控限制或余额不足。",
                    _ if status.is_server_error() => "建议: 上游服务器内部错误 (5xx)，请稍后重试或切换备用节点。",
                    _ => "建议: 请检查 Base URL、API Key 与 Model 配置。",
                };
                let _ = on_event.send(TestStreamEvent::Log {
                    text: hint.to_string(),
                    level: "warn".to_string(),
                });

                let _ = on_event.send(TestStreamEvent::Finish {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    latency_ms,
                    status_code: Some(status_code),
                });

                ApiTestResult {
                    success: false,
                    message: format!("服务返回 HTTP {}", status_code),
                    status_code: Some(status_code),
                    latency_ms: Some(latency_ms),
                    response_preview: None,
                }
            }
        }
        Err(err) => handle_stream_request_error(&err, latency_ms, &on_event),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reject_unsafe_remote_http() {
        let res = reject_unsafe_test_target("http://evil.com/v1", "sk-custom-key");
        assert!(res.is_some());
        assert!(!res.unwrap().success);
    }

    #[test]
    fn test_reject_managed_key_to_unauthorized_dest() {
        let managed_key = "sk-managed-test-api-test-01";
        crate::credential_policy::register_managed_key(managed_key);
        let res = reject_unsafe_test_target("https://unauthorized-ai-service.com/v1", managed_key);
        assert!(res.is_some());
        let rejected = res.unwrap();
        assert!(!rejected.success);
        assert!(rejected.message.contains("受管 Key 不得发往未授权目标"));
    }

    #[test]
    fn test_allow_managed_key_to_official_dest() {
        let managed_key = "sk-managed-test-api-test-02";
        crate::credential_policy::register_managed_key(managed_key);
        let res = reject_unsafe_test_target("https://bob-api.com/v1", managed_key);
        assert!(res.is_none());
    }

    #[test]
    fn cursor_probe_uses_the_runtime_protocol_and_forces_the_probe_function() {
        assert!(cursor_probe_endpoint("https://example.test", true).ends_with("/v1/responses"));
        assert!(
            cursor_probe_endpoint("https://example.test", false).ends_with("/v1/chat/completions")
        );
        let responses = cursor_probe_body("test-model", true);
        assert_eq!(
            responses["tool_choice"],
            json!({"type":"function","name":"ai_helper_tool_probe"})
        );
        assert!(responses["max_output_tokens"].as_u64().unwrap() >= 256);
        assert_eq!(responses["tools"][0]["name"], "ai_helper_tool_probe");

        let chat = cursor_probe_body("test-model", false);
        assert_eq!(
            chat["tool_choice"],
            json!({"type":"function","function":{"name":"ai_helper_tool_probe"}})
        );
        assert!(chat["max_tokens"].as_u64().unwrap() >= 256);
        let function = chat["tools"][0]["function"].as_object().unwrap();
        assert_eq!(function["name"], "ai_helper_tool_probe");
        // Chat function objects carry no Responses-only fields.
        assert!(!function.contains_key("type"));
        assert!(!function.contains_key("strict"));
        assert!(crate::cursor::agent::prefers_responses("gpt-5.6-sol"));
        assert!(!crate::cursor::agent::prefers_responses("glm-5.3"));
    }

    #[test]
    fn cursor_probe_recognizes_calls_in_both_protocol_shapes() {
        let chat = json!({"choices":[{"message":{"tool_calls":[{
            "function":{"name":"ai_helper_tool_probe"}
        }]}}]});
        let responses = json!({"output":[{
            "type":"function_call","name":"ai_helper_tool_probe"
        }]});
        assert!(cursor_probe_has_tool_call(&chat, false));
        assert!(cursor_probe_has_tool_call(&responses, true));
        assert!(!cursor_probe_has_tool_call(&chat, true));
        assert!(!cursor_probe_has_tool_call(&responses, false));
    }
}

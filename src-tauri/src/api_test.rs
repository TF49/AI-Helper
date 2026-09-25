use std::time::{Duration, Instant};

use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::Channel;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

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

pub async fn test_codex_config(url: String, api_key: String, model: String) -> ApiTestResult {
    let endpoint = format!("{}/v1/responses", api_root(&url));
    let client = Client::new();
    let request = client.post(&endpoint).bearer_auth(&api_key).json(&json!({
        "model": model,
        "input": "Hi",
    }));

    send_test_request(request).await
}

pub async fn test_claude_config(url: String, api_key: String, model: String) -> ApiTestResult {
    let endpoint = format!("{}/v1/messages", api_root(&url));
    let client = Client::new();
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
        text: "发送轻量握手消息: [POST /v1/responses] payload: \"Hi\"...".to_string(),
        level: "info".to_string(),
    });

    let client = Client::new();
    let request = client.post(&endpoint).bearer_auth(&api_key).json(&json!({
        "model": model,
        "input": "Hi",
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
        Err(err) => {
            let msg = if err.is_timeout() {
                "请求超时 (超过 20 秒未收到响应)".to_string()
            } else if err.is_connect() {
                "网络连接失败: 无法连接至服务节点".to_string()
            } else {
                format!("请求异常: {}", err)
            };

            let _ = on_event.send(TestStreamEvent::Log {
                text: msg.clone(),
                level: "error".to_string(),
            });
            let _ = on_event.send(TestStreamEvent::Log {
                text: "建议: 请检查服务节点 URL 是否拼写正确、本地网络连通性及代理设置。"
                    .to_string(),
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
    }
}

pub async fn test_claude_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: Channel<TestStreamEvent>,
) -> ApiTestResult {
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

    let client = Client::new();
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
        Err(err) => {
            let msg = if err.is_timeout() {
                "请求超时 (超过 20 秒未收到响应)".to_string()
            } else if err.is_connect() {
                "网络连接失败: 无法连接至服务节点".to_string()
            } else {
                format!("请求异常: {}", err)
            };

            let _ = on_event.send(TestStreamEvent::Log {
                text: msg.clone(),
                level: "error".to_string(),
            });
            let _ = on_event.send(TestStreamEvent::Log {
                text: "建议: 请检查服务节点 URL 是否拼写正确、本地网络连通性及代理设置。"
                    .to_string(),
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
        Err(_) => ApiTestResult {
            success: false,
            message: "连接失败或请求超时".to_string(),
            status_code: None,
            latency_ms: None,
            response_preview: None,
        },
    }
}

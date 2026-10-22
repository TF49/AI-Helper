use serde_json::{json, Value};

/// 编码 Connect-RPC 协议帧 (1字节标志 + 4字节大端长度 + JSON有效载荷)
pub fn encode_connect_frame(flags: u8, val: &Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(val).unwrap_or_default();
    let len = json_bytes.len() as u32;
    let mut buf = Vec::with_capacity(5 + json_bytes.len());
    buf.push(flags);
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(&json_bytes);
    buf
}

/// 创建 Connect-RPC 文本流式增量 Chunk 帧
pub fn create_connect_text_chunk(text: &str) -> Vec<u8> {
    let payload = json!({
        "text": text,
        "fullText": ""
    });
    encode_connect_frame(0x00, &payload)
}

/// 创建 Connect-RPC 结束帧 (Trailer)
pub fn create_connect_end_frame() -> Vec<u8> {
    encode_connect_frame(0x02, &json!({}))
}

/// 创建 Connect-RPC 错误提示流 (包含提示文本帧及流结束尾帧，防止客户端无限挂起)
pub fn create_connect_error_stream(msg: &str) -> Vec<u8> {
    let mut buf = create_connect_text_chunk(msg);
    buf.extend_from_slice(&create_connect_end_frame());
    buf
}

/// 解包 Connect-RPC 请求体 (若包含 5 字节前缀则剥离，直接返回 JSON Value)
pub fn decode_connect_or_json(bytes: &[u8]) -> Option<Value> {
    if bytes.is_empty() {
        return None;
    }

    // 检查是否包含 5 字节 Connect-RPC 包头
    if bytes.len() > 5 && bytes[0] == 0x00 {
        let len = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as usize;
        if bytes.len() >= 5 + len {
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes[5..5 + len]) {
                return Some(v);
            }
        }
    }

    // 尝试作为普通 JSON 解析
    serde_json::from_slice::<Value>(bytes).ok()
}

/// 将 Cursor 请求转译为标准 OpenAI Chat Completions 协议
pub fn cursor_to_openai_request(raw_body: &Value, fallback_model: &str) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    let mut context_parts: Vec<String> = Vec::new();

    // 0. 提取工作区上下文 (当前文件、打开的代码块)
    let current_file_node = raw_body
        .get("currentFile")
        .or_else(|| raw_body.get("current_file"));
    if let Some(cf) = current_file_node {
        let path = cf
            .get("relativeWorkspacePath")
            .or_else(|| cf.get("relative_workspace_path"))
            .and_then(|v| v.as_str())
            .unwrap_or("active_file");
        let contents = cf.get("contents").and_then(|v| v.as_str()).unwrap_or("");
        if !contents.is_empty() {
            context_parts.push(format!(
                "### Current Active File: `{}`\n```\n{}\n```",
                path, contents
            ));
        }
    }

    let code_blocks_node = raw_body
        .get("codeBlocks")
        .or_else(|| raw_body.get("code_blocks"))
        .and_then(|v| v.as_array());
    if let Some(blocks) = code_blocks_node {
        for b in blocks {
            let path = b
                .get("relativeWorkspacePath")
                .or_else(|| b.get("relative_workspace_path"))
                .and_then(|v| v.as_str())
                .unwrap_or("code_block");
            let contents = b
                .get("contents")
                .or_else(|| b.get("fileContents"))
                .or_else(|| b.get("file_contents"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !contents.is_empty() {
                context_parts.push(format!(
                    "### Referenced Code `{}`:\n```\n{}\n```",
                    path, contents
                ));
            }
        }
    }

    if !context_parts.is_empty() {
        let system_prompt = format!(
            "Context from the user's workspace in Cursor IDE:\n\n{}",
            context_parts.join("\n\n")
        );
        messages.push(json!({
            "role": "system",
            "content": system_prompt
        }));
    }

    // 1. 如果包含标准 OpenAI messages 数组，直接沿用
    if let Some(msg_arr) = raw_body.get("messages").and_then(|v| v.as_array()) {
        for m in msg_arr {
            let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("user");
            let content = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if !content.is_empty() {
                messages.push(json!({
                    "role": role,
                    "content": content
                }));
            }
        }
    }

    // 2. 如果包含 Cursor conversation (Connect-RPC 格式)
    if let Some(conv) = raw_body.get("conversation").and_then(|v| v.as_array()) {
        for bubble in conv {
            let role = if let Some(t_int) = bubble.get("type").and_then(|v| v.as_i64()) {
                match t_int {
                    1 => "user",
                    2 => "assistant",
                    _ => "user",
                }
            } else if let Some(t_str) = bubble.get("type").and_then(|v| v.as_str()) {
                match t_str {
                    "MESSAGE_TYPE_USER" | "user" | "human" => "user",
                    "MESSAGE_TYPE_ASSISTANT" | "assistant" | "bot" => "assistant",
                    _ => "user",
                }
            } else {
                "user"
            };

            let text = bubble.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let mut bubble_text = text.to_string();

            if let Some(chunks) = bubble
                .get("attachedCodeChunks")
                .or_else(|| bubble.get("attached_code_chunks"))
                .and_then(|v| v.as_array())
            {
                for chunk in chunks {
                    let path = chunk
                        .get("relativeWorkspacePath")
                        .or_else(|| chunk.get("relative_workspace_path"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let lines: Vec<&str> = chunk
                        .get("lines")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|l| l.as_str()).collect())
                        .unwrap_or_default();
                    if !lines.is_empty() {
                        bubble_text.push_str(&format!(
                            "\n\n[Attached code from `{}`]:\n```\n{}\n```",
                            path,
                            lines.join("\n")
                        ));
                    }
                }
            }

            if !bubble_text.trim().is_empty() {
                messages.push(json!({
                    "role": role,
                    "content": bubble_text
                }));
            }
        }
    }

    // 3. 如果当前请求附带单独的 user 提问
    if let Some(current_text) = raw_body.get("text").and_then(|v| v.as_str()) {
        if !current_text.trim().is_empty() {
            // 避免重复追加最后一条
            let is_duplicate = messages
                .last()
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                == Some(current_text);
            if !is_duplicate {
                messages.push(json!({
                    "role": "user",
                    "content": current_text
                }));
            }
        }
    }

    // 4. 解析与规整目标模型
    let raw_model = raw_body
        .get("modelDetails")
        .or_else(|| raw_body.get("model_details"))
        .and_then(|d| d.get("model"))
        .and_then(|m| m.as_str())
        .or_else(|| raw_body.get("model").and_then(|m| m.as_str()))
        .unwrap_or(fallback_model);

    let target_model = match raw_model.trim() {
        "" | "default" | "auto" | "cursor-small" | "composer" => fallback_model,
        "claude-3.7-sonnet" => "claude-3-7-sonnet",
        "claude-3.5-sonnet" => "claude-3-5-sonnet",
        other => other,
    };

    // 兜底：如果 messages 为空，注入默认引导消息
    if messages.is_empty() {
        messages.push(json!({
            "role": "user",
            "content": "Hello"
        }));
    }

    json!({
        "model": target_model,
        "messages": messages,
        "stream": true,
        "temperature": 0.7
    })
}

/// 从标准 OpenAI SSE 数据行提取文本内容
pub fn extract_openai_delta_content(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with("data:") {
        return None;
    }

    let payload = trimmed.trim_start_matches("data:").trim();
    if payload == "[DONE]" || payload.is_empty() {
        return None;
    }

    let parsed: Value = serde_json::from_str(payload).ok()?;
    let choice = parsed.get("choices")?.as_array()?.first()?;
    let delta = choice.get("delta")?;

    // 优先提取正文 content
    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
        if !content.is_empty() {
            return Some(content.to_string());
        }
    }

    // 针对 DeepSeek R1 等思考模型，兼容 reasoning_content
    if let Some(reasoning) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
        if !reasoning.is_empty() {
            return Some(reasoning.to_string());
        }
    }

    None
}

/// 格式化 OpenAI /v1/models 响应
pub fn format_openai_models_response(custom_models: &[String]) -> Value {
    let data: Vec<Value> = custom_models
        .iter()
        .map(|m| {
            json!({
                "id": m,
                "object": "model",
                "created": 1700000000,
                "owned_by": "ai-helper"
            })
        })
        .collect();

    json!({
        "object": "list",
        "data": data
    })
}

/// 格式化 Connect-RPC AvailableModels 响应
pub fn format_connect_available_models(custom_models: &[String]) -> Value {
    let models: Vec<Value> = custom_models
        .iter()
        .map(|m| {
            let display_name = match m.as_str() {
                "claude-3-7-sonnet" => "Claude 3.7 Sonnet (AI-Helper)".to_string(),
                "claude-3-5-sonnet" => "Claude 3.5 Sonnet (AI-Helper)".to_string(),
                "deepseek-chat" => "DeepSeek V3 (AI-Helper)".to_string(),
                "deepseek-reasoner" => "DeepSeek R1 (AI-Helper)".to_string(),
                "gpt-4o" => "GPT-4o (AI-Helper)".to_string(),
                "o3-mini" => "o3-mini (AI-Helper)".to_string(),
                other => format!("{} (AI-Helper)", other),
            };

            json!({
                "name": m,
                "displayName": display_name,
                "isAvailable": true,
                "pricingType": "promptAndCompletion",
                "supportsStreaming": true
            })
        })
        .collect();

    json!({
        "models": models
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_connect_frame_roundtrip() {
        let payload = json!({"hello": "world"});
        let frame = encode_connect_frame(0x00, &payload);
        assert_eq!(frame[0], 0x00);
        let decoded = decode_connect_or_json(&frame).expect("should decode frame");
        assert_eq!(decoded["hello"], "world");
    }

    #[test]
    fn test_create_connect_error_stream() {
        let err_stream = create_connect_error_stream("test error message");
        assert!(!err_stream.is_empty());
        // First frame is 0x00 data frame
        assert_eq!(err_stream[0], 0x00);
        // Contains trailer frame 0x02
        assert!(err_stream.contains(&0x02));
    }

    #[test]
    fn test_cursor_to_openai_request_with_context() {
        let cursor_req = json!({
            "currentFile": {
                "relativeWorkspacePath": "src/main.rs",
                "contents": "fn main() { println!(\"hi\"); }"
            },
            "conversation": [
                {
                    "type": 1,
                    "text": "Explain this code",
                    "attachedCodeChunks": [
                        {
                            "relativeWorkspacePath": "src/lib.rs",
                            "lines": ["pub fn add(a: i32, b: i32) -> i32 { a + b }"]
                        }
                    ]
                }
            ],
            "modelDetails": {
                "model": "default"
            }
        });

        let openai_req = cursor_to_openai_request(&cursor_req, "claude-3-7-sonnet");
        assert_eq!(openai_req["model"], "claude-3-7-sonnet");

        let messages = openai_req["messages"].as_array().expect("array");
        assert_eq!(messages.len(), 2);
        // First message is system context
        assert_eq!(messages[0]["role"], "system");
        let sys_content = messages[0]["content"].as_str().unwrap();
        assert!(sys_content.contains("src/main.rs"));
        assert!(sys_content.contains("fn main()"));

        // Second message is user with attached code
        assert_eq!(messages[1]["role"], "user");
        let user_content = messages[1]["content"].as_str().unwrap();
        assert!(user_content.contains("Explain this code"));
        assert!(user_content.contains("src/lib.rs"));
        assert!(user_content.contains("pub fn add"));
    }

    #[test]
    fn test_cursor_model_normalization() {
        let req1 = json!({ "model": "claude-3.7-sonnet", "text": "hello" });
        let out1 = cursor_to_openai_request(&req1, "deepseek-chat");
        assert_eq!(out1["model"], "claude-3-7-sonnet");

        let req2 = json!({ "model": "cursor-small", "text": "hello" });
        let out2 = cursor_to_openai_request(&req2, "deepseek-chat");
        assert_eq!(out2["model"], "deepseek-chat");
    }

    #[test]
    fn test_extract_openai_delta_content() {
        let sse_normal = r#"data: {"choices":[{"delta":{"content":"Hello world"}}]}"#;
        assert_eq!(
            extract_openai_delta_content(sse_normal),
            Some("Hello world".to_string())
        );

        let sse_reasoning = r#"data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}"#;
        assert_eq!(
            extract_openai_delta_content(sse_reasoning),
            Some("Thinking...".to_string())
        );

        assert_eq!(extract_openai_delta_content("data: [DONE]"), None);
    }
}

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
            let bubble_type = bubble.get("type").and_then(|v| v.as_i64()).unwrap_or(1);
            let text = bubble.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if !text.trim().is_empty() {
                let role = match bubble_type {
                    1 => "user",
                    2 => "assistant",
                    _ => "user",
                };
                messages.push(json!({
                    "role": role,
                    "content": text
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

    // 4. 解析目标模型
    let target_model = raw_body
        .get("modelDetails")
        .and_then(|d| d.get("model"))
        .and_then(|m| m.as_str())
        .or_else(|| raw_body.get("model").and_then(|m| m.as_str()))
        .unwrap_or(fallback_model);

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

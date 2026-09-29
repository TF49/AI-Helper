use serde_json::{json, Value};

const MAX_TOOL_CONTENT_CHARS: usize = 32 * 1024;
const MAX_TEXT_CONTENT_CHARS: usize = 96 * 1024;

/// 安全按字符截断文本，避免 UTF-8 边界切分 Panic
pub fn safe_truncate_head(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

pub fn safe_truncate_tail(s: &str, max_chars: usize) -> &str {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        return s;
    }
    let skip = char_count - max_chars;
    match s.char_indices().nth(skip) {
        Some((idx, _)) => &s[idx..],
        None => s,
    }
}

/// 裁剪超长工具执行返回结果 (保留前 67% + 后 33%)
pub fn compact_tool_content(raw: &str, max_chars: usize) -> String {
    let char_count = raw.chars().count();
    if char_count <= max_chars {
        return raw.to_string();
    }
    let marker = format!(
        "\n\n[... AI-Helper 中继：中间内容已裁剪 (原长 {} 字符) ...]\n\n",
        char_count
    );
    let marker_chars = marker.chars().count();
    let available = max_chars.saturating_sub(marker_chars);
    let head_len = (available as f64 * 0.67).ceil() as usize;
    let tail_len = available.saturating_sub(head_len);

    format!(
        "{}{}{}",
        safe_truncate_head(raw, head_len),
        marker,
        safe_truncate_tail(raw, tail_len)
    )
}

/// 提取并解析 JSON
fn parse_json_or_text(val: &Value) -> String {
    match val {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// 将 Accio Gemini 格式请求转译为 OpenAI 标准 Chat Completions 协议
pub fn accio_to_openai(input: &Value, default_model: &str) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    // 1. 处理系统提示词 (systemInstruction / system_instruction)
    if let Some(sys) = input
        .get("systemInstruction")
        .or_else(|| input.get("system_instruction"))
    {
        let mut sys_text = Vec::new();
        if let Some(parts) = sys.get("parts").and_then(Value::as_array) {
            for part in parts {
                if let Some(t) = part.get("text").and_then(Value::as_str) {
                    sys_text.push(t);
                }
            }
        }
        if !sys_text.is_empty() {
            messages.push(json!({
                "role": "system",
                "content": sys_text.join("\n")
            }));
        }
    }

    // 2. 处理多轮对话内容 (contents)
    if let Some(contents) = input.get("contents").and_then(Value::as_array) {
        for content in contents {
            let role_raw = content
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("user");
            let role = match role_raw {
                "model" => "assistant",
                "function" => "tool",
                other => other,
            };

            let mut texts = Vec::new();
            let mut images = Vec::new();
            let mut tool_calls = Vec::new();
            let mut tool_responses = Vec::new();

            if let Some(parts) = content.get("parts").and_then(Value::as_array) {
                for (part_idx, part) in parts.iter().enumerate() {
                    // 文本
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        texts.push(t.to_string());
                    }
                    // 图片 (inlineData / inline_data)
                    if let Some(inline) = part.get("inlineData").or_else(|| part.get("inline_data"))
                    {
                        let mime = inline
                            .get("mimeType")
                            .or_else(|| inline.get("mime_type"))
                            .and_then(Value::as_str)
                            .unwrap_or("image/jpeg");
                        if let Some(data) = inline.get("data").and_then(Value::as_str) {
                            images.push(json!({
                                "type": "image_url",
                                "image_url": {
                                    "url": format!("data:{};base64,{}", mime, data)
                                }
                            }));
                        }
                    }
                    // 工具调用 (functionCall)
                    if let Some(fc) = part
                        .get("functionCall")
                        .or_else(|| part.get("function_call"))
                    {
                        let name = fc
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let call_id = fc
                            .get("id")
                            .and_then(Value::as_str)
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("call_{}", part_idx + 1));
                        let args = fc
                            .get("args")
                            .or_else(|| fc.get("argsJson"))
                            .or_else(|| fc.get("arguments"))
                            .cloned()
                            .unwrap_or_else(|| json!({}));

                        let args_str = if args.is_string() {
                            args.as_str().unwrap().to_string()
                        } else {
                            serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string())
                        };

                        tool_calls.push(json!({
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": args_str
                            }
                        }));
                    }
                    // 工具响应 (functionResponse)
                    if let Some(fr) = part
                        .get("functionResponse")
                        .or_else(|| part.get("function_response"))
                    {
                        let call_id = fr
                            .get("id")
                            .or_else(|| fr.get("toolCallId"))
                            .or_else(|| fr.get("tool_call_id"))
                            .and_then(Value::as_str)
                            .unwrap_or("call_1")
                            .to_string();
                        let resp_val = fr
                            .get("response")
                            .or_else(|| fr.get("responseJson"))
                            .or_else(|| fr.get("content"))
                            .or_else(|| fr.get("data"))
                            .cloned()
                            .unwrap_or(Value::Null);

                        let raw_resp = parse_json_or_text(&resp_val);
                        let compacted = compact_tool_content(&raw_resp, MAX_TOOL_CONTENT_CHARS);

                        tool_responses.push(json!({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": compacted
                        }));
                    }
                }
            }

            // 组装 assistant 角色消息 (可能含 tool_calls)
            if !tool_calls.is_empty() {
                let joined_text = texts.join("\n");
                let content_val = if joined_text.is_empty() {
                    Value::Null
                } else {
                    json!(safe_truncate_head(&joined_text, MAX_TEXT_CONTENT_CHARS))
                };
                messages.push(json!({
                    "role": "assistant",
                    "content": content_val,
                    "tool_calls": tool_calls
                }));
            } else if role == "assistant" && !texts.is_empty() {
                let joined_text = texts.join("\n");
                messages.push(json!({
                    "role": "assistant",
                    "content": safe_truncate_head(&joined_text, MAX_TEXT_CONTENT_CHARS)
                }));
            } else if !images.is_empty() {
                let mut parts_arr = vec![json!({
                    "type": "text",
                    "text": safe_truncate_head(&texts.join("\n"), MAX_TEXT_CONTENT_CHARS)
                })];
                parts_arr.extend(images);
                messages.push(json!({
                    "role": role,
                    "content": parts_arr
                }));
            } else if !texts.is_empty() {
                messages.push(json!({
                    "role": role,
                    "content": safe_truncate_head(&texts.join("\n"), MAX_TEXT_CONTENT_CHARS)
                }));
            }

            // 紧接着推入所有 tool 返回
            messages.extend(tool_responses);
        }
    }

    // 若无 contents 但直接传了 messages，兜底兼容
    if messages.is_empty() {
        if let Some(input_messages) = input.get("messages").and_then(Value::as_array) {
            messages.extend(input_messages.iter().cloned());
        }
    }

    // 3. 处理工具声明 (tools) - 支持嵌套 functionDeclarations 及顶层扁平定义
    let tools = input
        .get("tools")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .flat_map(|item| {
                    if item.get("name").is_some() {
                        vec![item.clone()]
                    } else {
                        item.get("functionDeclarations")
                            .or_else(|| item.get("function_declarations"))
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default()
                    }
                })
                .map(|declaration| {
                    let name = declaration
                        .get("name")
                        .cloned()
                        .unwrap_or_else(|| Value::String("tool".into()));
                    let description = declaration
                        .get("description")
                        .cloned()
                        .unwrap_or_else(|| Value::String(String::new()));
                    let parameters = declaration
                        .get("parameters")
                        .or_else(|| declaration.get("parametersJson"))
                        .or_else(|| declaration.get("parameters_json"))
                        .cloned()
                        .unwrap_or_else(|| json!({"type":"object","properties":{}}));
                    json!({
                        "type": "function",
                        "function": {
                            "name": name,
                            "description": description,
                            "parameters": parameters
                        }
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    // 4. 生成参数 (generationConfig / properties.generationConfig)
    let generation = input
        .get("generationConfig")
        .or_else(|| input.get("generation_config"))
        .cloned()
        .or_else(|| {
            input
                .pointer("/properties/generationConfig")
                .or_else(|| input.pointer("/properties/generation_config"))
                .and_then(|v| {
                    if let Some(s) = v.as_str() {
                        serde_json::from_str(s).ok()
                    } else {
                        Some(v.clone())
                    }
                })
        })
        .unwrap_or(Value::Null);

    // 模型选择：多字段探测 (model / modelCode / modelName / properties.model)，显式非 auto 优先
    let selected_model = extract_requested_model(input, default_model);

    let mut output = json!({
        "model": selected_model,
        "messages": messages,
        "stream": true,
        "temperature": generation.get("temperature").cloned().unwrap_or(json!(0.7)),
        "max_tokens": generation.get("maxOutputTokens")
            .or_else(|| generation.get("max_output_tokens"))
            .cloned()
            .unwrap_or(json!(16384))
    });

    if !tools.is_empty() {
        output["tools"] = Value::Array(tools);
        output["tool_choice"] = json!("auto");
    }

    output
}

/// 从 Accio 多种可能携带模型名称的字段中提取生效模型
pub fn extract_requested_model<'a>(input: &'a Value, default_model: &'a str) -> &'a str {
    let candidates = [
        input.get("model"),
        input.get("modelCode"),
        input.get("model_code"),
        input.get("modelName"),
        input.get("model_name"),
        input.pointer("/properties/model"),
        input.pointer("/properties/modelCode"),
        input.pointer("/properties/model_code"),
        input.pointer("/properties/modelName"),
        input.pointer("/properties/model_name"),
    ];
    for cand in candidates {
        if let Some(s) = cand.and_then(Value::as_str) {
            let trimmed = s.trim();
            if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("auto") {
                return trimmed;
            }
        }
    }
    default_model
}

/// 判断当前请求是否为 Accio 专用生图请求 (responseModalities 包含 IMAGE)
#[allow(dead_code)]
pub fn is_image_output_request(input: &Value) -> bool {
    let generation = input
        .get("generationConfig")
        .or_else(|| input.get("generation_config"))
        .or_else(|| input.pointer("/properties/generationConfig"))
        .or_else(|| input.pointer("/properties/generation_config"));

    let gen_val: Option<Value> = generation.and_then(|v| {
        if let Some(s) = v.as_str() {
            serde_json::from_str(s).ok()
        } else {
            Some(v.clone())
        }
    });

    if let Some(ref g) = gen_val {
        if let Some(modalities) = g
            .get("responseModalities")
            .or_else(|| g.get("response_modalities"))
            .and_then(Value::as_array)
        {
            return modalities.iter().any(|m| {
                m.as_str()
                    .map(|s| s.eq_ignore_ascii_case("IMAGE"))
                    .unwrap_or(false)
            });
        }
    }
    false
}

/// 合并 OpenAI 流式返回的所有 Chunk
pub fn merge_openai_chunks(chunks: &[Value]) -> Value {
    let mut merged_text = String::new();
    let mut reasoning_text = String::new();
    let mut tool_calls_map: std::collections::BTreeMap<usize, (String, String, String)> =
        std::collections::BTreeMap::new(); // index -> (id, name, args)
    let mut finish_reason = "STOP".to_string();
    let mut prompt_tokens = 0u64;
    let mut completion_tokens = 0u64;
    let mut total_tokens = 0u64;
    let mut model_name = String::new();

    for chunk in chunks {
        if let Some(m) = chunk.get("model").and_then(Value::as_str) {
            if model_name.is_empty() {
                model_name = m.to_string();
            }
        }
        if let Some(usage) = chunk.get("usage") {
            if let Some(pt) = usage.get("prompt_tokens").and_then(Value::as_u64) {
                prompt_tokens = pt;
            }
            if let Some(ct) = usage.get("completion_tokens").and_then(Value::as_u64) {
                completion_tokens = ct;
            }
            if let Some(tt) = usage.get("total_tokens").and_then(Value::as_u64) {
                total_tokens = tt;
            }
        }
        if let Some(choices) = chunk.get("choices").and_then(Value::as_array) {
            if let Some(choice) = choices.first() {
                if let Some(fr) = choice.get("finish_reason").and_then(Value::as_str) {
                    finish_reason = if fr == "length" {
                        "MAX_TOKENS".to_string()
                    } else {
                        "STOP".to_string()
                    };
                }
                let delta = choice.get("delta").or_else(|| choice.get("message"));
                if let Some(d) = delta {
                    if let Some(c) = d.get("content").and_then(Value::as_str) {
                        merged_text.push_str(c);
                    }
                    if let Some(rc) = d
                        .get("reasoning_content")
                        .or_else(|| d.get("reasoning"))
                        .and_then(Value::as_str)
                    {
                        reasoning_text.push_str(rc);
                    }
                    if let Some(tcs) = d.get("tool_calls").and_then(Value::as_array) {
                        for tc in tcs {
                            let idx = tc
                                .get("index")
                                .and_then(Value::as_u64)
                                .map(|i| i as usize)
                                .unwrap_or_else(|| tool_calls_map.len());
                            let entry = tool_calls_map
                                .entry(idx)
                                .or_insert_with(|| (String::new(), String::new(), String::new()));
                            if let Some(id) = tc.get("id").and_then(Value::as_str) {
                                if entry.0.is_empty() {
                                    entry.0 = id.to_string();
                                } else if !entry.0.contains(id) && !id.contains(&entry.0) {
                                    entry.0.push_str(id);
                                }
                            }
                            if let Some(func) = tc.get("function") {
                                if let Some(n) = func.get("name").and_then(Value::as_str) {
                                    if entry.1.is_empty() {
                                        entry.1 = n.to_string();
                                    } else if !entry.1.contains(n) && !n.contains(&entry.1) {
                                        entry.1.push_str(n);
                                    }
                                }
                                if let Some(a) = func.get("arguments").and_then(Value::as_str) {
                                    entry.2.push_str(a);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut parts = Vec::new();
    if !merged_text.is_empty() {
        parts.push(json!({ "text": merged_text }));
    } else if !reasoning_text.is_empty() {
        parts.push(json!({ "text": reasoning_text }));
    }

    for (idx, (id, name, args_str)) in tool_calls_map {
        let call_id = if id.is_empty() {
            format!("call_{}", idx + 1)
        } else {
            id
        };
        let call_name = if name.is_empty() {
            "tool".to_string()
        } else {
            name
        };
        let parsed_args: Value = serde_json::from_str(&args_str).unwrap_or_else(|_| json!({}));
        parts.push(json!({
            "functionCall": {
                "id": call_id,
                "name": call_name,
                "args": parsed_args
            }
        }));
    }

    json!({
        "content": {
            "role": "model",
            "parts": parts
        },
        "finishReason": finish_reason,
        "usageMetadata": {
            "promptTokenCount": prompt_tokens,
            "candidatesTokenCount": completion_tokens,
            "totalTokenCount": total_tokens
        },
        "customMetadata": {
            "model_name": model_name,
            "bridge": "ai-helper"
        },
        "turnComplete": true,
        "partial": false
    })
}

/// 格式化单帧 Accio SSE 输出
pub fn format_accio_sse(frame: &Value) -> String {
    format!(
        "data: {}\n\n",
        serde_json::to_string(frame).unwrap_or_default()
    )
}

/// 心跳包注释帧
pub const SSE_HEARTBEAT: &str = ": ai-helper heartbeat\n\n";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compact_tool_content_small() {
        let small = "hello world";
        assert_eq!(compact_tool_content(small, 100), small);
    }

    #[test]
    fn test_compact_tool_content_large() {
        let long_str = "A".repeat(1000);
        let compacted = compact_tool_content(&long_str, 200);
        assert!(compacted.contains("AI-Helper 中继：中间内容已裁剪"));
        assert!(compacted.starts_with("AAA"));
        assert!(compacted.ends_with("AAA"));
    }

    #[test]
    fn test_accio_to_openai_translation() {
        let input = json!({
            "model": "auto",
            "systemInstruction": {
                "parts": [{ "text": "You are a helpful AI assistant" }]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        { "text": "What is the weather?" }
                    ]
                },
                {
                    "role": "model",
                    "parts": [
                        {
                            "functionCall": {
                                "id": "call_123",
                                "name": "get_weather",
                                "args": { "city": "Hangzhou" }
                            }
                        }
                    ]
                },
                {
                    "role": "function",
                    "parts": [
                        {
                            "functionResponse": {
                                "id": "call_123",
                                "name": "get_weather",
                                "response": { "temperature": "25C" }
                            }
                        }
                    ]
                }
            ],
            "tools": [
                {
                    "functionDeclarations": [
                        {
                            "name": "get_weather",
                            "description": "Get current weather",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "city": { "type": "string" }
                                }
                            }
                        }
                    ]
                }
            ]
        });

        let openai_req = accio_to_openai(&input, "claude-3-7-sonnet");
        assert_eq!(openai_req["model"], "claude-3-7-sonnet");

        let messages = openai_req["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[3]["role"], "tool");

        let tools = openai_req["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["function"]["name"], "get_weather");
    }

    #[test]
    fn test_merge_openai_chunks() {
        let chunks = vec![
            json!({
                "model": "claude-3-7-sonnet",
                "choices": [{
                    "delta": { "content": "Hello " }
                }]
            }),
            json!({
                "choices": [{
                    "delta": { "content": "World!" },
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15
                }
            }),
        ];

        let merged = merge_openai_chunks(&chunks);
        assert_eq!(merged["turnComplete"], true);
        assert_eq!(merged["finishReason"], "STOP");
        let parts = merged["content"]["parts"].as_array().expect("parts");
        assert_eq!(parts[0]["text"], "Hello World!");
        assert_eq!(merged["usageMetadata"]["totalTokenCount"], 15);
    }

    #[test]
    fn test_extract_requested_model_and_flat_tools() {
        let input = json!({
            "modelCode": "deepseek-r1",
            "contents": [{
                "role": "user",
                "parts": [{ "text": "Run query" }]
            }],
            "tools": [
                {
                    "name": "sql_query",
                    "description": "Execute SQL",
                    "parameters": {
                        "type": "object",
                        "properties": { "q": { "type": "string" } }
                    }
                }
            ]
        });

        let req = accio_to_openai(&input, "default-model");
        assert_eq!(req["model"], "deepseek-r1");
        let tools = req["tools"].as_array().expect("tools");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["function"]["name"], "sql_query");
    }

    #[test]
    fn test_is_image_output_request() {
        let text_input = json!({
            "generationConfig": {
                "responseModalities": ["TEXT"]
            }
        });
        assert!(!is_image_output_request(&text_input));

        let image_input = json!({
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"]
            }
        });
        assert!(is_image_output_request(&image_input));

        let proto_input = json!({
            "properties": {
                "generationConfig": "{\"responseModalities\":[\"IMAGE\"]}"
            }
        });
        assert!(is_image_output_request(&proto_input));
    }
}

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
                    let parameters_raw = declaration
                        .get("parameters")
                        .or_else(|| declaration.get("parametersJson"))
                        .or_else(|| declaration.get("parameters_json"))
                        .cloned()
                        .unwrap_or_else(|| json!({"type":"object","properties":{}}));
                    // 若 parameters 字段实际是 JSON 字符串（如 parametersJson），则解析为对象
                    // 避免上游 API 报 "expected an object, but got a string"
                    let parameters = if let Some(s) = parameters_raw.as_str() {
                        serde_json::from_str(s)
                            .unwrap_or_else(|_| json!({"type":"object","properties":{}}))
                    } else {
                        parameters_raw
                    };
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

    // 模型选择：始终使用 AI-Helper 配置的模型，防止 Accio Work 客户端携带的内部混淆模型名透传
    let requested = extract_requested_model(input, default_model);
    if requested != default_model {
        log::warn!(
            "Accio 请求携带模型名 '{}' 与配置模型 '{}' 不同，已强制使用配置模型",
            requested,
            default_model
        );
    }
    let selected_model = default_model;

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
#[allow(dead_code)]
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
                    } else if let Some(arr) = d.get("content").and_then(Value::as_array) {
                        // Claude API 代理可能返回 content: [{type: "text", text: "..."}] 数组格式
                        for item in arr {
                            if let Some(t) = item.get("text").and_then(Value::as_str) {
                                merged_text.push_str(t);
                            }
                        }
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
                "args": parsed_args,
                "argsJson": args_str
            }
        }));
    }

    if parts.is_empty() {
        parts.push(json!({ "text": "（模型未输出可展示的正文内容）" }));
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

/// API 端点类型，根据模型名称自动路由
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApiEndpoint {
    /// /v1/chat/completions - OpenAI 标准 Chat 端点 (国产模型、通用兼容模型)
    ChatCompletions,
    /// /v1/responses - OpenAI 新版 Responses 端点 (GPT 系列)
    #[allow(dead_code)]
    Responses,
    /// /v1/messages - Anthropic Messages 端点 (Claude 系列)
    Messages,
}

impl ApiEndpoint {
    pub fn path(&self) -> &'static str {
        match self {
            Self::ChatCompletions => "/v1/chat/completions",
            Self::Responses => "/v1/responses",
            Self::Messages => "/v1/messages",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::ChatCompletions => "chat/completions",
            Self::Responses => "responses",
            Self::Messages => "messages",
        }
    }
}

/// 根据模型名称自动检测应使用的 API 端点
pub fn detect_api_endpoint(model: &str) -> ApiEndpoint {
    let lower = model.to_lowercase();
    if lower.contains("claude") {
        ApiEndpoint::Messages
    } else if lower.contains("gpt")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4")
        || lower.starts_with("chatgpt")
    {
        ApiEndpoint::Responses
    } else {
        ApiEndpoint::ChatCompletions
    }
}

/// 辅助函数：将 Value 内容标准化为 Anthropic content block 数组
fn normalize_anthropic_blocks(val: &Value) -> Vec<Value> {
    match val {
        Value::String(s) => {
            if s.is_empty() {
                Vec::new()
            } else {
                vec![json!({"type": "text", "text": s})]
            }
        }
        Value::Array(arr) => arr.clone(),
        Value::Null => Vec::new(),
        other => vec![json!({"type": "text", "text": other.to_string()})],
    }
}

/// 递归将 JSON Schema 中的大写类型转换为 Anthropic 接受的标准小写类型 (如 OBJECT -> object)
fn normalize_schema_types(schema: &mut Value) {
    if let Some(obj) = schema.as_object_mut() {
        if let Some(t) = obj.get_mut("type") {
            if let Some(s) = t.as_str() {
                *t = json!(s.to_lowercase());
            }
        }
        if let Some(props) = obj.get_mut("properties").and_then(Value::as_object_mut) {
            for (_, prop) in props.iter_mut() {
                normalize_schema_types(prop);
            }
        }
        if let Some(items) = obj.get_mut("items") {
            normalize_schema_types(items);
        }
    }
}

/// 将 accio_to_openai 输出的 Chat Completions 请求体转换为 Anthropic /v1/messages 请求格式
pub fn chat_to_anthropic_body(chat_body: &Value) -> Value {
    let empty = vec![];
    let messages = chat_body["messages"].as_array().unwrap_or(&empty);

    let mut system_text: Option<String> = None;
    let mut anthropic_messages: Vec<Value> = Vec::new();

    let mut i = 0;
    while i < messages.len() {
        let msg = &messages[i];
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("user");

        match role {
            "system" => {
                if let Some(c) = msg.get("content").and_then(Value::as_str) {
                    system_text = Some(c.to_string());
                }
            }
            "assistant" => {
                if let Some(tool_calls) = msg.get("tool_calls").and_then(Value::as_array) {
                    let mut content_blocks: Vec<Value> = Vec::new();
                    if let Some(text) = msg.get("content").and_then(Value::as_str) {
                        if !text.is_empty() {
                            content_blocks.push(json!({"type": "text", "text": text}));
                        }
                    }
                    for tc in tool_calls {
                        let id = tc.get("id").and_then(Value::as_str).unwrap_or("call_1");
                        if let Some(func) = tc.get("function") {
                            let name = func.get("name").and_then(Value::as_str).unwrap_or("tool");
                            let args_str = func
                                .get("arguments")
                                .and_then(Value::as_str)
                                .unwrap_or("{}");
                            let input: Value =
                                serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
                            content_blocks.push(json!({
                                "type": "tool_use",
                                "id": id,
                                "name": name,
                                "input": input
                            }));
                        }
                    }
                    if content_blocks.is_empty() {
                        content_blocks.push(json!({"type": "text", "text": ""}));
                    }
                    anthropic_messages
                        .push(json!({"role": "assistant", "content": content_blocks}));
                } else {
                    anthropic_messages.push(json!({
                        "role": "assistant",
                        "content": msg.get("content").cloned().unwrap_or(json!(""))
                    }));
                }
            }
            "tool" => {
                // Anthropic 要求 tool_result 放在 role=user 消息中
                let mut tool_results: Vec<Value> = Vec::new();
                while i < messages.len() {
                    let tmsg = &messages[i];
                    if tmsg.get("role").and_then(Value::as_str) != Some("tool") {
                        break;
                    }
                    let tool_call_id = tmsg
                        .get("tool_call_id")
                        .and_then(Value::as_str)
                        .unwrap_or("call_1");
                    let content = match tmsg.get("content") {
                        Some(Value::String(s)) => s.clone(),
                        Some(other) => other.to_string(),
                        None => String::new(),
                    };
                    tool_results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": content
                    }));
                    i += 1;
                }
                anthropic_messages.push(json!({"role": "user", "content": tool_results}));
                continue;
            }
            _ => {
                anthropic_messages.push(json!({
                    "role": "user",
                    "content": msg.get("content").cloned().unwrap_or(json!(""))
                }));
            }
        }

        i += 1;
    }

    // Anthropic 要求消息角色必须交替，合并连续同角色消息
    // 注意：合并时必须按 Content Block 数组追加合并，切勿用 as_str() 导致 tool_use / tool_result 被清空为 "\n"
    let mut merged: Vec<Value> = Vec::new();
    for msg in anthropic_messages {
        let role = msg
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user")
            .to_string();
        let last_role = merged
            .last()
            .and_then(|m: &Value| m.get("role").and_then(Value::as_str))
            .map(|s| s.to_string());

        if last_role.as_deref() == Some(&role) {
            if let Some(last) = merged.last_mut() {
                let mut blocks = normalize_anthropic_blocks(&last["content"]);
                let new_blocks = normalize_anthropic_blocks(&msg["content"]);
                blocks.extend(new_blocks);
                last["content"] = Value::Array(blocks);
            }
        } else {
            merged.push(msg);
        }
    }

    // Anthropic 官方规范要求首条消息必须是 user，且 messages 不可为空
    if merged.is_empty() {
        merged.push(json!({"role": "user", "content": "Hello"}));
    } else if merged
        .first()
        .and_then(|m| m.get("role"))
        .and_then(Value::as_str)
        == Some("assistant")
    {
        merged.insert(0, json!({"role": "user", "content": "Hello"}));
    }

    let mut body = json!({
        "model": chat_body.get("model").cloned().unwrap_or_else(|| json!("")),
        "messages": merged,
        "max_tokens": chat_body.get("max_tokens").cloned().unwrap_or(json!(8192)),
        "stream": false
    });

    if let Some(sys) = system_text {
        body["system"] = json!(sys);
    }
    if let Some(temp) = chat_body.get("temperature") {
        body["temperature"] = temp.clone();
    }

    // OpenAI tools 格式 → Anthropic tools 格式 (递归规范化小写 Schema 类型)
    if let Some(tools) = chat_body.get("tools").and_then(Value::as_array) {
        let anthropic_tools: Vec<Value> = tools
            .iter()
            .filter_map(|t| {
                let func = t.get("function")?;
                let mut schema = func
                    .get("parameters")
                    .cloned()
                    .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
                if !schema.is_object() {
                    schema = json!({"type": "object", "properties": {}});
                }
                normalize_schema_types(&mut schema);
                Some(json!({
                    "name": func.get("name").cloned().unwrap_or(json!("tool")),
                    "description": func.get("description").cloned().unwrap_or(json!("")),
                    "input_schema": schema
                }))
            })
            .collect();
        if !anthropic_tools.is_empty() {
            body["tools"] = json!(anthropic_tools);
        }
    }

    body
}

/// 解析 Anthropic /v1/messages 非流式 JSON 响应为 Accio Gemini 协议格式
pub fn parse_anthropic_response(json_val: &Value, default_model: &str) -> Value {
    let model_name = json_val
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(default_model);
    let mut parts: Vec<Value> = Vec::new();

    if let Some(content) = json_val.get("content").and_then(Value::as_array) {
        for block in content {
            match block.get("type").and_then(Value::as_str).unwrap_or("") {
                "text" => {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            parts.push(json!({"text": text}));
                        }
                    }
                }
                "tool_use" => {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or("call_1");
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let input = block.get("input").cloned().unwrap_or(json!({}));
                    let args_str =
                        serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
                    parts.push(json!({
                        "functionCall": {
                            "id": id,
                            "name": name,
                            "args": input,
                            "argsJson": args_str
                        }
                    }));
                }
                "thinking" => {
                    if let Some(text) = block.get("thinking").and_then(Value::as_str) {
                        if !text.is_empty() && !parts.iter().any(|p| p.get("text").is_some()) {
                            parts.push(json!({"text": text}));
                        }
                    }
                }
                _ => {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        parts.push(json!({"text": text}));
                    }
                }
            }
        }
    }

    // 防止 parts 为空导致 Accio Work 报“模型未返回可展示的内容，请重试。”
    if parts.is_empty() {
        parts.push(json!({
            "text": "（模型未输出可展示的正文内容）"
        }));
    }

    let usage = json_val.get("usage");
    let input_tokens = usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);

    let stop_reason = json_val
        .get("stop_reason")
        .and_then(Value::as_str)
        .unwrap_or("end_turn");
    let finish_reason = if stop_reason == "max_tokens" {
        "MAX_TOKENS"
    } else {
        "STOP"
    };

    json!({
        "content": {"role": "model", "parts": parts},
        "finishReason": finish_reason,
        "usageMetadata": {
            "promptTokenCount": input_tokens,
            "candidatesTokenCount": output_tokens,
            "totalTokenCount": input_tokens + output_tokens
        },
        "customMetadata": {"model_name": model_name, "bridge": "ai-helper"},
        "turnComplete": true,
        "partial": false
    })
}

/// 合并 Anthropic SSE 流式事件为 Accio Gemini 协议格式
pub fn merge_anthropic_sse(text: &str, default_model: &str) -> Value {
    let mut full_text = String::new();
    let mut tool_uses: Vec<(String, String, String)> = Vec::new(); // (id, name, input_json)
    let mut current_tool_input = String::new();
    let mut current_tool_idx: Option<usize> = None;
    let mut model_name = default_model.to_string();
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut stop_reason = "end_turn".to_string();

    for line in text.lines() {
        let trimmed = line.trim();
        let data = if let Some(d) = trimmed.strip_prefix("data:") {
            d.trim()
        } else {
            continue;
        };
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            continue;
        };

        // 检查是否为完整的非流式消息对象 (某些中转站在 SSE 中包裹完整响应)
        if chunk.get("type").and_then(Value::as_str) == Some("message")
            && chunk.get("content").and_then(Value::as_array).is_some()
        {
            return parse_anthropic_response(&chunk, default_model);
        }

        match chunk.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                if let Some(msg) = chunk.get("message") {
                    if let Some(m) = msg.get("model").and_then(Value::as_str) {
                        model_name = m.to_string();
                    }
                    if let Some(u) = msg.get("usage") {
                        input_tokens = u.get("input_tokens").and_then(Value::as_u64).unwrap_or(0);
                    }
                }
            }
            Some("content_block_start") => {
                if let Some(cb) = chunk.get("content_block") {
                    if cb.get("type").and_then(Value::as_str) == Some("tool_use") {
                        let id = cb
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("call_1")
                            .to_string();
                        let name = cb
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        tool_uses.push((id, name, String::new()));
                        current_tool_idx = Some(tool_uses.len() - 1);
                        current_tool_input.clear();
                    } else {
                        current_tool_idx = None;
                    }
                }
            }
            Some("content_block_delta") => {
                if let Some(delta) = chunk.get("delta") {
                    match delta.get("type").and_then(Value::as_str) {
                        Some("text_delta") => {
                            if let Some(t) = delta.get("text").and_then(Value::as_str) {
                                full_text.push_str(t);
                            }
                        }
                        Some("input_json_delta") => {
                            if let Some(partial) = delta.get("partial_json").and_then(Value::as_str)
                            {
                                current_tool_input.push_str(partial);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Some("content_block_stop") => {
                if let Some(idx) = current_tool_idx {
                    if idx < tool_uses.len() {
                        tool_uses[idx].2 = std::mem::take(&mut current_tool_input);
                    }
                }
                current_tool_idx = None;
            }
            Some("message_delta") => {
                if let Some(delta) = chunk.get("delta") {
                    if let Some(sr) = delta.get("stop_reason").and_then(Value::as_str) {
                        stop_reason = sr.to_string();
                    }
                }
                if let Some(usage) = chunk.get("usage") {
                    if let Some(ot) = usage.get("output_tokens").and_then(Value::as_u64) {
                        output_tokens = ot;
                    }
                }
            }
            _ => {}
        }
    }

    let mut parts = Vec::new();
    if !full_text.is_empty() {
        parts.push(json!({"text": full_text}));
    }
    for (id, name, input_str) in tool_uses {
        let input: Value = serde_json::from_str(&input_str).unwrap_or_else(|_| json!({}));
        parts.push(json!({
            "functionCall": {
                "id": id,
                "name": name,
                "args": input,
                "argsJson": input_str
            }
        }));
    }

    if parts.is_empty() {
        parts.push(json!({
            "text": "（模型未输出可展示的正文内容）"
        }));
    }

    let finish_reason = if stop_reason == "max_tokens" {
        "MAX_TOKENS"
    } else {
        "STOP"
    };

    json!({
        "content": {"role": "model", "parts": parts},
        "finishReason": finish_reason,
        "usageMetadata": {
            "promptTokenCount": input_tokens,
            "candidatesTokenCount": output_tokens,
            "totalTokenCount": input_tokens + output_tokens
        },
        "customMetadata": {"model_name": model_name, "bridge": "ai-helper"},
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
        // 修复后：始终使用配置的 default_model，不受请求体 modelCode 影响
        assert_eq!(req["model"], "default-model");
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

    #[test]
    fn test_detect_api_endpoint_routing() {
        assert_eq!(
            detect_api_endpoint("claude-sonnet-5"),
            ApiEndpoint::Messages
        );
        assert_eq!(
            detect_api_endpoint("claude-3-7-sonnet"),
            ApiEndpoint::Messages
        );
        assert_eq!(
            detect_api_endpoint("claude-3-5-haiku-20241022"),
            ApiEndpoint::Messages
        );
        // GPT / o1 / o3 保持路由至 Responses 端点
        assert_eq!(detect_api_endpoint("gpt-4o"), ApiEndpoint::Responses);
        assert_eq!(detect_api_endpoint("o1-preview"), ApiEndpoint::Responses);
        assert_eq!(detect_api_endpoint("o3-mini"), ApiEndpoint::Responses);
        assert_eq!(
            detect_api_endpoint("deepseek-chat"),
            ApiEndpoint::ChatCompletions
        );
        assert_eq!(
            detect_api_endpoint("qwen-max"),
            ApiEndpoint::ChatCompletions
        );
    }

    #[test]
    fn test_chat_to_anthropic_body_merges_without_data_loss() {
        let chat_body = json!({
            "model": "claude-sonnet-5",
            "messages": [
                { "role": "user", "content": "Please check files." },
                {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_123",
                        "type": "function",
                        "function": {
                            "name": "list_files",
                            "arguments": "{\"dir\":\"/\"}"
                        }
                    }]
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_123",
                    "content": "fileA.txt, fileB.txt"
                },
                {
                    "role": "user",
                    "content": "Also check /tmp."
                }
            ],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "list_files",
                    "description": "List files",
                    "parameters": {
                        "type": "OBJECT",
                        "properties": {
                            "dir": { "type": "STRING" }
                        }
                    }
                }
            }]
        });

        let anthropic_req = chat_to_anthropic_body(&chat_body);
        assert_eq!(anthropic_req["model"], "claude-sonnet-5");
        assert_eq!(anthropic_req["stream"], false);

        let msgs = anthropic_req["messages"].as_array().expect("messages");
        // user -> assistant -> user (merged: tool_result + text)
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0]["role"], "user");
        assert_eq!(msgs[1]["role"], "assistant");
        assert_eq!(msgs[2]["role"], "user");

        // 验证 tool_result 和后续 user text 在合并后均完整保留，没有被替换为 "\n"
        let user_blocks = msgs[2]["content"].as_array().expect("user content blocks");
        assert_eq!(user_blocks.len(), 2);
        assert_eq!(user_blocks[0]["type"], "tool_result");
        assert_eq!(user_blocks[0]["tool_use_id"], "call_123");
        assert_eq!(user_blocks[0]["content"], "fileA.txt, fileB.txt");
        assert_eq!(user_blocks[1]["type"], "text");
        assert_eq!(user_blocks[1]["text"], "Also check /tmp.");

        // 验证 tools input_schema 中的大写 OBJECT/STRING 被递归转为了小写
        let tools = anthropic_req["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 1);
        let schema = &tools[0]["input_schema"];
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"]["dir"]["type"], "string");
    }

    #[test]
    fn test_chat_to_anthropic_body_ensures_user_first() {
        let chat_body = json!({
            "model": "claude-sonnet-5",
            "messages": [
                { "role": "assistant", "content": "Welcome!" }
            ]
        });
        let anthropic_req = chat_to_anthropic_body(&chat_body);
        let msgs = anthropic_req["messages"].as_array().expect("messages");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["role"], "user");
        assert_eq!(msgs[1]["role"], "assistant");
    }

    #[test]
    fn test_parse_anthropic_response_empty_parts_fallback() {
        let empty_resp = json!({
            "id": "msg_empty",
            "type": "message",
            "role": "assistant",
            "content": [],
            "stop_reason": "end_turn"
        });
        let parsed = parse_anthropic_response(&empty_resp, "claude-sonnet-5");
        let parts = parsed["content"]["parts"].as_array().expect("parts");
        assert_eq!(parts.len(), 1);
        assert!(parts[0]["text"].as_str().unwrap().contains("未输出可展示"));
    }
}

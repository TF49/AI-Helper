use serde_json::{json, Value};

/// 最大请求体大小（15MB），防御超大请求体 DoS
pub const MAX_REQUEST_BODY_BYTES: usize = 15 * 1024 * 1024;
/// 最大文件内容字节数（50KB），防止超大文件导致请求体爆炸
pub const MAX_FILE_CONTENT_BYTES: usize = 50_000;
/// 最大代码块内容字节数（20KB）
pub const MAX_CODE_BLOCK_BYTES: usize = 20_000;
/// 最大项目规则内容字节数（30KB）
pub const MAX_RULE_CONTENT_BYTES: usize = 30_000;
/// 最大额外上下文单项字节数（50KB）
pub const MAX_EXTRA_CONTEXT_BYTES: usize = 50_000;
/// 上下文提取的最大规则条数
pub const MAX_RULES_COUNT: usize = 10;
/// 上下文提取的最大文件条数
pub const MAX_FILES_COUNT: usize = 20;
/// 上下文总字节数安全上限（200KB），防止下游模型上下文爆满
pub const MAX_TOTAL_CONTEXT_BYTES: usize = 200_000;
/// SSE 单行最大字节数（1MB），防止无换行符的恶意流
pub const MAX_SSE_LINE_BYTES: usize = 1024 * 1024;
/// 单次生成最大输出字节数（10MB），防止异常上游持续输出
pub const MAX_GENERATION_BYTES: usize = 10 * 1024 * 1024;

/// 转义 XML 标签属性（如 path="xxx"），避免注入破坏
pub fn sanitize_tag_attribute(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\n', " ")
        .replace('\r', "")
}

/// 转义内容中的闭合边界标签（如 </file>, </rule>, </code>, </selected_context>），防止标签逃逸伪造边界
pub fn sanitize_xml_delimiters(content: &str, tag_name: &str) -> String {
    let close_tag = format!("</{}>", tag_name);
    let escaped_close = format!("&lt;/{tag_name}&gt;");
    content.replace(&close_tag, &escaped_close)
}

/// 安全截断文本内容，若超过最大字节数则添加截断提示
pub fn truncate_with_ellipsis(content: &str, max_bytes: usize) -> String {
    if content.len() <= max_bytes {
        return content.to_string();
    }
    // 安全截断：确保不会在 UTF-8 字符中间切割
    let truncated = content
        .char_indices()
        .take_while(|(idx, _)| *idx < max_bytes)
        .map(|(_, c)| c)
        .collect::<String>();
    format!(
        "{}\n\n... [内容过大已截断，仅展示前 {} 字节] ...",
        truncated, max_bytes
    )
}

/// 编码底层 Connect-RPC 协议帧 (1字节标志 + 4字节大端长度 + 原始有效载荷)
pub fn encode_connect_frame_raw(flags: u8, payload: &[u8]) -> Vec<u8> {
    let len = payload.len() as u32;
    let mut buf = Vec::with_capacity(5 + payload.len());
    buf.push(flags);
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(payload);
    buf
}

/// 编码 Connect-RPC JSON 协议帧
#[allow(dead_code)]
pub fn encode_connect_frame(flags: u8, val: &Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(val).unwrap_or_default();
    encode_connect_frame_raw(flags, &json_bytes)
}

/// 核心 Protobuf 协议数据结构定义（基于 prost，原生兼容 Cursor Wire Protocol）
pub mod proto {
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct BidiRequestId {
        #[prost(string, tag = "1")]
        pub request_id: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct BidiAppendRequest {
        #[prost(string, tag = "1")]
        pub data: String,
        #[prost(message, optional, tag = "2")]
        pub request_id: Option<BidiRequestId>,
        #[prost(int64, tag = "3")]
        pub append_seqno: i64,
        #[prost(bytes = "vec", tag = "4")]
        pub data_binary: Vec<u8>,
    }

    #[allow(dead_code)]
    #[derive(Clone, Copy, PartialEq, ::prost::Message)]
    pub struct BidiAppendResponse {}

    #[allow(dead_code)]
    #[derive(Clone, Copy, PartialEq, ::prost::Message)]
    pub struct IsConnectedResponse {}

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct AgentClientMessage {
        #[prost(message, optional, tag = "1")]
        pub run_request: Option<AgentRunRequest>,
        #[prost(message, optional, tag = "4")]
        pub conversation_action: Option<ConversationAction>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct AgentRunRequest {
        #[prost(message, optional, tag = "2")]
        pub action: Option<ConversationAction>,
        #[prost(message, optional, tag = "3")]
        pub model_details: Option<ModelDetails>,
        #[prost(string, optional, tag = "5")]
        pub conversation_id: Option<String>,
        #[prost(message, optional, tag = "9")]
        pub requested_model: Option<RequestedModel>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ModelDetails {
        #[prost(string, tag = "1")]
        pub model: String,
        #[prost(string, tag = "3")]
        pub display_model_id: String,
        #[prost(string, tag = "4")]
        pub display_name: String,
        #[prost(string, tag = "5")]
        pub display_name_short: String,
        #[prost(string, repeated, tag = "6")]
        pub aliases: Vec<String>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct GetUsableModelsResponse {
        #[prost(message, repeated, tag = "1")]
        pub models: Vec<ModelDetails>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct GetDefaultModelForCliResponse {
        #[prost(message, optional, tag = "1")]
        pub model: Option<ModelDetails>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct AvailableModel {
        #[prost(string, tag = "1")]
        pub name: String,
        #[prost(bool, tag = "2")]
        pub default_on: bool,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct AvailableModelsResponse {
        #[prost(string, repeated, tag = "1")]
        pub model_names: Vec<String>,
        #[prost(message, repeated, tag = "2")]
        pub models: Vec<AvailableModel>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct RequestedModel {
        #[prost(string, tag = "1")]
        pub model_id: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationAction {
        #[prost(message, optional, tag = "1")]
        pub user_message_action: Option<UserMessageAction>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct UserMessageAction {
        #[prost(message, optional, tag = "1")]
        pub user_message: Option<UserMessage>,
        #[prost(message, optional, tag = "7")]
        pub conversation_history: Option<ConversationHistory>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistory {
        #[prost(message, repeated, tag = "1")]
        pub messages: Vec<ConversationHistoryMessage>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryMessage {
        #[prost(message, optional, tag = "1")]
        pub user: Option<ConversationHistoryUserMessage>,
        #[prost(message, optional, tag = "2")]
        pub assistant: Option<ConversationHistoryAssistantMessage>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryUserMessage {
        #[prost(message, repeated, tag = "1")]
        pub content: Vec<ConversationHistoryUserContent>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryUserContent {
        #[prost(message, optional, tag = "1")]
        pub text: Option<ConversationHistoryTextContent>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryAssistantMessage {
        #[prost(message, repeated, tag = "1")]
        pub content: Vec<ConversationHistoryAssistantContent>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryAssistantContent {
        #[prost(message, optional, tag = "1")]
        pub text: Option<ConversationHistoryTextContent>,
        #[prost(message, optional, tag = "2")]
        pub reasoning: Option<ConversationHistoryReasoningContent>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryTextContent {
        #[prost(string, tag = "1")]
        pub text: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ConversationHistoryReasoningContent {
        #[prost(string, tag = "1")]
        pub text: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct UserMessage {
        #[prost(string, tag = "1")]
        pub text: String,
        #[prost(string, tag = "2")]
        pub message_id: String,
        #[prost(message, optional, tag = "3")]
        pub selected_context: Option<SelectedContext>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct SelectedContext {
        #[prost(string, repeated, tag = "3")]
        pub extra_context: Vec<String>,
        #[prost(message, repeated, tag = "4")]
        pub files: Vec<SelectedFile>,
        #[prost(message, repeated, tag = "5")]
        pub code_selections: Vec<SelectedCodeSelection>,
        #[prost(message, repeated, tag = "10")]
        pub cursor_rules: Vec<SelectedCursorRule>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct SelectedFile {
        #[prost(string, tag = "1")]
        pub content: String,
        #[prost(string, tag = "2")]
        pub path: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct SelectedCodeSelection {
        #[prost(string, tag = "1")]
        pub content: String,
        #[prost(string, tag = "2")]
        pub path: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct SelectedCursorRule {
        #[prost(message, optional, tag = "1")]
        pub rule: Option<CursorRule>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct CursorRule {
        #[prost(string, tag = "1")]
        pub full_path: String,
        #[prost(string, tag = "2")]
        pub content: String,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct AgentServerMessage {
        #[prost(message, optional, tag = "1")]
        pub interaction_update: Option<InteractionUpdate>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct InteractionUpdate {
        #[prost(message, optional, tag = "1")]
        pub text_delta: Option<TextDeltaUpdate>,
        #[prost(message, optional, tag = "4")]
        pub thinking_delta: Option<ThinkingDeltaUpdate>,
        #[prost(message, optional, tag = "13")]
        pub heartbeat: Option<HeartbeatUpdate>,
        #[prost(message, optional, tag = "14")]
        pub turn_ended: Option<TurnEndedUpdate>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct HeartbeatUpdate {}

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct TurnEndedUpdate {
        #[prost(int64, optional, tag = "1")]
        pub input_tokens: Option<i64>,
        #[prost(int64, optional, tag = "2")]
        pub output_tokens: Option<i64>,
        #[prost(int64, optional, tag = "6")]
        pub ended_at_ms: Option<i64>,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct TextDeltaUpdate {
        #[prost(string, tag = "1")]
        pub text: String,
        #[prost(bool, tag = "2")]
        pub is_server_notice: bool,
    }

    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct ThinkingDeltaUpdate {
        #[prost(string, tag = "1")]
        pub text: String,
        #[prost(int32, optional, tag = "2")]
        pub thinking_style: Option<i32>,
    }

    // ========== 旧版 RPC 请求/响应消息（v0.3x 兼容） ==========

    /// 旧版 StreamChat 请求（Protobuf）
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamChatRequest {
        #[prost(string, tag = "1")]
        pub prompt: String,
        #[prost(string, optional, tag = "2")]
        pub model: Option<String>,
    }

    /// 旧版 StreamChat 响应（Protobuf）- text 是 tag 1 字符串
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamChatResponse {
        #[prost(string, tag = "1")]
        pub text: String,
    }

    /// 旧版 StreamComposer/StreamComposerIteration 请求（Protobuf）
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamComposerRequest {
        #[prost(string, tag = "1")]
        pub prompt: String,
        #[prost(string, optional, tag = "2")]
        pub model: Option<String>,
    }

    /// 旧版 StreamEdit 请求（Protobuf）
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamEditRequest {
        #[prost(string, tag = "1")]
        pub prompt: String,
        #[prost(string, optional, tag = "2")]
        pub model: Option<String>,
    }

    /// 旧版 StreamFastEdit 请求（Protobuf）
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamFastEditRequest {
        #[prost(string, tag = "1")]
        pub instruction: String,
        #[prost(string, tag = "2")]
        pub code: String,
        #[prost(string, optional, tag = "3")]
        pub model: Option<String>,
    }

    /// 旧版 StreamFastEdit 响应（Protobuf）- 有独立的 schema
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamFastEditResponse {
        #[prost(string, tag = "1")]
        pub edited_code: String,
    }

    /// 旧版 StreamGenerate 请求（Protobuf）
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct StreamGenerateRequest {
        #[prost(string, tag = "1")]
        pub prompt: String,
        #[prost(string, optional, tag = "2")]
        pub model: Option<String>,
    }

    /// GetDefaultModel 响应（Protobuf）- model 是 tag 1 字符串
    #[derive(Clone, PartialEq, ::prost::Message)]
    pub struct GetDefaultModelResponse {
        #[prost(string, tag = "1")]
        pub model: String,
    }
}

/// 创建 Connect-RPC Protobuf 格式的 Agent 文本增量帧 (适用于现代 Cursor RunSSE/Run 下行流)
pub fn create_agent_text_chunk(text: &str) -> Vec<u8> {
    use prost::Message;
    let msg = proto::AgentServerMessage {
        interaction_update: Some(proto::InteractionUpdate {
            text_delta: Some(proto::TextDeltaUpdate {
                text: text.to_string(),
                is_server_notice: false,
            }),
            thinking_delta: None,
            heartbeat: None,
            turn_ended: None,
        }),
    };
    let mut payload = Vec::with_capacity(32 + text.len());
    let _ = msg.encode(&mut payload);
    encode_connect_frame_raw(0x00, &payload)
}

/// 创建 Connect-RPC Protobuf 格式的 Agent 思考过程增量帧 (适用于 DeepSeek R1 / 推理模型)
pub fn create_agent_thinking_chunk(thinking: &str) -> Vec<u8> {
    use prost::Message;
    let msg = proto::AgentServerMessage {
        interaction_update: Some(proto::InteractionUpdate {
            text_delta: None,
            thinking_delta: Some(proto::ThinkingDeltaUpdate {
                text: thinking.to_string(),
                thinking_style: Some(0),
            }),
            heartbeat: None,
            turn_ended: None,
        }),
    };
    let mut payload = Vec::with_capacity(32 + thinking.len());
    let _ = msg.encode(&mut payload);
    encode_connect_frame_raw(0x00, &payload)
}

/// 创建 Connect-RPC Protobuf 格式的 Agent 心跳帧 (用于即时响应 Cursor 客户端握手，杜绝失联超时)
pub fn create_agent_heartbeat_chunk() -> Vec<u8> {
    use prost::Message;
    let msg = proto::AgentServerMessage {
        interaction_update: Some(proto::InteractionUpdate {
            text_delta: None,
            thinking_delta: None,
            heartbeat: Some(proto::HeartbeatUpdate {}),
            turn_ended: None,
        }),
    };
    let mut payload = Vec::with_capacity(16);
    let _ = msg.encode(&mut payload);
    encode_connect_frame_raw(0x00, &payload)
}

/// 创建 Connect-RPC JSON 格式的 Agent 心跳帧
pub fn create_agent_json_heartbeat_chunk() -> Vec<u8> {
    let payload = serde_json::json!({
        "interactionUpdate": {
            "heartbeat": {}
        }
    });
    encode_connect_frame(0x00, &payload)
}

/// 创建 Connect-RPC Protobuf 格式的 TurnEnded 结束标记帧
pub fn create_agent_turn_ended_chunk() -> Vec<u8> {
    use prost::Message;
    let msg = proto::AgentServerMessage {
        interaction_update: Some(proto::InteractionUpdate {
            text_delta: None,
            thinking_delta: None,
            heartbeat: None,
            turn_ended: Some(proto::TurnEndedUpdate {
                input_tokens: None,
                output_tokens: None,
                ended_at_ms: None,
            }),
        }),
    };
    let mut payload = Vec::with_capacity(16);
    let _ = msg.encode(&mut payload);
    encode_connect_frame_raw(0x00, &payload)
}

/// 创建 Connect-RPC JSON 格式的 Agent 文本增量帧
pub fn create_agent_json_text_chunk(text: &str) -> Vec<u8> {
    let payload = json!({
        "interactionUpdate": {
            "textDelta": {
                "text": text,
                "isServerNotice": false
            }
        }
    });
    encode_connect_frame(0x00, &payload)
}

/// 创建 Connect-RPC JSON 格式的 Agent 思考过程增量帧
pub fn create_agent_json_thinking_chunk(thinking: &str) -> Vec<u8> {
    let payload = json!({
        "interactionUpdate": {
            "thinkingDelta": {
                "text": thinking,
                "thinkingStyle": 0
            }
        }
    });
    encode_connect_frame(0x00, &payload)
}

/// 创建旧版 JSON 格式的 Connect-RPC 文本流式增量 Chunk 帧 (保持向后兼容 v0.3x)
pub fn create_connect_text_chunk(text: &str) -> Vec<u8> {
    let payload = json!({
        "text": text,
        "fullText": ""
    });
    encode_connect_frame(0x00, &payload)
}

/// 创建 Connect-RPC 成功结束帧 (Trailer: flags=0x02, payload={})
pub fn create_connect_end_frame() -> Vec<u8> {
    encode_connect_frame_raw(0x02, b"{}")
}

/// 创建 Connect-RPC 错误终止帧 (Trailer: flags=0x02, payload={"error": {"code": code, "message": msg}})
pub fn create_connect_error_frame(code: &str, msg: &str) -> Vec<u8> {
    let payload = json!({
        "error": {
            "code": code,
            "message": msg
        }
    });
    let json_bytes = serde_json::to_vec(&payload).unwrap_or_default();
    encode_connect_frame_raw(0x02, &json_bytes)
}

/// 创建 Connect-RPC 错误提示流 (根据 is_proto 发送对应文本增量帧与 Connect 错误尾帧)
pub fn create_connect_error_stream(msg: &str, is_proto: bool) -> Vec<u8> {
    let mut buf = if is_proto {
        create_agent_text_chunk(msg)
    } else {
        create_connect_text_chunk(msg)
    };
    buf.extend_from_slice(&create_connect_error_frame("unavailable", msg));
    buf
}

/// 编码 Protobuf 格式的 GetUsableModels 响应
pub fn encode_connect_usable_models_proto(custom_models: &[String]) -> Vec<u8> {
    use prost::Message;
    let models = custom_models
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
            proto::ModelDetails {
                model: m.clone(),
                display_model_id: m.clone(),
                display_name: display_name.clone(),
                display_name_short: display_name,
                aliases: vec![],
            }
        })
        .collect();
    let resp = proto::GetUsableModelsResponse { models };
    let mut buf = Vec::new();
    let _ = resp.encode(&mut buf);
    buf
}

/// 编码 Protobuf 格式的 GetDefaultModelForCli 响应（返回 ModelDetails 对象）
pub fn encode_connect_default_model_for_cli_proto(default_model: &str) -> Vec<u8> {
    use prost::Message;
    let display_name = format!("{} (AI-Helper)", default_model);
    let resp = proto::GetDefaultModelForCliResponse {
        model: Some(proto::ModelDetails {
            model: default_model.to_string(),
            display_model_id: default_model.to_string(),
            display_name: display_name.clone(),
            display_name_short: display_name,
            aliases: vec![],
        }),
    };
    let mut buf = Vec::new();
    let _ = resp.encode(&mut buf);
    buf
}

/// 编码 Protobuf 格式的 GetDefaultModel 响应（返回字符串）
pub fn encode_connect_default_model_proto(default_model: &str) -> Vec<u8> {
    use prost::Message;
    let resp = proto::GetDefaultModelResponse {
        model: default_model.to_string(),
    };
    let mut buf = Vec::new();
    let _ = resp.encode(&mut buf);
    buf
}

/// 解码旧版 Protobuf RPC 请求（StreamChat/StreamComposer/StreamEdit/StreamFastEdit/StreamGenerate）
pub fn decode_legacy_rpc_request(
    bytes: &[u8],
    rpc_method: &str,
) -> Option<(String, Option<String>)> {
    use prost::Message;

    // 剥离可能存在的 5 字节 Connect 前缀
    let payload_bytes = if bytes.len() >= 5 && bytes[0] == 0x00 {
        let len = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as usize;
        if bytes.len() >= 5 + len {
            &bytes[5..5 + len]
        } else {
            &bytes[5..]
        }
    } else {
        bytes
    };

    match rpc_method {
        "StreamChat" => {
            if let Ok(req) = proto::StreamChatRequest::decode(payload_bytes) {
                return Some((req.prompt, req.model));
            }
        }
        "StreamComposer" | "StreamComposerIteration" => {
            if let Ok(req) = proto::StreamComposerRequest::decode(payload_bytes) {
                return Some((req.prompt, req.model));
            }
        }
        "StreamEdit" => {
            if let Ok(req) = proto::StreamEditRequest::decode(payload_bytes) {
                return Some((req.prompt, req.model));
            }
        }
        "StreamFastEdit" => {
            if let Ok(req) = proto::StreamFastEditRequest::decode(payload_bytes) {
                let prompt = format!("Instruction: {}\n\nCode:\n{}", req.instruction, req.code);
                return Some((prompt, req.model));
            }
        }
        "StreamGenerate" => {
            if let Ok(req) = proto::StreamGenerateRequest::decode(payload_bytes) {
                return Some((req.prompt, req.model));
            }
        }
        _ => {}
    }

    None
}

/// 创建旧版 StreamChat/Composer/Edit 响应帧（Protobuf）
pub fn create_legacy_chat_response_chunk(text: &str) -> Vec<u8> {
    use prost::Message;
    let msg = proto::StreamChatResponse {
        text: text.to_string(),
    };
    let mut payload = Vec::with_capacity(16 + text.len());
    let _ = msg.encode(&mut payload);
    encode_connect_frame_raw(0x00, &payload)
}

/// 创建旧版 StreamFastEdit 响应帧（Protobuf）
pub fn create_legacy_fast_edit_response_chunk(edited_code: &str) -> Vec<u8> {
    use prost::Message;
    let msg = proto::StreamFastEditResponse {
        edited_code: edited_code.to_string(),
    };
    let mut payload = Vec::with_capacity(16 + edited_code.len());
    let _ = msg.encode(&mut payload);
    encode_connect_frame_raw(0x00, &payload)
}

/// 为旧版 Protobuf RPC 创建匹配的错误响应（空响应 + Connect 错误帧）
pub fn create_legacy_rpc_error(rpc_method: &str, error_msg: &str) -> Vec<u8> {
    // 对于旧版 RPC，发送一个空的数据响应，然后是 Connect 错误终止帧
    // 这样客户端可以正确解码响应类型，而不会因为收到 AgentServerMessage 而失败
    match rpc_method {
        "StreamChat" | "StreamComposer" | "StreamComposerIteration" | "StreamGenerate" => {
            // 先发送一个空文本响应
            let mut buf = create_legacy_chat_response_chunk("");
            // 然后追加 Connect 错误终止帧
            buf.extend_from_slice(&create_connect_error_frame("unavailable", error_msg));
            buf
        }
        "StreamFastEdit" => {
            // 先发送一个空代码响应
            let mut buf = create_legacy_fast_edit_response_chunk("");
            // 然后追加 Connect 错误终止帧
            buf.extend_from_slice(&create_connect_error_frame("unavailable", error_msg));
            buf
        }
        "StreamEdit" => {
            // StreamEdit 使用与 StreamChat 相同的响应结构
            let mut buf = create_legacy_chat_response_chunk("");
            buf.extend_from_slice(&create_connect_error_frame("unavailable", error_msg));
            buf
        }
        _ => {
            // 未知的 RPC，只返回 Connect 错误帧
            create_connect_error_frame("unavailable", error_msg).to_vec()
        }
    }
}

/// 编码 Protobuf 格式的 AvailableModels 响应
pub fn encode_connect_available_models_proto(custom_models: &[String]) -> Vec<u8> {
    use prost::Message;
    let models = custom_models
        .iter()
        .map(|m| proto::AvailableModel {
            name: m.clone(),
            default_on: true,
        })
        .collect();
    let resp = proto::AvailableModelsResponse {
        model_names: custom_models.to_vec(),
        models,
    };
    let mut buf = Vec::new();
    let _ = resp.encode(&mut buf);
    buf
}

/// 自动解压 GZIP 负载（若包含 1f 8b 魔数）
pub fn decompress_gzip_if_needed(data: &[u8]) -> Vec<u8> {
    use flate2::read::GzDecoder;
    use std::io::Read;

    if data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b {
        let mut decoder = GzDecoder::new(data);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() && !decompressed.is_empty() {
            return decompressed;
        }
    }
    data.to_vec()
}

/// 解析 Connect-RPC 帧负载，若 flag 标记或内部数据为 GZIP 压缩则自动解压
pub fn unpack_connect_frame_payload(flag: u8, payload: &[u8]) -> Vec<u8> {
    use flate2::read::GzDecoder;
    use std::io::Read;

    // Connect-RPC 规范：flag 第 0 位为 1 表示压缩帧 (通常为 gzip)
    if (flag & 0x01) != 0 {
        let mut decoder = GzDecoder::new(payload);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() && !decompressed.is_empty() {
            return decompressed;
        }
    }
    // 即使 flag 未显式标记，也检测是否包含 GZIP 魔数
    if payload.len() >= 2 && payload[0] == 0x1f && payload[1] == 0x8b {
        let mut decoder = GzDecoder::new(payload);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() && !decompressed.is_empty() {
            return decompressed;
        }
    }
    payload.to_vec()
}

/// 解包 Connect-RPC 请求体 (若包含 5 字节前缀则剥离，直接返回 JSON Value)
pub fn decode_connect_or_json(bytes: &[u8]) -> Option<Value> {
    if bytes.is_empty() {
        return None;
    }
    let decompressed = decompress_gzip_if_needed(bytes);
    let slice = decompressed.as_slice();

    if slice.len() >= 5 {
        let flag = slice[0];
        let len = u32::from_be_bytes([slice[1], slice[2], slice[3], slice[4]]) as usize;
        let payload = if slice.len() >= 5 + len {
            &slice[5..5 + len]
        } else {
            &slice[5..]
        };
        let unpacked = unpack_connect_frame_payload(flag, payload);
        if let Ok(v) = serde_json::from_slice::<Value>(&unpacked) {
            return Some(v);
        }
    }

    // 尝试作为普通 JSON 解析
    serde_json::from_slice::<Value>(slice).ok()
}

/// 解析上行的 BidiAppend 请求消息内容
#[derive(Clone, Debug, Default)]
pub struct DecodedBidiMessage {
    pub request_id: String,
    pub seqno: i64,
    pub user_text: String,
    pub model: Option<String>,
    #[allow(dead_code)]
    pub conversation_id: Option<String>,
    /// 多轮历史对话 [(role, text)]，例如 ("user", "..."), ("assistant", "...")
    pub history: Vec<(String, String)>,
    /// 附加的上下文文件 [(path, content)]
    pub context_files: Vec<(String, String)>,
    /// 附加的代码选中片段 [(path, content)]
    pub context_codes: Vec<(String, String)>,
    /// 附加的 Cursor Rules [(path, content)]
    pub context_rules: Vec<(String, String)>,
    /// 额外的文本上下文
    pub extra_context: Vec<String>,
}

/// 解析 AgentRunRequest 核心内容（提取历史对话、用户消息与工作区上下文）
pub fn parse_agent_run_request(
    run_req: proto::AgentRunRequest,
    request_id: String,
    seqno: i64,
) -> DecodedBidiMessage {
    let conversation_id = run_req.conversation_id;
    let model = run_req
        .requested_model
        .map(|m| m.model_id)
        .filter(|m| !m.is_empty())
        .or_else(|| {
            run_req
                .model_details
                .map(|m| m.model)
                .filter(|m| !m.is_empty())
        });

    let mut user_text = String::new();
    let mut history = Vec::new();
    let mut context_files = Vec::new();
    let mut context_codes = Vec::new();
    let mut context_rules = Vec::new();
    let mut extra_context = Vec::new();

    if let Some(action) = run_req.action {
        if let Some(user_action) = action.user_message_action {
            // 1. 提取多轮历史对话
            if let Some(hist) = user_action.conversation_history {
                for item in hist.messages {
                    if let Some(u) = item.user {
                        let mut combined = String::new();
                        for c in u.content {
                            if let Some(t) = c.text {
                                if !t.text.is_empty() {
                                    if !combined.is_empty() {
                                        combined.push('\n');
                                    }
                                    combined.push_str(&t.text);
                                }
                            }
                        }
                        if !combined.is_empty() {
                            history.push(("user".to_string(), combined));
                        }
                    }
                    if let Some(a) = item.assistant {
                        let mut combined = String::new();
                        for c in a.content {
                            if let Some(t) = c.text {
                                if !t.text.is_empty() {
                                    if !combined.is_empty() {
                                        combined.push('\n');
                                    }
                                    combined.push_str(&t.text);
                                }
                            }
                            if let Some(r) = c.reasoning {
                                if !r.text.is_empty() {
                                    if !combined.is_empty() {
                                        combined.push('\n');
                                    }
                                    combined
                                        .push_str(&format!("<thinking>\n{}\n</thinking>", r.text));
                                }
                            }
                        }
                        if !combined.is_empty() {
                            history.push(("assistant".to_string(), combined));
                        }
                    }
                }
            }

            // 2. 提取当前轮次用户输入及 SelectedContext (带安全上限保护)
            if let Some(u_msg) = user_action.user_message {
                user_text = u_msg.text;

                if let Some(sel) = u_msg.selected_context {
                    let mut total_context_bytes = 0usize;

                    for f in sel.files.into_iter().take(MAX_FILES_COUNT) {
                        if !f.path.is_empty() {
                            let truncated =
                                truncate_with_ellipsis(&f.content, MAX_FILE_CONTENT_BYTES);
                            let entry_size = f.path.len() + truncated.len();
                            if total_context_bytes + entry_size > MAX_TOTAL_CONTEXT_BYTES {
                                break;
                            }
                            total_context_bytes += entry_size;
                            context_files.push((f.path, truncated));
                        }
                    }
                    for c in sel.code_selections.into_iter().take(MAX_FILES_COUNT) {
                        if !c.path.is_empty() {
                            let truncated =
                                truncate_with_ellipsis(&c.content, MAX_CODE_BLOCK_BYTES);
                            let entry_size = c.path.len() + truncated.len();
                            if total_context_bytes + entry_size > MAX_TOTAL_CONTEXT_BYTES {
                                break;
                            }
                            total_context_bytes += entry_size;
                            context_codes.push((c.path, truncated));
                        }
                    }
                    for r in sel.cursor_rules.into_iter().take(MAX_RULES_COUNT) {
                        if let Some(rule) = r.rule {
                            if !rule.full_path.is_empty() && !rule.content.is_empty() {
                                let truncated =
                                    truncate_with_ellipsis(&rule.content, MAX_RULE_CONTENT_BYTES);
                                let entry_size = rule.full_path.len() + truncated.len();
                                if total_context_bytes + entry_size > MAX_TOTAL_CONTEXT_BYTES {
                                    break;
                                }
                                total_context_bytes += entry_size;
                                context_rules.push((rule.full_path, truncated));
                            }
                        }
                    }
                    for ex in sel.extra_context.into_iter().take(20) {
                        if !ex.trim().is_empty() {
                            let truncated = truncate_with_ellipsis(&ex, MAX_EXTRA_CONTEXT_BYTES);
                            if total_context_bytes + truncated.len() > MAX_TOTAL_CONTEXT_BYTES {
                                break;
                            }
                            total_context_bytes += truncated.len();
                            extra_context.push(truncated);
                        }
                    }
                }
            }
        }
    }

    DecodedBidiMessage {
        request_id,
        seqno,
        user_text,
        model,
        conversation_id,
        history,
        context_files,
        context_codes,
        context_rules,
        extra_context,
    }
}

/// 解码现代 Cursor AgentService/Run 双向流中的 AgentClientMessage
pub fn decode_agent_client_message(bytes: &[u8]) -> Option<DecodedBidiMessage> {
    use prost::Message;
    let decompressed = decompress_gzip_if_needed(bytes);
    let slice = decompressed.as_slice();

    let payload_bytes = if slice.len() >= 5 {
        let flag = slice[0];
        let len = u32::from_be_bytes([slice[1], slice[2], slice[3], slice[4]]) as usize;
        let p = if slice.len() >= 5 + len {
            &slice[5..5 + len]
        } else {
            &slice[5..]
        };
        unpack_connect_frame_payload(flag, p)
    } else {
        slice.to_vec()
    };

    if let Ok(client_msg) = proto::AgentClientMessage::decode(payload_bytes.as_slice()) {
        if let Some(run_req) = client_msg.run_request {
            let req_id = run_req
                .conversation_id
                .clone()
                .unwrap_or_else(|| "run_client_req".to_string());
            return Some(parse_agent_run_request(run_req, req_id, 0));
        }
        if let Some(action) = client_msg.conversation_action {
            let run_req = proto::AgentRunRequest {
                action: Some(action),
                ..Default::default()
            };
            return Some(parse_agent_run_request(
                run_req,
                "run_client_req".to_string(),
                0,
            ));
        }
    }
    if let Ok(run_req) = proto::AgentRunRequest::decode(payload_bytes.as_slice()) {
        if run_req.action.is_some() {
            let req_id = run_req
                .conversation_id
                .clone()
                .unwrap_or_else(|| "run_client_req".to_string());
            return Some(parse_agent_run_request(run_req, req_id, 0));
        }
    }
    None
}

/// 单个负载块的尝试解析
fn decode_single_bidi_append_payload(payload_bytes: &[u8]) -> Option<DecodedBidiMessage> {
    use base64::Engine;
    use prost::Message;

    // 1. 优先尝试作为 Protobuf BidiAppendRequest 解包
    if let Ok(req) = proto::BidiAppendRequest::decode(payload_bytes) {
        let request_id = req
            .request_id
            .map(|r| r.request_id)
            .filter(|id| !id.is_empty())
            .unwrap_or_default();

        // 获取 client_bytes (data 可能是 hex、base64 或 raw bytes；data_binary 为二进制)
        let mut client_bytes: Option<Vec<u8>> = if !req.data.is_empty() {
            if let Ok(hex_bytes) = hex::decode(req.data.trim()) {
                Some(hex_bytes)
            } else if let Ok(b64) =
                base64::engine::general_purpose::STANDARD.decode(req.data.trim())
            {
                Some(b64)
            } else {
                Some(req.data.as_bytes().to_vec())
            }
        } else if !req.data_binary.is_empty() {
            Some(req.data_binary)
        } else {
            None
        };

        // 如果 client_bytes 自身包含 GZIP，进行解压
        if let Some(ref b) = client_bytes {
            if b.len() >= 2 && b[0] == 0x1f && b[1] == 0x8b {
                client_bytes = Some(decompress_gzip_if_needed(b));
            }
        }

        if let Some(ref c_bytes) = client_bytes {
            // 尝试作为 AgentClientMessage 解包
            if let Ok(client_msg) = proto::AgentClientMessage::decode(c_bytes.as_slice()) {
                if let Some(run_req) = client_msg.run_request {
                    return Some(parse_agent_run_request(
                        run_req,
                        request_id,
                        req.append_seqno,
                    ));
                }
                if let Some(action) = client_msg.conversation_action {
                    let run_req = proto::AgentRunRequest {
                        action: Some(action),
                        ..Default::default()
                    };
                    return Some(parse_agent_run_request(
                        run_req,
                        request_id,
                        req.append_seqno,
                    ));
                }
            }
            // 尝试直接作为 AgentRunRequest 解包
            if let Ok(run_req) = proto::AgentRunRequest::decode(c_bytes.as_slice()) {
                if run_req.action.is_some() || run_req.requested_model.is_some() {
                    return Some(parse_agent_run_request(
                        run_req,
                        request_id,
                        req.append_seqno,
                    ));
                }
            }
        }

        if !request_id.is_empty() {
            return Some(DecodedBidiMessage {
                request_id,
                seqno: req.append_seqno,
                user_text: String::new(),
                model: None,
                conversation_id: None,
                history: Vec::new(),
                context_files: Vec::new(),
                context_codes: Vec::new(),
                context_rules: Vec::new(),
                extra_context: Vec::new(),
            });
        }
    }

    // 2. 尝试直接作为 AgentClientMessage 解包
    if let Ok(client_msg) = proto::AgentClientMessage::decode(payload_bytes) {
        if let Some(run_req) = client_msg.run_request {
            let req_id = run_req.conversation_id.clone().unwrap_or_default();
            return Some(parse_agent_run_request(run_req, req_id, 0));
        }
        if let Some(action) = client_msg.conversation_action {
            let run_req = proto::AgentRunRequest {
                action: Some(action),
                ..Default::default()
            };
            return Some(parse_agent_run_request(run_req, String::new(), 0));
        }
    }

    // 3. 尝试直接作为 AgentRunRequest 解包
    if let Ok(run_req) = proto::AgentRunRequest::decode(payload_bytes) {
        if run_req.action.is_some() {
            let req_id = run_req.conversation_id.clone().unwrap_or_default();
            return Some(parse_agent_run_request(run_req, req_id, 0));
        }
    }

    // 4. 尝试作为 JSON 解包
    if let Ok(val) = serde_json::from_slice::<Value>(payload_bytes) {
        let request_id = val
            .get("requestId")
            .or_else(|| val.get("request_id"))
            .and_then(|r| {
                if let Some(s) = r.as_str() {
                    Some(s.to_string())
                } else {
                    r.get("requestId")
                        .or_else(|| r.get("request_id"))
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string())
                }
            })
            .unwrap_or_default();

        let user_text = val
            .get("text")
            .or_else(|| val.get("message"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let model = val
            .get("model")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string());

        let mut history = Vec::new();
        if let Some(history_val) = val
            .get("conversationHistory")
            .or_else(|| val.get("conversation_history"))
        {
            if let Some(msgs) = history_val.get("messages").and_then(|m| m.as_array()) {
                for msg in msgs {
                    if let Some(role) = msg.get("role").and_then(|r| r.as_str()) {
                        let content = msg
                            .get("content")
                            .and_then(|c| c.as_str())
                            .unwrap_or_default();
                        if !content.is_empty() {
                            history.push((role.to_string(), content.to_string()));
                        }
                    }
                }
            }
        }

        let mut context_files = Vec::new();
        let mut context_codes = Vec::new();
        let mut context_rules = Vec::new();
        let mut extra_context = Vec::new();
        let mut total_context_bytes = 0usize;

        if let Some(ctx_val) = val
            .get("selectedContext")
            .or_else(|| val.get("selected_context"))
        {
            if let Some(files) = ctx_val.get("files").and_then(|f| f.as_array()) {
                for f in files.iter().take(MAX_FILES_COUNT) {
                    if let (Some(path), Some(content)) = (
                        f.get("path").and_then(|p| p.as_str()),
                        f.get("content").and_then(|c| c.as_str()),
                    ) {
                        let truncated = truncate_with_ellipsis(content, MAX_FILE_CONTENT_BYTES);
                        let entry_size = path.len() + truncated.len();
                        if total_context_bytes + entry_size > MAX_TOTAL_CONTEXT_BYTES {
                            break;
                        }
                        total_context_bytes += entry_size;
                        context_files.push((path.to_string(), truncated));
                    }
                }
            }
            if let Some(codes) = ctx_val
                .get("codeSelections")
                .or_else(|| ctx_val.get("code_selections"))
                .and_then(|c| c.as_array())
            {
                for c in codes.iter().take(MAX_FILES_COUNT) {
                    if let (Some(path), Some(content)) = (
                        c.get("path").and_then(|p| p.as_str()),
                        c.get("content").and_then(|c| c.as_str()),
                    ) {
                        let truncated = truncate_with_ellipsis(content, MAX_CODE_BLOCK_BYTES);
                        let entry_size = path.len() + truncated.len();
                        if total_context_bytes + entry_size > MAX_TOTAL_CONTEXT_BYTES {
                            break;
                        }
                        total_context_bytes += entry_size;
                        context_codes.push((path.to_string(), truncated));
                    }
                }
            }
            if let Some(rules) = ctx_val
                .get("cursorRules")
                .or_else(|| ctx_val.get("cursor_rules"))
                .and_then(|r| r.as_array())
            {
                for r in rules.iter().take(MAX_RULES_COUNT) {
                    let rule_node = r.get("rule").unwrap_or(r);
                    if let (Some(path), Some(content)) = (
                        rule_node
                            .get("fullPath")
                            .or_else(|| rule_node.get("full_path"))
                            .and_then(|p| p.as_str()),
                        rule_node.get("content").and_then(|c| c.as_str()),
                    ) {
                        let truncated = truncate_with_ellipsis(content, MAX_RULE_CONTENT_BYTES);
                        let entry_size = path.len() + truncated.len();
                        if total_context_bytes + entry_size > MAX_TOTAL_CONTEXT_BYTES {
                            break;
                        }
                        total_context_bytes += entry_size;
                        context_rules.push((path.to_string(), truncated));
                    }
                }
            }
            if let Some(extras) = ctx_val
                .get("extraContext")
                .or_else(|| ctx_val.get("extra_context"))
                .and_then(|e| e.as_array())
            {
                for ex in extras.iter().take(20) {
                    if let Some(s) = ex.as_str() {
                        if !s.trim().is_empty() {
                            let truncated = truncate_with_ellipsis(s, MAX_EXTRA_CONTEXT_BYTES);
                            if total_context_bytes + truncated.len() > MAX_TOTAL_CONTEXT_BYTES {
                                break;
                            }
                            total_context_bytes += truncated.len();
                            extra_context.push(truncated);
                        }
                    }
                }
            }
        }

        let seqno = val
            .get("appendSeqno")
            .or_else(|| val.get("append_seqno"))
            .and_then(|s| s.as_i64())
            .unwrap_or(0);

        if !request_id.is_empty() || !user_text.is_empty() || !history.is_empty() {
            return Some(DecodedBidiMessage {
                request_id,
                seqno,
                user_text,
                model,
                conversation_id: None,
                history,
                context_files,
                context_codes,
                context_rules,
                extra_context,
            });
        }
    }

    None
}

/// 解码 Cursor BidiAppend 消息（支持 Connect Protobuf / GZIP / Hex AgentClientMessage / JSON）
pub fn decode_bidi_append(bytes: &[u8]) -> Option<DecodedBidiMessage> {
    // 1. 如果整体是 GZIP 流，先解压
    let decompressed_buf = decompress_gzip_if_needed(bytes);
    let bytes = decompressed_buf.as_slice();

    // 2. 收集所有可能的 payload 切片（支持 Connect 单帧、多帧或无前缀）
    let mut candidate_payloads: Vec<Vec<u8>> = Vec::new();

    if bytes.len() >= 5 {
        let mut offset = 0;
        let mut framed_found = false;
        while offset + 5 <= bytes.len() {
            let flag = bytes[offset];
            let len = u32::from_be_bytes([
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
                bytes[offset + 4],
            ]) as usize;

            if offset + 5 + len <= bytes.len() {
                framed_found = true;
                let payload = &bytes[offset + 5..offset + 5 + len];
                let unpacked = unpack_connect_frame_payload(flag, payload);
                if !unpacked.is_empty() {
                    candidate_payloads.push(unpacked);
                }
                offset += 5 + len;
            } else {
                break;
            }
        }
        if !framed_found {
            candidate_payloads.push(bytes.to_vec());
        }
    } else {
        candidate_payloads.push(bytes.to_vec());
    }

    // 3. 逐个 payload 尝试解包，聚合提取 Prompt、History、Context
    let mut merged: Option<DecodedBidiMessage> = None;

    for payload in &candidate_payloads {
        if let Some(msg) = decode_single_bidi_append_payload(payload) {
            match merged.as_mut() {
                Some(existing) => {
                    if existing.request_id.is_empty() && !msg.request_id.is_empty() {
                        existing.request_id = msg.request_id;
                    }
                    if existing.user_text.is_empty() && !msg.user_text.is_empty() {
                        existing.user_text = msg.user_text;
                    }
                    if existing.model.is_none() && msg.model.is_some() {
                        existing.model = msg.model;
                    }
                    if existing.history.is_empty() && !msg.history.is_empty() {
                        existing.history = msg.history;
                    }
                    if existing.context_files.is_empty() && !msg.context_files.is_empty() {
                        existing.context_files = msg.context_files;
                    }
                    if existing.context_codes.is_empty() && !msg.context_codes.is_empty() {
                        existing.context_codes = msg.context_codes;
                    }
                    if existing.context_rules.is_empty() && !msg.context_rules.is_empty() {
                        existing.context_rules = msg.context_rules;
                    }
                    if existing.extra_context.is_empty() && !msg.extra_context.is_empty() {
                        existing.extra_context = msg.extra_context;
                    }
                    if msg.seqno > existing.seqno {
                        existing.seqno = msg.seqno;
                    }
                }
                None => {
                    merged = Some(msg);
                }
            }
        }
    }

    if merged.is_some() {
        return merged;
    }

    // 4. 降级：如果上述解帧失败，将整个 bytes 作为原始载荷直接尝试一次
    decode_single_bidi_append_payload(bytes)
}

/// 从 RunSSE 请求中提取 request_id (支持 Protobuf、GZIP 与 JSON)
pub fn decode_bidi_request_id(bytes: &[u8]) -> Option<String> {
    use prost::Message;
    let decompressed_buf = decompress_gzip_if_needed(bytes);
    let bytes = decompressed_buf.as_slice();

    let payload_bytes = if bytes.len() >= 5 {
        let flag = bytes[0];
        let len = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as usize;
        let p = if bytes.len() >= 5 + len {
            &bytes[5..5 + len]
        } else {
            &bytes[5..]
        };
        unpack_connect_frame_payload(flag, p)
    } else {
        bytes.to_vec()
    };

    if let Ok(req) = proto::BidiRequestId::decode(payload_bytes.as_slice()) {
        if !req.request_id.is_empty() {
            return Some(req.request_id);
        }
    }

    if let Ok(val) = serde_json::from_slice::<Value>(payload_bytes.as_slice()) {
        if let Some(id) = val
            .get("requestId")
            .or_else(|| val.get("request_id"))
            .and_then(|v| v.as_str())
        {
            return Some(id.to_string());
        }
    }

    None
}

/// 将 Cursor 请求转译为标准 OpenAI Chat Completions 协议
#[allow(dead_code)]
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
        let clean_path = sanitize_tag_attribute(path);
        let contents = cf.get("contents").and_then(|v| v.as_str()).unwrap_or("");
        if !contents.is_empty() {
            let safe_contents = truncate_with_ellipsis(contents, MAX_FILE_CONTENT_BYTES);
            context_parts.push(format!(
                "### Current Active File: `{}`\n```\n{}\n```",
                clean_path, safe_contents
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
            let clean_path = sanitize_tag_attribute(path);
            let contents = b
                .get("contents")
                .or_else(|| b.get("fileContents"))
                .or_else(|| b.get("file_contents"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !contents.is_empty() {
                let safe_contents = truncate_with_ellipsis(contents, MAX_CODE_BLOCK_BYTES);
                context_parts.push(format!(
                    "### Referenced Code `{}`:\n```\n{}\n```",
                    clean_path, safe_contents
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
                    let clean_path = sanitize_tag_attribute(path);
                    let lines: Vec<&str> = chunk
                        .get("lines")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|l| l.as_str()).collect())
                        .unwrap_or_default();
                    if !lines.is_empty() {
                        let joined_lines = lines.join("\n");
                        let safe_lines =
                            truncate_with_ellipsis(&joined_lines, MAX_CODE_BLOCK_BYTES);
                        bubble_text.push_str(&format!(
                            "\n\n[Attached code from `{}`]:\n```\n{}\n```",
                            clean_path, safe_lines
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

/// 格式化 Connect-RPC GetUsableModels 响应 (现代 Cursor 核心路由)
pub fn format_connect_usable_models(custom_models: &[String]) -> Value {
    format_connect_available_models(custom_models)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use prost::Message;

    #[test]
    fn protobuf_and_json_context_budgets_include_long_paths_and_all_categories() {
        let path = "p".repeat(190_000);
        let selected = proto::SelectedContext {
            files: vec![proto::SelectedFile {
                path: path.clone(),
                content: "x".into(),
            }],
            code_selections: vec![proto::SelectedCodeSelection {
                path: path.clone(),
                content: String::new(),
            }],
            cursor_rules: vec![proto::SelectedCursorRule {
                rule: Some(proto::CursorRule {
                    full_path: path.clone(),
                    content: "x".into(),
                }),
            }],
            extra_context: vec!["e".repeat(20_000)],
        };
        let inner = proto::AgentClientMessage {
            run_request: Some(proto::AgentRunRequest {
                action: Some(proto::ConversationAction {
                    user_message_action: Some(proto::UserMessageAction {
                        user_message: Some(proto::UserMessage {
                            text: "test".into(),
                            selected_context: Some(selected),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                }),
                ..Default::default()
            }),
            conversation_action: None,
        };
        let request = proto::BidiAppendRequest {
            request_id: Some(proto::BidiRequestId {
                request_id: "budget".into(),
            }),
            data_binary: inner.encode_to_vec(),
            ..Default::default()
        };
        let protobuf = decode_bidi_append(&request.encode_to_vec()).unwrap();
        let json = serde_json::json!({
            "requestId": "budget", "text": "test",
            "selectedContext": {
                "files": [{"path": path, "content": "x"}],
                "codeSelections": [{"path": path, "content": ""}],
                "cursorRules": [{"rule": {"fullPath": path, "content": "x"}}],
                "extraContext": ["e".repeat(20_000)]
            }
        });
        let json = decode_bidi_append(&serde_json::to_vec(&json).unwrap()).unwrap();
        for decoded in [protobuf, json] {
            let bytes: usize = decoded
                .context_files
                .iter()
                .chain(&decoded.context_codes)
                .chain(&decoded.context_rules)
                .map(|(p, c)| p.len() + c.len())
                .sum::<usize>()
                + decoded.extra_context.iter().map(String::len).sum::<usize>();
            assert_eq!(bytes, 190_001);
            assert!(bytes <= MAX_TOTAL_CONTEXT_BYTES);
            assert_eq!(decoded.context_files.len(), 1);
            assert!(decoded.context_codes.is_empty());
            assert!(decoded.context_rules.is_empty());
            assert!(decoded.extra_context.is_empty());
        }
    }

    #[test]
    fn test_truncate_with_ellipsis_short_content() {
        let short_text = "Hello World";
        let result = truncate_with_ellipsis(short_text, 100);
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn test_truncate_with_ellipsis_long_content() {
        let long_text = "a".repeat(100_000);
        let result = truncate_with_ellipsis(&long_text, 50_000);
        assert!(result.len() < 51_000);
        assert!(result.contains("内容过大已截断"));
    }

    #[test]
    fn test_connect_frame_roundtrip() {
        let payload = json!({"hello": "world"});
        let frame = encode_connect_frame(0x00, &payload);
        assert_eq!(frame[0], 0x00);
        let decoded = decode_connect_or_json(&frame).expect("should decode frame");
        assert_eq!(decoded["hello"], "world");
    }

    #[test]
    fn test_agent_text_chunk_protobuf_wire() {
        let chunk = create_agent_text_chunk("Hello from AI-Helper!");
        assert_eq!(chunk[0], 0x00);
        let len = u32::from_be_bytes([chunk[1], chunk[2], chunk[3], chunk[4]]) as usize;
        assert_eq!(chunk.len(), 5 + len);

        let decoded = proto::AgentServerMessage::decode(&chunk[5..]).expect("protobuf decode");
        let update = decoded.interaction_update.expect("has interaction update");
        let text_delta = update.text_delta.expect("has text delta");
        assert_eq!(text_delta.text, "Hello from AI-Helper!");
        assert!(!text_delta.is_server_notice);
    }

    #[test]
    fn test_agent_thinking_chunk_protobuf_wire() {
        let chunk = create_agent_thinking_chunk("DeepSeek Thinking...");
        assert_eq!(chunk[0], 0x00);
        let decoded = proto::AgentServerMessage::decode(&chunk[5..]).expect("protobuf decode");
        let update = decoded.interaction_update.expect("has interaction update");
        let thinking = update.thinking_delta.expect("has thinking delta");
        assert_eq!(thinking.text, "DeepSeek Thinking...");
        assert_eq!(thinking.thinking_style, Some(0));
    }

    #[test]
    fn test_bidi_append_protobuf_roundtrip() {
        let client_msg = proto::AgentClientMessage {
            run_request: Some(proto::AgentRunRequest {
                action: Some(proto::ConversationAction {
                    user_message_action: Some(proto::UserMessageAction {
                        user_message: Some(proto::UserMessage {
                            text: "Explain async in Rust".to_string(),
                            message_id: "msg_123".to_string(),
                            selected_context: Some(proto::SelectedContext {
                                extra_context: vec!["terminal output: success".to_string()],
                                files: vec![proto::SelectedFile {
                                    content: "fn main() {}".to_string(),
                                    path: "src/main.rs".to_string(),
                                }],
                                code_selections: vec![proto::SelectedCodeSelection {
                                    content: "let x = 42;".to_string(),
                                    path: "src/lib.rs".to_string(),
                                }],
                                cursor_rules: vec![proto::SelectedCursorRule {
                                    rule: Some(proto::CursorRule {
                                        full_path: ".cursorrules".to_string(),
                                        content: "Always write tests".to_string(),
                                    }),
                                }],
                            }),
                        }),
                        conversation_history: Some(proto::ConversationHistory {
                            messages: vec![
                                proto::ConversationHistoryMessage {
                                    user: Some(proto::ConversationHistoryUserMessage {
                                        content: vec![proto::ConversationHistoryUserContent {
                                            text: Some(proto::ConversationHistoryTextContent {
                                                text: "Hello, who are you?".to_string(),
                                            }),
                                        }],
                                    }),
                                    assistant: None,
                                },
                                proto::ConversationHistoryMessage {
                                    user: None,
                                    assistant: Some(proto::ConversationHistoryAssistantMessage {
                                        content: vec![proto::ConversationHistoryAssistantContent {
                                            text: Some(proto::ConversationHistoryTextContent {
                                                text: "I am your AI assistant.".to_string(),
                                            }),
                                            reasoning: None,
                                        }],
                                    }),
                                },
                            ],
                        }),
                    }),
                }),
                model_details: Some(proto::ModelDetails {
                    model: "claude-3-7-sonnet".to_string(),
                    display_model_id: "claude-3-7-sonnet".to_string(),
                    display_name: "Claude 3.7 Sonnet".to_string(),
                    display_name_short: "Claude 3.7 Sonnet".to_string(),
                    aliases: vec![],
                }),
                conversation_id: Some("conv_456".to_string()),
                requested_model: None,
            }),
            conversation_action: None,
        };
        let mut client_bytes = Vec::new();
        client_msg.encode(&mut client_bytes).unwrap();
        let hex_data = hex::encode(client_bytes);

        let bidi_req = proto::BidiAppendRequest {
            data: hex_data,
            request_id: Some(proto::BidiRequestId {
                request_id: "req_test_789".to_string(),
            }),
            append_seqno: 1,
            data_binary: Vec::new(),
        };
        let mut bidi_bytes = Vec::new();
        bidi_req.encode(&mut bidi_bytes).unwrap();
        let framed = encode_connect_frame_raw(0x00, &bidi_bytes);

        let decoded = decode_bidi_append(&framed).expect("must decode bidi append");
        assert_eq!(decoded.request_id, "req_test_789");
        assert_eq!(decoded.user_text, "Explain async in Rust");
        assert_eq!(decoded.model, Some("claude-3-7-sonnet".to_string()));
        assert_eq!(decoded.conversation_id, Some("conv_456".to_string()));

        // 验证多轮历史对话
        assert_eq!(decoded.history.len(), 2);
        assert_eq!(decoded.history[0].0, "user");
        assert_eq!(decoded.history[0].1, "Hello, who are you?");
        assert_eq!(decoded.history[1].0, "assistant");
        assert_eq!(decoded.history[1].1, "I am your AI assistant.");

        // 验证上下文文件与代码片段提取
        assert_eq!(decoded.context_files.len(), 1);
        assert_eq!(decoded.context_files[0].0, "src/main.rs");
        assert_eq!(decoded.context_files[0].1, "fn main() {}");

        assert_eq!(decoded.context_codes.len(), 1);
        assert_eq!(decoded.context_codes[0].0, "src/lib.rs");
        assert_eq!(decoded.context_codes[0].1, "let x = 42;");

        assert_eq!(decoded.context_rules.len(), 1);
        assert_eq!(decoded.context_rules[0].0, ".cursorrules");
        assert_eq!(decoded.context_rules[0].1, "Always write tests");

        assert_eq!(decoded.extra_context.len(), 1);
        assert_eq!(decoded.extra_context[0], "terminal output: success");
    }

    #[test]
    fn test_bidi_append_compressed_flag_and_raw_gzip() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let client_msg = proto::AgentClientMessage {
            run_request: Some(proto::AgentRunRequest {
                action: Some(proto::ConversationAction {
                    user_message_action: Some(proto::UserMessageAction {
                        user_message: Some(proto::UserMessage {
                            text: "Hello from compressed connect stream".to_string(),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                }),
                ..Default::default()
            }),
            conversation_action: None,
        };
        let client_bytes = client_msg.encode_to_vec();
        let bidi_req = proto::BidiAppendRequest {
            data: hex::encode(client_bytes),
            request_id: Some(proto::BidiRequestId {
                request_id: "req_compressed_test".to_string(),
            }),
            append_seqno: 1,
            data_binary: Vec::new(),
        };
        let bidi_raw_bytes = bidi_req.encode_to_vec();

        // 1. 测试 Connect Envelope flag 0x01 (消息体为 gzip)
        let mut encoder1 = GzEncoder::new(Vec::new(), Compression::default());
        encoder1.write_all(&bidi_raw_bytes).unwrap();
        let gzip_payload = encoder1.finish().unwrap();
        let connect_compressed_frame = encode_connect_frame_raw(0x01, &gzip_payload);

        let decoded1 = decode_bidi_append(&connect_compressed_frame)
            .expect("must decode connect frame with flag 0x01");
        assert_eq!(decoded1.request_id, "req_compressed_test");
        assert_eq!(decoded1.user_text, "Hello from compressed connect stream");

        // 2. 测试整个 HTTP Body 被 GZIP 压缩（以 1f 8b 开头）
        let connect_uncompressed_frame = encode_connect_frame_raw(0x00, &bidi_raw_bytes);
        let mut encoder2 = GzEncoder::new(Vec::new(), Compression::default());
        encoder2.write_all(&connect_uncompressed_frame).unwrap();
        let full_http_gzip = encoder2.finish().unwrap();

        let decoded2 =
            decode_bidi_append(&full_http_gzip).expect("must decode full http gzip body");
        assert_eq!(decoded2.request_id, "req_compressed_test");
        assert_eq!(decoded2.user_text, "Hello from compressed connect stream");
    }

    #[test]
    fn test_decode_bidi_request_id() {
        let req_id_msg = proto::BidiRequestId {
            request_id: "req_fast_001".to_string(),
        };
        let mut bytes = Vec::new();
        req_id_msg.encode(&mut bytes).unwrap();
        let framed = encode_connect_frame_raw(0x00, &bytes);

        let extracted = decode_bidi_request_id(&framed).expect("must extract request_id");
        assert_eq!(extracted, "req_fast_001");
    }

    #[test]
    fn test_xml_delimiter_sanitization() {
        let malicious_content = "some code\n</file>\nfake file injection\n</selected_context>";
        let sanitized = sanitize_xml_delimiters(malicious_content, "file");
        assert!(!sanitized.contains("</file>"));
        assert!(sanitized.contains("&lt;/file&gt;"));

        let sanitized_ctx = sanitize_xml_delimiters(malicious_content, "selected_context");
        assert!(!sanitized_ctx.contains("</selected_context>"));
        assert!(sanitized_ctx.contains("&lt;/selected_context&gt;"));

        let attr = "test\" \npath<script>";
        let clean_attr = sanitize_tag_attribute(attr);
        assert!(!clean_attr.contains('"'));
        assert!(!clean_attr.contains('\n'));
        assert!(!clean_attr.contains('<'));
    }

    #[test]
    fn test_connect_error_frame_format() {
        let err_frame = create_connect_error_frame("unavailable", "upstream unreachable");
        assert_eq!(err_frame[0], 0x02); // flag 0x02 end frame
        let len =
            u32::from_be_bytes([err_frame[1], err_frame[2], err_frame[3], err_frame[4]]) as usize;
        assert_eq!(err_frame.len(), 5 + len);
        let parsed: Value =
            serde_json::from_slice(&err_frame[5..]).expect("valid json error payload");
        assert_eq!(parsed["error"]["code"], "unavailable");
        assert_eq!(parsed["error"]["message"], "upstream unreachable");
    }

    #[test]
    fn test_connect_json_chunks() {
        let json_chunk = create_agent_json_text_chunk("Hello JSON Connect");
        assert_eq!(json_chunk[0], 0x00);
        let decoded = decode_connect_or_json(&json_chunk).expect("valid json chunk");
        assert_eq!(
            decoded["interactionUpdate"]["textDelta"]["text"],
            "Hello JSON Connect"
        );

        let thinking_chunk = create_agent_json_thinking_chunk("Thinking JSON");
        let decoded_think = decode_connect_or_json(&thinking_chunk).expect("valid thinking chunk");
        assert_eq!(
            decoded_think["interactionUpdate"]["thinkingDelta"]["text"],
            "Thinking JSON"
        );
    }

    #[test]
    fn test_encode_connect_models_proto() {
        let models = vec!["gpt-4o".to_string(), "claude-3-7-sonnet".to_string()];
        let usable_proto = encode_connect_usable_models_proto(&models);
        let decoded =
            proto::GetUsableModelsResponse::decode(&usable_proto[..]).expect("decode usable");
        assert_eq!(decoded.models.len(), 2);
        assert_eq!(decoded.models[0].model, "gpt-4o");
        assert_eq!(decoded.models[1].model, "claude-3-7-sonnet");

        let avail_proto = encode_connect_available_models_proto(&models);
        let decoded_avail =
            proto::AvailableModelsResponse::decode(&avail_proto[..]).expect("decode avail");
        assert_eq!(decoded_avail.models.len(), 2);
        assert_eq!(decoded_avail.model_names.len(), 2);
    }

    #[test]
    fn test_history_reasoning_extracted() {
        let client_msg = proto::AgentClientMessage {
            run_request: Some(proto::AgentRunRequest {
                action: Some(proto::ConversationAction {
                    user_message_action: Some(proto::UserMessageAction {
                        user_message: Some(proto::UserMessage {
                            text: "Explain R1".to_string(),
                            message_id: "m1".to_string(),
                            selected_context: None,
                        }),
                        conversation_history: Some(proto::ConversationHistory {
                            messages: vec![proto::ConversationHistoryMessage {
                                user: Some(proto::ConversationHistoryUserMessage {
                                    content: vec![proto::ConversationHistoryUserContent {
                                        text: Some(proto::ConversationHistoryTextContent {
                                            text: "Why is sky blue?".to_string(),
                                        }),
                                    }],
                                }),
                                assistant: Some(proto::ConversationHistoryAssistantMessage {
                                    content: vec![proto::ConversationHistoryAssistantContent {
                                        text: Some(proto::ConversationHistoryTextContent {
                                            text: "Rayleigh scattering".to_string(),
                                        }),
                                        reasoning: Some(
                                            proto::ConversationHistoryReasoningContent {
                                                text: "Let me ponder physics".to_string(),
                                            },
                                        ),
                                    }],
                                }),
                            }],
                        }),
                    }),
                }),
                model_details: None,
                conversation_id: None,
                requested_model: None,
            }),
            conversation_action: None,
        };
        let mut client_bytes = Vec::new();
        client_msg.encode(&mut client_bytes).unwrap();
        let hex_data = hex::encode(client_bytes);

        let bidi_req = proto::BidiAppendRequest {
            data: hex_data,
            request_id: Some(proto::BidiRequestId {
                request_id: "req_reasoning_test".to_string(),
            }),
            append_seqno: 1,
            data_binary: Vec::new(),
        };
        let mut bidi_bytes = Vec::new();
        bidi_req.encode(&mut bidi_bytes).unwrap();
        let framed = encode_connect_frame_raw(0x00, &bidi_bytes);

        let decoded = decode_bidi_append(&framed).expect("must decode");
        // Both user and assistant should be extracted even if present in the same message
        assert_eq!(decoded.history.len(), 2);
        assert_eq!(decoded.history[0].0, "user");
        assert_eq!(decoded.history[0].1, "Why is sky blue?");
        assert_eq!(decoded.history[1].0, "assistant");
        assert!(decoded.history[1].1.contains("Rayleigh scattering"));
        assert!(decoded.history[1]
            .1
            .contains("<thinking>\nLet me ponder physics\n</thinking>"));
    }

    #[test]
    fn test_decode_agent_client_message_wire() {
        let inner = proto::AgentClientMessage {
            run_request: Some(proto::AgentRunRequest {
                conversation_id: Some("conv-123".into()),
                requested_model: Some(proto::RequestedModel {
                    model_id: "gpt-5.6-sol".into(),
                }),
                action: Some(proto::ConversationAction {
                    user_message_action: Some(proto::UserMessageAction {
                        user_message: Some(proto::UserMessage {
                            text: "Hello from Agent Run".into(),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                }),
                ..Default::default()
            }),
            conversation_action: None,
        };
        let encoded = inner.encode_to_vec();
        let framed = encode_connect_frame_raw(0x00, &encoded);
        let decoded =
            decode_agent_client_message(&framed).expect("must decode agent client message");
        assert_eq!(decoded.conversation_id.as_deref(), Some("conv-123"));
        assert_eq!(decoded.model.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(decoded.user_text, "Hello from Agent Run");
    }
}

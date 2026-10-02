use crate::accio::config::{load_accio_config, save_accio_config, AccioConfig};
use crate::accio::protocol::{self, accio_to_openai, format_accio_sse, ApiEndpoint, SSE_HEARTBEAT};
use axum::{
    body::{Body, Bytes},
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use flate2::read::GzDecoder;
use futures_util::Stream;
use reqwest::Client;
use serde_json::{json, Value};
use std::io::Read;
use std::{
    pin::Pin,
    sync::Mutex,
    task::{Context, Poll},
    time::{Duration, Instant},
};
use tokio::{net::TcpListener, sync::oneshot};
use tower_http::cors::CorsLayer;

/// 用于 Axum Body::from_stream 的 MPSC Receiver Stream 适配器
struct ReceiverStream<T>(tokio::sync::mpsc::Receiver<T>);

impl<T> Stream for ReceiverStream<T> {
    type Item = T;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.0.poll_recv(cx)
    }
}

pub struct BridgeHandle {
    pub port: u16,
    shutdown_tx: oneshot::Sender<()>,
    join_handle: tokio::task::JoinHandle<()>,
}

static RUNNING_BRIDGE: Mutex<Option<BridgeHandle>> = Mutex::new(None);

/// 判断当前 Bridge 是否正在运行 (严格校验协程存活状态，防止僵尸句柄假在线)
pub fn is_bridge_running() -> bool {
    let mut guard = RUNNING_BRIDGE.lock().unwrap();
    if let Some(ref handle) = *guard {
        if handle.join_handle.is_finished() {
            log::warn!("检测到 Accio Bridge 后台协程已结束，自动重置运行状态");
            *guard = None;
            return false;
        }
        return true;
    }
    false
}

/// 获取当前 Bridge 实际监听端口 (严格校验协程存活状态)
pub fn get_bridge_port() -> Option<u16> {
    let mut guard = RUNNING_BRIDGE.lock().unwrap();
    if let Some(ref handle) = *guard {
        if handle.join_handle.is_finished() {
            *guard = None;
            return None;
        }
        return Some(handle.port);
    }
    None
}

/// 规整并去除 Base URL 结尾的斜杠与重复 /v1，避免生成 /v1/v1/... 路径
pub fn clean_base_url(url: &str) -> &str {
    let trimmed = url.trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

/// 尝试直接异步绑定空闲端口并返回已成功绑定的 TcpListener 和端口号
/// 避免先 bind 再 drop 造成的 Windows TIME_WAIT 10048 端口冲突
pub async fn bind_listener(start_port: u16) -> Result<(TcpListener, u16), String> {
    // 1. 优先尝试首选端口，带有平滑重试以允许刚停机的 socket 彻底释放
    for retry in 0..6 {
        match TcpListener::bind(("127.0.0.1", start_port)).await {
            Ok(listener) => return Ok((listener, start_port)),
            Err(e) => {
                log::debug!(
                    "尝试绑定端口 {} 遇到 (重试 {}/6): {}",
                    start_port,
                    retry + 1,
                    e
                );
                if retry < 5 {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                }
            }
        }
    }

    // 2. 首选端口无法获取，递增避让扫描可用端口
    for offset in 1..=20 {
        let port = start_port.saturating_add(offset);
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            log::info!("首选端口 {} 被占用，已避让至可用端口 {}", start_port, port);
            return Ok((listener, port));
        }
    }

    Err(format!(
        "无法在端口 {}..={} 成功建立本地监听，请检查是否有残留进程占用",
        start_port,
        start_port.saturating_add(20)
    ))
}

/// 启动 Accio Local Bridge 中继服务器
pub async fn start_bridge(preferred_port: Option<u16>) -> Result<u16, String> {
    {
        let mut guard = RUNNING_BRIDGE.lock().unwrap();
        if let Some(ref handle) = *guard {
            if !handle.join_handle.is_finished() {
                if preferred_port.is_none() || preferred_port == Some(handle.port) {
                    log::info!(
                        "Accio Local Bridge 已经在端口 {} 上稳定运行，直接复用",
                        handle.port
                    );
                    return Ok(handle.port);
                }
            } else {
                log::warn!("先前的 Accio Bridge 实例已结束，正在清理旧状态并重新拉起");
                *guard = None;
            }
        }
    }

    // 若当前正在运行但需要切换不同端口，先停止现存 bridge
    if is_bridge_running() {
        stop_bridge().await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let config = load_accio_config();
    let base_port = preferred_port.unwrap_or(config.bridge_port);
    let (listener, target_port) = bind_listener(base_port).await?;

    // 若发现端口发生了递增避让，回写配置
    if target_port != config.bridge_port {
        let mut updated = config.clone();
        updated.bridge_port = target_port;
        let _ = save_accio_config(&updated);
        log::info!(
            "Accio Bridge 端口已自适应切换: {} -> {}",
            config.bridge_port,
            target_port
        );
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/api/llm/config/v2", any(custom_model_list))
        .route("/api/tool/rlab/call", post(handle_tool_rlab_call))
        .route("/api/adk/embedding/embed", post(handle_embedding))
        .route("/api/adk/llm", post(handle_llm))
        .route("/api/adk/llm/*path", post(handle_llm))
        .route("/api/mcp/proxy", any(handle_mcp_proxy))
        .route("/api/mcp/proxy/*path", any(handle_mcp_proxy))
        .fallback(any(proxy_official))
        .layer(CorsLayer::permissive())
        .with_state(client);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let join_handle = tokio::spawn(async move {
        log::info!(
            "Accio Local Bridge 启动成功，监听于 http://127.0.0.1:{}",
            target_port
        );
        let server = axum::serve(listener, app);
        let graceful = server.with_graceful_shutdown(async move {
            match shutdown_rx.await {
                Ok(_) => log::info!("Accio Local Bridge 收到显式退出信号，正在关闭服务..."),
                Err(_) => log::info!("Accio Local Bridge 收到停机指令，正在关闭服务..."),
            }
        });

        if let Err(e) = graceful.await {
            log::error!("Accio Local Bridge 服务运行异常退出: {}", e);
        } else {
            log::info!("Accio Local Bridge 服务已优雅退出 (端口 {})", target_port);
        }
    });

    {
        let mut guard = RUNNING_BRIDGE.lock().unwrap();
        *guard = Some(BridgeHandle {
            port: target_port,
            shutdown_tx,
            join_handle,
        });
    }

    Ok(target_port)
}

/// 停止 Accio Local Bridge 服务
pub async fn stop_bridge() -> Result<(), String> {
    let handle_opt = {
        let mut guard = RUNNING_BRIDGE.lock().unwrap();
        guard.take()
    };
    if let Some(handle) = handle_opt {
        let _ = handle.shutdown_tx.send(());
        let _ = tokio::time::timeout(Duration::from_millis(1500), handle.join_handle).await;
        // 给予底层系统短暂缓冲以释放套接字
        tokio::time::sleep(Duration::from_millis(150)).await;
        log::info!("已安全停止并释放 Accio Bridge 端口 {}", handle.port);
    }
    Ok(())
}

/// GET /health: 快速探活健康检查
async fn handle_health() -> Json<Value> {
    let config = load_accio_config();
    Json(json!({
        "ok": true,
        "model": config.model,
        "provider": "bob-api"
    }))
}

/// GET /api/llm/config/v2: 注入模型列表，使 Accio Work 下拉框识别并选中当前配置的模型及 bob-api.com 丰富模型
async fn custom_model_list() -> Json<Value> {
    let config = load_accio_config();
    let mut model_list = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 1. 首选当前配置的模型
    if !config.model.trim().is_empty() {
        seen.insert(config.model.clone());
        model_list.push(json!({
            "modelCode": config.model,
            "modelName": config.model,
            "modelDisplayName": config.model,
            "modelDesc": format!("{} via bob-api.com", config.model),
            "visible": true,
            "isDefault": true,
            "freeUse": true,
            "multimodal": true,
            "contextWindow": 128000,
            "reasoningEfforts": ["low", "medium", "high"],
            "defaultReasoningEffort": "medium"
        }));
    }

    // 2. 加入缓存探测的模型列表 (来自 bob-api.com 模型拉取)
    for m in &config.cached_models {
        let trimmed = m.trim();
        if !trimmed.is_empty() && !seen.contains(trimmed) {
            seen.insert(trimmed.to_string());
            model_list.push(json!({
                "modelCode": trimmed,
                "modelName": trimmed,
                "modelDisplayName": trimmed,
                "modelDesc": format!("{} via bob-api.com", trimmed),
                "visible": true,
                "isDefault": trimmed == config.model,
                "freeUse": true,
                "multimodal": true,
                "contextWindow": 128000,
                "reasoningEfforts": ["low", "medium", "high"],
                "defaultReasoningEffort": "medium"
            }));
        }
    }

    // 3. 预设常用推荐模型，确保 Accio 下拉框丰富可选
    let presets = [
        "claude-3-7-sonnet",
        "claude-3-5-sonnet",
        "gpt-4o",
        "gpt-4.1-mini",
        "deepseek-chat",
        "deepseek-reasoner",
        "qwen-2.5-max",
    ];
    for p in presets {
        if !seen.contains(p) {
            seen.insert(p.to_string());
            model_list.push(json!({
                "modelCode": p,
                "modelName": p,
                "modelDisplayName": p,
                "modelDesc": format!("{} via bob-api.com", p),
                "visible": true,
                "isDefault": p == config.model,
                "freeUse": true,
                "multimodal": true,
                "contextWindow": 128000,
                "reasoningEfforts": ["low", "medium", "high"],
                "defaultReasoningEffort": "medium"
            }));
        }
    }

    Json(json!([{
        "provider": "ai-helper",
        "providerDisplayName": "AI-Helper (bob-api.com)",
        "modelList": model_list
    }]))
}

/// POST /api/tool/rlab/call: 处理 Accio 内部的自动模型路由请求 (model_routing)
async fn handle_tool_rlab_call(
    State(client): State<Client>,
    mut headers: HeaderMap,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let bytes = match axum::body::to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error_message": format!("无法读取请求体: {}", e)})),
            )
                .into_response();
        }
    };
    let bytes = match decode_request_body(&headers, bytes) {
        Ok(b) => b,
        Err((status, message)) => {
            return (
                status,
                Json(json!({"error_code": status.as_u16(), "error_message": message})),
            )
                .into_response();
        }
    };
    headers.remove(header::CONTENT_ENCODING);
    headers.remove(header::CONTENT_LENGTH);

    if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
        if val.get("function").and_then(Value::as_str) == Some("model_routing") {
            let config = load_accio_config();
            log::info!("已拦截 Accio 模型路由决策，锁定至: {}", config.model);
            return Json(json!({
                "success": true,
                "data": {
                    "payload": {
                        "modelCode": config.model,
                        "shouldCompact": false,
                        "reason": "ai_helper_forced"
                    }
                }
            }))
            .into_response();
        }
    }

    // 非 model_routing 请求，原样透明转发至阿里官方网关
    forward_to_official(&client, parts.method, headers, "/api/tool/rlab/call", bytes).await
}

/// POST /api/adk/embedding/embed: 映射转接向量嵌入请求
async fn handle_embedding(State(client): State<Client>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let raw_body = match axum::body::to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": {"message": format!("无法读取请求体: {}", e)}})),
            )
                .into_response();
        }
    };
    let body = match decode_request_body(&parts.headers, raw_body) {
        Ok(b) => b,
        Err((status, message)) => {
            return (status, Json(json!({"error": {"message": message}}))).into_response();
        }
    };
    let config = load_accio_config();
    if config.api_key.trim().is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": {"message": "API 密钥未配置，请先在 AI-Helper 中填写 API Key"}})),
        )
            .into_response();
    }

    let input: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": {"message": format!("请求 JSON 解析失败: {}", e)}})),
            )
                .into_response();
        }
    };

    // 验证输入字段
    let texts = input
        .get("texts")
        .or_else(|| input.get("input"))
        .and_then(Value::as_array);

    if texts.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": {"message": "缺少 texts 或 input 字段"}})),
        )
            .into_response();
    }

    let texts = texts.unwrap().clone();
    if texts.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": {"message": "输入文本数组不能为空"}})),
        )
            .into_response();
    }
    let root = clean_base_url(&config.base_url);
    let endpoint = format!("{root}/v1/embeddings");

    let res = client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .json(&json!({
            "input": texts,
            "model": "text-embedding-3-small"
        }))
        .send()
        .await;

    match res {
        Ok(upstream_res) => {
            let status = upstream_res.status();
            let body_bytes = match upstream_res.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(json!({"error": {"message": format!("读取上游响应失败: {}", e)}})),
                    )
                        .into_response();
                }
            };

            if body_bytes.len() > MAX_RESPONSE_SIZE {
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    Json(json!({"error": {"message": format!("上游响应体过大 ({} MB)", body_bytes.len() / 1024 / 1024)}})),
                )
                    .into_response();
            }

            match serde_json::from_slice::<Value>(&body_bytes) {
                Ok(data) => (status, Json(data)).into_response(),
                Err(e) => (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({"error": {"message": format!("上游向量接口响应非 JSON: {}", e)}})),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": {"message": format!("上游向量接口连接失败: {}", e)}})),
        )
            .into_response(),
    }
}

/// POST /api/adk/llm*: 模型调用核心转译网关 (带 15s SSE 心跳保活与头尾压缩)
async fn handle_llm(State(client): State<Client>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let raw_bytes = match axum::body::to_bytes(body, 32 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error_code": 400, "error_message": format!("无法读取请求体: {}", e)})),
            )
                .into_response();
        }
    };

    let bytes = match decode_request_body(&parts.headers, raw_bytes) {
        Ok(b) => b,
        Err((status, message)) => {
            return (
                status,
                Json(json!({
                    "error_code": status.as_u16(),
                    "error_message": message
                })),
            )
                .into_response();
        }
    };

    let input: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("收到无法解析的 LLM JSON 请求: {}", e);
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error_code": 400,
                    "error_message": format!("LLM 请求体不是有效 JSON: {}", e)
                })),
            )
                .into_response();
        }
    };

    // 验证请求结构
    if !input.is_object() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error_code": 400,
                "error_message": "LLM 请求体必须是 JSON 对象"
            })),
        )
            .into_response();
    }

    let has_contents = input.get("contents").and_then(Value::as_array).is_some();
    let has_messages = input.get("messages").and_then(Value::as_array).is_some();
    if !has_contents && !has_messages {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error_code": 400,
                "error_message": "LLM 请求体缺少 contents 或 messages 字段"
            })),
        )
            .into_response();
    }

    let config = load_accio_config();

    // 诊断日志：记录 Accio Work 请求中携带的模型相关字段
    log::info!(
        "Accio LLM 请求诊断 - model: {:?}, modelCode: {:?}, modelName: {:?}, properties.model: {:?}, 配置模型: {}",
        input.get("model").and_then(|v| v.as_str()),
        input.get("modelCode").and_then(|v| v.as_str()),
        input.get("modelName").and_then(|v| v.as_str()),
        input.pointer("/properties/model").and_then(|v| v.as_str()),
        config.model
    );
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::convert::Infallible>>(32);

    // 建立连接立即返回连通注释帧
    let _ = tx.send(Ok(Bytes::from(": ai-helper connected\n\n"))).await;

    // 异步执行转译与请求上游，同时保活心跳
    let client_clone = client.clone();
    let config_clone = config.clone();
    let method_clone = parts.method.clone();
    let mut headers_clone = parts.headers.clone();
    headers_clone.remove(header::CONTENT_ENCODING);
    headers_clone.remove(header::CONTENT_LENGTH);
    let path_clone = parts
        .uri
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| parts.uri.path().to_string());
    let bytes_for_fallback = bytes.clone();

    tokio::spawn(async move {
        let heartbeat_tx = tx.clone();
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        // 跳过首次即刻触发的 tick
        interval.tick().await;

        let upstream_fut = async {
            if crate::accio::protocol::is_image_output_request(&input) {
                call_custom_image(&client_clone, &config_clone, input).await
            } else {
                call_upstream_llm(&client_clone, &config_clone, input).await
            }
        };
        tokio::pin!(upstream_fut);

        let mut final_frame: Option<Value> = None;
        let mut final_error: Option<String> = None;

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if heartbeat_tx.send(Ok(Bytes::from(SSE_HEARTBEAT))).await.is_err() {
                        // Accio 客户端断连
                        break;
                    }
                }
                res = &mut upstream_fut => {
                    match res {
                        Ok(frame) => final_frame = Some(frame),
                        Err(err) => final_error = Some(err),
                    }
                    break;
                }
            }
        }

        if let Some(frame) = final_frame {
            let sse_str = format_accio_sse(&frame);
            let _ = tx.send(Ok(Bytes::from(sse_str))).await;
        } else if let Some(err) = final_error {
            log::error!("Accio 自定义 LLM 调用失败: {}", err);
            if config_clone.fallback_official {
                log::warn!("已开启官方网关回退，正在将请求透传至阿里官方网关...");
                let _ = tx
                    .send(Ok(Bytes::from(": ai-helper fallback to official\n\n")))
                    .await;
                let fallback_res = proxy_official_stream(
                    &client_clone,
                    &config_clone,
                    method_clone,
                    headers_clone,
                    &path_clone,
                    bytes_for_fallback,
                    tx.clone(),
                )
                .await;
                if let Err(proxy_err) = fallback_res {
                    let err_msg = format!(
                        "上游自定义模型报错: {}; 官方网关回退失败: {}",
                        err, proxy_err
                    );
                    let err_frame = json!({
                        "errorCode": "502",
                        "errorMessage": &err_msg,
                        "content": {
                            "role": "model",
                            "parts": [{ "text": format!("⚠️ 请求失败: {}", err_msg) }]
                        },
                        "finishReason": "ERROR",
                        "turnComplete": true,
                        "partial": false
                    });
                    let _ = tx.send(Ok(Bytes::from(format_accio_sse(&err_frame)))).await;
                }
            } else {
                let err_frame = json!({
                    "errorCode": "502",
                    "errorMessage": &err,
                    "content": {
                        "role": "model",
                        "parts": [{ "text": format!("⚠️ 调用上游模型失败: {}", err) }]
                    },
                    "finishReason": "ERROR",
                    "turnComplete": true,
                    "partial": false
                });
                let _ = tx.send(Ok(Bytes::from(format_accio_sse(&err_frame)))).await;
            }
        }
    });

    let stream = ReceiverStream(rx);
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-cache, no-transform"),
    );
    response.headers_mut().insert(
        header::CONNECTION,
        header::HeaderValue::from_static("keep-alive"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("x-accel-buffering"),
        header::HeaderValue::from_static("no"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );
    response
}

/// POST /api/mcp/proxy: MCP 请求的显式代理入口。
/// 上游响应保持 SSE/JSON 内容类型，传输错误转换为 JSON-RPC 错误，避免被官方网关的 HTML/文本错误污染。
async fn handle_mcp_proxy(State(client): State<Client>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let raw_bytes = match axum::body::to_bytes(body, 64 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return json_rpc_error_response(
                StatusCode::BAD_REQUEST,
                -32600,
                format!("无法读取 MCP 请求体: {}", e),
                None,
            );
        }
    };
    let mut headers = parts.headers;
    let bytes = match decode_request_body(&headers, raw_bytes) {
        Ok(b) => b,
        Err((status, message)) => {
            return json_rpc_error_response(status, -32600, message, None);
        }
    };
    headers.remove(header::CONTENT_ENCODING);
    headers.remove(header::CONTENT_LENGTH);

    let path = parts
        .uri
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| parts.uri.path().to_string());

    match forward_to_official_result(&client, parts.method, headers, &path, bytes).await {
        Ok(response) => normalize_mcp_response(response).await,
        Err((status, message)) => json_rpc_error_response(
            status,
            -32002,
            format!("MCP 上游代理失败: {}", message),
            None,
        ),
    }
}

fn json_rpc_error_response(
    status: StatusCode,
    code: i64,
    message: String,
    id: Option<Value>,
) -> Response {
    (
        status,
        [(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json; charset=utf-8"),
        )],
        Json(json!({
            "jsonrpc": "2.0",
            "id": id.unwrap_or(Value::Null),
            "error": { "code": code, "message": message }
        })),
    )
        .into_response()
}

async fn normalize_mcp_response(response: Response) -> Response {
    if response.status().is_success() {
        return response;
    }

    let status = response.status();
    let body = match axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024).await {
        Ok(body) => body,
        Err(error) => {
            return json_rpc_error_response(
                status,
                -32001,
                format!("读取 MCP 上游错误响应失败: {}", error),
                None,
            );
        }
    };
    if let Ok(payload) = serde_json::from_slice::<Value>(&body) {
        if payload.get("jsonrpc").is_some() || payload.get("error").is_some() {
            return (status, Json(payload)).into_response();
        }
    }
    let preview = String::from_utf8_lossy(&body);
    let preview = crate::accio::protocol::safe_truncate_head(&preview, 500);
    json_rpc_error_response(
        status,
        -32001,
        format!("MCP 上游返回 HTTP {}: {}", status, preview),
        None,
    )
}

/// 解压缩后上限：64MB，防止 gzip 炸弹
const MAX_DECOMPRESSED_SIZE: usize = 64 * 1024 * 1024;

fn decode_request_body(headers: &HeaderMap, body: Bytes) -> Result<Bytes, (StatusCode, String)> {
    let Some(encoding) = headers.get(header::CONTENT_ENCODING) else {
        return Ok(body);
    };
    let encoding = encoding.to_str().map_err(|_| {
        (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Content-Encoding 请求头不是有效 ASCII 文本".to_string(),
        )
    })?;
    let encodings: Vec<_> = encoding
        .split(',')
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value != "identity")
        .collect();
    if encodings.is_empty() {
        return Ok(body);
    }
    if encodings.len() != 1 || encodings[0] != "gzip" {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format!("暂不支持的请求 Content-Encoding: {}", encoding),
        ));
    }

    let decoder = GzDecoder::new(body.as_ref());
    let mut decoded = Vec::new();
    // 限制解压后大小，防止 gzip 炸弹
    let mut limited_reader = decoder.take(MAX_DECOMPRESSED_SIZE as u64 + 1);
    limited_reader.read_to_end(&mut decoded).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("无法解压 gzip 请求体: {}", e),
        )
    })?;

    if decoded.len() > MAX_DECOMPRESSED_SIZE {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "解压后的请求体超过 {} MB 上限",
                MAX_DECOMPRESSED_SIZE / 1024 / 1024
            ),
        ));
    }

    Ok(Bytes::from(decoded))
}

/// 上游响应体大小上限：128MB
const MAX_RESPONSE_SIZE: usize = 128 * 1024 * 1024;

/// 将 accio_to_openai 输出的 Chat Completions 格式体转换为 /v1/responses 请求格式：
/// - system message → instructions 字段
/// - messages → input 数组
/// - max_tokens → max_output_tokens
/// - 保留 tools / tool_choice / temperature / model
fn chat_to_responses_body(chat_body: &Value) -> Value {
    let empty = vec![];
    let messages = chat_body["messages"].as_array().unwrap_or(&empty);

    let mut instructions: Option<String> = None;
    let mut input_msgs: Vec<Value> = Vec::new();

    for msg in messages {
        if msg.get("role").and_then(Value::as_str) == Some("system") {
            // system 消息提取为 instructions
            if let Some(c) = msg.get("content").and_then(Value::as_str) {
                instructions = Some(c.to_string());
            }
        } else {
            input_msgs.push(msg.clone());
        }
    }

    let mut body = json!({
        "model": chat_body.get("model").cloned().unwrap_or_else(|| json!("")),
        "input": input_msgs,
        "max_output_tokens": chat_body.get("max_tokens").cloned().unwrap_or(json!(16384)),
    });

    if let Some(inst) = instructions {
        body["instructions"] = json!(inst);
    }
    if let Some(temp) = chat_body.get("temperature") {
        body["temperature"] = temp.clone();
    }
    if let Some(tools) = chat_body.get("tools") {
        body["tools"] = tools.clone();
    }
    if let Some(tc) = chat_body.get("tool_choice") {
        body["tool_choice"] = tc.clone();
    }

    body
}

/// 将 /v1/responses 的 JSON 响应解析为 Accio Gemini 协议格式。
/// 兼容：
///   - output[].content[].type = "output_text" | "text"  → parts[].text
///   - output[].content[].type = "tool_use" | "function_call" → parts[].functionCall
///   - usage.input_tokens / output_tokens / total_tokens
fn parse_responses_api_response(json_val: &Value, default_model: &str) -> Value {
    let model_name = json_val
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(default_model);
    let mut parts: Vec<Value> = Vec::new();

    // 解析 usage（/v1/responses 使用 input_tokens / output_tokens）
    let usage = json_val.get("usage");
    let prompt_tokens = usage
        .and_then(|u| u.get("input_tokens").or_else(|| u.get("prompt_tokens")))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .and_then(|u| {
            u.get("output_tokens")
                .or_else(|| u.get("completion_tokens"))
        })
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .and_then(|u| u.get("total_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(prompt_tokens + completion_tokens);

    // 解析 output 数组
    if let Some(output) = json_val.get("output").and_then(Value::as_array) {
        for (item_idx, item) in output.iter().enumerate() {
            if let Some(content_arr) = item.get("content").and_then(Value::as_array) {
                for c in content_arr {
                    let ctype = c.get("type").and_then(Value::as_str).unwrap_or("");
                    match ctype {
                        "output_text" | "text" => {
                            if let Some(txt) = c.get("text").and_then(Value::as_str) {
                                parts.push(json!({ "text": txt }));
                            }
                        }
                        "tool_use" | "function_call" => {
                            let call_id = c
                                .get("id")
                                .and_then(Value::as_str)
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("call_{}", item_idx + 1));
                            let name = c.get("name").and_then(Value::as_str).unwrap_or("tool");
                            let raw_args = c
                                .get("arguments")
                                .or_else(|| c.get("input"))
                                .cloned()
                                .unwrap_or(json!({}));
                            let (parsed_args, args_str) = if let Some(s) = raw_args.as_str() {
                                let parsed: Value =
                                    serde_json::from_str(s).unwrap_or_else(|_| json!({}));
                                (parsed, s.to_string())
                            } else {
                                let s = serde_json::to_string(&raw_args)
                                    .unwrap_or_else(|_| "{}".to_string());
                                (raw_args, s)
                            };
                            parts.push(json!({
                                "functionCall": {
                                    "id": call_id,
                                    "name": name,
                                    "args": parsed_args,
                                    "argsJson": args_str
                                }
                            }));
                        }
                        _ => {
                            // 兜底：尝试顶层 text 字段
                            if let Some(txt) = c.get("text").and_then(Value::as_str) {
                                parts.push(json!({ "text": txt }));
                            }
                        }
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        parts.push(json!({ "text": "（模型未输出可展示的正文内容）" }));
    }

    json!({
        "content": { "role": "model", "parts": parts },
        "finishReason": "STOP",
        "usageMetadata": {
            "promptTokenCount": prompt_tokens,
            "candidatesTokenCount": completion_tokens,
            "totalTokenCount": total_tokens
        },
        "customMetadata": { "model_name": model_name, "bridge": "ai-helper" },
        "turnComplete": true,
        "partial": false
    })
}

/// 底层执行单次 LLM 上游请求
///
/// - Claude → /v1/messages (Anthropic Messages 协议)
/// - GPT/o1/o3/o4 → /v1/responses (OpenAI Responses 协议)
/// - 其他 (DeepSeek/Qwen/通义等) → /v1/chat/completions (标准 Chat 协议)
async fn execute_single_llm_call(
    client: &Client,
    config: &AccioConfig,
    root: &str,
    actual_model: &str,
    endpoint_type: protocol::ApiEndpoint,
    chat_body: &Value,
) -> Result<Value, (Option<StatusCode>, String)> {
    let endpoint = format!("{root}{}", endpoint_type.path());
    let request_body = match endpoint_type {
        protocol::ApiEndpoint::Messages => protocol::chat_to_anthropic_body(chat_body),
        protocol::ApiEndpoint::Responses => chat_to_responses_body(chat_body),
        protocol::ApiEndpoint::ChatCompletions => {
            let mut body = chat_body.clone();
            body["stream"] = json!(false);
            body
        }
    };

    let mut req = client
        .post(&endpoint)
        .json(&request_body)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Helper/1.0",
        )
        .timeout(Duration::from_secs(180));

    match endpoint_type {
        protocol::ApiEndpoint::Messages => {
            // Anthropic 原生使用 x-api-key，中转站通常也接受 Bearer
            req = req
                .bearer_auth(&config.api_key)
                .header("x-api-key", &config.api_key)
                .header("anthropic-version", "2023-06-01");
        }
        _ => {
            req = req.bearer_auth(&config.api_key);
        }
    }

    let response = req
        .send()
        .await
        .map_err(|e| (None, format!("请求上游服务失败: {}", e)))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| (Some(status), format!("读取上游响应内容失败: {}", e)))?;

    if body_bytes.len() > MAX_RESPONSE_SIZE {
        return Err((
            Some(status),
            format!(
                "上游响应体过大 ({} MB)，超过 {} MB 上限",
                body_bytes.len() / 1024 / 1024,
                MAX_RESPONSE_SIZE / 1024 / 1024
            ),
        ));
    }

    let text = String::from_utf8_lossy(&body_bytes).to_string();

    if !status.is_success() {
        let err_preview = if text.chars().count() > 300 {
            format!("{}...", protocol::safe_truncate_head(&text, 300))
        } else {
            text
        };
        return Err((
            Some(status),
            format!("上游服务返回 HTTP {}: {}", status, err_preview),
        ));
    }

    // 精确判定 SSE：优先 Content-Type，次选文本首行判定，避免大模型文本内容含 "data:" 误触发
    let trimmed = text.trim_start();
    let is_sse = content_type.contains("text/event-stream")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("event:");

    let payload = match endpoint_type {
        // ── Anthropic /v1/messages ──
        protocol::ApiEndpoint::Messages => {
            if is_sse {
                protocol::merge_anthropic_sse(&text, actual_model)
            } else {
                let json_val: Value = serde_json::from_str(&text).map_err(|e| {
                    (
                        Some(status),
                        format!("解析 Anthropic 响应 JSON 失败: {}", e),
                    )
                })?;
                protocol::parse_anthropic_response(&json_val, actual_model)
            }
        }
        // ── OpenAI /v1/responses ──
        protocol::ApiEndpoint::Responses => {
            if is_sse {
                let mut text_buf = String::new();
                let mut full_response: Option<Value> = None;

                for line in text.lines() {
                    let trimmed = line.trim();
                    if let Some(stripped) = trimmed.strip_prefix("data:") {
                        let data = stripped.trim();
                        if data == "[DONE]" || data.is_empty() {
                            continue;
                        }
                        if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                            if chunk.get("output").is_some() {
                                full_response = Some(chunk);
                                break;
                            }
                            if let Some(delta) = chunk
                                .pointer("/delta/text")
                                .or_else(|| chunk.pointer("/text"))
                                .and_then(Value::as_str)
                            {
                                text_buf.push_str(delta);
                            }
                        }
                    }
                }

                if let Some(resp) = full_response {
                    parse_responses_api_response(&resp, actual_model)
                } else if !text_buf.is_empty() {
                    json!({
                        "content": {"role": "model", "parts": [{"text": text_buf}]},
                        "finishReason": "STOP",
                        "usageMetadata": {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0},
                        "customMetadata": {"model_name": actual_model, "bridge": "ai-helper"},
                        "turnComplete": true,
                        "partial": false
                    })
                } else {
                    return Err((
                        Some(status),
                        "上游 Responses API 返回了空的流式数据".to_string(),
                    ));
                }
            } else {
                let json_val: Value = serde_json::from_str(&text).map_err(|e| {
                    (
                        Some(status),
                        format!("解析 Responses API 响应 JSON 失败: {}", e),
                    )
                })?;
                parse_responses_api_response(&json_val, actual_model)
            }
        }
        // ── OpenAI /v1/chat/completions ──
        protocol::ApiEndpoint::ChatCompletions => {
            if is_sse {
                let mut chunks: Vec<Value> = Vec::new();
                for line in text.lines() {
                    let trimmed = line.trim();
                    if let Some(stripped) = trimmed.strip_prefix("data:") {
                        let data = stripped.trim();
                        if data == "[DONE]" || data.is_empty() {
                            continue;
                        }
                        if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                            chunks.push(chunk);
                        }
                    }
                }
                if chunks.is_empty() {
                    return Err((Some(status), "上游返回了空的流式数据".to_string()));
                }
                protocol::merge_openai_chunks(&chunks)
            } else {
                let json_val: Value = serde_json::from_str(&text)
                    .map_err(|e| (Some(status), format!("解析上游 JSON 响应失败: {}", e)))?;
                protocol::merge_openai_chunks(&[json_val])
            }
        }
    };

    Ok(payload)
}

/// 请求上游服务 (根据模型名自动路由至对应 API 端点，支持端点智能降级)
/// - Claude 优先 → /v1/messages；若中转站未实现则自动降级 → /v1/chat/completions
/// - GPT/o1/o3/DeepSeek/通义等 → /v1/chat/completions (兼容所有第三方中转站)
async fn call_upstream_llm(
    client: &Client,
    config: &AccioConfig,
    input: Value,
) -> Result<Value, String> {
    if config.api_key.trim().is_empty() {
        return Err("API 密钥未配置，请先在 AI-Helper 中填写 API Key".to_string());
    }

    let root = clean_base_url(&config.base_url);

    // 提取实际使用的模型 (支持 AccioWork 下拉框选择不同模型)
    let requested = protocol::extract_requested_model(&input, &config.model);
    let actual_model = if requested.is_empty() || requested.eq_ignore_ascii_case("auto") {
        config.model.as_str()
    } else {
        requested
    };

    // 根据模型名称自动检测主要端点
    let primary_endpoint = protocol::detect_api_endpoint(actual_model);

    log::info!(
        "Accio LLM 路由: 模型 '{}' → {} (主端点: {}{})",
        actual_model,
        primary_endpoint.label(),
        root,
        primary_endpoint.path()
    );

    // 1. 先统一转译为 OpenAI Chat Completions 中间格式
    let chat_body = accio_to_openai(&input, actual_model);

    let started = Instant::now();

    // 2. 发起请求并支持智能降级
    let (payload, final_endpoint) = match execute_single_llm_call(
        client,
        config,
        root,
        actual_model,
        primary_endpoint,
        &chat_body,
    )
    .await
    {
        Ok(p) => (p, primary_endpoint),
        Err((status_opt, err_msg)) => {
            // 如果主要端点是 Messages 且收到 404, 501 或 500 (not implemented / convert_request_failed)，
            // 说明中转站是按 OpenAI 规范提供 Claude 服务的，自动降级至 /v1/chat/completions 重试
            let is_not_implemented = status_opt == Some(StatusCode::NOT_FOUND)
                || status_opt == Some(StatusCode::NOT_IMPLEMENTED)
                || (status_opt == Some(StatusCode::INTERNAL_SERVER_ERROR)
                    && (err_msg.contains("not implemented")
                        || err_msg.contains("convert_request_failed")
                        || err_msg.contains("endpoint not found")));

            if primary_endpoint == ApiEndpoint::Messages && is_not_implemented {
                log::warn!(
                    "上游 /v1/messages 端点响应 HTTP {:?} ({})，中转站可能仅支持 OpenAI 协议，正在自动降级尝试 /v1/chat/completions...",
                    status_opt,
                    err_msg
                );
                let fallback_endpoint = ApiEndpoint::ChatCompletions;
                match execute_single_llm_call(
                    client,
                    config,
                    root,
                    actual_model,
                    fallback_endpoint,
                    &chat_body,
                )
                .await
                {
                    Ok(p) => {
                        log::info!("自动降级至 /v1/chat/completions 成功！");
                        (p, fallback_endpoint)
                    }
                    Err((_, fb_err)) => {
                        return Err(format!(
                            "上游 Messages 失败 ({})，降级 chat/completions 亦失败: {}",
                            err_msg, fb_err
                        ));
                    }
                }
            } else {
                return Err(err_msg);
            }
        }
    };

    log::info!(
        "Accio 请求在 {} ms 内转译并完成 (模型: {}, 端点: {})",
        started.elapsed().as_millis(),
        actual_model,
        final_endpoint.label()
    );
    Ok(payload)
}

/// 处理 Accio Work 的生图请求 (responseModalities: ["IMAGE"])
async fn call_custom_image(
    client: &Client,
    config: &AccioConfig,
    input: Value,
) -> Result<Value, String> {
    if config.api_key.trim().is_empty() {
        return Err("API 密钥未配置，请先在 AI-Helper 中填写 API Key".to_string());
    }
    let root = clean_base_url(&config.base_url);
    let endpoint = format!("{root}/v1/images/generations");

    let mut prompts = Vec::new();
    if let Some(contents) = input
        .get("contents")
        .or_else(|| input.get("messages"))
        .and_then(Value::as_array)
    {
        for item in contents {
            if let Some(parts) = item.get("parts").and_then(Value::as_array) {
                for part in parts {
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        prompts.push(t);
                    }
                }
            } else if let Some(content) = item.get("content").and_then(Value::as_str) {
                prompts.push(content);
            }
        }
    }
    let prompt = if prompts.is_empty() {
        "Generate a high quality commercial product photo".to_string()
    } else {
        prompts.join("\n\n")
    };

    let gen_config = input
        .get("generationConfig")
        .or_else(|| input.get("generation_config"));
    let aspect_ratio = gen_config
        .and_then(|g| g.get("imageConfig").or_else(|| g.get("image_config")))
        .and_then(|ic| ic.get("aspectRatio").or_else(|| ic.get("aspect_ratio")))
        .and_then(Value::as_str)
        .unwrap_or("1:1");

    let size = match aspect_ratio {
        "16:9" | "3:2" => "1792x1024",
        "9:16" | "2:3" | "3:4" => "1024x1792",
        _ => "1024x1024",
    };

    let image_model = "dall-e-3";

    log::info!(
        "Accio 生图转译：目标端点 {} (模型: {}, 尺寸: {}, prompt: {} 字符)",
        endpoint,
        image_model,
        size,
        prompt.chars().count()
    );

    let req_payload = json!({
        "model": image_model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "response_format": "b64_json"
    });

    let resp = client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .json(&req_payload)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("请求生图服务失败: {}", e))?;

    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("读取生图响应失败: {}", e))?;

    if !status.is_success() {
        let err_preview = if body_text.chars().count() > 300 {
            let truncated = crate::accio::protocol::safe_truncate_head(&body_text, 300);
            format!("{}...", truncated)
        } else {
            body_text
        };
        return Err(format!("上游生图接口返回 HTTP {}: {}", status, err_preview));
    }

    let payload: Value =
        serde_json::from_str(&body_text).map_err(|e| format!("解析生图响应 JSON 失败: {}", e))?;

    let mut b64_opt: Option<String> = None;
    if let Some(data_arr) = payload.get("data").and_then(Value::as_array) {
        if let Some(first) = data_arr.first() {
            if let Some(b64) = first.get("b64_json").and_then(Value::as_str) {
                b64_opt = Some(b64.to_string());
            } else if let Some(img_url) = first.get("url").and_then(Value::as_str) {
                if let Ok(img_resp) = client
                    .get(img_url)
                    .timeout(Duration::from_secs(30))
                    .send()
                    .await
                {
                    if let Ok(bytes) = img_resp.bytes().await {
                        use base64::Engine;
                        b64_opt = Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
                    }
                }
            }
        }
    }

    let b64_str =
        b64_opt.ok_or_else(|| "生图接口未返回有效的图像数据 (b64_json / url)".to_string())?;

    Ok(json!({
        "content": {
            "role": "model",
            "parts": [{
                "inlineData": {
                    "mimeType": "image/png",
                    "data": b64_str
                }
            }]
        },
        "turnComplete": true,
        "partial": false,
        "finishReason": "STOP",
        "customMetadata": {
            "model_name": image_model,
            "bridge": "ai-helper-image"
        }
    }))
}

/// ANY /*: 透明反向代理至阿里巴巴官方网关 (保留 Cookies, 授权与原样数据)
async fn proxy_official(State(client): State<Client>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let path = parts
        .uri
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| parts.uri.path().to_string());

    let bytes = match axum::body::to_bytes(body, 64 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("无法读取待代理请求体: {}", e),
            )
                .into_response();
        }
    };

    forward_to_official(&client, parts.method, parts.headers, &path, bytes).await
}

async fn forward_to_official(
    client: &Client,
    method: axum::http::Method,
    headers: HeaderMap,
    path: &str,
    body: Bytes,
) -> Response {
    match forward_to_official_result(client, method, headers, path, body).await {
        Ok(response) => response,
        Err((status, message)) => (
            status,
            Json(json!({"error_message": format!("阿里官方网关透明反向代理失败: {}", message)})),
        )
            .into_response(),
    }
}

/// 端到端请求头白名单，排除 hop-by-hop 头
const END_TO_END_REQUEST_HEADERS: &[&str] = &[
    "accept",
    "accept-encoding",
    "accept-language",
    "authorization",
    "cache-control",
    "content-type",
    "cookie",
    "origin",
    "referer",
    "user-agent",
    "x-request-id",
    "x-forwarded-for",
    "x-real-ip",
];

/// 端到端响应头白名单，排除 hop-by-hop 头
const END_TO_END_RESPONSE_HEADERS: &[&str] = &[
    "cache-control",
    "content-type",
    "date",
    "etag",
    "expires",
    "last-modified",
    "set-cookie",
    "vary",
    "x-request-id",
];

fn is_end_to_end_request_header(name: &str) -> bool {
    END_TO_END_REQUEST_HEADERS
        .iter()
        .any(|&h| name.eq_ignore_ascii_case(h))
}

fn is_end_to_end_response_header(name: &str) -> bool {
    END_TO_END_RESPONSE_HEADERS
        .iter()
        .any(|&h| name.eq_ignore_ascii_case(h))
}

async fn forward_to_official_result(
    client: &Client,
    method: axum::http::Method,
    headers: HeaderMap,
    path: &str,
    body: Bytes,
) -> Result<Response, (StatusCode, String)> {
    let config = load_accio_config();
    let url = format!("{}{}", config.official_gateway.trim_end_matches('/'), path);

    let mut req = client.request(method, &url).body(body);
    for (name, val) in &headers {
        if is_end_to_end_request_header(name.as_str()) {
            req = req.header(name, val);
        }
    }

    let upstream = req
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let stream = upstream.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    for (name, val) in upstream_headers {
        if let Some(name) = name {
            if is_end_to_end_response_header(name.as_str()) {
                response.headers_mut().insert(name, val);
            }
        }
    }
    Ok(response)
}

async fn proxy_official_stream(
    client: &Client,
    config: &AccioConfig,
    method: axum::http::Method,
    headers: HeaderMap,
    path: &str,
    body: Bytes,
    tx: tokio::sync::mpsc::Sender<Result<Bytes, std::convert::Infallible>>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    let url = format!("{}{}", config.official_gateway.trim_end_matches('/'), path);

    let mut req = client.request(method, &url).body(body);
    for (name, val) in &headers {
        if is_end_to_end_request_header(name.as_str()) {
            req = req.header(name, val);
        }
    }

    let upstream = req.send().await.map_err(|e| e.to_string())?;
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // 如果不是 SSE 响应且状态码异常，转换为 Accio SSE 错误帧
    if !status.is_success() && !content_type.contains("text/event-stream") {
        let body_bytes = upstream.bytes().await.map_err(|e| e.to_string())?;
        let preview = String::from_utf8_lossy(&body_bytes);
        let preview = crate::accio::protocol::safe_truncate_head(&preview, 500);

        let err_frame = serde_json::json!({
            "errorCode": status.as_u16().to_string(),
            "errorMessage": format!("官方网关返回 HTTP {}: {}", status, preview),
            "turnComplete": true,
            "partial": false
        });
        let sse_str = format_accio_sse(&err_frame);
        let _ = tx.send(Ok(Bytes::from(sse_str))).await;
        return Ok(());
    }

    // SSE 响应原样流式转发
    let mut stream = upstream.bytes_stream();
    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(b) => {
                if tx.send(Ok(b)).await.is_err() {
                    break;
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn decode_request_body_supports_gzip() {
        let source = br#"{"contents":[{"parts":[{"text":"hello"}]}]}"#;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(source).expect("compress request");
        let compressed = Bytes::from(encoder.finish().expect("finish gzip"));

        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static("gzip"),
        );
        let decoded = decode_request_body(&headers, compressed).expect("decode gzip");
        assert_eq!(decoded.as_ref(), source);
    }

    #[test]
    fn decode_request_body_rejects_unknown_encoding() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static("br"),
        );
        let error = decode_request_body(&headers, Bytes::from_static(b"{}"))
            .expect_err("unknown encoding must fail");
        assert_eq!(error.0, StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert!(error.1.contains("Content-Encoding"));
    }

    #[test]
    fn decode_request_body_rejects_gzip_bomb() {
        // 模拟 gzip 炸弹：压缩前很小，解压后超过上限
        let huge = vec![b'A'; MAX_DECOMPRESSED_SIZE + 1024];
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&huge).expect("compress bomb");
        let compressed = Bytes::from(encoder.finish().expect("finish gzip"));

        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_ENCODING,
            header::HeaderValue::from_static("gzip"),
        );
        let error =
            decode_request_body(&headers, compressed).expect_err("gzip bomb must be rejected");
        assert_eq!(error.0, StatusCode::PAYLOAD_TOO_LARGE);
        assert!(error.1.contains("超过"));
    }

    #[test]
    fn end_to_end_headers_filter_hop_by_hop() {
        assert!(is_end_to_end_request_header("authorization"));
        assert!(is_end_to_end_request_header("content-type"));
        assert!(!is_end_to_end_request_header("connection"));
        assert!(!is_end_to_end_request_header("transfer-encoding"));
        assert!(!is_end_to_end_request_header("upgrade"));

        assert!(is_end_to_end_response_header("content-type"));
        assert!(is_end_to_end_response_header("set-cookie"));
        assert!(!is_end_to_end_response_header("connection"));
        assert!(!is_end_to_end_response_header("transfer-encoding"));
    }

    #[test]
    fn clean_base_url_removes_trailing_slash_and_v1() {
        assert_eq!(
            clean_base_url("https://api.example.com/"),
            "https://api.example.com"
        );
        assert_eq!(
            clean_base_url("https://api.example.com/v1"),
            "https://api.example.com"
        );
        assert_eq!(
            clean_base_url("https://api.example.com/v1/"),
            "https://api.example.com"
        );
        assert_eq!(
            clean_base_url("https://api.example.com"),
            "https://api.example.com"
        );
    }
}

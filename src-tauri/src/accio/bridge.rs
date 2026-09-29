use crate::accio::config::{load_accio_config, save_accio_config, AccioConfig};
use crate::accio::protocol::{
    accio_to_openai, format_accio_sse, merge_openai_chunks, SSE_HEARTBEAT,
};
use axum::{
    body::{Body, Bytes},
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures_util::Stream;
use reqwest::Client;
use serde_json::{json, Value};
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

/// 判断当前 Bridge 是否正在运行
pub fn is_bridge_running() -> bool {
    RUNNING_BRIDGE.lock().unwrap().is_some()
}

/// 获取当前 Bridge 实际监听端口
pub fn get_bridge_port() -> Option<u16> {
    RUNNING_BRIDGE.lock().unwrap().as_ref().map(|h| h.port)
}

/// 规整并去除 Base URL 结尾的斜杠与重复 /v1，避免生成 /v1/v1/... 路径
pub fn clean_base_url(url: &str) -> &str {
    let trimmed = url.trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

/// 查找空闲端口 (在 start_port..=start_port+20 范围内扫描)
pub async fn find_available_port(start_port: u16) -> Result<u16, String> {
    // 对首选端口进行快速重试 (针对刚停机后 TCP 端口处于短暂释放延时场景)
    for retry in 0..5 {
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", start_port)) {
            drop(listener);
            return Ok(start_port);
        }
        if retry < 4 {
            tokio::time::sleep(Duration::from_millis(60)).await;
        }
    }
    for offset in 1..20 {
        let port = start_port.saturating_add(offset);
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", port)) {
            drop(listener);
            return Ok(port);
        }
    }
    Err(format!(
        "无法在端口 {}..={} 找到可用端口，请检查是否有残留进程占用",
        start_port,
        start_port.saturating_add(20)
    ))
}

/// 启动 Accio Local Bridge 中继服务器
pub async fn start_bridge(preferred_port: Option<u16>) -> Result<u16, String> {
    {
        let guard = RUNNING_BRIDGE.lock().unwrap();
        if let Some(ref handle) = *guard {
            if preferred_port.is_none() || preferred_port == Some(handle.port) {
                return Ok(handle.port);
            }
        }
    }

    // 若当前正在运行但需要切换不同端口，先停止现存 bridge
    if is_bridge_running() {
        stop_bridge().await?;
    }

    let config = load_accio_config();
    let base_port = preferred_port.unwrap_or(config.bridge_port);
    let target_port = find_available_port(base_port).await?;

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

    let listener = TcpListener::bind(("127.0.0.1", target_port))
        .await
        .map_err(|e| format!("绑定端口 127.0.0.1:{} 失败: {}", target_port, e))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let app = Router::new()
        .route("/api/llm/config/v2", get(custom_model_list))
        .route("/api/tool/rlab/call", post(handle_tool_rlab_call))
        .route("/api/adk/embedding/embed", post(handle_embedding))
        .route("/api/adk/llm", post(handle_llm))
        .route("/api/adk/llm/*path", post(handle_llm))
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
            let _ = shutdown_rx.await;
            log::info!("Accio Local Bridge 收到退出信号，正在关闭服务...");
        });

        if let Err(e) = graceful.await {
            log::error!("Accio Local Bridge 服务运行异常退出: {}", e);
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
        let _ = tokio::time::timeout(Duration::from_millis(1000), handle.join_handle).await;
        log::info!("已释放 Accio Bridge 端口 {}", handle.port);
    }
    Ok(())
}

/// GET /api/llm/config/v2: 伪造模型列表，使 Accio Work 下拉框识别并选中当前配置的模型
async fn custom_model_list() -> Json<Value> {
    let config = load_accio_config();
    Json(json!([{
        "provider": "ai-helper",
        "providerDisplayName": "AI-Helper",
        "modelList": [{
            "modelCode": config.model,
            "modelName": config.model,
            "modelDisplayName": config.model,
            "modelDesc": format!("{} via AI-Helper", config.model),
            "visible": true,
            "isDefault": true,
            "freeUse": true,
            "multimodal": true,
            "contextWindow": 128000,
            "reasoningEfforts": ["low", "medium", "high"],
            "defaultReasoningEffort": "medium"
        }]
    }]))
}

/// POST /api/tool/rlab/call: 处理 Accio 内部的自动模型路由请求 (model_routing)
async fn handle_tool_rlab_call(
    State(client): State<Client>,
    headers: HeaderMap,
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
async fn handle_embedding(State(client): State<Client>, body: Bytes) -> Response {
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

    let texts = input
        .get("texts")
        .or_else(|| input.get("input"))
        .cloned()
        .unwrap_or_else(|| json!([]));
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
            match upstream_res.json::<Value>().await {
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
    let bytes = match axum::body::to_bytes(body, 32 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error_code": 400, "error_message": format!("无法读取请求体: {}", e)})),
            )
                .into_response();
        }
    };

    let input: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("收到非 JSON 格式 LLM 数据包，透明转交官方网关: {}", e);
            let path = parts
                .uri
                .path_and_query()
                .map(|p| p.as_str())
                .unwrap_or(parts.uri.path());
            return forward_to_official(&client, parts.method, parts.headers, path, bytes).await;
        }
    };

    let config = load_accio_config();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::convert::Infallible>>(32);

    // 建立连接立即返回连通注释帧
    let _ = tx.send(Ok(Bytes::from(": ai-helper connected\n\n"))).await;

    // 异步执行转译与请求上游，同时保活心跳
    let client_clone = client.clone();
    let config_clone = config.clone();
    let method_clone = parts.method.clone();
    let headers_clone = parts.headers.clone();
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

        let upstream_fut = async { call_upstream_llm(&client_clone, &config_clone, input).await };
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
                    let err_frame = json!({
                        "errorCode": "502",
                        "errorMessage": format!("上游自定义模型报错: {}; 官方网关回退失败: {}", err, proxy_err),
                        "turnComplete": true,
                        "partial": false
                    });
                    let _ = tx.send(Ok(Bytes::from(format_accio_sse(&err_frame)))).await;
                }
            } else {
                let err_frame = json!({
                    "errorCode": "502",
                    "errorMessage": err,
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

/// 请求上游 OpenAI 兼容服务
async fn call_upstream_llm(
    client: &Client,
    config: &AccioConfig,
    input: Value,
) -> Result<Value, String> {
    if config.api_key.trim().is_empty() {
        return Err("API 密钥未配置，请先在 AI-Helper 中填写 API Key".to_string());
    }
    let root = clean_base_url(&config.base_url);
    let endpoint = format!("{root}/v1/chat/completions");
    let request_body = accio_to_openai(&input, &config.model);

    let started = Instant::now();
    let response = client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .json(&request_body)
        .timeout(Duration::from_secs(180))
        .send()
        .await
        .map_err(|e| format!("请求上游服务失败: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取上游响应内容失败: {}", e))?;

    if !status.is_success() {
        let err_preview = if text.chars().count() > 300 {
            let truncated = crate::accio::protocol::safe_truncate_head(&text, 300);
            format!("{}...", truncated)
        } else {
            text
        };
        return Err(format!("上游服务返回 HTTP {}: {}", status, err_preview));
    }

    let payload = if text.contains("data:") {
        // SSE 流式响应
        let mut chunks = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(stripped) = trimmed.strip_prefix("data:") {
                let data = stripped.trim();
                if data == "[DONE]" || data.is_empty() {
                    continue;
                }
                if let Ok(chunk_json) = serde_json::from_str::<Value>(data) {
                    chunks.push(chunk_json);
                }
            }
        }
        if chunks.is_empty() {
            return Err("上游返回了空的流式数据".to_string());
        }
        merge_openai_chunks(&chunks)
    } else {
        // 非流式 JSON 响应
        let json_val: Value =
            serde_json::from_str(&text).map_err(|e| format!("解析上游 JSON 响应失败: {}", e))?;

        let choice = json_val
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|cs| cs.first());

        if let Some(c) = choice {
            let model_name = json_val
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or(&config.model);

            let mut parts = Vec::new();
            if let Some(msg) = c.get("message") {
                if let Some(content) = msg.get("content").and_then(Value::as_str) {
                    parts.push(json!({ "text": content }));
                } else if let Some(rc) = msg
                    .get("reasoning_content")
                    .or_else(|| msg.get("reasoning"))
                    .and_then(Value::as_str)
                {
                    parts.push(json!({ "text": rc }));
                }
                if let Some(tcs) = msg.get("tool_calls").and_then(Value::as_array) {
                    for (i, tc) in tcs.iter().enumerate() {
                        let call_id = tc
                            .get("id")
                            .and_then(Value::as_str)
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("call_{}", i + 1));
                        let func = tc.get("function");
                        let name = func
                            .and_then(|f| f.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        let args_str = func
                            .and_then(|f| f.get("arguments"))
                            .and_then(Value::as_str)
                            .unwrap_or("{}");
                        let args: Value =
                            serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
                        parts.push(json!({
                            "functionCall": {
                                "id": call_id,
                                "name": name,
                                "args": args
                            }
                        }));
                    }
                }
            }

            let usage = json_val.get("usage");
            json!({
                "content": {
                    "role": "model",
                    "parts": parts
                },
                "finishReason": c.get("finish_reason").and_then(Value::as_str).unwrap_or("STOP"),
                "usageMetadata": {
                    "promptTokenCount": usage.and_then(|u| u.get("prompt_tokens")).unwrap_or(&json!(0)),
                    "candidatesTokenCount": usage.and_then(|u| u.get("completion_tokens")).unwrap_or(&json!(0)),
                    "totalTokenCount": usage.and_then(|u| u.get("total_tokens")).unwrap_or(&json!(0))
                },
                "customMetadata": {
                    "model_name": model_name,
                    "bridge": "ai-helper"
                },
                "turnComplete": true,
                "partial": false
            })
        } else {
            json_val
        }
    };

    log::info!(
        "Accio 请求在 {} ms 内转译并完成 (模型: {})",
        started.elapsed().as_millis(),
        config.model
    );
    Ok(payload)
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
    let config = load_accio_config();
    let url = format!("{}{}", config.official_gateway.trim_end_matches('/'), path);

    let mut req = client.request(method, &url).body(body);
    for (name, val) in &headers {
        if name.as_str().eq_ignore_ascii_case("host")
            || name.as_str().eq_ignore_ascii_case("content-length")
        {
            continue;
        }
        req = req.header(name, val);
    }

    match req.send().await {
        Ok(upstream) => {
            let status = upstream.status();
            let upstream_headers = upstream.headers().clone();
            let stream = upstream.bytes_stream();
            let mut response = Response::new(Body::from_stream(stream));
            *response.status_mut() = status;
            for (name, val) in upstream_headers {
                if let Some(name) = name {
                    if name.as_str().eq_ignore_ascii_case("content-length")
                        || name.as_str().eq_ignore_ascii_case("content-encoding")
                    {
                        continue;
                    }
                    response.headers_mut().insert(name, val);
                }
            }
            response
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error_message": format!("阿里官方网关透明反向代理失败: {}", e)})),
        )
            .into_response(),
    }
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
        if name.as_str().eq_ignore_ascii_case("host")
            || name.as_str().eq_ignore_ascii_case("content-length")
        {
            continue;
        }
        req = req.header(name, val);
    }

    let upstream = req.send().await.map_err(|e| e.to_string())?;
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

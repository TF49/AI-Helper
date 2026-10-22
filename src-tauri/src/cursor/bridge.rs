use crate::cursor::config::load_cursor_config;
use crate::cursor::protocol::{
    create_connect_end_frame, create_connect_error_stream, create_connect_text_chunk,
    cursor_to_openai_request, decode_connect_or_json, extract_openai_delta_content,
    format_connect_available_models, format_openai_models_response,
};
use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{header, StatusCode},
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
    time::Duration,
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

pub struct CursorBridgeHandle {
    pub port: u16,
    shutdown_tx: oneshot::Sender<()>,
    join_handle: tokio::task::JoinHandle<()>,
}

static RUNNING_CURSOR_BRIDGE: Mutex<Option<CursorBridgeHandle>> = Mutex::new(None);

pub fn is_bridge_running() -> bool {
    RUNNING_CURSOR_BRIDGE
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}

pub fn get_bridge_port() -> Option<u16> {
    RUNNING_CURSOR_BRIDGE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|h| h.port))
}

pub async fn start_bridge(port: Option<u16>) -> Result<u16, String> {
    {
        let guard = RUNNING_CURSOR_BRIDGE
            .lock()
            .map_err(|e| format!("锁获取失败: {}", e))?;

        if let Some(ref handle) = *guard {
            if !handle.join_handle.is_finished() {
                return Ok(handle.port);
            }
        }
    }

    let config = load_cursor_config();
    let target_port = port.unwrap_or(config.bridge_port);

    let listener = TcpListener::bind(("127.0.0.1", target_port))
        .await
        .map_err(|e| format!("无法绑定本地端口 127.0.0.1:{}: {}", target_port, e))?;

    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("无法获取实际端口: {}", e))?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/v1/models", get(handle_openai_models))
        .route("/v1/chat/completions", post(handle_openai_chat))
        .route(
            "/aiserver.v1.AiService/AvailableModels",
            post(handle_connect_available_models),
        )
        .route(
            "/aiserver.v1.AiService/GetUsage",
            post(handle_connect_get_usage),
        )
        .route(
            "/aiserver.v1.AiService/GetSubscription",
            post(handle_connect_get_subscription),
        )
        .route(
            "/aiserver.v1.AiService/GetUserInfo",
            post(handle_connect_get_user_info),
        )
        .route(
            "/aiserver.v1.AiService/ServerTime",
            post(handle_connect_server_time),
        )
        .route(
            "/aiserver.v1.AiService/HealthCheck",
            post(handle_connect_health_check),
        )
        .route(
            "/aiserver.v1.AiService/PrivacyCheck",
            post(handle_connect_privacy_check),
        )
        .route(
            "/aiserver.v1.AiService/CheckComposerMeshAuth",
            post(handle_connect_mesh_auth),
        )
        .route(
            "/aiserver.v1.AiService/CheckUploadStatus",
            post(handle_connect_upload_status),
        )
        .route(
            "/aiserver.v1.AiService/StreamChat",
            post(handle_connect_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamComposer",
            post(handle_connect_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamComposerIteration",
            post(handle_connect_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamEdit",
            post(handle_connect_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamFastEdit",
            post(handle_connect_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamGenerate",
            post(handle_connect_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamChatWeb",
            post(handle_connect_stream),
        )
        .fallback(any(handle_fallback))
        .layer(CorsLayer::permissive());

    let join_handle = tokio::spawn(async move {
        let server = axum::serve(listener, app);
        let _ = server
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    {
        let mut guard = RUNNING_CURSOR_BRIDGE
            .lock()
            .map_err(|e| format!("锁获取失败: {}", e))?;
        *guard = Some(CursorBridgeHandle {
            port: actual_port,
            shutdown_tx,
            join_handle,
        });
    }

    log::info!(
        "AI-Helper Cursor Bridge 已在 127.0.0.1:{} 启动",
        actual_port
    );
    Ok(actual_port)
}

pub async fn stop_bridge() -> Result<(), String> {
    let handle_opt = {
        let mut guard = RUNNING_CURSOR_BRIDGE
            .lock()
            .map_err(|e| format!("锁获取失败: {}", e))?;
        guard.take()
    };

    if let Some(handle) = handle_opt {
        let _ = handle.shutdown_tx.send(());
        let _ = tokio::time::timeout(Duration::from_millis(1500), handle.join_handle).await;
        tokio::time::sleep(Duration::from_millis(150)).await;
        log::info!("AI-Helper Cursor Bridge 已停止 (释放端口 {})", handle.port);
    }
    Ok(())
}

async fn handle_health() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "ai-helper-cursor-bridge"
    }))
}

async fn handle_openai_models() -> impl IntoResponse {
    let cfg = load_cursor_config();
    Json(format_openai_models_response(&cfg.custom_models))
}

async fn handle_connect_available_models() -> impl IntoResponse {
    let cfg = load_cursor_config();
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(format_connect_available_models(&cfg.custom_models)),
    )
}

async fn handle_connect_get_usage() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({
            "fastRequests": 9999,
            "maxFastRequests": 10000,
            "numRequests": 1,
            "maxRequestUsage": 10000,
            "membershipType": "pro"
        })),
    )
}

async fn handle_connect_get_subscription() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({
            "isActive": true,
            "isPro": true,
            "membershipType": "pro",
            "canUseCopilot": true
        })),
    )
}

async fn handle_connect_get_user_info() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({
            "userId": "ai-helper-user",
            "user_id": "ai-helper-user",
            "jupyterToken": "ai-helper",
            "usage": {
                "gpt4_max_requests": 10000,
                "fastRequests": 10000
            }
        })),
    )
}

async fn handle_connect_server_time() -> impl IntoResponse {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(1700000000);
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({ "serverTime": now })),
    )
}

async fn handle_connect_health_check() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({ "healthy": true, "status": "ok" })),
    )
}

async fn handle_connect_privacy_check() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({ "isPrivacy": true, "privacy": true })),
    )
}

async fn handle_connect_mesh_auth() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({
            "isAuthenticated": true
        })),
    )
}

async fn handle_connect_upload_status() -> impl IntoResponse {
    (
        [(
            header::HeaderName::from_static("connect-protocol-version"),
            "1",
        )],
        Json(json!({
            "status": "ok"
        })),
    )
}

async fn handle_fallback(req: Request) -> Response {
    let path = req.uri().path().to_string();
    let content_type = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_connect_stream = path.contains("Stream")
        || content_type.contains("connect+")
        || content_type.contains("event-stream");

    log::debug!(
        "Cursor Bridge 捕获到辅助请求: {} (流式: {})",
        path,
        is_connect_stream
    );

    if is_connect_stream {
        // 针对未显式拦截的流式 RPC (如 StreamEdit / StreamFastEdit)，返回标准 Connect 尾帧优雅关闭
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/connect+json")
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_end_frame()))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header("connect-protocol-version", "1")
            .body(Body::from(
                serde_json::to_string(&json!({"status": "ok"})).unwrap_or_default(),
            ))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    }
}

/// 规整并去除 Base URL 结尾的斜杠与重复 /v1
fn clean_base_url(url: &str) -> &str {
    let trimmed = url.trim().trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

/// 处理 Connect-RPC 格式的流式请求 (StreamChat / StreamComposer / StreamEdit)
async fn handle_connect_stream(bytes: Bytes) -> Response {
    let config = load_cursor_config();
    if config.api_key.trim().is_empty() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/connect+json")
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_error_stream(
                "【AI-Helper 提示】请先在 AI-Helper 客户端的 Cursor 面板中配置并绑定有效 API Key。",
            )))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let parsed_body = decode_connect_or_json(&bytes).unwrap_or_else(|| json!({}));
    let openai_req = cursor_to_openai_request(&parsed_body, &config.model);

    let upstream_url = format!("{}/v1/chat/completions", clean_base_url(&config.base_url));
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .unwrap_or_default();

    let upstream_res = match client
        .post(&upstream_url)
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", config.api_key.trim()),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .json(&openai_req)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/connect+json")
                .header("connect-protocol-version", "1")
                .body(Body::from(create_connect_error_stream(&format!(
                    "【AI-Helper 错误】请求上游 API 失败: {}",
                    e
                ))))
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
        }
    };

    if !upstream_res.status().is_success() {
        let err_text = upstream_res.text().await.unwrap_or_default();
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/connect+json")
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_error_stream(&format!(
                "【AI-Helper 上游报错】{}",
                err_text
            ))))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);

    tokio::spawn(async move {
        use futures_util::StreamExt;
        let mut byte_stream = upstream_res.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_res) = byte_stream.next().await {
            match chunk_res {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    buffer.push_str(&text);

                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();

                        if let Some(content) = extract_openai_delta_content(&line) {
                            let frame = create_connect_text_chunk(&content);
                            if tx.send(Ok(Bytes::from(frame))).await.is_err() {
                                return;
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("上游流式读取错误: {}", e);
                    break;
                }
            }
        }

        // 发送结束帧
        let end_frame = create_connect_end_frame();
        let _ = tx.send(Ok(Bytes::from(end_frame))).await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/connect+json")
        .header("connect-protocol-version", "1")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
}

/// 处理标准 OpenAI 格式的 /v1/chat/completions 请求
async fn handle_openai_chat(Json(payload): Json<Value>) -> Response {
    let config = load_cursor_config();
    if config.api_key.trim().is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": {"message": "API Key is required in AI-Helper"}})),
        )
            .into_response();
    }

    let upstream_url = format!("{}/v1/chat/completions", clean_base_url(&config.base_url));
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .unwrap_or_default();

    let is_streaming = payload
        .get("stream")
        .and_then(|s| s.as_bool())
        .unwrap_or(false);

    let upstream_res = match client
        .post(&upstream_url)
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", config.api_key.trim()),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": {"message": format!("上游请求失败: {}", e)}})),
            )
                .into_response();
        }
    };

    if !is_streaming {
        let status = upstream_res.status();
        let json_body: Value = upstream_res.json().await.unwrap_or_else(|_| json!({}));
        return (status, Json(json_body)).into_response();
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);

    tokio::spawn(async move {
        use futures_util::StreamExt;
        let mut byte_stream = upstream_res.bytes_stream();
        while let Some(chunk_res) = byte_stream.next().await {
            match chunk_res {
                Ok(bytes) => {
                    if tx.send(Ok(bytes)).await.is_err() {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
}

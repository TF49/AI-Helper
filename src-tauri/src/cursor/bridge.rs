use crate::cursor::config::load_cursor_config;
use crate::cursor::protocol::{
    create_agent_heartbeat_chunk, create_agent_json_heartbeat_chunk, create_agent_json_text_chunk,
    create_agent_json_thinking_chunk, create_agent_text_chunk, create_agent_thinking_chunk,
    create_agent_turn_ended_chunk, create_connect_end_frame, create_connect_error_frame,
    create_connect_error_stream, create_connect_text_chunk, create_legacy_chat_response_chunk,
    create_legacy_fast_edit_response_chunk, create_legacy_rpc_error, decode_agent_client_message,
    decode_bidi_append, decode_bidi_request_id, decode_connect_or_json, decode_legacy_rpc_request,
    encode_connect_available_models_proto, encode_connect_default_model_for_cli_proto,
    encode_connect_default_model_proto, encode_connect_frame_raw,
    encode_connect_usable_models_proto, format_connect_available_models,
    format_connect_usable_models, format_openai_models_response, sanitize_tag_attribute,
    sanitize_xml_delimiters, MAX_GENERATION_BYTES, MAX_REQUEST_BODY_BYTES, MAX_SSE_LINE_BYTES,
    MAX_TOTAL_CONTEXT_BYTES,
};
use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures_util::Stream;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex as TokioMutex, Notify},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

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

static RUNNING_CURSOR_BRIDGE: TokioMutex<Option<CursorBridgeHandle>> = TokioMutex::const_new(None);

const MODEL_LIST_TTL: Duration = Duration::from_secs(300);

static MODEL_LIST_CACHE: std::sync::Mutex<Option<ModelListCache>> = std::sync::Mutex::new(None);
static IS_REFRESHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

struct ModelListCache {
    fingerprint: String,
    models: Vec<String>,
    fetched_at: std::time::Instant,
}

pub fn invalidate_model_list_cache() {
    if let Ok(mut guard) = MODEL_LIST_CACHE.lock() {
        *guard = None;
    }
}

pub async fn refresh_model_list_cache() {
    if IS_REFRESHING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    struct RefreshGuard;
    impl Drop for RefreshGuard {
        fn drop(&mut self) {
            IS_REFRESHING.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _guard = RefreshGuard;
    let config = load_cursor_config();
    let count = fetch_and_cache_model_ids(&config).await.len();
    log::info!("Cursor 已按当前 Key 刷新模型列表，共 {count} 个真实可用模型");
}

fn remember_model_list(fingerprint: String, models: Vec<String>) {
    if let Ok(mut guard) = MODEL_LIST_CACHE.lock() {
        *guard = Some(ModelListCache {
            fingerprint,
            models,
            fetched_at: std::time::Instant::now(),
        });
    }
}

fn cached_model_list(fingerprint: &str, allow_stale: bool) -> Option<Vec<String>> {
    let guard = MODEL_LIST_CACHE.lock().ok()?;
    let cache = guard.as_ref()?;
    if cache.fingerprint != fingerprint {
        return None;
    }
    if !allow_stale && cache.fetched_at.elapsed() >= MODEL_LIST_TTL {
        return None;
    }
    Some(cache.models.clone())
}

async fn fetch_and_cache_model_ids(config: &crate::cursor::config::CursorConfig) -> Vec<String> {
    let fingerprint =
        crate::cursor::config::model_source_fingerprint(&config.base_url, &config.api_key);
    if config.api_key.trim().is_empty() || config.base_url.trim().is_empty() {
        return Vec::new();
    }

    match crate::model_fetch::fetch_models(&config.base_url, &config.api_key).await {
        Ok(models) => {
            let ids: Vec<String> = models
                .into_iter()
                .map(|m| m.id.trim().to_string())
                .filter(|id| !id.is_empty())
                .collect();
            remember_model_list(fingerprint.clone(), ids.clone());

            let mut latest = load_cursor_config();
            let latest_fp =
                crate::cursor::config::model_source_fingerprint(&latest.base_url, &latest.api_key);
            if latest_fp == fingerprint
                && (latest.cached_models != ids || latest.cached_models_fingerprint != fingerprint)
            {
                latest.cached_models = ids.clone();
                latest.cached_models_fingerprint = fingerprint;
                if let Err(e) = crate::cursor::config::save_cursor_config(&latest) {
                    log::warn!("回写 Cursor 模型缓存失败: {e}");
                }
            }
            ids
        }
        Err(e) => {
            log::warn!("按当前 Key 拉取 Cursor 可用模型失败: {e}");
            Vec::new()
        }
    }
}

fn with_selected_model(selected: &str, mut models: Vec<String>) -> Vec<String> {
    let selected_trim = selected.trim();
    if !selected_trim.is_empty() {
        models.retain(|m| m.trim() != selected_trim);
        models.insert(0, selected_trim.to_string());
    }
    models
}

pub async fn load_key_model_ids(config: &crate::cursor::config::CursorConfig) -> Vec<String> {
    let fingerprint =
        crate::cursor::config::model_source_fingerprint(&config.base_url, &config.api_key);

    // 1. 命中有效内存缓存
    if let Some(fresh) = cached_model_list(&fingerprint, false) {
        return with_selected_model(&config.model, fresh);
    }

    // 2. 检查陈旧内存缓存或磁盘缓存 (SWR)
    let disk_models: Option<Vec<String>> =
        if config.cached_models_fingerprint == fingerprint && !config.cached_models.is_empty() {
            Some(
                config
                    .cached_models
                    .iter()
                    .map(|id| id.trim().to_string())
                    .filter(|id| !id.is_empty())
                    .collect(),
            )
        } else {
            None
        };

    if let Some(cached) = cached_model_list(&fingerprint, true).or(disk_models) {
        remember_model_list(fingerprint.clone(), cached.clone());
        tokio::spawn(async {
            refresh_model_list_cache().await;
        });
        return with_selected_model(&config.model, cached);
    }

    // 3. 首次拉取
    let fetched = fetch_and_cache_model_ids(config).await;
    if !fetched.is_empty() {
        return with_selected_model(&config.model, fetched);
    }

    // 4. 容灾保底：若上游没有 /v1/models 或请求失败，保底返回用户配置的 model
    if !config.model.trim().is_empty() {
        vec![config.model.trim().to_string()]
    } else if !config.custom_models.is_empty() {
        config.custom_models.clone()
    } else {
        vec!["gpt-5.6-sol".to_string()]
    }
}

/// 判断客户端请求是否期望 Protobuf 协议 (兼容现代 Cursor Connect-RPC)
pub fn is_proto_request(headers: &HeaderMap) -> bool {
    if let Some(ct) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        if ct.contains("proto") {
            return true;
        }
    }
    if let Some(accept) = headers.get(header::ACCEPT).and_then(|v| v.to_str().ok()) {
        if accept.contains("proto") {
            return true;
        }
    }
    false
}

/// Native Cursor requests may omit Origin; browser origins must match exactly.
fn allowed_origin(origin: &str) -> bool {
    if origin == "vscode-webview://" {
        return true;
    }
    let Ok(url) = reqwest::Url::parse(origin) else {
        return false;
    };
    if !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    match url.scheme() {
        "http" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        "vscode-webview" => url.host_str().is_some(),
        "vscode-file" => url.host_str() == Some("vscode-app"),
        _ => false,
    }
}

fn validate_request_origin(headers: &HeaderMap) -> Result<(), &'static str> {
    if headers.get_all(header::ORIGIN).iter().count() > 1 {
        return Err("Invalid origin");
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !origin.to_str().map(allowed_origin).unwrap_or(false) {
            return Err("Unauthorized origin");
        }
    }
    if headers.get_all(header::CONTENT_TYPE).iter().count() != 1 {
        return Err("Content-Type is required");
    }
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .unwrap_or("")
        .trim();
    if ![
        "application/json",
        "application/proto",
        "application/connect+json",
        "application/connect+proto",
    ]
    .iter()
    .any(|allowed| mime.eq_ignore_ascii_case(allowed))
    {
        return Err("Invalid content-type");
    }
    Ok(())
}

/// Apply before CORS and every route, including OpenAI and fallback forwarding.
/// Host validation prevents DNS rebinding even when a request has no Origin.
fn validate_bridge_request(req: &Request, port: u16) -> Result<(), &'static str> {
    let headers = req.headers();
    if headers.get_all(header::HOST).iter().count() > 1 {
        return Err("Invalid host");
    }
    let authority = headers
        .get(header::HOST)
        .map(|v| {
            v.to_str()
                .ok()
                .and_then(|s| s.parse::<axum::http::uri::Authority>().ok())
        })
        .unwrap_or_else(|| req.uri().authority().cloned())
        .ok_or("Host is required")?;
    let is_local = |a: &axum::http::uri::Authority| {
        matches!(a.host(), "127.0.0.1" | "localhost" | "[::1]")
            && a.port_u16().unwrap_or(port) == port
    };
    if !is_local(&authority) || req.uri().authority().is_some_and(|a| !is_local(a)) {
        return Err("Unauthorized host");
    }
    if headers.get_all(header::ORIGIN).iter().count() > 1
        || headers
            .get(header::ORIGIN)
            .is_some_and(|v| !v.to_str().map(allowed_origin).unwrap_or(false))
    {
        return Err("Unauthorized origin");
    }
    if matches!(
        *req.method(),
        axum::http::Method::POST | axum::http::Method::PUT | axum::http::Method::PATCH
    ) {
        validate_request_origin(headers)?;
    }
    Ok(())
}

/// 过滤 RFC 7230 / 9110 逐跳头 (Hop-by-hop Headers)，包括 Connection 列表中声明的扩展头
pub fn filter_hop_by_hop_headers(headers: &mut HeaderMap) {
    let mut to_remove: Vec<header::HeaderName> = Vec::new();
    if let Some(conn) = headers.get(header::CONNECTION) {
        if let Ok(conn_str) = conn.to_str() {
            for name in conn_str.split(',') {
                let name = name.trim();
                if let Ok(hname) = header::HeaderName::from_bytes(name.as_bytes()) {
                    to_remove.push(hname);
                }
            }
        }
    }
    for h in to_remove {
        headers.remove(h);
    }
    headers.remove(header::HOST);
    headers.remove(header::CONNECTION);
    headers.remove("keep-alive");
    headers.remove(header::UPGRADE);
    headers.remove(header::TRANSFER_ENCODING);
    headers.remove(header::TE);
    headers.remove(header::TRAILER);
    headers.remove(header::PROXY_AUTHENTICATE);
    headers.remove(header::PROXY_AUTHORIZATION);
}

/// Bidi 内存会话缓存（协调 BidiAppend 与 RunSSE 的时序并发）
#[derive(Clone, Debug)]
struct BidiSession {
    #[allow(dead_code)]
    request_id: String,
    user_prompt: String,
    model: String,
    history: Vec<(String, String)>,
    context_files: Vec<(String, String)>,
    context_codes: Vec<(String, String)>,
    context_rules: Vec<(String, String)>,
    extra_context: Vec<String>,
    last_seqno: i64,
    created_at: std::time::Instant,
}

impl BidiSession {
    /// Budget the merged context and the actual escaped text sent upstream.
    fn formatted_context(&self) -> Result<(String, String), &'static str> {
        let raw_bytes: usize = self
            .context_files
            .iter()
            .chain(&self.context_codes)
            .chain(&self.context_rules)
            .map(|(path, content)| path.len() + content.len())
            .sum::<usize>()
            + self.extra_context.iter().map(String::len).sum::<usize>();
        if raw_bytes > MAX_TOTAL_CONTEXT_BYTES {
            return Err("Context memory limit exceeded");
        }
        let mut system = Vec::new();
        if !self.context_rules.is_empty() {
            system.push("[Project Rules]".to_string());
            for (path, content) in &self.context_rules {
                system.push(format!(
                    "<rule path=\"{}\">\n{}\n</rule>",
                    sanitize_tag_attribute(path),
                    sanitize_xml_delimiters(content, "rule")
                ));
            }
        }
        let mut user = Vec::new();
        if !self.context_files.is_empty()
            || !self.context_codes.is_empty()
            || !self.extra_context.is_empty()
        {
            user.push("<selected_context>".to_string());
            for (tag, entries) in [("file", &self.context_files), ("code", &self.context_codes)] {
                for (path, content) in entries {
                    user.push(format!(
                        "<{} path=\"{}\">\n{}\n</{}>",
                        tag,
                        sanitize_tag_attribute(path),
                        sanitize_xml_delimiters(content, tag),
                        tag
                    ));
                }
            }
            for extra in &self.extra_context {
                user.push(sanitize_xml_delimiters(extra, "selected_context"));
            }
            user.push("</selected_context>".to_string());
        }
        let system = system.join("\n\n");
        let user = user.join("\n");
        if system.len() + user.len() > MAX_TOTAL_CONTEXT_BYTES {
            return Err("Formatted context limit exceeded");
        }
        Ok((system, user))
    }

    /// 计算当前会话的总字节数（包括 prompt、history、context 等）
    fn total_bytes(&self) -> usize {
        let mut total = self.user_prompt.len() + self.request_id.len() + self.model.len();
        total += self
            .history
            .iter()
            .map(|(r, c)| r.len() + c.len())
            .sum::<usize>();
        total += self
            .context_files
            .iter()
            .map(|(n, c)| n.len() + c.len())
            .sum::<usize>();
        total += self
            .context_codes
            .iter()
            .map(|(n, c)| n.len() + c.len())
            .sum::<usize>();
        total += self
            .context_rules
            .iter()
            .map(|(n, c)| n.len() + c.len())
            .sum::<usize>();
        total += self.extra_context.iter().map(|s| s.len()).sum::<usize>();
        total
    }
}

// Session 总内存预算限制：单个 session 最大 15 MB，全局最多 100 MB
const MAX_SESSION_BYTES: usize = 15 * 1024 * 1024;
const MAX_TOTAL_SESSIONS_BYTES: usize = 100 * 1024 * 1024;
const MAX_REQUEST_ID_LENGTH: usize = 256;
const MAX_HISTORY_ITEMS: usize = 100;
const MAX_SESSIONS_COUNT: usize = 500;

fn commit_session(
    map: &mut HashMap<String, BidiSession>,
    id: String,
    candidate: BidiSession,
) -> Result<(), &'static str> {
    candidate.formatted_context()?;
    let new_size = candidate.total_bytes();
    if new_size > MAX_SESSION_BYTES {
        return Err("Session memory limit exceeded");
    }
    // Plan count eviction before computing the global budget, without mutating
    // any cached state if this candidate ultimately has to be rejected.
    let mut evictions = Vec::new();
    if !map.contains_key(&id) && map.len() >= MAX_SESSIONS_COUNT {
        let mut entries: Vec<_> = map
            .iter()
            .map(|(key, s)| (key.clone(), s.created_at))
            .collect();
        entries.sort_by_key(|(_, time)| *time);
        evictions.extend(
            entries
                .into_iter()
                .take(map.len().saturating_sub(400))
                .map(|(key, _)| key),
        );
    }
    let total_bytes: usize = map.values().map(BidiSession::total_bytes).sum();
    let evicted_bytes: usize = evictions
        .iter()
        .filter_map(|key| map.get(key))
        .map(BidiSession::total_bytes)
        .sum();
    let old_size = map.get(&id).map(BidiSession::total_bytes).unwrap_or(0);
    let global_after = total_bytes
        .saturating_sub(evicted_bytes)
        .saturating_sub(old_size)
        .saturating_add(new_size);
    if global_after > MAX_TOTAL_SESSIONS_BYTES {
        return Err("Global memory limit exceeded");
    }
    for key in evictions {
        map.remove(&key);
    }
    map.insert(id, candidate);
    Ok(())
}

static SESSION_MAP: Lazy<Arc<TokioMutex<HashMap<String, BidiSession>>>> =
    Lazy::new(|| Arc::new(TokioMutex::new(HashMap::new())));

static SESSION_NOTIFY: Lazy<Arc<Notify>> = Lazy::new(|| Arc::new(Notify::new()));

pub fn is_bridge_running() -> bool {
    RUNNING_CURSOR_BRIDGE.blocking_lock().is_some()
}

pub fn get_bridge_port() -> Option<u16> {
    RUNNING_CURSOR_BRIDGE
        .blocking_lock()
        .as_ref()
        .map(|h| h.port)
}

pub async fn start_bridge(port: Option<u16>) -> Result<u16, String> {
    {
        let guard = RUNNING_CURSOR_BRIDGE.lock().await;

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
        // 核心健康检查与基础接口
        .route("/health", get(handle_health))
        .route("/v1/models", get(handle_openai_models))
        .route("/v1/chat/completions", post(handle_openai_chat))
        // 现代 Cursor Agent 核心双向流 (重点修复)
        .route(
            "/aiserver.v1.BidiService/BidiAppend",
            post(handle_bidi_append),
        )
        .route("/agent.v1.AgentService/RunSSE", post(handle_run_sse))
        .route("/agent.v1.AgentService/Run", post(handle_agent_run))
        // 现代与传统模型目录探测
        .route(
            "/agent.v1.AgentService/GetUsableModels",
            post(handle_get_usable_models),
        )
        .route(
            "/aiserver.v1.AiService/GetUsableModels",
            post(handle_get_usable_models),
        )
        .route(
            "/aiserver.v1.AiService/AvailableModels",
            post(handle_connect_available_models),
        )
        .route(
            "/aiserver.v1.AiService/AvailableDocs",
            post(handle_available_docs),
        )
        .route(
            "/aiserver.v1.AnalyticsService/BootstrapStatsig",
            post(handle_bootstrap_statsig),
        )
        .route(
            "/agent.v1.AgentService/GetDefaultModelForCli",
            post(handle_default_model_for_cli),
        )
        .route(
            "/aiserver.v1.AiService/GetDefaultModelForCli",
            post(handle_default_model_for_cli),
        )
        .route(
            "/aiserver.v1.AiService/GetDefaultModel",
            post(handle_get_default_model),
        )
        .route(
            "/aiserver.v1.AiService/GetDefaultModelNudgeData",
            post(handle_default_model_nudge),
        )
        // 网络与心跳连接检查 (防止 Cursor Watchdog 超时熔断)
        .route(
            "/aiserver.v1.NetworkService/IsConnected",
            post(handle_is_connected),
        )
        .route(
            "/aiserver.v1.AiService/HealthCheck",
            post(handle_connect_health_check),
        )
        .route(
            "/aiserver.v1.AiService/ServerTime",
            post(handle_connect_server_time),
        )
        .route(
            "/aiserver.v1.AiService/GetServerConfig",
            post(handle_server_config),
        )
        .route(
            "/aiserver.v1.ServerConfigService/GetServerConfig",
            post(handle_server_config),
        )
        // 元数据与隐私设置
        .route(
            "/agent.v1.AgentService/UpdateConversationMetadata",
            post(handle_update_metadata),
        )
        .route(
            "/aiserver.v1.DashboardService/GetUserPrivacyMode",
            post(handle_privacy_mode),
        )
        .route(
            "/aiserver.v1.DashboardService/GetEffectiveUserPlugins",
            post(handle_user_plugins),
        )
        // 用户信息与用量 Mocks
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
        // 旧版 RPC 兼容接口 (v0.3x)
        .route(
            "/aiserver.v1.AiService/StreamChat",
            post(handle_legacy_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamComposer",
            post(handle_legacy_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamComposerIteration",
            post(handle_legacy_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamEdit",
            post(handle_legacy_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamFastEdit",
            post(handle_legacy_fast_edit),
        )
        .route(
            "/aiserver.v1.AiService/StreamGenerate",
            post(handle_legacy_stream),
        )
        .route(
            "/aiserver.v1.AiService/StreamChatWeb",
            post(handle_legacy_stream),
        )
        // 未处理接口透明回源转发给官方服务器 (核心架构升级)
        .fallback(any(handle_fallback))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(
                    |origin: &axum::http::HeaderValue, _| {
                        origin.to_str().map(allowed_origin).unwrap_or(false)
                    },
                ))
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                ]),
        )
        .layer(axum::middleware::from_fn(
            move |req: Request, next: axum::middleware::Next| async move {
                if let Err(message) = validate_bridge_request(&req, actual_port) {
                    return (StatusCode::FORBIDDEN, message).into_response();
                }
                next.run(req).await
            },
        ));

    let join_handle = tokio::spawn(async move {
        let server = axum::serve(listener, app);
        let _ = server
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    {
        let mut guard = RUNNING_CURSOR_BRIDGE.lock().await;
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
        let mut guard = RUNNING_CURSOR_BRIDGE.lock().await;
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
    let models = load_key_model_ids(&cfg).await;
    Json(format_openai_models_response(&models))
}

fn connect_unary_response(headers: &HeaderMap, json_val: Value) -> Response {
    if is_proto_request(headers) {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/proto")
            .header("connect-protocol-version", "1")
            .body(Body::from(Vec::<u8>::new()))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header("connect-protocol-version", "1")
            .body(Body::from(
                serde_json::to_string(&json_val).unwrap_or_default(),
            ))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    }
}

async fn handle_connect_available_models(headers: HeaderMap) -> Response {
    let cfg = load_cursor_config();
    let models = load_key_model_ids(&cfg).await;
    if is_proto_request(&headers) {
        let body = encode_connect_available_models_proto(&models);
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/proto")
            .header("connect-protocol-version", "1")
            .body(Body::from(body))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        connect_unary_response(&headers, format_connect_available_models(&models))
    }
}

async fn handle_get_usable_models(headers: HeaderMap) -> Response {
    let cfg = load_cursor_config();
    let models = load_key_model_ids(&cfg).await;
    if is_proto_request(&headers) {
        let body = encode_connect_usable_models_proto(&models);
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/proto")
            .header("connect-protocol-version", "1")
            .body(Body::from(body))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        connect_unary_response(&headers, format_connect_usable_models(&models))
    }
}

async fn handle_default_model_for_cli(headers: HeaderMap) -> Response {
    let cfg = load_cursor_config();
    let default_m = if !cfg.model.trim().is_empty() {
        cfg.model.clone()
    } else {
        let models = load_key_model_ids(&cfg).await;
        models
            .into_iter()
            .next()
            .unwrap_or_else(|| "gpt-5.6-sol".to_string())
    };
    if is_proto_request(&headers) {
        let body = encode_connect_default_model_for_cli_proto(&default_m);
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/proto")
            .header("connect-protocol-version", "1")
            .body(Body::from(body))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        connect_unary_response(
            &headers,
            json!({
                "model": {
                    "model": default_m,
                    "displayName": format!("{} (AI-Helper)", default_m),
                    "isAvailable": true
                }
            }),
        )
    }
}

async fn handle_get_default_model(headers: HeaderMap) -> Response {
    let cfg = load_cursor_config();
    let default_m = if !cfg.model.trim().is_empty() {
        cfg.model.clone()
    } else {
        let models = load_key_model_ids(&cfg).await;
        models
            .into_iter()
            .next()
            .unwrap_or_else(|| "gpt-5.6-sol".to_string())
    };
    if is_proto_request(&headers) {
        let body = encode_connect_default_model_proto(&default_m);
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/proto")
            .header("connect-protocol-version", "1")
            .body(Body::from(body))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        connect_unary_response(
            &headers,
            json!({
                "model": default_m
            }),
        )
    }
}

async fn handle_default_model_nudge(headers: HeaderMap) -> Response {
    connect_unary_response(
        &headers,
        json!({
            "nudgeDate": "0",
            "shouldDefaultSwitchOnNewChat": false,
            "modelsWithNoDefaultSwitch": []
        }),
    )
}

async fn handle_is_connected(req: Request) -> Response {
    // IsConnected 是 unary RPC，应返回空 Protobuf 消息而不是 Connect 流帧
    connect_unary_response(req.headers(), json!({}))
}

async fn handle_available_docs(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "docs": [] }))
}

async fn handle_bootstrap_statsig(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({}))
}

async fn handle_server_config(headers: HeaderMap) -> Response {
    connect_unary_response(
        &headers,
        json!({
            "isServerAlive": true,
            "status": "ok"
        }),
    )
}

async fn handle_privacy_mode(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "privacyMode": true }))
}

async fn handle_user_plugins(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "plugins": [] }))
}

async fn handle_update_metadata(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "status": "ok" }))
}

async fn handle_connect_get_usage(headers: HeaderMap) -> Response {
    connect_unary_response(
        &headers,
        json!({
            "fastRequests": 9999,
            "maxFastRequests": 10000,
            "numRequests": 1,
            "maxRequestUsage": 10000,
            "membershipType": "pro"
        }),
    )
}

async fn handle_connect_get_subscription(headers: HeaderMap) -> Response {
    connect_unary_response(
        &headers,
        json!({
            "isActive": true,
            "isPro": true,
            "membershipType": "pro",
            "canUseCopilot": true
        }),
    )
}

async fn handle_connect_get_user_info(headers: HeaderMap) -> Response {
    connect_unary_response(
        &headers,
        json!({
            "userId": "ai-helper-user",
            "user_id": "ai-helper-user",
            "jupyterToken": "ai-helper",
            "usage": {
                "gpt4_max_requests": 10000,
                "fastRequests": 10000
            }
        }),
    )
}

async fn handle_connect_server_time(headers: HeaderMap) -> Response {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(1700000000);
    connect_unary_response(&headers, json!({ "serverTime": now }))
}

async fn handle_connect_health_check(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "healthy": true, "status": "ok" }))
}

async fn handle_connect_privacy_check(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "isPrivacy": true, "privacy": true }))
}

async fn handle_connect_mesh_auth(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "isAuthenticated": true }))
}

async fn handle_connect_upload_status(headers: HeaderMap) -> Response {
    connect_unary_response(&headers, json!({ "status": "ok" }))
}

/// 规整并去除 Base URL 结尾的斜杠与重复 /v1
fn clean_base_url(url: &str) -> &str {
    let trimmed = url.trim().trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

type StreamFailure = (&'static str, &'static str);
type StreamSender = tokio::sync::mpsc::Sender<Result<Bytes, std::io::Error>>;

#[derive(Clone, Copy)]
enum StreamKind {
    Agent,
    Legacy,
    FastEdit,
}

struct StreamOutput {
    kind: StreamKind,
    is_proto: bool,
    accumulated_code: String,
    generated_bytes: usize,
    wire_bytes: usize,
}

impl StreamOutput {
    fn new(kind: StreamKind, is_proto: bool) -> Self {
        Self {
            kind,
            is_proto,
            accumulated_code: String::new(),
            generated_bytes: 0,
            wire_bytes: 0,
        }
    }

    fn encode_line(&mut self, line: &str) -> Result<Vec<Vec<u8>>, StreamFailure> {
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(Vec::new());
        };
        let Ok(parsed) = serde_json::from_str::<Value>(data.trim()) else {
            return Ok(Vec::new());
        };
        let delta = parsed.pointer("/choices/0/delta");
        let reasoning = if matches!(self.kind, StreamKind::Agent) {
            delta
                .and_then(|v| v.get("reasoning_content"))
                .and_then(Value::as_str)
        } else {
            None
        };
        let content = delta.and_then(|v| v.get("content")).and_then(Value::as_str);
        let mut frames = Vec::new();
        for (text, thinking) in [(reasoning, true), (content, false)] {
            let Some(text) = text.filter(|s| !s.is_empty()) else {
                continue;
            };
            if text.len() > MAX_GENERATION_BYTES.saturating_sub(self.generated_bytes) {
                return Err(("resource_exhausted", "Generation limit exceeded"));
            }
            self.generated_bytes += text.len();
            let frame = match self.kind {
                StreamKind::Agent => match (self.is_proto, thinking) {
                    (true, true) => create_agent_thinking_chunk(text),
                    (false, true) => create_agent_json_thinking_chunk(text),
                    (true, false) => create_agent_text_chunk(text),
                    (false, false) => create_agent_json_text_chunk(text),
                },
                StreamKind::Legacy => {
                    if self.is_proto {
                        create_legacy_chat_response_chunk(text)
                    } else {
                        create_connect_text_chunk(text)
                    }
                }
                StreamKind::FastEdit => {
                    self.accumulated_code.push_str(text);
                    if self.is_proto {
                        create_legacy_fast_edit_response_chunk(&self.accumulated_code)
                    } else {
                        let payload = json!({"editedCode": self.accumulated_code});
                        encode_connect_frame_raw(
                            0,
                            &serde_json::to_vec(&payload).unwrap_or_default(),
                        )
                    }
                }
            };
            // Reserve room for the terminal success/error frame. FastEdit
            // snapshots count in full, bounding repeated serialization as well.
            if frame.len() > (MAX_GENERATION_BYTES - 512).saturating_sub(self.wire_bytes) {
                return Err(("resource_exhausted", "Output limit exceeded"));
            }
            self.wire_bytes += frame.len();
            frames.push(frame);
        }
        Ok(frames)
    }
}

async fn send_sse_line(
    output: &mut StreamOutput,
    line: &[u8],
    tx: &StreamSender,
) -> Result<bool, StreamFailure> {
    let line = String::from_utf8_lossy(line);
    let line = line.trim();
    if line
        .strip_prefix("data:")
        .is_some_and(|data| data.trim() == "[DONE]")
    {
        return Ok(true);
    }
    for frame in output.encode_line(line)? {
        tx.send(Ok(Bytes::from(frame)))
            .await
            .map_err(|_| ("cancelled", "Client disconnected"))?;
    }
    Ok(false)
}

/// All three Cursor streaming paths share line, EOF, output and cancellation
/// handling. Split each network chunk before checking the pending line length.
async fn forward_connect_stream<S, E>(
    mut stream: S,
    tx: &StreamSender,
    kind: StreamKind,
    is_proto: bool,
) where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    use futures_util::StreamExt;
    let mut line = Vec::new();
    let mut output = StreamOutput::new(kind, is_proto);
    let result: Result<(), StreamFailure> = async {
        loop {
            let chunk = tokio::select! {
                _ = tx.closed() => return Err(("cancelled", "Client disconnected")),
                chunk = stream.next() => chunk,
            };
            let Some(chunk) = chunk else {
                break;
            };
            let bytes = chunk.map_err(|error| {
                log::warn!("Cursor upstream stream failed: {}", error);
                ("unavailable", "Upstream stream interrupted")
            })?;
            for part in bytes.split_inclusive(|b| *b == b'\n') {
                let complete = part.last() == Some(&b'\n');
                let data = if complete {
                    &part[..part.len() - 1]
                } else {
                    part
                };
                if data.len() > MAX_SSE_LINE_BYTES.saturating_sub(line.len()) {
                    return Err(("resource_exhausted", "SSE line limit exceeded"));
                }
                line.extend_from_slice(data);
                if complete {
                    if send_sse_line(&mut output, &line, tx).await? {
                        return Ok(());
                    }
                    line.clear();
                }
            }
        }
        if !line.is_empty() {
            send_sse_line(&mut output, &line, tx).await?;
        }
        Ok(())
    }
    .await;
    // Drop the HTTP response immediately on overflow, before waiting for the
    // client to consume the terminal frame.
    drop(stream);
    if tx.is_closed() {
        return;
    }
    let terminal = match result {
        Ok(()) => {
            if matches!(kind, StreamKind::Agent) && is_proto {
                let _ = tx
                    .send(Ok(Bytes::from(create_agent_turn_ended_chunk())))
                    .await;
            }
            create_connect_end_frame()
        }
        Err((code, message)) => create_connect_error_frame(code, message),
    };
    debug_assert!(terminal.len() <= 512);
    let _ = tx.send(Ok(Bytes::from(terminal))).await;
}

async fn bounded_upstream_error(response: reqwest::Response) -> String {
    use futures_util::StreamExt;
    const LIMIT: usize = 64 * 1024;
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(Ok(chunk)) = stream.next().await {
        let count = chunk.len().min(LIMIT - body.len());
        body.extend_from_slice(&chunk[..count]);
        if body.len() == LIMIT {
            break;
        }
    }
    String::from_utf8_lossy(&body).into_owned()
}

/// 处理现代 Cursor 上行 BidiAppend 请求
async fn handle_bidi_append(req: Request) -> Response {
    // 服务端准入校验
    if let Err(err_msg) = validate_request_origin(req.headers()) {
        return (StatusCode::FORBIDDEN, err_msg).into_response();
    }

    let is_proto = is_proto_request(req.headers());
    let (_parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, MAX_REQUEST_BODY_BYTES).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Cursor BidiAppend 请求体过大或读取失败: {}", e);
            return (StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large").into_response();
        }
    };

    if let Some(decoded) = decode_bidi_append(&bytes) {
        log::info!(
            "Cursor BidiAppend 接收请求 [{}], seqno: {}, model: {:?}, history: {} 轮, files: {}, prompt 长度: {}",
            decoded.request_id,
            decoded.seqno,
            decoded.model,
            decoded.history.len(),
            decoded.context_files.len(),
            decoded.user_text.len()
        );

        // 限制 request_id 长度防止内存攻击
        if decoded.request_id.len() > MAX_REQUEST_ID_LENGTH {
            log::warn!("拒绝过长的 request_id: {} 字节", decoded.request_id.len());
            return (StatusCode::BAD_REQUEST, "Request ID too long").into_response();
        }

        let default_model = load_cursor_config().model;
        let mut map = SESSION_MAP.lock().await;

        // 清理超期 5 分钟的过期 session
        map.retain(|_, s| s.created_at.elapsed() < Duration::from_secs(300));

        // 构建候选会话状态（先不修改缓存）
        let mut candidate = map
            .get(&decoded.request_id)
            .cloned()
            .unwrap_or_else(|| BidiSession {
                request_id: decoded.request_id.clone(),
                user_prompt: String::new(),
                model: default_model.clone(),
                history: Vec::new(),
                context_files: Vec::new(),
                context_codes: Vec::new(),
                context_rules: Vec::new(),
                extra_context: Vec::new(),
                last_seqno: -1,
                created_at: std::time::Instant::now(),
            });

        if decoded.seqno >= candidate.last_seqno {
            candidate.last_seqno = decoded.seqno;

            // 限制单个字段长度，防止单次写入过大
            if !decoded.user_text.trim().is_empty() {
                candidate.user_prompt = decoded.user_text;
            }

            if let Some(m) = decoded.model {
                if !m.trim().is_empty() && m.len() < 256 {
                    candidate.model = m;
                }
            }
            // 限制 history 条数和总大小
            if !decoded.history.is_empty() {
                let mut new_history = decoded.history;
                if new_history.len() > MAX_HISTORY_ITEMS {
                    new_history = new_history
                        .into_iter()
                        .rev()
                        .take(MAX_HISTORY_ITEMS)
                        .rev()
                        .collect();
                }
                candidate.history = new_history;
            }

            if !decoded.context_files.is_empty() {
                candidate.context_files = decoded.context_files;
            }
            if !decoded.context_codes.is_empty() {
                candidate.context_codes = decoded.context_codes;
            }
            if !decoded.context_rules.is_empty() {
                candidate.context_rules = decoded.context_rules;
            }
            if !decoded.extra_context.is_empty() {
                candidate.extra_context = decoded.extra_context;
            }
        }

        if let Err(message) = commit_session(&mut map, decoded.request_id, candidate) {
            return (StatusCode::PAYLOAD_TOO_LARGE, message).into_response();
        }

        SESSION_NOTIFY.notify_waiters();
    } else {
        log::warn!(
            "Cursor BidiAppend 收到无法解析的消息体 (长度: {} 字节)",
            bytes.len()
        );
    }

    if is_proto {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/proto")
            .header("connect-protocol-version", "1")
            .body(Body::from(Vec::<u8>::new()))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    } else {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header("connect-protocol-version", "1")
            .body(Body::from(
                serde_json::to_string(&json!({})).unwrap_or_default(),
            ))
            .unwrap_or_else(|_| (StatusCode::OK, "").into_response())
    }
}

/// 处理现代 Cursor 下行 RunSSE 流式长连接 (驱动大模型生成输出)
async fn handle_run_sse(req: Request) -> Response {
    // 服务端准入校验
    if let Err(err_msg) = validate_request_origin(req.headers()) {
        return (StatusCode::FORBIDDEN, err_msg).into_response();
    }

    let is_proto = is_proto_request(req.headers());
    let content_type = if is_proto {
        "application/connect+proto"
    } else {
        "application/connect+json"
    };

    let (_parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, MAX_REQUEST_BODY_BYTES).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Cursor RunSSE 请求体读取失败: {}", e);
            return (StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large").into_response();
        }
    };

    let req_id_opt = decode_bidi_request_id(&bytes);
    log::info!("Cursor RunSSE 发起订阅, 解包 request_id: {:?}", req_id_opt);

    let config = load_cursor_config();
    if config.api_key.trim().is_empty() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_error_stream(
                "【AI-Helper 提示】请先在 AI-Helper 客户端的 Cursor 面板中配置并绑定有效 API Key。",
                is_proto,
            )))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(128);
    let cleanup_req_id = req_id_opt.clone();

    tokio::spawn(async move {
        // 先发送一次心跳帧完成与 Cursor 客户端的即时握手 (消除 Reconnecting 状态)
        let heartbeat = if is_proto {
            create_agent_heartbeat_chunk()
        } else {
            create_agent_json_heartbeat_chunk()
        };
        if tx.send(Ok(Bytes::from(heartbeat))).await.is_err() {
            return;
        }

        // 等待对应 request_id 的 BidiAppend 数据就绪 (消除丢通知竞态)
        let session = if let Some(ref req_id) = cleanup_req_id {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
            loop {
                let notified = SESSION_NOTIFY.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();

                {
                    let map = SESSION_MAP.lock().await;
                    if let Some(s) = map.get(req_id) {
                        if !s.user_prompt.trim().is_empty() || !s.history.is_empty() {
                            break Some(s.clone());
                        }
                    }
                }

                if tokio::time::timeout_at(deadline, notified.as_mut())
                    .await
                    .is_err()
                {
                    let map = SESSION_MAP.lock().await;
                    break map
                        .get(req_id)
                        .filter(|s| !s.user_prompt.trim().is_empty() || !s.history.is_empty())
                        .cloned();
                }
            }
        } else {
            None
        };

        let session_data = match session {
            Some(s) => s,
            None => {
                log::warn!("Cursor RunSSE 未找到对应 Prompt 数据，返回优雅结束帧");
                let _ = tx.send(Ok(Bytes::from(create_connect_end_frame()))).await;
                return;
            }
        };

        let model_to_use = match session_data.model.trim() {
            "" | "default" | "auto" | "cursor-small" | "composer" => config.model.as_str(),
            other => other,
        };

        log::info!(
            "Cursor RunSSE 开始向下游派发模型生成流, 模型: {}, 历史轮数: {}, 上下文文件数: {}, prompt 长度: {}",
            model_to_use,
            session_data.history.len(),
            session_data.context_files.len(),
            session_data.user_prompt.len()
        );

        let mut messages: Vec<Value> = Vec::new();

        let (system_context, user_context) = match session_data.formatted_context() {
            Ok(context) => context,
            Err(message) => {
                let err_frame = create_connect_error_frame("resource_exhausted", message);
                let _ = tx.send(Ok(Bytes::from(err_frame))).await;
                return;
            }
        };
        if !system_context.is_empty() {
            messages.push(json!({"role": "system", "content": system_context}));
        }
        for (role, content) in &session_data.history {
            messages.push(json!({"role": role, "content": content}));
        }
        let full_user_content = if user_context.is_empty() {
            session_data.user_prompt
        } else {
            format!("{}\n\n{}", user_context, session_data.user_prompt)
        };
        messages.push(json!({"role": "user", "content": full_user_content}));

        let openai_req = json!({
            "model": model_to_use,
            "messages": messages,
            "stream": true,
            "temperature": 0.7
        });

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
                log::error!("RunSSE 请求第三方模型 API 失败: {}", e);
                let err_frame = create_connect_error_frame(
                    "internal",
                    &format!("【AI-Helper 错误】请求第三方模型 API 失败: {}", e),
                );
                let _ = tx.send(Ok(Bytes::from(err_frame))).await;
                return;
            }
        };

        if !upstream_res.status().is_success() {
            let err_status = upstream_res.status();
            let err_text = bounded_upstream_error(upstream_res).await;
            log::error!("RunSSE 上游报错 HTTP {}: {}", err_status, err_text);
            let err_frame = create_connect_error_frame(
                "internal",
                &format!("【AI-Helper 上游报错】{}", err_text),
            );
            let _ = tx.send(Ok(Bytes::from(err_frame))).await;
            return;
        }

        forward_connect_stream(
            upstream_res.bytes_stream(),
            &tx,
            StreamKind::Agent,
            is_proto,
        )
        .await;

        if let Some(id) = cleanup_req_id {
            SESSION_MAP.lock().await.remove(&id);
        }
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("connect-protocol-version", "1")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
}

/// 处理现代 Cursor 核心双向流 (POST /agent.v1.AgentService/Run)
async fn handle_agent_run(req: Request) -> Response {
    if let Err(err_msg) = validate_request_origin(req.headers()) {
        return (StatusCode::FORBIDDEN, err_msg).into_response();
    }

    let is_proto = is_proto_request(req.headers());
    let content_type = if is_proto {
        "application/connect+proto"
    } else {
        "application/connect+json"
    };

    let (_parts, body) = req.into_parts();
    use futures_util::StreamExt;
    let mut stream = body.into_data_stream();

    // 从双向输入流中读取首包帧（带超时保护，防止无限阻塞）
    let mut initial_buf = Vec::new();
    let read_result = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(chunk_res) = stream.next().await {
            match chunk_res {
                Ok(chunk) => {
                    initial_buf.extend_from_slice(&chunk);
                    if initial_buf.len() >= 5 {
                        let frame_len = u32::from_be_bytes([
                            initial_buf[1],
                            initial_buf[2],
                            initial_buf[3],
                            initial_buf[4],
                        ]) as usize;
                        if initial_buf.len() >= 5 + frame_len {
                            break;
                        }
                    }
                    if initial_buf.len() >= MAX_REQUEST_BODY_BYTES {
                        break;
                    }
                }
                Err(e) => {
                    log::warn!("读取 Agent Run 输入流分块失败: {e}");
                    break;
                }
            }
        }
    })
    .await;

    if read_result.is_err() {
        log::warn!("读取 Agent Run 首包帧超时");
    }

    let decoded_opt =
        decode_agent_client_message(&initial_buf).or_else(|| decode_bidi_append(&initial_buf));

    let decoded = match decoded_opt {
        Some(d) => d,
        None => {
            log::warn!("未能从 Agent Run 输入流解析出有效 AgentClientMessage，返回优雅结束帧");
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header("connect-protocol-version", "1")
                .body(Body::from(create_connect_end_frame()))
                .unwrap_or_else(|_| (StatusCode::OK, "").into_response());
        }
    };

    let config = load_cursor_config();
    if config.api_key.trim().is_empty() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_error_stream(
                "【AI-Helper 提示】请先在 AI-Helper 客户端的 Cursor 面板中配置并绑定有效 API Key。",
                is_proto,
            )))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let model_to_use = match decoded.model.as_deref().unwrap_or("").trim() {
        "" | "default" | "auto" | "cursor-small" | "composer" => {
            if !config.model.trim().is_empty() {
                config.model.as_str()
            } else {
                "gpt-5.6-sol"
            }
        }
        other => other,
    };

    log::info!(
        "Cursor Agent Run 开始派发模型生成流, 模型: {}, 历史轮数: {}, 上下文文件数: {}, prompt 长度: {}",
        model_to_use,
        decoded.history.len(),
        decoded.context_files.len(),
        decoded.user_text.len()
    );

    let session = BidiSession {
        request_id: decoded.request_id.clone(),
        user_prompt: decoded.user_text.clone(),
        model: model_to_use.to_string(),
        history: decoded.history.clone(),
        context_files: decoded.context_files.clone(),
        context_codes: decoded.context_codes.clone(),
        context_rules: decoded.context_rules.clone(),
        extra_context: decoded.extra_context.clone(),
        last_seqno: 0,
        created_at: std::time::Instant::now(),
    };

    let mut messages: Vec<Value> = Vec::new();
    let (system_context, user_context) = match session.formatted_context() {
        Ok(context) => context,
        Err(message) => return (StatusCode::PAYLOAD_TOO_LARGE, message).into_response(),
    };
    if !system_context.is_empty() {
        messages.push(json!({"role": "system", "content": system_context}));
    }
    for (role, content) in &decoded.history {
        messages.push(json!({"role": role, "content": content}));
    }
    let full_user_content = if user_context.is_empty() {
        decoded.user_text
    } else {
        format!("{}\n\n{}", user_context, decoded.user_text)
    };
    messages.push(json!({"role": "user", "content": full_user_content}));

    let openai_req = json!({
        "model": model_to_use,
        "messages": messages,
        "stream": true,
        "temperature": 0.7
    });

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
            log::error!("Agent Run 请求第三方模型 API 失败: {}", e);
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header("connect-protocol-version", "1")
                .body(Body::from(create_connect_error_stream(
                    &format!("【AI-Helper 错误】请求第三方模型 API 失败: {}", e),
                    is_proto,
                )))
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
        }
    };

    if !upstream_res.status().is_success() {
        let err_status = upstream_res.status();
        let err_text = bounded_upstream_error(upstream_res).await;
        log::error!("Agent Run 上游报错 HTTP {}: {}", err_status, err_text);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_error_stream(
                &format!("【AI-Helper 上游报错】{}", err_text),
                is_proto,
            )))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(128);

    tokio::spawn(async move {
        // 先发送一次心跳帧完成与 Cursor 客户端的握手 (消除 Reconnecting 状态)
        if is_proto {
            let _ = tx
                .send(Ok(Bytes::from(create_agent_heartbeat_chunk())))
                .await;
        }
        forward_connect_stream(
            upstream_res.bytes_stream(),
            &tx,
            StreamKind::Agent,
            is_proto,
        )
        .await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("connect-protocol-version", "1")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
}

/// 处理旧版 Connect-RPC 格式的流式请求 (StreamChat / StreamComposer / StreamEdit / StreamGenerate)
async fn handle_legacy_stream(req: Request) -> Response {
    // 服务端准入校验
    if let Err(err_msg) = validate_request_origin(req.headers()) {
        return (StatusCode::FORBIDDEN, err_msg).into_response();
    }

    let uri_path = req.uri().path().to_string();
    let rpc_method = uri_path.rsplit('/').next().unwrap_or("Unknown").to_string();
    let is_proto = is_proto_request(req.headers());
    let content_type = if is_proto {
        "application/connect+proto"
    } else {
        "application/connect+json"
    };

    let (_parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, MAX_REQUEST_BODY_BYTES).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Legacy RPC {} 请求体读取失败: {}", rpc_method, e);
            return (StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large").into_response();
        }
    };

    let config = load_cursor_config();
    if config.api_key.trim().is_empty() {
        let error_msg =
            "【AI-Helper 提示】请先在 AI-Helper 客户端的 Cursor 面板中配置并绑定有效 API Key。";
        let error_body = if is_proto {
            create_legacy_rpc_error(&rpc_method, error_msg)
        } else {
            create_connect_error_stream(error_msg, false)
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(error_body))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    // 尝试按 Protobuf 解码旧版 RPC 请求
    let (prompt, model_override) = if is_proto {
        decode_legacy_rpc_request(&bytes, &rpc_method).unwrap_or_else(|| {
            // 回退到 JSON 解析
            let parsed = decode_connect_or_json(&bytes).unwrap_or_else(|| json!({}));
            let prompt = parsed
                .get("prompt")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            let model = parsed
                .get("model")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string());
            (prompt, model)
        })
    } else {
        let parsed = decode_connect_or_json(&bytes).unwrap_or_else(|| json!({}));
        let prompt = parsed
            .get("prompt")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string();
        let model = parsed
            .get("model")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string());
        (prompt, model)
    };

    if prompt.trim().is_empty() {
        let error_msg = "【AI-Helper 错误】请求的 prompt 为空";
        let error_body = if is_proto {
            create_legacy_rpc_error(&rpc_method, error_msg)
        } else {
            create_connect_error_stream(error_msg, false)
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(error_body))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let model = model_override.unwrap_or_else(|| config.model.clone());
    let openai_req = json!({
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": true
    });

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
            let error_msg = format!("【AI-Helper 错误】请求上游 API 失败: {}", e);
            let error_body = if is_proto {
                create_legacy_rpc_error(&rpc_method, &error_msg)
            } else {
                create_connect_error_stream(&error_msg, false)
            };
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header("connect-protocol-version", "1")
                .body(Body::from(error_body))
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
        }
    };

    if !upstream_res.status().is_success() {
        let err_text = bounded_upstream_error(upstream_res).await;
        let error_msg = format!("【AI-Helper 上游报错】{}", err_text);
        let error_body = if is_proto {
            create_legacy_rpc_error(&rpc_method, &error_msg)
        } else {
            create_connect_error_stream(&error_msg, false)
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(error_body))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);

    tokio::spawn(async move {
        forward_connect_stream(
            upstream_res.bytes_stream(),
            &tx,
            StreamKind::Legacy,
            is_proto,
        )
        .await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("connect-protocol-version", "1")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
}

/// 处理旧版 StreamFastEdit RPC（有独立的请求和响应 schema）
async fn handle_legacy_fast_edit(req: Request) -> Response {
    // 服务端准入校验
    if let Err(err_msg) = validate_request_origin(req.headers()) {
        return (StatusCode::FORBIDDEN, err_msg).into_response();
    }

    let is_proto = is_proto_request(req.headers());
    let content_type = if is_proto {
        "application/connect+proto"
    } else {
        "application/connect+json"
    };

    let (_parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, MAX_REQUEST_BODY_BYTES).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("StreamFastEdit 请求体读取失败: {}", e);
            return (StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large").into_response();
        }
    };

    let config = load_cursor_config();
    if config.api_key.trim().is_empty() {
        let error_body = if is_proto {
            create_legacy_rpc_error(
                "StreamFastEdit",
                "【AI-Helper 提示】请先在 AI-Helper 客户端的 Cursor 面板中配置并绑定有效 API Key。",
            )
        } else {
            create_connect_error_stream(
                "【AI-Helper 提示】请先在 AI-Helper 客户端的 Cursor 面板中配置并绑定有效 API Key。",
                false,
            )
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(error_body))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    // 尝试按 Protobuf 解码 StreamFastEdit 请求
    let (prompt, model_override) = if is_proto {
        decode_legacy_rpc_request(&bytes, "StreamFastEdit").unwrap_or_else(|| {
            // 回退到 JSON 解析
            let parsed = decode_connect_or_json(&bytes).unwrap_or_else(|| json!({}));
            let instruction = parsed
                .get("instruction")
                .and_then(|i| i.as_str())
                .unwrap_or("");
            let code = parsed.get("code").and_then(|c| c.as_str()).unwrap_or("");
            let prompt = format!("Instruction: {}\n\nCode:\n{}", instruction, code);
            let model = parsed
                .get("model")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string());
            (prompt, model)
        })
    } else {
        let parsed = decode_connect_or_json(&bytes).unwrap_or_else(|| json!({}));
        let instruction = parsed
            .get("instruction")
            .and_then(|i| i.as_str())
            .unwrap_or("");
        let code = parsed.get("code").and_then(|c| c.as_str()).unwrap_or("");
        let prompt = format!("Instruction: {}\n\nCode:\n{}", instruction, code);
        let model = parsed
            .get("model")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string());
        (prompt, model)
    };

    if prompt.trim().is_empty() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(create_connect_error_stream(
                "【AI-Helper 错误】StreamFastEdit 请求参数为空",
                is_proto,
            )))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let model = model_override.unwrap_or_else(|| config.model.clone());
    let openai_req = json!({
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": true
    });

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
            let error_msg = format!("【AI-Helper 错误】请求上游 API 失败: {}", e);
            let error_body = if is_proto {
                create_legacy_rpc_error("StreamFastEdit", &error_msg)
            } else {
                create_connect_error_stream(&error_msg, false)
            };
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header("connect-protocol-version", "1")
                .body(Body::from(error_body))
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
        }
    };

    if !upstream_res.status().is_success() {
        let err_text = bounded_upstream_error(upstream_res).await;
        let error_msg = format!("【AI-Helper 上游报错】{}", err_text);
        let error_body = if is_proto {
            create_legacy_rpc_error("StreamFastEdit", &error_msg)
        } else {
            create_connect_error_stream(&error_msg, false)
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header("connect-protocol-version", "1")
            .body(Body::from(error_body))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "error").into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);

    tokio::spawn(async move {
        forward_connect_stream(
            upstream_res.bytes_stream(),
            &tx,
            StreamKind::FastEdit,
            is_proto,
        )
        .await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("connect-protocol-version", "1")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
}

/// 处理标准 OpenAI 格式的 /v1/chat/completions 请求
async fn handle_openai_chat(headers: HeaderMap, Json(payload): Json<Value>) -> Response {
    if let Err(message) = validate_request_origin(&headers) {
        return (StatusCode::FORBIDDEN, message).into_response();
    }
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

/// Fallback 处理：对所有未被本地直接接管的请求，透明反向代理透传至 Cursor 官方服务端
async fn handle_fallback(req: Request) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(uri.path());

    let upstream_target = format!("https://api2.cursor.sh{}", path_and_query);

    log::info!(
        "Cursor Bridge 透明回源透传: {} {} -> {}",
        method,
        uri.path(),
        upstream_target
    );

    let is_proto_request = is_proto_request(req.headers());

    let mut headers = req.headers().clone();
    filter_hop_by_hop_headers(&mut headers);

    // 关键优化：强制要求上游使用 identity 编码，防止上游返回 gzip/br 破坏 Connect-RPC 帧
    headers.insert(
        "connect-accept-encoding",
        header::HeaderValue::from_static("identity"),
    );
    headers.insert(
        header::ACCEPT_ENCODING,
        header::HeaderValue::from_static("identity"),
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_default();

    let body_bytes = match axum::body::to_bytes(req.into_body(), MAX_REQUEST_BODY_BYTES).await {
        Ok(b) => b,
        Err(e) => {
            log::error!("读取待透传请求体失败: {}", e);
            return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response();
        }
    };

    let upstream_res = match client
        .request(method, &upstream_target)
        .headers(headers)
        .body(body_bytes)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("透传官方 Cursor 上游失败 (可能离线或网络受限): {}", e);
            let err_msg = format!("透传官方 Cursor 上游失败: {}", e);
            if is_proto_request {
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .header(header::CONTENT_TYPE, "application/connect+proto")
                    .header("connect-protocol-version", "1")
                    .body(Body::from(create_connect_error_frame(
                        "unavailable",
                        &err_msg,
                    )))
                    .unwrap_or_else(|_| (StatusCode::BAD_GATEWAY, "Bad Gateway").into_response());
            } else {
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("connect-protocol-version", "1")
                    .body(Body::from(
                        serde_json::to_string(&json!({
                            "error": {
                                "code": "unavailable",
                                "message": err_msg
                            }
                        }))
                        .unwrap_or_default(),
                    ))
                    .unwrap_or_else(|_| (StatusCode::BAD_GATEWAY, "Bad Gateway").into_response());
            }
        }
    };

    let status = upstream_res.status();
    let mut resp_headers = upstream_res.headers().clone();
    filter_hop_by_hop_headers(&mut resp_headers);

    let stream = upstream_res.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    *response.headers_mut() = resp_headers;
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    fn test_session(id: &str) -> BidiSession {
        BidiSession {
            request_id: id.into(),
            user_prompt: "test".into(),
            model: "test".into(),
            history: Vec::new(),
            context_files: Vec::new(),
            context_codes: Vec::new(),
            context_rules: Vec::new(),
            extra_context: Vec::new(),
            last_seqno: 0,
            created_at: std::time::Instant::now(),
        }
    }

    #[test]
    fn request_admission_rejects_spoofed_and_malformed_headers() {
        for origin in [
            "http://evil.test",
            "http://localhost:80@evil.test",
            "http://localhost:80/path",
            "http://127.0.0.1.evil.test:80",
            "null",
            "vscode-file://evil",
            "http://localhost:80/?x=1",
        ] {
            assert!(!allowed_origin(origin), "{origin}");
        }
        for origin in [
            "http://localhost:3000",
            "http://127.0.0.1:8969",
            "vscode-file://vscode-app",
            "vscode-webview://test-id",
            "vscode-webview://",
        ] {
            assert!(allowed_origin(origin), "{origin}");
        }
        let request = |host: &str, mime: &str| {
            Request::builder()
                .method("POST")
                .header(header::HOST, host)
                .header(header::CONTENT_TYPE, mime)
                .body(Body::empty())
                .unwrap()
        };
        assert!(validate_bridge_request(
            &request("127.0.0.1:8969", "application/json; charset=utf-8"),
            8969
        )
        .is_ok());
        assert!(validate_bridge_request(
            &request("localhost:8969", "application/connect+proto"),
            8969
        )
        .is_ok());
        for host in [
            "rebind.invalid:8969",
            "localhost.evil:8969",
            "localhost:8970",
            "127.0.0.1:80",
        ] {
            assert!(validate_bridge_request(&request(host, "application/json"), 8969).is_err());
        }
        for mime in [
            "text/plain; x=application/json",
            "application/jsonp",
            "application/connect-anything",
        ] {
            assert!(validate_bridge_request(&request("127.0.0.1:8969", mime), 8969).is_err());
        }
        let mut req = request("localhost:8969", "application/json");
        req.headers_mut().insert(
            header::ORIGIN,
            axum::http::HeaderValue::from_bytes(&[0xff]).unwrap(),
        );
        assert!(validate_bridge_request(&req, 8969).is_err());
        req.headers_mut().remove(header::ORIGIN);
        req.headers_mut()
            .append(header::CONTENT_TYPE, "application/json".parse().unwrap());
        assert!(validate_bridge_request(&req, 8969).is_err());
        req.headers_mut().remove(header::CONTENT_TYPE);
        assert!(validate_bridge_request(&req, 8969).is_err());
        req.headers_mut()
            .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
        *req.uri_mut() = "http://evil.test:8969/v1/chat/completions".parse().unwrap();
        assert!(validate_bridge_request(&req, 8969).is_err());
    }

    #[test]
    fn merged_and_escaped_context_rejections_preserve_cache() {
        let mut map = HashMap::new();
        let mut session = test_session("context");
        session.context_files = vec![("path".into(), "x".repeat(100_000))];
        commit_session(&mut map, "context".into(), session.clone()).unwrap();
        let old_size = map["context"].total_bytes();
        session.context_codes = vec![("code".into(), "x".repeat(100_000))];
        assert!(commit_session(&mut map, "context".into(), session).is_err());
        assert!(map["context"].context_codes.is_empty());
        assert_eq!(map["context"].total_bytes(), old_size);
        let mut session = test_session("escaped");
        session.context_files = vec![("&".repeat(190_000), "x".into())];
        assert!(commit_session(&mut map, "escaped".into(), session).is_err());
        assert!(!map.contains_key("escaped"));
        let mut session = test_session("markup");
        session.context_files = vec![("p".repeat(MAX_TOTAL_CONTEXT_BYTES), String::new())];
        assert!(session.formatted_context().is_err());
        let mut session = test_session("valid");
        session.context_rules = vec![("rule".into(), "content".into())];
        session.context_codes = vec![("code".into(), "content".into())];
        let (system, user) = session.formatted_context().unwrap();
        assert!(system.contains("<rule path="));
        assert!(user.contains("<code path="));
    }

    #[test]
    fn session_count_eviction_uses_retained_total_and_rejection_is_atomic() {
        let mut map = HashMap::new();
        for i in 0..501 {
            let mut session = test_session(&format!("old-{i}"));
            session.user_prompt = "x".repeat(200_000);
            map.insert(session.request_id.clone(), session);
        }
        let mut candidate = test_session("new");
        candidate.user_prompt = "x".repeat(10_000_000);
        commit_session(&mut map, "new".into(), candidate).unwrap();
        assert_eq!(map.len(), 401);
        assert!(
            map.values().map(BidiSession::total_bytes).sum::<usize>() < MAX_TOTAL_SESSIONS_BYTES
        );
        let mut huge = map["new"].clone();
        huge.history = vec![("user".into(), "x".repeat(MAX_SESSION_BYTES))];
        assert!(commit_session(&mut map, "new".into(), huge).is_err());
        assert!(map["new"].history.is_empty());
        assert_eq!(map.len(), 401);
        let mut candidate = test_session("global-overflow");
        candidate.user_prompt = "x".repeat(14_000_000);
        let mut candidate2 = candidate.clone();
        candidate2.request_id = "global-overflow-2".into();
        commit_session(&mut map, candidate.request_id.clone(), candidate).unwrap();
        let before = map.len();
        assert!(commit_session(&mut map, candidate2.request_id.clone(), candidate2).is_err());
        assert_eq!(map.len(), before);
        assert!(!map.contains_key("global-overflow-2"));
    }

    fn sse_delta(text: &str, newline: bool) -> Vec<u8> {
        format!(
            "data: {}{}",
            json!({"choices":[{"delta":{"content":text}}]}),
            if newline { "\n\n" } else { "" }
        )
        .into_bytes()
    }

    fn decode_test_frames(bytes: &[u8]) -> Vec<(u8, Value)> {
        let mut frames = Vec::new();
        let mut remaining = bytes;
        while !remaining.is_empty() {
            assert!(remaining.len() >= 5);
            let len = u32::from_be_bytes(remaining[1..5].try_into().unwrap()) as usize;
            assert!(remaining.len() >= 5 + len);
            let value = if remaining[0] == 2 {
                serde_json::from_slice(&remaining[5..5 + len]).unwrap()
            } else {
                serde_json::from_slice(&remaining[5..5 + len]).unwrap_or(Value::Null)
            };
            frames.push((remaining[0], value));
            remaining = &remaining[5 + len..];
        }
        frames
    }

    async fn collect_test_stream(
        kind: StreamKind,
        is_proto: bool,
        chunks: Vec<Vec<u8>>,
    ) -> Vec<u8> {
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        let task = tokio::spawn(async move {
            let stream = futures_util::stream::iter(
                chunks
                    .into_iter()
                    .map(|v| Ok::<_, std::io::Error>(Bytes::from(v))),
            );
            forward_connect_stream(stream, &tx, kind, is_proto).await;
        });
        let mut bytes = Vec::new();
        while let Some(chunk) = rx.recv().await {
            bytes.extend_from_slice(&chunk.unwrap());
        }
        task.await.unwrap();
        assert!(bytes.len() <= MAX_GENERATION_BYTES);
        bytes
    }

    #[tokio::test]
    async fn all_cursor_streams_enforce_line_limit_and_error_trailer() {
        for kind in [StreamKind::Agent, StreamKind::Legacy, StreamKind::FastEdit] {
            for proto in [false, true] {
                let bytes = collect_test_stream(
                    kind,
                    proto,
                    vec![sse_delta(&"x".repeat(MAX_SSE_LINE_BYTES + 100), false)],
                )
                .await;
                let frames = decode_test_frames(&bytes);
                assert_eq!(frames.len(), 1);
                assert_eq!(frames[0].0, 2);
                assert_eq!(frames[0].1["error"]["code"], "resource_exhausted");
            }
        }
    }

    #[tokio::test]
    async fn all_cursor_streams_budget_eof_tail_and_fast_edit_snapshots() {
        for kind in [StreamKind::Agent, StreamKind::Legacy, StreamKind::FastEdit] {
            for proto in [false, true] {
                let mut chunks = Vec::new();
                for _ in 0..14 {
                    chunks.push(sse_delta(&"x".repeat(720_000), true));
                }
                chunks.push(sse_delta(&"x".repeat(720_000), false));
                let bytes = collect_test_stream(kind, proto, chunks).await;
                let frames = decode_test_frames(&bytes);
                assert_eq!(
                    frames.last().unwrap().1["error"]["code"],
                    "resource_exhausted"
                );
            }
        }
    }

    #[tokio::test]
    async fn combined_short_lines_are_valid_and_legacy_text_is_incremental() {
        let mut chunk = Vec::new();
        for _ in 0..40 {
            chunk.extend(sse_delta(&"x".repeat(30_000), true));
        }
        assert!(chunk.len() > MAX_SSE_LINE_BYTES);
        let bytes = collect_test_stream(StreamKind::Legacy, false, vec![chunk]).await;
        let frames = decode_test_frames(&bytes);
        assert_eq!(frames.len(), 41);
        assert!(frames.last().unwrap().1.get("error").is_none());
        let bytes = collect_test_stream(
            StreamKind::Legacy,
            false,
            vec![sse_delta("A", true), sse_delta("B", false)],
        )
        .await;
        let frames = decode_test_frames(&bytes);
        assert_eq!(frames[0].1["text"], "A");
        assert_eq!(frames[1].1["text"], "B");
        let bytes = collect_test_stream(
            StreamKind::FastEdit,
            false,
            vec![sse_delta("A", true), sse_delta("B", false)],
        )
        .await;
        let frames = decode_test_frames(&bytes);
        assert_eq!(frames[0].1["editedCode"], "A");
        assert_eq!(frames[1].1["editedCode"], "AB");
    }

    #[tokio::test]
    async fn stream_stops_reading_after_overflow_and_client_disconnect() {
        let first = futures_util::stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(vec![
                b'x';
                MAX_SSE_LINE_BYTES
                    + 1
            ]))]);
        let unexpected =
            futures_util::stream::poll_fn(|_| -> Poll<Option<Result<Bytes, std::io::Error>>> {
                panic!("upstream must not be polled after overflow");
            });
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        forward_connect_stream(
            futures_util::StreamExt::chain(first, unexpected),
            &tx,
            StreamKind::Agent,
            false,
        )
        .await;
        assert!(rx.recv().await.unwrap().is_ok());
        drop(rx);
        tokio::time::timeout(
            Duration::from_millis(500),
            forward_connect_stream(
                futures_util::stream::pending::<Result<Bytes, std::io::Error>>(),
                &tx,
                StreamKind::Agent,
                false,
            ),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn agent_reasoning_is_not_duplicated_and_utf8_survives_chunk_split() {
        let line = format!(
            "data: {}\n",
            json!({"choices":[{"delta":{"reasoning_content":"reason"}}]})
        );
        let bytes = collect_test_stream(StreamKind::Agent, false, vec![line.into_bytes()]).await;
        assert_eq!(decode_test_frames(&bytes).len(), 2);
        let line = sse_delta("中🦀", false);
        let split = line.iter().position(|b| *b == 0xe4).unwrap() + 1;
        let bytes = collect_test_stream(
            StreamKind::Legacy,
            false,
            vec![line[..split].to_vec(), line[split..].to_vec()],
        )
        .await;
        assert_eq!(decode_test_frames(&bytes)[0].1["text"], "中🦀");
    }

    #[test]
    fn test_is_proto_request() {
        let mut headers = HeaderMap::new();
        assert!(!is_proto_request(&headers));

        headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
        assert!(!is_proto_request(&headers));

        headers.insert(
            header::CONTENT_TYPE,
            "application/connect+json".parse().unwrap(),
        );
        assert!(!is_proto_request(&headers));

        headers.insert(header::CONTENT_TYPE, "application/proto".parse().unwrap());
        assert!(is_proto_request(&headers));

        headers.insert(
            header::CONTENT_TYPE,
            "application/connect+proto".parse().unwrap(),
        );
        assert!(is_proto_request(&headers));

        headers.remove(header::CONTENT_TYPE);
        headers.insert(header::ACCEPT, "application/connect+proto".parse().unwrap());
        assert!(is_proto_request(&headers));
    }

    #[test]
    fn test_filter_hop_by_hop_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "api.cursor.sh".parse().unwrap());
        headers.insert(
            header::CONNECTION,
            "keep-alive, X-Custom-Extension".parse().unwrap(),
        );
        headers.insert("keep-alive", "timeout=5".parse().unwrap());
        headers.insert(header::TRANSFER_ENCODING, "chunked".parse().unwrap());
        headers.insert("X-Custom-Extension", "some-value".parse().unwrap());
        headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());

        filter_hop_by_hop_headers(&mut headers);

        assert!(!headers.contains_key(header::HOST));
        assert!(!headers.contains_key(header::CONNECTION));
        assert!(!headers.contains_key("keep-alive"));
        assert!(!headers.contains_key(header::TRANSFER_ENCODING));
        assert!(!headers.contains_key("X-Custom-Extension"));
        assert!(headers.contains_key(header::CONTENT_TYPE));
    }

    #[test]
    fn test_utf8_multibyte_buffer_reassembly() {
        // 模拟多字节 UTF-8 字符（如中文 "中" = [0xE4, 0xB8, 0xAD] 和 emoji "🦀" = [0xF0, 0x9F, 0xA6, 0x80]）跨网络 chunk 拆分
        let chunk1: Vec<u8> = vec![b'd', b'a', b't', b'a', b':', b' ', 0xE4, 0xB8];
        let chunk2: Vec<u8> = vec![0xAD, b'\n', b'd', b'a', b't', b'a', b':', b' ', 0xF0, 0x9F];
        let chunk3: Vec<u8> = vec![0xA6, 0x80, b'\n'];

        let mut raw_buffer: Vec<u8> = Vec::new();
        let mut parsed_lines = Vec::new();

        for chunk in [chunk1, chunk2, chunk3] {
            raw_buffer.extend_from_slice(&chunk);
            while let Some(pos) = raw_buffer.iter().position(|&b| b == b'\n') {
                let line_bytes = &raw_buffer[..pos];
                let line = String::from_utf8_lossy(line_bytes).trim().to_string();
                raw_buffer.drain(..=pos);
                parsed_lines.push(line);
            }
        }

        assert_eq!(parsed_lines.len(), 2);
        assert_eq!(parsed_lines[0], "data: 中");
        assert_eq!(parsed_lines[1], "data: 🦀");
        assert!(!parsed_lines[0].contains('\u{FFFD}'));
        assert!(!parsed_lines[1].contains('\u{FFFD}'));
    }

    #[tokio::test]
    async fn test_bidi_notification_race_resolution() {
        let req_id = "test_race_req_123".to_string();

        let req_id_clone = req_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            {
                let mut map = SESSION_MAP.lock().await;
                map.insert(
                    req_id_clone.clone(),
                    BidiSession {
                        request_id: req_id_clone,
                        user_prompt: "Race test prompt".to_string(),
                        model: "test-model".to_string(),
                        history: vec![],
                        context_files: vec![],
                        context_codes: vec![],
                        context_rules: vec![],
                        extra_context: vec![],
                        last_seqno: 1,
                        created_at: std::time::Instant::now(),
                    },
                );
            }
            SESSION_NOTIFY.notify_waiters();
        });

        // 模拟 RunSSE 等待
        let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
        let session = loop {
            let notified = SESSION_NOTIFY.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();

            {
                let map = SESSION_MAP.lock().await;
                if let Some(s) = map.get(&req_id) {
                    if !s.user_prompt.trim().is_empty() || !s.history.is_empty() {
                        break Some(s.clone());
                    }
                }
            }

            if tokio::time::timeout_at(deadline, notified.as_mut())
                .await
                .is_err()
            {
                let map = SESSION_MAP.lock().await;
                break map.get(&req_id).cloned();
            }
        };

        let found = session.expect("should find session without race condition");
        assert_eq!(found.user_prompt, "Race test prompt");
        assert_eq!(found.model, "test-model");

        // 清理测试会话
        let mut map = SESSION_MAP.lock().await;
        map.remove(&req_id);
    }
}

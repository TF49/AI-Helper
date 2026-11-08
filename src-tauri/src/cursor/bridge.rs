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
    collections::{HashMap, HashSet},
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
// Serialize start/port-recovery sequences so two callers cannot both bind a
// preferred port before either one publishes its bridge handle.
static START_CURSOR_BRIDGE: TokioMutex<()> = TokioMutex::const_new(());
// In-flight Agent streams. Graceful shutdown would otherwise wait on (or be
// aborted around) streaming responses whose detached tasks keep running tools
// and calling the upstream after the bridge is gone.
static AGENT_TASKS: Lazy<AgentTaskSet> =
    Lazy::new(|| std::sync::Mutex::new(tokio::task::JoinSet::new()));

type AgentTaskSet = std::sync::Mutex<tokio::task::JoinSet<()>>;

fn spawn_agent_task(task: impl std::future::Future<Output = ()> + Send + 'static) {
    spawn_tracked(&AGENT_TASKS, task);
}

/// Abort every in-flight Agent stream; returns how many were still running.
fn abort_agent_tasks() -> usize {
    abort_tracked(&AGENT_TASKS)
}

fn spawn_tracked(set: &AgentTaskSet, task: impl std::future::Future<Output = ()> + Send + 'static) {
    let mut tasks = set
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // Reap finished tasks so the set only holds live streams.
    while tasks.try_join_next().is_some() {}
    tasks.spawn(task);
}

fn abort_tracked(set: &AgentTaskSet) -> usize {
    let mut tasks = set
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    while tasks.try_join_next().is_some() {}
    let running = tasks.len();
    tasks.abort_all();
    running
}

/// Aborts the wrapped task when dropped. A plain `JoinHandle` detaches on
/// drop, so aborting the stream task would otherwise leave the inner agent
/// (and its blocking tools) running.
struct AbortOnDrop(tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

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
    let reset_generation = crate::reset::current_generation();
    let fingerprint =
        crate::cursor::config::model_source_fingerprint(&config.base_url, &config.api_key);
    if config.api_key.trim().is_empty() || config.base_url.trim().is_empty() {
        return Vec::new();
    }

    match crate::model_fetch::fetch_models(&config.base_url, &config.api_key).await {
        Ok(models) => {
            let mut seen = HashSet::new();
            let ids: Vec<String> = models
                .into_iter()
                .map(|m| m.id.trim().to_string())
                .filter(|id| !id.is_empty() && seen.insert(id.clone()))
                .collect();
            // The config lock and file I/O block; keep them off the async workers.
            let cache_ids = ids.clone();
            let written = tokio::task::spawn_blocking(move || {
                crate::reset::with_config_write_at_generation(reset_generation, || {
                    remember_model_list(fingerprint.clone(), cache_ids.clone());
                    let mut latest = load_cursor_config();
                    let latest_fp = crate::cursor::config::model_source_fingerprint(
                        &latest.base_url,
                        &latest.api_key,
                    );
                    if latest_fp == fingerprint
                        && (latest.cached_models != cache_ids
                            || latest.cached_models_fingerprint != fingerprint)
                    {
                        latest.cached_models = cache_ids;
                        latest.cached_models_fingerprint = fingerprint;
                        if let Ok(path) = crate::cursor::get_cursor_config_path() {
                            if let Err(e) =
                                crate::cursor::config::save_cursor_config_unlocked(&latest, &path)
                            {
                                log::warn!("回写 Cursor 模型缓存失败: {e}");
                            }
                        }
                    }
                    Ok(())
                })
            })
            .await;
            match written {
                Ok(Ok(())) => {}
                Ok(Err(e)) => log::warn!("回写 Cursor 模型缓存前配置锁失败: {e}"),
                Err(e) => log::warn!("回写 Cursor 模型缓存任务异常: {e}"),
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
    let mut seen = HashSet::new();
    let mut ordered = Vec::with_capacity(models.len() + 1);

    // Only promote the selected model when the current API Key actually
    // advertises it.  This keeps Cursor's list consistent with Accio and
    // avoids presenting an unavailable model as usable.
    if !selected_trim.is_empty() && models.iter().any(|model| model.trim() == selected_trim) {
        ordered.push(selected_trim.to_string());
        seen.insert(selected_trim.to_string());
    }

    for model in models.drain(..) {
        let trimmed = model.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            ordered.push(trimmed.to_string());
        }
    }

    ordered
}

fn default_model_from_available(configured: &str, models: &[String]) -> String {
    let configured = configured.trim();
    if !configured.is_empty() && models.iter().any(|model| model.trim() == configured) {
        return configured.to_string();
    }
    models
        .iter()
        .find_map(|model| {
            let trimmed = model.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
        .or_else(|| (!configured.is_empty()).then(|| configured.to_string()))
        .unwrap_or_else(|| "gpt-5.6-sol".to_string())
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
    request_id: String,
    /// Cursor 会话标识，跨轮稳定；用于在请求缺少内联历史时从本地缓存补全。
    conversation_id: Option<String>,
    /// 当前用户消息标识；与已缓存轮次重复时表示重新生成/编辑旧消息。
    message_id: Option<String>,
    user_prompt: String,
    model: String,
    history: Vec<(String, String)>,
    context_files: Vec<(String, String)>,
    context_codes: Vec<(String, String)>,
    context_rules: Vec<(String, String)>,
    extra_context: Vec<String>,
    images: Vec<crate::cursor::protocol::CursorImageData>,
    workspace_paths: Vec<String>,
    shell: Option<String>,
    project_folder: Option<String>,
    process_working_directory: Option<String>,
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
        total += [&self.conversation_id, &self.message_id]
            .iter()
            .filter_map(|v| v.as_ref())
            .map(String::len)
            .sum::<usize>();
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
        total += self.workspace_paths.iter().map(String::len).sum::<usize>();
        total += [
            &self.shell,
            &self.project_folder,
            &self.process_working_directory,
        ]
        .iter()
        .filter_map(|v| v.as_ref())
        .map(String::len)
        .sum::<usize>();
        total += self
            .images
            .iter()
            .map(|img| img.base64.len() + img.mime_type.len())
            .sum::<usize>();
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

/// 新建一个空的 BidiSession（尚未收到任何轮次内容）
fn empty_session(request_id: &str, default_model: &str) -> BidiSession {
    BidiSession {
        request_id: request_id.to_string(),
        conversation_id: None,
        message_id: None,
        user_prompt: String::new(),
        model: default_model.to_string(),
        history: Vec::new(),
        context_files: Vec::new(),
        context_codes: Vec::new(),
        context_rules: Vec::new(),
        extra_context: Vec::new(),
        images: Vec::new(),
        workspace_paths: Vec::new(),
        shell: None,
        project_folder: None,
        process_working_directory: None,
        last_seqno: -1,
        created_at: std::time::Instant::now(),
    }
}

/// 把一条携带轮次内容的 BidiAppend 合并进会话。
///
/// 序号不小于已处理序号时覆盖对应字段；乱序到达的较旧内容包只补齐仍为空的字段，
/// 不会被整体丢弃（否则先到的空控制包会让真正的用户请求失效）。
fn merge_turn_into_session(
    candidate: &mut BidiSession,
    decoded: crate::cursor::protocol::DecodedBidiMessage,
) {
    let newer = decoded.seqno >= candidate.last_seqno;
    let awaiting_turn = candidate.user_prompt.trim().is_empty() && candidate.history.is_empty();
    if newer {
        candidate.last_seqno = decoded.seqno;
    }
    let take = |slot_empty: bool| newer || slot_empty;

    if !decoded.user_text.trim().is_empty() && take(candidate.user_prompt.trim().is_empty()) {
        candidate.user_prompt = decoded.user_text;
    }
    if let Some(m) = decoded.model {
        if !m.trim().is_empty() && m.len() < 256 && (newer || awaiting_turn) {
            candidate.model = m;
        }
    }
    // 限制 history 条数和总大小
    if !decoded.history.is_empty() && take(candidate.history.is_empty()) {
        let mut new_history = decoded.history;
        if new_history.len() > MAX_HISTORY_ITEMS {
            new_history.drain(..new_history.len() - MAX_HISTORY_ITEMS);
        }
        candidate.history = new_history;
    }
    if !decoded.context_files.is_empty() && take(candidate.context_files.is_empty()) {
        candidate.context_files = decoded.context_files;
    }
    if !decoded.context_codes.is_empty() && take(candidate.context_codes.is_empty()) {
        candidate.context_codes = decoded.context_codes;
    }
    if !decoded.context_rules.is_empty() && take(candidate.context_rules.is_empty()) {
        candidate.context_rules = decoded.context_rules;
    }
    if !decoded.extra_context.is_empty() && take(candidate.extra_context.is_empty()) {
        candidate.extra_context = decoded.extra_context;
    }
    if !decoded.images.is_empty() && take(candidate.images.is_empty()) {
        candidate.images = decoded.images;
    }
    if !decoded.workspace_paths.is_empty() {
        // A session that already has a valid workspace root keeps it:
        // a later append must not redirect the agent's file tools.
        let has_root = candidate
            .workspace_paths
            .iter()
            .any(|path| crate::cursor::workspace_auth::canonical_root(path).is_some());
        if has_root {
            if decoded.workspace_paths != candidate.workspace_paths {
                log::warn!("Cursor BidiAppend 试图替换已有工作区根目录，已忽略");
            }
        } else {
            candidate.workspace_paths = decoded.workspace_paths;
        }
    }
    if decoded.shell.is_some() && take(candidate.shell.is_none()) {
        candidate.shell = decoded.shell;
    }
    if decoded.project_folder.is_some() && take(candidate.project_folder.is_none()) {
        candidate.project_folder = decoded.project_folder;
    }
    if decoded.process_working_directory.is_some()
        && take(candidate.process_working_directory.is_none())
    {
        candidate.process_working_directory = decoded.process_working_directory;
    }
    if decoded.conversation_id.is_some() && take(candidate.conversation_id.is_none()) {
        candidate.conversation_id = decoded.conversation_id;
    }
    if decoded.message_id.is_some() && take(candidate.message_id.is_none()) {
        candidate.message_id = decoded.message_id;
    }
}

/// 日志用的短摘要：标识符的 SHA-256 前 8 位十六进制，可跨日志关联但不暴露原值。
fn short_hash(value: Option<&str>) -> String {
    use sha2::{Digest, Sha256};
    match value {
        Some(value) if !value.is_empty() => hex::encode(&Sha256::digest(value.as_bytes())[..4]),
        _ => "-".to_string(),
    }
}

/// 结构摘要去掉长度后的形状，用于控制包日志去重。
fn shape_key(shape: &str) -> String {
    let mut key = String::with_capacity(shape.len());
    let mut skipping_len = false;
    for ch in shape.chars() {
        if skipping_len && ch.is_ascii_digit() {
            continue;
        }
        skipping_len = ch == 'L';
        key.push(ch);
    }
    key
}

/// 控制包按形状只在首次出现时以 info 级别记录，避免心跳刷屏。
static SEEN_CONTROL_SHAPES: Lazy<std::sync::Mutex<HashSet<String>>> =
    Lazy::new(|| std::sync::Mutex::new(HashSet::new()));
const MAX_SEEN_CONTROL_SHAPES: usize = 256;

fn first_sighting_of_control_shape(shape: &str) -> bool {
    let mut seen = SEEN_CONTROL_SHAPES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    seen.len() < MAX_SEEN_CONTROL_SHAPES && seen.insert(shape_key(shape))
}

// ===== 跨轮会话历史缓存 =====
//
// 部分 Cursor 版本在后续轮次不内联完整历史，而依赖服务端保存会话状态；本地桥接
// 此前不保存任何跨轮状态，导致第二轮只把当前问题发给模型。这里按 conversation_id
// 保存已成功完成的轮次，仅在请求缺少内联历史时用于补全。只驻留内存，桥接停止或
// 重置时清空。
const CONVERSATION_TTL: Duration = Duration::from_secs(2 * 60 * 60);
const MAX_CONVERSATIONS: usize = 200;
const MAX_CONVERSATION_BYTES: usize = 2 * 1024 * 1024;
const MAX_CONVERSATION_STORE_BYTES: usize = 32 * 1024 * 1024;
/// 单轮回答最多缓存的字节数
const MAX_ASSISTANT_CAPTURE_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
struct StoredMessage {
    role: String,
    text: String,
    message_id: Option<String>,
}

impl StoredMessage {
    fn bytes(&self) -> usize {
        self.role.len() + self.text.len() + self.message_id.as_ref().map_or(0, String::len)
    }
}

#[derive(Debug)]
struct StoredConversation {
    messages: Vec<StoredMessage>,
    last_used: std::time::Instant,
}

impl StoredConversation {
    fn bytes(&self) -> usize {
        self.messages.iter().map(StoredMessage::bytes).sum()
    }

    /// 截止到 `message_id` 对应轮次之前的消息；message_id 未出现过时返回全部。
    fn prefix_before(&self, message_id: Option<&str>) -> &[StoredMessage] {
        let end = message_id
            .and_then(|id| {
                self.messages
                    .iter()
                    .position(|m| m.role == "user" && m.message_id.as_deref() == Some(id))
            })
            .unwrap_or(self.messages.len());
        &self.messages[..end]
    }
}

#[derive(Default)]
struct ConversationStore {
    conversations: HashMap<String, StoredConversation>,
}

/// 本轮发往模型的历史来自哪里
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HistorySource {
    /// Cursor 在本轮请求中内联发送
    Inline,
    /// 从本地会话缓存补全
    Store,
    /// 没有历史（新会话，或缺少 conversation_id 无法补全）
    Empty,
}

impl HistorySource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Inline => "inline",
            Self::Store => "store",
            Self::Empty => "none",
        }
    }
}

impl ConversationStore {
    fn prune(&mut self, now: std::time::Instant) {
        self.conversations
            .retain(|_, c| now.saturating_duration_since(c.last_used) < CONVERSATION_TTL);
    }

    /// 取该会话在当前消息之前的历史。若当前 message_id 已缓存过（重新生成或编辑旧
    /// 消息），只返回该轮之前的部分，避免把作废的回答当作上下文。
    fn history_before(
        &mut self,
        conversation_id: &str,
        message_id: Option<&str>,
        now: std::time::Instant,
    ) -> Vec<(String, String)> {
        self.prune(now);
        let Some(conversation) = self.conversations.get_mut(conversation_id) else {
            return Vec::new();
        };
        conversation.last_used = now;
        conversation
            .prefix_before(message_id)
            .iter()
            .map(|m| (m.role.clone(), m.text.clone()))
            .collect()
    }

    /// 记录一轮成功完成的对话：`base` 为本轮实际发送给模型的历史。
    #[allow(clippy::too_many_arguments)]
    fn remember_turn(
        &mut self,
        conversation_id: &str,
        source: HistorySource,
        base: &[(String, String)],
        user: &str,
        message_id: Option<&str>,
        assistant: &str,
        now: std::time::Instant,
    ) {
        self.prune(now);
        // 历史来自缓存时沿用缓存条目（保留 message_id，便于后续识别重新生成）。
        let mut messages: Vec<StoredMessage> =
            match (source, self.conversations.get(conversation_id)) {
                (HistorySource::Store, Some(existing)) => {
                    existing.prefix_before(message_id).to_vec()
                }
                _ => base
                    .iter()
                    .map(|(role, text)| StoredMessage {
                        role: role.clone(),
                        text: text.clone(),
                        message_id: None,
                    })
                    .collect(),
            };
        if !user.trim().is_empty() {
            messages.push(StoredMessage {
                role: "user".into(),
                text: user.to_string(),
                message_id: message_id.map(str::to_string),
            });
        }
        if !assistant.trim().is_empty() {
            messages.push(StoredMessage {
                role: "assistant".into(),
                text: assistant.to_string(),
                message_id: None,
            });
        }
        // 单会话预算：从最旧的消息开始丢弃，并保证历史以 user 消息开头。
        let mut bytes: usize = messages.iter().map(StoredMessage::bytes).sum();
        let mut skip = 0;
        while skip < messages.len()
            && (messages.len() - skip > MAX_HISTORY_ITEMS
                || bytes > MAX_CONVERSATION_BYTES
                || (skip > 0 && messages[skip].role != "user"))
        {
            bytes -= messages[skip].bytes();
            skip += 1;
        }
        messages.drain(..skip);
        if messages.is_empty() {
            // 本轮放不进预算：丢弃旧缓存，避免之后补全出与实际对话不一致的历史。
            self.conversations.remove(conversation_id);
            return;
        }
        self.conversations.insert(
            conversation_id.to_string(),
            StoredConversation {
                messages,
                last_used: now,
            },
        );
        // 全局预算：按最近使用时间淘汰其他会话。
        loop {
            let total: usize = self
                .conversations
                .values()
                .map(StoredConversation::bytes)
                .sum();
            if self.conversations.len() <= MAX_CONVERSATIONS
                && total <= MAX_CONVERSATION_STORE_BYTES
            {
                break;
            }
            let Some(oldest) = self
                .conversations
                .iter()
                .filter(|(key, _)| key.as_str() != conversation_id)
                .min_by_key(|(_, c)| c.last_used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.conversations.remove(&oldest);
        }
    }

    fn clear(&mut self) {
        self.conversations.clear();
    }
}

static CONVERSATION_STORE: Lazy<std::sync::Mutex<ConversationStore>> =
    Lazy::new(|| std::sync::Mutex::new(ConversationStore::default()));

fn conversation_store() -> std::sync::MutexGuard<'static, ConversationStore> {
    CONVERSATION_STORE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// 请求缺少内联历史时，按 conversation_id 从本地缓存补全。
fn resolve_history(session: &mut BidiSession, store: &mut ConversationStore) -> HistorySource {
    if !session.history.is_empty() {
        return HistorySource::Inline;
    }
    let Some(conversation_id) = session.conversation_id.as_deref() else {
        return HistorySource::Empty;
    };
    let history = store.history_before(
        conversation_id,
        session.message_id.as_deref(),
        std::time::Instant::now(),
    );
    if history.is_empty() {
        return HistorySource::Empty;
    }
    session.history = history;
    HistorySource::Store
}

/// Connect 一元调用错误响应（HTTP 状态码 + JSON 错误体）
fn connect_unary_error(status: StatusCode, code: &str, message: &str) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header("connect-protocol-version", "1")
        .body(Body::from(
            json!({"code": code, "message": message}).to_string(),
        ))
        .unwrap_or_else(|_| (status, message.to_string()).into_response())
}

static SESSION_MAP: Lazy<Arc<TokioMutex<HashMap<String, BidiSession>>>> =
    Lazy::new(|| Arc::new(TokioMutex::new(HashMap::new())));

static SESSION_NOTIFY: Lazy<Arc<Notify>> = Lazy::new(|| Arc::new(Notify::new()));

pub fn is_bridge_running() -> bool {
    let mut guard = RUNNING_CURSOR_BRIDGE.blocking_lock();
    if guard
        .as_ref()
        .is_some_and(|handle| handle.join_handle.is_finished())
    {
        *guard = None;
    }
    guard.is_some()
}

pub fn get_bridge_port() -> Option<u16> {
    let mut guard = RUNNING_CURSOR_BRIDGE.blocking_lock();
    if guard
        .as_ref()
        .is_some_and(|handle| handle.join_handle.is_finished())
    {
        *guard = None;
    }
    guard.as_ref().map(|h| h.port)
}

/// 直接持有成功绑定的监听器，避免“先探测再 bind”产生竞态。
/// 首选端口被其他程序占用时，在有限范围内自动避让到下一个空闲端口。
pub async fn bind_listener(start_port: u16) -> Result<(TcpListener, u16), String> {
    for retry in 0..6 {
        match TcpListener::bind(("127.0.0.1", start_port)).await {
            Ok(listener) => {
                let actual_port = listener
                    .local_addr()
                    .map_err(|e| format!("无法获取 Cursor Bridge 实际端口: {e}"))?
                    .port();
                return Ok((listener, actual_port));
            }
            Err(error) => {
                log::debug!(
                    "Cursor Bridge 绑定端口 {} 失败（重试 {}/6）: {}",
                    start_port,
                    retry + 1,
                    error
                );
                if retry < 5 {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                }
            }
        }
    }

    for offset in 1..=20 {
        let Some(candidate) = start_port.checked_add(offset) else {
            break;
        };
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", candidate)).await {
            log::warn!(
                "Cursor Bridge 首选端口 {} 被占用，已自动切换到 {}",
                start_port,
                candidate
            );
            return Ok((listener, candidate));
        }
    }

    Err(format!(
        "无法在端口 {}..={} 建立 Cursor Bridge，请检查本机端口占用",
        start_port,
        start_port.saturating_add(20)
    ))
}

/// `generation` is supplied by callers that belong to a configuration task.
/// It is checked while holding the start lock so a task that resumes after a
/// reset began (or finished) can no longer start the bridge.
pub async fn start_bridge(port: Option<u16>, generation: Option<u64>) -> Result<u16, String> {
    let _start_guard = START_CURSOR_BRIDGE.lock().await;
    if crate::reset::is_resetting() {
        return Err("客户端配置正在清除，暂不能启动 Cursor Bridge".into());
    }
    if let Some(generation) = generation {
        crate::reset::ensure_generation(generation).map_err(|error| error.to_string())?;
    }

    {
        let guard = RUNNING_CURSOR_BRIDGE.lock().await;

        if let Some(ref handle) = *guard {
            if !handle.join_handle.is_finished() && (port.is_none() || port == Some(handle.port)) {
                return Ok(handle.port);
            }
        }
    }

    // 配置端口发生变化时，先优雅停止旧实例再重新绑定；只有 AI Helper
    // 自己持有的 Bridge 会走到这里，不会触碰其他程序的端口进程。
    // 这里仍在 Tokio 异步上下文中，必须使用异步锁，不能调用
    // `is_bridge_running()` 的 `blocking_lock()`，否则会触发运行时 panic。
    let should_stop_existing = {
        let mut guard = RUNNING_CURSOR_BRIDGE.lock().await;
        if guard
            .as_ref()
            .is_some_and(|handle| handle.join_handle.is_finished())
        {
            *guard = None;
            false
        } else {
            guard.is_some()
        }
    };
    if should_stop_existing {
        stop_bridge().await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let config = load_cursor_config();
    let target_port = port.unwrap_or(config.bridge_port);

    let (listener, actual_port) = bind_listener(target_port).await?;

    if actual_port != config.bridge_port {
        let mut updated = config.clone();
        updated.bridge_port = actual_port;
        match generation {
            Some(generation) => {
                crate::cursor::config::save_cursor_config_at_generation(&updated, generation)
            }
            None => crate::cursor::config::save_cursor_config(&updated),
        }
        .map_err(|e| format!("Bridge 已切换端口，但写回 Cursor 配置失败: {e}"))?;
        log::warn!(
            "Cursor Bridge 端口已自适应切换: {} -> {}；下次挂接将使用新端口",
            config.bridge_port,
            actual_port
        );
    }

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
        ))
        // Outermost layer: every route (including CORS preflight) first proves
        // that the connecting process belongs to the same OS user.
        .layer(axum::middleware::from_fn({
            let lookup = crate::cursor::process_auth::system_lookup();
            move |req: Request, next: axum::middleware::Next| {
                crate::cursor::process_auth::peer_auth_middleware(lookup.clone(), req, next)
            }
        }));

    let join_handle = tokio::spawn(async move {
        let server = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<crate::cursor::process_auth::PeerConnection>(
            ),
        );
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
    stop_bridge_inner().await
}

pub async fn stop_bridge_for_reset() -> Result<(), String> {
    let _start_guard = START_CURSOR_BRIDGE.lock().await;
    stop_bridge_inner().await
}

async fn stop_bridge_inner() -> Result<(), String> {
    let handle_opt = {
        let mut guard = RUNNING_CURSOR_BRIDGE.lock().await;
        guard.take()
    };

    if let Some(handle) = handle_opt {
        let CursorBridgeHandle {
            port,
            shutdown_tx,
            mut join_handle,
        } = handle;
        let _ = shutdown_tx.send(());
        // Ending the Agent streams lets graceful shutdown finish promptly.
        let aborted = abort_agent_tasks();
        if aborted > 0 {
            log::info!("Cursor Bridge 停止，已取消 {} 个在途 Agent 任务", aborted);
        }
        if tokio::time::timeout(Duration::from_millis(1500), &mut join_handle)
            .await
            .is_err()
        {
            log::warn!("Cursor Bridge 未在超时内退出，正在中止自有后台任务");
            join_handle.abort();
            let _ = join_handle.await;
        }
        // A request accepted just before shutdown may have spawned its agent
        // after the first pass; the server task has ended, so this is final.
        abort_agent_tasks();
        tokio::time::sleep(Duration::from_millis(150)).await;
        log::info!("AI-Helper Cursor Bridge 已停止 (释放端口 {})", port);
    }
    // 会话内容只驻留内存，桥接停止或重置时一并清空。
    conversation_store().clear();
    SESSION_MAP.lock().await.clear();
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
    let models = load_key_model_ids(&cfg).await;
    let default_m = default_model_from_available(&cfg.model, &models);
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
    let models = load_key_model_ids(&cfg).await;
    let default_m = default_model_from_available(&cfg.model, &models);
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

async fn send_stream_frame(tx: &StreamSender, frame: Vec<u8>) -> Result<(), ()> {
    tx.send(Ok(Bytes::from(frame))).await.map_err(|_| ())
}

fn encode_agent_event(event: crate::cursor::agent::AgentEvent, is_proto: bool) -> Vec<u8> {
    match event {
        crate::cursor::agent::AgentEvent::Text(text) => {
            if is_proto {
                create_agent_text_chunk(&text)
            } else {
                create_agent_json_text_chunk(&text)
            }
        }
        crate::cursor::agent::AgentEvent::Thinking(text)
        | crate::cursor::agent::AgentEvent::Tool(text) => {
            if is_proto {
                create_agent_thinking_chunk(&text)
            } else {
                create_agent_json_thinking_chunk(&text)
            }
        }
    }
}

#[derive(Clone, Copy)]
enum StreamKind {
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
        let content = delta.and_then(|v| v.get("content")).and_then(Value::as_str);
        let mut frames = Vec::new();
        if let Some(text) = content.filter(|s| !s.is_empty()) {
            if text.len() > MAX_GENERATION_BYTES.saturating_sub(self.generated_bytes) {
                return Err(("resource_exhausted", "Generation limit exceeded"));
            }
            self.generated_bytes += text.len();
            let frame = match self.kind {
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
        Ok(()) => create_connect_end_frame(),
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

fn agent_messages(session: &BidiSession) -> Result<Vec<Value>, String> {
    let (system_context, user_context) = session
        .formatted_context()
        .map_err(|message| message.to_string())?;
    let mut messages = Vec::new();
    if !system_context.is_empty() {
        messages.push(json!({"role":"system","content":system_context}));
    }
    for (role, content) in &session.history {
        messages.push(json!({"role":role,"content":content}));
    }
    let full_user_content = if user_context.is_empty() {
        session.user_prompt.clone()
    } else {
        format!("{}\n\n{}", user_context, session.user_prompt)
    };
    messages.push(json!({
        "role":"user",
        "content": crate::cursor::protocol::build_openai_multimodal_content(&full_user_content, &session.images)
    }));
    Ok(messages)
}

/// Execute the local workspace tool loop and translate its events into Cursor frames.
/// This is shared by RunSSE and Run so both transports have identical capabilities.
async fn run_cursor_agent_stream(
    mut session: BidiSession,
    is_proto: bool,
    content_type: &'static str,
    transport: &'static str,
) -> Response {
    let config = load_cursor_config();
    let history_source = resolve_history(&mut session, &mut conversation_store());
    log::info!(
        "Cursor Agent 派发 [{}] request: {}, conversation: {}, message_id: {}, history: {} 条 (来源: {}), prompt 长度: {}, files: {}, images: {}, workspace roots: {}, model: {}",
        transport,
        short_hash(Some(&session.request_id)),
        short_hash(session.conversation_id.as_deref()),
        if session.message_id.is_some() { "有" } else { "无" },
        session.history.len(),
        history_source.as_str(),
        session.user_prompt.len(),
        session.context_files.len(),
        session.images.len(),
        session.workspace_paths.len(),
        session.model
    );
    if history_source == HistorySource::Empty && session.conversation_id.is_none() {
        log::warn!(
            "Cursor Agent 请求既无内联历史也无 conversation_id，无法补全跨轮上下文，本轮按单轮发送"
        );
    }
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(128);
    spawn_agent_task(async move {
        let send = send_stream_frame;
        let heartbeat = if is_proto {
            create_agent_heartbeat_chunk()
        } else {
            create_agent_json_heartbeat_chunk()
        };
        if send(&tx, heartbeat).await.is_err() {
            return;
        }
        // 累积模型可见回答，成功结束后写入跨轮会话缓存。
        let mut assistant_text = String::new();
        let mut capture = |event: &crate::cursor::agent::AgentEvent| {
            if let crate::cursor::agent::AgentEvent::Text(text) = event {
                if assistant_text.len() + text.len() <= MAX_ASSISTANT_CAPTURE_BYTES {
                    assistant_text.push_str(text);
                }
            }
        };
        let messages = match agent_messages(&session) {
            Ok(messages) => messages,
            Err(error) => {
                let _ = send(
                    &tx,
                    create_connect_error_frame("resource_exhausted", &error),
                )
                .await;
                return;
            }
        };
        let input = crate::cursor::agent::AgentInput {
            model: session.model.clone(),
            base_url: config.base_url.clone(),
            api_key: config.api_key.clone(),
            messages,
            workspace_paths: session.workspace_paths.clone(),
            project_folder: session.project_folder.clone(),
            process_working_directory: session.process_working_directory.clone(),
        };
        let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(32);
        let agent_task = tokio::spawn(crate::cursor::agent::run_agent(input, event_tx));
        // Aborting this stream task (bridge stop) must also stop the agent.
        let _abort_agent = AbortOnDrop(agent_task.abort_handle());
        let mut agent = Box::pin(agent_task);
        let completion = loop {
            tokio::select! {
                event = event_rx.recv() => {
                    let Some(event) = event else { break (&mut agent).await; };
                    capture(&event);
                    if send(&tx, encode_agent_event(event, is_proto)).await.is_err() {
                        agent.as_mut().abort();
                        let _ = (&mut agent).await;
                        return;
                    }
                }
                result = &mut agent => break result,
                _ = tx.closed() => {
                    agent.as_mut().abort();
                    let _ = (&mut agent).await;
                    return;
                }
                _ = tokio::time::sleep(Duration::from_secs(15)) => {
                    if send(&tx, if is_proto { create_agent_heartbeat_chunk() } else { create_agent_json_heartbeat_chunk() }).await.is_err() {
                        agent.as_mut().abort();
                        let _ = (&mut agent).await;
                        return;
                    }
                }
            }
        };
        // A task can finish while the channel still contains final text events.
        // Drain them before closing the Cursor turn rather than dropping the answer.
        while let Ok(event) = event_rx.try_recv() {
            capture(&event);
            if send(&tx, encode_agent_event(event, is_proto))
                .await
                .is_err()
            {
                return;
            }
        }
        match completion {
            Ok(Ok(_)) => {
                if let Some(conversation_id) = session.conversation_id.as_deref() {
                    conversation_store().remember_turn(
                        conversation_id,
                        history_source,
                        &session.history,
                        &session.user_prompt,
                        session.message_id.as_deref(),
                        &assistant_text,
                        std::time::Instant::now(),
                    );
                }
            }
            Ok(Err(error)) => {
                let _ = send(
                    &tx,
                    create_connect_error_frame(
                        "internal",
                        &format!("【AI-Helper Agent】{}", error),
                    ),
                )
                .await;
                return;
            }
            Err(error) => {
                let _ = send(
                    &tx,
                    create_connect_error_frame("internal", &format!("Agent 任务异常: {}", error)),
                )
                .await;
                return;
            }
        }
        if is_proto {
            let _ = send(&tx, create_agent_turn_ended_chunk()).await;
        }
        let _ = send(&tx, create_connect_end_frame()).await;
    });
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("connect-protocol-version", "1")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(ReceiverStream(rx)))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法创建响应流").into_response())
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

    let Some(decoded) = decode_bidi_append(&bytes) else {
        log::warn!(
            "Cursor BidiAppend 收到无法解析的消息体 (长度: {} 字节)，已返回错误",
            bytes.len()
        );
        return connect_unary_error(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "AI-Helper 无法解析 Cursor BidiAppend 消息",
        );
    };

    // 限制 request_id 长度防止内存攻击；空 request_id 无法与 RunSSE 关联，直接拒绝，
    // 避免不同会话的数据混入同一个空键。
    if decoded.request_id.is_empty() || decoded.request_id.len() > MAX_REQUEST_ID_LENGTH {
        log::warn!(
            "拒绝 request_id 无效的 Cursor BidiAppend (长度: {} 字节, kind: {}, 结构: {})",
            decoded.request_id.len(),
            decoded.kind.as_str(),
            decoded.wire_shape
        );
        return connect_unary_error(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Cursor BidiAppend 缺少有效 request_id",
        );
    }

    if !decoded.kind.carries_turn() {
        // 控制包（心跳、KV、exec 等）不含用户轮次，不创建或修改会话。
        // 每种结构只在首次出现时以 info 记录，便于确认其中没有被漏解析的用户消息。
        if first_sighting_of_control_shape(&decoded.wire_shape) {
            log::info!(
                "Cursor BidiAppend 控制包 [{}] seqno: {}, 结构: {}",
                short_hash(Some(&decoded.request_id)),
                decoded.seqno,
                decoded.wire_shape
            );
        } else {
            log::debug!(
                "Cursor BidiAppend 控制包 [{}] seqno: {}, 结构: {}",
                short_hash(Some(&decoded.request_id)),
                decoded.seqno,
                decoded.wire_shape
            );
        }
    } else {
        log::info!(
            "Cursor BidiAppend 用户轮次 [{}] seqno: {}, kind: {}, conversation: {}, message_id: {}, model: {:?}, history: {} 条, files: {}, images: {}, prompt 长度: {}, 结构: {}",
            short_hash(Some(&decoded.request_id)),
            decoded.seqno,
            decoded.kind.as_str(),
            short_hash(decoded.conversation_id.as_deref()),
            if decoded.message_id.is_some() { "有" } else { "无" },
            decoded.model,
            decoded.history.len(),
            decoded.context_files.len(),
            decoded.images.len(),
            decoded.user_text.len(),
            decoded.wire_shape
        );

        let default_model = load_cursor_config().model;
        let mut map = SESSION_MAP.lock().await;

        // 清理超期 5 分钟的过期 session
        map.retain(|_, s| s.created_at.elapsed() < Duration::from_secs(300));

        // 构建候选会话状态（先不修改缓存）
        let request_id = decoded.request_id.clone();
        let mut candidate = map
            .get(&request_id)
            .cloned()
            .unwrap_or_else(|| empty_session(&request_id, &default_model));
        merge_turn_into_session(&mut candidate, decoded);

        if let Err(message) = commit_session(&mut map, request_id, candidate) {
            return (StatusCode::PAYLOAD_TOO_LARGE, message).into_response();
        }

        SESSION_NOTIFY.notify_waiters();
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
    log::info!(
        "Cursor RunSSE 发起订阅, request: {}",
        short_hash(req_id_opt.as_deref())
    );

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
        // Complete the Cursor stream handshake before waiting for BidiAppend.
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

        let mut session_data = match session {
            Some(s) => s,
            None => {
                // 不再以“正常结束”掩盖失败：明确告知用户本轮请求未送达模型。
                let (code, message) = if cleanup_req_id.is_some() {
                    (
                        "deadline_exceeded",
                        "【AI-Helper】未在 5 秒内收到本轮 Cursor 请求内容，消息未发送给模型，请重试。",
                    )
                } else {
                    (
                        "invalid_argument",
                        "【AI-Helper】RunSSE 请求缺少 request_id，无法关联本轮消息，请重试。",
                    )
                };
                log::warn!(
                    "Cursor RunSSE 未找到对应轮次数据 [{}] ({})，返回错误帧",
                    short_hash(cleanup_req_id.as_deref()),
                    code
                );
                let mut frames = encode_agent_event(
                    crate::cursor::agent::AgentEvent::Text(message.to_string()),
                    is_proto,
                );
                frames.extend_from_slice(&create_connect_error_frame(code, message));
                let _ = tx.send(Ok(Bytes::from(frames))).await;
                return;
            }
        };

        let model_to_use = match session_data.model.trim() {
            "" | "default" | "auto" | "cursor-small" | "composer" => {
                if config.model.trim().is_empty() {
                    "gpt-5.6-sol".to_string()
                } else {
                    config.model.clone()
                }
            }
            other => other.to_string(),
        };

        session_data.model = model_to_use;
        let agent_response =
            run_cursor_agent_stream(session_data, is_proto, content_type, "RunSSE").await;
        use futures_util::StreamExt;
        let mut agent_body = agent_response.into_body().into_data_stream();
        while let Some(frame) = agent_body.next().await {
            match frame {
                Ok(frame) => {
                    if tx.send(Ok(frame)).await.is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
        // 无论正常结束还是客户端断开，都释放本轮会话。
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
        Some(d)
            if d.kind.carries_turn()
                && (!d.user_text.trim().is_empty()
                    || !d.history.is_empty()
                    || !d.images.is_empty()) =>
        {
            d
        }
        other => {
            // 不再以“正常结束”掩盖解析失败。
            log::warn!(
                "未能从 Agent Run 输入流解析出用户轮次 (首包 {} 字节, 结构: {})，返回错误帧",
                initial_buf.len(),
                other.map(|d| d.wire_shape).unwrap_or_else(|| "?".into())
            );
            let message = "【AI-Helper】无法解析 Cursor Agent Run 请求，消息未发送给模型，请重试。";
            let mut frames = encode_agent_event(
                crate::cursor::agent::AgentEvent::Text(message.to_string()),
                is_proto,
            );
            frames.extend_from_slice(&create_connect_error_frame("invalid_argument", message));
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header("connect-protocol-version", "1")
                .body(Body::from(frames))
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

    let session = BidiSession {
        request_id: decoded.request_id.clone(),
        conversation_id: decoded.conversation_id.clone(),
        message_id: decoded.message_id.clone(),
        user_prompt: decoded.user_text.clone(),
        model: model_to_use.to_string(),
        history: decoded.history.clone(),
        context_files: decoded.context_files.clone(),
        context_codes: decoded.context_codes.clone(),
        context_rules: decoded.context_rules.clone(),
        extra_context: decoded.extra_context.clone(),
        images: decoded.images.clone(),
        workspace_paths: decoded.workspace_paths.clone(),
        shell: decoded.shell.clone(),
        project_folder: decoded.project_folder.clone(),
        process_working_directory: decoded.process_working_directory.clone(),
        last_seqno: 0,
        created_at: std::time::Instant::now(),
    };

    run_cursor_agent_stream(session, is_proto, content_type, "AgentRun").await
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
            conversation_id: None,
            message_id: None,
            user_prompt: "test".into(),
            model: "test".into(),
            history: Vec::new(),
            context_files: Vec::new(),
            context_codes: Vec::new(),
            context_rules: Vec::new(),
            extra_context: Vec::new(),
            images: Vec::new(),
            workspace_paths: Vec::new(),
            shell: None,
            project_folder: None,
            process_working_directory: None,
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
        for kind in [StreamKind::Legacy, StreamKind::FastEdit] {
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
        for kind in [StreamKind::Legacy, StreamKind::FastEdit] {
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
            StreamKind::Legacy,
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
                StreamKind::Legacy,
                false,
            ),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn legacy_stream_ignores_reasoning_and_utf8_survives_chunk_split() {
        let line = format!(
            "data: {}\n",
            json!({"choices":[{"delta":{"reasoning_content":"reason"}}]})
        );
        let bytes = collect_test_stream(StreamKind::Legacy, false, vec![line.into_bytes()]).await;
        assert_eq!(decode_test_frames(&bytes).len(), 1);
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
                        conversation_id: None,
                        message_id: None,
                        user_prompt: "Race test prompt".to_string(),
                        model: "test-model".to_string(),
                        history: vec![],
                        context_files: vec![],
                        context_codes: vec![],
                        context_rules: vec![],
                        extra_context: vec![],
                        images: vec![],
                        workspace_paths: vec![],
                        shell: None,
                        project_folder: None,
                        process_working_directory: None,
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

    #[tokio::test]
    async fn occupied_preferred_port_is_avoided_without_killing_owner() {
        let occupied = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let preferred = occupied.local_addr().unwrap().port();
        let (fallback, actual) = bind_listener(preferred).await.unwrap();

        assert_ne!(actual, preferred);
        drop(fallback);
        // The unrelated listener remains alive: port recovery must never kill
        // an unknown process merely because it owns the preferred port.
        assert!(occupied.local_addr().is_ok());
    }

    #[test]
    fn selected_model_is_first_but_all_key_models_are_retained() {
        let models = with_selected_model(
            "glm-5.3",
            vec![
                "gpt-5.6-sol".into(),
                "glm-5.3".into(),
                "claude-sonnet-5-5".into(),
            ],
        );
        assert_eq!(models, ["glm-5.3", "gpt-5.6-sol", "claude-sonnet-5-5"]);
    }

    #[test]
    fn unavailable_selected_model_is_not_injected_into_key_models() {
        let models = with_selected_model(
            "glm-5.3",
            vec!["gpt-5.6-sol".into(), "claude-sonnet-5-5".into()],
        );
        assert_eq!(models, ["gpt-5.6-sol", "claude-sonnet-5-5"]);
    }

    #[test]
    fn unavailable_configured_default_falls_back_to_first_key_model() {
        let models = vec!["gpt-5.6-sol".into(), "claude-sonnet-5-5".into()];
        assert_eq!(
            default_model_from_available("glm-5.3", &models),
            "gpt-5.6-sol"
        );
        assert_eq!(
            default_model_from_available("claude-sonnet-5-5", &models),
            "claude-sonnet-5-5"
        );
    }

    #[tokio::test]
    async fn ephemeral_port_returns_the_actual_listener_port() {
        let (listener, actual) = bind_listener(0).await.unwrap();
        assert_ne!(actual, 0);
        assert_eq!(listener.local_addr().unwrap().port(), actual);
    }

    #[tokio::test]
    async fn stale_generation_cannot_start_bridge_after_reset() {
        // A task that read the generation before (or during) a reset must not
        // start the Cursor bridge once that reset has finished.
        let stale = crate::reset::current_generation();
        drop(crate::reset::begin_reset().unwrap());
        let error = start_bridge(Some(0), Some(stale)).await.unwrap_err();
        assert!(error.contains("已取消过期的配置任务"), "{error}");
    }

    #[tokio::test]
    async fn aborting_tracked_agent_streams_also_stops_the_inner_agent_task() {
        use std::sync::atomic::{AtomicBool, Ordering};

        struct SetOnDrop(Arc<AtomicBool>);
        impl Drop for SetOnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }

        let set: AgentTaskSet = std::sync::Mutex::new(tokio::task::JoinSet::new());
        let inner_dropped = Arc::new(AtomicBool::new(false));
        let (started_tx, started_rx) = oneshot::channel();
        let flag = inner_dropped.clone();
        // Mirrors run_cursor_agent_stream: an outer stream task owning an
        // inner agent task through AbortOnDrop.
        spawn_tracked(&set, async move {
            let inner = tokio::spawn(async move {
                let _guard = SetOnDrop(flag);
                let _ = started_tx.send(());
                std::future::pending::<()>().await;
            });
            let _abort_inner = AbortOnDrop(inner.abort_handle());
            let _ = inner.await;
        });
        started_rx.await.unwrap();

        assert_eq!(abort_tracked(&set), 1);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !inner_dropped.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("inner agent task must be aborted with its stream");
        // Aborted tasks are reaped, leaving nothing to cancel on the next stop.
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(abort_tracked(&set), 0);
    }

    // ===== 多轮上下文回归测试 =====

    use crate::cursor::protocol::{proto, BidiMessageKind, DecodedBidiMessage};
    use prost::Message as _;

    const FIRST_TURN: &str = "请记住数字 4817 和代号青柠，只回复已记住，不要读取或修改文件。";
    const SECOND_TURN: &str = "刚才请你记住的数字和代号分别是什么？";

    fn bidi_append_body(request_id: &str, seqno: i64, client_bytes: &[u8]) -> Vec<u8> {
        let request = proto::BidiAppendRequest {
            data: hex::encode(client_bytes),
            request_id: (!request_id.is_empty()).then(|| proto::BidiRequestId {
                request_id: request_id.into(),
            }),
            append_seqno: seqno,
            data_binary: Vec::new(),
        };
        encode_connect_frame_raw(0, &request.encode_to_vec())
    }

    fn run_request(
        conversation_id: Option<&str>,
        message_id: &str,
        text: &str,
        history: &[(&str, &str)],
    ) -> proto::AgentRunRequest {
        let conversation_history = (!history.is_empty()).then(|| proto::ConversationHistory {
            messages: history
                .iter()
                .map(|(role, text)| {
                    let content = Some(proto::ConversationHistoryTextContent {
                        text: (*text).into(),
                    });
                    if *role == "user" {
                        proto::ConversationHistoryMessage {
                            user: Some(proto::ConversationHistoryUserMessage {
                                content: vec![proto::ConversationHistoryUserContent {
                                    text: content,
                                    image: None,
                                }],
                            }),
                            assistant: None,
                        }
                    } else {
                        proto::ConversationHistoryMessage {
                            user: None,
                            assistant: Some(proto::ConversationHistoryAssistantMessage {
                                content: vec![proto::ConversationHistoryAssistantContent {
                                    text: content,
                                    reasoning: None,
                                }],
                            }),
                        }
                    }
                })
                .collect(),
        });
        proto::AgentRunRequest {
            action: Some(proto::ConversationAction {
                user_message_action: Some(proto::UserMessageAction {
                    user_message: Some(proto::UserMessage {
                        text: text.into(),
                        message_id: message_id.into(),
                        selected_context: None,
                    }),
                    request_context: None,
                    conversation_history,
                }),
            }),
            conversation_id: conversation_id.map(str::to_string),
            requested_model: Some(proto::RequestedModel {
                model_id: "test-model".into(),
            }),
            ..Default::default()
        }
    }

    fn client_turn(run: proto::AgentRunRequest) -> Vec<u8> {
        proto::AgentClientMessage {
            run_request: Some(run),
            conversation_action: None,
        }
        .encode_to_vec()
    }

    /// 走真实解码路径：BidiAppend 字节 → 解码 → 合并进以 request_id 为键的会话。
    fn session_from_append(request_id: &str, client_bytes: &[u8]) -> BidiSession {
        let decoded = decode_bidi_append(&bidi_append_body(request_id, 0, client_bytes))
            .expect("BidiAppend 必须可解码");
        assert_eq!(
            decoded.request_id, request_id,
            "会话必须以 BidiRequestId 关联"
        );
        let mut session = empty_session(request_id, "default");
        merge_turn_into_session(&mut session, decoded);
        session
    }

    fn roles_and_texts(messages: &[Value]) -> Vec<(String, String)> {
        messages
            .iter()
            .map(|m| {
                (
                    m["role"].as_str().unwrap().to_string(),
                    m["content"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    }

    fn expected_conversation() -> Vec<(String, String)> {
        vec![
            ("user".into(), FIRST_TURN.into()),
            ("assistant".into(), "已记住".into()),
            ("user".into(), SECOND_TURN.into()),
        ]
    }

    #[test]
    fn second_turn_without_inline_history_recovers_context_from_store() {
        let mut store = ConversationStore::default();
        let now = std::time::Instant::now();

        // 第一轮：新会话，没有历史。
        let mut first = session_from_append(
            "req-1",
            &client_turn(run_request(Some("conv-1"), "m1", FIRST_TURN, &[])),
        );
        assert_eq!(first.conversation_id.as_deref(), Some("conv-1"));
        assert_eq!(first.message_id.as_deref(), Some("m1"));
        let source = resolve_history(&mut first, &mut store);
        assert_eq!(source, HistorySource::Empty);
        store.remember_turn(
            "conv-1",
            source,
            &first.history,
            &first.user_prompt,
            first.message_id.as_deref(),
            "已记住",
            now,
        );

        // 第二轮：新的 request_id，只带当前问题与 conversation_id（复现场景）。
        let mut second = session_from_append(
            "req-2",
            &client_turn(run_request(Some("conv-1"), "m2", SECOND_TURN, &[])),
        );
        assert!(second.history.is_empty());
        assert_eq!(
            resolve_history(&mut second, &mut store),
            HistorySource::Store
        );
        let messages = agent_messages(&second).unwrap();
        assert_eq!(roles_and_texts(&messages), expected_conversation());
    }

    #[test]
    fn inline_history_is_parsed_and_takes_precedence_over_store() {
        let mut store = ConversationStore::default();
        store.remember_turn(
            "conv-2",
            HistorySource::Empty,
            &[],
            "stale question",
            Some("m0"),
            "stale answer",
            std::time::Instant::now(),
        );
        let mut session = session_from_append(
            "req-inline",
            &client_turn(run_request(
                Some("conv-2"),
                "m2",
                SECOND_TURN,
                &[("user", FIRST_TURN), ("assistant", "已记住")],
            )),
        );
        assert_eq!(
            resolve_history(&mut session, &mut store),
            HistorySource::Inline
        );
        let messages = agent_messages(&session).unwrap();
        assert_eq!(roles_and_texts(&messages), expected_conversation());
    }

    #[test]
    fn regenerating_a_cached_message_drops_the_superseded_turn() {
        let mut store = ConversationStore::default();
        let now = std::time::Instant::now();
        store.remember_turn(
            "conv-3",
            HistorySource::Empty,
            &[],
            "q1",
            Some("m1"),
            "a1",
            now,
        );
        store.remember_turn(
            "conv-3",
            HistorySource::Store,
            &[],
            "q2",
            Some("m2"),
            "a2",
            now,
        );

        // 重新生成 m2：历史只保留 m2 之前的轮次。
        let history = store.history_before("conv-3", Some("m2"), now);
        assert_eq!(
            history,
            vec![
                ("user".into(), "q1".into()),
                ("assistant".into(), "a1".into())
            ]
        );
        store.remember_turn(
            "conv-3",
            HistorySource::Store,
            &history,
            "q2",
            Some("m2"),
            "a2-new",
            now,
        );
        let after = store.history_before("conv-3", Some("m3"), now);
        assert_eq!(after.len(), 4);
        assert_eq!(after[3], ("assistant".into(), "a2-new".into()));
    }

    #[test]
    fn missing_conversation_id_stays_single_turn() {
        let mut store = ConversationStore::default();
        let mut session = session_from_append(
            "req-no-conv",
            &client_turn(run_request(None, "m1", SECOND_TURN, &[])),
        );
        assert_eq!(
            resolve_history(&mut session, &mut store),
            HistorySource::Empty
        );
        assert_eq!(agent_messages(&session).unwrap().len(), 1);
    }

    #[test]
    fn conversation_store_enforces_budgets_and_starts_history_with_user() {
        let mut store = ConversationStore::default();
        let start = std::time::Instant::now();
        for turn in 0..MAX_HISTORY_ITEMS {
            store.remember_turn(
                "conv-long",
                HistorySource::Store,
                &[],
                &format!("q{turn}"),
                Some(&format!("m{turn}")),
                &format!("a{turn}"),
                start,
            );
        }
        let history = store.history_before("conv-long", None, start);
        assert!(history.len() <= MAX_HISTORY_ITEMS);
        assert_eq!(history[0].0, "user");
        assert_eq!(
            history.last().unwrap().1,
            format!("a{}", MAX_HISTORY_ITEMS - 1)
        );

        // 单轮超出单会话预算时丢弃缓存，避免补全出不一致的历史。
        let huge = "x".repeat(MAX_CONVERSATION_BYTES + 1);
        store.remember_turn(
            "conv-long",
            HistorySource::Store,
            &[],
            &huge,
            None,
            "",
            start,
        );
        assert!(store.history_before("conv-long", None, start).is_empty());

        // 会话数超限时按最近使用时间淘汰。
        for index in 0..=MAX_CONVERSATIONS {
            store.remember_turn(
                &format!("conv-{index}"),
                HistorySource::Empty,
                &[],
                "q",
                None,
                "a",
                start + Duration::from_millis(index as u64),
            );
        }
        assert_eq!(store.conversations.len(), MAX_CONVERSATIONS);
        assert!(!store.conversations.contains_key("conv-0"));
        assert!(store
            .conversations
            .contains_key(&format!("conv-{MAX_CONVERSATIONS}")));
    }

    #[test]
    fn stale_history_expires_after_ttl() {
        let mut store = ConversationStore::default();
        let start = std::time::Instant::now();
        store.remember_turn("conv-ttl", HistorySource::Empty, &[], "q", None, "a", start);
        assert!(store
            .history_before("conv-ttl", None, start + CONVERSATION_TTL)
            .is_empty());
    }

    fn turn_message(seqno: i64) -> DecodedBidiMessage {
        DecodedBidiMessage {
            request_id: "req-order".into(),
            seqno,
            kind: BidiMessageKind::RunRequest,
            ..Default::default()
        }
    }

    #[test]
    fn out_of_order_append_fills_missing_turn_without_overwriting_newer_data() {
        let mut session = empty_session("req-order", "default");
        let mut newer = turn_message(3);
        newer.model = Some("model-new".into());
        merge_turn_into_session(&mut session, newer);

        // 较旧序号的内容包晚到：仍应补齐 prompt 与历史，而不是被整体丢弃。
        let mut older = turn_message(2);
        older.user_text = SECOND_TURN.into();
        older.history = vec![("user".into(), FIRST_TURN.into())];
        older.conversation_id = Some("conv-order".into());
        merge_turn_into_session(&mut session, older);
        assert_eq!(session.user_prompt, SECOND_TURN);
        assert_eq!(session.history.len(), 1);
        assert_eq!(session.conversation_id.as_deref(), Some("conv-order"));
        assert_eq!(session.model, "model-new");
        assert_eq!(session.last_seqno, 3);

        // 已填充的字段不被更旧的包覆盖。
        let mut stale = turn_message(1);
        stale.user_text = "stale".into();
        merge_turn_into_session(&mut session, stale);
        assert_eq!(session.user_prompt, SECOND_TURN);

        // 更新的包照常覆盖。
        let mut latest = turn_message(4);
        latest.user_text = "latest".into();
        merge_turn_into_session(&mut session, latest);
        assert_eq!(session.user_prompt, "latest");
    }

    #[test]
    fn control_packets_are_classified_with_content_free_shape() {
        // AgentClientMessage 只含未建模的 tag 7（例如心跳）。
        let decoded =
            decode_bidi_append(&bidi_append_body("req-control", 5, &[0x3a, 0x00])).unwrap();
        assert_eq!(decoded.kind, BidiMessageKind::Control);
        assert!(decoded.user_text.is_empty());
        assert_eq!(decoded.wire_shape, "client[7:L0]");

        // run_request 带有未建模的 tag 1（例如会话状态）时，摘要能暴露该字段但不含正文。
        let run = run_request(Some("c"), "m", "hi", &[]).encode_to_vec();
        let mut run_bytes = vec![0x0a, 0x02, 0xaa, 0xbb];
        run_bytes.extend_from_slice(&run);
        assert!(run_bytes.len() < 128);
        let mut client = vec![0x0a, run_bytes.len() as u8];
        client.extend_from_slice(&run_bytes);
        let decoded = decode_bidi_append(&bidi_append_body("req-shape", 0, &client)).unwrap();
        assert_eq!(decoded.kind, BidiMessageKind::RunRequest);
        assert_eq!(decoded.user_text, "hi");
        assert!(
            decoded.wire_shape.contains("run[1:L2,"),
            "{}",
            decoded.wire_shape
        );
        assert!(!decoded.wire_shape.contains("hi"));
    }

    #[test]
    fn log_helpers_do_not_expose_identifiers() {
        let hashed = short_hash(Some("conversation-secret"));
        assert_eq!(hashed.len(), 8);
        assert!(!hashed.contains("secret"));
        assert_eq!(short_hash(None), "-");
        assert_eq!(
            shape_key("client[7:L12] run[1:L3,5:V]"),
            "client[7:L] run[1:L,5:V]"
        );
    }

    fn append_request(body: Vec<u8>) -> Request {
        Request::builder()
            .method("POST")
            .header(header::CONTENT_TYPE, "application/proto")
            .body(Body::from(body))
            .unwrap()
    }

    #[tokio::test]
    async fn bidi_append_rejects_undecodable_and_unkeyed_turns_and_ignores_control() {
        let response = handle_bidi_append(append_request(vec![0xff, 0xff, 0xff])).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        // 没有 BidiRequestId 的轮次无法与 RunSSE 关联，必须报错而不是写入空键。
        let unkeyed = bidi_append_body(
            "",
            0,
            &client_turn(run_request(Some("conv-x"), "m", SECOND_TURN, &[])),
        );
        let response = handle_bidi_append(append_request(unkeyed)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(!SESSION_MAP.lock().await.contains_key(""));

        // 控制包返回成功，但不创建会话。
        let control = bidi_append_body("req-control-handler", 9, &[0x3a, 0x00]);
        let response = handle_bidi_append(append_request(control)).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!SESSION_MAP.lock().await.contains_key("req-control-handler"));
    }
}

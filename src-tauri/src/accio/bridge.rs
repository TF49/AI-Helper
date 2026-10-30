use crate::accio::config::{
    load_accio_config, model_source_fingerprint, save_accio_config, AccioConfig,
};
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
use std::collections::HashSet;
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
static INSTANCE_TOKEN: Mutex<Option<String>> = Mutex::new(None);

pub fn current_instance_token() -> Option<String> {
    INSTANCE_TOKEN.lock().ok()?.clone()
}

/// 获取（必要时生成）实例凭据。凭据在 AI Helper 进程生命周期内保持不变，
/// 使 Bridge 因改端口或重启而重新监听时，已注入旧凭据的 Accio 进程无需重启即可继续访问。
fn ensure_instance_token() -> String {
    let mut guard = INSTANCE_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(crate::instance_auth::generate_instance_token)
        .clone()
}

/// 注入给 Accio 的网关根地址：`http://127.0.0.1:<port>/i/<token>`。
/// Accio 以字符串拼接方式在其后追加 `/api/...`，凭据随路径到达 Bridge 并在路由前被校验、剥离。
/// 仅 Windows/macOS 会拉起 Accio，其他平台只在测试中使用。
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub fn accio_gateway_base_url(port: u16) -> Option<String> {
    let token = current_instance_token()?;
    Some(format!(
        "http://127.0.0.1:{port}{}{token}",
        crate::instance_auth::INSTANCE_PATH_PREFIX
    ))
}

const MODEL_LIST_TTL: Duration = Duration::from_secs(300);

static IS_REFRESHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

struct ModelListCache {
    fingerprint: String,
    models: Vec<String>,
    fetched_at: Instant,
}

static MODEL_LIST_CACHE: Mutex<Option<ModelListCache>> = Mutex::new(None);

/// 配置或 Key 变更后丢弃内存中的模型列表，迫使下次按新凭据实时拉取。
pub fn invalidate_model_list_cache() {
    *MODEL_LIST_CACHE.lock().unwrap() = None;
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
    let config = load_accio_config();
    let count = fetch_and_cache_model_ids(&config).await.len();
    log::info!("Accio 已按当前 Key 刷新模型列表，共 {count} 个真实可用模型");
}

fn provider_source_label(base_url: Option<&str>) -> String {
    if let Some(url) = base_url {
        let trimmed = url.trim();
        if let Ok(parsed) = reqwest::Url::parse(trimmed) {
            if let Some(host) = parsed.host_str() {
                if !host.is_empty() {
                    return host.to_string();
                }
            }
        }
    }
    "bob-api.com".to_string()
}

fn model_entry(id: &str, is_default: bool, source_label: &str) -> Value {
    json!({
        "modelCode": id,
        "modelName": id,
        "modelDisplayName": id,
        "modelDesc": format!("{id} via {source_label}"),
        "visible": true,
        "isDefault": is_default,
        "freeUse": true,
        "multimodal": true,
        "contextWindow": get_model_context_window(id),
        "reasoningEfforts": ["low", "medium", "high"],
        "defaultReasoningEffort": "medium"
    })
}

/// 仅用当前 Key 真实可用的模型组装 Accio `/api/llm/config/v2` 载荷，不注入写死预设。
pub fn build_provider_payload_with_source(
    selected_model: &str,
    model_ids: &[String],
    base_url: Option<&str>,
) -> Value {
    let source_label = provider_source_label(base_url);
    let selected = selected_model.trim();
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();

    if !selected.is_empty() && model_ids.iter().any(|id| id.trim() == selected) {
        ordered.push(selected.to_string());
        seen.insert(selected.to_string());
    }

    for id in model_ids {
        let trimmed = id.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        ordered.push(trimmed.to_string());
    }

    let model_list: Vec<Value> = ordered
        .iter()
        .map(|id| model_entry(id, id == selected, &source_label))
        .collect();

    json!([{
        "provider": "ai-helper",
        "providerDisplayName": format!("AI-Helper ({source_label})"),
        "modelList": model_list
    }])
}

#[cfg(test)]
fn build_provider_payload(selected_model: &str, model_ids: &[String]) -> Value {
    build_provider_payload_with_source(selected_model, model_ids, None)
}

fn remember_model_list(fingerprint: String, models: Vec<String>) {
    *MODEL_LIST_CACHE.lock().unwrap() = Some(ModelListCache {
        fingerprint,
        models,
        fetched_at: Instant::now(),
    });
}

fn cached_model_list(fingerprint: &str, allow_stale: bool) -> Option<Vec<String>> {
    let guard = MODEL_LIST_CACHE.lock().unwrap();
    let cache = guard.as_ref()?;
    if cache.fingerprint != fingerprint {
        return None;
    }
    if !allow_stale && cache.fetched_at.elapsed() >= MODEL_LIST_TTL {
        return None;
    }
    Some(cache.models.clone())
}

async fn fetch_and_cache_model_ids(config: &AccioConfig) -> Vec<String> {
    let fingerprint = model_source_fingerprint(&config.base_url, &config.api_key);
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

            // 安全写盘：重新从磁盘加载当前最新的配置，防止覆盖网络请求期间用户的新修改
            let mut latest = load_accio_config();
            let latest_fp = model_source_fingerprint(&latest.base_url, &latest.api_key);
            if latest_fp == fingerprint {
                if latest.cached_models != ids || latest.cached_models_fingerprint != fingerprint {
                    latest.cached_models = ids.clone();
                    latest.cached_models_fingerprint = fingerprint;
                    if let Err(e) = save_accio_config(&latest) {
                        log::warn!("回写 Accio 模型缓存失败: {e}");
                    }
                }
            } else {
                log::debug!("用户在拉取模型期间切换了凭据，丢弃向磁盘写回旧 Key 缓存");
            }
            ids
        }
        Err(e) => {
            log::warn!("按当前 Key 拉取 Accio 可用模型失败，尝试回退缓存: {e}");
            Vec::new()
        }
    }
}

/// 按当前配置的 Base URL + API Key 拉取真实可用模型；支持 SWR (Stale-While-Revalidate)
async fn load_key_model_ids(config: &AccioConfig) -> Vec<String> {
    let fingerprint = model_source_fingerprint(&config.base_url, &config.api_key);

    // 1. 命中有效内存缓存
    if let Some(fresh) = cached_model_list(&fingerprint, false) {
        return fresh;
    }

    // 2. 检查是否有陈旧内存缓存或匹配的磁盘缓存
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
        // 先用已有模型预热内存并立即返回，后台触发异步刷新避免阻塞
        remember_model_list(fingerprint.clone(), cached.clone());
        tokio::spawn(async {
            refresh_model_list_cache().await;
        });
        return cached;
    }

    // 3. 无任何缓存（首次拉取），同步拉取一次
    let fetched = fetch_and_cache_model_ids(config).await;
    if !fetched.is_empty() {
        return fetched;
    }

    // 4. 拉取失败时最后尝试内存陈旧缓存
    if let Some(stale) = cached_model_list(&fingerprint, true) {
        return stale;
    }

    Vec::new()
}

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
pub use crate::accio::config::clean_base_url;

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

/// 严格判断请求 Origin 是否属于受信任的本地/内嵌环境，防止公网网页跨站 (CSRF) 盗刷用户额度与资金
pub fn is_trusted_bridge_origin(origin: &str) -> bool {
    let lower = origin.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return true;
    }

    if lower.starts_with("tauri://")
        || lower.starts_with("vscode-webview://")
        || lower.starts_with("file://")
        || lower.starts_with("app://")
    {
        return true;
    }

    if let Ok(url) = reqwest::Url::parse(&lower) {
        if let Some(host) = url.host_str() {
            if host == "127.0.0.1" || host == "localhost" || host == "tauri.localhost" {
                return true;
            }
        }
    }

    false
}

/// 严格判断请求 Host 是否属于受信任的本地主机地址，彻底封堵公网利用 DNS Rebinding (重绑定) 盗刷本地网关与额度
pub fn is_trusted_bridge_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    // 剔除端口部分 (支持 127.0.0.1:8787、localhost:8787、[::1]:8787 等格式)
    let hostname = if lower.starts_with('[') {
        if let Some(end_bracket) = lower.find(']') {
            &lower[1..end_bracket]
        } else {
            lower.as_str()
        }
    } else if let Some(colon_pos) = lower.rfind(':') {
        &lower[..colon_pos]
    } else {
        lower.as_str()
    };

    hostname == "127.0.0.1"
        || hostname == "localhost"
        || hostname == "tauri.localhost"
        || hostname == "::1"
}

/// 滑动窗口流控器，防止恶意死循环或外部脚本高频盗刷用户余额与 API 额度
pub struct SlidingWindowRateLimiter {
    window_duration: Duration,
    max_requests: usize,
    timestamps: Vec<Instant>,
}

impl SlidingWindowRateLimiter {
    pub fn new(window_duration: Duration, max_requests: usize) -> Self {
        Self {
            window_duration,
            max_requests,
            timestamps: Vec::new(),
        }
    }

    pub fn check_and_record(&mut self) -> bool {
        let now = Instant::now();
        self.timestamps.retain(|&t| {
            now.checked_duration_since(t)
                .map(|d| d < self.window_duration)
                .unwrap_or(false)
        });
        if self.timestamps.len() >= self.max_requests {
            false
        } else {
            self.timestamps.push(now);
            true
        }
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn reset(&mut self) {
        self.timestamps.clear();
    }
}

static BRIDGE_LLM_RATE_LIMITER: Mutex<Option<SlidingWindowRateLimiter>> = Mutex::new(None);
static BRIDGE_IMAGE_RATE_LIMITER: Mutex<Option<SlidingWindowRateLimiter>> = Mutex::new(None);

pub fn check_llm_rate_limit() -> bool {
    let mut guard = BRIDGE_LLM_RATE_LIMITER.lock().unwrap();
    let limiter = guard.get_or_insert_with(|| {
        // 允许 60 秒内最多 120 次请求（平均 2次/秒，足够 Agent 链式推理，但彻底锁死恶意脚本死循环）
        SlidingWindowRateLimiter::new(Duration::from_secs(60), 120)
    });
    limiter.check_and_record()
}

pub fn check_image_rate_limit() -> bool {
    let mut guard = BRIDGE_IMAGE_RATE_LIMITER.lock().unwrap();
    let limiter = guard.get_or_insert_with(|| {
        // 生图成本极其高昂（DALL-E 3 约 0.3~0.6 元/张），限制 60 秒内最多 6 次请求
        SlidingWindowRateLimiter::new(Duration::from_secs(60), 6)
    });
    limiter.check_and_record()
}

pub fn is_monetized_bridge_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.starts_with("/api/adk/llm")
        || lower.starts_with("/api/adk/embedding")
        || lower.starts_with("/api/tool/rlab/call")
        || lower.starts_with("/api/mcp/proxy")
}

fn validate_upstream_destination(config: &AccioConfig) -> Result<(), String> {
    crate::credential_policy::validate_key_destination(
        &config.api_key,
        &config.base_url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn instance_auth_error(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error_code": 401,
            "error_message": message
        })),
    )
        .into_response()
}

/// 将请求 URI 的路径替换为 `new_path`，保留查询串与 scheme/authority
fn rewrite_request_path(request: &mut Request, new_path: &str) -> Result<(), String> {
    let uri = request.uri().clone();
    let path_and_query = match uri.query() {
        Some(query) => format!("{new_path}?{query}"),
        None => new_path.to_string(),
    };
    let mut parts = uri.into_parts();
    parts.path_and_query = Some(
        path_and_query
            .parse()
            .map_err(|e| format!("无效的请求路径: {e}"))?,
    );
    *request.uri_mut() =
        axum::http::Uri::from_parts(parts).map_err(|e| format!("无效的请求 URI: {e}"))?;
    Ok(())
}

/// 实例鉴权、Anti-CSRF、Anti-DNS-Rebinding 及流控防盗刷中间件：
/// 0. 校验 `/i/<token>` 路径凭据（或请求头凭据），通过后剥离前缀；
/// 1. 严格拦截非受信 Host 请求，抵御 DNS Rebinding 攻击；
/// 2. 拦截所有带有非受信 Origin 或跨站探测 (Sec-Fetch-Site: cross-site) 的请求；
/// 3. 对消耗 token/额度的收费端点进行高频死循环拦截与限流保护。
///
/// 必须包裹在路由之外运行（见 `build_bridge_app`），否则剥离前缀后的路径不会参与路由匹配。
async fn bridge_anti_csrf_middleware(
    mut request: Request,
    next: axum::middleware::Next,
) -> Response {
    let token = current_instance_token().unwrap_or_default();
    let raw_path = request.uri().path().to_string();

    // 0. 实例鉴权：优先识别 Accio 使用的 `/i/<token>` 路径凭据，其次兼容请求头凭据
    let path = if let Some((candidate, tail)) = crate::instance_auth::split_instance_path(&raw_path)
    {
        if !crate::instance_auth::token_eq(candidate, &token) {
            log::warn!(
                "【实例鉴权】路径凭据与当前实例不匹配，已拒绝: {} (Accio 可能沿用了旧实例凭据，请通过 AI Helper 重启 Accio)",
                tail
            );
            return instance_auth_error(
                "【安全拦截】本地实例凭据无效或已过期，请通过 AI Helper 重新启动 Accio Work",
            );
        }
        let tail = tail.to_string();
        if let Err(error) = rewrite_request_path(&mut request, &tail) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error_code": 400, "error_message": error})),
            )
                .into_response();
        }
        tail
    } else {
        if crate::instance_auth::requires_instance_auth(&raw_path)
            && !crate::instance_auth::header_matches_instance(request.headers(), &token)
        {
            log::warn!("【实例鉴权】拒绝未持有当前实例凭据的敏感调用: {}", raw_path);
            return instance_auth_error(
                "【安全拦截】缺少有效的本地实例凭据，已拒绝访问计费或敏感路由",
            );
        }
        raw_path
    };

    // 1. 严格检查 Host 头部 (防范 DNS Rebinding 跨站盗刷)
    if let Some(host_val) = request.headers().get(header::HOST) {
        if let Ok(host_str) = host_val.to_str() {
            if !is_trusted_bridge_host(host_str) {
                log::warn!(
                    "【安全拦截】拦截来自非受信 Host 的调用 (疑遭遇 DNS Rebinding 盗刷攻击, Host: {})",
                    host_str
                );
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error_code": 403,
                        "error_message": "【安全拦截】非受信 Host 请求，已拦截疑似 DNS Rebinding 跨站盗刷"
                    })),
                )
                    .into_response();
            }
        }
    }

    // 2. 检查 Origin 头
    if let Some(origin_val) = request.headers().get(header::ORIGIN) {
        if let Ok(origin_str) = origin_val.to_str() {
            if !is_trusted_bridge_origin(origin_str) {
                log::warn!(
                    "【CSRF 安全拦截】拒绝来自非受信任外部 Web 站点的盗刷调用 (Origin: {})",
                    origin_str
                );
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error_code": 403,
                        "error_message": "【安全拦截】禁止从非受信任的公网网页调用本地 AI Helper Bridge 网关，防止账户额度遭 CSRF 盗刷"
                    })),
                )
                    .into_response();
            }
        }
    }

    // 2. 检查 Sec-Fetch-Site 头
    if let Some(sec_fetch) = request.headers().get("sec-fetch-site") {
        if sec_fetch == "cross-site" {
            let is_trusted = request
                .headers()
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok())
                .map(is_trusted_bridge_origin)
                .unwrap_or(false);

            if !is_trusted {
                log::warn!("【CSRF 安全拦截】拦截浏览器 cross-site 探测或恶意调用");
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error_code": 403,
                        "error_message": "【安全拦截】禁止跨站 (cross-site) 访问本地 AI Helper Bridge"
                    })),
                )
                    .into_response();
            }
        }
    }

    // 3. 对扣费/高频消费端点执行速率限制保护 (防死循环掏空用户额度)
    if is_monetized_bridge_path(&path) && !check_llm_rate_limit() {
        log::warn!(
            "【流控安全拦截】本地 Bridge 针对收费端点 {} 的请求超出限流阈值 (120次/分钟)，已拦截以防止账户额度耗尽",
            path
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error_code": 429,
                "error_message": "【安全拦截】请求频率过高已触发本地 AI Helper Bridge 流控保护 (120次/分钟)，自动拦截以防止账户额度遭死循环消耗殆尽。请稍候重试。"
            })),
        )
            .into_response();
    }

    if !token.is_empty() {
        crate::instance_auth::strip_instance_headers(request.headers_mut(), &token);
    }
    next.run(request).await
}

/// 组装 Bridge 服务：业务路由作为内层 fallback service，安全中间件包在路由之外，
/// 保证 `/i/<token>` 前缀在路由匹配前完成校验与剥离；CORS 位于最外层以正确响应预检请求。
fn build_bridge_app(routes: Router) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(
            |origin: &axum::http::HeaderValue, _| {
                if let Ok(s) = origin.to_str() {
                    is_trusted_bridge_origin(s)
                } else {
                    false
                }
            },
        ))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    Router::new()
        .fallback_service(routes)
        .layer(axum::middleware::from_fn(bridge_anti_csrf_middleware))
        .layer(cors)
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
                    tokio::spawn(async {
                        refresh_model_list_cache().await;
                    });
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
    ensure_instance_token();
    let image_cap = std::env::var("AI_HELPER_IMAGE_BUDGET_UNITS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if let Err(error) = crate::paid_request::reset_image_budget(image_cap) {
        crate::paid_request::disable_image_budget();
        log::error!("生图预算不可用，已关闭生图通道；文本与嵌入服务继续启动: {error}");
    }

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
        .redirect(crate::credential_policy::credentialed_redirect_policy())
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let routes = Router::new()
        .route("/health", get(handle_health))
        .route("/api/llm/config/v2", any(custom_model_list))
        .route("/api/tool/rlab/call", post(handle_tool_rlab_call))
        .route("/api/adk/embedding/embed", post(handle_embedding))
        .route("/api/adk/llm", post(handle_llm))
        .route("/api/adk/llm/*path", post(handle_llm))
        .route("/api/mcp/proxy", any(handle_mcp_proxy))
        .route("/api/mcp/proxy/*path", any(handle_mcp_proxy))
        .fallback(any(proxy_official))
        .with_state(client);
    let app = build_bridge_app(routes);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async {
        refresh_model_list_cache().await;
    });

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
    // 实例凭据保留至 AI Helper 退出：Bridge 停止后不再监听，凭据本身不构成可用入口
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

/// GET /api/llm/config/v2: 按当前 Key 动态注入该凭据真实可用的模型列表
async fn custom_model_list() -> Json<Value> {
    let config = load_accio_config();
    let mut ids = load_key_model_ids(&config).await;
    // 容灾保底：当上游无法拉取可用模型（如未实现 /v1/models 或网络离线），保底注入当前配置模型，防止客户端下拉框彻底空白
    if ids.is_empty() && !config.model.trim().is_empty() {
        ids.push(config.model.trim().to_string());
    }
    Json(build_provider_payload_with_source(
        &config.model,
        &ids,
        Some(&config.base_url),
    ))
}

/// 根据模型名称返回对应的上下文窗口大小
fn get_model_context_window(model: &str) -> u64 {
    let lower = model.to_lowercase();

    // Claude 系列
    if lower.contains("claude-3-7") || lower.contains("claude-3.7") {
        return 200000;
    }
    if lower.contains("claude-3-5") || lower.contains("claude-3.5") {
        return 200000;
    }
    if lower.contains("claude-3") {
        return 200000;
    }
    if lower.contains("claude-2") {
        return 100000;
    }

    // GPT 系列 - 更具体的型号优先（新型号在前）
    // GPT-6 系列: gpt-6-sol, gpt-6.1-sol, gpt-6-luna 等，官方上下文窗口: 1,050,000 tokens
    if lower.contains("gpt-6") {
        return 1050000;
    }
    // GPT-5 系列: 官方上下文窗口: 400,000 tokens
    if lower.contains("gpt-5") {
        return 400000;
    }
    if lower.contains("gpt-4.1-mini") {
        return 128000;
    }
    if lower.contains("gpt-4.1") {
        // GPT-4.1 官方上下文窗口: 1,047,576 tokens
        return 1047576;
    }
    if lower.contains("gpt-4.5") || lower.contains("gpt-4-turbo") || lower.contains("gpt-4o") {
        return 128000;
    }
    if lower.contains("gpt-4") {
        return 8192;
    }
    if lower.contains("gpt-3.5") || lower.contains("gpt-35") {
        return 16385;
    }

    // o 系列
    if lower.starts_with("o1") || lower.starts_with("o3") || lower.starts_with("o4") {
        return 200000;
    }

    // DeepSeek 系列
    if lower.contains("deepseek-chat") {
        return 64000;
    }
    if lower.contains("deepseek-reasoner") || lower.contains("deepseek-r1") {
        return 64000;
    }
    if lower.contains("deepseek-coder") {
        return 16000;
    }

    // Qwen 系列 - 更具体的型号优先
    if lower.contains("qwen-2.5-max") || lower.contains("qwen2.5-max") {
        return 128000;
    }
    if lower.contains("qwen-max") || lower.contains("qwen-plus") {
        return 32000;
    }
    if lower.contains("qwen-2.5") || lower.contains("qwen2.5") {
        return 128000;
    }

    // Gemini 系列
    if lower.contains("gemini-2") || lower.contains("gemini-1.5") {
        return 1000000;
    }
    if lower.contains("gemini-1.0") || lower.contains("gemini-pro") {
        return 32000;
    }

    // 默认值
    128000
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

    let config = load_accio_config();
    if config.prevent_official_leak {
        log::info!("【防泄漏生效】已开启 prevent_official_leak，对 /api/tool/rlab/call 返回本地合规响应，避免泄漏至官方网关");
        return (
            StatusCode::OK,
            Json(json!({"code": 200, "data": {}, "message": "success (prevent_official_leak active)"})),
        )
            .into_response();
    }

    log::debug!("转发 /api/tool/rlab/call 请求至官方网关");
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
    if let Err(error) = validate_upstream_destination(&config) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error": {"message": error}})),
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
                call_custom_image(&client_clone, &config_clone, input)
                    .await
                    .map_err(|e| (None, e))
            } else {
                call_upstream_llm(&client_clone, &config_clone, input).await
            }
        };
        tokio::pin!(upstream_fut);

        let mut final_frame: Option<Value> = None;
        let mut final_error: Option<(Option<u16>, String)> = None;

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
        } else if let Some((status_code_opt, err_msg)) = final_error {
            let error_code = status_code_opt
                .map(|c| c.to_string())
                .unwrap_or_else(|| "502".to_string());

            log::error!(
                "Accio 自定义 LLM 调用失败 (HTTP {}): {}",
                error_code,
                err_msg
            );

            let paid_state = crate::paid_request::PaidAttemptState::DispatchedUnknown;
            if config_clone.fallback_official
                && crate::paid_request::may_fallback_to_other_provider(paid_state, status_code_opt)
            {
                if config_clone.prevent_official_leak {
                    log::warn!("【防泄漏拦截】已开启 prevent_official_leak，阻止 LLM 失败后回退至阿里官方网关");
                    let full_err_msg = format!(
                        "上游自定义模型报错: {}; (已开启防官方泄露，禁止回退官方网关)",
                        err_msg
                    );
                    let err_frame = json!({
                        "errorCode": error_code,
                        "errorMessage": &full_err_msg,
                        "content": {
                            "role": "model",
                            "parts": [{ "text": format!("⚠️ 请求失败: {}", full_err_msg) }]
                        },
                        "finishReason": "ERROR",
                        "turnComplete": true,
                        "partial": false
                    });
                    let _ = tx.send(Ok(Bytes::from(format_accio_sse(&err_frame)))).await;
                } else {
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
                        let full_err_msg = format!(
                            "上游自定义模型报错: {}; 官方网关回退失败: {}",
                            err_msg, proxy_err
                        );
                        let err_frame = json!({
                            "errorCode": error_code,
                            "errorMessage": &full_err_msg,
                            "content": {
                                "role": "model",
                                "parts": [{ "text": format!("⚠️ 请求失败: {}", full_err_msg) }]
                            },
                            "finishReason": "ERROR",
                            "turnComplete": true,
                            "partial": false
                        });
                        let _ = tx.send(Ok(Bytes::from(format_accio_sse(&err_frame)))).await;
                    }
                }
            } else {
                let err_frame = json!({
                    "errorCode": error_code,
                    "errorMessage": &err_msg,
                    "content": {
                        "role": "model",
                        "parts": [{ "text": format!("⚠️ 调用上游模型失败: {}", err_msg) }]
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

/// 将 accio_to_openai 输出的 Chat Completions 格式体转换为 /v1/responses 请求格式。
/// Responses API 的工具定义和工具调用历史与 Chat Completions 不同，必须在这里完成协议转换。
fn chat_to_responses_body(chat_body: &Value) -> Value {
    let empty = vec![];
    let messages = chat_body["messages"].as_array().unwrap_or(&empty);

    let mut instructions = Vec::new();
    let mut input_msgs: Vec<Value> = Vec::new();

    for msg in messages {
        if msg.get("role").and_then(Value::as_str) == Some("system") {
            if let Some(c) = msg.get("content").and_then(Value::as_str) {
                if !c.is_empty() {
                    instructions.push(c.to_string());
                }
            }
        } else if msg.get("role").and_then(Value::as_str) == Some("tool") {
            // Chat Completions 的 tool 消息对应 Responses 的 function_call_output。
            let call_id = msg
                .get("tool_call_id")
                .and_then(Value::as_str)
                .unwrap_or("call_1");
            let output = msg.get("content").cloned().unwrap_or_else(|| json!(""));
            input_msgs.push(json!({
                "type": "function_call_output",
                "call_id": call_id,
                "output": if output.is_string() {
                    output
                } else {
                    json!(output.to_string())
                }
            }));
        } else if let Some(tool_calls) = msg.get("tool_calls").and_then(Value::as_array) {
            // 保留 assistant 的文字部分，再把每个工具调用转换为独立 Responses item。
            if let Some(content) = msg.get("content").and_then(Value::as_str) {
                if !content.is_empty() {
                    input_msgs.push(json!({
                        "role": "assistant",
                        "content": content
                    }));
                }
            }
            for tool_call in tool_calls {
                let Some(function) = tool_call.get("function") else {
                    continue;
                };
                input_msgs.push(json!({
                    "type": "function_call",
                    "call_id": tool_call
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("call_1"),
                    "name": function
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool"),
                    "arguments": function
                        .get("arguments")
                        .and_then(Value::as_str)
                        .unwrap_or("{}")
                }));
            }
        } else {
            // 处理普通消息和多模态内容
            let mut converted_msg = json!({
                "role": msg.get("role").cloned().unwrap_or_else(|| json!("user"))
            });

            // 处理多模态消息 (image_url 转换为 input_image)
            if let Some(content_arr) = msg.get("content").and_then(Value::as_array) {
                let mut converted_content = Vec::new();
                for part in content_arr {
                    if let Some(part_type) = part.get("type").and_then(Value::as_str) {
                        match part_type {
                            "text" => {
                                // 标准格式: {type:"input_text", text:"..."}
                                if let Some(text) = part.get("text") {
                                    converted_content.push(json!({
                                        "type": "input_text",
                                        "text": text
                                    }));
                                } else {
                                    converted_content.push(part.clone());
                                }
                            }
                            "image_url" => {
                                // Chat Completions: {type:"image_url", image_url:{url:"..."}}
                                // Responses: {type:"input_image", image_url:"data:image/png;base64,..."}
                                if let Some(image_url_obj) = part.get("image_url") {
                                    if let Some(url) =
                                        image_url_obj.get("url").and_then(Value::as_str)
                                    {
                                        let mut img_part = json!({
                                            "type": "input_image",
                                            "image_url": url
                                        });
                                        // 保留 detail 字段（如果存在）
                                        if let Some(detail) = image_url_obj.get("detail") {
                                            img_part["detail"] = detail.clone();
                                        }
                                        converted_content.push(img_part);
                                    }
                                }
                            }
                            _ => {
                                converted_content.push(part.clone());
                            }
                        }
                    } else {
                        converted_content.push(part.clone());
                    }
                }
                converted_msg["content"] = json!(converted_content);
            } else {
                converted_msg["content"] = msg.get("content").cloned().unwrap_or_else(|| json!(""));
            }

            input_msgs.push(converted_msg);
        }
    }

    let mut body = json!({
        "model": chat_body.get("model").cloned().unwrap_or_else(|| json!("")),
        "input": input_msgs,
        "max_output_tokens": chat_body.get("max_tokens").cloned().unwrap_or(json!(16384)),
    });

    if !instructions.is_empty() {
        body["instructions"] = json!(instructions.join("\n\n"));
    }

    // 推理模型通常拒绝 temperature 参数，避免把 Chat Completions 的默认值透传过去。
    let model = chat_body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_reasoning_model = model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("gpt-5")
        || model.starts_with("gpt-6")
        || model.contains("reasoning")
        || model.contains("reasoner");

    if !is_reasoning_model {
        if let Some(temp) = chat_body.get("temperature") {
            // 只有非推理模型才添加 temperature 参数
            body["temperature"] = temp.clone();
        }
    } else {
        log::debug!("检测到推理模型 '{}'，已跳过 temperature 参数", model);
    }

    // Chat Completions: {type:function,function:{name,parameters}}
    // Responses: {type:function,name,parameters}
    if let Some(tools) = chat_body.get("tools").and_then(Value::as_array) {
        let response_tools: Vec<Value> = tools
            .iter()
            .filter_map(|tool| {
                let function = tool.get("function")?;
                let mut converted = json!({
                    "type": "function",
                    "name": function.get("name").cloned().unwrap_or_else(|| json!("tool")),
                    "description": function
                        .get("description")
                        .cloned()
                        .unwrap_or_else(|| json!("")),
                    "parameters": function
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({"type": "object", "properties": {}}))
                });
                if let Some(strict) = function.get("strict") {
                    converted["strict"] = strict.clone();
                }
                Some(converted)
            })
            .collect();
        if !response_tools.is_empty() {
            body["tools"] = json!(response_tools);
        }
    }

    // 转换 tool_choice 格式
    if let Some(tc) = chat_body.get("tool_choice") {
        let converted_tool_choice = if tc.is_string() {
            // 字符串形式直接保留 ("auto", "required", "none")
            tc.clone()
        } else if let Some(tc_obj) = tc.as_object() {
            // Chat Completions 对象格式: {type:"function", function:{name:"foo"}}
            // Responses 格式: {type:"function", name:"foo"}
            if tc_obj.get("type").and_then(Value::as_str) == Some("function") {
                if let Some(func_name) = tc_obj
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(Value::as_str)
                {
                    json!({
                        "type": "function",
                        "name": func_name
                    })
                } else {
                    tc.clone()
                }
            } else {
                tc.clone()
            }
        } else {
            tc.clone()
        };
        body["tool_choice"] = converted_tool_choice;
    }

    body
}

/// 将 /v1/responses 的 JSON 响应解析为 Accio Gemini 协议格式。
/// 兼容：
///   - output[].type = "function_call" (顶层工具调用)
///   - output[].content[].type = "output_text" | "text"  → parts[].text
///   - output[].content[].type = "tool_use" | "function_call" → parts[].functionCall
///   - usage.input_tokens / output_tokens / total_tokens
///   - status / incomplete_details / error 字段处理
fn parse_responses_api_response(json_val: &Value, default_model: &str) -> Value {
    let model_name = json_val
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(default_model);

    // 首先检查响应状态
    let status = json_val
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed");

    // 如果响应失败，返回错误
    if status == "failed" {
        let error_msg = json_val
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown error");
        return json!({
            "content": {
                "role": "model",
                "parts": [{"text": format!("API Error: {}", error_msg)}]
            },
            "finishReason": "ERROR",
            "usage": {
                "promptTokens": 0,
                "candidatesTokens": 0,
                "totalTokens": 0
            },
            "modelVersion": model_name
        });
    }

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

    // 解析完成原因，处理 incomplete 状态
    let accio_finish_reason = if status == "incomplete" {
        // 检查 incomplete_details.reason
        let incomplete_reason = json_val
            .pointer("/incomplete_details/reason")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        match incomplete_reason {
            "max_output_tokens" | "max_tokens" => "MAX_TOKENS",
            "content_filter" => "SAFETY",
            _ => "OTHER",
        }
    } else {
        // 正常完成，读取 finish_reason
        let finish_reason = json_val
            .get("finish_reason")
            .or_else(|| json_val.pointer("/output/0/finish_reason"))
            .and_then(Value::as_str)
            .unwrap_or("stop");

        match finish_reason.to_lowercase().as_str() {
            "stop" | "end_turn" => "STOP",
            "length" | "max_tokens" | "max_output_tokens" => "MAX_TOKENS",
            "content_filter" | "safety" => "SAFETY",
            "tool_calls" | "function_call" => "STOP",
            _ => "STOP",
        }
    };

    // 解析 output 数组
    if let Some(output) = json_val.get("output").and_then(Value::as_array) {
        for (item_idx, item) in output.iter().enumerate() {
            // 检查顶层是否直接是 function_call (OpenAI Responses API 标准格式)
            if item.get("type").and_then(Value::as_str) == Some("function_call") {
                let call_id = item
                    .get("call_id")
                    .or_else(|| item.get("id"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("call_{}", item_idx + 1));
                let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                let raw_args = item
                    .get("arguments")
                    .or_else(|| item.get("input"))
                    .cloned()
                    .unwrap_or(json!({}));
                let (parsed_args, args_str) = if let Some(s) = raw_args.as_str() {
                    let parsed: Value = serde_json::from_str(s).unwrap_or_else(|_| json!({}));
                    (parsed, s.to_string())
                } else {
                    let s = serde_json::to_string(&raw_args).unwrap_or_else(|_| "{}".to_string());
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
                continue;
            }

            // 解析 content[] 数组 (嵌套格式)
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
                                .get("call_id")
                                .or_else(|| c.get("id"))
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
        "finishReason": accio_finish_reason,
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

            // 如果原始模型是推理模型（o1/o3/o4/gpt-5/gpt-6 系列），转换参数以兼容 Chat Completions
            if actual_model.starts_with("o1")
                || actual_model.starts_with("o3")
                || actual_model.starts_with("o4")
                || actual_model.starts_with("gpt-5")
                || actual_model.starts_with("gpt-6")
            {
                // max_tokens → max_completion_tokens
                if let Some(max_tokens) = body.get("max_tokens").cloned() {
                    body["max_completion_tokens"] = max_tokens;
                    body.as_object_mut().unwrap().remove("max_tokens");
                }
                // 移除不兼容的 temperature（推理模型不支持）
                body.as_object_mut().unwrap().remove("temperature");
                log::info!("推理模型降级至 Chat Completions: 已转换参数 (max_completion_tokens, 移除 temperature)");
            }

            body
        }
    };

    log::info!("🌐 发起上游请求: 端点={}, 模型={}", endpoint, actual_model);

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

    log::debug!(
        "📥 收到上游响应: HTTP {}, Content-Type={}",
        status,
        content_type
    );

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
        log::error!(
            "❌ 上游服务返回错误: HTTP {}, 端点={}, 完整响应长度: {} chars",
            status,
            endpoint_type.label(),
            text.len()
        );
        // 返回完整错误文本，供调用方进行降级判断（不要截断）
        return Err((Some(status), text));
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
                let mut tool_calls: Vec<Value> = Vec::new();
                let mut full_response: Option<Value> = None;

                for line in text.lines() {
                    let trimmed = line.trim();
                    if let Some(stripped) = trimmed.strip_prefix("data:") {
                        let data = stripped.trim();
                        if data == "[DONE]" || data.is_empty() {
                            continue;
                        }
                        if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                            // 标准 Responses API SSE 事件格式
                            // 1. 文本增量: response.output_text.delta (字符串)
                            if let Some(delta_str) = chunk
                                .pointer("/response/output_text/delta")
                                .and_then(Value::as_str)
                            {
                                text_buf.push_str(delta_str);
                            }
                            // 2. 工具参数增量: response.function_call_arguments.delta
                            if let Some(args_delta) =
                                chunk.pointer("/response/function_call_arguments/delta")
                            {
                                if let Some(item_id) = chunk
                                    .pointer("/response/function_call_arguments/item_id")
                                    .and_then(Value::as_str)
                                {
                                    tool_calls.push(json!({
                                        "item_id": item_id,
                                        "delta": args_delta
                                    }));
                                }
                            }
                            // 3. 完整结果: response.completed (内容位于 response.output)
                            if chunk.pointer("/response/completed").is_some() {
                                if let Some(output) = chunk.pointer("/response/output") {
                                    full_response = Some(json!({
                                        "output": output,
                                        "status": chunk.pointer("/response/status"),
                                        "usage": chunk.pointer("/response/usage")
                                    }));
                                }
                            }

                            // 兼容旧格式: 检查是否有完整的 output (可能在流的最后一帧)
                            if full_response.is_none() && chunk.get("output").is_some() {
                                full_response = Some(chunk.clone());
                            }

                            // 兼容旧格式: 累积文本增量
                            if let Some(delta) = chunk
                                .pointer("/delta/text")
                                .or_else(|| chunk.pointer("/text"))
                                .and_then(Value::as_str)
                            {
                                text_buf.push_str(delta);
                            }

                            // 兼容旧格式: 累积工具调用增量
                            if let Some(delta_obj) = chunk.get("delta").and_then(Value::as_object) {
                                if let Some(tc) =
                                    delta_obj.get("tool_calls").and_then(Value::as_array)
                                {
                                    for tool_call in tc {
                                        tool_calls.push(tool_call.clone());
                                    }
                                }
                                if delta_obj.get("type").and_then(Value::as_str)
                                    == Some("function_call")
                                {
                                    tool_calls.push(chunk.clone());
                                }
                            }
                        }
                    }
                }

                // 优先使用完整响应，其次构造累积的内容
                if let Some(resp) = full_response {
                    parse_responses_api_response(&resp, actual_model)
                } else if !text_buf.is_empty() || !tool_calls.is_empty() {
                    // 构造伪响应对象
                    let mut output_items = Vec::new();
                    if !text_buf.is_empty() {
                        output_items.push(json!({
                            "content": [{"type": "text", "text": text_buf}]
                        }));
                    }
                    for tc in tool_calls {
                        output_items.push(tc);
                    }
                    let synthetic = json!({
                        "output": output_items,
                        "finish_reason": "stop",
                        "usage": {
                            "input_tokens": 0,
                            "output_tokens": 0,
                            "total_tokens": 0
                        }
                    });
                    parse_responses_api_response(&synthetic, actual_model)
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
///
/// - Claude 优先 → /v1/messages；若中转站未实现则自动降级 → /v1/chat/completions
/// - GPT/o1/o3/DeepSeek/通义等 → /v1/chat/completions (兼容所有第三方中转站)
///
/// 返回: `Result<Value, (Option<u16>, String)>` — 错误时返回 (HTTP状态码, 错误消息)
async fn call_upstream_llm(
    client: &Client,
    config: &AccioConfig,
    input: Value,
) -> Result<Value, (Option<u16>, String)> {
    if config.api_key.trim().is_empty() {
        return Err((
            None,
            "API 密钥未配置，请先在 AI-Helper 中填写 API Key".to_string(),
        ));
    }
    validate_upstream_destination(config).map_err(|e| (None, e))?;

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

    // 记录诊断信息
    let msg_count = chat_body
        .get("messages")
        .and_then(Value::as_array)
        .map(|m| m.len())
        .unwrap_or(0);
    let tools_count = chat_body
        .get("tools")
        .and_then(Value::as_array)
        .map(|t| t.len())
        .unwrap_or(0);
    let request_size = serde_json::to_string(&chat_body)
        .map(|s| s.len())
        .unwrap_or(0);

    log::info!(
        "📊 请求统计: 历史条数={}, 工具数量={}, 请求大小={} bytes",
        msg_count,
        tools_count,
        request_size
    );

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
            // 智能降级逻辑：检测是否需要从主端点降级到 Chat Completions
            let should_fallback = match primary_endpoint {
                // Messages API → Chat Completions 降级条件：仅限明确未受理的 404 或 501，严禁对 500 或已受理错误自动重试
                ApiEndpoint::Messages => {
                    status_opt == Some(StatusCode::NOT_FOUND)
                        || status_opt == Some(StatusCode::NOT_IMPLEMENTED)
                }
                // Responses API → Chat Completions 降级条件 (仅限明确不支持的情况)
                ApiEndpoint::Responses => {
                    let err_lower = err_msg.to_lowercase();

                    // 检查是否为模型不存在错误（不应降级）
                    let is_model_not_found = err_lower.contains("model")
                        && (err_lower.contains("not found")
                            || err_lower.contains("does not exist")
                            || err_lower.contains("not available"));

                    // 只在明确不支持端点时降级，不把所有 400 都当作不支持
                    let is_endpoint_not_supported = (status_opt == Some(StatusCode::NOT_FOUND)
                        || status_opt == Some(StatusCode::NOT_IMPLEMENTED)
                        || (status_opt == Some(StatusCode::BAD_REQUEST)
                            && ((err_lower.contains("endpoint")
                                && (err_lower.contains("not found")
                                    || err_lower.contains("not supported")
                                    || err_lower.contains("does not exist")))
                                || err_lower.contains("api not available")
                                || err_lower.contains("route not found"))))
                        && !err_lower.contains("parameter")
                        && !err_lower.contains("schema")
                        && !err_lower.contains("token")
                        && !err_lower.contains("quota");

                    is_endpoint_not_supported && !is_model_not_found
                }
                // Chat Completions 本身不需要降级
                ApiEndpoint::ChatCompletions => false,
            };

            if should_fallback {
                log::warn!(
                    "⚠️ 上游 {} 端点响应 HTTP {:?} ({})，中转站可能仅支持 Chat Completions 协议，正在自动降级...",
                    primary_endpoint.label(),
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
                        log::info!("✅ 自动降级至 /v1/chat/completions 成功！");
                        (p, fallback_endpoint)
                    }
                    Err((status_opt, fb_err)) => {
                        let status_code = status_opt.map(|s| s.as_u16());
                        return Err((
                            status_code,
                            format!(
                                "上游 {} 失败 ({})，降级 chat/completions 亦失败: {}",
                                primary_endpoint.label(),
                                err_msg,
                                fb_err
                            ),
                        ));
                    }
                }
            } else {
                let status_code = status_opt.map(|s| s.as_u16());
                return Err((status_code, err_msg));
            }
        }
    };

    log::info!(
        "✅ Accio 请求在 {} ms 内转译并完成 (模型: {}, 端点: {})",
        started.elapsed().as_millis(),
        actual_model,
        final_endpoint.label()
    );
    Ok(payload)
}

async fn download_generated_image(img_url: &str) -> Result<Vec<u8>, String> {
    let parsed = crate::image_fetch::validate_image_url(img_url).map_err(|e| e.to_string())?;
    let resolved_ip =
        crate::image_fetch::resolve_public_host(&parsed).map_err(|e| e.to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "图片地址缺少主机名".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        // Bind the checked DNS answer to the actual connection. Re-resolving
        // the hostname after the preflight would leave a DNS-rebinding window.
        .resolve(host, std::net::SocketAddr::new(resolved_ip, port))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("取图请求失败: {e}"))?;
    if let Some(peer) = resp.remote_addr() {
        if crate::image_fetch::is_blocked_ip(peer.ip()) {
            return Err(crate::image_fetch::ImageFetchError::BlockedAddress.to_string());
        }
    }
    if !resp.status().is_success() {
        return Err(format!("取图 HTTP {}", resp.status()));
    }
    let mut collected = Vec::new();
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("取图传输中断: {e}"))?;
        collected.extend_from_slice(&chunk);
        crate::image_fetch::enforce_image_size(collected.len()).map_err(|e| e.to_string())?;
    }
    crate::image_fetch::detect_image_mime(&collected)
        .ok_or_else(|| crate::image_fetch::ImageFetchError::NotImage.to_string())?;
    Ok(collected)
}

/// 处理 Accio Work 的生图请求 (responseModalities: ["IMAGE"])
async fn call_custom_image(
    client: &Client,
    config: &AccioConfig,
    input: Value,
) -> Result<Value, String> {
    if !check_image_rate_limit() {
        log::warn!("【生图流控安全拦截】短时间内生图请求过于频繁 (超出 6次/分钟 限制)，已主动拦截以防资金耗损");
        return Err("【生图流控拦截】1 分钟内生图请求已达到 6 次安全上限。生图接口单价较高，为防止账户额度遭异常耗尽已自动限流，请稍后再试。".to_string());
    }
    if config.api_key.trim().is_empty() {
        return Err("API 密钥未配置，请先在 AI-Helper 中填写 API Key".to_string());
    }
    validate_upstream_destination(config)?;
    if config.image_model.trim().is_empty() {
        return Err("未配置受管生图模型或预算，已禁用生图以免静默使用昂贵默认模型".to_string());
    }
    crate::paid_request::reserve_image_unit()?;
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

    let image_model = config.image_model.trim();

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

    let resp = match client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .json(&req_payload)
        .timeout(Duration::from_secs(120))
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Err(error) = crate::paid_request::settle_image_unit() {
                    log::error!("生图已收到成功响应但预算结算失败，保留未决状态: {error}");
                }
            } else {
                log::warn!(
                    "生图上游返回 HTTP {}，扣费结果保留未决，不自动释放或重试",
                    resp.status()
                );
            }
            resp
        }
        Err(e) => {
            return Err(format!("请求生图服务失败: {}", e));
        }
    };

    let status = resp.status();
    let mut stream = resp.bytes_stream();
    let mut collected = Vec::new();
    const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024; // 10MB 流式读取上限
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取生图响应流中断: {}", e))?;
        if collected.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("上游生图响应数据超出 10MB 安全上限".to_string());
        }
        collected.extend_from_slice(&chunk);
    }
    let body_text =
        String::from_utf8(collected).map_err(|e| format!("解析生图响应文本失败: {}", e))?;

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
                match download_generated_image(img_url).await {
                    Ok(bytes) => {
                        use base64::Engine;
                        b64_opt = Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
                    }
                    Err(e) => {
                        log::warn!("取图失败，保留原图 URL，不重新计费生成: {}", e);
                        // 关键加固：保留已扣费生成的图片 URL 返回给用户，避免无法重取或丢失原图
                        return Ok(json!({
                            "content": {
                                "role": "model",
                                "parts": [{
                                    "text": format!("图片已扣费生成成功，但自动下载暂未完成 ({})。您可直接点击以下官方原链查看/保存图片（不重复计费）:\n{}", e, img_url)
                                }]
                            },
                            "turnComplete": true,
                            "partial": false,
                            "finishReason": "STOP",
                            "customMetadata": {
                                "model_name": image_model,
                                "bridge": "ai-helper-image",
                                "original_image_url": img_url
                            }
                        }));
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
    if config.prevent_official_leak && !crate::accio::config::is_official_metadata_path(path) {
        log::warn!(
            "【防泄漏拦截】已开启 prevent_official_leak，已拦截向阿里官方网关透明转发: {}",
            path
        );
        return Err((
            StatusCode::FORBIDDEN,
            format!(
                "【AI-Helper 安全保护】防官方泄露已开启 (prevent_official_leak=true)，已拦截向阿里官方网关 ({}) 的请求: {}",
                config.official_gateway, path
            ),
        ));
    }

    let url = crate::accio::config::official_request_url(&config, path)
        .map_err(|error| (StatusCode::FORBIDDEN, error))?;

    let mut req = client.request(method, url).body(body);
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
    let url = crate::accio::config::official_request_url(config, path)?;

    let mut req = client.request(method, url).body(body);
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

    #[tokio::test]
    async fn instance_path_prefix_is_verified_and_stripped_before_routing() {
        let token = ensure_instance_token();
        let routes = Router::new()
            .route("/health", get(|| async { "ok" }))
            .route(
                "/api/echo",
                get(|uri: axum::http::Uri| async move { uri.to_string() }),
            )
            .fallback(
                |uri: axum::http::Uri| async move { (StatusCode::NOT_FOUND, uri.to_string()) },
            );
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            axum::serve(listener, build_bridge_app(routes))
                .await
                .unwrap();
        });
        let base = format!("http://127.0.0.1:{port}");
        let gateway = accio_gateway_base_url(port).unwrap();
        assert_eq!(gateway, format!("{base}/i/{token}"));
        let client = Client::new();
        let get = |url: String| {
            let client = client.clone();
            async move {
                let response = client.get(url).send().await.unwrap();
                (response.status(), response.text().await.unwrap())
            }
        };

        // Accio 形式：凭据在路径前缀中，剥离后命中业务路由且保留查询串
        assert_eq!(
            get(format!("{gateway}/api/echo?sg_k=1")).await,
            (StatusCode::OK, "/api/echo?sg_k=1".to_string())
        );
        assert_eq!(get(format!("{gateway}/health")).await.0, StatusCode::OK);
        // 未知路径剥离前缀后进入 fallback，确保凭据不会随路径转发出去
        assert_eq!(
            get(format!("{gateway}/api/unknown")).await,
            (StatusCode::NOT_FOUND, "/api/unknown".to_string())
        );

        // 无凭据、错误凭据均被拒绝，/health 保持免鉴权
        assert_eq!(
            get(format!("{base}/api/echo")).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            get(format!("{base}/i/{}/api/echo", "0".repeat(64))).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(get(format!("{base}/health")).await.0, StatusCode::OK);

        // 兼容请求头凭据
        let response = client
            .get(format!("{base}/api/echo"))
            .header(crate::instance_auth::INSTANCE_HEADER, &token)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        server.abort();
    }

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

    fn payload_model_ids(payload: &Value) -> Vec<&str> {
        payload[0]["modelList"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["modelCode"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn model_list_payload_only_includes_key_available_models() {
        let payload = build_provider_payload(
            "gpt-6-sol",
            &[
                "gpt-6-sol".to_string(),
                "gpt-6.1-sol".to_string(),
                "codex-auto-review".to_string(),
            ],
        );
        let ids = payload_model_ids(&payload);
        assert_eq!(ids, vec!["gpt-6-sol", "gpt-6.1-sol", "codex-auto-review"]);
        assert!(!ids.contains(&"gpt-4o"));
        assert!(!ids.contains(&"claude-3-7-sonnet"));
        assert!(!ids.contains(&"qwen-2.5-max"));
        assert!(!ids.contains(&"deepseek-reasoner"));
        assert_eq!(payload[0]["modelList"][0]["isDefault"], true);
        assert_eq!(payload[0]["modelList"][1]["isDefault"], false);
    }

    #[test]
    fn model_list_payload_does_not_inject_unavailable_selected_model() {
        let payload = build_provider_payload("secret-model", &["gpt-6-sol".to_string()]);
        let ids = payload_model_ids(&payload);
        assert_eq!(ids, vec!["gpt-6-sol"]);
        assert_eq!(payload[0]["modelList"][0]["isDefault"], false);
    }

    #[test]
    fn model_list_payload_is_empty_when_key_has_no_models() {
        let payload = build_provider_payload("gpt-4o", &[]);
        assert!(payload[0]["modelList"].as_array().unwrap().is_empty());
    }

    #[test]
    fn model_source_fingerprint_normalizes_base_url() {
        let fp1 = model_source_fingerprint("https://api.example.com/", "sk-123");
        let fp2 = model_source_fingerprint("https://api.example.com/v1", "sk-123");
        let fp3 = model_source_fingerprint("https://api.example.com/v1/", "sk-123");
        let fp4 = model_source_fingerprint(" https://api.example.com ", "sk-123 ");
        assert!(!fp1.contains("sk-123"));
        assert_eq!(fp1, fp2);
        assert_eq!(fp2, fp3);
        assert_eq!(fp3, fp4);
    }

    #[test]
    fn build_provider_payload_supports_custom_source_label() {
        let payload = build_provider_payload_with_source(
            "deepseek-chat",
            &["deepseek-chat".to_string()],
            Some("https://api.deepseek.com/v1/"),
        );
        assert_eq!(
            payload[0]["providerDisplayName"],
            "AI-Helper (api.deepseek.com)"
        );
        assert_eq!(
            payload[0]["modelList"][0]["modelDesc"],
            "deepseek-chat via api.deepseek.com"
        );
    }

    #[test]
    fn test_get_model_context_window() {
        // GPT-6 系列 - 1,050,000 tokens
        assert_eq!(get_model_context_window("gpt-6.1-sol"), 1050000);
        assert_eq!(get_model_context_window("gpt-6-sol"), 1050000);
        assert_eq!(get_model_context_window("gpt-6-luna"), 1050000);
        assert_eq!(get_model_context_window("gpt-6"), 1050000);

        // GPT-5 系列 - 400,000 tokens
        assert_eq!(get_model_context_window("gpt-5"), 400000);
        assert_eq!(get_model_context_window("gpt-5.6-sol"), 400000);

        // GPT-4 系列 - 测试更具体型号优先
        assert_eq!(get_model_context_window("gpt-4.1"), 1047576); // 官方规格
        assert_eq!(get_model_context_window("gpt-4.1-mini"), 128000);
        assert_eq!(get_model_context_window("gpt-4"), 8192); // 不应该匹配 gpt-4.1

        // Qwen 系列 - 测试更具体型号优先
        assert_eq!(get_model_context_window("qwen-max"), 32000);
        assert_eq!(get_model_context_window("qwen-2.5-max"), 128000); // 应该先匹配 qwen-2.5-max
        assert_eq!(get_model_context_window("qwen-2.5"), 128000);

        // Claude 系列
        assert_eq!(get_model_context_window("claude-3-7-sonnet"), 200000);
        assert_eq!(get_model_context_window("claude-3.7-sonnet"), 200000);
    }

    #[test]
    fn test_chat_to_responses_body_with_multimodal() {
        let chat_body = json!({
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What's in this image?"},
                        {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg", "detail": "high"}}
                    ]
                }
            ]
        });

        let responses_body = chat_to_responses_body(&chat_body);

        // 验证 image_url 被转换为标准格式
        let input = responses_body.get("input").unwrap().as_array().unwrap();
        let first_msg = &input[0];
        let content = first_msg.get("content").unwrap().as_array().unwrap();

        // 文本格式: {type:"input_text", text:"..."}
        assert_eq!(content[0]["type"], "input_text");
        assert_eq!(content[0]["text"], "What's in this image?");

        // 图片格式: {type:"input_image", image_url:"...", detail:"high"}
        assert_eq!(content[1]["type"], "input_image");
        assert_eq!(content[1]["image_url"], "https://example.com/image.jpg");
        assert_eq!(content[1]["detail"], "high");
    }

    #[test]
    fn test_chat_to_responses_body_with_tool_choice() {
        // 测试字符串形式
        let chat_body1 = json!({
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "test"}],
            "tool_choice": "auto"
        });
        let responses_body1 = chat_to_responses_body(&chat_body1);
        assert_eq!(responses_body1["tool_choice"], "auto");

        // 测试对象形式
        let chat_body2 = json!({
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "test"}],
            "tool_choice": {
                "type": "function",
                "function": {"name": "get_weather"}
            }
        });
        let responses_body2 = chat_to_responses_body(&chat_body2);
        assert_eq!(responses_body2["tool_choice"]["type"], "function");
        assert_eq!(responses_body2["tool_choice"]["name"], "get_weather");
    }

    #[test]
    fn test_parse_responses_api_response_with_top_level_function_call() {
        // 测试顶层 function_call (OpenAI Responses API 标准格式)
        let response = json!({
            "model": "gpt-4o",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call_abc123",
                    "name": "get_weather",
                    "arguments": "{\"location\":\"Beijing\"}"
                }
            ],
            "finish_reason": "tool_calls",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "total_tokens": 150
            }
        });

        let parsed = parse_responses_api_response(&response, "gpt-4o");

        let parts = parsed["content"]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["functionCall"]["id"], "call_abc123");
        assert_eq!(parts[0]["functionCall"]["name"], "get_weather");
        assert_eq!(parts[0]["functionCall"]["args"]["location"], "Beijing");
    }

    #[test]
    fn test_parse_responses_api_response_with_finish_reasons() {
        let test_cases = vec![
            ("stop", "STOP"),
            ("length", "MAX_TOKENS"),
            ("max_tokens", "MAX_TOKENS"),
            ("content_filter", "SAFETY"),
            ("tool_calls", "STOP"),
        ];

        for (finish_reason, expected) in test_cases {
            let response = json!({
                "model": "gpt-4o",
                "output": [{"content": [{"type": "text", "text": "test"}]}],
                "finish_reason": finish_reason,
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            });

            let parsed = parse_responses_api_response(&response, "gpt-4o");
            assert_eq!(
                parsed["finishReason"], expected,
                "Failed for finish_reason: {}",
                finish_reason
            );
        }
    }

    #[test]
    fn test_parse_responses_api_response_prefers_call_id() {
        // 测试优先使用 call_id 而不是 id
        let response = json!({
            "model": "gpt-4o",
            "output": [
                {
                    "type": "function_call",
                    "id": "old_id",
                    "call_id": "new_call_id",
                    "name": "test_tool",
                    "arguments": "{}"
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        });

        let parsed = parse_responses_api_response(&response, "gpt-4o");
        let parts = parsed["content"]["parts"].as_array().unwrap();
        assert_eq!(parts[0]["functionCall"]["id"], "new_call_id");
    }

    #[test]
    fn test_parse_responses_api_response_with_status_handling() {
        // 测试 status=incomplete 和 incomplete_details
        let incomplete_response = json!({
            "model": "gpt-4o",
            "status": "incomplete",
            "incomplete_details": {
                "reason": "max_output_tokens"
            },
            "output": [{"content": [{"type": "text", "text": "partial response"}]}],
            "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
        });

        let parsed = parse_responses_api_response(&incomplete_response, "gpt-4o");
        assert_eq!(parsed["finishReason"], "MAX_TOKENS");

        // 测试 status=failed 和 error
        let failed_response = json!({
            "model": "gpt-4o",
            "status": "failed",
            "error": {
                "message": "Rate limit exceeded"
            },
            "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        });

        let parsed_failed = parse_responses_api_response(&failed_response, "gpt-4o");
        assert_eq!(parsed_failed["finishReason"], "ERROR");
        assert!(parsed_failed["content"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Rate limit exceeded"));

        // 测试 status=incomplete 与 content_filter
        let filtered_response = json!({
            "model": "gpt-4o",
            "status": "incomplete",
            "incomplete_details": {
                "reason": "content_filter"
            },
            "output": [],
            "usage": {"input_tokens": 10, "output_tokens": 0, "total_tokens": 10}
        });

        let parsed_filtered = parse_responses_api_response(&filtered_response, "gpt-4o");
        assert_eq!(parsed_filtered["finishReason"], "SAFETY");
    }

    #[test]
    fn test_is_trusted_bridge_origin() {
        assert!(is_trusted_bridge_origin("http://127.0.0.1:3000"));
        assert!(is_trusted_bridge_origin("http://localhost:8080"));
        assert!(is_trusted_bridge_origin("tauri://localhost"));
        assert!(is_trusted_bridge_origin("https://tauri.localhost"));
        assert!(is_trusted_bridge_origin("vscode-webview://d8h24h2f84"));

        assert!(!is_trusted_bridge_origin("https://evil.com"));
        assert!(!is_trusted_bridge_origin("http://malicious-hacker.com"));
        assert!(!is_trusted_bridge_origin("http://localhost.attacker.com"));
    }

    #[test]
    fn test_is_trusted_bridge_host() {
        assert!(is_trusted_bridge_host("127.0.0.1"));
        assert!(is_trusted_bridge_host("127.0.0.1:8787"));
        assert!(is_trusted_bridge_host("localhost"));
        assert!(is_trusted_bridge_host("localhost:8787"));
        assert!(is_trusted_bridge_host("tauri.localhost"));
        assert!(is_trusted_bridge_host("tauri.localhost:3000"));
        assert!(is_trusted_bridge_host("[::1]"));
        assert!(is_trusted_bridge_host("[::1]:8787"));

        assert!(!is_trusted_bridge_host("evil.com"));
        assert!(!is_trusted_bridge_host("rebind.evil.com:8787"));
        assert!(!is_trusted_bridge_host("attacker.com"));
        assert!(!is_trusted_bridge_host("127.0.0.1.attacker.com"));
        assert!(!is_trusted_bridge_host("localhost.attacker.com:8787"));
    }

    #[test]
    fn test_sliding_window_rate_limiter() {
        let mut limiter = SlidingWindowRateLimiter::new(Duration::from_secs(10), 3);
        assert!(limiter.check_and_record());
        assert!(limiter.check_and_record());
        assert!(limiter.check_and_record());
        // 4th request must be rejected
        assert!(!limiter.check_and_record());
    }

    #[test]
    fn test_is_monetized_bridge_path() {
        assert!(is_monetized_bridge_path("/api/adk/llm"));
        assert!(is_monetized_bridge_path("/api/adk/llm/v1/chat/completions"));
        assert!(is_monetized_bridge_path("/api/adk/embedding/embed"));
        assert!(is_monetized_bridge_path("/api/tool/rlab/call"));
        assert!(is_monetized_bridge_path("/api/mcp/proxy"));

        // Free endpoints must not be throttled by monetized limiter
        assert!(!is_monetized_bridge_path("/health"));
        assert!(!is_monetized_bridge_path("/api/llm/config/v2"));
    }
}

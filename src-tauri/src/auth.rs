use log::error;
use reqwest::cookie::Jar;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, ORIGIN};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

pub const BASE_URL: &str = "https://bob-api.com";
pub const AUTH_ORIGIN: &str = "https://bob-api.com";
pub const USER_AGENT: &str = "AI-Helper-Desktop/1.0 (Windows)";

// ── 数据模型定义 ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteStatus {
    pub password_login_enabled: bool,
    pub password_login_encryption_enabled: bool,
    pub captcha_enabled: bool,
    pub captcha_type: Option<String>,
    pub slide_captcha_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionKeyData {
    pub enabled: bool,
    pub kid: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptchaGenerateData {
    pub captcha_id: String,
    pub master_image: String,
    pub tile_image: String,
    pub master_width: u32,
    pub master_height: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub thumb_display_x: i32,
    pub thumb_display_y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: i64,
    pub username: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub role: Option<i32>,
    #[serde(default)]
    pub email: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub sid: String,
    #[serde(default)]
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: Option<String>,
    pub password_encrypted: Option<String>,
    pub encryption_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwoFaRequirement {
    pub require_2fa: bool,
    pub flow_token: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginSuccessData {
    pub user: UserInfo,
    pub access_token: String,
    pub access_expires_at: i64,
    pub session_sid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LoginResult {
    #[serde(rename = "success")]
    Success(LoginSuccessData),
    #[serde(rename = "require_2fa")]
    Require2Fa(TwoFaRequirement),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenItem {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub key: String,
    #[serde(default = "default_status")]
    pub status: i32, // 1: active, 2: disabled, 3: expired, 4: quota exhausted
    #[serde(default = "default_neg_one")]
    pub expired_time: i64,
    #[serde(default)]
    pub unlimited_quota: bool,
    #[serde(default)]
    pub remain_quota: i64,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub user_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelTrendPoint {
    #[serde(default)]
    pub timestamp: i64,
    #[serde(default)]
    pub success_rate: f64,
    #[serde(default)]
    pub avg_response_time: f64,
    #[serde(default)]
    pub has_data: bool,
    #[serde(default)]
    pub total_requests: i64,
    #[serde(default)]
    pub failed_requests: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelGroupOverview {
    pub group_name: String,
    #[serde(default)]
    pub success_rate: f64,
    #[serde(default)]
    pub avg_response_time: f64,
    #[serde(default)]
    pub has_successful_requests: bool,
    #[serde(default)]
    pub total_requests: i64,
    #[serde(default)]
    pub failed_requests: i64,
    #[serde(default)]
    pub trend_points: Vec<ChannelTrendPoint>,
}

fn default_status() -> i32 {
    1
}
fn default_neg_one() -> i64 {
    -1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserWalletInfo {
    pub quota: i64,
    pub used_quota: i64,
    pub quota_usd: f64,
    pub quota_cny: f64,
    pub used_quota_usd: f64,
    pub used_quota_cny: f64,
    pub request_count: i64,
    pub group: Option<String>,
    pub quota_per_unit: i64,
    pub rmb_to_usd_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AuthSessionStorage {
    pub user: Option<UserInfo>,
    pub refresh_cookie: Option<String>,
    pub session_sid: Option<String>,
    pub selected_token_id: Option<i64>,
    pub selected_token_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentAuthState {
    pub is_logged_in: bool,
    pub user: Option<UserInfo>,
    pub selected_token_id: Option<i64>,
    pub selected_token_name: Option<String>,
    pub access_token_expires_at: Option<i64>,
}

// ── 使用日志模型 ──

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageLogItem {
    pub id: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub user_id: i64,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub token_name: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub prompt_tokens: i64,
    #[serde(default)]
    pub completion_tokens: i64,
    #[serde(default)]
    pub use_time: i64,
    #[serde(default)]
    pub is_stream: bool,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub channel_id: Option<i64>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub log_type: Option<i32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageLogsResponse {
    pub items: Vec<UsageLogItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageLogQueryParams {
    pub p: Option<i64>,
    pub page_size: Option<i64>,
    pub token_name: Option<String>,
    pub model_name: Option<String>,
    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,
    pub log_type: Option<i32>,
    pub username: Option<String>,
    pub all: Option<bool>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStatData {
    pub quota: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub request_count: i64,
    pub avg_use_time: f64,
}

// ── 模型与定价模型 ──

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PricingModelItem {
    pub model_name: String,
    #[serde(default)]
    pub vendor_id: Option<i64>,
    #[serde(default)]
    pub quota_type: i32,
    #[serde(default)]
    pub model_ratio: f64,
    #[serde(default)]
    pub model_price: f64,
    #[serde(default)]
    pub owner_by: String,
    #[serde(default)]
    pub completion_ratio: f64,
    #[serde(default)]
    pub cache_ratio: Option<f64>,
    #[serde(default)]
    pub create_cache_ratio: Option<f64>,
    #[serde(default)]
    pub enable_groups: Vec<String>,
    #[serde(default)]
    pub supported_endpoint_types: Vec<String>,
    #[serde(default)]
    pub billing_mode: Option<String>,
    #[serde(default)]
    pub billing_expr: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VendorInfo {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub icon: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PricingResponse {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub pricing_version: String,
    #[serde(default)]
    pub svip_group_ratio: HashMap<String, f64>,
    #[serde(default)]
    pub data: Vec<PricingModelItem>,
    #[serde(default)]
    pub group_ratio: HashMap<String, f64>,
    #[serde(default)]
    pub usable_group: HashMap<String, String>,
    #[serde(default)]
    pub vendors: Vec<VendorInfo>,
    #[serde(default)]
    pub auto_groups: Vec<String>,
    #[serde(default)]
    pub user_group: Option<String>,
    #[serde(default)]
    pub user_available_groups: Vec<String>,
}

// ── 服务端通用响应包装 ──

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    pub success: bool,
    #[serde(default)]
    pub message: String,
    pub data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct ApiRawTokenKeyData {
    pub key: String,
}

fn parse_api_response_body<T: serde::de::DeserializeOwned>(
    status: reqwest::StatusCode,
    text: &str,
    action_name: &str,
) -> Result<ApiResponse<T>, String> {
    let trimmed = text.trim();
    if trimmed.starts_with('<') {
        return Err(format!(
            "{action_name}遇到网络拦截 (收到 HTML 页面，HTTP {})，请检查网络或开启代理 / VPN 的 TUN 模式重试",
            status.as_u16()
        ));
    }

    if !status.is_success() {
        if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(msg) = err_val.get("message").and_then(|m| m.as_str()) {
                if !msg.is_empty() {
                    return Err(msg.to_string());
                }
            }
        }
        return Err(format!(
            "{action_name}异常 (HTTP {}): {}",
            status.as_u16(),
            trimmed.chars().take(120).collect::<String>()
        ));
    }

    serde_json::from_str::<ApiResponse<T>>(trimmed).map_err(|e| {
        format!("解析{action_name}响应数据失败: {e} (若处于受限网络请检查代理设置或开启 TUN 模式)")
    })
}

// ── 内部认证状态管理器 ──

pub struct AuthManager {
    client: Client,
    cookie_jar: Arc<Jar>,
    access_token: Option<String>,
    access_expires_at: i64,
    current_user: Option<UserInfo>,
    session_sid: Option<String>,
    selected_token_id: Option<i64>,
    selected_token_name: Option<String>,
}

impl AuthManager {
    pub fn new() -> Self {
        let cookie_jar = Arc::new(Jar::default());
        let mut builder = Client::builder()
            .cookie_provider(cookie_jar.clone())
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .no_proxy();

        let proxy = reqwest::Proxy::custom(|_url| {
            if let Some(proxy_str) = crate::updater::get_cached_upstream_proxy_url() {
                Url::parse(&proxy_str).ok()
            } else {
                None
            }
        });
        builder = builder.proxy(proxy);

        let client = builder
            .build()
            .expect("Failed to build reqwest client for auth");

        let mut mgr = Self {
            client,
            cookie_jar,
            access_token: None,
            access_expires_at: 0,
            current_user: None,
            session_sid: None,
            selected_token_id: None,
            selected_token_name: None,
        };

        // 尝试从本地恢复凭据
        mgr.load_persisted_session();
        mgr
    }

    fn storage_path() -> PathBuf {
        let dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".ai-helper");
        let _ = fs::create_dir_all(&dir);
        dir.join("auth_session.json")
    }

    fn load_persisted_session(&mut self) {
        let path = Self::storage_path();
        if !path.exists() {
            return;
        }

        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(storage) = serde_json::from_str::<AuthSessionStorage>(&data) {
                self.current_user = storage.user;
                self.session_sid = storage.session_sid;
                self.selected_token_id = storage.selected_token_id;
                self.selected_token_name = storage.selected_token_name;

                // 若有 Refresh Cookie，注入到 CookieJar 中
                if let Some(cookie) = storage.refresh_cookie {
                    if let Ok(url) = Url::parse(&format!("{}/api/user/auth", BASE_URL)) {
                        self.cookie_jar.add_cookie_str(&cookie, &url);
                    }
                }
            }
        }
    }

    fn persist_session(&self, refresh_cookie: Option<&str>) {
        let path = Self::storage_path();
        let existing = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str::<AuthSessionStorage>(&s).ok())
                .unwrap_or_default()
        } else {
            AuthSessionStorage::default()
        };

        let storage = AuthSessionStorage {
            user: self.current_user.clone(),
            refresh_cookie: refresh_cookie
                .map(|s| s.to_string())
                .or(existing.refresh_cookie),
            session_sid: self.session_sid.clone(),
            selected_token_id: self.selected_token_id,
            selected_token_name: self.selected_token_name.clone(),
        };

        if let Ok(json_str) = serde_json::to_string_pretty(&storage) {
            let _ = fs::write(&path, json_str);
        }
    }

    fn clear_persisted_session(&mut self) {
        self.access_token = None;
        self.access_expires_at = 0;
        self.current_user = None;
        self.session_sid = None;
        let path = Self::storage_path();
        let _ = fs::remove_file(path);
    }

    pub fn get_state(&self) -> CurrentAuthState {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let is_logged_in = self.current_user.is_some() && self.access_token.is_some();

        CurrentAuthState {
            is_logged_in,
            user: self.current_user.clone(),
            selected_token_id: self.selected_token_id,
            selected_token_name: self.selected_token_name.clone(),
            access_token_expires_at: if self.access_expires_at > now {
                Some(self.access_expires_at)
            } else {
                None
            },
        }
    }

    #[allow(dead_code)]
    fn has_persisted_refresh_cookie(&self) -> bool {
        let path = Self::storage_path();
        if let Ok(data) = fs::read_to_string(path) {
            if let Ok(storage) = serde_json::from_str::<AuthSessionStorage>(&data) {
                return storage.refresh_cookie.is_some();
            }
        }
        false
    }

    pub fn set_selected_token(&mut self, token_id: Option<i64>, token_name: Option<String>) {
        self.selected_token_id = token_id;
        self.selected_token_name = token_name;
        self.persist_session(None);
    }
}

// ── 全局 AuthManager 单例 ──

static AUTH_MGR: once_cell::sync::Lazy<Mutex<AuthManager>> =
    once_cell::sync::Lazy::new(|| Mutex::new(AuthManager::new()));

// ── 接口实现 ──

/// 获取站点基本状态（密码登录开关、验证码配置等）
pub async fn get_site_status() -> Result<SiteStatus, String> {
    let mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/status", BASE_URL);
    let resp = mgr
        .client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(ORIGIN, AUTH_ORIGIN)
        .send()
        .await
        .map_err(|e| format!("请求站点状态失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取站点状态响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取站点状态")?;

    let data = parsed
        .data
        .ok_or_else(|| "站点状态未包含 data 字段".to_string())?;

    Ok(SiteStatus {
        password_login_enabled: data
            .get("password_login_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        password_login_encryption_enabled: data
            .get("password_login_encryption_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        captcha_enabled: data
            .get("captcha_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        captcha_type: data
            .get("captcha_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        slide_captcha_check: data
            .get("slide_captcha_check")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// 获取密码加密公钥
pub async fn get_encryption_key() -> Result<EncryptionKeyData, String> {
    let mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/user/login/encryption-key", BASE_URL);
    let resp = mgr
        .client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(ORIGIN, AUTH_ORIGIN)
        .send()
        .await
        .map_err(|e| format!("获取加密公钥失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取加密公钥响应失败: {e}"))?;

    let parsed: ApiResponse<EncryptionKeyData> =
        parse_api_response_body(status, &text, "获取加密公钥")?;

    if !parsed.success {
        return Err(format!("服务端拒绝提供加密公钥: {}", parsed.message));
    }

    parsed.data.ok_or_else(|| "返回公钥数据为空".to_string())
}

/// 获取 GO 滑块图片与挑战 ID
pub async fn generate_captcha() -> Result<CaptchaGenerateData, String> {
    let mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/captcha/generate", BASE_URL);
    let resp = mgr
        .client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(ORIGIN, AUTH_ORIGIN)
        .send()
        .await
        .map_err(|e| format!("获取滑块验证码失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取滑块响应内容失败: {e}"))?;

    let parsed: ApiResponse<CaptchaGenerateData> =
        parse_api_response_body(status, &text, "获取滑块验证码")?;

    if !parsed.success {
        return Err(format!("生成滑块失败: {}", parsed.message));
    }

    parsed.data.ok_or_else(|| "滑块挑战数据为空".to_string())
}

/// 提交滑块校验（成功后会将 new_api_slide_captcha 写入统一 CookieJar）
pub async fn verify_captcha(captcha_id: String, x: i32, y: i32) -> Result<(), String> {
    let mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/captcha/verify", BASE_URL);

    let body = serde_json::json!({
        "captcha_id": captcha_id,
        "x": x,
        "y": y,
    });

    let resp = mgr
        .client
        .post(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(ORIGIN, AUTH_ORIGIN)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("滑块校验网络请求失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取滑块校验结果失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "滑块校验")?;

    if !status.is_success() || !parsed.success {
        let msg = if parsed.message.is_empty() {
            "滑块验证未通过，请重试".to_string()
        } else {
            parsed.message
        };
        return Err(msg);
    }

    Ok(())
}

/// 提交账号密码登录
pub async fn login(payload: LoginPayload) -> Result<LoginResult, String> {
    let mut mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/user/login", BASE_URL);

    let mut body = serde_json::Map::new();
    body.insert("username".to_string(), serde_json::json!(payload.username));

    if let Some(enc_pwd) = payload.password_encrypted {
        body.insert("password_encrypted".to_string(), serde_json::json!(enc_pwd));
        if let Some(kid) = payload.encryption_key_id {
            body.insert("encryption_key_id".to_string(), serde_json::json!(kid));
        }
    } else if let Some(pwd) = payload.password {
        body.insert("password".to_string(), serde_json::json!(pwd));
    } else {
        return Err("必须提供密码或加密密码".to_string());
    }

    let resp = mgr
        .client
        .post(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(ORIGIN, AUTH_ORIGIN)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("登录请求异常: {e}"))?;

    let status = resp.status();

    // 提取可能的 Set-Cookie: new_api_refresh
    let mut extracted_refresh_cookie: Option<String> = None;
    for cookie in resp.cookies() {
        if cookie.name() == "new_api_refresh" {
            extracted_refresh_cookie = Some(format!(
                "new_api_refresh={}; Path=/api/user/auth; HttpOnly; Secure; SameSite=Strict",
                cookie.value()
            ));
            break;
        }
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取登录响应返回失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "账号登录")?;

    if !status.is_success() || !parsed.success {
        return Err(if parsed.message.is_empty() {
            format!("登录失败，状态码: {}", status)
        } else {
            parsed.message
        });
    }

    let data = parsed
        .data
        .ok_or_else(|| "登录响应中缺少 data 字段".to_string())?;

    // 检查是否需要 2FA
    if data
        .get("require_2fa")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let flow_token = data
            .get("flow_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let expires_at = data.get("expires_at").and_then(|v| v.as_i64()).unwrap_or(0);
        return Ok(LoginResult::Require2Fa(TwoFaRequirement {
            require_2fa: true,
            flow_token,
            expires_at,
        }));
    }

    // 完整登录成功
    let success_data = parse_login_success_data(&data)?;
    mgr.access_token = Some(success_data.access_token.clone());
    mgr.access_expires_at = success_data.access_expires_at;
    mgr.current_user = Some(success_data.user.clone());
    mgr.session_sid = success_data.session_sid.clone();
    mgr.persist_session(extracted_refresh_cookie.as_deref());

    Ok(LoginResult::Success(success_data))
}

/// 提交 2FA 动态码
pub async fn login_2fa(flow_token: String, code: String) -> Result<LoginSuccessData, String> {
    let mut mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/user/login/2fa", BASE_URL);

    let body = serde_json::json!({
        "flow_token": flow_token,
        "code": code.trim(),
    });

    let resp = mgr
        .client
        .post(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(ORIGIN, AUTH_ORIGIN)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("2FA 验证请求异常: {e}"))?;

    let mut extracted_refresh_cookie: Option<String> = None;
    for cookie in resp.cookies() {
        if cookie.name() == "new_api_refresh" {
            extracted_refresh_cookie = Some(format!(
                "new_api_refresh={}; Path=/api/user/auth; HttpOnly; Secure; SameSite=Strict",
                cookie.value()
            ));
            break;
        }
    }

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 2FA 响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "2FA 验证")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "2FA 验证码错误".to_string()
        } else {
            parsed.message
        });
    }

    let data = parsed
        .data
        .ok_or_else(|| "2FA 成功但未返回数据".to_string())?;
    let success_data = parse_login_success_data(&data)?;

    mgr.access_token = Some(success_data.access_token.clone());
    mgr.access_expires_at = success_data.access_expires_at;
    mgr.current_user = Some(success_data.user.clone());
    mgr.session_sid = success_data.session_sid.clone();
    mgr.persist_session(extracted_refresh_cookie.as_deref());

    Ok(success_data)
}

fn parse_login_success_data(data: &serde_json::Value) -> Result<LoginSuccessData, String> {
    let access_token = data
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "未返回 access_token".to_string())?
        .to_string();

    let access_expires_at = data
        .get("access_expires_at")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let user_val = data
        .get("user")
        .ok_or_else(|| "未返回 user 字段".to_string())?;

    let role = user_val
        .get("role")
        .and_then(|v| v.as_i64())
        .map(|r| r as i32);

    let email = user_val
        .get("email")
        .or_else(|| user_val.get("mail"))
        .or_else(|| data.get("email"))
        .or_else(|| data.get("mail"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let user = UserInfo {
        id: user_val
            .get("id")
            .and_then(|v| v.as_i64())
            .unwrap_or_default(),
        username: user_val
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        display_name: user_val
            .get("display_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        role,
        email,
    };

    let session_sid = data
        .get("session")
        .and_then(|v| v.get("sid"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(LoginSuccessData {
        user,
        access_token,
        access_expires_at,
        session_sid,
    })
}

/// 刷新当前登录凭据
pub async fn refresh_session() -> Result<LoginSuccessData, String> {
    let mut mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/user/auth/refresh", BASE_URL);

    let mut req = mgr
        .client
        .post(&url)
        .header(ORIGIN, AUTH_ORIGIN)
        .header(CONTENT_TYPE, "application/json");

    if let Some(sid) = &mgr.session_sid {
        req = req.header("X-Auth-Session", sid);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return Err(format!("刷新会话网络请求异常: {e}"));
        }
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        mgr.clear_persisted_session();
        return Err("登录状态已过期，请重新登录".to_string());
    }

    let mut extracted_refresh_cookie: Option<String> = None;
    for cookie in resp.cookies() {
        if cookie.name() == "new_api_refresh" {
            extracted_refresh_cookie = Some(format!(
                "new_api_refresh={}; Path=/api/user/auth; HttpOnly; Secure; SameSite=Strict",
                cookie.value()
            ));
            break;
        }
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            mgr.clear_persisted_session();
            return Err(format!("读取会话刷新响应失败: {e}"));
        }
    };

    let parsed: ApiResponse<serde_json::Value> =
        match parse_api_response_body(status, &text, "刷新会话") {
            Ok(p) => p,
            Err(e) => {
                mgr.clear_persisted_session();
                return Err(e);
            }
        };

    if !status.is_success() || !parsed.success {
        mgr.clear_persisted_session();
        return Err("登录状态已失效，请重新登录".to_string());
    }

    let data = match parsed.data {
        Some(d) => d,
        None => {
            mgr.clear_persisted_session();
            return Err("刷新会话返回数据为空".to_string());
        }
    };

    let success_data = match parse_login_success_data(&data) {
        Ok(d) => d,
        Err(e) => {
            mgr.clear_persisted_session();
            return Err(e);
        }
    };

    mgr.access_token = Some(success_data.access_token.clone());
    mgr.access_expires_at = success_data.access_expires_at;
    mgr.current_user = Some(success_data.user.clone());
    mgr.session_sid = success_data.session_sid.clone();
    mgr.persist_session(extracted_refresh_cookie.as_deref());

    Ok(success_data)
}

/// 确保拥有可用的 access_token
async fn ensure_access_token() -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // 先在只读锁下判断
    {
        let mgr = AUTH_MGR.lock().await;
        if let Some(token) = &mgr.access_token {
            if mgr.access_expires_at > now + 30 {
                return Ok(token.clone());
            }
        }
    }

    // 需要刷新
    let refreshed = refresh_session()
        .await
        .map_err(|_| "登录状态已失效，请重新登录".to_string())?;
    Ok(refreshed.access_token)
}

/// 退出登录
pub async fn logout() -> Result<(), String> {
    let mut mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/user/auth/logout", BASE_URL);

    let mut req = mgr.client.post(&url).header(ORIGIN, AUTH_ORIGIN);

    if let Some(token) = &mgr.access_token {
        req = req.header(AUTHORIZATION, format!("Bearer {}", token));
    }
    if let Some(sid) = &mgr.session_sid {
        req = req.header("X-Auth-Session", sid);
    }

    let _ = req.send().await;
    mgr.clear_persisted_session();
    Ok(())
}

/// 获取当前登录态
pub async fn get_auth_state() -> CurrentAuthState {
    let mgr = AUTH_MGR.lock().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let token_expired = mgr.access_token.is_none() || mgr.access_expires_at <= now;

    // 如果 access_token 已经过期但有 refresh cookie，尝试在后台恢复一次
    if mgr.current_user.is_some() && token_expired && mgr.has_persisted_refresh_cookie() {
        drop(mgr);
        let res = refresh_session().await;
        let mut mgr = AUTH_MGR.lock().await;
        if res.is_err() {
            mgr.clear_persisted_session();
        }
        return mgr.get_state();
    }

    mgr.get_state()
}

/// 切换当前选中的 API Key 记录
pub async fn set_selected_token(token_id: Option<i64>, token_name: Option<String>) {
    let mut mgr = AUTH_MGR.lock().await;
    mgr.set_selected_token(token_id, token_name);
}

// ── 令牌管理接口（关键：获取用户在 bob-api 创建的 API Key 列表） ──

/// 获取用户在 https://bob-api.com 创建的 API Key 列表
pub async fn get_user_tokens(all: Option<bool>) -> Result<Vec<TokenItem>, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let is_all = all.unwrap_or(false);
    // 优先调用 search 接口获取完整列表，若为全部则追加 all=true
    let url = if is_all {
        format!(
            "{}/api/token/search?keyword=&p=1&size=100&all=true",
            BASE_URL
        )
    } else {
        format!("{}/api/token/search?keyword=&p=1&size=100", BASE_URL)
    };
    let resp = mgr
        .client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("获取 API Key 列表失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 API Key 列表响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取 API Key 列表")?;

    if !parsed.success {
        let msg = if parsed.message.is_empty() {
            "获取令牌列表失败".to_string()
        } else {
            parsed.message
        };
        return Err(msg);
    }

    let data = parsed
        .data
        .ok_or_else(|| "响应数据中无 data 字段".to_string())?;

    // 兼容 data 为数组或 data.items 为数组
    let items_val = if let Some(items) = data.get("items") {
        items
    } else if data.is_array() {
        &data
    } else {
        return Ok(vec![]);
    };

    let items: Vec<TokenItem> = serde_json::from_value(items_val.clone())
        .map_err(|e| format!("反序列化令牌列表失败: {e}"))?;

    Ok(items)
}

/// 获取某个 Token 的真实明文 API Key (调用 POST /api/token/:id/key)
pub async fn get_token_key(token_id: i64) -> Result<String, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let url = format!("{}/api/token/{}/key", BASE_URL, token_id);
    let resp = mgr
        .client
        .post(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("读取明文 API Key 失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取明文 API Key 响应失败: {e}"))?;

    let parsed: ApiResponse<ApiRawTokenKeyData> =
        parse_api_response_body(status, &text, "读取明文 API Key")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "无法读取该 API Key 的明文，可能已被禁用或删除".to_string()
        } else {
            parsed.message
        });
    }

    let key_data = parsed.data.ok_or_else(|| "返回数据为空".to_string())?;

    let mut key = key_data.key.trim().to_string();
    if !key.starts_with("sk-") {
        key = format!("sk-{}", key);
    }

    Ok(key)
}

/// 快速在 bob-api 创建一个新的普通令牌（可选指定分组）
pub async fn create_user_token(name: String, group: Option<String>) -> Result<TokenItem, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let target_group = group.unwrap_or_default().trim().to_string();
    let url = format!("{}/api/token/", BASE_URL);
    let body = serde_json::json!({
        "name": name.trim(),
        "expired_time": -1,
        "remain_quota": 0,
        "unlimited_quota": true,
        "model_limits_enabled": false,
        "model_limits": "",
        "allow_ips": "",
        "group": target_group,
        "auto_groups": [],
        "cross_group_retry": false,
        "fallback_groups": []
    });

    let resp = mgr
        .client
        .post(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("创建新令牌网络异常: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取创建令牌响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "创建新令牌")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "创建令牌失败".to_string()
        } else {
            parsed.message
        });
    }

    drop(mgr);

    // 重新检索该名称的令牌
    let tokens = get_user_tokens(None).await?;
    tokens
        .into_iter()
        .find(|t| t.name == name)
        .ok_or_else(|| "令牌创建成功，但刷新列表时未找到刚创建的记录".to_string())
}

/// 更新已有 API Key 的所属分组 (调用 PUT /api/token/)
pub async fn update_user_token_group(
    token_id: i64,
    new_group: String,
) -> Result<TokenItem, String> {
    let clean_group = new_group.trim().to_string();
    if clean_group.is_empty() {
        return Err("分组名称不能为空".to_string());
    }

    let token = ensure_access_token().await?;
    let client = {
        let mgr = AUTH_MGR.lock().await;
        mgr.client.clone()
    };

    // 1. 尝试通过 GET /api/token/:id 获取完整原有 Token 信息，确保保留原参数
    let get_url = format!("{}/api/token/{}", BASE_URL, token_id);
    let mut put_body = None;

    if let Ok(resp) = client
        .get(&get_url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
    {
        let status = resp.status();
        if let Ok(text) = resp.text().await {
            if let Ok(parsed) =
                parse_api_response_body::<serde_json::Value>(status, &text, "读取原令牌信息")
            {
                if parsed.success {
                    if let Some(mut data_obj) = parsed.data {
                        if data_obj.is_object() {
                            data_obj["group"] = serde_json::json!(clean_group);
                            put_body = Some(data_obj);
                        }
                    }
                }
            }
        }
    }

    // 2. 如果 GET /api/token/:id 未取到，回退从 get_user_tokens 检索原有基础信息
    let body = if let Some(b) = put_body {
        b
    } else {
        let tokens = get_user_tokens(None).await?;
        let orig = tokens
            .into_iter()
            .find(|t| t.id == token_id)
            .ok_or_else(|| format!("未找到 ID 为 {} 的 API Key", token_id))?;

        serde_json::json!({
            "id": orig.id,
            "name": orig.name,
            "expired_time": orig.expired_time,
            "remain_quota": orig.remain_quota,
            "unlimited_quota": orig.unlimited_quota,
            "model_limits_enabled": false,
            "model_limits": "",
            "allow_ips": "",
            "group": clean_group,
            "auto_groups": [],
            "cross_group_retry": false,
            "fallback_groups": []
        })
    };

    let put_url = format!("{}/api/token/", BASE_URL);
    let resp = client
        .put(&put_url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("更新令牌分组网络异常: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取更新令牌响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "更新令牌分组")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "更新分组失败，可能您的账号无权使用该分组".to_string()
        } else {
            parsed.message
        });
    }

    // 重新检索更新后的令牌列表并返回
    let tokens = get_user_tokens(None).await?;
    let updated = tokens
        .into_iter()
        .find(|t| t.id == token_id)
        .ok_or_else(|| "分组更新成功，但刷新列表时未找到该令牌".to_string())?;

    Ok(updated)
}

/// 一键将 API Key 批量写入指定的 Agent 配置文件中
pub async fn apply_api_key_to_agents(
    api_key: String,
    targets: Vec<String>,
) -> Result<HashMap<String, bool>, String> {
    let mut results = HashMap::new();

    for target in targets {
        match target.as_str() {
            "codex" | "chatgpt" => {
                // 读取当前已有配置
                let cur = crate::codex::get_codex_config().ok();
                let url = cur
                    .as_ref()
                    .map(|c| c.base_url.clone())
                    .unwrap_or_else(|| "https://bob-api.com/".to_string());
                let model = cur.as_ref().map(|c| c.model.clone());
                match crate::codex::set_codex_config(url, api_key.clone(), model) {
                    Ok(_) => {
                        results.insert("chatgpt".to_string(), true);
                    }
                    Err(e) => {
                        error!("应用 Key 到 Codex 失败: {e}");
                        results.insert("chatgpt".to_string(), false);
                    }
                }
            }
            "claude" => {
                let cur = crate::claude::get_claude_config().ok();
                let url = cur
                    .as_ref()
                    .map(|c| c.base_url.clone())
                    .unwrap_or_else(|| "https://bob-api.com/".to_string());
                let model = cur.as_ref().map(|c| c.model.clone());
                match crate::claude::set_claude_config(url, api_key.clone(), model) {
                    Ok(_) => {
                        results.insert("claude".to_string(), true);
                    }
                    Err(e) => {
                        error!("应用 Key 到 Claude 失败: {e}");
                        results.insert("claude".to_string(), false);
                    }
                }
            }
            "workbuddy" => {
                let cur = crate::workbuddy::get_workbuddy_config().ok();
                let url = cur
                    .as_ref()
                    .map(|c| c.base_url.clone())
                    .unwrap_or_else(|| "https://bob-api.com/v1".to_string());
                let model = cur
                    .as_ref()
                    .map(|c| c.model.clone())
                    .unwrap_or_else(|| "gpt-5.6-sol".to_string());
                let payload = crate::workbuddy::WorkbuddySavePayload {
                    url,
                    api_key: api_key.clone(),
                    model,
                    supports_tool_call: true,
                    supports_images: true,
                    supports_reasoning: true,
                    only_reasoning: false,
                    can_disable_thinking: false,
                    use_custom_protocol: false,
                    default_effort: None,
                    supported_efforts: vec![],
                    max_input_tokens: None,
                    max_output_tokens: None,
                };
                match crate::workbuddy::set_workbuddy_config(payload) {
                    Ok(_) => {
                        results.insert("workbuddy".to_string(), true);
                    }
                    Err(e) => {
                        error!("应用 Key 到 WorkBuddy 失败: {e}");
                        results.insert("workbuddy".to_string(), false);
                    }
                }
            }
            "accio" | "acciowork" => {
                let cur = crate::accio::config::load_accio_config();
                let config = crate::accio::config::AccioConfig {
                    base_url: if cur.base_url.is_empty() {
                        "https://bob-api.com/".to_string()
                    } else {
                        cur.base_url
                    },
                    api_key: api_key.clone(),
                    model: cur.model,
                    bridge_port: cur.bridge_port,
                    official_gateway: cur.official_gateway,
                    fallback_official: cur.fallback_official,
                    prevent_official_leak: cur.prevent_official_leak,
                    auto_start_bridge: cur.auto_start_bridge,
                    cached_models: Vec::new(),
                    cached_models_fingerprint: String::new(),
                };
                crate::accio::invalidate_model_list_cache();
                match crate::accio::config::save_accio_config(&config) {
                    Ok(_) => {
                        if crate::accio::is_bridge_running() {
                            tauri::async_runtime::spawn(async {
                                crate::accio::refresh_model_list_cache().await;
                            });
                        }
                        results.insert("acciowork".to_string(), true);
                    }
                    Err(e) => {
                        error!("应用 Key 到 AccioWork 失败: {e}");
                        results.insert("acciowork".to_string(), false);
                    }
                }
            }
            _ => {}
        }
    }

    Ok(results)
}

/// 获取 Bob API 分组实时健康与稳定性监控概览 (GET /api/channel/monitor/group-overview?hours=N)
pub async fn get_channel_group_overview(
    hours: Option<u32>,
) -> Result<Vec<ChannelGroupOverview>, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let h = hours.unwrap_or(1);
    let url = format!(
        "{}/api/channel/monitor/group-overview?hours={}",
        BASE_URL, h
    );
    let resp = mgr
        .client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("请求分组监控数据网络异常: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取分组监控数据响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取分组监控数据")?;

    if !parsed.success {
        let msg = if parsed.message.is_empty() {
            "获取分组监控数据失败".to_string()
        } else {
            parsed.message
        };
        return Err(msg);
    }

    let data_val = parsed
        .data
        .ok_or_else(|| "分组监控数据中无 data 字段".to_string())?;

    let items: Vec<ChannelGroupOverview> =
        serde_json::from_value(data_val).map_err(|e| format!("反序列化分组监控列表失败: {e}"))?;

    Ok(items)
}

/// 获取用户在 bob-api 的钱包与额度余额信息 (调用 GET /api/user/self)
pub async fn get_user_wallet() -> Result<UserWalletInfo, String> {
    let mut token = ensure_access_token().await?;
    let url = format!("{}/api/user/self", BASE_URL);

    let mut resp = {
        let mgr = AUTH_MGR.lock().await;
        mgr.client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("获取账号额度网络异常: {e}"))?
    };

    // 若 access_token 在服务端已失效 (401)，自动刷新一次会话凭据重试
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Ok(refreshed) = refresh_session().await {
            token = refreshed.access_token;
            let mgr = AUTH_MGR.lock().await;
            if let Ok(retry_resp) = mgr
                .client
                .get(&url)
                .header(AUTHORIZATION, format!("Bearer {}", token))
                .send()
                .await
            {
                resp = retry_resp;
            }
        } else {
            let mut mgr = AUTH_MGR.lock().await;
            mgr.clear_persisted_session();
            return Err("登录状态已过期，请重新登录".to_string());
        }
    }

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取账号额度响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取账号额度")?;

    if !parsed.success {
        let msg = if parsed.message.is_empty() {
            "获取账号额度失败".to_string()
        } else {
            parsed.message
        };
        return Err(msg);
    }

    let data = parsed
        .data
        .ok_or_else(|| "响应数据中缺少 data 字段".to_string())?;

    let quota = data.get("quota").and_then(|v| v.as_i64()).unwrap_or(0);
    let used_quota = data.get("used_quota").and_then(|v| v.as_i64()).unwrap_or(0);
    let request_count = data
        .get("request_count")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let group = data
        .get("group")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 同步提取并更新当前用户的 role 角色（管理员 role >= 10）以及 email 邮箱
    let role = data.get("role").and_then(|v| v.as_i64()).map(|r| r as i32);
    let email = data
        .get("email")
        .or_else(|| data.get("mail"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if role.is_some() || email.is_some() {
        let mut mgr = AUTH_MGR.lock().await;
        if let Some(ref mut u) = mgr.current_user {
            if let Some(r) = role {
                u.role = Some(r);
            }
            if let Some(em) = email {
                u.email = Some(em);
            }
        }
        mgr.persist_session(None);
    }

    let quota_per_unit: i64 = 500000;
    let rmb_to_usd_rate: f64 = 4.0; // 充值比例 1￥ = 4$

    let quota_usd = quota as f64 / quota_per_unit as f64;
    let quota_cny = quota_usd / rmb_to_usd_rate;

    let used_quota_usd = used_quota as f64 / quota_per_unit as f64;
    let used_quota_cny = used_quota_usd / rmb_to_usd_rate;

    Ok(UserWalletInfo {
        quota,
        used_quota,
        quota_usd,
        quota_cny,
        used_quota_usd,
        used_quota_cny,
        request_count,
        group,
        quota_per_unit,
        rmb_to_usd_rate,
    })
}

/// 删除指定 API Key (调用 DELETE /api/token/:id)
#[allow(dead_code)]
pub async fn delete_user_token(token_id: i64) -> Result<(), String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let url = format!("{}/api/token/{}", BASE_URL, token_id);
    let resp = mgr
        .client
        .delete(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("删除令牌网络异常: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取删除令牌响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "删除令牌")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "删除令牌失败".to_string()
        } else {
            parsed.message
        });
    }

    Ok(())
}

/// 快速更新指定 API Key 状态 (1: 启用, 2: 禁用 - 调用 PUT /api/token/?status_only=true)
#[allow(dead_code)]
pub async fn update_user_token_status(token_id: i64, status: i32) -> Result<(), String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let url = format!("{}/api/token/?status_only=true", BASE_URL);
    let body = serde_json::json!({
        "id": token_id,
        "status": status,
    });

    let resp = mgr
        .client
        .put(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("更新令牌状态网络异常: {e}"))?;

    let status_code = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取更新状态响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status_code, &text, "更新令牌状态")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "更新令牌状态失败".to_string()
        } else {
            parsed.message
        });
    }

    Ok(())
}

/// 获取令牌可选的自动分组列表 (GET /api/token/auto-groups)
#[allow(dead_code)]
pub async fn get_token_auto_groups() -> Result<Vec<String>, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let url = format!("{}/api/token/auto-groups", BASE_URL);
    let resp = mgr
        .client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("获取分组信息失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取分组信息失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取令牌可选分组")?;

    if !parsed.success {
        return Ok(vec![]);
    }

    let data = parsed.data.unwrap_or_default();
    if let Some(arr) = data.as_array() {
        let groups: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        return Ok(groups);
    }

    Ok(vec![])
}

/// 获取已登录用户拥有的可用渠道分组列表 (GET /api/user/self/groups)
#[allow(dead_code)]
pub async fn get_user_available_groups() -> Result<Vec<String>, String> {
    let token = match ensure_access_token().await {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };
    let mgr = AUTH_MGR.lock().await;

    let url = format!("{}/api/user/self/groups", BASE_URL);
    let resp = match mgr
        .client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };

    let status = resp.status();
    let text = match resp.text().await {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };

    let parsed: ApiResponse<serde_json::Value> =
        match parse_api_response_body(status, &text, "获取用户可用分组") {
            Ok(p) => p,
            Err(_) => return Ok(vec![]),
        };

    if !parsed.success {
        return Ok(vec![]);
    }

    let data = parsed.data.unwrap_or_default();
    if let Some(arr) = data.as_array() {
        let groups: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        return Ok(groups);
    } else if let Some(obj) = data.as_object() {
        let groups: Vec<String> = obj.keys().cloned().collect();
        return Ok(groups);
    }

    Ok(vec![])
}

/// 获取用户个人调用与消费日志明细 (GET /api/log/self)
#[allow(dead_code)]
pub async fn get_user_usage_logs(params: UsageLogQueryParams) -> Result<UsageLogsResponse, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let p = params.p.unwrap_or(1);
    let size = params.page_size.unwrap_or(20);

    let mut query_params: Vec<(String, String)> = vec![
        ("p".to_string(), p.to_string()),
        ("page_size".to_string(), size.to_string()),
    ];

    if let Some(tn) = &params.token_name {
        if !tn.trim().is_empty() {
            query_params.push(("token_name".to_string(), tn.trim().to_string()));
        }
    }
    if let Some(mn) = &params.model_name {
        if !mn.trim().is_empty() {
            query_params.push(("model_name".to_string(), mn.trim().to_string()));
        }
    }
    if let Some(start) = params.start_timestamp {
        if start > 0 {
            query_params.push(("start_timestamp".to_string(), start.to_string()));
        }
    }
    if let Some(end) = params.end_timestamp {
        if end > 0 {
            query_params.push(("end_timestamp".to_string(), end.to_string()));
        }
    }
    if let Some(lt) = params.log_type {
        query_params.push(("type".to_string(), lt.to_string()));
    }
    if let Some(un) = &params.username {
        if !un.trim().is_empty() {
            query_params.push(("username".to_string(), un.trim().to_string()));
        }
    }

    let is_all = params.all.unwrap_or(false);
    let url = if is_all {
        format!("{}/api/log/", BASE_URL)
    } else {
        format!("{}/api/log/self", BASE_URL)
    };
    let resp = mgr
        .client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .query(&query_params)
        .send()
        .await
        .map_err(|e| format!("请求使用日志网络失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取使用日志响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取使用日志")?;

    if !parsed.success {
        let msg = if parsed.message.is_empty() {
            "获取使用日志失败".to_string()
        } else {
            parsed.message
        };
        return Err(msg);
    }

    let data = parsed
        .data
        .ok_or_else(|| "使用日志响应中无 data".to_string())?;

    let mut items: Vec<UsageLogItem> = Vec::new();
    let mut total: i64 = 0;

    if let Some(arr) = data.as_array() {
        items = serde_json::from_value(serde_json::Value::Array(arr.clone())).unwrap_or_default();
        total = items.len() as i64;
    } else if let Some(items_val) = data.get("items").or_else(|| data.get("data")) {
        if let Some(arr) = items_val.as_array() {
            items =
                serde_json::from_value(serde_json::Value::Array(arr.clone())).unwrap_or_default();
        }
        total = data
            .get("total")
            .and_then(|v| v.as_i64())
            .unwrap_or(items.len() as i64);
    }

    Ok(UsageLogsResponse {
        items,
        total,
        page: p,
        page_size: size,
    })
}

/// 获取用户调用与消费统计数据 (GET /api/log/self/stat 或管理员 GET /api/log/stat)
#[allow(dead_code)]
pub async fn get_user_usage_stat(params: UsageLogQueryParams) -> Result<UsageStatData, String> {
    let token = ensure_access_token().await?;
    let mgr = AUTH_MGR.lock().await;

    let mut query_params: Vec<(String, String)> = Vec::new();

    if let Some(tn) = &params.token_name {
        if !tn.trim().is_empty() {
            query_params.push(("token_name".to_string(), tn.trim().to_string()));
        }
    }
    if let Some(mn) = &params.model_name {
        if !mn.trim().is_empty() {
            query_params.push(("model_name".to_string(), mn.trim().to_string()));
        }
    }
    if let Some(start) = params.start_timestamp {
        if start > 0 {
            query_params.push(("start_timestamp".to_string(), start.to_string()));
        }
    }
    if let Some(end) = params.end_timestamp {
        if end > 0 {
            query_params.push(("end_timestamp".to_string(), end.to_string()));
        }
    }
    if let Some(lt) = params.log_type {
        query_params.push(("type".to_string(), lt.to_string()));
    }
    if let Some(un) = &params.username {
        if !un.trim().is_empty() {
            query_params.push(("username".to_string(), un.trim().to_string()));
        }
    }

    let is_all = params.all.unwrap_or(false);
    let url = if is_all {
        format!("{}/api/log/stat", BASE_URL)
    } else {
        format!("{}/api/log/self/stat", BASE_URL)
    };
    let resp = mgr
        .client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .query(&query_params)
        .send()
        .await
        .map_err(|e| format!("请求日志统计数据网络失败: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取日志统计响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "获取日志统计")?;

    if !parsed.success {
        return Ok(UsageStatData::default());
    }

    let data = parsed.data.unwrap_or_default();
    let quota = data.get("quota").and_then(|v| v.as_i64()).unwrap_or(0);
    let prompt_tokens = data
        .get("prompt_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let completion_tokens = data
        .get("completion_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let request_count = data
        .get("request_count")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let avg_use_time = data
        .get("avg_use_time")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    Ok(UsageStatData {
        quota,
        prompt_tokens,
        completion_tokens,
        request_count,
        avg_use_time,
    })
}

/// 获取模型与价格数据（支持包含分组倍率、厂商列表等，已登录时附带当前用户的实际分组）
#[allow(dead_code)]
pub async fn get_pricing_data() -> Result<PricingResponse, String> {
    let user_token = ensure_access_token().await.ok();
    let client = {
        let mgr = AUTH_MGR.lock().await;
        mgr.client.clone()
    };

    let url = format!("{}/api/pricing", BASE_URL);
    let mut req = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(token) = &user_token {
        req = req.header(AUTHORIZATION, format!("Bearer {}", token));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求模型与价格数据失败: {e}"))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取模型与价格响应失败: {e}"))?;

    let mut parsed: PricingResponse =
        serde_json::from_str(&text).map_err(|e| format!("解析模型与价格响应数据失败: {e}"))?;

    // 如果用户已登录，获取当前用户主分组与可用分组
    if user_token.is_some() {
        if let Ok(wallet) = get_user_wallet().await {
            parsed.user_group = wallet.group;
        }
        if let Ok(groups) = get_user_available_groups().await {
            parsed.user_available_groups = groups;
        }
    }

    Ok(parsed)
}

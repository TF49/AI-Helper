use crate::error::AppError;
use crate::secret_storage::CredentialPurpose;
use log::error;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, ORIGIN};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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
    #[serde(default)]
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
    pub remain_quota: Option<i64>,
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
    #[serde(default)]
    pub session_generation: Option<String>,
    #[serde(default)]
    pub storage_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentAuthState {
    pub is_logged_in: bool,
    pub user: Option<UserInfo>,
    pub selected_token_id: Option<i64>,
    pub selected_token_name: Option<String>,
    pub access_token_expires_at: Option<i64>,
    pub session_restore_error: Option<String>,
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
    pub quota: Option<i64>,
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
    pub quota: Option<i64>,
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

#[derive(Clone)]
struct SessionStore {
    path: PathBuf,
}

#[derive(Clone, Copy)]
enum SessionWrite {
    ExplicitLogin(SessionRevision),
    Existing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SessionRevision {
    session: Option<[u8; 32]>,
    marker: Option<[u8; 32]>,
}

#[derive(Serialize, Deserialize)]
struct LogoutMarker {
    reason: String,
    revision: String,
}

impl SessionStore {
    fn marker_path(&self) -> PathBuf {
        self.path.with_file_name("auth_logout.marker")
    }

    fn backup_path(&self) -> PathBuf {
        self.path.with_extension("json.bak")
    }

    // These helpers are only called while holding the session file lock. The
    // marker deliberately shares that lock, rather than having its own lock.
    fn read_optional_locked(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                #[cfg(windows)]
                let is_link = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0
                };
                #[cfg(not(windows))]
                let is_link = metadata.file_type().is_symlink();
                if is_link || !metadata.is_file() {
                    return Err(AppError::Other("会话存储不是普通文件".into()));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        Ok(Some(fs::read(path)?))
    }

    fn read_locked(&self) -> Result<Option<AuthSessionStorage>, AppError> {
        Self::read_optional_locked(&self.path)?
            .map(|bytes| {
                serde_json::from_slice(&bytes)
                    .map_err(|_| AppError::Other("会话文件已损坏，请重新登录".into()))
            })
            .transpose()
    }

    fn blocked_locked(&self) -> Result<bool, AppError> {
        Ok(Self::read_optional_locked(&self.marker_path())?.is_some())
    }

    fn revision_locked(&self) -> Result<SessionRevision, AppError> {
        fn digest(bytes: Vec<u8>) -> [u8; 32] {
            Sha256::digest(bytes).into()
        }
        Ok(SessionRevision {
            session: Self::read_optional_locked(&self.path)?.map(digest),
            marker: Self::read_optional_locked(&self.marker_path())?.map(digest),
        })
    }

    fn revision(&self) -> Result<SessionRevision, AppError> {
        crate::safe_fs::with_file_lock(&self.path, || self.revision_locked())
    }

    fn remove_optional_locked(path: &Path) -> Result<(), AppError> {
        crate::safe_fs::remove_file_locked(path)
    }

    fn delete_references(storage: &AuthSessionStorage) {
        for (purpose, value) in [
            (CredentialPurpose::SessionId, storage.session_sid.as_deref()),
            (
                CredentialPurpose::RefreshCookie,
                storage.refresh_cookie.as_deref(),
            ),
        ] {
            if let Some(value) = value {
                if let Err(error) = crate::secret_storage::delete_secret_for(purpose, value) {
                    log::warn!("清理系统凭据条目失败: {error}");
                }
            }
        }
    }

    fn protect(storage: &AuthSessionStorage) -> Result<AuthSessionStorage, AppError> {
        let mut protected = storage.clone();
        protected.session_sid = storage
            .session_sid
            .as_deref()
            .map(|value| {
                crate::secret_storage::protect_secret_for(CredentialPurpose::SessionId, value)
            })
            .transpose()?;
        protected.refresh_cookie = match storage
            .refresh_cookie
            .as_deref()
            .map(|value| {
                crate::secret_storage::protect_secret_for(CredentialPurpose::RefreshCookie, value)
            })
            .transpose()
        {
            Ok(value) => value,
            Err(error) => {
                // A new platform entry may already exist for the first field.
                protected.refresh_cookie = None;
                Self::delete_references(&protected);
                return Err(error);
            }
        };
        Ok(protected)
    }

    fn unprotect(storage: &AuthSessionStorage) -> Result<AuthSessionStorage, AppError> {
        let mut plain = storage.clone();
        plain.session_sid = storage
            .session_sid
            .as_deref()
            .map(|value| {
                crate::secret_storage::unprotect_secret_for(CredentialPurpose::SessionId, value)
                    .map(|(value, _)| value)
            })
            .transpose()?;
        plain.refresh_cookie = storage
            .refresh_cookie
            .as_deref()
            .map(|value| {
                crate::secret_storage::unprotect_secret_for(CredentialPurpose::RefreshCookie, value)
                    .map(|(value, _)| value)
            })
            .transpose()?;
        if plain.user.is_none()
            || (plain.session_sid.as_deref().unwrap_or("").is_empty()
                && plain.refresh_cookie.as_deref().unwrap_or("").is_empty())
        {
            return Err(AppError::Other("会话凭据不完整，请重新登录".into()));
        }
        Ok(plain)
    }

    fn new_generation() -> Result<String, AppError> {
        let mut bytes = [0u8; 16];
        getrandom::getrandom(&mut bytes)
            .map_err(|error| AppError::Other(format!("生成会话代次失败: {error}")))?;
        Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }

    fn same_session(left: &AuthSessionStorage, right: &AuthSessionStorage) -> bool {
        left.session_generation == right.session_generation
            && left.user.as_ref().map(|user| user.id) == right.user.as_ref().map(|user| user.id)
    }

    fn write_verified_locked(&self, plain: &AuthSessionStorage) -> Result<(), AppError> {
        let protected = Self::protect(plain)?;
        let staging = self.path.with_extension("json.pending");
        let mut committed = false;
        let result = (|| {
            let bytes = serde_json::to_vec_pretty(&protected)
                .map_err(|_| AppError::Other("序列化会话失败".into()))?;
            // Verify a protected staging file first, preserving the sole old
            // copy if the platform service or the new write cannot be read back.
            crate::safe_fs::atomic_write_locked(&staging, &bytes)?;
            let staged_bytes = Self::read_optional_locked(&staging)?
                .ok_or_else(|| AppError::Other("安全会话暂存文件丢失".into()))?;
            let staged: AuthSessionStorage = serde_json::from_slice(&staged_bytes)
                .map_err(|_| AppError::Other("安全会话暂存文件已损坏".into()))?;
            let verified = Self::unprotect(&staged)?;
            if serde_json::to_value(&verified).ok() != serde_json::to_value(plain).ok() {
                return Err(AppError::Other("会话安全存储暂存验证失败".into()));
            }
            match crate::safe_fs::atomic_write_locked(&self.path, &bytes) {
                Ok(()) => committed = true,
                Err(error) => {
                    committed = error.file_was_committed(&self.path);
                    return Err(error);
                }
            }
            let stored = self
                .read_locked()?
                .ok_or_else(|| AppError::Other("会话写入后丢失".into()))?;
            // Verify both the durable file and the platform-protected entries.
            let actual = Self::unprotect(&stored)?;
            if serde_json::to_value(&actual).ok() != serde_json::to_value(plain).ok() {
                return Err(AppError::Other("会话安全存储读回验证失败".into()));
            }
            Ok(())
        })();
        let staging_cleanup = Self::remove_optional_locked(&staging);
        if result.is_err() && !committed {
            Self::delete_references(&protected);
        }
        result?;
        staging_cleanup
    }

    fn block_locked(&self) -> Result<(), AppError> {
        self.write_marker_locked("logged-out")
    }

    fn write_marker_locked(&self, reason: &str) -> Result<(), AppError> {
        let marker = LogoutMarker {
            reason: reason.to_owned(),
            revision: Self::new_generation()?,
        };
        crate::safe_fs::atomic_write_locked(&self.marker_path(), serde_json::to_vec(&marker)?)
    }

    fn quarantine_locked(&self) -> Result<(), AppError> {
        // Keep the only old credential for manual recovery when possible, but
        // persistently forbid automatic recovery until a successful login.
        if let Err(marker_error) = self.write_marker_locked("relogin-required") {
            Self::remove_optional_locked(&self.path).map_err(|delete_error| {
                AppError::Other(format!(
                    "无法阻断旧会话恢复: {marker_error}; 无法清理会话: {delete_error}"
                ))
            })?;
        }
        Ok(())
    }

    fn restore(&self) -> Result<Option<AuthSessionStorage>, AppError> {
        crate::safe_fs::with_file_lock(&self.path, || {
            if let Some(marker) = Self::read_optional_locked(&self.marker_path())? {
                if marker == b"relogin-required"
                    || serde_json::from_slice::<LogoutMarker>(&marker)
                        .is_ok_and(|marker| marker.reason == "relogin-required")
                {
                    return Err(AppError::Other("上次会话安全恢复未完成，请重新登录".into()));
                }
                return Ok(None);
            }
            let restored = (|| {
                let Some(previous) = self.read_locked()? else {
                    return Ok(None);
                };
                let mut plain = Self::unprotect(&previous)?;
                plain.session_generation = Some(Self::new_generation()?);
                plain.storage_revision = Some(Self::new_generation()?);
                // Even an already protected session must pass a fresh protected
                // write/read cycle before any credential enters the CookieJar.
                self.write_verified_locked(&plain)?;
                Self::delete_references(&previous);
                Self::remove_optional_locked(&self.backup_path())?;
                Ok(Some(plain))
            })();
            if let Err(error) = restored {
                self.quarantine_locked()?;
                return Err(error);
            }
            restored
        })
    }

    fn save(&self, storage: &AuthSessionStorage, mode: SessionWrite) -> Result<(), AppError> {
        crate::safe_fs::with_file_lock(&self.path, || {
            if let SessionWrite::ExplicitLogin(expected) = mode {
                if self.revision_locked()? != expected {
                    // A late password/2FA result is not a new login operation:
                    // leave the other process's session and marker untouched.
                    return Err(AppError::Other(
                        "会话状态已变化，已丢弃过期登录响应，请重试登录".into(),
                    ));
                }
            }
            let blocked = self.blocked_locked()?;
            let previous = match self.read_locked() {
                Ok(previous) => previous,
                Err(_) if matches!(mode, SessionWrite::ExplicitLogin(_)) => None,
                Err(error) => return Err(error),
            };
            if matches!(mode, SessionWrite::Existing)
                && (blocked
                    || !previous
                        .as_ref()
                        .is_some_and(|old| Self::same_session(old, storage)))
            {
                return Err(AppError::Other("会话已退出或已切换，请重新登录".into()));
            }
            let mut storage = storage.clone();
            storage.storage_revision = Some(Self::new_generation()?);
            if let Err(error) = self.write_verified_locked(&storage) {
                self.quarantine_locked()?;
                return Err(error);
            }
            if let Err(error) = Self::remove_optional_locked(&self.backup_path()) {
                self.quarantine_locked()?;
                return Err(error);
            }
            // A normal migration, refresh, or profile update never clears this.
            if matches!(mode, SessionWrite::ExplicitLogin(_)) {
                if let Err(error) = Self::remove_optional_locked(&self.marker_path()) {
                    self.quarantine_locked()?;
                    return Err(error);
                }
            }
            if let Some(previous) = previous {
                Self::delete_references(&previous);
            }
            Ok(())
        })
    }

    fn validate(&self, generation: Option<&str>, user_id: Option<i64>) -> Result<(), AppError> {
        crate::safe_fs::with_file_lock(&self.path, || {
            let current = self.read_locked()?;
            if self.blocked_locked()?
                || !current.as_ref().is_some_and(|current| {
                    current.session_generation.as_deref() == generation
                        && current.user.as_ref().map(|user| user.id) == user_id
                })
            {
                return Err(AppError::Other("会话已退出或已切换，请重新登录".into()));
            }
            Ok(())
        })
    }

    fn invalidate(&self, generation: Option<&str>, explicit: bool) -> Result<(), AppError> {
        crate::safe_fs::with_file_lock(&self.path, || {
            let previous = self.read_locked();
            if let Ok(Some(previous)) = &previous {
                if (!explicit || generation.is_some())
                    && previous.session_generation.as_deref() != generation
                {
                    return Ok(());
                }
            }
            // Attempt both steps even if one fails. Either durable blocking or
            // deletion stops recovery; surface any incomplete cleanup.
            let blocked = self.block_locked();
            let removed = Self::remove_optional_locked(&self.path);
            let backup_removed = Self::remove_optional_locked(&self.backup_path());
            if let Ok(Some(previous)) = previous {
                Self::delete_references(&previous);
            }
            blocked?;
            removed?;
            backup_removed?;
            Ok(())
        })
    }
}

pub struct AuthManager {
    client: Client,
    cookie_jar: Arc<Jar>,
    access_token: Option<String>,
    access_expires_at: i64,
    current_user: Option<UserInfo>,
    session_sid: Option<String>,
    selected_token_id: Option<i64>,
    selected_token_name: Option<String>,
    session_epoch: u64,
    auto_refresh_blocked: bool,
    storage: SessionStore,
    refresh_cookie: Option<String>,
    session_generation: Option<String>,
    session_restore_error: Option<String>,
    refresh_backoff: Option<(Instant, String)>,
    #[cfg(test)]
    _test_directory: Option<tempfile::TempDir>,
}

impl AuthManager {
    fn build_client(cookie_jar: Arc<Jar>) -> Result<Client, String> {
        #[cfg(not(test))]
        let proxy = reqwest::Proxy::custom(|_url| {
            crate::updater::get_cached_upstream_proxy_url()
                .and_then(|proxy| Url::parse(&proxy).ok())
        });
        let builder = Client::builder()
            .cookie_provider(cookie_jar)
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .redirect(crate::credential_policy::credentialed_redirect_policy())
            .no_proxy();
        #[cfg(not(test))]
        let builder = builder.proxy(proxy);
        builder
            .build()
            .map_err(|error| format!("创建认证客户端失败: {error}"))
    }

    pub fn new() -> Self {
        #[cfg(not(test))]
        let path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".ai-helper/auth_session.json");
        // No unit test, including callers outside this module, may touch HOME.
        #[cfg(test)]
        let directory = tempfile::tempdir().expect("isolated authentication test directory");
        #[cfg(test)]
        let path = directory.path().join("auth_session.json");
        let manager = Self::with_storage_path(path);
        #[cfg(test)]
        let manager = Self {
            _test_directory: Some(directory),
            ..manager
        };
        manager
    }

    fn with_storage_path(path: PathBuf) -> Self {
        let cookie_jar = Arc::new(Jar::default());
        let client = Self::build_client(cookie_jar.clone())
            .expect("Failed to build reqwest client for auth");
        let mut manager = Self {
            client,
            cookie_jar,
            access_token: None,
            access_expires_at: 0,
            current_user: None,
            session_sid: None,
            selected_token_id: None,
            selected_token_name: None,
            session_epoch: 0,
            auto_refresh_blocked: true,
            storage: SessionStore { path },
            refresh_cookie: None,
            session_generation: None,
            session_restore_error: None,
            refresh_backoff: None,
            #[cfg(test)]
            _test_directory: None,
        };
        manager.load_persisted_session();
        manager
    }

    fn install_cookie_jar(&mut self, refresh_cookie: Option<&str>) -> Result<(), String> {
        let jar = Arc::new(Jar::default());
        if let Some(cookie) = refresh_cookie {
            let url = Url::parse(&format!("{BASE_URL}/api/user/auth"))
                .map_err(|error| format!("认证地址无效: {error}"))?;
            jar.add_cookie_str(cookie, &url);
        }
        let client = Self::build_client(jar.clone())?;
        self.cookie_jar = jar;
        self.client = client;
        Ok(())
    }

    fn reset_memory(&mut self) {
        self.refresh_backoff = None;
        self.access_token = None;
        self.access_expires_at = 0;
        self.current_user = None;
        self.session_sid = None;
        self.refresh_cookie = None;
        self.selected_token_id = None;
        self.selected_token_name = None;
        self.session_generation = None;
        self.auto_refresh_blocked = true;
        self.session_epoch = self.session_epoch.wrapping_add(1);
        if let Err(error) = self.install_cookie_jar(None) {
            log::error!("清理认证 CookieJar 失败: {error}");
        }
    }

    fn load_persisted_session(&mut self) {
        self.reset_memory();
        match self.storage.restore() {
            Ok(Some(storage)) => {
                if let Err(error) = self.install_cookie_jar(storage.refresh_cookie.as_deref()) {
                    self.session_restore_error = Some(error);
                    return;
                }
                self.current_user = storage.user;
                self.session_sid = storage.session_sid;
                self.refresh_cookie = storage.refresh_cookie;
                self.selected_token_id = storage.selected_token_id;
                self.selected_token_name = storage.selected_token_name;
                self.session_generation = storage.session_generation;
                self.auto_refresh_blocked = false;
                self.session_restore_error = None;
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!("安全恢复会话失败，已禁止自动刷新: {error}");
                self.session_restore_error =
                    Some(format!("无法安全恢复本地会话，请重新登录: {error}"));
            }
        }
    }

    fn session_storage(&self, refresh_cookie: Option<&str>) -> AuthSessionStorage {
        AuthSessionStorage {
            user: self.current_user.clone(),
            refresh_cookie: refresh_cookie
                .map(str::to_owned)
                .or_else(|| self.refresh_cookie.clone()),
            session_sid: self.session_sid.clone(),
            selected_token_id: self.selected_token_id,
            selected_token_name: self.selected_token_name.clone(),
            session_generation: self.session_generation.clone(),
            storage_revision: None,
        }
    }

    fn persist_session(&self, refresh_cookie: Option<&str>) -> Result<(), String> {
        if self.auto_refresh_blocked {
            return Err("本地已退出，已禁止保存旧会话".into());
        }
        self.storage
            .save(
                &self.session_storage(refresh_cookie),
                SessionWrite::Existing,
            )
            .map_err(|error| error.to_string())
    }

    #[cfg(test)]
    fn complete_login(
        &mut self,
        data: &LoginSuccessData,
        refresh_cookie: Option<&str>,
    ) -> Result<(), String> {
        let revision = self.storage.revision().map_err(|error| error.to_string())?;
        self.complete_login_at_revision(data, refresh_cookie, revision)
    }

    fn complete_login_at_revision(
        &mut self,
        data: &LoginSuccessData,
        refresh_cookie: Option<&str>,
        revision: SessionRevision,
    ) -> Result<(), String> {
        let storage = AuthSessionStorage {
            user: Some(data.user.clone()),
            refresh_cookie: refresh_cookie.map(str::to_owned),
            session_sid: data.session_sid.clone(),
            selected_token_id: None,
            selected_token_name: None,
            session_generation: Some(
                SessionStore::new_generation().map_err(|error| error.to_string())?,
            ),
            storage_revision: None,
        };
        if let Err(error) = self
            .storage
            .save(&storage, SessionWrite::ExplicitLogin(revision))
        {
            self.reset_memory();
            // save() quarantines failures under the same file transaction. Do
            // not delete a replacement whose durability/readback is uncertain.
            let message = format!("无法安全保存登录会话，请重新登录: {error}");
            self.session_restore_error = Some(message.clone());
            return Err(message);
        }
        self.install_cookie_jar(refresh_cookie)?;
        self.session_epoch = self.session_epoch.wrapping_add(1);
        self.access_token = Some(data.access_token.clone());
        self.access_expires_at = data.access_expires_at;
        self.current_user = storage.user;
        self.session_sid = storage.session_sid;
        self.refresh_cookie = storage.refresh_cookie;
        self.selected_token_id = None;
        self.selected_token_name = None;
        self.session_generation = storage.session_generation;
        self.auto_refresh_blocked = false;
        self.session_restore_error = None;
        self.refresh_backoff = None;
        Ok(())
    }

    fn refresh_request(&self, url: &str) -> Result<reqwest::RequestBuilder, String> {
        self.validate_current_session()?;
        // A response may arrive after logout. Its Set-Cookie must belong to an
        // isolated Jar until the session generation has been checked again.
        let jar = Arc::new(Jar::default());
        if let Some(cookie) = &self.refresh_cookie {
            jar.add_cookie_str(
                cookie,
                &Url::parse(&format!("{BASE_URL}/api/user/auth")).unwrap(),
            );
        }
        let client = Self::build_client(jar)?;
        let mut request = client
            .post(url)
            .header(ORIGIN, AUTH_ORIGIN)
            .header(CONTENT_TYPE, "application/json");
        if let Some(sid) = &self.session_sid {
            request = request.header("X-Auth-Session", sid);
        }
        Ok(request)
    }

    fn isolated_login_client(&self, url: &str) -> Result<Client, String> {
        let url = Url::parse(url).map_err(|error| format!("认证地址无效: {error}"))?;
        Self::build_client(self.login_cookie_jar(&url)?)
    }

    fn login_cookie_jar(&self, url: &Url) -> Result<Arc<Jar>, String> {
        let jar = Arc::new(Jar::default());
        if let Some(cookies) = self.cookie_jar.cookies(url) {
            let cookies = cookies
                .to_str()
                .map_err(|_| "验证码 Cookie 格式无效".to_string())?;
            for cookie in cookies.split(';') {
                let Some((name, value)) = cookie.trim().split_once('=') else {
                    continue;
                };
                // Preserve CAPTCHA state while withholding old authentication.
                if name != "new_api_refresh" {
                    jar.add_cookie_str(&format!("{name}={value}; Path=/; Secure; HttpOnly"), url);
                }
            }
        }
        Ok(jar)
    }

    fn complete_refresh(
        &mut self,
        data: &LoginSuccessData,
        refresh_cookie: Option<&str>,
        expected_epoch: u64,
        expected_user_id: Option<i64>,
    ) -> Result<(), String> {
        if self.auto_refresh_blocked
            || self.session_epoch != expected_epoch
            || self.current_user.as_ref().map(|user| user.id) != expected_user_id
        {
            return Err("会话已切换，已丢弃过期刷新响应".into());
        }
        if expected_user_id != Some(data.user.id) {
            self.clear_persisted_session();
            return Err("刷新响应账号与当前会话不符，请重新登录".into());
        }
        let refresh_cookie = refresh_cookie
            .map(str::to_owned)
            .or_else(|| self.refresh_cookie.clone());
        let mut storage = self.session_storage(refresh_cookie.as_deref());
        storage.user = Some(data.user.clone());
        storage.session_sid = data.session_sid.clone();
        if let Err(error) = self.storage.save(&storage, SessionWrite::Existing) {
            self.reset_memory();
            let message = format!("无法安全保存刷新会话，请重新登录: {error}");
            self.session_restore_error = Some(message.clone());
            return Err(message);
        }
        self.install_cookie_jar(refresh_cookie.as_deref())?;
        self.access_token = Some(data.access_token.clone());
        self.access_expires_at = data.access_expires_at;
        self.current_user = storage.user;
        self.session_sid = storage.session_sid;
        self.refresh_cookie = refresh_cookie;
        Ok(())
    }

    fn clear_persisted_session(&mut self) {
        let generation = self.session_generation.clone();
        self.reset_memory();
        if let Err(error) = self.storage.invalidate(generation.as_deref(), false) {
            self.session_restore_error = Some(format!("本地会话清理未完成，请重新登录: {error}"));
            log::error!("清理失效会话失败: {error}");
        }
    }

    fn validate_current_session(&self) -> Result<(), String> {
        if self.auto_refresh_blocked {
            return Err("本地已退出，已禁止自动刷新旧会话".into());
        }
        self.storage
            .validate(
                self.session_generation.as_deref(),
                self.current_user.as_ref().map(|user| user.id),
            )
            .map_err(|error| error.to_string())
    }

    pub fn get_state(&self) -> CurrentAuthState {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let is_logged_in = self.current_user.is_some() && self.access_token.is_some();

        CurrentAuthState {
            is_logged_in,
            session_restore_error: self.session_restore_error.clone(),
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

    fn has_persisted_refresh_cookie(&self) -> bool {
        !self.auto_refresh_blocked && (self.refresh_cookie.is_some() || self.session_sid.is_some())
    }

    pub fn set_selected_token(
        &mut self,
        token_id: Option<i64>,
        token_name: Option<String>,
    ) -> Result<(), String> {
        let previous_id = self.selected_token_id;
        let previous_name = self.selected_token_name.clone();
        self.selected_token_id = token_id;
        self.selected_token_name = token_name;
        if let Err(error) = self.persist_session(None) {
            self.selected_token_id = previous_id;
            self.selected_token_name = previous_name;
            return Err(format!("保存选定 Token 状态失败: {error}"));
        }
        Ok(())
    }
}

// ── 全局 AuthManager 单例 ──

static AUTH_MGR: once_cell::sync::Lazy<Mutex<AuthManager>> =
    once_cell::sync::Lazy::new(|| Mutex::new(AuthManager::new()));
// Serialize refresh rotation without preventing logout or an explicit login.
static REFRESH_GATE: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
struct TokenListCacheKey {
    user_id: i64,
    session_epoch: u64,
    all: bool,
}

struct RequestCache<K, V> {
    revision: u64,
    entries: HashMap<K, (Instant, Result<V, String>)>,
}

impl<K: Eq + std::hash::Hash, V: Clone> RequestCache<K, V> {
    fn new() -> Self {
        Self {
            revision: 0,
            entries: HashMap::new(),
        }
    }

    fn get(&self, key: &K) -> Option<Result<V, String>> {
        self.entries
            .get(key)
            .filter(|(until, _)| *until > Instant::now())
            .map(|(_, result)| result.clone())
    }

    fn invalidate(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.entries.clear();
    }

    fn insert(&mut self, key: K, value: V, ttl: Duration) {
        self.revision = self.revision.wrapping_add(1);
        self.entries.retain(|_, (until, _)| *until > Instant::now());
        if self.entries.len() >= 256 {
            self.entries.clear();
        }
        self.entries.insert(key, (Instant::now() + ttl, Ok(value)));
    }
}

// A second cache check under the gate merges concurrent callers, including failures.
// A mutation during a read prevents that old response from repopulating the cache.
async fn cached_read<K, V, F, Fut>(
    cache: &Mutex<RequestCache<K, V>>,
    gate: &Mutex<()>,
    key: K,
    ttl: Duration,
    fetch: F,
) -> Result<V, String>
where
    K: Eq + std::hash::Hash + Clone,
    V: Clone,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<V, BobRequestError>>,
{
    if let Some(result) = cache.lock().await.get(&key) {
        return result;
    }
    let _request = gate.lock().await;
    let revision = {
        let cache = cache.lock().await;
        if let Some(result) = cache.get(&key) {
            return result;
        }
        cache.revision
    };
    let result = fetch().await;
    let rate_limited = matches!(&result, Err(error) if error.rate_limited);
    let result = result.map_err(|error| error.message);
    let mut cache = cache.lock().await;
    if cache.revision == revision {
        cache
            .entries
            .retain(|_, (until, _)| *until > Instant::now());
        if cache.entries.len() >= 256 {
            cache.entries.clear();
        }
        let ttl = match &result {
            Ok(_) => ttl,
            // Do not let a cached 429 outlive a short Retry-After cooldown.
            Err(_) if rate_limited => Duration::ZERO,
            Err(_) => Duration::from_secs(5),
        };
        cache
            .entries
            .insert(key, (Instant::now() + ttl, result.clone()));
    }
    result
}

type TokenKeyCache = RequestCache<(i64, u64, i64), String>;
type AutoTokenKey = (i64, u64, String);
type AutoTokenAttemptsMap = HashMap<AutoTokenKey, Instant>;
type AutoTokenReadyMap = HashMap<AutoTokenKey, (Instant, TokenItem)>;

static TOKEN_LIST_CACHE: once_cell::sync::Lazy<
    Mutex<RequestCache<TokenListCacheKey, Vec<TokenItem>>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(RequestCache::new()));
static TOKEN_LIST_GATE: Mutex<()> = Mutex::const_new(());
static TOKEN_KEY_CACHE: once_cell::sync::Lazy<Mutex<TokenKeyCache>> =
    once_cell::sync::Lazy::new(|| Mutex::new(RequestCache::new()));
static TOKEN_KEY_GATE: Mutex<()> = Mutex::const_new(());
static AUTO_TOKEN_ENSURE_GATE: Mutex<()> = Mutex::const_new(());
// Ambiguous automatic POSTs must be reconciled before another creation.
static AUTO_TOKEN_ATTEMPTS: once_cell::sync::Lazy<Mutex<AutoTokenAttemptsMap>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));
static AUTO_TOKEN_READY: once_cell::sync::Lazy<Mutex<AutoTokenReadyMap>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));
static BOB_RATE_LIMIT: Mutex<Option<Instant>> = Mutex::const_new(None);
static BOB_REQUEST_GATE: Mutex<()> = Mutex::const_new(());
// Auth recovery and public login must not be held behind a cooldown caused by
// unrelated account/token APIs.
static BOB_AUTH_RATE_LIMIT: Mutex<Option<Instant>> = Mutex::const_new(None);
static BOB_AUTH_REQUEST_GATE: Mutex<()> = Mutex::const_new(());
static BOB_CAPTCHA_RATE_LIMIT: Mutex<Option<Instant>> = Mutex::const_new(None);
static BOB_CAPTCHA_REQUEST_GATE: Mutex<()> = Mutex::const_new(());
static BOB_LOGIN_RATE_LIMIT: Mutex<Option<Instant>> = Mutex::const_new(None);
static BOB_LOGIN_REQUEST_GATE: Mutex<()> = Mutex::const_new(());
static BOB_REFRESH_RATE_LIMIT: Mutex<Option<Instant>> = Mutex::const_new(None);
static BOB_REFRESH_REQUEST_GATE: Mutex<()> = Mutex::const_new(());
static BOB_LOGOUT_REQUEST_GATE: Mutex<()> = Mutex::const_new(());

async fn invalidate_token_caches() {
    TOKEN_LIST_CACHE.lock().await.invalidate();
    TOKEN_KEY_CACHE.lock().await.invalidate();
    AUTO_TOKEN_READY.lock().await.clear();
}

async fn cache_auto_token_ready(user_id: i64, epoch: u64, group: &str, token: &TokenItem) {
    let mut ready = AUTO_TOKEN_READY.lock().await;
    ready.retain(|_, (until, _)| *until > Instant::now());
    if ready.len() >= 128 {
        ready.clear();
    }
    ready.insert(
        (user_id, epoch, group.to_ascii_lowercase()),
        (Instant::now() + Duration::from_secs(5), token.clone()),
    );
}

async fn clear_auto_token_attempt(user_id: i64, epoch: u64, group: &str) {
    AUTO_TOKEN_ATTEMPTS
        .lock()
        .await
        .remove(&(user_id, epoch, group.to_ascii_lowercase()));
}

async fn remember_ensured_token(
    user_id: i64,
    epoch: u64,
    existing: &[TokenItem],
    token: &TokenItem,
) {
    let mut tokens = existing.to_vec();
    if !tokens.iter().any(|item| item.id == token.id) {
        let mut summary = token.clone();
        // Keep the bulk list cache free of newly revealed plaintext.
        summary.key.clear();
        tokens.push(summary);
    }
    let mut lists = TOKEN_LIST_CACHE.lock().await;
    // `existing` came from all=true. Do not seed the default list from it:
    // that endpoint may intentionally omit disabled/expired tokens.
    lists.insert(
        TokenListCacheKey {
            user_id,
            session_epoch: epoch,
            all: true,
        },
        tokens,
        Duration::from_secs(20),
    );
    TOKEN_KEY_CACHE.lock().await.insert(
        (user_id, epoch, token.id),
        token.key.clone(),
        Duration::from_secs(60),
    );
}

async fn check_rate_limit(cooldown: &Mutex<Option<Instant>>) -> Result<(), String> {
    if let Some(until) = *cooldown.lock().await {
        if until > Instant::now() {
            return Err(format!(
                "Bob API 请求受限 (HTTP 429)，请在 {} 秒后重试",
                until.saturating_duration_since(Instant::now()).as_secs() + 1
            ));
        }
    }
    Ok(())
}

fn retry_after_duration(headers: &reqwest::header::HeaderMap) -> Duration {
    let seconds = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value.parse::<u64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(value)
                    .ok()
                    .map(|date| (date.timestamp() - chrono::Utc::now().timestamp()).max(1) as u64)
            })
        })
        .unwrap_or(30);
    Duration::from_secs(seconds.clamp(1, 3600))
}

async fn observe_rate_limit(response: &reqwest::Response, cooldown: &Mutex<Option<Instant>>) {
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let until = Instant::now() + retry_after_duration(response.headers());
        let mut cooldown = cooldown.lock().await;
        *cooldown = Some(cooldown.map_or(until, |previous| previous.max(until)));
    }
}

/// A Bob API failure classified for callers that must not infer the cause
/// from message text.
#[derive(Debug, Clone)]
struct BobRequestError {
    message: String,
    /// HTTP 429, or the local cooldown that an earlier 429 started.
    rate_limited: bool,
    /// The request never left this process (local cooldown, request build or
    /// connection failure), so a non-idempotent POST cannot have taken effect.
    not_sent: bool,
}

impl BobRequestError {
    fn not_sent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            rate_limited: false,
            not_sent: true,
        }
    }

    fn local_cooldown(message: String) -> Self {
        Self {
            message,
            rate_limited: true,
            not_sent: true,
        }
    }

    fn from_status(status: reqwest::StatusCode, mut message: String) -> Self {
        let rate_limited = status == reqwest::StatusCode::TOO_MANY_REQUESTS;
        // The server's own 429 text varies; keep a stable marker for the UI,
        // which only sees the message string.
        if rate_limited && !message.contains("429") {
            message.push_str("（HTTP 429）");
        }
        Self {
            message,
            rate_limited,
            not_sent: false,
        }
    }

    fn with_context(mut self, context: &str) -> Self {
        self.message = format!("{context}: {}", self.message);
        self
    }
}

impl From<String> for BobRequestError {
    fn from(message: String) -> Self {
        Self {
            message,
            rate_limited: false,
            not_sent: false,
        }
    }
}

// Account/token data requests share one cooldown and in-flight gate. Never
// retry non-idempotent requests automatically after a timeout or rate limit.
async fn send_bob_request(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    send_bob_request_classified(request)
        .await
        .map_err(|error| error.message)
}

async fn send_bob_request_classified(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, BobRequestError> {
    let _request = BOB_REQUEST_GATE.lock().await;
    check_rate_limit(&BOB_RATE_LIMIT)
        .await
        .map_err(BobRequestError::local_cooldown)?;
    let response = request.send().await.map_err(|error| BobRequestError {
        // A build or connect failure happens before any request byte reaches
        // the server; everything else (timeouts, resets) is ambiguous.
        not_sent: error.is_builder() || error.is_connect(),
        rate_limited: false,
        message: error.to_string(),
    })?;
    observe_rate_limit(&response, &BOB_RATE_LIMIT).await;
    Ok(response)
}

async fn send_bob_auth_request(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let _request = BOB_AUTH_REQUEST_GATE.lock().await;
    check_rate_limit(&BOB_AUTH_RATE_LIMIT).await?;
    let response = request.send().await.map_err(|error| error.to_string())?;
    observe_rate_limit(&response, &BOB_AUTH_RATE_LIMIT).await;
    Ok(response)
}

async fn send_bob_captcha_request(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let _request = BOB_CAPTCHA_REQUEST_GATE.lock().await;
    check_rate_limit(&BOB_CAPTCHA_RATE_LIMIT).await?;
    let response = request.send().await.map_err(|error| error.to_string())?;
    observe_rate_limit(&response, &BOB_CAPTCHA_RATE_LIMIT).await;
    Ok(response)
}

async fn send_bob_login_request(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let _request = BOB_LOGIN_REQUEST_GATE.lock().await;
    check_rate_limit(&BOB_LOGIN_RATE_LIMIT).await?;
    let response = request.send().await.map_err(|error| error.to_string())?;
    observe_rate_limit(&response, &BOB_LOGIN_RATE_LIMIT).await;
    Ok(response)
}

async fn send_bob_refresh_request(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let _request = BOB_REFRESH_REQUEST_GATE.lock().await;
    check_rate_limit(&BOB_REFRESH_RATE_LIMIT).await?;
    let response = request.send().await.map_err(|error| error.to_string())?;
    observe_rate_limit(&response, &BOB_REFRESH_RATE_LIMIT).await;
    Ok(response)
}

// Local logout is already committed before this request. Always attempt remote
// revocation even if another auth endpoint has recently received HTTP 429.
async fn send_bob_logout_request(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let _request = BOB_LOGOUT_REQUEST_GATE.lock().await;
    request.send().await.map_err(|error| error.to_string())
}

async fn token_request_context() -> Result<(String, Client, i64, u64), String> {
    ensure_access_token().await?;
    let manager = AUTH_MGR.lock().await;
    manager.validate_current_session()?;
    Ok((
        manager.access_token.clone().ok_or("未登录")?,
        manager.client.clone(),
        manager.current_user.as_ref().ok_or("未登录")?.id,
        manager.session_epoch,
    ))
}

async fn validate_token_context(user_id: i64, epoch: u64) -> Result<(), String> {
    let manager = AUTH_MGR.lock().await;
    manager.validate_current_session()?;
    if manager.session_epoch != epoch
        || manager.current_user.as_ref().map(|u| u.id) != Some(user_id)
    {
        return Err("账号已切换，已丢弃旧令牌请求".into());
    }
    Ok(())
}

// ── 接口实现 ──

/// 获取站点基本状态（密码登录开关、验证码配置等）
pub async fn get_site_status() -> Result<SiteStatus, String> {
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/status", BASE_URL);
    let resp = send_bob_auth_request(
        client
            .get(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(ORIGIN, AUTH_ORIGIN),
    )
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
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/user/login/encryption-key", BASE_URL);
    let resp = send_bob_auth_request(
        client
            .get(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(ORIGIN, AUTH_ORIGIN),
    )
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
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/captcha/generate", BASE_URL);
    let resp = send_bob_captcha_request(
        client
            .get(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(ORIGIN, AUTH_ORIGIN),
    )
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
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/captcha/verify", BASE_URL);

    let body = serde_json::json!({
        "captcha_id": captcha_id,
        "x": x,
        "y": y,
    });

    let resp = send_bob_captcha_request(
        client
            .post(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(ORIGIN, AUTH_ORIGIN)
            .json(&body),
    )
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
    let url = format!("{}/api/user/login", BASE_URL);
    let (client, epoch, revision) = {
        let manager = AUTH_MGR.lock().await;
        (
            manager.isolated_login_client(&url)?,
            manager.session_epoch,
            manager
                .storage
                .revision()
                .map_err(|error| error.to_string())?,
        )
    };

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

    let resp = send_bob_login_request(
        client
            .post(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(ORIGIN, AUTH_ORIGIN)
            .json(&body),
    )
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
    let mut mgr = AUTH_MGR.lock().await;
    if mgr.session_epoch != epoch {
        return Err("会话已切换，已丢弃过期登录响应".into());
    }
    mgr.complete_login_at_revision(&success_data, extracted_refresh_cookie.as_deref(), revision)?;

    Ok(LoginResult::Success(success_data))
}

/// 提交 2FA 动态码
pub async fn login_2fa(flow_token: String, code: String) -> Result<LoginSuccessData, String> {
    let url = format!("{}/api/user/login/2fa", BASE_URL);
    let (client, epoch, revision) = {
        let manager = AUTH_MGR.lock().await;
        (
            manager.isolated_login_client(&url)?,
            manager.session_epoch,
            manager
                .storage
                .revision()
                .map_err(|error| error.to_string())?,
        )
    };

    let body = serde_json::json!({
        "flow_token": flow_token,
        "code": code.trim(),
    });

    let resp = send_bob_login_request(
        client
            .post(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(ORIGIN, AUTH_ORIGIN)
            .json(&body),
    )
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

    let mut mgr = AUTH_MGR.lock().await;
    if mgr.session_epoch != epoch {
        return Err("会话已切换，已丢弃过期登录响应".into());
    }
    mgr.complete_login_at_revision(&success_data, extracted_refresh_cookie.as_deref(), revision)?;

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

#[derive(Debug)]
enum RefreshFailure {
    Retryable(String),
    RateLimited(String, Duration),
    Expired(String),
}

async fn fetch_refreshed_session(
    request: reqwest::RequestBuilder,
) -> Result<(LoginSuccessData, Option<String>), RefreshFailure> {
    let response = send_bob_refresh_request(request)
        .await
        .map_err(|error| RefreshFailure::Retryable(format!("刷新会话网络请求异常: {error}")))?;
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(RefreshFailure::RateLimited(
            "会话刷新受限 (HTTP 429)，请稍后重试".into(),
            retry_after_duration(response.headers()),
        ));
    }
    if status.is_server_error() {
        return Err(RefreshFailure::Retryable(format!(
            "会话刷新服务暂时不可用 (HTTP {})",
            status.as_u16()
        )));
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(RefreshFailure::Expired("登录状态已过期，请重新登录".into()));
    }
    let refresh_cookie = response
        .cookies()
        .find(|cookie| cookie.name() == "new_api_refresh")
        .map(|cookie| {
            format!(
                "new_api_refresh={}; Path=/api/user/auth; HttpOnly; Secure; SameSite=Strict",
                cookie.value()
            )
        });
    let text = response
        .text()
        .await
        .map_err(|error| RefreshFailure::Retryable(format!("读取会话刷新响应失败: {error}")))?;
    let data = parse_refreshed_session_body(status, &text)?;
    Ok((data, refresh_cookie))
}

fn parse_refreshed_session_body(
    status: reqwest::StatusCode,
    text: &str,
) -> Result<LoginSuccessData, RefreshFailure> {
    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, text, "刷新会话").map_err(RefreshFailure::Retryable)?;
    if !status.is_success() {
        return Err(RefreshFailure::Retryable(format!(
            "会话刷新返回意外状态 (HTTP {})",
            status.as_u16()
        )));
    }
    if !parsed.success {
        // A 2xx application error is not enough evidence that the refresh
        // credential is revoked; the service may be temporarily unhealthy.
        let message = if parsed.message.is_empty() {
            "会话刷新暂未成功".to_string()
        } else {
            format!("会话刷新暂未成功: {}", parsed.message)
        };
        return Err(RefreshFailure::Retryable(message));
    }
    let data = parsed
        .data
        .ok_or_else(|| RefreshFailure::Retryable("刷新会话响应缺少数据".into()))?;
    parse_login_success_data(&data)
        .map_err(|error| RefreshFailure::Retryable(format!("刷新会话响应格式无效: {error}")))
}

/// 刷新当前登录凭据
pub async fn refresh_session() -> Result<LoginSuccessData, String> {
    refresh_session_after_rejection(None).await
}

async fn refresh_session_after_rejection(
    rejected_token: Option<&str>,
) -> Result<LoginSuccessData, String> {
    let expected_epoch = AUTH_MGR.lock().await.session_epoch;
    let _refresh = REFRESH_GATE.lock().await;
    let (request, epoch, user_id) = {
        let mut manager = AUTH_MGR.lock().await;
        manager.validate_current_session()?;
        if manager.session_epoch != expected_epoch {
            return Err("会话已切换，已取消旧刷新请求".into());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        // Waiting callers reuse the newly issued token, including concurrent 401s.
        if let (Some(user), Some(access_token)) =
            (manager.current_user.clone(), manager.access_token.clone())
        {
            if manager.access_expires_at > now + 30 && rejected_token != Some(access_token.as_str())
            {
                return Ok(LoginSuccessData {
                    user,
                    access_token,
                    access_expires_at: manager.access_expires_at,
                    session_sid: manager.session_sid.clone(),
                });
            }
        }
        if let Some((until, error)) = &manager.refresh_backoff {
            if *until > Instant::now() {
                return Err(error.clone());
            }
        }
        check_rate_limit(&BOB_REFRESH_RATE_LIMIT).await?;
        let url = format!("{BASE_URL}/api/user/auth/refresh");
        let request = match manager.refresh_request(&url) {
            Ok(request) => request,
            Err(error) => {
                let message = format!("准备刷新会话失败: {error}");
                manager.refresh_backoff =
                    Some((Instant::now() + Duration::from_secs(5), message.clone()));
                return Err(message);
            }
        };
        (
            request,
            manager.session_epoch,
            manager.current_user.as_ref().map(|user| user.id),
        )
    };
    let response = fetch_refreshed_session(request).await;
    let mut manager = AUTH_MGR.lock().await;
    if manager.auto_refresh_blocked
        || manager.session_epoch != epoch
        || manager.current_user.as_ref().map(|user| user.id) != user_id
    {
        return Err("会话已切换，已丢弃过期刷新响应".into());
    }
    match response {
        Ok((data, refresh_cookie)) => {
            manager.complete_refresh(&data, refresh_cookie.as_deref(), epoch, user_id)?;
            manager.refresh_backoff = None;
            Ok(data)
        }
        Err(RefreshFailure::Expired(error)) => {
            manager.clear_persisted_session();
            Err(error)
        }
        Err(RefreshFailure::Retryable(error)) => {
            manager.refresh_backoff =
                Some((Instant::now() + Duration::from_secs(5), error.clone()));
            Err(error)
        }
        Err(RefreshFailure::RateLimited(error, delay)) => {
            manager.refresh_backoff = Some((Instant::now() + delay, error.clone()));
            let until = Instant::now() + delay;
            let mut cooldown = BOB_REFRESH_RATE_LIMIT.lock().await;
            *cooldown = Some(cooldown.map_or(until, |previous| previous.max(until)));
            Err(error)
        }
    }
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
        mgr.validate_current_session()?;
        if let Some(token) = &mgr.access_token {
            if mgr.access_expires_at > now + 30 {
                return Ok(token.clone());
            }
        }
    }

    // 需要刷新
    let refreshed = refresh_session().await?;
    Ok(refreshed.access_token)
}

/// 退出登录
pub async fn logout() -> Result<(), String> {
    let mut mgr = AUTH_MGR.lock().await;
    let url = format!("{}/api/user/auth/logout", BASE_URL);
    let mut request = mgr.client.post(&url).header(ORIGIN, AUTH_ORIGIN);
    if let Some(token) = &mgr.access_token {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    if let Some(sid) = &mgr.session_sid {
        request = request.header("X-Auth-Session", sid);
    }

    // Clear local credentials before waiting for the network. The old request
    // owns the old client/Jar, so its response cannot repopulate the new Jar.
    let generation = mgr.session_generation.clone();
    mgr.reset_memory();
    let local_result = mgr.storage.invalidate(generation.as_deref(), true);
    if let Err(error) = &local_result {
        mgr.session_restore_error = Some(format!("本地退出未完成: {error}"));
    }
    drop(mgr);
    invalidate_token_caches().await;
    let remote_result = send_bob_logout_request(request).await;
    local_result.map_err(|error| format!("本地退出未完成: {error}"))?;
    match remote_result {
        Ok(response) if response.status().is_success() => Ok(()),
        Ok(_) => Err("本地已退出；远程会话吊销未确认".into()),
        Err(_) => Err("本地已退出；网络不可用，远程会话吊销未确认".into()),
    }
}

pub async fn get_auth_state() -> CurrentAuthState {
    let mut mgr = AUTH_MGR.lock().await;
    if !mgr.auto_refresh_blocked {
        if let Err(error) = mgr.validate_current_session() {
            mgr.reset_memory();
            mgr.session_restore_error = Some(error);
        }
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let token_expired = mgr.access_token.is_none() || mgr.access_expires_at <= now;

    if mgr.auto_refresh_blocked {
        return mgr.get_state();
    }

    // 如果 access_token 已经过期但有 refresh cookie，尝试在后台恢复一次
    if mgr.current_user.is_some() && token_expired && mgr.has_persisted_refresh_cookie() {
        drop(mgr);
        let _ = refresh_session().await;
        let mgr = AUTH_MGR.lock().await;
        return mgr.get_state();
    }

    mgr.get_state()
}

/// 切换当前选中的 API Key 记录
pub async fn set_selected_token(
    token_id: Option<i64>,
    token_name: Option<String>,
) -> Result<(), String> {
    let mut mgr = AUTH_MGR.lock().await;
    mgr.set_selected_token(token_id, token_name)
}

// ── 令牌管理接口（关键：获取用户在 bob-api 创建的 API Key 列表） ──

/// 获取用户在 https://bob-api.com 创建的 API Key 列表
pub async fn get_user_tokens(all: Option<bool>) -> Result<Vec<TokenItem>, String> {
    let is_all = all.unwrap_or(false);
    let (token, client, user_id, epoch) = token_request_context().await?;
    let items = cached_read(
        &TOKEN_LIST_CACHE,
        &TOKEN_LIST_GATE,
        TokenListCacheKey {
            user_id,
            session_epoch: epoch,
            all: is_all,
        },
        Duration::from_secs(20),
        || async move {
            validate_token_context(user_id, epoch).await?;
            let mut page = 1u32;
            let mut collected = Vec::new();
            loop {
                let url = if is_all {
                    format!(
                        "{}/api/token/search?keyword=&p={page}&size=100&all=true",
                        BASE_URL
                    )
                } else {
                    format!("{}/api/token/search?keyword=&p=1&size=100", BASE_URL)
                };
                let resp = send_bob_request_classified(
                    client
                        .get(&url)
                        .header(AUTHORIZATION, format!("Bearer {}", token)),
                )
                .await
                .map_err(|e| e.with_context("获取 API Key 列表失败"))?;
                let status = resp.status();
                let text = resp
                    .text()
                    .await
                    .map_err(|e| format!("读取 API Key 列表响应失败: {e}"))?;
                let parsed: ApiResponse<serde_json::Value> =
                    parse_api_response_body(status, &text, "获取 API Key 列表")
                        .map_err(|message| BobRequestError::from_status(status, message))?;
                if !parsed.success {
                    return Err(if parsed.message.is_empty() {
                        "获取令牌列表失败".to_string()
                    } else {
                        parsed.message
                    }
                    .into());
                }
                let data = parsed
                    .data
                    .ok_or_else(|| "响应数据中无 data 字段".to_string())?;
                let items_val = if let Some(items) = data.get("items") {
                    items
                } else if data.is_array() {
                    &data
                } else {
                    return Ok(vec![]);
                };
                let page_items: Vec<TokenItem> = serde_json::from_value(items_val.clone())
                    .map_err(|e| format!("反序列化令牌列表失败: {e}"))?;
                let page_len = page_items.len();
                collected.extend(page_items);
                if !is_all
                    || page_len < 100
                    || data
                        .get("total")
                        .and_then(serde_json::Value::as_u64)
                        .is_some_and(|total| collected.len() as u64 >= total)
                    || page >= 100
                {
                    break;
                }
                page += 1;
            }
            Ok(collected)
        },
    )
    .await?;
    validate_token_context(user_id, epoch).await?;

    for token in &items {
        if !token.key.is_empty() {
            crate::credential_policy::register_managed_key(&token.key);
        }
    }

    Ok(items)
}

/// 获取某个 Token 的真实明文 API Key (调用 POST /api/token/:id/key)
pub async fn get_token_key(token_id: i64) -> Result<String, String> {
    let (token, client, user_id, epoch) = token_request_context().await?;
    let key = cached_read(
        &TOKEN_KEY_CACHE,
        &TOKEN_KEY_GATE,
        (user_id, epoch, token_id),
        Duration::from_secs(60),
        || async move {
            validate_token_context(user_id, epoch).await?;
            let url = format!("{}/api/token/{}/key", BASE_URL, token_id);
            let resp = send_bob_request_classified(
                client
                    .post(&url)
                    .header(AUTHORIZATION, format!("Bearer {}", token)),
            )
            .await
            .map_err(|e| e.with_context("读取明文 API Key 失败"))?;
            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| format!("读取明文 API Key 响应失败: {e}"))?;
            let parsed: ApiResponse<ApiRawTokenKeyData> =
                parse_api_response_body(status, &text, "读取明文 API Key")
                    .map_err(|message| BobRequestError::from_status(status, message))?;
            if !parsed.success {
                return Err(if parsed.message.is_empty() {
                    "无法读取该 API Key 的明文，可能已被禁用或删除".to_string()
                } else {
                    parsed.message
                }
                .into());
            }
            let key_data = parsed.data.ok_or_else(|| "返回数据为空".to_string())?;
            let mut key = key_data.key.trim().to_string();
            if !key.starts_with("sk-") {
                key = format!("sk-{}", key);
            }
            Ok(key)
        },
    )
    .await?;
    validate_token_context(user_id, epoch).await?;

    // 登记为 Bob API 受管密钥，确保后续单工具关联、保存与模型探测均受来源限制
    crate::credential_policy::register_managed_key(&key);

    Ok(key)
}

/// 更新已有 API Key 的所属分组 (调用 PUT /api/token/)
pub async fn update_user_token_group(
    token_id: i64,
    new_group: String,
) -> Result<TokenItem, String> {
    let _ensure_gate = AUTO_TOKEN_ENSURE_GATE.lock().await;
    let clean_group = new_group.trim().to_string();
    if clean_group.is_empty() {
        return Err("分组名称不能为空".to_string());
    }

    let (token, client, user_id, epoch) = token_request_context().await?;

    // Only a group-only endpoint is safe here. A full GET -> PUT would replay
    // stale quota/IP/model fields and overwrite concurrent server-side changes.
    let group_url = format!("{}/api/token/{}/group", BASE_URL, token_id);
    // A mutation may commit even if its response is lost. Clear old list/key
    // data before sending so ambiguous outcomes cannot be served from cache.
    invalidate_token_caches().await;
    validate_token_context(user_id, epoch).await?;
    let resp = match send_bob_request(
        client
            .patch(&group_url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .json(&serde_json::json!({ "group": clean_group })),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            invalidate_token_caches().await;
            validate_token_context(user_id, epoch).await?;
            return Err(format!(
                "更新令牌分组网络异常（服务端 group-only 契约不可用）: {error}"
            ));
        }
    };
    invalidate_token_caches().await;
    validate_token_context(user_id, epoch).await?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 group-only 更新响应失败: {e}"))?;
    validate_token_context(user_id, epoch).await?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "更新令牌分组（group-only）")?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "更新分组失败，可能您的账号无权使用该分组".to_string()
        } else {
            parsed.message
        });
    }

    let tokens = match get_user_tokens(None).await {
        Ok(tokens) => tokens,
        Err(_) => return Err("修改已提交，状态待确认".to_string()),
    };
    validate_token_context(user_id, epoch).await?;
    let updated = tokens
        .into_iter()
        .find(|t| t.id == token_id)
        .ok_or_else(|| "修改已提交，状态待确认".to_string())?;

    Ok(updated)
}

/// 为自动接入取得指定分组的可用 API Key：优先复用该分组下已启用的令牌
/// （`preferred_token_id` 匹配时优先），没有时才调用 POST /api/token/ 创建一个。
/// 分组下只有停用或不可用的令牌时直接报错，不会重复创建。创建请求发出后结果不明时，
/// 先按令牌列表核对是否已经创建成功，核对不到则在 30 秒内暂停同一分组的再次创建；
/// 请求没有真正发出（本地限流、请求构建或连接失败）时不登记，可以立即重试。
pub async fn ensure_user_token(
    name: String,
    group: String,
    preferred_token_id: Option<i64>,
) -> Result<TokenItem, String> {
    let clean_name = name.trim().to_string();
    if clean_name.is_empty() {
        return Err("令牌名称不能为空".to_string());
    }
    let clean_group = group.trim().to_string();
    if clean_group.is_empty() {
        return Err("令牌分组不能为空".into());
    }

    let _ensure_gate = AUTO_TOKEN_ENSURE_GATE.lock().await;
    let (_, _, user_id, epoch) = token_request_context().await?;
    let ready_key = (user_id, epoch, clean_group.to_ascii_lowercase());
    let ready_token = {
        let mut ready = AUTO_TOKEN_READY.lock().await;
        ready.retain(|_, (until, _)| *until > Instant::now());
        ready.get(&ready_key).map(|(_, token)| token.clone())
    };
    if let Some(token) = ready_token {
        validate_token_context(user_id, epoch).await?;
        clear_auto_token_attempt(user_id, epoch, &clean_group).await;
        return Ok(token);
    }
    // Ensure the first decision after an idle period sees tokens created on
    // the website, while concurrent/batch targets share the fresh result.
    invalidate_token_caches().await;
    let existing = get_user_tokens(Some(true)).await?;
    validate_token_context(user_id, epoch).await?;
    let is_group_name = |item: &TokenItem| {
        item.group
            .as_deref()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case(&clean_group)
    };
    let is_group_match = |item: &TokenItem| item.status == 1 && is_group_name(item);
    if existing.iter().any(is_group_name) && !existing.iter().any(is_group_match) {
        return Err(format!(
            "「{clean_group}」分组已有停用或不可用的令牌；为避免重复创建，请先在 Key 管理页面检查并启用或删除旧令牌"
        ));
    }
    if let Some(mut item) = existing
        .iter()
        .find(|item| preferred_token_id == Some(item.id) && is_group_match(item))
        .or_else(|| existing.iter().find(|item| is_group_match(item)))
        .cloned()
    {
        let key = get_token_key(item.id).await.map_err(|error| {
            format!("已有「{clean_group}」令牌，但读取明文失败，已停止创建: {error}")
        })?;
        validate_token_context(user_id, epoch).await?;
        item.key = key;
        remember_ensured_token(user_id, epoch, &existing, &item).await;
        cache_auto_token_ready(user_id, epoch, &clean_group, &item).await;
        clear_auto_token_attempt(user_id, epoch, &clean_group).await;
        return Ok(item);
    }

    let attempt_key = (user_id, epoch, clean_group.to_ascii_lowercase());
    check_rate_limit(&BOB_RATE_LIMIT).await?;
    {
        let mut attempts = AUTO_TOKEN_ATTEMPTS.lock().await;
        attempts.retain(|_, until| *until > Instant::now());
        if let Some(until) = attempts.get(&attempt_key) {
            return Err(format!(
                "「{clean_group}」令牌创建结果待确认，请在 {} 秒后重试，避免重复创建",
                until.saturating_duration_since(Instant::now()).as_secs() + 1
            ));
        }
        attempts.insert(
            attempt_key.clone(),
            Instant::now() + Duration::from_secs(30),
        );
    }

    // AUTO_TOKEN_ENSURE_GATE is held across the record and the request, so
    // no other caller can observe the record before a not-sent failure
    // removes it again.
    match create_user_token_request(clean_name, clean_group.clone(), user_id, epoch).await {
        Err(create_error) if create_error.not_sent => {
            clear_auto_token_attempt(user_id, epoch, &clean_group).await;
            Err(format!(
                "自动创建「{clean_group}」令牌失败: {}",
                create_error.message
            ))
        }
        Ok(item) => {
            validate_token_context(user_id, epoch).await?;
            remember_ensured_token(user_id, epoch, &existing, &item).await;
            cache_auto_token_ready(user_id, epoch, &clean_group, &item).await;
            clear_auto_token_attempt(user_id, epoch, &clean_group).await;
            Ok(item)
        }
        Err(create_error) => {
            invalidate_token_caches().await;
            validate_token_context(user_id, epoch).await?;
            if let Ok(tokens) = get_user_tokens(Some(true)).await {
                validate_token_context(user_id, epoch).await?;
                if let Some(mut item) = tokens.iter().find(|item| is_group_match(item)).cloned() {
                    item.key = get_token_key(item.id).await.map_err(|key_error| {
                        format!("令牌可能已创建，但读取明文失败，已禁止重复创建: {key_error}")
                    })?;
                    validate_token_context(user_id, epoch).await?;
                    remember_ensured_token(user_id, epoch, &tokens, &item).await;
                    cache_auto_token_ready(user_id, epoch, &clean_group, &item).await;
                    clear_auto_token_attempt(user_id, epoch, &clean_group).await;
                    return Ok(item);
                }
            }
            Err(format!(
                "自动创建「{clean_group}」令牌失败或结果待确认，已暂停重复创建: {}",
                create_error.message
            ))
        }
    }
}

/// 创建新的 API Key 令牌 (调用 POST /api/token/)
/// Explicit Key creation preserves the user's request to create a new token;
/// automatic callers should use `ensure_user_token` for reuse-before-create.
pub async fn create_user_token(name: String, group: String) -> Result<TokenItem, String> {
    let _ensure_gate = AUTO_TOKEN_ENSURE_GATE.lock().await;
    let (_, _, user_id, epoch) = token_request_context().await?;
    create_user_token_request(name, group, user_id, epoch)
        .await
        .map_err(|error| error.message)
}

/// Errors flagged `not_sent` happened before the POST left this process.
async fn create_user_token_request(
    name: String,
    group: String,
    expected_user_id: i64,
    expected_epoch: u64,
) -> Result<TokenItem, BobRequestError> {
    let clean_name = name.trim().to_string();
    if clean_name.is_empty() {
        return Err(BobRequestError::not_sent("令牌名称不能为空"));
    }
    let clean_group = group.trim().to_string();

    let (token, client, user_id, epoch) = token_request_context()
        .await
        .map_err(BobRequestError::not_sent)?;
    if user_id != expected_user_id || epoch != expected_epoch {
        return Err(BobRequestError::not_sent("账号已切换，已取消旧令牌创建"));
    }
    check_rate_limit(&BOB_RATE_LIMIT)
        .await
        .map_err(BobRequestError::local_cooldown)?;
    let url = format!("{}/api/token/", BASE_URL);
    let payload = serde_json::json!({
        "name": clean_name,
        "remain_quota": 500000,
        "expired_time": -1,
        "unlimited_quota": true,
        "group": clean_group,
    });

    invalidate_token_caches().await;
    let resp = send_bob_request_classified(
        client
            .post(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .json(&payload),
    )
    .await
    .map_err(|e| e.with_context("创建令牌网络请求失败"))?;

    finish_created_token(
        resp,
        clean_name,
        clean_group,
        expected_user_id,
        expected_epoch,
    )
    .await
    .map_err(BobRequestError::from)
}

/// Everything after the creation POST was sent: failures here are ambiguous
/// (the token may exist), so they are never classified as `not_sent`.
async fn finish_created_token(
    resp: reqwest::Response,
    clean_name: String,
    clean_group: String,
    expected_user_id: i64,
    expected_epoch: u64,
) -> Result<TokenItem, String> {
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取创建令牌响应失败: {e}"))?;

    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "创建新令牌")?;
    validate_token_context(expected_user_id, expected_epoch).await?;

    if !parsed.success {
        return Err(if parsed.message.is_empty() {
            "创建令牌失败".to_string()
        } else {
            parsed.message
        });
    }

    let item_opt: Option<TokenItem> = parsed.data.and_then(|d| serde_json::from_value(d).ok());

    let mut item = match item_opt {
        Some(it) if it.id > 0 => it,
        _ => {
            // 服务端成功创建但 data 未返回完整对象时，重新拉取用户令牌列表并定位最新令牌
            invalidate_token_caches().await;
            let tokens = get_user_tokens(Some(true)).await?;
            validate_token_context(expected_user_id, expected_epoch).await?;
            tokens
                .into_iter()
                .filter(|t| {
                    t.name == clean_name && t.group.as_deref().unwrap_or("").trim() == clean_group
                })
                .max_by_key(|t| t.id)
                .ok_or_else(|| "令牌创建成功，但未能检索到新生成的令牌".to_string())?
        }
    };

    // 无论服务端是否在创建接口中回显 Key，统一调用专用明文接口获取未截断明文并登记受管权限
    item.key = get_token_key(item.id)
        .await
        .map_err(|error| format!("令牌已创建，但获取明文失败，请稍后在 Key 页面查看: {error}"))?;

    validate_token_context(expected_user_id, expected_epoch).await?;

    Ok(item)
}

fn managed_destination(url: &str, default: &str) -> Result<String, String> {
    let dest = if url.trim().is_empty() {
        default.to_string()
    } else {
        url.to_string()
    };
    crate::credential_policy::assert_managed_key_destination(
        &dest,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| e.to_string())?;
    Ok(dest)
}

/// 一键配置会按目标 Agent 覆盖为对应分组的推荐模型。
///
/// 这里不能保留旧模型：API Key 已切换到专属分组后，旧模型可能不在该分组的
/// 可用渠道中，最终会出现 `model_not_found`，形成“Key 已切换但模型未切换”的
/// 半配置状态。
const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-5-5";
const DEFAULT_CODEX_MODEL: &str = "gpt-5.6-sol";
const DEFAULT_DOMESTIC_MODEL: &str = "glm-5.3";

fn default_model_for_target(target: &str) -> Option<&'static str> {
    match target {
        "codex" | "chatgpt" => Some(DEFAULT_CODEX_MODEL),
        "claude" => Some(DEFAULT_CLAUDE_MODEL),
        "workbuddy" | "accio" | "acciowork" | "cursor" => Some(DEFAULT_DOMESTIC_MODEL),
        _ => None,
    }
}

/// 在阻塞线程池中执行同步配置读写，避免文件 I/O、注册表和进程探测阻塞 Tokio 工作线程。
async fn run_config_blocking<T, F>(operation: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|e| format!("后台配置任务执行异常: {e}"))
}

/// 一键将 API Key 批量写入指定的 Agent 配置文件中
pub async fn apply_api_key_to_agents(
    api_key: String,
    targets: Vec<String>,
) -> Result<HashMap<String, bool>, String> {
    let mut results = HashMap::new();
    let reset_generation = crate::reset::current_generation();
    crate::reset::ensure_generation(reset_generation).map_err(|error| error.to_string())?;

    for target in targets {
        crate::reset::ensure_generation(reset_generation).map_err(|error| error.to_string())?;
        match target.as_str() {
            "codex" | "chatgpt" => {
                let model = default_model_for_target(&target)
                    .expect("已知 Codex 目标必须有默认模型")
                    .to_string();
                let key = api_key.clone();
                let outcome = run_config_blocking(move || {
                    // 读取当前已有配置
                    let cur = crate::codex::get_codex_config().ok();
                    let url = cur
                        .as_ref()
                        .map(|c| c.base_url.clone())
                        .unwrap_or_else(|| "https://bob-api.com/".to_string());
                    managed_destination(&url, "https://bob-api.com/").and_then(|url| {
                        crate::codex::set_codex_config_at_generation(
                            url,
                            key,
                            Some(model),
                            reset_generation,
                        )
                        .map_err(|e| e.to_string())
                    })
                })
                .await
                .and_then(|result| result);
                match outcome {
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
                let model = default_model_for_target(&target)
                    .expect("已知 Claude 目标必须有默认模型")
                    .to_string();
                let key = api_key.clone();
                let outcome = run_config_blocking(move || {
                    let cur = crate::claude::get_claude_config().ok();
                    let url = cur
                        .as_ref()
                        .map(|c| c.base_url.clone())
                        .unwrap_or_else(|| "https://bob-api.com/".to_string());
                    managed_destination(&url, "https://bob-api.com/").and_then(|url| {
                        crate::claude::set_claude_config_at_generation(
                            url,
                            key,
                            Some(model),
                            reset_generation,
                        )
                        .map_err(|e| e.to_string())
                    })
                })
                .await
                .and_then(|result| result);
                match outcome {
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
                let model = default_model_for_target(&target)
                    .expect("已知 WorkBuddy 目标必须有默认模型")
                    .to_string();
                let key = api_key.clone();
                let outcome = run_config_blocking(move || {
                    let cur = crate::workbuddy::get_workbuddy_config().ok();
                    let url = cur
                        .as_ref()
                        .map(|c| c.base_url.clone())
                        .unwrap_or_else(|| "https://bob-api.com/v1".to_string());
                    let url = managed_destination(&url, "https://bob-api.com/v1")?;
                    let payload = crate::workbuddy::WorkbuddySavePayload {
                        url,
                        api_key: key,
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
                    crate::workbuddy::set_workbuddy_default_config_at_generation(
                        payload,
                        reset_generation,
                    )
                    .map_err(|e| e.to_string())
                })
                .await
                .and_then(|result| result);
                match outcome {
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
                let cur = run_config_blocking(crate::accio::config::load_accio_config).await?;
                let base_url = if cur.base_url.is_empty() {
                    "https://bob-api.com/".to_string()
                } else {
                    cur.base_url
                };
                if let Err(e) = managed_destination(&base_url, "https://bob-api.com/") {
                    error!("应用 Key 到 AccioWork 失败: {e}");
                    results.insert("acciowork".to_string(), false);
                    continue;
                }
                let model = default_model_for_target(&target)
                    .expect("已知 Accio Work 目标必须有默认模型")
                    .to_string();
                let config = crate::accio::config::AccioConfig {
                    base_url,
                    api_key: api_key.clone(),
                    model,
                    bridge_port: cur.bridge_port,
                    official_gateway: cur.official_gateway,
                    fallback_official: cur.fallback_official,
                    prevent_official_leak: cur.prevent_official_leak,
                    // 一键配置的目标是“配置后即可用”：同步打开并持久化 Bridge 守护。
                    auto_start_bridge: true,
                    cached_models: Vec::new(),
                    cached_models_fingerprint: String::new(),
                    image_model: cur.image_model,
                };
                crate::accio::invalidate_model_list_cache();
                let saved_config = config.clone();
                let saved = run_config_blocking(move || {
                    crate::accio::config::save_accio_config_at_generation(
                        &saved_config,
                        reset_generation,
                    )
                    .map_err(|e| e.to_string())
                })
                .await
                .and_then(|result| result);
                match saved {
                    Ok(_) => {
                        // 一键配置必须和手动配置保持一致：保存凭据后立即启动
                        // Bridge，再按新 Key 刷新模型目录。
                        if config.auto_start_bridge && !config.api_key.trim().is_empty() {
                            if let Err(e) = crate::accio::start_bridge(
                                Some(config.bridge_port),
                                Some(reset_generation),
                            )
                            .await
                            {
                                error!("一键配置后启动 Accio Work Bridge 失败: {e}");
                                results.insert("acciowork".to_string(), false);
                                continue;
                            }
                            crate::reset::ensure_generation(reset_generation)
                                .map_err(|error| error.to_string())?;
                        }
                        crate::accio::refresh_model_list_cache().await;
                        crate::reset::ensure_generation(reset_generation)
                            .map_err(|error| error.to_string())?;
                        results.insert("acciowork".to_string(), true);
                    }
                    Err(e) => {
                        error!("应用 Key 到 AccioWork 失败: {e}");
                        results.insert("acciowork".to_string(), false);
                    }
                }
            }
            "cursor" => {
                let cur = run_config_blocking(crate::cursor::config::load_cursor_config).await?;
                let old_fp = crate::cursor::model_source_fingerprint(&cur.base_url, &cur.api_key);
                let base_url = if cur.base_url.is_empty() {
                    "https://bob-api.com/".to_string()
                } else {
                    cur.base_url
                };
                if let Err(e) = managed_destination(&base_url, "https://bob-api.com/") {
                    error!("应用 Key 到 Cursor 失败: {e}");
                    results.insert("cursor".to_string(), false);
                    continue;
                }
                // 与 set_cursor_config 保持一致：Key 或地址变化后旧模型缓存失效
                let new_fp = crate::cursor::model_source_fingerprint(&base_url, &api_key);
                let source_changed = old_fp != new_fp;
                let (cached_models, cached_models_fingerprint) = if source_changed {
                    (Vec::new(), String::new())
                } else {
                    (cur.cached_models, cur.cached_models_fingerprint)
                };
                let model = default_model_for_target(&target)
                    .expect("已知 Cursor 目标必须有默认模型")
                    .to_string();
                let config = crate::cursor::config::CursorConfig {
                    base_url,
                    api_key: api_key.clone(),
                    model,
                    bridge_port: cur.bridge_port,
                    // Cursor 只有在 Bridge 常驻且挂接后才能真正使用自有模型。
                    auto_start_bridge: true,
                    custom_models: cur.custom_models,
                    cached_models,
                    cached_models_fingerprint,
                    cursor_path: cur.cursor_path,
                };
                let saved_config = config.clone();
                let saved = run_config_blocking(move || {
                    crate::cursor::config::save_cursor_config_at_generation(
                        &saved_config,
                        reset_generation,
                    )
                    .map_err(|e| e.to_string())
                })
                .await
                .and_then(|result| result);
                match saved {
                    Ok(_) => {
                        if source_changed {
                            crate::cursor::invalidate_model_list_cache();
                        }

                        // Cursor 的模型目录和 Bridge 必须跟随刚写入的 Key
                        // 同步生效，不能等用户再次打开配置面板才后台刷新。
                        let actual_port =
                            if config.auto_start_bridge && !config.api_key.trim().is_empty() {
                                match crate::cursor::start_bridge(
                                    Some(config.bridge_port),
                                    Some(reset_generation),
                                )
                                .await
                                {
                                    Ok(port) => port,
                                    Err(e) => {
                                        error!("一键配置后启动 Cursor Bridge 失败: {e}");
                                        results.insert("cursor".to_string(), false);
                                        continue;
                                    }
                                }
                            } else {
                                config.bridge_port
                            };
                        crate::reset::ensure_generation(reset_generation)
                            .map_err(|error| error.to_string())?;
                        crate::cursor::refresh_model_list_cache().await;
                        crate::reset::ensure_generation(reset_generation)
                            .map_err(|error| error.to_string())?;
                        let mut latest =
                            run_config_blocking(crate::cursor::config::load_cursor_config).await?;
                        let models = crate::cursor::load_key_model_ids(&latest).await;
                        crate::reset::ensure_generation(reset_generation)
                            .map_err(|error| error.to_string())?;
                        if !models.is_empty() && latest.custom_models != models {
                            latest.custom_models = models;
                            let models_config = latest.clone();
                            let saved_models = run_config_blocking(move || {
                                crate::cursor::config::save_cursor_config_at_generation(
                                    &models_config,
                                    reset_generation,
                                )
                                .map_err(|e| e.to_string())
                            })
                            .await
                            .and_then(|result| result);
                            if let Err(e) = saved_models {
                                error!("一键配置后保存 Cursor 模型列表失败: {e}");
                            }
                        }

                        // Cursor 的一键配置必须包含客户端接入，不能再要求用户
                        // 进入详细页手动点击“接入 AI Helper”。仅在原本运行时
                        // 恢复启动，避免擅自打开用户原先关闭的客户端。
                        let cursor_path = latest.cursor_path.clone();
                        let status_path = cursor_path.clone();
                        let patch = run_config_blocking(move || {
                            crate::cursor::get_patch_status(status_path.as_deref())
                        })
                        .await?;
                        let expected_target = format!("http://127.0.0.1:{actual_port}");
                        if !patch.is_patched
                            || patch.current_bridge_target.as_deref()
                                != Some(expected_target.as_str())
                        {
                            let patch_path = cursor_path.clone();
                            let patch_result =
                                tokio::task::spawn_blocking(move || {
                                    // 进程探测同样是阻塞操作，必须在打补丁（会结束
                                    // Cursor 进程）之前、在阻塞线程中完成。
                                    let was_running = crate::app_paths::is_target_running("cursor");
                                    crate::reset::with_config_write_at_generation(
                                        reset_generation,
                                        || {
                                            crate::cursor::apply_patch(
                                                patch_path.as_deref(),
                                                actual_port,
                                            )
                                            .map_err(crate::error::AppError::Other)?;
                                            if was_running {
                                                crate::process_manager::restart_target_app(
                                                    "cursor",
                                                    patch_path.as_deref(),
                                                )
                                                .map_err(|error| {
                                                    crate::error::AppError::Other(format!(
                                                        "Cursor 已接入但恢复启动失败: {error}"
                                                    ))
                                                })?;
                                            }
                                            Ok(())
                                        },
                                    )
                                    .map_err(|error| error.to_string())
                                })
                                .await
                                .map_err(|e| format!("Cursor 接入任务执行异常: {e}"))
                                .and_then(|result| result);

                            if let Err(e) = patch_result {
                                error!("一键配置后接入 Cursor 到 AI Helper 失败: {e}");
                                results.insert("cursor".to_string(), false);
                                continue;
                            }
                            crate::reset::ensure_generation(reset_generation)
                                .map_err(|error| error.to_string())?;
                        }
                        results.insert("cursor".to_string(), true);
                    }
                    Err(e) => {
                        error!("应用 Key 到 Cursor 失败: {e}");
                        results.insert("cursor".to_string(), false);
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
    let client = AUTH_MGR.lock().await.client.clone();

    let h = hours.unwrap_or(1);
    let url = format!(
        "{}/api/channel/monitor/group-overview?hours={}",
        BASE_URL, h
    );
    let resp = send_bob_request(
        client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token)),
    )
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

fn parse_wallet_info(data: &serde_json::Value) -> Result<UserWalletInfo, String> {
    let quota = data
        .get("quota")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "服务端未返回有效原始平台余额，无法确认余额".to_string())?;
    let used_quota = data
        .get("used_quota")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "服务端未返回有效原始已用额度，无法确认用量".to_string())?;

    // Bob API 规范：500,000 点数 = $1.00，充值比例 1￥ = 4$
    let quota_per_unit: i64 = 500_000;
    let rmb_to_usd_rate: f64 = 4.0;

    let quota_usd = quota as f64 / quota_per_unit as f64;
    let quota_cny = quota_usd / rmb_to_usd_rate;
    let used_quota_usd = used_quota as f64 / quota_per_unit as f64;
    let used_quota_cny = used_quota_usd / rmb_to_usd_rate;

    let request_count = data
        .get("request_count")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);

    Ok(UserWalletInfo {
        quota,
        used_quota,
        quota_usd,
        quota_cny,
        used_quota_usd,
        used_quota_cny,
        request_count,
        group: data
            .get("group")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        quota_per_unit,
        rmb_to_usd_rate,
    })
}

/// 获取用户在 bob-api 的钱包与额度余额信息 (调用 GET /api/user/self)
pub async fn get_user_wallet() -> Result<UserWalletInfo, String> {
    let access_token = ensure_access_token().await?;
    let (mut token, expected_user_id, expected_epoch, client) = {
        let mgr = AUTH_MGR.lock().await;
        mgr.validate_current_session()?;
        let token = mgr
            .access_token
            .clone()
            .ok_or_else(|| "未登录".to_string())?;
        if token != access_token {
            return Err("会话已切换，已取消旧钱包请求".into());
        }
        let user_id = mgr
            .current_user
            .as_ref()
            .map(|u| u.id)
            .ok_or_else(|| "未登录".to_string())?;
        let epoch = mgr.session_epoch;
        (token, user_id, epoch, mgr.client.clone())
    };
    let url = format!("{}/api/user/self", BASE_URL);

    let mut resp = send_bob_request(
        client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token)),
    )
    .await
    .map_err(|e| format!("获取账号额度网络异常: {e}"))?;

    // 若 access_token 在服务端已失效 (401)，自动刷新一次会话凭据重试
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let refreshed = refresh_session_after_rejection(Some(&token))
            .await
            .map_err(|error| format!("刷新登录会话失败，当前登录状态已保留: {error}"))?;
        token = refreshed.access_token;
        let client = {
            let mgr = AUTH_MGR.lock().await;
            if mgr.session_epoch != expected_epoch
                || mgr.current_user.as_ref().map(|user| user.id) != Some(expected_user_id)
            {
                return Err("账号已切换，已丢弃旧钱包请求".into());
            }
            mgr.client.clone()
        };
        if let Ok(retry_resp) = send_bob_request(
            client
                .get(&url)
                .header(AUTHORIZATION, format!("Bearer {}", token)),
        )
        .await
        {
            resp = retry_resp;
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

    // The response itself is session-bound. Never return stale account data to
    // the renderer after logout or an account switch, even when only profile
    // fields are absent from the payload.
    {
        let mgr = AUTH_MGR.lock().await;
        if mgr.session_epoch != expected_epoch
            || mgr.current_user.as_ref().map(|u| u.id) != Some(expected_user_id)
        {
            return Err("账号已切换或会话已失效，已丢弃旧钱包响应".to_string());
        }
    }

    let wallet = parse_wallet_info(&data)?;

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
        // 关键加固：严格绑定请求发出时的 user_id 与 session_epoch，防止切换账号期间旧响应覆盖新资料落盘
        if mgr.session_epoch == expected_epoch
            && mgr.current_user.as_ref().map(|u| u.id) == Some(expected_user_id)
        {
            if let Some(ref mut u) = mgr.current_user {
                if let Some(r) = role {
                    u.role = Some(r);
                }
                if let Some(em) = email {
                    u.email = Some(em);
                }
            }
            mgr.persist_session(None)
                .map_err(|error| format!("保存账号资料失败: {error}"))?;
        } else {
            log::warn!(
                "会话已切换或已退出，丢弃在途钱包资料响应: expected_user={}, expected_epoch={}",
                expected_user_id,
                expected_epoch
            );
        }
    }

    Ok(wallet)
}

/// 删除指定 API Key (调用 DELETE /api/token/:id)
#[allow(dead_code)]
pub async fn delete_user_token(token_id: i64) -> Result<(), String> {
    let _ensure_gate = AUTO_TOKEN_ENSURE_GATE.lock().await;
    let (token, client, user_id, epoch) = token_request_context().await?;

    let url = format!("{}/api/token/{}", BASE_URL, token_id);
    invalidate_token_caches().await;
    validate_token_context(user_id, epoch).await?;
    let resp = match send_bob_request(
        client
            .delete(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token)),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            invalidate_token_caches().await;
            validate_token_context(user_id, epoch).await?;
            return Err(format!("删除令牌网络异常: {error}"));
        }
    };
    invalidate_token_caches().await;
    validate_token_context(user_id, epoch).await?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取删除令牌响应失败: {e}"))?;
    validate_token_context(user_id, epoch).await?;

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
    let _ensure_gate = AUTO_TOKEN_ENSURE_GATE.lock().await;
    let (token, client, user_id, epoch) = token_request_context().await?;

    let url = format!("{}/api/token/?status_only=true", BASE_URL);
    let body = serde_json::json!({
        "id": token_id,
        "status": status,
    });

    invalidate_token_caches().await;
    validate_token_context(user_id, epoch).await?;
    let resp = match send_bob_request(
        client
            .put(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .json(&body),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            invalidate_token_caches().await;
            validate_token_context(user_id, epoch).await?;
            return Err(format!("更新令牌状态网络异常: {error}"));
        }
    };
    invalidate_token_caches().await;
    validate_token_context(user_id, epoch).await?;

    let status_code = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取更新状态响应失败: {e}"))?;
    validate_token_context(user_id, epoch).await?;

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
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/token/auto-groups", BASE_URL);
    let resp = send_bob_request(
        client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token)),
    )
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
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/user/self/groups", BASE_URL);
    let resp = match send_bob_request(
        client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token)),
    )
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
    let client = AUTH_MGR.lock().await.client.clone();

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
    let resp = send_bob_request(
        client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .query(&query_params),
    )
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

    let (items, total) = if let Some(arr) = data.as_array() {
        let items: Vec<UsageLogItem> =
            serde_json::from_value(serde_json::Value::Array(arr.clone()))
                .map_err(|_| "使用日志额度数据无效，无法确认用量".to_string())?;
        let total = items.len() as i64;
        (items, total)
    } else if let Some(items_val) = data.get("items").or_else(|| data.get("data")) {
        let arr = items_val
            .as_array()
            .ok_or_else(|| "使用日志列表数据无效，无法确认用量".to_string())?;
        let items: Vec<UsageLogItem> =
            serde_json::from_value(serde_json::Value::Array(arr.clone()))
                .map_err(|_| "使用日志额度数据无效，无法确认用量".to_string())?;
        let total = data
            .get("total")
            .and_then(|v| v.as_i64())
            .unwrap_or(items.len() as i64);
        (items, total)
    } else {
        return Err("使用日志响应格式无效，无法确认用量".into());
    };

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
    let client = AUTH_MGR.lock().await.client.clone();

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
    let resp = send_bob_request(
        client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .query(&query_params),
    )
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
    let quota = data.get("quota").and_then(|v| v.as_i64());
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

    let resp = send_bob_request(req)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secret_storage::test_support::TestScope;
    use reqwest::cookie::CookieStore;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Barrier;

    #[tokio::test]
    async fn concurrent_cached_reads_share_one_request() {
        let cache: Mutex<RequestCache<&'static str, Vec<u8>>> = Mutex::new(RequestCache::new());
        let gate = Mutex::const_new(());
        let fetches = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let read = || {
            let fetches = fetches.clone();
            async {
                cached_read(
                    &cache,
                    &gate,
                    "tokens",
                    Duration::from_secs(20),
                    || async move {
                        fetches.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        Ok(vec![1, 2, 3])
                    },
                )
                .await
            }
        };

        let (first, second, third) = tokio::join!(read(), read(), read());
        assert_eq!(first.unwrap(), vec![1, 2, 3]);
        assert_eq!(second.unwrap(), vec![1, 2, 3]);
        assert_eq!(third.unwrap(), vec![1, 2, 3]);
        assert_eq!(fetches.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cached_rate_limit_error_does_not_outlive_retry_after() {
        let cache: Mutex<RequestCache<&'static str, u8>> = Mutex::new(RequestCache::new());
        let gate = Mutex::const_new(());
        let first = cached_read(&cache, &gate, "key", Duration::from_secs(60), || async {
            Err(BobRequestError::from_status(
                reqwest::StatusCode::TOO_MANY_REQUESTS,
                "Too many requests".to_string(),
            ))
        })
        .await;
        assert_eq!(first.unwrap_err(), "Too many requests（HTTP 429）");

        let second = cached_read(&cache, &gate, "key", Duration::from_secs(60), || async {
            Ok(7)
        })
        .await;
        assert_eq!(second.unwrap(), 7);
    }

    #[tokio::test]
    async fn requests_that_never_leave_the_process_are_classified_as_not_sent() {
        let client = Client::builder().no_proxy().build().unwrap();

        // Request construction fails before anything is sent.
        let error = send_bob_request_classified(client.get("not a url"))
            .await
            .unwrap_err();
        assert!(error.not_sent, "{error:?}");

        // Nothing listens on a port that was just released.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let error =
            send_bob_request_classified(client.post(format!("http://127.0.0.1:{port}/api/token/")))
                .await
                .unwrap_err();
        assert!(error.not_sent, "{error:?}");

        // Any failure surfaced after the request was sent stays ambiguous.
        let generic = BobRequestError::from("读取创建令牌响应失败".to_string());
        assert!(!generic.not_sent);
        let limited = BobRequestError::from_status(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            "slow down".into(),
        );
        assert!(limited.rate_limited && !limited.not_sent);
        let local = BobRequestError::local_cooldown("cooldown".into());
        assert!(local.rate_limited && local.not_sent);
    }

    #[tokio::test]
    async fn account_api_cooldown_does_not_block_auth_recovery() {
        let api_cooldown = Mutex::new(Some(Instant::now() + Duration::from_secs(30)));
        let auth_cooldown = Mutex::new(None);
        assert!(check_rate_limit(&auth_cooldown).await.is_ok());
        assert!(check_rate_limit(&api_cooldown).await.is_err());
    }

    #[test]
    fn retry_after_supports_delta_seconds_and_http_dates() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "17".parse().unwrap());
        assert_eq!(retry_after_duration(&headers), Duration::from_secs(17));

        headers.insert(
            reqwest::header::RETRY_AFTER,
            "Wed, 21 Oct 2015 07:28:00 GMT".parse().unwrap(),
        );
        assert_eq!(retry_after_duration(&headers), Duration::from_secs(1));
        headers.remove(reqwest::header::RETRY_AFTER);
        assert_eq!(retry_after_duration(&headers), Duration::from_secs(30));
    }

    #[test]
    fn malformed_or_application_failed_refresh_response_is_retryable() {
        let status = reqwest::StatusCode::OK;
        let missing_data = r#"{"success":true}"#;
        assert!(matches!(
            parse_refreshed_session_body(status, missing_data),
            Err(RefreshFailure::Retryable(message)) if message.contains("缺少数据")
        ));

        let application_failure = r#"{"success":false,"message":"暂时不可用"}"#;
        assert!(matches!(
            parse_refreshed_session_body(status, application_failure),
            Err(RefreshFailure::Retryable(message)) if message.contains("暂时不可用")
        ));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    struct NativeSessionCleanup<'scope> {
        scope: &'scope crate::secret_storage::test_support::NativeTestScope,
        path: PathBuf,
        references: Vec<(CredentialPurpose, String)>,
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    impl<'scope> NativeSessionCleanup<'scope> {
        fn new(
            scope: &'scope crate::secret_storage::test_support::NativeTestScope,
            store: &SessionStore,
        ) -> Self {
            Self {
                scope,
                path: store.path.clone(),
                references: Vec::new(),
            }
        }

        fn track(&mut self, storage: &AuthSessionStorage) {
            for (purpose, protected) in [
                (CredentialPurpose::SessionId, storage.session_sid.as_ref()),
                (
                    CredentialPurpose::RefreshCookie,
                    storage.refresh_cookie.as_ref(),
                ),
            ] {
                if let Some(protected) = protected
                    .filter(|value| value.starts_with(crate::secret_storage::ENCRYPTED_PREFIX))
                {
                    let reference = (purpose, protected.clone());
                    if !self.references.contains(&reference) {
                        self.references.push(reference);
                    }
                }
            }
        }

        fn assert_all_missing(&self) {
            for (purpose, protected) in &self.references {
                assert!(self.scope.entry_is_missing(*purpose, protected).unwrap());
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    impl Drop for NativeSessionCleanup<'_> {
        fn drop(&mut self) {
            // On an assertion failure, also collect the current committed pair.
            // Only this temporary file and this scope's random OS namespace are
            // addressed; the scope outlives this guard, including unwinding.
            if let Ok(bytes) = fs::read(&self.path) {
                if let Ok(storage) = serde_json::from_slice::<AuthSessionStorage>(&bytes) {
                    self.track(&storage);
                }
            }
            for (purpose, protected) in &self.references {
                let _ = crate::secret_storage::delete_secret_for(*purpose, protected);
            }
        }
    }

    fn user(id: i64) -> UserInfo {
        UserInfo {
            id,
            username: format!("test-user-{id}"),
            display_name: None,
            role: Some(1),
            email: None,
        }
    }

    fn legacy(id: i64) -> AuthSessionStorage {
        AuthSessionStorage {
            user: Some(user(id)),
            refresh_cookie: Some(format!(
                "new_api_refresh=fake-cookie-{id}; Path=/api/user/auth; Secure; HttpOnly"
            )),
            session_sid: Some(format!("fake-sid-{id}")),
            selected_token_id: Some(10),
            selected_token_name: Some("fake-token".into()),
            session_generation: None,
            storage_revision: None,
        }
    }

    fn login_data(id: i64) -> LoginSuccessData {
        LoginSuccessData {
            user: user(id),
            access_token: format!("fake-access-{id}"),
            access_expires_at: i64::MAX,
            session_sid: Some(format!("fake-sid-{id}")),
        }
    }

    #[test]
    fn one_click_configuration_uses_the_model_for_each_target_group() {
        for (target, expected) in [
            ("codex", DEFAULT_CODEX_MODEL),
            ("chatgpt", DEFAULT_CODEX_MODEL),
            ("claude", DEFAULT_CLAUDE_MODEL),
            ("workbuddy", DEFAULT_DOMESTIC_MODEL),
            ("accio", DEFAULT_DOMESTIC_MODEL),
            ("acciowork", DEFAULT_DOMESTIC_MODEL),
            ("cursor", DEFAULT_DOMESTIC_MODEL),
        ] {
            assert_eq!(default_model_for_target(target), Some(expected));
        }
        assert_eq!(default_model_for_target("unknown"), None);
    }

    fn fixture() -> (tempfile::TempDir, SessionStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = SessionStore {
            path: directory.path().join("auth_session.json"),
        };
        (directory, store)
    }

    fn write_fixture(store: &SessionStore, storage: &AuthSessionStorage) {
        crate::safe_fs::with_file_lock(&store.path, || {
            crate::safe_fs::atomic_write_locked(&store.path, serde_json::to_vec(storage).unwrap())
        })
        .unwrap();
    }

    fn read_fixture(store: &SessionStore) -> AuthSessionStorage {
        crate::safe_fs::with_file_lock(&store.path, || store.read_locked())
            .unwrap()
            .unwrap()
    }

    fn cookies(manager: &AuthManager) -> Option<String> {
        manager
            .cookie_jar
            .cookies(&Url::parse(&format!("{BASE_URL}/api/user/auth/refresh")).unwrap())
            .map(|value| value.to_str().unwrap().to_owned())
    }

    #[test]
    fn wallet_converts_quota_to_usd_and_cny_at_standard_rates() {
        let data = serde_json::json!({"quota": 163638029, "used_quota": 380572158, "request_count": 22649});
        let wallet = parse_wallet_info(&data).unwrap();
        assert_eq!(wallet.quota, 163638029);
        assert_eq!(wallet.used_quota, 380572158);
        assert!((wallet.quota_usd - (163638029.0 / 500000.0)).abs() < 1e-6);
        assert!((wallet.quota_cny - (wallet.quota_usd / 4.0)).abs() < 1e-6);
        assert!((wallet.used_quota_usd - (380572158.0 / 500000.0)).abs() < 1e-6);
        assert!((wallet.used_quota_cny - (wallet.used_quota_usd / 4.0)).abs() < 1e-6);
        assert_eq!(wallet.quota_per_unit, 500000);
        assert_eq!(wallet.rmb_to_usd_rate, 4.0);
        assert_eq!(wallet.request_count, 22649);

        let zero = parse_wallet_info(&serde_json::json!({"quota": 0, "used_quota": 0})).unwrap();
        assert_eq!(zero.quota, 0);
        assert_eq!(zero.quota_usd, 0.0);
        assert_eq!(zero.quota_cny, 0.0);
    }

    #[test]
    fn missing_or_invalid_raw_wallet_quota_never_defaults_to_zero() {
        for invalid in [
            serde_json::Value::Null,
            serde_json::json!("0"),
            serde_json::json!(1.5),
        ] {
            assert!(
                parse_wallet_info(&serde_json::json!({"quota":invalid,"used_quota":0})).is_err()
            );
            assert!(
                parse_wallet_info(&serde_json::json!({"quota":0,"used_quota":invalid})).is_err()
            );
        }
        assert!(parse_wallet_info(&serde_json::json!({"used_quota":1})).is_err());
        let token: TokenItem =
            serde_json::from_value(serde_json::json!({"id":1,"name":"fake"})).unwrap();
        assert!(token.remain_quota.is_none());
        let log: UsageLogItem = serde_json::from_value(serde_json::json!({"id":1})).unwrap();
        assert!(log.quota.is_none());
    }

    fn delayed_login_server(
        endpoint: &str,
        user_id: i64,
    ) -> (
        String,
        tokio::sync::oneshot::Receiver<()>,
        std::sync::mpsc::Sender<()>,
        std::thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}{endpoint}", listener.local_addr().unwrap());
        let endpoint = endpoint.to_owned();
        let (seen, started) = tokio::sync::oneshot::channel();
        let (release, released) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let mut chunk = [0u8; 1024];
                let amount = socket.read(&mut chunk).unwrap();
                assert!(amount > 0);
                request.extend_from_slice(&chunk[..amount]);
                assert!(request.len() < 32 * 1024);
            }
            assert!(String::from_utf8_lossy(&request).starts_with(&format!("POST {endpoint} ")));
            seen.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(10)).unwrap();
            let body = serde_json::json!({ "success": true, "data": {
                "access_token": format!("fake-late-access-{user_id}"), "access_expires_at": i64::MAX,
                "user": { "id": user_id, "username": format!("test-user-{user_id}") },
                "session": { "sid": format!("fake-late-sid-{user_id}") }
            }}).to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nSet-Cookie: new_api_refresh=fake-late-cookie-{user_id}; Path=/api/user/auth\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        (url, started, release, server)
    }

    async fn synthetic_login_response(
        request: reqwest::RequestBuilder,
    ) -> (LoginSuccessData, Option<String>) {
        let response = request.send().await.unwrap();
        let refresh_cookie = response
            .cookies()
            .find(|cookie| cookie.name() == "new_api_refresh")
            .map(|cookie| {
                format!(
                    "new_api_refresh={}; Path=/api/user/auth; Secure; HttpOnly",
                    cookie.value()
                )
            });
        let status = response.status();
        let body = response.text().await.unwrap();
        let parsed: ApiResponse<serde_json::Value> =
            parse_api_response_body(status, &body, "test login").unwrap();
        (
            parse_login_success_data(&parsed.data.unwrap()).unwrap(),
            refresh_cookie,
        )
    }

    #[test]
    fn legacy_migration_commits_and_verifies_before_activation() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        write_fixture(&store, &legacy(42));
        let manager = AuthManager::with_storage_path(store.path.clone());
        assert_eq!(manager.current_user.as_ref().map(|user| user.id), Some(42));
        assert_eq!(manager.session_sid.as_deref(), Some("fake-sid-42"));
        assert_eq!(
            cookies(&manager).as_deref(),
            Some("new_api_refresh=fake-cookie-42")
        );
        assert_eq!(manager.selected_token_id, Some(10));
        assert!(manager.session_restore_error.is_none());
        let stored = read_fixture(&store);
        assert!(stored.storage_revision.is_some());
        assert!(stored.session_sid.as_ref().unwrap().starts_with("enc:v2:"));
        assert!(stored
            .refresh_cookie
            .as_ref()
            .unwrap()
            .starts_with("enc:v2:"));
        let bytes = fs::read_to_string(&store.path).unwrap();
        assert!(!bytes.contains("fake-sid-42"));
        assert!(!bytes.contains("fake-cookie-42"));
        assert!(!store.backup_path().exists());
        let restored = AuthManager::with_storage_path(store.path.clone());
        assert_eq!(restored.session_sid, manager.session_sid);
        assert_ne!(restored.session_generation, manager.session_generation);
        assert!(!restored.auto_refresh_blocked);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn assert_native_session_snapshot(
        scope: &crate::secret_storage::test_support::NativeTestScope,
        store: &SessionStore,
        expected: &AuthSessionStorage,
    ) -> AuthSessionStorage {
        let persisted = read_fixture(store);
        let json = fs::read_to_string(&store.path).unwrap();
        assert_eq!(
            persisted.user.as_ref().map(|user| user.id),
            expected.user.as_ref().map(|user| user.id)
        );
        assert!(persisted.session_generation.is_some());
        assert!(persisted.storage_revision.is_some());
        for (purpose, encoded, plaintext, prefix) in [
            (
                CredentialPurpose::SessionId,
                persisted.session_sid.as_deref().unwrap(),
                expected.session_sid.as_deref().unwrap(),
                "enc:v2:keyring:session-id:",
            ),
            (
                CredentialPurpose::RefreshCookie,
                persisted.refresh_cookie.as_deref().unwrap(),
                expected.refresh_cookie.as_deref().unwrap(),
                "enc:v2:keyring:refresh-cookie:",
            ),
        ] {
            assert!(encoded.starts_with(prefix));
            assert!(!json.contains(plaintext));
            assert!(!scope.entry_is_missing(purpose, encoded).unwrap());
            assert_eq!(
                crate::secret_storage::unprotect_secret_for(purpose, encoded).unwrap(),
                (plaintext.to_owned(), false)
            );
        }
        assert!(!store.backup_path().exists());
        assert!(!store.path.with_extension("json.pending").exists());
        persisted
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn native_session_store_migration_restore_and_local_logout() {
        let scope = crate::secret_storage::test_support::NativeTestScope::enter();
        let (_directory, store) = fixture();
        // Drop order guarantees cleanup runs before either the file disappears
        // or the random native namespace is deactivated, including on panic.
        let mut cleanup = NativeSessionCleanup::new(&scope, &store);
        let old_plaintext = legacy(42621022);
        write_fixture(&store, &old_plaintext);
        assert!(fs::read_to_string(&store.path)
            .unwrap()
            .contains(old_plaintext.session_sid.as_deref().unwrap()));

        let first = AuthManager::with_storage_path(store.path.clone());
        // The actual SessionStore restore protects, stages, reads back, commits,
        // and reads back again before enabling this manager's memory/CookieJar.
        let first_protected = assert_native_session_snapshot(&scope, &store, &old_plaintext);
        cleanup.track(&first_protected);
        assert_eq!(first.session_sid, old_plaintext.session_sid);
        assert_eq!(first.refresh_cookie, old_plaintext.refresh_cookie);
        assert_eq!(
            first.current_user.as_ref().map(|user| user.id),
            Some(42621022)
        );
        assert_eq!(first.selected_token_id, Some(10));
        assert_eq!(
            cookies(&first).as_deref(),
            Some("new_api_refresh=fake-cookie-42621022")
        );
        assert_eq!(first.session_generation, first_protected.session_generation);
        assert!(!first.auto_refresh_blocked);
        assert!(first.session_restore_error.is_none());

        let mut restarted = AuthManager::with_storage_path(store.path.clone());
        let second_protected = assert_native_session_snapshot(&scope, &store, &old_plaintext);
        cleanup.track(&second_protected);
        assert_ne!(first.session_generation, restarted.session_generation);
        assert_ne!(first_protected.session_sid, second_protected.session_sid);
        assert_ne!(
            first_protected.refresh_cookie,
            second_protected.refresh_cookie
        );
        assert_eq!(restarted.session_sid, old_plaintext.session_sid);
        assert_eq!(
            cookies(&restarted).as_deref(),
            Some("new_api_refresh=fake-cookie-42621022")
        );
        assert!(first.validate_current_session().is_err());
        for (purpose, encoded) in [
            (
                CredentialPurpose::SessionId,
                first_protected.session_sid.as_deref().unwrap(),
            ),
            (
                CredentialPurpose::RefreshCookie,
                first_protected.refresh_cookie.as_deref().unwrap(),
            ),
        ] {
            assert!(scope.entry_is_missing(purpose, encoded).unwrap());
        }

        // A new synthetic login exercises the real protected save/commit path,
        // without using the global manager or issuing an HTTP request.
        let replacement = legacy(42621023);
        let previous_generation = restarted.session_generation.clone();
        restarted
            .complete_login(&login_data(42621023), replacement.refresh_cookie.as_deref())
            .unwrap();
        let replacement_protected = assert_native_session_snapshot(&scope, &store, &replacement);
        cleanup.track(&replacement_protected);
        assert_ne!(restarted.session_generation, previous_generation);
        assert_eq!(
            restarted.current_user.as_ref().map(|user| user.id),
            Some(42621023)
        );
        assert_eq!(restarted.session_sid, replacement.session_sid);
        assert_eq!(
            restarted.access_token.as_deref(),
            Some("fake-access-42621023")
        );
        assert_eq!(
            cookies(&restarted).as_deref(),
            Some("new_api_refresh=fake-cookie-42621023")
        );
        assert!(restarted.session_restore_error.is_none());
        for (purpose, encoded) in [
            (
                CredentialPurpose::SessionId,
                second_protected.session_sid.as_deref().unwrap(),
            ),
            (
                CredentialPurpose::RefreshCookie,
                second_protected.refresh_cookie.as_deref().unwrap(),
            ),
        ] {
            assert!(scope.entry_is_missing(purpose, encoded).unwrap());
        }

        restarted.clear_persisted_session();
        assert!(restarted.current_user.is_none());
        assert!(restarted.session_sid.is_none());
        assert!(restarted.refresh_cookie.is_none());
        assert!(restarted.access_token.is_none());
        assert!(cookies(&restarted).is_none());
        assert!(restarted.auto_refresh_blocked);
        assert!(restarted.session_restore_error.is_none());
        assert!(!store.path.exists());
        assert!(!store.backup_path().exists());
        assert!(store.marker_path().exists());
        cleanup.assert_all_missing();
        assert!(store.restore().unwrap().is_none());
        let after_logout = AuthManager::with_storage_path(store.path.clone());
        assert!(after_logout.auto_refresh_blocked);
        assert!(after_logout.current_user.is_none());
        assert!(cookies(&after_logout).is_none());
        cleanup.assert_all_missing();
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires AI_HELPER_NATIVE_CREDENTIAL_TESTS=1 and a disposable user Keychain"]
    fn native_keychain_session_store() {
        native_session_store_migration_restore_and_local_logout();
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires AI_HELPER_NATIVE_CREDENTIAL_TESTS=1 and an isolated Secret Service"]
    fn native_secret_service_session_store() {
        native_session_store_migration_restore_and_local_logout();
    }

    #[test]
    fn unavailable_migration_never_activates_and_remains_blocked_after_restart() {
        let scope = TestScope::unavailable();
        let _guard = scope.enter();
        let (_directory, store) = fixture();
        write_fixture(&store, &legacy(42));
        let manager = AuthManager::with_storage_path(store.path.clone());
        assert!(manager.auto_refresh_blocked);
        assert!(manager.current_user.is_none());
        assert!(manager.session_sid.is_none());
        assert!(cookies(&manager).is_none());
        assert!(manager.get_state().session_restore_error.is_some());
        assert!(store.marker_path().exists());
        // Retain the sole old copy for recovery, guarded by the durable marker.
        assert_eq!(
            read_fixture(&store).session_sid.as_deref(),
            Some("fake-sid-42")
        );
        scope.set_available(true);
        let restarted = AuthManager::with_storage_path(store.path.clone());
        assert!(restarted.auto_refresh_blocked);
        assert!(restarted.current_user.is_none());
        assert!(restarted.validate_current_session().is_err());
    }

    #[test]
    fn protected_restore_also_requires_the_system_service() {
        let scope = TestScope::new();
        let _guard = scope.enter();
        let (_directory, store) = fixture();
        let mut original = AuthManager::with_storage_path(store.path.clone());
        original
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        scope.set_available(false);
        let restarted = AuthManager::with_storage_path(store.path.clone());
        assert!(restarted.auto_refresh_blocked);
        assert!(restarted.session_restore_error.is_some());
        assert!(cookies(&restarted).is_none());
        assert!(store.marker_path().exists());
    }

    #[test]
    fn corrupt_json_or_one_corrupt_credential_never_partially_restores() {
        let _scope = TestScope::new().enter();
        for corrupt_json in [false, true] {
            let (_directory, store) = fixture();
            let mut storage = legacy(42);
            storage.session_sid = Some("enc:v2:invalid-purpose:malformed".into());
            write_fixture(&store, &storage);
            if corrupt_json {
                fs::write(&store.path, b"{broken").unwrap();
            }
            let manager = AuthManager::with_storage_path(store.path.clone());
            assert!(manager.current_user.is_none());
            assert!(manager.refresh_cookie.is_none());
            assert!(manager.session_restore_error.is_some());
            assert!(cookies(&manager).is_none());
            assert!(store.marker_path().exists());
        }
    }

    #[test]
    fn migration_cleanup_failure_blocks_activation() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        write_fixture(&store, &legacy(42));
        fs::create_dir(store.backup_path()).unwrap();
        let manager = AuthManager::with_storage_path(store.path.clone());
        assert!(manager.current_user.is_none());
        assert!(manager.session_restore_error.is_some());
        assert!(store.marker_path().exists());
    }

    #[test]
    fn failed_login_write_never_enables_memory_or_removes_logout_marker() {
        let scope = TestScope::unavailable();
        let _guard = scope.enter();
        let (_directory, store) = fixture();
        store.invalidate(None, true).unwrap();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        assert!(manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .is_err());
        assert!(!manager.get_state().is_logged_in);
        assert!(manager.access_token.is_none());
        assert!(cookies(&manager).is_none());
        assert!(store.marker_path().exists());
        scope.set_available(true);
        manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        assert!(manager.get_state().is_logged_in);
        assert!(!store.marker_path().exists());
    }

    #[test]
    fn invalid_session_path_reports_failure_without_touching_home() {
        let _scope = TestScope::new().enter();
        let (directory, _store) = fixture();
        let parent_file = directory.path().join("blocked-parent");
        fs::write(&parent_file, b"not a directory").unwrap();
        let mut manager = AuthManager::with_storage_path(parent_file.join("session.json"));
        assert!(manager.session_restore_error.is_some());
        assert!(manager.complete_login(&login_data(42), None).is_err());
        assert!(!manager.get_state().is_logged_in);
        assert!(manager.auto_refresh_blocked);
        assert_eq!(fs::read(&parent_file).unwrap(), b"not a directory");
    }

    #[test]
    fn ordinary_save_cannot_remove_an_explicit_logout_marker() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        let stale = manager.session_storage(None);
        store.invalidate(None, true).unwrap();
        assert!(store.save(&stale, SessionWrite::Existing).is_err());
        assert!(store.marker_path().exists());
        assert!(!store.path.exists());
        let restarted = AuthManager::with_storage_path(store.path.clone());
        assert!(restarted.current_user.is_none());
        assert!(restarted.auto_refresh_blocked);
    }

    #[test]
    fn concurrent_logout_and_refresh_never_resurrect_a_session() {
        let scope = TestScope::new();
        let _guard = scope.enter();
        let (_directory, store) = fixture();
        for _ in 0..12 {
            let mut storage = legacy(42);
            storage.session_generation = Some(SessionStore::new_generation().unwrap());
            store
                .save(
                    &storage,
                    SessionWrite::ExplicitLogin(store.revision().unwrap()),
                )
                .unwrap();
            let barrier = Arc::new(Barrier::new(2));
            let save = {
                let store = store.clone();
                let scope = scope.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let _guard = scope.enter();
                    barrier.wait();
                    store.save(&storage, SessionWrite::Existing)
                })
            };
            let logout = {
                let store = store.clone();
                let scope = scope.clone();
                std::thread::spawn(move || {
                    let _guard = scope.enter();
                    barrier.wait();
                    store.invalidate(None, true)
                })
            };
            let _ = save.join().unwrap();
            logout.join().unwrap().unwrap();
            assert!(store.marker_path().exists());
            assert!(!store.path.exists());
            assert!(store.restore().unwrap().is_none());
        }
    }

    #[test]
    fn account_switch_never_inherits_refresh_cookie_or_token_selection() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        manager
            .set_selected_token(Some(10), Some("fake-token".into()))
            .unwrap();
        let old = manager.session_storage(None);
        manager.complete_login(&login_data(84), None).unwrap();
        assert_eq!(manager.current_user.as_ref().map(|user| user.id), Some(84));
        assert!(manager.refresh_cookie.is_none());
        assert!(cookies(&manager).is_none());
        assert!(manager.selected_token_id.is_none());
        assert!(read_fixture(&store).refresh_cookie.is_none());
        assert!(store.save(&old, SessionWrite::Existing).is_err());
        store
            .invalidate(old.session_generation.as_deref(), false)
            .unwrap();
        store
            .invalidate(old.session_generation.as_deref(), true)
            .unwrap();
        assert_eq!(read_fixture(&store).user.unwrap().id, 84);
        assert!(!store.marker_path().exists());
    }

    #[test]
    fn reauthentication_to_same_account_rejects_old_generation() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        let old = manager.session_storage(None);
        manager.complete_login(&login_data(42), None).unwrap();
        assert_ne!(manager.session_generation, old.session_generation);
        assert!(store.save(&old, SessionWrite::Existing).is_err());
        assert!(read_fixture(&store).refresh_cookie.is_none());
    }

    #[test]
    fn selected_token_is_rolled_back_when_persistence_is_blocked() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager.complete_login(&login_data(42), None).unwrap();
        store.invalidate(None, true).unwrap();
        assert!(manager
            .set_selected_token(Some(10), Some("fake-token".into()))
            .is_err());
        assert!(manager.selected_token_id.is_none());
        assert!(store.marker_path().exists());
    }

    #[test]
    fn failed_postcommit_readback_preserves_durable_credential_references() {
        let scope = TestScope::new();
        let _guard = scope.enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        // The two staged fields verify successfully; the first primary-file
        // verification read then fails while protection/deletion remain usable.
        scope.fail_reads_after(2);
        assert!(manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .is_err());
        assert!(manager.auto_refresh_blocked);
        assert!(!manager.get_state().is_logged_in);
        assert!(store.marker_path().exists());
        scope.clear_read_failure();
        let protected = read_fixture(&store);
        let recovered = SessionStore::unprotect(&protected).unwrap();
        assert_eq!(recovered.session_sid.as_deref(), Some("fake-sid-42"));
        assert_eq!(recovered.user.unwrap().id, 42);
        // The file remains usable for explicit recovery, never automatic login.
        assert!(store.restore().is_err());
    }

    #[test]
    fn login_jar_keeps_captcha_but_cannot_mutate_the_active_refresh_cookie() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        let url = Url::parse(&format!("{BASE_URL}/api/user/login")).unwrap();
        manager
            .cookie_jar
            .add_cookie_str("new_api_slide_captcha=fake-captcha; Path=/; Secure", &url);
        manager
            .cookie_jar
            .add_cookie_str("new_api_refresh=fake-wide-cookie; Path=/; Secure", &url);
        let isolated = manager.login_cookie_jar(&url).unwrap();
        let login_cookies = isolated.cookies(&url).unwrap().to_str().unwrap().to_owned();
        assert!(login_cookies.contains("new_api_slide_captcha=fake-captcha"));
        assert!(!login_cookies.contains("new_api_refresh"));
        isolated.add_cookie_str("new_api_refresh=fake-uncommitted; Path=/; Secure", &url);
        let active = manager
            .cookie_jar
            .cookies(&url)
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
        assert!(active.contains("fake-wide-cookie"));
        assert!(!active.contains("fake-uncommitted"));
    }

    #[test]
    fn unreadable_marker_blocks_restore_even_when_session_is_valid() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        write_fixture(&store, &legacy(42));
        fs::create_dir(store.marker_path()).unwrap();
        let manager = AuthManager::with_storage_path(store.path.clone());
        assert!(manager.auto_refresh_blocked);
        assert!(manager.session_restore_error.is_some());
        assert!(cookies(&manager).is_none());
    }

    #[tokio::test]
    async fn late_password_login_cannot_replace_another_instances_new_account() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut first = AuthManager::with_storage_path(store.path.clone());
        let revision = first.storage.revision().unwrap();
        let (url, started, release, server) = delayed_login_server("/api/user/login", 42);
        let request = first.isolated_login_client(&url).unwrap().post(url);
        let response = tokio::spawn(synthetic_login_response(request));
        started.await.unwrap();
        let mut second = AuthManager::with_storage_path(store.path.clone());
        second
            .complete_login(&login_data(84), legacy(84).refresh_cookie.as_deref())
            .unwrap();
        let committed = store.revision().unwrap();
        release.send(()).unwrap();
        let (data, cookie) = response.await.unwrap();
        assert!(first
            .complete_login_at_revision(&data, cookie.as_deref(), revision)
            .is_err());
        assert_eq!(store.revision().unwrap(), committed);
        assert_eq!(read_fixture(&store).user.unwrap().id, 84);
        assert!(!store.marker_path().exists());
        assert!(second.validate_current_session().is_ok());
        assert!(!first.get_state().is_logged_in);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn late_two_factor_login_cannot_clear_another_instances_new_logout_marker() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        store.invalidate(None, true).unwrap();
        let mut first = AuthManager::with_storage_path(store.path.clone());
        let revision = first.storage.revision().unwrap();
        let (url, started, release, server) = delayed_login_server("/api/user/login/2fa", 42);
        let request = first.isolated_login_client(&url).unwrap().post(url);
        let response = tokio::spawn(synthetic_login_response(request));
        started.await.unwrap();
        let second = AuthManager::with_storage_path(store.path.clone());
        second.storage.invalidate(None, true).unwrap();
        let logged_out = store.revision().unwrap();
        assert_ne!(logged_out.marker, revision.marker);
        release.send(()).unwrap();
        let (data, cookie) = response.await.unwrap();
        assert!(first
            .complete_login_at_revision(&data, cookie.as_deref(), revision)
            .is_err());
        assert_eq!(store.revision().unwrap(), logged_out);
        assert!(store.marker_path().exists());
        assert!(!store.path.exists());
        let restarted = AuthManager::with_storage_path(store.path.clone());
        assert!(restarted.auto_refresh_blocked);
        assert!(restarted.current_user.is_none());
        assert!(cookies(&restarted).is_none());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn delayed_refresh_response_cannot_restore_a_logged_out_or_replaced_account() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager
            .complete_login(&login_data(42), legacy(42).refresh_cookie.as_deref())
            .unwrap();
        let epoch = manager.session_epoch;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/api/user/auth/refresh",
            listener.local_addr().unwrap()
        );
        let (seen, started) = tokio::sync::oneshot::channel();
        let (release, released) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0u8; 4096];
            let size = socket.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..size]).contains("fake-sid-42"));
            seen.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(5)).unwrap();
            let body = serde_json::json!({
                "success": true,
                "data": { "access_token": "fake-late-access", "access_expires_at": i64::MAX,
                    "user": { "id": 42, "username": "test-user-42" },
                    "session": { "sid": "fake-late-sid" } }
            })
            .to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nSet-Cookie: new_api_refresh=fake-late-cookie; Path=/\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let request = manager.refresh_request(&url).unwrap();
        let response = tokio::spawn(fetch_refreshed_session(request));
        started.await.unwrap();
        manager.reset_memory();
        store.invalidate(None, true).unwrap();
        manager.complete_login(&login_data(84), None).unwrap();
        release.send(()).unwrap();
        let (data, cookie) = response.await.unwrap().unwrap();
        assert!(manager
            .complete_refresh(&data, cookie.as_deref(), epoch, Some(42))
            .is_err());
        assert_eq!(manager.current_user.as_ref().map(|user| user.id), Some(84));
        assert_eq!(manager.access_token.as_deref(), Some("fake-access-84"));
        assert!(manager.refresh_cookie.is_none());
        assert!(cookies(&manager).is_none());
        assert_eq!(read_fixture(&store).user.unwrap().id, 84);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn simulated_login_response_is_committed_without_real_account_requests() {
        let _scope = TestScope::new().enter();
        let (_directory, store) = fixture();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0u8; 4096];
            let amount = socket.read(&mut request).unwrap();
            assert!(amount > 0);
            let body = serde_json::json!({
                "success": true,
                "data": {
                    "access_token": "fake-http-access",
                    "access_expires_at": i64::MAX,
                    "user": { "id": 42, "username": "test-user-42" },
                    "session": { "sid": "fake-http-sid" }
                }
            })
            .to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nSet-Cookie: new_api_refresh=fake-http-cookie; Path=/api/user/auth; HttpOnly\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let response = Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("http://{address}/api/user/login"))
            .send()
            .await
            .unwrap();
        let cookie = response
            .cookies()
            .find(|cookie| cookie.name() == "new_api_refresh")
            .map(|cookie| {
                format!(
                    "new_api_refresh={}; Path=/api/user/auth; Secure; HttpOnly",
                    cookie.value()
                )
            });
        let status = response.status();
        let text = response.text().await.unwrap();
        let parsed: ApiResponse<serde_json::Value> =
            parse_api_response_body(status, &text, "test login").unwrap();
        let data = parse_login_success_data(&parsed.data.unwrap()).unwrap();
        let mut manager = AuthManager::with_storage_path(store.path.clone());
        manager.complete_login(&data, cookie.as_deref()).unwrap();
        assert_eq!(manager.access_token.as_deref(), Some("fake-http-access"));
        assert_eq!(
            cookies(&manager).as_deref(),
            Some("new_api_refresh=fake-http-cookie")
        );
        assert!(!fs::read_to_string(&store.path)
            .unwrap()
            .contains("fake-http-cookie"));
        server.join().unwrap();
    }
}

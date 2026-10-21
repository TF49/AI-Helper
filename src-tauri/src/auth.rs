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
    pub quota_usd: Option<f64>,
    pub quota_cny: Option<f64>,
    pub used_quota_usd: Option<f64>,
    pub used_quota_cny: Option<f64>,
    pub request_count: Option<i64>,
    pub group: Option<String>,
    pub quota_per_unit: Option<i64>,
    pub rmb_to_usd_rate: Option<f64>,
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

// ── 接口实现 ──

/// 获取站点基本状态（密码登录开关、验证码配置等）
pub async fn get_site_status() -> Result<SiteStatus, String> {
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/status", BASE_URL);
    let resp = client
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
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/user/login/encryption-key", BASE_URL);
    let resp = client
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
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/captcha/generate", BASE_URL);
    let resp = client
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
    let client = AUTH_MGR.lock().await.client.clone();
    let url = format!("{}/api/captcha/verify", BASE_URL);

    let body = serde_json::json!({
        "captcha_id": captcha_id,
        "x": x,
        "y": y,
    });

    let resp = client
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

    let resp = client
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

    let resp = client
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
    Expired(String),
}

async fn fetch_refreshed_session(
    request: reqwest::RequestBuilder,
) -> Result<(LoginSuccessData, Option<String>), RefreshFailure> {
    let response = request
        .send()
        .await
        .map_err(|error| RefreshFailure::Retryable(format!("刷新会话网络请求异常: {error}")))?;
    let status = response.status();
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
        .map_err(|error| RefreshFailure::Expired(format!("读取会话刷新响应失败: {error}")))?;
    let parsed: ApiResponse<serde_json::Value> =
        parse_api_response_body(status, &text, "刷新会话").map_err(RefreshFailure::Expired)?;
    if !status.is_success() || !parsed.success {
        return Err(RefreshFailure::Expired("登录状态已失效，请重新登录".into()));
    }
    let data = parsed
        .data
        .ok_or_else(|| RefreshFailure::Expired("刷新会话返回数据为空".into()))?;
    let data = parse_login_success_data(&data).map_err(RefreshFailure::Expired)?;
    Ok((data, refresh_cookie))
}

/// 刷新当前登录凭据
pub async fn refresh_session() -> Result<LoginSuccessData, String> {
    let _refresh = REFRESH_GATE.lock().await;
    let (request, epoch, user_id) = {
        let mut manager = AUTH_MGR.lock().await;
        let url = format!("{BASE_URL}/api/user/auth/refresh");
        let request = match manager.refresh_request(&url) {
            Ok(request) => request,
            Err(error) => {
                manager.reset_memory();
                manager.session_restore_error = Some(error.clone());
                return Err(error);
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
            Ok(data)
        }
        Err(RefreshFailure::Expired(error)) => {
            manager.clear_persisted_session();
            Err(error)
        }
        Err(RefreshFailure::Retryable(error)) => Err(error),
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
    let refreshed = refresh_session()
        .await
        .map_err(|_| "登录状态已失效，请重新登录".to_string())?;
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
    let remote_result = request.send().await;
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
    let token = ensure_access_token().await?;
    let client = AUTH_MGR.lock().await.client.clone();

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
    let resp = client
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

    for token in &items {
        if !token.key.is_empty() {
            crate::credential_policy::register_managed_key(&token.key);
        }
    }

    Ok(items)
}

/// 获取某个 Token 的真实明文 API Key (调用 POST /api/token/:id/key)
pub async fn get_token_key(token_id: i64) -> Result<String, String> {
    let token = ensure_access_token().await?;
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/token/{}/key", BASE_URL, token_id);
    let resp = client
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

    // 登记为 Bob API 受管密钥，确保后续单工具关联、保存与模型探测均受来源限制
    crate::credential_policy::register_managed_key(&key);

    Ok(key)
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

    // Only a group-only endpoint is safe here. A full GET -> PUT would replay
    // stale quota/IP/model fields and overwrite concurrent server-side changes.
    let group_url = format!("{}/api/token/{}/group", BASE_URL, token_id);
    let resp = client
        .patch(&group_url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .json(&serde_json::json!({ "group": clean_group }))
        .send()
        .await
        .map_err(|e| format!("更新令牌分组网络异常（服务端 group-only 契约不可用）: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 group-only 更新响应失败: {e}"))?;

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
    let updated = tokens
        .into_iter()
        .find(|t| t.id == token_id)
        .ok_or_else(|| "修改已提交，状态待确认".to_string())?;

    Ok(updated)
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
                match managed_destination(&url, "https://bob-api.com/").and_then(|url| {
                    crate::codex::set_codex_config(url, api_key.clone(), model)
                        .map_err(|e| e.to_string())
                }) {
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
                match managed_destination(&url, "https://bob-api.com/").and_then(|url| {
                    crate::claude::set_claude_config(url, api_key.clone(), model)
                        .map_err(|e| e.to_string())
                }) {
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
                let url = match managed_destination(&url, "https://bob-api.com/v1") {
                    Ok(url) => url,
                    Err(e) => {
                        error!("应用 Key 到 WorkBuddy 失败: {e}");
                        results.insert("workbuddy".to_string(), false);
                        continue;
                    }
                };
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
                let config = crate::accio::config::AccioConfig {
                    base_url,
                    api_key: api_key.clone(),
                    model: cur.model,
                    bridge_port: cur.bridge_port,
                    official_gateway: cur.official_gateway,
                    fallback_official: cur.fallback_official,
                    prevent_official_leak: cur.prevent_official_leak,
                    auto_start_bridge: cur.auto_start_bridge,
                    cached_models: Vec::new(),
                    cached_models_fingerprint: String::new(),
                    image_model: cur.image_model,
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
    let client = AUTH_MGR.lock().await.client.clone();

    let h = hours.unwrap_or(1);
    let url = format!(
        "{}/api/channel/monitor/group-overview?hours={}",
        BASE_URL, h
    );
    let resp = client
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

fn parse_wallet_info(data: &serde_json::Value) -> Result<UserWalletInfo, String> {
    let quota = data
        .get("quota")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "服务端未返回有效原始平台余额，无法确认余额".to_string())?;
    let used_quota = data
        .get("used_quota")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "服务端未返回有效原始已用额度，无法确认用量".to_string())?;
    Ok(UserWalletInfo {
        quota,
        used_quota,
        // TODO(SEC-08, backend): confirm the authenticated wallet's currency,
        // quota unit, conversion direction, provenance and validity contract.
        // No currency/unit contract has been confirmed for this endpoint.
        // Similar-looking JSON fields are not evidence of a conversion rate.
        quota_usd: None,
        quota_cny: None,
        used_quota_usd: None,
        used_quota_cny: None,
        request_count: data
            .get("request_count")
            .and_then(serde_json::Value::as_i64)
            .filter(|count| *count >= 0),
        group: data
            .get("group")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        quota_per_unit: None,
        rmb_to_usd_rate: None,
    })
}

/// 获取用户在 bob-api 的钱包与额度余额信息 (调用 GET /api/user/self)
pub async fn get_user_wallet() -> Result<UserWalletInfo, String> {
    let (mut token, expected_user_id, expected_epoch, client) = {
        let mgr = AUTH_MGR.lock().await;
        mgr.validate_current_session()?;
        let token = mgr
            .access_token
            .clone()
            .ok_or_else(|| "未登录".to_string())?;
        let user_id = mgr
            .current_user
            .as_ref()
            .map(|u| u.id)
            .ok_or_else(|| "未登录".to_string())?;
        let epoch = mgr.session_epoch;
        (token, user_id, epoch, mgr.client.clone())
    };
    let url = format!("{}/api/user/self", BASE_URL);

    let mut resp = client
        .get(&url)
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("获取账号额度网络异常: {e}"))?;

    // 若 access_token 在服务端已失效 (401)，自动刷新一次会话凭据重试
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Ok(refreshed) = refresh_session().await {
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
            if let Ok(retry_resp) = client
                .get(&url)
                .header(AUTHORIZATION, format!("Bearer {}", token))
                .send()
                .await
            {
                resp = retry_resp;
            }
        } else {
            let mut mgr = AUTH_MGR.lock().await;
            if mgr.session_epoch == expected_epoch
                && mgr.current_user.as_ref().map(|user| user.id) == Some(expected_user_id)
            {
                mgr.clear_persisted_session();
            }
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
    let token = ensure_access_token().await?;
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/token/{}", BASE_URL, token_id);
    let resp = client
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
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/token/?status_only=true", BASE_URL);
    let body = serde_json::json!({
        "id": token_id,
        "status": status,
    });

    let resp = client
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
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/token/auto-groups", BASE_URL);
    let resp = client
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
    let client = AUTH_MGR.lock().await.client.clone();

    let url = format!("{}/api/user/self/groups", BASE_URL);
    let resp = match client
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
    let resp = client
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
    let resp = client
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secret_storage::test_support::TestScope;
    use reqwest::cookie::CookieStore;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Barrier;

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
    fn wallet_preserves_raw_quota_without_guessing_unconfirmed_currency_fields() {
        for conversion in [
            serde_json::json!({}),
            serde_json::json!({"quota_per_unit":0,"rmb_to_usd_rate":-4,"quota_usd":99999}),
            serde_json::json!({"quota_per_unit":500000,"rmb_to_usd_rate":4,"quota_usd":2,"quota_cny":0.5}),
        ] {
            let mut data = serde_json::json!({"quota":1234567,"used_quota":42});
            data.as_object_mut()
                .unwrap()
                .extend(conversion.as_object().unwrap().clone());
            let wallet = parse_wallet_info(&data).unwrap();
            assert_eq!(wallet.quota, 1234567);
            assert_eq!(wallet.used_quota, 42);
            assert!(wallet.quota_usd.is_none());
            assert!(wallet.quota_cny.is_none());
            assert!(wallet.used_quota_usd.is_none());
            assert!(wallet.used_quota_cny.is_none());
            assert!(wallet.quota_per_unit.is_none());
            assert!(wallet.rmb_to_usd_rate.is_none());
            assert!(wallet.request_count.is_none());
        }
        let zero = parse_wallet_info(&serde_json::json!({"quota":0,"used_quota":0})).unwrap();
        assert_eq!(zero.quota, 0);
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

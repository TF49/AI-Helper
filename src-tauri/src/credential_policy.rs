//! 凭据出口策略：精确 origin 比较、HTTPS 约束、禁止把受管 Key 发往未授权目标。

use once_cell::sync::Lazy;
use reqwest::Url;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
struct KeyStoreFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    managed: HashSet<String>,
    #[serde(default)]
    external: HashSet<String>,
    #[serde(default)]
    external_origins: HashMap<String, HashSet<String>>,
}

#[derive(Debug, Clone, Default)]
struct KeyStore {
    managed: HashSet<String>,
    external_origins: HashMap<String, HashSet<String>>,
}

fn key_store_path() -> std::path::PathBuf {
    #[cfg(test)]
    {
        static TEST_DIRECTORY: Lazy<tempfile::TempDir> =
            Lazy::new(|| tempfile::tempdir().expect("isolated credential tests"));
        return TEST_DIRECTORY.path().join("managed_keys.json");
    }
    #[cfg(not(test))]
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".ai-helper")
        .join("managed_keys.json")
}

static KEY_STORE: Lazy<Mutex<KeyStore>> = Lazy::new(|| Mutex::new(KeyStore::default()));

fn read_key_store(path: &Path) -> Result<KeyStore, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(KeyStore::default())
        }
        Err(error) => return Err(format!("读取凭据来源登记失败: {error}")),
    };
    if let Ok(managed) = serde_json::from_slice::<HashSet<String>>(&bytes) {
        return Ok(KeyStore {
            managed,
            ..KeyStore::default()
        });
    }
    let file: KeyStoreFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("凭据来源登记损坏，已停止使用及修改: {error}"))?;
    if !matches!(file.version, 1 | 2) {
        return Err(format!(
            "不支持的凭据来源登记版本 {}，已停止使用及修改",
            file.version
        ));
    }
    let mut state = KeyStore {
        managed: file.managed,
        // Version 1 external hashes lacked an origin binding and must be confirmed again.
        external_origins: if file.version == 2 {
            file.external_origins
        } else {
            HashMap::new()
        },
    };
    state
        .external_origins
        .retain(|digest, _| !state.managed.contains(digest));
    Ok(state)
}

/// Lock order is always the local store mutex, then the file's OS lock. Read,
/// merge, decision, and commit share that file lock across application instances.
fn with_store_at<T>(
    state: &mut KeyStore,
    path: &Path,
    operation: impl FnOnce(&mut KeyStore, &Path) -> Result<T, String>,
) -> Result<T, String> {
    crate::safe_fs::with_file_lock(path, || {
        let mut latest = read_key_store(path).map_err(crate::error::AppError::Other)?;
        // A trusted cloud observation remains managed even if its previous
        // persistence failed. Never merge stale external permissions back in.
        latest.managed.extend(state.managed.iter().cloned());
        latest
            .external_origins
            .retain(|digest, _| !latest.managed.contains(digest));
        *state = latest;
        operation(state, path).map_err(crate::error::AppError::Other)
    })
    .map_err(|error| error.to_string())
}

fn with_current_store<T>(
    operation: impl FnOnce(&mut KeyStore, &Path) -> Result<T, String>,
) -> Result<T, String> {
    let mut state = KEY_STORE
        .lock()
        .map_err(|_| "凭据来源锁不可用".to_string())?;
    with_store_at(&mut state, &key_store_path(), operation)
}

fn persist_key_store_locked(state: &KeyStore, path: &Path) -> Result<(), String> {
    let file = KeyStoreFile {
        version: 2,
        managed: state.managed.clone(),
        external: HashSet::new(),
        external_origins: state.external_origins.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;
    crate::safe_fs::atomic_write_locked(path, bytes).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialSource {
    Managed,
    External,
    Unknown,
}

fn source_in_store(state: &KeyStore, key: &str) -> CredentialSource {
    let digest = hash_key(key.trim());
    if state.managed.contains(&digest) {
        CredentialSource::Managed
    } else if state.external_origins.contains_key(&digest) {
        CredentialSource::External
    } else {
        CredentialSource::Unknown
    }
}

fn source_for(key: &str) -> CredentialSource {
    with_current_store(|state, _| Ok(source_in_store(state, key)))
        .unwrap_or(CredentialSource::Unknown)
}

#[derive(Debug, serde::Serialize)]
pub struct CredentialStatus {
    pub source: &'static str,
    pub authorized: bool,
    pub can_confirm: bool,
    pub origin: String,
    pub message: Option<String>,
}

pub fn credential_status(key: &str, destination: &str) -> CredentialStatus {
    let result =
        with_current_store(|state, _| Ok(credential_status_in_store(state, key, destination)));
    result.unwrap_or_else(|message| CredentialStatus {
        source: "unknown",
        authorized: false,
        can_confirm: false,
        origin: String::new(),
        message: Some(message),
    })
}

fn credential_status_in_store(state: &KeyStore, key: &str, destination: &str) -> CredentialStatus {
    let source = match source_in_store(state, key) {
        CredentialSource::Managed => "managed",
        CredentialSource::External => "external",
        CredentialSource::Unknown => "unknown",
    };
    let endpoint = validate_endpoint(destination, loopback_http_allowed());
    let origin = endpoint
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_default();
    let validation = validate_destination_in_store(
        state,
        key,
        destination,
        &default_managed_origins(),
        loopback_http_allowed(),
    );
    CredentialStatus {
        source,
        authorized: validation.is_ok(),
        can_confirm: !key.trim().is_empty() && source != "managed" && endpoint.is_ok(),
        origin,
        message: validation.err().map(|error| error.to_string()),
    }
}

/// A user explicitly authorizes this credential for the exact displayed origin.
/// Managed credentials can never be reclassified to bypass their destination policy.
pub fn confirm_key_destination(key: &str, destination: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("请先填写 API Key".into());
    }
    validate_endpoint(destination, loopback_http_allowed()).map_err(|error| error.to_string())?;
    with_current_store(|state, path| {
        confirm_destination_in_store(state, path, trimmed, destination)
    })
}

fn confirm_destination_in_store(
    state: &mut KeyStore,
    path: &Path,
    key: &str,
    destination: &str,
) -> Result<(), String> {
    let origin = validate_endpoint(destination, loopback_http_allowed())
        .map_err(|error| error.to_string())?;
    let trimmed = key.trim();
    let digest = hash_key(trimmed);
    if state.managed.contains(&digest) {
        return assert_managed_key_destination(
            destination,
            &default_managed_origins(),
            loopback_http_allowed(),
        )
        .map(|_| ())
        .map_err(|error| error.to_string());
    }
    let mut next = state.clone();
    if origin_allowed(&origin, &default_managed_origins()) {
        next.managed.insert(digest.clone());
        next.external_origins.remove(&digest);
    } else {
        next.external_origins
            .entry(digest)
            .or_default()
            .insert(origin.to_string());
    }
    persist_key_store_locked(&next, path).map_err(|e| format!("凭据目标确认保存失败: {e}"))?;
    *state = next;
    Ok(())
}

pub fn validate_key_destination(
    key: &str,
    destination: &str,
    allowed: &[Origin],
    allow_loopback_http: bool,
) -> Result<Origin, PolicyError> {
    if key.trim().is_empty() {
        return validate_endpoint(destination, allow_loopback_http);
    }
    with_current_store(|state, _| {
        Ok(validate_destination_in_store(
            state,
            key,
            destination,
            allowed,
            allow_loopback_http,
        ))
    })
    .unwrap_or_else(|message| Err(PolicyError::CredentialStoreUnavailable { message }))
}

fn validate_destination_in_store(
    state: &KeyStore,
    key: &str,
    destination: &str,
    allowed: &[Origin],
    allow_loopback_http: bool,
) -> Result<Origin, PolicyError> {
    if key.trim().is_empty() {
        return validate_endpoint(destination, allow_loopback_http);
    }
    match source_in_store(state, key) {
        CredentialSource::Managed => {
            assert_managed_key_destination(destination, allowed, allow_loopback_http)
        }
        CredentialSource::External => {
            let origin = validate_endpoint(destination, allow_loopback_http)?;
            let digest = hash_key(key.trim());
            if state
                .external_origins
                .get(&digest)
                .is_some_and(|origins| origins.contains(&origin.to_string()))
            {
                Ok(origin)
            } else {
                Err(PolicyError::UnconfirmedDestination)
            }
        }
        CredentialSource::Unknown if allow_loopback_http => {
            let origin = validate_endpoint(destination, true)?;
            if is_loopback_host(&origin.host) && origin.scheme == "http" {
                Ok(origin)
            } else {
                Err(PolicyError::UnknownCredentialSource)
            }
        }
        CredentialSource::Unknown => Err(PolicyError::UnknownCredentialSource),
    }
}

fn hash_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn register_managed_key(key: &str) {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return;
    }
    let digest = hash_key(trimmed);
    if let Ok(mut guard) = KEY_STORE.lock() {
        guard.managed.insert(digest.clone());
        guard.external_origins.remove(&digest);
        if let Err(e) = with_store_at(&mut guard, &key_store_path(), |state, path| {
            persist_key_store_locked(state, path)
        }) {
            log::error!("受管密钥来源登记保存失败，未知凭据将被阻断: {}", e);
        }
    }
}

#[allow(dead_code)]
pub fn is_managed_key(key: &str) -> bool {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return false;
    }
    source_for(trimmed) == CredentialSource::Managed
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub scheme: String,
    pub host: String,
    pub port: u16,
}

impl fmt::Display for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}://{}:{}", self.scheme, self.host, self.port)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    InvalidUrl,
    UserinfoForbidden,
    SecretInUrl,
    HttpRemoteForbidden,
    OriginNotAllowed { actual: String },
    UnknownCredentialSource,
    UnconfirmedDestination,
    CredentialStoreUnavailable { message: String },
}

impl fmt::Display for PolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PolicyError::InvalidUrl => write!(f, "目标 URL 无效"),
            PolicyError::UserinfoForbidden => write!(f, "拒绝 URL 中的用户名/密码"),
            PolicyError::SecretInUrl => write!(f, "拒绝在 query/fragment 中携带秘密"),
            PolicyError::HttpRemoteForbidden => {
                write!(
                    f,
                    "远程节点仅允许 HTTPS；loopback HTTP 需显式开启本地开发模式"
                )
            }
            PolicyError::OriginNotAllowed { actual } => {
                write!(f, "受管 Key 不得发往未授权目标 {}", actual)
            }
            PolicyError::UnknownCredentialSource => write!(
                f,
                "凭据来源未知，请在密钥输入处确认当前节点，或从账号中选择已有 Key"
            ),
            PolicyError::UnconfirmedDestination => {
                write!(f, "此密钥尚未获准用于当前节点，请在密钥输入处确认目标")
            }
            PolicyError::CredentialStoreUnavailable { message } => {
                write!(f, "凭据来源登记不可用，已阻止发送: {message}")
            }
        }
    }
}

pub fn default_managed_origins() -> Vec<Origin> {
    vec![
        parse_origin("https://bob-api.com").expect("builtin origin"),
        parse_origin("https://www.bob-api.com").expect("builtin origin"),
        parse_origin("https://api.bob-api.com").expect("builtin origin"),
        parse_origin("https://helper.bob-api.com").expect("builtin origin"),
    ]
}

pub fn loopback_http_allowed() -> bool {
    matches!(
        std::env::var("AI_HELPER_ALLOW_LOOPBACK_HTTP").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

pub fn parse_origin(raw: &str) -> Result<Origin, PolicyError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(PolicyError::InvalidUrl);
    }
    let url = Url::parse(trimmed)
        .or_else(|_| Url::parse(&format!("https://{trimmed}")))
        .map_err(|_| PolicyError::InvalidUrl)?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PolicyError::UserinfoForbidden);
    }
    if url.query().is_some_and(contains_secret) || url.fragment().is_some_and(contains_secret) {
        return Err(PolicyError::SecretInUrl);
    }
    let scheme = url.scheme().to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err(PolicyError::InvalidUrl);
    }
    let host = url
        .host_str()
        .ok_or(PolicyError::InvalidUrl)?
        .to_ascii_lowercase();
    let port = url.port_or_known_default().ok_or(PolicyError::InvalidUrl)?;
    Ok(Origin { scheme, host, port })
}

fn contains_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("token")
        || lower.contains("password")
        || lower.contains("secret")
        || lower.contains("sid=")
}

pub fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

pub fn validate_endpoint(raw: &str, allow_loopback_http: bool) -> Result<Origin, PolicyError> {
    let origin = parse_origin(raw)?;
    if origin.scheme == "https" {
        return Ok(origin);
    }
    if origin.scheme == "http" && allow_loopback_http && is_loopback_host(&origin.host) {
        return Ok(origin);
    }
    Err(PolicyError::HttpRemoteForbidden)
}

pub fn origin_allowed(actual: &Origin, allowed: &[Origin]) -> bool {
    allowed.iter().any(|item| item == actual)
}

pub fn assert_managed_key_destination(
    destination: &str,
    allowed: &[Origin],
    allow_loopback_http: bool,
) -> Result<Origin, PolicyError> {
    let origin = validate_endpoint(destination, allow_loopback_http)?;
    if origin_allowed(&origin, allowed) {
        return Ok(origin);
    }
    if allow_loopback_http && is_loopback_host(&origin.host) && origin.scheme == "http" {
        return Ok(origin);
    }
    Err(PolicyError::OriginNotAllowed {
        actual: origin.to_string(),
    })
}

pub fn credentialed_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_external_snapshot_observes_managed_promotion_before_confirmation_or_send() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sources.json");
        let key = "fake-cross-process-promoted-key";
        let mut first = KeyStore::default();
        with_store_at(&mut first, &path, |state, path| {
            confirm_destination_in_store(state, path, key, "https://provider.example")
        })
        .unwrap();
        let mut stale = first.clone();
        let mut publisher = KeyStore::default();
        publisher.managed.insert(hash_key(key));
        with_store_at(&mut publisher, &path, |state, path| {
            persist_key_store_locked(state, path)
        })
        .unwrap();

        assert!(with_store_at(&mut stale, &path, |state, path| {
            confirm_destination_in_store(state, path, key, "https://other.example")
        })
        .is_err());
        let validation = with_store_at(&mut stale, &path, |state, _| {
            Ok(validate_destination_in_store(
                state,
                key,
                "https://provider.example",
                &default_managed_origins(),
                false,
            ))
        })
        .unwrap();
        assert!(matches!(
            validation,
            Err(PolicyError::OriginNotAllowed { .. })
        ));
        assert!(read_key_store(&path)
            .unwrap()
            .managed
            .contains(&hash_key(key)));
    }

    #[test]
    fn independent_old_snapshots_cannot_drop_each_others_managed_keys() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sources.json");
        let mut first = KeyStore::default();
        let mut second = KeyStore::default();
        first.managed.insert(hash_key("fake-first-managed-key"));
        second.managed.insert(hash_key("fake-second-managed-key"));
        with_store_at(&mut first, &path, |state, path| {
            persist_key_store_locked(state, path)
        })
        .unwrap();
        with_store_at(&mut second, &path, |state, path| {
            persist_key_store_locked(state, path)
        })
        .unwrap();
        assert_eq!(read_key_store(&path).unwrap().managed.len(), 2);
    }

    #[test]
    fn corrupt_future_or_unreadable_stores_are_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sources.json");
        for contents in [
            b"broken-json".as_slice(),
            br#"{"version":999,"managed":[],"external_origins":{}}"#,
        ] {
            std::fs::write(&path, contents).unwrap();
            let mut state = KeyStore::default();
            assert!(with_store_at(&mut state, &path, |state, path| {
                confirm_destination_in_store(
                    state,
                    path,
                    "fake-blocked-confirmation",
                    "https://provider.example",
                )
            })
            .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), contents);
        }
        assert!(read_key_store(directory.path()).is_err());
    }

    #[test]
    fn failed_confirmation_does_not_change_in_memory_permissions() {
        let directory = tempfile::tempdir().unwrap();
        let mut state = KeyStore::default();
        let key = "fake-confirmation-write-failure";
        // A directory cannot be replaced by a credential file. No HOME or
        // global store is touched, and failure occurs at the actual commit.
        assert!(confirm_destination_in_store(
            &mut state,
            directory.path(),
            key,
            "https://provider.example"
        )
        .is_err());
        assert_eq!(source_in_store(&state, key), CredentialSource::Unknown);
        assert!(state.external_origins.is_empty());
    }

    #[test]
    fn legacy_external_hashes_require_confirmation_again() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sources.json");
        let key = "fake-legacy-external-key";
        let file = KeyStoreFile {
            version: 1,
            external: HashSet::from([hash_key(key)]),
            ..Default::default()
        };
        std::fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
        let state = read_key_store(&path).unwrap();
        assert_eq!(source_in_store(&state, key), CredentialSource::Unknown);
    }

    #[test]
    fn unknown_key_requires_an_explicit_destination_confirmation() {
        let key = "fake-unconfirmed-origin-key";
        assert_eq!(
            validate_key_destination(
                key,
                "https://provider.example/v1",
                &default_managed_origins(),
                false
            ),
            Err(PolicyError::UnknownCredentialSource)
        );
        let status = credential_status(key, "https://provider.example/v1");
        assert!(status.can_confirm);
        assert!(!status.authorized);
    }

    #[test]
    fn external_confirmation_is_bound_to_exact_origin() {
        let key = "fake-external-origin-key";
        confirm_key_destination(key, "https://provider.example/v1").unwrap();
        assert!(validate_key_destination(
            key,
            "https://provider.example/models",
            &default_managed_origins(),
            false
        )
        .is_ok());
        assert_eq!(
            validate_key_destination(
                key,
                "https://other.example/v1",
                &default_managed_origins(),
                false
            ),
            Err(PolicyError::UnconfirmedDestination)
        );
        assert_eq!(
            validate_key_destination(
                key,
                "https://provider.example:8443/v1",
                &default_managed_origins(),
                false
            ),
            Err(PolicyError::UnconfirmedDestination)
        );
    }

    #[test]
    fn managed_key_cannot_be_reclassified_as_external() {
        let key = "fake-managed-confirmation-key";
        register_managed_key(key);
        assert!(confirm_key_destination(key, "https://provider.example/v1").is_err());
        assert!(is_managed_key(key));
        assert!(!credential_status(key, "https://provider.example/v1").can_confirm);
    }

    #[test]
    fn manual_official_key_confirmation_keeps_managed_restrictions() {
        let key = "fake-manual-official-key";
        confirm_key_destination(key, "https://bob-api.com/v1").unwrap();
        assert!(is_managed_key(key));
        assert!(confirm_key_destination(key, "https://other.example").is_err());
    }

    #[test]
    fn confirmation_cannot_enable_plaintext_remote_requests() {
        assert!(confirm_key_destination("fake-http-key", "http://provider.example/v1").is_err());
    }

    #[test]
    fn origin_compares_scheme_host_and_effective_port() {
        let a = parse_origin("https://bob-api.com/v1").unwrap();
        let b = parse_origin("HTTPS://BOB-API.COM:443/extra").unwrap();
        assert_eq!(a, b);
        let other_port = parse_origin("https://bob-api.com:8443").unwrap();
        assert_ne!(a, other_port);
    }

    #[test]
    fn similar_domain_is_not_trusted() {
        let allowed = default_managed_origins();
        let err =
            assert_managed_key_destination("https://bob-api.com.evil.example", &allowed, false)
                .unwrap_err();
        assert!(matches!(err, PolicyError::OriginNotAllowed { .. }));
    }

    #[test]
    fn managed_key_cannot_go_to_old_third_party() {
        let allowed = default_managed_origins();
        let err = assert_managed_key_destination("https://api.openai.com/v1", &allowed, false)
            .unwrap_err();
        assert!(matches!(err, PolicyError::OriginNotAllowed { .. }));
    }

    #[test]
    fn https_bob_api_is_allowed() {
        let allowed = default_managed_origins();
        assert!(assert_managed_key_destination("https://bob-api.com/", &allowed, false).is_ok());
    }

    #[test]
    fn remote_http_is_rejected() {
        let err = validate_endpoint("http://bob-api.com", false).unwrap_err();
        assert_eq!(err, PolicyError::HttpRemoteForbidden);
    }

    #[test]
    fn loopback_http_requires_explicit_flag() {
        assert!(validate_endpoint("http://127.0.0.1:8787", false).is_err());
        assert!(validate_endpoint("http://127.0.0.1:8787", true).is_ok());
    }

    #[test]
    fn userinfo_is_rejected() {
        assert_eq!(
            parse_origin("https://user:pass@bob-api.com").unwrap_err(),
            PolicyError::UserinfoForbidden
        );
    }

    #[test]
    fn secret_query_is_rejected() {
        assert_eq!(
            parse_origin("https://bob-api.com/v1?api_key=sk-test").unwrap_err(),
            PolicyError::SecretInUrl
        );
    }
}

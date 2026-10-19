//! 凭据出口策略：精确 origin 比较、HTTPS 约束、禁止把受管 Key 发往未授权目标。

use once_cell::sync::Lazy;
use reqwest::Url;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt;
use std::sync::Mutex;

static MANAGED_KEY_HASHES: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| {
    let mut set = HashSet::new();
    let path = dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".ai-helper")
        .join("managed_keys.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(loaded) = serde_json::from_str::<HashSet<String>>(&text) {
            set = loaded;
        }
    }
    Mutex::new(set)
});

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
    if let Ok(mut guard) = MANAGED_KEY_HASHES.lock() {
        if guard.insert(digest) {
            let app_dir = dirs::home_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join(".ai-helper");
            let _ = std::fs::create_dir_all(&app_dir);
            let path = app_dir.join("managed_keys.json");
            if let Ok(json) = serde_json::to_string(&*guard) {
                if let Err(e) = crate::safe_fs::safe_write_file(&path, json.as_bytes()) {
                    log::warn!("受管密钥哈希持久化写入失败: {}", e);
                }
            }
        }
    }
}

pub fn is_managed_key(key: &str) -> bool {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return false;
    }
    let digest = hash_key(trimmed);
    if let Ok(guard) = MANAGED_KEY_HASHES.lock() {
        if guard.contains(&digest) {
            return true;
        }
    }
    false
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
        }
    }
}

pub fn default_managed_origins() -> Vec<Origin> {
    vec![
        parse_origin("https://bob-api.com").expect("builtin origin"),
        parse_origin("https://www.bob-api.com").expect("builtin origin"),
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

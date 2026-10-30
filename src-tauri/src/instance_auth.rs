//! Accio Bridge 实例生命周期凭据：敏感路由在读大体/调上游前校验，并在转发前剥离。

use axum::http::HeaderMap;

pub const INSTANCE_HEADER: &str = "x-ai-helper-instance";
pub const GATEWAY_AUTH_HEADER: &str = "x-gateway-auth";
/// Accio 不支持自定义请求头，但会把 `GATEWAY_BASE_URL` / `ADK_BASE_URL` 原样作为前缀拼接请求路径，
/// 因此实例凭据以 `/i/<token>` 路径前缀的形式随每个请求到达 Bridge。
pub const INSTANCE_PATH_PREFIX: &str = "/i/";

pub fn generate_instance_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("secure random unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 常量时间比较，避免按字节提前返回泄露凭据前缀
pub fn token_eq(candidate: &str, token: &str) -> bool {
    let a = candidate.as_bytes();
    let b = token.as_bytes();
    if token.is_empty() || a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 拆分 `/i/<token>/rest` 形式的路径，返回 (token, 剥离前缀后的路径)。
/// 不带该前缀时返回 None；`/i/<token>` 本身视为根路径 `/`。
pub fn split_instance_path(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix(INSTANCE_PATH_PREFIX)?;
    let (token, tail) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    if token.is_empty() {
        return None;
    }
    Some((token, tail))
}

pub fn header_matches_instance(headers: &HeaderMap, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    if header_eq(headers, INSTANCE_HEADER, token) || header_eq(headers, GATEWAY_AUTH_HEADER, token)
    {
        return true;
    }
    if let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        let value = value.trim();
        if let Some(rest) = value
            .strip_prefix("Bearer ")
            .or_else(|| value.strip_prefix("bearer "))
        {
            return token_eq(rest.trim(), token);
        }
    }
    false
}

fn header_eq(headers: &HeaderMap, name: &str, token: &str) -> bool {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| token_eq(v.trim(), token))
}

pub fn strip_instance_headers(headers: &mut HeaderMap, token: &str) {
    headers.remove(INSTANCE_HEADER);
    headers.remove(GATEWAY_AUTH_HEADER);
    if let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    {
        if let Some(rest) = value
            .trim()
            .strip_prefix("Bearer ")
            .or_else(|| value.trim().strip_prefix("bearer "))
        {
            if rest.trim() == token {
                headers.remove(axum::http::header::AUTHORIZATION);
            }
        }
    }
}

pub fn requires_instance_auth(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower == "/health" || lower.starts_with("/health?") {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn generated_token_is_unpredictable_length() {
        let a = generate_instance_token();
        let b = generate_instance_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    #[test]
    fn missing_or_wrong_token_is_rejected() {
        let mut headers = HeaderMap::new();
        assert!(!header_matches_instance(&headers, "abc"));
        headers.insert(INSTANCE_HEADER, HeaderValue::from_static("nope"));
        assert!(!header_matches_instance(&headers, "abc"));
    }

    #[test]
    fn bearer_and_custom_headers_are_accepted() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer secret-token"),
        );
        assert!(header_matches_instance(&headers, "secret-token"));
        headers.clear();
        headers.insert(INSTANCE_HEADER, HeaderValue::from_static("secret-token"));
        assert!(header_matches_instance(&headers, "secret-token"));
    }

    #[test]
    fn instance_headers_are_stripped_before_upstream() {
        let mut headers = HeaderMap::new();
        headers.insert(INSTANCE_HEADER, HeaderValue::from_static("secret-token"));
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer secret-token"),
        );
        headers.insert("x-api-key", HeaderValue::from_static("sk-real"));
        strip_instance_headers(&mut headers, "secret-token");
        assert!(headers.get(INSTANCE_HEADER).is_none());
        assert!(headers.get(axum::http::header::AUTHORIZATION).is_none());
        assert_eq!(headers.get("x-api-key").unwrap(), "sk-real");
    }

    #[test]
    fn instance_path_prefix_is_split() {
        assert_eq!(
            split_instance_path("/i/abc/api/adk/llm/generateContent"),
            Some(("abc", "/api/adk/llm/generateContent"))
        );
        assert_eq!(split_instance_path("/i/abc"), Some(("abc", "/")));
        assert_eq!(split_instance_path("/i/"), None);
        assert_eq!(split_instance_path("/i//api"), None);
        assert_eq!(split_instance_path("/api/adk/llm"), None);
        assert_eq!(split_instance_path("/item/x"), None);
    }

    #[test]
    fn token_eq_requires_exact_match() {
        assert!(token_eq("secret", "secret"));
        assert!(!token_eq("secreT", "secret"));
        assert!(!token_eq("secre", "secret"));
        assert!(!token_eq("", ""));
    }

    #[test]
    fn health_skips_auth_other_routes_require_it() {
        assert!(!requires_instance_auth("/health"));
        assert!(requires_instance_auth("/api/adk/llm"));
        assert!(requires_instance_auth("/api/llm/config/v2"));
        assert!(requires_instance_auth("/anything"));
    }
}

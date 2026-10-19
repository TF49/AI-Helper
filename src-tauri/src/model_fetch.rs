// Adapted from CC Switch f21e09449a11529341d2251c5ea19cb79e236d2d.
// See THIRD_PARTY_NOTICES.md for the upstream MIT license.
use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const ERROR_BODY_MAX_CHARS: usize = 512;
const KNOWN_COMPAT_SUFFIXES: &[&str] = &[
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
];

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct FetchedModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Option<Vec<FetchedModel>>,
}

pub async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<FetchedModel>, String> {
    let client = Client::builder()
        .redirect(crate::credential_policy::credentialed_redirect_policy())
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    fetch_models_with_client(&client, base_url, api_key).await
}

fn assert_fetch_endpoint(base_url: &str, api_key: &str) -> Result<(), String> {
    if crate::credential_policy::is_managed_key(api_key) {
        crate::credential_policy::assert_managed_key_destination(
            base_url,
            &crate::credential_policy::default_managed_origins(),
            crate::credential_policy::loopback_http_allowed(),
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let origin = crate::credential_policy::parse_origin(base_url).map_err(|e| e.to_string())?;
    if origin.scheme == "https" {
        return Ok(());
    }
    if origin.scheme == "http" && crate::credential_policy::is_loopback_host(&origin.host) {
        return Ok(());
    }
    Err(crate::credential_policy::PolicyError::HttpRemoteForbidden.to_string())
}

async fn fetch_models_with_client(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<FetchedModel>, String> {
    assert_fetch_endpoint(base_url, api_key)?;
    let candidates = model_endpoints(base_url)?;
    if api_key.is_empty() {
        return Err("API Key or request headers are required to fetch models".to_string());
    }
    let authorization = header::HeaderValue::from_str(&format!("Bearer {api_key}"))
        .map_err(|error| format!("Invalid API Key header value: {error}"))?;
    let mut last_error = None;

    // Claude and Codex forms in CC Switch both use OpenAI-compatible model discovery.
    for endpoint in candidates {
        let response = client
            .get(endpoint)
            .header(header::AUTHORIZATION, authorization.clone())
            .timeout(FETCH_TIMEOUT)
            .send()
            .await
            .map_err(|error| format!("Request failed: {error}"))?;
        let status = response.status();
        if status.is_success() {
            let payload: ModelsResponse = response
                .json()
                .await
                .map_err(|error| format!("Failed to parse response: {error}"))?;
            let mut models = payload.data.unwrap_or_default();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            return Ok(models);
        }

        let body = error_body(response.text().await.unwrap_or_default(), api_key);
        let error = format!("HTTP {status}: {body}");
        if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
            last_error = Some(error);
            continue;
        }
        return Err(error);
    }

    Err(format!(
        "All candidates failed: {}",
        last_error.unwrap_or_else(|| "no candidates".to_string())
    ))
}

fn model_endpoints(url: &str) -> Result<Vec<String>, String> {
    let base = url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Base URL is empty".to_string());
    }
    let mut endpoints = Vec::new();
    let last_segment = base.rsplit('/').next().unwrap_or_default();
    if last_segment.strip_prefix('v').is_some_and(|digits| {
        !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        endpoints.push(format!("{base}/models"));
        if !base.ends_with("/v1") {
            endpoints.push(format!("{base}/v1/models"));
        }
    } else {
        endpoints.push(format!("{base}/v1/models"));
    }

    for suffix in KNOWN_COMPAT_SUFFIXES {
        if let Some(root) = base.strip_suffix(suffix) {
            let root = root.trim_end_matches('/');
            if !root.is_empty() && root.contains("://") {
                endpoints.push(format!("{root}/v1/models"));
                endpoints.push(format!("{root}/models"));
            }
            break;
        }
    }

    let mut unique = Vec::with_capacity(endpoints.len());
    for endpoint in endpoints {
        if !unique.contains(&endpoint) {
            unique.push(endpoint);
        }
    }
    Ok(unique)
}

fn error_body(body: String, api_key: &str) -> String {
    let redacted = if api_key.is_empty() {
        body
    } else {
        body.replace(api_key, "[REDACTED]")
    };
    if redacted.chars().count() <= ERROR_BODY_MAX_CHARS {
        redacted
    } else {
        let mut truncated: String = redacted.chars().take(ERROR_BODY_MAX_CHARS).collect();
        truncated.push('\u{2026}');
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Instant;

    fn mock_server(
        responses: Vec<(u16, &'static str)>,
    ) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "Expected model request missing");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("Mock server failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                let read_deadline = Instant::now() + Duration::from_secs(5);
                while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    let count = match stream.read(&mut buffer) {
                        Ok(count) => count,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < read_deadline, "Read request timed out");
                            thread::sleep(Duration::from_millis(5));
                            continue;
                        }
                        Err(error) => panic!("Failed to read request: {error}"),
                    };
                    assert!(count > 0, "Incomplete model request");
                    request.extend_from_slice(&buffer[..count]);
                }
                requests.push(String::from_utf8(request).unwrap());
                write!(
                    stream,
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                ).unwrap();
                let _ = stream.flush();
            }
            requests
        });
        (url, server)
    }

    fn client() -> Client {
        Client::builder().no_proxy().build().unwrap()
    }

    #[test]
    fn root_and_version_candidates_match_cc_switch() {
        for base in [
            "https://example.com",
            " https://example.com/// ",
            "https://example.com/v1",
        ] {
            assert_eq!(
                model_endpoints(base).unwrap(),
                ["https://example.com/v1/models"]
            );
        }
        assert_eq!(
            model_endpoints("https://example.com/api/coding/paas/v4").unwrap(),
            [
                "https://example.com/api/coding/paas/v4/models",
                "https://example.com/api/coding/paas/v4/v1/models"
            ]
        );
        assert_eq!(
            model_endpoints("https://example.com/api").unwrap(),
            ["https://example.com/api/v1/models"]
        );
        assert!(model_endpoints(" / ").is_err());
    }

    #[test]
    fn every_compat_suffix_uses_the_same_fallback_order() {
        for suffix in KNOWN_COMPAT_SUFFIXES {
            assert_eq!(
                model_endpoints(&format!("https://example.com{suffix}")).unwrap(),
                [
                    format!("https://example.com{suffix}/v1/models"),
                    "https://example.com/v1/models".into(),
                    "https://example.com/models".into()
                ]
            );
        }
    }

    #[tokio::test]
    async fn bearer_auth_sorting_and_ownership_match_cc_switch() {
        let (url, server) = mock_server(vec![(
            200,
            r#"{"data":[{"id":"z","owned_by":"vendor"},{"id":"a"},{"id":"a"},{"id":" padded "}]}"#,
        )]);
        let models = fetch_models_with_client(&client(), &url, "test-key")
            .await
            .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /v1/models HTTP/1.1"));
        let request = requests[0].to_lowercase();
        assert!(request.contains("authorization: bearer test-key\r\n"));
        assert!(!request.contains("x-api-key:"));
        assert!(!request.contains("anthropic-version:"));
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            [" padded ", "a", "a", "z"]
        );
        assert_eq!(
            serde_json::to_value(&models[3]).unwrap(),
            json_model("z", "vendor")
        );
        assert!(models[1].owned_by.is_none());
    }

    fn json_model(id: &str, vendor: &str) -> serde_json::Value {
        serde_json::json!({"id": id, "ownedBy": vendor})
    }

    #[tokio::test]
    async fn only_404_and_405_advance_to_the_next_candidate() {
        let (url, server) = mock_server(vec![
            (404, "missing"),
            (405, "unsupported"),
            (200, r#"{"data":[{"id":"claude-opus-5"}]}"#),
        ]);
        let models = fetch_models_with_client(&client(), &format!("{url}/api/anthropic"), "key")
            .await
            .unwrap();
        assert_eq!(models[0].id, "claude-opus-5");
        let requests = server.join().unwrap();
        for (request, path) in
            requests
                .iter()
                .zip(["/api/anthropic/v1/models", "/v1/models", "/models"])
        {
            assert!(request.starts_with(&format!("GET {path} HTTP/1.1")));
        }
    }

    #[tokio::test]
    async fn all_missing_candidates_report_the_last_response() {
        let (url, server) = mock_server(vec![(404, "first"), (405, "second"), (404, "last")]);
        let error = fetch_models_with_client(&client(), &format!("{url}/anthropic"), "key")
            .await
            .unwrap_err();
        assert!(error.starts_with("All candidates failed: HTTP 404"));
        assert!(error.ends_with("last"));
        assert_eq!(server.join().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn auth_and_server_errors_stop_without_fallback() {
        for status in [401, 403, 429, 500] {
            let (url, server) = mock_server(vec![(status, "invalid test-key")]);
            let error =
                fetch_models_with_client(&client(), &format!("{url}/anthropic"), "test-key")
                    .await
                    .unwrap_err();
            assert!(error.starts_with(&format!("HTTP {status}")));
            assert!(error.ends_with("invalid [REDACTED]"));
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn empty_and_missing_data_are_successful_empty_lists() {
        for body in [r#"{"data":[]}"#, r#"{"data":null}"#, "{}"] {
            let (url, server) = mock_server(vec![(200, body)]);
            assert!(fetch_models_with_client(&client(), &url, "key")
                .await
                .unwrap()
                .is_empty());
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn malformed_success_response_reports_parse_error() {
        for body in [
            "<html>not JSON</html>",
            r#"{"data":[{"name":"missing-id"}]}"#,
        ] {
            let (url, server) = mock_server(vec![(200, body)]);
            let error = fetch_models_with_client(&client(), &format!("{url}/anthropic"), "key")
                .await
                .unwrap_err();
            assert!(error.starts_with("Failed to parse response:"));
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn missing_and_invalid_keys_fail_before_network_access() {
        for key in ["", "bad\nkey"] {
            let error = fetch_models_with_client(&client(), "http://127.0.0.1:1", key)
                .await
                .unwrap_err();
            assert!(error.contains("API Key"));
        }
    }

    #[tokio::test]
    async fn managed_key_rejects_unauthorized_destination() {
        let managed_key = "sk-managed-test-model-fetch-01";
        crate::credential_policy::register_managed_key(managed_key);
        let error = fetch_models_with_client(
            &client(),
            "https://unauthorized-destination.com",
            managed_key,
        )
        .await
        .unwrap_err();
        assert!(error.contains("受管 Key 不得发往未授权目标"));
    }

    #[test]
    fn error_body_redacts_before_unicode_safe_truncation() {
        let body = format!("test-key{}", "\u{4e2d}".repeat(600));
        let error = error_body(body, "test-key");
        assert!(error.starts_with("[REDACTED]"));
        assert!(!error.contains("test-key"));
        assert_eq!(error.chars().count(), 513);
        assert!(error.ends_with('\u{2026}'));
    }
}

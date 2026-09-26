use std::time::{Duration, Instant};

pub const BOB_API_URL: &str = "https://bob-api.com/";
const CHECK_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(serde::Serialize, Clone, Debug)]
pub struct NetworkStatus {
    pub reachable: bool,
    pub target_url: String,
    pub status_code: Option<u16>,
    pub latency_ms: Option<u64>,
    pub error_message: Option<String>,
}

pub async fn check_bob_api_network() -> NetworkStatus {
    let start = Instant::now();
    // Build HTTP client with timeout configuration
    let client = match reqwest::Client::builder().timeout(CHECK_TIMEOUT).build() {
        Ok(c) => c,
        Err(e) => {
            return NetworkStatus {
                reachable: false,
                target_url: BOB_API_URL.to_string(),
                status_code: None,
                latency_ms: None,
                error_message: Some(format!("HTTP 客户端构建失败: {e}")),
            };
        }
    };

    // Attempt HTTPS GET request to validate actual HTTP-level connectivity
    match client.get(BOB_API_URL).send().await {
        Ok(response) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let status = response.status();
            let status_code = status.as_u16();
            let reachable = status_code < 500;
            NetworkStatus {
                reachable,
                target_url: BOB_API_URL.to_string(),
                status_code: Some(status_code),
                latency_ms: Some(latency_ms),
                error_message: if reachable {
                    None
                } else {
                    Some(format!("HTTP 响应状态码异常: {}", status))
                },
            }
        }
        Err(err) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let mut err_msg = "网络请求失败: ".to_string();
            if err.is_timeout() {
                err_msg.push_str("连接超时(5秒)，无法连接至指定站点，请检查网络或开启代理");
            } else if err.is_connect() {
                err_msg.push_str("目标服务器连接失败或DNS无法解析，请检查本地网络配置");
            } else {
                err_msg.push_str(&err.to_string());
            }

            NetworkStatus {
                reachable: false,
                target_url: BOB_API_URL.to_string(),
                status_code: None,
                latency_ms: Some(latency_ms),
                error_message: Some(err_msg),
            }
        }
    }
}

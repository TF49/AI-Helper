/// 更新检查模块
/// 完全复用 Antigravity-Manager (https://github.com/lbjlaq/Antigravity-Manager) 的自动更新检测逻辑：
///   1. 支持系统环境变量代理 (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY)
///   2. 多源检测策略：
///      - Source 1: updater.json (latest.json，Tauri 原生自动更新的最权威源)
///      - Source 2: GitHub Releases API
///      - Source 3: GitHub Raw (package.json)
///      - Source 4: jsDelivr CDN (package.json)
///   3. 语义化版本比对 compare_versions
///   4. 返回携带 proxy_url 的 UpdateInfo 供前端及 Tauri updater 使用

use serde::{Deserialize, Serialize};
use std::time::Duration;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const UPDATER_JSON_URL: &str =
    "https://github.com/TF49/Bobapi-Tool/releases/latest/download/latest.json";
const GITHUB_API_URL: &str =
    "https://api.github.com/repos/TF49/Bobapi-Tool/releases/latest";
const GITHUB_RAW_URL: &str =
    "https://raw.githubusercontent.com/TF49/Bobapi-Tool/main/package.json";
const JSDELIVR_URL: &str =
    "https://cdn.jsdelivr.net/gh/TF49/Bobapi-Tool@main/package.json";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub download_url: String,
    pub release_notes: String,
    pub published_at: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub proxy_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdaterJson {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    pub_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PackageJson {
    version: String,
}

/// 获取上游或系统环境代理
pub fn get_upstream_proxy_url() -> Option<String> {
    for env_var in &[
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ] {
        if let Ok(val) = std::env::var(env_var) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                let normalized = if !trimmed.contains("://") {
                    format!("http://{}", trimmed)
                } else {
                    trimmed.to_string()
                };
                return Some(normalized);
            }
        }
    }
    None
}

/// 创建带代理和超时的 HTTP 客户端
async fn create_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("BobAPI-Tool/{}", CURRENT_VERSION))
        .timeout(REQUEST_TIMEOUT);

    if let Some(proxy_url) = get_upstream_proxy_url() {
        log::info!("Update checker using upstream proxy: {}", proxy_url);
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        } else {
            log::warn!("Failed to parse proxy URL '{}'", proxy_url);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// 语义化版本比对（如 "1.0.8" vs "1.0.1"）
fn compare_versions(latest: &str, current: &str) -> bool {
    let parse_version = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };

    let latest_parts = parse_version(latest);
    let current_parts = parse_version(current);

    for i in 0..latest_parts.len().max(current_parts.len()) {
        let latest_part = latest_parts.get(i).unwrap_or(&0);
        let current_part = current_parts.get(i).unwrap_or(&0);

        if latest_part > current_part {
            return true;
        } else if latest_part < current_part {
            return false;
        }
    }

    false
}

/// 检查更新对外主入口：按优先级 fallback
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let mut info = check_for_updates_internal().await?;
    info.proxy_url = get_upstream_proxy_url();
    Ok(info)
}

async fn check_for_updates_internal() -> Result<UpdateInfo, String> {
    // 1. 优先 updater.json (latest.json)
    match check_updater_json().await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "updater.json check failed: {}. Trying GitHub API...",
                e
            );
        }
    }

    // 2. 回退 GitHub Releases API
    match check_github_api().await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "GitHub API check failed: {}. Trying GitHub Raw...",
                e
            );
        }
    }

    // 3. 回退 GitHub Raw (package.json)
    match check_static_url(GITHUB_RAW_URL, "GitHub Raw").await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "GitHub Raw check failed: {}. Trying jsDelivr CDN...",
                e
            );
        }
    }

    // 4. 回退 jsDelivr CDN
    match check_static_url(JSDELIVR_URL, "jsDelivr").await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::error!("All update checks failed. Last error: {}", e);
            Err(e)
        }
    }
}

async fn check_updater_json() -> Result<UpdateInfo, String> {
    let client = create_client().await?;
    log::info!("Checking for updates via updater.json...");

    let response = client
        .get(UPDATER_JSON_URL)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "updater.json returned status: {}",
            response.status()
        ));
    }

    let updater_info: UpdaterJson = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse updater.json: {}", e))?;

    let latest_version = updater_info.version.trim_start_matches('v').to_string();
    let current_version = CURRENT_VERSION.to_string();
    let has_update = compare_versions(&latest_version, &current_version);

    if has_update {
        log::info!(
            "New version found (updater.json): {} (Current: {})",
            latest_version, current_version
        );
    } else {
        log::info!(
            "Up to date (updater.json): {} (Matches {})",
            current_version, latest_version
        );
    }

    let download_url = format!(
        "https://github.com/TF49/Bobapi-Tool/releases/tag/v{}",
        latest_version
    );

    Ok(UpdateInfo {
        current_version,
        latest_version,
        has_update,
        download_url,
        release_notes: updater_info
            .notes
            .unwrap_or_else(|| "Release notes available on GitHub.".to_string()),
        published_at: updater_info.pub_date.unwrap_or_default(),
        source: Some("updater.json".to_string()),
        proxy_url: None,
    })
}

async fn check_github_api() -> Result<UpdateInfo, String> {
    let client = create_client().await?;
    log::info!("Checking for updates via GitHub API...");

    let response = client
        .get(GITHUB_API_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let current_version = CURRENT_VERSION.to_string();
    let has_update = compare_versions(&latest_version, &current_version);

    if has_update {
        log::info!(
            "New version found (API): {} (Current: {})",
            latest_version, current_version
        );
    } else {
        log::info!(
            "Up to date (API): {} (Matches {})",
            current_version, latest_version
        );
    }

    Ok(UpdateInfo {
        current_version,
        latest_version,
        has_update,
        download_url: release.html_url,
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        source: Some("GitHub API".to_string()),
        proxy_url: None,
    })
}

async fn check_static_url(url: &str, source_name: &str) -> Result<UpdateInfo, String> {
    let client = create_client().await?;
    log::info!("Checking for updates via {}...", source_name);

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("{} returned status: {}", source_name, response.status()));
    }

    let package_json: PackageJson = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse package.json: {}", e))?;

    let latest_version = package_json.version.trim_start_matches('v').to_string();
    let current_version = CURRENT_VERSION.to_string();
    let has_update = compare_versions(&latest_version, &current_version);

    if has_update {
        log::info!(
            "New version found ({}): {} (Current: {})",
            source_name, latest_version, current_version
        );
    } else {
        log::info!(
            "Up to date ({}): {} (Matches {})",
            source_name, current_version, latest_version
        );
    }

    let download_url = "https://github.com/TF49/Bobapi-Tool/releases/latest".to_string();
    let release_notes = format!(
        "New version detected via {}. Please check release page for details.",
        source_name
    );

    Ok(UpdateInfo {
        current_version,
        latest_version,
        has_update,
        download_url,
        release_notes,
        published_at: String::new(),
        source: Some(source_name.to_string()),
        proxy_url: None,
    })
}

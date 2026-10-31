/// 更新检查与多源容灾下载模块
/// 针对国内网络、VPN 代理环境、死代理残留、镜像源单点故障等复杂场景进行了全面加固：
///   1. 智能代理嗅探与死代理自愈（检测环境变量与 Windows 注册表 WinINet 代理，并进行 200ms TCP 握手探测，自动规避 10061 积极拒绝错误）
///   2. 多通道 Manifest 检测（ghfast.top / gh-proxy.com / ghproxy.net / 官方 GitHub / jsDelivr / GitHub Raw / GitHub API）
///   3. 多源容灾自动下载器（download_and_install_update）：
///      - 支持官方直链、ghfast、gh-proxy、ghproxy.net 自动竞速与故障自动秒切
///      - 支持流式分块写入、实时进度回显与源切换事件广播
///      - 下载校验完成后自动调起 Windows 安装程序并退出应用生效
use crate::update_trust::{
    self, current_platform_key, is_newer, load_trust_state, record_accepted_install,
    save_trust_state, select_trusted_update, TrustError, UntrustedVersionClaim, UpdateSelection,
    VerifiedManifest, TAURI_UPDATER_PUBKEY_B64,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
/// 本站自托管更新元数据（第一优先级，国内直连稳定）
const UPDATER_JSON_LOCAL_URL: &str = "https://helper.bob-api.com/downloads/latest.json";
const UPDATER_JSON_MIRROR_URL: &str =
    "https://ghfast.top/https://github.com/TF49/AI-Helper/releases/latest/download/latest.json";
const UPDATER_JSON_MIRROR_BACKUP_URL: &str =
    "https://gh-proxy.com/https://github.com/TF49/AI-Helper/releases/latest/download/latest.json";
const UPDATER_JSON_MIRROR_BACKUP2_URL: &str =
    "https://ghproxy.net/https://github.com/TF49/AI-Helper/releases/latest/download/latest.json";
const UPDATER_JSON_OFFICIAL_URL: &str =
    "https://github.com/TF49/AI-Helper/releases/latest/download/latest.json";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(any(target_os = "windows", test))]
const WINDOWS_UPDATE_INSTALLER_ARGS: [&str; 4] = ["/P", "/R", "/UPDATE", "/ARGS"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateMirror {
    pub name: String,
    pub url: String,
}

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
    #[serde(default)]
    pub candidate_mirrors: Vec<CandidateMirror>,
    #[serde(default)]
    pub manifest_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    #[serde(rename = "Started")]
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
        source: String,
    },
    #[serde(rename = "Progress")]
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
        downloaded: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: u64,
    },
    #[serde(rename = "SwitchSource")]
    SwitchSource {
        #[serde(rename = "fromSource")]
        from_source: String,
        #[serde(rename = "toSource")]
        to_source: String,
        reason: String,
    },
    #[serde(rename = "Finished")]
    Finished,
}

fn trust_app_dir() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".ai-helper")
}

fn signature_url_for(manifest_url: &str) -> String {
    format!("{}.sig", manifest_url.trim_end_matches('/'))
}

/// 解析 host 和 port
fn parse_host_port(proxy_url: &str) -> Option<(String, u16)> {
    let clean = proxy_url
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_start_matches("socks5://")
        .trim_start_matches("socks5h://");
    let host_port = clean.split('/').next()?;
    let mut parts = host_port.split(':');
    let host = parts.next()?.to_string();
    let port = parts
        .next()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(80);
    Some((host, port))
}

/// 快速验证代理端口是否真正存活（防止用户关闭 VPN 后残留死代理导致 10061 积极拒绝错误）
pub fn is_proxy_alive(proxy_url: &str) -> bool {
    if let Some((host, port)) = parse_host_port(proxy_url) {
        use std::net::{TcpStream, ToSocketAddrs};
        let addr_str = format!("{}:{}", host, port);
        if let Ok(mut addrs) = addr_str.to_socket_addrs() {
            if let Some(addr) = addrs.next() {
                if let Ok(stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
                    drop(stream);
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn get_windows_system_proxy() -> Option<String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(settings) =
        hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
    {
        let proxy_enable: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
        if proxy_enable == 1 {
            let proxy_server: String = settings.get_value("ProxyServer").unwrap_or_default();
            let trimmed = proxy_server.trim();
            if !trimmed.is_empty() {
                let server = if trimmed.contains(';') {
                    trimmed
                        .split(';')
                        .find(|s| s.starts_with("https=") || s.starts_with("http="))
                        .map(|s| s.split('=').nth(1).unwrap_or(""))
                        .unwrap_or(trimmed)
                } else {
                    trimmed
                };
                let normalized = if !server.contains("://") {
                    format!("http://{}", server)
                } else {
                    server.to_string()
                };
                return Some(normalized);
            }
        }
    }
    None
}

/// 获取当前配置的代理 URL（环境变量 + Windows 注册表）
pub fn get_configured_proxy_url() -> Option<String> {
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

    #[cfg(target_os = "windows")]
    {
        if let Some(reg_proxy) = get_windows_system_proxy() {
            return Some(reg_proxy);
        }
    }

    None
}

/// 获取经过连通性验证的有效代理；若配置了代理但端口已关闭（如关掉了VPN），则返回 None
pub fn get_upstream_proxy_url() -> Option<String> {
    if let Some(proxy_url) = get_configured_proxy_url() {
        if is_proxy_alive(&proxy_url) {
            log::info!("Verified active proxy found: {}", proxy_url);
            return Some(proxy_url);
        } else {
            log::warn!(
                "Proxy '{}' is configured in environment/registry but connection was refused. Bypassing proxy to direct connection.",
                proxy_url
            );
        }
    }
    None
}

static PROXY_CACHE: std::sync::Mutex<Option<(std::time::Instant, Option<String>)>> =
    std::sync::Mutex::new(None);

/// 获取带轻量级缓存 (TTL 3秒) 的可用代理配置，避免高频请求重复进行 TCP 端口握手探测
pub fn get_cached_upstream_proxy_url() -> Option<String> {
    if let Ok(guard) = PROXY_CACHE.lock() {
        if let Some((timestamp, ref cached_val)) = *guard {
            if timestamp.elapsed() < Duration::from_secs(3) {
                return cached_val.clone();
            }
        }
    }

    let now = std::time::Instant::now();
    let fresh = get_upstream_proxy_url();
    if let Ok(mut guard) = PROXY_CACHE.lock() {
        *guard = Some((now, fresh.clone()));
    }
    fresh
}

/// 创建带安全策略的 HTTP 客户端（用于常规 API 交互与配置嗅探）
pub fn create_client(timeout: Duration) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", CURRENT_VERSION))
        .connect_timeout(timeout.min(Duration::from_secs(15)))
        .timeout(timeout);

    if let Some(proxy_url) = get_upstream_proxy_url() {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
            return builder
                .build()
                .map_err(|e| format!("Failed to create HTTP client with proxy: {}", e));
        }
    }

    // 显式指定 no_proxy，彻底免疫 Windows 注册表死代理残留（10061 积极拒绝错误）
    builder = builder.no_proxy();
    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// 创建专用于大文件流式下载的 HTTP 客户端
/// 配置连接超时与 TCP Keepalive，并给予最长 30 分钟生命周期，避免大文件在低带宽下被全局超时掐断
pub fn create_download_client(connect_timeout: Duration) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", CURRENT_VERSION))
        .connect_timeout(connect_timeout)
        .tcp_keepalive(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800));

    if let Some(proxy_url) = get_upstream_proxy_url() {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
            return builder
                .build()
                .map_err(|e| format!("Failed to create HTTP download client with proxy: {}", e));
        }
    }

    builder = builder.no_proxy();
    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP download client: {}", e))
}

/// 创建强制直连（绕过系统/环境代理）的下载客户端，专门用于国内 CDN 节点在代理环境下故障时的容灾重试
#[allow(dead_code)]
pub fn create_direct_download_client(connect_timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", CURRENT_VERSION))
        .connect_timeout(connect_timeout)
        .tcp_keepalive(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to create direct HTTP download client: {}", e))
}

#[cfg_attr(not(test), allow(dead_code))]
fn compare_versions(latest: &str, current: &str) -> bool {
    is_newer(latest, current)
}

/// 获取全平台候选下载镜像源列表
fn installer_name_for_platform(version: &str, platform: &str) -> String {
    let clean_ver = version.trim_start_matches('v');
    let suffix = match platform {
        "darwin-aarch64" => "macOS-aarch64.dmg",
        "darwin-x86_64" => "macOS-x64.dmg",
        _ => "Windows-x64-Setup.exe",
    };
    format!("AI-Helper-v{}-{}", clean_ver, suffix)
}

pub fn get_candidate_mirrors(version: &str) -> Vec<CandidateMirror> {
    let clean_ver = version.trim_start_matches('v');
    let installer_name = installer_name_for_platform(version, current_platform_key());

    let local_mirror = CandidateMirror {
        name: "本站直链 (helper.bob-api.com)".to_string(),
        url: format!("https://helper.bob-api.com/downloads/{}", installer_name),
    };
    let oss_mirror = CandidateMirror {
        name: "阿里云 OSS 高速镜像".to_string(),
        url: format!(
            "https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/{}",
            installer_name
        ),
    };
    let official = CandidateMirror {
        name: "GitHub 官方直链 (带 VPN 极速)".to_string(),
        url: format!(
            "https://github.com/TF49/AI-Helper/releases/download/v{}/{}",
            clean_ver, installer_name
        ),
    };
    let ghfast = CandidateMirror {
        name: "国内高速镜像 1 (ghfast)".to_string(),
        url: format!(
            "https://ghfast.top/https://github.com/TF49/AI-Helper/releases/download/v{}/{}",
            clean_ver, installer_name
        ),
    };
    let gh_proxy = CandidateMirror {
        name: "国内高速镜像 2 (gh-proxy)".to_string(),
        url: format!(
            "https://gh-proxy.com/https://github.com/TF49/AI-Helper/releases/download/v{}/{}",
            clean_ver, installer_name
        ),
    };
    let ghproxy_net = CandidateMirror {
        name: "国内高速镜像 3 (ghproxy.net)".to_string(),
        url: format!(
            "https://ghproxy.net/https://github.com/TF49/AI-Helper/releases/download/v{}/{}",
            clean_ver, installer_name
        ),
    };

    // 本站直链与阿里云 OSS 高速镜像始终位于前列（国内直连，千兆带宽）
    // 若检测到有效代理（VPN 已开启），官方 GitHub 提升优先级；否则国内镜像次之
    if get_upstream_proxy_url().is_some() {
        vec![
            local_mirror,
            oss_mirror,
            official,
            gh_proxy,
            ghfast,
            ghproxy_net,
        ]
    } else {
        vec![
            local_mirror,
            oss_mirror,
            ghfast,
            gh_proxy,
            ghproxy_net,
            official,
        ]
    }
}

/// 检查更新对外主入口：按优先级 fallback 并附带多镜像候选列表
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let mut info = check_for_updates_internal().await?;
    info.proxy_url = get_upstream_proxy_url();
    info.candidate_mirrors = get_candidate_mirrors(&info.latest_version);
    Ok(info)
}

async fn check_for_updates_internal() -> Result<UpdateInfo, String> {
    let platform = current_platform_key();
    let state = load_trust_state(&trust_app_dir(), CURRENT_VERSION).map_err(|e| e.to_string())?;
    let official = match fetch_signed_manifest(
        UPDATER_JSON_LOCAL_URL,
        "updater.json (本站 helper.bob-api.com)",
    )
    .await
    {
        Ok(m) => Some(Ok(m)),
        Err(_) => {
            match fetch_signed_manifest(UPDATER_JSON_OFFICIAL_URL, "updater.json (GitHub 官方直连)")
                .await
            {
                Ok(m) => Some(Ok(m)),
                Err(e) => Some(Err(e)),
            }
        }
    };

    let mut claims = Vec::new();
    for (url, name) in [
        (UPDATER_JSON_OFFICIAL_URL, "updater.json (GitHub 官方直连)"),
        (UPDATER_JSON_MIRROR_URL, "updater.json (ghfast)"),
        (UPDATER_JSON_MIRROR_BACKUP_URL, "updater.json (gh-proxy)"),
        (
            UPDATER_JSON_MIRROR_BACKUP2_URL,
            "updater.json (ghproxy.net)",
        ),
    ] {
        match fetch_signed_manifest(url, name).await {
            Ok(verified) => claims.push(UntrustedVersionClaim {
                source: name.to_string(),
                version: verified.manifest.version.clone(),
                verified: Some(verified),
            }),
            Err(err) => {
                log::warn!("{} 未通过签名清单校验: {}", name, err);
                claims.push(UntrustedVersionClaim {
                    source: name.to_string(),
                    version: "0.0.0".to_string(),
                    verified: None,
                });
            }
        }
    }

    let selection =
        select_trusted_update(CURRENT_VERSION, official.clone(), &claims, &state, platform)
            .map_err(|e| e.to_string())?;

    let (latest_version, has_update, notes, published_at, download_url, source) = match &selection {
        UpdateSelection::NoUpdate { latest_version } => (
            latest_version.clone(),
            false,
            "已是最新版本".to_string(),
            String::new(),
            format!(
                "https://github.com/TF49/AI-Helper/releases/tag/v{}",
                latest_version
            ),
            Some("signed-manifest".to_string()),
        ),
        UpdateSelection::Update { version, .. } => {
            let verified = official
                .as_ref()
                .and_then(|r| r.as_ref().ok())
                .filter(|v| update_trust::normalize_version(&v.manifest.version) == *version)
                .cloned()
                .or_else(|| {
                    claims
                        .iter()
                        .filter_map(|c| c.verified.as_ref())
                        .find(|v| update_trust::normalize_version(&v.manifest.version) == *version)
                        .cloned()
                });
            let (notes, published_at, download_url) = if let Some(v) = verified {
                let artifact = v.manifest.platforms.get(platform);
                (
                    v.manifest.notes.clone().unwrap_or_default(),
                    v.manifest.pub_date.clone().unwrap_or_default(),
                    artifact.map(|a| a.url.clone()).unwrap_or_else(|| {
                        format!(
                            "https://github.com/TF49/AI-Helper/releases/tag/v{}",
                            version
                        )
                    }),
                )
            } else {
                (
                    String::new(),
                    String::new(),
                    format!(
                        "https://github.com/TF49/AI-Helper/releases/tag/v{}",
                        version
                    ),
                )
            };
            (
                version.clone(),
                true,
                notes,
                published_at,
                download_url,
                Some("signed-manifest".to_string()),
            )
        }
    };

    Ok(UpdateInfo {
        current_version: CURRENT_VERSION.to_string(),
        latest_version,
        has_update,
        download_url,
        release_notes: notes,
        published_at,
        source,
        proxy_url: None,
        candidate_mirrors: Vec::new(),
        manifest_verified: true,
    })
}

async fn fetch_signed_manifest(
    url: &str,
    source_name: &str,
) -> Result<VerifiedManifest, TrustError> {
    let client = create_client(REQUEST_TIMEOUT).map_err(TrustError::ReadFailed)?;
    log::info!("Checking for signed updates via {}...", source_name);

    let cache_buster = chrono::Utc::now().timestamp_millis();
    let url_with_buster = if url.contains('?') {
        format!("{}&_t={}", url, cache_buster)
    } else {
        format!("{}?_t={}", url, cache_buster)
    };

    let response = client
        .get(&url_with_buster)
        .header(
            reqwest::header::CACHE_CONTROL,
            "no-cache, no-store, max-age=0",
        )
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    if !response.status().is_success() {
        return Err(TrustError::MissingManifest);
    }
    let json = response
        .bytes()
        .await
        .map_err(|e| TrustError::ReadFailed(e.to_string()))?;

    let sig_url = signature_url_for(url);
    let sig_url_with_buster = if sig_url.contains('?') {
        format!("{}&_t={}", sig_url, cache_buster)
    } else {
        format!("{}?_t={}", sig_url, cache_buster)
    };

    let sig_response = client
        .get(&sig_url_with_buster)
        .header(
            reqwest::header::CACHE_CONTROL,
            "no-cache, no-store, max-age=0",
        )
        .header(reqwest::header::PRAGMA, "no-cache")
        .send()
        .await
        .map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    if !sig_response.status().is_success() {
        return Err(TrustError::MissingSignature);
    }
    let signature = sig_response
        .text()
        .await
        .map_err(|e| TrustError::ReadFailed(e.to_string()))?;

    update_trust::verify_signed_manifest(
        &json,
        Some(&signature),
        TAURI_UPDATER_PUBKEY_B64,
        current_platform_key(),
        chrono::Utc::now(),
    )
}

async fn resolve_verified_artifact(
    version: &str,
) -> Result<(VerifiedManifest, update_trust::PlatformArtifact), String> {
    let platform = current_platform_key();
    let state = load_trust_state(&trust_app_dir(), CURRENT_VERSION).map_err(|e| e.to_string())?;
    let sources = [
        UPDATER_JSON_LOCAL_URL,
        UPDATER_JSON_OFFICIAL_URL,
        UPDATER_JSON_MIRROR_URL,
        UPDATER_JSON_MIRROR_BACKUP_URL,
        UPDATER_JSON_MIRROR_BACKUP2_URL,
    ];
    let mut found: Option<VerifiedManifest> = None;
    for url in sources {
        if let Ok(verified) = fetch_signed_manifest(url, url).await {
            if update_trust::normalize_version(&verified.manifest.version)
                == update_trust::normalize_version(version)
            {
                found = Some(verified);
                break;
            }
        }
    }
    let verified = found.ok_or_else(|| TrustError::MissingManifest.to_string())?;
    update_trust::assert_artifact_allowed(&verified, CURRENT_VERSION, &state, platform)
        .map_err(|e| e.to_string())?;
    let artifact = verified
        .manifest
        .platforms
        .get(platform)
        .cloned()
        .ok_or_else(|| TrustError::MissingPlatformEntry(platform.to_string()).to_string())?;
    if artifact.signature.trim().is_empty() {
        return Err(TrustError::MissingSignature.to_string());
    }
    Ok((verified, artifact))
}

/// 计算本地文件的 SHA-256 哈希值 (小写十六进制)
#[cfg_attr(not(test), allow(dead_code))]
pub fn compute_file_sha256(path: &std::path::Path) -> Result<String, String> {
    update_trust::sha256_file(path).map_err(|e| e.to_string())
}

/// 尝试从各备选镜像与官方源获取该版本权威的 SHA256SUMS.txt
async fn fetch_release_sha256sums(client: &reqwest::Client, version: &str) -> Option<String> {
    let clean_ver = version.trim_start_matches('v');
    let candidate_urls = [
        "https://helper.bob-api.com/downloads/SHA256SUMS.txt".to_string(),
        format!(
            "https://github.com/TF49/AI-Helper/releases/download/v{}/SHA256SUMS.txt",
            clean_ver
        ),
        format!(
            "https://ghfast.top/https://github.com/TF49/AI-Helper/releases/download/v{}/SHA256SUMS.txt",
            clean_ver
        ),
        format!(
            "https://gh-proxy.com/https://github.com/TF49/AI-Helper/releases/download/v{}/SHA256SUMS.txt",
            clean_ver
        ),
        format!(
            "https://ghproxy.net/https://github.com/TF49/AI-Helper/releases/download/v{}/SHA256SUMS.txt",
            clean_ver
        ),
    ];

    for url in &candidate_urls {
        let cache_buster = chrono::Utc::now().timestamp_millis();
        let url_with_buster = if url.contains('?') {
            format!("{}&_t={}", url, cache_buster)
        } else {
            format!("{}?_t={}", url, cache_buster)
        };

        if let Ok(resp) = client
            .get(&url_with_buster)
            .header(
                reqwest::header::CACHE_CONTROL,
                "no-cache, no-store, max-age=0",
            )
            .header(reqwest::header::PRAGMA, "no-cache")
            .timeout(Duration::from_secs(8))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if text.contains(&format!("AI-Helper-v{}", clean_ver))
                        || text.contains(&format!("AI-Helper-{}", clean_ver))
                    {
                        log::info!("成功从 {} 获取到权威 SHA256SUMS 校验清单", url);
                        return Some(text);
                    }
                }
            }
        }
    }
    None
}

/// 从 SHA256SUMS.txt 文本中解析指定安装包名称对应的预期哈希值
pub fn parse_expected_hash(sums_text: &str, file_name: &str) -> Option<String> {
    for line in sums_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            let hash = parts[0];
            let name = parts[1].trim_start_matches('*');
            if name.eq_ignore_ascii_case(file_name) {
                return Some(hash.to_lowercase());
            }
        }
    }
    None
}

/// 多源容灾自动下载并在验签通过后启动更新安装包。
/// 未通过签名、平台或防重放检查的文件不会进入可启动路径。
pub async fn download_and_install_update(
    version: String,
    on_event: tauri::ipc::Channel<UpdateDownloadEvent>,
) -> Result<(), String> {
    let clean_ver = version.trim_start_matches('v');
    let (verified, artifact) = resolve_verified_artifact(clean_ver).await?;
    let platform = current_platform_key();
    let staging = update_trust::create_secure_update_staging_dir().map_err(|e| e.to_string())?;
    let temp_file_path = update_trust::staging_payload_path(staging.path(), platform);

    let mut candidate_mirrors = vec![CandidateMirror {
        name: "清单指定下载地址".to_string(),
        url: artifact.url.clone(),
    }];
    candidate_mirrors.extend(get_candidate_mirrors(clean_ver));

    // 使用大文件流式下载客户端，避免全局超时掐断下载
    let client = create_download_client(Duration::from_secs(30))?;
    let mut last_error = String::new();

    for (idx, mirror) in candidate_mirrors.iter().enumerate() {
        if !mirror.url.starts_with("https://") {
            last_error = "拒绝非 HTTPS 更新下载地址".to_string();
            continue;
        }

        log::info!(
            "Attempting to download update from [{}]: {}",
            mirror.name,
            mirror.url
        );

        if idx > 0 {
            let prev_mirror = &candidate_mirrors[idx - 1];
            let _ = on_event.send(UpdateDownloadEvent::SwitchSource {
                from_source: prev_mirror.name.clone(),
                to_source: mirror.name.clone(),
                reason: if last_error.is_empty() {
                    "连接中断或超时".to_string()
                } else {
                    last_error.clone()
                },
            });
        }

        let resp_res = client.get(&mirror.url).send().await;
        let mut response = match resp_res {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_error = format!("HTTP 状态码: {}", resp.status());
                    log::warn!(
                        "Source {} returned non-success: {}",
                        mirror.name,
                        last_error
                    );
                    continue;
                }
                resp
            }
            Err(e) => {
                last_error = format!("请求失败: {}", e);
                log::warn!("Failed to connect to {}: {}", mirror.name, e);
                continue;
            }
        };

        let content_length = response.content_length();
        let _ = on_event.send(UpdateDownloadEvent::Started {
            content_length,
            source: mirror.name.clone(),
        });

        // 尝试打开临时写入文件
        let mut file = match std::fs::File::create(&temp_file_path) {
            Ok(f) => f,
            Err(e) => {
                let err_msg = format!("无法创建临时安装包文件: {}", e);
                log::error!("{}", err_msg);
                return Err(err_msg);
            }
        };

        let mut downloaded: u64 = 0;
        let mut stream_failed = false;

        use std::io::Write;
        loop {
            let chunk_opt =
                match tokio::time::timeout(Duration::from_secs(45), response.chunk()).await {
                    Ok(res) => res,
                    Err(_) => {
                        last_error = "下载传输超时停滞（45秒未收到新数据）".to_string();
                        log::warn!("Stream chunk timed out from {}", mirror.name);
                        stream_failed = true;
                        break;
                    }
                };

            match chunk_opt {
                Ok(Some(chunk)) => {
                    let chunk_len = chunk.len();
                    if let Err(e) = file.write_all(&chunk) {
                        log::error!("Failed to write chunk to disk: {}", e);
                        last_error = format!("写入磁盘失败: {}", e);
                        stream_failed = true;
                        break;
                    }
                    downloaded += chunk_len as u64;
                    let _ = on_event.send(UpdateDownloadEvent::Progress {
                        chunk_length: chunk_len,
                        downloaded,
                        total_bytes: content_length.unwrap_or(downloaded),
                    });
                }
                Ok(None) => break,
                Err(e) => {
                    last_error = format!("流式传输中断: {}", e);
                    log::warn!("Stream chunk error from {}: {}", mirror.name, e);
                    stream_failed = true;
                    break;
                }
            }
        }

        let _ = file.flush();
        drop(file);

        if stream_failed {
            let _ = std::fs::remove_file(&temp_file_path);
            continue;
        }

        // 完整性安全校验：NSIS 安装包必须大于 1MB 且在有 Content-Length 时长度匹配
        if downloaded < 1_000_000 {
            last_error = format!("下载文件不完整或仅为错误页面 (大小: {} 字节)", downloaded);
            log::warn!("{}", last_error);
            let _ = std::fs::remove_file(&temp_file_path);
            continue;
        }

        if let Some(expected_len) = content_length {
            if expected_len > 0 && downloaded < expected_len {
                last_error = format!(
                    "下载字节不匹配 (已下载: {}, 预期: {})",
                    downloaded, expected_len
                );
                log::warn!("{}", last_error);
                let _ = std::fs::remove_file(&temp_file_path);
                continue;
            }
        }

        log::info!(
            "Update installer downloaded from {} ({} bytes), verifying signature",
            mirror.name,
            downloaded
        );

        let digest = match update_trust::verify_installer_file(
            &temp_file_path,
            &artifact,
            TAURI_UPDATER_PUBKEY_B64,
        ) {
            Ok(digest) => digest,
            Err(e) => {
                last_error = e.to_string();
                log::error!("安装包验签失败，已删除临时文件: {}", last_error);
                let _ = std::fs::remove_file(&temp_file_path);
                continue;
            }
        };

        let target_installer_name = installer_name_for_platform(clean_ver, platform);
        if let Some(sums_text) = fetch_release_sha256sums(&client, clean_ver).await {
            if let Some(expected_hash) = parse_expected_hash(&sums_text, &target_installer_name) {
                if !digest.eq_ignore_ascii_case(&expected_hash) {
                    let _ = std::fs::remove_file(&temp_file_path);
                    last_error = format!(
                        "安装包 SHA-256 与 SHA256SUMS 不一致（签名已通过但仍拒绝）: 预期 {}, 实际 {}",
                        expected_hash, digest
                    );
                    log::error!("{}", last_error);
                    continue;
                }
            }
        }

        if !update_trust::is_executable_staging_path(&temp_file_path) {
            let _ = std::fs::remove_file(&temp_file_path);
            return Err("安装包不在受保护的临时目录中，已拒绝执行".to_string());
        }

        let digest_again = match update_trust::verify_installer_file(
            &temp_file_path,
            &artifact,
            TAURI_UPDATER_PUBKEY_B64,
        ) {
            Ok(digest) => digest,
            Err(e) => {
                let _ = std::fs::remove_file(&temp_file_path);
                return Err(format!("执行前复验失败: {}", e));
            }
        };
        if digest_again != digest {
            let _ = std::fs::remove_file(&temp_file_path);
            return Err("执行前文件内容已变化，已拒绝安装".to_string());
        }

        let mut state =
            load_trust_state(&trust_app_dir(), CURRENT_VERSION).map_err(|e| e.to_string())?;
        record_accepted_install(
            &mut state,
            &verified.manifest.version,
            if verified.manifest.release_seq > 0 {
                verified.manifest.release_seq
            } else {
                update_trust::version_to_seq(&verified.manifest.version)
            },
            &digest,
        );
        save_trust_state(&trust_app_dir(), &state).map_err(|e| e.to_string())?;

        let _ = on_event.send(UpdateDownloadEvent::Finished);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            log::info!("Launching verified installer: {:?}", temp_file_path);
            let spawn_res = std::process::Command::new(&temp_file_path)
                .args(WINDOWS_UPDATE_INSTALLER_ARGS)
                .creation_flags(0x00000008 | 0x00000200)
                .spawn();

            match spawn_res {
                Ok(_) => {
                    std::mem::forget(staging);
                    log::info!("Installer launched successfully. Exiting current process.");
                    std::process::exit(0);
                }
                Err(e) => {
                    let err = format!("启动安装程序失败: {}", e);
                    log::error!("{}", err);
                    return Err(err);
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            log::info!("Opening macOS DMG: {:?}", temp_file_path);
            let spawn_res = std::process::Command::new("open")
                .arg(&temp_file_path)
                .spawn();

            match spawn_res {
                Ok(_) => {
                    std::mem::forget(staging);
                    log::info!("DMG package opened successfully. Exiting current process.");
                    std::process::exit(0);
                }
                Err(e) => {
                    let err = format!("打开安装包失败: {}", e);
                    log::error!("{}", err);
                    return Err(err);
                }
            }
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            return Err("当前平台请手动安装更新包".to_string());
        }
    }

    Err(format!(
        "所有自动下载镜像源均尝试失败（最后错误: {}），请检查网络或点击手动下载",
        last_error
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_windows_update_installer_args_enable_restart() {
        assert_eq!(
            WINDOWS_UPDATE_INSTALLER_ARGS,
            ["/P", "/R", "/UPDATE", "/ARGS"]
        );
    }

    #[test]
    fn test_parse_host_port() {
        assert_eq!(
            parse_host_port("http://127.0.0.1:7897"),
            Some(("127.0.0.1".to_string(), 7897))
        );
        assert_eq!(
            parse_host_port("127.0.0.1:7890"),
            Some(("127.0.0.1".to_string(), 7890))
        );
        assert_eq!(
            parse_host_port("socks5://192.168.1.1:1080/"),
            Some(("192.168.1.1".to_string(), 1080))
        );
        assert_eq!(
            parse_host_port("http://example.com"),
            Some(("example.com".to_string(), 80))
        );
    }

    #[test]
    fn test_compare_versions() {
        assert!(compare_versions("1.0.33", "1.0.32"));
        assert!(compare_versions("v1.0.33", "1.0.32"));
        assert!(!compare_versions("1.0.32", "1.0.32"));
        assert!(!compare_versions("1.0.31", "1.0.32"));
        assert!(compare_versions("2.0.0", "1.99.99"));
    }

    #[test]
    fn test_get_candidate_mirrors() {
        let mirrors = get_candidate_mirrors("1.0.32");
        assert_eq!(mirrors.len(), 6);
        for m in &mirrors {
            assert!(m.url.contains(&installer_name_for_platform(
                "1.0.32",
                current_platform_key()
            )));
        }
        assert!(mirrors.iter().any(|m| m.name.contains("阿里云 OSS")));
    }

    #[test]
    fn installer_names_match_signed_release_artifacts() {
        assert_eq!(
            installer_name_for_platform("v1.0.70", "darwin-aarch64"),
            "AI-Helper-v1.0.70-macOS-aarch64.dmg"
        );
        assert_eq!(
            installer_name_for_platform("1.0.70", "darwin-x86_64"),
            "AI-Helper-v1.0.70-macOS-x64.dmg"
        );
        assert_eq!(
            installer_name_for_platform("1.0.70", "windows-x86_64"),
            "AI-Helper-v1.0.70-Windows-x64-Setup.exe"
        );
    }

    #[test]
    fn compute_file_sha256_matches_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.bin");
        std::fs::write(&path, b"").unwrap();
        assert_eq!(
            compute_file_sha256(&path).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_parse_expected_hash() {
        let sample = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  AI-Helper-v1.0.66-Windows-x64-Setup.exe\n\
                      a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0 *AI-Helper-v1.0.66-macOS.dmg";
        assert_eq!(
            parse_expected_hash(sample, "AI-Helper-v1.0.66-Windows-x64-Setup.exe"),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string())
        );
        assert_eq!(
            parse_expected_hash(sample, "AI-Helper-v1.0.66-macOS.dmg"),
            Some("a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0".to_string())
        );
        assert_eq!(parse_expected_hash(sample, "NonExistent.exe"), None);
    }
}

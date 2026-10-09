/// 更新检查与多源容灾下载模块
/// 针对国内网络、VPN 代理环境、死代理残留、镜像源单点故障等复杂场景进行了全面加固：
///   1. 智能代理嗅探与死代理自愈（检测环境变量与 Windows 注册表 WinINet 代理，并进行 200ms TCP 握手探测，自动规避 10061 积极拒绝错误）
///   2. 多通道 Manifest 检测（ghfast.top / gh-proxy.com / ghproxy.net / 官方 GitHub / jsDelivr / GitHub Raw / GitHub API）
///   3. 多源容灾自动下载器（download_and_install_update）：
///      - 支持官方直链、ghfast、gh-proxy、ghproxy.net 自动竞速与故障自动秒切
///      - 支持流式分块写入、实时进度回显与源切换事件广播
///      - 下载校验完成后自动调起 Windows 安装程序并退出应用生效
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
const JSDELIVR_URL: &str = "https://cdn.jsdelivr.net/gh/TF49/AI-Helper@main/package.json";
const GITHUB_RAW_MIRROR_URL: &str =
    "https://ghfast.top/https://raw.githubusercontent.com/TF49/AI-Helper/main/package.json";
const GITHUB_API_URL: &str = "https://api.github.com/repos/TF49/AI-Helper/releases/latest";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
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

/// 创建带安全策略的 HTTP 客户端
pub fn create_client(timeout: Duration) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", CURRENT_VERSION))
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

/// 获取全平台候选下载镜像源列表
pub fn get_candidate_mirrors(version: &str) -> Vec<CandidateMirror> {
    let clean_ver = version.trim_start_matches('v');
    let installer_name = format!("AI-Helper-v{}-Windows-x64-Setup.exe", clean_ver);

    let local_mirror = CandidateMirror {
        name: "本站直链 (helper.bob-api.com)".to_string(),
        url: format!("https://helper.bob-api.com/downloads/{}", installer_name),
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

    // 本站直链始终放第一位（国内直连，速度最快）
    // 若检测到有效代理（VPN 已开启），官方 GitHub 升为第二位；否则国内镜像次之
    if get_upstream_proxy_url().is_some() {
        vec![local_mirror, official, gh_proxy, ghfast, ghproxy_net]
    } else {
        vec![local_mirror, ghfast, gh_proxy, ghproxy_net, official]
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
    let has_proxy = get_upstream_proxy_url().is_some();

    // 0. 优先尝试本站自托管 latest.json（国内直连稳定，无需代理）
    match check_updater_json(
        UPDATER_JSON_LOCAL_URL,
        "updater.json (本站 helper.bob-api.com)",
    )
    .await
    {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "Local mirror updater.json check failed: {}. Trying official GitHub...",
                e
            );
        }
    }

    // 如果开启了 VPN 代理，优先尝试 GitHub 官方更新源，避免被国内镜像防火墙拦截
    if has_proxy {
        if let Ok(info) =
            check_updater_json(UPDATER_JSON_OFFICIAL_URL, "updater.json (GitHub 官方直连)").await
        {
            return Ok(info);
        }
    }

    // 1. ghfast.top 镜像 updater.json (国内高速通道)
    match check_updater_json(UPDATER_JSON_MIRROR_URL, "updater.json (ghfast)").await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "ghfast updater.json check failed: {}. Trying gh-proxy backup...",
                e
            );
        }
    }

    // 2. 备用 gh-proxy.com 镜像 updater.json
    match check_updater_json(UPDATER_JSON_MIRROR_BACKUP_URL, "updater.json (gh-proxy)").await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "gh-proxy updater.json check failed: {}. Trying ghproxy.net backup...",
                e
            );
        }
    }

    // 3. 备用 ghproxy.net 镜像 updater.json
    match check_updater_json(
        UPDATER_JSON_MIRROR_BACKUP2_URL,
        "updater.json (ghproxy.net)",
    )
    .await
    {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "ghproxy.net updater.json check failed: {}. Trying official GitHub...",
                e
            );
        }
    }

    // 4. 官方 GitHub updater.json (适合海外用户或已配置系统代理/VPN环境)
    if !has_proxy {
        match check_updater_json(UPDATER_JSON_OFFICIAL_URL, "updater.json (GitHub)").await {
            Ok(info) => return Ok(info),
            Err(e) => {
                log::warn!(
                    "Official GitHub updater.json check failed: {}. Trying jsDelivr CDN...",
                    e
                );
            }
        }
    }

    // 5. 回退 jsDelivr CDN (package.json)
    match check_static_url(JSDELIVR_URL, "jsDelivr").await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!("jsDelivr check failed: {}. Trying GitHub Raw Mirror...", e);
        }
    }

    // 6. 回退 GitHub Raw 镜像 (package.json)
    match check_static_url(GITHUB_RAW_MIRROR_URL, "GitHub Raw (ghfast)").await {
        Ok(info) => return Ok(info),
        Err(e) => {
            log::warn!(
                "GitHub Raw Mirror check failed: {}. Trying GitHub API...",
                e
            );
        }
    }

    // 7. 回退 GitHub Releases API
    match check_github_api().await {
        Ok(info) => Ok(info),
        Err(e) => {
            log::error!("All update checks failed. Last error: {}", e);
            Err(e)
        }
    }
}

async fn check_updater_json(url: &str, source_name: &str) -> Result<UpdateInfo, String> {
    let client = create_client(REQUEST_TIMEOUT)?;
    log::info!("Checking for updates via {}...", source_name);

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "{} returned status: {}",
            source_name,
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
            "New version found ({}): {} (Current: {})",
            source_name,
            latest_version,
            current_version
        );
    } else {
        log::info!(
            "Up to date ({}): {} (Matches {})",
            source_name,
            current_version,
            latest_version
        );
    }

    let download_url = format!(
        "https://github.com/TF49/AI-Helper/releases/tag/v{}",
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
        source: Some(source_name.to_string()),
        proxy_url: None,
        candidate_mirrors: Vec::new(),
    })
}

async fn check_github_api() -> Result<UpdateInfo, String> {
    let client = create_client(REQUEST_TIMEOUT)?;
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
            latest_version,
            current_version
        );
    } else {
        log::info!(
            "Up to date (API): {} (Matches {})",
            current_version,
            latest_version
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
        candidate_mirrors: Vec::new(),
    })
}

async fn check_static_url(url: &str, source_name: &str) -> Result<UpdateInfo, String> {
    let client = create_client(REQUEST_TIMEOUT)?;
    log::info!("Checking for updates via {}...", source_name);

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "{} returned status: {}",
            source_name,
            response.status()
        ));
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
            source_name,
            latest_version,
            current_version
        );
    } else {
        log::info!(
            "Up to date ({}): {} (Matches {})",
            source_name,
            current_version,
            latest_version
        );
    }

    let download_url = "https://github.com/TF49/AI-Helper/releases/latest".to_string();
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
        candidate_mirrors: Vec::new(),
    })
}

/// 多源容灾自动下载并静默启动更新安装包
pub async fn download_and_install_update(
    version: String,
    on_event: tauri::ipc::Channel<UpdateDownloadEvent>,
) -> Result<(), String> {
    let clean_ver = version.trim_start_matches('v');
    let candidate_mirrors = get_candidate_mirrors(clean_ver);
    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join(format!("AI-Helper-v{}-Windows-x64-Setup.exe", clean_ver));

    // 使用 60 秒单次超时，适配大安装包下载
    let client = create_client(Duration::from_secs(60))?;
    let mut last_error = String::new();

    for (idx, mirror) in candidate_mirrors.iter().enumerate() {
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
        while let Some(chunk_res) = response.chunk().await.transpose() {
            match chunk_res {
                Ok(chunk) => {
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

        // 下载圆满成功！
        log::info!(
            "Update installer successfully downloaded from {} ({} bytes)",
            mirror.name,
            downloaded
        );
        let _ = on_event.send(UpdateDownloadEvent::Finished);

        // 启动安装程序并退出当前应用
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            log::info!("Launching installer: {:?}", temp_file_path);
            let spawn_res = std::process::Command::new(&temp_file_path)
                .args(WINDOWS_UPDATE_INSTALLER_ARGS)
                .creation_flags(0x00000008 | 0x00000200) // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
                .spawn();

            match spawn_res {
                Ok(_) => {
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

        #[cfg(not(target_os = "windows"))]
        {
            return Err("非 Windows 平台请手动安装更新包".to_string());
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
        assert_eq!(mirrors.len(), 4);
        for m in &mirrors {
            assert!(m.url.contains("AI-Helper-v1.0.32-Windows-x64-Setup.exe"));
        }
    }
}

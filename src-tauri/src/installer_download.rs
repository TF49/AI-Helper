use crate::updater::create_client;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;

#[derive(Clone)]
struct InstallerRecord {
    path: PathBuf,
    sha256: String,
    consumed: bool,
}

static INSTALLER_RECORDS: once_cell::sync::Lazy<Mutex<HashMap<String, InstallerRecord>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

fn register_installer_record(path: &Path) -> Result<String, String> {
    let sha256 = crate::update_trust::sha256_file(path).map_err(|e| e.to_string())?;
    let id = format!("{:x}", {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update(sha256.as_bytes());
        hasher.finalize()
    });
    let mut guard = INSTALLER_RECORDS
        .lock()
        .map_err(|_| "安装记录锁不可用".to_string())?;
    guard.insert(
        id.clone(),
        InstallerRecord {
            path: path.to_path_buf(),
            sha256,
            consumed: false,
        },
    );
    Ok(id)
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(45);

const ACCIO_HOMEPAGE_URL: &str = "https://www.accio.com/work";
const ACCIO_FALLBACK_URL: &str =
    "https://work-download.accio.com/package/v0.34.5/Accio-0.34.5-20261013-0010-win.exe?dl_name=Accio-0.34.5-20261013-0010-win_ec130b61.exe";
const ACCIO_FALLBACK_VERSION: &str = "v0.34.5";

const WORKBUDDY_HISTORY_URL: &str = "https://www.workbuddy.cn/docs/workbuddy/Download-History";
const WORKBUDDY_FALLBACK_URL: &str =
    "https://download.codebuddy.cn/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.7.6.40409493-306add2a.exe";
const WORKBUDDY_FALLBACK_VERSION: &str = "v5.7.6";

const CHATGPT_STORE_ID: &str = "9NT1R1C2HH7J";
const CHATGPT_STORE_URI: &str = "ms-windows-store://pdp/?productid=9NT1R1C2HH7J";
const CHATGPT_WINGET_CMD: &str =
    "winget install --id=9NT1R1C2HH7J --source=msstore --accept-package-agreements --accept-source-agreements";
const CHATGPT_DOWNLOAD_PAGE: &str = "https://chatgpt.com/download";

const CURSOR_HOMEPAGE_URL: &str = "https://www.cursor.com";
const CURSOR_DOWNLOAD_URL: &str = "https://downloader.cursor.sh/windows/x64";
const CURSOR_FALLBACK_VERSION: &str = "最新版";

fn is_allowed_installer_download_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw.trim()) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let host = url.host_str().unwrap_or("");
    matches!(
        host,
        "work-download.accio.com"
            | "www.accio.com"
            | "download.codebuddy.cn"
            | "www.workbuddy.cn"
            | "chatgpt.com"
            | "apps.microsoft.com"
            | "downloader.cursor.sh"
            | "cursor.com"
            | "www.cursor.com"
    ) || host.ends_with(".todesktop.com")
}

fn create_installer_download_client(connect_timeout: Duration) -> Result<reqwest::Client, String> {
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        let target_url = attempt.url().to_string();
        if attempt.previous().len() >= 10 {
            attempt.error("安装包下载重定向次数过多")
        } else if !is_allowed_installer_download_url(&target_url) {
            attempt.error(format!(
                "重定向目标 '{}' 不是允许的官方安装包域名",
                target_url
            ))
        } else {
            attempt.follow()
        }
    });

    let mut builder = reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect_timeout)
        .tcp_keepalive(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .redirect(redirect_policy);

    if let Some(proxy_url) = crate::updater::get_upstream_proxy_url() {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
            return builder
                .build()
                .map_err(|e| format!("构建带代理下载客户端失败: {}", e));
        }
    }

    builder = builder.no_proxy();
    builder
        .build()
        .map_err(|e| format!("构建下载客户端失败: {}", e))
}

fn create_installer_direct_download_client(
    connect_timeout: Duration,
) -> Result<reqwest::Client, String> {
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        let target_url = attempt.url().to_string();
        if attempt.previous().len() >= 10 {
            attempt.error("安装包下载重定向次数过多")
        } else if !is_allowed_installer_download_url(&target_url) {
            attempt.error(format!(
                "重定向目标 '{}' 不是允许的官方安装包域名",
                target_url
            ))
        } else {
            attempt.follow()
        }
    });

    reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect_timeout)
        .tcp_keepalive(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .no_proxy()
        .redirect(redirect_policy)
        .build()
        .map_err(|e| format!("构建直连下载客户端失败: {}", e))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppInstallerInfo {
    pub app_type: String,
    pub app_name: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub size_bytes: Option<u64>,
    pub is_external_store: bool,
    pub store_uri: Option<String>,
    pub winget_command: Option<String>,
    pub official_web_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "event", content = "data")]
pub enum AppDownloadEvent {
    #[serde(rename = "Started")]
    Started {
        #[serde(rename = "totalBytes")]
        total_bytes: Option<u64>,
        #[serde(rename = "fileName")]
        file_name: String,
    },
    #[serde(rename = "Progress")]
    Progress {
        downloaded: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: u64,
        percent: f64,
    },
    #[serde(rename = "Finished")]
    Finished {
        #[serde(rename = "filePath")]
        file_path: String,
        #[serde(rename = "recordId")]
        record_id: String,
    },
    #[serde(rename = "Error")]
    Error { message: String },
}

/// 嗅探 Accio Work 官方最新下载信息
async fn fetch_accio_installer_info(client: &reqwest::Client) -> AppInstallerInfo {
    let mut download_url = ACCIO_FALLBACK_URL.to_string();
    let mut version = ACCIO_FALLBACK_VERSION.to_string();

    match client.get(ACCIO_HOMEPAGE_URL).send().await {
        Ok(res) if res.status().is_success() => {
            if let Ok(html) = res.text().await {
                // 1. 尝试匹配 windowsDownloadUrl: "..."
                if let Some(pos) = html.find("windowsDownloadUrl") {
                    let slice = &html[pos..html.len().min(pos + 400)];
                    if let Some(url_start) = slice.find("http") {
                        if let Some(url_end) = slice[url_start..].find('"') {
                            let extracted = &slice[url_start..url_start + url_end];
                            let cleaned = extracted
                                .replace("\\u002F", "/")
                                .replace("\\/", "/")
                                .trim()
                                .to_string();
                            if cleaned.starts_with("https")
                                && cleaned.contains(".exe")
                                && is_allowed_installer_download_url(&cleaned)
                            {
                                log::info!(
                                    "Successfully parsed latest Accio Work URL: {}",
                                    cleaned
                                );
                                download_url = cleaned;
                            }
                        }
                    }
                }

                // 2. 尝试从 URL 提取版本号（如 package/v0.34.5/ 或 Accio-0.34.5）
                if let Some(v_pos) = download_url.find("/package/v") {
                    let sub = &download_url[v_pos + 9..];
                    if let Some(slash) = sub.find('/') {
                        version = format!("v{}", &sub[..slash]);
                    }
                } else if let Some(v_pos) = download_url.find("Accio-") {
                    let sub = &download_url[v_pos + 6..];
                    if let Some(dash) = sub.find('-') {
                        version = format!("v{}", &sub[..dash]);
                    }
                }
            }
        }
        Err(e) => {
            log::warn!(
                "Failed to probe Accio Work homepage ({}), falling back to default official CDN: {}",
                e,
                ACCIO_FALLBACK_URL
            );
        }
        _ => {}
    }

    let file_name = if let Some(slash) = download_url.split('?').next().and_then(|u| u.rfind('/')) {
        let raw = &download_url.split('?').next().unwrap()[slash + 1..];
        if raw.ends_with(".exe") {
            raw.to_string()
        } else {
            format!("Accio-{}-Setup.exe", version.trim_start_matches('v'))
        }
    } else {
        format!("Accio-{}-Setup.exe", version.trim_start_matches('v'))
    };

    AppInstallerInfo {
        app_type: "acciowork".to_string(),
        app_name: "Accio Work".to_string(),
        version,
        download_url,
        file_name,
        size_bytes: None,
        is_external_store: false,
        store_uri: None,
        winget_command: None,
        official_web_url: Some(ACCIO_HOMEPAGE_URL.to_string()),
    }
}

/// 嗅探 WorkBuddy 官方最新下载信息
async fn fetch_workbuddy_installer_info(client: &reqwest::Client) -> AppInstallerInfo {
    let mut download_url = WORKBUDDY_FALLBACK_URL.to_string();
    let mut version = WORKBUDDY_FALLBACK_VERSION.to_string();

    match client.get(WORKBUDDY_HISTORY_URL).send().await {
        Ok(res) if res.status().is_success() => {
            if let Ok(html) = res.text().await {
                // 匹配 https://download.codebuddy.cn/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-*.exe
                let prefix =
                    "https://download.codebuddy.cn/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-";
                if let Some(pos) = html.find(prefix) {
                    let sub = &html[pos..];
                    if let Some(end) = sub.find(".exe") {
                        let full = &sub[..end + 4];
                        let cleaned = full.trim().to_string();
                        if !cleaned.contains(' ')
                            && !cleaned.contains('"')
                            && !cleaned.contains('<')
                            && is_allowed_installer_download_url(&cleaned)
                        {
                            log::info!("Successfully parsed latest WorkBuddy URL: {}", cleaned);
                            download_url = cleaned;
                        }
                    }
                }

                // 提取版本号（如 WorkBuddy-win32-x64-user-5.7.6.40409493-... -> 5.7.6）
                if let Some(idx) = download_url.find("win32-x64-user-") {
                    let sub = &download_url[idx + 15..];
                    let v_str = sub.split('-').next().unwrap_or(sub);
                    let parts = v_str.split('.').take(3).collect::<Vec<_>>();
                    if parts.len() == 3 {
                        version = format!("v{}", parts.join("."));
                    }
                }
            }
        }
        Err(e) => {
            log::warn!(
                "Failed to probe WorkBuddy docs ({}), falling back to default official CDN: {}",
                e,
                WORKBUDDY_FALLBACK_URL
            );
        }
        _ => {}
    }

    let file_name = if let Some(slash) = download_url.rfind('/') {
        let raw = &download_url[slash + 1..];
        if raw.ends_with(".exe") {
            raw.to_string()
        } else {
            format!("WorkBuddy-{}-Setup.exe", version.trim_start_matches('v'))
        }
    } else {
        format!("WorkBuddy-{}-Setup.exe", version.trim_start_matches('v'))
    };

    AppInstallerInfo {
        app_type: "workbuddy".to_string(),
        app_name: "WorkBuddy".to_string(),
        version,
        download_url,
        file_name,
        size_bytes: None,
        is_external_store: false,
        store_uri: None,
        winget_command: None,
        official_web_url: Some("https://www.workbuddy.cn".to_string()),
    }
}

/// 嗅探 Cursor 官方最新下载信息
async fn fetch_cursor_installer_info(client: &reqwest::Client) -> AppInstallerInfo {
    let mut download_url = CURSOR_DOWNLOAD_URL.to_string();
    let mut version = CURSOR_FALLBACK_VERSION.to_string();

    // 尝试向 Cursor 官方分发中继发送 HEAD 请求以获取实际跳转文件名与版本
    if let Ok(res) = client.head(CURSOR_DOWNLOAD_URL).send().await {
        let final_url = res.url().to_string();
        if is_allowed_installer_download_url(&final_url) {
            download_url = final_url.clone();
        }
        if let Some(filename) = extract_filename_from_headers(res.headers()) {
            for part in filename.split(|c: char| !c.is_numeric() && c != '.') {
                let p = part.trim_matches('.');
                if p.split('.').count() >= 3 && p.chars().next().map_or(false, |c| c.is_numeric()) {
                    version = format!("v{}", p);
                    break;
                }
            }
        } else if let Some(v_pos) = final_url.find("Cursor%20Setup%20") {
            let sub = &final_url[v_pos + 17..];
            let v_str = sub.split('%').next().unwrap_or(sub);
            if !v_str.is_empty() {
                version = format!("v{}", v_str);
            }
        }
    }

    let file_name = if let Some(slash) = download_url.split('?').next().and_then(|u| u.rfind('/')) {
        let raw = &download_url.split('?').next().unwrap()[slash + 1..];
        let decoded = percent_decode_string(raw);
        let sanitized = sanitize_filename(&decoded);
        if sanitized.ends_with(".exe") {
            sanitized
        } else {
            "Cursor-Setup-x64.exe".to_string()
        }
    } else {
        "Cursor-Setup-x64.exe".to_string()
    };

    AppInstallerInfo {
        app_type: "cursor".to_string(),
        app_name: "Cursor".to_string(),
        version,
        download_url,
        file_name,
        size_bytes: None,
        is_external_store: false,
        store_uri: None,
        winget_command: None,
        official_web_url: Some(CURSOR_HOMEPAGE_URL.to_string()),
    }
}

/// 组装 ChatGPT 客户端信息（微软商店 / WinGet / 官方直达）
fn get_chatgpt_installer_info() -> AppInstallerInfo {
    AppInstallerInfo {
        app_type: "chatgpt".to_string(),
        app_name: "ChatGPT".to_string(),
        version: "Microsoft Store 官方最新版".to_string(),
        download_url: format!("https://apps.microsoft.com/detail/{}", CHATGPT_STORE_ID),
        file_name: "ChatGPT (Microsoft Store)".to_string(),
        size_bytes: None,
        is_external_store: true,
        store_uri: Some(CHATGPT_STORE_URI.to_string()),
        winget_command: Some(CHATGPT_WINGET_CMD.to_string()),
        official_web_url: Some(CHATGPT_DOWNLOAD_PAGE.to_string()),
    }
}

/// 获取指定客户端的最新官方安装包元数据
pub async fn fetch_latest_installer_info(app_type: &str) -> Result<AppInstallerInfo, String> {
    match app_type {
        "chatgpt" => Ok(get_chatgpt_installer_info()),
        "workbuddy" => {
            let client = create_client(REQUEST_TIMEOUT)?;
            Ok(fetch_workbuddy_installer_info(&client).await)
        }
        "acciowork" => {
            let client = create_client(REQUEST_TIMEOUT)?;
            Ok(fetch_accio_installer_info(&client).await)
        }
        "cursor" => {
            let client = create_client(REQUEST_TIMEOUT)?;
            Ok(fetch_cursor_installer_info(&client).await)
        }
        _ => Err(format!("不支持的客户端安装包下载类型: {}", app_type)),
    }
}

/// 安全净化文件名，去除路径分隔符与 Windows 非法字符
fn sanitize_filename(name: &str) -> String {
    name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string()
}

/// 简单轻量 URL 百分比解码 (百分号十六进制)
fn percent_decode_string(input: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            if let (Some(h1), Some(h2)) = (chars.next(), chars.next()) {
                if let Ok(hex_val) =
                    u8::from_str_radix(&format!("{}{}", h1 as char, h2 as char), 16)
                {
                    bytes.push(hex_val);
                    continue;
                }
            }
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

/// 尝试从 HTTP 响应头 Content-Disposition 中提取合法的 .exe 文件名
fn extract_filename_from_headers(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let header_val = headers
        .get(reqwest::header::CONTENT_DISPOSITION)?
        .to_str()
        .ok()?;

    // 1. 优先匹配 RFC 5987 / RFC 6266 的 filename*=UTF-8''...
    if let Some(pos) = header_val.find("filename*=") {
        let sub = &header_val[pos + 10..];
        let token = sub
            .split(';')
            .next()
            .unwrap_or(sub)
            .trim()
            .trim_matches('"');
        if let Some(quote_idx) = token.find("''") {
            let encoded = &token[quote_idx + 2..];
            let decoded = percent_decode_string(encoded);
            let cleaned = sanitize_filename(&decoded);
            if cleaned.ends_with(".exe") && !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }

    // 2. 其次匹配常规 filename="..."
    if let Some(pos) = header_val.find("filename=") {
        let sub = &header_val[pos + 9..];
        let token = sub
            .split(';')
            .next()
            .unwrap_or(sub)
            .trim()
            .trim_matches('"')
            .trim_matches('\'');
        let cleaned = sanitize_filename(token);
        if cleaned.ends_with(".exe") && !cleaned.is_empty() {
            return Some(cleaned);
        }
    }

    None
}

/// 解析下载文件保存目录（优先 Downloads，其次桌面或临时目录）
pub fn get_download_destination_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .unwrap_or_else(std::env::temp_dir)
}

/// 下载指定客户端官方安装包，带实时流式事件回传
pub async fn download_installer_file(
    app_type: String,
    on_event: Channel<AppDownloadEvent>,
) -> Result<String, String> {
    log::info!("Starting download for client app: {}", app_type);

    let info = fetch_latest_installer_info(&app_type).await?;
    if info.is_external_store {
        return Err(format!(
            "{} 为应用商店/WinGet分发客户端，请使用专门安装渠道",
            info.app_name
        ));
    }

    let download_dir = get_download_destination_dir();
    if !download_dir.exists() {
        std::fs::create_dir_all(&download_dir).map_err(|e| format!("无法创建下载目录: {}", e))?;
    }

    let client = create_installer_download_client(DOWNLOAD_CONNECT_TIMEOUT)?;

    // 准备主下载地址与兜底备用 CDN 地址
    let fallback_candidate = match app_type.as_str() {
        "acciowork" => Some(ACCIO_FALLBACK_URL),
        "workbuddy" => Some(WORKBUDDY_FALLBACK_URL),
        "cursor" => Some(CURSOR_DOWNLOAD_URL),
        _ => None,
    };

    let mut target_url = info.download_url.clone();
    if !is_allowed_installer_download_url(&target_url) {
        return Err("安装包下载地址不在允许的官方域名列表中".to_string());
    }
    let mut resp = client.get(&target_url).send().await;

    // 若嗅探到的直链网络不可达或返回非 200，尝试切换官方 CDN 稳定兜底源
    if let Some(fallback_url) = fallback_candidate {
        let needs_fallback = match &resp {
            Ok(r) => !r.status().is_success(),
            Err(_) => true,
        };

        if needs_fallback && target_url != fallback_url {
            if !is_allowed_installer_download_url(fallback_url) {
                return Err("安装包兜底地址不在允许的官方域名列表中".to_string());
            }
            log::warn!(
                "Primary download URL failed or responded with error. Falling back to official stable CDN: {}",
                fallback_url
            );
            target_url = fallback_url.to_string();
            resp = client.get(&target_url).send().await;
        }
    }

    // 若通过代理客户端仍旧无法连接国内 CDN，尝试使用直连（不走代理）兜底
    if resp.is_err()
        || resp
            .as_ref()
            .map(|r| !r.status().is_success())
            .unwrap_or(false)
    {
        if let Ok(direct_client) = create_installer_direct_download_client(DOWNLOAD_CONNECT_TIMEOUT)
        {
            log::info!("Attempting direct connection (bypassing proxy) for domestic installer...");
            let direct_resp = direct_client.get(&target_url).send().await;
            if let Ok(ref r) = direct_resp {
                if r.status().is_success() {
                    resp = direct_resp;
                }
            }
        }
    }

    let res = resp.map_err(|e| format!("请求下载直链失败 ({}): {}", target_url, e))?;

    // 关键加固：验证最终响应 URL 依然属于受信任的官方域名清单（防跳转链被劫持）
    if !is_allowed_installer_download_url(res.url().as_str()) {
        let msg = format!("最终下载地址 '{}' 不在受信任的官方域名列表中", res.url());
        log::error!("{}", msg);
        let _ = on_event.send(AppDownloadEvent::Error {
            message: msg.clone(),
        });
        return Err(msg);
    }

    if !res.status().is_success() {
        let status = res.status();
        let msg = format!("下载源响应异常 HTTP {}", status);
        log::error!("{}", msg);
        let _ = on_event.send(AppDownloadEvent::Error {
            message: msg.clone(),
        });
        return Err(msg);
    }

    // 优先从 HTTP 响应头的 Content-Disposition 解析文件名，未提供则使用嗅探得到的规范文件名
    let file_name = extract_filename_from_headers(res.headers())
        .unwrap_or_else(|| sanitize_filename(&info.file_name));

    let total_bytes = res.content_length();
    let _ = on_event.send(AppDownloadEvent::Started {
        total_bytes,
        file_name: file_name.clone(),
    });

    // 使用 .downloading 临时扩展名进行原子写入，确保下载中断不会留存破损可执行文件
    let temp_part_path = download_dir.join(format!("{}.downloading", file_name));
    let final_dest_path = download_dir.join(&file_name);

    log::info!(
        "Download URL: {}\nTemp target: {}\nFinal destination: {}",
        target_url,
        temp_part_path.display(),
        final_dest_path.display()
    );

    let mut file = match tokio::fs::File::create(&temp_part_path).await {
        Ok(f) => f,
        Err(e) => {
            let msg = format!("无法创建目标文件 {}: {}", temp_part_path.display(), e);
            log::error!("{}", msg);
            let _ = on_event.send(AppDownloadEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
    };

    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    loop {
        let chunk_opt = match tokio::time::timeout(CHUNK_IDLE_TIMEOUT, stream.next()).await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(_) => {
                let _ = tokio::fs::remove_file(&temp_part_path).await;
                let msg = format!(
                    "下载传输停滞: 超过 {} 秒未接收到数据流，网络连接可能已挂起",
                    CHUNK_IDLE_TIMEOUT.as_secs()
                );
                log::error!("{}", msg);
                let _ = on_event.send(AppDownloadEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
        };

        let chunk = match chunk_opt {
            Ok(c) => c,
            Err(e) => {
                let _ = tokio::fs::remove_file(&temp_part_path).await;
                let msg = format!("数据流读取中断: {}", e);
                log::error!("{}", msg);
                let _ = on_event.send(AppDownloadEvent::Error {
                    message: msg.clone(),
                });
                return Err(msg);
            }
        };

        if let Err(e) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&temp_part_path).await;
            let msg = format!("写入文件失败: {}", e);
            log::error!("{}", msg);
            let _ = on_event.send(AppDownloadEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }

        downloaded += chunk.len() as u64;

        // 节流刷新：每 100ms 或累计到达 100% 触发一次 Progress 事件
        if last_emit.elapsed() >= Duration::from_millis(100)
            || (total_bytes.is_some() && downloaded >= total_bytes.unwrap())
        {
            last_emit = std::time::Instant::now();
            let total = total_bytes.unwrap_or(downloaded);
            let percent = if total > 0 {
                ((downloaded as f64 / total as f64) * 100.0).min(100.0)
            } else {
                0.0
            };

            let _ = on_event.send(AppDownloadEvent::Progress {
                downloaded,
                total_bytes: total,
                percent,
            });
        }
    }

    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&temp_part_path).await;
        let msg = format!("刷新文件缓冲区失败: {}", e);
        log::error!("{}", msg);
        let _ = on_event.send(AppDownloadEvent::Error {
            message: msg.clone(),
        });
        return Err(msg);
    }

    // 完整性校验：若响应头提供了 Content-Length 且大于 0，必须确保完整下载
    if let Some(expected) = total_bytes {
        if expected > 0 && downloaded < expected {
            let _ = tokio::fs::remove_file(&temp_part_path).await;
            let msg = format!("下载不完整: 仅接收到 {} / {} 字节", downloaded, expected);
            log::error!("{}", msg);
            let _ = on_event.send(AppDownloadEvent::Error {
                message: msg.clone(),
            });
            return Err(msg);
        }
    }

    // 关闭文件句柄后原子重命名至最终目标路径
    drop(file);
    if let Err(e) = tokio::fs::rename(&temp_part_path, &final_dest_path).await {
        let msg = format!("重命名已就绪文件失败: {}", e);
        let _ = on_event.send(AppDownloadEvent::Error {
            message: msg.clone(),
        });
        return Err(msg);
    }

    let saved_path_str = final_dest_path.to_string_lossy().to_string();
    let record_id = register_installer_record(&final_dest_path)?;
    log::info!("Download completed successfully: {}", saved_path_str);

    let _ = on_event.send(AppDownloadEvent::Finished {
        file_path: saved_path_str.clone(),
        record_id: record_id.clone(),
    });

    Ok(record_id)
}

#[cfg(target_os = "windows")]
fn verify_windows_authenticode_signature(path: &Path) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let escaped = path_str.replace('\'', "''");
    let script = format!(
        "$sig = Get-AuthenticodeSignature -LiteralPath '{}'; \
         if ($sig.Status -ne 'Valid') {{ \
             Write-Error \"Signature status invalid: $($sig.Status)\"; exit 1 \
         }} \
         $subject = if ($sig.SignerCertificate) {{ $sig.SignerCertificate.Subject }} else {{ '' }}; \
         Write-Output \"VALID:$subject\"",
        escaped
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("调起 Windows 签名校验失败: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "安装包未通过数字签名验证 (拒绝执行非官方或被篡改的文件): {}",
            err_msg.trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("VALID:") {
        return Err("安装包签名状态异常，拒绝执行".to_string());
    }

    // 校验签名发布者 Subject 是否属于已知官方白名单
    let subject = stdout
        .trim()
        .strip_prefix("VALID:")
        .unwrap_or("")
        .to_ascii_uppercase();
    if !is_trusted_publisher_subject(&subject) {
        return Err(format!(
            "安装包签名发布者不在受信任白名单中（Subject: {}），拒绝执行",
            subject
        ));
    }
    log::info!("Verified official installer signature: {}", stdout.trim());
    Ok(())
}

/// 受信任的安装包签名发布者 Subject 关键字白名单。
/// 匹配规则：Subject（大写）中包含任一关键字即视为可信。
/// 新增第三方工具时须在此维护对应发布者，不得放行全部合法签名。
#[cfg(target_os = "windows")]
const TRUSTED_PUBLISHER_KEYWORDS: &[&str] = &[
    "ACCIO",     // Accio Work
    "CODEBUDDY", // WorkBuddy / CodeBuddy
    "TENCENT",   // WorkBuddy (腾讯旗下)
    "OPENAI",    // ChatGPT desktop
    "MICROSOFT", // Microsoft Store apps
    "ANYSPHERE", // Cursor (Anysphere, Inc.)
    "CURSOR",    // Cursor
];

#[cfg(target_os = "windows")]
fn is_trusted_publisher_subject(subject_upper: &str) -> bool {
    if subject_upper.is_empty() {
        return false;
    }
    TRUSTED_PUBLISHER_KEYWORDS
        .iter()
        .any(|kw| subject_upper.contains(kw))
}

/// 调起运行安装包程序（仅接受本次下载登记的 record_id，并强制核验发布者数字签名）
pub fn run_installer_file(record_id: String) -> Result<(), String> {
    let mut guard = INSTALLER_RECORDS
        .lock()
        .map_err(|_| "安装记录锁不可用".to_string())?;
    let record = guard
        .get_mut(&record_id)
        .ok_or_else(|| "拒绝执行未登记或已被替换的安装包".to_string())?;
    if record.consumed {
        return Err("该安装包记录已使用，请重新下载".to_string());
    }
    if !record.path.exists() {
        return Err(format!("安装包文件不存在: {}", record.path.display()));
    }
    let canonical = record
        .path
        .canonicalize()
        .unwrap_or_else(|_| record.path.clone());
    let actual = crate::update_trust::sha256_file(&canonical).map_err(|e| e.to_string())?;
    if !record.sha256.eq_ignore_ascii_case(&actual) {
        return Err("安装包校验失败，文件可能已被替换".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // 核心安全锁定：在执行前核验预期发布者 Authenticode 签名
        verify_windows_authenticode_signature(&canonical)?;
    }

    record.consumed = true;
    let path = canonical;
    drop(guard);

    #[cfg(target_os = "windows")]
    {
        // 优先尝试通过 opener (ShellExecute) 打开安装包，可自动唤起 Windows UAC 管理员提权确认框
        match opener::open(&path) {
            Ok(_) => Ok(()),
            Err(_) => std::process::Command::new(&path)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("无法启动安装包: {}", e)),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        opener::open(&path).map_err(|e| format!("无法启动安装包: {}", e))
    }
}

/// 在操作系统文件资源管理器中高亮定位文件
pub fn show_file_in_folder(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("目标文件不存在: {}", file_path));
    }

    #[cfg(target_os = "windows")]
    {
        let arg = format!("/select,{}", file_path);
        std::process::Command::new("explorer.exe")
            .arg(arg)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = path.parent() {
            opener::open(parent).map_err(|e| format!("打开文件夹失败: {}", e))
        } else {
            opener::open(path).map_err(|e| format!("打开文件夹失败: {}", e))
        }
    }
}

const ALLOWED_SYSTEM_URI_OPS: &[(&str, &str)] = &[
    ("chatgpt_store", CHATGPT_STORE_URI),
    ("chatgpt_web", CHATGPT_DOWNLOAD_PAGE),
];

/// 调起系统特定 URI 协议（仅固定操作 ID）
pub fn open_system_uri(uri_id: String) -> Result<(), String> {
    let trimmed = uri_id.trim();
    let resolved = ALLOWED_SYSTEM_URI_OPS
        .iter()
        .find(|(id, _)| *id == trimmed)
        .map(|(_, uri)| *uri)
        .ok_or_else(|| "未授权的系统 URI".to_string())?;

    opener::open(resolved).map_err(|e| format!("无法打开 URI: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_urls_must_be_https_official_hosts() {
        assert!(is_allowed_installer_download_url(ACCIO_FALLBACK_URL));
        assert!(is_allowed_installer_download_url(WORKBUDDY_FALLBACK_URL));
        assert!(!is_allowed_installer_download_url(
            "http://work-download.accio.com/x.exe"
        ));
        assert!(!is_allowed_installer_download_url(
            "https://evil.example/x.exe"
        ));
        assert!(!is_allowed_installer_download_url(
            "https://user:pass@download.codebuddy.cn/x.exe"
        ));
    }
}

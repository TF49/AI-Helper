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

                Err("未找到有效的 ChatGPT 桌面客户端路径，请在路径管理中配置或执行自动探测".to_string())
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
                let mut cmd = Command::new("cmd");
                cmd.args(["/c", "start", "Claude Code", "cmd.exe", "/k", &path_str]);
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
                // 在独立 CMD 窗口中启动 Codex CLI
                let mut cmd = Command::new("cmd");
                cmd.args(["/c", "start", "Codex CLI", "cmd.exe", "/k", &path_str]);
                cmd.spawn()
                    .map_err(|e| format!("启动 Codex CLI 终端失败: {}", e))?;
                Ok(format!("Codex CLI 终端已在独立窗口中拉起 ({})", path_str))
            }

            #[cfg(not(target_os = "windows"))]
            {
                Err("当前平台不支持自动拉起 Codex CLI".to_string())
            }
        }
        _ => Err(format!("未知应用类型: {}", app_type)),
    }
}

/// 重启目标应用 (若正在运行则先杀灭、等待释放，再重新拉起)
pub fn restart_target_app(app_type: &str, custom_path: Option<&str>) -> Result<String, String> {
    let was_running = is_target_running(app_type);
    if was_running {
        let killed_count = kill_app_processes(app_type)?;
        log::info!("正在安全终止目标应用 {} (清理 {} 个进程)...", app_type, killed_count);
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

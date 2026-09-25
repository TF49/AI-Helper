use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use sysinfo::System;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppPathsConfig {
    pub claude_cli_path: Option<String>,
    pub codex_cli_path: Option<String>,
    pub chatgpt_client_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DetectedPathInfo {
    pub app_type: String,
    pub path: String,
    pub exists: bool,
    pub source: String, // "running_process" | "npm_global" | "path_env" | "windows_apps" | "standard_dir" | "not_found"
    pub is_running: bool,
    pub extra_info: Option<String>,
}

pub fn get_app_paths_file() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".ai-helper").join("app_paths.json"))
}

pub fn load_app_paths() -> AppPathsConfig {
    let Ok(path) = get_app_paths_file() else {
        return AppPathsConfig::default();
    };
    if !path.exists() {
        return AppPathsConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AppPathsConfig::default(),
    }
}

pub fn save_app_paths(config: &AppPathsConfig) -> Result<(), AppError> {
    let path = get_app_paths_file()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&path, content)?;
    Ok(())
}

/// 查找环境变量 PATH 中的可执行文件 (支持 .cmd, .exe, .bat)
fn find_in_path(cmd_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    #[cfg(target_os = "windows")]
    let exts = ["cmd", "exe", "bat"];
    #[cfg(not(target_os = "windows"))]
    let exts = [""];

    #[cfg(target_os = "windows")]
    let sep = ';';
    #[cfg(not(target_os = "windows"))]
    let sep = ':';

    for dir in path_var.split(sep) {
        let dir_path = Path::new(dir);
        for ext in &exts {
            let filename = if ext.is_empty() {
                cmd_name.to_string()
            } else {
                format!("{}.{}", cmd_name, ext)
            };
            let candidate = dir_path.join(filename);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn matches_process(
    target: &str,
    name_lower: &str,
    cmd_line: &str,
    exe_path: Option<&Path>,
) -> bool {
    let exe_str = exe_path
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match target {
        "chatgpt" => {
            (name_lower == "chatgpt.exe"
                || name_lower == "chatgpt"
                || cmd_line.contains("chatgpt.exe"))
                && !name_lower.contains("crashpad")
        }
        "claude" => {
            name_lower == "claude.exe"
                || name_lower == "claude"
                || (name_lower == "node.exe" && cmd_line.contains("claude"))
        }
        "codex" => {
            // 排除 ChatGPT Store 客户端内置的辅助服务 (如 codex-windows-sandbox-service)
            if exe_str.contains("windowsapps")
                || name_lower.contains("sandbox")
                || name_lower.contains("command-runner")
                || name_lower.contains("service")
            {
                return false;
            }
            name_lower == "codex.exe"
                || name_lower == "codex"
                || (name_lower == "node.exe" && cmd_line.contains("codex"))
        }
        _ => false,
    }
}

/// 单次刷新探测指定目标运行状态和可执行文件路径
pub fn inspect_target_process(target: &str) -> (bool, Option<PathBuf>) {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All);
    inspect_target_process_with_system(target, &system)
}

fn inspect_target_process_with_system(target: &str, system: &System) -> (bool, Option<PathBuf>) {
    let mut is_running = false;
    let mut exe_path = None;

    for proc in system.processes().values() {
        let name_lower = proc.name().to_string_lossy().to_lowercase();
        let cmd_line = proc
            .cmd()
            .iter()
            .map(|a| a.to_string_lossy().to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");

        if matches_process(target, &name_lower, &cmd_line, proc.exe()) {
            is_running = true;
            if exe_path.is_none() {
                if let Some(exe) = proc.exe() {
                    if exe.exists() {
                        exe_path = Some(exe.to_path_buf());
                    }
                }
            }
            if exe_path.is_some() {
                break;
            }
        }
    }

    (is_running, exe_path)
}

/// 检查某个应用是否在运行
pub fn is_target_running(target: &str) -> bool {
    inspect_target_process(target).0
}

/// 收集目标运行时的 PID
pub fn get_target_pids(target: &str) -> Vec<u32> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All);
    let mut pids = Vec::new();

    for (pid, proc) in system.processes() {
        let name_lower = proc.name().to_string_lossy().to_lowercase();
        let cmd_line = proc
            .cmd()
            .iter()
            .map(|a| a.to_string_lossy().to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");

        if matches_process(target, &name_lower, &cmd_line, proc.exe()) {
            pids.push(pid.as_u32());
        }
    }
    pids
}

/// 探测 Claude CLI 路径 (内部复用进程扫描结果)
pub fn detect_claude_cli_path_internal(
    is_running: bool,
    running_exe: Option<PathBuf>,
) -> DetectedPathInfo {
    // 1. 尝试从运行中进程获取
    if let Some(path) = running_exe {
        return DetectedPathInfo {
            app_type: "claude".to_string(),
            path: path.to_string_lossy().to_string(),
            exists: true,
            source: "running_process".to_string(),
            is_running,
            extra_info: Some("探测自当前运行中的进程".to_string()),
        };
    }

    // 2. 检查全局 npm 目录 (Windows 优先 %APPDATA%\npm\claude.cmd)
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_claude = PathBuf::from(&appdata).join("npm").join("claude.cmd");
            if npm_claude.exists() {
                return DetectedPathInfo {
                    app_type: "claude".to_string(),
                    path: npm_claude.to_string_lossy().to_string(),
                    exists: true,
                    source: "npm_global".to_string(),
                    is_running,
                    extra_info: Some("探测自全局 npm 目录 (%APPDATA%\\npm)".to_string()),
                };
            }
        }
    }

    // 3. 检查 PATH 环境变量
    if let Some(path) = find_in_path("claude") {
        return DetectedPathInfo {
            app_type: "claude".to_string(),
            path: path.to_string_lossy().to_string(),
            exists: true,
            source: "path_env".to_string(),
            is_running,
            extra_info: Some("探测自系统 PATH 环境变量".to_string()),
        };
    }

    DetectedPathInfo {
        app_type: "claude".to_string(),
        path: String::new(),
        exists: false,
        source: "not_found".to_string(),
        is_running: false,
        extra_info: None,
    }
}

/// 探测 Claude CLI 路径
pub fn detect_claude_cli_path() -> DetectedPathInfo {
    let (is_running, running_exe) = inspect_target_process("claude");
    detect_claude_cli_path_internal(is_running, running_exe)
}

/// 探测 Codex CLI 路径 (内部复用进程扫描结果)
pub fn detect_codex_cli_path_internal(
    is_running: bool,
    running_exe: Option<PathBuf>,
) -> DetectedPathInfo {
    // 1. 尝试从运行中进程获取
    if let Some(path) = running_exe {
        return DetectedPathInfo {
            app_type: "codex".to_string(),
            path: path.to_string_lossy().to_string(),
            exists: true,
            source: "running_process".to_string(),
            is_running,
            extra_info: Some("探测自当前运行中的进程".to_string()),
        };
    }

    // 2. 检查全局 npm 目录 (Windows 优先 %APPDATA%\npm\codex.cmd)
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_codex = PathBuf::from(&appdata).join("npm").join("codex.cmd");
            if npm_codex.exists() {
                return DetectedPathInfo {
                    app_type: "codex".to_string(),
                    path: npm_codex.to_string_lossy().to_string(),
                    exists: true,
                    source: "npm_global".to_string(),
                    is_running,
                    extra_info: Some("探测自全局 npm 目录 (%APPDATA%\\npm)".to_string()),
                };
            }
        }
    }

    // 3. 检查 PATH 环境变量
    if let Some(path) = find_in_path("codex") {
        return DetectedPathInfo {
            app_type: "codex".to_string(),
            path: path.to_string_lossy().to_string(),
            exists: true,
            source: "path_env".to_string(),
            is_running,
            extra_info: Some("探测自系统 PATH 环境变量".to_string()),
        };
    }

    DetectedPathInfo {
        app_type: "codex".to_string(),
        path: String::new(),
        exists: false,
        source: "not_found".to_string(),
        is_running: false,
        extra_info: None,
    }
}

/// 探测 Codex CLI 路径
pub fn detect_codex_cli_path() -> DetectedPathInfo {
    let (is_running, running_exe) = inspect_target_process("codex");
    detect_codex_cli_path_internal(is_running, running_exe)
}

/// 探测 ChatGPT 桌面客户端路径 (内部复用进程扫描结果)
pub fn detect_chatgpt_client_path_internal(
    is_running: bool,
    running_exe: Option<PathBuf>,
) -> DetectedPathInfo {
    // 1. 尝试从运行中进程获取真实可执行路径
    if let Some(path) = running_exe {
        let is_store = path.to_string_lossy().contains("WindowsApps");
        return DetectedPathInfo {
            app_type: "chatgpt".to_string(),
            path: path.to_string_lossy().to_string(),
            exists: true,
            source: if is_store {
                "windows_apps".to_string()
            } else {
                "running_process".to_string()
            },
            is_running,
            extra_info: Some(if is_store {
                "探测自运行中实例 (Microsoft Store 商店版)".to_string()
            } else {
                "探测自当前运行中进程".to_string()
            }),
        };
    }

    // 2. 检查 Microsoft Store (WindowsApps/OpenAI.Codex)
    #[cfg(target_os = "windows")]
    {
        let windows_apps = Path::new("C:\\Program Files\\WindowsApps");
        if windows_apps.exists() {
            if let Ok(entries) = std::fs::read_dir(windows_apps) {
                let mut store_candidates = Vec::new();
                for entry in entries.flatten() {
                    let folder_name = entry.file_name().to_string_lossy().to_string();
                    if folder_name.starts_with("OpenAI.Codex_") {
                        let candidate_exe = entry.path().join("app").join("ChatGPT.exe");
                        if candidate_exe.exists() {
                            store_candidates.push((folder_name, candidate_exe));
                        }
                    }
                }

                // 按版本号降序排序，确保在版本升级/更新残留时始终选用最新版本
                store_candidates.sort_by(|a, b| b.0.cmp(&a.0));

                if let Some((latest_folder, latest_exe)) = store_candidates.into_iter().next() {
                    return DetectedPathInfo {
                        app_type: "chatgpt".to_string(),
                        path: latest_exe.to_string_lossy().to_string(),
                        exists: true,
                        source: "windows_apps".to_string(),
                        is_running,
                        extra_info: Some(format!("Microsoft Store 应用包 ({})", latest_folder)),
                    };
                }
            }
        }

        // 3. 检查常见 LocalAppData 安装路径
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let user_install = PathBuf::from(&local_appdata)
                .join("Programs")
                .join("ChatGPT")
                .join("ChatGPT.exe");
            if user_install.exists() {
                return DetectedPathInfo {
                    app_type: "chatgpt".to_string(),
                    path: user_install.to_string_lossy().to_string(),
                    exists: true,
                    source: "standard_dir".to_string(),
                    is_running,
                    extra_info: Some(
                        "标准用户安装目录 (%LOCALAPPDATA%\\Programs\\ChatGPT)".to_string(),
                    ),
                };
            }

            let direct_install = PathBuf::from(&local_appdata)
                .join("ChatGPT")
                .join("ChatGPT.exe");
            if direct_install.exists() {
                return DetectedPathInfo {
                    app_type: "chatgpt".to_string(),
                    path: direct_install.to_string_lossy().to_string(),
                    exists: true,
                    source: "standard_dir".to_string(),
                    is_running,
                    extra_info: Some("本地目录 (%LOCALAPPDATA%\\ChatGPT)".to_string()),
                };
            }
        }

        // 4. 检查 Program Files
        if let Ok(prog_files) = std::env::var("ProgramFiles") {
            let pf_install = PathBuf::from(prog_files)
                .join("ChatGPT")
                .join("ChatGPT.exe");
            if pf_install.exists() {
                return DetectedPathInfo {
                    app_type: "chatgpt".to_string(),
                    path: pf_install.to_string_lossy().to_string(),
                    exists: true,
                    source: "standard_dir".to_string(),
                    is_running,
                    extra_info: Some("系统安装目录 (Program Files\\ChatGPT)".to_string()),
                };
            }
        }
    }

    // 5. 检查 PATH
    if let Some(path) = find_in_path("chatgpt") {
        return DetectedPathInfo {
            app_type: "chatgpt".to_string(),
            path: path.to_string_lossy().to_string(),
            exists: true,
            source: "path_env".to_string(),
            is_running,
            extra_info: Some("探测自系统 PATH 环境变量".to_string()),
        };
    }

    DetectedPathInfo {
        app_type: "chatgpt".to_string(),
        path: String::new(),
        exists: false,
        source: "not_found".to_string(),
        is_running: false,
        extra_info: None,
    }
}

/// 探测 ChatGPT 桌面客户端路径
pub fn detect_chatgpt_client_path() -> DetectedPathInfo {
    let (is_running, running_exe) = inspect_target_process("chatgpt");
    detect_chatgpt_client_path_internal(is_running, running_exe)
}

/// 单次扫描系统进程树，高效全量探测所有应用路径
pub fn detect_all_app_paths() -> Vec<DetectedPathInfo> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All);

    let (claude_run, claude_exe) = inspect_target_process_with_system("claude", &system);
    let (codex_run, codex_exe) = inspect_target_process_with_system("codex", &system);
    let (chatgpt_run, chatgpt_exe) = inspect_target_process_with_system("chatgpt", &system);

    vec![
        detect_claude_cli_path_internal(claude_run, claude_exe),
        detect_codex_cli_path_internal(codex_run, codex_exe),
        detect_chatgpt_client_path_internal(chatgpt_run, chatgpt_exe),
    ]
}

/// 弹出系统文件选择窗口
#[cfg(target_os = "windows")]
pub fn browse_path_dialog(app_type: &str) -> Result<Option<String>, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // 白名单校验输入 app_type，防止非法传参或 PowerShell 字符串拼接注入
    let (filter_name, filter_ext, title) = match app_type {
        "chatgpt" => (
            "可执行文件 (*.exe)",
            "*.exe",
            "选择 ChatGPT 客户端路径 (ChatGPT.exe)",
        ),
        "claude" => (
            "命令与可执行文件 (*.cmd;*.exe;*.bat)",
            "*.cmd;*.exe;*.bat",
            "选择 Claude CLI 启动入口 (claude.cmd / claude.exe)",
        ),
        "codex" => (
            "命令与可执行文件 (*.cmd;*.exe;*.bat)",
            "*.cmd;*.exe;*.bat",
            "选择 Codex CLI 启动入口 (codex.cmd / codex.exe)",
        ),
        _ => return Err(format!("不支持的应用类型选择: {}", app_type)),
    };

    let ps_script = format!(
        "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; \
         $f = New-Object System.Windows.Forms.OpenFileDialog; \
         $f.Filter = '{0}|{1}|所有文件 (*.*)|*.*'; \
         $f.Title = '{2}'; \
         $f.RestoreDirectory = $true; \
         if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Host $f.FileName }}",
        filter_name, filter_ext, title
    );

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &ps_script,
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("唤起文件选择对话框失败: {}", e))?;

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn browse_path_dialog(_app_type: &str) -> Result<Option<String>, String> {
    Err("当前平台不支持文件选择器".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_claude_cli_path_does_not_panic() {
        let detected = detect_claude_cli_path();
        assert_eq!(detected.app_type, "claude");
        println!("Detected Claude: {:?}", detected);
    }

    #[test]
    fn test_detect_codex_cli_path_does_not_panic() {
        let detected = detect_codex_cli_path();
        assert_eq!(detected.app_type, "codex");
        println!("Detected Codex: {:?}", detected);
    }

    #[test]
    fn test_detect_chatgpt_client_path_does_not_panic() {
        let detected = detect_chatgpt_client_path();
        assert_eq!(detected.app_type, "chatgpt");
        println!("Detected ChatGPT: {:?}", detected);
    }

    #[test]
    fn test_app_paths_config_serde() {
        let cfg = AppPathsConfig {
            claude_cli_path: Some("C:\\bin\\claude.cmd".to_string()),
            codex_cli_path: Some("C:\\bin\\codex.cmd".to_string()),
            chatgpt_client_path: Some("C:\\Program Files\\ChatGPT\\ChatGPT.exe".to_string()),
        };

        let json = serde_json::to_string(&cfg).expect("serialize");
        let deserialized: AppPathsConfig = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(deserialized.claude_cli_path, cfg.claude_cli_path);
        assert_eq!(deserialized.codex_cli_path, cfg.codex_cli_path);
        assert_eq!(deserialized.chatgpt_client_path, cfg.chatgpt_client_path);
    }
}

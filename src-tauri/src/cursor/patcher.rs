use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CursorPatchInfo {
    pub is_installed: bool,
    pub cursor_app_path: Option<String>,
    pub workbench_js_path: Option<String>,
    pub product_json_path: Option<String>,
    pub is_patched: bool,
    pub current_bridge_target: Option<String>,
    pub backup_exists: bool,
    pub message: String,
}

/// 计算 VS Code / Cursor product.json 校验和 (Sha256 + Base64 无末尾等号)
pub fn compute_file_checksum(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    STANDARD
        .encode(hasher.finalize())
        .trim_end_matches('=')
        .to_string()
}

/// 探测 Cursor 根目录
pub fn find_cursor_root(custom_path: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_path {
        let p = PathBuf::from(custom.trim());
        if p.exists() {
            if p.is_file() {
                if let Some(parent) = p.parent() {
                    return Some(parent.to_path_buf());
                }
            }
            return Some(p);
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 优先检查常见安装路径 (包括用户实际工作区目录)
        let candidates = [
            PathBuf::from("E:\\Developer Tool\\Cursor"),
            dirs::data_local_dir()
                .map(|p| p.join("Programs").join("cursor"))
                .unwrap_or_default(),
            dirs::data_local_dir()
                .map(|p| p.join("Programs").join("Cursor"))
                .unwrap_or_default(),
            PathBuf::from("C:\\Program Files\\Cursor"),
            PathBuf::from("C:\\Program Files (x86)\\Cursor"),
        ];

        for c in &candidates {
            if c.exists() && (c.join("Cursor.exe").exists() || c.join("cursor.exe").exists()) {
                return Some(c.clone());
            }
        }

        // 注册表检测
        if let Ok(reg_key) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall")
        {
            for sub in reg_key.enum_keys().filter_map(|r| r.ok()) {
                if sub.to_lowercase().contains("cursor") {
                    if let Ok(k) = reg_key.open_subkey(&sub) {
                        if let Ok(loc) = k.get_value::<String, _>("InstallLocation") {
                            let p = PathBuf::from(loc.trim());
                            if p.exists() {
                                return Some(p);
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mac_candidates = [
            PathBuf::from("/Applications/Cursor.app"),
            dirs::home_dir()
                .map(|h| h.join("Applications").join("Cursor.app"))
                .unwrap_or_default(),
        ];
        for c in &mac_candidates {
            if c.exists() {
                return Some(c.clone());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let linux_candidates = [
            PathBuf::from("/opt/Cursor"),
            PathBuf::from("/usr/share/cursor"),
            dirs::home_dir()
                .map(|h| h.join(".local/share/cursor"))
                .unwrap_or_default(),
        ];
        for c in &linux_candidates {
            if c.exists() {
                return Some(c.clone());
            }
        }
    }

    None
}

/// 定位 workbench.desktop.main.js、workbench.glass.main.js 与 product.json
#[derive(Debug, Clone)]
pub struct CursorPatchTargets {
    pub desktop_workbench_js: PathBuf,
    pub glass_workbench_js: Option<PathBuf>,
    pub product_json: PathBuf,
}

pub fn resolve_cursor_patch_targets(root: &Path) -> Option<CursorPatchTargets> {
    #[cfg(target_os = "macos")]
    let base = root.join("Contents").join("Resources").join("app");
    #[cfg(not(target_os = "macos"))]
    let base = root.join("resources").join("app");

    let workbench_js = base
        .join("out")
        .join("vs")
        .join("workbench")
        .join("workbench.desktop.main.js");
    let glass_workbench_js = base
        .join("out")
        .join("vs")
        .join("workbench")
        .join("workbench.glass.main.js");
    let product_json = base.join("product.json");

    if (workbench_js.exists() || glass_workbench_js.exists()) && product_json.exists() {
        Some(CursorPatchTargets {
            desktop_workbench_js: workbench_js,
            glass_workbench_js: if glass_workbench_js.exists() {
                Some(glass_workbench_js)
            } else {
                None
            },
            product_json,
        })
    } else {
        None
    }
}

pub fn get_backup_dir(root: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    let base = root.join("Contents").join("Resources").join("app");
    #[cfg(not(target_os = "macos"))]
    let base = root.join("resources").join("app");

    base.join(".ai-helper-backup")
}

pub fn get_patch_status(custom_path: Option<&str>) -> CursorPatchInfo {
    let Some(root) = find_cursor_root(custom_path) else {
        return CursorPatchInfo {
            is_installed: false,
            cursor_app_path: None,
            workbench_js_path: None,
            product_json_path: None,
            is_patched: false,
            current_bridge_target: None,
            backup_exists: false,
            message: "未检测到 Cursor 安装路径，请手动指定".to_string(),
        };
    };

    let cursor_app_path = root.to_string_lossy().to_string();

    let Some(targets) = resolve_cursor_patch_targets(&root) else {
        return CursorPatchInfo {
            is_installed: true,
            cursor_app_path: Some(cursor_app_path),
            workbench_js_path: None,
            product_json_path: None,
            is_patched: false,
            current_bridge_target: None,
            backup_exists: false,
            message: "已找到 Cursor，但未找到 resources/app 核心资源文件".to_string(),
        };
    };

    let backup_dir = get_backup_dir(&root);
    let backup_exists = backup_dir.join("workbench.desktop.main.js.bak").exists()
        && backup_dir.join("product.json.bak").exists();

    // 优先读取实际生效的主核心文件 (若存在 Glass 现代架构则以 Glass 为主)
    let active_wb_path = targets
        .glass_workbench_js
        .as_ref()
        .unwrap_or(&targets.desktop_workbench_js);

    match std::fs::read_to_string(active_wb_path) {
        Ok(content) => {
            let marker = "http://127.0.0.1:";
            let is_patched =
                content.contains(marker) || content.contains("/* [AI-Helper Patched] */");
            let current_bridge_target = if let Some(idx) = content.find(marker) {
                let slice = &content[idx..std::cmp::min(idx + 30, content.len())];
                let port_end = slice
                    .find('"')
                    .or_else(|| slice.find('\''))
                    .unwrap_or(slice.len());
                Some(slice[..port_end].to_string())
            } else {
                None
            };

            let architecture_label = if targets.glass_workbench_js.is_some() {
                "Cursor Glass 现代架构"
            } else {
                "Cursor Desktop 传统架构"
            };

            CursorPatchInfo {
                is_installed: true,
                cursor_app_path: Some(cursor_app_path),
                workbench_js_path: Some(active_wb_path.to_string_lossy().to_string()),
                product_json_path: Some(targets.product_json.to_string_lossy().to_string()),
                is_patched,
                current_bridge_target,
                backup_exists,
                message: if is_patched {
                    format!(
                        "{} 已成功挂接 AI-Helper 本地 Bridge 网关",
                        architecture_label
                    )
                } else {
                    format!(
                        "{} 处于原生官方连接模式，可一键修补接入",
                        architecture_label
                    )
                },
            }
        }
        Err(e) => CursorPatchInfo {
            is_installed: true,
            cursor_app_path: Some(cursor_app_path),
            workbench_js_path: Some(active_wb_path.to_string_lossy().to_string()),
            product_json_path: Some(targets.product_json.to_string_lossy().to_string()),
            is_patched: false,
            current_bridge_target: None,
            backup_exists,
            message: format!("读取核心 JS 文件失败: {}", e),
        },
    }
}

/// 原子方式写入文件，防止进程崩溃导致文件损坏截断
pub fn atomic_write_file(path: &Path, content: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or_else(|| format!("文件没有父目录: {:?}", path))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".ai-helper-")
        .tempfile_in(parent)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    #[cfg(unix)]
    match std::fs::metadata(path) {
        Ok(metadata) => temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| format!("保留原文件权限失败: {}", e))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("读取原文件权限失败: {}", error)),
    }
    temporary
        .write_all(content)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    let tmp_path = temporary.into_temp_path();

    #[cfg(windows)]
    {
        // Windows: 使用 MoveFileEx 的 MOVEFILE_REPLACE_EXISTING 原子替换
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let tmp_wide: Vec<u16> = OsStr::new(tmp_path.as_os_str())
            .encode_wide()
            .chain(Some(0))
            .collect();
        let dst_wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();

        let result = unsafe {
            winapi::um::winbase::MoveFileExW(
                tmp_wide.as_ptr(),
                dst_wide.as_ptr(),
                winapi::um::winbase::MOVEFILE_REPLACE_EXISTING
                    | winapi::um::winbase::MOVEFILE_WRITE_THROUGH,
            )
        };

        if result == 0 {
            let error = std::io::Error::last_os_error();
            return Err(format!("Windows 原子替换文件 {:?} 失败: {}", path, error));
        }
    }

    #[cfg(not(windows))]
    {
        if let Err(e) = std::fs::rename(&tmp_path, path) {
            return Err(format!("Unix 原子替换文件 {:?} 失败: {}", path, e));
        }
    }
    Ok(())
}

pub const CURSOR_BASE_DOMAINS: &[&str] = &[
    "https://api.cursor.sh",
    "https://api2.cursor.sh",
    "https://api3.cursor.sh",
    "https://api4.cursor.sh",
    "https://api5.cursor.sh",
    "https://agent.api5.cursor.sh",
    "https://agentn.api5.cursor.sh",
    "https://api.cursor.com",
    "https://api.origin.cursor.com",
    "https://api.origin-staging.cursor.com",
];

pub fn patch_js_content(content: &str, bridge_port: u16) -> String {
    let target_url = format!("http://127.0.0.1:{}", bridge_port);
    let mut current_content = content.to_string();

    for domain in CURSOR_BASE_DOMAINS {
        current_content = current_content.replace(domain, &target_url);
    }

    // 匹配所有以 agent 开头、发往 cursor.sh 的域名 (包括 agentn.global.api5、地域节点 agent*-gcpp-* 等)
    if let Ok(agent_pattern) = regex_lite::Regex::new(r"https://agent[a-zA-Z0-9_.-]*\.cursor\.sh") {
        current_content = agent_pattern
            .replace_all(&current_content, target_url.as_str())
            .to_string();
    }

    regex_lite_or_simple_replace(&current_content, bridge_port)
}

pub fn get_cursor_global_storage_db_path() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    let path = config_dir
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

pub fn patch_cursor_state_vscdb(bridge_port: u16) -> Result<(), String> {
    let Some(db_path) = get_cursor_global_storage_db_path() else {
        log::info!("未找到 Cursor globalStorage/state.vscdb，跳过数据库修补");
        return Ok(());
    };

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("打开 Cursor state.vscdb 失败: {}", e))?;

    // 在备份和修改前，执行 TRUNCATE 检查点，确保 WAL 事务日志合并至主库
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    let bak_path = db_path.with_extension("vscdb.ai-helper-bak");
    if !bak_path.exists() {
        if let Err(e) = std::fs::copy(&db_path, &bak_path) {
            log::warn!("备份 state.vscdb 失败 (非阻塞): {}", e);
        }
    }

    let target_url = format!("http://127.0.0.1:{}", bridge_port);

    let app_user_key = "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";
    let app_user_query: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [app_user_key],
        |row| row.get(0),
    );

    if let Ok(val_str) = app_user_query {
        if let Ok(mut data) = serde_json::from_str::<serde_json::Value>(&val_str) {
            if let Some(creds) = data.get_mut("cursorCreds").and_then(|c| c.as_object_mut()) {
                creds.insert(
                    "backendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "originBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "repoBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "telemBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "cmdkBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "geoCppBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "cppConfigBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "bcProxyUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "cppBackendUrl".into(),
                    serde_json::Value::String(target_url.clone()),
                );

                let mut default_map = serde_json::Map::new();
                default_map.insert(
                    "default".into(),
                    serde_json::Value::String(target_url.clone()),
                );
                creds.insert(
                    "agentBackendUrlPrivacy".into(),
                    serde_json::Value::Object(default_map.clone()),
                );
                creds.insert(
                    "agentBackendUrlNonPrivacy".into(),
                    serde_json::Value::Object(default_map),
                );

                if let Ok(new_val) = serde_json::to_string(&data) {
                    if let Err(e) = conn.execute(
                        "UPDATE ItemTable SET value = ?1 WHERE key = ?2",
                        rusqlite::params![new_val, app_user_key],
                    ) {
                        log::warn!("更新 state.vscdb applicationUser 失败: {}", e);
                    }
                }
            }
        }
    }

    let server_config_key = "cursorai/serverConfig";
    let server_config_query: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [server_config_key],
        |row| row.get(0),
    );

    if let Ok(val_str) = server_config_query {
        let mut replaced = val_str;
        for domain in CURSOR_BASE_DOMAINS {
            replaced = replaced.replace(domain, &target_url);
        }
        if let Ok(reg) = regex_lite::Regex::new(r"https://agent[a-zA-Z0-9_.-]*\.cursor\.sh") {
            replaced = reg.replace_all(&replaced, target_url.as_str()).to_string();
        }
        if let Err(e) = conn.execute(
            "UPDATE ItemTable SET value = ?1 WHERE key = ?2",
            rusqlite::params![replaced, server_config_key],
        ) {
            log::warn!("更新 state.vscdb cursorai/serverConfig 失败: {}", e);
        }
    }

    // 更新完成后再次执行 TRUNCATE 检查点，确保修改立即落盘，避免残留于 -wal 缓冲
    if let Err(e) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        log::warn!("state.vscdb WAL 检查点同步失败 (非阻塞): {}", e);
    }

    log::info!(
        "已成功同步 Cursor globalStorage/state.vscdb 路由至 {}",
        target_url
    );
    Ok(())
}

pub fn restore_cursor_state_vscdb() -> Result<(), String> {
    let Some(db_path) = get_cursor_global_storage_db_path() else {
        return Ok(());
    };
    let bak_path = db_path.with_extension("vscdb.ai-helper-bak");
    if bak_path.exists() {
        if let Err(e) = std::fs::copy(&bak_path, &db_path) {
            log::warn!("还原 state.vscdb 失败 (非阻塞): {}", e);
        } else {
            let _ = std::fs::remove_file(&bak_path);
            log::info!("已成功从备份恢复 Cursor globalStorage/state.vscdb");
        }

        // 清理潜在残留的 WAL 和 SHM 文件，防止 SQLite 重放已修补的旧事务日志
        if let Some(parent) = db_path.parent() {
            let wal_path = parent.join("state.vscdb-wal");
            let shm_path = parent.join("state.vscdb-shm");
            let _ = std::fs::remove_file(wal_path);
            let _ = std::fs::remove_file(shm_path);
        }
    }
    Ok(())
}

pub fn apply_patch(custom_path: Option<&str>, bridge_port: u16) -> Result<String, String> {
    let root = find_cursor_root(custom_path).ok_or("未找到 Cursor 安装根目录")?;

    // 强制清理正在运行的 Cursor 进程并等待退出，防止文件锁占用
    if crate::app_paths::is_target_running("cursor") {
        log::warn!("检测到 Cursor 正在运行，正在安全清理进程树以释放文件锁...");
        crate::process_manager::kill_app_processes("cursor")
            .map_err(|e| format!("清理 Cursor 进程失败: {}", e))?;

        if !crate::process_manager::wait_for_app_exit("cursor", 5000) {
            return Err("Cursor 进程清理超时（5秒），请手动关闭所有 Cursor 窗口后重试".to_string());
        }
        // 额外等待 300ms 确保文件句柄完全释放
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    let targets = resolve_cursor_patch_targets(&root).ok_or("未找到 Cursor 核心 workbench 文件")?;

    let backup_dir = get_backup_dir(&root);
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;

    let current_prod_bytes = std::fs::read(&targets.product_json)
        .map_err(|e| format!("读取 product.json 失败: {}", e))?;
    let current_content = std::fs::read_to_string(&targets.desktop_workbench_js)
        .map_err(|e| format!("读取 workbench.desktop.main.js 失败: {}", e))?;
    let is_currently_patched = current_content.contains("http://127.0.0.1:")
        || current_content.contains("/* [AI-Helper Patched] */");

    ensure_backup(
        &backup_dir,
        &current_prod_bytes,
        current_content.as_bytes(),
        is_currently_patched,
    )?;

    // 1. 修补 workbench.desktop.main.js 与 workbench.glass.main.js
    let modified_desktop = patch_js_content(&current_content, bridge_port);
    let modified_desktop_bytes = modified_desktop.as_bytes();

    let prod_str = std::fs::read_to_string(&targets.product_json)
        .map_err(|e| format!("读取 product.json 失败: {}", e))?;
    let mut prod_val: serde_json::Value =
        serde_json::from_str(&prod_str).map_err(|e| format!("解析 product.json 失败: {}", e))?;

    if prod_val
        .get("checksums")
        .and_then(|v| v.as_object())
        .is_none()
    {
        return Err("product.json 缺少 checksums 字段，无法安全修补 workbench.js".to_string());
    }

    let new_checksum = compute_file_checksum(modified_desktop_bytes);
    let checksums = prod_val
        .get_mut("checksums")
        .and_then(|v| v.as_object_mut())
        .unwrap();

    checksums.insert(
        "vs/workbench/workbench.desktop.main.js".to_string(),
        serde_json::Value::String(new_checksum),
    );

    // 2. 预备修补 workbench.glass.main.js 并同步 product.json 校验和（若 checksums 中存在）
    let modified_glass = if let Some(ref glass_path) = targets.glass_workbench_js {
        if glass_path.exists() {
            let current_glass_content = std::fs::read_to_string(glass_path)
                .map_err(|e| format!("读取 workbench.glass.main.js 失败: {}", e))?;
            let is_glass_patched = current_glass_content.contains("http://127.0.0.1:")
                || current_glass_content.contains("/* [AI-Helper Patched] */");

            let glass_bak = backup_dir.join("workbench.glass.main.js.bak");
            if !glass_bak.exists() && !is_glass_patched {
                if let Err(e) = atomic_write_file(&glass_bak, current_glass_content.as_bytes()) {
                    log::warn!("备份 workbench.glass.main.js 失败 (非阻塞): {}", e);
                }
            }

            let modified = patch_js_content(&current_glass_content, bridge_port);
            if checksums.contains_key("vs/workbench/workbench.glass.main.js") {
                let glass_checksum = compute_file_checksum(modified.as_bytes());
                checksums.insert(
                    "vs/workbench/workbench.glass.main.js".to_string(),
                    serde_json::Value::String(glass_checksum),
                );
            }
            Some((glass_path.clone(), modified))
        } else {
            None
        }
    } else {
        None
    };

    let updated_prod = serde_json::to_string_pretty(&prod_val)
        .map_err(|e| format!("序列化 product.json 失败: {}", e))?;

    let wb_original = std::fs::read(&targets.desktop_workbench_js)
        .map_err(|e| format!("读取当前 workbench.js 用于回滚失败: {}", e))?;

    if let Err(e) = atomic_write_file(&targets.desktop_workbench_js, modified_desktop_bytes) {
        return Err(format!("写入 workbench.desktop.main.js 失败: {}", e));
    }

    if let Err(e) = atomic_write_file(&targets.product_json, updated_prod.as_bytes()) {
        log::error!("写入 product.json 失败，正在回滚 workbench.js: {}", e);
        if let Err(rollback_err) = atomic_write_file(&targets.desktop_workbench_js, &wb_original) {
            return Err(format!(
                "写入 product.json 失败: {}；回滚 workbench.js 也失败: {}。系统可能处于不一致状态，请手动从备份恢复",
                e, rollback_err
            ));
        }
        return Err(format!(
            "写入 product.json 失败: {}；已回滚 workbench.js",
            e
        ));
    }

    // 写入 workbench.glass.main.js
    if let Some((ref glass_path, ref modified_glass_content)) = modified_glass {
        if let Err(e) = atomic_write_file(glass_path, modified_glass_content.as_bytes()) {
            log::error!(
                "写入 workbench.glass.main.js 失败，正在回滚 desktop 与 product.json: {}",
                e
            );
            let _ = atomic_write_file(&targets.desktop_workbench_js, &wb_original);
            let _ = atomic_write_file(&targets.product_json, &current_prod_bytes);
            return Err(format!("修补 workbench.glass.main.js 失败: {}", e));
        }
        log::info!("已成功完成 Cursor Glass 现代架构 workbench.glass.main.js 修补");
    }

    // 3. 自动同步 Cursor 本地持久化缓存数据库 (state.vscdb)
    if let Err(e) = patch_cursor_state_vscdb(bridge_port) {
        log::warn!("同步 Cursor globalStorage/state.vscdb 失败 (非致命): {}", e);
    }

    // 4. 优化 Cursor 用户配置：禁用 HTTP/2 强制降级并启用代理支持
    if let Err(error) = configure_cursor_user_settings(true) {
        return Err(rollback_after_settings_error(
            &targets.desktop_workbench_js,
            &wb_original,
            &targets.product_json,
            &current_prod_bytes,
            error,
        ));
    }

    let target_url = format!("http://127.0.0.1:{}", bridge_port);
    Ok(format!("成功修补 Cursor！请求已重定向至 {}", target_url))
}

pub fn get_cursor_user_settings_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        Some(appdata.join("Cursor").join("User").join("settings.json"))
    }
    #[cfg(target_os = "macos")]
    {
        Some(
            home.join("Library")
                .join("Application Support")
                .join("Cursor")
                .join("User")
                .join("settings.json"),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        Some(config.join("Cursor").join("User").join("settings.json"))
    }
}

pub fn configure_cursor_user_settings(disable_http2: bool) -> Result<(), String> {
    let path = get_cursor_user_settings_path().ok_or("无法定位 Cursor 用户设置目录")?;
    configure_settings_at(&path, disable_http2)
}

fn read_settings(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("读取 Cursor 设置 {:?} 失败: {}", path, e))?;
    json5::from_str(&content).map_err(|e| format!("解析 Cursor 设置 {:?} 失败: {}", path, e))
}

fn configure_settings_at(path: &Path, enable: bool) -> Result<(), String> {
    let bak_path = path.with_extension("ai-helper-bak");
    const KEYS: [&str; 2] = ["cursor.general.disableHttp2", "http.proxySupport"];
    if !enable && !bak_path.exists() {
        // Without provenance, existing user settings must be left intact.
        return Ok(());
    }
    let (mut current, original_bytes) = match std::fs::read_to_string(path) {
        Ok(content) => {
            let map = json5::from_str::<serde_json::Map<String, serde_json::Value>>(&content)
                .map_err(|e| format!("解析 Cursor settings.json 失败，已保留备份: {}", e))?;
            (map, content.into_bytes())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (serde_json::Map::new(), b"{}".to_vec())
        }
        Err(error) => {
            return Err(format!(
                "读取 Cursor settings.json 失败，已保留备份: {}",
                error
            ))
        }
    };
    if enable {
        if bak_path.exists() {
            read_settings(&bak_path)?;
        } else {
            let parent = path.parent().ok_or("无法定位设置父目录")?;
            std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {}", e))?;
            // Store an empty original map even if settings.json did not exist.
            atomic_write_file(&bak_path, &original_bytes)
                .map_err(|e| format!("备份 Cursor 设置失败，已停止修改: {}", e))?;
        }
        current.insert(KEYS[0].into(), serde_json::Value::Bool(true));
        current.insert(KEYS[1].into(), serde_json::Value::String("on".into()));
    } else {
        let original = read_settings(&bak_path)?;
        for key in KEYS {
            if let Some(value) = original.get(key) {
                current.insert(key.into(), value.clone());
            } else {
                current.remove(key);
            }
        }
    }
    let updated = serde_json::to_vec_pretty(&current)
        .map_err(|e| format!("序列化 Cursor 设置失败: {}", e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {}", e))?;
    }
    atomic_write_file(path, &updated)
        .map_err(|e| format!("写入 Cursor 设置失败，已保留备份: {}", e))?;
    if !enable {
        // Failure to remove an obsolete backup is safe and must not turn a
        // completed settings restore into an attempted core-file rollback.
        if let Err(error) = std::fs::remove_file(&bak_path) {
            log::warn!("设置已恢复，但清理备份 {:?} 失败: {}", bak_path, error);
        }
    }
    Ok(())
}

fn required_commit(value: &serde_json::Value) -> Result<&str, String> {
    value
        .get("commit")
        .and_then(|v| v.as_str())
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 256
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        })
        .ok_or_else(|| "缺少有效的非空 Cursor commit，无法确认版本安全性".to_string())
}

fn validate_workbench_checksum(
    product: &serde_json::Value,
    workbench: &[u8],
) -> Result<(), String> {
    let expected = product
        .get("checksums")
        .and_then(|v| v.get("vs/workbench/workbench.desktop.main.js"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("product.json 缺少 workbench checksum，无法验证备份完整性")?;
    if expected.trim_end_matches('=') != compute_file_checksum(workbench) {
        return Err("workbench 备份与 product.json checksum 不匹配".into());
    }
    Ok(())
}

fn ensure_backup(
    directory: &Path,
    product: &[u8],
    workbench: &[u8],
    is_patched: bool,
) -> Result<(), String> {
    let product_value: serde_json::Value =
        serde_json::from_slice(product).map_err(|e| format!("解析 product.json 失败: {}", e))?;
    let current_commit = required_commit(&product_value)?;
    let wb_bak = directory.join("workbench.desktop.main.js.bak");
    let prod_bak = directory.join("product.json.bak");
    let meta_file = directory.join("backup_meta.json");
    if let Err(error) = validated_backup(directory, current_commit) {
        if is_patched {
            return Err(format!("原始备份不完整或版本不匹配，拒绝覆盖已修补文件: {}。请先恢复或重新安装当前版本 Cursor", error));
        }
        // An unpatched installation is the only safe source for rebuilding an
        // incomplete/stale backup set. Validate before touching either target.
        validate_workbench_checksum(&product_value, workbench)?;
        let meta_json = serde_json::json!({
            "commit": current_commit,
            "version": product_value.get("version").and_then(|v| v.as_str()).unwrap_or(""),
            "workbench_checksum": compute_file_checksum(workbench),
            "product_checksum": compute_file_checksum(product),
            "backed_up_at": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
        });
        let metadata = serde_json::to_vec_pretty(&meta_json)
            .map_err(|e| format!("序列化备份元数据失败: {}", e))?;
        atomic_write_file(&wb_bak, workbench)?;
        atomic_write_file(&prod_bak, product)?;
        atomic_write_file(&meta_file, &metadata)
            .map_err(|e| format!("写入备份元数据失败: {}", e))?;
        validated_backup(directory, current_commit)?;
    }

    Ok(())
}

fn validated_backup(directory: &Path, current_commit: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
    let meta_file = directory.join("backup_meta.json");
    let metadata: Option<serde_json::Value> = match std::fs::read(&meta_file) {
        Ok(raw) => {
            let val: serde_json::Value =
                serde_json::from_slice(&raw).map_err(|e| format!("解析备份元数据失败: {}", e))?;
            Some(val)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("读取备份元数据失败: {}", err)),
    };

    if let Some(ref meta) = metadata {
        if required_commit(meta)? != current_commit {
            return Err("当前 Cursor 与备份元数据的 commit 不匹配".into());
        }
    }

    let workbench = std::fs::read(directory.join("workbench.desktop.main.js.bak"))
        .map_err(|e| format!("读取备份 workbench 失败: {}", e))?;
    let product = std::fs::read(directory.join("product.json.bak"))
        .map_err(|e| format!("读取备份 product.json 失败: {}", e))?;
    let product_value: serde_json::Value = serde_json::from_slice(&product)
        .map_err(|e| format!("解析备份 product.json 失败: {}", e))?;
    if required_commit(&product_value)? != current_commit {
        return Err("备份 product.json 的 commit 与当前版本不匹配".into());
    }
    validate_workbench_checksum(&product_value, &workbench)?;

    if let Some(ref meta) = metadata {
        for (field, bytes) in [
            ("workbench_checksum", &workbench),
            ("product_checksum", &product),
        ] {
            // Older complete backups only recorded commit; their actual product
            // version and workbench checksum are still mandatory above.
            if let Some(checksum) = meta.get(field) {
                if checksum.as_str() != Some(compute_file_checksum(bytes).as_str()) {
                    return Err(format!("备份元数据 {} 校验失败", field));
                }
            }
        }
    } else {
        // 兼容老版本备份（缺少 backup_meta.json）：自动修复补齐元数据
        let meta_json = serde_json::json!({
            "commit": current_commit,
            "version": product_value.get("version").and_then(|v| v.as_str()).unwrap_or(""),
            "workbench_checksum": compute_file_checksum(&workbench),
            "product_checksum": compute_file_checksum(&product),
            "backed_up_at": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
        });
        if let Ok(meta_bytes) = serde_json::to_vec_pretty(&meta_json) {
            let _ = atomic_write_file(&meta_file, &meta_bytes);
        }
    }

    Ok((workbench, product))
}

fn rollback_after_settings_error(
    wb_path: &Path,
    workbench: &[u8],
    prod_path: &Path,
    product: &[u8],
    error: String,
) -> String {
    let wb_result = atomic_write_file(wb_path, workbench);
    let product_result = atomic_write_file(prod_path, product);
    match (wb_result, product_result) {
        (Ok(()), Ok(())) => format!("设置操作失败: {}；已回滚核心文件，设置备份已保留", error),
        (wb, product) => format!(
            "设置操作失败: {}；核心文件回滚结果 workbench={:?}, product={:?}，请从备份恢复",
            error, wb, product
        ),
    }
}

fn regex_lite_or_simple_replace(content: &str, target_port: u16) -> String {
    let pattern =
        regex_lite::Regex::new(r"http://127\.0\.0\.1:\d+").expect("端口热换正则表达式无效");
    let target = format!("http://127.0.0.1:{}", target_port);
    pattern.replace_all(content, target.as_str()).to_string()
}

pub fn restore_patch(custom_path: Option<&str>) -> Result<String, String> {
    let root = find_cursor_root(custom_path).ok_or("未找到 Cursor 安装根目录")?;

    // 强制清理正在运行的 Cursor 进程并等待退出，防止文件锁占用
    if crate::app_paths::is_target_running("cursor") {
        log::warn!("检测到 Cursor 正在运行，正在安全清理进程树以释放文件锁...");
        crate::process_manager::kill_app_processes("cursor")
            .map_err(|e| format!("清理 Cursor 进程失败: {}", e))?;

        if !crate::process_manager::wait_for_app_exit("cursor", 5000) {
            return Err("Cursor 进程清理超时（5秒），请手动关闭所有 Cursor 窗口后重试".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    let targets = resolve_cursor_patch_targets(&root).ok_or("未找到 Cursor 核心 workbench 文件")?;

    let backup_dir = get_backup_dir(&root);
    let prod_current = std::fs::read(&targets.product_json)
        .map_err(|e| format!("读取当前 product.json 失败: {}", e))?;
    let current_prod_val: serde_json::Value = serde_json::from_slice(&prod_current)
        .map_err(|e| format!("解析当前 product.json 失败: {}", e))?;
    let current_commit = required_commit(&current_prod_val)?;
    let (wb_backup_content, prod_backup_content) = validated_backup(&backup_dir, current_commit)?;

    // 保存当前 workbench 用于回滚（以防恢复失败）
    let wb_current = std::fs::read(&targets.desktop_workbench_js)
        .map_err(|e| format!("读取当前 workbench.js 用于回滚失败: {}", e))?;

    // 1. 原子恢复 workbench.desktop.main.js
    if let Err(e) = atomic_write_file(&targets.desktop_workbench_js, &wb_backup_content) {
        return Err(format!("还原 workbench.js 失败: {}", e));
    }

    // 原子恢复 product.json，失败时回滚第一个文件
    if let Err(e) = atomic_write_file(&targets.product_json, &prod_backup_content) {
        log::error!("还原 product.json 失败，正在回滚 workbench.js: {}", e);
        if let Err(rollback_err) = atomic_write_file(&targets.desktop_workbench_js, &wb_current) {
            return Err(format!(
                "还原 product.json 失败: {}；回滚 workbench.js 也失败: {}。系统可能处于不一致状态，请手动检查",
                e, rollback_err
            ));
        }
        return Err(format!(
            "还原 product.json 失败: {}；已回滚 workbench.js",
            e
        ));
    }

    // 2. 还原 workbench.glass.main.js (若存在备份)
    if let Some(ref glass_path) = targets.glass_workbench_js {
        let glass_bak = backup_dir.join("workbench.glass.main.js.bak");
        if glass_bak.exists() {
            if let Ok(glass_content) = std::fs::read(&glass_bak) {
                if let Err(e) = atomic_write_file(glass_path, &glass_content) {
                    log::warn!("还原 workbench.glass.main.js 失败: {}", e);
                } else {
                    let _ = std::fs::remove_file(&glass_bak);
                    log::info!("已成功还原 workbench.glass.main.js");
                }
            }
        }
    }

    // 3. 还原 Cursor 本地状态数据库 (state.vscdb)
    if let Err(e) = restore_cursor_state_vscdb() {
        log::warn!("还原 state.vscdb 失败 (非阻塞): {}", e);
    }

    // 4. 恢复 Cursor 用户配置
    if let Err(error) = configure_cursor_user_settings(false) {
        return Err(rollback_after_settings_error(
            &targets.desktop_workbench_js,
            &wb_current,
            &targets.product_json,
            &prod_current,
            error,
        ));
    }

    Ok("成功还原 Cursor 至官方原始连接状态！".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn atomic_replace_preserves_existing_unix_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workbench.js");
        std::fs::write(&path, b"original").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        atomic_write_file(&path, b"updated").unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }

    fn test_product(commit: &str, workbench: &[u8]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "commit": commit,
            "checksums": {"vs/workbench/workbench.desktop.main.js": compute_file_checksum(workbench)}
        })).unwrap()
    }

    #[test]
    fn backup_rejects_empty_versions_mismatched_actual_product_and_corruption() {
        let directory = tempfile::tempdir().unwrap();
        let wb = b"const url='https://api2.cursor.sh';";
        let product = test_product("A", wb);
        ensure_backup(directory.path(), &product, wb, false).unwrap();
        assert!(validated_backup(directory.path(), "A").is_ok());
        assert!(required_commit(&serde_json::json!({"commit":""})).is_err());
        assert!(required_commit(&serde_json::json!({"commit":"  "})).is_err());
        assert!(required_commit(&serde_json::json!({})).is_err());
        assert!(validated_backup(directory.path(), "B").is_err());
        // A forged matching metadata version must not hide a stale product.
        atomic_write_file(
            &directory.path().join("backup_meta.json"),
            br#"{"commit":"B"}"#,
        )
        .unwrap();
        assert!(validated_backup(directory.path(), "B").is_err());
        atomic_write_file(
            &directory.path().join("backup_meta.json"),
            br#"{"commit":"A"}"#,
        )
        .unwrap();
        assert!(validated_backup(directory.path(), "A").is_ok()); // legacy metadata compatibility
        atomic_write_file(
            &directory.path().join("workbench.desktop.main.js.bak"),
            b"corrupted",
        )
        .unwrap();
        assert!(validated_backup(directory.path(), "A").is_err());
        let no_checksum = serde_json::json!({"commit":"A","checksums":{}});
        assert!(validate_workbench_checksum(&no_checksum, wb).is_err());
    }

    #[test]
    fn missing_or_invalid_metadata_rebuilds_only_from_unpatched_installation() {
        let directory = tempfile::tempdir().unwrap();
        let wb = b"const url='https://api2.cursor.sh';";
        let old = test_product("A", b"old");
        ensure_backup(directory.path(), &old, b"old", false).unwrap();
        let product = test_product("B", wb);
        let metadata = directory.path().join("backup_meta.json");
        std::fs::remove_file(&metadata).unwrap();
        assert!(ensure_backup(directory.path(), &product, wb, true).is_err());
        assert_eq!(
            std::fs::read(directory.path().join("product.json.bak")).unwrap(),
            old
        );
        ensure_backup(directory.path(), &product, wb, false).unwrap();
        let (backup_wb, backup_product) = validated_backup(directory.path(), "B").unwrap();
        assert_eq!(backup_wb, wb);
        assert_eq!(backup_product, product);
        atomic_write_file(&metadata, b"{invalid").unwrap();
        ensure_backup(directory.path(), &product, wb, false).unwrap();
        assert!(validated_backup(directory.path(), "B").is_ok());
        std::fs::remove_file(&metadata).unwrap();
        std::fs::create_dir(&metadata).unwrap();
        assert!(ensure_backup(directory.path(), &product, wb, false).is_err());
    }

    #[test]
    fn legacy_backup_without_metadata_file_is_accepted_and_repaired() {
        let directory = tempfile::tempdir().unwrap();
        let wb = b"const url='https://api2.cursor.sh';";
        let product = test_product("A", wb);
        ensure_backup(directory.path(), &product, wb, false).unwrap();
        let meta_file = directory.path().join("backup_meta.json");
        assert!(meta_file.exists());
        // 模拟旧版本 AI Helper 创建的备份（仅有 .bak 文件，无 backup_meta.json）
        std::fs::remove_file(&meta_file).unwrap();
        assert!(!meta_file.exists());

        // validated_backup 应当平滑兼容并读取 product.json.bak 进行校验
        let (backup_wb, backup_product) = validated_backup(directory.path(), "A").unwrap();
        assert_eq!(backup_wb, wb);
        assert_eq!(backup_product, product);

        // 验证自动修复补齐了 backup_meta.json
        assert!(meta_file.exists());
        assert!(validated_backup(directory.path(), "A").is_ok());

        // 若 commit 不匹配，老备份依然必须被拒绝
        std::fs::remove_file(&meta_file).unwrap();
        assert!(validated_backup(directory.path(), "B").is_err());

        // 若 workbench 损坏，老备份依然必须被拒绝
        atomic_write_file(
            &directory.path().join("workbench.desktop.main.js.bak"),
            b"corrupted",
        )
        .unwrap();
        assert!(validated_backup(directory.path(), "A").is_err());
    }

    #[test]
    fn settings_parse_and_write_failures_preserve_only_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let backup = path.with_extension("ai-helper-bak");
        atomic_write_file(&path, b"{invalid").unwrap();
        atomic_write_file(&backup, br#"{"cursor.general.disableHttp2":false}"#).unwrap();
        assert!(configure_settings_at(&path, false).is_err());
        assert!(backup.is_file());
        assert_eq!(std::fs::read(&path).unwrap(), b"{invalid");
        atomic_write_file(&path, b"{}").unwrap();
        atomic_write_file(&backup, b"{invalid").unwrap();
        assert!(configure_settings_at(&path, false).is_err());
        assert!(configure_settings_at(&path, true).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{}");
        std::fs::remove_file(&backup).unwrap();
        std::fs::create_dir(&backup).unwrap();
        assert!(configure_settings_at(&path, true).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{}");
    }

    #[test]
    fn settings_restore_merges_owned_keys_and_supports_missing_current_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let backup = path.with_extension("ai-helper-bak");
        atomic_write_file(
            &path,
            br#"{
            // JSONC comments and trailing commas
            "cursor.general.disableHttp2": false,
            "http.proxySupport": "override",
            "original": 1,
        }"#,
        )
        .unwrap();
        configure_settings_at(&path, true).unwrap();
        let mut current = read_settings(&path).unwrap();
        current.insert("user-added".into(), serde_json::json!(123));
        atomic_write_file(&path, &serde_json::to_vec(&current).unwrap()).unwrap();
        configure_settings_at(&path, false).unwrap();
        let restored = read_settings(&path).unwrap();
        assert_eq!(restored["cursor.general.disableHttp2"], false);
        assert_eq!(restored["http.proxySupport"], "override");
        assert_eq!(restored["user-added"], 123);
        assert!(!backup.exists());
        // Missing provenance must never delete an existing user's setting.
        configure_settings_at(&path, false).unwrap();
        assert_eq!(read_settings(&path).unwrap(), restored);
        configure_settings_at(&path, true).unwrap();
        std::fs::remove_file(&path).unwrap();
        configure_settings_at(&path, false).unwrap();
        assert_eq!(
            read_settings(&path).unwrap()["http.proxySupport"],
            "override"
        );
        // Creating settings from scratch still leaves recoverable provenance.
        let new_path = directory.path().join("new/settings.json");
        configure_settings_at(&new_path, true).unwrap();
        assert!(new_path.with_extension("ai-helper-bak").exists());
        configure_settings_at(&new_path, false).unwrap();
        assert!(read_settings(&new_path).unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    #[allow(clippy::permissions_set_readonly_false)]
    fn settings_replace_failure_preserves_backup_and_current_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        atomic_write_file(&path, b"{}").unwrap();
        configure_settings_at(&path, true).unwrap();
        let before = std::fs::read(&path).unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        let result = configure_settings_at(&path, false);
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(false);
        std::fs::set_permissions(&path, permissions).unwrap();
        assert!(result.is_err());
        assert!(path.with_extension("ai-helper-bak").exists());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        configure_settings_at(&path, false).unwrap();
    }

    #[test]
    fn concurrent_atomic_writes_never_mix_contents_or_share_temporary_names() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("file");
        let mut tasks = Vec::new();
        for byte in 0u8..8 {
            let path = path.clone();
            tasks.push(std::thread::spawn(move || {
                atomic_write_file(&path, &vec![byte; 32_000])
            }));
        }
        // Windows may reject simultaneous replacements with access denied;
        // either success or a clean error must preserve a complete file.
        let successes = tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .filter(Result::is_ok)
            .count();
        assert!(successes > 0);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 32_000);
        assert!(bytes.iter().all(|byte| *byte == bytes[0]));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn test_compute_file_checksum_not_empty() {
        let dummy = b"console.log('hello cursor');";
        let hash = compute_file_checksum(dummy);
        assert!(!hash.is_empty());
        assert!(!hash.ends_with('=')); // stripped trailing base64 padding
    }

    #[test]
    fn test_regex_lite_or_simple_replace_single_port() {
        let text = "const backend = 'http://127.0.0.1:8969/api';";
        let replaced = regex_lite_or_simple_replace(text, 9999);
        assert_eq!(replaced, "const backend = 'http://127.0.0.1:9999/api';");
    }

    #[test]
    fn test_regex_lite_or_simple_replace_multiple_ports() {
        let text = r#"
            const api1 = "http://127.0.0.1:8969/v1";
            const api2 = "http://127.0.0.1:8888/v1";
            const api3 = "http://127.0.0.1:12345/v1";
        "#;
        let result = regex_lite_or_simple_replace(text, 9999);

        // 验证所有旧端口都被替换为新端口
        assert_eq!(result.matches("http://127.0.0.1:9999").count(), 3);
        assert!(!result.contains("8969"));
        assert!(!result.contains("8888"));
        assert!(!result.contains("12345"));
    }

    #[test]
    fn test_regex_lite_or_simple_replace_different_length_ports() {
        // 测试从 4 位端口号替换为 5 位端口号
        let text = "url: 'http://127.0.0.1:8969'";
        let result = regex_lite_or_simple_replace(text, 12345);
        assert_eq!(result, "url: 'http://127.0.0.1:12345'");

        // 测试从 5 位端口号替换为 4 位端口号
        let text2 = "url: 'http://127.0.0.1:12345'";
        let result2 = regex_lite_or_simple_replace(text2, 8888);
        assert_eq!(result2, "url: 'http://127.0.0.1:8888'");
    }

    #[test]
    fn test_regex_lite_or_simple_replace_no_false_positives() {
        // 确保不会误替换其他 IP 或端口格式
        let text = r#"
            external: "https://api.example.com:443/v1",
            loopback: "http://127.0.0.1:8969/v1",
            other_ip: "http://192.168.1.1:8080/v1"
        "#;
        let result = regex_lite_or_simple_replace(text, 9999);

        // 只有 127.0.0.1 的端口被替换
        assert!(result.contains("https://api.example.com:443"));
        assert!(result.contains("http://127.0.0.1:9999"));
        assert!(result.contains("http://192.168.1.1:8080"));
    }

    #[test]
    fn test_agent_region_regex_matches_various_formats() {
        let pattern = regex_lite::Regex::new(
            r"https://agent[a-zA-Z0-9_-]*-gcpp-[a-zA-Z0-9_-]+\.api[0-9]*\.cursor\.sh",
        )
        .unwrap();
        assert!(pattern.is_match("https://agent1-gcpp-us-west.api5.cursor.sh"));
        assert!(pattern.is_match("https://agent-gcpp-asia-east-1.api5.cursor.sh"));
        assert!(pattern.is_match("https://agent123-gcpp-europe-west-3.api2.cursor.sh"));

        let generic_pattern =
            regex_lite::Regex::new(r"https://agent[a-zA-Z0-9_.-]*\.api[0-9]*\.cursor\.sh").unwrap();
        assert!(generic_pattern.is_match("https://agent.api5.cursor.sh"));
        assert!(generic_pattern.is_match("https://agentn.api5.cursor.sh"));
        assert!(generic_pattern.is_match("https://agent-custom.api1.cursor.sh"));
    }

    #[test]
    fn test_atomic_write_file_basic() {
        let tmp_dir = std::env::temp_dir().join(format!("ai_helper_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp_dir);
        let test_file = tmp_dir.join("test_write.js");

        let content = b"console.log('atomic write test');";
        assert!(atomic_write_file(&test_file, content).is_ok());
        assert_eq!(std::fs::read(&test_file).unwrap(), content);

        let new_content = b"console.log('overwritten');";
        assert!(atomic_write_file(&test_file, new_content).is_ok());
        assert_eq!(std::fs::read(&test_file).unwrap(), new_content);

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_patch_js_content_includes_origin_and_glass_domains() {
        let content = r#"
            backend: "https://api2.cursor.sh",
            agent: "https://agentn.api5.cursor.sh",
            origin: "https://api.origin.cursor.com",
            origin_staging: "https://api.origin-staging.cursor.com",
            region: "https://agent-gcpp-uswest.api5.cursor.sh"
        "#;
        let patched = patch_js_content(content, 8969);
        assert!(!patched.contains("https://api2.cursor.sh"));
        assert!(!patched.contains("https://agentn.api5.cursor.sh"));
        assert!(!patched.contains("https://api.origin.cursor.com"));
        assert!(!patched.contains("https://api.origin-staging.cursor.com"));
        assert!(!patched.contains("https://agent-gcpp-uswest.api5.cursor.sh"));
        assert_eq!(patched.matches("http://127.0.0.1:8969").count(), 5);
    }

    #[test]
    fn test_patch_sqlite_database_tables() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("state.vscdb");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .unwrap();

        let app_user_key = "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";
        let initial_user = serde_json::json!({
            "cursorCreds": {
                "backendUrl": "https://api2.cursor.sh",
                "agentBackendUrlNonPrivacy": {"default": "https://agentn.global.api5.cursor.sh"}
            }
        });
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            rusqlite::params![app_user_key, initial_user.to_string()],
        )
        .unwrap();

        let val_str: String = conn
            .query_row(
                "SELECT value FROM ItemTable WHERE key = ?1",
                [app_user_key],
                |row| row.get(0),
            )
            .unwrap();
        let mut data: serde_json::Value = serde_json::from_str(&val_str).unwrap();
        let creds = data
            .get_mut("cursorCreds")
            .unwrap()
            .as_object_mut()
            .unwrap();
        creds.insert(
            "backendUrl".into(),
            serde_json::Value::String("http://127.0.0.1:8969".into()),
        );
        let new_val = serde_json::to_string(&data).unwrap();
        conn.execute(
            "UPDATE ItemTable SET value = ?1 WHERE key = ?2",
            rusqlite::params![new_val, app_user_key],
        )
        .unwrap();

        let updated_val: String = conn
            .query_row(
                "SELECT value FROM ItemTable WHERE key = ?1",
                [app_user_key],
                |row| row.get(0),
            )
            .unwrap();
        assert!(updated_val.contains("http://127.0.0.1:8969"));
    }
}

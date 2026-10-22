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

/// 定位 workbench.desktop.main.js 与 product.json
pub fn resolve_cursor_patch_targets(root: &Path) -> Option<(PathBuf, PathBuf)> {
    #[cfg(target_os = "macos")]
    let base = root.join("Contents").join("Resources").join("app");
    #[cfg(not(target_os = "macos"))]
    let base = root.join("resources").join("app");

    let workbench_js = base
        .join("out")
        .join("vs")
        .join("workbench")
        .join("workbench.desktop.main.js");
    let product_json = base.join("product.json");

    if workbench_js.exists() && product_json.exists() {
        Some((workbench_js, product_json))
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

    let Some((wb_path, prod_path)) = resolve_cursor_patch_targets(&root) else {
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

    match std::fs::read_to_string(&wb_path) {
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

            CursorPatchInfo {
                is_installed: true,
                cursor_app_path: Some(cursor_app_path),
                workbench_js_path: Some(wb_path.to_string_lossy().to_string()),
                product_json_path: Some(prod_path.to_string_lossy().to_string()),
                is_patched,
                current_bridge_target,
                backup_exists,
                message: if is_patched {
                    "Cursor 已成功挂接 AI-Helper 本地 Bridge 网关".to_string()
                } else {
                    "Cursor 处于原生官方连接模式，可一键修补接入".to_string()
                },
            }
        }
        Err(e) => CursorPatchInfo {
            is_installed: true,
            cursor_app_path: Some(cursor_app_path),
            workbench_js_path: Some(wb_path.to_string_lossy().to_string()),
            product_json_path: Some(prod_path.to_string_lossy().to_string()),
            is_patched: false,
            current_bridge_target: None,
            backup_exists,
            message: format!("读取 workbench.desktop.main.js 失败: {}", e),
        },
    }
}

pub fn apply_patch(custom_path: Option<&str>, bridge_port: u16) -> Result<String, String> {
    let root = find_cursor_root(custom_path).ok_or("未找到 Cursor 安装根目录")?;
    let (wb_path, prod_path) =
        resolve_cursor_patch_targets(&root).ok_or("未找到 Cursor 核心 workbench 文件")?;

    let backup_dir = get_backup_dir(&root);
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;

    let wb_bak = backup_dir.join("workbench.desktop.main.js.bak");
    let prod_bak = backup_dir.join("product.json.bak");

    // 仅在首次修补时备份原始文件，避免把已修补的文件当备份覆盖
    if !wb_bak.exists() {
        std::fs::copy(&wb_path, &wb_bak).map_err(|e| format!("备份 workbench.js 失败: {}", e))?;
    }
    if !prod_bak.exists() {
        std::fs::copy(&prod_path, &prod_bak)
            .map_err(|e| format!("备份 product.json 失败: {}", e))?;
    }

    let mut content = std::fs::read_to_string(&wb_path)
        .map_err(|e| format!("读取 workbench.desktop.main.js 失败: {}", e))?;

    let target_url = format!("http://127.0.0.1:{}", bridge_port);

    // 替换核心 API 服务地址 (涵盖基础 API、Composer、Agent 模式及各区域网关)
    const CURSOR_TARGET_DOMAINS: &[&str] = &[
        "https://api2.cursor.sh",
        "https://api3.cursor.sh",
        "https://api4.cursor.sh",
        "https://agent.api5.cursor.sh",
        "https://agentn.api5.cursor.sh",
        "https://agent-gcpp-uswest.api5.cursor.sh",
        "https://agentn-gcpp-uswest.api5.cursor.sh",
        "https://agentn-gcpp-eucentral.api5.cursor.sh",
        "https://agentn-gcpp-apsoutheast.api5.cursor.sh",
    ];

    for domain in CURSOR_TARGET_DOMAINS {
        content = content.replace(domain, &target_url);
    }

    // 针对可能已经修补过的端口进行热换
    let regex_pattern = regex_lite_or_simple_replace(&content, bridge_port);
    content = regex_pattern;

    let modified_bytes = content.as_bytes();
    std::fs::write(&wb_path, modified_bytes)
        .map_err(|e| format!("写入 workbench.desktop.main.js 失败: {}", e))?;

    // 计算校验和并写入 product.json，防止 VS Code / Cursor 报错提示文件损坏
    let new_checksum = compute_file_checksum(modified_bytes);
    if let Ok(prod_str) = std::fs::read_to_string(&prod_path) {
        if let Ok(mut prod_val) = serde_json::from_str::<serde_json::Value>(&prod_str) {
            if let Some(checksums) = prod_val
                .get_mut("checksums")
                .and_then(|v| v.as_object_mut())
            {
                checksums.insert(
                    "vs/workbench/workbench.desktop.main.js".to_string(),
                    serde_json::Value::String(new_checksum),
                );
                if let Ok(updated_prod) = serde_json::to_string_pretty(&prod_val) {
                    let _ = std::fs::write(&prod_path, updated_prod);
                }
            }
        }
    }

    Ok(format!("成功修补 Cursor！请求已重定向至 {}", target_url))
}

fn regex_lite_or_simple_replace(content: &str, target_port: u16) -> String {
    let mut result = content.to_string();
    let marker = "http://127.0.0.1:";
    let target = format!("http://127.0.0.1:{}", target_port);

    let mut start = 0;
    while let Some(idx) = result[start..].find(marker) {
        let abs_idx = start + idx;
        let rest = &result[abs_idx + marker.len()..];
        let end_offset = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        let current_port_str = &rest[..end_offset];
        if !current_port_str.is_empty() {
            let full_match = format!("http://127.0.0.1:{}", current_port_str);
            if full_match != target {
                result.replace_range(abs_idx..abs_idx + full_match.len(), &target);
            }
        }
        start = abs_idx + target.len();
        if start >= result.len() {
            break;
        }
    }
    result
}

pub fn restore_patch(custom_path: Option<&str>) -> Result<String, String> {
    let root = find_cursor_root(custom_path).ok_or("未找到 Cursor 安装根目录")?;
    let (wb_path, prod_path) =
        resolve_cursor_patch_targets(&root).ok_or("未找到 Cursor 核心 workbench 文件")?;

    let backup_dir = get_backup_dir(&root);
    let wb_bak = backup_dir.join("workbench.desktop.main.js.bak");
    let prod_bak = backup_dir.join("product.json.bak");

    if !wb_bak.exists() {
        return Err("未找到原始 workbench.desktop.main.js.bak 备份文件".to_string());
    }

    std::fs::copy(&wb_bak, &wb_path).map_err(|e| format!("还原 workbench.js 失败: {}", e))?;
    if prod_bak.exists() {
        let _ = std::fs::copy(&prod_bak, &prod_path);
    }

    Ok("成功还原 Cursor 至官方原始连接状态！".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_file_checksum_not_empty() {
        let dummy = b"console.log('hello cursor');";
        let hash = compute_file_checksum(dummy);
        assert!(!hash.is_empty());
        assert!(!hash.ends_with('=')); // stripped trailing base64 padding
    }

    #[test]
    fn test_regex_lite_or_simple_replace() {
        let text = "const backend = 'http://127.0.0.1:8969/api';";
        let replaced = regex_lite_or_simple_replace(text, 9999);
        assert_eq!(replaced, "const backend = 'http://127.0.0.1:9999/api';");
    }
}

use crate::error::AppError;
use std::path::Path;

pub fn atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Other(format!("无效路径: {}", path.display())))?;
    std::fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Other("无效文件名".into()))?;
    let tmp = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));
    std::fs::write(&tmp, contents.as_ref())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(windows)]
    {
        restrict_to_current_user(&tmp);
    }
    if path.exists() {
        let bak = parent.join(format!(".{}.{}.bak", file_name, std::process::id()));
        // 先重命名原文件到临时备份，避免在 rename 前直接删除导致原件丢失
        std::fs::rename(path, &bak)?;
        if let Err(e) = std::fs::rename(&tmp, path) {
            // 重命名失败时立即从备份恢复原文件
            let _ = std::fs::rename(&bak, path);
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        let _ = std::fs::remove_file(&bak);
    } else {
        std::fs::rename(&tmp, path)?;
    }
    Ok(())
}

pub fn backup_then_atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    if path.exists() {
        let bak = match path.extension().and_then(|e| e.to_str()) {
            Some(ext) => path.with_extension(format!("{ext}.bak")),
            None => path.with_extension("bak"),
        };
        std::fs::copy(path, bak)?;
    }
    atomic_write(path, contents)
}

pub fn safe_write_file(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    atomic_write(path, contents)
}

/// Windows: 移除继承权限并仅授权当前用户读写，等效于 Unix 0600。
/// 使用 icacls 不引入额外依赖；失败时仅警告，不阻断写入。
#[cfg(windows)]
fn restrict_to_current_user(path: &Path) {
    let path_str = path.to_string_lossy();
    let username = std::env::var("USERNAME").unwrap_or_default();
    if username.is_empty() {
        log::warn!("无法获取 USERNAME 环境变量，跳过 ACL 设置");
        return;
    }
    // 先移除继承权限
    let disable_inherit = std::process::Command::new("icacls")
        .args([path_str.as_ref(), "/inheritance:r"])
        .output();
    if let Err(e) = disable_inherit {
        log::warn!("icacls 移除继承权限失败 ({}): {}", path_str, e);
        return;
    }
    // 仅授权当前用户完全控制
    let grant = std::process::Command::new("icacls")
        .args([path_str.as_ref(), "/grant:r", &format!("{}:(F)", username)])
        .output();
    if let Err(e) = grant {
        log::warn!("icacls 授权当前用户失败 ({}): {}", path_str, e);
    }
}

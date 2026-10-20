use crate::error::AppError;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

fn lock_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        ".{}.lock",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
    ))
}

fn with_file_lock<T>(path: &Path, f: impl FnOnce() -> Result<T, AppError>) -> Result<T, AppError> {
    let lock = lock_path(path);
    let parent = lock
        .parent()
        .ok_or_else(|| AppError::Other("无效文件路径".into()))?;
    fs::create_dir_all(parent)?;
    let handle = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|e| AppError::Other(format!("配置文件正在被其他写入者占用: {e}")))?;
    let result = f();
    drop(handle);
    let _ = fs::remove_file(lock);
    result
}

fn prepare_parent(path: &Path) -> Result<&Path, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Other(format!("无效路径: {}", path.display())))?;
    fs::create_dir_all(parent)?;
    Ok(parent)
}

fn restrict_existing_path(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(windows)]
    {
        let username = std::env::var("USERNAME")
            .map_err(|_| AppError::Other("无法获取当前 Windows 用户".into()))?;
        let output = std::process::Command::new("icacls")
            .args([
                path.to_string_lossy().as_ref(),
                "/inheritance:r",
                "/grant:r",
                &format!("{}:(F)", username),
            ])
            .output()?;
        if !output.status.success() {
            return Err(AppError::Other(format!(
                "icacls 限权失败: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
    }
    Ok(())
}

fn write_temp(path: &Path, contents: &[u8]) -> Result<PathBuf, AppError> {
    let parent = prepare_parent(path)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Other("无效文件名".into()))?;
    let tmp = parent.join(format!(
        ".{}.{}.{}.tmp",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    if let Err(e) = restrict_existing_path(&tmp) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(tmp)
}

#[cfg(unix)]
fn replace_target(tmp: &Path, target: &Path) -> Result<(), AppError> {
    fs::rename(tmp, target).map_err(AppError::from)
}

#[cfg(windows)]
fn replace_target(tmp: &Path, target: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    let src = wide(tmp);
    let dst = wide(target);
    unsafe {
        let ok = if target.exists() {
            ReplaceFileW(
                dst.as_ptr(),
                src.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } else {
            MoveFileExW(src.as_ptr(), dst.as_ptr(), 0x00000001 | 0x00000008)
        };
        if ok == 0 {
            return Err(AppError::Other(format!(
                "原子替换配置文件失败: {}",
                std::io::Error::last_os_error()
            )));
        }
    }
    Ok(())
}

#[cfg(windows)]
unsafe extern "system" {
    fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    fn ReplaceFileW(
        replaced: *const u16,
        replacement: *const u16,
        backup: *const u16,
        flags: u32,
        exclude: *mut std::ffi::c_void,
        reserved: *mut std::ffi::c_void,
    ) -> i32;
}

pub fn recover_missing_file(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        return Ok(());
    }
    let backup = match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => path.with_extension(format!("{ext}.bak")),
        None => path.with_extension("bak"),
    };
    if backup.exists() {
        let bytes = fs::read(&backup)?;
        let tmp = write_temp(path, &bytes)?;
        replace_target(&tmp, path)?;
    }
    Ok(())
}

pub fn atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    with_file_lock(path, || {
        recover_missing_file(path)?;
        let tmp = write_temp(path, contents.as_ref())?;
        if let Err(e) = replace_target(&tmp, path) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Ok(())
    })
}

pub fn backup_then_atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    with_file_lock(path, || {
        prepare_parent(path)?;
        recover_missing_file(path)?;
        if path.exists() {
            let backup = match path.extension().and_then(|e| e.to_str()) {
                Some(ext) => path.with_extension(format!("{ext}.bak")),
                None => path.with_extension("bak"),
            };
            fs::copy(path, &backup)?;
            restrict_existing_path(&backup)?;
        }
        let tmp = write_temp(path, contents.as_ref())?;
        if let Err(e) = replace_target(&tmp, path) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Ok(())
    })
}

pub fn safe_write_file(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    atomic_write(path, contents)
}

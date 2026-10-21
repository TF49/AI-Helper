#[cfg(target_os = "windows")]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

#[cfg(target_os = "windows")]
const REG_RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const REG_APP_NAME: &str = "AIHelper";

#[cfg(target_os = "windows")]
pub fn get_auto_start_status() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = match hkcu.open_subkey(REG_RUN_SUBKEY) {
        Ok(k) => k,
        Err(e) => {
            log::warn!("未能打开自启动注册表项: {}", e);
            return Ok(false);
        }
    };

    match run_key.get_value::<String, _>(REG_APP_NAME) {
        Ok(cmd) => {
            // 确保不为空
            Ok(!cmd.trim().is_empty())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => {
            log::warn!("读取自启动注册表项异常: {}", e);
            Ok(false)
        }
    }
}

#[cfg(target_os = "windows")]
pub fn set_auto_start_status(enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(REG_RUN_SUBKEY)
        .map_err(|e| format!("打开或创建自启动注册表项失败: {}", e))?;

    if enabled {
        let current_exe =
            std::env::current_exe().map_err(|e| format!("获取当前可执行文件路径失败: {}", e))?;
        let exe_str = current_exe.to_string_lossy().to_string();
        let cmd = format!("\"{}\"", exe_str);
        run_key
            .set_value(REG_APP_NAME, &cmd)
            .map_err(|e| format!("写入自启动注册表失败: {}", e))?;
        log::info!("已成功启用开机自启动: {}", cmd);
    } else {
        match run_key.delete_value(REG_APP_NAME) {
            Ok(()) => {
                log::info!("已成功取消开机自启动");
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("删除自启动注册表项失败: {}", e)),
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn get_auto_start_status() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_os = "windows"))]
pub fn set_auto_start_status(_enabled: bool) -> Result<(), String> {
    Ok(())
}

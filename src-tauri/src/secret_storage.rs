//! 平台级敏感凭据加密与存储保护（SEC-09）。
//!
//! 在 Windows 上使用 Win32 DPAPI (`CryptProtectData` / `CryptUnprotectData`)，
//! 将凭据加密范围绑定至当前登录操作系统用户；
//! 在 Unix / macOS 上使用具备私有文件权限 (`0600`) 的用户主密钥与基于 HMAC-SHA256 的 AEAD 流加密。
//! 支持透明识别和自动迁移历史版本存储的明文凭据。

use crate::error::AppError;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

pub const ENCRYPTED_PREFIX: &str = "enc:v1:";

/// 检查给定字符串是否已处于加密封包格式
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENCRYPTED_PREFIX)
}

/// 对敏感凭据进行平台级加密，输出 `enc:v1:<base64>` 封包
pub fn protect_secret(plaintext: &str) -> Result<String, AppError> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let encrypted_bytes = platform::protect(plaintext.as_bytes())?;
    let b64 = BASE64.encode(encrypted_bytes);
    Ok(format!("{ENCRYPTED_PREFIX}{b64}"))
}

/// 对敏感凭据进行解密。
/// 返回 `(解密后明文, 是否来自旧版未加密的明文)`。
/// 若输入为旧版未加密明文，`was_legacy_plaintext` 为 `true`，调用方应触发迁移回写。
pub fn unprotect_secret(value: &str) -> Result<(String, bool), AppError> {
    if value.is_empty() {
        return Ok((String::new(), false));
    }
    if !is_encrypted(value) {
        // 旧版未加密的明文，标记为需要迁移
        return Ok((value.to_string(), true));
    }
    let b64 = &value[ENCRYPTED_PREFIX.len()..];
    let ciphertext = BASE64
        .decode(b64)
        .map_err(|e| AppError::Other(format!("Base64 解码凭据失败: {e}")))?;
    let decrypted_bytes = platform::unprotect(&ciphertext)?;
    let plaintext = String::from_utf8(decrypted_bytes)
        .map_err(|e| AppError::Other(format!("解密后的凭据非有效 UTF-8: {e}")))?;
    Ok((plaintext, false))
}

#[cfg(target_os = "windows")]
mod platform {
    use crate::error::AppError;
    use std::ffi::c_void;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            data_in: *const DataBlob,
            description: *const u16,
            optional_entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt_struct: *mut c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;

        fn CryptUnprotectData(
            data_in: *const DataBlob,
            description: *mut *mut u16,
            optional_entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt_struct: *mut c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    pub(super) fn protect(plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
        let in_blob = DataBlob {
            cb_data: plaintext.len() as u32,
            pb_data: plaintext.as_ptr() as *mut u8,
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };

        let success = unsafe {
            CryptProtectData(
                &in_blob,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };

        if success == 0 {
            return Err(AppError::Other(format!(
                "Windows DPAPI 加密凭据失败: {}",
                std::io::Error::last_os_error()
            )));
        }

        let encrypted = unsafe {
            std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize).to_vec()
        };
        unsafe {
            LocalFree(out_blob.pb_data as *mut c_void);
        }
        Ok(encrypted)
    }

    pub(super) fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, AppError> {
        let in_blob = DataBlob {
            cb_data: ciphertext.len() as u32,
            pb_data: ciphertext.as_ptr() as *mut u8,
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };

        let success = unsafe {
            CryptUnprotectData(
                &in_blob,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };

        if success == 0 {
            return Err(AppError::Other(format!(
                "Windows DPAPI 解密凭据失败 (可能由其他用户或损坏会话导致): {}",
                std::io::Error::last_os_error()
            )));
        }

        let decrypted = unsafe {
            std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize).to_vec()
        };
        unsafe {
            LocalFree(out_blob.pb_data as *mut c_void);
        }
        Ok(decrypted)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use crate::error::AppError;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    fn key_file_path() -> Result<PathBuf, AppError> {
        let home = dirs::home_dir().ok_or_else(|| AppError::Other("无法获取用户主目录".into()))?;
        Ok(home.join(".ai-helper").join(".session_master_key"))
    }

    fn get_or_create_master_key() -> Result<[u8; 32], AppError> {
        let path = key_file_path()?;
        if path.exists() {
            let bytes = fs::read(&path)?;
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
        let mut key = [0u8; 32];
        getrandom::getrandom(&mut key)
            .map_err(|e| AppError::Other(format!("生成主密钥失败: {e}")))?;
        crate::safe_fs::safe_write_file(&path, &key)?;
        Ok(key)
    }

    fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
        let mut ipad = [0x36u8; 64];
        let mut opad = [0x5cu8; 64];
        let k = if key.len() > 64 {
            let mut hasher = Sha256::new();
            hasher.update(key);
            let mut buf = [0u8; 64];
            buf[..32].copy_from_slice(&hasher.finalize());
            buf
        } else {
            let mut buf = [0u8; 64];
            buf[..key.len()].copy_from_slice(key);
            buf
        };
        for i in 0..64 {
            ipad[i] ^= k[i];
            opad[i] ^= k[i];
        }
        let mut inner = Sha256::new();
        inner.update(&ipad);
        inner.update(data);
        let inner_hash = inner.finalize();

        let mut outer = Sha256::new();
        outer.update(&opad);
        outer.update(&inner_hash);
        let mut tag = [0u8; 32];
        tag.copy_from_slice(&outer.finalize());
        tag
    }

    pub(super) fn protect(plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
        let key = get_or_create_master_key()?;
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce)
            .map_err(|e| AppError::Other(format!("生成 nonce 失败: {e}")))?;

        // CTR 模式流加密
        let mut ciphertext = Vec::with_capacity(plaintext.len());
        for (i, chunk) in plaintext.chunks(32).enumerate() {
            let mut counter_buf = [0u8; 20];
            counter_buf[..16].copy_from_slice(&nonce);
            counter_buf[16..].copy_from_slice(&(i as u32).to_be_bytes());
            let stream_block = hmac_sha256(&key, &counter_buf);
            for (p, s) in chunk.iter().zip(stream_block.iter()) {
                ciphertext.push(p ^ s);
            }
        }

        // Encrypt-then-MAC 认证标签
        let mut mac_input = Vec::with_capacity(16 + ciphertext.len());
        mac_input.extend_from_slice(&nonce);
        mac_input.extend_from_slice(&ciphertext);
        let tag = hmac_sha256(&key, &mac_input);

        // 组装格式: nonce (16) || tag (32) || ciphertext
        let mut result = Vec::with_capacity(16 + 32 + ciphertext.len());
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&tag);
        result.extend_from_slice(&ciphertext);
        Ok(result)
    }

    pub(super) fn unprotect(data: &[u8]) -> Result<Vec<u8>, AppError> {
        if data.len() < 16 + 32 {
            return Err(AppError::Other("密文格式无效，长度不足".into()));
        }
        let key = get_or_create_master_key()?;
        let nonce = &data[..16];
        let tag = &data[16..48];
        let ciphertext = &data[48..];

        let mut mac_input = Vec::with_capacity(16 + ciphertext.len());
        mac_input.extend_from_slice(nonce);
        mac_input.extend_from_slice(ciphertext);
        let expected_tag = hmac_sha256(&key, &mac_input);

        // 常量时间比较
        let mut diff = 0u8;
        for (a, b) in tag.iter().zip(expected_tag.iter()) {
            diff |= a ^ b;
        }
        if diff != 0 {
            return Err(AppError::Other("凭据认证标签不匹配，数据可能被篡改".into()));
        }

        let mut plaintext = Vec::with_capacity(ciphertext.len());
        for (i, chunk) in ciphertext.chunks(32).enumerate() {
            let mut counter_buf = [0u8; 20];
            counter_buf[..16].copy_from_slice(nonce);
            counter_buf[16..].copy_from_slice(&(i as u32).to_be_bytes());
            let stream_block = hmac_sha256(&key, &counter_buf);
            for (c, s) in chunk.iter().zip(stream_block.iter()) {
                plaintext.push(c ^ s);
            }
        }
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protect_and_unprotect_roundtrip() {
        let secret = "new_api_refresh=fake_secret_token_value; Path=/api/user/auth; HttpOnly";
        let encrypted = protect_secret(secret).expect("encrypt must succeed");
        assert!(is_encrypted(&encrypted));
        assert_ne!(encrypted, secret);
        assert!(!encrypted.contains("fake_secret_token_value"));

        let (decrypted, was_legacy) = unprotect_secret(&encrypted).expect("decrypt must succeed");
        assert_eq!(decrypted, secret);
        assert!(!was_legacy);
    }

    #[test]
    fn test_legacy_plaintext_migration_detection() {
        let legacy_plaintext = "new_api_refresh=plain_value_from_old_version";
        let (decrypted, was_legacy) =
            unprotect_secret(legacy_plaintext).expect("legacy plaintext should pass");
        assert_eq!(decrypted, legacy_plaintext);
        assert!(was_legacy);
    }

    #[test]
    fn test_empty_string_handling() {
        assert_eq!(protect_secret("").unwrap(), "");
        let (decrypted, was_legacy) = unprotect_secret("").unwrap();
        assert_eq!(decrypted, "");
        assert!(!was_legacy);
    }

    #[test]
    fn test_corrupted_ciphertext_rejected() {
        let secret = "sensitive_cookie_session";
        let mut encrypted = protect_secret(secret).unwrap();
        // Tamper with the base64 content
        encrypted.push('A');
        assert!(unprotect_secret(&encrypted).is_err());
    }
}

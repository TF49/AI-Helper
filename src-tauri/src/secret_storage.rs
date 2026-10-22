//! Use OS user credential protection, with no application-managed disk key.
//! Windows uses DPAPI; macOS/Linux store only references to Keychain/Secret Service.

use crate::error::AppError;
use serde::{Deserialize, Serialize};

pub const ENCRYPTED_PREFIX: &str = "enc:v2:";
const LEGACY_PREFIX: &str = "enc:v1:";
const MAX_SECRET_BYTES: usize = 1024 * 1024;
const MAX_PAYLOAD_BYTES: usize = 2 * MAX_SECRET_BYTES;
const MAX_REFERENCE_BYTES: usize = 4 * MAX_SECRET_BYTES;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CredentialPurpose {
    SessionId,
    RefreshCookie,
    Generic,
}

impl CredentialPurpose {
    fn label(self) -> &'static str {
        match self {
            Self::SessionId => "session-id",
            Self::RefreshCookie => "refresh-cookie",
            Self::Generic => "generic",
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialEnvelope {
    version: u32,
    purpose: String,
    reference: String,
    secret: String,
}

/// Recognizes protected formats; callers must still authenticate the contents.
#[allow(dead_code)]
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENCRYPTED_PREFIX) || value.starts_with(LEGACY_PREFIX)
}

#[allow(dead_code)]
pub fn protect_secret(plaintext: &str) -> Result<String, AppError> {
    protect_secret_for(CredentialPurpose::Generic, plaintext)
}

#[allow(dead_code)]
pub fn unprotect_secret(value: &str) -> Result<(String, bool), AppError> {
    unprotect_secret_for(CredentialPurpose::Generic, value)
}

pub fn protect_secret_for(purpose: CredentialPurpose, plaintext: &str) -> Result<String, AppError> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    if plaintext.len() > MAX_SECRET_BYTES {
        return Err(invalid_credential());
    }
    let reference = new_reference()?;
    let payload = serde_json::to_vec(&CredentialEnvelope {
        version: 2,
        purpose: purpose.label().to_owned(),
        reference: reference.clone(),
        secret: plaintext.to_owned(),
    })?;
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(invalid_credential());
    }
    let token = platform::protect(purpose, &reference, &payload)?;
    Ok(format!(
        "{ENCRYPTED_PREFIX}{}:{}:{token}",
        platform::kind(),
        purpose.label()
    ))
}

/// Returns plaintext and whether it needs a committed upgrade before activation.
pub fn unprotect_secret_for(
    purpose: CredentialPurpose,
    value: &str,
) -> Result<(String, bool), AppError> {
    if value.is_empty() {
        return Ok((String::new(), false));
    }
    if let Some(legacy) = value.strip_prefix(LEGACY_PREFIX) {
        if value.len() > MAX_REFERENCE_BYTES {
            return Err(invalid_credential());
        }
        let secret = platform::unprotect_legacy(legacy)?;
        if secret.len() > MAX_SECRET_BYTES {
            return Err(invalid_credential());
        }
        return Ok((secret, true));
    }
    if !value.starts_with("enc:") {
        // Historical plaintext is never activated before its protected replacement
        // has been saved and verified by the session store.
        if value.len() > MAX_SECRET_BYTES {
            return Err(invalid_credential());
        }
        return Ok((value.to_owned(), true));
    }
    let token = parse_reference(purpose, value)?;
    let payload = platform::unprotect(purpose, token)?;
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(invalid_credential());
    }
    let envelope: CredentialEnvelope =
        serde_json::from_slice(&payload).map_err(|_| invalid_credential())?;
    if envelope.version != 2
        || envelope.purpose != purpose.label()
        || !valid_reference_id(&envelope.reference)
        || (platform::kind() == "keyring" && envelope.reference != token)
        || envelope.secret.len() > MAX_SECRET_BYTES
    {
        return Err(invalid_credential());
    }
    Ok((envelope.secret, false))
}

/// Cleanup is safe after a successful session-file replacement, or when a newly
/// created reference was never committed. Historical formats are left alone.
pub fn delete_secret_for(purpose: CredentialPurpose, value: &str) -> Result<(), AppError> {
    if value.is_empty() || !value.starts_with(ENCRYPTED_PREFIX) {
        return Ok(());
    }
    platform::delete(purpose, parse_reference(purpose, value)?)
}

fn parse_reference(purpose: CredentialPurpose, value: &str) -> Result<&str, AppError> {
    if value.len() > MAX_REFERENCE_BYTES {
        return Err(invalid_credential());
    }
    let encoded = value
        .strip_prefix(ENCRYPTED_PREFIX)
        .ok_or_else(invalid_credential)?;
    let mut parts = encoded.splitn(3, ':');
    let kind = parts.next().ok_or_else(invalid_credential)?;
    let actual_purpose = parts.next().ok_or_else(invalid_credential)?;
    let token = parts.next().ok_or_else(invalid_credential)?;
    if kind != platform::kind()
        || actual_purpose != purpose.label()
        || token.is_empty()
        || (kind == "keyring" && !valid_reference_id(token))
    {
        return Err(invalid_credential());
    }
    Ok(token)
}

fn valid_reference_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn new_reference() -> Result<String, AppError> {
    let mut random = [0_u8; 32];
    getrandom::getrandom(&mut random)
        .map_err(|_| AppError::Other("无法生成安全凭据引用，请重试".into()))?;
    use std::fmt::Write;
    let mut id = String::with_capacity(64);
    for byte in random {
        write!(&mut id, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(id)
}

fn invalid_credential() -> AppError {
    AppError::Other("凭据格式、用途或完整性校验失败，请重新登录".into())
}

fn unavailable() -> AppError {
    #[cfg(target_os = "macos")]
    let hint =
        "系统钥匙串不可用或拒绝访问。请在系统设置-隐私与安全性中允许访问，或解锁钥匙串后重试";
    #[cfg(target_os = "linux")]
    let hint = "Secret Service 不可用或拒绝访问。请确认 gnome-keyring 或 KWallet 正在运行，或检查系统权限设置";
    #[cfg(target_os = "windows")]
    let hint = "系统凭据保护服务不可用或拒绝访问；请确认当前 Windows 用户配置文件可用并在同一用户上下文运行";
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let hint = "系统凭据保护服务不可用或拒绝访问；请重试";
    AppError::Other(hint.into())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[allow(dead_code)]
mod native_keyring {
    use super::*;
    use std::sync::Mutex;

    #[cfg(test)]
    thread_local! {
        static TEST_NAMESPACE: std::cell::RefCell<Option<String>> = const {
            std::cell::RefCell::new(None)
        };
    }

    #[cfg(test)]
    pub(super) struct NativeTestScope {
        previous: Option<String>,
        _thread_bound: std::marker::PhantomData<std::rc::Rc<()>>,
    }

    #[cfg(test)]
    impl NativeTestScope {
        pub(super) fn enter() -> Self {
            assert_eq!(
                std::env::var("AI_HELPER_NATIVE_CREDENTIAL_TESTS").as_deref(),
                Ok("1"),
                "native credential tests require an explicitly isolated OS service"
            );
            let namespace = new_reference().expect("generate a unique native test namespace");
            let previous = TEST_NAMESPACE.with(|current| current.replace(Some(namespace)));
            Self {
                previous,
                _thread_bound: std::marker::PhantomData,
            }
        }
    }

    #[cfg(test)]
    impl Drop for NativeTestScope {
        fn drop(&mut self) {
            TEST_NAMESPACE.with(|current| current.replace(self.previous.take()));
        }
    }

    #[cfg(test)]
    pub(super) fn test_backend_active() -> bool {
        TEST_NAMESPACE.with(|current| current.borrow().is_some())
    }

    // Backends have different concurrency semantics. Serialize complete accesses
    // without ever switching keyring's global backend or falling back to a file.
    static KEYRING_ACCESS: Mutex<()> = Mutex::new(());

    #[allow(dead_code)]
    pub(super) fn kind() -> &'static str {
        "keyring"
    }

    pub(super) fn service(purpose: CredentialPurpose) -> Result<String, AppError> {
        #[cfg(not(test))]
        {
            Ok(format!("com.ai-helper.credentials.v2.{}", purpose.label()))
        }
        #[cfg(test)]
        {
            // Native tests cannot address the production namespace, even when
            // someone accidentally calls this module without an explicit scope.
            TEST_NAMESPACE.with(|current| {
                current
                    .borrow()
                    .as_ref()
                    .map(|namespace| {
                        format!(
                            "com.ai-helper.tests.credentials.v2.{namespace}.{}",
                            purpose.label()
                        )
                    })
                    .ok_or_else(unavailable)
            })
        }
    }

    fn entry(purpose: CredentialPurpose, reference: &str) -> Result<keyring::Entry, AppError> {
        let service = service(purpose)?;
        // Select the OS store explicitly. Missing native features must produce a
        // compile error rather than keyring's default mock/in-memory fallback.
        #[cfg(target_os = "macos")]
        let credential =
            keyring::macos::MacCredential::new_with_target(Some("User"), &service, reference)
                .map_err(|_| unavailable())?;
        #[cfg(target_os = "linux")]
        let credential =
            keyring::secret_service::SsCredential::new_with_target(None, &service, reference)
                .map_err(|_| unavailable())?;
        Ok(keyring::Entry::new_with_credential(Box::new(credential)))
    }

    pub(super) fn protect(
        purpose: CredentialPurpose,
        reference: &str,
        payload: &[u8],
    ) -> Result<String, AppError> {
        let _guard = KEYRING_ACCESS.lock().map_err(|_| unavailable())?;
        entry(purpose, reference)?
            .set_secret(payload)
            .map_err(|_| unavailable())?;
        Ok(reference.to_owned())
    }

    pub(super) fn unprotect(
        purpose: CredentialPurpose,
        reference: &str,
    ) -> Result<Vec<u8>, AppError> {
        let _guard = KEYRING_ACCESS.lock().map_err(|_| unavailable())?;
        entry(purpose, reference)?
            .get_secret()
            .map_err(|_| unavailable())
    }

    pub(super) fn delete(purpose: CredentialPurpose, reference: &str) -> Result<(), AppError> {
        let _guard = KEYRING_ACCESS.lock().map_err(|_| unavailable())?;
        match entry(purpose, reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(unavailable()),
        }
    }

    #[cfg(test)]
    pub(super) fn test_entry_is_missing(
        purpose: CredentialPurpose,
        reference: &str,
    ) -> Result<bool, AppError> {
        let _guard = KEYRING_ACCESS.lock().map_err(|_| unavailable())?;
        match entry(purpose, reference)?.get_secret() {
            Err(keyring::Error::NoEntry) => Ok(true),
            Ok(_) => Ok(false),
            Err(_) => Err(unavailable()),
        }
    }

    #[allow(dead_code)]
    pub(super) fn unprotect_legacy(_legacy: &str) -> Result<String, AppError> {
        // Never open/recreate the historical HOME/.ai-helper master-key file.
        Err(AppError::Other("旧版凭据无法安全迁移，请重新登录".into()))
    }
}

#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
use native_keyring as platform;

#[cfg(all(target_os = "windows", not(test)))]
use native_windows as platform;

#[cfg(target_os = "windows")]
mod native_windows {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
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

    struct LocalBlob(DataBlob);

    impl Drop for LocalBlob {
        fn drop(&mut self) {
            if !self.0.pb_data.is_null() {
                unsafe {
                    LocalFree(self.0.pb_data.cast());
                }
            }
        }
    }

    pub(super) fn kind() -> &'static str {
        "dpapi"
    }

    fn transform(data: &[u8], entropy: Option<&[u8]>, protect: bool) -> Result<Vec<u8>, AppError> {
        let input = DataBlob {
            cb_data: u32::try_from(data.len()).map_err(|_| invalid_credential())?,
            pb_data: data.as_ptr() as *mut u8,
        };
        let entropy_blob = entropy.map(|bytes| DataBlob {
            cb_data: bytes.len() as u32,
            pb_data: bytes.as_ptr() as *mut u8,
        });
        let entropy_ptr = entropy_blob
            .as_ref()
            .map_or(std::ptr::null(), |blob| blob as *const DataBlob);
        let mut output = LocalBlob(DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        });
        // CRYPTPROTECT_UI_FORBIDDEN; user scope is the default. Machine scope is
        // never requested. Entropy also binds ciphertext to the credential purpose.
        let success = unsafe {
            if protect {
                CryptProtectData(
                    &input,
                    std::ptr::null(),
                    entropy_ptr,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0x1,
                    &mut output.0,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    std::ptr::null_mut(),
                    entropy_ptr,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0x1,
                    &mut output.0,
                )
            }
        };
        if success == 0 || output.0.pb_data.is_null() {
            return Err(unavailable());
        }
        Ok(unsafe {
            std::slice::from_raw_parts(output.0.pb_data, output.0.cb_data as usize).to_vec()
        })
    }

    fn entropy(purpose: CredentialPurpose) -> String {
        format!("com.ai-helper.credentials.v2.{}", purpose.label())
    }

    pub(super) fn protect(
        purpose: CredentialPurpose,
        _reference: &str,
        payload: &[u8],
    ) -> Result<String, AppError> {
        transform(payload, Some(entropy(purpose).as_bytes()), true)
            .map(|bytes| BASE64.encode(bytes))
    }

    pub(super) fn unprotect(
        purpose: CredentialPurpose,
        ciphertext: &str,
    ) -> Result<Vec<u8>, AppError> {
        let bytes = BASE64
            .decode(ciphertext)
            .map_err(|_| invalid_credential())?;
        transform(&bytes, Some(entropy(purpose).as_bytes()), false)
    }

    pub(super) fn delete(_purpose: CredentialPurpose, _reference: &str) -> Result<(), AppError> {
        Ok(())
    }

    pub(super) fn unprotect_legacy(ciphertext: &str) -> Result<String, AppError> {
        let bytes = BASE64
            .decode(ciphertext)
            .map_err(|_| invalid_credential())?;
        // Only Windows v1 used DPAPI without optional entropy. Never interpret
        // another platform's old ciphertext as the plaintext credential.
        let plaintext = transform(&bytes, None, false)?;
        String::from_utf8(plaintext).map_err(|_| invalid_credential())
    }

    #[cfg(test)]
    pub(super) fn protect_legacy_for_test(plaintext: &[u8]) -> Result<String, AppError> {
        transform(plaintext, None, true).map(|bytes| BASE64.encode(bytes))
    }
}

#[cfg(all(
    not(test),
    not(any(target_os = "windows", target_os = "macos", target_os = "linux"))
))]
mod platform {
    use super::*;
    pub(super) fn kind() -> &'static str {
        "unsupported"
    }
    pub(super) fn protect(_: CredentialPurpose, _: &str, _: &[u8]) -> Result<String, AppError> {
        Err(unavailable())
    }
    pub(super) fn unprotect(_: CredentialPurpose, _: &str) -> Result<Vec<u8>, AppError> {
        Err(unavailable())
    }
    pub(super) fn delete(_: CredentialPurpose, _: &str) -> Result<(), AppError> {
        Err(unavailable())
    }
    pub(super) fn unprotect_legacy(_: &str) -> Result<String, AppError> {
        Err(unavailable())
    }
}

// Default unit tests never call a native provider. Threads use separate memory
// stores, with explicit TestScope sharing across a test's chosen worker threads.
// Ignored native tests opt in to synthetic DPAPI calls or a unique test-only
// Keychain/Secret Service namespace. Public APIs use memory unless scoped in.
#[cfg(test)]
pub(crate) mod test_support {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// Test-only access to a random native namespace, never the production namespace.
    /// The inner scope is thread-bound and still requires explicit opt-in.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(crate) struct NativeTestScope {
        _scope: super::native_keyring::NativeTestScope,
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    impl NativeTestScope {
        pub(crate) fn enter() -> Self {
            Self {
                _scope: super::native_keyring::NativeTestScope::enter(),
            }
        }

        /// Distinguish a confirmed OS NoEntry from an unavailable/locked store.
        pub(crate) fn entry_is_missing(
            &self,
            purpose: super::CredentialPurpose,
            protected: &str,
        ) -> Result<bool, crate::error::AppError> {
            let reference = super::parse_reference(purpose, protected)?;
            super::native_keyring::test_entry_is_missing(purpose, reference)
        }
    }

    #[derive(Default)]
    pub(super) struct MemoryBackend {
        pub(super) unavailable: bool,
        pub(super) successful_reads_remaining: Option<usize>,
        pub(super) values: HashMap<(String, String), Vec<u8>>,
    }

    #[derive(Clone, Default)]
    pub(crate) struct TestScope {
        pub(super) backend: Arc<Mutex<MemoryBackend>>,
    }

    thread_local! {
        pub(super) static CURRENT: RefCell<TestScope> = RefCell::new(TestScope::new());
    }

    pub(crate) struct TestScopeGuard {
        previous: Option<TestScope>,
        _thread_bound: std::marker::PhantomData<std::rc::Rc<()>>,
    }

    impl TestScope {
        pub(crate) fn new() -> Self {
            Self::default()
        }
        pub(crate) fn unavailable() -> Self {
            let scope = Self::new();
            scope.set_available(false);
            scope
        }
        pub(crate) fn set_available(&self, available: bool) {
            self.backend.lock().unwrap().unavailable = !available;
        }
        pub(crate) fn fail_reads_after(&self, successful_reads: usize) {
            self.backend.lock().unwrap().successful_reads_remaining = Some(successful_reads);
        }
        pub(crate) fn clear_read_failure(&self) {
            self.backend.lock().unwrap().successful_reads_remaining = None;
        }
        pub(crate) fn enter(&self) -> TestScopeGuard {
            let previous = CURRENT.with(|current| current.replace(self.clone()));
            TestScopeGuard {
                previous: Some(previous),
                _thread_bound: std::marker::PhantomData,
            }
        }
    }

    impl Drop for TestScopeGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                CURRENT.with(|current| current.replace(previous));
            }
        }
    }
}

#[cfg(test)]
mod platform {
    use super::test_support::CURRENT;
    use super::*;

    pub(super) fn kind() -> &'static str {
        "keyring"
    }

    fn with_backend<T>(
        action: impl FnOnce(&mut test_support::MemoryBackend) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        CURRENT.with(|scope| {
            let scope = scope.borrow();
            let mut backend = scope.backend.lock().map_err(|_| unavailable())?;
            if backend.unavailable {
                return Err(unavailable());
            }
            action(&mut backend)
        })
    }

    pub(super) fn protect(
        purpose: CredentialPurpose,
        reference: &str,
        payload: &[u8],
    ) -> Result<String, AppError> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if native_keyring::test_backend_active() {
            return native_keyring::protect(purpose, reference, payload);
        }
        with_backend(|backend| {
            backend.values.insert(
                (purpose.label().to_owned(), reference.to_owned()),
                payload.to_vec(),
            );
            Ok(reference.to_owned())
        })
    }

    pub(super) fn unprotect(
        purpose: CredentialPurpose,
        reference: &str,
    ) -> Result<Vec<u8>, AppError> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if native_keyring::test_backend_active() {
            return native_keyring::unprotect(purpose, reference);
        }
        with_backend(|backend| {
            if let Some(remaining) = &mut backend.successful_reads_remaining {
                if *remaining == 0 {
                    return Err(unavailable());
                }
                *remaining -= 1;
            }
            backend
                .values
                .get(&(purpose.label().to_owned(), reference.to_owned()))
                .cloned()
                .ok_or_else(invalid_credential)
        })
    }

    pub(super) fn delete(purpose: CredentialPurpose, reference: &str) -> Result<(), AppError> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if native_keyring::test_backend_active() {
            return native_keyring::delete(purpose, reference);
        }
        with_backend(|backend| {
            backend
                .values
                .remove(&(purpose.label().to_owned(), reference.to_owned()));
            Ok(())
        })
    }

    #[allow(dead_code)]
    pub(super) fn unprotect_legacy(legacy: &str) -> Result<String, AppError> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if native_keyring::test_backend_active() {
            return native_keyring::unprotect_legacy(legacy);
        }
        let _ = legacy;
        Err(invalid_credential())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod native_windows_tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    #[test]
    #[ignore = "native OS provider; opt in on disposable CI runner"]
    fn native_dpapi_binds_purpose_and_rejects_tampering() {
        // All payloads are synthetic bytes in memory. No application file,
        // registry value, HOME path or existing credential is read or written.
        let payload = b"ai-helper-synthetic-native-dpapi-payload";
        let reference = "0".repeat(64);
        assert_eq!(native_windows::kind(), "dpapi");
        let token = native_windows::protect(CredentialPurpose::SessionId, &reference, payload)
            .expect("native DPAPI must protect the synthetic payload");
        assert_eq!(
            native_windows::unprotect(CredentialPurpose::SessionId, &token).unwrap(),
            payload
        );
        // Rewriting a public purpose label cannot bypass DPAPI entropy binding.
        assert!(native_windows::unprotect(CredentialPurpose::RefreshCookie, &token).is_err());
        let mut tampered = BASE64.decode(&token).unwrap();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(
            native_windows::unprotect(CredentialPurpose::SessionId, &BASE64.encode(tampered),)
                .is_err()
        );
        native_windows::delete(CredentialPurpose::SessionId, &token).unwrap();

        let workers: Vec<_> = (0..4)
            .map(|index| {
                std::thread::spawn(move || {
                    let payload = format!("synthetic-native-thread-{index}");
                    let token = native_windows::protect(
                        CredentialPurpose::RefreshCookie,
                        "unused-dpapi-reference",
                        payload.as_bytes(),
                    )
                    .unwrap();
                    assert_eq!(
                        native_windows::unprotect(CredentialPurpose::RefreshCookie, &token)
                            .unwrap(),
                        payload.as_bytes()
                    );
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
    }

    #[test]
    #[ignore = "native OS provider; opt in on disposable CI runner"]
    fn native_dpapi_legacy_v1_remains_decryptable() {
        let legacy_plaintext = "ai-helper-synthetic-legacy-dpapi-value";
        let legacy = native_windows::protect_legacy_for_test(legacy_plaintext.as_bytes()).unwrap();
        assert_eq!(
            native_windows::unprotect_legacy(&legacy).unwrap(),
            legacy_plaintext
        );
        // V2 cannot silently treat unbound v1 bytes as purpose-bound ciphertext.
        assert!(native_windows::unprotect(CredentialPurpose::SessionId, &legacy).is_err());
        let upgraded = native_windows::protect(
            CredentialPurpose::SessionId,
            "unused-dpapi-reference",
            legacy_plaintext.as_bytes(),
        )
        .unwrap();
        assert_eq!(
            native_windows::unprotect(CredentialPurpose::SessionId, &upgraded).unwrap(),
            legacy_plaintext.as_bytes()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::TestScope;
    use super::*;

    #[test]
    fn roundtrip_uses_only_an_opaque_reference() {
        let _guard = TestScope::new().enter();
        let secret = "regression-test-cookie";
        let reference = protect_secret_for(CredentialPurpose::RefreshCookie, secret).unwrap();
        assert!(is_encrypted(&reference));
        assert!(!reference.contains(secret));
        assert_eq!(
            unprotect_secret_for(CredentialPurpose::RefreshCookie, &reference).unwrap(),
            (secret.to_owned(), false)
        );
    }

    #[test]
    fn rejects_wrong_purpose_missing_and_corrupt_references() {
        let _guard = TestScope::new().enter();
        let reference = protect_secret_for(CredentialPurpose::SessionId, "test-session").unwrap();
        assert!(unprotect_secret_for(CredentialPurpose::RefreshCookie, &reference).is_err());
        assert!(delete_secret_for(CredentialPurpose::RefreshCookie, &reference).is_err());
        assert!(
            unprotect_secret_for(CredentialPurpose::SessionId, &(reference.clone() + "a")).is_err()
        );
        let missing = format!("{ENCRYPTED_PREFIX}keyring:session-id:{}", "0".repeat(64));
        assert!(unprotect_secret_for(CredentialPurpose::SessionId, &missing).is_err());
        for malformed in ["enc:v3:anything", "enc:v2:", "enc:v2:keyring:session-id:"] {
            assert!(unprotect_secret_for(CredentialPurpose::SessionId, malformed).is_err());
        }
        let relabeled = reference.replace(":session-id:", ":refresh-cookie:");
        assert!(unprotect_secret_for(CredentialPurpose::RefreshCookie, &relabeled).is_err());
        assert!(unprotect_secret_for(CredentialPurpose::SessionId, &reference).is_ok());
    }

    #[test]
    fn checks_the_envelope_identity_version_and_purpose() {
        let scope = TestScope::new();
        let _guard = scope.enter();
        let reference = protect_secret_for(CredentialPurpose::SessionId, "test-session").unwrap();
        let token = parse_reference(CredentialPurpose::SessionId, &reference).unwrap();
        let mut payloads = vec![b"{}".to_vec(), b"not-json".to_vec()];
        for (version, purpose, id) in [
            (3, "session-id", token.to_owned()),
            (2, "refresh-cookie", token.to_owned()),
            (2, "session-id", "0".repeat(64)),
        ] {
            payloads.push(
                serde_json::to_vec(&CredentialEnvelope {
                    version,
                    purpose: purpose.into(),
                    reference: id,
                    secret: "test-session".into(),
                })
                .unwrap(),
            );
        }
        for payload in payloads {
            scope
                .backend
                .lock()
                .unwrap()
                .values
                .insert(("session-id".into(), token.into()), payload);
            assert!(unprotect_secret_for(CredentialPurpose::SessionId, &reference).is_err());
        }
    }

    #[test]
    fn unavailable_service_has_no_storage_fallback() {
        let scope = TestScope::new();
        let _guard = scope.enter();
        let reference = protect_secret_for(CredentialPurpose::SessionId, "test-session").unwrap();
        scope.set_available(false);
        assert!(protect_secret_for(CredentialPurpose::SessionId, "other").is_err());
        assert!(unprotect_secret_for(CredentialPurpose::SessionId, &reference).is_err());
        assert!(delete_secret_for(CredentialPurpose::SessionId, &reference).is_err());
        scope.set_available(true);
        assert!(unprotect_secret_for(CredentialPurpose::SessionId, &reference).is_ok());
        delete_secret_for(CredentialPurpose::SessionId, &reference).unwrap();
        assert!(unprotect_secret_for(CredentialPurpose::SessionId, &reference).is_err());
        delete_secret_for(CredentialPurpose::SessionId, &reference).unwrap();
    }

    #[test]
    fn concurrent_credentials_keep_distinct_references() {
        let scope = TestScope::new();
        let handles: Vec<_> = (0..16)
            .map(|index| {
                let scope = scope.clone();
                std::thread::spawn(move || {
                    let _guard = scope.enter();
                    let secret = format!("test-session-{index}");
                    let reference =
                        protect_secret_for(CredentialPurpose::SessionId, &secret).unwrap();
                    assert_eq!(
                        unprotect_secret_for(CredentialPurpose::SessionId, &reference)
                            .unwrap()
                            .0,
                        secret
                    );
                    reference
                })
            })
            .collect();
        let references: std::collections::HashSet<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(references.len(), 16);
        let _guard = scope.enter();
        for reference in references {
            assert!(unprotect_secret_for(CredentialPurpose::SessionId, &reference).is_ok());
        }
    }

    #[test]
    fn scopes_are_isolated_and_empty_credentials_need_no_service() {
        let first = TestScope::new();
        let reference = {
            let _guard = first.enter();
            protect_secret("test-value").unwrap()
        };
        let _guard = TestScope::unavailable().enter();
        assert!(unprotect_secret(&reference).is_err());
        assert_eq!(protect_secret("").unwrap(), "");
        assert_eq!(unprotect_secret("").unwrap(), (String::new(), false));
        let _nested_guard = TestScope::new().enter();
        assert!(unprotect_secret(&reference).is_err());
    }

    #[test]
    fn legacy_plaintext_requires_upgrade_and_unknown_ciphertext_is_rejected() {
        let _guard = TestScope::new().enter();
        assert_eq!(
            unprotect_secret("test-legacy-value").unwrap(),
            ("test-legacy-value".into(), true)
        );
        assert!(unprotect_secret("enc:v1:not-a-native-dpapi-blob").is_err());
        assert!(is_encrypted("enc:v1:historical"));
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn native_keyring_contract() {
        assert_eq!(native_keyring::kind(), "keyring");
        assert!(native_keyring::unprotect_legacy("any-legacy-string").is_err());
        assert!(!native_keyring::test_backend_active());
        assert!(native_keyring::service(CredentialPurpose::SessionId).is_err());
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod native_keyring_tests {
    use super::*;
    use std::process::{Command, Output};

    struct NativeCleanup<'scope> {
        purpose: CredentialPurpose,
        protected: Option<String>,
        _scope: &'scope native_keyring::NativeTestScope,
    }

    impl<'scope> NativeCleanup<'scope> {
        // Only called after protect_secret_for successfully creates this entry.
        fn new(
            scope: &'scope native_keyring::NativeTestScope,
            purpose: CredentialPurpose,
            protected: String,
        ) -> Self {
            Self {
                purpose,
                protected: Some(protected),
                _scope: scope,
            }
        }

        fn remove(&mut self) -> Result<(), AppError> {
            if let Some(protected) = &self.protected {
                delete_secret_for(self.purpose, protected)?;
                self.protected = None;
            }
            Ok(())
        }
    }

    impl Drop for NativeCleanup<'_> {
        fn drop(&mut self) {
            let _ = self.remove();
        }
    }

    fn read_with_os_tool(service: &str, reference: &str) -> Output {
        #[cfg(target_os = "macos")]
        let output = Command::new("security")
            // Metadata lookup needs no cross-application secret-read grant.
            // The creating test executable reads the actual secret below.
            .args(["find-generic-password", "-s", service, "-a", reference])
            .output()
            .expect("security command failed");
        #[cfg(target_os = "linux")]
        let output = Command::new("secret-tool")
            .args([
                "lookup", "service", service, "username", reference, "target", "default",
            ])
            .output()
            .expect("secret-tool command failed");
        output
    }

    fn native_v2_envelope_roundtrip_and_cleanup() {
        // Scope outlives every cleanup guard. It changes this test thread only;
        // other unit tests continue to use their isolated memory backends.
        let scope = native_keyring::NativeTestScope::enter();
        let purpose = CredentialPurpose::SessionId;
        let plaintext = "ai-helper-synthetic-native-v2-session";
        let protected = protect_secret_for(purpose, plaintext).unwrap();
        let mut cleanup = NativeCleanup::new(&scope, purpose, protected.clone());
        let reference = parse_reference(purpose, &protected).unwrap();
        let service = native_keyring::service(purpose).unwrap();
        assert!(service.starts_with("com.ai-helper.tests.credentials.v2."));
        assert!(valid_reference_id(reference));
        assert!(!protected.contains(plaintext));
        assert_eq!(
            unprotect_secret_for(purpose, &protected).unwrap(),
            (plaintext.to_owned(), false)
        );
        let refresh_purpose = CredentialPurpose::RefreshCookie;
        let refresh =
            protect_secret_for(refresh_purpose, "synthetic-native-refresh-cookie").unwrap();
        let mut refresh_cleanup = NativeCleanup::new(&scope, refresh_purpose, refresh.clone());
        let refresh_reference = parse_reference(refresh_purpose, &refresh).unwrap();
        assert_ne!(reference, refresh_reference);
        assert_eq!(
            unprotect_secret_for(refresh_purpose, &refresh).unwrap(),
            ("synthetic-native-refresh-cookie".to_owned(), false)
        );
        assert!(
            !native_keyring::test_entry_is_missing(refresh_purpose, refresh_reference).unwrap()
        );

        // Independent OS lookup proves this public-API roundtrip reached the
        // native store rather than the unit-test MemoryBackend.
        let original = native_keyring::unprotect(purpose, reference).unwrap();
        let verify = read_with_os_tool(&service, reference);
        assert!(verify.status.success(), "native entry not found by OS tool");
        #[cfg(target_os = "linux")]
        assert_eq!(
            verify.stdout.strip_suffix(b"\n").unwrap_or(&verify.stdout),
            original
        );
        assert!(unprotect_secret_for(CredentialPurpose::RefreshCookie, &protected).is_err());
        assert!(delete_secret_for(CredentialPurpose::RefreshCookie, &protected).is_err());
        let relabeled = protected.replace(":session-id:", ":refresh-cookie:");
        assert!(unprotect_secret_for(CredentialPurpose::RefreshCookie, &relabeled).is_err());
        assert!(
            unprotect_secret_for(purpose, &protected.replacen("enc:v2:", "enc:v3:", 1)).is_err()
        );
        assert!(unprotect_secret_for(purpose, "enc:v1:synthetic-legacy-unix").is_err());

        let missing_reference = new_reference().unwrap();
        assert!(native_keyring::test_entry_is_missing(purpose, &missing_reference).unwrap());
        let replaced_reference = protected.replace(reference, &missing_reference);
        assert!(unprotect_secret_for(purpose, &replaced_reference).is_err());

        // Mutate only the entry this test successfully created. This covers the
        // shared v2 parser as well as the native backend; it does not exercise
        // SessionStore's file commit, migration or CookieJar activation.
        for (field, value) in [
            ("version", serde_json::json!(3)),
            ("purpose", serde_json::json!("refresh-cookie")),
            ("reference", serde_json::json!(missing_reference)),
            ("unexpected", serde_json::json!(true)),
        ] {
            let mut tampered: serde_json::Value = serde_json::from_slice(&original).unwrap();
            tampered[field] = value;
            native_keyring::protect(purpose, reference, &serde_json::to_vec(&tampered).unwrap())
                .unwrap();
            assert!(unprotect_secret_for(purpose, &protected).is_err());
        }
        native_keyring::protect(purpose, reference, b"not-a-v2-envelope").unwrap();
        assert!(unprotect_secret_for(purpose, &protected).is_err());
        native_keyring::protect(purpose, reference, &original).unwrap();
        assert_eq!(
            unprotect_secret_for(purpose, &protected).unwrap(),
            (plaintext.to_owned(), false)
        );

        cleanup.remove().unwrap();
        assert!(native_keyring::test_entry_is_missing(purpose, reference).unwrap());
        assert!(unprotect_secret_for(purpose, &protected).is_err());
        let deleted = read_with_os_tool(&service, reference);
        assert!(!deleted.status.success(), "native entry should be deleted");
        assert!(deleted.stdout.is_empty());
        assert_eq!(
            unprotect_secret_for(refresh_purpose, &refresh).unwrap(),
            ("synthetic-native-refresh-cookie".to_owned(), false)
        );
        refresh_cleanup.remove().unwrap();
        assert!(native_keyring::test_entry_is_missing(refresh_purpose, refresh_reference).unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires AI_HELPER_NATIVE_CREDENTIAL_TESTS=1 and a disposable user Keychain"]
    fn native_keychain_roundtrip_and_cleanup() {
        native_v2_envelope_roundtrip_and_cleanup();
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires AI_HELPER_NATIVE_CREDENTIAL_TESTS=1 and an isolated Secret Service"]
    fn native_secret_service_roundtrip_and_cleanup() {
        native_v2_envelope_roundtrip_and_cleanup();
    }
}

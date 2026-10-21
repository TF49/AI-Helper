use crate::error::AppError;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

fn lock_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        ".{}.lock",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file")
    ))
}

/// OS locks are released on process exit. Keep the empty lock file in place:
/// unlinking it would allow writers to lock different files at the same path.
pub(crate) fn with_file_lock<T>(
    path: &Path,
    f: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    prepare_parent(path)?;
    let lock = lock_path(path);
    reject_link(&lock)?;
    let _guard = platform::lock(platform::open_lock(&lock)?)?;
    f()
}

fn prepare_parent(path: &Path) -> Result<&Path, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Other(format!("无效路径: {}", path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)?;
    }
    #[cfg(windows)]
    fs::create_dir_all(parent)?;
    Ok(parent)
}

fn reject_link(path: &Path) -> Result<(), AppError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    #[cfg(windows)]
    let is_link = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(unix)]
    let is_link = metadata.file_type().is_symlink();
    if is_link || !metadata.is_file() {
        return Err(AppError::Other(format!(
            "拒绝写入符号链接、重解析点或非普通文件: {}",
            path.display()
        )));
    }
    Ok(())
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn write_temp(path: &Path, contents: &[u8]) -> Result<TemporaryFile, AppError> {
    let parent = prepare_parent(path)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Other("无效文件名".into()))?;
    let mut random = [0u8; 16];
    getrandom::getrandom(&mut random)
        .map_err(|error| AppError::Other(format!("生成安全临时文件名失败: {error}")))?;
    let suffix = u128::from_ne_bytes(random);
    let tmp_path = parent.join(format!(".{name}.{suffix:032x}.tmp"));
    let mut file = platform::open_private(&tmp_path, true)?;
    let tmp = TemporaryFile(tmp_path);
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);
    Ok(tmp)
}

fn backup_path(path: &Path) -> PathBuf {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => path.with_extension(format!("{ext}.bak")),
        None => path.with_extension("bak"),
    }
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    reject_link(path)?;
    match fs::read(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn recover_missing_file_locked(path: &Path) -> Result<(), AppError> {
    if read_optional(path)?.is_none() {
        if let Some(contents) = read_optional(&backup_path(path))? {
            atomic_write_locked(path, contents)?;
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub fn recover_missing_file(path: &Path) -> Result<(), AppError> {
    with_file_lock(path, || recover_missing_file_locked(path))
}

/// Caller must already hold `with_file_lock(path, ...)`.
pub(crate) fn atomic_write_locked(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    reject_link(path)?;
    let tmp = write_temp(path, contents.as_ref())?;
    platform::replace(&tmp.0, path)?;
    Ok(())
}

pub fn atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    with_file_lock(path, || {
        recover_missing_file_locked(path)?;
        atomic_write_locked(path, contents)
    })
}

/// Recovery, reading, merging, backup creation, and replacement share one lock.
/// Backups are also private from creation; no plaintext `copy` window exists.
pub(crate) fn update_file(
    path: &Path,
    update: impl FnOnce(Option<&[u8]>) -> Result<Vec<u8>, AppError>,
) -> Result<(), AppError> {
    with_file_lock(path, || update_file_locked(path, update))
}

/// Caller must already hold the target lock, including any related rollback.
pub(crate) fn update_file_locked(
    path: &Path,
    update: impl FnOnce(Option<&[u8]>) -> Result<Vec<u8>, AppError>,
) -> Result<(), AppError> {
    recover_missing_file_locked(path)?;
    let previous = read_optional(path)?;
    let contents = update(previous.as_deref())?;
    if let Some(previous) = previous {
        atomic_write_locked(&backup_path(path), previous)?;
    }
    atomic_write_locked(path, contents)
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn backup_then_atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    update_file(path, |_| Ok(contents.as_ref().to_vec()))
}

pub fn safe_write_file(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
    atomic_write(path, contents)
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::fs::OpenOptions;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;

    pub(super) fn open_private(path: &Path, create_new: bool) -> Result<File, AppError> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).mode(0o600);
        if create_new {
            options.create_new(true);
        } else {
            options.create(true).truncate(false);
        }
        Ok(options.open(path)?)
    }

    pub(super) fn open_lock(path: &Path) -> Result<File, AppError> {
        use std::os::unix::fs::PermissionsExt;
        if path.exists() {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
        open_private(path, false)
    }

    pub(super) struct LockGuard(File);

    pub(super) fn lock(file: File) -> Result<LockGuard, AppError> {
        loop {
            if unsafe { flock(file.as_raw_fd(), 2) } == 0 {
                return Ok(LockGuard(file));
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(error.into());
            }
        }
    }

    impl Drop for LockGuard {
        fn drop(&mut self) {
            unsafe {
                flock(self.0.as_raw_fd(), 8);
            }
        }
    }

    pub(super) fn replace(tmp: &Path, target: &Path) -> Result<(), AppError> {
        replace_with_sync(tmp, target, File::sync_all)
    }

    fn replace_with_sync(
        tmp: &Path,
        target: &Path,
        sync_directory: impl FnOnce(&File) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
        // Open before rename: a searchable/writable directory need not be
        // readable. Access errors must leave the target unchanged.
        let directory = File::open(target.parent().expect("target has parent"))?;
        fs::rename(tmp, target)?;
        sync_directory(&directory).map_err(|source| AppError::FileCommittedButNotDurable {
            path: target.to_path_buf(),
            source,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn directory_sync_failure_reports_the_committed_file() {
            let directory = tempfile::tempdir().unwrap();
            let target = directory.path().join("config.json");
            let replacement = directory.path().join("replacement.tmp");
            fs::write(&target, b"old").unwrap();
            fs::write(&replacement, b"new").unwrap();
            let error = replace_with_sync(&replacement, &target, |_| {
                Err(std::io::Error::other("injected directory sync failure"))
            })
            .unwrap_err();
            assert!(error.file_was_committed(&target));
            assert!(!error.file_was_committed(&backup_path(&target)));
            assert_eq!(fs::read(&target).unwrap(), b"new");
            assert!(!replacement.exists());
        }

        #[test]
        fn failed_rename_is_not_reported_as_a_commit() {
            let directory = tempfile::tempdir().unwrap();
            let target = directory.path().join("config.json");
            fs::write(&target, b"old").unwrap();
            let error = replace_with_sync(&directory.path().join("missing.tmp"), &target, |_| {
                panic!("a failed rename must not attempt directory sync")
            })
            .unwrap_err();
            assert!(!error.file_was_committed(&target));
            assert_eq!(fs::read(&target).unwrap(), b"old");
        }
    }

    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

    type Handle = *mut c_void;

    #[repr(C)]
    struct SecurityAttributes {
        length: u32,
        descriptor: *mut c_void,
        inherit: i32,
    }
    #[repr(C)]
    struct TokenUser {
        sid: *mut c_void,
        attributes: u32,
    }
    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: Handle,
    }

    struct LocalAllocation(*mut c_void);
    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn sid_string() -> Result<String, AppError> {
        let mut token = std::ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), 0x0008, &mut token) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let token = unsafe { OwnedHandle::from_raw_handle(token) };
        let mut length = 0;
        unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                1,
                std::ptr::null_mut(),
                0,
                &mut length,
            );
        }
        if length == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut buffer = vec![0usize; (length as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                1,
                buffer.as_mut_ptr().cast(),
                length,
                &mut length,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let user = unsafe { &*buffer.as_ptr().cast::<TokenUser>() };
        let mut text = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.sid, &mut text) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let _allocation = LocalAllocation(text.cast());
        let mut count = 0;
        unsafe {
            while *text.add(count) != 0 {
                count += 1;
            }
            Ok(String::from_utf16_lossy(std::slice::from_raw_parts(
                text, count,
            )))
        }
    }

    fn descriptor(sddl: &str) -> Result<LocalAllocation, AppError> {
        let sddl = sddl.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(LocalAllocation(descriptor))
    }

    pub(super) fn open_private(path: &Path, create_new: bool) -> Result<File, AppError> {
        let descriptor = descriptor(&format!("D:P(A;;FA;;;{})", sid_string()?))?;
        let attributes = SecurityAttributes {
            length: std::mem::size_of::<SecurityAttributes>() as u32,
            descriptor: descriptor.0,
            inherit: 0,
        };
        let path = wide(path);
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                0x80000000 | 0x40000000,
                0x1 | 0x2,
                &attributes,
                if create_new { 1 } else { 4 },
                0x00000080 | 0x00200000,
                std::ptr::null_mut(),
            )
        };
        if handle == -1isize as Handle {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(unsafe { File::from_raw_handle(handle) })
    }

    pub(super) fn open_lock(path: &Path) -> Result<File, AppError> {
        let descriptor = descriptor(&format!("D:P(A;;FA;;;{})", sid_string()?))?;
        let attributes = SecurityAttributes {
            length: std::mem::size_of::<SecurityAttributes>() as u32,
            descriptor: descriptor.0,
            inherit: 0,
        };
        // The owner can repair a legacy lock's DACL even when that DACL no
        // longer grants read/write access to the actual process identity.
        let raw = unsafe {
            CreateFileW(
                wide(path).as_ptr(),
                0x00020000 | 0x00040000,
                0x1 | 0x2,
                &attributes,
                4,
                0x00000080 | 0x00200000,
                std::ptr::null_mut(),
            )
        };
        if raw == -1isize as Handle {
            return Err(std::io::Error::last_os_error().into());
        }
        let security_handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl = std::ptr::null_mut();
        if unsafe {
            GetSecurityDescriptorDacl(descriptor.0, &mut present, &mut dacl, &mut defaulted)
        } == 0
            || present == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let error = unsafe {
            SetSecurityInfo(
                security_handle.as_raw_handle(),
                1,
                0x4 | 0x80000000,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                dacl,
                std::ptr::null_mut(),
            )
        };
        if error != 0 {
            return Err(std::io::Error::from_raw_os_error(error as i32).into());
        }
        // Keep a non-delete-sharing handle open until the locking handle is
        // acquired, so the named lock cannot be swapped during DACL repair.
        let file = open_private(path, false)?;
        drop(security_handle);
        Ok(file)
    }

    pub(super) struct LockGuard {
        file: File,
        overlapped: Overlapped,
    }

    pub(super) fn lock(file: File) -> Result<LockGuard, AppError> {
        let mut guard = LockGuard {
            file,
            overlapped: Overlapped {
                internal: 0,
                internal_high: 0,
                offset: 0,
                offset_high: 0,
                event: std::ptr::null_mut(),
            },
        };
        if unsafe {
            LockFileEx(
                guard.file.as_raw_handle(),
                2,
                0,
                1,
                0,
                &mut guard.overlapped,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(guard)
    }

    impl Drop for LockGuard {
        fn drop(&mut self) {
            unsafe {
                UnlockFileEx(self.file.as_raw_handle(), 0, 1, 0, &mut self.overlapped);
            }
        }
    }

    pub(super) fn replace(tmp: &Path, target: &Path) -> Result<(), AppError> {
        // ReplaceFileW merges the old target DACL. A same-directory move keeps
        // the private security descriptor of the newly created replacement.
        if unsafe { MoveFileExW(wide(tmp).as_ptr(), wide(target).as_ptr(), 0x1 | 0x8) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            path: *const u16,
            access: u32,
            share: u32,
            security: *const SecurityAttributes,
            disposition: u32,
            flags: u32,
            template: Handle,
        ) -> Handle;
        fn GetCurrentProcess() -> Handle;
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
        fn LockFileEx(
            file: Handle,
            flags: u32,
            reserved: u32,
            bytes_low: u32,
            bytes_high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
        fn UnlockFileEx(
            file: Handle,
            reserved: u32,
            bytes_low: u32,
            bytes_high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(
            token: Handle,
            class: u32,
            information: *mut c_void,
            length: u32,
            needed: *mut u32,
        ) -> i32;
        fn ConvertSidToStringSidW(sid: *const c_void, text: *mut *mut u16) -> i32;
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text: *const u16,
            revision: u32,
            descriptor: *mut *mut c_void,
            length: *mut u32,
        ) -> i32;
        fn GetSecurityDescriptorDacl(
            descriptor: *const c_void,
            present: *mut i32,
            dacl: *mut *mut c_void,
            defaulted: *mut i32,
        ) -> i32;
        fn SetSecurityInfo(
            object: Handle,
            kind: u32,
            information: u32,
            owner: *mut c_void,
            group: *mut c_void,
            dacl: *mut c_void,
            sacl: *mut c_void,
        ) -> u32;
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn set_dacl(path: &Path, sddl: &str) {
            let descriptor = descriptor(sddl).unwrap();
            assert_ne!(
                unsafe { SetFileSecurityW(wide(path).as_ptr(), 0x4 | 0x80000000, descriptor.0) },
                0,
                "{}",
                std::io::Error::last_os_error()
            );
        }

        fn dacl(path: &Path) -> String {
            let mut length = 0;
            unsafe {
                GetFileSecurityW(
                    wide(path).as_ptr(),
                    0x4,
                    std::ptr::null_mut(),
                    0,
                    &mut length,
                );
            }
            assert_ne!(length, 0);
            let mut buffer = vec![0usize; (length as usize).div_ceil(std::mem::size_of::<usize>())];
            assert_ne!(
                unsafe {
                    GetFileSecurityW(
                        wide(path).as_ptr(),
                        0x4,
                        buffer.as_mut_ptr().cast(),
                        length,
                        &mut length,
                    )
                },
                0
            );
            let mut text = std::ptr::null_mut();
            assert_ne!(
                unsafe {
                    ConvertSecurityDescriptorToStringSecurityDescriptorW(
                        buffer.as_ptr().cast(),
                        1,
                        0x4,
                        &mut text,
                        std::ptr::null_mut(),
                    )
                },
                0
            );
            let _allocation = LocalAllocation(text.cast());
            let mut count = 0;
            unsafe {
                while *text.add(count) != 0 {
                    count += 1;
                }
                String::from_utf16_lossy(std::slice::from_raw_parts(text, count))
            }
        }

        fn assert_current_user_only(path: &Path) {
            let acl = dacl(path);
            assert_eq!(acl.matches('(').count(), 1, "unexpected ACL: {acl}");
            assert!(
                acl.contains(&sid_string().unwrap()),
                "unexpected ACL: {acl}"
            );
            assert!(!acl.contains(";;;WD)"), "Everyone still has access: {acl}");
        }

        #[test]
        fn private_acl_exists_before_any_contents_are_written() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("empty.json");
            let file = open_private(&path, true).unwrap();
            assert_eq!(file.metadata().unwrap().len(), 0);
            assert_current_user_only(&path);
        }

        #[test]
        fn replacement_and_backup_remove_old_explicit_everyone_access() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("settings.json");
            let backup = backup_path(&path);
            fs::write(&path, b"old-fake-key").unwrap();
            fs::write(&backup, b"older-fake-key").unwrap();
            let permissive = format!("D:P(A;;FA;;;{})(A;;FR;;;WD)", sid_string().unwrap());
            set_dacl(&path, &permissive);
            set_dacl(&backup, &permissive);
            assert!(dacl(&path).contains(";;;WD)"));

            backup_then_atomic_write(&path, b"new-fake-key").unwrap();

            assert_eq!(fs::read(&path).unwrap(), b"new-fake-key");
            assert_eq!(fs::read(&backup).unwrap(), b"old-fake-key");
            assert_current_user_only(&path);
            assert_current_user_only(&backup);
        }

        #[test]
        fn stale_lock_with_no_write_permission_is_repaired_and_reused() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("settings.json");
            let lock = lock_path(&path);
            fs::write(&lock, b"").unwrap();
            set_dacl(&lock, "D:P(A;;FR;;;WD)");
            with_file_lock(&path, || Ok(())).unwrap();
            assert_current_user_only(&lock);
            with_file_lock(&path, || Ok(())).unwrap();
        }

        #[link(name = "advapi32")]
        unsafe extern "system" {
            fn SetFileSecurityW(
                path: *const u16,
                information: u32,
                descriptor: *const c_void,
            ) -> i32;
            fn GetFileSecurityW(
                path: *const u16,
                information: u32,
                descriptor: *mut c_void,
                length: u32,
                needed: *mut u32,
            ) -> i32;
            fn ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor: *const c_void,
                revision: u32,
                information: u32,
                text: *mut *mut u16,
                length: *mut u32,
            ) -> i32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    #[test]
    fn recovered_configuration_is_the_merge_input() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let old = br#"{"permissions":{"deny":["Bash(rm:*)"]},"sandbox":{"enabled":true},"hooks":{"keep":1}}"#;
        fs::write(backup_path(&path), old).unwrap();
        assert!(!path.exists());

        update_file(&path, |previous| {
            let existing = serde_json::from_slice(previous.expect("backup must be recovered"))?;
            let merged = crate::claude::merge_claude_settings(
                existing,
                "https://bob-api.com",
                "fake-key",
                Some("fake-model"),
            )?;
            Ok(serde_json::to_vec(&merged)?)
        })
        .unwrap();

        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["permissions"]["deny"][0], "Bash(rm:*)");
        assert_eq!(value["sandbox"]["enabled"], true);
        assert_eq!(value["hooks"]["keep"], 1);
        assert_eq!(value["env"]["ANTHROPIC_AUTH_TOKEN"], "fake-key");
        assert_eq!(fs::read(backup_path(&path)).unwrap(), old);
    }

    #[test]
    fn concurrent_updates_keep_all_committed_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("counter.txt");
        safe_write_file(&path, b"0").unwrap();
        let workers = (0..4)
            .map(|_| {
                let path = path.clone();
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        update_file(&path, |previous| {
                            let value = std::str::from_utf8(previous.unwrap())
                                .unwrap()
                                .parse::<u64>()
                                .unwrap();
                            Ok((value + 1).to_string().into_bytes())
                        })
                        .unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), "40");
        assert_eq!(fs::read_to_string(backup_path(&path)).unwrap(), "39");
    }

    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn lock_child(path: &Path, ready: &Path, hold: bool) -> ChildGuard {
        ChildGuard(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "safe_fs::tests::lock_process_helper",
                    "--ignored",
                ])
                .env("AI_HELPER_LOCK_TEST_PATH", path)
                .env("AI_HELPER_LOCK_TEST_READY", ready)
                .env("AI_HELPER_LOCK_TEST_HOLD", if hold { "1" } else { "0" })
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }

    fn wait_for_ready(child: &mut ChildGuard, ready: &Path) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            if let Some(status) = child.0.try_wait().unwrap() {
                assert!(
                    status.success() && ready.exists(),
                    "lock helper exited before acquiring lock"
                );
                return;
            }
            assert!(
                Instant::now() < deadline,
                "lock was not released by terminated process"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn process_exit_releases_lock_and_waiting_writer_can_continue() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        let held = directory.path().join("held");
        let acquired = directory.path().join("acquired");
        let mut holder = lock_child(&path, &held, true);
        wait_for_ready(&mut holder, &held);
        let mut waiter = lock_child(&path, &acquired, false);
        std::thread::sleep(Duration::from_millis(150));
        assert!(
            !acquired.exists(),
            "a second process entered the locked transaction"
        );
        holder.0.kill().unwrap();
        holder.0.wait().unwrap();
        wait_for_ready(&mut waiter, &acquired);
        assert!(waiter.0.wait().unwrap().success());
        assert!(lock_path(&path).exists(), "lock file must not be unlinked");
    }

    #[test]
    #[ignore = "subprocess helper; uses only explicitly supplied temporary paths"]
    fn lock_process_helper() {
        let Some(path) = std::env::var_os("AI_HELPER_LOCK_TEST_PATH") else {
            return;
        };
        let ready = std::env::var_os("AI_HELPER_LOCK_TEST_READY").unwrap();
        with_file_lock(Path::new(&path), || {
            fs::write(ready, b"ready")?;
            if std::env::var("AI_HELPER_LOCK_TEST_HOLD").as_deref() == Ok("1") {
                loop {
                    std::thread::sleep(Duration::from_secs(10));
                }
            }
            Ok(())
        })
        .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replacement_and_backup_are_private_with_permissive_old_modes() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(&path, b"old-fake-key").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
        backup_then_atomic_write(&path, b"new-fake-key").unwrap();
        for path in [&path, &backup_path(&path)] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}

//! DSH's own cross-process write lock (`@deepseek-ai/dsh-atomic-write`).
//!
//! DSH serializes every read-modify-write of `.credentials.yaml` and
//! `cordis.patch.yml` — including refreshes of the official DeepSeek account
//! token under `records.deepseek-account-platform/*` — with a sibling
//! `<file>.lock` created exclusively and holding `<pid>\n`. AI Helper's own
//! lock is a different file, so without this one a token refresh landing
//! between our read and our rename would be overwritten with the stale token.
//!
//! Stale locks are never taken over here: DSH only removes a lock after
//! proving its holder exited through a claim protocol of its own, and a second
//! implementation could remove a lock DSH has just re-acquired. DSH clears a
//! stale lock on its next write, so we wait and then report.

use crate::error::AppError;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// DSH writers give up after two seconds by default, so the lock is held
/// only around the local read-render-commit cycle.
const WAIT: Duration = Duration::from_secs(5);
const FIRST_BACKOFF: Duration = Duration::from_millis(10);
const MAX_BACKOFF: Duration = Duration::from_millis(200);

pub(crate) fn lock_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    path.with_file_name(name)
}

struct Held {
    path: PathBuf,
    record: Vec<u8>,
}

impl Drop for Held {
    fn drop(&mut self) {
        // Only remove the lock while it is still ours.
        if fs::read(&self.path).is_ok_and(|current| current == self.record) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn try_acquire(path: &Path, record: &[u8]) -> std::io::Result<Option<Held>> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => {
            if let Err(error) = file.write_all(record) {
                drop(file);
                let _ = fs::remove_file(path);
                return Err(error);
            }
            Ok(Some(Held {
                path: path.to_path_buf(),
                record: record.to_vec(),
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
        // Windows reports a lock that is being deleted as access denied.
        Err(error)
            if error.kind() == std::io::ErrorKind::PermissionDenied
                && fs::symlink_metadata(path).is_ok() =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

fn acquire(path: &Path, wait: Duration) -> Result<Held, AppError> {
    let lock = lock_path(path);
    let record = format!("{}\n", std::process::id()).into_bytes();
    let deadline = Instant::now() + wait;
    let mut backoff = FIRST_BACKOFF;
    loop {
        if let Some(held) = try_acquire(&lock, &record)? {
            return Ok(held);
        }
        if Instant::now() >= deadline {
            return Err(AppError::Other(format!(
                "DeepSeek Harness 正在写入 {}，请稍后重试；若 DeepSeek Harness 未在运行，可启动一次让它清理遗留的锁文件 {}",
                path.file_name().unwrap_or_default().to_string_lossy(),
                lock.display()
            )));
        }
        std::thread::sleep(backoff);
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

/// Run `operation` while holding DSH's write lock of every path, acquired in
/// the given order.
pub(crate) fn with_dsh_locks<T>(
    paths: &[&Path],
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    with_dsh_locks_waiting(paths, WAIT, operation)
}

fn with_dsh_locks_waiting<T>(
    paths: &[&Path],
    wait: Duration,
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut held = Vec::with_capacity(paths.len());
    for path in paths {
        held.push(acquire(path, wait)?);
    }
    let result = operation();
    drop(held);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_file_matches_dsh_naming_and_is_removed_afterwards() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(".credentials.yaml");
        assert_eq!(
            lock_path(&path),
            directory.path().join(".credentials.yaml.lock")
        );
        let seen = with_dsh_locks(&[&path], || {
            Ok(fs::read_to_string(lock_path(&path)).unwrap())
        })
        .unwrap();
        assert_eq!(seen, format!("{}\n", std::process::id()));
        assert!(!lock_path(&path).exists());
    }

    #[test]
    fn a_lock_held_by_dsh_blocks_and_is_never_removed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cordis.patch.yml");
        fs::write(lock_path(&path), "4242\n").unwrap();
        let mut ran = false;
        let error = with_dsh_locks_waiting(&[&path], Duration::from_millis(50), || {
            ran = true;
            Ok(())
        })
        .unwrap_err();
        assert!(!ran);
        assert!(error.to_string().contains("cordis.patch.yml"));
        assert_eq!(fs::read_to_string(lock_path(&path)).unwrap(), "4242\n");
    }

    #[test]
    fn waits_for_a_lock_released_meanwhile() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(".credentials.yaml");
        fs::write(lock_path(&path), "4242\n").unwrap();
        let lock = lock_path(&path);
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            fs::remove_file(lock).unwrap();
        });
        with_dsh_locks_waiting(&[&path], Duration::from_secs(5), || Ok(())).unwrap();
        release.join().unwrap();
    }
}

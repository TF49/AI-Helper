//! 付费请求状态：已受理/未知结果不得跨供应商重做。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum PaidAttemptState {
    LocalRejected,
    NotDispatched,
    DispatchedUnknown,
    Completed,
}

pub fn may_fallback_to_other_provider(state: PaidAttemptState, status: Option<u16>) -> bool {
    if matches!(status, Some(400 | 401 | 403 | 404 | 408 | 409 | 422 | 429)) {
        return false;
    }
    match state {
        PaidAttemptState::LocalRejected
        | PaidAttemptState::DispatchedUnknown
        | PaidAttemptState::Completed => false,
        PaidAttemptState::NotDispatched => false,
    }
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegerBudget {
    pub settled: u64,
    pub pending: u64,
    pub cap: u64,
}

impl IntegerBudget {
    pub fn try_reserve(&mut self, amount: u64) -> Result<(), &'static str> {
        if self.cap == 0 {
            return Err("未配置有限预算，已禁用对应受管付费功能");
        }
        if amount == 0 {
            return Err("预留金额必须为正整数");
        }
        let used = self.settled.saturating_add(self.pending);
        if used.saturating_add(amount) > self.cap {
            return Err("已结算与未决预留超出预算");
        }
        self.pending = self.pending.saturating_add(amount);
        Ok(())
    }

    pub fn release_unsent(&mut self, amount: u64) {
        self.pending = self.pending.saturating_sub(amount);
    }

    pub fn settle(&mut self, reserved: u64, actual: u64) {
        self.pending = self.pending.saturating_sub(reserved);
        self.settled = self.settled.saturating_add(actual);
    }
}

fn budget_ledger_path() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(path) = std::env::var_os("AI_HELPER_TEST_LEDGER_PATH") {
            return PathBuf::from(path);
        }
        static TEST_DIRECTORY: once_cell::sync::Lazy<tempfile::TempDir> =
            once_cell::sync::Lazy::new(|| tempfile::tempdir().expect("isolated budget tests"));
        return TEST_DIRECTORY.path().join("image_budget_ledger.json");
    }
    #[cfg(not(test))]
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".ai-helper")
        .join("image_budget_ledger.json")
}

fn with_ledger_lock<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    crate::safe_fs::with_file_lock(&budget_ledger_path(), || {
        f().map_err(crate::error::AppError::Other)
    })
    .map_err(|error| error.to_string())
}

fn load_ledger(default_cap: u64) -> Result<IntegerBudget, String> {
    let path = budget_ledger_path();
    load_ledger_at(&path, default_cap)
}

fn load_ledger_at(path: &std::path::Path, default_cap: u64) -> Result<IntegerBudget, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(IntegerBudget {
                settled: 0,
                pending: 0,
                cap: default_cap,
            });
        }
        Err(error) => return Err(format!("读取预算账本失败: {error}")),
    };
    let mut ledger = serde_json::from_str::<IntegerBudget>(&content)
        .map_err(|e| format!("预算账本损坏，已禁用生图直到恢复: {e}"))?;
    ledger.cap = default_cap;
    Ok(ledger)
}

fn save_ledger(budget: &IntegerBudget) -> Result<(), String> {
    let path = budget_ledger_path();
    let content =
        serde_json::to_vec_pretty(budget).map_err(|e| format!("序列化预算账本失败: {e}"))?;
    // All callers hold the ledger's OS lock throughout load/reserve/commit.
    crate::safe_fs::atomic_write_locked(&path, content)
        .map_err(|e| format!("写入预算账本失败: {e}"))
}

static IMAGE_BUDGET: std::sync::Mutex<IntegerBudget> = std::sync::Mutex::new(IntegerBudget {
    settled: 0,
    pending: 0,
    cap: 0,
});

pub fn reset_image_budget(cap: u64) -> Result<(), String> {
    let mut guard = IMAGE_BUDGET
        .lock()
        .map_err(|_| "生图预算锁不可用".to_string())?;
    with_ledger_lock(|| {
        let mut loaded = load_ledger(cap)?;
        loaded.cap = cap;
        save_ledger(&loaded)?;
        *guard = loaded;
        Ok(())
    })
}

pub fn disable_image_budget() {
    if let Ok(mut budget) = IMAGE_BUDGET.lock() {
        budget.cap = 0;
    }
}

pub fn reserve_image_unit() -> Result<(), String> {
    let mut guard = IMAGE_BUDGET
        .lock()
        .map_err(|_| "生图预算锁不可用".to_string())?;
    with_ledger_lock(|| {
        let cap = guard.cap;
        if cap == 0 {
            return Err("未配置生图次数预算，已禁用受管生图功能".to_string());
        }
        let mut ledger = load_ledger(cap)?;
        ledger.try_reserve(1).map_err(str::to_string)?;
        save_ledger(&ledger)?;
        *guard = ledger;
        Ok(())
    })
}

#[allow(dead_code)]
pub fn release_image_unit() -> Result<(), String> {
    let mut guard = IMAGE_BUDGET
        .lock()
        .map_err(|_| "生图预算锁不可用".to_string())?;
    with_ledger_lock(|| {
        let cap = guard.cap;
        if cap == 0 {
            return Err("未配置生图预算，无法释放预留".to_string());
        }
        let mut ledger = load_ledger(cap)?;
        ledger.release_unsent(1);
        save_ledger(&ledger)?;
        *guard = ledger;
        Ok(())
    })
}

pub fn settle_image_unit() -> Result<(), String> {
    let mut guard = IMAGE_BUDGET
        .lock()
        .map_err(|_| "生图预算锁不可用".to_string())?;
    with_ledger_lock(|| {
        let cap = guard.cap;
        if cap == 0 {
            return Err("未配置生图预算，无法结算".to_string());
        }
        let mut ledger = load_ledger(cap)?;
        ledger.settle(1, 1);
        save_ledger(&ledger)?;
        *guard = ledger;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "subprocess helper; executed by cross-process budget tests"]
    fn budget_reservation_child() {
        if std::env::var_os("AI_HELPER_TEST_LEDGER_PATH").is_none() {
            return;
        }
        if reset_image_budget(1).is_err() {
            std::process::exit(24);
        }
        match reserve_image_unit() {
            Ok(()) => std::process::exit(0),
            Err(error) if error.contains("超出预算") => std::process::exit(23),
            Err(_) => std::process::exit(24),
        }
    }

    fn reservation_child(path: &std::path::Path) -> std::process::Child {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "paid_request::tests::budget_reservation_child",
                "--ignored",
            ])
            .env("AI_HELPER_TEST_LEDGER_PATH", path)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap()
    }

    #[test]
    fn two_processes_cannot_reserve_the_same_last_unit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.json");
        let mut first = reservation_child(&path);
        let mut second = reservation_child(&path);
        let mut results = [
            first.wait().unwrap().code().unwrap(),
            second.wait().unwrap().code().unwrap(),
        ];
        results.sort();
        assert_eq!(results, [0, 23]);
        let ledger = load_ledger_at(&path, 1).unwrap();
        assert_eq!(ledger.pending, 1);
        assert_eq!(ledger.settled, 0);
        // A restarted third process must observe the pending reservation too.
        assert_eq!(reservation_child(&path).wait().unwrap().code(), Some(23));
    }

    #[test]
    fn corrupt_ledger_blocks_new_process_without_erasing_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.json");
        fs::write(&path, b"broken ledger").unwrap();
        assert_eq!(reservation_child(&path).wait().unwrap().code(), Some(24));
        assert_eq!(fs::read(&path).unwrap(), b"broken ledger");
    }

    #[test]
    fn corrupt_or_unreadable_ledger_is_not_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ledger.json");
        fs::write(&path, b"broken ledger").unwrap();
        assert!(load_ledger_at(&path, 3).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken ledger");
        assert!(load_ledger_at(dir.path(), 3).is_err());
    }

    #[test]
    fn reopening_ledger_keeps_pending_and_settled_counts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ledger.json");
        fs::write(&path, br#"{"settled":2,"pending":1,"cap":4}"#).unwrap();
        let mut budget = load_ledger_at(&path, 4).unwrap();
        budget.try_reserve(1).unwrap();
        assert!(budget.try_reserve(1).is_err());
        assert_eq!(budget.settled, 2);
        assert_eq!(budget.pending, 2);
    }

    #[test]
    fn dispatched_or_unknown_never_retries_second_provider() {
        assert!(!may_fallback_to_other_provider(
            PaidAttemptState::DispatchedUnknown,
            Some(504)
        ));
        assert!(!may_fallback_to_other_provider(
            PaidAttemptState::Completed,
            Some(200)
        ));
        assert!(!may_fallback_to_other_provider(
            PaidAttemptState::LocalRejected,
            None
        ));
        assert!(!may_fallback_to_other_provider(
            PaidAttemptState::NotDispatched,
            Some(500)
        ));
    }

    #[test]
    fn client_errors_never_fallback() {
        for code in [400, 401, 403, 429] {
            assert!(!may_fallback_to_other_provider(
                PaidAttemptState::NotDispatched,
                Some(code)
            ));
        }
    }

    #[test]
    fn concurrent_reserve_allows_only_budget_cap() {
        let mut budget = IntegerBudget {
            settled: 0,
            pending: 0,
            cap: 100,
        };
        assert!(budget.try_reserve(100).is_ok());
        assert!(budget.try_reserve(1).is_err());
        budget.release_unsent(100);
        assert!(budget.try_reserve(40).is_ok());
        budget.settle(40, 50);
        assert_eq!(budget.settled, 50);
        assert_eq!(budget.pending, 0);
        assert!(budget.try_reserve(51).is_err());
        assert!(budget.try_reserve(50).is_ok());
    }

    #[test]
    fn zero_cap_disables_paid_feature() {
        let mut budget = IntegerBudget {
            settled: 0,
            pending: 0,
            cap: 0,
        };
        assert!(budget.try_reserve(1).is_err());
    }
}

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
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::time::Duration;

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
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".ai-helper")
        .join("image_budget_ledger.json")
}

fn lock_path() -> PathBuf {
    budget_ledger_path().with_file_name(".image_budget_ledger.lock")
}

fn with_ledger_lock<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let path = lock_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建预算目录失败: {e}"))?;
    }
    let mut handle = None;
    for _ in 0..100 {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                handle = Some(file);
                break;
            }
            Err(_) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    let _handle = handle.ok_or_else(|| "预算账本正被其他进程使用，已阻止付费请求".to_string())?;
    let result = f();
    let _ = fs::remove_file(path);
    result
}

fn load_ledger(default_cap: u64) -> Result<IntegerBudget, String> {
    let path = budget_ledger_path();
    if !path.exists() {
        return Ok(IntegerBudget {
            settled: 0,
            pending: 0,
            cap: default_cap,
        });
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取预算账本失败: {e}"))?;
    let mut ledger = serde_json::from_str::<IntegerBudget>(&content)
        .map_err(|e| format!("预算账本损坏，已禁用生图直到恢复: {e}"))?;
    ledger.cap = default_cap;
    Ok(ledger)
}

fn save_ledger(budget: &IntegerBudget) -> Result<(), String> {
    let path = budget_ledger_path();
    let content =
        serde_json::to_vec_pretty(budget).map_err(|e| format!("序列化预算账本失败: {e}"))?;
    crate::safe_fs::safe_write_file(&path, content).map_err(|e| format!("写入预算账本失败: {e}"))
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

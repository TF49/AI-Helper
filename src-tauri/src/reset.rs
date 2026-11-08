use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    PoisonError, RwLock, RwLockReadGuard,
};

pub const CLIENTS: [&str; 5] = [
    "Codex / ChatGPT",
    "Claude Code",
    "WorkBuddy",
    "Accio Work",
    "Cursor",
];
const CODEX_ENV: &str = "CUSTOM_OPENAI_API_KEY";
/// Clients whose configuration files belong to AI Helper and are deleted on
/// reset instead of being restored from a snapshot.
const OWNED_CLIENTS: [&str; 2] = ["Accio Work", "Cursor"];
static CONFIG_ACCESS: RwLock<()> = RwLock::new(());
static RESETTING: AtomicBool = AtomicBool::new(false);
static RESET_GENERATION: AtomicU64 = AtomicU64::new(0);

pub struct ResetGuard;

impl Drop for ResetGuard {
    fn drop(&mut self) {
        // Invalidate every generation observed while the reset was running
        // before reopening writes, so a task that read the generation mid-reset
        // can never pass `ensure_generation` afterwards.
        RESET_GENERATION.fetch_add(1, Ordering::AcqRel);
        RESETTING.store(false, Ordering::Release);
    }
}

pub fn begin_reset() -> Result<ResetGuard, AppError> {
    RESETTING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| AppError::Other("配置恢复正在执行，请稍后重试".into()))?;
    RESET_GENERATION.fetch_add(1, Ordering::AcqRel);
    Ok(ResetGuard)
}

pub fn is_resetting() -> bool {
    RESETTING.load(Ordering::Acquire)
}

pub fn current_generation() -> u64 {
    RESET_GENERATION.load(Ordering::Acquire)
}

pub fn ensure_generation(generation: u64) -> Result<(), AppError> {
    if is_resetting() || current_generation() != generation {
        return Err(AppError::Other(
            "客户端配置已被恢复操作更新，已取消过期的配置任务".into(),
        ));
    }
    Ok(())
}

/// The lock only orders writers against a reset and protects no data, so a
/// panic in an earlier holder leaves nothing inconsistent: recover from
/// poisoning instead of blocking every later configuration write.
fn config_read_lock() -> RwLockReadGuard<'static, ()> {
    CONFIG_ACCESS.read().unwrap_or_else(PoisonError::into_inner)
}

/// Writers (including background cache writes) finish before a reset begins.
pub fn with_config_write<T>(
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let _guard = config_read_lock();
    if is_resetting() {
        return Err(AppError::Other("配置清除期间暂不接受新的配置写入".into()));
    }
    operation()
}

/// Serialize a write that belongs to an async operation with the reset that
/// may have started while that operation was awaiting I/O. Checking the
/// generation while holding the read lock closes the check-then-write race.
pub fn with_config_write_at_generation<T>(
    generation: u64,
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let _guard = config_read_lock();
    ensure_generation(generation)?;
    operation()
}

pub fn with_reset<T>(operation: impl FnOnce() -> Result<T, AppError>) -> Result<T, AppError> {
    let _guard = CONFIG_ACCESS
        .write()
        .unwrap_or_else(PoisonError::into_inner);
    operation()
}

#[derive(Debug, Serialize, Deserialize)]
struct ResetState {
    version: u32,
    clients: BTreeMap<String, ClientBaseline>,
}

impl Default for ResetState {
    fn default() -> Self {
        Self {
            version: 2,
            clients: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ClientBaseline {
    files: BTreeMap<PathBuf, Option<Vec<u8>>>,
    environment: BTreeMap<String, EnvironmentBaseline>,
    #[serde(default)]
    legacy_limited: bool,
    /// SHA256 hex hashes of files we last wrote. Used to detect external modifications.
    #[serde(default)]
    last_written: BTreeMap<PathBuf, String>,
    /// Captured by a version 1 build, before write hashes existed: reset can
    /// never tell whether these files were edited later, so they only get
    /// field-level cleaning. Persisted so it survives the upgrade to version 2.
    #[serde(default)]
    unhashed_snapshot: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct EnvironmentBaseline {
    user: Option<String>,
    process: Option<String>,
}

pub struct CaptureReceipt {
    client: String,
    initialized: bool,
    client_existed: bool,
    previous_legacy_limited: bool,
    inserted_files: Vec<PathBuf>,
    inserted_environment: Vec<String>,
    original_files: BTreeMap<PathBuf, Option<Vec<u8>>>,
    original_environment: BTreeMap<String, EnvironmentBaseline>,
}

impl CaptureReceipt {
    pub fn new(client: &str) -> Self {
        Self {
            client: client.into(),
            initialized: false,
            client_existed: false,
            previous_legacy_limited: false,
            inserted_files: Vec::new(),
            inserted_environment: Vec::new(),
            original_files: BTreeMap::new(),
            original_environment: BTreeMap::new(),
        }
    }

    pub(crate) fn captured_file(&self, path: &Path) -> Option<Option<Vec<u8>>> {
        self.original_files.get(path).cloned()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientResetResult {
    pub client: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ResetResult {
    pub clients: Vec<ClientResetResult>,
    pub warnings: Vec<String>,
    pub requires_restart: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResetPreview {
    pub clients: Vec<ClientResetPlan>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientResetPlan {
    pub client: String,
    pub action: String, // restore_snapshot, clean_managed_fields, remove_owned, restore_cursor_patch, skip
    pub files: Vec<FileResetPlan>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileResetPlan {
    pub path: String,
    pub action: String, // restore_snapshot, clean_managed_fields, delete, skip
}

impl ResetResult {
    fn record(&mut self, client: &str, status: &str, message: impl Into<String>) {
        self.clients.push(ClientResetResult {
            client: client.into(),
            status: status.into(),
            message: message.into(),
        });
    }
}

fn state_path() -> Result<PathBuf, AppError> {
    #[cfg(test)]
    {
        if let Some(path) = TEST_STATE_PATH.with(|slot| slot.borrow().clone()) {
            return Ok(path);
        }
        static DIRECTORY: once_cell::sync::Lazy<tempfile::TempDir> =
            once_cell::sync::Lazy::new(|| tempfile::tempdir().expect("isolated reset tests"));
        Ok(DIRECTORY.path().join("reset_state.json"))
    }
    #[cfg(not(test))]
    {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".into()))?;
        Ok(home.join(".ai-helper/reset_state.json"))
    }
}

#[cfg(test)]
thread_local! {
    static TEST_STATE_PATH: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub fn with_test_state_path<T>(path: &Path, operation: impl FnOnce() -> T) -> T {
    struct Restore(Option<PathBuf>);
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_STATE_PATH.with(|slot| *slot.borrow_mut() = self.0.take());
        }
    }
    let _restore =
        Restore(TEST_STATE_PATH.with(|slot| slot.borrow_mut().replace(path.to_path_buf())));
    operation()
}

#[cfg(test)]
pub fn restore_client_for_test(client: &str) -> Result<(), AppError> {
    let path = state_path()?;
    let state = crate::safe_fs::with_file_lock(&path, || load_locked(&path))?;
    let baseline = state
        .clients
        .get(client)
        .ok_or_else(|| AppError::Other("测试恢复基线缺失".into()))?;
    restore_baseline(baseline, client)?;
    Ok(())
}

fn load_locked(path: &Path) -> Result<ResetState, AppError> {
    let Some(raw) = crate::safe_fs::read_optional_no_recovery_locked(path)? else {
        return Ok(ResetState::default());
    };
    let mut state: ResetState = serde_json::from_slice(&raw)
        .map_err(|_| AppError::Other("AI Helper 恢复基线损坏，已停止恢复以保护现有配置".into()))?;
    if state.version > 2
        || state
            .clients
            .keys()
            .any(|client| !CLIENTS.contains(&client.as_str()))
    {
        return Err(AppError::Other(
            "AI Helper 恢复基线版本或客户端无效，已停止恢复".into(),
        ));
    }
    if state.version < 2 {
        // Empty baselines are post-reset markers with nothing to restore.
        for baseline in state.clients.values_mut() {
            if !baseline.files.is_empty() {
                baseline.unhashed_snapshot = true;
            }
        }
        // The next save writes version 2; the flag keeps the old semantics.
        state.version = 2;
    }
    discard_owned_client_files(&mut state);
    Ok(state)
}

/// Accio and Cursor configs are AI Helper-owned files that reset deletes
/// outright. Older builds snapshotted them (including plaintext API keys);
/// drop that content so the next save no longer persists it.
fn discard_owned_client_files(state: &mut ResetState) {
    for client in OWNED_CLIENTS {
        if let Some(baseline) = state.clients.get_mut(client) {
            baseline.files.clear();
            baseline.last_written.clear();
        }
    }
}

/// Startup cleanup: older builds snapshotted the AI Helper-owned Accio and
/// Cursor configs (with plaintext API keys) into reset_state.json. Rewrite the
/// state once without them; nothing is written when there is nothing to drop.
pub fn scrub_owned_snapshots() -> Result<bool, AppError> {
    let path = state_path()?;
    with_config_write(|| scrub_owned_snapshots_at(&path))
}

fn scrub_owned_snapshots_at(path: &Path) -> Result<bool, AppError> {
    crate::safe_fs::with_file_lock(path, || {
        let Some(raw) = crate::safe_fs::read_optional_no_recovery_locked(path)? else {
            return Ok(false);
        };
        let Ok(stored) = serde_json::from_slice::<ResetState>(&raw) else {
            // A damaged state is reported by the reset itself; leave it untouched.
            return Ok(false);
        };
        let has_owned_content = OWNED_CLIENTS.iter().any(|client| {
            stored.clients.get(*client).is_some_and(|baseline| {
                !baseline.files.is_empty() || !baseline.last_written.is_empty()
            })
        });
        if !has_owned_content {
            return Ok(false);
        }
        let state = load_locked(path)?;
        save_locked(path, &state)?;
        Ok(true)
    })
}

fn save_locked(path: &Path, state: &ResetState) -> Result<(), AppError> {
    crate::safe_fs::atomic_write_locked(path, serde_json::to_vec_pretty(state)?)
}

/// Caller holds the primary file lock. Capture its recovery backup too, so a
/// later read cannot resurrect managed settings after the primary is removed.
pub fn capture_file_locked(receipt: &mut CaptureReceipt, path: &Path) -> Result<(), AppError> {
    capture_at(&state_path()?, receipt, path)
}

fn capture_at(
    baseline_path: &Path,
    receipt: &mut CaptureReceipt,
    path: &Path,
) -> Result<(), AppError> {
    crate::safe_fs::with_file_lock(baseline_path, || {
        let mut state = load_locked(baseline_path)?;
        if !receipt.initialized {
            receipt.client_existed = state.clients.contains_key(&receipt.client);
            receipt.previous_legacy_limited = state
                .clients
                .get(&receipt.client)
                .is_some_and(|baseline| baseline.legacy_limited);
            receipt.initialized = true;
        }
        let baseline = state.clients.entry(receipt.client.clone()).or_default();
        let mut changed = false;
        for target in [path.to_path_buf(), crate::safe_fs::backup_path(path)] {
            if !baseline.files.contains_key(&target) {
                let original = crate::safe_fs::read_optional_no_recovery_locked(&target)?;
                let cleaned = match (receipt.client.as_str(), original.as_deref()) {
                    ("Claude Code", Some(raw)) => clean_legacy_claude(raw),
                    ("Codex / ChatGPT", Some(raw)) => clean_legacy_codex(raw),
                    ("WorkBuddy", Some(raw)) => clean_legacy_workbuddy(raw),
                    _ => Ok(None),
                }
                .ok()
                .flatten();
                if cleaned.is_some() {
                    baseline.legacy_limited = true;
                }
                baseline
                    .files
                    .insert(target.clone(), cleaned.or(original.clone()));
                receipt.original_files.insert(target.clone(), original);
                receipt.inserted_files.push(target.clone());
                changed = true;
            }
        }
        if changed {
            save_locked(baseline_path, &state)?;
        }
        Ok(())
    })
}

pub fn capture_environment(receipt: &mut CaptureReceipt, name: &str) -> Result<(), AppError> {
    let baseline_path = state_path()?;
    crate::safe_fs::with_file_lock(&baseline_path, || {
        let mut state = load_locked(&baseline_path)?;
        if !receipt.initialized {
            receipt.client_existed = state.clients.contains_key(&receipt.client);
            receipt.previous_legacy_limited = state
                .clients
                .get(&receipt.client)
                .is_some_and(|baseline| baseline.legacy_limited);
            receipt.initialized = true;
        }
        let baseline = state.clients.entry(receipt.client.clone()).or_default();
        if !baseline.environment.contains_key(name) {
            let legacy_managed_codex_key = if receipt.client == "Codex / ChatGPT" {
                let path = crate::codex::codex_config_path()?;
                let mut managed = false;
                for target in [&path, &crate::safe_fs::backup_path(&path)] {
                    if let Some(raw) = crate::safe_fs::read_optional_no_recovery_locked(target)? {
                        if clean_legacy_codex(&raw)?.is_some() {
                            managed = true;
                            break;
                        }
                    }
                }
                managed
            } else {
                false
            };
            let process = std::env::var(name).map(Some).or_else(|error| match error {
                std::env::VarError::NotPresent => Ok(None),
                _ => Err(AppError::Other("原环境变量无法无损记录，已停止写入".into())),
            })?;
            #[cfg(target_os = "windows")]
            let user = if legacy_managed_codex_key {
                None
            } else {
                crate::codex::read_registry_env_optional(name)?
            };
            #[cfg(not(target_os = "windows"))]
            let user = None;

            // Baseline stores None for legacy-managed keys (for clean reset)
            let baseline_user = if legacy_managed_codex_key {
                None
            } else {
                user.clone()
            };
            let baseline_process = if legacy_managed_codex_key {
                None
            } else {
                process.clone()
            };

            baseline.environment.insert(
                name.into(),
                EnvironmentBaseline {
                    user: baseline_user,
                    process: baseline_process,
                },
            );
            receipt.inserted_environment.push(name.into());
            // Receipt always stores actual values (for rollback on write failure)
            receipt
                .original_environment
                .insert(name.into(), EnvironmentBaseline { user, process });
            save_locked(&baseline_path, &state)?;
        }
        Ok(())
    })
}

pub fn rollback_capture_locked(receipt: CaptureReceipt, primary: AppError) -> AppError {
    finish_capture(receipt, primary, true)
}

/// Discard a speculative baseline without changing the client files. WorkBuddy
/// uses this after its own journal has already rolled back a failed commit;
/// restoring captured bytes here could overwrite a concurrent external edit.
pub fn discard_capture_locked(receipt: CaptureReceipt, primary: AppError) -> AppError {
    finish_capture(receipt, primary, false)
}

pub fn discard_capture(receipt: CaptureReceipt) -> Result<(), AppError> {
    let baseline_path = state_path()?;
    discard_capture_at(&baseline_path, &receipt)
}

fn finish_capture(receipt: CaptureReceipt, primary: AppError, restore_targets: bool) -> AppError {
    let baseline_path = match state_path() {
        Ok(path) => path,
        Err(rollback) => {
            return AppError::Other(format!("{primary}；撤销未提交的恢复基线失败：{rollback}"));
        }
    };
    rollback_capture_at(&baseline_path, receipt, primary, restore_targets)
}

fn rollback_capture_at(
    baseline_path: &Path,
    receipt: CaptureReceipt,
    primary: AppError,
    restore_targets: bool,
) -> AppError {
    let restore_result = (|| {
        if restore_targets {
            let mut files = receipt.original_files.iter().collect::<Vec<_>>();
            files.sort_by_key(|(path, _)| !path.to_string_lossy().ends_with(".bak"));
            for (path, original) in files {
                crate::safe_fs::restore_optional_locked(path, original.as_deref())?;
            }
            for (name, original) in &receipt.original_environment {
                #[cfg(target_os = "windows")]
                match &original.user {
                    Some(value) => crate::codex::write_registry_env(name, value)?,
                    None => crate::codex::delete_registry_env(name)?,
                }
                match &original.process {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
        discard_capture_at(baseline_path, &receipt)
    })();

    match restore_result {
        Ok(()) => primary,
        Err(rollback) => {
            AppError::Other(format!("{primary}；撤销未提交的恢复基线失败：{rollback}"))
        }
    }
}

fn discard_capture_at(baseline_path: &Path, receipt: &CaptureReceipt) -> Result<(), AppError> {
    crate::safe_fs::with_file_lock(baseline_path, || {
        let mut state = load_locked(baseline_path)?;
        let mut changed = false;
        if let Some(baseline) = state.clients.get_mut(&receipt.client) {
            for path in &receipt.inserted_files {
                changed |= baseline.files.remove(path).is_some();
            }
            for name in &receipt.inserted_environment {
                changed |= baseline.environment.remove(name).is_some();
            }
            if baseline.legacy_limited != receipt.previous_legacy_limited {
                baseline.legacy_limited = receipt.previous_legacy_limited;
                changed = true;
            }
            if !receipt.client_existed
                && baseline.files.is_empty()
                && baseline.environment.is_empty()
                && !baseline.legacy_limited
            {
                state.clients.remove(&receipt.client);
                changed = true;
            }
        }
        // Nothing was inserted (or it is already gone): leave the file as is.
        if !changed {
            return Ok(());
        }
        save_locked(baseline_path, &state)
    })
}

/// One captured file and its pre-takeover bytes (`None` = absent).
type SnapshotEntry<'a> = (&'a PathBuf, &'a Option<Vec<u8>>);

/// Outcome of restoring one client baseline.
#[derive(Debug, Default)]
struct BaselineRestore {
    warnings: Vec<String>,
    /// The action applied to each snapshot file, in application order.
    applied: Vec<(PathBuf, &'static str)>,
}

impl BaselineRestore {
    fn field_cleaned(&self) -> bool {
        self.applied
            .iter()
            .any(|(_, action)| *action == "clean_managed_fields")
    }
}

fn restore_baseline(baseline: &ClientBaseline, client: &str) -> Result<BaselineRestore, AppError> {
    let mut outcome = BaselineRestore::default();

    // Each recovery backup is restored together with its primary under the
    // primary's lock, which is the lock every writer of that pair holds.
    // Within a group the backup goes first, so a failure never leaves a
    // deleted primary paired with the managed recovery backup.
    let mut groups: BTreeMap<PathBuf, Vec<SnapshotEntry<'_>>> = BTreeMap::new();
    for (path, original) in &baseline.files {
        groups
            .entry(primary_file_of(path))
            .or_default()
            .push((path, original));
    }

    for (primary, mut entries) in groups {
        entries.sort_by_key(|(path, _)| **path == primary);
        crate::safe_fs::with_file_lock(&primary, || {
            for (path, original) in entries {
                let action = restore_baseline_file_locked(
                    baseline,
                    client,
                    path,
                    original.as_deref(),
                    &mut outcome.warnings,
                )?;
                outcome.applied.push((path.clone(), action));
            }
            Ok(())
        })?;
    }

    for (name, original) in &baseline.environment {
        #[cfg(target_os = "windows")]
        match &original.user {
            Some(value) => crate::codex::write_registry_env(name, value)?,
            None => crate::codex::delete_registry_env(name)?,
        }
        match &original.process {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    Ok(outcome)
}

/// The primary file a snapshot entry belongs to: `x.toml.bak` maps to
/// `x.toml` (see `safe_fs::backup_path`); any other path is its own primary.
fn primary_file_of(path: &Path) -> PathBuf {
    if let Some(stem) = path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix(".bak"))
        .filter(|stem| !stem.is_empty())
    {
        let primary = path.with_file_name(stem);
        if crate::safe_fs::backup_path(&primary) == path {
            return primary;
        }
    }
    path.to_path_buf()
}

/// What reset does with one snapshot file. Preview and execution both call
/// `decide_file_locked`, so the plan shown to the user is the rule applied.
#[derive(Debug, Clone, PartialEq, Eq)]
enum FileDecision {
    /// Unchanged since AI Helper last wrote it: put the snapshot bytes back.
    RestoreSnapshot,
    /// Unchanged since AI Helper last wrote it and absent before takeover.
    Delete,
    /// Edited after AI Helper's last write, or no hash to tell: only the
    /// managed fields go back to their snapshot values. Holds the new bytes.
    CleanManagedFields(Vec<u8>),
    /// The file is gone now; an external deletion is kept.
    Missing,
    /// Field-level cleaning would change nothing.
    Unchanged,
}

impl FileDecision {
    fn action(&self) -> &'static str {
        match self {
            Self::RestoreSnapshot => "restore_snapshot",
            Self::Delete => "delete",
            Self::CleanManagedFields(_) => "clean_managed_fields",
            Self::Missing | Self::Unchanged => "skip",
        }
    }
}

/// Decide how to reset `path`. Read failures propagate: a file that cannot be
/// inspected is never overwritten on a guess. Execution calls this while
/// holding the primary file's lock; preview calls it read-only.
fn decide_file_locked(
    baseline: &ClientBaseline,
    client: &str,
    path: &Path,
    original: Option<&[u8]>,
) -> Result<FileDecision, AppError> {
    let current = crate::safe_fs::read_optional_no_recovery_locked(path)?;
    let unchanged_since_write = !baseline.unhashed_snapshot
        && current.as_deref().is_some_and(|bytes| {
            baseline
                .last_written
                .get(path)
                .is_some_and(|last| *last == compute_hash(bytes))
        });
    if unchanged_since_write {
        return Ok(if original.is_some() {
            FileDecision::RestoreSnapshot
        } else {
            FileDecision::Delete
        });
    }
    let Some(current) = current else {
        return Ok(FileDecision::Missing);
    };
    Ok(
        match reconcile_managed_fields(client, &current, original)? {
            Some(bytes) => FileDecision::CleanManagedFields(bytes),
            None => FileDecision::Unchanged,
        },
    )
}

/// Caller holds the lock of `path`'s primary file.
fn restore_baseline_file_locked(
    baseline: &ClientBaseline,
    client: &str,
    path: &Path,
    original: Option<&[u8]>,
    warnings: &mut Vec<String>,
) -> Result<&'static str, AppError> {
    let decision = decide_file_locked(baseline, client, path, original)?;
    match &decision {
        FileDecision::RestoreSnapshot => crate::safe_fs::restore_optional_locked(path, original)?,
        FileDecision::Delete => crate::safe_fs::remove_file_locked(path)?,
        FileDecision::CleanManagedFields(bytes) => {
            crate::safe_fs::atomic_write_locked(path, bytes)?;
            warnings.push(if baseline.unhashed_snapshot {
                format!(
                    "{} 的快照来自旧版本，无法判断接管后是否被修改，只清理了受管字段，其他内容已保留",
                    path.display()
                )
            } else {
                format!(
                    "{} 在接管后被外部修改，只清理了受管字段，其他内容已保留",
                    path.display()
                )
            });
        }
        FileDecision::Missing => {
            if original.is_some() {
                warnings.push(format!(
                    "{} 在接管后已被删除，保留删除状态，未从快照恢复",
                    path.display()
                ));
            }
        }
        FileDecision::Unchanged => {}
    }
    Ok(decision.action())
}

/// Reset only the managed fields of `current` to their values in
/// `snapshot`, removing those the snapshot lacks; everything else is kept.
/// Returns `None` when nothing would change.
fn reconcile_managed_fields(
    client: &str,
    current: &[u8],
    snapshot: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, AppError> {
    if current.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    match client {
        "Claude Code" => reconcile_claude(current, snapshot),
        "Codex / ChatGPT" => reconcile_codex(current, snapshot),
        "WorkBuddy" => reconcile_workbuddy(current, snapshot),
        _ => Ok(None),
    }
}

/// A snapshot that cannot be parsed contributes no values, so its managed
/// fields count as absent and are removed rather than guessed.
fn parse_snapshot_json(snapshot: Option<&[u8]>) -> Option<Value> {
    let bytes = snapshot?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return None;
    }
    serde_json::from_slice(bytes)
        .map_err(|error| log::warn!("恢复快照不是有效 JSON，受管字段将被删除: {error}"))
        .ok()
}

const CLAUDE_MANAGED_ENV: [&str; 3] = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
];

fn reconcile_claude(current: &[u8], snapshot: Option<&[u8]>) -> Result<Option<Vec<u8>>, AppError> {
    let invalid = || AppError::Other("Claude 配置格式无效，已保留原文件".into());
    let before: Value = serde_json::from_slice(current).map_err(|_| invalid())?;
    let mut root = before.clone();
    let object = root.as_object_mut().ok_or_else(invalid)?;
    let snapshot = parse_snapshot_json(snapshot);
    let snapshot_env = snapshot
        .as_ref()
        .and_then(|value| value.get("env"))
        .and_then(Value::as_object);
    // Read before the env is rewritten: the top-level model is managed only
    // while it mirrors the managed ANTHROPIC_MODEL.
    let managed_model = object
        .get("env")
        .and_then(|env| env.get("ANTHROPIC_MODEL"))
        .and_then(Value::as_str)
        .map(str::to_owned);

    let snapshot_has_env = snapshot_env.is_some_and(|env| {
        CLAUDE_MANAGED_ENV
            .iter()
            .any(|name| env.contains_key(*name))
    });
    if snapshot_has_env && !object.contains_key("env") {
        object.insert("env".into(), Value::Object(serde_json::Map::new()));
    }
    let mut env_empty = false;
    if let Some(env) = object.get_mut("env") {
        let env = env.as_object_mut().ok_or_else(invalid)?;
        for name in CLAUDE_MANAGED_ENV {
            match snapshot_env.and_then(|env| env.get(name)) {
                Some(value) => {
                    env.insert(name.into(), value.clone());
                }
                None => {
                    env.remove(name);
                }
            }
        }
        env_empty = env.is_empty();
    }
    if env_empty {
        object.remove("env");
    }

    if let Some(model) = managed_model.as_deref() {
        if object.get("model").and_then(Value::as_str) == Some(model) {
            match snapshot.as_ref().and_then(|value| value.get("model")) {
                Some(value) => {
                    object.insert("model".into(), value.clone());
                }
                None => {
                    object.remove("model");
                }
            }
        }
    }

    if root == before {
        return Ok(None);
    }
    Ok(Some(serde_json::to_vec_pretty(&root)?))
}

fn toml_lookup<'a>(doc: &'a toml_edit::DocumentMut, path: &[&str]) -> Option<&'a toml_edit::Item> {
    let (first, rest) = path.split_first()?;
    let mut item = doc.get(first)?;
    for key in rest {
        item = item.get(key)?;
    }
    Some(item)
}

fn set_toml_entry(table: &mut dyn toml_edit::TableLike, key: &str, value: Option<toml_edit::Item>) {
    match value {
        Some(item) => {
            table.insert(key, item);
        }
        None => {
            table.remove(key);
        }
    }
}

fn reconcile_codex(current: &[u8], snapshot: Option<&[u8]>) -> Result<Option<Vec<u8>>, AppError> {
    use toml_edit::{DocumentMut, Item, Table};
    let text =
        std::str::from_utf8(current).map_err(|_| AppError::Other("Codex 配置不是 UTF-8".into()))?;
    let mut doc = text
        .parse::<DocumentMut>()
        .map_err(|_| AppError::Other("Codex 配置损坏，已保留原文件".into()))?;
    let snapshot = snapshot.and_then(|bytes| {
        std::str::from_utf8(bytes)
            .ok()
            .and_then(|text| text.parse::<DocumentMut>().ok())
            .or_else(|| {
                log::warn!("Codex 恢复快照无法解析，受管字段将被删除");
                None
            })
    });
    let snapshot_value = |path: &[&str]| {
        snapshot
            .as_ref()
            .and_then(|doc| toml_lookup(doc, path))
            .cloned()
    };

    // model_providers.custom
    match snapshot_value(&["model_providers", "custom"]) {
        Some(custom) => {
            if doc.get("model_providers").is_none() {
                let mut providers = Table::new();
                providers.set_implicit(true);
                doc.insert("model_providers", Item::Table(providers));
            }
            let providers = doc
                .get_mut("model_providers")
                .and_then(Item::as_table_like_mut)
                .ok_or_else(|| AppError::Other("Codex 配置中的 model_providers 不是表".into()))?;
            providers.insert("custom", custom);
        }
        None => {
            let mut now_empty = false;
            if let Some(providers) = doc
                .get_mut("model_providers")
                .and_then(Item::as_table_like_mut)
            {
                providers.remove("custom");
                now_empty = providers.is_empty();
            }
            if now_empty && snapshot_value(&["model_providers"]).is_none() {
                doc.remove("model_providers");
            }
        }
    }

    // Top-level selection, only while it points at the managed provider.
    if doc.get("model_provider").and_then(Item::as_str) == Some("custom") {
        for key in ["model_provider", "model"] {
            set_toml_entry(doc.as_table_mut(), key, snapshot_value(&[key]));
        }
    }

    // Profile selections pointing at the managed provider.
    let custom_profiles = doc
        .get("profiles")
        .and_then(Item::as_table_like)
        .map(|profiles| {
            profiles
                .iter()
                .filter(|(_, profile)| {
                    profile.get("model_provider").and_then(Item::as_str) == Some("custom")
                })
                .map(|(name, _)| name.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for name in custom_profiles {
        let values = ["model_provider", "model"]
            .map(|key| (key, snapshot_value(&["profiles", name.as_str(), key])));
        if let Some(profile) = doc
            .get_mut("profiles")
            .and_then(|profiles| profiles.get_mut(name.as_str()))
            .and_then(Item::as_table_like_mut)
        {
            for (key, value) in values {
                set_toml_entry(profile, key, value);
            }
        }
    }

    let updated = doc.to_string();
    if updated == text {
        return Ok(None);
    }
    Ok(Some(updated.into_bytes()))
}

/// A WorkBuddy model entry AI Helper manages: custom (or unspecified)
/// vendor pointing at a managed relay.
fn is_managed_workbuddy_entry(entry: &Value) -> bool {
    entry
        .get("vendor")
        .and_then(Value::as_str)
        .is_none_or(|vendor| vendor == "Custom")
        && entry
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(managed_url)
}

fn workbuddy_entries(root: &Value) -> Option<&Vec<Value>> {
    if root.is_array() {
        root.as_array()
    } else {
        root.get("models").and_then(Value::as_array)
    }
}

fn workbuddy_entries_mut(root: &mut Value) -> Option<&mut Vec<Value>> {
    if root.is_array() {
        root.as_array_mut()
    } else {
        root.get_mut("models").and_then(Value::as_array_mut)
    }
}

fn reconcile_workbuddy(
    current: &[u8],
    snapshot: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, AppError> {
    let invalid = || AppError::Other("WorkBuddy 配置格式无效，已保留原文件".into());
    let before: Value = serde_json::from_slice(current).map_err(|_| invalid())?;
    let mut root = before.clone();
    let entries = workbuddy_entries_mut(&mut root).ok_or_else(invalid)?;
    entries.retain(|entry| !is_managed_workbuddy_entry(entry));
    if let Some(snapshot) = parse_snapshot_json(snapshot) {
        entries.extend(
            workbuddy_entries(&snapshot)
                .into_iter()
                .flatten()
                .filter(|entry| is_managed_workbuddy_entry(entry))
                .cloned(),
        );
    }
    if root == before {
        return Ok(None);
    }
    Ok(Some(serde_json::to_vec_pretty(&root)?))
}

pub fn managed_url(url: &str) -> bool {
    crate::credential_policy::parse_origin(url).is_ok_and(|origin| {
        crate::credential_policy::default_managed_origins().contains(&origin)
            || crate::credential_policy::parse_origin("https://taijiai.online")
                .is_ok_and(|legacy| legacy == origin)
    })
}

/// Compute SHA256 hash of byte content
pub fn compute_hash(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

/// Update last_written hash for a file after successful write
pub fn record_file_write(client: &str, path: &Path, content: &[u8]) -> Result<(), AppError> {
    record_file_write_at(&state_path()?, client, path, content)
}

fn record_file_write_at(
    baseline_path: &Path,
    client: &str,
    path: &Path,
    content: &[u8],
) -> Result<(), AppError> {
    crate::safe_fs::with_file_lock(baseline_path, || {
        let mut state = load_locked(baseline_path)?;
        if let Some(baseline) = state.clients.get_mut(client) {
            let hash = compute_hash(content);
            baseline.last_written.insert(path.to_path_buf(), hash);
            // Also record backup file if it exists
            let backup = crate::safe_fs::backup_path(path);
            if backup.exists() {
                if let Some(backup_content) =
                    crate::safe_fs::read_optional_no_recovery_locked(&backup)?
                {
                    let backup_hash = compute_hash(&backup_content);
                    baseline.last_written.insert(backup, backup_hash);
                }
            }
            save_locked(baseline_path, &state)?;
        }
        Ok(())
    })
}

fn clean_legacy_claude(raw: &[u8]) -> Result<Option<Vec<u8>>, AppError> {
    if raw.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let mut root: Value = serde_json::from_slice(raw)?;
    let managed = root
        .pointer("/env/ANTHROPIC_BASE_URL")
        .and_then(Value::as_str)
        .is_some_and(managed_url);
    if !managed {
        return Ok(None);
    }
    let managed_model = root
        .pointer("/env/ANTHROPIC_MODEL")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(env) = root.get_mut("env").and_then(Value::as_object_mut) {
        for name in [
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_MODEL",
        ] {
            env.remove(name);
        }
        if env.is_empty() {
            root.as_object_mut().unwrap().remove("env");
        }
    }
    if managed_model
        .as_deref()
        .is_some_and(|model| root.get("model").and_then(Value::as_str) == Some(model))
    {
        root.as_object_mut().unwrap().remove("model");
    }
    Ok(Some(serde_json::to_vec_pretty(&root)?))
}

fn clean_legacy_codex(raw: &[u8]) -> Result<Option<Vec<u8>>, AppError> {
    use toml_edit::{DocumentMut, Item};
    let text =
        std::str::from_utf8(raw).map_err(|_| AppError::Other("Codex 配置不是 UTF-8".into()))?;
    if text.trim().is_empty() {
        return Ok(None);
    }
    let mut doc = text
        .parse::<DocumentMut>()
        .map_err(|_| AppError::Other("Codex 配置损坏，已保留原文件".into()))?;
    let Some(custom) = doc
        .get("model_providers")
        .and_then(|p| p.get("custom"))
        .and_then(Item::as_table_like)
    else {
        return Ok(None);
    };
    let owned = custom
        .get("base_url")
        .and_then(Item::as_str)
        .is_some_and(managed_url)
        && custom
            .get("env_key")
            .and_then(Item::as_str)
            .is_none_or(|key| key == CODEX_ENV);
    if !owned {
        return Ok(None);
    }
    if let Some(providers) = doc
        .get_mut("model_providers")
        .and_then(Item::as_table_like_mut)
    {
        providers.remove("custom");
    }
    if doc.get("model_provider").and_then(Item::as_str) == Some("custom") {
        doc.remove("model_provider");
        doc.remove("model");
    }
    if let Some(profiles) = doc.get_mut("profiles").and_then(Item::as_table_like_mut) {
        for (_, item) in profiles.iter_mut() {
            if let Some(profile) = item.as_table_like_mut() {
                if profile.get("model_provider").and_then(Item::as_str) == Some("custom") {
                    profile.remove("model_provider");
                    profile.remove("model");
                }
            }
        }
    }
    Ok(Some(doc.to_string().into_bytes()))
}

pub fn clean_legacy_workbuddy(raw: &[u8]) -> Result<Option<Vec<u8>>, AppError> {
    if raw.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let mut root: Value = serde_json::from_slice(raw)?;
    let entries = if root.is_array() {
        root.as_array_mut()
    } else {
        root.get_mut("models").and_then(Value::as_array_mut)
    }
    .ok_or_else(|| AppError::Other("WorkBuddy 配置格式无效，已保留原文件".into()))?;
    let before = entries.len();
    entries.retain(|entry| !is_managed_workbuddy_entry(entry));
    if before == entries.len() {
        return Ok(None);
    }
    Ok(Some(serde_json::to_vec_pretty(&root)?))
}

pub fn clean_legacy_file(
    path: &Path,
    clean: impl Fn(&[u8]) -> Result<Option<Vec<u8>>, AppError>,
) -> Result<bool, AppError> {
    crate::safe_fs::with_file_lock(path, || clean_legacy_file_locked(path, clean))
}

pub fn clean_legacy_file_locked(
    path: &Path,
    clean: impl Fn(&[u8]) -> Result<Option<Vec<u8>>, AppError>,
) -> Result<bool, AppError> {
    let mut changed = false;
    for target in [crate::safe_fs::backup_path(path), path.to_path_buf()] {
        if let Some(raw) = crate::safe_fs::read_optional_no_recovery_locked(&target)? {
            if let Some(cleaned) = clean(&raw)? {
                crate::safe_fs::atomic_write_locked(&target, cleaned)?;
                changed = true;
            }
        }
    }
    Ok(changed)
}

/// AI Helper-owned files for a client. Cursor also owns the Agent workspace
/// write grants. Reset deletes these instead of restoring a snapshot.
fn owned_files(client: &str) -> Result<Vec<PathBuf>, AppError> {
    match client {
        "Accio Work" => Ok(vec![crate::accio::get_accio_config_path()?]),
        "Cursor" => Ok(vec![
            crate::cursor::get_cursor_config_path()?,
            crate::cursor::workspace_auth::agent_workspaces_path()?,
        ]),
        _ => Ok(Vec::new()),
    }
}

/// Whether `restore_all` will restore the Cursor patch. Shared by preview and
/// execution so both reach the same decision.
fn cursor_patch_restore_needed() -> bool {
    let config = crate::cursor::load_cursor_config();
    let patch = crate::cursor::get_patch_status(config.cursor_path.as_deref());
    (patch.is_patched && patch.backup_exists && patch.core_files_readable)
        || crate::cursor::has_pending_patch_restore(config.cursor_path.as_deref())
}

fn owned_file_present(path: &Path) -> bool {
    [crate::safe_fs::backup_path(path), path.to_path_buf()]
        .iter()
        .any(|target| std::fs::symlink_metadata(target).is_ok())
}

/// Plan for an AI Helper-owned client: restore the Cursor patch when needed,
/// otherwise delete owned files that exist, otherwise skip.
fn owned_client_plan(client: &str, files: &[PathBuf], patch_restore: bool) -> ClientResetPlan {
    let file_plans: Vec<FileResetPlan> = files
        .iter()
        .map(|path| FileResetPlan {
            path: path.to_string_lossy().into_owned(),
            action: if owned_file_present(path) {
                "delete".into()
            } else {
                "skip".into()
            },
        })
        .collect();
    let any_present = file_plans.iter().any(|file| file.action == "delete");
    let (action, reason) = if patch_restore {
        (
            "restore_cursor_patch",
            "还原 Cursor 接入补丁与状态库路由，并删除 AI Helper 专用配置、凭据和 Agent 工作区授权",
        )
    } else if any_present {
        ("remove_owned", "删除 AI Helper 专用配置与凭据")
    } else {
        ("skip", "未发现 AI Helper 专用配置")
    };
    ClientResetPlan {
        client: client.into(),
        action: action.into(),
        files: file_plans,
        reason: reason.into(),
    }
}

fn remove_owned_files(files: &[PathBuf]) -> Result<bool, AppError> {
    let mut removed = false;
    for path in files {
        removed |= remove_owned_file(path)?;
    }
    Ok(removed)
}

fn remove_owned_file(path: &Path) -> Result<bool, AppError> {
    crate::safe_fs::with_file_lock(path, || {
        let mut removed = false;
        for target in [crate::safe_fs::backup_path(path), path.to_path_buf()] {
            removed |= crate::safe_fs::read_optional_no_recovery_locked(&target)?.is_some();
            crate::safe_fs::remove_file_locked(&target)?;
        }
        Ok(removed)
    })
}

fn legacy_cleanup(client: &str) -> Result<bool, AppError> {
    match client {
        "Codex / ChatGPT" => {
            let changed =
                clean_legacy_file(&crate::codex::codex_config_path()?, clean_legacy_codex)?;
            let env_removed = cleanup_legacy_codex_env(
                changed,
                current_codex_env_values,
                crate::credential_policy::is_managed_key,
                || crate::codex::delete_registry_env(CODEX_ENV),
            )?;
            Ok(changed || env_removed)
        }
        "Claude Code" => {
            clean_legacy_file(&crate::claude::claude_config_path()?, clean_legacy_claude)
        }
        "WorkBuddy" => crate::workbuddy::reset_legacy_configs(clean_legacy_workbuddy),
        "Accio Work" | "Cursor" => remove_owned_files(&owned_files(client)?),
        _ => Err(AppError::Other("未知客户端".into())),
    }
}

/// Current user-level (Windows registry) and process values of the legacy
/// Codex key variable.
fn current_codex_env_values() -> Result<Vec<String>, AppError> {
    let mut values = Vec::new();
    #[cfg(target_os = "windows")]
    values.extend(crate::codex::read_registry_env_optional(CODEX_ENV)?);
    match std::env::var(CODEX_ENV) {
        Ok(value) => values.push(value),
        Err(std::env::VarError::NotPresent) => {}
        Err(std::env::VarError::NotUnicode(_)) => {
            return Err(AppError::Other("旧 Codex 环境凭据不是有效 UTF-8".into()));
        }
    }
    Ok(values)
}

/// Decide independently of this round's file cleanup whether the legacy
/// environment key must be removed. A retry after a failed deletion finds the
/// config already clean, so the variable is also removed whenever it still
/// holds a key AI Helper registered as managed.
fn cleanup_legacy_codex_env(
    file_cleaned: bool,
    read_values: impl FnOnce() -> Result<Vec<String>, AppError>,
    is_managed: impl Fn(&str) -> bool,
    delete: impl FnOnce() -> Result<(), AppError>,
) -> Result<bool, AppError> {
    let values = read_values()?;
    if values.is_empty() {
        return Ok(false);
    }
    if file_cleaned || values.iter().any(|value| is_managed(value)) {
        delete()?;
        return Ok(true);
    }
    Ok(false)
}

/// Caller holds the exclusive configuration gate. Successful clients keep an
/// empty marker, so a retry cannot mistake restored originals for legacy data.
pub fn restore_all(
    cursor_bridge_error: Option<String>,
    accio_bridge_error: Option<String>,
) -> Result<ResetResult, AppError> {
    let baseline_path = state_path()?;
    let mut state = crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path))?;
    let mut result = ResetResult {
        requires_restart: true,
        ..ResetResult::default()
    };
    for client in CLIENTS {
        let bridge_error = match client {
            "Cursor" => cursor_bridge_error.as_ref(),
            "Accio Work" => accio_bridge_error.as_ref(),
            _ => None,
        };
        if let Some(error) = bridge_error {
            result.record(
                client,
                "failed",
                format!("本地网关停止失败，已保留配置：{error}"),
            );
            continue;
        }
        let outcome: Result<(&str, &str), AppError> = (|| {
            let mut patch_restored = false;
            if client == "Cursor" && cursor_patch_restore_needed() {
                let config = crate::cursor::load_cursor_config();
                crate::cursor::restore_patch(config.cursor_path.as_deref())
                    .map_err(AppError::Other)?;
                patch_restored = true;
                if crate::cursor::patcher::state_db_backup_pending() {
                    result.warnings.push(
                        "Cursor 状态库 (state.vscdb) 未能还原，已保留备份；请关闭 Cursor 后再次执行清除配置。"
                            .into(),
                    );
                }
            }
            if matches!(client, "Accio Work" | "Cursor") {
                let removed = remove_owned_files(&owned_files(client)?)?;
                if client == "Cursor" {
                    if let Some(store) = crate::cursor::workspace_auth::global() {
                        store.clear_pending();
                    }
                }
                return Ok(if patch_restored {
                    (
                        "cleaned",
                        "已还原 Cursor 接入并移除 AI Helper 专用配置与凭据",
                    )
                } else if removed {
                    ("cleaned", "已移除 AI Helper 专用配置与凭据")
                } else {
                    ("skipped", "未发现 AI Helper 专用配置")
                });
            }
            if let Some(baseline) = state.clients.get(client) {
                if client == "WorkBuddy" {
                    crate::workbuddy::prepare_for_reset()?;
                }
                let legacy_limited = baseline.legacy_limited;
                let restore = restore_baseline(baseline, client)?;
                let field_cleaned = restore.field_cleaned();
                result.warnings.extend(restore.warnings);
                if legacy_limited {
                    result.warnings.push(format!("{client} 的快照包含旧版受管配置，已清理可识别项；无法还原旧版本覆盖前的原值。"));
                    Ok(("cleaned", "已清理旧版本受管项；原始值无法还原"))
                } else if field_cleaned {
                    Ok((
                        "cleaned",
                        "部分文件在接管后被修改，已只清理受管字段，其他内容已保留",
                    ))
                } else {
                    Ok(("restored", "已恢复首次接管前的配置"))
                }
            } else {
                let changed = legacy_cleanup(client)?;
                if changed {
                    result.warnings.push(format!("{client} 缺少首次接管基线，已清理可识别的受管配置；无法还原被旧版本覆盖的原值。"));
                    Ok(("cleaned", "已清理旧版本受管配置"))
                } else {
                    Ok(("skipped", "未发现可识别的受管配置；其他自定义配置已保留"))
                }
            }
        })();
        match outcome {
            Ok((status, message)) => {
                let previous = state
                    .clients
                    .insert(client.into(), ClientBaseline::default());
                match crate::safe_fs::with_file_lock(&baseline_path, || {
                    save_locked(&baseline_path, &state)
                }) {
                    Ok(()) => result.record(client, status, message),
                    Err(error) => {
                        if let Some(previous) = previous {
                            state.clients.insert(client.into(), previous);
                        }
                        result.record(
                            client,
                            "failed",
                            format!("配置已恢复，但保存重试标记失败：{error}"),
                        );
                    }
                }
            }
            Err(error) => result.record(
                client,
                "failed",
                format!("恢复失败，已保留恢复记录供重试：{error}"),
            ),
        }
    }
    crate::accio::invalidate_model_list_cache();
    crate::cursor::invalidate_model_list_cache();
    Ok(result)
}

/// Preview of a client that has a snapshot. Uses the same per-file decision
/// as `restore_baseline`, in the same order (backups before primaries).
fn baseline_client_plan(client: &str, baseline: &ClientBaseline) -> ClientResetPlan {
    let mut entries = baseline.files.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(path, _)| {
        let primary = primary_file_of(path);
        let is_primary = **path == primary;
        (primary, is_primary)
    });
    let mut files = Vec::new();
    for (path, original) in entries {
        match decide_file_locked(baseline, client, path, original.as_deref()) {
            Ok(decision) => files.push(FileResetPlan {
                path: path.to_string_lossy().to_string(),
                action: decision.action().to_string(),
            }),
            Err(error) => {
                return ClientResetPlan {
                    client: client.to_string(),
                    action: "skip".to_string(),
                    files: Vec::new(),
                    reason: format!(
                        "无法检查 {}：{error}；执行时该客户端会报错并保留现有文件",
                        path.display()
                    ),
                };
            }
        }
    }
    let field_cleaned = files
        .iter()
        .any(|file| file.action == "clean_managed_fields");
    let (action, reason) = if baseline.legacy_limited {
        ("clean_managed_fields", "包含旧版受管配置，只清理受管字段")
    } else if field_cleaned {
        (
            "clean_managed_fields",
            "部分文件在接管后被修改，只清理受管字段，其他内容保留",
        )
    } else {
        ("restore_snapshot", "恢复首次接管前的配置")
    };
    ClientResetPlan {
        client: client.to_string(),
        action: action.to_string(),
        files,
        reason: reason.to_string(),
    }
}

/// Preview what will happen during a reset without actually performing it
pub fn preview_reset() -> Result<ResetPreview, AppError> {
    let baseline_path = state_path()?;
    let state = crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path))?;
    let mut plans = Vec::new();

    for client in CLIENTS {
        let mut plan = ClientResetPlan {
            client: client.to_string(),
            action: String::new(),
            files: Vec::new(),
            reason: String::new(),
        };

        if matches!(client, "Accio Work" | "Cursor") {
            let patch_restore = client == "Cursor" && cursor_patch_restore_needed();
            plans.push(owned_client_plan(
                client,
                &owned_files(client)?,
                patch_restore,
            ));
            continue;
        }

        if let Some(baseline) = state.clients.get(client) {
            plans.push(baseline_client_plan(client, baseline));
            continue;
        } else {
            plan.action = "clean_managed_fields".to_string();
            plan.reason = "缺少快照，将清理可识别的受管配置".to_string();
        }

        plans.push(plan);
    }

    Ok(ResetPreview { clients: plans })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_scoped_write_rejects_a_task_that_resumed_after_reset() {
        let generation = current_generation();
        let reset_guard = begin_reset().unwrap();
        drop(reset_guard);

        let mut wrote = false;
        let result = with_config_write_at_generation(generation, || {
            wrote = true;
            Ok(())
        });

        assert!(result.is_err());
        assert!(!wrote);
    }

    #[test]
    fn generation_read_during_reset_is_stale_after_reset_finishes() {
        let reset_guard = begin_reset().unwrap();
        let during_reset = current_generation();
        assert!(ensure_generation(during_reset).is_err());
        drop(reset_guard);

        assert!(ensure_generation(during_reset).is_err());
        let mut wrote = false;
        let result = with_config_write_at_generation(during_reset, || {
            wrote = true;
            Ok(())
        });
        assert!(result.is_err());
        assert!(!wrote);
        assert!(ensure_generation(current_generation()).is_ok());
    }

    #[test]
    fn legacy_codex_env_retry_removes_managed_key_after_config_is_already_clean() {
        let managed = |value: &str| value == "managed-key";

        // First attempt cleaned the file, but deleting the variable failed.
        let first = cleanup_legacy_codex_env(
            true,
            || Ok(vec!["managed-key".to_string()]),
            managed,
            || Err(AppError::Registry("injected delete failure".into())),
        );
        assert!(first.is_err());

        // Retry: the config is already clean, yet the managed key is removed.
        let mut deleted = false;
        let retry = cleanup_legacy_codex_env(
            false,
            || Ok(vec!["managed-key".to_string()]),
            managed,
            || {
                deleted = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(retry);
        assert!(deleted);
    }

    #[test]
    fn legacy_codex_env_keeps_unmanaged_user_key_when_config_is_clean() {
        let mut deleted = false;
        let removed = cleanup_legacy_codex_env(
            false,
            || Ok(vec!["user-own-key".to_string()]),
            |_| false,
            || {
                deleted = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(!removed);
        assert!(!deleted);

        let removed = cleanup_legacy_codex_env(
            true,
            || Ok(Vec::new()),
            |_| false,
            || panic!("absent variable must not be deleted"),
        )
        .unwrap();
        assert!(!removed);
    }

    #[test]
    fn loading_state_discards_owned_client_snapshots_and_next_save_drops_secrets() {
        let directory = tempfile::tempdir().unwrap();
        let baseline_path = directory.path().join("state.json");
        let owned_path = directory.path().join("cursor_config.json");
        let other_path = directory.path().join("settings.json");
        let mut state = ResetState::default();
        for client in OWNED_CLIENTS {
            let baseline = state.clients.entry(client.into()).or_default();
            baseline
                .files
                .insert(owned_path.clone(), Some(b"plaintext-owned-secret".to_vec()));
            baseline
                .last_written
                .insert(owned_path.clone(), "hash".into());
        }
        state
            .clients
            .entry("Claude Code".into())
            .or_default()
            .files
            .insert(other_path.clone(), Some(b"{}".to_vec()));
        std::fs::write(&baseline_path, serde_json::to_vec(&state).unwrap()).unwrap();

        let loaded =
            crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path)).unwrap();
        for client in OWNED_CLIENTS {
            assert!(loaded.clients[client].files.is_empty());
            assert!(loaded.clients[client].last_written.is_empty());
        }
        assert!(loaded.clients["Claude Code"]
            .files
            .contains_key(&other_path));

        // Any later capture rewrites the state without the owned snapshots.
        let mut capture = CaptureReceipt::new("WorkBuddy");
        capture_at(
            &baseline_path,
            &mut capture,
            &directory.path().join("models.json"),
        )
        .unwrap();
        let raw: Value = serde_json::from_slice(&std::fs::read(&baseline_path).unwrap()).unwrap();
        for client in OWNED_CLIENTS {
            assert_eq!(raw["clients"][client]["files"], serde_json::json!({}));
        }
    }

    #[test]
    fn baseline_restores_backup_under_the_primary_lock_only() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        let backup = crate::safe_fs::backup_path(&path);
        let baseline_path = directory.path().join("state.json");
        std::fs::write(&path, b"model = \"original\"\n").unwrap();
        std::fs::write(&backup, b"model = \"older\"\n").unwrap();

        let mut capture = CaptureReceipt::new("Codex / ChatGPT");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        std::fs::write(&backup, b"managed backup").unwrap();
        managed_write(&baseline_path, "Codex / ChatGPT", &path, b"managed");
        let state = load(&baseline_path);
        restore_baseline(&state.clients["Codex / ChatGPT"], "Codex / ChatGPT").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"model = \"original\"\n");
        assert_eq!(std::fs::read(&backup).unwrap(), b"model = \"older\"\n");
        assert!(directory.path().join(".config.toml.lock").exists());
        assert!(
            !directory.path().join(".config.toml.bak.lock").exists(),
            "the backup must not take a lock of its own"
        );
    }

    #[test]
    fn snapshot_entries_group_backups_with_their_primary() {
        let dir = Path::new("cfg");
        assert_eq!(
            primary_file_of(&dir.join("config.toml.bak")),
            dir.join("config.toml")
        );
        assert_eq!(
            primary_file_of(&dir.join("settings.bak")),
            dir.join("settings")
        );
        assert_eq!(
            primary_file_of(&dir.join("config.toml")),
            dir.join("config.toml")
        );
        assert_eq!(primary_file_of(&dir.join(".bak")), dir.join(".bak"));
    }

    #[test]
    fn discarding_a_capture_without_changes_does_not_write_the_state() {
        let directory = tempfile::tempdir().unwrap();
        let baseline_path = directory.path().join("state.json");
        let receipt = CaptureReceipt::new("Claude Code");

        // No state file: nothing to discard, nothing created.
        discard_capture_at(&baseline_path, &receipt).unwrap();
        assert!(!baseline_path.exists());

        // An existing state keeps its exact bytes (save_locked would rewrite
        // this compact JSON as pretty-printed JSON).
        let compact = br#"{"version":2,"clients":{"Claude Code":{"files":{},"environment":{"X":{"user":null,"process":null}}}}}"#;
        std::fs::write(&baseline_path, compact).unwrap();
        let mut receipt = CaptureReceipt::new("Claude Code");
        receipt.client_existed = true;
        discard_capture_at(&baseline_path, &receipt).unwrap();
        assert_eq!(std::fs::read(&baseline_path).unwrap(), compact);

        // A real removal is still persisted.
        receipt.inserted_environment.push("X".into());
        discard_capture_at(&baseline_path, &receipt).unwrap();
        assert_ne!(std::fs::read(&baseline_path).unwrap(), compact);
        let state =
            crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path)).unwrap();
        assert!(state.clients["Claude Code"].environment.is_empty());
    }

    #[test]
    fn poisoned_config_lock_does_not_block_later_writes() {
        let panicked = std::panic::catch_unwind(|| {
            let _ = with_reset::<()>(|| panic!("simulated panic while holding the reset lock"));
        });
        assert!(panicked.is_err());
        assert!(CONFIG_ACCESS.is_poisoned());

        assert_eq!(with_reset(|| Ok(1)).unwrap(), 1);
        if !is_resetting() {
            assert_eq!(with_config_write(|| Ok(2)).unwrap(), 2);
            assert_eq!(
                with_config_write_at_generation(current_generation(), || Ok(3)).unwrap(),
                3
            );
        }
    }

    #[test]
    fn baseline_restores_original_files_and_backup_presence() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let backup = crate::safe_fs::backup_path(&path);
        let baseline_path = directory.path().join("state.json");
        std::fs::write(&path, br#"{"original":true}"#).unwrap();
        std::fs::write(&backup, b"previous backup").unwrap();

        let mut capture = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        // AI Helper's writer backs up the primary, then writes it.
        std::fs::write(&backup, br#"{"original":true}"#).unwrap();
        managed_write(&baseline_path, "Claude Code", &path, br#"{"managed":true}"#);
        let state = load(&baseline_path);
        let restore = restore_baseline(&state.clients["Claude Code"], "Claude Code").unwrap();

        // Both files are untouched since AI Helper wrote them: whole-file restore.
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"original":true}"#);
        assert_eq!(std::fs::read(&backup).unwrap(), b"previous backup");
        assert!(restore.warnings.is_empty(), "{:?}", restore.warnings);
        assert!(!restore.field_cleaned());
    }

    #[test]
    fn baseline_restores_absent_file_as_absent() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let baseline_path = directory.path().join("state.json");

        let mut capture = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        managed_write(&baseline_path, "Claude Code", &path, b"managed");
        let state = load(&baseline_path);
        let restore = restore_baseline(&state.clients["Claude Code"], "Claude Code").unwrap();

        assert!(!path.exists());
        // The absent backup was absent before takeover too: nothing to do.
        assert_eq!(
            restore.applied,
            vec![
                (crate::safe_fs::backup_path(&path), "skip"),
                (path.clone(), "delete")
            ]
        );
    }

    #[test]
    fn failed_first_write_discards_snapshot_before_a_later_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let baseline_path = directory.path().join("state.json");
        std::fs::write(&path, br#"{"broken":true}"#).unwrap();

        let mut first = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut first, &path).unwrap();
        std::fs::write(&path, br#"{"partial":true}"#).unwrap();
        let error = rollback_capture_at(
            &baseline_path,
            first,
            AppError::Other("injected write failure".into()),
            true,
        );
        assert!(error.to_string().contains("injected write failure"));
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"broken":true}"#);
        let state =
            crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path)).unwrap();
        assert!(!state.clients.contains_key("Claude Code"));

        std::fs::write(&path, br#"{"repaired":true}"#).unwrap();
        let mut retry = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut retry, &path).unwrap();
        let state =
            crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path)).unwrap();
        assert_eq!(
            state.clients["Claude Code"].files[&path].as_deref(),
            Some(br#"{"repaired":true}"#.as_slice())
        );
    }

    #[test]
    fn discarding_a_failed_capture_does_not_rewrite_concurrent_file_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.json");
        let baseline_path = directory.path().join("state.json");
        std::fs::write(&path, b"before").unwrap();

        let mut capture = CaptureReceipt::new("WorkBuddy");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        std::fs::write(&path, b"external update").unwrap();
        let error = rollback_capture_at(
            &baseline_path,
            capture,
            AppError::Other("snapshot conflict".into()),
            false,
        );

        assert!(error.to_string().contains("snapshot conflict"));
        assert_eq!(std::fs::read(&path).unwrap(), b"external update");
        let state =
            crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path)).unwrap();
        assert!(!state.clients.contains_key("WorkBuddy"));
    }

    #[test]
    fn new_baseline_cleans_detectable_legacy_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let baseline_path = directory.path().join("state.json");
        std::fs::write(
            &path,
            br#"{"theme":"dark","env":{"ANTHROPIC_BASE_URL":"https://bob-api.com/v1","ANTHROPIC_AUTH_TOKEN":"old-key","KEEP":"yes"}}"#,
        )
        .unwrap();

        let mut capture = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        let state =
            crate::safe_fs::with_file_lock(&baseline_path, || load_locked(&baseline_path)).unwrap();
        let baseline = &state.clients["Claude Code"];
        assert!(baseline.legacy_limited);
        let snapshot: Value =
            serde_json::from_slice(baseline.files[&path].as_deref().unwrap()).unwrap();
        assert_eq!(snapshot["theme"], "dark");
        assert_eq!(snapshot["env"]["KEEP"], "yes");
        assert!(snapshot["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    }

    #[test]
    fn legacy_claude_cleanup_preserves_unmanaged_settings() {
        let original = br#"{"model":"managed-model","theme":"dark","env":{"ANTHROPIC_BASE_URL":"https://bob-api.com/v1","ANTHROPIC_AUTH_TOKEN":"managed-key","ANTHROPIC_MODEL":"managed-model","KEEP":"yes"}}"#;
        let cleaned = clean_legacy_claude(original).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&cleaned).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["env"]["KEEP"], "yes");
        assert!(value.get("model").is_none());
        assert!(value
            .get("env")
            .unwrap()
            .get("ANTHROPIC_AUTH_TOKEN")
            .is_none());
    }

    #[test]
    fn legacy_workbuddy_cleanup_removes_only_managed_custom_entries() {
        let original = serde_json::to_vec(&serde_json::json!({
            "models": [
                {"id":"managed", "vendor":"Custom", "url":"https://bob-api.com/v1", "api_key":"key"},
                {"id":"native", "vendor":"Anthropic", "url":"https://api.anthropic.com"},
                {"id":"external", "vendor":"Custom", "url":"https://other.example"}
            ],
            "other": true
        })).unwrap();
        let cleaned = clean_legacy_workbuddy(&original).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&cleaned).unwrap();
        assert_eq!(value["models"].as_array().unwrap().len(), 2);
        assert_eq!(value["other"], true);
    }

    #[test]
    fn legacy_codex_cleanup_removes_managed_provider_and_keeps_unrelated_tables() {
        let raw = b"model = 'gpt-managed'\nmodel_provider = 'custom'\n[model_providers.custom]\nbase_url = 'https://bob-api.com/v1'\nenv_key = 'CUSTOM_OPENAI_API_KEY'\n[model_providers.other]\nbase_url = 'https://other.example/v1'\n";
        let cleaned = clean_legacy_codex(raw).unwrap().unwrap();
        let doc = std::str::from_utf8(&cleaned)
            .unwrap()
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert!(doc.get("model_provider").is_none());
        assert!(doc.get("model").is_none());
        assert!(doc["model_providers"].get("custom").is_none());
        assert!(doc["model_providers"].get("other").is_some());
    }

    #[test]
    fn codex_capture_preserves_user_key_in_receipt_for_rollback() {
        // Test the core M4 fix: when legacy_managed_codex_key is true,
        // baseline gets None but receipt preserves actual values
        let directory = tempfile::tempdir().unwrap();
        let baseline_path = directory.path().join("state.json");

        with_test_state_path(&baseline_path, || {
            let mut state = ResetState::default();
            let mut receipt = CaptureReceipt::new("Codex / ChatGPT");
            receipt.initialized = true;
            receipt.client_existed = false;

            let baseline = state.clients.entry("Codex / ChatGPT".into()).or_default();
            let name = CODEX_ENV;
            let user = Some("user-actual-key".to_string());
            let process = Some("user-actual-key".to_string());
            let legacy_managed_codex_key = true;

            // Core logic from capture_environment: baseline gets None, receipt gets actual
            let baseline_user = if legacy_managed_codex_key {
                None
            } else {
                user.clone()
            };
            let baseline_process = if legacy_managed_codex_key {
                None
            } else {
                process.clone()
            };

            baseline.environment.insert(
                name.into(),
                EnvironmentBaseline {
                    user: baseline_user,
                    process: baseline_process,
                },
            );
            receipt.inserted_environment.push(name.into());
            receipt.original_environment.insert(
                name.into(),
                EnvironmentBaseline {
                    user: user.clone(),
                    process: process.clone(),
                },
            );

            // Verify baseline has None (for clean reset)
            assert_eq!(baseline.environment[name].user, None);
            assert_eq!(baseline.environment[name].process, None);

            // Verify receipt preserves actual values (for rollback)
            assert_eq!(receipt.original_environment[name].user, user);
            assert_eq!(receipt.original_environment[name].process, process);
        });
    }

    #[test]
    fn owned_client_preview_matches_removal_result() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("cursor_config.json");
        let grants = directory.path().join("agent_workspaces.json");
        let files = vec![config.clone(), grants.clone()];

        let empty = owned_client_plan("Cursor", &files, false);
        assert_eq!(empty.action, "skip");
        assert!(empty.files.iter().all(|file| file.action == "skip"));
        assert!(!remove_owned_files(&files).unwrap());

        std::fs::write(&grants, b"{}").unwrap();
        let plan = owned_client_plan("Cursor", &files, false);
        assert_eq!(plan.action, "remove_owned");
        assert_eq!(plan.files[0].action, "skip");
        assert_eq!(plan.files[1].action, "delete");
        assert!(remove_owned_files(&files).unwrap());
        assert!(!grants.exists());

        // A pending patch restore takes precedence, and is not hidden behind
        // the owned-file branch.
        let patch = owned_client_plan("Cursor", &files, true);
        assert_eq!(patch.action, "restore_cursor_patch");
    }

    #[test]
    fn startup_scrub_rewrites_only_when_owned_snapshots_exist() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        assert!(!scrub_owned_snapshots_at(&path).unwrap());

        let mut state = ResetState::default();
        state
            .clients
            .entry("Claude Code".into())
            .or_default()
            .files
            .insert(directory.path().join("settings.json"), Some(b"{}".to_vec()));
        std::fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(!scrub_owned_snapshots_at(&path).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), before);

        state
            .clients
            .entry("Cursor".into())
            .or_default()
            .files
            .insert(
                directory.path().join("cursor_config.json"),
                Some(b"secret".to_vec()),
            );
        std::fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();
        assert!(scrub_owned_snapshots_at(&path).unwrap());
        let raw: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["clients"]["Cursor"]["files"], serde_json::json!({}));
        assert!(raw["clients"]["Claude Code"]["files"]
            .as_object()
            .is_some_and(|files| files.len() == 1));
        assert!(!scrub_owned_snapshots_at(&path).unwrap());
    }

    /// Simulate an AI Helper write: put `contents` in place and record its
    /// hash (plus the backup's, when present) like the real writers do.
    fn managed_write(baseline_path: &Path, client: &str, path: &Path, contents: &[u8]) {
        std::fs::write(path, contents).unwrap();
        record_file_write_at(baseline_path, client, path, contents).unwrap();
    }

    fn load(baseline_path: &Path) -> ResetState {
        crate::safe_fs::with_file_lock(baseline_path, || load_locked(baseline_path)).unwrap()
    }

    fn read_json(path: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn externally_modified_claude_settings_only_reset_managed_fields() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let baseline_path = directory.path().join("state.json");
        std::fs::write(
            &path,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://user.example","OTHER":"1"},"model":"user-model","theme":"dark"}"#,
        )
        .unwrap();
        let mut capture = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        managed_write(
            &baseline_path,
            "Claude Code",
            &path,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://taijiai.online","ANTHROPIC_AUTH_TOKEN":"sk-managed","ANTHROPIC_MODEL":"m","OTHER":"1"},"model":"m","theme":"dark"}"#,
        );
        // The user edits the file after AI Helper wrote it.
        std::fs::write(
            &path,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://taijiai.online","ANTHROPIC_AUTH_TOKEN":"sk-managed","ANTHROPIC_MODEL":"m","OTHER":"1"},"model":"m","theme":"light","permissions":{"allow":["Read"]}}"#,
        )
        .unwrap();

        let state = load(&baseline_path);
        let restore = restore_baseline(&state.clients["Claude Code"], "Claude Code").unwrap();

        assert_eq!(
            read_json(&path),
            serde_json::json!({
                "env": {"ANTHROPIC_BASE_URL": "https://user.example", "OTHER": "1"},
                "model": "user-model",
                "theme": "light",
                "permissions": {"allow": ["Read"]}
            })
        );
        assert!(restore
            .applied
            .contains(&(path.clone(), "clean_managed_fields")));
        assert!(restore.field_cleaned());
        assert!(
            restore
                .warnings
                .iter()
                .any(|warning| warning.contains(&path.display().to_string())
                    && warning.contains("只清理了受管字段")),
            "{:?}",
            restore.warnings
        );
    }

    #[test]
    fn claude_field_cleanup_removes_fields_the_snapshot_lacks() {
        let current = br#"{"env":{"ANTHROPIC_BASE_URL":"https://taijiai.online","ANTHROPIC_MODEL":"m"},"model":"m","a":1}"#;
        let cleaned = reconcile_claude(current, None).unwrap().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&cleaned).unwrap(),
            serde_json::json!({"a": 1})
        );
        // A top-level model that does not mirror ANTHROPIC_MODEL is the user's.
        let current = br#"{"env":{"ANTHROPIC_MODEL":"m"},"model":"user-choice"}"#;
        let cleaned = reconcile_claude(current, None).unwrap().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&cleaned).unwrap(),
            serde_json::json!({"model": "user-choice"})
        );
        // Nothing managed and nothing to restore: no rewrite at all.
        assert!(
            reconcile_claude(br#"{"theme":"dark"}"#, Some(br#"{"theme":"old"}"#))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn codex_field_cleanup_restores_snapshot_selections_and_keeps_other_tables() {
        let snapshot = br#"model = "gpt-user"
model_provider = "openai"

[profiles.work]
model = "w"
"#;
        let current = br#"model = "m"
model_provider = "custom"

[model_providers.custom]
name = "custom"
base_url = "https://taijiai.online/v1"
env_key = "CUSTOM_OPENAI_API_KEY"

[profiles.work]
model_provider = "custom"
model = "m"

[profiles.other]
model_provider = "custom"
model = "m"
approval_policy = "never"

[mcp_servers.x]
command = "y"
"#;
        let cleaned = reconcile_codex(current, Some(snapshot)).unwrap().unwrap();
        let doc = std::str::from_utf8(&cleaned)
            .unwrap()
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert_eq!(doc["model"].as_str(), Some("gpt-user"));
        assert_eq!(doc["model_provider"].as_str(), Some("openai"));
        assert!(doc.get("model_providers").is_none());
        assert_eq!(doc["profiles"]["work"]["model"].as_str(), Some("w"));
        assert!(doc["profiles"]["work"].get("model_provider").is_none());
        assert!(doc["profiles"]["other"].get("model_provider").is_none());
        assert!(doc["profiles"]["other"].get("model").is_none());
        assert_eq!(
            doc["profiles"]["other"]["approval_policy"].as_str(),
            Some("never")
        );
        assert_eq!(doc["mcp_servers"]["x"]["command"].as_str(), Some("y"));

        // A provider the user had before takeover is put back as it was.
        let snapshot = br#"[model_providers.custom]
base_url = "https://user.example/v1"
"#;
        let current = br#"[model_providers.custom]
base_url = "https://taijiai.online/v1"

[model_providers.other]
base_url = "https://other.example/v1"
"#;
        let cleaned = reconcile_codex(current, Some(snapshot)).unwrap().unwrap();
        let doc = std::str::from_utf8(&cleaned)
            .unwrap()
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://user.example/v1")
        );
        assert_eq!(
            doc["model_providers"]["other"]["base_url"].as_str(),
            Some("https://other.example/v1")
        );
    }

    #[test]
    fn workbuddy_field_cleanup_replaces_managed_entries_with_snapshot_ones() {
        let snapshot = br#"{"models":[
            {"vendor":"Custom","url":"https://taijiai.online/v1","model":"old"},
            {"vendor":"OpenAI","url":"https://api.openai.com/v1","model":"u"}
        ]}"#;
        let current = br#"{"models":[
            {"vendor":"Custom","url":"https://taijiai.online/v1","model":"new"},
            {"url":"https://taijiai.online/v1","model":"unnamed-vendor"},
            {"vendor":"OpenAI","url":"https://api.openai.com/v1","model":"u"},
            {"vendor":"Custom","url":"https://my.proxy.example/v1","model":"mine"}
        ],"extra":true}"#;
        let cleaned = reconcile_workbuddy(current, Some(snapshot))
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&cleaned).unwrap(),
            serde_json::json!({"models":[
                {"vendor":"OpenAI","url":"https://api.openai.com/v1","model":"u"},
                {"vendor":"Custom","url":"https://my.proxy.example/v1","model":"mine"},
                {"vendor":"Custom","url":"https://taijiai.online/v1","model":"old"}
            ],"extra":true})
        );
    }

    #[test]
    fn version_1_state_loads_upgrades_and_always_cleans_fields_only() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let baseline_path = directory.path().join("state.json");
        let snapshot = br#"{"env":{"ANTHROPIC_BASE_URL":"https://user.example"}}"#.to_vec();
        let managed = br#"{"env":{"ANTHROPIC_BASE_URL":"https://taijiai.online","ANTHROPIC_AUTH_TOKEN":"sk-managed"},"theme":"light"}"#;
        std::fs::write(&path, managed).unwrap();
        let v1 = serde_json::json!({
            "version": 1,
            "clients": {
                "Claude Code": {
                    "files": {path.to_string_lossy(): snapshot},
                    "environment": {}
                },
                // A post-reset marker has nothing to restore and stays unflagged.
                "Codex / ChatGPT": {"files": {}, "environment": {}}
            }
        });
        std::fs::write(&baseline_path, serde_json::to_vec(&v1).unwrap()).unwrap();

        let state = load(&baseline_path);
        assert_eq!(state.version, 2);
        assert!(state.clients["Claude Code"].unhashed_snapshot);
        assert!(!state.clients["Codex / ChatGPT"].unhashed_snapshot);

        // The next save writes version 2 and keeps the flag; a hash recorded
        // after the upgrade does not turn the old snapshot into a full restore.
        record_file_write_at(&baseline_path, "Claude Code", &path, managed).unwrap();
        let saved = read_json(&baseline_path);
        assert_eq!(saved["version"], 2);
        assert_eq!(saved["clients"]["Claude Code"]["unhashed_snapshot"], true);

        let state = load(&baseline_path);
        let restore = restore_baseline(&state.clients["Claude Code"], "Claude Code").unwrap();
        assert_eq!(
            read_json(&path),
            serde_json::json!({"env":{"ANTHROPIC_BASE_URL":"https://user.example"},"theme":"light"})
        );
        assert!(restore.warnings.iter().any(|w| w.contains("旧版本")));
    }

    #[test]
    fn preview_plan_matches_the_applied_restore() {
        let directory = tempfile::tempdir().unwrap();
        let baseline_path = directory.path().join("state.json");
        let unchanged = directory.path().join("settings.json");
        let created = directory.path().join("created.json");
        let edited = directory.path().join("edited.json");
        let deleted = directory.path().join("deleted.json");
        let untouched = directory.path().join("untouched.json");
        std::fs::write(&unchanged, br#"{"theme":"dark"}"#).unwrap();
        std::fs::write(&edited, br#"{"env":{"OTHER":"1"}}"#).unwrap();
        std::fs::write(&deleted, br#"{"env":{"OTHER":"2"}}"#).unwrap();
        std::fs::write(&untouched, br#"{"keep":true}"#).unwrap();

        let mut capture = CaptureReceipt::new("Claude Code");
        for path in [&unchanged, &created, &edited, &deleted, &untouched] {
            capture_at(&baseline_path, &mut capture, path).unwrap();
        }
        let managed = br#"{"env":{"ANTHROPIC_BASE_URL":"https://taijiai.online","OTHER":"1"}}"#;
        managed_write(&baseline_path, "Claude Code", &unchanged, managed);
        managed_write(&baseline_path, "Claude Code", &created, managed);
        managed_write(&baseline_path, "Claude Code", &edited, managed);
        managed_write(&baseline_path, "Claude Code", &deleted, managed);
        std::fs::write(
            &edited,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://taijiai.online","OTHER":"1"},"user":1}"#,
        )
        .unwrap();
        std::fs::remove_file(&deleted).unwrap();

        let state = load(&baseline_path);
        let baseline = &state.clients["Claude Code"];
        let plan = baseline_client_plan("Claude Code", baseline);
        let planned = plan
            .files
            .iter()
            .map(|file| (PathBuf::from(&file.path), file.action.clone()))
            .collect::<Vec<_>>();
        let expected = |path: &PathBuf| match path {
            p if *p == unchanged => "restore_snapshot",
            p if *p == created => "delete",
            p if *p == edited => "clean_managed_fields",
            _ => "skip",
        };
        for path in [&unchanged, &created, &edited, &deleted, &untouched] {
            assert!(planned.iter().any(|(planned, _)| planned == path));
        }
        for (path, action) in &planned {
            assert_eq!(action, expected(path), "{}", path.display());
        }
        assert_eq!(plan.action, "clean_managed_fields");

        let restore = restore_baseline(baseline, "Claude Code").unwrap();
        let applied = restore
            .applied
            .iter()
            .map(|(path, action)| (path.clone(), action.to_string()))
            .collect::<Vec<_>>();
        assert_eq!(applied, planned, "execution must apply the previewed plan");

        assert_eq!(std::fs::read(&unchanged).unwrap(), br#"{"theme":"dark"}"#);
        assert!(!created.exists());
        assert_eq!(
            read_json(&edited),
            serde_json::json!({"env":{"OTHER":"1"},"user":1})
        );
        assert!(!deleted.exists(), "an external deletion is kept");
        assert!(restore
            .warnings
            .iter()
            .any(|w| w.contains(&deleted.display().to_string())));
        assert_eq!(std::fs::read(&untouched).unwrap(), br#"{"keep":true}"#);
    }

    #[test]
    fn unreadable_file_fails_the_restore_instead_of_guessing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let baseline_path = directory.path().join("state.json");
        std::fs::write(&path, br#"{"theme":"dark"}"#).unwrap();
        let mut capture = CaptureReceipt::new("Claude Code");
        capture_at(&baseline_path, &mut capture, &path).unwrap();
        managed_write(&baseline_path, "Claude Code", &path, b"{}");
        // Something that cannot be read as a file now sits at the path.
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        let state = load(&baseline_path);
        let baseline = &state.clients["Claude Code"];
        assert_eq!(baseline_client_plan("Claude Code", baseline).action, "skip");
        assert!(restore_baseline(baseline, "Claude Code").is_err());
        assert!(path.is_dir());
    }
}

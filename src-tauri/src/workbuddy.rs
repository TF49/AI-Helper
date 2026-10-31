use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[cfg(test)]
thread_local! {
    static TEST_ROOT: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    static TEST_FAIL_AFTER_WRITES: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

fn config_home() -> Option<PathBuf> {
    #[cfg(test)]
    {
        if let Some(root) = TEST_ROOT.with(|root| root.borrow().clone()) {
            return Some(root);
        }
        if let Some(root) = std::env::var_os("AI_HELPER_TEST_WORKBUDDY_ROOT") {
            return Some(PathBuf::from(root));
        }
        static DIRECTORY: once_cell::sync::Lazy<tempfile::TempDir> =
            once_cell::sync::Lazy::new(|| tempfile::tempdir().expect("isolated WorkBuddy tests"));
        Some(DIRECTORY.path().to_path_buf())
    }
    #[cfg(not(test))]
    dirs::home_dir()
}

fn configured_directories() -> Vec<PathBuf> {
    // Unit tests never consult a developer's real configured directories.
    #[cfg(test)]
    return Vec::new();
    #[cfg(not(test))]
    ["WORKBUDDY_CONFIG_DIR", "CODEBUDDY_CONFIG_DIR"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .filter_map(|value| (!value.trim().is_empty()).then(|| PathBuf::from(value.trim())))
        .collect()
}

fn default_vendor() -> String {
    "Custom".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyModelEntry {
    pub id: String,
    pub name: String,
    #[serde(default = "default_vendor")]
    pub vendor: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default = "default_true")]
    pub supports_tool_call: bool,
    #[serde(default = "default_true")]
    pub supports_images: bool,
    #[serde(default = "default_true")]
    pub supports_reasoning: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only_reasoning: Option<bool>,
    #[serde(default)]
    pub use_custom_protocol: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<WorkbuddyReasoning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyReasoning {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_efforts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_disable_thinking: Option<bool>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkbuddyUIConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,

    // 高级功能开关
    pub supports_tool_call: bool,
    pub supports_images: bool,
    pub supports_reasoning: bool,
    pub only_reasoning: bool,
    pub can_disable_thinking: bool,
    pub use_custom_protocol: bool,

    // 思考强度设置
    pub default_effort: String,
    pub supported_efforts: Vec<String>,

    // Token 上限限制
    pub max_input_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,

    // 已配置的所有模型列表（支持多模型拼接）
    pub configured_models: Vec<WorkbuddyModelEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkbuddySavePayload {
    pub url: String,
    pub api_key: String,
    pub model: String,

    pub supports_tool_call: bool,
    pub supports_images: bool,
    pub supports_reasoning: bool,
    pub only_reasoning: bool,
    pub can_disable_thinking: bool,
    pub use_custom_protocol: bool,

    pub default_effort: Option<String>,
    pub supported_efforts: Vec<String>,

    pub max_input_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

pub fn workbuddy_primary_config_path() -> Result<PathBuf, AppError> {
    if let Some(directory) = configured_directories().first() {
        return Ok(directory.join("models.json"));
    }
    let home =
        config_home().ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;

    // 默认主路径为官方标准 WorkBuddy 路径: ~/.workbuddy/models.json
    Ok(home.join(".workbuddy").join("models.json"))
}

#[allow(dead_code)]
pub fn workbuddy_config_path() -> Result<PathBuf, AppError> {
    workbuddy_primary_config_path()
}

/// 获取 WorkBuddy 所有可能探测和同步写入的配置文件候选路径
/// 包含官方标准路径 ~/.workbuddy/models.json 以及兼容历史/特定版本的 ~/.workbuddy-ai/models.json
pub fn get_all_workbuddy_config_paths() -> Vec<PathBuf> {
    candidate_paths(configured_directories(), config_home())
}

fn candidate_paths(configured: Vec<PathBuf>, home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for directory in configured {
        let path = directory.join("models.json");
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    // An explicit profile is isolated from the default home-directory profiles.
    if !paths.is_empty() {
        return paths;
    }
    if let Some(home) = home {
        // 1. 官方标准 WorkBuddy 路径 (其他用户及主流版本使用)
        let std_path = home.join(".workbuddy").join("models.json");
        if !paths.contains(&std_path) {
            paths.push(std_path);
        }
        // 2. 兼容路径 ~/.workbuddy-ai/models.json
        let ai_path = home.join(".workbuddy-ai").join("models.json");
        if !paths.contains(&ai_path) {
            paths.push(ai_path);
        }
    }
    paths
}

/// 读取并聚合 WorkBuddy 在所有候选路径（~/.workbuddy 与 ~/.workbuddy-ai）中的模型配置
/// 返回 (聚合后的模型列表, 主路径, 是否至少存在一个配置文件)
#[derive(Clone)]
struct WorkbuddyPaths {
    primary: PathBuf,
    candidates: Vec<PathBuf>,
    journal: PathBuf,
}

fn absolute_path(path: PathBuf) -> Result<PathBuf, AppError> {
    let path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    };
    // Let the filesystem resolve `..` through existing symlinked directories;
    // lexical removal would silently select a different custom profile.
    let normalized = path;
    let mut missing = vec![normalized
        .file_name()
        .ok_or_else(|| AppError::Other("无效配置路径".into()))?
        .to_os_string()];
    let mut ancestor = normalized
        .parent()
        .ok_or_else(|| AppError::Other("无效配置路径".into()))?;
    loop {
        match ancestor.canonicalize() {
            Ok(mut canonical) => {
                for component in missing.into_iter().rev() {
                    canonical.push(component);
                }
                return Ok(canonical);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(
                    ancestor
                        .file_name()
                        .ok_or_else(|| AppError::Other("无效配置路径".into()))?
                        .to_os_string(),
                );
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| AppError::Other("无效配置路径".into()))?;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn path_key(path: &std::path::Path) -> std::ffi::OsString {
    #[cfg(windows)]
    return path.to_string_lossy().to_lowercase().into();
    #[cfg(not(windows))]
    path.as_os_str().to_os_string()
}

fn transaction_paths() -> Result<WorkbuddyPaths, AppError> {
    let primary = absolute_path(workbuddy_primary_config_path()?)?;
    let mut candidates = vec![primary.clone()];
    for path in get_all_workbuddy_config_paths() {
        let path = absolute_path(path)?;
        if !candidates
            .iter()
            .any(|existing| path_key(existing) == path_key(&path))
        {
            candidates.push(path);
        }
    }
    let home =
        config_home().ok_or_else(|| AppError::ConfigNotFound("无法获取配置事务目录".into()))?;
    Ok(WorkbuddyPaths {
        primary,
        candidates,
        journal: absolute_path(home.join(".ai-helper/workbuddy-transaction.json"))?,
    })
}

fn model_backup(path: &std::path::Path) -> PathBuf {
    path.with_extension("json.bak")
}

#[derive(Debug, Serialize, Deserialize)]
enum TransactionPhase {
    Prepared,
    Committed,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileChange {
    path: PathBuf,
    before: Option<Vec<u8>>,
    after: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
struct WorkbuddyTransaction {
    version: u32,
    phase: TransactionPhase,
    files: Vec<FileChange>,
    // Existing merge inputs that this transaction never replaces. Persist
    // only their paths so recovery cannot resurrect an externally deleted
    // source from a backup, and never replay their old credential contents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    read_dependencies: Vec<PathBuf>,
}

fn read_optional_bytes(path: &std::path::Path) -> Result<Option<Vec<u8>>, AppError> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn read_transaction(path: &std::path::Path) -> Result<Option<WorkbuddyTransaction>, AppError> {
    let Some(bytes) = read_optional_bytes(path)? else {
        return Ok(None);
    };
    let mut transaction: WorkbuddyTransaction =
        serde_json::from_slice(&bytes).map_err(|error| {
            AppError::Other(format!("WorkBuddy 配置事务记录损坏，已停止读写: {error}"))
        })?;
    if !matches!(transaction.version, 1 | 2)
        || transaction.files.is_empty()
        || transaction.files.len() > 16
        || transaction.read_dependencies.len() > 16
    {
        return Err(AppError::Other(
            "WorkBuddy 配置事务记录无效，已停止读写".into(),
        ));
    }
    for file in &mut transaction.files {
        if !file.path.is_absolute() {
            return Err(AppError::Other("WorkBuddy 配置事务路径不是绝对路径".into()));
        }
        file.path = absolute_path(file.path.clone())?;
    }
    for dependency in &mut transaction.read_dependencies {
        if !dependency.is_absolute() {
            return Err(AppError::Other("WorkBuddy 配置事务路径不是绝对路径".into()));
        }
        *dependency = absolute_path(dependency.clone())?;
    }
    let mut seen = std::collections::HashSet::new();
    if transaction.files.iter().any(|file| {
        !file.path.is_absolute()
            || !matches!(
                file.path.file_name().and_then(|name| name.to_str()),
                Some("models.json" | "models.json.bak")
            )
            || !seen.insert(path_key(&file.path))
    }) || transaction.read_dependencies.iter().any(|dependency| {
        dependency.file_name().and_then(|name| name.to_str()) != Some("models.json")
            || !seen.insert(path_key(dependency))
    }) {
        return Err(AppError::Other(
            "WorkBuddy 配置事务记录无效，已停止读写".into(),
        ));
    }
    Ok(Some(transaction))
}

fn with_path_locks<T>(
    paths: &[PathBuf],
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    if let Some((path, rest)) = paths.split_first() {
        crate::safe_fs::with_file_lock(path, || with_path_locks(rest, operation))
    } else {
        operation()
    }
}

fn transaction_conflict(path: &std::path::Path) -> AppError {
    AppError::Other(format!(
        "WorkBuddy 配置已被其他程序修改，已停止读写并保留事务记录，请先处理冲突: {}",
        path.display()
    ))
}

fn transaction_path_is_link(path: &std::path::Path) -> Result<bool, AppError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    #[cfg(windows)]
    let is_link = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let is_link = metadata.file_type().is_symlink();
    Ok(is_link)
}

fn verify_file_snapshot(path: &std::path::Path, expected: Option<&[u8]>) -> Result<(), AppError> {
    if transaction_path_is_link(path)? {
        return Err(transaction_conflict(path));
    }
    if read_optional_bytes(path)?.as_deref() != expected {
        return Err(transaction_conflict(path));
    }
    Ok(())
}

fn verify_transaction_snapshot(
    transaction: &WorkbuddyTransaction,
    documents: &[ModelDocument],
    committed_files: usize,
) -> Result<(), AppError> {
    // A document can supply models to another profile without needing its
    // own replacement. Keep that read dependency in every validation pass,
    // separately from the targets recovery is allowed to rewrite.
    for document in documents {
        if !transaction
            .files
            .iter()
            .any(|file| file.path == document.path)
        {
            verify_file_snapshot(&document.path, document.raw.as_deref())?;
        }
    }
    for (index, file) in transaction.files.iter().enumerate() {
        let expected = if index < committed_files {
            Some(file.after.as_slice())
        } else {
            file.before.as_deref()
        };
        verify_file_snapshot(&file.path, expected)?;
    }
    Ok(())
}

fn restore_transaction(
    transaction: &WorkbuddyTransaction,
    committed: bool,
) -> Result<(), AppError> {
    if committed {
        // A durable completion marker proves all replacements succeeded. Do
        // not replay snapshots over later edits. Missing/unreadable targets
        // retain the marker and stop before normal backup recovery could
        // recreate a file that another program intentionally deleted.
        for file in &transaction.files {
            if !matches!(transaction_path_is_link(&file.path), Ok(false)) {
                return Err(transaction_conflict(&file.path));
            }
            match read_optional_bytes(&file.path) {
                Ok(Some(_)) => {}
                _ => return Err(transaction_conflict(&file.path)),
            }
        }
        return Ok(());
    }
    // Inspect the entire transaction before restoring its first file. An
    // editor/WorkBuddy need not participate in our advisory lock protocol.
    // Preserve every file and the journal if any readable file is a version
    // that this transaction did not write or snapshot.
    for file in &transaction.files {
        if matches!(transaction_path_is_link(&file.path), Ok(true)) {
            return Err(transaction_conflict(&file.path));
        }
    }
    let snapshots = transaction
        .files
        .iter()
        .map(|file| read_optional_bytes(&file.path))
        .collect::<Vec<_>>();
    for (file, snapshot) in transaction.files.iter().zip(&snapshots) {
        if let Ok(current) = snapshot {
            let is_after = current.as_deref() == Some(file.after.as_slice());
            if !is_after && current.as_deref() != file.before.as_deref() {
                return Err(transaction_conflict(&file.path));
            }
        }
    }
    let mut failure = None;
    for (file, snapshot) in transaction.files.iter().zip(snapshots) {
        let current = match snapshot {
            Ok(current) => current,
            Err(error) => {
                if failure.is_none() {
                    failure = Some(error);
                }
                continue;
            }
        };
        if current.as_deref() == file.before.as_deref() {
            continue;
        }
        verify_file_snapshot(&file.path, current.as_deref())?;
        let result = if let Some(contents) = file.before.as_deref() {
            crate::safe_fs::atomic_write_locked(&file.path, contents)
        } else {
            crate::safe_fs::remove_file_locked(&file.path)
        };
        // One inaccessible backup must not prevent restoring the remaining
        // actual profiles. Keep the journal until every restoration succeeds.
        if let Err(error) = result {
            if failure.is_none() {
                failure = Some(error);
            }
        }
    }
    failure.map_or(Ok(()), Err)
}

fn recover_transaction(
    path: &std::path::Path,
    transaction: &WorkbuddyTransaction,
) -> Result<(), AppError> {
    // A read dependency may have changed contents since the interrupted
    // operation; use those contents in the next fresh merge. Missing,
    // unreadable or redirected inputs instead preserve the journal and stop
    // before normal backup recovery can recreate the old source credentials.
    for dependency in &transaction.read_dependencies {
        if !matches!(transaction_path_is_link(dependency), Ok(false))
            || !std::fs::symlink_metadata(dependency).is_ok_and(|metadata| metadata.is_file())
            || !matches!(read_optional_bytes(dependency), Ok(Some(_)))
        {
            return Err(transaction_conflict(dependency));
        }
    }
    restore_transaction(
        transaction,
        matches!(transaction.phase, TransactionPhase::Committed),
    )
    .map_err(|error| {
        AppError::Other(format!(
            "WorkBuddy 配置恢复未完成，已停止读写，保留事务供下次恢复: {error}"
        ))
    })?;
    crate::safe_fs::remove_file_locked(path)?;
    Ok(())
}

fn remove_broken_symlink_locked(path: &std::path::Path) -> Result<(), AppError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink()
        && matches!(std::fs::metadata(path), Err(ref e)
            if e.kind() == std::io::ErrorKind::NotFound)
    {
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileTypeExt;
            if metadata.file_type().is_symlink_dir() {
                // Remove only the directory link itself; never recurse into
                // or follow its target. DeleteFileW rejects directory links.
                std::fs::remove_dir(path)?;
                return Ok(());
            }
        }
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn with_workbuddy_transaction<T>(
    paths: &WorkbuddyPaths,
    operation: impl FnOnce(&[PathBuf]) -> Result<T, AppError>,
) -> Result<T, AppError> {
    // All application profiles share this coordinator. Configuration and backup
    // locks are acquired in one stable order, including paths in a crash journal.
    crate::safe_fs::with_file_lock(&paths.journal, || {
        let mut pending = read_transaction(&paths.journal)?;
        for path in &paths.candidates {
            if let Some(parent) = path.parent() {
                remove_broken_symlink_locked(parent)?;
            }
        }
        let active = paths
            .candidates
            .iter()
            .filter(|path| {
                **path == paths.primary
                    || path.exists()
                    || model_backup(path).exists()
                    || path.parent().is_some_and(std::path::Path::exists)
            })
            .cloned()
            .collect::<Vec<_>>();
        if let Some(pending) = &mut pending {
            if pending.version == 1 {
                // Legacy journals did not record unchanged merge inputs.
                // Require every identifiable non-written active source to
                // exist before recovery; its old contents are never guessed
                // or restored from a backup.
                for path in &active {
                    if !pending.files.iter().any(|file| file.path == *path)
                        && !pending.read_dependencies.contains(path)
                    {
                        pending.read_dependencies.push(path.clone());
                    }
                }
            }
        }
        let mut locked = active
            .iter()
            .flat_map(|path| [path.clone(), model_backup(path)])
            .collect::<Vec<_>>();
        if let Some(pending) = &pending {
            locked.extend(pending.files.iter().map(|file| file.path.clone()));
            locked.extend(pending.read_dependencies.iter().cloned());
        }
        locked.sort_by_key(|path| path_key(path));
        locked.dedup_by(|left, right| path_key(left) == path_key(right));
        with_path_locks(&locked, || {
            if let Some(pending) = pending {
                recover_transaction(&paths.journal, &pending)?;
            }
            // Recovery must precede the read/merge snapshot, not the final write.
            for path in &active {
                remove_broken_symlink_locked(path)?;
                crate::safe_fs::recover_missing_file_locked(path)?;
            }
            operation(&active)
        })
    })
}

struct ModelDocument {
    path: PathBuf,
    raw: Option<Vec<u8>>,
    value: serde_json::Value,
    entries: Vec<WorkbuddyModelEntry>,
}

fn load_documents(paths: &[PathBuf]) -> Result<Vec<ModelDocument>, AppError> {
    paths
        .iter()
        .map(|path| {
            let raw = read_optional_bytes(path)?;
            let text = std::str::from_utf8(raw.as_deref().unwrap_or_default())
                .map_err(|error| AppError::Other(format!("WorkBuddy 配置不是 UTF-8: {error}")))?;
            let entries = parse_workbuddy_entries_from_str(text)?;
            let value = if text.trim().is_empty() {
                serde_json::json!([])
            } else {
                serde_json::from_str(text)?
            };
            Ok(ModelDocument {
                path: path.clone(),
                raw,
                value,
                entries,
            })
        })
        .collect()
}

fn aggregate_models(documents: &[ModelDocument]) -> Vec<WorkbuddyModelEntry> {
    let mut merged = Vec::<WorkbuddyModelEntry>::new();
    for document in documents {
        for entry in &document.entries {
            if !merged.iter().any(|existing| existing.id == entry.id) {
                merged.push(entry.clone());
            }
        }
    }
    merged
}

fn preserve_unmanaged_fields(updated: &mut WorkbuddyModelEntry, previous: &WorkbuddyModelEntry) {
    updated.extra.extend(previous.extra.clone());
    updated.temperature = previous.temperature;
    updated.disabled = previous.disabled;
    if previous.api.is_some() {
        updated.api = previous.api.clone();
    }
    match (&mut updated.reasoning, &previous.reasoning) {
        (Some(updated), Some(previous)) => updated.extra.extend(previous.extra.clone()),
        (None, Some(previous)) => updated.reasoning = Some(previous.clone()),
        _ => {}
    }
}

fn document_bytes(
    document: &ModelDocument,
    entries: &[WorkbuddyModelEntry],
) -> Result<Vec<u8>, AppError> {
    let mut entries = entries.to_vec();
    for entry in &mut entries {
        if let Some(previous) = document
            .entries
            .iter()
            .find(|previous| previous.id == entry.id)
        {
            preserve_unmanaged_fields(entry, previous);
        }
    }
    let entries = serde_json::to_value(entries)?;
    let mut value = document.value.clone();
    match &mut value {
        serde_json::Value::Object(wrapper) => {
            wrapper.insert("models".into(), entries);
        }
        _ => value = entries,
    }
    Ok(serde_json::to_vec_pretty(&value)?)
}

fn transaction_checkpoint(_writes: usize) -> Result<(), AppError> {
    #[cfg(test)]
    {
        if TEST_FAIL_AFTER_WRITES.with(|limit| limit.get()) == Some(_writes) {
            return Err(AppError::Other("injected WorkBuddy write failure".into()));
        }
        if std::env::var("AI_HELPER_TEST_WORKBUDDY_PAUSE_AFTER")
            .ok()
            .and_then(|value| value.parse().ok())
            == Some(_writes)
        {
            if let Some(ready) = std::env::var_os("AI_HELPER_TEST_WORKBUDDY_READY") {
                std::fs::write(ready, b"ready")?;
                loop {
                    if std::env::var_os("AI_HELPER_TEST_WORKBUDDY_CONTINUE")
                        .is_some_and(|path| std::path::Path::new(&path).exists())
                    {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    }
    Ok(())
}

fn rollback_failed_transaction(
    paths: &WorkbuddyPaths,
    transaction: &WorkbuddyTransaction,
    original: AppError,
) -> Result<(), AppError> {
    if let Err(recovery) = restore_transaction(transaction, false) {
        return Err(AppError::Other(format!("WorkBuddy 配置写入失败 ({original})，回滚未完成 ({recovery})；已保留事务记录，恢复前停止读写")));
    }
    crate::safe_fs::remove_file_locked(&paths.journal).map_err(|error| {
        AppError::Other(format!("WorkBuddy 配置已回滚，但事务清理失败: {error}"))
    })?;
    Err(original)
}

fn commit_documents(
    paths: &WorkbuddyPaths,
    documents: &[ModelDocument],
    entries: &[WorkbuddyModelEntry],
) -> Result<(), AppError> {
    let mut files = Vec::new();
    for document in documents {
        let after = document_bytes(document, entries)?;
        if document.raw.as_deref() == Some(after.as_slice()) {
            continue;
        }
        if let Some(previous) = &document.raw {
            let backup = model_backup(&document.path);
            let before = read_optional_bytes(&backup)?;
            if before.as_deref() != Some(previous.as_slice()) {
                files.push(FileChange {
                    path: backup,
                    before,
                    after: previous.clone(),
                });
            }
        }
        files.push(FileChange {
            path: document.path.clone(),
            before: document.raw.clone(),
            after,
        });
    }
    if files.is_empty() {
        return Ok(());
    }
    let read_dependencies = documents
        .iter()
        .filter(|document| {
            document.raw.is_some() && !files.iter().any(|file| file.path == document.path)
        })
        .map(|document| document.path.clone())
        .collect();
    let mut transaction = WorkbuddyTransaction {
        version: 2,
        phase: TransactionPhase::Prepared,
        files,
        read_dependencies,
    };
    let staged = transaction
        .files
        .iter()
        .map(|file| crate::safe_fs::prepare_write_locked(&file.path, &file.after))
        .collect::<Result<Vec<_>, _>>()?;
    verify_transaction_snapshot(&transaction, documents, 0)?;
    crate::safe_fs::atomic_write_locked(&paths.journal, serde_json::to_vec(&transaction)?)?;
    if let Err(error) = transaction_checkpoint(0) {
        drop(staged);
        return rollback_failed_transaction(paths, &transaction, error);
    }
    // Byte checks detect non-cooperating writers during preparation and
    // between replacements. Ordinary rename has no compare-and-swap form:
    // such a writer can still race the final check and replacement.
    let mut staged = staged.into_iter();
    for (index, file) in transaction.files.iter().enumerate() {
        verify_transaction_snapshot(&transaction, documents, index)?;
        verify_file_snapshot(&file.path, file.before.as_deref())?;
        let result = staged
            .next()
            .expect("one prepared write per transaction file")
            .commit()
            .and_then(|_| transaction_checkpoint(index + 1));
        if let Err(error) = result {
            // Release every remaining staging file before rollback allocates
            // replacements. A conflict detected above keeps the journal.
            drop(staged);
            return rollback_failed_transaction(paths, &transaction, error);
        }
    }
    verify_transaction_snapshot(&transaction, documents, transaction.files.len())?;
    transaction.phase = TransactionPhase::Committed;
    if let Err(error) =
        crate::safe_fs::atomic_write_locked(&paths.journal, serde_json::to_vec(&transaction)?)
    {
        if error.file_was_committed(&paths.journal) {
            return Err(AppError::Other(format!(
                "WorkBuddy 所有配置已更新，但完成标记的持久化未确认；已保留记录供恢复: {error}"
            )));
        }
        return rollback_failed_transaction(paths, &transaction, error);
    }
    #[cfg(test)]
    transaction_checkpoint(usize::MAX)?;
    // The complete new state and commit marker are durable. Recovery can
    // validate and clean a leftover marker without replaying its old snapshot.
    if let Err(error) = crate::safe_fs::remove_file_locked(&paths.journal) {
        log::warn!("WorkBuddy 配置事务已提交，清理记录将在下次操作重试: {error}");
    }
    Ok(())
}

/// Read, backup recovery, merging, and synchronization share one transaction.
pub fn read_all_workbuddy_entries() -> Result<(Vec<WorkbuddyModelEntry>, PathBuf, bool), AppError> {
    let paths = transaction_paths()?;
    with_workbuddy_transaction(&paths, |active| {
        let documents = load_documents(active)?;
        let entries = aggregate_models(&documents);
        let mut exists = documents.iter().any(|document| document.raw.is_some());
        let needs_sync = documents.iter().any(|document| {
            document.raw.is_none()
                || document.entries.len() != entries.len()
                || entries.iter().any(|entry| {
                    !document
                        .entries
                        .iter()
                        .any(|existing| existing.id == entry.id)
                })
        });
        if !entries.is_empty() && needs_sync {
            commit_documents(&paths, &documents, &entries)?;
            exists = true;
        }
        Ok((entries, paths.primary.clone(), exists))
    })
}

pub fn detect_workbuddy_installation() -> (bool, Option<String>) {
    // 0. 优先检查用户已保存的自定义安装路径
    let saved = crate::app_paths::load_app_paths();
    if let Some(ref custom) = saved.workbuddy_client_path {
        let p = PathBuf::from(custom);
        if p.exists() {
            return (true, Some(custom.clone()));
        }
    }

    // 1. 调用系统化深度探测模式 (进程、Store应用包、注册表、标准目录与多盘符)
    let detected = crate::app_paths::detect_workbuddy_client_path();
    if detected.exists && !detected.path.is_empty() {
        return (true, Some(detected.path));
    }

    (false, None)
}

/// 解析 WorkBuddy 本地 models.json 配置文件内容，支持标准数组格式与包装对象格式
pub fn parse_workbuddy_entries_from_str(
    content: &str,
) -> Result<Vec<WorkbuddyModelEntry>, AppError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // 优先尝试标准数组格式: [ { ... }, { ... } ]
    if let Ok(arr) = serde_json::from_str::<Vec<WorkbuddyModelEntry>>(trimmed) {
        return Ok(arr);
    }

    // 兼容可能存在的对象格式: { "models": [ ... ] }
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(models_val) = obj.get("models") {
            if let Ok(arr) = serde_json::from_value::<Vec<WorkbuddyModelEntry>>(models_val.clone())
            {
                return Ok(arr);
            }
        }
    }

    Err(AppError::Other(
        "WorkBuddy 配置文件内容损坏或格式不受支持".to_string(),
    ))
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn read_workbuddy_entries(path: &PathBuf) -> Result<Vec<WorkbuddyModelEntry>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(path)?;
    parse_workbuddy_entries_from_str(&content)
}

pub fn get_workbuddy_config() -> Result<WorkbuddyUIConfig, AppError> {
    let (entries, primary_path, config_exists) = read_all_workbuddy_entries()?;
    let (is_installed, app_path) = detect_workbuddy_installation();

    let mut base_url = "https://bob-api.com/".to_string();
    let mut api_key = String::new();
    let mut model = "glm-5.3".to_string();

    let mut supports_tool_call = true;
    let mut supports_images = true;
    let mut supports_reasoning = true;
    let mut only_reasoning = false;
    let mut can_disable_thinking = true;
    let mut use_custom_protocol = false;
    let mut default_effort = String::new();
    let mut supported_efforts = vec!["medium".to_string()];
    let mut max_input_tokens = Some(32768);
    let mut max_output_tokens = Some(32768);

    if let Some(entry) = entries
        .iter()
        .find(|e| e.vendor == "Custom")
        .or_else(|| entries.first())
    {
        model = entry.id.clone();
        if let Some(k) = &entry.api_key {
            api_key = k.clone();
        }

        // 规范化 URL 映射回预设节点
        let raw_url = entry.url.trim_end_matches('/');
        let stripped = raw_url.strip_suffix("/v1").unwrap_or(raw_url);
        if stripped.starts_with("https://bob-api.com") {
            base_url = "https://bob-api.com/".to_string();
        } else if stripped.starts_with("https://taijiai.online") {
            base_url = "https://taijiai.online/".to_string();
        } else if !stripped.is_empty() {
            base_url = format!("{}/", stripped);
        }

        supports_tool_call = entry.supports_tool_call;
        supports_images = entry.supports_images;
        supports_reasoning = entry.supports_reasoning;
        only_reasoning = entry.only_reasoning.unwrap_or(false);
        use_custom_protocol = entry.use_custom_protocol;

        if let Some(reasoning) = &entry.reasoning {
            if let Some(efforts) = &reasoning.supported_efforts {
                supported_efforts = efforts.clone();
            }
            if let Some(de) = &reasoning.default_effort {
                default_effort = de.clone();
            }
            if let Some(cdt) = reasoning.can_disable_thinking {
                can_disable_thinking = cdt;
            }
        }

        max_input_tokens = entry.max_input_tokens;
        max_output_tokens = entry.max_output_tokens;
    }

    Ok(WorkbuddyUIConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: primary_path.display().to_string(),
        is_installed: is_installed || config_exists,
        app_path,
        supports_tool_call,
        supports_images,
        supports_reasoning,
        only_reasoning,
        can_disable_thinking,
        use_custom_protocol,
        default_effort,
        supported_efforts,
        max_input_tokens,
        max_output_tokens,
        configured_models: entries,
    })
}

pub fn set_workbuddy_config(payload: WorkbuddySavePayload) -> Result<(), AppError> {
    crate::credential_policy::validate_key_destination(
        &payload.api_key,
        payload.url.trim(),
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    let paths = transaction_paths()?;
    with_workbuddy_transaction(&paths, |active| {
        let documents = load_documents(active)?;
        let mut entries = aggregate_models(&documents);
        let normalized_url = if payload.use_custom_protocol {
            payload.url.trim().to_string()
        } else {
            let trimmed = payload.url.trim().trim_end_matches('/');
            if trimmed.ends_with("/v1") {
                trimmed.to_string()
            } else {
                format!("{}/v1", trimmed)
            }
        };

        let model_id = payload.model.trim().to_string();

        let reasoning_config = if payload.supports_reasoning {
            Some(WorkbuddyReasoning {
                supported_efforts: if payload.supported_efforts.is_empty() {
                    None
                } else {
                    Some(payload.supported_efforts)
                },
                default_effort: if payload.default_effort.as_deref().unwrap_or("").is_empty() {
                    None
                } else {
                    payload.default_effort
                },
                can_disable_thinking: if payload.can_disable_thinking {
                    None // WorkBuddy 默认为 true
                } else {
                    Some(false)
                },
                extra: serde_json::Map::new(),
            })
        } else {
            None
        };

        let new_entry = WorkbuddyModelEntry {
            id: model_id.clone(),
            name: model_id.clone(),
            vendor: "Custom".to_string(),
            url: normalized_url,
            api: Some("openai-responses".to_string()),
            api_key: if payload.api_key.trim().is_empty() {
                None
            } else {
                Some(payload.api_key.trim().to_string())
            },
            supports_tool_call: payload.supports_tool_call,
            supports_images: payload.supports_images,
            supports_reasoning: payload.supports_reasoning,
            only_reasoning: if payload.only_reasoning {
                Some(true)
            } else {
                None
            },
            use_custom_protocol: payload.use_custom_protocol,
            reasoning: reasoning_config,
            max_input_tokens: payload.max_input_tokens,
            max_output_tokens: payload.max_output_tokens,
            temperature: None,
            disabled: None,
            extra: serde_json::Map::new(),
        };

        // 核心变更：仅当在已配置模型中存在完全相同 model_id 时更新该项；
        // 否则直接作为新模型追加（拼接）至模型数组末尾，绝不覆盖已有模型
        if let Some(idx) = entries.iter().position(|e| e.id == model_id) {
            let mut updated = new_entry;
            preserve_unmanaged_fields(&mut updated, &entries[idx]);
            entries[idx] = updated;
        } else {
            entries.push(new_entry);
        }

        commit_documents(&paths, &documents, &entries)?;
        Ok(())
    })
}

pub fn delete_workbuddy_model(model_id: String) -> Result<Vec<WorkbuddyModelEntry>, AppError> {
    let paths = transaction_paths()?;
    with_workbuddy_transaction(&paths, |active| {
        let documents = load_documents(active)?;
        let mut entries = aggregate_models(&documents);
        let original_len = entries.len();
        entries.retain(|entry| entry.id != model_id.trim());
        if entries.len() != original_len {
            commit_documents(&paths, &documents, &entries)?;
        }
        Ok(entries)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    pub(crate) fn in_profile<T>(root: &std::path::Path, operation: impl FnOnce() -> T) -> T {
        struct Restore(Option<PathBuf>);
        impl Drop for Restore {
            fn drop(&mut self) {
                TEST_ROOT.with(|root| *root.borrow_mut() = self.0.take());
            }
        }
        let _restore =
            Restore(TEST_ROOT.with(|profile| profile.borrow_mut().replace(root.to_path_buf())));
        operation()
    }

    pub(crate) fn payload(model: &str) -> WorkbuddySavePayload {
        WorkbuddySavePayload {
            url: "https://bob-api.com".into(),
            api_key: String::new(),
            model: model.into(),
            supports_tool_call: true,
            supports_images: true,
            supports_reasoning: true,
            only_reasoning: false,
            can_disable_thinking: true,
            use_custom_protocol: false,
            default_effort: Some("medium".into()),
            supported_efforts: vec!["medium".into()],
            max_input_tokens: Some(32768),
            max_output_tokens: Some(4096),
        }
    }

    fn profiles(root: &std::path::Path) -> [PathBuf; 2] {
        [
            root.join(".workbuddy/models.json"),
            root.join(".workbuddy-ai/models.json"),
        ]
    }

    pub(crate) fn fixture(root: &std::path::Path) -> [Vec<u8>; 2] {
        let mut result = [Vec::new(), Vec::new()];
        for (index, path) in profiles(root).iter().enumerate() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let value = serde_json::json!({
                "permissions": {"deny": [format!("private-policy-{index}")]},
                "unknownRoot": index,
                "models": [{"id":"keep", "name":"keep", "url":"https://bob-api.com/v1", "disabled":true,
                    "temperature":0.25 + index as f64, "permissions":{"models":["keep"]},
                    "reasoning":{"privateReasoningRule":index}}]
            });
            result[index] = serde_json::to_vec(&value).unwrap();
            std::fs::write(path, &result[index]).unwrap();
        }
        result
    }

    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn child_command(
        root: &std::path::Path,
        action: &str,
        model: &str,
        pause: Option<usize>,
    ) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "workbuddy::tests::workbuddy_transaction_child",
                "--ignored",
            ])
            .env("AI_HELPER_TEST_WORKBUDDY_ROOT", root)
            .env("AI_HELPER_TEST_WORKBUDDY_ACTION", action)
            .env("AI_HELPER_TEST_WORKBUDDY_MODEL", model)
            .env_remove("AI_HELPER_TEST_WORKBUDDY_CONTINUE")
            .stdout(Stdio::null());
        if let Some(writes) = pause {
            command
                .env("AI_HELPER_TEST_WORKBUDDY_PAUSE_AFTER", writes.to_string())
                .env("AI_HELPER_TEST_WORKBUDDY_READY", root.join("child-ready"));
        }
        command
    }

    fn child(
        root: &std::path::Path,
        action: &str,
        model: &str,
        pause: Option<usize>,
    ) -> ChildGuard {
        ChildGuard(child_command(root, action, model, pause).spawn().unwrap())
    }

    fn resumable_child(root: &std::path::Path, action: &str, pause: usize) -> ChildGuard {
        ChildGuard(
            child_command(root, action, "conflicted", Some(pause))
                .env(
                    "AI_HELPER_TEST_WORKBUDDY_CONTINUE",
                    root.join("child-continue"),
                )
                .spawn()
                .unwrap(),
        )
    }

    fn child_timeout() -> Duration {
        Duration::from_secs(if cfg!(windows) { 120 } else { 30 })
    }

    fn wait_child(child: &mut ChildGuard) -> std::process::ExitStatus {
        let started = Instant::now();
        let timeout = child_timeout();
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                return status;
            }
            assert!(
                started.elapsed() < timeout,
                "WorkBuddy transaction exceeded subprocess deadline: pid={}, elapsed={:?}, limit={timeout:?}",
                child.0.id(),
                started.elapsed()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_ready(child: &mut ChildGuard, root: &std::path::Path) {
        let started = Instant::now();
        let timeout = child_timeout();
        while !root.join("child-ready").exists() {
            let status = child.0.try_wait().unwrap();
            assert!(
                status.is_none(),
                "child exited before transaction checkpoint: pid={}, status={status:?}, profile={}",
                child.0.id(),
                root.display()
            );
            assert!(
                started.elapsed() < timeout,
                "child did not reach transaction checkpoint: pid={}, elapsed={:?}, limit={timeout:?}, profile={}",
                child.0.id(),
                started.elapsed(),
                root.display()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn ids(path: &PathBuf) -> Vec<String> {
        let mut ids = read_workbuddy_entries(path)
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }

    #[test]
    #[ignore = "subprocess helper; only uses the explicitly supplied temporary profile"]
    fn workbuddy_transaction_child() {
        if std::env::var_os("AI_HELPER_TEST_WORKBUDDY_ROOT").is_none() {
            return;
        }
        let action = std::env::var("AI_HELPER_TEST_WORKBUDDY_ACTION").unwrap();
        let model = std::env::var("AI_HELPER_TEST_WORKBUDDY_MODEL").unwrap();
        match action.as_str() {
            "save" => set_workbuddy_config(payload(&model)).unwrap(),
            "save-conflict" => {
                assert!(set_workbuddy_config(payload(&model))
                    .unwrap_err()
                    .to_string()
                    .contains("其他程序修改"));
            }
            "delete" => {
                delete_workbuddy_model(model).unwrap();
            }
            "read" => {
                read_all_workbuddy_entries().unwrap();
            }
            "read-conflict" => {
                assert!(read_all_workbuddy_entries()
                    .unwrap_err()
                    .to_string()
                    .contains("其他程序修改"));
            }
            _ => panic!("unknown child operation"),
        }
    }

    #[test]
    fn actual_save_and_delete_complete_without_reentering_the_lock() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let mut saver = child(directory.path(), "save", "added", None);
        assert!(wait_child(&mut saver).success());
        for (index, path) in profiles(directory.path()).iter().enumerate() {
            assert_eq!(ids(path), ["added", "keep"]);
            let value: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            assert_eq!(value["unknownRoot"], index);
            assert_eq!(
                value["permissions"]["deny"][0],
                format!("private-policy-{index}")
            );
            let keep = value["models"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["id"] == "keep")
                .unwrap();
            assert_eq!(keep["disabled"], true);
            assert_eq!(keep["temperature"], 0.25 + index as f64);
            assert_eq!(keep["permissions"]["models"][0], "keep");
            assert_eq!(keep["reasoning"]["privateReasoningRule"], index);
        }
        let mut deleter = child(directory.path(), "delete", "added", None);
        assert!(wait_child(&mut deleter).success());
        for path in profiles(directory.path()) {
            assert_eq!(ids(&path), ["keep"]);
        }
    }

    #[test]
    fn recovery_happens_before_merging_compatibility_models() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let [primary, compatibility] = profiles(directory.path());
        std::fs::rename(&primary, model_backup(&primary)).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&compatibility).unwrap()).unwrap();
        value["models"][0]["id"] = serde_json::json!("compatibility");
        std::fs::write(&compatibility, serde_json::to_vec(&value).unwrap()).unwrap();
        let mut reader = child(directory.path(), "read", "unused", None);
        assert!(wait_child(&mut reader).success());
        assert_eq!(ids(&primary), ["compatibility", "keep"]);
        assert_eq!(ids(&compatibility), ["compatibility", "keep"]);
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(primary).unwrap()).unwrap();
        assert_eq!(value["permissions"]["deny"][0], "private-policy-0");
    }

    #[test]
    fn independent_writers_keep_both_committed_updates() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let mut first = child(directory.path(), "save", "writer-a", None);
        let mut second = child(directory.path(), "save", "writer-b", None);
        assert!(wait_child(&mut first).success());
        assert!(wait_child(&mut second).success());
        for path in profiles(directory.path()) {
            assert_eq!(ids(&path), ["keep", "writer-a", "writer-b"]);
        }
    }

    #[test]
    fn failure_after_primary_commit_restores_every_profile_and_backup() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        in_profile(directory.path(), || {
            TEST_FAIL_AFTER_WRITES.with(|limit| limit.set(Some(2)));
            let result = set_workbuddy_config(payload("failed-update"));
            TEST_FAIL_AFTER_WRITES.with(|limit| limit.set(None));
            assert!(result.is_err());
            for (index, path) in profiles(directory.path()).iter().enumerate() {
                assert_eq!(std::fs::read(path).unwrap(), before[index]);
                assert!(!model_backup(path).exists());
            }
            assert!(!transaction_paths().unwrap().journal.exists());
        });
    }

    #[test]
    fn preparation_failure_cannot_commit_only_the_primary_profile() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        let paths = profiles(directory.path());
        std::fs::create_dir(model_backup(&paths[1])).unwrap();
        in_profile(directory.path(), || {
            assert!(set_workbuddy_config(payload("not-written")).is_err())
        });
        for (index, path) in paths.iter().enumerate() {
            assert_eq!(std::fs::read(path).unwrap(), before[index]);
        }
    }

    #[test]
    fn delete_failure_also_restores_every_profile() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        in_profile(directory.path(), || {
            TEST_FAIL_AFTER_WRITES.with(|limit| limit.set(Some(2)));
            let result = delete_workbuddy_model("keep".into());
            TEST_FAIL_AFTER_WRITES.with(|limit| limit.set(None));
            assert!(result.is_err());
            for (index, path) in profiles(directory.path()).iter().enumerate() {
                assert_eq!(std::fs::read(path).unwrap(), before[index]);
            }
        });
    }

    #[test]
    fn corrupt_journal_blocks_reads_and_writes_without_erasing_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        in_profile(directory.path(), || {
            let paths = transaction_paths().unwrap();
            std::fs::create_dir_all(paths.journal.parent().unwrap()).unwrap();
            std::fs::write(&paths.journal, b"broken transaction").unwrap();
            assert!(read_all_workbuddy_entries().is_err());
            assert!(set_workbuddy_config(payload("blocked")).is_err());
            assert_eq!(
                std::fs::read(&paths.journal).unwrap(),
                b"broken transaction"
            );
            for (index, path) in profiles(directory.path()).iter().enumerate() {
                assert_eq!(std::fs::read(path).unwrap(), before[index]);
            }
        });
    }

    #[test]
    fn incomplete_recovery_blocks_new_operations_until_the_fault_is_repaired() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        in_profile(directory.path(), || {
            let paths = transaction_paths().unwrap();
            let transaction = WorkbuddyTransaction {
                version: 1,
                phase: TransactionPhase::Prepared,
                files: paths
                    .candidates
                    .iter()
                    .enumerate()
                    .map(|(index, path)| FileChange {
                        path: path.clone(),
                        before: Some(before[index].clone()),
                        after: b"[]".to_vec(),
                    })
                    .collect(),
                read_dependencies: Vec::new(),
            };
            std::fs::create_dir_all(paths.journal.parent().unwrap()).unwrap();
            std::fs::write(&paths.journal, serde_json::to_vec(&transaction).unwrap()).unwrap();
            let compatibility = &paths.candidates[1];
            std::fs::remove_file(compatibility).unwrap();
            std::fs::create_dir(compatibility).unwrap();
            assert!(read_all_workbuddy_entries().is_err());
            assert!(delete_workbuddy_model("keep".into()).is_err());
            assert!(paths.journal.exists());
            std::fs::remove_dir(compatibility).unwrap();
            // Restore a known transaction version after repairing the fault.
            // An unexplained deletion must be treated as an external change.
            std::fs::write(compatibility, b"[]").unwrap();
            read_all_workbuddy_entries().unwrap();
            assert!(!paths.journal.exists());
            for (index, path) in profiles(directory.path()).iter().enumerate() {
                assert_eq!(std::fs::read(path).unwrap(), before[index]);
            }
        });
    }

    #[test]
    fn failed_backup_recovery_still_restores_remaining_profiles() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        in_profile(directory.path(), || {
            let paths = transaction_paths().unwrap();
            let primary = &paths.primary;
            let backup = model_backup(primary);
            let transaction = WorkbuddyTransaction {
                version: 1,
                phase: TransactionPhase::Prepared,
                files: vec![
                    FileChange {
                        path: backup.clone(),
                        before: None,
                        after: before[0].clone(),
                    },
                    FileChange {
                        path: primary.clone(),
                        before: Some(before[0].clone()),
                        after: b"[]".to_vec(),
                    },
                ],
                read_dependencies: Vec::new(),
            };
            std::fs::create_dir_all(paths.journal.parent().unwrap()).unwrap();
            std::fs::write(&paths.journal, serde_json::to_vec(&transaction).unwrap()).unwrap();
            std::fs::create_dir(&backup).unwrap();
            std::fs::write(primary, b"[]").unwrap();
            assert!(read_all_workbuddy_entries().is_err());
            assert_eq!(std::fs::read(primary).unwrap(), before[0]);
            assert!(paths.journal.exists());
            std::fs::remove_dir(&backup).unwrap();
            read_all_workbuddy_entries().unwrap();
            assert!(!paths.journal.exists());
        });
    }

    #[cfg(windows)]
    #[test]
    fn read_only_compatibility_failure_rolls_back_primary_without_stalling_recovery() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        let compatibility = profiles(directory.path())[1].clone();
        struct RestorePermission(PathBuf, std::fs::Permissions);
        impl Drop for RestorePermission {
            fn drop(&mut self) {
                let _ = std::fs::set_permissions(&self.0, self.1.clone());
            }
        }
        let mut permissions = std::fs::metadata(&compatibility).unwrap().permissions();
        let _restore = RestorePermission(compatibility.clone(), permissions.clone());
        permissions.set_readonly(true);
        std::fs::set_permissions(&compatibility, permissions).unwrap();
        in_profile(directory.path(), || {
            assert!(set_workbuddy_config(payload("read-only-failure")).is_err());
            assert!(!transaction_paths().unwrap().journal.exists());
            read_all_workbuddy_entries().unwrap();
            for (index, path) in profiles(directory.path()).iter().enumerate() {
                assert_eq!(std::fs::read(path).unwrap(), before[index]);
            }
        });
    }

    #[cfg(unix)]
    #[test]
    fn aliased_profiles_do_not_acquire_the_same_file_lock_twice() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        std::fs::remove_dir_all(directory.path().join(".workbuddy-ai")).unwrap();
        std::os::unix::fs::symlink(
            directory.path().join(".workbuddy"),
            directory.path().join(".workbuddy-ai"),
        )
        .unwrap();
        let mut saver = child(directory.path(), "save", "alias-update", None);
        assert!(wait_child(&mut saver).success());
        for path in profiles(directory.path()) {
            assert_eq!(ids(&path), ["alias-update", "keep"]);
        }
    }

    #[cfg(unix)]
    #[test]
    fn parent_components_follow_existing_symlink_directory_semantics() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("actual/inside");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(directory.path().join("actual/profile")).unwrap();
        std::os::unix::fs::symlink(&target, directory.path().join("link")).unwrap();
        assert_eq!(
            absolute_path(directory.path().join("link/../profile/models.json")).unwrap(),
            directory
                .path()
                .join("actual/profile")
                .canonicalize()
                .unwrap()
                .join("models.json")
        );
    }

    #[test]
    fn process_interruption_rolls_back_prepared_transaction_on_next_read() {
        let directory = tempfile::tempdir().unwrap();
        let before = fixture(directory.path());
        let mut interrupted = child(directory.path(), "save", "uncommitted", Some(2));
        wait_ready(&mut interrupted, directory.path());
        assert!(ids(&profiles(directory.path())[0]).contains(&"uncommitted".into()));
        assert!(!ids(&profiles(directory.path())[1]).contains(&"uncommitted".into()));
        interrupted.0.kill().unwrap();
        interrupted.0.wait().unwrap();
        let mut recovery = child(directory.path(), "read", "unused", None);
        assert!(wait_child(&mut recovery).success());
        for (index, path) in profiles(directory.path()).iter().enumerate() {
            assert_eq!(std::fs::read(path).unwrap(), before[index]);
        }
        assert!(!directory
            .path()
            .join(".ai-helper/workbuddy-transaction.json")
            .exists());
    }

    #[test]
    fn process_interruption_after_commit_keeps_both_new_profiles() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let mut interrupted = child(directory.path(), "save", "committed", Some(usize::MAX));
        wait_ready(&mut interrupted, directory.path());
        interrupted.0.kill().unwrap();
        interrupted.0.wait().unwrap();
        let mut recovery = child(directory.path(), "read", "unused", None);
        assert!(wait_child(&mut recovery).success());
        for path in profiles(directory.path()) {
            assert_eq!(ids(&path), ["committed", "keep"]);
        }
        assert!(!directory
            .path()
            .join(".ai-helper/workbuddy-transaction.json")
            .exists());
    }

    fn external_policy_edit(path: &std::path::Path) -> Vec<u8> {
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        value["permissions"]["deny"] = serde_json::json!(["external-security-rule"]);
        value["externalSecurityMarker"] = serde_json::json!(true);
        let bytes = serde_json::to_vec(&value).unwrap();
        std::fs::write(path, &bytes).unwrap();
        bytes
    }

    fn profile_and_backup_snapshot(root: &std::path::Path) -> Vec<Option<Vec<u8>>> {
        profiles(root)
            .iter()
            .flat_map(|path| [path.clone(), model_backup(path)])
            .map(|path| read_optional_bytes(&path).unwrap())
            .collect()
    }

    #[test]
    fn prepared_recovery_preserves_external_change_before_restoring_any_file() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let mut interrupted = child(directory.path(), "save", "uncommitted", Some(2));
        wait_ready(&mut interrupted, directory.path());
        interrupted.0.kill().unwrap();
        interrupted.0.wait().unwrap();
        // The conflict is in the last profile. Recovery must detect it before
        // rolling back the already replaced primary or its backup.
        external_policy_edit(&profiles(directory.path())[1]);
        let snapshot = profile_and_backup_snapshot(directory.path());
        let journal = directory
            .path()
            .join(".ai-helper/workbuddy-transaction.json");
        let pending = std::fs::read(&journal).unwrap();
        let mut reader = child(directory.path(), "read-conflict", "unused", None);
        assert!(wait_child(&mut reader).success());
        assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
        assert_eq!(std::fs::read(journal).unwrap(), pending);
    }

    #[test]
    fn committed_recovery_keeps_later_external_policy_fields() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let mut interrupted = child(directory.path(), "save", "committed", Some(usize::MAX));
        wait_ready(&mut interrupted, directory.path());
        interrupted.0.kill().unwrap();
        interrupted.0.wait().unwrap();
        external_policy_edit(&profiles(directory.path())[0]);
        let snapshot = profile_and_backup_snapshot(directory.path());
        let mut reader = child(directory.path(), "read", "unused", None);
        assert!(wait_child(&mut reader).success());
        assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
        assert!(!directory
            .path()
            .join(".ai-helper/workbuddy-transaction.json")
            .exists());
    }

    #[test]
    fn committed_recovery_does_not_resurrect_an_externally_deleted_profile() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let mut interrupted = child(directory.path(), "save", "committed", Some(usize::MAX));
        wait_ready(&mut interrupted, directory.path());
        interrupted.0.kill().unwrap();
        interrupted.0.wait().unwrap();
        std::fs::remove_file(&profiles(directory.path())[0]).unwrap();
        let snapshot = profile_and_backup_snapshot(directory.path());
        let journal = directory
            .path()
            .join(".ai-helper/workbuddy-transaction.json");
        let pending = std::fs::read(&journal).unwrap();
        let mut reader = child(directory.path(), "read-conflict", "unused", None);
        assert!(wait_child(&mut reader).success());
        assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
        assert_eq!(std::fs::read(journal).unwrap(), pending);
    }

    #[test]
    fn external_edits_during_staging_or_commit_preserve_every_file_and_journal() {
        // Check before the first replacement, after replacing the primary,
        // and after replacing every file but before writing Committed.
        for checkpoint in [0, 2, 4] {
            let directory = tempfile::tempdir().unwrap();
            fixture(directory.path());
            let mut saver = resumable_child(directory.path(), "save-conflict", checkpoint);
            wait_ready(&mut saver, directory.path());
            external_policy_edit(&profiles(directory.path())[1]);
            let snapshot = profile_and_backup_snapshot(directory.path());
            let journal = directory
                .path()
                .join(".ai-helper/workbuddy-transaction.json");
            let pending = std::fs::read(&journal).unwrap();
            std::fs::write(directory.path().join("child-continue"), b"continue").unwrap();
            assert!(wait_child(&mut saver).success());
            assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
            assert_eq!(std::fs::read(journal).unwrap(), pending);
        }
    }

    fn synchronization_fixture(root: &std::path::Path) -> [Vec<u8>; 2] {
        fixture(root);
        // Rotate an existing known field. Adding a previously absent field
        // changes its JSON map position under serde_json's preserve_order;
        // a later normal serialization would then reorder the same value.
        for path in profiles(root) {
            let mut value: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            value["models"][0]["apiKey"] = serde_json::json!("original-fake-key");
            std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
        in_profile(root, || {
            set_workbuddy_config(payload("source-only")).unwrap()
        });
        let [primary, compatibility] = profiles(root);
        let primary_before = std::fs::read(&primary).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&compatibility).unwrap()).unwrap();
        value["models"]
            .as_array_mut()
            .unwrap()
            .retain(|entry| entry["id"] != "source-only");
        let compatibility_before = serde_json::to_vec(&value).unwrap();
        std::fs::write(&compatibility, &compatibility_before).unwrap();
        std::fs::remove_file(model_backup(&compatibility)).unwrap();
        [primary_before, compatibility_before]
    }

    #[test]
    fn read_synchronization_keeps_unchanged_source_and_updates_compatibility() {
        let directory = tempfile::tempdir().unwrap();
        let [primary_before, compatibility_before] = synchronization_fixture(directory.path());
        let [primary, compatibility] = profiles(directory.path());
        let mut reader = child(directory.path(), "read", "unused", None);
        assert!(wait_child(&mut reader).success());
        assert_eq!(std::fs::read(&primary).unwrap(), primary_before);
        assert_eq!(ids(&primary), ["keep", "source-only"]);
        assert_eq!(ids(&compatibility), ["keep", "source-only"]);
        assert_eq!(
            std::fs::read(model_backup(&compatibility)).unwrap(),
            compatibility_before
        );
        assert!(!directory
            .path()
            .join(".ai-helper/workbuddy-transaction.json")
            .exists());
    }

    fn unchanged_sync_source_conflicts(delete_model: bool) {
        // Check before any replacement, after the compatibility backup, and
        // after both replacements but before the completion marker. The
        // unchanged source must be validated at all three points.
        for checkpoint in [0, 1, 2] {
            let directory = tempfile::tempdir().unwrap();
            let [_, compatibility_before] = synchronization_fixture(directory.path());
            let [primary, compatibility] = profiles(directory.path());
            let mut reader = resumable_child(directory.path(), "read-conflict", checkpoint);
            wait_ready(&mut reader, directory.path());
            let journal = directory
                .path()
                .join(".ai-helper/workbuddy-transaction.json");
            let transaction = read_transaction(&journal).unwrap().unwrap();
            assert_eq!(transaction.files.len(), 2);
            assert_eq!(
                transaction.read_dependencies,
                [absolute_path(primary.clone()).unwrap()]
            );
            assert!(transaction
                .files
                .iter()
                .all(|file| file.path != absolute_path(primary.clone()).unwrap()));
            let pending = std::fs::read(&journal).unwrap();
            let mut value: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&primary).unwrap()).unwrap();
            value["externalSourceEdit"] = serde_json::json!(true);
            if delete_model {
                value["models"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|entry| entry["id"] != "source-only");
            } else {
                let keep = value["models"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|entry| entry["id"] == "keep")
                    .unwrap();
                keep["apiKey"] = serde_json::json!("externally-rotated-fake-key");
            }
            let edited = serde_json::to_vec_pretty(&value).unwrap();
            std::fs::write(&primary, &edited).unwrap();
            let snapshot = profile_and_backup_snapshot(directory.path());
            std::fs::write(directory.path().join("child-continue"), b"continue").unwrap();
            assert!(wait_child(&mut reader).success());
            assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
            assert_eq!(std::fs::read(&journal).unwrap(), pending);
            if checkpoint < 2 {
                // Reject stale output before it reaches the profile. A
                // completed replacement at checkpoint 2 is rolled back by
                // the next read before it can become a merge input.
                assert_eq!(std::fs::read(&compatibility).unwrap(), compatibility_before);
            }

            let mut recovery = child(directory.path(), "read", "unused", None);
            assert!(wait_child(&mut recovery).success());
            assert!(!journal.exists());
            assert_eq!(std::fs::read(&primary).unwrap(), edited);
            for path in [&primary, &compatibility] {
                if delete_model {
                    assert_eq!(ids(path), ["keep"]);
                } else {
                    assert_eq!(ids(path), ["keep", "source-only"]);
                    let entries = read_workbuddy_entries(path).unwrap();
                    let keep = entries.iter().find(|entry| entry.id == "keep").unwrap();
                    assert_eq!(keep.api_key.as_deref(), Some("externally-rotated-fake-key"));
                }
            }
        }
    }

    #[test]
    fn read_synchronization_rejects_rotated_credentials_in_unchanged_source() {
        unchanged_sync_source_conflicts(false);
    }

    #[test]
    fn read_synchronization_does_not_resurrect_model_deleted_from_unchanged_source() {
        unchanged_sync_source_conflicts(true);
    }

    #[test]
    fn recovery_does_not_recreate_deleted_unchanged_source_from_backup() {
        for checkpoint in [0, 1, 2, usize::MAX] {
            let directory = tempfile::tempdir().unwrap();
            synchronization_fixture(directory.path());
            let [primary, _] = profiles(directory.path());
            let mut reader = resumable_child(directory.path(), "read-conflict", checkpoint);
            wait_ready(&mut reader, directory.path());
            let journal = directory
                .path()
                .join(".ai-helper/workbuddy-transaction.json");
            let transaction = read_transaction(&journal).unwrap().unwrap();
            assert_eq!(
                transaction.read_dependencies,
                [absolute_path(primary.clone()).unwrap()]
            );
            let pending = std::fs::read(&journal).unwrap();
            if checkpoint == usize::MAX {
                // Exercise a leftover durable Committed marker as well as
                // Prepared journals kept after an in-process conflict.
                reader.0.kill().unwrap();
                reader.0.wait().unwrap();
            }
            assert!(model_backup(&primary).exists());
            std::fs::remove_file(&primary).unwrap();
            let snapshot = profile_and_backup_snapshot(directory.path());
            if checkpoint != usize::MAX {
                std::fs::write(directory.path().join("child-continue"), b"continue").unwrap();
                assert!(wait_child(&mut reader).success());
                assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
                assert_eq!(std::fs::read(&journal).unwrap(), pending);
            }
            for action in ["read-conflict", "save-conflict"] {
                let mut recovery = child(directory.path(), action, "unused", None);
                assert!(wait_child(&mut recovery).success());
                assert!(!primary.exists());
                assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
                assert_eq!(std::fs::read(&journal).unwrap(), pending);
            }
        }
    }

    fn interrupted_legacy_synchronization(root: &std::path::Path) -> PathBuf {
        synchronization_fixture(root);
        let mut reader = child(root, "read", "unused", Some(1));
        wait_ready(&mut reader, root);
        reader.0.kill().unwrap();
        reader.0.wait().unwrap();
        let journal = root.join(".ai-helper/workbuddy-transaction.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&journal).unwrap()).unwrap();
        assert_eq!(value["version"], 2);
        value["version"] = serde_json::json!(1);
        value.as_object_mut().unwrap().remove("read_dependencies");
        std::fs::write(&journal, serde_json::to_vec(&value).unwrap()).unwrap();
        journal
    }

    #[test]
    fn legacy_journal_recovers_with_existing_unchanged_source() {
        let directory = tempfile::tempdir().unwrap();
        let journal = interrupted_legacy_synchronization(directory.path());
        let [primary, compatibility] = profiles(directory.path());
        let primary_before = std::fs::read(&primary).unwrap();
        let mut recovery = child(directory.path(), "read", "unused", None);
        assert!(wait_child(&mut recovery).success());
        assert!(!journal.exists());
        assert_eq!(std::fs::read(&primary).unwrap(), primary_before);
        assert_eq!(ids(&primary), ["keep", "source-only"]);
        assert_eq!(ids(&compatibility), ["keep", "source-only"]);
    }

    #[test]
    fn legacy_journal_does_not_recreate_missing_nonwritten_source() {
        let directory = tempfile::tempdir().unwrap();
        let journal = interrupted_legacy_synchronization(directory.path());
        let [primary, _] = profiles(directory.path());
        assert!(model_backup(&primary).exists());
        std::fs::remove_file(&primary).unwrap();
        let snapshot = profile_and_backup_snapshot(directory.path());
        let pending = std::fs::read(&journal).unwrap();
        for action in ["read-conflict", "save-conflict"] {
            let mut recovery = child(directory.path(), action, "unused", None);
            assert!(wait_child(&mut recovery).success());
            assert!(!primary.exists());
            assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
            assert_eq!(std::fs::read(&journal).unwrap(), pending);
        }
    }

    #[test]
    fn future_journal_version_blocks_operations_without_changes() {
        let directory = tempfile::tempdir().unwrap();
        let journal = interrupted_legacy_synchronization(directory.path());
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&journal).unwrap()).unwrap();
        value["version"] = serde_json::json!(3);
        let pending = serde_json::to_vec(&value).unwrap();
        std::fs::write(&journal, &pending).unwrap();
        let snapshot = profile_and_backup_snapshot(directory.path());
        in_profile(directory.path(), || {
            assert!(read_all_workbuddy_entries()
                .unwrap_err()
                .to_string()
                .contains("事务记录无效"));
            assert!(set_workbuddy_config(payload("blocked")).is_err());
            assert!(delete_workbuddy_model("keep".into()).is_err());
        });
        assert_eq!(profile_and_backup_snapshot(directory.path()), snapshot);
        assert_eq!(std::fs::read(&journal).unwrap(), pending);
    }

    #[cfg(windows)]
    fn directory_junction(target: &std::path::Path, link: &std::path::Path) {
        use std::os::windows::process::CommandExt;
        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "New-Item -ItemType Junction -Path $env:AI_HELPER_TEST_JUNCTION_LINK -Target $env:AI_HELPER_TEST_JUNCTION_TARGET -ErrorAction Stop | Out-Null",
            ])
            .env("AI_HELPER_TEST_JUNCTION_LINK", link)
            .env("AI_HELPER_TEST_JUNCTION_TARGET", target)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(windows)]
    #[test]
    fn broken_parent_directory_junction_heals_through_actual_save() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("deleted-target");
        std::fs::create_dir(&target).unwrap();
        let link = directory.path().join(".workbuddy");
        directory_junction(&target, &link);
        std::fs::remove_dir(&target).unwrap();
        let mut saver = child(directory.path(), "save", "healed-junction", None);
        assert!(wait_child(&mut saver).success());
        let metadata = std::fs::symlink_metadata(&link).unwrap();
        assert!(metadata.is_dir());
        assert!(!metadata.file_type().is_symlink());
        assert_eq!(ids(&link.join("models.json")), ["healed-junction"]);
        assert!(!target.exists());
    }

    #[cfg(windows)]
    #[test]
    fn valid_parent_directory_junction_is_preserved_through_actual_save() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("actual-target");
        std::fs::create_dir(&target).unwrap();
        let sentinel = target.join("untouched-policy");
        std::fs::write(&sentinel, b"keep").unwrap();
        let link = directory.path().join(".workbuddy");
        directory_junction(&target, &link);
        let mut saver = child(directory.path(), "save", "linked-profile", None);
        assert!(wait_child(&mut saver).success());
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(ids(&target.join("models.json")), ["linked-profile"]);
        assert_eq!(std::fs::read(sentinel).unwrap(), b"keep");
    }

    #[test]
    fn explicit_profiles_do_not_add_default_home_candidates() {
        let paths = candidate_paths(
            vec![PathBuf::from("isolated-a"), PathBuf::from("isolated-b")],
            Some(PathBuf::from("unused-home")),
        );
        assert_eq!(
            paths,
            [
                PathBuf::from("isolated-a/models.json"),
                PathBuf::from("isolated-b/models.json")
            ]
        );
    }

    #[test]
    fn paths_stay_stable_when_parent_directories_are_created() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("new-profile/models.json");
        let before = absolute_path(path.clone()).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        assert_eq!(before, absolute_path(path).unwrap());
    }

    #[test]
    fn test_parse_multi_model_json_with_and_without_api() {
        let sample = r#"[
  {
    "id": "gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "api": "openai-responses",
    "apiKey": "sk-test1",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false,
    "reasoning": {
      "supportedEfforts": [
        "medium"
      ]
    },
    "maxInputTokens": 32768,
    "maxOutputTokens": 32768
  },
  {
    "id": "gpt-6-sol",
    "name": "gpt-6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "apiKey": "sk-test2",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false,
    "reasoning": {
      "supportedEfforts": [
        "medium"
      ]
    },
    "maxInputTokens": 32768,
    "maxOutputTokens": 32768
  }
]"#;

        let entries = parse_workbuddy_entries_from_str(sample).expect("valid sample");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "gpt-5.6-sol");
        assert_eq!(entries[0].api, Some("openai-responses".to_string()));
        assert_eq!(entries[1].id, "gpt-6-sol");
        assert_eq!(entries[1].api, None);
    }

    #[test]
    fn test_parse_corrupt_json_fails() {
        let corrupt = r#"{"id": "gpt-5", "name":"#;
        let res = parse_workbuddy_entries_from_str(corrupt);
        assert!(res.is_err(), "Corrupted config must fail to parse");
    }

    #[test]
    fn test_append_new_model_does_not_overwrite_existing() {
        let sample = r#"[
  {
    "id": "gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "api": "openai-responses",
    "apiKey": "sk-test1",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false
  }
]"#;

        let mut entries = parse_workbuddy_entries_from_str(sample).expect("valid sample");
        assert_eq!(entries.len(), 1);

        let new_model_id = "gpt-6-sol".to_string();
        let new_entry = WorkbuddyModelEntry {
            id: new_model_id.clone(),
            name: new_model_id.clone(),
            vendor: "Custom".to_string(),
            url: "https://bob-api.com/v1".to_string(),
            api: Some("openai-responses".to_string()),
            api_key: Some("sk-test2".to_string()),
            supports_tool_call: true,
            supports_images: true,
            supports_reasoning: true,
            only_reasoning: None,
            use_custom_protocol: false,
            reasoning: None,
            max_input_tokens: Some(32768),
            max_output_tokens: Some(32768),
            temperature: None,
            disabled: None,
            extra: serde_json::Map::new(),
        };

        // 仅匹配同 ID
        if let Some(idx) = entries.iter().position(|e| e.id == new_model_id) {
            entries[idx] = new_entry;
        } else {
            entries.push(new_entry);
        }

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "gpt-5.6-sol");
        assert_eq!(entries[1].id, "gpt-6-sol");
    }

    #[test]
    fn test_update_model_with_same_id() {
        let sample = r#"[
  {
    "id": "gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "apiKey": "sk-old",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false
  }
]"#;

        let mut entries = parse_workbuddy_entries_from_str(sample).expect("valid sample");
        assert_eq!(entries.len(), 1);

        let update_id = "gpt-5.6-sol".to_string();
        let updated_entry = WorkbuddyModelEntry {
            id: update_id.clone(),
            name: update_id.clone(),
            vendor: "Custom".to_string(),
            url: "https://bob-api.com/v1".to_string(),
            api: Some("openai-responses".to_string()),
            api_key: Some("sk-new".to_string()),
            supports_tool_call: true,
            supports_images: true,
            supports_reasoning: true,
            only_reasoning: None,
            use_custom_protocol: false,
            reasoning: None,
            max_input_tokens: Some(65536),
            max_output_tokens: Some(65536),
            temperature: None,
            disabled: None,
            extra: serde_json::Map::new(),
        };

        if let Some(idx) = entries.iter().position(|e| e.id == update_id) {
            entries[idx] = updated_entry;
        } else {
            entries.push(updated_entry);
        }

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "gpt-5.6-sol");
        assert_eq!(entries[0].api_key, Some("sk-new".to_string()));
        assert_eq!(entries[0].max_input_tokens, Some(65536));
    }

    #[test]
    fn test_candidate_paths_contain_standard_and_ai() {
        let paths = get_all_workbuddy_config_paths();
        assert!(!paths.is_empty());
        let has_std = paths.iter().any(|p| {
            p.ends_with(".workbuddy\\models.json") || p.ends_with(".workbuddy/models.json")
        });
        let has_ai = paths.iter().any(|p| {
            p.ends_with(".workbuddy-ai\\models.json") || p.ends_with(".workbuddy-ai/models.json")
        });
        assert!(
            has_std,
            "Candidate paths must contain standard .workbuddy/models.json"
        );
        assert!(
            has_ai,
            "Candidate paths must contain compatible .workbuddy-ai/models.json"
        );
    }

    #[test]
    fn test_workbuddy_primary_config_path_defaults_to_standard() {
        let primary = workbuddy_primary_config_path().expect("should return primary path");
        assert!(
            primary.ends_with(".workbuddy\\models.json")
                || primary.ends_with(".workbuddy/models.json"),
            "Primary path should default to .workbuddy/models.json"
        );
    }

    #[test]
    fn test_read_all_workbuddy_entries_does_not_panic() {
        let (entries, primary_path, _exists) =
            read_all_workbuddy_entries().expect("read entries successfully");
        assert!(
            primary_path.ends_with(".workbuddy\\models.json")
                || primary_path.ends_with(".workbuddy/models.json"),
            "Primary path should be standard"
        );
        // 如果当前环境中存在 .workbuddy-ai/models.json，自动同步后主路径也应存在
        if !entries.is_empty() {
            assert!(
                primary_path.exists(),
                "Primary path should have been auto-synced"
            );
        }
    }

    #[test]
    fn deterministic_lock_contention_blocks_competing_writer_until_release() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        // Child 1 holds the lock at transaction checkpoint (paused)
        let mut holder = child(directory.path(), "save", "first-holder", Some(2));
        wait_ready(&mut holder, directory.path());

        // Child 2 attempts to write while Child 1 holds the transaction locks
        let mut competing = child(directory.path(), "save", "second-competing", None);

        // Competing writer must be blocked waiting for the locks held by Child 1
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(
            competing.0.try_wait().unwrap().is_none(),
            "Competing writer must be blocked by the lock held by the first writer"
        );

        // Terminate the holder (which drops its OS locks)
        holder.0.kill().unwrap();
        holder.0.wait().unwrap();

        // Competing writer must now acquire the locks, recover any uncommitted state, and complete
        assert!(wait_child(&mut competing).success());

        // Verify the competing write completed and is readable
        for path in profiles(directory.path()) {
            assert!(ids(&path).contains(&"second-competing".into()));
        }
    }
}

#[cfg(all(test, not(target_os = "windows")))]
mod unix_filesystem_tests {
    use super::tests::{fixture, in_profile, payload};
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn symlink_to_readonly_mount_fails_gracefully() {
        let directory = tempfile::tempdir().unwrap();
        let readonly_target = directory.path().join("readonly_target");
        let readonly_models = readonly_target.join("models.json");
        std::fs::create_dir_all(&readonly_target).unwrap();
        std::fs::write(&readonly_models, b"[]").unwrap();

        // 模拟只读：设置文件和目录为只读
        let mut perms = std::fs::metadata(&readonly_target).unwrap().permissions();
        perms.set_mode(0o555); // r-xr-xr-x
        std::fs::set_permissions(&readonly_target, perms).unwrap();

        let symlink_dir = directory.path().join(".workbuddy");
        std::fs::create_dir_all(&symlink_dir).unwrap();
        let symlink_path = symlink_dir.join("models.json");
        std::os::unix::fs::symlink(&readonly_models, &symlink_path).unwrap();

        in_profile(directory.path(), || {
            // 尝试写入应该失败并提供清晰错误（拒绝符号链接或只读权限错误）
            let result = set_workbuddy_config(payload("test-readonly"));
            assert!(result.is_err());
            let error_msg = result.unwrap_err().to_string();
            assert!(
                error_msg.contains("符号链接")
                    || error_msg.contains("Permission denied")
                    || error_msg.contains("只读"),
                "错误信息应说明符号链接或权限问题: {}",
                error_msg
            );
        });

        // 清理：恢复可写权限以便删除
        let mut perms = std::fs::metadata(&readonly_target).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&readonly_target, perms).unwrap();
    }

    #[test]
    fn broken_symlink_is_treated_as_nonexistent() {
        let directory = tempfile::tempdir().unwrap();
        let config_dir = directory.path().join(".workbuddy");
        std::fs::create_dir_all(&config_dir).unwrap();

        let broken_symlink = config_dir.join("models.json");
        let nonexistent_target = directory.path().join("deleted/models.json");
        std::os::unix::fs::symlink(&nonexistent_target, &broken_symlink).unwrap();

        in_profile(directory.path(), || {
            // 损坏的符号链接应被自愈移除并视为不存在，允许创建新文件
            let result = set_workbuddy_config(payload("test-new"));
            assert!(result.is_ok(), "应该能创建新配置: {:?}", result);

            // 验证实际创建了普通文件（而非符号链接）
            let metadata = std::fs::symlink_metadata(&broken_symlink).unwrap();
            assert!(
                !metadata.file_type().is_symlink(),
                "应创建普通文件而非符号链接"
            );
        });
    }

    #[test]
    fn nested_symlink_parent_directories_follow_correctly() {
        let directory = tempfile::tempdir().unwrap();
        let actual_config = directory.path().join("actual_config");
        std::fs::create_dir_all(&actual_config).unwrap();

        let link_parent = directory.path().join(".workbuddy");
        std::os::unix::fs::symlink(&actual_config, &link_parent).unwrap();

        in_profile(directory.path(), || {
            set_workbuddy_config(payload("test-symlink-parent")).unwrap();

            // 验证文件实际写入到符号链接目录目标
            let actual_file = actual_config.join("models.json");
            assert!(actual_file.exists(), "应写入符号链接目标位置");

            let content = std::fs::read_to_string(&actual_file).unwrap();
            assert!(content.contains("test-symlink-parent"));
        });
    }

    #[test]
    fn concurrent_writers_with_file_locks_prevent_corruption() {
        let directory = tempfile::tempdir().unwrap();
        fixture(directory.path());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));

        let handles: Vec<_> = (0..4)
            .map(|index| {
                let dir = directory.path().to_owned();
                let b = barrier.clone();
                std::thread::spawn(move || {
                    b.wait();
                    in_profile(&dir, || {
                        let model_id = format!("concurrent-{}", index);
                        set_workbuddy_config(payload(&model_id)).unwrap();
                        let entries = read_all_workbuddy_entries().unwrap().0;
                        assert!(
                            entries.iter().any(|e| e.id == model_id),
                            "写入的模型应可读取"
                        );
                    });
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap();
        }

        // 验证最终状态包含所有并发写入
        in_profile(directory.path(), || {
            let entries = read_all_workbuddy_entries().unwrap().0;
            let ids: Vec<_> = entries.iter().map(|e| &e.id).collect();
            for index in 0..4 {
                let expected = format!("concurrent-{}", index);
                assert!(
                    ids.iter().any(|id| id.as_str() == expected),
                    "并发写入的模型 {} 应存在于最终结果",
                    expected
                );
            }
        });
    }

    #[test]
    fn broken_parent_directory_symlink_heals_and_allows_write() {
        let directory = tempfile::tempdir().unwrap();
        let nonexistent_parent = directory.path().join("deleted_parent_dir");
        let broken_parent = directory.path().join(".workbuddy");
        std::os::unix::fs::symlink(&nonexistent_parent, &broken_parent).unwrap();

        in_profile(directory.path(), || {
            // Broken parent symlink should be auto-healed so writing succeeds
            let result = set_workbuddy_config(payload("test-parent-healed"));
            assert!(result.is_ok(), "损坏的父目录软链应被自愈: {:?}", result);

            // Verify .workbuddy is now a valid directory and models.json was created
            let metadata = std::fs::symlink_metadata(&broken_parent).unwrap();
            assert!(
                !metadata.file_type().is_symlink(),
                "自愈后应为普通目录而非断损软链"
            );
            let models_file = broken_parent.join("models.json");
            assert!(models_file.exists());
        });
    }

    #[test]
    fn readonly_directory_for_regular_file_fails_gracefully() {
        unsafe extern "C" {
            fn geteuid() -> u32;
        }
        if unsafe { geteuid() } == 0 {
            // Root user bypasses standard Unix file permissions; skip in container/root environments
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let config_dir = directory.path().join(".workbuddy");
        std::fs::create_dir_all(&config_dir).unwrap();
        let models_path = config_dir.join("models.json");
        std::fs::write(&models_path, b"[]").unwrap();

        // 模拟普通文件位于只读目录：把父目录设为 0555
        let mut perms = std::fs::metadata(&config_dir).unwrap().permissions();
        perms.set_mode(0o555);
        std::fs::set_permissions(&config_dir, perms).unwrap();

        in_profile(directory.path(), || {
            let result = set_workbuddy_config(payload("test-readonly-dir"));
            assert!(result.is_err(), "向只读目录更新普通文件应失败");
            let error_msg = result.unwrap_err().to_string();
            assert!(
                error_msg.contains("Permission denied")
                    || error_msg.contains("拒绝")
                    || error_msg.contains("IO 错误"),
                "错误信息应反映目录写权限问题: {}",
                error_msg
            );
        });

        // 清理：恢复可写权限
        let mut perms = std::fs::metadata(&config_dir).unwrap().permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(&config_dir, perms);
    }
}

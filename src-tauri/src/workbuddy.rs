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
    if transaction.version != 1 || transaction.files.is_empty() || transaction.files.len() > 16 {
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
    let mut seen = std::collections::HashSet::new();
    if transaction.files.iter().any(|file| {
        !file.path.is_absolute()
            || !matches!(
                file.path.file_name().and_then(|name| name.to_str()),
                Some("models.json" | "models.json.bak")
            )
            || !seen.insert(path_key(&file.path))
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

fn restore_transaction(
    transaction: &WorkbuddyTransaction,
    committed: bool,
) -> Result<(), AppError> {
    let mut failure = None;
    for file in &transaction.files {
        let contents = if committed {
            Some(file.after.as_slice())
        } else {
            file.before.as_deref()
        };
        // A failed replacement may leave its old file intact (for example a
        // read-only Windows profile). Do not require another write to restore
        // bytes that already match the intended recovery state.
        if let Ok(current) = read_optional_bytes(&file.path) {
            if current.as_deref() == contents {
                continue;
            }
        }
        let result = if let Some(contents) = contents {
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

fn with_workbuddy_transaction<T>(
    paths: &WorkbuddyPaths,
    operation: impl FnOnce(&[PathBuf]) -> Result<T, AppError>,
) -> Result<T, AppError> {
    // All application profiles share this coordinator. Configuration and backup
    // locks are acquired in one stable order, including paths in a crash journal.
    crate::safe_fs::with_file_lock(&paths.journal, || {
        let pending = read_transaction(&paths.journal)?;
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
        let mut locked = active
            .iter()
            .flat_map(|path| [path.clone(), model_backup(path)])
            .collect::<Vec<_>>();
        if let Some(pending) = &pending {
            locked.extend(pending.files.iter().map(|file| file.path.clone()));
        }
        locked.sort_by_key(|path| path_key(path));
        locked.dedup_by(|left, right| path_key(left) == path_key(right));
        with_path_locks(&locked, || {
            if let Some(pending) = pending {
                recover_transaction(&paths.journal, &pending)?;
            }
            // Recovery must precede the read/merge snapshot, not the final write.
            for path in &active {
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
    let mut transaction = WorkbuddyTransaction {
        version: 1,
        phase: TransactionPhase::Prepared,
        files,
    };
    let staged = transaction
        .files
        .iter()
        .map(|file| crate::safe_fs::prepare_write_locked(&file.path, &file.after))
        .collect::<Result<Vec<_>, _>>()?;
    crate::safe_fs::atomic_write_locked(&paths.journal, serde_json::to_vec(&transaction)?)?;
    let result = staged
        .into_iter()
        .enumerate()
        .try_for_each(|(index, staged)| {
            staged
                .commit()
                .and_then(|_| transaction_checkpoint(index + 1))
        });
    // Drop every uncommitted staging file before allocating rollback files.
    if let Err(error) = result {
        return rollback_failed_transaction(paths, &transaction, error);
    }
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
    // The complete new state and commit marker are durable. A leftover committed
    // journal is safe to replay; cleanup failure does not undo a committed update.
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
    let mut model = "gpt-5.6-sol".to_string();

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

    fn in_profile<T>(root: &std::path::Path, operation: impl FnOnce() -> T) -> T {
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

    fn payload(model: &str) -> WorkbuddySavePayload {
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

    fn fixture(root: &std::path::Path) -> [Vec<u8>; 2] {
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

    fn child(
        root: &std::path::Path,
        action: &str,
        model: &str,
        pause: Option<usize>,
    ) -> ChildGuard {
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
            .stdout(Stdio::null());
        if let Some(writes) = pause {
            command
                .env("AI_HELPER_TEST_WORKBUDDY_PAUSE_AFTER", writes.to_string())
                .env("AI_HELPER_TEST_WORKBUDDY_READY", root.join("child-ready"));
        }
        ChildGuard(command.spawn().unwrap())
    }

    fn wait_child(child: &mut ChildGuard) -> std::process::ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "WorkBuddy transaction exceeded subprocess deadline"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_ready(child: &mut ChildGuard, root: &std::path::Path) {
        let deadline = Instant::now() + Duration::from_secs(15);
        while !root.join("child-ready").exists() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "child exited before transaction checkpoint"
            );
            assert!(
                Instant::now() < deadline,
                "child did not reach transaction checkpoint"
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
            "delete" => {
                delete_workbuddy_model(model).unwrap();
            }
            "read" => {
                read_all_workbuddy_entries().unwrap();
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
}

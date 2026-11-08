//! Cursor Agent 工作区写入授权
//!
//! - 读类工具只受工作区边界约束；写类工具（写入、替换、建目录、删除）要求目标
//!   位于用户已授权的工作区根目录之内。
//! - 授权保存在 `~/.ai-helper/agent_workspaces.json`，经 reset 配置写锁与
//!   safe_fs 原子写入；一键重置时作为 AI Helper 自有文件删除。
//! - 未授权的写入会在内存中登记待授权请求（按路径去重，最多 20 条），由用户在
//!   AI Helper 的 Cursor 面板中允许或拒绝。

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MAX_PENDING_REQUESTS: usize = 20;
pub const UNAUTHORIZED_WRITE_MESSAGE: &str =
    "该工作区尚未授权 AI Helper 修改文件，请在 AI Helper 的 Cursor 面板中允许后重试";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorkspaceRequest {
    pub path: String,
    pub requested_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceGrant {
    pub path: String,
    pub granted_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct GrantFile {
    version: u32,
    #[serde(default)]
    grants: Vec<WorkspaceGrant>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 规则：拒绝盘符根或文件系统根、用户主目录本身，以及 `~/.ai-helper` 及其子目录。
/// `canonical` 必须是 canonicalize 之后的目录。
pub fn validate_root(canonical: &Path) -> Result<(), String> {
    let home = dirs::home_dir().and_then(|home| std::fs::canonicalize(home).ok());
    validate_root_with_home(canonical, home.as_deref())
}

fn validate_root_with_home(canonical: &Path, home: Option<&Path>) -> Result<(), String> {
    if canonical.parent().is_none() {
        return Err("不能把盘符根目录或文件系统根目录作为工作区".into());
    }
    if let Some(home) = home {
        if canonical == home {
            return Err("不能把用户主目录本身作为工作区".into());
        }
        if canonical.starts_with(home.join(".ai-helper")) {
            return Err("不能把 AI Helper 的数据目录作为工作区".into());
        }
    }
    Ok(())
}

/// 把请求中的目录解析为合法的工作区根；不合法时返回 None。
pub fn canonical_root(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let canonical = std::fs::canonicalize(raw).ok()?;
    if !canonical.is_dir() || validate_root(&canonical).is_err() {
        return None;
    }
    Some(canonical)
}

#[derive(Debug)]
pub struct WorkspaceAuthStore {
    path: PathBuf,
    pending: Mutex<Vec<WorkspaceRequest>>,
}

impl WorkspaceAuthStore {
    pub fn with_path(path: PathBuf) -> Self {
        Self {
            path,
            pending: Mutex::new(Vec::new()),
        }
    }

    fn pending_guard(&self) -> std::sync::MutexGuard<'_, Vec<WorkspaceRequest>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn load_locked(&self) -> Result<GrantFile, AppError> {
        let Some(raw) = crate::safe_fs::read_optional_locked(&self.path)? else {
            return Ok(GrantFile {
                version: 1,
                grants: Vec::new(),
            });
        };
        serde_json::from_slice(&raw)
            .map_err(|_| AppError::Other("Agent 工作区授权记录损坏，已拒绝写入".into()))
    }

    pub fn grants(&self) -> Result<Vec<WorkspaceGrant>, AppError> {
        crate::safe_fs::with_file_lock(&self.path, || self.load_locked()).map(|file| file.grants)
    }

    fn update_grants(
        &self,
        update: impl FnOnce(&mut Vec<WorkspaceGrant>) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        crate::reset::with_config_write(|| {
            crate::safe_fs::with_file_lock(&self.path, || {
                let mut file = self.load_locked()?;
                update(&mut file.grants)?;
                file.version = 1;
                crate::safe_fs::atomic_write_locked(&self.path, serde_json::to_vec_pretty(&file)?)
            })
        })
    }

    /// 目标（canonical）路径位于某个已授权根之内即允许写入。
    pub fn is_write_allowed(&self, target: &Path) -> Result<bool, AppError> {
        Ok(self
            .grants()?
            .iter()
            .any(|grant| target.starts_with(Path::new(&grant.path))))
    }

    /// 登记一条待授权请求：按路径去重，超过上限时丢弃最早的一条。
    pub fn request(&self, root: &Path) {
        let path = root.to_string_lossy().into_owned();
        let mut pending = self.pending_guard();
        if pending.iter().any(|request| request.path == path) {
            return;
        }
        if pending.len() >= MAX_PENDING_REQUESTS {
            pending.remove(0);
        }
        pending.push(WorkspaceRequest {
            path,
            requested_at: now_secs(),
        });
    }

    pub fn pending(&self) -> Vec<WorkspaceRequest> {
        self.pending_guard().clone()
    }

    /// 只能授权已在待授权列表或已授权列表中的路径，并重新校验根目录规则。
    pub fn grant(&self, raw: &str) -> Result<(), AppError> {
        let canonical = std::fs::canonicalize(raw.trim())
            .map_err(|_| AppError::Other("工作区目录不存在或无法访问".into()))?;
        if !canonical.is_dir() {
            return Err(AppError::Other("只能授权目录".into()));
        }
        validate_root(&canonical).map_err(AppError::Other)?;
        let path = canonical.to_string_lossy().into_owned();
        let requested = self.pending_guard().iter().any(|r| r.path == path);
        let granted = self.grants()?.iter().any(|g| g.path == path);
        if !requested && !granted {
            return Err(AppError::Other(
                "只能授权 Cursor Agent 已请求过的工作区".into(),
            ));
        }
        if !granted {
            self.update_grants(|grants| {
                if !grants.iter().any(|g| g.path == path) {
                    grants.push(WorkspaceGrant {
                        path: path.clone(),
                        granted_at: now_secs(),
                    });
                }
                Ok(())
            })?;
        }
        self.pending_guard().retain(|r| r.path != path);
        Ok(())
    }

    pub fn deny(&self, path: &str) {
        self.pending_guard().retain(|r| r.path != path);
    }

    /// 撤销按记录中的路径字符串匹配，目录被删除后仍可撤销。
    pub fn revoke(&self, path: &str) -> Result<(), AppError> {
        let canonical = std::fs::canonicalize(path.trim())
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        self.update_grants(|grants| {
            let before = grants.len();
            grants.retain(|g| g.path != path && Some(&g.path) != canonical.as_ref());
            if grants.len() == before {
                return Err(AppError::Other("该工作区未被授权".into()));
            }
            Ok(())
        })
    }

    /// 一键重置删除授权文件后，同时清空内存中的待授权请求。
    pub fn clear_pending(&self) {
        self.pending_guard().clear();
    }

    #[cfg(test)]
    pub fn file_path(&self) -> &Path {
        &self.path
    }
}

pub fn agent_workspaces_path() -> Result<PathBuf, AppError> {
    #[cfg(test)]
    {
        static DIRECTORY: once_cell::sync::Lazy<tempfile::TempDir> =
            once_cell::sync::Lazy::new(|| tempfile::tempdir().expect("isolated workspace grants"));
        Ok(DIRECTORY.path().join("agent_workspaces.json"))
    }
    #[cfg(not(test))]
    {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".into()))?;
        Ok(home.join(".ai-helper").join("agent_workspaces.json"))
    }
}

static GLOBAL: once_cell::sync::Lazy<Option<Arc<WorkspaceAuthStore>>> =
    once_cell::sync::Lazy::new(|| {
        agent_workspaces_path()
            .ok()
            .map(|path| Arc::new(WorkspaceAuthStore::with_path(path)))
    });

/// 全局授权存储；无法确定主目录时返回 None（此时所有写入都会被拒绝）。
pub fn global() -> Option<Arc<WorkspaceAuthStore>> {
    GLOBAL.clone()
}

fn require_global() -> Result<Arc<WorkspaceAuthStore>, String> {
    global().ok_or_else(|| "无法确定 Agent 工作区授权文件位置".to_string())
}

pub fn list_requests() -> Result<Vec<WorkspaceRequest>, String> {
    Ok(require_global()?.pending())
}

pub fn list_grants() -> Result<Vec<WorkspaceGrant>, String> {
    require_global()?.grants().map_err(|e| e.to_string())
}

pub fn grant(path: &str) -> Result<(), String> {
    require_global()?.grant(path).map_err(|e| e.to_string())
}

pub fn deny(path: &str) -> Result<(), String> {
    require_global()?.deny(path);
    Ok(())
}

pub fn revoke(path: &str) -> Result<(), String> {
    require_global()?.revoke(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(directory: &Path) -> WorkspaceAuthStore {
        WorkspaceAuthStore::with_path(directory.join("agent_workspaces.json"))
    }

    #[test]
    fn grant_requires_a_pending_request_and_persists() {
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(workspace.path()).unwrap();
        let store = store(data.path());

        assert!(store.grant(&root.to_string_lossy()).is_err());
        assert!(!store.is_write_allowed(&root.join("a.txt")).unwrap());

        store.request(&root);
        assert_eq!(store.pending().len(), 1);
        store.grant(&root.to_string_lossy()).unwrap();
        assert!(store.pending().is_empty());
        assert!(store.is_write_allowed(&root.join("nested/a.txt")).unwrap());

        // Grants survive a restart (a fresh store reading the same file).
        let reloaded = WorkspaceAuthStore::with_path(store.file_path().to_path_buf());
        assert!(reloaded.is_write_allowed(&root.join("a.txt")).unwrap());

        reloaded.revoke(&root.to_string_lossy()).unwrap();
        assert!(!reloaded.is_write_allowed(&root.join("a.txt")).unwrap());
        assert!(reloaded.revoke(&root.to_string_lossy()).is_err());
    }

    #[test]
    fn pending_requests_are_deduplicated_capped_and_deniable() {
        let data = tempfile::tempdir().unwrap();
        let store = store(data.path());
        let root = PathBuf::from("/workspace/a");
        store.request(&root);
        store.request(&root);
        assert_eq!(store.pending().len(), 1);
        for index in 0..30 {
            store.request(&PathBuf::from(format!("/workspace/{index}")));
        }
        let pending = store.pending();
        assert_eq!(pending.len(), MAX_PENDING_REQUESTS);
        assert_eq!(
            pending.last().unwrap().path,
            PathBuf::from("/workspace/29").to_string_lossy()
        );
        store.deny(&pending[0].path);
        assert_eq!(store.pending().len(), MAX_PENDING_REQUESTS - 1);
    }

    #[test]
    fn root_rules_reject_filesystem_root_home_and_ai_helper_data() {
        let home = tempfile::tempdir().unwrap();
        let home = std::fs::canonicalize(home.path()).unwrap();
        let project = home.join("project");
        let data = home.join(".ai-helper").join("sub");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&data).unwrap();

        let filesystem_root = project.ancestors().last().unwrap();
        assert!(validate_root_with_home(filesystem_root, Some(&home)).is_err());
        assert!(validate_root_with_home(&home, Some(&home)).is_err());
        assert!(validate_root_with_home(&home.join(".ai-helper"), Some(&home)).is_err());
        assert!(validate_root_with_home(&data, Some(&home)).is_err());
        assert!(validate_root_with_home(&project, Some(&home)).is_ok());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn drive_root_is_rejected() {
        let drive_root = std::fs::canonicalize("C:\\").unwrap();
        assert!(validate_root_with_home(&drive_root, None).is_err());
        assert!(canonical_root("C:\\").is_none());
    }

    #[test]
    fn real_home_directory_is_not_a_valid_root() {
        if let Some(home) = dirs::home_dir() {
            assert!(canonical_root(&home.to_string_lossy()).is_none());
        }
    }
}

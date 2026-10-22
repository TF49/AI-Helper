use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[cfg_attr(windows, allow(dead_code))]
    #[error("文件已替换，但目录持久化未确认（{path:?}）: {source}")]
    FileCommittedButNotDurable {
        path: std::path::PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),
    #[allow(dead_code)]
    #[error("TOML 解析错误: {0}")]
    Toml(String),
    #[error("配置文件未找到: {0}")]
    ConfigNotFound(String),
    #[error("注册表操作错误: {0}")]
    Registry(String),
    #[allow(dead_code)]
    #[error("操作错误: {0}")]
    Other(String),
}

impl AppError {
    /// A caller must not roll related state back after this target was replaced.
    /// An error for a backup path does not mean the primary file was committed.
    pub fn file_was_committed(&self, path: &std::path::Path) -> bool {
        matches!(self, Self::FileCommittedButNotDurable { path: committed, .. } if committed == path)
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn committed_error_identifies_the_exact_target_not_its_backup() {
        let target = Path::new("config.toml");
        let backup = Path::new("config.toml.bak");
        let error = AppError::FileCommittedButNotDurable {
            path: target.to_path_buf(),
            source: std::io::Error::other("injected directory sync failure"),
        };
        assert!(error.file_was_committed(target));
        assert!(!error.file_was_committed(backup));
        assert!(!AppError::Io(std::io::Error::other("before rename")).file_was_committed(target));
    }
}

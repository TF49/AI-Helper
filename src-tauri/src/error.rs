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
    #[error(
        "{primary}{}",
        format_rollback_details(.file_rollback.as_deref(), .environment_rollback.as_deref())
    )]
    Transaction {
        #[source]
        primary: Box<AppError>,
        file_rollback: Option<Box<AppError>>,
        environment_rollback: Option<Box<AppError>>,
    },
}

fn format_rollback_details(
    file_rollback: Option<&AppError>,
    env_rollback: Option<&AppError>,
) -> String {
    let mut details = Vec::new();
    if let Some(e) = file_rollback {
        details.push(format!("文件回滚失败: {e}"));
    }
    if let Some(e) = env_rollback {
        details.push(format!("环境变量回滚失败: {e}"));
    }
    if details.is_empty() {
        String::new()
    } else {
        format!("；且回滚过程中发生错误（{}）", details.join("，"))
    }
}

impl AppError {
    /// A caller must not roll related state back after this target was replaced.
    /// An error for a backup path does not mean the primary file was committed.
    pub fn file_was_committed(&self, path: &std::path::Path) -> bool {
        match self {
            Self::FileCommittedButNotDurable {
                path: committed, ..
            } => committed == path,
            Self::Transaction { primary, .. } => primary.file_was_committed(path),
            _ => false,
        }
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

    #[test]
    fn transaction_error_delegates_committed_and_formats_both_rollbacks() {
        let target = Path::new("config.toml");
        let primary = AppError::FileCommittedButNotDurable {
            path: target.to_path_buf(),
            source: std::io::Error::other("fsync failed"),
        };
        let file_err = AppError::Other("disk full".into());
        let env_err = AppError::Registry("access denied".into());

        let tx_err = AppError::Transaction {
            primary: Box::new(primary),
            file_rollback: Some(Box::new(file_err)),
            environment_rollback: Some(Box::new(env_err)),
        };

        // file_was_committed must delegate to primary
        assert!(tx_err.file_was_committed(target));
        assert!(!tx_err.file_was_committed(Path::new("other.toml")));

        // Display string must retain primary and both rollback failure details
        let display = tx_err.to_string();
        assert!(display.contains("文件已替换，但目录持久化未确认"));
        assert!(display.contains("文件回滚失败: 操作错误: disk full"));
        assert!(display.contains("环境变量回滚失败: 注册表操作错误: access denied"));
    }
}

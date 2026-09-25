use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),
    #[allow(dead_code)]
    #[error("TOML 解析错误: {0}")]
    Toml(String),
    #[error("配置文件未找到: {0}")]
    ConfigNotFound(String),
    #[error("注册表操作错误: {0}")]
    Registry(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

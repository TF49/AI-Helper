use crate::error::AppError;
use serde_json::Value;
use std::path::PathBuf;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ClaudeConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub config_exists: bool,
    pub config_path: String,
}

pub fn claude_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".claude").join("settings.json"))
}

fn parse_claude_content(content: &str, config_path: &str, config_exists: bool) -> ClaudeConfig {
    let mut base_url = String::new();
    let mut api_key = String::new();
    let mut model = String::new();

    if config_exists {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
                    model = m.to_string();
                }

                if let Some(env) = json.get("env") {
                    if let Some(url) = env.get("ANTHROPIC_BASE_URL") {
                        base_url = url.as_str().unwrap_or("").to_string();
                    }
                    if let Some(key) = env.get("ANTHROPIC_AUTH_TOKEN") {
                        api_key = key.as_str().unwrap_or("").to_string();
                    }
                    if model.is_empty() {
                        if let Some(m) = env.get("ANTHROPIC_MODEL").and_then(|v| v.as_str()) {
                            model = m.to_string();
                        }
                    }
                }
            } else {
                eprintln!(
                    "警告: 配置文件 {} 格式非有效 JSON，使用默认配置载荷",
                    config_path
                );
            }
        }
    }

    if model.is_empty() {
        model = "claude-3-7-sonnet-20250219".to_string();
    }

    ClaudeConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: config_path.to_string(),
    }
}

pub fn get_claude_config() -> Result<ClaudeConfig, AppError> {
    let path = claude_config_path()?;
    let config_path = path.display().to_string();
    let config_exists = path.exists();
    let content = if config_exists {
        std::fs::read_to_string(&path)?
    } else {
        String::new()
    };

    Ok(parse_claude_content(&content, &config_path, config_exists))
}

fn prepare_claude_json(
    existing_content: Option<&str>,
    url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Value {
    let mut json: Value = if let Some(content) = existing_content {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(trimmed).unwrap_or_else(|_| serde_json::json!({}))
        }
    } else {
        serde_json::json!({})
    };

    if !json.get("env").is_some_and(|v| v.is_object()) {
        json["env"] = serde_json::json!({});
    }

    json["env"]["ANTHROPIC_BASE_URL"] = Value::String(url.to_string());
    json["env"]["ANTHROPIC_AUTH_TOKEN"] = Value::String(api_key.to_string());

    if let Some(m) = model {
        if !m.is_empty() {
            json["model"] = Value::String(m.to_string());
            json["env"]["ANTHROPIC_MODEL"] = Value::String(m.to_string());
        }
    }

    json
}

pub fn set_claude_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    let path = claude_config_path()?;

    let existing_content = if path.exists() {
        Some(std::fs::read_to_string(&path)?)
    } else {
        None
    };

    let json = prepare_claude_json(
        existing_content.as_deref(),
        &url,
        &api_key,
        model.as_deref(),
    );

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(&path, serde_json::to_string_pretty(&json)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_claude_content_empty_string() {
        let cfg = parse_claude_content("", "C:/path/settings.json", true);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "claude-3-7-sonnet-20250219");
    }

    #[test]
    fn test_parse_claude_content_whitespace_only() {
        let cfg = parse_claude_content("   \r\n\t  ", "C:/path/settings.json", true);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "claude-3-7-sonnet-20250219");
    }

    #[test]
    fn test_parse_claude_content_malformed_json() {
        let cfg = parse_claude_content("{ broken json: ", "C:/path/settings.json", true);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "claude-3-7-sonnet-20250219");
    }

    #[test]
    fn test_parse_claude_content_valid_json() {
        let raw = r#"{
            "model": "claude-3-5-sonnet-20241022",
            "env": {
                "ANTHROPIC_BASE_URL": "https://api.example.com",
                "ANTHROPIC_AUTH_TOKEN": "sk-ant-test"
            }
        }"#;
        let cfg = parse_claude_content(raw, "C:/path/settings.json", true);
        assert_eq!(cfg.base_url, "https://api.example.com");
        assert_eq!(cfg.api_key, "sk-ant-test");
        assert_eq!(cfg.model, "claude-3-5-sonnet-20241022");
    }

    #[test]
    fn test_prepare_claude_json_empty_existing() {
        let json = prepare_claude_json(
            Some(""),
            "https://api.example.com",
            "sk-test",
            Some("claude-test"),
        );
        assert_eq!(json["env"]["ANTHROPIC_BASE_URL"], "https://api.example.com");
        assert_eq!(json["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test");
        assert_eq!(json["model"], "claude-test");
    }

    #[test]
    fn test_prepare_claude_json_malformed_existing() {
        let json = prepare_claude_json(
            Some("corrupted{"),
            "https://api.example.com",
            "sk-test",
            None,
        );
        assert_eq!(json["env"]["ANTHROPIC_BASE_URL"], "https://api.example.com");
        assert_eq!(json["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test");
    }
}

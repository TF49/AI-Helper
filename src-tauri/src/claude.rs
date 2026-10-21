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
    pub is_installed: bool,
    pub app_path: Option<String>,
}

pub fn claude_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".claude").join("settings.json"))
}

fn parse_claude_content(
    content: &str,
    config_path: &str,
    config_exists: bool,
    is_installed: bool,
    app_path: Option<String>,
) -> ClaudeConfig {
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

    ClaudeConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: config_path.to_string(),
        is_installed,
        app_path,
    }
}

pub fn get_claude_config() -> Result<ClaudeConfig, AppError> {
    let path = claude_config_path()?;
    let config_exists = path.exists();

    // 检查本地是否已安装 Claude Code CLI 或保存了自定义路径
    let claude_cli = crate::app_paths::detect_claude_cli_path();
    let saved_paths = crate::app_paths::load_app_paths();

    let has_saved_path = saved_paths
        .claude_cli_path
        .as_deref()
        .is_some_and(|p| !p.is_empty() && std::path::Path::new(p).exists());

    let is_installed = config_exists || claude_cli.exists || has_saved_path;

    let app_path = if claude_cli.exists {
        Some(claude_cli.path)
    } else if has_saved_path {
        saved_paths.claude_cli_path
    } else {
        None
    };

    // 仅当配置文件真实存在或应用已确认安装时才提供有效路径，避免未安装时误导呈现虚假路径
    let config_path = if config_exists || is_installed {
        path.display().to_string()
    } else {
        String::new()
    };

    let content = if config_exists {
        std::fs::read_to_string(&path)?
    } else {
        String::new()
    };

    Ok(parse_claude_content(
        &content,
        &config_path,
        config_exists,
        is_installed,
        app_path,
    ))
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn prepare_claude_json(url: &str, api_key: &str, model: Option<&str>) -> Value {
    merge_claude_settings(Value::Object(serde_json::Map::new()), url, api_key, model)
        .expect("empty object is valid")
}

pub fn merge_claude_settings(
    existing: Value,
    url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<Value, AppError> {
    let mut root = match existing {
        Value::Object(map) => map,
        _ => {
            return Err(AppError::Other(
                "Claude 配置不是 JSON 对象，已停止写入以免覆盖安全规则".into(),
            ))
        }
    };
    let mut env = root
        .remove("env")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        Value::String(url.to_string()),
    );
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        Value::String(api_key.to_string()),
    );
    let model_str = model.unwrap_or("").trim();
    if !model_str.is_empty() {
        env.insert(
            "ANTHROPIC_MODEL".to_string(),
            Value::String(model_str.to_string()),
        );
        root.insert("model".to_string(), Value::String(model_str.to_string()));
    }
    root.insert("env".to_string(), Value::Object(env));
    Ok(Value::Object(root))
}

pub fn set_claude_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    crate::credential_policy::validate_key_destination(
        &api_key,
        &url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    let path = claude_config_path()?;
    crate::safe_fs::update_file(&path, |previous| {
        let raw = previous.unwrap_or_default();
        let existing = if raw.iter().all(u8::is_ascii_whitespace) {
            Value::Object(serde_json::Map::new())
        } else {
            serde_json::from_slice(raw).map_err(|_| {
                AppError::Other("现有 Claude 配置损坏，已停止写入以免丢失安全规则".into())
            })?
        };
        let json = merge_claude_settings(existing, &url, &api_key, model.as_deref())?;
        Ok(serde_json::to_vec_pretty(&json)?)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_claude_content_empty_string() {
        let cfg = parse_claude_content("", "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert!(cfg.is_installed);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_claude_content_whitespace_only() {
        let cfg = parse_claude_content("   \r\n\t  ", "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_claude_content_malformed_json() {
        let cfg =
            parse_claude_content("{ broken json: ", "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
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
        let cfg = parse_claude_content(raw, "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.base_url, "https://api.example.com");
        assert_eq!(cfg.api_key, "sk-ant-test");
        assert_eq!(cfg.model, "claude-3-5-sonnet-20241022");
    }

    #[test]
    fn test_prepare_claude_json_with_model() {
        let json = prepare_claude_json("https://api.example.com", "sk-test", Some("claude-test"));
        assert_eq!(json["env"]["ANTHROPIC_BASE_URL"], "https://api.example.com");
        assert_eq!(json["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test");
        assert_eq!(json["env"]["ANTHROPIC_MODEL"], "claude-test");
        assert_eq!(json["model"], "claude-test");
    }

    #[test]
    fn test_prepare_claude_json_without_model() {
        let json = prepare_claude_json("https://api.example.com", "sk-test", None);
        assert_eq!(json["env"]["ANTHROPIC_BASE_URL"], "https://api.example.com");
        assert_eq!(json["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test");
        assert!(json.get("model").is_none());
        assert!(json["env"].get("ANTHROPIC_MODEL").is_none());
    }

    #[test]
    fn merge_preserves_permissions_sandbox_hooks_and_unknown_fields() {
        let existing = serde_json::json!({
            "permissions": { "allow": ["Bash"] },
            "sandbox": { "enabled": true },
            "hooks": { "pre": "echo" },
            "unknownFuture": 1,
            "env": { "KEEP_ME": "yes" }
        });
        let merged = merge_claude_settings(
            existing,
            "https://bob-api.com",
            "sk-managed",
            Some("claude-sonnet"),
        )
        .unwrap();
        assert_eq!(merged["permissions"]["allow"][0], "Bash");
        assert_eq!(merged["sandbox"]["enabled"], true);
        assert_eq!(merged["hooks"]["pre"], "echo");
        assert_eq!(merged["unknownFuture"], 1);
        assert_eq!(merged["env"]["KEEP_ME"], "yes");
        assert_eq!(merged["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-managed");
    }

    #[test]
    fn merge_rejects_non_object_config() {
        assert!(
            merge_claude_settings(Value::Array(vec![]), "https://bob-api.com", "k", None).is_err()
        );
    }
}

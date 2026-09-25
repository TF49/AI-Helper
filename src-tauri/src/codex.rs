use crate::error::AppError;
use std::path::PathBuf;
use toml_edit::DocumentMut;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct CodexConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,
}

pub fn codex_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".codex").join("config.toml"))
}

fn parse_codex_content(
    content: &str,
    config_path: &str,
    config_exists: bool,
    api_key: String,
    is_installed: bool,
    app_path: Option<String>,
) -> CodexConfig {
    let mut base_url = String::new();
    let mut model = String::new();

    if config_exists {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            if let Ok(doc) = trimmed.parse::<DocumentMut>() {
                if let Some(m) = doc.get("model").and_then(|v| v.as_str()) {
                    model = m.to_string();
                } else if let Some(profiles) = doc.get("profiles") {
                    if let Some(thirdparty) = profiles.get("thirdparty") {
                        if let Some(m) = thirdparty.get("model").and_then(|v| v.as_str()) {
                            model = m.to_string();
                        }
                    }
                }

                if let Some(providers) = doc.get("model_providers") {
                    if let Some(custom) = providers.get("custom") {
                        if let Some(url_item) = custom.get("base_url") {
                            if let Some(url_str) = url_item.as_str() {
                                let trimmed_url = url_str.trim_end_matches('/');
                                let stripped =
                                    trimmed_url.strip_suffix("/v1").unwrap_or(trimmed_url);
                                if !stripped.is_empty() {
                                    base_url = format!("{}/", stripped);
                                }
                            }
                        }
                    }
                }
            } else {
                eprintln!(
                    "警告: 配置文件 {} 格式非有效 TOML，使用默认配置载荷",
                    config_path
                );
            }
        }
    }

    CodexConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: config_path.to_string(),
        is_installed,
        app_path,
    }
}

pub fn get_codex_config() -> Result<CodexConfig, AppError> {
    let path = codex_config_path()?;
    let config_exists = path.exists();

    // 检查本地是否已安装 Codex CLI 或 ChatGPT 桌面客户端，或已保存自定义路径
    let codex_cli = crate::app_paths::detect_codex_cli_path();
    let chatgpt_client = crate::app_paths::detect_chatgpt_client_path();
    let saved_paths = crate::app_paths::load_app_paths();

    let has_saved_path = saved_paths
        .codex_cli_path
        .as_deref()
        .is_some_and(|p| !p.is_empty() && std::path::Path::new(p).exists())
        || saved_paths
            .chatgpt_client_path
            .as_deref()
            .is_some_and(|p| !p.is_empty() && std::path::Path::new(p).exists());

    let is_installed = config_exists || codex_cli.exists || chatgpt_client.exists || has_saved_path;

    let app_path = if codex_cli.exists {
        Some(codex_cli.path)
    } else if chatgpt_client.exists {
        Some(chatgpt_client.path)
    } else if has_saved_path {
        saved_paths
            .codex_cli_path
            .or(saved_paths.chatgpt_client_path)
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

    let api_key = read_registry_env("CUSTOM_OPENAI_API_KEY").unwrap_or_default();
    Ok(parse_codex_content(
        &content,
        &config_path,
        config_exists,
        api_key,
        is_installed,
        app_path,
    ))
}

fn prepare_codex_doc(
    existing_content: Option<&str>,
    base_url: &str,
    model: Option<&str>,
) -> DocumentMut {
    let mut doc = if let Some(content) = existing_content {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            DocumentMut::new()
        } else {
            trimmed
                .parse::<DocumentMut>()
                .unwrap_or_else(|_| DocumentMut::new())
        }
    } else {
        DocumentMut::new()
    };

    // 如果指定了 model，则更新顶层 model 与 profile model
    if let Some(m) = model {
        if !m.is_empty() {
            doc["model"] = toml_edit::value(m);
            if let Some(profiles) = doc.get_mut("profiles") {
                if let Some(thirdparty) = profiles.get_mut("thirdparty") {
                    thirdparty["model"] = toml_edit::value(m);
                }
            }
        }
    }

    // 确保默认 provider 指向 custom
    if doc.get("model_provider").is_none() {
        doc["model_provider"] = toml_edit::value("custom");
    }

    // 确保 [model_providers] 存在
    if doc.get("model_providers").is_none() {
        doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    // 确保 [model_providers.custom] 存在
    if doc["model_providers"].get("custom").is_none() {
        doc["model_providers"]["custom"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    if doc["model_providers"]["custom"].get("name").is_none() {
        doc["model_providers"]["custom"]["name"] = toml_edit::value("Custom");
    }
    if doc["model_providers"]["custom"].get("api").is_none() {
        doc["model_providers"]["custom"]["api"] = toml_edit::value("openai-responses");
    }
    doc["model_providers"]["custom"]["base_url"] = toml_edit::value(base_url);
    if doc["model_providers"]["custom"].get("env_key").is_none() {
        doc["model_providers"]["custom"]["env_key"] = toml_edit::value("CUSTOM_OPENAI_API_KEY");
    }

    doc
}

pub fn set_codex_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    let path = codex_config_path()?;
    let normalized = url.trim_end_matches('/');
    let base_url = format!("{}/v1", normalized);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let existing_content = if path.exists() {
        Some(std::fs::read_to_string(&path)?)
    } else {
        None
    };

    let doc = prepare_codex_doc(existing_content.as_deref(), &base_url, model.as_deref());

    std::fs::write(&path, doc.to_string())?;
    write_registry_env("CUSTOM_OPENAI_API_KEY", &api_key)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_registry_env(name: &str) -> Result<String, AppError> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = hkcu
        .open_subkey("Environment")
        .map_err(|e| AppError::Registry(e.to_string()))?;
    Ok(env.get_value(name).unwrap_or_default())
}

#[cfg(not(target_os = "windows"))]
fn read_registry_env(name: &str) -> Result<String, AppError> {
    Ok(std::env::var(name).unwrap_or_default())
}

#[cfg(target_os = "windows")]
fn write_registry_env(name: &str, value: &str) -> Result<(), AppError> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (env, _) = hkcu
        .create_subkey("Environment")
        .map_err(|e| AppError::Registry(e.to_string()))?;
    env.set_value(name, &value.to_string())
        .map_err(|e| AppError::Registry(e.to_string()))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn write_registry_env(name: &str, value: &str) -> Result<(), AppError> {
    std::env::set_var(name, value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_codex_content_empty_string() {
        let cfg = parse_codex_content(
            "",
            "C:/path/config.toml",
            true,
            "test-key".to_string(),
            true,
            None,
        );
        assert_eq!(cfg.config_path, "C:/path/config.toml");
        assert!(cfg.config_exists);
        assert!(cfg.is_installed);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "test-key");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_codex_content_whitespace_only() {
        let cfg = parse_codex_content(
            "   \r\n\t  ",
            "C:/path/config.toml",
            true,
            "".to_string(),
            true,
            None,
        );
        assert_eq!(cfg.config_path, "C:/path/config.toml");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_codex_content_malformed_toml() {
        let cfg = parse_codex_content(
            "[invalid toml syntax",
            "C:/path/config.toml",
            true,
            "".to_string(),
            true,
            None,
        );
        assert_eq!(cfg.config_path, "C:/path/config.toml");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_codex_content_valid_toml() {
        let raw = r#"
model = "o3-mini"

[model_providers.custom]
name = "Custom"
base_url = "https://api.openai.com/v1"
"#;
        let cfg = parse_codex_content(
            raw,
            "C:/path/config.toml",
            true,
            "test-key".to_string(),
            true,
            None,
        );
        assert_eq!(cfg.model, "o3-mini");
        assert_eq!(cfg.base_url, "https://api.openai.com/");
        assert_eq!(cfg.api_key, "test-key");
    }

    #[test]
    fn test_prepare_codex_doc_empty_existing() {
        let doc = prepare_codex_doc(Some(""), "https://api.example.com/v1", Some("o1"));
        assert_eq!(doc["model"].as_str(), Some("o1"));
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://api.example.com/v1")
        );
    }

    #[test]
    fn test_prepare_codex_doc_malformed_existing() {
        let doc = prepare_codex_doc(
            Some("[broken toml"),
            "https://api.example.com/v1",
            Some("gpt-4o"),
        );
        assert_eq!(doc["model"].as_str(), Some("gpt-4o"));
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://api.example.com/v1")
        );
    }
}

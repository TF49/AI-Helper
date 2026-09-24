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
}

pub fn codex_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".codex").join("config.toml"))
}

pub fn get_codex_config() -> Result<CodexConfig, AppError> {
    let path = codex_config_path()?;
    let config_path = path.display().to_string();
    let config_exists = path.exists();
    let mut base_url = String::new();
    let mut model = String::new();

    if config_exists {
        let content = std::fs::read_to_string(&path)?;
        let doc = content
            .parse::<DocumentMut>()
            .map_err(|e| AppError::Toml(e.to_string()))?;

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
                        let trimmed = url_str.trim_end_matches('/');
                        let stripped = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
                        if !stripped.is_empty() {
                            base_url = format!("{}/", stripped);
                        }
                    }
                }
            }
        }
    }

    if model.is_empty() {
        model = "gpt-4o".to_string();
    }

    let api_key = read_registry_env("CUSTOM_OPENAI_API_KEY").unwrap_or_default();

    Ok(CodexConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path,
    })
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

    let mut doc = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        content
            .parse::<DocumentMut>()
            .map_err(|e| AppError::Toml(e.to_string()))?
    } else {
        DocumentMut::new()
    };

    // 如果指定了 model，则更新顶层 model 与 profile model
    if let Some(m) = model {
        if !m.is_empty() {
            doc["model"] = toml_edit::value(&m);
            if let Some(profiles) = doc.get_mut("profiles") {
                if let Some(thirdparty) = profiles.get_mut("thirdparty") {
                    thirdparty["model"] = toml_edit::value(&m);
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

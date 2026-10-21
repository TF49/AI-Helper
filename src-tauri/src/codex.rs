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

#[cfg_attr(not(test), allow(dead_code))]
pub fn prepare_codex_doc(base_url: &str, model: Option<&str>) -> DocumentMut {
    let mut doc = DocumentMut::new();
    merge_codex_managed_fields(&mut doc, base_url, model);
    doc
}

pub fn merge_codex_managed_fields(doc: &mut DocumentMut, base_url: &str, model: Option<&str>) {
    let model_str = model.unwrap_or("").trim();
    if !model_str.is_empty() {
        doc["model"] = toml_edit::value(model_str);
    }
    doc["model_provider"] = toml_edit::value("custom");

    if doc.get("model_providers").is_none() {
        doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    let providers = &mut doc["model_providers"];
    if let Some(providers_tbl) = providers.as_table_mut() {
        if let Some(custom_item) = providers_tbl.get_mut("custom") {
            if let Some(inline) = custom_item.as_inline_table_mut() {
                inline.insert("base_url", base_url.into());
                if !inline.contains_key("name") {
                    inline.insert("name", "Custom".into());
                }
                if !inline.contains_key("api") {
                    inline.insert("api", "openai-responses".into());
                }
                inline.insert("env_key", "CUSTOM_OPENAI_API_KEY".into());
            } else if let Some(custom) = custom_item.as_table_mut() {
                custom["base_url"] = toml_edit::value(base_url);
                if custom.get("name").is_none() {
                    custom["name"] = toml_edit::value("Custom");
                }
                if custom.get("api").is_none() {
                    custom["api"] = toml_edit::value("openai-responses");
                }
                custom["env_key"] = toml_edit::value("CUSTOM_OPENAI_API_KEY");
            } else {
                let mut custom_table = toml_edit::Table::new();
                custom_table["name"] = toml_edit::value("Custom");
                custom_table["api"] = toml_edit::value("openai-responses");
                custom_table["env_key"] = toml_edit::value("CUSTOM_OPENAI_API_KEY");
                custom_table["base_url"] = toml_edit::value(base_url);
                *custom_item = toml_edit::Item::Table(custom_table);
            }
        } else {
            let mut custom_table = toml_edit::Table::new();
            custom_table["name"] = toml_edit::value("Custom");
            custom_table["api"] = toml_edit::value("openai-responses");
            custom_table["env_key"] = toml_edit::value("CUSTOM_OPENAI_API_KEY");
            custom_table["base_url"] = toml_edit::value(base_url);
            providers_tbl["custom"] = toml_edit::Item::Table(custom_table);
        }
    } else if let Some(inline_providers) = providers.as_inline_table_mut() {
        if let Some(custom_val) = inline_providers.get_mut("custom") {
            if let Some(inline_custom) = custom_val.as_inline_table_mut() {
                inline_custom.insert("base_url", base_url.into());
                inline_custom.insert("env_key", "CUSTOM_OPENAI_API_KEY".into());
            }
        }
    }
}

pub fn set_codex_config(
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

    let path = codex_config_path()?;
    let normalized = url.trim_end_matches('/');
    let base_url = format!("{}/v1", normalized);

    crate::safe_fs::with_file_lock(&path, || {
        // Do not mutate a credential whose previous value cannot be read.
        let previous_env = read_registry_env("CUSTOM_OPENAI_API_KEY")?;
        let mut env_changed = false;
        let result = crate::safe_fs::update_file_locked(&path, |previous| {
            let raw = std::str::from_utf8(previous.unwrap_or_default())
                .map_err(|_| AppError::Toml("现有 Codex 配置不是 UTF-8，已停止写入".into()))?;
            let mut doc = if raw.trim().is_empty() {
                DocumentMut::new()
            } else {
                raw.parse::<DocumentMut>().map_err(|_| {
                    AppError::Toml("现有 Codex 配置损坏，已停止写入以免丢失安全规则".into())
                })?
            };
            merge_codex_managed_fields(&mut doc, &base_url, model.as_deref());
            let doc_str = doc.to_string();
            let final_env_key = doc
                .get("model_providers")
                .and_then(|providers| providers.get("custom"))
                .and_then(|custom| custom.get("env_key"))
                .and_then(|value| value.as_str());
            if final_env_key != Some("CUSTOM_OPENAI_API_KEY") {
                return Err(AppError::Other(
                    "Codex 凭据引用未指向实际写入的 CUSTOM_OPENAI_API_KEY，已停止保存".into(),
                ));
            }

            let parsed_check = parse_codex_content(&doc_str, "", true, String::new(), false, None);
            let parsed_clean = parsed_check
                .base_url
                .trim_end_matches('/')
                .strip_suffix("/v1")
                .unwrap_or(&parsed_check.base_url)
                .trim_end_matches('/');
            if parsed_clean != normalized {
                return Err(AppError::Other(format!(
                    "Codex 目标校验失败: 最终解析的地址 '{}' 与目标 '{}' 不匹配，已停止写 Key",
                    parsed_check.base_url, normalized
                )));
            }

            env_changed = true;
            if api_key.trim().is_empty() {
                delete_registry_env("CUSTOM_OPENAI_API_KEY")?;
            } else {
                write_registry_env("CUSTOM_OPENAI_API_KEY", &api_key)?;
            }
            if read_registry_env("CUSTOM_OPENAI_API_KEY")? != api_key {
                return Err(AppError::Other(
                    "Codex 凭据未能写入实际 CLI 环境位置，已停止保存配置".into(),
                ));
            }
            Ok(doc_str.into_bytes())
        });
        if env_changed
            && result
                .as_ref()
                .err()
                .is_some_and(|error| !error.file_was_committed(&path))
        {
            let rollback = if previous_env.is_empty() {
                delete_registry_env("CUSTOM_OPENAI_API_KEY")
            } else {
                write_registry_env("CUSTOM_OPENAI_API_KEY", &previous_env)
            };
            if rollback.is_err() {
                return Err(AppError::Other(
                    "Codex 配置未保存，且凭据回滚失败；请重新关联 Key 后再启动 CLI".into(),
                ));
            }
        }
        result
    })
}

#[cfg(any(target_os = "windows", test))]
fn checked_environment_read(value: std::io::Result<String>) -> Result<String, AppError> {
    match value {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(AppError::Registry(error.to_string())),
    }
}

#[cfg(target_os = "windows")]
fn read_registry_env(name: &str) -> Result<String, AppError> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = match hkcu.open_subkey("Environment") {
        Ok(env) => env,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(AppError::Registry(error.to_string())),
    };
    checked_environment_read(env.get_value(name))
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
    std::env::set_var(name, value);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn write_registry_env(name: &str, value: &str) -> Result<(), AppError> {
    std::env::set_var(name, value);
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn delete_registry_env(name: &str) -> Result<(), AppError> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.open_subkey_with_flags("Environment", winreg::enums::KEY_SET_VALUE) {
        Ok(env) => {
            if let Err(error) = env.delete_value(name) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(AppError::Registry(error.to_string()));
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::Registry(error.to_string())),
    }
    std::env::remove_var(name);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn delete_registry_env(name: &str) -> Result<(), AppError> {
    std::env::remove_var(name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_old_credentials_are_not_treated_as_missing() {
        assert!(checked_environment_read(Err(std::io::Error::from(
            std::io::ErrorKind::PermissionDenied,
        )))
        .is_err());
        assert!(checked_environment_read(Err(std::io::Error::from(
            std::io::ErrorKind::InvalidData,
        )))
        .is_err());
        assert_eq!(
            checked_environment_read(Err(std::io::Error::from(std::io::ErrorKind::NotFound)))
                .unwrap(),
            ""
        );
    }

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
    fn test_prepare_codex_doc_with_model() {
        let doc = prepare_codex_doc("https://api.example.com/v1", Some("o1"));
        assert_eq!(doc["model"].as_str(), Some("o1"));
        assert_eq!(doc["model_provider"].as_str(), Some("custom"));
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://api.example.com/v1")
        );
        assert_eq!(
            doc["model_providers"]["custom"]["api"].as_str(),
            Some("openai-responses")
        );
        assert_eq!(
            doc["model_providers"]["custom"]["env_key"].as_str(),
            Some("CUSTOM_OPENAI_API_KEY")
        );
    }

    #[test]
    fn test_prepare_codex_doc_without_model() {
        let doc = prepare_codex_doc("https://api.example.com/v1", None);
        assert!(doc.get("model").is_none());
        assert_eq!(doc["model_provider"].as_str(), Some("custom"));
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://api.example.com/v1")
        );
    }

    #[test]
    fn merge_preserves_other_providers_and_unknown_keys() {
        let mut doc: DocumentMut = r#"
model = "keep-me"
approval_policy = "untrusted"

[model_providers.openai]
name = "OpenAI"

[model_providers.custom]
name = "Custom"
base_url = "https://old.example/v1"
extra_flag = true
"#
        .parse()
        .unwrap();
        merge_codex_managed_fields(&mut doc, "https://bob-api.com/v1", Some("new-model"));
        assert_eq!(doc["approval_policy"].as_str(), Some("untrusted"));
        assert_eq!(
            doc["model_providers"]["openai"]["name"].as_str(),
            Some("OpenAI")
        );
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://bob-api.com/v1")
        );
        assert_eq!(
            doc["model_providers"]["custom"]["extra_flag"].as_bool(),
            Some(true)
        );
        assert_eq!(doc["model"].as_str(), Some("new-model"));
    }

    #[test]
    fn merge_updates_inline_table_custom_provider() {
        let mut doc: DocumentMut = r#"
[model_providers]
custom = { name = "Old", base_url = "https://old.example/v1", api = "openai-responses" }
"#
        .parse()
        .unwrap();
        merge_codex_managed_fields(&mut doc, "https://bob-api.com/v1", Some("gpt-4o"));
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://bob-api.com/v1")
        );
        let parsed = parse_codex_content(&doc.to_string(), "", true, String::new(), false, None);
        assert_eq!(parsed.base_url, "https://bob-api.com/");
    }
}

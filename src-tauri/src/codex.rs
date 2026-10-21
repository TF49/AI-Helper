use crate::error::AppError;
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item, TableLike};

const MANAGED_PROVIDER: &str = "custom";
const LEGACY_ENV_KEY: &str = "CUSTOM_OPENAI_API_KEY";

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
    #[cfg(test)]
    {
        static DIRECTORY: once_cell::sync::Lazy<tempfile::TempDir> =
            once_cell::sync::Lazy::new(|| tempfile::tempdir().expect("isolated Codex tests"));
        Ok(DIRECTORY.path().join("config.toml"))
    }
    #[cfg(not(test))]
    {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".into()))?;
        Ok(home.join(".codex/config.toml"))
    }
}

fn custom_provider(doc: &DocumentMut) -> Option<&dyn TableLike> {
    doc.get("model_providers")?
        .get(MANAGED_PROVIDER)?
        .as_table_like()
}

fn active_profile_name(doc: &DocumentMut) -> Result<Option<&str>, AppError> {
    let Some(profile) = doc.get("profile") else {
        return Ok(None);
    };
    profile
        .as_str()
        .filter(|name| !name.trim().is_empty())
        .map(Some)
        .ok_or_else(|| AppError::Toml("Codex 当前 profile 无效，请先选择有效配置后再保存".into()))
}

fn active_profile(doc: &DocumentMut) -> Result<Option<&dyn TableLike>, AppError> {
    let Some(name) = active_profile_name(doc)? else {
        return Ok(None);
    };
    doc.get("profiles")
        .and_then(|profiles| profiles.get(name))
        .and_then(Item::as_table_like)
        .map(Some)
        .ok_or_else(|| {
            AppError::Toml(
                "Codex 当前活动 profile 无法在本地配置中确认，请先修复 profile 再保存".into(),
            )
        })
}

fn selected_provider(doc: &DocumentMut) -> Result<&str, AppError> {
    let profile = active_profile(doc)?;
    let provider = profile
        .and_then(|profile| profile.get("model_provider"))
        .or_else(|| doc.get("model_provider"));
    match provider {
        Some(provider) => provider
            .as_str()
            .ok_or_else(|| AppError::Toml("Codex 当前 provider 选择无效".into())),
        None => Ok("openai"),
    }
}

fn align_active_managed_profile(
    doc: &mut DocumentMut,
    model: Option<&str>,
) -> Result<(), AppError> {
    let Some(name) = active_profile_name(doc)?.map(ToOwned::to_owned) else {
        return Ok(());
    };
    let profile = active_profile(doc)?.expect("active profile was resolved");
    if profile
        .get("model_provider")
        .is_some_and(|provider| provider.as_str() != Some(MANAGED_PROVIDER))
    {
        return Err(AppError::Toml("Codex 活动 profile 使用其他 provider；请先切换到 custom profile 再保存，避免配置显示与实际运行目标不一致".into()));
    }
    let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) else {
        return Ok(());
    };
    if let Some(profile_model) = profile.get("model") {
        let profile_model = profile_model
            .as_str()
            .ok_or_else(|| AppError::Toml("Codex 活动 profile 的 model 无效".into()))?;
        if profile_model != model {
            if selected_provider(doc)? != MANAGED_PROVIDER {
                return Err(AppError::Toml("Codex 活动 profile 覆盖了模型且不属于当前管理 provider，请先切换 profile 再保存".into()));
            }
            // This profile already selects our provider. Only its managed model
            // override changes; approvals, sandbox and every other profile stay.
            doc.get_mut("profiles")
                .and_then(|profiles| profiles.get_mut(&name))
                .and_then(Item::as_table_like_mut)
                .ok_or_else(|| AppError::Toml("Codex 活动 profile 不是表".into()))?
                .insert("model", toml_edit::value(model));
        }
    }
    Ok(())
}

fn needs_legacy_environment(doc: &DocumentMut) -> bool {
    selected_provider(doc).is_ok_and(|provider| provider == MANAGED_PROVIDER)
        && custom_provider(doc).is_some_and(|provider| {
            provider.get("experimental_bearer_token").is_none()
                && provider.get("env_key").and_then(Item::as_str) == Some(LEGACY_ENV_KEY)
        })
}

fn parse_codex_content(
    content: &str,
    config_path: &str,
    config_exists: bool,
    legacy_api_key: String,
    is_installed: bool,
    app_path: Option<String>,
) -> CodexConfig {
    let mut base_url = String::new();
    let mut model = String::new();
    let mut api_key = String::new();
    if config_exists {
        if let Ok(doc) = content.trim().parse::<DocumentMut>() {
            model = active_profile(&doc)
                .ok()
                .flatten()
                .and_then(|profile| profile.get("model"))
                .or_else(|| doc.get("model"))
                .and_then(Item::as_str)
                .or_else(|| {
                    doc.get("profiles")?
                        .get("thirdparty")?
                        .get("model")?
                        .as_str()
                })
                .unwrap_or_default()
                .to_string();
            if let Some(custom) = custom_provider(&doc).filter(|_| {
                selected_provider(&doc).is_ok_and(|provider| provider == MANAGED_PROVIDER)
            }) {
                if let Some(url) = custom.get("base_url").and_then(Item::as_str) {
                    let trimmed = url.trim_end_matches('/');
                    let stripped = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
                    if !stripped.is_empty() {
                        base_url = format!("{stripped}/");
                    }
                }
                if let Some(token) = custom.get("experimental_bearer_token") {
                    // Presence, including an explicit empty token, prevents a
                    // stale global credential from being paired with this URL.
                    api_key = token.as_str().unwrap_or_default().to_string();
                } else if needs_legacy_environment(&doc) {
                    api_key = legacy_api_key;
                }
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

fn legacy_key_for_content(
    content: &str,
    read: impl FnOnce(&str) -> Result<String, AppError>,
) -> Result<String, AppError> {
    if content
        .parse::<DocumentMut>()
        .ok()
        .is_some_and(|doc| needs_legacy_environment(&doc))
    {
        read(LEGACY_ENV_KEY)
    } else {
        Ok(String::new())
    }
}

pub fn get_codex_config() -> Result<CodexConfig, AppError> {
    let path = codex_config_path()?;
    let config_exists = path.exists();
    let codex_cli = crate::app_paths::detect_codex_cli_path();
    let chatgpt_client = crate::app_paths::detect_chatgpt_client_path();
    let saved_paths = crate::app_paths::load_app_paths();
    let has_saved_path = saved_paths
        .codex_cli_path
        .as_deref()
        .is_some_and(|path| !path.is_empty() && Path::new(path).exists())
        || saved_paths
            .chatgpt_client_path
            .as_deref()
            .is_some_and(|path| !path.is_empty() && Path::new(path).exists());
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
    let legacy_api_key = legacy_key_for_content(&content, read_registry_env)?;
    Ok(parse_codex_content(
        &content,
        &config_path,
        config_exists,
        legacy_api_key,
        is_installed,
        app_path,
    ))
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn prepare_codex_doc(
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<DocumentMut, AppError> {
    let mut doc = DocumentMut::new();
    merge_codex_managed_fields(&mut doc, base_url, api_key, model)?;
    Ok(doc)
}

fn is_credential_header(name: &str) -> bool {
    [
        "authorization",
        "proxy-authorization",
        "cookie",
        "cookie2",
        "x-api-key",
        "api-key",
        "x-auth-token",
        "x-access-token",
        "x-auth-session",
        "x-gateway-auth",
        "x-ai-helper-instance",
    ]
    .iter()
    .any(|credential| name.eq_ignore_ascii_case(credential))
}

fn remove_credential_headers(provider: &mut dyn TableLike, field: &str) -> Result<(), AppError> {
    let Some(headers) = provider.get_mut(field) else {
        return Ok(());
    };
    let headers = headers.as_table_like_mut().ok_or_else(|| {
        AppError::Toml(format!(
            "Codex custom provider 的 {field} 不是表，已停止保存"
        ))
    })?;
    let names = headers
        .iter()
        .filter(|(name, _)| is_credential_header(name))
        .map(|(name, _)| name.to_string())
        .collect::<Vec<_>>();
    for name in names {
        headers.remove(&name);
    }
    Ok(())
}

fn clean_query_parameters(
    provider: &mut dyn TableLike,
    previous_url: Option<&str>,
    base_url: &str,
) -> Result<(), AppError> {
    let Some(parameters) = provider.get_mut("query_params") else {
        return Ok(());
    };
    let parameters = parameters.as_table_like_mut().ok_or_else(|| {
        AppError::Toml("Codex custom provider 的 query_params 不是表，已停止保存".into())
    })?;
    let credentials = [
        "api_key",
        "apikey",
        "api-key",
        "key",
        "token",
        "access_token",
        "access-token",
        "auth",
        "authorization",
        "signature",
        "sig",
        "password",
        "secret",
        "sid",
    ];
    let names = parameters
        .iter()
        .filter(|(name, _)| {
            credentials
                .iter()
                .any(|credential| name.eq_ignore_ascii_case(credential))
        })
        .map(|(name, _)| name.to_string())
        .collect::<Vec<_>>();
    for name in names {
        parameters.remove(&name);
    }
    let same_origin = previous_url
        .and_then(|url| crate::credential_policy::parse_origin(url).ok())
        .zip(crate::credential_policy::parse_origin(base_url).ok())
        .is_some_and(|(previous, next)| previous == next);
    if !same_origin && !parameters.is_empty() {
        return Err(AppError::Toml("Codex 当前 provider 的 query_params 仍有自定义参数；更换节点前请先检查并清理这些参数，避免把旧节点参数发送到新节点".into()));
    }
    Ok(())
}

/// Only this helper's `custom` provider is managed. Keep every other provider,
/// profile, sandbox setting, and unrelated header intact.
pub fn merge_codex_managed_fields(
    doc: &mut DocumentMut,
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<(), AppError> {
    align_active_managed_profile(doc, model)?;
    if let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) {
        doc["model"] = toml_edit::value(model);
    }
    doc["model_provider"] = toml_edit::value(MANAGED_PROVIDER);
    if doc.get("model_providers").is_none() {
        doc["model_providers"] = Item::Table(toml_edit::Table::new());
    }
    let providers = doc
        .get_mut("model_providers")
        .ok_or_else(|| AppError::Toml("缺少 provider 表".into()))?;
    let inline = providers.as_inline_table().is_some();
    let providers = providers
        .as_table_like_mut()
        .ok_or_else(|| AppError::Toml("Codex model_providers 不是表，已停止保存".into()))?;
    if providers.get(MANAGED_PROVIDER).is_none() {
        let custom = if inline {
            Item::Value(toml_edit::Value::InlineTable(toml_edit::InlineTable::new()))
        } else {
            Item::Table(toml_edit::Table::new())
        };
        providers.insert(MANAGED_PROVIDER, custom);
    }
    let custom = providers
        .get_mut(MANAGED_PROVIDER)
        .and_then(Item::as_table_like_mut)
        .ok_or_else(|| AppError::Toml("Codex custom provider 不是表，已停止保存".into()))?;
    let previous_url = custom
        .get("base_url")
        .and_then(Item::as_str)
        .map(ToOwned::to_owned);
    clean_query_parameters(custom, previous_url.as_deref(), base_url)?;
    custom.insert("base_url", toml_edit::value(base_url));
    custom.insert("experimental_bearer_token", toml_edit::value(api_key));
    for name in [
        "env_key",
        "env_key_instructions",
        "auth",
        "requires_openai_auth",
    ] {
        custom.remove(name);
    }
    remove_credential_headers(custom, "http_headers")?;
    remove_credential_headers(custom, "env_http_headers")?;
    if custom.get("name").is_none() {
        custom.insert("name", toml_edit::value("Custom"));
    }
    if custom.get("api").is_none() {
        custom.insert("api", toml_edit::value("openai-responses"));
    }
    Ok(())
}

fn edited_codex_contents(
    previous: Option<&[u8]>,
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<Vec<u8>, AppError> {
    let raw = std::str::from_utf8(previous.unwrap_or_default())
        .map_err(|_| AppError::Toml("现有 Codex 配置不是 UTF-8，已停止写入".into()))?;
    let mut doc = if raw.trim().is_empty() {
        DocumentMut::new()
    } else {
        raw.parse::<DocumentMut>()
            .map_err(|_| AppError::Toml("现有 Codex 配置损坏，已停止写入以免丢失安全规则".into()))?
    };
    merge_codex_managed_fields(&mut doc, base_url, api_key, model)?;
    let text = doc.to_string();
    let check = text
        .parse::<DocumentMut>()
        .map_err(|_| AppError::Toml("Codex 配置序列化校验失败，已停止保存".into()))?;
    let custom = custom_provider(&check)
        .ok_or_else(|| AppError::Toml("Codex custom provider 缺失".into()))?;
    if check.get("model_provider").and_then(Item::as_str) != Some(MANAGED_PROVIDER)
        || custom.get("base_url").and_then(Item::as_str) != Some(base_url)
        || custom
            .get("experimental_bearer_token")
            .and_then(Item::as_str)
            != Some(api_key)
    {
        return Err(AppError::Toml(
            "Codex URL 与密钥未能在同一配置中绑定，已停止保存".into(),
        ));
    }
    Ok(text.into_bytes())
}

fn write_codex_config_at(
    path: &Path,
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<(), AppError> {
    // URL and bearer token commit as one private file. There is no global
    // environment or registry staging/rollback window, including on failures.
    crate::safe_fs::update_file(path, |previous| {
        edited_codex_contents(previous, base_url, api_key, model)
    })
}

pub fn set_codex_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    let url = url.trim();
    crate::credential_policy::validate_key_destination(
        &api_key,
        url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|error| AppError::Other(error.to_string()))?;
    let normalized = url.trim_end_matches('/');
    let base_url = if normalized.ends_with("/v1") {
        normalized.to_string()
    } else {
        format!("{normalized}/v1")
    };
    write_codex_config_at(
        &codex_config_path()?,
        &base_url,
        api_key.trim(),
        model.as_deref(),
    )
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
    match std::env::var(name) {
        Ok(value) => Ok(value),
        Err(std::env::VarError::NotPresent) => Ok(String::new()),
        Err(std::env::VarError::NotUnicode(_)) => {
            Err(AppError::Registry("旧 Codex 环境凭据不是有效 UTF-8".into()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_pair_commits_together_and_preserves_security_configuration() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        let previous = r#"
model = "old-model"
profile = "team"
approval_policy = "untrusted"
[sandbox_workspace_write]
network_access = false
[profiles.team]
model_provider = "custom"
model = "team-model"
[model_providers.custom]
base_url = "https://old.example/v1"
experimental_bearer_token = "fake-old-key"
unknown_policy = { keep = true }
[model_providers.other]
base_url = "https://other.example/v1"
env_key = "OTHER_PROVIDER_KEY"
"#;
        std::fs::write(&path, previous).unwrap();
        write_codex_config_at(
            &path,
            "https://new.example/v1",
            "fake-new-key",
            Some("new-model"),
        )
        .unwrap();
        let current = std::fs::read_to_string(&path).unwrap();
        let doc = current.parse::<DocumentMut>().unwrap();
        let provider = custom_provider(&doc).unwrap();
        assert_eq!(
            provider.get("base_url").and_then(Item::as_str),
            Some("https://new.example/v1")
        );
        assert_eq!(
            provider
                .get("experimental_bearer_token")
                .and_then(Item::as_str),
            Some("fake-new-key")
        );
        assert_eq!(doc["profile"].as_str(), Some("team"));
        assert_eq!(
            doc["profiles"]["team"]["model_provider"].as_str(),
            Some("custom")
        );
        assert_eq!(
            doc["sandbox_workspace_write"]["network_access"].as_bool(),
            Some(false)
        );
        assert_eq!(doc["approval_policy"].as_str(), Some("untrusted"));
        assert_eq!(
            doc["model_providers"]["custom"]["unknown_policy"]["keep"].as_bool(),
            Some(true)
        );
        assert_eq!(
            doc["model_providers"]["other"]["env_key"].as_str(),
            Some("OTHER_PROVIDER_KEY")
        );
        assert_eq!(
            std::fs::read_to_string(path.with_extension("toml.bak")).unwrap(),
            previous
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn failed_atomic_update_keeps_the_previous_url_and_key_pair() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        let previous = b"model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nexperimental_bearer_token='fake-old-key'\n";
        std::fs::write(&path, previous).unwrap();
        // Force the real backup write to fail before replacing the target.
        std::fs::create_dir(path.with_extension("toml.bak")).unwrap();
        assert!(
            write_codex_config_at(&path, "https://new.example/v1", "fake-new-key", None).is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), previous);
        let parsed = parse_codex_content(
            std::str::from_utf8(previous).unwrap(),
            "",
            true,
            "unrelated-legacy-key".into(),
            false,
            None,
        );
        assert_eq!(parsed.base_url, "https://old.example/");
        assert_eq!(parsed.api_key, "fake-old-key");
    }

    #[test]
    fn document_edit_removes_conflicting_auth_only_from_managed_provider() {
        let previous = r#"
model_provider = "other"
[model_providers.custom]
base_url = "https://old.example/v1"
env_key = "CUSTOM_OPENAI_API_KEY"
env_key_instructions = "obsolete setup"
requires_openai_auth = true
auth = { command = "fake-command", args = ["unchanged elsewhere"] }
http_headers = { Authorization = "fake-old-key", aUtHoRiZaTiOn = "fake-second-key", X-Trace = "keep" }
env_http_headers = { AUTHORIZATION = "OLD_ENV", X-Meta = "KEEP_ENV" }
[model_providers.other]
base_url = "https://other.example/v1"
env_key = "OTHER_KEY"
requires_openai_auth = true
http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
"#;
        let original = previous.parse::<DocumentMut>().unwrap();
        let token = "fake-token-with-\"quotes\"-and-\\slashes";
        let bytes = edited_codex_contents(
            Some(previous.as_bytes()),
            "https://new.example/v1",
            token,
            None,
        )
        .unwrap();
        let doc = std::str::from_utf8(&bytes)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        let custom = custom_provider(&doc).unwrap();
        for name in [
            "env_key",
            "env_key_instructions",
            "auth",
            "requires_openai_auth",
        ] {
            assert!(custom.get(name).is_none());
        }
        assert_eq!(
            custom
                .get("experimental_bearer_token")
                .and_then(Item::as_str),
            Some(token)
        );
        for field in ["http_headers", "env_http_headers"] {
            assert!(!custom
                .get(field)
                .unwrap()
                .as_table_like()
                .unwrap()
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case("authorization")));
        }
        assert_eq!(
            doc["model_providers"]["custom"]["http_headers"]["X-Trace"].as_str(),
            Some("keep")
        );
        assert_eq!(
            doc["model_providers"]["custom"]["env_http_headers"]["X-Meta"].as_str(),
            Some("KEEP_ENV")
        );
        assert_eq!(
            doc["model_providers"]["other"].to_string(),
            original["model_providers"]["other"].to_string()
        );
    }

    #[test]
    fn inline_provider_forms_keep_unrelated_fields_and_headers() {
        for previous in [
            r#"model_providers = { custom = { base_url = "https://old.example/v1", env_key = "OLD", requires_openai_auth = true, auth = { command = "fake" }, http_headers = { Authorization = "old", X-Keep = "yes" } }, other = { env_key = "OTHER" } }"#,
            r#"model_providers = { other = { env_key = "OTHER" } }"#,
        ] {
            let bytes = edited_codex_contents(
                Some(previous.as_bytes()),
                "https://new.example/v1",
                "fake-new-key",
                None,
            )
            .unwrap();
            let doc = std::str::from_utf8(&bytes)
                .unwrap()
                .parse::<DocumentMut>()
                .unwrap();
            assert_eq!(
                doc["model_providers"]["other"]["env_key"].as_str(),
                Some("OTHER")
            );
            assert_eq!(
                doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
                Some("fake-new-key")
            );
            assert!(doc["model_providers"]["custom"].get("env_key").is_none());
            if previous.contains("X-Keep") {
                assert_eq!(
                    doc["model_providers"]["custom"]["http_headers"]["X-Keep"].as_str(),
                    Some("yes")
                );
            }
        }
    }

    #[test]
    fn known_credential_headers_are_removed_in_all_table_forms() {
        for inline in [false, true] {
            let assignments = [
                "Authorization",
                "Proxy-Authorization",
                "Cookie",
                "X-API-Key",
                "api-key",
                "x-auth-token",
                "X-Access-Token",
            ]
            .iter()
            .map(|name| format!("'{name}' = 'fake-old-credential'"))
            .chain(std::iter::once("X-Trace = 'keep'".into()))
            .collect::<Vec<_>>();
            let raw = if inline {
                format!("model_providers = {{ custom = {{ base_url = 'https://old.example/v1', http_headers = {{ {} }}, env_http_headers = {{ {} }} }}, other = {{ http_headers = {{ Cookie = 'fake-other-cookie' }} }} }}", assignments.join(", "), assignments.join(", "))
            } else {
                format!("[model_providers.custom]\nbase_url='https://old.example/v1'\n[model_providers.custom.http_headers]\n{}\n[model_providers.custom.env_http_headers]\n{}\n[model_providers.other.http_headers]\nCookie='fake-other-cookie'\n", assignments.join("\n"), assignments.join("\n"))
            };
            let bytes = edited_codex_contents(
                Some(raw.as_bytes()),
                "https://new.example/v1",
                "fake-new-key",
                None,
            )
            .unwrap();
            let doc = std::str::from_utf8(&bytes)
                .unwrap()
                .parse::<DocumentMut>()
                .unwrap();
            for field in ["http_headers", "env_http_headers"] {
                let headers = custom_provider(&doc)
                    .unwrap()
                    .get(field)
                    .unwrap()
                    .as_table_like()
                    .unwrap();
                assert_eq!(headers.iter().count(), 1);
                assert_eq!(headers.get("X-Trace").and_then(Item::as_str), Some("keep"));
            }
            assert_eq!(
                doc["model_providers"]["other"]["http_headers"]["Cookie"].as_str(),
                Some("fake-other-cookie")
            );
        }
    }

    #[test]
    fn credential_query_keys_are_removed_and_same_origin_custom_parameters_survive() {
        let raw = r#"
[model_providers.custom]
base_url = "https://new.example:443/v1"
query_params = { api_key = "fake-old", key = "fake-old", token = "fake-old", access_token = "fake-old", auth = "fake-old", signature = "fake-old", region = "keep" }
"#;
        let bytes = edited_codex_contents(
            Some(raw.as_bytes()),
            "https://new.example/v1",
            "fake-new-key",
            None,
        )
        .unwrap();
        let doc = std::str::from_utf8(&bytes)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        let parameters = custom_provider(&doc)
            .unwrap()
            .get("query_params")
            .unwrap()
            .as_table_like()
            .unwrap();
        assert_eq!(parameters.iter().count(), 1);
        assert_eq!(
            parameters.get("region").and_then(Item::as_str),
            Some("keep")
        );
    }

    #[test]
    fn origin_change_requires_review_of_remaining_custom_query_parameters() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        let raw = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nexperimental_bearer_token='fake-old-key'\nquery_params={region='keep',api_key='fake-old-query-key'}";
        std::fs::write(&path, raw).unwrap();
        let error = write_codex_config_at(&path, "https://new.example/v1", "fake-new-key", None)
            .unwrap_err();
        assert!(error.to_string().contains("query_params"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), raw);
        let credential_only = "[model_providers.custom]\nbase_url='https://old.example/v1'\nquery_params={api_key='fake-old-query-key'}";
        let bytes = edited_codex_contents(
            Some(credential_only.as_bytes()),
            "https://new.example/v1",
            "fake-new-key",
            None,
        )
        .unwrap();
        let doc = std::str::from_utf8(&bytes)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        assert!(custom_provider(&doc)
            .unwrap()
            .get("query_params")
            .unwrap()
            .as_table_like()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn malformed_provider_or_header_tables_do_not_overwrite_existing_files() {
        for previous in [
            "model_providers = 'not-a-table'",
            "[model_providers]\ncustom = 42",
            "[model_providers.custom]\nhttp_headers = ['not-a-map']",
            "[model_providers.custom]\nenv_http_headers = 'not-a-map'",
            "[invalid toml",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("config.toml");
            std::fs::write(&path, previous).unwrap();
            assert!(
                write_codex_config_at(&path, "https://new.example/v1", "fake-new-key", None)
                    .is_err()
            );
            assert_eq!(std::fs::read_to_string(path).unwrap(), previous);
        }
    }

    #[test]
    fn legacy_reads_are_limited_to_the_managed_custom_environment_reference() {
        let legacy = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nenv_key='CUSTOM_OPENAI_API_KEY'\n";
        let key = legacy_key_for_content(legacy, |name| {
            assert_eq!(name, LEGACY_ENV_KEY);
            Ok("fake-legacy-key".into())
        })
        .unwrap();
        let parsed = parse_codex_content(legacy, "", true, key, false, None);
        assert_eq!(parsed.api_key, "fake-legacy-key");
        for content in [
            "[model_providers.other]\nenv_key='CUSTOM_OPENAI_API_KEY'",
            "[model_providers.custom]\nenv_key='AN_UNRELATED_SECRET'",
            "[model_providers.custom]\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token=''",
            "[model_providers.custom]\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token=42",
            "[invalid toml",
            "",
        ] {
            assert_eq!(legacy_key_for_content(content, |_| panic!("must not read an unrelated environment credential")).unwrap(), "");
        }
    }

    #[test]
    fn explicit_empty_bearer_never_falls_back_to_old_global_key() {
        let content = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://new.example/v1'\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token=''";
        let parsed =
            parse_codex_content(content, "", true, "fake-old-global-key".into(), false, None);
        assert_eq!(parsed.base_url, "https://new.example/");
        assert_eq!(parsed.api_key, "");
    }

    #[test]
    fn legacy_read_failure_is_reported_instead_of_becoming_an_empty_key() {
        let content =
            "model_provider='custom'\n[model_providers.custom]\nenv_key='CUSTOM_OPENAI_API_KEY'";
        assert!(legacy_key_for_content(content, |_| Err(AppError::Registry(
            "injected read failure".into()
        )))
        .is_err());
    }

    #[test]
    fn active_other_provider_profile_rejects_save_and_preserves_the_old_pair() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        let previous = r#"
profile = "other-profile"
model_provider = "custom"
[profiles.other-profile]
model_provider = "other"
model = "other-model"
[model_providers.custom]
base_url = "https://old.example/v1"
experimental_bearer_token = "fake-old-key"
[model_providers.other]
base_url = "https://other.example/v1"
env_key = "OTHER_KEY"
"#;
        std::fs::write(&path, previous).unwrap();
        let error = write_codex_config_at(
            &path,
            "https://new.example/v1",
            "fake-new-key",
            Some("new-model"),
        )
        .unwrap_err();
        assert!(error.to_string().contains("profile"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), previous);
        assert_eq!(
            legacy_key_for_content(previous, |_| panic!(
                "other active provider must not read our old global key"
            ))
            .unwrap(),
            ""
        );
    }

    #[test]
    fn managed_active_profile_updates_its_model_override_and_keeps_its_policy() {
        let previous = r#"
profile = "managed"
model_provider = "custom"
[profiles.managed]
model = "old-model"
approval_policy = "untrusted"
sandbox_mode = "read-only"
[profiles.unrelated]
model_provider = "other"
model = "unrelated-model"
"#;
        let original = previous.parse::<DocumentMut>().unwrap();
        let bytes = edited_codex_contents(
            Some(previous.as_bytes()),
            "https://new.example/v1",
            "fake-new-key",
            Some("new-model"),
        )
        .unwrap();
        let doc = std::str::from_utf8(&bytes)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        assert_eq!(
            doc["profiles"]["managed"]["model"].as_str(),
            Some("new-model")
        );
        assert_eq!(
            doc["profiles"]["managed"]["approval_policy"].as_str(),
            Some("untrusted")
        );
        assert_eq!(
            doc["profiles"]["managed"]["sandbox_mode"].as_str(),
            Some("read-only")
        );
        assert_eq!(
            doc["profiles"]["unrelated"].to_string(),
            original["profiles"]["unrelated"].to_string()
        );
        let parsed = parse_codex_content(
            std::str::from_utf8(&bytes).unwrap(),
            "",
            true,
            String::new(),
            false,
            None,
        );
        assert_eq!(parsed.model, "new-model");
    }

    #[test]
    fn unknown_or_unmanaged_active_profile_overrides_fail_before_write() {
        for previous in [
            "profile = 'missing'",
            "profile = 'other'\nmodel_provider = 'other'\n[profiles.other]\nmodel = 'old-model'",
            "profile = 'broken'\n[profiles]\nbroken = 42",
        ] {
            assert!(edited_codex_contents(
                Some(previous.as_bytes()),
                "https://new.example/v1",
                "fake-new-key",
                Some("new-model")
            )
            .is_err());
        }
    }

    #[test]
    fn actual_set_codex_config_writes_one_private_pair_without_an_env_reference() {
        let key = "fake-managed-codex-atomic-pair-key";
        crate::credential_policy::register_managed_key(key);
        set_codex_config(
            "https://bob-api.com/v1/".into(),
            key.into(),
            Some("fake-model".into()),
        )
        .unwrap();
        let content = std::fs::read_to_string(codex_config_path().unwrap()).unwrap();
        let doc = content.parse::<DocumentMut>().unwrap();
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://bob-api.com/v1")
        );
        assert_eq!(
            doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
            Some(key)
        );
        assert!(doc["model_providers"]["custom"].get("env_key").is_none());
    }

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
        assert_eq!(cfg.api_key, "");
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
model_provider = "custom"

[model_providers.custom]
name = "Custom"
env_key = "CUSTOM_OPENAI_API_KEY"
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
        let doc =
            prepare_codex_doc("https://api.example.com/v1", "fake-direct-key", Some("o1")).unwrap();
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
            doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
            Some("fake-direct-key")
        );
    }

    #[test]
    fn test_prepare_codex_doc_without_model() {
        let doc = prepare_codex_doc("https://api.example.com/v1", "fake-direct-key", None).unwrap();
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
        merge_codex_managed_fields(
            &mut doc,
            "https://bob-api.com/v1",
            "fake-direct-key",
            Some("new-model"),
        )
        .unwrap();
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
        merge_codex_managed_fields(
            &mut doc,
            "https://bob-api.com/v1",
            "fake-direct-key",
            Some("gpt-4o"),
        )
        .unwrap();
        assert_eq!(
            doc["model_providers"]["custom"]["base_url"].as_str(),
            Some("https://bob-api.com/v1")
        );
        let parsed = parse_codex_content(&doc.to_string(), "", true, String::new(), false, None);
        assert_eq!(parsed.base_url, "https://bob-api.com/");
    }
}

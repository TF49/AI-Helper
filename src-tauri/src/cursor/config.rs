use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CursorConfig {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_bridge_port")]
    pub bridge_port: u16,
    #[serde(default = "default_true")]
    pub auto_start_bridge: bool,
    #[serde(default)]
    pub custom_models: Vec<String>,
    #[serde(default)]
    pub cached_models: Vec<String>,
    #[serde(default)]
    pub cached_models_fingerprint: String,
    #[serde(default)]
    pub cursor_path: Option<String>,
}

fn default_base_url() -> String {
    "https://bob-api.com/".to_string()
}

fn default_model() -> String {
    "glm-5.3".to_string()
}

fn default_bridge_port() -> u16 {
    8969
}

fn default_true() -> bool {
    true
}

pub fn model_source_fingerprint(base_url: &str, api_key: &str) -> String {
    let normalized = base_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/v1");
    format!("{normalized}||{}", api_key.trim())
}

impl Default for CursorConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            api_key: String::new(),
            model: default_model(),
            bridge_port: default_bridge_port(),
            auto_start_bridge: true,
            custom_models: Vec::new(),
            cached_models: Vec::new(),
            cached_models_fingerprint: String::new(),
            cursor_path: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CursorUIConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub bridge_port: u16,
    pub auto_start_bridge: bool,
    pub custom_models: Vec<String>,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,
    pub bridge_running: bool,
    pub actual_port: Option<u16>,
    pub is_patched: bool,
    pub patch_detail: Option<String>,
    pub is_process_running: bool,
}

pub fn get_cursor_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".ai-helper").join("cursor_config.json"))
}

pub fn load_cursor_config() -> CursorConfig {
    let Ok(path) = get_cursor_config_path() else {
        return CursorConfig::default();
    };
    if !path.exists() {
        return CursorConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => CursorConfig::default(),
    }
}

pub fn merge_config_update(
    payload: serde_json::Value,
    existing: &CursorConfig,
) -> Result<CursorConfig, AppError> {
    let mut config: CursorConfig = serde_json::from_value(payload)?;
    let source_changed = model_source_fingerprint(&config.base_url, &config.api_key)
        != model_source_fingerprint(&existing.base_url, &existing.api_key);

    if config.custom_models.is_empty() {
        config.custom_models = existing.custom_models.clone();
    }

    if source_changed {
        // A model list belongs to one upstream credential pair. Never carry it
        // across to a new endpoint or key, even when the frontend omits cache fields.
        config.cached_models.clear();
        config.cached_models_fingerprint.clear();
    } else if config.cached_models.is_empty() && !existing.cached_models.is_empty() {
        config.cached_models = existing.cached_models.clone();
        config.cached_models_fingerprint = existing.cached_models_fingerprint.clone();
    } else if !config.cached_models.is_empty() {
        config.cached_models_fingerprint =
            model_source_fingerprint(&config.base_url, &config.api_key);
    }
    Ok(config)
}

pub fn save_cursor_config(config: &CursorConfig) -> Result<(), AppError> {
    crate::credential_policy::validate_key_destination(
        &config.api_key,
        &config.base_url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    let path = get_cursor_config_path()?;
    crate::reset::with_config_write(|| save_cursor_config_unlocked(config, &path))
}

pub(crate) fn save_cursor_config_at_generation(
    config: &CursorConfig,
    generation: u64,
) -> Result<(), AppError> {
    crate::credential_policy::validate_key_destination(
        &config.api_key,
        &config.base_url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let path = get_cursor_config_path()?;
    crate::reset::with_config_write_at_generation(generation, || {
        save_cursor_config_unlocked(config, &path)
    })
}

pub(crate) fn save_cursor_config_unlocked(
    config: &CursorConfig,
    path: &std::path::Path,
) -> Result<(), AppError> {
    crate::credential_policy::validate_key_destination(
        &config.api_key,
        &config.base_url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let content = serde_json::to_string_pretty(config)?;
    // AI Helper owns this file and reset deletes it outright, so no reset
    // snapshot is taken (it would only duplicate the plaintext API key).
    crate::safe_fs::with_file_lock(path, || {
        crate::safe_fs::atomic_write_locked(path, content.as_bytes())
    })
}

pub fn get_cursor_ui_config(bridge_running: bool, actual_port: Option<u16>) -> CursorUIConfig {
    let config = load_cursor_config();
    let config_path = get_cursor_config_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "~/.ai-helper/cursor_config.json".to_string());
    let config_exists = get_cursor_config_path()
        .map(|p| p.exists())
        .unwrap_or(false);

    let patch_info = crate::cursor::patcher::get_patch_status(config.cursor_path.as_deref());
    let is_running = crate::app_paths::is_target_running("cursor");

    CursorUIConfig {
        base_url: config.base_url,
        api_key: config.api_key,
        model: config.model,
        bridge_port: config.bridge_port,
        auto_start_bridge: config.auto_start_bridge,
        custom_models: config.custom_models,
        config_exists,
        config_path,
        is_installed: patch_info.is_installed,
        app_path: patch_info.cursor_app_path,
        bridge_running,
        actual_port,
        is_patched: patch_info.is_patched,
        patch_detail: Some(patch_info.message),
        is_process_running: is_running,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_source_fingerprint_normalization() {
        let fp1 = model_source_fingerprint("https://bob-api.com/", "sk-test123");
        let fp2 = model_source_fingerprint("https://bob-api.com/v1", "sk-test123");
        let fp3 = model_source_fingerprint("https://bob-api.com/v1/", "sk-test123 ");
        assert_eq!(fp1, "https://bob-api.com||sk-test123");
        assert_eq!(fp2, "https://bob-api.com||sk-test123");
        assert_eq!(fp3, "https://bob-api.com||sk-test123");
    }

    #[test]
    fn merge_config_update_preserves_cache_for_same_source() {
        let existing = CursorConfig {
            api_key: "sk-existing".to_string(),
            custom_models: vec!["custom-model".to_string()],
            cached_models: vec!["cached-model".to_string()],
            cached_models_fingerprint: "https://bob-api.com||sk-existing".to_string(),
            ..CursorConfig::default()
        };
        let payload = serde_json::json!({
            "base_url": "https://bob-api.com/v1/",
            "api_key": "sk-existing",
            "model": "selected-model",
            "bridge_port": 8969,
            "auto_start_bridge": true,
            "cursor_path": null
        });

        let merged = merge_config_update(payload, &existing).unwrap();

        assert_eq!(merged.custom_models, vec!["custom-model"]);
        assert_eq!(merged.cached_models, vec!["cached-model"]);
        assert_eq!(
            merged.cached_models_fingerprint,
            "https://bob-api.com||sk-existing"
        );
    }

    #[test]
    fn merge_config_update_clears_cache_for_changed_source() {
        let existing = CursorConfig {
            api_key: "sk-old".to_string(),
            cached_models: vec!["old-model".to_string()],
            cached_models_fingerprint: "https://bob-api.com||sk-old".to_string(),
            ..CursorConfig::default()
        };
        let payload = serde_json::json!({
            "base_url": "https://new.example.com/",
            "api_key": "sk-new",
            "model": "new-model",
            "bridge_port": 8969,
            "auto_start_bridge": true,
            "cached_models": ["stale-model-from-payload"],
            "cached_models_fingerprint": "stale-fingerprint",
            "cursor_path": null
        });

        let merged = merge_config_update(payload, &existing).unwrap();

        assert!(merged.cached_models.is_empty());
        assert!(merged.cached_models_fingerprint.is_empty());
    }
}

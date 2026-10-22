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
    #[serde(default = "default_models")]
    pub custom_models: Vec<String>,
    #[serde(default)]
    pub cursor_path: Option<String>,
}

fn default_base_url() -> String {
    "https://bob-api.com/".to_string()
}

fn default_model() -> String {
    "claude-3-7-sonnet".to_string()
}

fn default_bridge_port() -> u16 {
    8969
}

fn default_true() -> bool {
    true
}

fn default_models() -> Vec<String> {
    vec![
        "claude-3-7-sonnet".to_string(),
        "claude-3-5-sonnet".to_string(),
        "deepseek-chat".to_string(),
        "deepseek-reasoner".to_string(),
        "gpt-4o".to_string(),
        "o3-mini".to_string(),
    ]
}

impl Default for CursorConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            api_key: String::new(),
            model: default_model(),
            bridge_port: default_bridge_port(),
            auto_start_bridge: true,
            custom_models: default_models(),
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
    if config.custom_models.is_empty() {
        config.custom_models = existing.custom_models.clone();
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
    let content = serde_json::to_string_pretty(config)?;
    crate::safe_fs::safe_write_file(&path, content.as_bytes())?;
    Ok(())
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

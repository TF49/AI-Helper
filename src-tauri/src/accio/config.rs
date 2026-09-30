use crate::app_paths::detect_accio_client_path;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccioConfig {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_bridge_port")]
    pub bridge_port: u16,
    #[serde(default = "default_official_gateway")]
    pub official_gateway: String,
    #[serde(default)]
    pub fallback_official: bool,
    #[serde(default = "default_true")]
    pub prevent_official_leak: bool,
    #[serde(default)]
    pub cached_models: Vec<String>,
}

fn default_base_url() -> String {
    "https://bob-api.com/".to_string()
}

fn default_model() -> String {
    String::new()
}

fn default_bridge_port() -> u16 {
    8787
}

fn default_official_gateway() -> String {
    "https://phoenix-gw.alibaba.com".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for AccioConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            api_key: String::new(),
            model: default_model(),
            bridge_port: default_bridge_port(),
            official_gateway: default_official_gateway(),
            fallback_official: false,
            prevent_official_leak: true,
            cached_models: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccioUIConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub bridge_port: u16,
    pub official_gateway: String,
    pub fallback_official: bool,
    pub prevent_official_leak: bool,
    pub cached_models: Vec<String>,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,
    pub bridge_running: bool,
    pub actual_port: Option<u16>,
}

pub fn get_accio_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".ai-helper").join("accio_config.json"))
}

pub fn load_accio_config() -> AccioConfig {
    let Ok(path) = get_accio_config_path() else {
        return AccioConfig::default();
    };
    if !path.exists() {
        return AccioConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AccioConfig::default(),
    }
}

pub fn save_accio_config(config: &AccioConfig) -> Result<(), AppError> {
    let path = get_accio_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&path, content)?;
    Ok(())
}

pub fn get_accio_ui_config(bridge_running: bool, actual_port: Option<u16>) -> AccioUIConfig {
    let config = load_accio_config();
    let config_path = get_accio_config_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "~/.ai-helper/accio_config.json".to_string());
    let config_exists = get_accio_config_path().map(|p| p.exists()).unwrap_or(false);

    let detected = detect_accio_client_path();

    AccioUIConfig {
        base_url: config.base_url,
        api_key: config.api_key,
        model: config.model,
        bridge_port: config.bridge_port,
        official_gateway: config.official_gateway,
        fallback_official: config.fallback_official,
        prevent_official_leak: config.prevent_official_leak,
        cached_models: config.cached_models,
        config_exists,
        config_path,
        is_installed: detected.exists,
        app_path: if detected.exists {
            Some(detected.path)
        } else {
            None
        },
        bridge_running,
        actual_port,
    }
}

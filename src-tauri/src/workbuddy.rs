use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyModelEntry {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub url: String,
    pub api: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    pub supports_tool_call: bool,
    pub supports_images: bool,
    pub supports_reasoning: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only_reasoning: Option<bool>,
    pub use_custom_protocol: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<WorkbuddyReasoning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyReasoning {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_efforts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_disable_thinking: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkbuddyUIConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,

    // 高级功能开关
    pub supports_tool_call: bool,
    pub supports_images: bool,
    pub supports_reasoning: bool,
    pub only_reasoning: bool,
    pub can_disable_thinking: bool,
    pub use_custom_protocol: bool,

    // 思考强度设置
    pub default_effort: String,
    pub supported_efforts: Vec<String>,

    // Token 上限限制
    pub max_input_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkbuddySavePayload {
    pub url: String,
    pub api_key: String,
    pub model: String,

    pub supports_tool_call: bool,
    pub supports_images: bool,
    pub supports_reasoning: bool,
    pub only_reasoning: bool,
    pub can_disable_thinking: bool,
    pub use_custom_protocol: bool,

    pub default_effort: Option<String>,
    pub supported_efforts: Vec<String>,

    pub max_input_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

pub fn workbuddy_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".workbuddy-ai").join("models.json"))
}

pub fn detect_workbuddy_installation() -> (bool, Option<String>) {
    // 0. 优先检查用户已保存的自定义安装路径
    let saved = crate::app_paths::load_app_paths();
    if let Some(ref custom) = saved.workbuddy_client_path {
        let p = PathBuf::from(custom);
        if p.exists() {
            return (true, Some(custom.clone()));
        }
    }

    // 1. 调用系统化深度探测模式 (进程、Store应用包、注册表、标准目录与多盘符)
    let detected = crate::app_paths::detect_workbuddy_client_path();
    if detected.exists && !detected.path.is_empty() {
        return (true, Some(detected.path));
    }

    (false, None)
}

pub fn get_workbuddy_config() -> Result<WorkbuddyUIConfig, AppError> {
    let path = workbuddy_config_path()?;
    let config_exists = path.exists();
    let (is_installed, app_path) = detect_workbuddy_installation();

    let mut base_url = "https://bob-api.com/".to_string();
    let mut api_key = String::new();
    let mut model = "gpt-5.6-sol".to_string();

    let mut supports_tool_call = true;
    let mut supports_images = true;
    let mut supports_reasoning = true;
    let mut only_reasoning = false;
    let mut can_disable_thinking = true;
    let mut use_custom_protocol = false;
    let mut default_effort = String::new();
    let mut supported_efforts = vec!["medium".to_string()];
    let mut max_input_tokens = Some(32768);
    let mut max_output_tokens = Some(32768);

    if config_exists {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                // 兼容数组格式与 { models: [...] } 两种格式
                let entries: Vec<WorkbuddyModelEntry> =
                    if let Ok(arr) = serde_json::from_str::<Vec<WorkbuddyModelEntry>>(trimmed) {
                        arr
                    } else if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        if let Some(models_val) = obj.get("models") {
                            serde_json::from_value(models_val.clone()).unwrap_or_default()
                        } else {
                            Vec::new()
                        }
                    } else {
                        Vec::new()
                    };

                // 查找 Custom 供应商或第一条可用模型
                if let Some(entry) = entries
                    .iter()
                    .find(|e| e.vendor == "Custom")
                    .or_else(|| entries.first())
                {
                    model = entry.id.clone();
                    if let Some(k) = &entry.api_key {
                        api_key = k.clone();
                    }

                    // 规范化 URL 映射回预设节点
                    let raw_url = entry.url.trim_end_matches('/');
                    let stripped = raw_url.strip_suffix("/v1").unwrap_or(raw_url);
                    if stripped.starts_with("https://bob-api.com") {
                        base_url = "https://bob-api.com/".to_string();
                    } else if stripped.starts_with("https://taijiai.online") {
                        base_url = "https://taijiai.online/".to_string();
                    } else if !stripped.is_empty() {
                        base_url = format!("{}/", stripped);
                    }

                    supports_tool_call = entry.supports_tool_call;
                    supports_images = entry.supports_images;
                    supports_reasoning = entry.supports_reasoning;
                    only_reasoning = entry.only_reasoning.unwrap_or(false);
                    use_custom_protocol = entry.use_custom_protocol;

                    if let Some(reasoning) = &entry.reasoning {
                        if let Some(efforts) = &reasoning.supported_efforts {
                            supported_efforts = efforts.clone();
                        }
                        if let Some(de) = &reasoning.default_effort {
                            default_effort = de.clone();
                        }
                        if let Some(cdt) = reasoning.can_disable_thinking {
                            can_disable_thinking = cdt;
                        }
                    }

                    max_input_tokens = entry.max_input_tokens;
                    max_output_tokens = entry.max_output_tokens;
                }
            }
        }
    }

    Ok(WorkbuddyUIConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: path.display().to_string(),
        is_installed: is_installed || config_exists,
        app_path,
        supports_tool_call,
        supports_images,
        supports_reasoning,
        only_reasoning,
        can_disable_thinking,
        use_custom_protocol,
        default_effort,
        supported_efforts,
        max_input_tokens,
        max_output_tokens,
    })
}

pub fn set_workbuddy_config(payload: WorkbuddySavePayload) -> Result<(), AppError> {
    let path = workbuddy_config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // 规范化后端请求 URL
    // 当 useCustomProtocol 为 false 时，WorkBuddy 会自动补全 /chat/completions，因此 base_url 应传入形如 https://bob-api.com/v1
    let normalized_url = if payload.use_custom_protocol {
        payload.url.trim().to_string()
    } else {
        let trimmed = payload.url.trim().trim_end_matches('/');
        if trimmed.ends_with("/v1") {
            trimmed.to_string()
        } else {
            format!("{}/v1", trimmed)
        }
    };

    // 读取现有配置，保留其他已存在的模型
    let mut entries: Vec<WorkbuddyModelEntry> = if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let trimmed = content.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else if let Ok(arr) = serde_json::from_str::<Vec<WorkbuddyModelEntry>>(trimmed) {
                arr
            } else if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(models_val) = obj.get("models") {
                    serde_json::from_value(models_val.clone()).unwrap_or_default()
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let model_id = payload.model.trim().to_string();

    let reasoning_config = if payload.supports_reasoning {
        Some(WorkbuddyReasoning {
            supported_efforts: if payload.supported_efforts.is_empty() {
                None
            } else {
                Some(payload.supported_efforts)
            },
            default_effort: if payload.default_effort.as_deref().unwrap_or("").is_empty() {
                None
            } else {
                payload.default_effort
            },
            can_disable_thinking: if payload.can_disable_thinking {
                None // WorkBuddy 默认为 true
            } else {
                Some(false)
            },
        })
    } else {
        None
    };

    let new_entry = WorkbuddyModelEntry {
        id: model_id.clone(),
        name: model_id.clone(),
        vendor: "Custom".to_string(),
        url: normalized_url,
        api: "openai-responses".to_string(),
        api_key: if payload.api_key.trim().is_empty() {
            None
        } else {
            Some(payload.api_key.trim().to_string())
        },
        supports_tool_call: payload.supports_tool_call,
        supports_images: payload.supports_images,
        supports_reasoning: payload.supports_reasoning,
        only_reasoning: if payload.only_reasoning {
            Some(true)
        } else {
            None
        },
        use_custom_protocol: payload.use_custom_protocol,
        reasoning: reasoning_config,
        max_input_tokens: payload.max_input_tokens,
        max_output_tokens: payload.max_output_tokens,
        temperature: None,
        disabled: None,
    };

    // 如果已存在同 id 或 vendor 为 Custom 的模型，则更新；否则追加
    if let Some(idx) = entries
        .iter()
        .position(|e| e.id == model_id || e.vendor == "Custom")
    {
        entries[idx] = new_entry;
    } else {
        entries.push(new_entry);
    }

    let json_text = serde_json::to_string_pretty(&entries)?;

    std::fs::write(&path, json_text)?;

    Ok(())
}

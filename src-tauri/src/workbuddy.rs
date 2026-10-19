use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_vendor() -> String {
    "Custom".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyModelEntry {
    pub id: String,
    pub name: String,
    #[serde(default = "default_vendor")]
    pub vendor: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default = "default_true")]
    pub supports_tool_call: bool,
    #[serde(default = "default_true")]
    pub supports_images: bool,
    #[serde(default = "default_true")]
    pub supports_reasoning: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only_reasoning: Option<bool>,
    #[serde(default)]
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
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyReasoning {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_efforts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_disable_thinking: Option<bool>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
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

    // 已配置的所有模型列表（支持多模型拼接）
    pub configured_models: Vec<WorkbuddyModelEntry>,
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

pub fn workbuddy_primary_config_path() -> Result<PathBuf, AppError> {
    if let Ok(dir) = std::env::var("WORKBUDDY_CONFIG_DIR") {
        let p = PathBuf::from(dir.trim());
        if !p.as_os_str().is_empty() {
            return Ok(p.join("models.json"));
        }
    }
    if let Ok(dir) = std::env::var("CODEBUDDY_CONFIG_DIR") {
        let p = PathBuf::from(dir.trim());
        if !p.as_os_str().is_empty() {
            return Ok(p.join("models.json"));
        }
    }
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;

    // 默认主路径为官方标准 WorkBuddy 路径: ~/.workbuddy/models.json
    Ok(home.join(".workbuddy").join("models.json"))
}

#[allow(dead_code)]
pub fn workbuddy_config_path() -> Result<PathBuf, AppError> {
    workbuddy_primary_config_path()
}

/// 获取 WorkBuddy 所有可能探测和同步写入的配置文件候选路径
/// 包含官方标准路径 ~/.workbuddy/models.json 以及兼容历史/特定版本的 ~/.workbuddy-ai/models.json
pub fn get_all_workbuddy_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(dir) = std::env::var("WORKBUDDY_CONFIG_DIR") {
        let p = PathBuf::from(dir.trim());
        if !p.as_os_str().is_empty() {
            let m = p.join("models.json");
            if !paths.contains(&m) {
                paths.push(m);
            }
        }
    }
    if let Ok(dir) = std::env::var("CODEBUDDY_CONFIG_DIR") {
        let p = PathBuf::from(dir.trim());
        if !p.as_os_str().is_empty() {
            let m = p.join("models.json");
            if !paths.contains(&m) {
                paths.push(m);
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        // 1. 官方标准 WorkBuddy 路径 (其他用户及主流版本使用)
        let std_path = home.join(".workbuddy").join("models.json");
        if !paths.contains(&std_path) {
            paths.push(std_path);
        }
        // 2. 兼容路径 ~/.workbuddy-ai/models.json
        let ai_path = home.join(".workbuddy-ai").join("models.json");
        if !paths.contains(&ai_path) {
            paths.push(ai_path);
        }
    }
    paths
}

/// 读取并聚合 WorkBuddy 在所有候选路径（~/.workbuddy 与 ~/.workbuddy-ai）中的模型配置
/// 返回 (聚合后的模型列表, 主路径, 是否至少存在一个配置文件)
pub fn read_all_workbuddy_entries() -> Result<(Vec<WorkbuddyModelEntry>, PathBuf, bool), AppError> {
    let primary_path = workbuddy_primary_config_path().unwrap_or_else(|_| {
        dirs::home_dir()
            .map(|h| h.join(".workbuddy").join("models.json"))
            .unwrap_or_default()
    });

    let all_paths = get_all_workbuddy_config_paths();
    let mut merged: Vec<WorkbuddyModelEntry> = Vec::new();
    let mut any_exists = false;

    // 1. 优先读取主配置文件 (~/.workbuddy/models.json)
    let primary_count = if primary_path.exists() {
        any_exists = true;
        let p_entries = read_workbuddy_entries(&primary_path)?;
        let count = p_entries.len();
        merged.extend(p_entries);
        count
    } else {
        0
    };

    // 2. 遍历其他兼容路径（例如 ~/.workbuddy-ai/models.json），合并尚未记录的自定义模型
    for path in &all_paths {
        if path == &primary_path {
            continue;
        }
        if path.exists() {
            any_exists = true;
            let other_entries = read_workbuddy_entries(path)?;
            for entry in other_entries {
                if !merged.iter().any(|m| m.id == entry.id) {
                    merged.push(entry);
                }
            }
        }
    }

    // 3. 智能自动同步兼容：
    // 若主路径 (~/.workbuddy/models.json) 尚不存在或其模型数少于合并后的模型数（例如 .workbuddy-ai 中配置了更多模型），
    // 自动将聚合配置通过安全原子写入主路径
    if !merged.is_empty() && (!primary_path.exists() || primary_count < merged.len()) {
        if let Ok(json_text) = serde_json::to_string_pretty(&merged) {
            if crate::safe_fs::safe_write_file(&primary_path, json_text.as_bytes()).is_ok() {
                any_exists = true;
            }
        }
    }

    Ok((merged, primary_path, any_exists))
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

/// 解析 WorkBuddy 本地 models.json 配置文件内容，支持标准数组格式与包装对象格式
pub fn parse_workbuddy_entries_from_str(
    content: &str,
) -> Result<Vec<WorkbuddyModelEntry>, AppError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // 优先尝试标准数组格式: [ { ... }, { ... } ]
    if let Ok(arr) = serde_json::from_str::<Vec<WorkbuddyModelEntry>>(trimmed) {
        return Ok(arr);
    }

    // 兼容可能存在的对象格式: { "models": [ ... ] }
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(models_val) = obj.get("models") {
            if let Ok(arr) = serde_json::from_value::<Vec<WorkbuddyModelEntry>>(models_val.clone())
            {
                return Ok(arr);
            }
        }
    }

    Err(AppError::Other(
        "WorkBuddy 配置文件内容损坏或格式不受支持".to_string(),
    ))
}

pub fn read_workbuddy_entries(path: &PathBuf) -> Result<Vec<WorkbuddyModelEntry>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(path)?;
    parse_workbuddy_entries_from_str(&content)
}

pub fn get_workbuddy_config() -> Result<WorkbuddyUIConfig, AppError> {
    let (entries, primary_path, config_exists) = read_all_workbuddy_entries()?;
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

    Ok(WorkbuddyUIConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: primary_path.display().to_string(),
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
        configured_models: entries,
    })
}

pub fn set_workbuddy_config(payload: WorkbuddySavePayload) -> Result<(), AppError> {
    if crate::credential_policy::is_managed_key(&payload.api_key) {
        crate::credential_policy::assert_managed_key_destination(
            &payload.url,
            &crate::credential_policy::default_managed_origins(),
            crate::credential_policy::loopback_http_allowed(),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    } else {
        crate::credential_policy::validate_endpoint(
            payload.url.trim(),
            crate::credential_policy::loopback_http_allowed(),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    }
    let (mut entries, primary_path, _) = read_all_workbuddy_entries()?;
    let all_paths = get_all_workbuddy_config_paths();

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
            extra: serde_json::Map::new(),
        })
    } else {
        None
    };

    let new_entry = WorkbuddyModelEntry {
        id: model_id.clone(),
        name: model_id.clone(),
        vendor: "Custom".to_string(),
        url: normalized_url,
        api: Some("openai-responses".to_string()),
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
        extra: serde_json::Map::new(),
    };

    // 核心变更：仅当在已配置模型中存在完全相同 model_id 时更新该项；
    // 否则直接作为新模型追加（拼接）至模型数组末尾，绝不覆盖已有模型
    if let Some(idx) = entries.iter().position(|e| e.id == model_id) {
        let mut updated = new_entry;
        updated.extra = entries[idx].extra.clone();
        if entries[idx].api.is_some() {
            updated.api = entries[idx].api.clone();
        }
        entries[idx] = updated;
    } else {
        entries.push(new_entry);
    }

    let json_text = serde_json::to_string_pretty(&entries)?;

    // 核心保证：
    // 1. 优先保证官方标准主路径 (~/.workbuddy/models.json) 原子安全写入
    crate::safe_fs::safe_write_file(&primary_path, json_text.as_bytes())?;

    // 2. 双向原子级同步写入所有其他候选兼容路径（~/.workbuddy-ai/models.json 等）
    // 若兼容路径存在或其父目录已存在，必须安全写入；写入失败必须阻断并报错，不可静默吞掉
    for path in all_paths {
        if path == primary_path {
            continue;
        }
        if path.exists() || path.parent().map(|p| p.exists()).unwrap_or(false) {
            crate::safe_fs::safe_write_file(&path, json_text.as_bytes())?;
        }
    }

    Ok(())
}

pub fn delete_workbuddy_model(model_id: String) -> Result<Vec<WorkbuddyModelEntry>, AppError> {
    let (mut entries, primary_path, _) = read_all_workbuddy_entries()?;
    let all_paths = get_all_workbuddy_config_paths();
    let original_len = entries.len();
    entries.retain(|e| e.id != model_id.trim());

    if entries.len() != original_len {
        let json_text = serde_json::to_string_pretty(&entries)?;

        // 1. 原子写入主路径
        crate::safe_fs::safe_write_file(&primary_path, json_text.as_bytes())?;

        // 2. 同步清理其他兼容路径
        for path in all_paths {
            if path == primary_path {
                continue;
            }
            if path.exists() {
                crate::safe_fs::safe_write_file(&path, json_text.as_bytes())?;
            }
        }
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_multi_model_json_with_and_without_api() {
        let sample = r#"[
  {
    "id": "gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "api": "openai-responses",
    "apiKey": "sk-test1",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false,
    "reasoning": {
      "supportedEfforts": [
        "medium"
      ]
    },
    "maxInputTokens": 32768,
    "maxOutputTokens": 32768
  },
  {
    "id": "gpt-6-sol",
    "name": "gpt-6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "apiKey": "sk-test2",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false,
    "reasoning": {
      "supportedEfforts": [
        "medium"
      ]
    },
    "maxInputTokens": 32768,
    "maxOutputTokens": 32768
  }
]"#;

        let entries = parse_workbuddy_entries_from_str(sample).expect("valid sample");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "gpt-5.6-sol");
        assert_eq!(entries[0].api, Some("openai-responses".to_string()));
        assert_eq!(entries[1].id, "gpt-6-sol");
        assert_eq!(entries[1].api, None);
    }

    #[test]
    fn test_parse_corrupt_json_fails() {
        let corrupt = r#"{"id": "gpt-5", "name":"#;
        let res = parse_workbuddy_entries_from_str(corrupt);
        assert!(res.is_err(), "Corrupted config must fail to parse");
    }

    #[test]
    fn test_append_new_model_does_not_overwrite_existing() {
        let sample = r#"[
  {
    "id": "gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "api": "openai-responses",
    "apiKey": "sk-test1",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false
  }
]"#;

        let mut entries = parse_workbuddy_entries_from_str(sample).expect("valid sample");
        assert_eq!(entries.len(), 1);

        let new_model_id = "gpt-6-sol".to_string();
        let new_entry = WorkbuddyModelEntry {
            id: new_model_id.clone(),
            name: new_model_id.clone(),
            vendor: "Custom".to_string(),
            url: "https://bob-api.com/v1".to_string(),
            api: Some("openai-responses".to_string()),
            api_key: Some("sk-test2".to_string()),
            supports_tool_call: true,
            supports_images: true,
            supports_reasoning: true,
            only_reasoning: None,
            use_custom_protocol: false,
            reasoning: None,
            max_input_tokens: Some(32768),
            max_output_tokens: Some(32768),
            temperature: None,
            disabled: None,
            extra: serde_json::Map::new(),
        };

        // 仅匹配同 ID
        if let Some(idx) = entries.iter().position(|e| e.id == new_model_id) {
            entries[idx] = new_entry;
        } else {
            entries.push(new_entry);
        }

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "gpt-5.6-sol");
        assert_eq!(entries[1].id, "gpt-6-sol");
    }

    #[test]
    fn test_update_model_with_same_id() {
        let sample = r#"[
  {
    "id": "gpt-5.6-sol",
    "name": "gpt-5.6-sol",
    "vendor": "Custom",
    "url": "https://bob-api.com/v1",
    "apiKey": "sk-old",
    "supportsToolCall": true,
    "supportsImages": true,
    "supportsReasoning": true,
    "useCustomProtocol": false
  }
]"#;

        let mut entries = parse_workbuddy_entries_from_str(sample).expect("valid sample");
        assert_eq!(entries.len(), 1);

        let update_id = "gpt-5.6-sol".to_string();
        let updated_entry = WorkbuddyModelEntry {
            id: update_id.clone(),
            name: update_id.clone(),
            vendor: "Custom".to_string(),
            url: "https://bob-api.com/v1".to_string(),
            api: Some("openai-responses".to_string()),
            api_key: Some("sk-new".to_string()),
            supports_tool_call: true,
            supports_images: true,
            supports_reasoning: true,
            only_reasoning: None,
            use_custom_protocol: false,
            reasoning: None,
            max_input_tokens: Some(65536),
            max_output_tokens: Some(65536),
            temperature: None,
            disabled: None,
            extra: serde_json::Map::new(),
        };

        if let Some(idx) = entries.iter().position(|e| e.id == update_id) {
            entries[idx] = updated_entry;
        } else {
            entries.push(updated_entry);
        }

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "gpt-5.6-sol");
        assert_eq!(entries[0].api_key, Some("sk-new".to_string()));
        assert_eq!(entries[0].max_input_tokens, Some(65536));
    }

    #[test]
    fn test_candidate_paths_contain_standard_and_ai() {
        let paths = get_all_workbuddy_config_paths();
        assert!(!paths.is_empty());
        let has_std = paths.iter().any(|p| {
            p.ends_with(".workbuddy\\models.json") || p.ends_with(".workbuddy/models.json")
        });
        let has_ai = paths.iter().any(|p| {
            p.ends_with(".workbuddy-ai\\models.json") || p.ends_with(".workbuddy-ai/models.json")
        });
        assert!(
            has_std,
            "Candidate paths must contain standard .workbuddy/models.json"
        );
        assert!(
            has_ai,
            "Candidate paths must contain compatible .workbuddy-ai/models.json"
        );
    }

    #[test]
    fn test_workbuddy_primary_config_path_defaults_to_standard() {
        let primary = workbuddy_primary_config_path().expect("should return primary path");
        assert!(
            primary.ends_with(".workbuddy\\models.json")
                || primary.ends_with(".workbuddy/models.json"),
            "Primary path should default to .workbuddy/models.json"
        );
    }

    #[test]
    fn test_read_all_workbuddy_entries_does_not_panic() {
        let (entries, primary_path, _exists) =
            read_all_workbuddy_entries().expect("read entries successfully");
        assert!(
            primary_path.ends_with(".workbuddy\\models.json")
                || primary_path.ends_with(".workbuddy/models.json"),
            "Primary path should be standard"
        );
        // 如果当前环境中存在 .workbuddy-ai/models.json，自动同步后主路径也应存在
        if !entries.is_empty() {
            assert!(
                primary_path.exists(),
                "Primary path should have been auto-synced"
            );
        }
    }
}

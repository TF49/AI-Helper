use crate::error::AppError;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TraeWorkModelEntry {
    pub name: String,
    pub display_name: String,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_custom_base_url: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builder: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_preset: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_connect: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ak: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multimodal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_source: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selectable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_type: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_enable: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turn: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_remote_service: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_config: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_size: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saas_usage: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TraeWorkUIConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub api_format: String,
    pub display_name: String,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,
    pub is_full_url: bool,

    // 高级功能开关
    pub supports_images: bool,
    pub thinking_mode: String, // "default" | "on" | "off"
    pub max_turn: u32,         // 默认 500
    pub token_input: Option<u32>,
    pub token_output: Option<u32>,

    // 采样参数
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i32>,

    // 已解析的所有自定义模型
    pub configured_models: Vec<TraeWorkModelEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TraeWorkSavePayload {
    pub api_format: String,
    pub base_url: String,
    pub is_full_url: bool,
    pub model: String,
    pub display_name: Option<String>,
    pub api_key: String,

    pub supports_images: bool,
    pub thinking_mode: String,
    pub max_turn: u32,
    pub token_input: Option<u32>,
    pub token_output: Option<u32>,

    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i32>,
}

/// 获取 Trae Work 本地 SQLite 状态数据库路径
pub fn traework_db_path() -> Result<PathBuf, AppError> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let base = PathBuf::from(&appdata);
            let candidates = [
                base.join("TRAE SOLO CN")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                base.join("TRAE SOLO")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                base.join("Trae CN")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                base.join("Trae")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                base.join("TraeWork CN")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                base.join("TraeWork")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
            ];
            for cand in &candidates {
                if cand.exists() {
                    return Ok(cand.clone());
                }
            }
            return Ok(candidates[0].clone());
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let app_sup = home.join("Library").join("Application Support");
            let candidates = [
                app_sup
                    .join("TRAE SOLO CN")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                app_sup
                    .join("TRAE SOLO")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                app_sup
                    .join("Trae CN")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                app_sup
                    .join("Trae")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
                app_sup
                    .join("TraeWork")
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
            ];
            for cand in &candidates {
                if cand.exists() {
                    return Ok(cand.clone());
                }
            }
            return Ok(candidates[0].clone());
        }
    }

    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".trae").join("state.vscdb"))
}

pub fn detect_traework_installation() -> (bool, Option<String>) {
    // 0. 优先检查用户已保存的自定义安装路径
    let saved = crate::app_paths::load_app_paths();
    if let Some(ref custom) = saved.traework_client_path {
        let p = PathBuf::from(custom);
        if p.exists() {
            return (true, Some(custom.clone()));
        }
    }

    let detected = crate::app_paths::detect_traework_client_path();
    if detected.exists && !detected.path.is_empty() {
        return (true, Some(detected.path));
    }

    (false, None)
}

/// 解析单条模型 JSON 节点对象为 TraeWorkModelEntry
pub fn parse_model_node(val: &serde_json::Value) -> Option<TraeWorkModelEntry> {
    let obj = val.as_object()?;
    let name = obj.get("name")?.as_str()?.to_string();
    let display_name = obj
        .get("display_name")
        .and_then(|v| v.as_str())
        .unwrap_or(&name)
        .to_string();
    let provider = obj
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("custom_responses_compatible")
        .to_string();

    let mut entry = serde_json::from_value::<TraeWorkModelEntry>(val.clone()).ok()?;
    entry.name = name;
    entry.display_name = display_name;
    entry.provider = provider;
    Some(entry)
}

/// 扫描并安全解析 state.vscdb 中当前用户配置的所有自定义模型
pub fn read_traework_models(
    db_path: &PathBuf,
) -> Result<(Option<String>, Vec<TraeWorkModelEntry>), AppError> {
    if !db_path.exists() {
        return Ok((None, Vec::new()));
    }

    // 以只读标志打开，避免竞争
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| AppError::Other(format!("打开 Trae SQLite 数据库失败: {}", e)))?;

    // 设置 5 秒繁忙超时，防止客户端打开时锁库
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    // 查询所有匹配 model_list_map 的键 (兼容 : 与 _)
    let mut stmt = conn
        .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.model_list_map'")
        .map_err(|e| AppError::Other(format!("查询 ItemTable 失败: {}", e)))?;

    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let val: String = row.get(1)?;
            Ok((key, val))
        })
        .map_err(|e| AppError::Other(format!("读取记录失败: {}", e)))?
        .filter_map(|r| r.ok())
        .collect();

    let mut detected_user_id: Option<String> = None;
    let mut collected = Vec::new();
    let mut seen_names = HashSet::new();

    for (key, json_str) in rows {
        if let Some(uid) = key.split(':').next() {
            if uid.chars().all(|c| c.is_ascii_digit()) && !uid.is_empty() {
                detected_user_id = Some(uid.to_string());
            }
        }

        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if let Some(map) = json_val.as_object() {
                for (_category, models_val) in map {
                    if let Some(arr) = models_val.as_array() {
                        for m in arr {
                            if let Some(entry) = parse_model_node(m) {
                                // 仅保留用户自定义模型 (provider 包含 custom 或 config_source == 3 或 is_preset 为 false)
                                let is_custom = entry.provider.contains("custom")
                                    || entry.config_source == Some(3)
                                    || entry.is_preset == Some(false);

                                if is_custom && !seen_names.contains(&entry.name) {
                                    seen_names.insert(entry.name.clone());
                                    collected.push(entry);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok((detected_user_id, collected))
}

pub fn get_traework_config() -> Result<TraeWorkUIConfig, AppError> {
    let db_path = traework_db_path()?;
    let config_exists = db_path.exists();
    let (is_installed, app_path) = detect_traework_installation();

    let mut base_url = "https://bob-api.com/v1/responses".to_string();
    let mut api_key = String::new();
    let mut model = "gpt-5.6-sol".to_string();
    let mut api_format = "custom_responses_compatible".to_string();
    let mut display_name = "gpt-5.6-sol".to_string();
    let mut is_full_url = true;

    let mut supports_images = true;
    let mut thinking_mode = "default".to_string();
    let mut max_turn = 500;
    let mut token_input: Option<u32> = None;
    let mut token_output: Option<u32> = None;
    let mut temperature: Option<f64> = None;
    let mut top_p: Option<f64> = None;
    let mut top_k: Option<i32> = None;

    let (_user_id, entries) = read_traework_models(&db_path).unwrap_or((None, Vec::new()));

    // 若找到配置，以首个自定义模型或匹配项回填默认 UI 表单
    if let Some(entry) = entries.first() {
        model = entry
            .name
            .split("//")
            .last()
            .unwrap_or(&entry.name)
            .to_string();
        display_name = entry.display_name.clone();
        api_format = entry.provider.clone();

        if let Some(b) = &entry.base_url {
            base_url = b.clone();
            // 如果 base_url 以特定后缀结尾且不是仅根路径，则推导为 full url
            if b.ends_with("/chat/completions")
                || b.ends_with("/responses")
                || b.ends_with("/v1/messages")
            {
                is_full_url = true;
            }
        }

        if let Some(m) = entry.multimodal {
            supports_images = m;
        }

        if let Some(te) = entry.thinking_enable {
            thinking_mode = match te {
                1 => "on".to_string(),
                2 => "off".to_string(),
                _ => "default".to_string(),
            };
        }

        if let Some(mt) = entry.max_turn {
            if mt > 0 {
                max_turn = mt as u32;
            }
        }

        token_input = entry.prompt_max_tokens;
        token_output = entry.max_tokens;
        temperature = entry.temperature;
        top_p = entry.top_p;
        top_k = entry.top_k;

        // 若 ak 存在，脱敏显示指示已配置
        if let Some(k) = &entry.ak {
            if !k.is_empty() {
                api_key = "••••••••••••••••".to_string();
            }
        }
    }

    Ok(TraeWorkUIConfig {
        base_url,
        api_key,
        model,
        api_format,
        display_name,
        config_exists,
        config_path: db_path.display().to_string(),
        is_installed: is_installed || config_exists,
        app_path,
        is_full_url,
        supports_images,
        thinking_mode,
        max_turn,
        token_input,
        token_output,
        temperature,
        top_p,
        top_k,
        configured_models: entries,
    })
}

/// 保存模型配置至本地 SQLite (支持热更新与追加)
pub fn set_traework_config(payload: TraeWorkSavePayload) -> Result<(), AppError> {
    let db_path = traework_db_path()?;
    if !db_path.exists() {
        return Err(AppError::ConfigNotFound(format!(
            "Trae 状态数据库不存在: {}",
            db_path.display()
        )));
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| AppError::Other(format!("打开 Trae SQLite 数据库失败: {}", e)))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    // 1. 查找包含当前用户 ID 的 key (兼容 : 与 _ 分隔符)
    let mut stmt = conn
        .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.model_list_map'")
        .map_err(|e| AppError::Other(format!("查询 ItemTable 失败: {}", e)))?;

    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            let k: String = row.get(0)?;
            let v: String = row.get(1)?;
            Ok((k, v))
        })
        .map_err(|e| AppError::Other(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Err(AppError::Other(
            "未检测到 Trae 登录用户配置项，请先启动并登录一次 Trae 客户端".to_string(),
        ));
    }

    let model_id = payload.model.trim().to_string();
    let display_name = payload
        .display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| model_id.clone());

    let provider = if payload.api_format.trim().is_empty() {
        "custom_responses_compatible".to_string()
    } else {
        payload.api_format.trim().to_string()
    };

    let composite_name = format!("{}//{}", provider, model_id);

    // 2. 先扫描现有记录中是否已有该模型，提取旧的 custom_model_id 与 ak，避免覆盖或遗失密文
    let mut existing_custom_model_id: Option<String> = None;
    let mut existing_ak: Option<String> = None;
    let mut existing_icon: Option<serde_json::Value> = None;

    for (_k, json_str) in &rows {
        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(map) = json_val.as_object() {
                for (_cat, list_val) in map {
                    if let Some(arr) = list_val.as_array() {
                        for item in arr {
                            let item_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let item_disp = item
                                .get("display_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if item_name == composite_name
                                || item_disp == display_name
                                || item_name.ends_with(&format!("//{}", model_id))
                            {
                                if existing_custom_model_id.is_none() {
                                    existing_custom_model_id = item
                                        .get("custom_model_id")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string());
                                }
                                if existing_ak.is_none() {
                                    existing_ak = item
                                        .get("ak")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.trim().is_empty())
                                        .map(|s| s.to_string());
                                }
                                if existing_icon.is_none() {
                                    existing_icon = item.get("icon").cloned();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 格式化 base_url
    let normalized_url = if payload.is_full_url {
        payload.base_url.trim().to_string()
    } else {
        let trimmed = payload.base_url.trim().trim_end_matches('/');
        match provider.as_str() {
            "custom_openai_compatible" => {
                if trimmed.ends_with("/chat/completions") {
                    trimmed.to_string()
                } else {
                    format!("{}/chat/completions", trimmed)
                }
            }
            "custom_anthropic_compatible" => {
                if trimmed.ends_with("/v1/messages") {
                    trimmed.to_string()
                } else {
                    format!("{}/v1/messages", trimmed)
                }
            }
            _ => {
                if trimmed.ends_with("/responses") {
                    trimmed.to_string()
                } else {
                    format!("{}/responses", trimmed)
                }
            }
        }
    };

    let thinking_enable = match payload.thinking_mode.as_str() {
        "on" => 1,
        "off" => 2,
        _ => 0,
    };

    // 保留原有 custom_model_id，若无则生成
    let final_custom_model_id = existing_custom_model_id.unwrap_or_else(|| {
        format!(
            "2800{:06}",
            (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                % 1_000_000)
        )
    });

    // 处理 API Key (ak)：若传入为空或包含掩码符 '•'，优先保留现有已存的 ak
    let final_ak = if payload.api_key.trim().is_empty() || payload.api_key.contains('•') {
        existing_ak
    } else {
        Some(payload.api_key.trim().to_string())
    };

    let default_icon = serde_json::json!({
        "dark": "https://lf-cdn.trae.com.cn/obj/trae-com-cn/model/default-custom-dark.svg",
        "light": "https://lf-cdn.trae.com.cn/obj/trae-com-cn/model/default-custom-light.svg"
    });

    let new_entry = TraeWorkModelEntry {
        name: composite_name.clone(),
        display_name: display_name.clone(),
        provider: provider.clone(),
        base_url: Some(normalized_url.clone()),
        is_custom_base_url: Some(true),
        custom_model_id: Some(final_custom_model_id.clone()),
        model_type: Some("chat_model".to_string()),
        builder: Some(true),
        is_preset: Some(false),
        client_connect: Some(true),
        status: Some(true),
        ak: final_ak,
        multimodal: Some(payload.supports_images),
        config_source: Some(3),
        selectable: Some(true),
        auth_type: Some(0),
        thinking_enable: Some(thinking_enable),
        max_turn: Some(payload.max_turn as i32),
        temperature: payload.temperature,
        top_p: payload.top_p,
        top_k: payload.top_k,
        max_tokens: payload.token_output,
        prompt_max_tokens: payload.token_input,
        config_name: Some(composite_name.clone()),
        use_remote_service: Some(false),
        is_default: Some(false),
        custom_config: Some("".to_string()),
        sk: Some("".to_string()),
        icon: Some(existing_icon.unwrap_or(default_icon)),
        context_window_size: Some(serde_json::json!({
            "max": payload.token_input,
            "default": null
        })),
        max_turns: Some(serde_json::json!({
            "max": payload.max_turn,
            "default": null
        })),
        saas_usage: Some(serde_json::json!({
            "max": null,
            "default": null
        })),
        features: Some(serde_json::json!({
            "provider": {
                "enable": true,
                "data": {
                    "provider_name": provider
                }
            },
            "context_windows": {
                "enable": true,
                "data": {
                    "dev_context": null,
                    "max_context": payload.token_input,
                    "max_context_list": null,
                    "dev_turns": null,
                    "max_turns": payload.max_turn
                }
            }
        })),
        extra: serde_json::Map::new(),
    };

    let new_entry_val = serde_json::to_value(&new_entry)?;

    // 标准核心分类列表
    let core_categories = [
        "solo_work_lite",
        "solo_agent_lite",
        "solo_coder",
        "solo_design_lite",
        "solo_work_remote",
        "solo_agent_remote",
        "solo_design_remote",
        "assistant",
        "agent",
    ];

    // 遍历每一个 model_list_map 进行增量合并
    for (key, json_str) in rows {
        if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if let Some(map) = json_val.as_object_mut() {
                // 1. 先对 map 中现存的所有分类（如果是数组）做更新
                let mut updated_categories = HashSet::new();
                for (cat_name, list_val) in map.iter_mut() {
                    if let Some(arr) = list_val.as_array_mut() {
                        updated_categories.insert(cat_name.clone());
                        if let Some(pos) = arr.iter().position(|item| {
                            let item_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let item_disp = item
                                .get("display_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            item_name == composite_name || item_disp == display_name
                        }) {
                            arr[pos] = new_entry_val.clone();
                        } else {
                            arr.push(new_entry_val.clone());
                        }
                    }
                }

                // 2. 补全尚未存在的核心常用分类
                for cat in core_categories {
                    if !updated_categories.contains(cat) {
                        map.insert(
                            cat.to_string(),
                            serde_json::Value::Array(vec![new_entry_val.clone()]),
                        );
                    }
                }

                let updated_json = serde_json::to_string(&json_val)?;
                conn.execute(
                    "UPDATE ItemTable SET value = ? WHERE key = ?",
                    rusqlite::params![updated_json, key],
                )
                .map_err(|e| AppError::Other(format!("更新 ItemTable 失败: {}", e)))?;
            }
        }
    }

    // 3. 同步更新最近选中的模型记录 (recent_user_selection_by_agent_label)，以便客户端启动后自动激活该模型
    let mut sel_stmt = conn
        .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.recent_user_selection_by_agent_label'")
        .map_err(|e| AppError::Other(format!("查询 ItemTable 选单记录失败: {}", e)))?;

    let sel_rows: Vec<(String, String)> = sel_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| AppError::Other(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    for (sel_key, sel_json_str) in sel_rows {
        if let Ok(mut sel_json) = serde_json::from_str::<serde_json::Value>(&sel_json_str) {
            if let Some(sel_map) = sel_json.as_object_mut() {
                // 更新 solo_work_lite 与 solo_agent_lite 的激活模型
                for agent_label in ["solo_work_lite", "solo_agent_lite"] {
                    let agent_model_id = format!(
                        "{}_3_{}_{}_{}",
                        agent_label, provider, composite_name, final_custom_model_id
                    );
                    sel_map.insert(
                        agent_label.to_string(),
                        serde_json::json!({
                            "modelId": agent_model_id,
                            "mode": 0
                        }),
                    );
                }
                if let Ok(updated_sel_json) = serde_json::to_string(&sel_json) {
                    let _ = conn.execute(
                        "UPDATE ItemTable SET value = ? WHERE key = ?",
                        rusqlite::params![updated_sel_json, sel_key],
                    );
                }
            }
        }
    }

    Ok(())
}

/// 删除指定的模型
pub fn delete_traework_model(model_name: String) -> Result<Vec<TraeWorkModelEntry>, AppError> {
    let db_path = traework_db_path()?;
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| AppError::Other(format!("打开 Trae SQLite 数据库失败: {}", e)))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let mut stmt = conn
        .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.model_list_map'")
        .map_err(|e| AppError::Other(format!("查询 ItemTable 失败: {}", e)))?;

    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            let k: String = row.get(0)?;
            let v: String = row.get(1)?;
            Ok((k, v))
        })
        .map_err(|e| AppError::Other(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    let target = model_name.trim().to_string();

    for (key, json_str) in rows {
        if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if let Some(map) = json_val.as_object_mut() {
                for (_cat, list_val) in map.iter_mut() {
                    if let Some(arr) = list_val.as_array_mut() {
                        arr.retain(|item| {
                            let item_name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            let item_disp = item
                                .get("display_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            item_name != target
                                && item_disp != target
                                && !item_name.ends_with(&format!("//{}", target))
                        });
                    }
                }

                let updated_json = serde_json::to_string(&json_val)?;
                let _ = conn.execute(
                    "UPDATE ItemTable SET value = ? WHERE key = ?",
                    rusqlite::params![updated_json, key],
                );
            }
        }
    }

    let (_uid, remaining) = read_traework_models(&db_path).unwrap_or((None, Vec::new()));
    Ok(remaining)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_model_node_valid() {
        let sample = serde_json::json!({
            "name": "custom_responses_compatible//gpt-5.6-sol",
            "display_name": "gpt-5.6-sol",
            "provider": "custom_responses_compatible",
            "base_url": "https://bob-api.com/v1/responses",
            "is_custom_base_url": true,
            "custom_model_id": "2800545666",
            "status": true,
            "multimodal": true,
            "thinking_enable": 0,
            "max_turn": 500
        });

        let entry = parse_model_node(&sample).expect("parse entry");
        assert_eq!(entry.name, "custom_responses_compatible//gpt-5.6-sol");
        assert_eq!(entry.display_name, "gpt-5.6-sol");
        assert_eq!(entry.provider, "custom_responses_compatible");
        assert_eq!(entry.multimodal, Some(true));
        assert_eq!(entry.max_turn, Some(500));
    }
}

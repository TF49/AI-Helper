use crate::error::AppError;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

/// 选择真正包含 Trae 状态数据的数据库，而不是仅按目录名称命中第一个文件。
/// 多个 Trae/TraeWork 发行版可能同时留下 state.vscdb，模型写入错误数据库会表现为
/// “保存成功但客户端没有变化”。
fn choose_traework_db(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .filter(|path| path.is_file())
        .map(|path| {
            let mut model_keys = 0usize;
            let mut selection_keys = 0usize;
            if let Ok(conn) = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
            ) {
                let _ = conn.busy_timeout(std::time::Duration::from_millis(250));
                model_keys = conn
                    .query_row(
                        "SELECT COUNT(*) FROM ItemTable WHERE key LIKE '%AI.agent.model.model_list_map'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
                    .max(0) as usize;
                selection_keys = conn
                    .query_row(
                        "SELECT COUNT(*) FROM ItemTable WHERE key LIKE '%AI.agent.model.recent_user_selection_by_agent_label'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
                    .max(0) as usize;
            }
            let modified = path
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            (path.clone(), model_keys, selection_keys, modified)
        })
        .max_by_key(|(_, model_keys, selection_keys, modified)| {
            (*model_keys > 0, *selection_keys > 0, *model_keys, *selection_keys, *modified)
        })
        .map(|(path, _, _, _)| path)
}

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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TraeWorkSaveResult {
    /// 当前版本可安全完成的是本地兼容写入；Trae 官方服务端注册仍需走其 ai-agent RPC。
    pub persistence_mode: String,
    pub verified: bool,
    pub model_name: String,
    pub custom_model_id: Option<String>,
    pub warning: Option<String>,
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
            if let Some(path) = choose_traework_db(&candidates) {
                return Ok(path);
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
            if let Some(path) = choose_traework_db(&candidates) {
                return Ok(path);
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
            let clean = b.trim().trim_end_matches('/');
            is_full_url = clean.ends_with("/chat/completions")
                || clean.ends_with("/responses")
                || clean.ends_with("/messages");
            base_url = clean.to_string();
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

        // 回填 API Key (明文优先，方便在线测试与多模型复用)
        if let Some(k) = &entry.ak {
            api_key = k.clone();
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
/// 标准化 TraeWork 请求地址，兼容官方协议与第三方大模型网关 (如智谱 v4、火山 v3、Bob-API 等)
pub fn normalize_traework_url(base_url: &str, provider: &str, is_full_url: bool) -> String {
    let mut u = base_url.trim().trim_end_matches('/').to_string();
    if u.ends_with("/chat/completions") {
        u = u[..u.len() - 17].trim_end_matches('/').to_string();
    } else if u.ends_with("/responses") {
        u = u[..u.len() - 10].trim_end_matches('/').to_string();
    } else if u.ends_with("/messages") {
        u = u[..u.len() - 9].trim_end_matches('/').to_string();
    }

    if is_full_url {
        match provider {
            "custom_anthropic_compatible" => {
                if u.ends_with("/v1") {
                    format!("{u}/messages")
                } else {
                    format!("{u}/v1/messages")
                }
            }
            "custom_responses_compatible" => {
                if u.ends_with("/v1") {
                    format!("{u}/responses")
                } else {
                    format!("{u}/v1/responses")
                }
            }
            _ => {
                let last_segment = u.rsplit('/').next().unwrap_or_default();
                let is_version = last_segment.starts_with('v')
                    && last_segment.len() > 1
                    && last_segment[1..].chars().all(|c| c.is_ascii_digit());
                if is_version {
                    format!("{u}/chat/completions")
                } else {
                    format!("{u}/v1/chat/completions")
                }
            }
        }
    } else {
        match provider {
            "custom_anthropic_compatible" => {
                while u.ends_with("/v1") {
                    u = u[..u.len() - 3].trim_end_matches('/').to_string();
                }
                u
            }
            _ => {
                let last_segment = u.rsplit('/').next().unwrap_or_default();
                let is_version = last_segment.starts_with('v')
                    && last_segment.len() > 1
                    && last_segment[1..].chars().all(|c| c.is_ascii_digit());
                if is_version {
                    u
                } else {
                    format!("{u}/v1")
                }
            }
        }
    }
}

pub fn set_traework_config(payload: TraeWorkSavePayload) -> Result<TraeWorkSaveResult, AppError> {
    let db_path = traework_db_path()?;
    if !db_path.exists() {
        return Err(AppError::ConfigNotFound(format!(
            "Trae 状态数据库不存在: {}",
            db_path.display()
        )));
    }

    let model_id = payload.model.trim().to_string();
    if model_id.is_empty() {
        return Err(AppError::Other("模型 ID 不能为空".to_string()));
    }
    let display_name = payload
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&model_id)
        .to_string();
    let provider = if payload.api_format.trim().is_empty() {
        "custom_responses_compatible".to_string()
    } else {
        payload.api_format.trim().to_string()
    };
    let composite_name = format!("{}//{}", provider, model_id);
    let normalized_url = normalize_traework_url(&payload.base_url, &provider, payload.is_full_url);
    let thinking_enable = match payload.thinking_mode.as_str() {
        "on" => 1,
        "off" => 2,
        _ => 0,
    };

    let conn = Connection::open(&db_path)
        .map_err(|e| AppError::Other(format!("打开 Trae SQLite 数据库失败: {}", e)))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::Other(format!("开启 Trae SQLite 事务失败: {}", e)))?;

    let rows: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.model_list_map'",
            )
            .map_err(|e| AppError::Other(format!("查询 ItemTable 失败: {}", e)))?;
        let result = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| AppError::Other(format!("读取模型列表失败: {}", e)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Other(format!("读取模型列表失败: {}", e)))?;
        result
    };
    if rows.is_empty() {
        return Err(AppError::Other(
            "未检测到 Trae 登录用户配置项，请先启动并登录一次 Trae 客户端".to_string(),
        ));
    }

    let mut existing_custom_model_id = None;
    let mut existing_ak = None;
    let mut existing_icon = None;
    for (_, json_str) in &rows {
        let Ok(json_val) = serde_json::from_str::<serde_json::Value>(json_str) else {
            continue;
        };
        let Some(map) = json_val.as_object() else {
            continue;
        };
        for list_val in map.values() {
            let Some(arr) = list_val.as_array() else {
                continue;
            };
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
                    existing_custom_model_id = existing_custom_model_id.or_else(|| {
                        item.get("custom_model_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                    });
                    existing_ak = existing_ak.or_else(|| {
                        item.get("ak")
                            .and_then(|v| v.as_str())
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_string)
                    });
                    existing_icon = existing_icon.or_else(|| item.get("icon").cloned());
                }
            }
        }
    }

    let final_custom_model_id = existing_custom_model_id.unwrap_or_else(|| {
        format!(
            "2800{:06}",
            (std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                % 1_000_000)
        )
    });
    let final_ak = if payload.api_key.trim().is_empty() || payload.api_key.contains('•') {
        existing_ak
    } else {
        Some(payload.api_key.trim().to_string())
    };

    let new_entry = TraeWorkModelEntry {
        name: composite_name.clone(),
        display_name: display_name.clone(),
        provider: provider.clone(),
        base_url: Some(normalized_url),
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
        icon: Some(existing_icon.unwrap_or_else(|| {
            serde_json::json!({
                "dark": "https://lf-cdn.trae.com.cn/obj/trae-com-cn/model/default-custom-dark.svg",
                "light": "https://lf-cdn.trae.com.cn/obj/trae-com-cn/model/default-custom-light.svg"
            })
        })),
        context_window_size: Some(serde_json::json!({
            "max": payload.token_input,
            "default": null
        })),
        max_turns: Some(serde_json::json!({
            "max": payload.max_turn,
            "default": null
        })),
        saas_usage: Some(serde_json::json!({"max": null, "default": null})),
        features: Some(serde_json::json!({
            "provider": {"enable": true, "data": {"provider_name": provider}},
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
    let suffix = format!("//{}", model_id);
    let mut changed_model_rows = 0usize;

    // 只修改 Trae 已经创建的分类，不凭空生成不存在的分类；更新已有节点时以 merge
    // 方式写入，从而保留新版本 Trae 增加的未知字段。
    for (key, json_str) in &rows {
        let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(json_str) else {
            continue;
        };
        let Some(map) = json_val.as_object_mut() else {
            continue;
        };
        let mut changed = false;
        for list_val in map.values_mut() {
            let Some(arr) = list_val.as_array_mut() else {
                continue;
            };
            let matching = arr.iter().position(|item| {
                let item_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let item_disp = item
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                item_name == composite_name
                    || item_disp == display_name
                    || item_name.ends_with(&suffix)
            });
            if let Some(index) = matching {
                if let (Some(existing), Some(patch)) =
                    (arr[index].as_object_mut(), new_entry_val.as_object())
                {
                    for (field, value) in patch {
                        existing.insert(field.clone(), value.clone());
                    }
                } else {
                    arr[index] = new_entry_val.clone();
                }
            } else {
                arr.push(new_entry_val.clone());
            }
            changed = true;
        }
        if changed {
            let updated_json = serde_json::to_string(&json_val)?;
            tx.execute(
                "UPDATE ItemTable SET value = ? WHERE key = ?",
                rusqlite::params![updated_json, key],
            )
            .map_err(|e| AppError::Other(format!("更新 ItemTable 失败: {}", e)))?;
            changed_model_rows += 1;
        }
    }
    if changed_model_rows == 0 {
        return Err(AppError::Other(
            "Trae 模型列表结构无法识别，未执行任何写入".to_string(),
        ));
    }

    let make_model_id = |agent_label: &str| {
        format!(
            "{}_3_{}_{}_{}",
            agent_label, provider, composite_name, final_custom_model_id
        )
    };
    let selection_rows: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.recent_user_selection_by_agent_label'")
            .map_err(|e| AppError::Other(format!("查询 Trae 最近选择失败: {}", e)))?;
        let result = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| AppError::Other(format!("读取 Trae 最近选择失败: {}", e)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Other(format!("读取 Trae 最近选择失败: {}", e)))?;
        result
    };
    for (key, value) in selection_rows {
        let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&value) else {
            continue;
        };
        let Some(map) = json.as_object_mut() else {
            continue;
        };
        for agent_label in ["solo_work_lite", "solo_agent_lite"] {
            if map.contains_key(agent_label) {
                map.insert(
                    agent_label.to_string(),
                    serde_json::json!({"modelId": make_model_id(agent_label), "mode": 0}),
                );
            }
        }
        let updated_json = serde_json::to_string(&json)?;
        tx.execute(
            "UPDATE ItemTable SET value = ? WHERE key = ?",
            rusqlite::params![updated_json, key],
        )
        .map_err(|e| AppError::Other(format!("更新 Trae 最近选择失败: {}", e)))?;
    }

    // session_selected_model 由较新版本使用。只改已有会话中的同名 agent，避免污染历史会话结构。
    let session_rows: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%AI.agent.model.session_selected_model'")
            .map_err(|e| AppError::Other(format!("查询 Trae 会话模型失败: {}", e)))?;
        let result = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| AppError::Other(format!("读取 Trae 会话模型失败: {}", e)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Other(format!("读取 Trae 会话模型失败: {}", e)))?;
        result
    };
    for (key, value) in session_rows {
        let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&value) else {
            continue;
        };
        let Some(sessions) = json.as_object_mut() else {
            continue;
        };
        let mut changed = false;
        for session in sessions.values_mut() {
            let Some(session_map) = session.as_object_mut() else {
                continue;
            };
            for agent_label in ["solo_work_lite", "solo_agent_lite"] {
                if let Some(selection) = session_map.get_mut(agent_label) {
                    if let Some(selection_map) = selection.as_object_mut() {
                        selection_map.insert(
                            "modelId".to_string(),
                            serde_json::Value::String(make_model_id(agent_label)),
                        );
                        selection_map.insert("mode".to_string(), serde_json::json!(0));
                        changed = true;
                    }
                }
            }
        }
        if changed {
            let updated_json = serde_json::to_string(&json)?;
            tx.execute(
                "UPDATE ItemTable SET value = ? WHERE key = ?",
                rusqlite::params![updated_json, key],
            )
            .map_err(|e| AppError::Other(format!("更新 Trae 会话模型失败: {}", e)))?;
        }
    }
    tx.commit()
        .map_err(|e| AppError::Other(format!("提交 Trae SQLite 配置失败: {}", e)))?;

    // 写后重新读取验证，避免数据库被锁、路径选错或 JSON 结构变化时仍向前端报告成功。
    let (_, verified_models) = read_traework_models(&db_path)?;
    let verified = verified_models.iter().any(|entry| {
        entry.name == composite_name
            && entry.custom_model_id.as_deref() == Some(final_custom_model_id.as_str())
    });
    if !verified {
        return Err(AppError::Other(
            "Trae 状态库写入后校验失败，模型未出现在可解析的自定义模型列表中".to_string(),
        ));
    }

    Ok(TraeWorkSaveResult {
        persistence_mode: "local_cache_compatibility".to_string(),
        verified: true,
        model_name: composite_name,
        custom_model_id: Some(final_custom_model_id),
        warning: Some(
            "已验证写入 Trae 本地 state.vscdb；Trae 启动后可能从服务端重建模型列表，因此这不是服务端永久注册。要永久保留，请在 Trae 官方模型管理器中添加，或接入其 ai-agent RPC。".to_string(),
        ),
    })
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
    if target.is_empty() {
        let (_uid, remaining) = read_traework_models(&db_path).unwrap_or((None, Vec::new()));
        return Ok(remaining);
    }

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

    #[test]
    fn test_normalize_traework_url_responses() {
        assert_eq!(
            normalize_traework_url("https://bob-api.com", "custom_responses_compatible", true),
            "https://bob-api.com/v1/responses"
        );
        assert_eq!(
            normalize_traework_url(
                "https://bob-api.com/v1",
                "custom_responses_compatible",
                true
            ),
            "https://bob-api.com/v1/responses"
        );
        assert_eq!(
            normalize_traework_url(
                "https://bob-api.com/v1/responses",
                "custom_responses_compatible",
                true
            ),
            "https://bob-api.com/v1/responses"
        );
        assert_eq!(
            normalize_traework_url(
                "https://bob-api.com/v1/responses",
                "custom_responses_compatible",
                false
            ),
            "https://bob-api.com/v1"
        );
    }

    #[test]
    fn test_normalize_traework_url_openai_custom_versions() {
        // 智谱 v4 不应被强制插入 /v1/
        assert_eq!(
            normalize_traework_url(
                "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                "custom_openai_compatible",
                true
            ),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
        assert_eq!(
            normalize_traework_url(
                "https://open.bigmodel.cn/api/paas/v4",
                "custom_openai_compatible",
                false
            ),
            "https://open.bigmodel.cn/api/paas/v4"
        );
        // 标准 OpenAI 自动补齐 /v1
        assert_eq!(
            normalize_traework_url("https://api.openai.com", "custom_openai_compatible", true),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_traework_url("https://api.openai.com", "custom_openai_compatible", false),
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn test_normalize_traework_url_anthropic() {
        assert_eq!(
            normalize_traework_url(
                "https://api.anthropic.com",
                "custom_anthropic_compatible",
                true
            ),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            normalize_traework_url(
                "https://api.anthropic.com/v1/messages",
                "custom_anthropic_compatible",
                false
            ),
            "https://api.anthropic.com"
        );
    }
}

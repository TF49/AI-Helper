use crate::error::AppError;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ClaudeConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub config_exists: bool,
    pub config_path: String,
    pub is_installed: bool,
    pub app_path: Option<String>,
}

pub fn claude_config_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".claude").join("settings.json"))
}

// ---------------------------------------------------------------------------
// Claude Code CLI first-run onboarding
//
// A fresh Claude Code CLI starts with an onboarding flow that asks the user to
// sign in to an Anthropic account. Someone who only configured a third-party
// endpoint has no such account, so the CLI looks broken right after "已配置好".
// Claude Code skips the flow when `~/.claude.json` has
// `hasCompletedOnboarding: true` (the same switch cc-switch offers).
//
// `~/.claude.json` is Claude Code's own state file: large, rewritten by the
// CLI all the time, and full of things AI Helper must never roll back. So it
// is never snapshotted. Only this one field is touched, and a marker file
// records that AI Helper was the one who set it, so a reset removes the field
// only in that case.
// ---------------------------------------------------------------------------

const ONBOARDING_FIELD: &str = "hasCompletedOnboarding";

#[cfg_attr(test, allow(dead_code))]
fn claude_state_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".claude.json"))
}

#[cfg_attr(test, allow(dead_code))]
fn onboarding_marker_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".to_string()))?;
    Ok(home.join(".ai-helper").join("claude_onboarding_skipped"))
}

/// Set `hasCompletedOnboarding: true` in the state file at `state`, keeping
/// every other field and their order. Returns whether the file was changed.
/// A file that is not a JSON object is left alone and reported as an error.
fn mark_onboarding_complete_at(state: &Path) -> Result<bool, AppError> {
    crate::safe_fs::with_file_lock(state, || {
        let raw = crate::safe_fs::read_optional_no_recovery_locked(state)?;
        let mut root = match raw.as_deref() {
            Some(bytes) if !bytes.iter().all(u8::is_ascii_whitespace) => {
                serde_json::from_slice::<Value>(bytes)
                    .map_err(|_| AppError::Other("~/.claude.json 不是有效的 JSON，未修改".into()))?
            }
            _ => Value::Object(serde_json::Map::new()),
        };
        let object = root
            .as_object_mut()
            .ok_or_else(|| AppError::Other("~/.claude.json 不是 JSON 对象，未修改".into()))?;
        if object.get(ONBOARDING_FIELD).and_then(Value::as_bool) == Some(true) {
            return Ok(false);
        }
        object.insert(ONBOARDING_FIELD.into(), Value::Bool(true));
        crate::safe_fs::atomic_write_locked(state, serde_json::to_vec_pretty(&root)?)?;
        Ok(true)
    })
}

/// Remove `hasCompletedOnboarding` from the state file at `state`, so the
/// CLI shows its sign-in flow again. Returns whether the file was changed.
fn clear_onboarding_at(state: &Path) -> Result<bool, AppError> {
    crate::safe_fs::with_file_lock(state, || {
        let Some(raw) = crate::safe_fs::read_optional_no_recovery_locked(state)? else {
            return Ok(false);
        };
        let mut root: Value = serde_json::from_slice(&raw)
            .map_err(|_| AppError::Other("~/.claude.json 不是有效的 JSON，未修改".into()))?;
        let Some(object) = root.as_object_mut() else {
            return Ok(false);
        };
        if object.remove(ONBOARDING_FIELD).is_none() {
            return Ok(false);
        }
        crate::safe_fs::atomic_write_locked(state, serde_json::to_vec_pretty(&root)?)?;
        Ok(true)
    })
}

/// Skip the CLI's first-run sign-in flow, remembering in `marker` when it was
/// AI Helper that did so. A user who had already completed onboarding is not
/// marked: that state is theirs, and a later reset must not undo it.
fn skip_onboarding_at(state: &Path, marker: &Path) -> Result<bool, AppError> {
    if !mark_onboarding_complete_at(state)? {
        return Ok(false);
    }
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(marker, b"")?;
    Ok(true)
}

/// Undo `skip_onboarding_at`, only when the marker says AI Helper set the
/// field. Returns whether the sign-in flow was restored.
fn restore_onboarding_at(state: &Path, marker: &Path) -> Result<bool, AppError> {
    if !marker.exists() {
        return Ok(false);
    }
    let changed = clear_onboarding_at(state)?;
    std::fs::remove_file(marker)?;
    Ok(changed)
}

/// After configuring Claude Code: make a fresh CLI start straight into the
/// configured endpoint instead of asking for an Anthropic sign-in.
#[cfg_attr(test, allow(dead_code))]
pub fn skip_cli_onboarding() -> Result<bool, AppError> {
    skip_onboarding_at(&claude_state_path()?, &onboarding_marker_path()?)
}

/// When Claude Code is reset to official: bring the sign-in flow back if AI
/// Helper was the one who skipped it.
#[cfg_attr(test, allow(dead_code))]
pub fn restore_cli_onboarding() -> Result<bool, AppError> {
    restore_onboarding_at(&claude_state_path()?, &onboarding_marker_path()?)
}

fn parse_claude_content(
    content: &str,
    config_path: &str,
    config_exists: bool,
    is_installed: bool,
    app_path: Option<String>,
) -> ClaudeConfig {
    let mut base_url = String::new();
    let mut api_key = String::new();
    let mut model = String::new();

    if config_exists {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                if let Some(m) = json.get("model").and_then(|v| v.as_str()) {
                    model = m.to_string();
                }

                if let Some(env) = json.get("env") {
                    if let Some(url) = env.get("ANTHROPIC_BASE_URL") {
                        base_url = url.as_str().unwrap_or("").to_string();
                    }
                    if let Some(key) = env.get("ANTHROPIC_AUTH_TOKEN") {
                        api_key = key.as_str().unwrap_or("").to_string();
                    }
                    if model.is_empty() {
                        if let Some(m) = env.get("ANTHROPIC_MODEL").and_then(|v| v.as_str()) {
                            model = m.to_string();
                        }
                    }
                }
            } else {
                eprintln!(
                    "警告: 配置文件 {} 格式非有效 JSON，使用默认配置载荷",
                    config_path
                );
            }
        }
    }

    ClaudeConfig {
        base_url,
        api_key,
        model,
        config_exists,
        config_path: config_path.to_string(),
        is_installed,
        app_path,
    }
}

pub fn get_claude_config() -> Result<ClaudeConfig, AppError> {
    let path = claude_config_path()?;
    let config_exists = path.exists();

    // 检查本地是否已安装 Claude Code CLI 或保存了自定义路径
    let claude_cli = crate::app_paths::detect_claude_cli_path();
    let saved_paths = crate::app_paths::load_app_paths();

    let has_saved_path = saved_paths
        .claude_cli_path
        .as_deref()
        .is_some_and(|p| !p.is_empty() && std::path::Path::new(p).exists());

    let is_installed = config_exists || claude_cli.exists || has_saved_path;

    let app_path = if claude_cli.exists {
        Some(claude_cli.path)
    } else if has_saved_path {
        saved_paths.claude_cli_path
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

    Ok(parse_claude_content(
        &content,
        &config_path,
        config_exists,
        is_installed,
        app_path,
    ))
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn prepare_claude_json(url: &str, api_key: &str, model: Option<&str>) -> Value {
    merge_claude_settings(Value::Object(serde_json::Map::new()), url, api_key, model)
        .expect("empty object is valid")
}

pub fn merge_claude_settings(
    existing: Value,
    url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<Value, AppError> {
    let mut root = match existing {
        Value::Object(map) => map,
        _ => {
            return Err(AppError::Other(
                "Claude 配置不是 JSON 对象，已停止写入以免覆盖安全规则".into(),
            ))
        }
    };
    let mut env = root
        .remove("env")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        Value::String(url.to_string()),
    );
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        Value::String(api_key.to_string()),
    );
    let model_str = model.unwrap_or("").trim();
    if !model_str.is_empty() {
        env.insert(
            "ANTHROPIC_MODEL".to_string(),
            Value::String(model_str.to_string()),
        );
        root.insert("model".to_string(), Value::String(model_str.to_string()));
    }
    root.insert("env".to_string(), Value::Object(env));
    Ok(Value::Object(root))
}

pub fn set_claude_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    set_claude_config_inner(url, api_key, model, None)
}

pub(crate) fn set_claude_config_at_generation(
    url: String,
    api_key: String,
    model: Option<String>,
    generation: u64,
) -> Result<(), AppError> {
    set_claude_config_inner(url, api_key, model, Some(generation))
}

fn set_claude_config_inner(
    url: String,
    api_key: String,
    model: Option<String>,
    generation: Option<u64>,
) -> Result<(), AppError> {
    crate::credential_policy::validate_key_destination(
        &api_key,
        &url,
        &crate::credential_policy::default_managed_origins(),
        crate::credential_policy::loopback_http_allowed(),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    let path = claude_config_path()?;
    let operation = || {
        crate::safe_fs::with_file_lock(&path, || {
            let mut capture = crate::reset::CaptureReceipt::new("Claude Code");
            if let Err(error) = crate::reset::capture_file_locked(&mut capture, &path) {
                return Err(crate::reset::rollback_capture_locked(capture, error));
            }
            let result = crate::safe_fs::update_file_locked(&path, |previous| {
                let raw = previous.unwrap_or_default();
                let existing = if raw.iter().all(u8::is_ascii_whitespace) {
                    Value::Object(serde_json::Map::new())
                } else {
                    serde_json::from_slice(raw).map_err(|_| {
                        AppError::Other("现有 Claude 配置损坏，已停止写入以免丢失安全规则".into())
                    })?
                };
                let json = merge_claude_settings(existing, &url, &api_key, model.as_deref())?;
                Ok(serde_json::to_vec_pretty(&json)?)
            });

            match result {
                Ok(()) => {
                    // Record the file write hash for intelligent reset
                    // Read the file content that was just written
                    if let Ok(Some(written_content)) =
                        crate::safe_fs::read_optional_no_recovery_locked(&path)
                    {
                        if let Err(e) =
                            crate::reset::record_file_write("Claude Code", &path, &written_content)
                        {
                            return Err(crate::reset::rollback_capture_locked(capture, e));
                        }
                    }
                    Ok(())
                }
                Err(error) => Err(crate::reset::rollback_capture_locked(capture, error)),
            }
        })
    };
    if let Some(generation) = generation {
        crate::reset::with_config_write_at_generation(generation, operation)?;
    } else {
        crate::reset::with_config_write(operation)?;
    }

    // The endpoint is saved. Skipping the CLI's sign-in flow is a convenience
    // on top: if it fails the configuration still stands, and the worst case
    // is the onboarding screen the user would have seen anyway.
    // Tests exercise the path-taking helpers; they must never reach the real
    // `~/.claude.json` of whoever runs them.
    #[cfg(not(test))]
    if !api_key.trim().is_empty() {
        if let Err(error) = skip_cli_onboarding() {
            log::warn!("未能跳过 Claude Code 首次启动引导: {error}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod onboarding_tests {
    use super::*;

    fn read(path: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn skipping_sets_only_the_flag_and_keeps_field_order() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join(".claude.json");
        let marker = dir.path().join(".ai-helper/claude_onboarding_skipped");
        std::fs::write(
            &state,
            r#"{"zeta": 1, "projects": {"/a": {"x": true}}, "alpha": "keep"}"#,
        )
        .unwrap();

        assert!(skip_onboarding_at(&state, &marker).unwrap());

        let value = read(&state);
        assert_eq!(value["hasCompletedOnboarding"], true);
        assert_eq!(value["projects"]["/a"]["x"], true);
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        assert_eq!(
            keys,
            ["zeta", "projects", "alpha", "hasCompletedOnboarding"]
        );
        assert!(marker.exists());
    }

    #[test]
    fn a_missing_state_file_is_created() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join(".claude.json");
        let marker = dir.path().join("marker");

        assert!(skip_onboarding_at(&state, &marker).unwrap());
        assert_eq!(read(&state)["hasCompletedOnboarding"], true);
    }

    #[test]
    fn onboarding_the_user_already_finished_is_not_claimed_or_undone() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join(".claude.json");
        let marker = dir.path().join("marker");
        let original = r#"{"hasCompletedOnboarding": true, "oauthAccount": {"id": "u"}}"#;
        std::fs::write(&state, original).unwrap();

        assert!(!skip_onboarding_at(&state, &marker).unwrap());
        assert!(!marker.exists());
        // Without the marker a reset leaves the user's own state alone.
        assert!(!restore_onboarding_at(&state, &marker).unwrap());
        assert_eq!(std::fs::read_to_string(&state).unwrap(), original);
    }

    #[test]
    fn reset_brings_the_sign_in_flow_back_only_when_ai_helper_skipped_it() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join(".claude.json");
        let marker = dir.path().join("marker");
        std::fs::write(&state, r#"{"theme": "dark"}"#).unwrap();

        assert!(skip_onboarding_at(&state, &marker).unwrap());
        assert!(restore_onboarding_at(&state, &marker).unwrap());

        let value = read(&state);
        assert!(value.get("hasCompletedOnboarding").is_none());
        assert_eq!(value["theme"], "dark");
        assert!(!marker.exists());
        // A second reset has nothing left to do.
        assert!(!restore_onboarding_at(&state, &marker).unwrap());
    }

    #[test]
    fn a_state_file_that_is_not_a_json_object_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("marker");
        for content in ["not json at all", "[1, 2, 3]"] {
            let state = dir.path().join(".claude.json");
            std::fs::write(&state, content).unwrap();

            assert!(skip_onboarding_at(&state, &marker).is_err());
            assert_eq!(std::fs::read_to_string(&state).unwrap(), content);
            assert!(!marker.exists());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_claude_content_empty_string() {
        let cfg = parse_claude_content("", "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert!(cfg.is_installed);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_claude_content_whitespace_only() {
        let cfg = parse_claude_content("   \r\n\t  ", "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_claude_content_malformed_json() {
        let cfg =
            parse_claude_content("{ broken json: ", "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.config_path, "C:/path/settings.json");
        assert!(cfg.config_exists);
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_parse_claude_content_valid_json() {
        let raw = r#"{
            "model": "claude-3-5-sonnet-20241022",
            "env": {
                "ANTHROPIC_BASE_URL": "https://api.example.com",
                "ANTHROPIC_AUTH_TOKEN": "sk-ant-test"
            }
        }"#;
        let cfg = parse_claude_content(raw, "C:/path/settings.json", true, true, None);
        assert_eq!(cfg.base_url, "https://api.example.com");
        assert_eq!(cfg.api_key, "sk-ant-test");
        assert_eq!(cfg.model, "claude-3-5-sonnet-20241022");
    }

    #[test]
    fn test_prepare_claude_json_with_model() {
        let json = prepare_claude_json("https://api.example.com", "sk-test", Some("claude-test"));
        assert_eq!(json["env"]["ANTHROPIC_BASE_URL"], "https://api.example.com");
        assert_eq!(json["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test");
        assert_eq!(json["env"]["ANTHROPIC_MODEL"], "claude-test");
        assert_eq!(json["model"], "claude-test");
    }

    #[test]
    fn test_prepare_claude_json_without_model() {
        let json = prepare_claude_json("https://api.example.com", "sk-test", None);
        assert_eq!(json["env"]["ANTHROPIC_BASE_URL"], "https://api.example.com");
        assert_eq!(json["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-test");
        assert!(json.get("model").is_none());
        assert!(json["env"].get("ANTHROPIC_MODEL").is_none());
    }

    #[test]
    fn merge_preserves_permissions_sandbox_hooks_and_unknown_fields() {
        let existing = serde_json::json!({
            "permissions": { "allow": ["Bash"] },
            "sandbox": { "enabled": true },
            "hooks": { "pre": "echo" },
            "unknownFuture": 1,
            "env": { "KEEP_ME": "yes" }
        });
        let merged = merge_claude_settings(
            existing,
            "https://bob-api.com",
            "sk-managed",
            Some("claude-sonnet"),
        )
        .unwrap();
        assert_eq!(merged["permissions"]["allow"][0], "Bash");
        assert_eq!(merged["sandbox"]["enabled"], true);
        assert_eq!(merged["hooks"]["pre"], "echo");
        assert_eq!(merged["unknownFuture"], 1);
        assert_eq!(merged["env"]["KEEP_ME"], "yes");
        assert_eq!(merged["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-managed");
    }

    #[test]
    fn merge_rejects_non_object_config() {
        assert!(
            merge_claude_settings(Value::Array(vec![]), "https://bob-api.com", "k", None).is_err()
        );
    }
}

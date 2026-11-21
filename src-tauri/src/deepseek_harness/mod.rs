//! DeepSeek Harness (DSH) desktop integration.
//!
//! AI Helper owns up to three gateway routes inside the profile patch layer
//! (`profiles/<profile>/cordis.patch.yml`, entry `llm-pi-ai`) and their API
//! keys in `.credentials.yaml` (`refs.AIHELPER_*`). Everything else in those
//! files — the user's own routes, `records`, comments and `!!js` tags — is
//! kept byte for byte: edits are line-level and every result is verified
//! semantically against the original before it is written.

mod lock;
mod yaml_text;

pub(crate) use lock::with_dsh_locks;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_norway::{Mapping, Value as Yaml};
use std::path::{Path, PathBuf};
use yaml_text::{unsupported, Block, Lines};

pub const CLIENT: &str = "DeepSeek Harness";
const PATCH_FILE: &str = "cordis.patch.yml";
const CREDENTIALS_FILE: &str = ".credentials.yaml";
const DEFAULT_PROFILE: &str = "desktop";
const DEFAULT_BASE_URL: &str = "https://bob-api.com";
const MANAGED_ROUTE_PREFIX: &str = "aihelper-";
const LLM_ENTRY_ID: &str = "llm-pi-ai";
const LLM_ENTRY_NAME: &str = "@deepseek-ai/dsh-llm-pi-ai";
const DEFAULT_MODEL_ENTRY_ID: &str = "agent-default-model";
/// DSH's official DeepSeek routes: the API-key route (`llm-deepseek` entry)
/// and the account route (`llm-deepseek-account`). AI Helper never writes
/// these entries, and never replaces a default the user pointed at them.
pub(crate) const OFFICIAL_PROVIDERS: [&str; 3] =
    ["deepseek-official", "deepseek-account", "deepseek"];
const OFFICIAL_API_ENTRY_ID: &str = "llm-deepseek";
const OFFICIAL_API_ORIGIN: &str = "https://api.deepseek.com";
/// Credential record of a signed-in official DeepSeek account.
const OFFICIAL_ACCOUNT_RECORD: &str = "deepseek-account-platform/default";
const DEFAULT_MODEL_ENTRY_NAME: &str = "@deepseek-ai/dsh-agent-default-model";
const PATCH_HEADER: [&str; 3] = [
    "# Your patch layer for this dsh profile, applied after every bundle layer:",
    "# a top-level YAML array of loader patch entries (id-targeted config",
    "# overrides, disables, and insert lists; `!!js` expressions allowed).",
];

// ---------------------------------------------------------------------------
// Paths and profiles
// ---------------------------------------------------------------------------

#[cfg(test)]
thread_local! {
    static TEST_HOME: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    static TEST_FAIL_WRITE: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

/// DSH reads `DSH_HOME` and falls back to `~/.dsh`.
pub(crate) fn dsh_home() -> Result<PathBuf, AppError> {
    #[cfg(test)]
    {
        if let Some(home) = TEST_HOME.with(|home| home.borrow().clone()) {
            return Ok(home);
        }
        static DIRECTORY: once_cell::sync::Lazy<tempfile::TempDir> =
            once_cell::sync::Lazy::new(|| tempfile::tempdir().expect("isolated DSH tests"));
        Ok(DIRECTORY.path().to_path_buf())
    }
    #[cfg(not(test))]
    {
        if let Some(home) = std::env::var_os("DSH_HOME").filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(home));
        }
        dirs::home_dir()
            .map(|home| home.join(".dsh"))
            .ok_or_else(|| AppError::ConfigNotFound("无法获取用户主目录".into()))
    }
}

/// AI Helper only configures the DeepSeek Harness desktop client, which always
/// launches the `desktop` profile. Other profiles under `profiles/` (CLI / web /
/// dev launches such as `web`, `tauri`, `safe`, `core-020`) are never touched.
fn desktop_profile(home: &Path) -> Option<String> {
    home.join("profiles")
        .join(DEFAULT_PROFILE)
        .is_dir()
        .then(|| DEFAULT_PROFILE.to_string())
}

fn resolve_profile(home: &Path, requested: Option<&str>) -> Result<String, AppError> {
    match requested.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) if name != DEFAULT_PROFILE => Err(AppError::Other(
            "AI Helper 只配置 DeepSeek Harness 桌面版 (desktop) 档案".into(),
        )),
        _ => desktop_profile(home).ok_or_else(|| {
            AppError::ConfigNotFound(
                "未找到 DeepSeek Harness 桌面版配置档案，请先启动一次 DeepSeek Harness".into(),
            )
        }),
    }
}

fn patch_path(home: &Path, profile: &str) -> PathBuf {
    home.join("profiles").join(profile).join(PATCH_FILE)
}

fn credentials_path(home: &Path) -> PathBuf {
    home.join(CREDENTIALS_FILE)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DshRouteKind {
    Claude,
    Codex,
    Domestic,
}

const ALL_KINDS: [DshRouteKind; 3] = [
    DshRouteKind::Claude,
    DshRouteKind::Codex,
    DshRouteKind::Domestic,
];

impl DshRouteKind {
    pub fn route(self) -> &'static str {
        match self {
            Self::Claude => "aihelper-claude",
            Self::Codex => "aihelper-codex",
            Self::Domestic => "aihelper-cn",
        }
    }

    pub fn key_ref(self) -> &'static str {
        match self {
            Self::Claude => "AIHELPER_CLAUDE_API_KEY",
            Self::Codex => "AIHELPER_CODEX_API_KEY",
            Self::Domestic => "AIHELPER_CN_API_KEY",
        }
    }

    pub fn api(self) -> &'static str {
        match self {
            Self::Claude => "anthropic-messages",
            Self::Codex => "openai-responses",
            Self::Domestic => "openai-completions",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Claude => "AI Helper · Claude",
            Self::Codex => "AI Helper · Codex",
            Self::Domestic => "AI Helper · 国产模型",
        }
    }

    /// Input types declared for models AI Helper writes into this route.
    /// Every bob-api group (Claude, Codex and domestic) accepts images.
    pub fn input_modalities(self) -> &'static [&'static str] {
        &["text", "image"]
    }

    fn from_route(route: &str) -> Option<Self> {
        ALL_KINDS.into_iter().find(|kind| kind.route() == route)
    }

    /// Anthropic clients append `/v1/messages` themselves; OpenAI clients
    /// expect the `/v1` root.
    pub fn normalize_base_url(self, url: Option<&str>) -> Result<String, AppError> {
        let raw = url.map(str::trim).filter(|url| !url.is_empty());
        let raw = raw.unwrap_or(DEFAULT_BASE_URL);
        if raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(AppError::Other("节点地址包含非法字符".into()));
        }
        let mut base = raw.trim_end_matches('/');
        if let Some(stripped) = base.strip_suffix("/v1") {
            base = stripped.trim_end_matches('/');
        }
        if base.is_empty() {
            return Err(AppError::Other("节点地址无效".into()));
        }
        Ok(match self {
            Self::Claude => format!("{base}/"),
            Self::Codex | Self::Domestic => format!("{base}/v1"),
        })
    }

    /// The managed route a model is written to: its protocol decides, so one
    /// relay key can serve Claude, Codex and domestic models side by side.
    pub fn for_model(id: &str) -> Self {
        if crate::cursor::agent::prefers_messages(id) {
            Self::Claude
        } else if crate::cursor::agent::prefers_responses(id)
            || id.to_ascii_lowercase().starts_with("gpt-")
        {
            Self::Codex
        } else {
            Self::Domestic
        }
    }

    #[cfg(test)]
    pub fn accepts_model(self, id: &str) -> bool {
        is_chat_model(id) && Self::for_model(id) == self
    }
}

/// Relay groups also list image / audio / video / embedding models that DSH
/// cannot chat with; offering them would only produce failing sessions.
fn is_chat_model(id: &str) -> bool {
    const NON_CHAT: [&str; 11] = [
        "image",
        "audio",
        "video",
        "embedding",
        "asr",
        "tts",
        "whisper",
        "dall-e",
        "rerank",
        "moderation",
        "speech",
    ];
    let lower = id.to_ascii_lowercase();
    !NON_CHAT.iter().any(|marker| lower.contains(marker))
}

// ---------------------------------------------------------------------------
// UI types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct DshRouteState {
    pub kind: DshRouteKind,
    pub route: String,
    pub display_name: String,
    pub api: String,
    pub key_ref: String,
    pub configured: bool,
    pub api_key: String,
    pub base_url: String,
    pub models: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DshDefaultModel {
    pub provider: String,
    pub model: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct DshExternalRoute {
    pub name: String,
    pub display_name: Option<String>,
    pub api: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DshUIConfig {
    pub is_installed: bool,
    pub is_running: bool,
    pub app_path: Option<String>,
    pub dsh_home: String,
    pub home_exists: bool,
    pub profiles: Vec<String>,
    pub selected_profile: Option<String>,
    pub default_profile: Option<String>,
    pub patch_path: Option<String>,
    pub credentials_path: String,
    pub routes: Vec<DshRouteState>,
    pub default_model: Option<DshDefaultModel>,
    pub external_routes: Vec<DshExternalRoute>,
    pub official: DshOfficialState,
    pub read_error: Option<String>,
}

/// How the official DeepSeek routes are set up, so the UI can keep clear of
/// them.
#[derive(Serialize, Clone, Debug, Default)]
pub struct DshOfficialState {
    /// The official DeepSeek account is signed in (its login record exists).
    pub account_signed_in: bool,
    /// The saved default model points at an official route.
    pub default_is_official: bool,
    /// `baseURL` of the official API-key route when it no longer points at
    /// `https://api.deepseek.com` (e.g. hand-edited towards a relay).
    pub api_key_route_redirected_to: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct DshRouteUpdate {
    pub kind: DshRouteKind,
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    /// With `enabled: false`: remove the route only while it still uses
    /// `api_key`. A route that holds another key belongs to another relay
    /// group (e.g. a Claude key next to a GPT key) and is left untouched.
    #[serde(default)]
    pub only_same_key: bool,
}

#[derive(Deserialize, Clone, Debug)]
pub struct DshDefaultSelection {
    pub kind: DshRouteKind,
    pub model: String,
}

/// Route-level save request. Routes absent from `routes` are left untouched;
/// `enabled: false` removes the route together with its key.
#[derive(Deserialize, Clone, Debug, Default)]
pub struct DshRoutesPayload {
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub routes: Vec<DshRouteUpdate>,
    #[serde(default)]
    pub default_model: Option<DshDefaultSelection>,
}

/// What the UI saves: one relay key and the models it may use. Models are
/// split into routes by their protocol and those routes get this key. A route
/// left without models is removed only if it already used this key; routes
/// configured with another key (another relay group) are kept as they are.
#[derive(Deserialize, Clone, Debug, Default)]
pub struct DshSavePayload {
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    /// `None` keeps the current default (e.g. an official DeepSeek model).
    #[serde(default)]
    pub default_model: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DshModelRoute {
    pub model: String,
    pub kind: DshRouteKind,
    pub route: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct DshSaveResult {
    pub profile: String,
    pub requires_restart: bool,
}

// ---------------------------------------------------------------------------
// YAML value helpers
// ---------------------------------------------------------------------------

fn ystr(value: &str) -> Yaml {
    Yaml::String(value.to_string())
}

fn is_blank(raw: &[u8]) -> bool {
    raw.iter().all(u8::is_ascii_whitespace)
}

fn parse_patch_value(raw: &[u8]) -> Result<Yaml, AppError> {
    if is_blank(raw) {
        return Ok(Yaml::Null);
    }
    serde_norway::from_slice(raw).map_err(|error| {
        AppError::Other(format!(
            "DeepSeek Harness 配置文件不是有效的 YAML，已停止写入: {error}"
        ))
    })
}

/// Parse errors of the credentials file never echo its contents.
fn parse_credentials_value(raw: &[u8]) -> Result<Yaml, AppError> {
    if is_blank(raw) {
        return Ok(Yaml::Null);
    }
    serde_norway::from_slice(raw)
        .map_err(|_| AppError::Other("DeepSeek Harness 凭据文件不是有效的 YAML，已停止写入".into()))
}

fn items(doc: &Yaml) -> &[Yaml] {
    doc.as_sequence().map_or(&[], Vec::as_slice)
}

fn item_id(item: &Yaml) -> Option<&str> {
    item.get("id")?.as_str()
}

fn find_entry<'a>(doc: &'a Yaml, id: &str) -> Option<&'a Yaml> {
    items(doc).iter().find(|item| item_id(item) == Some(id))
}

fn providers_of(doc: &Yaml) -> Option<&Mapping> {
    find_entry(doc, LLM_ENTRY_ID)?
        .get("config")?
        .get("providers")?
        .as_mapping()
}

fn default_config_of(doc: &Yaml) -> Option<&Yaml> {
    find_entry(doc, DEFAULT_MODEL_ENTRY_ID)?.get("config")
}

fn model_ids(route: &Yaml) -> Vec<String> {
    route
        .get("models")
        .and_then(Yaml::as_sequence)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("id").and_then(Yaml::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn is_empty_value(value: &Yaml) -> bool {
    matches!(value, Yaml::Null) || value.as_mapping().is_some_and(Mapping::is_empty)
}

fn route_value(
    kind: DshRouteKind,
    base_url: &str,
    models: &[String],
    previous: Option<&Yaml>,
) -> Yaml {
    let previous_models = previous
        .and_then(|route| route.get("models"))
        .and_then(Yaml::as_sequence);
    let models = models
        .iter()
        .map(|id| {
            let mut model = previous_models
                .and_then(|list| {
                    list.iter()
                        .find(|model| model.get("id").and_then(Yaml::as_str) == Some(id))
                })
                .cloned()
                .unwrap_or_else(|| {
                    let mut model = Mapping::new();
                    model.insert(ystr("id"), ystr(id));
                    model.insert(ystr("name"), ystr(id));
                    Yaml::Mapping(model)
                });
            // DSH treats a missing `inputModalities` as "unknown" and refuses
            // image attachments; every bob-api model AI Helper writes accepts
            // images. A value the user set explicitly is kept.
            if let Yaml::Mapping(map) = &mut model {
                if !map.contains_key("inputModalities") {
                    map.insert(
                        ystr("inputModalities"),
                        Yaml::Sequence(kind.input_modalities().iter().map(|m| ystr(m)).collect()),
                    );
                }
            }
            model
        })
        .collect();
    let mut route = Mapping::new();
    route.insert(ystr("displayName"), ystr(kind.display_name()));
    route.insert(ystr("apiKeyEnv"), ystr(kind.key_ref()));
    route.insert(ystr("api"), ystr(kind.api()));
    route.insert(ystr("baseURL"), ystr(base_url));
    route.insert(ystr("models"), Yaml::Sequence(models));
    Yaml::Mapping(route)
}

// ---------------------------------------------------------------------------
// Patch file edits
// ---------------------------------------------------------------------------

/// Edits of `agent-default-model.config`. Like DSH's own `saveSelection()`,
/// a selection is written as a whole: `effort: None` removes a stale
/// `reasoningEffort` that belonged to the previous provider (e.g. `max` of the
/// official DeepSeek account route).
// One short-lived value per save; boxing would only obscure the matches.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum DefaultEdit {
    Keep,
    Set {
        provider: Yaml,
        model: Yaml,
        effort: Option<Yaml>,
    },
    Clear,
}

const DEFAULT_FIELDS: [&str; 3] = ["provider", "model", "reasoningEffort"];

#[derive(Clone, Debug)]
pub(crate) struct PatchEdit {
    /// `(route name, new value)`; `None` removes the route.
    pub(crate) routes: Vec<(String, Option<Yaml>)>,
    pub(crate) default_model: DefaultEdit,
}

/// Line range of the top-level entry with `id`, if any.
fn locate_entry(doc: &Lines, id: &str) -> Result<Option<(usize, usize)>, AppError> {
    let value = parse_patch_value(&doc.to_bytes())?;
    let entries = items(&value);
    let mut matches = entries
        .iter()
        .enumerate()
        .filter(|(_, item)| item_id(item) == Some(id))
        .map(|(index, _)| index);
    let Some(index) = matches.next() else {
        return Ok(None);
    };
    if matches.next().is_some() {
        return Err(unsupported(&format!("存在多个 {id} 条目")));
    }
    let (ranges, _) = yaml_text::top_level_items(doc)?;
    if ranges.len() != entries.len() {
        return Err(unsupported("列表条目无法定位"));
    }
    let range = ranges[index];
    // Keys written on the `- ` line are invisible to block navigation; only
    // the identifying keys may live there.
    let dash = &doc.lines[range.0];
    let first = &dash[yaml_text::virtual_indent(dash).min(dash.len())..];
    if let Some((key, _)) = yaml_text::parse_key(first) {
        if key != "id" && key != "name" {
            return Err(unsupported(&format!("{id} 条目首行不是 id/name")));
        }
    }
    Ok(Some(range))
}

fn entry_body(doc: &Lines, id: &str) -> Result<Option<Block>, AppError> {
    Ok(locate_entry(doc, id)?.map(|range| yaml_text::item_block(doc, range)))
}

fn append_entry(doc: &mut Lines, id: &str, name: &str, config: Mapping) -> Result<(), AppError> {
    let mut entry = Mapping::new();
    entry.insert(ystr("id"), ystr(id));
    entry.insert(ystr("name"), ystr(name));
    entry.insert(ystr("config"), Yaml::Mapping(config));
    let rendered = yaml_text::render_item(&Yaml::Mapping(entry))?;
    let (ranges, empty_flow) = yaml_text::top_level_items(doc)?;
    let at = if let Some(line) = empty_flow {
        doc.remove(line, line + 1);
        line
    } else {
        ranges.last().map_or(doc.len(), |range| range.1)
    };
    doc.insert(at, rendered);
    Ok(())
}

/// After removals, drop `config.<nested>` / `config` once empty, and the whole
/// entry once only `id` / `name` remain.
fn prune_entry(doc: &mut Lines, id: &str, nested: Option<&str>) -> Result<(), AppError> {
    if let Some(nested) = nested {
        let Some(body) = entry_body(doc, id)? else {
            return Ok(());
        };
        if let Some(config) = yaml_text::child_map(doc, body, "config")? {
            yaml_text::remove_empty_map(doc, config, nested);
        }
    }
    let Some(body) = entry_body(doc, id)? else {
        return Ok(());
    };
    yaml_text::remove_empty_map(doc, body, "config");
    let Some(range) = locate_entry(doc, id)? else {
        return Ok(());
    };
    let body = yaml_text::item_block(doc, range);
    if doc
        .keys(body)
        .iter()
        .all(|(key, _)| key == "id" || key == "name")
    {
        let value = parse_patch_value(&doc.to_bytes())?;
        let only_ids = find_entry(&value, id)
            .and_then(Yaml::as_mapping)
            .is_some_and(|entry| {
                entry
                    .keys()
                    .all(|key| matches!(key.as_str(), Some("id" | "name")))
            });
        if only_ids {
            doc.remove(range.0, range.1);
        }
    }
    Ok(())
}

fn providers_block(doc: &mut Lines, create: bool) -> Result<Option<Block>, AppError> {
    let Some(body) = entry_body(doc, LLM_ENTRY_ID)? else {
        return Ok(None);
    };
    if create {
        let config = yaml_text::ensure_child_map(doc, body, "config")?;
        yaml_text::ensure_child_map(doc, config, "providers").map(Some)
    } else {
        match yaml_text::child_map(doc, body, "config")? {
            Some(config) => yaml_text::child_map(doc, config, "providers"),
            None => Ok(None),
        }
    }
}

fn apply_routes(doc: &mut Lines, routes: &[(String, Option<Yaml>)]) -> Result<(), AppError> {
    if routes.is_empty() {
        return Ok(());
    }
    if locate_entry(doc, LLM_ENTRY_ID)?.is_none() {
        let providers: Mapping = routes
            .iter()
            .filter_map(|(name, value)| value.clone().map(|value| (ystr(name), value)))
            .collect();
        if !providers.is_empty() {
            let mut config = Mapping::new();
            config.insert(ystr("providers"), Yaml::Mapping(providers));
            append_entry(doc, LLM_ENTRY_ID, LLM_ENTRY_NAME, config)?;
        }
        return Ok(());
    }
    let mut removed = false;
    for (name, value) in routes {
        match value {
            Some(value) => {
                let block =
                    providers_block(doc, true)?.ok_or_else(|| unsupported("无法创建 providers"))?;
                yaml_text::set_key(doc, block, name, value)?;
            }
            None => {
                if let Some(block) = providers_block(doc, false)? {
                    removed |= yaml_text::remove_key(doc, block, name);
                }
            }
        }
    }
    if removed {
        prune_entry(doc, LLM_ENTRY_ID, Some("providers"))?;
    }
    Ok(())
}

fn apply_default(doc: &mut Lines, edit: &DefaultEdit) -> Result<(), AppError> {
    match edit {
        DefaultEdit::Keep => Ok(()),
        DefaultEdit::Set {
            provider,
            model,
            effort,
        } => {
            let Some(body) = entry_body(doc, DEFAULT_MODEL_ENTRY_ID)? else {
                let mut config = Mapping::new();
                config.insert(ystr("provider"), provider.clone());
                config.insert(ystr("model"), model.clone());
                if let Some(effort) = effort {
                    config.insert(ystr("reasoningEffort"), effort.clone());
                }
                return append_entry(
                    doc,
                    DEFAULT_MODEL_ENTRY_ID,
                    DEFAULT_MODEL_ENTRY_NAME,
                    config,
                );
            };
            yaml_text::ensure_child_map(doc, body, "config")?;
            // Blocks move after every edit, so the config map is located anew.
            let config_block = |doc: &Lines| -> Result<Block, AppError> {
                let body = entry_body(doc, DEFAULT_MODEL_ENTRY_ID)?
                    .ok_or_else(|| unsupported("默认模型条目丢失"))?;
                yaml_text::child_map(doc, body, "config")?
                    .ok_or_else(|| unsupported("默认模型条目丢失"))
            };
            let config = config_block(doc)?;
            yaml_text::set_key(doc, config, "provider", provider)?;
            let config = config_block(doc)?;
            yaml_text::set_key(doc, config, "model", model)?;
            let config = config_block(doc)?;
            match effort {
                Some(effort) => {
                    yaml_text::set_key(doc, config, "reasoningEffort", effort)?;
                }
                None => {
                    yaml_text::remove_key(doc, config, "reasoningEffort");
                }
            }
            Ok(())
        }
        DefaultEdit::Clear => {
            let mut removed = false;
            for key in DEFAULT_FIELDS {
                let Some(body) = entry_body(doc, DEFAULT_MODEL_ENTRY_ID)? else {
                    break;
                };
                let Some(config) = yaml_text::child_map(doc, body, "config")? else {
                    break;
                };
                removed |= yaml_text::remove_key(doc, config, key);
            }
            if removed {
                prune_entry(doc, DEFAULT_MODEL_ENTRY_ID, None)?;
            }
            Ok(())
        }
    }
}

/// DSH expects a list; a patch layer that lost its last entry becomes `[]`.
fn ensure_list(doc: &mut Lines) -> Result<(), AppError> {
    let (ranges, empty_flow) = yaml_text::top_level_items(doc)?;
    if ranges.is_empty() && empty_flow.is_none() {
        doc.lines.push("[]".into());
    }
    Ok(())
}

fn strip_nested(item: &mut Yaml, nested: Option<&str>, keys: &[&str]) {
    let Some(config) = item.get_mut("config") else {
        return;
    };
    let target = match nested {
        Some(nested) => config.get_mut(nested),
        None => Some(&mut *config),
    };
    if let Some(Yaml::Mapping(map)) = target {
        for key in keys {
            map.remove(*key);
        }
    }
    if let (Some(nested), Yaml::Mapping(map)) = (nested, &mut *config) {
        if map.get(nested).is_some_and(is_empty_value) {
            map.remove(nested);
        }
    }
    if is_empty_value(config) {
        if let Some(map) = item.as_mapping_mut() {
            map.remove("config");
        }
    }
}

/// The document with every managed path removed, for comparing everything
/// AI Helper must not have touched.
fn strip_patch(doc: &Yaml, edit: &PatchEdit) -> Vec<Yaml> {
    let names: Vec<&str> = edit.routes.iter().map(|(name, _)| name.as_str()).collect();
    let strip_default = edit.default_model != DefaultEdit::Keep;
    items(doc)
        .iter()
        .filter_map(|item| {
            let mut item = item.clone();
            match item_id(&item) {
                Some(LLM_ENTRY_ID) if !names.is_empty() => {
                    strip_nested(&mut item, Some("providers"), &names)
                }
                Some(DEFAULT_MODEL_ENTRY_ID) if strip_default => {
                    strip_nested(&mut item, None, &DEFAULT_FIELDS)
                }
                _ => return Some(item),
            }
            let only_ids = item.as_mapping().is_some_and(|entry| {
                entry
                    .keys()
                    .all(|key| matches!(key.as_str(), Some("id" | "name")))
            });
            (!only_ids).then_some(item)
        })
        .collect()
}

fn verify_patch(old: &Yaml, new_bytes: &[u8], edit: &PatchEdit) -> Result<(), AppError> {
    let new = parse_patch_value(new_bytes).map_err(|_| unsupported("修改结果无法解析"))?;
    if !matches!(new, Yaml::Sequence(_)) {
        return Err(unsupported("修改结果不是列表"));
    }
    if strip_patch(old, edit) != strip_patch(&new, edit) {
        return Err(unsupported("修改会影响其他配置"));
    }
    let providers = providers_of(&new);
    for (name, expected) in &edit.routes {
        if providers.and_then(|map| map.get(name.as_str())) != expected.as_ref() {
            return Err(unsupported("写入的路由与预期不符"));
        }
    }
    let config = default_config_of(&new);
    let field = |key: &str| config.and_then(|config| config.get(key));
    let ok = match &edit.default_model {
        DefaultEdit::Keep => true,
        DefaultEdit::Set {
            provider,
            model,
            effort,
        } => {
            field("provider") == Some(provider)
                && field("model") == Some(model)
                && field("reasoningEffort") == effort.as_ref()
        }
        DefaultEdit::Clear => DEFAULT_FIELDS.iter().all(|key| field(key).is_none()),
    };
    if !ok {
        return Err(unsupported("写入的默认模型与预期不符"));
    }
    Ok(())
}

pub(crate) fn edit_patch(raw: Option<&[u8]>, edit: &PatchEdit) -> Result<Vec<u8>, AppError> {
    let (old, mut doc) = match raw.filter(|raw| !is_blank(raw)) {
        Some(raw) => {
            let old = parse_patch_value(raw)?;
            if !matches!(old, Yaml::Sequence(_) | Yaml::Null) {
                return Err(unsupported("顶层不是列表"));
            }
            (old, Lines::parse(raw)?)
        }
        None => (Yaml::Null, Lines::from_lines(PATCH_HEADER)),
    };
    apply_routes(&mut doc, &edit.routes)?;
    apply_default(&mut doc, &edit.default_model)?;
    ensure_list(&mut doc)?;
    let bytes = doc.to_bytes();
    verify_patch(&old, &bytes, edit)?;
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Credentials edits
// ---------------------------------------------------------------------------

fn strip_credentials(doc: &Yaml, names: &[&str]) -> Yaml {
    let mut doc = doc.clone();
    if let Some(Yaml::Mapping(refs)) = doc.get_mut("refs") {
        for name in names {
            refs.remove(*name);
        }
    }
    if doc.get("refs").is_some_and(is_empty_value) {
        if let Some(map) = doc.as_mapping_mut() {
            map.remove("refs");
        }
    }
    doc
}

/// Set or remove `refs.<name>`; `version`, `records` and other refs keep
/// their bytes.
pub(crate) fn edit_credentials(
    raw: Option<&[u8]>,
    refs: &[(String, Option<Yaml>)],
) -> Result<Vec<u8>, AppError> {
    let (old, mut doc) = match raw.filter(|raw| !is_blank(raw)) {
        Some(raw) => {
            let old = parse_credentials_value(raw)?;
            if !old.is_mapping() {
                return Err(unsupported("凭据文件顶层不是映射"));
            }
            (old, Lines::parse(raw)?)
        }
        None => {
            let doc = Lines::from_lines(["version: 1"]);
            (parse_credentials_value(&doc.to_bytes())?, doc)
        }
    };
    let mut removed = false;
    for (name, value) in refs {
        let root = doc.root();
        match value {
            Some(value) => {
                let block = yaml_text::ensure_child_map(&mut doc, root, "refs")?;
                yaml_text::set_key(&mut doc, block, name, value)?;
            }
            None => {
                if let Some(block) = yaml_text::child_map(&doc, root, "refs")? {
                    removed |= yaml_text::remove_key(&mut doc, block, name);
                }
            }
        }
    }
    if removed {
        let root = doc.root();
        yaml_text::collapse_empty_map(&mut doc, root, "refs")?;
    }
    let bytes = doc.to_bytes();

    let new = parse_credentials_value(&bytes).map_err(|_| unsupported("凭据修改结果无法解析"))?;
    let names: Vec<&str> = refs.iter().map(|(name, _)| name.as_str()).collect();
    if strip_credentials(&old, &names) != strip_credentials(&new, &names) {
        return Err(unsupported("凭据修改会影响其他内容"));
    }
    for (name, expected) in refs {
        if new.get("refs").and_then(|refs| refs.get(name.as_str())) != expected.as_ref() {
            return Err(unsupported("写入的凭据与预期不符"));
        }
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取 {} 失败: {error}", path.display())),
    }
}

fn build_routes(patch: &Yaml, credentials: &Yaml) -> Vec<DshRouteState> {
    let providers = providers_of(patch);
    ALL_KINDS
        .into_iter()
        .map(|kind| {
            let route = providers.and_then(|map| map.get(kind.route()));
            let key_ref = route
                .and_then(|route| route.get("apiKeyEnv"))
                .and_then(Yaml::as_str)
                .unwrap_or(kind.key_ref());
            let api_key = credentials
                .get("refs")
                .and_then(|refs| refs.get(key_ref))
                .and_then(Yaml::as_str)
                .unwrap_or_default()
                .to_string();
            let base_url = route
                .and_then(|route| route.get("baseURL"))
                .and_then(Yaml::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    kind.normalize_base_url(None)
                        .unwrap_or_else(|_| DEFAULT_BASE_URL.into())
                });
            DshRouteState {
                kind,
                route: kind.route().into(),
                display_name: kind.display_name().into(),
                api: kind.api().into(),
                key_ref: kind.key_ref().into(),
                configured: route.is_some(),
                api_key,
                base_url,
                models: route.map(model_ids).unwrap_or_default(),
            }
        })
        .collect()
}

fn build_external_routes(patch: &Yaml) -> Vec<DshExternalRoute> {
    providers_of(patch)
        .map(|providers| {
            providers
                .iter()
                .filter_map(|(name, route)| {
                    let name = name.as_str()?;
                    (!name.starts_with(MANAGED_ROUTE_PREFIX)).then(|| DshExternalRoute {
                        name: name.to_string(),
                        display_name: route
                            .get("displayName")
                            .and_then(Yaml::as_str)
                            .map(str::to_string),
                        api: route.get("api").and_then(Yaml::as_str).map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn build_official_state(patch: &Yaml, credentials: &Yaml) -> DshOfficialState {
    let account_signed_in = credentials
        .get("records")
        .and_then(|records| records.get(OFFICIAL_ACCOUNT_RECORD))
        .is_some();
    let default_is_official = default_config_of(patch)
        .and_then(|config| config.get("provider"))
        .and_then(Yaml::as_str)
        .is_some_and(|provider| OFFICIAL_PROVIDERS.contains(&provider));
    let api_key_route_redirected_to = find_entry(patch, OFFICIAL_API_ENTRY_ID)
        .and_then(|entry| entry.get("config"))
        .and_then(|config| config.get("baseURL"))
        .and_then(Yaml::as_str)
        .filter(|url| url.trim().trim_end_matches('/') != OFFICIAL_API_ORIGIN)
        .map(str::to_string);
    DshOfficialState {
        account_signed_in,
        default_is_official,
        api_key_route_redirected_to,
    }
}

fn build_default_model(patch: &Yaml) -> Option<DshDefaultModel> {
    let config = default_config_of(patch)?;
    Some(DshDefaultModel {
        provider: config.get("provider")?.as_str()?.to_string(),
        model: config.get("model")?.as_str()?.to_string(),
    })
}

pub fn get_dsh_config(profile: Option<String>) -> Result<DshUIConfig, AppError> {
    let detection = crate::app_paths::detect_dsh_client_path();
    let home = dsh_home()?;
    // The desktop client only ever reads the `desktop` profile; the parameter
    // is kept for API compatibility and otherwise ignored.
    let _ = profile;
    let selected = desktop_profile(&home);
    let profiles: Vec<String> = selected.iter().cloned().collect();
    let default = selected.clone();
    let credentials_file = credentials_path(&home);
    let patch_file = selected.as_deref().map(|name| patch_path(&home, name));

    let mut errors = Vec::new();
    let credentials = match read_file(&credentials_file) {
        Ok(raw) => {
            parse_credentials_value(raw.as_deref().unwrap_or_default()).unwrap_or_else(|error| {
                errors.push(error.to_string());
                Yaml::Null
            })
        }
        Err(error) => {
            errors.push(error);
            Yaml::Null
        }
    };
    let patch = match patch_file.as_deref().map(read_file).transpose() {
        Ok(raw) => parse_patch_value(raw.flatten().as_deref().unwrap_or_default()).unwrap_or_else(
            |error| {
                errors.push(error.to_string());
                Yaml::Null
            },
        ),
        Err(error) => {
            errors.push(error);
            Yaml::Null
        }
    };

    let home_exists = home.is_dir();
    Ok(DshUIConfig {
        is_installed: detection.exists || home_exists,
        is_running: detection.is_running,
        app_path: detection.exists.then(|| detection.path.clone()),
        dsh_home: home.display().to_string(),
        home_exists,
        profiles,
        selected_profile: selected,
        default_profile: default,
        patch_path: patch_file.map(|path| path.display().to_string()),
        credentials_path: credentials_file.display().to_string(),
        routes: build_routes(&patch, &credentials),
        default_model: build_default_model(&patch),
        external_routes: build_external_routes(&patch),
        official: build_official_state(&patch, &credentials),
        read_error: (!errors.is_empty()).then(|| errors.join("；")),
    })
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct RouteSpec {
    api_key: String,
    base_url: String,
    models: Vec<String>,
}

fn validate_routes(
    updates: &[DshRouteUpdate],
) -> Result<Vec<(DshRouteKind, Option<RouteSpec>)>, AppError> {
    let mut specs: Vec<(DshRouteKind, Option<RouteSpec>)> = Vec::new();
    let mut seen: Vec<DshRouteKind> = Vec::new();
    for update in updates {
        if seen.contains(&update.kind) {
            return Err(AppError::Other("同一分组路由重复提交".into()));
        }
        seen.push(update.kind);
        if !update.enabled {
            if !update.only_same_key {
                specs.push((update.kind, None));
            }
            continue;
        }
        let label = update.kind.display_name();
        let api_key = update.api_key.trim().to_string();
        if api_key.is_empty() {
            return Err(AppError::Other(format!("{label} 的 API Key 不能为空")));
        }
        if api_key.chars().any(char::is_control) {
            return Err(AppError::Other(format!("{label} 的 API Key 包含非法字符")));
        }
        let base_url = update.kind.normalize_base_url(update.base_url.as_deref())?;
        crate::credential_policy::validate_key_destination(
            &api_key,
            &base_url,
            &crate::credential_policy::default_managed_origins(),
            crate::credential_policy::loopback_http_allowed(),
        )
        .map_err(|error| AppError::Other(error.to_string()))?;
        let mut models: Vec<String> = Vec::new();
        for model in &update.models {
            let model = model.trim();
            if model.is_empty() || models.iter().any(|known| known == model) {
                continue;
            }
            if model.chars().any(char::is_control) {
                return Err(AppError::Other(format!("{label} 的模型名包含非法字符")));
            }
            models.push(model.to_string());
        }
        if models.is_empty() {
            return Err(AppError::Other(format!("{label} 至少需要选择一个模型")));
        }
        specs.push((
            update.kind,
            Some(RouteSpec {
                api_key,
                base_url,
                models,
            }),
        ));
    }
    Ok(specs)
}

type RefEdits = Vec<(String, Option<Yaml>)>;

/// `(route, key)`: remove the route if it still uses `key` when the save lands.
fn same_key_removals(updates: &[DshRouteUpdate]) -> Vec<(DshRouteKind, String)> {
    updates
        .iter()
        .filter(|update| !update.enabled && update.only_same_key)
        .map(|update| (update.kind, update.api_key.trim().to_string()))
        .filter(|(_, key)| !key.is_empty())
        .collect()
}

/// The API key a managed route currently reads, if the route exists.
fn current_route_key(patch: &Yaml, credentials: &Yaml, kind: DshRouteKind) -> Option<String> {
    let route = providers_of(patch)?.get(kind.route())?;
    let key_ref = route
        .get("apiKeyEnv")
        .and_then(Yaml::as_str)
        .unwrap_or(kind.key_ref());
    credentials
        .get("refs")?
        .get(key_ref)?
        .as_str()
        .map(|key| key.trim().to_string())
}

fn plan_save(
    old_patch: &Yaml,
    specs: &[(DshRouteKind, Option<RouteSpec>)],
    selection: Option<&DshDefaultSelection>,
) -> Result<(PatchEdit, RefEdits), AppError> {
    let providers = providers_of(old_patch);
    let mut routes = Vec::new();
    let mut refs = Vec::new();
    for (kind, spec) in specs {
        let previous = providers.and_then(|map| map.get(kind.route()));
        routes.push((
            kind.route().to_string(),
            spec.as_ref()
                .map(|spec| route_value(*kind, &spec.base_url, &spec.models, previous)),
        ));
        refs.push((
            kind.key_ref().to_string(),
            spec.as_ref().map(|spec| ystr(&spec.api_key)),
        ));
    }
    // Models each route will offer once this save lands.
    let final_models = |kind: DshRouteKind| -> Option<Vec<String>> {
        match specs.iter().find(|(known, _)| *known == kind) {
            Some((_, spec)) => spec.as_ref().map(|spec| spec.models.clone()),
            None => providers
                .and_then(|map| map.get(kind.route()))
                .map(model_ids),
        }
    };
    let default_model = match selection {
        Some(selection) => {
            let model = selection.model.trim();
            let models = final_models(selection.kind)
                .ok_or_else(|| AppError::Other("默认模型所在的分组未启用".into()))?;
            if !models.iter().any(|known| known == model) {
                return Err(AppError::Other("默认模型不在该分组已选择的模型中".into()));
            }
            DefaultEdit::Set {
                provider: ystr(selection.kind.route()),
                model: ystr(model),
                effort: None,
            }
        }
        None => {
            let config = default_config_of(old_patch);
            let provider = config
                .and_then(|config| config.get("provider"))
                .and_then(Yaml::as_str);
            let model = config
                .and_then(|config| config.get("model"))
                .and_then(Yaml::as_str);
            match provider.and_then(DshRouteKind::from_route) {
                Some(kind) => {
                    let still_valid = final_models(kind).is_some_and(|models| {
                        model.is_some_and(|model| models.iter().any(|known| known == model))
                    });
                    if still_valid {
                        DefaultEdit::Keep
                    } else {
                        DefaultEdit::Clear
                    }
                }
                None => DefaultEdit::Keep,
            }
        }
    };
    Ok((
        PatchEdit {
            routes,
            default_model,
        },
        refs,
    ))
}

fn with_path_locks<T>(
    paths: &[PathBuf],
    operation: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    if let Some((path, rest)) = paths.split_first() {
        crate::safe_fs::with_file_lock(path, || with_path_locks(rest, operation))
    } else {
        operation()
    }
}

/// Caller holds AI Helper's and DSH's locks of both files.
fn write_locked(
    patch_file: &Path,
    credentials_file: &Path,
    specs: &[(DshRouteKind, Option<RouteSpec>)],
    same_key_removals: &[(DshRouteKind, String)],
    selection: Option<&DshDefaultSelection>,
) -> Result<(), AppError> {
    crate::safe_fs::recover_missing_file_locked(patch_file)?;
    // The credentials file is never restored from a backup: it would bring
    // back an official account login or keys the user has since removed.
    let patch_raw = crate::safe_fs::read_optional_no_recovery_locked(patch_file)?;
    let credentials_raw = crate::safe_fs::read_optional_no_recovery_locked(credentials_file)?;

    // Plan and render both files before touching either.
    let old_patch = parse_patch_value(patch_raw.as_deref().unwrap_or_default())?;
    let old_credentials = parse_credentials_value(credentials_raw.as_deref().unwrap_or_default())?;
    // Decided under the locks, against what the files hold right now.
    let mut specs = specs.to_vec();
    for (kind, key) in same_key_removals {
        if current_route_key(&old_patch, &old_credentials, *kind).as_deref() == Some(key.as_str()) {
            specs.push((*kind, None));
        }
    }
    if specs.is_empty() && selection.is_none() {
        return Ok(());
    }
    let (patch_edit, ref_edits) = plan_save(&old_patch, &specs, selection)?;
    let new_patch = edit_patch(patch_raw.as_deref(), &patch_edit)?;
    let new_credentials = edit_credentials(credentials_raw.as_deref(), &ref_edits)?;

    // Keys first, so the patch never names a key that does not exist yet.
    type Write<'a> = (&'a Path, Option<Vec<u8>>, Vec<u8>);
    let writes: Vec<Write> = [
        (credentials_file, credentials_raw, new_credentials),
        (patch_file, patch_raw, new_patch),
    ]
    .into_iter()
    .filter(|(_, previous, contents)| previous.as_deref() != Some(contents.as_slice()))
    .collect();
    if writes.is_empty() {
        return Ok(());
    }

    let mut capture = crate::reset::CaptureReceipt::new(CLIENT);
    for (path, _, _) in &writes {
        if let Err(error) = crate::reset::capture_file_locked(&mut capture, path) {
            return Err(crate::reset::rollback_capture_locked(capture, error));
        }
    }
    for (path, previous, contents) in &writes {
        #[cfg(test)]
        if TEST_FAIL_WRITE.with(|target| target.borrow().as_deref() == Some(*path)) {
            let error = AppError::Other("测试注入的写入失败".into());
            return Err(crate::reset::rollback_capture_locked(capture, error));
        }
        let commit = |current: Option<&[u8]>| {
            if current == previous.as_deref() {
                Ok(contents.clone())
            } else {
                Err(AppError::Other(
                    "DeepSeek Harness 配置在写入期间被修改，已停止写入".into(),
                ))
            }
        };
        let written = if is_credentials_file(path) {
            // No `.bak`: a copy would duplicate the official account token
            // and every other stored key next to the file.
            crate::safe_fs::read_optional_no_recovery_locked(path).and_then(|current| {
                crate::safe_fs::atomic_write_locked(path, commit(current.as_deref())?)
            })
        } else {
            crate::safe_fs::update_file_locked(path, commit)
        };
        let result = written.and_then(|()| {
            let written = crate::safe_fs::read_optional_no_recovery_locked(path)?
                .ok_or_else(|| AppError::Other("写入后的配置文件丢失".into()))?;
            crate::reset::record_file_write(CLIENT, path, &written)
        });
        if let Err(error) = result {
            return Err(crate::reset::rollback_capture_locked(capture, error));
        }
    }
    Ok(())
}

/// Split a single-key save into one update per managed route.
pub(crate) fn split_payload(payload: DshSavePayload) -> Result<DshRoutesPayload, AppError> {
    let api_key = payload.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(AppError::Other("API Key 不能为空".into()));
    }
    let mut models: Vec<String> = Vec::new();
    for model in &payload.models {
        let model = model.trim();
        if !model.is_empty() && !models.iter().any(|known| known == model) {
            models.push(model.to_string());
        }
    }
    if models.is_empty() {
        return Err(AppError::Other("请至少选择一个模型".into()));
    }
    let routes = ALL_KINDS
        .into_iter()
        .map(|kind| {
            let routed: Vec<String> = models
                .iter()
                .filter(|model| DshRouteKind::for_model(model) == kind)
                .cloned()
                .collect();
            // A protocol without models in this save only loses its route
            // when that route was configured with this same key.
            DshRouteUpdate {
                kind,
                enabled: !routed.is_empty(),
                api_key: api_key.clone(),
                base_url: payload.base_url.clone(),
                only_same_key: routed.is_empty(),
                models: routed,
            }
        })
        .collect();
    let default_model = payload
        .default_model
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(|model| DshDefaultSelection {
            kind: DshRouteKind::for_model(model),
            model: model.to_string(),
        });
    Ok(DshRoutesPayload {
        profile: payload.profile,
        routes,
        default_model,
    })
}

pub fn classify_dsh_models(models: Vec<String>) -> Vec<DshModelRoute> {
    models
        .into_iter()
        .map(|model| {
            let kind = DshRouteKind::for_model(model.trim());
            DshModelRoute {
                model,
                kind,
                route: kind.route().to_string(),
            }
        })
        .collect()
}

fn set_dsh_config_inner(
    payload: DshRoutesPayload,
    generation: Option<u64>,
) -> Result<DshSaveResult, AppError> {
    let home = dsh_home()?;
    let profile = resolve_profile(&home, payload.profile.as_deref())?;
    let specs = validate_routes(&payload.routes)?;
    let removals = same_key_removals(&payload.routes);
    if specs.is_empty() && removals.is_empty() && payload.default_model.is_none() {
        return Err(AppError::Other(
            "没有需要保存的 DeepSeek Harness 配置".into(),
        ));
    }
    let patch_file = patch_path(&home, &profile);
    let credentials_file = credentials_path(&home);
    let operation = || {
        let mut paths = vec![patch_file.clone(), credentials_file.clone()];
        paths.sort();
        with_path_locks(&paths, || {
            let dsh_paths: Vec<&Path> = paths.iter().map(PathBuf::as_path).collect();
            with_dsh_locks(&dsh_paths, || {
                write_locked(
                    &patch_file,
                    &credentials_file,
                    &specs,
                    &removals,
                    payload.default_model.as_ref(),
                )
            })
        })
    };
    if let Some(generation) = generation {
        crate::reset::with_config_write_at_generation(generation, operation)?;
    } else {
        crate::reset::with_config_write(operation)?;
    }
    Ok(DshSaveResult {
        profile,
        requires_restart: crate::app_paths::is_target_running("dsh"),
    })
}

pub fn set_dsh_config(payload: DshSavePayload) -> Result<DshSaveResult, AppError> {
    set_dsh_config_inner(split_payload(payload)?, None)
}

#[cfg(test)]
pub(crate) fn set_dsh_routes(payload: DshRoutesPayload) -> Result<DshSaveResult, AppError> {
    set_dsh_config_inner(payload, None)
}

#[allow(dead_code)]
pub(crate) fn set_dsh_config_at_generation(
    payload: DshSavePayload,
    generation: u64,
) -> Result<DshSaveResult, AppError> {
    set_dsh_config_inner(split_payload(payload)?, Some(generation))
}

/// Every chat model the key may use; the protocol of each decides its route
/// on save.
pub async fn fetch_dsh_models(url: Option<String>, api_key: String) -> Result<Vec<String>, String> {
    let base_url = DshRouteKind::Domestic
        .normalize_base_url(url.as_deref())
        .map_err(|error| error.to_string())?;
    let models = crate::model_fetch::fetch_models(&base_url, api_key.trim()).await?;
    let mut ids: Vec<String> = models
        .into_iter()
        .map(|model| model.id)
        .filter(|id| is_chat_model(id))
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/// `.credentials.yaml` and its legacy `.bak`.
pub(crate) fn is_credentials_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(CREDENTIALS_FILE))
}

/// What the reset baseline keeps of a file before takeover. For the
/// credentials file only the `AIHELPER_*` refs survive: the rest — the
/// official DeepSeek account grant, `DEEPSEEK_API_KEY`, the user's own keys —
/// must not be copied into AI Helper's state, and reset never needs it since
/// [`reconcile_file`] only restores managed refs.
pub(crate) fn baseline_snapshot(path: &Path, original: Option<Vec<u8>>) -> Option<Vec<u8>> {
    if !is_credentials_file(path) {
        return original;
    }
    let value = original
        .as_deref()
        .and_then(|raw| parse_credentials_value(raw).ok())
        .unwrap_or(Yaml::Null);
    let mut refs = Mapping::new();
    for kind in ALL_KINDS {
        if let Some(key) = value.get("refs").and_then(|refs| refs.get(kind.key_ref())) {
            refs.insert(ystr(kind.key_ref()), key.clone());
        }
    }
    let mut doc = Mapping::new();
    doc.insert(ystr("version"), Yaml::Number(1.into()));
    if !refs.is_empty() {
        doc.insert(ystr("refs"), Yaml::Mapping(refs));
    }
    // Always present, so reset reconciles instead of deleting the file.
    Some(
        serde_norway::to_string(&Yaml::Mapping(doc))
            .ok()?
            .into_bytes(),
    )
}

/// Reset may replace a file wholesale with its snapshot only when the
/// snapshot is complete.
pub(crate) fn snapshot_is_partial(path: &Path) -> bool {
    is_credentials_file(path)
}

/// Reset only AI Helper's fields of a file changed after takeover: managed
/// routes/refs return to their snapshot values (or disappear), and a default
/// model pointing at a managed route returns to the snapshot's default.
/// Returns `None` when nothing would change.
pub(crate) fn reconcile_file(
    path: &Path,
    current: &[u8],
    snapshot: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, AppError> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let updated = if name.starts_with(CREDENTIALS_FILE) {
        let snapshot = snapshot
            .and_then(|raw| parse_credentials_value(raw).ok())
            .unwrap_or(Yaml::Null);
        let refs: RefEdits = ALL_KINDS
            .into_iter()
            .map(|kind| {
                let value = snapshot
                    .get("refs")
                    .and_then(|refs| refs.get(kind.key_ref()))
                    .cloned();
                (kind.key_ref().to_string(), value)
            })
            .collect();
        edit_credentials(Some(current), &refs)?
    } else {
        let snapshot = snapshot
            .and_then(|raw| parse_patch_value(raw).ok())
            .unwrap_or(Yaml::Null);
        let current_value = parse_patch_value(current)?;
        let snapshot_providers = providers_of(&snapshot);
        let routes = ALL_KINDS
            .into_iter()
            .map(|kind| {
                let value = snapshot_providers
                    .and_then(|map| map.get(kind.route()))
                    .cloned();
                (kind.route().to_string(), value)
            })
            .collect();
        let managed_default = default_config_of(&current_value)
            .and_then(|config| config.get("provider"))
            .and_then(Yaml::as_str)
            .is_some_and(|provider| provider.starts_with(MANAGED_ROUTE_PREFIX));
        let default_model = if managed_default {
            let config = default_config_of(&snapshot);
            match (
                config.and_then(|config| config.get("provider")),
                config.and_then(|config| config.get("model")),
            ) {
                (Some(provider), Some(model)) => DefaultEdit::Set {
                    provider: provider.clone(),
                    model: model.clone(),
                    effort: config
                        .and_then(|config| config.get("reasoningEffort"))
                        .cloned(),
                },
                _ => DefaultEdit::Clear,
            }
        } else {
            DefaultEdit::Keep
        };
        edit_patch(
            Some(current),
            &PatchEdit {
                routes,
                default_model,
            },
        )?
    };
    Ok((updated != current).then_some(updated))
}

#[cfg(test)]
pub(crate) fn with_test_home<T>(home: &Path, operation: impl FnOnce() -> T) -> T {
    struct Restore(Option<PathBuf>);
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_HOME.with(|slot| *slot.borrow_mut() = self.0.take());
        }
    }
    let _restore = Restore(TEST_HOME.with(|slot| slot.borrow_mut().replace(home.to_path_buf())));
    operation()
}

#[cfg(test)]
mod tests;

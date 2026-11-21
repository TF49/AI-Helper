use super::*;

/// Sanitized copy of a real desktop profile: no keys, user routes kept.
const DESKTOP_PATCH: &str = r#"# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-08-13.1
    legacyFlag: "no"
    ratio: 1.10
    sortKey: !!js "(a, b) => a.order - b.order"
- id: llm-deepseek
  name: "@deepseek-ai/dsh-llm-deepseek-api-key"
  config:
    baseURL: https://bob-api.com/
    models:
      - id: deepseek-v4.1-flash
        name: deepseek-v4.1-flash
        inputModalities:
          - text
          - image
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: bobapi
    model: claude-sonnet-5
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      bobapi:
        displayName: 涂夫
        apiKeyEnv: BOBAPI_API_KEY
        api: anthropic-messages
        baseURL: https://bob-api.com/
        models:
          - id: claude-sonnet-5
            name: claude-sonnet-5
      # the user's Codex route
      tufu:
        displayName: 涂夫
        apiKeyEnv: TUFU_API_KEY
        api: openai-responses
        baseURL: https://bob-api.com/v1
        models:
          - id: gpt-6-sol
            name: gpt-6-sol
"#;

const EMPTY_PATCH: &str = "# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n";

/// Fake values only.
const CREDENTIALS: &str = r#"version: 1
refs:
  BOBAPI_API_KEY: sk-fake-bobapi
  TUFU_API_KEY: sk-fake-tufu
records:
  client-connection/browser-session:
    kind: secret
    payload:
      version: 1
      secret: fake-browser-secret
  deepseek-account-platform/default:
    kind: token
    payload:
      version: 1
      token: fake-account-token
      issuer: https://example.invalid
"#;

fn route_set(kind: DshRouteKind, models: &[&str]) -> (String, Option<Yaml>) {
    let models: Vec<String> = models.iter().map(|m| m.to_string()).collect();
    let base = kind.normalize_base_url(None).unwrap();
    (
        kind.route().to_string(),
        Some(route_value(kind, &base, &models, None)),
    )
}

fn parse(bytes: &[u8]) -> Yaml {
    serde_norway::from_slice(bytes).unwrap()
}

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap()
}

#[test]
fn adding_and_removing_routes_round_trips_byte_for_byte() {
    let edit = PatchEdit {
        routes: vec![
            route_set(
                DshRouteKind::Claude,
                &["claude-sonnet-5-5", "claude-opus-5-5"],
            ),
            route_set(DshRouteKind::Codex, &["gpt-6-sol"]),
            route_set(DshRouteKind::Domestic, &["deepseek-v4-pro", "1.10"]),
        ],
        default_model: DefaultEdit::Set {
            provider: ystr("aihelper-claude"),
            model: ystr("claude-sonnet-5-5"),
            effort: None,
        },
    };
    let written = edit_patch(Some(DESKTOP_PATCH.as_bytes()), &edit).unwrap();
    let written_text = text(written.clone());

    // Untouched lines keep their exact spelling.
    for line in [
        "    welcomeNoticeVersion: 2026-08-13.1",
        "    legacyFlag: \"no\"",
        "    ratio: 1.10",
        "    sortKey: !!js \"(a, b) => a.order - b.order\"",
        "      # the user's Codex route",
        "  name: \"@deepseek-ai/dsh-llm-pi-ai\"",
    ] {
        assert!(written_text.contains(line), "missing {line}");
    }
    assert!(written_text.starts_with(PATCH_HEADER[0]));

    let value = parse(&written);
    let providers = providers_of(&value).unwrap();
    let original = parse(DESKTOP_PATCH.as_bytes());
    let original_providers = providers_of(&original).unwrap();
    assert_eq!(providers.get("bobapi"), original_providers.get("bobapi"));
    assert_eq!(providers.get("tufu"), original_providers.get("tufu"));
    let claude = providers.get("aihelper-claude").unwrap();
    assert_eq!(claude.get("api").unwrap(), "anthropic-messages");
    assert_eq!(claude.get("baseURL").unwrap(), "https://bob-api.com/");
    assert_eq!(claude.get("apiKeyEnv").unwrap(), "AIHELPER_CLAUDE_API_KEY");
    assert_eq!(
        model_ids(providers.get("aihelper-cn").unwrap()),
        vec!["deepseek-v4-pro", "1.10"]
    );
    assert_eq!(
        providers
            .get("aihelper-codex")
            .unwrap()
            .get("baseURL")
            .unwrap(),
        "https://bob-api.com/v1"
    );
    assert_eq!(
        build_default_model(&value),
        Some(DshDefaultModel {
            provider: "aihelper-claude".into(),
            model: "claude-sonnet-5-5".into(),
        })
    );

    // Undo: remove our routes and put the user's default back.
    let undo = PatchEdit {
        routes: ALL_KINDS
            .into_iter()
            .map(|kind| (kind.route().to_string(), None))
            .collect(),
        default_model: DefaultEdit::Set {
            provider: ystr("bobapi"),
            model: ystr("claude-sonnet-5"),
            effort: None,
        },
    };
    let restored = edit_patch(Some(&written), &undo).unwrap();
    assert_eq!(text(restored), DESKTOP_PATCH);
}

#[test]
fn replacing_a_route_keeps_its_position_and_extra_model_fields() {
    let first = edit_patch(
        Some(DESKTOP_PATCH.as_bytes()),
        &PatchEdit {
            routes: vec![route_set(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
            default_model: DefaultEdit::Keep,
        },
    )
    .unwrap();
    // The user adds a field to one of our models.
    let first = text(first);
    let name_line = first
        .lines()
        .skip_while(|line| !line.contains("aihelper-claude:"))
        .find(|line| line.trim() == "name: claude-sonnet-5-5")
        .unwrap()
        .to_string();
    let indent = &name_line[..name_line.len() - name_line.trim_start().len()];
    let edited = first.replace(
        &format!("{name_line}\n"),
        &format!("{name_line}\n{indent}reasoning: true\n"),
    );
    let previous = providers_of(&parse(edited.as_bytes()))
        .unwrap()
        .get("aihelper-claude")
        .cloned();
    let models = vec![
        "claude-sonnet-5-5".to_string(),
        "claude-opus-5-5".to_string(),
    ];
    let value = route_value(
        DshRouteKind::Claude,
        "https://bob-api.com/",
        &models,
        previous.as_ref(),
    );
    let second = edit_patch(
        Some(edited.as_bytes()),
        &PatchEdit {
            routes: vec![("aihelper-claude".into(), Some(value))],
            default_model: DefaultEdit::Keep,
        },
    )
    .unwrap();
    let parsed = parse(&second);
    let route = providers_of(&parsed)
        .unwrap()
        .get("aihelper-claude")
        .unwrap();
    assert_eq!(model_ids(route), models);
    assert_eq!(
        route.get("models").unwrap()[0].get("reasoning"),
        Some(&Yaml::Bool(true))
    );
    // A single copy of the route.
    assert_eq!(text(second).matches("aihelper-claude:").count(), 1);
}

#[test]
fn empty_profile_gains_entries_and_returns_to_an_empty_list() {
    let edit = PatchEdit {
        routes: vec![route_set(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
        default_model: DefaultEdit::Set {
            provider: ystr("aihelper-claude"),
            model: ystr("claude-sonnet-5-5"),
            effort: None,
        },
    };
    let written = edit_patch(Some(EMPTY_PATCH.as_bytes()), &edit).unwrap();
    let written_text = text(written.clone());
    assert!(!written_text.contains("[]"));
    let value = parse(&written);
    assert_eq!(items(&value).len(), 2);
    assert!(providers_of(&value)
        .unwrap()
        .contains_key("aihelper-claude"));

    let cleared = edit_patch(
        Some(&written),
        &PatchEdit {
            routes: vec![("aihelper-claude".into(), None)],
            default_model: DefaultEdit::Clear,
        },
    )
    .unwrap();
    assert_eq!(text(cleared), EMPTY_PATCH);
}

#[test]
fn missing_patch_file_is_created_with_the_dsh_header() {
    let written = edit_patch(
        None,
        &PatchEdit {
            routes: vec![route_set(DshRouteKind::Codex, &["gpt-6-sol"])],
            default_model: DefaultEdit::Keep,
        },
    )
    .unwrap();
    let written_text = text(written.clone());
    assert!(written_text.starts_with(&PATCH_HEADER.join("\n")));
    assert!(providers_of(&parse(&written))
        .unwrap()
        .contains_key("aihelper-codex"));
}

#[test]
fn removing_routes_that_do_not_exist_changes_nothing() {
    let unchanged = edit_patch(
        Some(DESKTOP_PATCH.as_bytes()),
        &PatchEdit {
            routes: vec![("aihelper-claude".into(), None)],
            default_model: DefaultEdit::Keep,
        },
    )
    .unwrap();
    assert_eq!(text(unchanged), DESKTOP_PATCH);
}

#[test]
fn unsupported_structures_are_refused() {
    let edit = PatchEdit {
        routes: vec![route_set(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
        default_model: DefaultEdit::Keep,
    };
    for raw in [
        "id: not-a-list\n",
        "[{id: llm-pi-ai, config: {providers: {}}}]\n",
        "- id: llm-pi-ai\n  config:\n    providers: {bobapi: {api: x}}\n",
        "- id: llm-pi-ai\n  config:\n    providers: !!js \"() => ({})\"\n",
        "- id: llm-pi-ai\n- id: llm-pi-ai\n",
        "- config:\n    providers:\n      x: 1\n  id: llm-pi-ai\n",
    ] {
        assert!(
            edit_patch(Some(raw.as_bytes()), &edit).is_err(),
            "accepted {raw:?}"
        );
    }
}

#[test]
fn inline_empty_providers_is_expanded() {
    let raw =
        "- id: llm-pi-ai\n  name: \"@deepseek-ai/dsh-llm-pi-ai\"\n  config:\n    providers: {}\n";
    let written = edit_patch(
        Some(raw.as_bytes()),
        &PatchEdit {
            routes: vec![route_set(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
            default_model: DefaultEdit::Keep,
        },
    )
    .unwrap();
    let value = parse(&written);
    assert!(providers_of(&value)
        .unwrap()
        .contains_key("aihelper-claude"));
}

#[test]
fn credentials_only_touch_managed_refs() {
    let refs = vec![
        (
            "AIHELPER_CLAUDE_API_KEY".to_string(),
            Some(ystr("sk-fake-claude")),
        ),
        ("AIHELPER_CN_API_KEY".to_string(), Some(ystr("sk-fake-cn"))),
    ];
    let written = edit_credentials(Some(CREDENTIALS.as_bytes()), &refs).unwrap();
    let written_text = text(written.clone());
    let records = &CREDENTIALS[CREDENTIALS.find("records:").unwrap()..];
    assert!(
        written_text.ends_with(records),
        "records must be byte-identical"
    );
    let value = parse(&written);
    assert_eq!(
        value["refs"]["AIHELPER_CLAUDE_API_KEY"],
        ystr("sk-fake-claude")
    );
    assert_eq!(value["refs"]["BOBAPI_API_KEY"], ystr("sk-fake-bobapi"));

    let removed = edit_credentials(
        Some(&written),
        &[
            ("AIHELPER_CLAUDE_API_KEY".to_string(), None),
            ("AIHELPER_CN_API_KEY".to_string(), None),
        ],
    )
    .unwrap();
    assert_eq!(text(removed), CREDENTIALS);
}

#[test]
fn credentials_file_is_created_when_missing_and_refs_collapse_when_empty() {
    let refs = vec![(
        "AIHELPER_CODEX_API_KEY".to_string(),
        Some(ystr("sk-fake-codex")),
    )];
    let written = edit_credentials(None, &refs).unwrap();
    assert_eq!(
        text(written.clone()),
        "version: 1\nrefs:\n  AIHELPER_CODEX_API_KEY: sk-fake-codex\n"
    );
    let removed =
        edit_credentials(Some(&written), &[("AIHELPER_CODEX_API_KEY".into(), None)]).unwrap();
    assert_eq!(text(removed), "version: 1\nrefs: {}\n");
}

#[test]
fn credentials_with_crlf_and_non_mapping_root() {
    let crlf = CREDENTIALS.replace('\n', "\r\n");
    let written = edit_credentials(
        Some(crlf.as_bytes()),
        &[("AIHELPER_CN_API_KEY".into(), Some(ystr("sk-fake-cn")))],
    )
    .unwrap();
    let written_text = text(written);
    assert!(written_text.contains("  AIHELPER_CN_API_KEY: sk-fake-cn\r\n"));
    assert!(!written_text.replace("\r\n", "").contains('\n'));

    assert!(edit_credentials(
        Some(b"- a\n- b\n"),
        &[("AIHELPER_CN_API_KEY".into(), Some(ystr("k")))]
    )
    .is_err());
}

#[test]
fn base_urls_are_normalized_per_protocol() {
    for input in [
        None,
        Some(""),
        Some("https://bob-api.com"),
        Some("https://bob-api.com/v1/"),
    ] {
        assert_eq!(
            DshRouteKind::Claude.normalize_base_url(input).unwrap(),
            "https://bob-api.com/"
        );
        assert_eq!(
            DshRouteKind::Domestic.normalize_base_url(input).unwrap(),
            "https://bob-api.com/v1"
        );
    }
    assert!(DshRouteKind::Codex
        .normalize_base_url(Some("https://bob-api.com/ v1"))
        .is_err());
}

#[test]
fn models_are_split_by_protocol() {
    assert!(DshRouteKind::Claude.accepts_model("claude-sonnet-5-5"));
    assert!(!DshRouteKind::Claude.accepts_model("gpt-6-sol"));
    assert!(DshRouteKind::Codex.accepts_model("gpt-6-sol"));
    assert!(DshRouteKind::Codex.accepts_model("codex-auto-review"));
    assert!(DshRouteKind::Codex.accepts_model("gpt-4o"));
    assert!(!DshRouteKind::Codex.accepts_model("deepseek-v4-pro"));
    assert!(DshRouteKind::Domestic.accepts_model("deepseek-v4-pro"));
    assert!(DshRouteKind::Domestic.accepts_model("glm-5.2"));
    assert!(!DshRouteKind::Domestic.accepts_model("claude-opus-5"));
}

#[test]
fn non_chat_models_are_never_offered() {
    // Real entries of the bob-api 国产Token计划 group.
    for id in [
        "qwen-image-3.0-pro",
        "qwen-audio-3.0-asr-flash",
        "wan3.0-video",
        "text-embedding-3-large",
    ] {
        assert!(!DshRouteKind::Domestic.accepts_model(id), "{id}");
    }
    assert!(!DshRouteKind::Codex.accepts_model("gpt-image-2"));
    for id in [
        "deepseek-v4.1-flash",
        "deepseek-v4.1-flash-1017",
        "glm-5.3-flashx",
        "qwen3.8-max",
        "kimi-k3.1-pro",
        "minimax-m3",
        "hy4-flash",
    ] {
        assert!(DshRouteKind::Domestic.accepts_model(id), "{id}");
    }
}

#[test]
fn managed_models_declare_image_input() {
    let modalities = |model: &Yaml| -> Option<Vec<String>> {
        model
            .get("inputModalities")
            .and_then(Yaml::as_sequence)
            .map(|list| {
                list.iter()
                    .filter_map(Yaml::as_str)
                    .map(str::to_string)
                    .collect()
            })
    };
    let base = DshRouteKind::Domestic.normalize_base_url(None).unwrap();
    let models = vec!["deepseek-v4.1-flash".to_string(), "glm-5.3".to_string()];

    // Fresh entries gain [text, image].
    let fresh = route_value(DshRouteKind::Domestic, &base, &models, None);
    for model in fresh.get("models").and_then(Yaml::as_sequence).unwrap() {
        assert_eq!(modalities(model), Some(vec!["text".into(), "image".into()]));
    }

    // Entries written before keep their fields and gain the declaration; an
    // explicit user value wins.
    let previous: Yaml = serde_norway::from_str(
        "models:\n  - id: deepseek-v4.1-flash\n    name: deepseek-v4.1-flash\n    contextWindow: 1000000\n  - id: glm-5.3\n    name: glm-5.3\n    inputModalities: [text]\n",
    )
    .unwrap();
    let merged = route_value(DshRouteKind::Domestic, &base, &models, Some(&previous));
    let list = merged.get("models").and_then(Yaml::as_sequence).unwrap();
    assert_eq!(
        list[0].get("contextWindow").and_then(Yaml::as_u64),
        Some(1_000_000)
    );
    assert_eq!(
        modalities(&list[0]),
        Some(vec!["text".into(), "image".into()])
    );
    assert_eq!(modalities(&list[1]), Some(vec!["text".into()]));

    // Claude / Codex routes on bob-api accept images too.
    for (kind, model) in [
        (DshRouteKind::Claude, "claude-sonnet-5-5"),
        (DshRouteKind::Codex, "gpt-6-sol"),
    ] {
        let base = kind.normalize_base_url(None).unwrap();
        let route = route_value(kind, &base, &[model.to_string()], None);
        let list = route.get("models").and_then(Yaml::as_sequence).unwrap();
        assert_eq!(
            modalities(&list[0]),
            Some(vec!["text".into(), "image".into()]),
            "{model}"
        );
    }

    // The rendered patch passes verification and reads back.
    let edit = PatchEdit {
        routes: vec![route_set(DshRouteKind::Domestic, &["deepseek-v4.1-flash"])],
        default_model: DefaultEdit::Keep,
    };
    let written = text(edit_patch(Some(DESKTOP_PATCH.as_bytes()), &edit).unwrap());
    assert!(written.contains("        inputModalities:\n          - text\n          - image\n"));
}

const MANAGED_KEY: &str = "sk-fake-dsh-managed";

fn update(kind: DshRouteKind, models: &[&str]) -> DshRouteUpdate {
    crate::credential_policy::register_managed_key(MANAGED_KEY);
    DshRouteUpdate {
        kind,
        enabled: true,
        api_key: MANAGED_KEY.into(),
        base_url: None,
        models: models.iter().map(|m| m.to_string()).collect(),
        only_same_key: false,
    }
}

#[test]
fn route_validation_rejects_bad_input() {
    let mut missing_key = update(DshRouteKind::Claude, &["claude-sonnet-5-5"]);
    missing_key.api_key = "  ".into();
    assert!(validate_routes(&[missing_key]).is_err());

    let mut foreign = update(DshRouteKind::Claude, &["claude-sonnet-5-5"]);
    foreign.base_url = Some("https://evil.example.com".into());
    assert!(validate_routes(&[foreign]).is_err());

    assert!(validate_routes(&[update(DshRouteKind::Claude, &[" ", ""])]).is_err());
    assert!(validate_routes(&[
        update(DshRouteKind::Claude, &["a"]),
        update(DshRouteKind::Claude, &["b"]),
    ])
    .is_err());

    let specs = validate_routes(&[update(
        DshRouteKind::Codex,
        &[" gpt-6-sol ", "gpt-6-sol", "gpt-6-luna"],
    )])
    .unwrap();
    let spec = specs[0].1.as_ref().unwrap();
    assert_eq!(spec.models, vec!["gpt-6-sol", "gpt-6-luna"]);
    assert_eq!(spec.base_url, "https://bob-api.com/v1");
}

#[test]
fn planning_tracks_the_default_model() {
    let with_ours = edit_patch(
        Some(DESKTOP_PATCH.as_bytes()),
        &PatchEdit {
            routes: vec![route_set(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
            default_model: DefaultEdit::Set {
                provider: ystr("aihelper-claude"),
                model: ystr("claude-sonnet-5-5"),
                effort: None,
            },
        },
    )
    .unwrap();
    let old = parse(&with_ours);

    // Disabling the route that holds the default clears the default.
    let disable = validate_routes(&[DshRouteUpdate {
        kind: DshRouteKind::Claude,
        enabled: false,
        api_key: String::new(),
        base_url: None,
        models: Vec::new(),
        only_same_key: false,
    }])
    .unwrap();
    let (edit, refs) = plan_save(&old, &disable, None).unwrap();
    assert_eq!(edit.default_model, DefaultEdit::Clear);
    assert_eq!(refs, vec![("AIHELPER_CLAUDE_API_KEY".to_string(), None)]);

    // Dropping the default's model from the route clears it as well.
    let narrowed = validate_routes(&[update(DshRouteKind::Claude, &["claude-opus-5-5"])]).unwrap();
    let (edit, _) = plan_save(&old, &narrowed, None).unwrap();
    assert_eq!(edit.default_model, DefaultEdit::Clear);

    // Saving another route keeps it.
    let other = validate_routes(&[update(DshRouteKind::Codex, &["gpt-6-sol"])]).unwrap();
    let (edit, _) = plan_save(&old, &other, None).unwrap();
    assert_eq!(edit.default_model, DefaultEdit::Keep);

    // A user default on their own route is never cleared.
    let user = parse(DESKTOP_PATCH.as_bytes());
    let (edit, _) = plan_save(&user, &disable, None).unwrap();
    assert_eq!(edit.default_model, DefaultEdit::Keep);

    // Selecting a default requires the model to be offered.
    let selection = DshDefaultSelection {
        kind: DshRouteKind::Codex,
        model: "gpt-6-luna".into(),
    };
    assert!(plan_save(&old, &other, Some(&selection)).is_err());
    let selection = DshDefaultSelection {
        kind: DshRouteKind::Domestic,
        model: "glm-5.2".into(),
    };
    assert!(plan_save(&old, &other, Some(&selection)).is_err());
    let selection = DshDefaultSelection {
        kind: DshRouteKind::Claude,
        model: "claude-sonnet-5-5".into(),
    };
    let (edit, _) = plan_save(&old, &other, Some(&selection)).unwrap();
    assert_eq!(
        edit.default_model,
        DefaultEdit::Set {
            provider: ystr("aihelper-claude"),
            model: ystr("claude-sonnet-5-5"),
            effort: None,
        }
    );
}

fn make_home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    for profile in ["desktop", "core-020", "node_modules", ".hidden"] {
        std::fs::create_dir_all(home.path().join("profiles").join(profile)).unwrap();
    }
    std::fs::write(
        home.path().join("profiles/desktop").join(PATCH_FILE),
        DESKTOP_PATCH,
    )
    .unwrap();
    std::fs::write(
        home.path().join("profiles/core-020").join(PATCH_FILE),
        EMPTY_PATCH,
    )
    .unwrap();
    std::fs::write(home.path().join(CREDENTIALS_FILE), CREDENTIALS).unwrap();
    home
}

#[test]
fn only_the_desktop_profile_is_used() {
    let home = make_home();
    assert_eq!(resolve_profile(home.path(), None).unwrap(), "desktop");
    assert_eq!(
        resolve_profile(home.path(), Some("desktop")).unwrap(),
        "desktop"
    );
    for other in [
        "core-020",
        "../desktop",
        "node_modules",
        ".hidden",
        "missing",
        "a/b",
    ] {
        assert!(
            resolve_profile(home.path(), Some(other)).is_err(),
            "{other}"
        );
    }
    with_test_home(home.path(), || {
        let config = get_dsh_config(Some("core-020".into())).unwrap();
        assert_eq!(config.profiles, vec!["desktop"]);
        assert_eq!(config.selected_profile.as_deref(), Some("desktop"));
    });
    std::fs::remove_dir_all(home.path().join("profiles/desktop")).unwrap();
    assert!(resolve_profile(home.path(), None).is_err());
}

#[test]
fn save_writes_both_files_and_reads_back() {
    let home = make_home();
    let state = tempfile::tempdir().unwrap();
    crate::reset::with_test_state_path(&state.path().join("reset.json"), || {
        with_test_home(home.path(), || {
            let payload = DshRoutesPayload {
                profile: None,
                routes: vec![
                    update(DshRouteKind::Claude, &["claude-sonnet-5-5"]),
                    update(DshRouteKind::Domestic, &["glm-5.2"]),
                ],
                default_model: Some(DshDefaultSelection {
                    kind: DshRouteKind::Claude,
                    model: "claude-sonnet-5-5".into(),
                }),
            };
            let result = set_dsh_routes(payload).unwrap();
            assert_eq!(result.profile, "desktop");

            let credentials = std::fs::read_to_string(home.path().join(CREDENTIALS_FILE)).unwrap();
            let records = &CREDENTIALS[CREDENTIALS.find("records:").unwrap()..];
            assert!(credentials.ends_with(records));

            let config = get_dsh_config(None).unwrap();
            assert_eq!(config.selected_profile.as_deref(), Some("desktop"));
            let claude = &config.routes[0];
            assert!(claude.configured);
            assert_eq!(claude.api_key, MANAGED_KEY);
            assert_eq!(claude.models, vec!["claude-sonnet-5-5"]);
            assert!(!config.routes[1].configured);
            assert!(config.routes[2].configured);
            assert_eq!(
                config.default_model,
                Some(DshDefaultModel {
                    provider: "aihelper-claude".into(),
                    model: "claude-sonnet-5-5".into(),
                })
            );
            let external: Vec<_> = config
                .external_routes
                .iter()
                .map(|route| route.name.as_str())
                .collect();
            assert_eq!(external, vec!["bobapi", "tufu"]);
            assert!(config.read_error.is_none());

            // The other profile is untouched.
            assert_eq!(
                std::fs::read_to_string(home.path().join("profiles/core-020").join(PATCH_FILE))
                    .unwrap(),
                EMPTY_PATCH
            );
        })
    });
}

#[test]
fn failed_patch_write_rolls_back_the_credentials() {
    let home = make_home();
    let state = tempfile::tempdir().unwrap();
    let patch_file = home.path().join("profiles/desktop").join(PATCH_FILE);
    crate::reset::with_test_state_path(&state.path().join("reset.json"), || {
        with_test_home(home.path(), || {
            TEST_FAIL_WRITE.with(|target| *target.borrow_mut() = Some(patch_file.clone()));
            let result = set_dsh_routes(DshRoutesPayload {
                profile: None,
                routes: vec![update(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
                default_model: None,
            });
            TEST_FAIL_WRITE.with(|target| *target.borrow_mut() = None);
            assert!(result.is_err());
        })
    });
    assert_eq!(
        std::fs::read_to_string(home.path().join(CREDENTIALS_FILE)).unwrap(),
        CREDENTIALS
    );
    assert_eq!(std::fs::read_to_string(&patch_file).unwrap(), DESKTOP_PATCH);
}

#[test]
fn reconcile_restores_only_managed_fields() {
    let snapshot = DESKTOP_PATCH.as_bytes();
    let managed = edit_patch(
        Some(snapshot),
        &PatchEdit {
            routes: vec![route_set(DshRouteKind::Claude, &["claude-sonnet-5-5"])],
            default_model: DefaultEdit::Set {
                provider: ystr("aihelper-claude"),
                model: ystr("claude-sonnet-5-5"),
                effort: None,
            },
        },
    )
    .unwrap();
    // The user then changes their own theme entry.
    let user_edited = format!(
        "{}- id: ui-theme\n  name: \"@deepseek-ai/dsh-client-ui-theme\"\n  config:\n    preference: dark\n",
        text(managed)
    );
    let path = Path::new("C:/dsh/profiles/desktop/cordis.patch.yml");
    let reconciled = reconcile_file(path, user_edited.as_bytes(), Some(snapshot))
        .unwrap()
        .unwrap();
    let expected = format!(
        "{DESKTOP_PATCH}- id: ui-theme\n  name: \"@deepseek-ai/dsh-client-ui-theme\"\n  config:\n    preference: dark\n"
    );
    assert_eq!(text(reconciled), expected);
    // Nothing left to do afterwards.
    assert!(reconcile_file(path, expected.as_bytes(), Some(snapshot))
        .unwrap()
        .is_none());

    let credentials_path = Path::new("C:/dsh/.credentials.yaml.bak");
    let managed = edit_credentials(
        Some(CREDENTIALS.as_bytes()),
        &[(
            "AIHELPER_CLAUDE_API_KEY".into(),
            Some(ystr("sk-fake-claude")),
        )],
    )
    .unwrap();
    let reconciled = reconcile_file(credentials_path, &managed, Some(CREDENTIALS.as_bytes()))
        .unwrap()
        .unwrap();
    assert_eq!(text(reconciled), CREDENTIALS);
}

/// The official DeepSeek account and API-key routes live in their own
/// entries and credentials; AI Helper must leave them exactly as they are.
#[test]
fn official_deepseek_routes_and_login_are_left_alone() {
    const OFFICIAL_PATCH: &str = "- id: llm-deepseek-account\n  name: \"@deepseek-ai/dsh-llm-deepseek-account\"\n  config:\n    reasoningEffort: high\n- id: llm-deepseek\n  name: \"@deepseek-ai/dsh-llm-deepseek-api-key\"\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n- id: agent-default-model\n  name: \"@deepseek-ai/dsh-agent-default-model\"\n  config:\n    provider: deepseek-account\n    model: deepseek-v4-pro\n    reasoningEffort: max\n";
    let home = make_home();
    let patch_path = home.path().join("profiles/desktop").join(PATCH_FILE);
    std::fs::write(&patch_path, OFFICIAL_PATCH).unwrap();
    let credentials_path = home.path().join(CREDENTIALS_FILE);
    let credentials_with_official_key =
        CREDENTIALS.replace("refs:\n", "refs:\n  DEEPSEEK_API_KEY: sk-fake-official\n");
    std::fs::write(&credentials_path, &credentials_with_official_key).unwrap();
    let state = tempfile::tempdir().unwrap();
    let state_file = state.path().join("reset.json");

    crate::reset::with_test_state_path(&state_file, || {
        with_test_home(home.path(), || {
            // No default selection: the official account stays the default.
            set_dsh_routes(DshRoutesPayload {
                profile: None,
                routes: vec![update(DshRouteKind::Domestic, &["deepseek-v4.1-flash"])],
                default_model: None,
            })
            .unwrap();
        })
    });

    let written = std::fs::read_to_string(&patch_path).unwrap();
    assert!(written.starts_with(OFFICIAL_PATCH), "{written}");
    let credentials = std::fs::read_to_string(&credentials_path).unwrap();
    assert!(credentials.contains("  DEEPSEEK_API_KEY: sk-fake-official\n"));
    let records = &CREDENTIALS[CREDENTIALS.find("records:").unwrap()..];
    assert!(credentials.ends_with(records));
    // The credentials file gets no backup copy, and DSH's locks are released.
    assert!(!crate::safe_fs::backup_path(&credentials_path).exists());
    assert!(!lock::lock_path(&credentials_path).exists());
    assert!(!lock::lock_path(&patch_path).exists());

    // AI Helper's reset state never holds the official login or keys.
    let saved = std::fs::read_to_string(&state_file).unwrap();
    for secret in [
        "fake-account-token",
        "sk-fake-official",
        "sk-fake-bobapi",
        "fake-browser-secret",
    ] {
        assert!(!saved.contains(secret), "reset state leaked {secret}");
    }
}

#[test]
fn selecting_a_managed_default_drops_the_official_reasoning_effort() {
    let doc = "- id: agent-default-model\n  name: \"@deepseek-ai/dsh-agent-default-model\"\n  config:\n    provider: deepseek-account\n    model: deepseek-v4-pro\n    reasoningEffort: max\n";
    let edit = PatchEdit {
        routes: vec![route_set(DshRouteKind::Domestic, &["deepseek-v4.1-flash"])],
        default_model: DefaultEdit::Set {
            provider: ystr("aihelper-cn"),
            model: ystr("deepseek-v4.1-flash"),
            effort: None,
        },
    };
    let written = parse(&edit_patch(Some(doc.as_bytes()), &edit).unwrap());
    let config = default_config_of(&written).unwrap();
    assert_eq!(config.get("provider").unwrap(), "aihelper-cn");
    assert_eq!(config.get("model").unwrap(), "deepseek-v4.1-flash");
    assert!(config.get("reasoningEffort").is_none());

    // Reset restores the official default together with its effort.
    let restored = reconcile_file(
        Path::new("cordis.patch.yml"),
        &edit_patch(Some(doc.as_bytes()), &edit).unwrap(),
        Some(doc.as_bytes()),
    )
    .unwrap()
    .unwrap();
    assert_eq!(String::from_utf8(restored).unwrap(), doc);
}

/// DSH refreshes the official account token after AI Helper's write; reset
/// must bring back only the managed refs and keep the fresh token.
#[test]
fn reset_keeps_a_token_refreshed_after_takeover() {
    let home = make_home();
    let credentials_path = home.path().join(CREDENTIALS_FILE);
    let state = tempfile::tempdir().unwrap();
    let state_file = state.path().join("reset.json");
    crate::reset::with_test_state_path(&state_file, || {
        with_test_home(home.path(), || {
            set_dsh_routes(DshRoutesPayload {
                profile: None,
                routes: vec![update(DshRouteKind::Domestic, &["deepseek-v4.1-flash"])],
                default_model: None,
            })
            .unwrap();
        });
        let refreshed = std::fs::read_to_string(&credentials_path)
            .unwrap()
            .replace("fake-account-token", "fake-account-token-refreshed");
        std::fs::write(&credentials_path, refreshed).unwrap();

        crate::reset::restore_client_for_test(CLIENT).unwrap();
    });
    assert_eq!(
        std::fs::read_to_string(&credentials_path).unwrap(),
        CREDENTIALS.replace("fake-account-token", "fake-account-token-refreshed")
    );
}

/// Unchanged since AI Helper's write: reset removes the managed refs only,
/// it never puts the redacted snapshot back over the records.
#[test]
fn reset_of_unchanged_credentials_keeps_the_records() {
    let home = make_home();
    let credentials_path = home.path().join(CREDENTIALS_FILE);
    let state = tempfile::tempdir().unwrap();
    let state_file = state.path().join("reset.json");
    crate::reset::with_test_state_path(&state_file, || {
        with_test_home(home.path(), || {
            set_dsh_routes(DshRoutesPayload {
                profile: None,
                routes: vec![update(DshRouteKind::Domestic, &["deepseek-v4.1-flash"])],
                default_model: None,
            })
            .unwrap();
        });
        crate::reset::restore_client_for_test(CLIENT).unwrap();
    });
    assert_eq!(
        std::fs::read_to_string(&credentials_path).unwrap(),
        CREDENTIALS
    );
}

#[test]
fn official_state_is_reported() {
    let credentials = parse(CREDENTIALS.as_bytes());
    let official = build_official_state(&parse(DESKTOP_PATCH.as_bytes()), &credentials);
    assert!(official.account_signed_in);
    // The fixture's default is the user's own `bobapi` route.
    assert!(!official.default_is_official);
    // The fixture's `llm-deepseek` entry was hand-pointed at the relay.
    assert_eq!(
        official.api_key_route_redirected_to.as_deref(),
        Some("https://bob-api.com/")
    );

    let patch = parse(b"- id: agent-default-model\n  config:\n    provider: deepseek-account\n    model: deepseek-v4-pro\n- id: llm-deepseek\n  config:\n    baseURL: https://api.deepseek.com/\n");
    let official = build_official_state(&patch, &Yaml::Null);
    assert!(!official.account_signed_in);
    assert!(official.default_is_official);
    assert!(official.api_key_route_redirected_to.is_none());
    // Managed route names never shadow an official one.
    for kind in ALL_KINDS {
        assert!(!OFFICIAL_PROVIDERS.contains(&kind.route()));
    }
}

fn single_key(models: &[&str], default_model: Option<&str>) -> DshSavePayload {
    crate::credential_policy::register_managed_key(MANAGED_KEY);
    DshSavePayload {
        profile: None,
        api_key: MANAGED_KEY.into(),
        base_url: None,
        models: models.iter().map(|m| m.to_string()).collect(),
        default_model: default_model.map(str::to_string),
    }
}

#[test]
fn single_key_models_are_split_into_routes_by_protocol() {
    let routes = split_payload(single_key(
        &[
            "deepseek-v4.1-flash",
            " claude-sonnet-5-5 ",
            "gpt-6-sol",
            "glm-5.3",
            "glm-5.3",
        ],
        Some("claude-sonnet-5-5"),
    ))
    .unwrap();
    let by_kind = |kind: DshRouteKind| routes.routes.iter().find(|r| r.kind == kind).unwrap();
    assert_eq!(routes.routes.len(), 3);
    assert_eq!(
        by_kind(DshRouteKind::Claude).models,
        vec!["claude-sonnet-5-5"]
    );
    assert_eq!(by_kind(DshRouteKind::Codex).models, vec!["gpt-6-sol"]);
    assert_eq!(
        by_kind(DshRouteKind::Domestic).models,
        vec!["deepseek-v4.1-flash", "glm-5.3"]
    );
    assert!(routes
        .routes
        .iter()
        .all(|r| r.enabled && r.api_key == MANAGED_KEY));
    let default = routes.default_model.unwrap();
    assert_eq!(default.kind, DshRouteKind::Claude);
    assert_eq!(default.model, "claude-sonnet-5-5");
}

#[test]
fn single_key_without_models_of_a_protocol_removes_that_route() {
    let routes = split_payload(single_key(&["deepseek-v4.1-flash"], None)).unwrap();
    for update in &routes.routes {
        assert_eq!(
            update.enabled,
            update.kind == DshRouteKind::Domestic,
            "{:?}",
            update.kind
        );
        // Empty protocols are removed only if they hold this same key.
        assert_eq!(update.only_same_key, !update.enabled, "{:?}", update.kind);
    }
    assert!(routes.default_model.is_none());

    assert!(split_payload(single_key(&[" "], None)).is_err());
    let mut no_key = single_key(&["glm-5.3"], None);
    no_key.api_key = "  ".into();
    assert!(split_payload(no_key).is_err());
}

#[test]
fn single_key_save_rewrites_every_managed_route_with_the_same_key() {
    let home = make_home();
    let state = tempfile::tempdir().unwrap();
    crate::reset::with_test_state_path(&state.path().join("reset.json"), || {
        with_test_home(home.path(), || {
            // Before: Claude and domestic routes configured separately.
            set_dsh_routes(DshRoutesPayload {
                profile: None,
                routes: vec![
                    update(DshRouteKind::Claude, &["claude-sonnet-5-5"]),
                    update(DshRouteKind::Domestic, &["glm-5.2"]),
                ],
                default_model: Some(DshDefaultSelection {
                    kind: DshRouteKind::Claude,
                    model: "claude-sonnet-5-5".into(),
                }),
            })
            .unwrap();

            // After: one key with domestic and Codex models; Claude is gone.
            set_dsh_config(single_key(
                &["deepseek-v4.1-flash", "gpt-6-sol"],
                Some("deepseek-v4.1-flash"),
            ))
            .unwrap();

            let config = get_dsh_config(None).unwrap();
            let route = |kind: DshRouteKind| config.routes.iter().find(|r| r.kind == kind).unwrap();
            assert!(!route(DshRouteKind::Claude).configured);
            assert_eq!(route(DshRouteKind::Codex).models, vec!["gpt-6-sol"]);
            assert_eq!(
                route(DshRouteKind::Domestic).models,
                vec!["deepseek-v4.1-flash"]
            );
            assert_eq!(route(DshRouteKind::Codex).api_key, MANAGED_KEY);
            assert_eq!(route(DshRouteKind::Domestic).api_key, MANAGED_KEY);
            assert_eq!(
                config.default_model,
                Some(DshDefaultModel {
                    provider: "aihelper-cn".into(),
                    model: "deepseek-v4.1-flash".into(),
                })
            );
            let credentials = std::fs::read_to_string(home.path().join(CREDENTIALS_FILE)).unwrap();
            assert!(!credentials.contains("AIHELPER_CLAUDE_API_KEY"));
        })
    });
}

const OTHER_KEY: &str = "sk-fake-dsh-other-group";

#[test]
fn saving_another_key_keeps_routes_of_the_first_key() {
    let home = make_home();
    let state = tempfile::tempdir().unwrap();
    crate::reset::with_test_state_path(&state.path().join("reset.json"), || {
        with_test_home(home.path(), || {
            // Claude group key first.
            set_dsh_config(single_key(
                &["claude-sonnet-5-5"],
                Some("claude-sonnet-5-5"),
            ))
            .unwrap();

            // Then a GPT group key with only GPT models: Claude must survive.
            crate::credential_policy::register_managed_key(OTHER_KEY);
            let mut gpt = single_key(&["gpt-6-sol", "gpt-6-luna"], None);
            gpt.api_key = OTHER_KEY.into();
            set_dsh_config(gpt).unwrap();

            let config = get_dsh_config(None).unwrap();
            let route = |kind: DshRouteKind| config.routes.iter().find(|r| r.kind == kind).unwrap();
            assert_eq!(
                route(DshRouteKind::Claude).models,
                vec!["claude-sonnet-5-5"]
            );
            assert_eq!(route(DshRouteKind::Claude).api_key, MANAGED_KEY);
            assert_eq!(
                route(DshRouteKind::Codex).models,
                vec!["gpt-6-sol", "gpt-6-luna"]
            );
            assert_eq!(route(DshRouteKind::Codex).api_key, OTHER_KEY);
            assert!(!route(DshRouteKind::Domestic).configured);
            // The default still points at the untouched Claude route.
            assert_eq!(
                config.default_model,
                Some(DshDefaultModel {
                    provider: "aihelper-claude".into(),
                    model: "claude-sonnet-5-5".into(),
                })
            );

            // Deselecting Claude models under the Claude key still removes it.
            set_dsh_config(single_key(&["deepseek-v4.1-flash"], None)).unwrap();
            let config = get_dsh_config(None).unwrap();
            let route = |kind: DshRouteKind| config.routes.iter().find(|r| r.kind == kind).unwrap();
            assert!(!route(DshRouteKind::Claude).configured);
            assert_eq!(route(DshRouteKind::Codex).api_key, OTHER_KEY);
            assert_eq!(route(DshRouteKind::Domestic).api_key, MANAGED_KEY);
            assert_eq!(config.default_model, None);
        })
    });
}

#[test]
fn models_are_classified_to_their_route() {
    let routes = classify_dsh_models(vec![
        "claude-opus-5-5".into(),
        "gpt-6-sol".into(),
        "kimi-k3".into(),
    ]);
    let names: Vec<_> = routes.iter().map(|r| r.route.as_str()).collect();
    assert_eq!(
        names,
        vec!["aihelper-claude", "aihelper-codex", "aihelper-cn"]
    );
}

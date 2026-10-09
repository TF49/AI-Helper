use tauri::Manager;

mod accio;
mod api_test;
mod app_paths;
mod auth;
mod claude;
mod codex;
mod error;
mod model_fetch;
mod network;
mod process_manager;
mod updater;
mod workbuddy;

#[tauri::command]
fn get_app_paths() -> app_paths::AppPathsConfig {
    app_paths::load_app_paths()
}

#[tauri::command]
fn save_app_paths(config: app_paths::AppPathsConfig) -> Result<(), error::AppError> {
    app_paths::save_app_paths(&config)
}

#[tauri::command]
fn detect_app_path(app_type: String) -> Result<app_paths::DetectedPathInfo, String> {
    match app_type.as_str() {
        "claude" => Ok(app_paths::detect_claude_cli_path()),
        "codex" => Ok(app_paths::detect_codex_cli_path()),
        "chatgpt" => Ok(app_paths::detect_chatgpt_client_path()),
        "workbuddy" => Ok(app_paths::detect_workbuddy_client_path()),
        "acciowork" => Ok(app_paths::detect_accio_client_path()),
        _ => Err(format!("未知应用类型: {}", app_type)),
    }
}

#[tauri::command]
fn detect_all_app_paths() -> Vec<app_paths::DetectedPathInfo> {
    app_paths::detect_all_app_paths()
}

#[tauri::command]
fn browse_app_path(app_type: String) -> Result<Option<String>, String> {
    app_paths::browse_path_dialog(&app_type)
}

#[tauri::command]
fn check_app_process_status(app_type: String) -> bool {
    app_paths::is_target_running(&app_type)
}

#[tauri::command]
async fn restart_target_app(
    app_type: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        process_manager::restart_target_app(&app_type, custom_path.as_deref())
    })
    .await
    .map_err(|e| format!("进程任务执行异常: {}", e))?
}

#[tauri::command]
async fn execute_in_terminal(command: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || process_manager::execute_in_terminal(&command))
        .await
        .map_err(|e| format!("终端启动异常: {}", e))?
}

#[tauri::command]
fn get_codex_config() -> Result<codex::CodexConfig, error::AppError> {
    codex::get_codex_config()
}

#[tauri::command]
fn set_codex_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), error::AppError> {
    codex::set_codex_config(url, api_key, model)
}

#[tauri::command]
fn get_claude_config() -> Result<claude::ClaudeConfig, error::AppError> {
    claude::get_claude_config()
}

#[tauri::command]
fn set_claude_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), error::AppError> {
    claude::set_claude_config(url, api_key, model)
}

#[tauri::command]
fn get_workbuddy_config() -> Result<workbuddy::WorkbuddyUIConfig, error::AppError> {
    workbuddy::get_workbuddy_config()
}

#[tauri::command]
fn set_workbuddy_config(payload: workbuddy::WorkbuddySavePayload) -> Result<(), error::AppError> {
    workbuddy::set_workbuddy_config(payload)
}

#[tauri::command]
fn delete_workbuddy_model(
    model_id: String,
) -> Result<Vec<workbuddy::WorkbuddyModelEntry>, error::AppError> {
    workbuddy::delete_workbuddy_model(model_id)
}

#[tauri::command]
async fn check_for_updates() -> Result<updater::UpdateInfo, String> {
    updater::check_for_updates().await
}

#[tauri::command]
async fn download_and_install_update(
    version: String,
    on_event: tauri::ipc::Channel<updater::UpdateDownloadEvent>,
) -> Result<(), String> {
    updater::download_and_install_update(version, on_event).await
}

#[tauri::command]
async fn check_bob_api_network() -> network::NetworkStatus {
    network::check_bob_api_network().await
}

#[tauri::command]
async fn test_codex_config(url: String, api_key: String, model: String) -> api_test::ApiTestResult {
    api_test::test_codex_config(url, api_key, model).await
}

#[tauri::command]
async fn test_claude_config(
    url: String,
    api_key: String,
    model: String,
) -> api_test::ApiTestResult {
    api_test::test_claude_config(url, api_key, model).await
}

#[tauri::command]
async fn test_codex_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: tauri::ipc::Channel<api_test::TestStreamEvent>,
) -> api_test::ApiTestResult {
    api_test::test_codex_stream(url, api_key, model, on_event).await
}

#[tauri::command]
async fn test_claude_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: tauri::ipc::Channel<api_test::TestStreamEvent>,
) -> api_test::ApiTestResult {
    api_test::test_claude_stream(url, api_key, model, on_event).await
}

#[tauri::command]
async fn test_workbuddy_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: tauri::ipc::Channel<api_test::TestStreamEvent>,
) -> api_test::ApiTestResult {
    api_test::test_workbuddy_stream(url, api_key, model, on_event).await
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AccioBridgeStatus {
    pub is_running: bool,
    pub port: Option<u16>,
}

#[tauri::command]
fn get_accio_config() -> accio::AccioUIConfig {
    let running = accio::is_bridge_running();
    let port = accio::get_bridge_port();
    accio::get_accio_ui_config(running, port)
}

#[tauri::command]
fn set_accio_config(config: accio::AccioConfig) -> Result<(), error::AppError> {
    accio::save_accio_config(&config)
}

#[tauri::command]
async fn start_accio_bridge(port: Option<u16>) -> Result<u16, String> {
    accio::start_bridge(port).await
}

#[tauri::command]
async fn stop_accio_bridge() -> Result<(), String> {
    accio::stop_bridge().await
}

#[tauri::command]
fn get_accio_bridge_status() -> AccioBridgeStatus {
    AccioBridgeStatus {
        is_running: accio::is_bridge_running(),
        port: accio::get_bridge_port(),
    }
}

#[tauri::command]
async fn test_accio_stream(
    url: String,
    api_key: String,
    model: String,
    on_event: tauri::ipc::Channel<api_test::TestStreamEvent>,
) -> api_test::ApiTestResult {
    api_test::test_accio_stream(url, api_key, model, on_event).await
}

#[tauri::command]
async fn fetch_codex_models(
    url: String,
    api_key: String,
) -> Result<Vec<model_fetch::FetchedModel>, String> {
    model_fetch::fetch_models(&url, &api_key).await
}

#[tauri::command]
async fn fetch_claude_models(
    url: String,
    api_key: String,
) -> Result<Vec<model_fetch::FetchedModel>, String> {
    model_fetch::fetch_models(&url, &api_key).await
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim().to_string();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Only http and https URLs are allowed".to_string());
    }
    tokio::task::spawn_blocking(move || opener::open(&trimmed).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_config_file(path: String) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("配置文件路径为空".to_string());
    }

    let expanded_path = if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            home.join(&trimmed[2..])
        } else {
            std::path::PathBuf::from(&trimmed)
        }
    } else if trimmed == "~" {
        dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(&trimmed))
    } else {
        std::path::PathBuf::from(&trimmed)
    };

    if !expanded_path.exists() {
        return Err(format!("配置文件不存在: {}", expanded_path.display()));
    }

    tokio::task::spawn_blocking(move || match opener::open(&expanded_path) {
        Ok(()) => Ok(()),
        Err(open_err) => {
            log::warn!(
                "opener::open 失败 ({:?})，尝试系统后备方案打开: {}",
                open_err,
                expanded_path.display()
            );

            #[cfg(target_os = "windows")]
            {
                if std::process::Command::new("notepad.exe")
                    .arg(&expanded_path)
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }
                if std::process::Command::new("explorer.exe")
                    .arg(format!("/select,{}", expanded_path.display()))
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }
            }

            #[cfg(target_os = "macos")]
            {
                if std::process::Command::new("open")
                    .arg("-t")
                    .arg(&expanded_path)
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }
            }

            #[cfg(target_os = "linux")]
            {
                if std::process::Command::new("xdg-open")
                    .arg(&expanded_path)
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }
            }

            Err(format!("无法打开配置文件: {}", open_err))
        }
    })
    .await
    .map_err(|e| format!("打开配置文件任务执行异常: {}", e))?
}

#[tauri::command]
async fn get_site_status() -> Result<auth::SiteStatus, String> {
    auth::get_site_status().await
}

#[tauri::command]
async fn get_encryption_key() -> Result<auth::EncryptionKeyData, String> {
    auth::get_encryption_key().await
}

#[tauri::command]
async fn generate_captcha() -> Result<auth::CaptchaGenerateData, String> {
    auth::generate_captcha().await
}

#[tauri::command]
async fn verify_captcha(captcha_id: String, x: i32, y: i32) -> Result<(), String> {
    auth::verify_captcha(captcha_id, x, y).await
}

#[tauri::command]
async fn login_account(payload: auth::LoginPayload) -> Result<auth::LoginResult, String> {
    auth::login(payload).await
}

#[tauri::command]
async fn login_2fa(flow_token: String, code: String) -> Result<auth::LoginSuccessData, String> {
    auth::login_2fa(flow_token, code).await
}

#[tauri::command]
async fn get_auth_state() -> auth::CurrentAuthState {
    auth::get_auth_state().await
}

#[tauri::command]
async fn refresh_auth_session() -> Result<auth::LoginSuccessData, String> {
    auth::refresh_session().await
}

#[tauri::command]
async fn logout_account() -> Result<(), String> {
    auth::logout().await
}

#[tauri::command]
async fn get_user_tokens() -> Result<Vec<auth::TokenItem>, String> {
    auth::get_user_tokens().await
}

#[tauri::command]
async fn get_token_key(token_id: i64) -> Result<String, String> {
    auth::get_token_key(token_id).await
}

#[tauri::command]
async fn create_user_token(name: String) -> Result<auth::TokenItem, String> {
    auth::create_user_token(name).await
}

#[tauri::command]
async fn set_selected_token(token_id: Option<i64>, token_name: Option<String>) {
    auth::set_selected_token(token_id, token_name).await
}

#[tauri::command]
async fn apply_api_key_to_agents(
    api_key: String,
    targets: Vec<String>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    auth::apply_api_key_to_agents(api_key, targets).await
}

#[tauri::command]
async fn get_channel_group_overview(
    hours: Option<u32>,
) -> Result<Vec<auth::ChannelGroupOverview>, String> {
    auth::get_channel_group_overview(hours).await
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_item = MenuItemBuilder::with_id("show", "显示 AI Helper 窗口").build(app)?;
    let hide_item = MenuItemBuilder::with_id("hide", "隐藏主窗口").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "彻底退出 AI Helper").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &hide_item, &sep1, &quit_item])
        .build()?;

    if let Some(icon) = app.default_window_icon().cloned() {
        let _tray = TrayIconBuilder::new()
            .icon(icon)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .tooltip("AI Helper - 客户端后台守护中")
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
            })
            .build(app)?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if let Err(e) = setup_tray(app) {
                log::warn!("初始化系统托盘失败: {}", e);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
                let _ = window.show();
                #[cfg(debug_assertions)]
                window.open_devtools();
            }

            // 启动时自动恢复 Bridge (若开启了 auto_start_bridge 且配置了 API Key)
            let accio_cfg = accio::config::load_accio_config();
            if accio_cfg.auto_start_bridge && !accio_cfg.api_key.trim().is_empty() {
                log::info!("正在自动拉起 Accio Work Bridge 网关...");
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = accio::start_bridge(Some(accio_cfg.bridge_port)).await {
                        log::error!("自启动 Accio Bridge 异常: {}", e);
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_codex_config,
            set_codex_config,
            get_claude_config,
            set_claude_config,
            get_workbuddy_config,
            set_workbuddy_config,
            delete_workbuddy_model,
            check_for_updates,
            download_and_install_update,
            check_bob_api_network,
            test_codex_config,
            test_claude_config,
            test_codex_stream,
            test_claude_stream,
            test_workbuddy_stream,
            get_accio_config,
            set_accio_config,
            start_accio_bridge,
            stop_accio_bridge,
            get_accio_bridge_status,
            test_accio_stream,
            fetch_codex_models,
            fetch_claude_models,
            open_url,
            open_config_file,
            get_app_paths,
            save_app_paths,
            detect_app_path,
            detect_all_app_paths,
            browse_app_path,
            check_app_process_status,
            restart_target_app,
            execute_in_terminal,
            get_site_status,
            get_encryption_key,
            generate_captcha,
            verify_captcha,
            login_account,
            login_2fa,
            get_auth_state,
            refresh_auth_session,
            logout_account,
            get_user_tokens,
            get_token_key,
            create_user_token,
            set_selected_token,
            apply_api_key_to_agents,
            get_channel_group_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ai-helper");
}

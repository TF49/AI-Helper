use tauri::Manager;

mod api_test;
mod app_paths;
mod claude;
mod codex;
mod error;
mod model_fetch;
mod network;
mod process_manager;
mod updater;

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
async fn check_for_updates() -> Result<updater::UpdateInfo, String> {
    updater::check_for_updates().await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let _ = window.maximize();
            window.show().unwrap();
            #[cfg(debug_assertions)]
            window.open_devtools();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_codex_config,
            set_codex_config,
            get_claude_config,
            set_claude_config,
            check_for_updates,
            check_bob_api_network,
            test_codex_config,
            test_claude_config,
            test_codex_stream,
            test_claude_stream,
            fetch_codex_models,
            fetch_claude_models,
            open_url,
            get_app_paths,
            save_app_paths,
            detect_app_path,
            detect_all_app_paths,
            browse_app_path,
            check_app_process_status,
            restart_target_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ai-helper");
}

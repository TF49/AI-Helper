use tauri::Manager;

mod api_test;
mod claude;
mod codex;
mod error;
mod model_fetch;
mod network;
mod updater;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running ai-helper");
}

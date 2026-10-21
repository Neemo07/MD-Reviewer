use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
struct AppState {
    root: Mutex<Option<PathBuf>>,
}

#[tauri::command]
fn get_root(state: State<AppState>) -> Option<String> {
    state.root.lock().unwrap().as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let folder = tauri_plugin_dialog::DialogExt::file(&app)
        .blocking_pick_folder();
    folder.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    let file = tauri_plugin_dialog::DialogExt::file(&app)
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();
    file.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn set_root(path: String, state: State<AppState>) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.exists() || !p.is_dir() {
        return Err("Path must exist and be a directory".to_string());
    }
    // Same security rule: only local directories
    *state.root.lock().unwrap() = Some(p.canonicalize().unwrap_or(p));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![get_root, pick_folder, pick_file, set_root])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

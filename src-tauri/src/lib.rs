mod persistence;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            persistence::read_project,
            persistence::resolve_source,
            persistence::write_project,
            persistence::read_export_source,
            persistence::read_source_pdf,
            persistence::write_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

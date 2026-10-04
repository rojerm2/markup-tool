mod persistence;
mod portable;
mod presets;
mod printing;
mod recent;
mod recovery;
mod reports;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(portable::EmbeddedSources::default())
        .manage(recent::RecentFiles::default())
        .manage(recovery::RecoveryWrites::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            reports::write_report_csv,
            presets::read_preset,
            presets::write_preset,
            printing::print_annotated_pdf,
            recent::list_recent_files,
            recent::remember_recent_file,
            recent::authorize_recent_file,
            recent::clear_recent_files,
            recovery::write_recovery,
            recovery::list_recovery,
            recovery::read_recovery,
            recovery::delete_recovery,
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

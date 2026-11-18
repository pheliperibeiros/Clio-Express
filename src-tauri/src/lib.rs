// Clio lib - expõe os comandos para o Tauri
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::clio_init_recording_session,
            commands::clio_write_recording_chunk,
            commands::clio_write_recording_chunk_raw,
            commands::clio_finalize_recording_session,
            commands::clio_delete_recovery_session,
            commands::clio_save_settings,
            commands::clio_load_settings,
            commands::clio_pick_folder,
            commands::clio_save_file_dialog,
            commands::clio_write_file,
            commands::clio_write_file_raw,
            commands::clio_sha256_file,
            commands::clio_rename_file,
            commands::clio_delete_file,
            commands::clio_open_path,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o Clio");
}

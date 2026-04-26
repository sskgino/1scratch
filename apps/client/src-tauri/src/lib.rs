mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_1scratch_secure_store::init())
        .plugin(commands::mobile_haptic::init_plugin())
        .plugin(commands::mobile_camera::init_plugin())
        .plugin(commands::mobile_status_bar::init_plugin())
        .invoke_handler(tauri::generate_handler![
            commands::mobile_haptic::mobile_haptic,
            commands::mobile_status_bar::mobile_status_bar,
            commands::mobile_network::mobile_network_probe,
            commands::mobile_camera::mobile_camera,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

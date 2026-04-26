// Android: wraps the Kotlin MobileStatusBarPlugin via Tauri's mobile plugin bridge.

#[cfg(target_os = "android")]
mod android {
    use tauri::{plugin::PluginHandle, Runtime};

    pub struct StatusBarPluginHandle<R: Runtime>(pub PluginHandle<R>);

    pub fn register<R: Runtime>(
        _app: &tauri::AppHandle<R>,
        api: tauri::plugin::PluginApi<R, ()>,
    ) -> Result<PluginHandle<R>, tauri::plugin::mobile::PluginInvokeError> {
        api.register_android_plugin("ai.scratch.app", "MobileStatusBarPlugin")
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn mobile_status_bar<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    theme: String,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app
        .try_state::<android::StatusBarPluginHandle<R>>()
        .ok_or_else(|| "MobileStatusBarPlugin not initialised".to_string())?;
    state
        .0
        .run_mobile_plugin::<()>("set", serde_json::json!({ "theme": theme }))
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn mobile_status_bar(theme: String) -> Result<(), String> {
    let _ = theme;
    Ok(())
}

#[cfg(target_os = "android")]
pub fn init_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::plugin::Builder;
    Builder::<R>::new("mobile-status-bar")
        .setup(|app, api| {
            let handle = android::register(app, api)?;
            app.manage(android::StatusBarPluginHandle(handle));
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
pub fn init_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("mobile-status-bar").build()
}

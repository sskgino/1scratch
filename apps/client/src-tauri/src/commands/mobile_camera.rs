// Android: wraps the Kotlin MobileCameraPlugin via Tauri's mobile plugin bridge.
// Returns a filesystem path to the captured JPEG; the JS side runs the
// EXIF-stripping pipeline before storing the resulting image card.

#[cfg(target_os = "android")]
mod android {
    use tauri::{plugin::PluginHandle, Runtime};

    pub struct CameraPluginHandle<R: Runtime>(pub PluginHandle<R>);

    pub fn register<R: Runtime>(
        _app: &tauri::AppHandle<R>,
        api: tauri::plugin::PluginApi<R, ()>,
    ) -> Result<PluginHandle<R>, tauri::plugin::mobile::PluginInvokeError> {
        api.register_android_plugin("ai.scratch.app", "MobileCameraPlugin")
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn mobile_camera<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    use tauri::Manager;
    let state = app
        .try_state::<android::CameraPluginHandle<R>>()
        .ok_or_else(|| "MobileCameraPlugin not initialised".to_string())?;
    let res: serde_json::Value = state
        .0
        .run_mobile_plugin("capture", serde_json::json!({}))
        .map_err(|e| e.to_string())?;
    res.get("path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "missing path".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn mobile_camera() -> Result<String, String> {
    Err("unsupported".into())
}

#[cfg(target_os = "android")]
pub fn init_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::plugin::Builder;
    use tauri::Manager;
    Builder::<R>::new("mobile-camera")
        .setup(|app, api| {
            let handle = android::register(app, api)?;
            app.manage(android::CameraPluginHandle(handle));
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
pub fn init_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("mobile-camera").build()
}

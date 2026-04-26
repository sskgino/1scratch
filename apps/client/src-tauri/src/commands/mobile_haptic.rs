// Android: wraps the Kotlin MobileHapticPlugin via Tauri's mobile plugin bridge.
// The plugin handle is registered once at startup (see lib.rs) and stored in
// managed state so that the command can retrieve it without needing a dedicated
// plugin crate.

#[cfg(target_os = "android")]
mod android {
    use tauri::{plugin::PluginHandle, Runtime};

    /// Managed state that holds the handle to the Kotlin MobileHapticPlugin.
    pub struct HapticPluginHandle<R: Runtime>(pub PluginHandle<R>);

    /// Called from lib.rs inside `.setup()` to register the Android plugin and
    /// store the handle.  The identifier must match the Kotlin package, and the
    /// class name must match the Kotlin class registered via
    /// `registerPlugin(MobileHapticPlugin::class.java)` in MainActivity.
    pub fn register<R: Runtime>(
        app: &tauri::AppHandle<R>,
        api: tauri::plugin::PluginApi<R, ()>,
    ) -> Result<PluginHandle<R>, tauri::plugin::mobile::PluginInvokeError> {
        api.register_android_plugin("ai.scratch.app", "MobileHapticPlugin")
    }
}

// ── Command ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn mobile_haptic<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    kind: String,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app
        .try_state::<android::HapticPluginHandle<R>>()
        .ok_or_else(|| "MobileHapticPlugin not initialised".to_string())?;
    state
        .0
        .run_mobile_plugin::<()>("trigger", serde_json::json!({ "kind": kind }))
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn mobile_haptic(kind: String) -> Result<(), String> {
    let _ = kind;
    Ok(())
}

// ── Plugin initialisation helper (Android only) ──────────────────────────────

/// Returns a `TauriPlugin` that registers the Kotlin MobileHapticPlugin and
/// stores the handle in managed state.  On non-Android targets this is a no-op
/// plugin so the call site in lib.rs stays uniform.
#[cfg(target_os = "android")]
pub fn init_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::plugin::Builder;
    Builder::<R>::new("mobile-haptic")
        .setup(|app, api| {
            let handle = android::register(app, api)?;
            app.manage(android::HapticPluginHandle(handle));
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
pub fn init_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("mobile-haptic").build()
}

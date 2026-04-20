use serde::{Deserialize, Serialize};
use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

#[cfg(mobile)] mod mobile;
#[cfg(desktop)] mod desktop;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Other(String),
}
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&self.to_string()) }
}

#[derive(Deserialize)]
struct GetArgs { key: String }
#[derive(Deserialize)]
struct SetArgs { key: String, value: String }
#[derive(Serialize)]
struct GetReturn { value: Option<String> }
#[derive(Serialize)]
struct HasReturn { value: bool }

#[tauri::command]
async fn get<R: Runtime>(_app: tauri::AppHandle<R>, args: GetArgs) -> Result<GetReturn, Error> {
    let value = {
        #[cfg(mobile)]    { mobile::get(&args.key).await.map_err(|e| Error::Other(e.to_string()))? }
        #[cfg(desktop)]   { desktop::get(&args.key).map_err(|e| Error::Other(e.to_string()))? }
    };
    Ok(GetReturn { value })
}

#[tauri::command]
async fn set<R: Runtime>(_app: tauri::AppHandle<R>, args: SetArgs) -> Result<(), Error> {
    #[cfg(mobile)]    { mobile::set(&args.key, &args.value).await.map_err(|e| Error::Other(e.to_string())) }
    #[cfg(desktop)]   { desktop::set(&args.key, &args.value).map_err(|e| Error::Other(e.to_string())) }
}

#[tauri::command]
async fn delete<R: Runtime>(_app: tauri::AppHandle<R>, args: GetArgs) -> Result<(), Error> {
    #[cfg(mobile)]    { mobile::delete(&args.key).await.map_err(|e| Error::Other(e.to_string())) }
    #[cfg(desktop)]   { desktop::delete(&args.key).map_err(|e| Error::Other(e.to_string())) }
}

#[tauri::command]
async fn has<R: Runtime>(_app: tauri::AppHandle<R>, args: GetArgs) -> Result<HasReturn, Error> {
    let v = {
        #[cfg(mobile)]    { mobile::has(&args.key).await.map_err(|e| Error::Other(e.to_string()))? }
        #[cfg(desktop)]   { desktop::has(&args.key).map_err(|e| Error::Other(e.to_string()))? }
    };
    Ok(HasReturn { value: v })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-store")
        .invoke_handler(tauri::generate_handler![get, set, delete, has])
        .setup(|app, _api| {
            let _ = app;
            #[cfg(target_os = "android")] {
                let _ = api.register_android_plugin("app.scratch.securestore", "SecureStorePlugin");
            }
            #[cfg(target_os = "ios")] {
                // Swift-side init function name produced by `tauri ios init` macros.
                extern "C" {
                    fn init_plugin_secure_store(webview: tauri::ipc::Channel<()>) -> *const std::ffi::c_void;
                }
                let _ = api.register_ios_plugin(init_plugin_secure_store);
            }
            Ok(())
        })
        .build()
}

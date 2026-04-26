use tauri::{AppHandle, Emitter, Runtime};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NetworkPayload {
    pub online: bool,
    pub r#type: String,
}

#[tauri::command]
pub async fn mobile_network_probe<R: Runtime>(app: AppHandle<R>) -> Result<NetworkPayload, String> {
    // Best-effort: emit current state so JS can subscribe + reconcile.
    let payload = NetworkPayload { online: true, r#type: "unknown".into() };
    app.emit("network-change", payload.clone()).map_err(|e| e.to_string())?;
    Ok(payload)
}

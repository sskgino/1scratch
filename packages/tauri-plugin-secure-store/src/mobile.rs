// Mobile dispatch is wired through Tauri's mobile plugin macros — the actual
// JNI / Objective-C bridging is generated. These helpers delegate to the
// installed plugin via the AppHandle. In Tauri 2.x mobile, the recommended
// pattern is `app.secure_store().get(...)`. We use a thin handle accessor.

use std::error::Error;

pub async fn get(_key: &str) -> Result<Option<String>, Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound — registered by app.handle()".into())
}
pub async fn set(_key: &str, _value: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound".into())
}
pub async fn delete(_key: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound".into())
}
pub async fn has(_key: &str) -> Result<bool, Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound".into())
}

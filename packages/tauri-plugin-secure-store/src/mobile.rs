use serde::{Deserialize, Serialize};
use tauri::{plugin::PluginHandle, AppHandle, Manager, Runtime};

pub struct SecureStoreHandle<R: Runtime>(pub PluginHandle<R>);

#[derive(Serialize)]
struct KeyArg<'a> { key: &'a str }
#[derive(Serialize)]
struct KeyValueArg<'a> { key: &'a str, value: &'a str }
#[derive(Deserialize)]
struct ValueResp { value: Option<String> }
#[derive(Deserialize)]
struct BoolResp { value: bool }

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("secure-store plugin handle not initialized")]
    NotInit,
    #[error("{0}")]
    Plugin(String),
}

fn handle<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, SecureStoreHandle<R>>, Error> {
    app.try_state::<SecureStoreHandle<R>>().ok_or(Error::NotInit)
}

pub async fn get<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>, Error> {
    let h = handle(app)?;
    let resp: ValueResp = h.0
        .run_mobile_plugin("get", KeyArg { key })
        .map_err(|e| Error::Plugin(e.to_string()))?;
    Ok(resp.value)
}

pub async fn set<R: Runtime>(app: &AppHandle<R>, key: &str, value: &str) -> Result<(), Error> {
    let h = handle(app)?;
    h.0.run_mobile_plugin::<()>("set", KeyValueArg { key, value })
        .map_err(|e| Error::Plugin(e.to_string()))?;
    Ok(())
}

pub async fn delete<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), Error> {
    let h = handle(app)?;
    h.0.run_mobile_plugin::<()>("delete", KeyArg { key })
        .map_err(|e| Error::Plugin(e.to_string()))?;
    Ok(())
}

pub async fn has<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<bool, Error> {
    let h = handle(app)?;
    let resp: BoolResp = h.0
        .run_mobile_plugin("has", KeyArg { key })
        .map_err(|e| Error::Plugin(e.to_string()))?;
    Ok(resp.value)
}

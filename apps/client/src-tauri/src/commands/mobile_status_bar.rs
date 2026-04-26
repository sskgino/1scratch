#[tauri::command]
pub async fn mobile_status_bar(theme: String) -> Result<(), String> {
    let _ = theme;
    Ok(())
}

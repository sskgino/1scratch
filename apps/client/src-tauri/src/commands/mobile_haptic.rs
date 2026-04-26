#[tauri::command]
pub async fn mobile_haptic(kind: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        // Kotlin plugin invocation goes through Tauri plugin bridge added in Task 1.16.
        // For now, accept the call and no-op; the Kotlin path lands in 1.16.
        let _ = kind;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = kind;
        Ok(())
    }
}

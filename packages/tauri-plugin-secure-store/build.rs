const COMMANDS: &[&str] = &["get", "set", "delete", "has"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}

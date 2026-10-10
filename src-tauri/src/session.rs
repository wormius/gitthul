//! Snapshot ligero de pestañas. TypeScript valida la forma; Rust persiste JSON atómicamente.

use serde_json::Value;
use tauri::AppHandle;

use crate::store;

const FILE_NAME: &str = "session.json";

#[tauri::command]
pub fn session_read(app: AppHandle) -> Result<Value, String> {
    store::read(&app, FILE_NAME)
}

#[tauri::command]
pub fn session_write(app: AppHandle, session: Value) -> Result<(), String> {
    store::write(&app, FILE_NAME, &session)
}

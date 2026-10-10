//! Biblioteca local. Lee `workspace.json` solo como migración y nunca lo borra.

use serde_json::Value;
use tauri::AppHandle;

use crate::store;

const FILE_NAME: &str = "library.json";
const LEGACY_FILE_NAME: &str = "workspace.json";

#[tauri::command]
pub fn library_read(app: AppHandle) -> Result<Value, String> {
    let current = store::read(&app, FILE_NAME)?;
    if current.as_object().is_some_and(|object| !object.is_empty()) {
        return Ok(current);
    }
    store::read(&app, LEGACY_FILE_NAME)
}

#[tauri::command]
pub fn library_write(app: AppHandle, library: Value) -> Result<(), String> {
    store::write(&app, FILE_NAME, &library)
}

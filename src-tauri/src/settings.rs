//! Los ajustes de la aplicación, en un archivo de la carpeta de configuración.
//!
//! La persistencia general pertenece a `store`. Aquí también se valida la política
//! de recuperación y se conserva la configuración dañada antes de repararla.

use serde_json::Value;
use std::{fs, io::Write, path::Path};
use tauri::{AppHandle, Manager};

use crate::store;

const FILE_NAME: &str = "settings.json";

#[tauri::command]
pub fn settings_read(app: AppHandle) -> Result<Value, String> {
    Ok(with_backup_suspension(with_recovery_suspension(
        store::read(&app, FILE_NAME)?,
        crate::git::recovery::configuration_warning(),
    )))
}

/// Reflect the native safe fallback instead of showing automatic backups enabled
/// when malformed preferences made the worker suspend them. Keep other fields
/// and the original file unchanged until the user saves valid preferences.
fn with_backup_suspension(mut settings: Value) -> Value {
    if crate::git::backup::policy_from_settings(&settings).is_ok() {
        return settings;
    }
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    let backup = settings
        .as_object_mut()
        .unwrap()
        .entry("backup")
        .or_insert_with(|| serde_json::json!({}));
    if !backup.is_object() {
        *backup = serde_json::json!({});
    }
    backup["enabled"] = Value::Bool(false);
    settings
}

fn with_recovery_suspension(mut settings: Value, suspended: bool) -> Value {
    if suspended {
        if let Some(settings) = settings.as_object_mut() {
            let recovery = settings
                .entry("recovery")
                .or_insert_with(|| serde_json::json!({}));
            if !recovery.is_object() {
                *recovery = serde_json::json!({});
            }
            recovery["autoCleanup"] = Value::Bool(false);
        }
    }
    settings
}

#[tauri::command]
pub fn settings_write(app: AppHandle, settings: Value) -> Result<(), String> {
    let recovery_policy = crate::git::recovery::policy_from_settings(&settings)?;
    let backup_policy = crate::git::backup::policy_from_settings(&settings)?;
    preserve_invalid_settings(&store::file_path(&app, FILE_NAME)?)?;
    store::write(&app, FILE_NAME, &settings)?;
    crate::git::recovery::update_policy(recovery_policy)?;
    app.state::<crate::git::backup::BackupManager>()
        .update_policy(backup_policy);
    crate::logging::set_debug_enabled(
        settings
            .pointer("/logging/debugEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    );
    Ok(())
}

/// Keep the original bytes before repairing unreadable or invalid preferences.
/// A settings change may reconstruct defaults; that must not discard the only
/// copy of a damaged file containing other user preferences.
fn preserve_invalid_settings(path: &Path) -> Result<(), String> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "No se pudo leer la configuración anterior: {error}"
            ))
        }
    };
    if serde_json::from_slice::<Value>(&contents)
        .ok()
        .is_some_and(|settings| {
            crate::git::recovery::policy_from_settings(&settings).is_ok()
                && crate::git::backup::policy_from_settings(&settings).is_ok()
        })
    {
        return Ok(());
    }
    let mut backup = tempfile::Builder::new()
        .prefix("settings-rejected-")
        .suffix(".json")
        .tempfile_in(
            path.parent()
                .ok_or("No se pudo localizar la configuración anterior")?,
        )
        .map_err(|error| format!("No se pudo respaldar la configuración anterior: {error}"))?;
    backup
        .write_all(&contents)
        .and_then(|()| backup.as_file().sync_all())
        .map_err(|error| format!("No se pudo guardar el respaldo de configuración: {error}"))?;
    backup
        .keep()
        .map_err(|error| format!("No se pudo conservar el respaldo de configuración: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairing_invalid_settings_preserves_exact_original_bytes() {
        for original in [
            b"{broken JSON".as_slice(),
            br#"{"recovery":{"maxCheckpoints":0},"locale":"fr"}"#.as_slice(),
            br#"{"backup":{"maxMiB":0},"locale":"fr"}"#.as_slice(),
        ] {
            let temporary = tempfile::tempdir().unwrap();
            let path = temporary.path().join(FILE_NAME);
            fs::write(&path, original).unwrap();
            preserve_invalid_settings(&path).unwrap();
            let entries: Vec<_> = fs::read_dir(temporary.path())
                .unwrap()
                .map(Result::unwrap)
                .filter(|entry| entry.path() != path)
                .collect();
            assert_eq!(entries.len(), 1);
            assert_eq!(fs::read(entries[0].path()).unwrap(), original);
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }

    #[test]
    fn valid_or_missing_settings_do_not_create_repair_backups() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(FILE_NAME);
        preserve_invalid_settings(&path).unwrap();
        fs::write(
            &path,
            br#"{"recovery":{"autoCleanup":false},"locale":"fr"}"#,
        )
        .unwrap();
        preserve_invalid_settings(&path).unwrap();
        assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_backup_preferences_show_the_native_suspended_state() {
        let settings = serde_json::json!({"locale":"fr", "backup":{"enabled":true,"maxMiB":0}});
        let projected = with_backup_suspension(settings);
        assert_eq!(projected["locale"], "fr");
        assert_eq!(projected["backup"]["enabled"], false);
        assert_eq!(projected["backup"]["maxMiB"], 0);
        assert_eq!(
            with_backup_suspension(serde_json::json!({})),
            serde_json::json!({})
        );
        assert_eq!(
            with_backup_suspension(serde_json::json!({"backup":null}))["backup"]["enabled"],
            false
        );
    }

    #[test]
    fn suspended_cleanup_is_projected_without_discarding_other_preferences() {
        let settings = serde_json::json!({ "locale": "fr", "recovery": {
            "autoCleanup": true, "maxCheckpoints": 0
        } });
        let projected = with_recovery_suspension(settings.clone(), true);
        assert_eq!(projected["locale"], "fr");
        assert_eq!(projected["recovery"]["autoCleanup"], false);
        assert_eq!(projected["recovery"]["maxCheckpoints"], 0);
        assert_eq!(with_recovery_suspension(settings.clone(), false), settings);
        assert_eq!(
            with_recovery_suspension(serde_json::json!({ "recovery": null }), true)["recovery"]
                ["autoCleanup"],
            false
        );
    }
}

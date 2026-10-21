//! Los ajustes de la aplicación, en un archivo de la carpeta de configuración.
//!
//! La persistencia general pertenece a `store`. Aquí también se valida la política
//! de recuperación y se conserva la configuración dañada antes de repararla.

use serde_json::Value;
use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

use crate::store;

const FILE_NAME: &str = "settings.json";
// A confirmed backup limit may wait for the worker and verify stored content.
// Keep settings writers in order without holding up the WebView thread.
static SETTINGS_WRITE: Mutex<()> = Mutex::new(());

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
pub async fn settings_write(
    app: AppHandle,
    settings: Value,
    backup_limit_token: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _write = SETTINGS_WRITE
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        write_settings(&app, settings, backup_limit_token.as_deref())
    })
    .await
    .map_err(|_| "No se pudo completar el guardado de configuraciones".to_owned())?
}

fn write_settings(
    app: &AppHandle,
    settings: Value,
    backup_limit_token: Option<&str>,
) -> Result<(), String> {
    let recovery_policy = crate::git::recovery::prepare_policy(
        crate::git::recovery::policy_from_settings(&settings)?,
    )?;
    let backup_policy = crate::git::backup::policy_from_settings(&settings)?;
    let path = store::file_path(app, FILE_NAME)?;
    let previous = SettingsFileSnapshot::read(&path)?;
    let mut persisted = false;
    app.state::<crate::git::backup::BackupManager>()
        .change_policy(backup_policy, backup_limit_token, |_policy| {
            if persisted {
                return previous.restore(&path);
            }
            preserve_invalid_settings(&path)?;
            store::write(app, FILE_NAME, &settings)?;
            persisted = true;
            Ok(())
        })
        .map_err(|error| {
            serde_json::to_string(&error)
                .unwrap_or_else(|_| "No se pudo aplicar el límite de respaldos".to_owned())
        })?;
    crate::git::recovery::apply_policy(recovery_policy);
    crate::logging::set_debug_enabled(
        settings
            .pointer("/logging/debugEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    );
    Ok(())
}

/// A failed cleanup must restore the complete settings file, including its
/// absence or original formatting. Invalid originals are also kept by the
/// normal repair path before the candidate is written.
struct SettingsFileSnapshot(Option<Vec<u8>>);

impl SettingsFileSnapshot {
    fn read(path: &Path) -> Result<Self, String> {
        match fs::read(path) {
            Ok(bytes) => Ok(Self(Some(bytes))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self(None)),
            Err(error) => Err(format!(
                "No se pudo leer la configuración anterior: {error}"
            )),
        }
    }

    fn restore(&self, path: &Path) -> Result<(), String> {
        let Some(bytes) = &self.0 else {
            return match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!(
                    "No se pudo restaurar la configuración anterior: {error}"
                )),
            };
        };
        let parent = path
            .parent()
            .ok_or("No se pudo localizar la configuración anterior")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| format!("No se pudo preparar la configuración anterior: {error}"))?;
        temporary
            .write_all(bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|error| format!("No se pudo restaurar la configuración anterior: {error}"))?;
        temporary
            .persist(path)
            .map_err(|error| format!("No se pudo restaurar la configuración anterior: {error}"))?;
        Ok(())
    }
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
    fn rejected_backup_limit_restores_the_complete_original_settings_file() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(FILE_NAME);
        for original in [
            b"{\"locale\": \"fr\", \"backup\":{\"maxMiB\":2048}}\n".as_slice(),
            b"{unreadable original".as_slice(),
        ] {
            fs::write(&path, original).unwrap();
            let previous = SettingsFileSnapshot::read(&path).unwrap();
            fs::write(&path, br#"{"locale":"en","backup":{"maxMiB":512}}"#).unwrap();
            previous.restore(&path).unwrap();
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }

    #[test]
    fn rejected_backup_limit_restores_absent_settings() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join(FILE_NAME);
        let previous = SettingsFileSnapshot::read(&path).unwrap();
        fs::write(&path, br#"{"backup":{"maxMiB":512}}"#).unwrap();
        previous.restore(&path).unwrap();
        assert!(!path.exists());
        previous.restore(&path).unwrap();
    }

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

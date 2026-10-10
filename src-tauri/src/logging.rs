//! Corriente persistente de `LogPort` para el visor integrado.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::DialogExt;
static LOG_LOCK: Mutex<()> = Mutex::new(());

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

static NATIVE_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static NATIVE_SESSION: OnceLock<String> = OnceLock::new();
static GIT_VERSION: OnceLock<String> = OnceLock::new();
static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

const FILE_NAME: &str = "gitthul.log";
const ROTATED_FILE_NAME: &str = "gitthul.log.1";
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_READ_ENTRIES: usize = 4000;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    id: u64,
    at: u64,
    level: String,
    scope: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schema_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    platform: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    git_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    debug_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context: Option<serde_json::Value>,
}

fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|error| format!("no se pudo resolver la carpeta de registros: {error}"))
}

fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(directory(app)?.join(FILE_NAME))
}

fn valid(entry: &LogEntry) -> bool {
    matches!(entry.level.as_str(), "debug" | "info" | "warn" | "error")
        && !entry.scope.is_empty()
        && entry.scope.len() <= 128
        && entry.message.len() <= 16_384
        && entry
            .session_id
            .as_ref()
            .is_none_or(|value| value.len() <= 128)
        && entry
            .app_version
            .as_ref()
            .is_none_or(|value| value.len() <= 128)
        && entry
            .platform
            .as_ref()
            .is_none_or(|value| value.len() <= 1024)
        && entry
            .git_version
            .as_ref()
            .is_none_or(|value| value.len() <= 128)
        && entry
            .origin
            .as_ref()
            .is_none_or(|value| matches!(value.as_str(), "frontend" | "backend"))
        && entry
            .context
            .as_ref()
            .is_none_or(|value| value.is_object() && value.to_string().len() <= 65_536)
        && entry
            .detail
            .as_ref()
            .is_none_or(|detail| detail.len() <= 65_536)
}

fn rotate(path: &std::path::Path) -> Result<(), String> {
    if path.metadata().map_or(0, |metadata| metadata.len()) < MAX_FILE_BYTES {
        return Ok(());
    }
    let rotated = path.with_file_name(ROTATED_FILE_NAME);
    if rotated.exists() {
        fs::remove_file(&rotated)
            .map_err(|error| format!("no se pudo retirar el registro rotado: {error}"))?;
    }
    fs::rename(path, rotated).map_err(|error| format!("no se pudo rotar el registro: {error}"))
}

#[tauri::command]
pub fn log_append(app: AppHandle, entry: LogEntry) -> Result<(), String> {
    if !valid(&entry) {
        return Err("la entrada de registro no es válida".to_owned());
    }
    if entry.level == "debug" && !DEBUG_ENABLED.load(Ordering::Relaxed) {
        return Ok(());
    }
    append_at(&file_path(&app)?, &entry)
}

fn append_at(path: &std::path::Path, entry: &LogEntry) -> Result<(), String> {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    append_unlocked(path, entry)
}

fn append_unlocked(path: &std::path::Path, entry: &LogEntry) -> Result<(), String> {
    let parent = path.parent().ok_or("el registro no tiene carpeta")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("no se pudo crear la carpeta de registros: {error}"))?;
    rotate(path)?;
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("no se pudo abrir el registro: {error}"))?;
    serde_json::to_writer(&mut file, &entry)
        .map_err(|error| format!("no se pudo serializar el registro: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("no se pudo escribir el registro: {error}"))
}

fn read_retained(directory: &std::path::Path) -> Result<Vec<LogEntry>, String> {
    let mut entries = Vec::new();
    for name in [ROTATED_FILE_NAME, FILE_NAME] {
        let file = match fs::File::open(directory.join(name)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("no se pudo abrir el registro: {error}")),
        };
        for line in BufReader::new(file).lines() {
            let line = line.map_err(|error| format!("no se pudo leer el registro: {error}"))?;
            if let Ok(entry) = serde_json::from_str::<LogEntry>(&line) {
                if valid(&entry) {
                    entries.push(entry);
                }
            }
        }
    }
    entries.sort_by_key(|entry| (entry.at, entry.id));
    Ok(entries)
}

#[tauri::command]
pub fn log_read(app: AppHandle) -> Result<Vec<LogEntry>, String> {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut entries = read_retained(&directory(&app)?)?;
    if entries.len() > MAX_READ_ENTRIES {
        entries.drain(..entries.len() - MAX_READ_ENTRIES);
    }
    Ok(entries)
}

#[tauri::command]
pub async fn log_export(app: AppHandle, errors_only: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entries = {
            let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
            read_retained(&directory(&app)?)?
        };
        let selected = app
            .dialog()
            .file()
            .set_file_name(if errors_only {
                "gitthul-incidents.jsonl"
            } else {
                "gitthul-logs.jsonl"
            })
            .add_filter("JSON Lines", &["jsonl"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|error| error.to_string())?;
        // Never overwrite the live journal, including through a symlink.
        let log_dir = directory(&app)?;
        let resolved = path.canonicalize().unwrap_or_else(|_| path.clone());
        if [FILE_NAME, ROTATED_FILE_NAME].iter().any(|name| {
            let source = log_dir.join(name);
            resolved == source.canonicalize().unwrap_or(source)
        }) {
            return Err("Elige un archivo distinto del registro activo".to_owned());
        }
        let output = encode_export(&entries, errors_only)?;
        fs::write(path, output).map_err(|error| format!("no se pudo exportar: {error}"))?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn encode_export(entries: &[LogEntry], incidents_only: bool) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    for entry in entries
        .iter()
        .filter(|entry| !incidents_only || matches!(entry.level.as_str(), "warn" | "error"))
    {
        serde_json::to_writer(&mut output, entry).map_err(|error| error.to_string())?;
        output.push(b'\n');
    }
    Ok(output)
}

#[tauri::command]
pub fn log_clear(app: AppHandle) -> Result<(), String> {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let directory = directory(&app)?;
    for name in [FILE_NAME, ROTATED_FILE_NAME] {
        match fs::remove_file(directory.join(name)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(format!("no se pudo vaciar el registro: {error}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn log_open_directory(app: AppHandle) -> Result<(), String> {
    let directory = directory(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("no se pudo crear la carpeta de registros: {error}"))?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("no se pudo abrir la carpeta de registros: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_source_includes_all_retained_entries_and_sorts_both_files() {
        let directory = tempfile::tempdir().unwrap();
        let make = |id| LogEntry {
            id,
            at: id,
            level: "error".into(),
            scope: "git.write".into(),
            message: "failure".into(),
            detail: None,
            ..LogEntry::default()
        };
        let mut older = Vec::new();
        for id in 0..4100 {
            serde_json::to_writer(&mut older, &make(id)).unwrap();
            older.push(b'\n');
        }
        fs::write(directory.path().join(ROTATED_FILE_NAME), older).unwrap();
        fs::write(
            directory.path().join(FILE_NAME),
            format!("{}\ntruncated", serde_json::to_string(&make(4100)).unwrap()),
        )
        .unwrap();
        let entries = read_retained(directory.path()).unwrap();
        assert_eq!(entries.len(), 4101);
        assert_eq!(entries.first().unwrap().id, 0);
        assert_eq!(entries.last().unwrap().id, 4100);
    }

    #[test]
    fn new_metadata_survives_disk_and_legacy_records_remain_readable() {
        let directory = tempfile::tempdir().unwrap();
        let old = r#"{"id":1,"at":1,"level":"error","scope":"git.write","message":"legacy"}"#;
        fs::write(directory.path().join(FILE_NAME), format!("{old}\n")).unwrap();
        let entry = LogEntry {
            id: 2,
            at: 2,
            level: "warn".into(),
            scope: "git.write".into(),
            message: "conflict".into(),
            schema_version: Some(2),
            session_id: Some("session".into()),
            git_version: Some("git version 2.50".into()),
            context: Some(
                serde_json::json!({ "operationId": "op", "errorCode": "merge.conflict", "durationMs": 14 }),
            ),
            ..LogEntry::default()
        };
        append_at(&directory.path().join(FILE_NAME), &entry).unwrap();
        let retained = read_retained(directory.path()).unwrap();
        assert_eq!(retained.len(), 2);
        assert_eq!(retained[0].schema_version, None);
        assert_eq!(retained[1].context, entry.context);
        assert_eq!(retained[1].git_version, entry.git_version);
    }

    #[test]
    fn concurrent_writes_leave_complete_json_lines() {
        let directory = tempfile::tempdir().unwrap();
        std::thread::scope(|scope| {
            for id in 0..30 {
                let path = directory.path().join(FILE_NAME);
                scope.spawn(move || {
                    append_at(
                        &path,
                        &LogEntry {
                            id,
                            at: id,
                            level: "info".into(),
                            scope: "app".into(),
                            message: "event".into(),
                            ..LogEntry::default()
                        },
                    )
                    .unwrap()
                });
            }
        });
        assert_eq!(read_retained(directory.path()).unwrap().len(), 30);
    }

    #[test]
    fn rejects_oversized_diagnostic_context() {
        let entry = LogEntry {
            level: "error".into(),
            scope: "app".into(),
            context: Some(serde_json::json!({ "request": "x".repeat(70_000) })),
            ..LogEntry::default()
        };
        assert!(!valid(&entry));
    }

    #[test]
    fn incident_export_keeps_warnings_errors_and_their_self_contained_context() {
        let entries = ["debug", "info", "warn", "error"].map(|level| LogEntry {
            level: level.into(),
            scope: "git.write".into(),
            message: "event".into(),
            session_id: Some("session".into()),
            context: Some(serde_json::json!({ "repository": "/repo", "operationId": "op" })),
            ..LogEntry::default()
        });
        let selected = String::from_utf8(encode_export(&entries, true).unwrap()).unwrap();
        let lines: Vec<LogEntry> = selected
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(
            lines
                .iter()
                .map(|entry| entry.level.as_str())
                .collect::<Vec<_>>(),
            ["warn", "error"]
        );
        assert_eq!(lines[0].context, entries[2].context);
        assert_eq!(lines[1].session_id.as_deref(), Some("session"));
        assert_eq!(
            String::from_utf8(encode_export(&entries, false).unwrap())
                .unwrap()
                .lines()
                .count(),
            4
        );
    }
}

pub fn set_debug_enabled(enabled: bool) {
    DEBUG_ENABLED.store(enabled, Ordering::Relaxed);
}

/// Native background failures cannot rely on a live WebView to reach the journal.
/// Accept only fixed messages and non-sensitive technical evidence, never PTY bytes or secrets.
pub fn native(level: &str, scope: &str, message: &str, detail: Option<String>) {
    native_with_context(level, scope, message, detail, None);
}

pub fn native_with_context(
    level: &str,
    scope: &str,
    message: &str,
    detail: Option<String>,
    context: Option<serde_json::Value>,
) {
    if level == "debug" && !DEBUG_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let Some(directory) = NATIVE_DIRECTORY.get() else {
        return;
    };
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let entry = LogEntry {
        id: at * 1000 + SEQUENCE.fetch_add(1, Ordering::Relaxed) % 1000,
        at,
        level: level.into(),
        scope: scope.into(),
        message: message.into(),
        detail,
        schema_version: Some(2),
        session_id: NATIVE_SESSION.get().cloned(),
        app_version: Some(env!("CARGO_PKG_VERSION").into()),
        platform: Some(format!(
            "{} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )),
        git_version: GIT_VERSION.get().cloned(),
        origin: Some("backend".into()),
        debug_enabled: Some(DEBUG_ENABLED.load(Ordering::Relaxed)),
        context,
    };
    // Failure to log must not turn a background failure into another panic.
    if std::thread::panicking() {
        // The panic may have occurred while the journal mutex was held.
        if let Ok(_guard) = LOG_LOCK.try_lock() {
            let _ = append_unlocked(&directory.join(FILE_NAME), &entry);
        }
    } else {
        let _ = append_at(&directory.join(FILE_NAME), &entry);
    }
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let _ = NATIVE_DIRECTORY.set(directory(app)?);
    let _ = NATIVE_SESSION.set(format!(
        "native-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let version = std::process::Command::new("git").arg("--version").output();
    let _ = GIT_VERSION.set(
        version
            .ok()
            .filter(|output| output.status.success())
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .chars()
                    .take(128)
                    .collect()
            })
            .unwrap_or_else(|| "unavailable".into()),
    );
    if let Ok(settings) = crate::store::read(app, "settings.json") {
        set_debug_enabled(
            settings
                .pointer("/logging/debugEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        );
    }
    native("info", "app.native", "Backend de GitThul iniciado", None);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Panic payloads can contain user data. Source location and backtrace are sufficient evidence.
        let evidence = format!(
            "location={}\n{}",
            info.location().map(|v| v.to_string()).unwrap_or_default(),
            std::backtrace::Backtrace::force_capture()
        );
        let mut end = evidence.len().min(15000);
        while !evidence.is_char_boundary(end) {
            end -= 1;
        }
        native(
            "error",
            "runtime.native",
            "Pánico en el backend; una operación puede haber quedado incompleta",
            Some(evidence[..end].into()),
        );
        previous(info);
    }));
    Ok(())
}

#[tauri::command]
pub fn log_environment() -> serde_json::Value {
    serde_json::json!({
        "sessionId": NATIVE_SESSION.get(),
        "platform": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "gitVersion": GIT_VERSION.get(),
        "appVersion": env!("CARGO_PKG_VERSION"),
    })
}

//! Corriente persistente de `LogPort` para el visor integrado.

use std::collections::{BTreeMap, BTreeSet};
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
static ENVIRONMENT: OnceLock<serde_json::Value> = OnceLock::new();
static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

const FILE_NAME: &str = "gitthul.log";
const ROTATED_FILE_NAME: &str = "gitthul.log.1";
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_READ_ENTRIES: usize = 4000;

fn sanitized(mut entry: LogEntry) -> LogEntry {
    entry.scope = crate::log_privacy::bounded(&entry.scope, 128);
    entry.message = crate::log_privacy::bounded(&entry.message, 4000);
    entry.detail = entry
        .detail
        .map(|detail| crate::log_privacy::bounded(&detail, 16000));
    if let Some(context) = &mut entry.context {
        crate::log_privacy::value(context);
    }
    for value in [
        &mut entry.session_id,
        &mut entry.app_version,
        &mut entry.git_version,
        &mut entry.platform,
    ]
    .into_iter()
    .flatten()
    {
        *value = crate::log_privacy::bounded(value, 1024);
    }
    entry
}

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
    let entry = sanitized(entry.clone());
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
    let mut unreadable = 0usize;
    for name in [ROTATED_FILE_NAME, FILE_NAME] {
        let file = match fs::File::open(directory.join(name)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("no se pudo abrir el registro: {error}")),
        };
        for line in BufReader::new(file).lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                    unreadable += 1;
                    continue;
                }
                Err(error) => return Err(format!("no se pudo leer el registro: {error}")),
            };
            if let Ok(entry) = serde_json::from_str::<LogEntry>(&line) {
                if valid(&entry) {
                    entries.push(sanitized(entry));
                } else {
                    unreadable += 1;
                }
            } else if !line.trim().is_empty() {
                unreadable += 1;
            }
        }
    }
    if unreadable > 0 {
        let at = entries
            .iter()
            .map(|entry| entry.at)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        entries.push(LogEntry {
            id: at.saturating_mul(1000),
            at,
            level: "warn".into(),
            scope: "logging".into(),
            message: "El registro contiene entradas ilegibles; el diagnóstico está incompleto"
                .into(),
            schema_version: Some(3),
            origin: Some("backend".into()),
            context: Some(serde_json::json!({ "report": { "unreadableEntries": unreadable } })),
            ..LogEntry::default()
        });
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
    let entries = entries.iter().cloned().map(sanitized).collect::<Vec<_>>();
    let selected = entries
        .iter()
        .filter(|entry| !incidents_only || matches!(entry.level.as_str(), "warn" | "error"))
        .collect::<Vec<_>>();
    let summary = export_summary(&entries, &selected, incidents_only);
    serde_json::to_writer(&mut output, &summary).map_err(|error| error.to_string())?;
    output.push(b'\n');
    for entry in selected {
        serde_json::to_writer(&mut output, &sanitized(entry.clone()))
            .map_err(|error| error.to_string())?;
        output.push(b'\n');
    }
    Ok(output)
}

fn export_summary(entries: &[LogEntry], selected: &[&LogEntry], incidents_only: bool) -> LogEntry {
    let mut levels = BTreeMap::<String, usize>::new();
    let mut sessions = BTreeSet::new();
    let mut incidents = BTreeMap::<String, serde_json::Value>::new();
    let mut omitted = BTreeSet::new();
    for entry in entries {
        *levels.entry(entry.level.clone()).or_default() += 1;
        if let Some(session) = &entry.session_id {
            sessions.insert(session.clone());
        }
        if !matches!(entry.level.as_str(), "warn" | "error") {
            continue;
        }
        let context = entry.context.as_ref();
        let method = context
            .and_then(|v| v.get("method"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let code = context
            .and_then(|v| v.get("errorCode"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let repo = context
            .and_then(|v| v.get("repository"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let stage = context
            .and_then(|v| v.pointer("/error/diagnostic/stage"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let diagnostic = context.and_then(|v| v.pointer("/error/diagnostic"));
        let causes = diagnostic
            .and_then(|v| v.get("causes"))
            .filter(|v| !v.as_array().is_some_and(Vec::is_empty))
            .map(|v| v.to_string());
        let evidence = diagnostic
            .and_then(|v| v.get("stderr"))
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .or(causes.as_deref())
            .unwrap_or(entry.detail.as_deref().unwrap_or(""));
        let exit_code = diagnostic.and_then(|v| v.get("exitCode"));
        let signal = diagnostic.and_then(|v| v.get("signal"));
        // Include evidence so different failures never become a misleading single incident.
        let key = serde_json::json!([
            entry.scope,
            method,
            code,
            repo,
            stage,
            exit_code,
            signal,
            evidence
        ])
        .to_string();
        if let Some(found) = incidents.get_mut(&key) {
            found["count"] = serde_json::json!(found["count"].as_u64().unwrap_or(1) + 1);
            found["firstAt"] =
                serde_json::json!(found["firstAt"].as_u64().unwrap_or(entry.at).min(entry.at));
            found["lastAt"] =
                serde_json::json!(found["lastAt"].as_u64().unwrap_or(entry.at).max(entry.at));
        } else if incidents.len() < 50 {
            incidents.insert(key, serde_json::json!({"scope": entry.scope, "method": method, "errorCode": code,
                "repository": repo, "stage": stage, "exitCode": exit_code, "signal": signal,
                "evidence": crate::log_privacy::bounded(evidence, 2000), "sampleMessage": crate::log_privacy::bounded(&entry.message, 1000),
                "sampleOperationId": context.and_then(|v| v.get("operationId")),
                "sampleNativeOperationId": context.and_then(|v| v.get("nativeOperationId")),
                "count": 1, "firstAt": entry.at, "lastAt": entry.at }));
        } else {
            omitted.insert(key);
        }
    }
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut metadata = serde_json::json!({ "format": "GitThul JSONL diagnostic report", "schemaVersion": 3,
        "mode": if incidents_only { "incidents" } else { "all" }, "entriesRetained": entries.len(),
        "entriesExported": selected.len(), "sessionCount": sessions.len(), "levels": levels,
        "firstAt": entries.iter().map(|v| v.at).min(), "lastAt": entries.iter().map(|v| v.at).max(),
        "incidentGroups": incidents.values().collect::<Vec<_>>(), "incidentGroupLimit": 50,
        "incidentGroupsOmittedCount": omitted.len(),
        "retention": { "rotationBytes": MAX_FILE_BYTES, "rotations": 1 },
        "scope": "Only retained entries are available; normal mode omits routine successes." });
    crate::log_privacy::value(&mut metadata);
    LogEntry {
        id: 0,
        at,
        level: "info".into(),
        scope: "diagnostic.report".into(),
        message: "Resumen del reporte de diagnóstico".into(),
        schema_version: Some(3),
        app_version: Some(env!("CARGO_PKG_VERSION").into()),
        platform: Some(format!(
            "{} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )),
        git_version: GIT_VERSION.get().cloned(),
        session_id: NATIVE_SESSION.get().cloned(),
        origin: Some("backend".into()),
        context: Some(serde_json::json!({ "report": metadata, "environment": ENVIRONMENT.get() })),
        ..LogEntry::default()
    }
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
        assert_eq!(entries.len(), 4102);
        assert_eq!(entries.first().unwrap().id, 0);
        assert_eq!(entries[4100].id, 4100);
        assert_eq!(
            entries[4101]
                .context
                .as_ref()
                .unwrap()
                .pointer("/report/unreadableEntries"),
            Some(&serde_json::json!(1))
        );
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
            ["info", "warn", "error"]
        );
        assert_eq!(lines[0].scope, "diagnostic.report");
        assert_eq!(
            lines[0]
                .context
                .as_ref()
                .unwrap()
                .pointer("/report/entriesExported"),
            Some(&serde_json::json!(2))
        );
        assert_eq!(lines[1].context, entries[2].context);
        assert_eq!(lines[2].session_id.as_deref(), Some("session"));
        assert_eq!(
            String::from_utf8(encode_export(&entries, false).unwrap())
                .unwrap()
                .lines()
                .count(),
            5
        );
    }

    #[test]
    fn append_and_legacy_export_redact_nested_credentials_and_preserve_failure_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let mut entry = LogEntry {
            id: 1,
            at: 10,
            level: "error".into(),
            scope: "git.read".into(),
            message: "read refs failed".into(),
            session_id: Some("s".into()),
            detail: Some("https://user:password@example.invalid/r?token=secret".into()),
            context: Some(
                serde_json::json!({"operationId":"op1", "method":"readRefs", "errorCode":"unknown", "repository":"/repo",
                "error":{"diagnostic":{"stage":"refs.command", "exitCode":128, "stderr":"fatal: bad object", "password":"private words"}}}),
            ),
            ..LogEntry::default()
        };
        append_at(&directory.path().join(FILE_NAME), &entry).unwrap();
        let raw = fs::read_to_string(directory.path().join(FILE_NAME)).unwrap();
        for secret in ["user:password", "token=secret", "private words"] {
            assert!(!raw.contains(secret));
        }
        entry.id = 2;
        entry.at = 20;
        entry.context.as_mut().unwrap()["operationId"] = serde_json::json!("op2");
        let report =
            String::from_utf8(encode_export(&[entry.clone(), entry], true).unwrap()).unwrap();
        for secret in ["user:password", "token=secret", "private words"] {
            assert!(!report.contains(secret));
        }
        let header: LogEntry = serde_json::from_str(report.lines().next().unwrap()).unwrap();
        let group = header.context.unwrap()["report"]["incidentGroups"][0].clone();
        assert_eq!(group["count"], 2);
        assert_eq!(group["stage"], "refs.command");
        assert_eq!(group["exitCode"], 128);
        assert_eq!(group["evidence"], "fatal: bad object");
        assert_eq!(report.lines().count(), 3);
    }

    #[test]
    fn runtime_environment_uses_only_support_metadata() {
        let environment = runtime_environment();
        assert_eq!(environment["os"], std::env::consts::OS);
        assert_eq!(environment["architecture"], std::env::consts::ARCH);
        for key in environment.as_object().unwrap().keys() {
            assert!([
                "os",
                "architecture",
                "ID",
                "VERSION_ID",
                "PRETTY_NAME",
                "glibc",
                "XDG_SESSION_TYPE",
                "GDK_BACKEND"
            ]
            .contains(&key.as_str()));
        }
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
        schema_version: Some(3),
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
    let version = crate::process::command("git").arg("--version").output();
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
    let _ = ENVIRONMENT.set(runtime_environment());
    if let Ok(settings) = crate::store::read(app, "settings.json") {
        set_debug_enabled(
            settings
                .pointer("/logging/debugEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        );
    }
    native_with_context(
        "info",
        "app.native",
        "Backend de GitThul iniciado",
        None,
        Some(serde_json::json!({ "environment": ENVIRONMENT.get() })),
    );
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
        "environment": ENVIRONMENT.get(),
    })
}

fn runtime_environment() -> serde_json::Value {
    let environment =
        serde_json::json!({ "os": std::env::consts::OS, "architecture": std::env::consts::ARCH });
    #[cfg(target_os = "linux")]
    let mut environment = environment;
    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = fs::read_to_string("/etc/os-release") {
            let allowed = ["ID", "VERSION_ID", "PRETTY_NAME"];
            for line in contents.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    if allowed.contains(&key) {
                        environment[key] = serde_json::json!(crate::log_privacy::bounded(
                            value.trim_matches('"'),
                            256
                        ));
                    }
                }
            }
        }
        #[cfg(target_env = "gnu")]
        {
            unsafe extern "C" {
                fn gnu_get_libc_version() -> *const std::os::raw::c_char;
            }
            // glibc returns a static NUL-terminated version string.
            let version = unsafe { gnu_get_libc_version() };
            if !version.is_null() {
                environment["glibc"] =
                    serde_json::json!(
                        unsafe { std::ffi::CStr::from_ptr(version) }.to_string_lossy()
                    );
            }
        }
        for key in ["XDG_SESSION_TYPE", "GDK_BACKEND"] {
            if let Ok(value) = std::env::var(key) {
                environment[key] = serde_json::json!(match value.as_str() {
                    "x11" | "wayland" | "tty" | "broadway" => value,
                    _ => "other".into(),
                });
            }
        }
    }
    environment
}

//! Background scheduling and IPC for autonomous emergency backups.
//! The window thread never walks repositories, compresses files or waits for a copy.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::{
    backup_store::{BackupCatalog, BackupError, BackupPolicy, BackupStore, CaptureOutcome},
    GitCommandError, GitWriteLocks,
};

const FIRST_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);
const BUSY_RETRY: Duration = Duration::from_secs(60);
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone)]
struct ScheduledRepository {
    path: PathBuf,
    status: &'static str,
    reason: Option<&'static str>,
    next_check: Instant,
}

struct RuntimeState {
    root: PathBuf,
    policy: BackupPolicy,
    policy_suspended: bool,
    revision: u64,
    repositories: BTreeMap<PathBuf, ScheduledRepository>,
    catalog: BackupCatalog,
    catalog_error: Option<BackupError>,
    store: Option<Arc<BackupStore>>,
    active: Option<Arc<AtomicBool>>,
    restore_cancel: Option<Arc<AtomicBool>>,
    restoring: bool,
    stopped: bool,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            root: PathBuf::new(),
            policy: BackupPolicy::default(),
            policy_suspended: false,
            revision: 0,
            repositories: BTreeMap::new(),
            catalog: BackupCatalog {
                total_bytes: 0,
                points: Vec::new(),
                corrupt_points: 0,
            },
            catalog_error: None,
            store: None,
            active: None,
            restore_cancel: None,
            restoring: false,
            stopped: false,
        }
    }
}

#[derive(Default)]
struct Runtime {
    state: Mutex<RuntimeState>,
    wake: Condvar,
}

#[derive(Clone, Default)]
pub(crate) struct BackupManager {
    runtime: Arc<Runtime>,
}

pub(crate) fn policy_from_settings(settings: &Value) -> Result<BackupPolicy, String> {
    if !settings.is_object() {
        return Err("La configuración de respaldos no es válida".into());
    }
    let policy: BackupPolicy =
        serde_json::from_value(settings.get("backup").cloned().unwrap_or_else(|| json!({})))
            .map_err(|_| "Los límites de respaldos no son válidos".to_owned())?;
    policy
        .validate()
        .map_err(|_| "Los límites de respaldos no son válidos".to_owned())?;
    Ok(policy)
}

pub(crate) fn initialize(app: &AppHandle) {
    let parsed =
        crate::store::read(app, "settings.json").and_then(|value| policy_from_settings(&value));
    let suspended = parsed.is_err();
    let policy = parsed.unwrap_or(BackupPolicy {
        enabled: false,
        ..Default::default()
    });
    let Ok(root) = app.path().app_local_data_dir() else {
        return;
    };
    app.state::<BackupManager>().start(
        root.join("backups"),
        policy,
        app.state::<GitWriteLocks>().inner().clone(),
        suspended,
    );
}

impl BackupManager {
    fn start(&self, root: PathBuf, policy: BackupPolicy, locks: GitWriteLocks, suspended: bool) {
        {
            let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
            state.root = root;
            state.policy = policy;
            state.policy_suspended = suspended;
        }
        let runtime = self.runtime.clone();
        if thread::Builder::new()
            .name("gitthul-backups".into())
            .spawn(move || worker(runtime, locks))
            .is_err()
        {
            self.runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .catalog_error = Some(BackupError::Io);
        }
    }

    fn schedule(&self, repository: String) -> Result<(), GitCommandError> {
        let path = PathBuf::from(repository);
        if !path.is_absolute() || path.as_os_str().is_empty() {
            return Err(GitCommandError::new("backup.invalid", json!({})));
        }
        let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        let enabled = state.policy.enabled;
        state
            .repositories
            .entry(path.clone())
            .or_insert_with(|| ScheduledRepository {
                path,
                status: if enabled { "queued" } else { "disabled" },
                reason: None,
                next_check: Instant::now() + FIRST_DELAY,
            });
        self.runtime.wake.notify_one();
        Ok(())
    }

    pub(crate) fn update_policy(&self, policy: BackupPolicy) {
        let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.policy == policy && !state.policy_suspended {
            return;
        }
        if let Some(cancel) = &state.active {
            cancel.store(true, Ordering::Relaxed);
        }
        state.policy = policy.clone();
        state.policy_suspended = false;
        state.revision = state.revision.wrapping_add(1);
        for repository in state.repositories.values_mut() {
            repository.status = if policy.enabled { "queued" } else { "disabled" };
            repository.reason = None;
            repository.next_check = Instant::now() + Duration::from_secs(1);
        }
        self.runtime.wake.notify_one();
    }

    pub(crate) fn shutdown(&self) {
        let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        state.stopped = true;
        if let Some(cancel) = &state.active {
            cancel.store(true, Ordering::Relaxed);
        }
        if let Some(cancel) = &state.restore_cancel {
            cancel.store(true, Ordering::Relaxed);
        }
        self.runtime.wake.notify_one();
    }

    fn snapshot(&self) -> Result<Value, GitCommandError> {
        let state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(error) = &state.catalog_error {
            return Err(failure(error.clone()));
        }
        let mut repositories: BTreeMap<String, Value> = BTreeMap::new();
        for point in &state.catalog.points {
            let repository = repositories
                .entry(point.repository_id.clone())
                .or_insert_with(|| {
                    json!({
                        "id": point.repository_id, "name": point.repository_name,
                        "repository": point.repository_path.to_string_lossy(), "status": "idle",
                        "lastCompletedAt": point.created_at, "points": [],
                    })
                });
            let previous = repository["lastCompletedAt"].as_u64().unwrap_or(0);
            repository["lastCompletedAt"] = json!(previous.max(point.created_at));
            repository["points"].as_array_mut().unwrap().push(json!({
                "id": point.id, "createdAt": point.created_at, "bytes": point.size_bytes,
                "fileCount": point.file_count,
            }));
        }
        for pending in state.repositories.values() {
            let path = pending.path.to_string_lossy().into_owned();
            let matching = repositories
                .iter()
                .filter(|(_, entry)| entry["repository"].as_str() == Some(&path))
                .max_by_key(|(_, entry)| entry["lastCompletedAt"].as_u64().unwrap_or(0))
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| path.clone());
            let entry = repositories.entry(matching.clone()).or_insert_with(|| json!({
                "id": matching, "name": pending.path.file_name().unwrap_or_default().to_string_lossy(),
                "repository": path, "status": pending.status, "lastCompletedAt": null, "points": [],
            }));
            entry["status"] = json!(if state.policy.enabled {
                pending.status
            } else {
                "disabled"
            });
            if let Some(reason) = pending.reason {
                entry["reason"] = json!(reason);
            }
        }
        Ok(
            json!({ "directory": state.root.to_string_lossy(), "totalBytes": state.catalog.total_bytes,
            "maxBytes": state.policy.max_mi_b.saturating_mul(1024 * 1024), "enabled": state.policy.enabled,
            "corruptPoints": state.catalog.corrupt_points,
            "repositories": repositories.into_values().collect::<Vec<_>>() }),
        )
    }
}

fn refresh_catalog(runtime: &Runtime, store: &BackupStore) {
    let result = store.list();
    let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
    match result {
        Ok(catalog) => {
            state.catalog = catalog;
            state.catalog_error = None;
        }
        Err(error) => state.catalog_error = Some(error),
    }
}

fn worker(runtime: Arc<Runtime>, locks: GitWriteLocks) {
    lower_priority();
    let (root, policy, suspended) = {
        let state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        (
            state.root.clone(),
            state.policy.clone(),
            state.policy_suspended,
        )
    };
    let store = match BackupStore::new(root, policy) {
        Ok(store) => store,
        Err(error) => {
            runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .catalog_error = Some(error);
            return;
        }
    };
    let store = Arc::new(store);
    runtime
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .store = Some(store.clone());
    if !suspended {
        let _ = store.maintenance();
    }
    refresh_catalog(&runtime, &store);
    let mut next_maintenance = Instant::now() + MAINTENANCE_INTERVAL;
    let mut seen_revision = 0;
    loop {
        let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.stopped {
            break;
        }
        if state.revision != seen_revision {
            let revision = state.revision;
            let policy = state.policy.clone();
            drop(state);
            // Conservative cleanup may reject damaged points. Reading still
            // exposes the independent healthy backups and a damage warning.
            let _ = store.update_policy(policy);
            refresh_catalog(&runtime, &store);
            seen_revision = revision;
            continue;
        }
        if !state.restoring && Instant::now() >= next_maintenance {
            let suspended = state.policy_suspended;
            drop(state);
            if !suspended {
                let _ = store.maintenance();
            }
            refresh_catalog(&runtime, &store);
            next_maintenance = Instant::now() + MAINTENANCE_INTERVAL;
            continue;
        }
        let due = if state.policy.enabled && !state.restoring {
            state
                .repositories
                .iter()
                .filter(|(_, entry)| entry.next_check <= Instant::now())
                .min_by_key(|(_, entry)| entry.next_check)
                .map(|(path, _)| path.clone())
        } else {
            None
        };
        let Some(path) = due else {
            let delay = state
                .repositories
                .values()
                .filter(|_| state.policy.enabled && !state.restoring)
                .map(|entry| entry.next_check.saturating_duration_since(Instant::now()))
                .min()
                .unwrap_or(CHECK_INTERVAL)
                .min(CHECK_INTERVAL)
                .min(next_maintenance.saturating_duration_since(Instant::now()))
                .max(Duration::from_millis(100));
            let _ = runtime.wake.wait_timeout(state, delay);
            continue;
        };
        let cancel = Arc::new(AtomicBool::new(false));
        state.active = Some(cancel.clone());
        let revision = state.revision;
        if let Some(entry) = state.repositories.get_mut(&path) {
            entry.status = "running";
            entry.reason = None;
        }
        drop(state);
        // Check whether a write is already active, then RELEASE the lock. A
        // backup must never make a new commit/checkout wait for a full copy.
        let lock = locks.repository(&path.to_string_lossy());
        let available = lock.try_lock().is_ok();
        let outcome = if available {
            store.capture(&path, &cancel)
        } else {
            Err(BackupError::Changed)
        };
        refresh_catalog(&runtime, &store);
        let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        state.active = None;
        if state.revision != revision {
            continue;
        }
        let outcome = match outcome {
            Ok(CaptureOutcome::Created { point })
                if !state
                    .catalog
                    .points
                    .iter()
                    .any(|saved| saved.id == point.id) =>
            {
                Err(BackupError::Corrupt)
            }
            outcome => outcome,
        };
        if let Some(entry) = state.repositories.get_mut(&path) {
            let (status, reason, retry) = match outcome {
                Ok(CaptureOutcome::Created { .. }) => ("completed", None, CHECK_INTERVAL),
                Ok(CaptureOutcome::Unchanged) => ("unchanged", None, CHECK_INTERVAL),
                Ok(CaptureOutcome::TooSoon { next_at }) => {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    (
                        "tooSoon",
                        None,
                        Duration::from_millis(next_at.saturating_sub(now))
                            .min(CHECK_INTERVAL)
                            .max(BUSY_RETRY),
                    )
                }
                Ok(CaptureOutcome::NoSpace) | Err(BackupError::NoSpace) => {
                    ("overBudget", None, CHECK_INTERVAL)
                }
                Err(BackupError::Changed) => ("busy", Some("changed"), BUSY_RETRY),
                Err(BackupError::Cancelled) => ("queued", None, BUSY_RETRY),
                Err(BackupError::Incomplete) => ("failed", Some("incomplete"), CHECK_INTERVAL),
                Err(BackupError::Corrupt) => ("failed", Some("corrupt"), CHECK_INTERVAL),
                Err(BackupError::GitFailed) => ("failed", Some("git"), CHECK_INTERVAL),
                Err(_) => ("failed", Some("io"), CHECK_INTERVAL),
            };
            entry.status = status;
            entry.reason = reason;
            entry.next_check = Instant::now() + retry;
        }
    }
}

fn failure(error: BackupError) -> GitCommandError {
    let code = match error {
        BackupError::InvalidPath => "backup.invalid",
        BackupError::Changed => "backup.stale",
        BackupError::Corrupt | BackupError::Incomplete => "backup.invalid",
        _ => "backup.unavailable",
    };
    GitCommandError::new(code, json!({}))
}

#[tauri::command]
pub fn backup_read(manager: State<'_, BackupManager>) -> Result<Value, GitCommandError> {
    manager.snapshot()
}

#[tauri::command]
pub fn backup_schedule(
    repository: String,
    manager: State<'_, BackupManager>,
) -> Result<(), GitCommandError> {
    manager.schedule(repository)
}

/// The picker chooses a parent; restoration always creates a new child folder.
#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    id: String,
    manager: State<'_, BackupManager>,
) -> Result<Option<Value>, GitCommandError> {
    let manager = manager.inner().clone();
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| failure(BackupError::Io))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let parent = picked
        .into_path()
        .map_err(|_| failure(BackupError::InvalidPath))?;
    tauri::async_runtime::spawn_blocking(move || {
        let (store, name, created_at) = {
            let state = manager
                .runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let point = state
                .catalog
                .points
                .iter()
                .find(|point| point.id == id)
                .ok_or_else(|| GitCommandError::new("backup.stale", json!({})))?;
            (
                state
                    .store
                    .clone()
                    .ok_or_else(|| failure(BackupError::Io))?,
                point.repository_name.clone(),
                point.created_at,
            )
        };
        let destination = new_destination(&parent, &name, created_at).map_err(restore_failure)?;
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut state = manager
                .runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if state.restoring {
                return Err(GitCommandError::new("backup.unavailable", json!({})));
            }
            state.restoring = true;
            state.restore_cancel = Some(cancel.clone());
            if let Some(cancel) = &state.active {
                cancel.store(true, Ordering::Relaxed);
            }
        }
        let result = store.restore(&id, &destination, &cancel);
        {
            let mut state = manager
                .runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            state.restoring = false;
            state.restore_cancel = None;
        }
        manager.runtime.wake.notify_one();
        result.map_err(restore_failure)?;
        Ok(Some(json!({ "path": destination.to_string_lossy() })))
    })
    .await
    .map_err(|_| failure(BackupError::Io))?
}

fn restore_failure(error: BackupError) -> GitCommandError {
    if error == BackupError::InvalidPath {
        GitCommandError::new("backup.destination", json!({}))
    } else {
        failure(error)
    }
}

fn new_destination(parent: &Path, name: &str, created_at: u64) -> Result<PathBuf, BackupError> {
    let parent = std::fs::canonicalize(parent).map_err(|_| BackupError::InvalidPath)?;
    if !parent.is_dir() {
        return Err(BackupError::InvalidPath);
    }
    let mut normalized = String::new();
    for ch in name.chars() {
        let ch = if ch.is_alphanumeric() || matches!(ch, '-' | '_') {
            ch
        } else {
            '-'
        };
        if normalized.len() + ch.len_utf8() > 80 {
            break;
        }
        normalized.push(ch);
    }
    let name = normalized;
    let name = if name.is_empty() { "repository" } else { &name };
    for suffix in 0..1000 {
        let candidate = parent.join(format!("{name}-restored-{created_at}-{suffix}"));
        if std::fs::symlink_metadata(&candidate)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            return Ok(candidate);
        }
    }
    Err(BackupError::InvalidPath)
}

fn lower_priority() {
    #[cfg(target_os = "linux")]
    unsafe {
        unsafe extern "C" {
            fn gettid() -> i32;
            fn setpriority(which: i32, who: u32, priority: i32) -> i32;
        }
        let _ = setpriority(0, gettid() as u32, 10);
    }
    #[cfg(target_os = "macos")]
    unsafe {
        unsafe extern "C" {
            fn pthread_set_qos_class_self_np(class: u32, relative_priority: i32) -> i32;
        }
        let _ = pthread_set_qos_class_self_np(0x09, 0);
    }
    #[cfg(windows)]
    unsafe {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetCurrentThread() -> *mut std::ffi::c_void;
            fn SetThreadPriority(thread: *mut std::ffi::c_void, priority: i32) -> i32;
        }
        let _ = SetThreadPriority(GetCurrentThread(), -1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait_for(manager: &BackupManager, predicate: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let value = manager.snapshot().unwrap();
            if predicate(&value) {
                return value;
            }
            assert!(
                Instant::now() < deadline,
                "background backup did not settle: {value}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn run_now(manager: &BackupManager, repository: &Path) {
        manager
            .runtime
            .state
            .lock()
            .unwrap()
            .repositories
            .get_mut(repository)
            .unwrap()
            .next_check = Instant::now();
        manager.runtime.wake.notify_one();
    }

    #[test]
    fn unreadable_preferences_preserve_storage_until_a_valid_policy_is_saved() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("backups");
        std::fs::create_dir_all(root.join("chunks")).unwrap();
        let orphan = root.join("chunks").join("a".repeat(64));
        std::fs::write(&orphan, b"preserve these bytes").unwrap();
        let policy = BackupPolicy {
            enabled: false,
            ..Default::default()
        };
        let manager = BackupManager::default();
        manager.start(root, policy.clone(), GitWriteLocks::default(), true);
        wait_for(&manager, |value| value["totalBytes"] == 20);
        assert_eq!(std::fs::read(&orphan).unwrap(), b"preserve these bytes");
        // Even saving the same disabled values lifts the damaged-settings guard.
        manager.update_policy(policy);
        wait_for(&manager, |value| value["totalBytes"] == 0);
        assert!(!orphan.exists());
        manager.shutdown();
    }

    #[test]
    fn background_capture_defers_active_writes_and_restores_without_the_source() {
        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repository");
        std::fs::create_dir(&repository).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Backup fixture"],
            vec!["config", "user.email", "fixture@example.invalid"],
            vec!["config", "core.autocrlf", "false"],
        ] {
            assert!(std::process::Command::new("git")
                .current_dir(&repository)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env(
                    "GIT_CONFIG_GLOBAL",
                    temporary.path().join("fixture-global-config")
                )
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        std::fs::write(repository.join("file.txt"), "committed\n").unwrap();
        for args in [vec!["add", "."], vec!["commit", "-m", "Initial fixture"]] {
            assert!(std::process::Command::new("git")
                .current_dir(&repository)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env(
                    "GIT_CONFIG_GLOBAL",
                    temporary.path().join("fixture-global-config")
                )
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        std::fs::write(repository.join("file.txt"), "local work\n").unwrap();
        std::fs::write(repository.join("untracked.txt"), "untracked work\n").unwrap();
        let repository = std::fs::canonicalize(repository).unwrap();
        let locks = GitWriteLocks::default();
        let lock = locks.repository(&repository.to_string_lossy());
        let writing = lock.lock().unwrap();
        let manager = BackupManager::default();
        manager.start(
            temporary.path().join("backups"),
            BackupPolicy::default(),
            locks,
            false,
        );
        manager
            .schedule(repository.to_string_lossy().into_owned())
            .unwrap();
        run_now(&manager, &repository);
        let busy = wait_for(&manager, |snapshot| {
            snapshot["repositories"][0]["status"] == "busy"
        });
        assert_eq!(
            busy["repositories"][0]["points"].as_array().unwrap().len(),
            0
        );
        drop(writing);
        run_now(&manager, &repository);
        wait_for(&manager, |snapshot| {
            snapshot["repositories"][0]["status"] == "running"
                || snapshot["repositories"][0]["status"] == "completed"
        });
        // Neither navigation's metadata read nor a new Git mutation waits for copying.
        let before = Instant::now();
        manager.snapshot().unwrap();
        assert!(before.elapsed() < Duration::from_millis(500));
        assert!(lock.try_lock().is_ok());
        let completed = wait_for(&manager, |snapshot| {
            snapshot["repositories"][0]["status"] == "completed"
        });
        let point = completed["repositories"][0]["points"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        std::fs::remove_dir_all(&repository).unwrap();
        let store = manager.runtime.state.lock().unwrap().store.clone().unwrap();
        let restored = temporary.path().join("restored");
        store
            .restore(&point, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(restored.join("file.txt")).unwrap(),
            "local work\n"
        );
        assert_eq!(
            std::fs::read_to_string(restored.join("untracked.txt")).unwrap(),
            "untracked work\n"
        );
        assert!(restored.join(".git").is_dir());
        manager.shutdown();
    }

    #[test]
    fn defaults_are_global_one_gib_and_invalid_preferences_are_rejected() {
        let policy = policy_from_settings(&json!({})).unwrap();
        assert!(policy.enabled);
        assert_eq!(policy.max_mi_b, 1024);
        for invalid in [
            json!({"backup":null}),
            json!({"backup":{"maxMiB":0}}),
            json!({"backup":{"enabled":"true"}}),
        ] {
            assert!(policy_from_settings(&invalid).is_err());
        }
    }

    #[test]
    fn repeated_opening_does_not_duplicate_or_accelerate_the_job() {
        let manager = BackupManager::default();
        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repo").to_string_lossy().into_owned();
        manager.schedule(repository.clone()).unwrap();
        let first = manager
            .runtime
            .state
            .lock()
            .unwrap()
            .repositories
            .values()
            .next()
            .unwrap()
            .next_check;
        manager.schedule(repository).unwrap();
        let state = manager.runtime.state.lock().unwrap();
        assert_eq!(state.repositories.len(), 1);
        assert_eq!(
            state.repositories.values().next().unwrap().next_check,
            first
        );
    }

    #[test]
    fn preferences_cancel_background_work_and_shutdown_cancels_restoration() {
        let manager = BackupManager::default();
        let cancel = Arc::new(AtomicBool::new(false));
        manager.runtime.state.lock().unwrap().active = Some(cancel.clone());
        manager.update_policy(BackupPolicy {
            enabled: false,
            max_mi_b: 512,
        });
        assert!(cancel.load(Ordering::Relaxed));
        assert_eq!(manager.snapshot().unwrap()["maxBytes"], 512 * 1024 * 1024);
        assert_eq!(manager.snapshot().unwrap()["enabled"], false);
        let restore_cancel = Arc::new(AtomicBool::new(false));
        manager.runtime.state.lock().unwrap().restore_cancel = Some(restore_cancel.clone());
        manager.shutdown();
        assert!(restore_cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn restoration_destination_is_new_and_repository_names_cannot_escape() {
        let temporary = tempfile::tempdir().unwrap();
        let first = new_destination(temporary.path(), "../outside/name", 42).unwrap();
        let parent = std::fs::canonicalize(temporary.path()).unwrap();
        assert_eq!(first.parent(), Some(parent.as_path()));
        std::fs::create_dir(&first).unwrap();
        assert_ne!(
            new_destination(temporary.path(), "../outside/name", 42).unwrap(),
            first
        );
    }
}

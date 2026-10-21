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
    backup_store::{
        AutoPruneReceipt, BackupCatalog, BackupError, BackupLimitPlan, BackupPolicy, BackupStore,
        CaptureOutcome,
    },
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
    policy_applied_revision: Option<u64>,
    repositories: BTreeMap<PathBuf, ScheduledRepository>,
    catalog: BackupCatalog,
    catalog_error: Option<BackupError>,
    scanning: bool,
    store: Option<Arc<BackupStore>>,
    active: Option<Arc<AtomicBool>>,
    restore_cancel: Option<Arc<AtomicBool>>,
    restoring: bool,
    deleting: bool,
    maintaining: bool,
    worker_failed: bool,
    last_auto_prune: Option<AutoPruneReceipt>,
    stopped: bool,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            root: PathBuf::new(),
            policy: BackupPolicy::default(),
            policy_suspended: false,
            revision: 0,
            policy_applied_revision: None,
            repositories: BTreeMap::new(),
            catalog: BackupCatalog {
                total_bytes: 0,
                points: Vec::new(),
                corrupt_points: 0,
            },
            catalog_error: None,
            scanning: true,
            store: None,
            active: None,
            restore_cancel: None,
            restoring: false,
            deleting: false,
            maintaining: false,
            worker_failed: false,
            last_auto_prune: None,
            stopped: false,
        }
    }
}

#[derive(Default)]
struct Runtime {
    state: Mutex<RuntimeState>,
    wake: Condvar,
}

struct DeletionReservation<'a>(&'a Runtime);
impl Drop for DeletionReservation<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        state.deleting = false;
        state.scanning = false;
        self.0.wake.notify_all();
    }
}

struct WorkerLifetime<'a>(&'a Runtime);
impl Drop for WorkerLifetime<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        state.scanning = false;
        state.maintaining = false;
        state.active = None;
        if !state.stopped && state.catalog_error.is_none() {
            state.catalog_error = Some(BackupError::Io);
        }
        state.worker_failed = !state.stopped;
        self.0.wake.notify_all();
    }
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
    let root = match app.path().app_local_data_dir() {
        Ok(root) => root,
        Err(_) => {
            catalog_failure(&app.state::<BackupManager>().runtime, BackupError::Io);
            return;
        }
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
            state.scanning = true;
            state.catalog_error = None;
            state.worker_failed = false;
        }
        let runtime = self.runtime.clone();
        if thread::Builder::new()
            .name("gitthul-backups".into())
            .spawn(move || worker(runtime, locks))
            .is_err()
        {
            catalog_failure(&self.runtime, BackupError::Io);
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
        self.runtime.wake.notify_all();
        Ok(())
    }

    #[cfg(test)]
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
        state.policy_applied_revision = None;
        for repository in state.repositories.values_mut() {
            repository.status = if policy.enabled { "queued" } else { "disabled" };
            repository.reason = None;
            repository.next_check = Instant::now() + Duration::from_secs(1);
        }
        self.runtime.wake.notify_all();
    }

    pub(crate) fn shutdown(&self) {
        let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        state.stopped = true;
        state.scanning = false;
        if let Some(cancel) = &state.active {
            cancel.store(true, Ordering::Relaxed);
        }
        if let Some(cancel) = &state.restore_cancel {
            cancel.store(true, Ordering::Relaxed);
        }
        self.runtime.wake.notify_all();
    }

    fn snapshot(&self) -> Result<Value, GitCommandError> {
        let state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(error) = state.catalog_error.as_ref().filter(|_| !state.scanning) {
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
        let mut snapshot = json!({ "directory": state.root.to_string_lossy(), "totalBytes": state.catalog.total_bytes,
            "maxBytes": state.policy.max_mi_b.saturating_mul(1024 * 1024), "enabled": state.policy.enabled,
            "corruptPoints": state.catalog.corrupt_points,
            "scanning": state.scanning,
            "repositories": repositories.into_values().collect::<Vec<_>>() });
        if let Some(receipt) = &state.last_auto_prune {
            snapshot["lastAutoPrune"] = json!(receipt);
        }
        Ok(snapshot)
    }

    /// Runs on a blocking worker. Reserve the operation before taking the store
    /// gate so captures/maintenance cannot publish an older catalog afterward.
    fn delete(&self, id: &str) -> Result<Value, GitCommandError> {
        self.remove_points(|store| store.delete(id))
    }

    fn prune(&self) -> Result<Value, GitCommandError> {
        self.remove_points(BackupStore::prune)
    }

    fn remove_points(
        &self,
        remove: impl FnOnce(&BackupStore) -> Result<(), BackupError>,
    ) -> Result<Value, GitCommandError> {
        let (store, reservation) = self.reserve_store(false)?;
        let result = remove(&store);
        // A filesystem failure can follow a successful manifest removal. Always
        // refresh before releasing this reservation, including on partial failure.
        refresh_catalog(&self.runtime, &store);
        let result = result.map_err(failure).and_then(|()| self.snapshot());
        drop(reservation);
        result
    }

    fn reserve_store(
        &self,
        allow_suspended: bool,
    ) -> Result<(Arc<BackupStore>, DeletionReservation<'_>), GitCommandError> {
        let store = {
            let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
            if (state.policy_suspended && !allow_suspended)
                || state.stopped
                || state.restoring
                || state.deleting
                || state.worker_failed
            {
                return Err(failure(BackupError::Io));
            }
            let store = state
                .store
                .clone()
                .ok_or_else(|| failure(BackupError::Io))?;
            state.deleting = true;
            if let Some(cancel) = &state.active {
                cancel.store(true, Ordering::Relaxed);
            }
            store
        };
        let reservation = DeletionReservation(&self.runtime);
        self.runtime.wake.notify_all();
        {
            let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if state.stopped
                    || (state.policy_suspended && !allow_suspended)
                    || state.worker_failed
                {
                    return Err(failure(BackupError::Io));
                }
                if state.active.is_none() && !state.maintaining {
                    break;
                }
                // The worker releases these flags only after its last catalog
                // publication. The reservation prevents it taking another job.
                state = self
                    .runtime
                    .wake
                    .wait(state)
                    .unwrap_or_else(|e| e.into_inner());
            }
            state.scanning = true;
        }
        Ok((store, reservation))
    }

    fn preview_limit(&self, max_mi_b: u64) -> Result<BackupLimitPlan, GitCommandError> {
        let (store, _reservation) = self.reserve_store(false)?;
        store.preview_limit(max_mi_b).map_err(failure)
    }

    pub(crate) fn change_policy(
        &self,
        policy: BackupPolicy,
        token: Option<&str>,
        mut persist: impl FnMut(&BackupPolicy) -> Result<(), String>,
    ) -> Result<(), GitCommandError> {
        policy.validate().map_err(failure)?;
        let (previous, suspended) = {
            let state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
            (state.policy.clone(), state.policy_suspended)
        };
        if policy.max_mi_b >= previous.max_mi_b {
            persist(&policy).map_err(|output| {
                let mut error = failure(BackupError::Io);
                error.output = Some(output);
                error
            })?;
            if policy != previous || suspended {
                let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(store) = &state.store {
                    store.set_policy_without_cleanup(policy.clone());
                }
                apply_runtime_policy(&mut state, policy);
                state.policy_suspended = false;
                self.runtime.wake.notify_all();
            }
            return Ok(());
        }
        let (store, reservation) = self.reserve_store(true)?;
        let result = store.change_policy(policy, token, persist);
        {
            let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
            if result.is_ok()
                || result
                    .as_ref()
                    .is_err_and(|failure| failure.rollback_failed)
            {
                apply_runtime_policy(&mut state, store.policy().map_err(failure)?);
                state.policy_suspended = result.is_err();
            }
        }
        refresh_catalog(&self.runtime, &store);
        drop(reservation);
        result.map_err(|error| {
            let mut command_error = failure(error.error);
            command_error.output = error.output;
            command_error
        })
    }

    fn begin_restore(&self, id: &str, cancel: Arc<AtomicBool>) -> Result<(), GitCommandError> {
        let mut state = self.runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.restoring || state.deleting || state.stopped {
            return Err(failure(BackupError::Io));
        }
        // The destination picker can outlive a completed deletion. Revalidate
        // while reserving restoration so the two operations cannot cross here.
        if !state.catalog.points.iter().any(|point| point.id == id) {
            return Err(failure(BackupError::Changed));
        }
        state.restoring = true;
        state.restore_cancel = Some(cancel);
        if let Some(cancel) = &state.active {
            cancel.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
}

fn apply_runtime_policy(state: &mut RuntimeState, policy: BackupPolicy) {
    if let Some(cancel) = &state.active {
        cancel.store(true, Ordering::Relaxed);
    }
    state.policy = policy.clone();
    state.revision = state.revision.wrapping_add(1);
    state.policy_applied_revision = Some(state.revision);
    for repository in state.repositories.values_mut() {
        repository.status = if policy.enabled { "queued" } else { "disabled" };
        repository.reason = None;
        repository.next_check = Instant::now() + Duration::from_secs(1);
    }
}

fn refresh_catalog(runtime: &Runtime, store: &BackupStore) {
    refresh_catalog_with(runtime, || store.list());
}

fn refresh_catalog_with(
    runtime: &Runtime,
    read: impl FnOnce() -> Result<BackupCatalog, BackupError>,
) {
    {
        let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        state.scanning = !state.stopped;
    }
    let result = read();
    let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
    state.scanning = false;
    match result {
        Ok(catalog) => {
            state.catalog = catalog;
            state.catalog_error = None;
        }
        Err(error) => state.catalog_error = Some(error),
    }
}

fn catalog_failure(runtime: &Runtime, error: BackupError) {
    let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
    state.scanning = false;
    state.catalog_error = Some(error);
    state.worker_failed = true;
    runtime.wake.notify_all();
}

fn worker(runtime: Arc<Runtime>, locks: GitWriteLocks) {
    let _lifetime = WorkerLifetime(&runtime);
    lower_priority();
    let (root, policy) = {
        let state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        (state.root.clone(), state.policy.clone())
    };
    let store = match BackupStore::new(root, policy) {
        Ok(store) => store,
        Err(error) => {
            catalog_failure(&runtime, error);
            return;
        }
    };
    let store = Arc::new(store);
    let suspended = publish_store(&runtime, &store);
    if !suspended {
        let _ = store.maintenance();
    }
    refresh_catalog(&runtime, &store);
    runtime
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .maintaining = false;
    runtime.wake.notify_all();
    let mut next_maintenance = Instant::now() + MAINTENANCE_INTERVAL;
    let mut seen_revision = 0;
    loop {
        let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.stopped {
            break;
        }
        if state.deleting || state.restoring {
            let _ = runtime.wake.wait_timeout(state, BUSY_RETRY);
            continue;
        }
        if state.revision != seen_revision {
            let revision = state.revision;
            if state.policy_applied_revision == Some(revision) || state.policy_suspended {
                seen_revision = revision;
                continue;
            }
            let policy = state.policy.clone();
            state.maintaining = true;
            state.scanning = true;
            drop(state);
            // Conservative cleanup may reject damaged points. Reading still
            // exposes the independent healthy backups and a damage warning.
            let _ = store.update_policy(policy);
            refresh_catalog(&runtime, &store);
            runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .maintaining = false;
            runtime.wake.notify_all();
            seen_revision = revision;
            continue;
        }
        if !state.restoring && Instant::now() >= next_maintenance {
            let suspended = state.policy_suspended;
            state.maintaining = true;
            state.scanning = true;
            drop(state);
            if !suspended {
                let _ = store.maintenance();
            }
            refresh_catalog(&runtime, &store);
            runtime
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .maintaining = false;
            runtime.wake.notify_all();
            next_maintenance = Instant::now() + MAINTENANCE_INTERVAL;
            continue;
        }
        let due = if state.policy.enabled && !state.policy_suspended && !state.restoring {
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
                .filter(|_| state.policy.enabled && !state.policy_suspended && !state.restoring)
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
        if let Some(receipt) = store.take_auto_prune() {
            state.last_auto_prune = Some(receipt);
        }
        state.active = None;
        runtime.wake.notify_all();
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

fn publish_store(runtime: &Runtime, store: &Arc<BackupStore>) -> bool {
    let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
    // Settings can be saved while the store constructor still owns no runtime
    // slot. Synchronize its policy before exposing it or starting maintenance.
    store.set_policy_without_cleanup(state.policy.clone());
    state.maintaining = true;
    state.store = Some(store.clone());
    state.policy_suspended
}

fn failure(error: BackupError) -> GitCommandError {
    let code = match error {
        BackupError::InvalidPath => "backup.invalid",
        BackupError::Changed => "backup.stale",
        BackupError::Protected => "backup.protected",
        BackupError::LimitTooSmall => "backup.limitTooSmall",
        BackupError::LimitChanged => "backup.limitChanged",
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
pub async fn backup_delete(
    id: String,
    manager: State<'_, BackupManager>,
) -> Result<Value, GitCommandError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.delete(&id))
        .await
        .map_err(|_| failure(BackupError::Io))?
}

#[tauri::command]
pub async fn backup_prune(manager: State<'_, BackupManager>) -> Result<Value, GitCommandError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.prune())
        .await
        .map_err(|_| failure(BackupError::Io))?
}

#[tauri::command]
pub async fn backup_preview_limit(
    max_mi_b: u64,
    manager: State<'_, BackupManager>,
) -> Result<BackupLimitPlan, GitCommandError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.preview_limit(max_mi_b))
        .await
        .map_err(|_| failure(BackupError::Io))?
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
        manager.begin_restore(&id, cancel.clone())?;
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
        manager.runtime.wake.notify_all();
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

    #[test]
    fn catalog_scanning_exposes_previous_data_without_waiting_for_io_and_clears_on_failure() {
        let manager = BackupManager::default();
        assert_eq!(manager.snapshot().unwrap()["scanning"], true);
        {
            let mut state = manager.runtime.state.lock().unwrap();
            state.catalog.total_bytes = 77;
            state.catalog_error = Some(BackupError::Io);
            state.scanning = false;
        }
        let (started, ready) = std::sync::mpsc::channel();
        let (release, waiting) = std::sync::mpsc::channel();
        let runtime = manager.runtime.clone();
        let reading = thread::spawn(move || {
            refresh_catalog_with(&runtime, || {
                started.send(()).unwrap();
                waiting.recv().unwrap();
                Ok(BackupCatalog {
                    total_bytes: 99,
                    points: Vec::new(),
                    corrupt_points: 0,
                })
            });
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let querying = manager.clone();
        let query = thread::spawn(move || sent.send(querying.snapshot()).unwrap());
        let snapshot = received.recv_timeout(Duration::from_secs(1));
        release.send(()).unwrap();
        reading.join().unwrap();
        query.join().unwrap();
        let snapshot = snapshot.expect("catalog query waited for disk IO").unwrap();
        assert_eq!(snapshot["scanning"], true);
        assert_eq!(snapshot["totalBytes"], 77);
        assert_eq!(manager.snapshot().unwrap()["scanning"], false);
        assert_eq!(manager.snapshot().unwrap()["totalBytes"], 99);

        refresh_catalog_with(&manager.runtime, || {
            assert_eq!(manager.snapshot().unwrap()["scanning"], true);
            Err(BackupError::Io)
        });
        let state = manager.runtime.state.lock().unwrap();
        assert!(!state.scanning);
        assert_eq!(state.catalog.total_bytes, 99);
        drop(state);
        assert_eq!(manager.snapshot().unwrap_err().code, "backup.unavailable");
    }

    #[test]
    fn catalog_initialization_and_worker_failures_do_not_leave_scanning_active() {
        let temporary = tempfile::tempdir().unwrap();
        let not_directory = temporary.path().join("file");
        std::fs::write(&not_directory, b"preserve").unwrap();
        let manager = BackupManager::default();
        manager.start(
            not_directory.clone(),
            BackupPolicy::default(),
            GitWriteLocks::default(),
            false,
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        while manager.snapshot().is_ok() {
            assert!(
                Instant::now() < deadline,
                "initialization never reported failure"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!manager.runtime.state.lock().unwrap().scanning);
        assert_eq!(std::fs::read(not_directory).unwrap(), b"preserve");

        let manager = BackupManager::default();
        manager.runtime.state.lock().unwrap().catalog.total_bytes = 42;
        let _ = std::panic::catch_unwind(|| {
            let _lifetime = WorkerLifetime(&manager.runtime);
            panic!("simulated background thread failure");
        });
        assert!(!manager.runtime.state.lock().unwrap().scanning);
        assert_eq!(
            manager.runtime.state.lock().unwrap().catalog.total_bytes,
            42
        );
        assert_eq!(manager.snapshot().unwrap_err().code, "backup.unavailable");

        let manager = BackupManager::default();
        catalog_failure(&manager.runtime, BackupError::Io);
        assert!(!manager.runtime.state.lock().unwrap().scanning);
        assert_eq!(manager.snapshot().unwrap_err().code, "backup.unavailable");
    }

    #[test]
    fn deletion_rejects_other_manual_operations_suspended_policy_and_failed_or_stopped_workers() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("backups");
        let store = Arc::new(BackupStore::new(root.clone(), BackupPolicy::default()).unwrap());
        let orphan = root.join("chunks").join("a".repeat(64));
        std::fs::write(&orphan, b"must survive busy rejection").unwrap();
        let manager = BackupManager::default();
        manager.runtime.state.lock().unwrap().store = Some(store);
        for blocked in ["restore", "delete", "policy", "worker", "stopped"] {
            {
                let mut state = manager.runtime.state.lock().unwrap();
                state.restoring = blocked == "restore";
                state.deleting = blocked == "delete";
                state.policy_suspended = blocked == "policy";
                state.worker_failed = blocked == "worker";
                state.stopped = blocked == "stopped";
            }
            assert_eq!(
                manager.delete(&"0".repeat(64)).unwrap_err().code,
                "backup.unavailable"
            );
            assert_eq!(manager.prune().unwrap_err().code, "backup.unavailable");
            assert_eq!(
                std::fs::read(&orphan).unwrap(),
                b"must survive busy rejection"
            );
        }
    }

    #[test]
    fn deletion_refreshes_the_catalog_on_failure_without_trusting_cached_points() {
        let temporary = tempfile::tempdir().unwrap();
        let store = Arc::new(
            BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap(),
        );
        let manager = BackupManager::default();
        {
            let mut state = manager.runtime.state.lock().unwrap();
            state.root = store.directory().to_owned();
            state.store = Some(store.clone());
            state
                .catalog
                .points
                .push(super::super::backup_store::BackupPoint {
                    id: "0".repeat(64),
                    repository_id: "1".repeat(64),
                    repository_path: temporary.path().join("old"),
                    repository_name: "old".into(),
                    created_at: 1,
                    size_bytes: 0,
                    file_count: 0,
                });
        }
        assert_eq!(
            manager.delete(&"0".repeat(64)).unwrap_err().code,
            "backup.stale"
        );
        assert_eq!(manager.snapshot().unwrap()["repositories"], json!([]));
        assert!(!manager.runtime.state.lock().unwrap().deleting);
        assert!(!manager.runtime.state.lock().unwrap().scanning);
        assert_eq!(failure(BackupError::Protected).code, "backup.protected");
    }

    #[test]
    fn deletion_reservation_is_released_during_unwinding() {
        let manager = BackupManager::default();
        manager.runtime.state.lock().unwrap().deleting = true;
        let _ = std::panic::catch_unwind(|| {
            let _reservation = DeletionReservation(&manager.runtime);
            panic!("simulated worker panic");
        });
        assert!(!manager.runtime.state.lock().unwrap().deleting);
    }

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
        manager.runtime.wake.notify_all();
    }

    fn wait_state(manager: &BackupManager, predicate: impl Fn(&RuntimeState) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !predicate(&manager.runtime.state.lock().unwrap()) {
            assert!(Instant::now() < deadline, "backup runtime did not settle");
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn repository_fixture(root: &Path, name: &str) -> PathBuf {
        let repository = root.join(name);
        std::fs::create_dir(&repository).unwrap();
        std::fs::write(repository.join("file.txt"), format!("{name} contents\n")).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Backup fixture"],
            vec!["config", "user.email", "fixture@example.invalid"],
            vec!["config", "core.autocrlf", "false"],
            vec!["add", "."],
            vec!["commit", "-m", "Fixture"],
        ] {
            assert!(std::process::Command::new("git")
                .current_dir(&repository)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", root.join("fixture-global-config"))
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        std::fs::canonicalize(repository).unwrap()
    }

    fn manager_with_point() -> (
        tempfile::TempDir,
        BackupManager,
        PathBuf,
        Arc<BackupStore>,
        String,
        String,
    ) {
        let temporary = tempfile::tempdir().unwrap();
        let repository = repository_fixture(temporary.path(), "saved");
        let manager = BackupManager::default();
        manager.start(
            temporary.path().join("backups"),
            BackupPolicy::default(),
            GitWriteLocks::default(),
            false,
        );
        manager
            .schedule(repository.to_string_lossy().into_owned())
            .unwrap();
        run_now(&manager, &repository);
        let completed = wait_for(&manager, |snapshot| {
            snapshot["repositories"][0]["status"] == "completed"
        });
        let point = completed["repositories"][0]["points"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let store = manager.runtime.state.lock().unwrap().store.clone().unwrap();
        let mut older: Value = serde_json::from_slice(
            &std::fs::read(
                store
                    .directory()
                    .join("points")
                    .join(format!("{point}.json")),
            )
            .unwrap(),
        )
        .unwrap();
        let old_id = "0".repeat(64);
        older["point"]["id"] = json!(old_id);
        older["point"]["createdAt"] =
            json!(older["point"]["createdAt"].as_u64().unwrap() - 24 * 60 * 60 * 1000);
        std::fs::write(
            store
                .directory()
                .join("points")
                .join(format!("{old_id}.json")),
            serde_json::to_vec(&older).unwrap(),
        )
        .unwrap();
        refresh_catalog(&manager.runtime, &store);
        (temporary, manager, repository, store, point, old_id)
    }

    fn snapshot_repository<'a>(snapshot: &'a Value, repository: &Path) -> &'a Value {
        snapshot["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| {
                entry["repository"].as_str() == Some(repository.to_string_lossy().as_ref())
            })
            .unwrap()
    }

    #[test]
    fn policy_increases_and_enable_changes_need_no_store_and_keep_persistence_diagnostics() {
        let manager = BackupManager::default();
        let active = Arc::new(AtomicBool::new(false));
        {
            let mut state = manager.runtime.state.lock().unwrap();
            state.active = Some(active.clone());
            state.worker_failed = true;
            state.catalog_error = Some(BackupError::Corrupt);
        }
        manager
            .change_policy(BackupPolicy::default(), None, |_| Ok(()))
            .unwrap();
        assert!(
            !active.load(Ordering::Relaxed),
            "unrelated preferences must not cancel capture"
        );
        assert_eq!(manager.runtime.state.lock().unwrap().revision, 0);
        let error = manager
            .change_policy(BackupPolicy::default(), None, |_| {
                Err("Permission denied writing settings".into())
            })
            .unwrap_err();
        assert_eq!(error.code, "backup.unavailable");
        assert_eq!(
            error.output.as_deref(),
            Some("Permission denied writing settings")
        );
        for policy in [
            BackupPolicy {
                enabled: false,
                max_mi_b: 1024,
            },
            BackupPolicy {
                enabled: true,
                max_mi_b: 2048,
            },
        ] {
            let mut written = None;
            manager
                .change_policy(policy.clone(), None, |policy| {
                    written = Some(policy.clone());
                    Ok(())
                })
                .unwrap();
            assert_eq!(written, Some(policy.clone()));
            assert_eq!(manager.runtime.state.lock().unwrap().policy, policy);
        }
    }

    #[test]
    fn store_publication_uses_policy_saved_during_initialization() {
        let temporary = tempfile::tempdir().unwrap();
        let manager = BackupManager::default();
        let store = Arc::new(
            BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap(),
        );
        let policy = BackupPolicy {
            enabled: false,
            max_mi_b: 2048,
        };
        manager
            .change_policy(policy.clone(), None, |_| Ok(()))
            .unwrap();
        assert!(!publish_store(&manager.runtime, &store));
        assert_eq!(store.policy().unwrap(), policy);
        assert!(manager.runtime.state.lock().unwrap().store.is_some());
    }

    #[test]
    fn limit_changes_publish_actual_catalog_and_suspend_only_if_settings_rollback_failed() {
        for rollback_fails in [false, true] {
            let (_temporary, manager, _repository, store, latest, old) = manager_with_point();
            let old_path = store.directory().join("points").join(format!("{old}.json"));
            let mut bytes = std::fs::read(&old_path).unwrap();
            bytes.extend(vec![b' '; 1024 * 1024]);
            std::fs::write(&old_path, bytes).unwrap();
            let plan = manager.preview_limit(1).unwrap();
            assert_eq!(plan.delete_count, 1);
            store.fail_next_deletion();
            let next = BackupPolicy {
                enabled: true,
                max_mi_b: 1,
            };
            let mut writes = 0;
            let error = manager
                .change_policy(next.clone(), Some(&plan.token), |_| {
                    writes += 1;
                    if writes == 2 && rollback_fails {
                        Err("Disk unavailable while restoring settings".into())
                    } else {
                        Ok(())
                    }
                })
                .unwrap_err();
            assert_eq!(error.code, "backup.unavailable");
            assert_eq!(writes, 2);
            assert_eq!(
                error
                    .output
                    .as_deref()
                    .is_some_and(|s| s.contains("Disk unavailable while restoring settings")),
                rollback_fails
            );
            {
                let state = manager.runtime.state.lock().unwrap();
                assert_eq!(state.catalog.points.len(), 1);
                assert_eq!(state.catalog.points[0].id, latest);
                assert_eq!(state.policy_suspended, rollback_fails);
                assert_eq!(
                    state.policy,
                    if rollback_fails {
                        next
                    } else {
                        BackupPolicy::default()
                    }
                );
                assert_eq!(state.policy, store.policy().unwrap());
                assert!(!state.deleting && !state.scanning);
            }
            manager.shutdown();
        }
    }

    #[test]
    fn confirmed_limit_does_not_trigger_extra_age_retention_and_requeues_over_budget() {
        let (_temporary, manager, repository, store, _latest, old) = manager_with_point();
        let old_path = store.directory().join("points").join(format!("{old}.json"));
        let mut manifest: Value =
            serde_json::from_slice(&std::fs::read(&old_path).unwrap()).unwrap();
        manifest["point"]["createdAt"] = json!(1);
        std::fs::write(&old_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let plan = manager.preview_limit(1).unwrap();
        assert_eq!(plan.delete_count, 0);
        manager
            .change_policy(
                BackupPolicy {
                    enabled: true,
                    max_mi_b: 1,
                },
                Some(&plan.token),
                |_| Ok(()),
            )
            .unwrap();
        run_now(&manager, &repository);
        wait_state(&manager, |state| {
            state.active.is_none() && state.repositories[&repository].status == "tooSoon"
        });
        assert!(
            old_path.exists(),
            "saving a lower limit must not also run age retention"
        );
        {
            let mut state = manager.runtime.state.lock().unwrap();
            let entry = state.repositories.get_mut(&repository).unwrap();
            entry.status = "overBudget";
            entry.next_check = Instant::now() + CHECK_INTERVAL;
        }
        manager
            .change_policy(
                BackupPolicy {
                    enabled: true,
                    max_mi_b: 2,
                },
                None,
                |_| Ok(()),
            )
            .unwrap();
        {
            let state = manager.runtime.state.lock().unwrap();
            assert_eq!(state.repositories[&repository].status, "queued");
            assert!(
                state.repositories[&repository].next_check
                    <= Instant::now() + Duration::from_secs(2)
            );
        }
        assert!(old_path.exists());
        manager.shutdown();
    }

    #[test]
    fn automatic_eviction_receipt_is_published_even_if_capture_later_fails() {
        for deletion_fails in [false, true] {
            let (temporary, manager, _repository, store, latest, old) = manager_with_point();
            let old_path = store.directory().join("points").join(format!("{old}.json"));
            let mut bytes = std::fs::read(&old_path).unwrap();
            bytes.extend(vec![b' '; 1024 * 1024]);
            std::fs::write(&old_path, bytes).unwrap();
            let policy = BackupPolicy {
                enabled: true,
                max_mi_b: 1,
            };
            store.set_policy_without_cleanup(policy.clone());
            manager.runtime.state.lock().unwrap().policy = policy;
            if deletion_fails {
                store.fail_next_deletion();
            }
            let incoming = repository_fixture(temporary.path(), "incoming");
            manager
                .schedule(incoming.to_string_lossy().into_owned())
                .unwrap();
            run_now(&manager, &incoming);
            let snapshot = wait_for(&manager, |snapshot| {
                snapshot_repository(snapshot, &incoming)["status"]
                    == if deletion_fails {
                        "failed"
                    } else {
                        "completed"
                    }
            });
            assert_eq!(snapshot["lastAutoPrune"]["removedCount"], 1);
            assert!(snapshot["lastAutoPrune"]["freedBytes"].as_u64().unwrap() >= 1024 * 1024);
            assert_eq!(snapshot["lastAutoPrune"]["id"].as_str().unwrap().len(), 64);
            assert!(!old_path.exists());
            manager.shutdown();
            wait_state(&manager, |state| state.active.is_none());
            store
                .restore(
                    &latest,
                    &temporary.path().join("preserved-latest"),
                    &AtomicBool::new(false),
                )
                .unwrap();
        }
    }

    #[test]
    fn manual_actions_cancel_and_drain_real_capture_before_the_next_queued_repository() {
        for action in ["delete", "prune", "stale", "shutdown"] {
            let (temporary, manager, saved, store, latest, old_id) = manager_with_point();
            let capturing = repository_fixture(temporary.path(), "capturing");
            let queued = repository_fixture(temporary.path(), "queued");
            let pause = store.pause_next_capture();
            manager
                .schedule(capturing.to_string_lossy().into_owned())
                .unwrap();
            run_now(&manager, &capturing);
            pause.wait(); // The real worker has read bytes and holds the store gate.
            manager
                .schedule(queued.to_string_lossy().into_owned())
                .unwrap();
            run_now(&manager, &queued);
            let (sent, received) = std::sync::mpsc::channel();
            let manual = manager.clone();
            let target = old_id.clone();
            let task = thread::spawn(move || {
                let result = match action {
                    "prune" => manual.prune(),
                    "stale" => manual.delete(&"f".repeat(64)),
                    _ => manual.delete(&target),
                };
                sent.send(result).unwrap();
            });
            wait_state(&manager, |state| state.deleting);
            assert!(manager
                .runtime
                .state
                .lock()
                .unwrap()
                .active
                .as_ref()
                .unwrap()
                .load(Ordering::Relaxed));
            assert!(received.try_recv().is_err());
            assert_eq!(manager.prune().unwrap_err().code, "backup.unavailable");
            let pending = manager.snapshot().unwrap();
            assert_eq!(
                snapshot_repository(&pending, &saved)["points"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
            assert_eq!(snapshot_repository(&pending, &queued)["status"], "queued");
            if action == "shutdown" {
                manager.shutdown();
                assert_eq!(
                    received
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap()
                        .unwrap_err()
                        .code,
                    "backup.unavailable"
                );
                assert!(store
                    .directory()
                    .join("points")
                    .join(format!("{old_id}.json"))
                    .exists());
                drop(pause);
                task.join().unwrap();
                wait_state(&manager, |state| state.active.is_none());
                continue;
            }
            drop(pause);
            let result = received.recv_timeout(Duration::from_secs(10)).unwrap();
            task.join().unwrap();
            if action == "stale" {
                assert_eq!(result.unwrap_err().code, "backup.stale");
            } else {
                let completed = result.unwrap();
                assert_eq!(
                    snapshot_repository(&completed, &capturing)["status"],
                    "queued"
                );
                assert_eq!(
                    snapshot_repository(&completed, &capturing)["points"],
                    json!([])
                );
                assert_eq!(snapshot_repository(&completed, &queued)["status"], "queued");
                assert_eq!(
                    snapshot_repository(&completed, &saved)["points"]
                        .as_array()
                        .unwrap()
                        .len(),
                    1
                );
                assert_eq!(
                    snapshot_repository(&completed, &saved)["points"][0]["id"],
                    latest
                );
            }
            let completed = wait_for(&manager, |snapshot| {
                snapshot_repository(snapshot, &queued)["status"] == "completed"
            });
            assert_eq!(
                snapshot_repository(&completed, &saved)["points"]
                    .as_array()
                    .unwrap()
                    .len(),
                if action == "stale" { 2 } else { 1 }
            );
            assert!(!manager.runtime.state.lock().unwrap().deleting);
            assert!(std::fs::read_dir(store.directory().join("staging"))
                .unwrap()
                .next()
                .is_none());
            manager.shutdown();
            std::fs::remove_dir_all(&saved).unwrap();
            let restored = temporary.path().join("restored");
            store
                .restore(&latest, &restored, &AtomicBool::new(false))
                .unwrap();
            assert_eq!(
                std::fs::read_to_string(restored.join("file.txt")).unwrap(),
                "saved contents\n"
            );
        }
    }

    #[test]
    fn manual_prune_waits_for_real_maintenance_and_its_catalog_publication() {
        let (_temporary, manager, _saved, store, latest, _old_id) = manager_with_point();
        let gate = store.lock_for_test();
        manager.update_policy(BackupPolicy {
            max_mi_b: 1025,
            ..Default::default()
        });
        wait_state(&manager, |state| state.maintaining);
        let (sent, received) = std::sync::mpsc::channel();
        let manual = manager.clone();
        let task = thread::spawn(move || sent.send(manual.prune()).unwrap());
        wait_state(&manager, |state| state.deleting);
        assert!(received.try_recv().is_err());
        manager.snapshot().unwrap();
        drop(gate);
        let result = received
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        task.join().unwrap();
        assert_eq!(
            result["repositories"][0]["points"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(result["repositories"][0]["points"][0]["id"], latest);
        assert_eq!(result["scanning"], false);
        assert!(!manager.runtime.state.lock().unwrap().maintaining);
        manager.shutdown();
    }

    #[test]
    fn waiting_manual_action_wakes_on_worker_failure_or_policy_suspension_without_mutating() {
        for failure in ["worker", "policy"] {
            let temporary = tempfile::tempdir().unwrap();
            let manager = BackupManager::default();
            manager.runtime.state.lock().unwrap().store = Some(Arc::new(
                BackupStore::new(temporary.path().join("backups"), BackupPolicy::default())
                    .unwrap(),
            ));
            manager.runtime.state.lock().unwrap().active = Some(Arc::new(AtomicBool::new(false)));
            let mutated = Arc::new(AtomicBool::new(false));
            let marker = mutated.clone();
            let (sent, received) = std::sync::mpsc::channel();
            let manual = manager.clone();
            let task = thread::spawn(move || {
                sent.send(manual.remove_points(|store| {
                    marker.store(true, Ordering::Relaxed);
                    store.prune()
                }))
                .unwrap()
            });
            wait_state(&manager, |state| state.deleting);
            if failure == "worker" {
                drop(WorkerLifetime(&manager.runtime));
            } else {
                manager.runtime.state.lock().unwrap().policy_suspended = true;
                manager.runtime.wake.notify_all();
            }
            assert_eq!(
                received
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap_err()
                    .code,
                "backup.unavailable"
            );
            task.join().unwrap();
            assert!(!mutated.load(Ordering::Relaxed));
            assert!(!manager.runtime.state.lock().unwrap().deleting);
        }
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
        let store = manager.runtime.state.lock().unwrap().store.clone().unwrap();
        // A second valid manifest exercises the IPC manager's fresh protection
        // and returned catalog without waiting another day for the scheduler.
        let manifest_path = store
            .directory()
            .join("points")
            .join(format!("{point}.json"));
        let mut older: Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        let old_id = "0".repeat(64);
        older["point"]["id"] = json!(old_id);
        older["point"]["createdAt"] = json!(older["point"]["createdAt"].as_u64().unwrap() - 1);
        std::fs::write(
            store
                .directory()
                .join("points")
                .join(format!("{old_id}.json")),
            serde_json::to_vec(&older).unwrap(),
        )
        .unwrap();
        manager.runtime.state.lock().unwrap().catalog.points.clear();
        assert_eq!(manager.delete(&point).unwrap_err().code, "backup.protected");
        let after_delete = manager.delete(&old_id).unwrap();
        assert_eq!(
            after_delete["repositories"][0]["points"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(after_delete["repositories"][0]["points"][0]["id"], point);
        assert_eq!(
            after_delete["totalBytes"],
            store.list().unwrap().total_bytes
        );
        assert!(!manager.runtime.state.lock().unwrap().deleting);
        assert_eq!(
            manager
                .begin_restore(&old_id, Arc::new(AtomicBool::new(false)))
                .unwrap_err()
                .code,
            "backup.stale"
        );
        assert!(!manager.runtime.state.lock().unwrap().restoring);
        let prune_id = "2".repeat(64);
        older["point"]["id"] = json!(prune_id);
        std::fs::write(
            store
                .directory()
                .join("points")
                .join(format!("{prune_id}.json")),
            serde_json::to_vec(&older).unwrap(),
        )
        .unwrap();
        let after_prune = manager.prune().unwrap();
        assert_eq!(
            after_prune["repositories"][0]["points"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(after_prune["repositories"][0]["points"][0]["id"], point);
        assert_eq!(after_prune["totalBytes"], store.list().unwrap().total_bytes);
        assert_eq!(after_prune["scanning"], false);
        std::fs::remove_dir_all(&repository).unwrap();
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

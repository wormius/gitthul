//! Internal checkpoint policy and safe cache cleanup. Individual checkpoint
//! restoration is no longer exposed through application IPC.
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{recovery_store, undo::UndoError, GitCommandError};

#[cfg(test)]
use super::{repository, undo_checkpoint::Checkpoint, GitWriteLocks};
#[cfg(test)]
use serde::Serialize;
#[cfg(test)]
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[cfg(test)]
const PREVIEW_LIFETIME: Duration = Duration::from_secs(15 * 60);
static CONFIGURATION_WARNING: AtomicBool = AtomicBool::new(false);

pub(crate) fn configuration_warning() -> bool {
    CONFIGURATION_WARNING.load(Ordering::Relaxed)
}

#[cfg(test)]
struct PreparedRecovery {
    target: Arc<Checkpoint>,
    baseline: Arc<Checkpoint>,
    created: Instant,
}

#[cfg(test)]
#[derive(Clone, Default)]
pub(crate) struct RecoveryPreviews {
    entries: Arc<Mutex<HashMap<String, PreparedRecovery>>>,
}

#[cfg(test)]
impl RecoveryPreviews {
    fn expire(&self) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, entry| entry.created.elapsed() < PREVIEW_LIFETIME);
    }
}

fn failure(error: UndoError) -> GitCommandError {
    GitCommandError::new(
        match error {
            UndoError::Stale => "recovery.stale",
            UndoError::GitFailed => "recovery.unavailable",
        },
        json!({}),
    )
}

fn interrupted() -> GitCommandError {
    GitCommandError::new("recovery.unavailable", json!({}))
}

pub(crate) fn policy_from_settings(
    settings: &Value,
) -> Result<recovery_store::RecoveryPolicy, String> {
    let policy: recovery_store::RecoveryPolicy = serde_json::from_value(
        settings
            .get("recovery")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .map_err(|_| "Los límites de recuperación no son válidos".to_owned())?;
    policy
        .validate()
        .map_err(|_| "Los límites de recuperación no son válidos".to_owned())?;
    // Legacy values remain readable/validated, but operational checkpoints now
    // have an internal automatic policy, independent of emergency backups.
    Ok(recovery_store::RecoveryPolicy::default())
}

fn startup_policy(settings: Result<Value, String>) -> (recovery_store::RecoveryPolicy, bool) {
    match settings.and_then(|settings| policy_from_settings(&settings)) {
        Ok(policy) => (policy, false),
        Err(_) => (
            recovery_store::RecoveryPolicy {
                auto_cleanup: false,
                ..Default::default()
            },
            true,
        ),
    }
}

pub(crate) fn initialize(app: &AppHandle) {
    let (policy, warning) = startup_policy(crate::store::read(app, "settings.json"));
    CONFIGURATION_WARNING.store(warning, Ordering::Relaxed);
    if warning {
        crate::logging::native_with_context("warn", "git.recovery",
            "No se pudo leer la configuración de recuperación; la depuración automática está suspendida", None, None);
    }
    let configured = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())
        .and_then(|root| {
            recovery_store::configure(root.join("recovery"), policy)
                .map_err(|_| "No se pudo preparar el almacén de recuperación".to_owned())
        });
    match configured {
        Ok(()) => schedule_cleanup(),
        Err(error) => crate::logging::native_with_context(
            "error",
            "git.recovery",
            "El almacén de recuperación no está disponible",
            None,
            Some(json!({ "error": error })),
        ),
    }
}

pub(crate) fn schedule_cleanup() {
    tauri::async_runtime::spawn_blocking(|| {
        if !recovery_store::policy().auto_cleanup {
            return;
        }
        if let Err(error) = recovery_store::cleanup() {
            crate::logging::native_with_context(
                "warn",
                "git.recovery",
                "No se pudo depurar el almacén de recuperación",
                None,
                Some(json!({ "error": format!("{error:?}") })),
            );
        }
    });
}

pub(crate) struct PreparedPolicy(recovery_store::PreparedPolicy);

pub(crate) fn prepare_policy(
    policy: recovery_store::RecoveryPolicy,
) -> Result<PreparedPolicy, String> {
    recovery_store::prepare_policy(policy)
        .map(PreparedPolicy)
        .map_err(|_| "Los límites de recuperación no son válidos".to_owned())
}

pub(crate) fn apply_policy(policy: PreparedPolicy) {
    let changed = recovery_store::apply_policy(policy.0);
    CONFIGURATION_WARNING.store(false, Ordering::Relaxed);
    if changed {
        schedule_cleanup();
    }
}

#[tauri::command]
pub async fn recovery_read() -> Result<Value, GitCommandError> {
    tauri::async_runtime::spawn_blocking(|| {
        let overview = recovery_store::list().map_err(failure)?;
        let entries = serde_json::to_value(&overview).map_err(|_| interrupted())?;
        let checkpoints: Vec<Value> = entries["entries"].as_array().into_iter().flatten().map(|entry| {
            json!({
                "id": entry["id"], "repository": entry["repository"],
                "createdAt": entry["createdAt"], "label": entry["label"].as_str().unwrap_or(""),
                "status": entry["state"], "fileCount": entry["files"].as_array().map_or(0, Vec::len),
                "bytes": entry["bytes"], "active": entry["active"],
            })
        }).collect();
        Ok(json!({ "directory": recovery_store::root_path().map_err(failure)?.to_string_lossy(),
            "checkpoints": checkpoints, "totalBytes": entries["totalBytes"],
            "overBudget": entries["overBudget"], "protectedCount": entries["protectedCount"],
            "uncertainBuckets": entries["uncertainBuckets"],
            "configurationWarning": CONFIGURATION_WARNING.load(Ordering::Relaxed) }))
    }).await.map_err(|_| interrupted())?
}

#[tauri::command]
pub async fn recovery_cleanup() -> Result<Value, GitCommandError> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = recovery_store::clear_cache().map_err(failure)?;
        Ok(json!({ "removed": result.removed_checkpoints, "freedBytes": result.removed_bytes }))
    })
    .await
    .map_err(|_| interrupted())?
}

#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPreview {
    token: String,
    repository: String,
    file_count: usize,
    paths: Vec<String>,
    includes_git_state: bool,
}

#[cfg(test)]
fn prepare(
    id: &str,
    locks: &GitWriteLocks,
    previews: &RecoveryPreviews,
) -> Result<RecoveryPreview, GitCommandError> {
    previews.expire();
    let target = recovery_store::load(id).map_err(failure)?;
    let path = target.recovery_repository();
    let current = repository::discover(path)
        .map_err(|_| GitCommandError::new("recovery.unavailable", json!({})))?;
    let lock = locks.repository(&current.id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    target.recovery_verify_repository(path).map_err(failure)?;
    let baseline = Checkpoint::after(path, &target).map_err(failure)?;
    baseline.recovery_complete_preview().map_err(failure)?;
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).map_err(|_| interrupted())?;
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut paths = target.recovery_files();
    paths.extend(baseline.recovery_files());
    if let Some(scope) = target.recovery_scope() {
        paths.extend(scope);
    }
    paths.sort();
    paths.dedup();
    let result = RecoveryPreview {
        token: token.clone(),
        repository: current.id,
        file_count: paths.len(),
        paths,
        includes_git_state: true,
    };
    previews
        .entries
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            token,
            PreparedRecovery {
                target,
                baseline,
                created: Instant::now(),
            },
        );
    Ok(result)
}

#[cfg(test)]
fn restore(
    token: &str,
    locks: &GitWriteLocks,
    previews: &RecoveryPreviews,
) -> Result<(), GitCommandError> {
    previews.expire();
    let entry = previews
        .entries
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(token)
        .ok_or_else(|| GitCommandError::new("recovery.stale", json!({})))?;
    let path = entry.target.recovery_repository();
    let current = repository::discover(path).map_err(|_| interrupted())?;
    let lock = locks.repository(&current.id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    entry
        .target
        .recovery_verify_repository(path)
        .map_err(failure)?;
    // The preview snapshot is also the rollback checkpoint. Changes since the
    // dialog opened are rejected by Checkpoint::apply before its first write.
    // Publish the rollback as pending before touching the repository. If the
    // process stops before the after checkpoint is durable, startup GC must
    // preserve the state replaced by this restoration.
    entry
        .baseline
        .recovery_mark_pending("undo.recovery")
        .map_err(failure)?;
    if let Err(error) = Checkpoint::apply(path, &entry.baseline, &entry.target) {
        if matches!(error, UndoError::Stale) {
            entry
                .baseline
                .recovery_complete_preview()
                .map_err(failure)?;
        }
        return Err(failure(error));
    }
    entry.target.recovery_complete_preview().map_err(failure)?;
    let after = Checkpoint::after(path, &entry.baseline).map_err(failure)?;
    locks
        .undo
        .remember_checkpoint(&current.id, entry.baseline, after, "undo.recovery");
    locks.resolutions.clear_repository(&current.id);
    super::undo_checkpoint::notify_undo_change(path).map_err(failure)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf, process::Command};

    fn git(path: &Path, args: &[&str]) {
        let result = Command::new("git")
            .current_dir(path)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", path.join("fixture-global-config"))
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repository");
        let root = temp.path().join("recovery");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]);
        git(&repo, &["config", "user.name", "Recovery fixture"]);
        git(&repo, &["config", "user.email", "fixture@example.invalid"]);
        git(&repo, &["config", "core.autocrlf", "false"]);
        fs::write(repo.join("file.txt"), "committed\n").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "Initial fixture"]);
        recovery_store::configure(root.clone(), recovery_store::RecoveryPolicy::default()).unwrap();
        let repo = fs::canonicalize(repo).unwrap();
        let root = fs::canonicalize(root).unwrap();
        (temp, repo, root)
    }

    fn point(repo: &Path, root: &Path) -> String {
        fs::write(repo.join("file.txt"), "uncommitted before\n").unwrap();
        let before = Checkpoint::capture(repo, &[]).unwrap();
        let id = before
            .recovery_directory()
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        fs::write(repo.join("file.txt"), "uncommitted after\n").unwrap();
        let after = Checkpoint::after(repo, &before).unwrap();
        let old_session = GitWriteLocks::default();
        old_session
            .undo
            .remember_checkpoint(repo.to_str().unwrap(), before, after, "undo.discard");
        // Drop the complete old session. Subsequent preview only has persisted data.
        drop(old_session);
        id
    }

    #[test]
    fn persisted_point_restores_after_session_loss_and_can_be_undone() {
        let (_temp, repo, root) = fixture();
        let id = point(&repo, &root);
        let locks = GitWriteLocks::default();
        let previews = RecoveryPreviews::default();
        let preview = prepare(&id, &locks, &previews).unwrap();
        assert!(preview.paths.iter().any(|path| path == "file.txt"));
        restore(&preview.token, &locks, &previews).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join("file.txt")).unwrap(),
            "uncommitted before\n"
        );
        locks.undo.undo(repo.to_str().unwrap(), &repo).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join("file.txt")).unwrap(),
            "uncommitted after\n"
        );
        assert!(!repo.join(".git/gitthul-recovery").exists());
    }

    #[test]
    fn changes_after_preview_are_rejected_without_overwriting_them() {
        let (_temp, repo, root) = fixture();
        let id = point(&repo, &root);
        let locks = GitWriteLocks::default();
        let previews = RecoveryPreviews::default();
        let preview = prepare(&id, &locks, &previews).unwrap();
        fs::write(repo.join("file.txt"), "newer work\n").unwrap();
        let error = restore(&preview.token, &locks, &previews).unwrap_err();
        assert_eq!(error.code, "recovery.stale");
        assert_eq!(
            fs::read_to_string(repo.join("file.txt")).unwrap(),
            "newer work\n"
        );
        assert!(previews.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn interrupted_point_survives_and_preview_pin_prevents_removal() {
        let (_temp, repo, root) = fixture();
        fs::write(repo.join("file.txt"), "before interrupted operation\n").unwrap();
        let before = Checkpoint::capture(&repo, &[]).unwrap();
        let id = before
            .recovery_directory()
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        drop(before);
        fs::write(repo.join("file.txt"), "partial operation\n").unwrap();
        recovery_store::cleanup().unwrap();
        assert!(root.join(&id).exists());
        let locks = GitWriteLocks::default();
        let previews = RecoveryPreviews::default();
        let preview = prepare(&id, &locks, &previews).unwrap();
        assert!(recovery_store::remove(&id).is_err());
        restore(&preview.token, &locks, &previews).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join("file.txt")).unwrap(),
            "before interrupted operation\n"
        );
    }

    #[test]
    fn unreadable_or_invalid_settings_suspend_cleanup_without_blocking_startup() {
        for settings in [
            Err("invalid JSON".to_owned()),
            Ok(json!({"recovery": null})),
            Ok(json!({"recovery": {"maxCheckpoints": 0}})),
        ] {
            let (policy, warning) = startup_policy(settings);
            assert!(warning);
            assert!(!policy.auto_cleanup);
            assert!(policy.validate().is_ok());
        }
        let (policy, warning) = startup_policy(Ok(json!({})));
        assert!(!warning);
        assert!(policy.auto_cleanup);
        let (policy, warning) = startup_policy(Ok(json!({"recovery": {
            "autoCleanup": false, "maxCheckpoints": 200, "maxMiB": 2048
        }})));
        assert!(!warning);
        assert_eq!(policy, recovery_store::RecoveryPolicy::default());
    }

    #[test]
    fn rollback_survives_interruption_after_restore_before_undo_is_published() {
        let (_temp, repo, root) = fixture();
        let id = point(&repo, &root);
        let locks = GitWriteLocks::default();
        let previews = RecoveryPreviews::default();
        let preview = prepare(&id, &locks, &previews).unwrap();
        let entry = previews
            .entries
            .lock()
            .unwrap()
            .remove(&preview.token)
            .unwrap();
        let rollback_id = entry
            .baseline
            .recovery_directory()
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        entry
            .baseline
            .recovery_mark_pending("undo.recovery")
            .unwrap();
        Checkpoint::apply(&repo, &entry.baseline, &entry.target).unwrap();
        drop(entry); // Simulate loss of the session before after/undo publication.
        recovery_store::update_policy(recovery_store::RecoveryPolicy {
            max_checkpoints: 1,
            ..Default::default()
        })
        .unwrap();
        recovery_store::cleanup().unwrap();
        assert!(root.join(&rollback_id).exists());
        let overview = recovery_store::list().unwrap();
        assert!(overview
            .entries
            .iter()
            .any(|entry| entry.id == rollback_id && entry.state == "pending"));
        let rollback = prepare(&rollback_id, &locks, &previews).unwrap();
        restore(&rollback.token, &locks, &previews).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join("file.txt")).unwrap(),
            "uncommitted after\n"
        );
    }
}

//! Recuperación de sesión: archivos e índice exactos, HEAD y referencias revalidados.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};

use super::recovery_store;
use super::status::{self, CommitPrecondition};
use super::undo_checkpoint::Checkpoint;
use super::undo_local::LocalSnapshot;

#[derive(Clone, Default)]
pub struct UndoStacks {
    stacks: Arc<Mutex<HashMap<String, RepositoryStacks>>>,
}

#[derive(Clone, Debug)]
struct UndoStep {
    entry: UndoEntry,
    operation: UndoOperation,
}

#[derive(Clone, Debug)]
enum UndoOperation {
    Barrier,
    Checkpoint {
        before: Arc<Checkpoint>,
        after: Arc<Checkpoint>,
    },
    Local {
        before: Arc<LocalSnapshot>,
        after: Arc<LocalSnapshot>,
    },
    Head {
        before: Option<String>,
        after: String,
        index_tree: String,
        branch: String,
    },
    RefUpdate {
        reference: String,
        before: Option<String>,
        after: Option<String>,
    },
    Checkout {
        before: CheckoutSnapshot,
        after: CheckoutSnapshot,
    },
    RenameBranch {
        before: RenameSnapshot,
        after: RenameSnapshot,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CheckoutSnapshot {
    head: CheckoutHead,
    state: status::ResetPrecondition,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CheckoutHead {
    Branch { reference: String, target: String },
    Detached { target: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct RenameSnapshot {
    name: String,
    target: String,
    config: Vec<u8>,
    worktrees: Vec<Vec<u8>>,
    reflog: Vec<u8>,
}

#[derive(Clone, Debug, Default)]
struct RepositoryStacks {
    undo: Vec<UndoStep>,
    redo: Vec<UndoStep>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoEntry {
    id: String,
    label_key: &'static str,
    params: Value,
    at: u64,
    undoable: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct UndoSnapshot {
    undo: Vec<UndoEntry>,
    redo: Vec<UndoEntry>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum UndoError {
    GitFailed,
    Stale,
}

impl UndoStacks {
    pub(super) fn remember_barrier(&self, repository: &str) {
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository.to_owned()).or_default();
        stacks.undo.insert(
            0,
            UndoStep {
                entry: UndoEntry {
                    id: format!("{}-push", now_millis()),
                    label_key: "undo.pushShared",
                    params: json!({}),
                    at: now_millis(),
                    undoable: false,
                },
                operation: UndoOperation::Barrier,
            },
        );
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
    }

    pub(super) fn remember_checkpoint(
        &self,
        repository: &str,
        before: Arc<Checkpoint>,
        after: Arc<Checkpoint>,
        label_key: &'static str,
    ) {
        let recovery_directory = before.recovery_directory().to_owned();
        // A failed durable completion keeps the snapshots pending and protected.
        let _ = Checkpoint::recovery_complete_pair(&before, &after, label_key);
        if before.same(&after) {
            recovery_store::cleanup_bucket_if_enabled(&recovery_directory);
            return;
        }
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository.to_owned()).or_default();
        stacks.undo.insert(
            0,
            UndoStep {
                entry: UndoEntry {
                    id: format!("{}-checkpoint", now_millis()),
                    label_key,
                    params: json!({}),
                    at: now_millis(),
                    undoable: true,
                },
                operation: UndoOperation::Checkpoint { before, after },
            },
        );
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
        drop(all);
        recovery_store::cleanup_bucket_if_enabled(&recovery_directory);
    }

    pub(super) fn remember_local(
        &self,
        repository: &str,
        before: LocalSnapshot,
        after: LocalSnapshot,
        label_key: &'static str,
    ) {
        if before.same(&after) {
            return;
        }
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository.to_owned()).or_default();
        stacks.undo.insert(
            0,
            UndoStep {
                entry: UndoEntry {
                    id: format!("{}-local", now_millis()),
                    label_key,
                    params: json!({}),
                    at: now_millis(),
                    undoable: true,
                },
                operation: UndoOperation::Local {
                    before: Arc::new(before),
                    after: Arc::new(after),
                },
            },
        );
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
    }

    pub fn remember_commit(
        &self,
        repository: &str,
        before: CommitPrecondition,
        after_head: String,
        amend: bool,
        branch: String,
        summary: String,
    ) {
        let Some(index_tree) = before.index_tree else {
            return;
        };
        let entry = UndoEntry {
            id: format!(
                "{}-{}",
                now_millis(),
                &after_head[..8.min(after_head.len())]
            ),
            label_key: if amend { "undo.amend" } else { "undo.commit" },
            params: json!({ "branch": branch, "summary": summary }),
            at: now_millis(),
            undoable: true,
        };
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository.to_owned()).or_default();
        stacks.undo.insert(
            0,
            UndoStep {
                entry,
                operation: UndoOperation::Head {
                    before: before.head,
                    after: after_head,
                    index_tree,
                    branch,
                },
            },
        );
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
    }

    pub fn remember_created_ref(
        &self,
        repository_id: &str,
        repository: &Path,
        reference: String,
        label_key: &'static str,
        params: Value,
    ) {
        let target = git_text(
            repository,
            &["rev-parse", "--verify", "--end-of-options", &reference],
        );
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository_id.to_owned()).or_default();
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
        let Some(target) = target else { return };
        remember_ref_update(stacks, reference, None, Some(target), label_key, params);
    }

    pub fn remember_deleted_ref(
        &self,
        repository_id: &str,
        reference: String,
        target: String,
        label_key: &'static str,
        params: Value,
    ) {
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository_id.to_owned()).or_default();
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
        remember_ref_update(stacks, reference, Some(target), None, label_key, params);
    }

    pub fn remember_checkout(
        &self,
        repository_id: &str,
        before: CheckoutSnapshot,
        after: CheckoutSnapshot,
    ) {
        let from = checkout_label(&before);
        let to = checkout_label(&after);
        let target = after.state.head.as_deref().unwrap_or("checkout");
        let entry = UndoEntry {
            id: format!(
                "{}-checkout-{}",
                now_millis(),
                &target[..8.min(target.len())]
            ),
            label_key: "undo.checkout",
            params: json!({ "from": from, "to": to }),
            at: now_millis(),
            undoable: true,
        };
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository_id.to_owned()).or_default();
        stacks.undo.insert(
            0,
            UndoStep {
                entry,
                operation: UndoOperation::Checkout { before, after },
            },
        );
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
    }

    pub fn remember_rename(
        &self,
        repository_id: &str,
        before: RenameSnapshot,
        after: RenameSnapshot,
    ) {
        let entry = UndoEntry {
            id: format!("{}-rename-{}", now_millis(), after.name),
            label_key: "undo.renameBranch",
            params: json!({ "from": before.name, "to": after.name }),
            at: now_millis(),
            undoable: true,
        };
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.entry(repository_id.to_owned()).or_default();
        stacks.undo.insert(
            0,
            UndoStep {
                entry,
                operation: UndoOperation::RenameBranch { before, after },
            },
        );
        stacks.redo.clear();
        stacks
            .undo
            .truncate(recovery_store::policy().max_checkpoints);
    }

    pub fn clear_redo(&self, repository: &str) {
        if let Some(stacks) = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get_mut(repository)
        {
            stacks.redo.clear();
            stacks
                .undo
                .truncate(recovery_store::policy().max_checkpoints);
        }
    }

    pub fn read(&self, repository: &str) -> UndoSnapshot {
        let all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(stacks) = all.get(repository) else {
            return UndoSnapshot {
                undo: Vec::new(),
                redo: Vec::new(),
            };
        };
        UndoSnapshot {
            undo: stacks.undo.iter().map(|step| step.entry.clone()).collect(),
            redo: stacks.redo.iter().map(|step| step.entry.clone()).collect(),
        }
    }

    pub fn undo(&self, repository_id: &str, repository: &Path) -> Result<(), UndoError> {
        let step = self.peek(repository_id, true);
        let Some(step) = step else { return Ok(()) };
        if !matches!(&step.operation, UndoOperation::Checkpoint { .. }) {
            ensure_idle(repository)?;
        }
        match &step.operation {
            UndoOperation::Barrier => return Err(UndoError::Stale),
            UndoOperation::Checkpoint { before, after } => {
                Checkpoint::apply(repository, after, before)?
            }
            UndoOperation::Local { before, after } => {
                LocalSnapshot::apply(repository, after, before)?
            }
            UndoOperation::Head {
                before,
                after,
                index_tree,
                branch,
            } => {
                ensure_branch(repository, branch)?;
                ensure(repository, Some(after), Some(index_tree))?;
                update_head(repository, before.as_deref(), Some(after))?;
                ensure(repository, before.as_deref(), Some(index_tree))?;
            }
            UndoOperation::RefUpdate {
                reference,
                before,
                after,
            } => {
                apply_ref_update(repository, reference, after.as_deref(), before.as_deref())?;
            }
            UndoOperation::Checkout { before, after } => {
                apply_checkout(repository, after, before)?;
            }
            UndoOperation::RenameBranch { before, after } => {
                apply_rename(repository, after, before)?;
            }
        }
        self.move_step(repository_id, &step.entry.id, true);
        Ok(())
    }

    pub fn redo(&self, repository_id: &str, repository: &Path) -> Result<(), UndoError> {
        let step = self.peek(repository_id, false);
        let Some(step) = step else { return Ok(()) };
        if !matches!(&step.operation, UndoOperation::Checkpoint { .. }) {
            ensure_idle(repository)?;
        }
        match &step.operation {
            UndoOperation::Barrier => return Err(UndoError::Stale),
            UndoOperation::Checkpoint { before, after } => {
                Checkpoint::apply(repository, before, after)?
            }
            UndoOperation::Local { before, after } => {
                LocalSnapshot::apply(repository, before, after)?
            }
            UndoOperation::Head {
                before,
                after,
                index_tree,
                branch,
            } => {
                ensure_branch(repository, branch)?;
                ensure(repository, before.as_deref(), Some(index_tree))?;
                update_head(repository, Some(after), before.as_deref())?;
                ensure(repository, Some(after), Some(index_tree))?;
            }
            UndoOperation::RefUpdate {
                reference,
                before,
                after,
            } => {
                apply_ref_update(repository, reference, before.as_deref(), after.as_deref())?;
            }
            UndoOperation::Checkout { before, after } => {
                apply_checkout(repository, before, after)?;
            }
            UndoOperation::RenameBranch { before, after } => {
                apply_rename(repository, before, after)?;
            }
        }
        self.move_step(repository_id, &step.entry.id, false);
        Ok(())
    }

    fn peek(&self, repository: &str, undo: bool) -> Option<UndoStep> {
        let all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stacks = all.get(repository)?;
        if undo {
            stacks.undo.first().cloned()
        } else {
            stacks.redo.first().cloned()
        }
    }

    fn move_step(&self, repository: &str, id: &str, undo: bool) {
        let mut all = self
            .stacks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(stacks) = all.get_mut(repository) else {
            return;
        };
        let source = if undo {
            &mut stacks.undo
        } else {
            &mut stacks.redo
        };
        if source.first().is_none_or(|step| step.entry.id != id) {
            return;
        }
        let step = source.remove(0);
        if undo {
            stacks.redo.insert(0, step);
        } else {
            stacks.undo.insert(0, step);
        }
    }
}

pub(super) fn checkout_snapshot(repository: &Path) -> Option<CheckoutSnapshot> {
    // Los archivos sin seguimiento no forman parte de un checkout y `git switch`
    // ya se niega a sobrescribirlos. No leer su contenido completo sólo para
    // registrar este undo; basta revalidar HEAD, índice y cambios rastreados.
    let state = status::tracked_reset_precondition(repository);
    let target = state.head.clone()?;
    let head = match git_text(repository, &["symbolic-ref", "-q", "HEAD"]) {
        Some(reference) => CheckoutHead::Branch { reference, target },
        None => CheckoutHead::Detached { target },
    };
    Some(CheckoutSnapshot { head, state })
}

fn checkout_label(snapshot: &CheckoutSnapshot) -> String {
    match &snapshot.head {
        CheckoutHead::Branch { reference, .. } => reference
            .strip_prefix("refs/heads/")
            .unwrap_or(reference)
            .to_owned(),
        CheckoutHead::Detached { target } => target[..8.min(target.len())].to_owned(),
    }
}

pub(super) fn rename_snapshot(repository: &Path, name: &str) -> Option<RenameSnapshot> {
    let reference = format!("refs/heads/{name}");
    let target = git_text(
        repository,
        &["rev-parse", "--verify", "--end-of-options", &reference],
    )?;
    let config = branch_config(repository, name)?;
    let worktrees = branch_worktrees(repository, &reference)?;
    let reflog = branch_reflog(repository, &reference)?;
    if reflog.is_empty() {
        return None;
    }
    Some(RenameSnapshot {
        name: name.to_owned(),
        target,
        config,
        worktrees,
        reflog,
    })
}

fn branch_config(repository: &Path, name: &str) -> Option<Vec<u8>> {
    let escaped = regex_escape(name);
    let pattern = format!(r"^branch\.{escaped}\.");
    let output = git_command(repository)
        .args(["config", "--null", "--get-regexp", &pattern])
        .output()
        .ok()?;
    if output.status.success() || output.status.code() == Some(1) {
        Some(output.stdout)
    } else {
        None
    }
}

fn regex_escape(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            if ".^$*+?()[]{}|\\".contains(character) {
                vec!['\\', character]
            } else {
                vec![character]
            }
        })
        .collect()
}

fn branch_worktrees(repository: &Path, reference: &str) -> Option<Vec<Vec<u8>>> {
    let output = git_command(repository)
        .args(["worktree", "list", "--porcelain", "-z"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let expected = format!("branch {reference}");
    let mut path = None;
    let mut matches = Vec::new();
    for field in output.stdout.split(|byte| *byte == 0) {
        if field.is_empty() {
            path = None;
        } else if let Some(value) = field.strip_prefix(b"worktree ") {
            path = Some(value.to_vec());
        } else if field == expected.as_bytes() {
            if let Some(path) = path.take() {
                matches.push(path);
            }
        }
    }
    matches.sort();
    Some(matches)
}

fn branch_reflog(repository: &Path, reference: &str) -> Option<Vec<u8>> {
    let output = git_command(repository)
        .args([
            "reflog",
            "show",
            "--format=%H%x09%gs",
            "--no-abbrev-commit",
            reference,
        ])
        .output()
        .ok()?;
    output.status.success().then_some(output.stdout)
}

fn remember_ref_update(
    stacks: &mut RepositoryStacks,
    reference: String,
    before: Option<String>,
    after: Option<String>,
    label_key: &'static str,
    params: Value,
) {
    let target = after
        .as_ref()
        .or(before.as_ref())
        .expect("una transición de ref tiene un OID");
    let entry = UndoEntry {
        id: format!("{}-{}", now_millis(), &target[..8.min(target.len())]),
        label_key,
        params,
        at: now_millis(),
        undoable: true,
    };
    stacks.undo.insert(
        0,
        UndoStep {
            entry,
            operation: UndoOperation::RefUpdate {
                reference,
                before,
                after,
            },
        },
    );
}

fn ensure(
    repository: &Path,
    head: Option<&str>,
    index_tree: Option<&str>,
) -> Result<(), UndoError> {
    let current = status::commit_precondition(repository);
    if current.head.as_deref() == head && current.index_tree.as_deref() == index_tree {
        Ok(())
    } else {
        Err(UndoError::Stale)
    }
}

fn update_head(
    repository: &Path,
    target: Option<&str>,
    expected: Option<&str>,
) -> Result<(), UndoError> {
    let reference =
        git_text(repository, &["symbolic-ref", "-q", "HEAD"]).unwrap_or_else(|| "HEAD".to_owned());
    update_ref(repository, &reference, target, expected)
}

fn ensure_ref(repository: &Path, reference: &str, expected: Option<&str>) -> Result<(), UndoError> {
    let actual = git_text(
        repository,
        &["rev-parse", "--verify", "--end-of-options", reference],
    );
    if actual.as_deref() == expected {
        Ok(())
    } else {
        Err(UndoError::Stale)
    }
}

fn object_exists(repository: &Path, target: &str) -> bool {
    git_command(repository)
        .args(["cat-file", "-e", target])
        .status()
        .is_ok_and(|status| status.success())
}

fn apply_ref_update(
    repository: &Path,
    reference: &str,
    expected: Option<&str>,
    target: Option<&str>,
) -> Result<(), UndoError> {
    if reference.starts_with("refs/heads/")
        && !branch_worktrees(repository, reference)
            .ok_or(UndoError::GitFailed)?
            .is_empty()
    {
        return Err(UndoError::Stale);
    }
    ensure_ref(repository, reference, expected)?;
    if target.is_some_and(|target| !object_exists(repository, target)) {
        return Err(UndoError::Stale);
    }
    update_ref(repository, reference, target, expected)?;
    ensure_ref(repository, reference, target)
}

fn apply_checkout(
    repository: &Path,
    expected: &CheckoutSnapshot,
    target: &CheckoutSnapshot,
) -> Result<(), UndoError> {
    if checkout_snapshot(repository).as_ref() != Some(expected) {
        return Err(UndoError::Stale);
    }
    match &target.head {
        CheckoutHead::Branch { reference, target } => {
            ensure_ref(repository, reference, Some(target))?;
            let Some(name) = reference.strip_prefix("refs/heads/") else {
                return Err(UndoError::GitFailed);
            };
            let status = git_command(repository)
                .args(["switch", "--quiet", name])
                .status()
                .map_err(|_| UndoError::GitFailed)?;
            if !status.success() {
                return Err(UndoError::Stale);
            }
        }
        CheckoutHead::Detached { target } => {
            if !object_exists(repository, target) {
                return Err(UndoError::Stale);
            }
            let status = git_command(repository)
                .args(["switch", "--quiet", "--detach", target])
                .status()
                .map_err(|_| UndoError::GitFailed)?;
            if !status.success() {
                return Err(UndoError::Stale);
            }
        }
    }
    if checkout_snapshot(repository).as_ref() == Some(target) {
        Ok(())
    } else {
        Err(UndoError::GitFailed)
    }
}

fn apply_rename(
    repository: &Path,
    expected: &RenameSnapshot,
    target: &RenameSnapshot,
) -> Result<(), UndoError> {
    let current = rename_snapshot(repository, &expected.name).ok_or(UndoError::Stale)?;
    if current.target != expected.target
        || current.config != expected.config
        || current.worktrees != expected.worktrees
        || !current.reflog.ends_with(&expected.reflog)
    {
        return Err(UndoError::Stale);
    }
    ensure_ref(repository, &format!("refs/heads/{}", target.name), None)?;
    let status = git_command(repository)
        .args(["branch", "--move", "--", &expected.name, &target.name])
        .status()
        .map_err(|_| UndoError::GitFailed)?;
    if !status.success() {
        return Err(UndoError::Stale);
    }
    let actual = rename_snapshot(repository, &target.name).ok_or(UndoError::GitFailed)?;
    if actual.target == target.target
        && actual.config == target.config
        && actual.worktrees == target.worktrees
        && actual.reflog.ends_with(&target.reflog)
    {
        Ok(())
    } else {
        Err(UndoError::GitFailed)
    }
}

fn update_ref(
    repository: &Path,
    reference: &str,
    target: Option<&str>,
    expected: Option<&str>,
) -> Result<(), UndoError> {
    let expected = expected.unwrap_or("0000000000000000000000000000000000000000");
    let status = if let Some(target) = target {
        git_command(repository)
            .args([
                "update-ref",
                "-m",
                "GitThul: deshacer/rehacer",
                reference,
                target,
                expected,
            ])
            .status()
    } else {
        git_command(repository)
            .args(["update-ref", "-d", reference, expected])
            .status()
    }
    .map_err(|_| UndoError::GitFailed)?;
    if status.success() {
        Ok(())
    } else {
        Err(UndoError::Stale)
    }
}

pub(super) fn git_text(repository: &Path, args: &[&str]) -> Option<String> {
    let output = git_command(repository).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8(output.stdout).ok()?.trim().to_owned())
}

fn git_command(repository: &Path) -> Command {
    let mut command = crate::process::command("git");
    command
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    command
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use serde_json::json;
    use tempfile::TempDir;

    use super::{checkout_snapshot, rename_snapshot, UndoError, UndoStacks};
    use crate::git::status;

    fn repository() -> TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        git(temporary.path(), &["config", "user.name", "GitThul"]);
        git(
            temporary.path(),
            &["config", "user.email", "gitthul@example.invalid"],
        );
        temporary
    }

    fn git(repository: &Path, args: &[&str]) {
        assert!(Command::new("git")
            .args(args)
            .current_dir(repository)
            .status()
            .unwrap()
            .success());
    }

    fn output(repository: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap()
    }

    fn reference(repository: &Path, name: &str) -> Option<String> {
        let output = Command::new("git")
            .args(["rev-parse", "--verify", "--end-of-options", name])
            .current_dir(repository)
            .output()
            .unwrap();
        output
            .status
            .success()
            .then(|| String::from_utf8(output.stdout).unwrap().trim().to_owned())
    }

    fn commit_and_remember(repository: &Path, stacks: &UndoStacks, amend: bool) -> String {
        let before = status::commit_precondition(repository);
        git(
            repository,
            if amend {
                &["commit", "--quiet", "--amend", "-m", "nuevo mensaje"]
            } else {
                &["commit", "--quiet", "-m", "cambio"]
            },
        );
        let after = output(repository, &["rev-parse", "HEAD"]).trim().to_owned();
        stacks.remember_commit(
            "repo",
            before,
            after.clone(),
            amend,
            "main".to_owned(),
            "cambio".to_owned(),
        );
        after
    }

    #[test]
    fn snapshot_reserves_the_larger_staged_version_before_discard() {
        let temporary = repository();
        let path = temporary.path();
        fs::File::create(path.join("large"))
            .unwrap()
            .set_len(65 * 1024 * 1024)
            .unwrap();
        git(path, &["add", "large"]);
        fs::write(path.join("large"), "small working copy").unwrap();
        assert!(super::LocalSnapshot::capture(path, &["large".to_owned()]).is_err());
        assert_eq!(
            fs::read_to_string(path.join("large")).unwrap(),
            "small working copy"
        );
    }

    #[test]
    fn recovery_refuses_an_in_progress_integration() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("a"), "a").unwrap();
        git(path, &["add", "a"]);
        let stacks = UndoStacks::default();
        let after = commit_and_remember(path, &stacks, false);
        fs::write(path.join(".git/MERGE_HEAD"), format!("{after}\n")).unwrap();
        assert_eq!(stacks.undo("repo", path), Err(UndoError::Stale));
        assert_eq!(reference(path, "HEAD"), Some(after));
        assert!(path.join(".git/MERGE_HEAD").exists());
        assert_eq!(stacks.read("repo").undo.len(), 1);
    }

    #[test]
    fn local_stage_undo_redo_preserves_unstaged_bytes_and_initial_index() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("archivo.txt"), "prepared\n").unwrap();
        let before = super::LocalSnapshot::capture(path, &[]).unwrap();
        git(path, &["add", "archivo.txt"]);
        let after = super::LocalSnapshot::capture(path, &[]).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_local("repo", before, after, "undo.stage");
        fs::write(path.join("archivo.txt"), "new unsaved work\n").unwrap();
        stacks.undo("repo", path).unwrap();
        assert!(output(path, &["ls-files"]).is_empty());
        assert_eq!(
            fs::read_to_string(path.join("archivo.txt")).unwrap(),
            "new unsaved work\n"
        );
        stacks.redo("repo", path).unwrap();
        assert_eq!(output(path, &["show", ":archivo.txt"]), "prepared\n");
        assert_eq!(
            fs::read_to_string(path.join("archivo.txt")).unwrap(),
            "new unsaved work\n"
        );
    }

    #[test]
    fn local_discard_recovers_binary_untracked_and_partial_staging() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("archivo.txt"), "base\n").unwrap();
        git(path, &["add", "archivo.txt"]);
        git(path, &["commit", "--quiet", "-m", "base"]);
        fs::write(path.join("archivo.txt"), "staged\n").unwrap();
        git(path, &["add", "archivo.txt"]);
        fs::write(path.join("archivo.txt"), "working\n").unwrap();
        fs::write(path.join("new.bin"), [0, 255, 1, 128]).unwrap();
        let paths = vec!["archivo.txt".to_owned(), "new.bin".to_owned()];
        let before = super::LocalSnapshot::capture(path, &paths).unwrap();
        let targets = paths
            .iter()
            .map(|name| {
                let diff = crate::git::diff::current(
                    path,
                    name.clone(),
                    crate::git::diff::DiffSource::Worktree,
                    false,
                )
                .unwrap();
                serde_json::from_value(json!({ "path": name, "precondition": diff.precondition }))
                    .unwrap()
            })
            .collect();
        crate::git::write::discard(path, targets).unwrap();
        let after = super::LocalSnapshot::capture(path, &paths).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_local("repo", before, after, "undo.discard");
        for _ in 0..2 {
            stacks.undo("repo", path).unwrap();
            assert_eq!(fs::read(path.join("new.bin")).unwrap(), [0, 255, 1, 128]);
            assert_eq!(
                fs::read_to_string(path.join("archivo.txt")).unwrap(),
                "working\n"
            );
            assert_eq!(output(path, &["show", ":archivo.txt"]), "staged\n");
            stacks.redo("repo", path).unwrap();
            assert!(!path.join("new.bin").exists());
            assert_eq!(
                fs::read_to_string(path.join("archivo.txt")).unwrap(),
                "staged\n"
            );
        }
        fs::write(path.join("new.bin"), "external").unwrap();
        assert_eq!(stacks.undo("repo", path), Err(UndoError::Stale));
        assert_eq!(
            fs::read_to_string(path.join("new.bin")).unwrap(),
            "external"
        );
        assert_eq!(stacks.read("repo").undo.len(), 1);
    }

    #[test]
    fn local_recovery_refuses_index_lock_and_external_staging() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("a"), "a").unwrap();
        let before = super::LocalSnapshot::capture(path, &[]).unwrap();
        git(path, &["add", "a"]);
        let after = super::LocalSnapshot::capture(path, &[]).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_local("repo", before, after, "undo.stage");
        fs::write(path.join(".git/index.lock"), "owned by another process").unwrap();
        assert_eq!(stacks.undo("repo", path), Err(UndoError::Stale));
        assert_eq!(
            fs::read_to_string(path.join(".git/index.lock")).unwrap(),
            "owned by another process"
        );
        fs::remove_file(path.join(".git/index.lock")).unwrap();
        fs::write(path.join("b"), "b").unwrap();
        git(path, &["add", "b"]);
        assert_eq!(stacks.undo("repo", path), Err(UndoError::Stale));
        assert_eq!(output(path, &["show", ":b"]), "b");
    }

    #[test]
    fn commit_recovery_refuses_another_branch_at_the_same_commit() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("a"), "a").unwrap();
        git(path, &["add", "a"]);
        let stacks = UndoStacks::default();
        let after = commit_and_remember(path, &stacks, false);
        git(path, &["switch", "--quiet", "-c", "other"]);
        assert_eq!(stacks.undo("repo", path), Err(UndoError::Stale));
        assert_eq!(reference(path, "refs/heads/other"), Some(after.clone()));
        assert_eq!(reference(path, "refs/heads/main"), Some(after));
    }

    #[test]
    fn ref_recovery_refuses_deleting_branch_checked_out_in_linked_worktree() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["commit", "--quiet", "--allow-empty", "-m", "base"]);
        git(path, &["branch", "topic"]);
        let stacks = UndoStacks::default();
        stacks.remember_created_ref(
            "repo",
            path,
            "refs/heads/topic".to_owned(),
            "undo.createBranch",
            json!({"branch":"topic"}),
        );
        let linked_root = tempfile::tempdir().unwrap();
        let linked = linked_root.path().join("linked");
        git(
            path,
            &[
                "worktree",
                "add",
                "--quiet",
                linked.to_str().unwrap(),
                "topic",
            ],
        );
        assert_eq!(stacks.undo("repo", path), Err(UndoError::Stale));
        assert!(reference(path, "refs/heads/topic").is_some());
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_refuses_symlinks_and_paths_outside_repository() {
        let temporary = repository();
        let path = temporary.path();
        std::os::unix::fs::symlink("/tmp", path.join("escape")).unwrap();
        for name in ["../outside", ".git/config", "escape/file"] {
            assert!(super::LocalSnapshot::capture(path, &[name.to_owned()]).is_err());
        }
    }

    #[test]
    fn deshace_y_rehace_rama_sin_mover_head() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        let head = output(temporary.path(), &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        git(temporary.path(), &["branch", "recuperada", &head]);
        let stacks = UndoStacks::default();
        stacks.remember_created_ref(
            "repo",
            temporary.path(),
            "refs/heads/recuperada".to_owned(),
            "undo.recoverBranch",
            json!({ "branch": "recuperada" }),
        );

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/heads/recuperada"), None);
        assert_eq!(
            reference(temporary.path(), "HEAD").as_deref(),
            Some(head.as_str())
        );
        assert_eq!(stacks.read("repo").redo.len(), 1);

        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            reference(temporary.path(), "refs/heads/recuperada").as_deref(),
            Some(head.as_str())
        );
        assert_eq!(
            reference(temporary.path(), "HEAD").as_deref(),
            Some(head.as_str())
        );
    }

    #[test]
    fn crear_y_cambiar_se_deshace_en_dos_pasos_sin_perder_indice_ni_arbol() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        fs::write(temporary.path().join("archivo.txt"), "preparado\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        fs::write(temporary.path().join("archivo.txt"), "sin preparar\n").unwrap();

        let before = checkout_snapshot(temporary.path()).unwrap();
        git(temporary.path(), &["branch", "dev"]);
        git(
            temporary.path(),
            &["switch", "--quiet", "-c", "tema", "dev"],
        );
        let after = checkout_snapshot(temporary.path()).unwrap();
        let target = reference(temporary.path(), "refs/heads/tema").unwrap();
        let staged = output(temporary.path(), &["diff", "--cached"]);
        let unstaged = output(temporary.path(), &["diff"]);
        let stacks = UndoStacks::default();
        stacks.remember_created_ref(
            "repo",
            temporary.path(),
            "refs/heads/tema".to_owned(),
            "undo.createBranch",
            json!({ "branch": "tema" }),
        );
        stacks.remember_checkout("repo", before, after);
        assert_eq!(
            stacks.read("repo").undo[0].params,
            json!({ "from": "main", "to": "tema" })
        );

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["branch", "--show-current"]),
            "main\n"
        );
        assert_eq!(
            reference(temporary.path(), "refs/heads/tema"),
            Some(target.clone())
        );
        assert_eq!(output(temporary.path(), &["diff", "--cached"]), staged);
        assert_eq!(output(temporary.path(), &["diff"]), unstaged);

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/heads/tema"), None);
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/heads/tema"), Some(target));
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["branch", "--show-current"]),
            "tema\n"
        );
        assert_eq!(output(temporary.path(), &["diff", "--cached"]), staged);
        assert_eq!(output(temporary.path(), &["diff"]), unstaged);
    }

    #[test]
    fn checkout_obsoleto_no_cambia_de_rama_ni_borra_la_nueva() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        let before = checkout_snapshot(temporary.path()).unwrap();
        git(temporary.path(), &["switch", "--quiet", "-c", "tema"]);
        let after = checkout_snapshot(temporary.path()).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkout("repo", before, after);
        fs::write(temporary.path().join("archivo.txt"), "externo\n").unwrap();

        assert_eq!(stacks.undo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(
            output(temporary.path(), &["branch", "--show-current"]),
            "tema\n"
        );
        assert!(reference(temporary.path(), "refs/heads/tema").is_some());
        assert_eq!(stacks.read("repo").undo.len(), 1);
    }

    #[test]
    fn rename_recorre_reflog_configuracion_y_worktree_en_ambos_sentidos() {
        let temporary = repository();
        git(
            temporary.path(),
            &["commit", "--quiet", "--allow-empty", "-m", "base"],
        );
        git(temporary.path(), &["branch", "tema"]);
        git(
            temporary.path(),
            &["config", "branch.tema.remote", "origin"],
        );
        git(
            temporary.path(),
            &["config", "branch.tema.merge", "refs/heads/tema"],
        );
        let worktrees = tempfile::tempdir().unwrap();
        let linked = worktrees.path().join("linked");
        git(
            temporary.path(),
            &[
                "worktree",
                "add",
                "--quiet",
                linked.to_str().unwrap(),
                "tema",
            ],
        );

        let before = rename_snapshot(temporary.path(), "tema").unwrap();
        git(
            temporary.path(),
            &["branch", "--move", "--", "tema", "nuevo"],
        );
        let after = rename_snapshot(temporary.path(), "nuevo").unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_rename("repo", before, after);

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(output(&linked, &["branch", "--show-current"]), "tema\n");
        assert_eq!(
            output(temporary.path(), &["config", "branch.tema.remote"]),
            "origin\n"
        );
        assert!(output(temporary.path(), &["reflog", "show", "tema"])
            .contains("renamed refs/heads/nuevo to refs/heads/tema"));

        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(output(&linked, &["branch", "--show-current"]), "nuevo\n");
        stacks.undo("repo", temporary.path()).unwrap();
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(output(&linked, &["branch", "--show-current"]), "nuevo\n");
        assert_eq!(stacks.read("repo").redo.len(), 0);
    }

    #[test]
    fn rename_obsoleto_no_pisa_colision_ni_acepta_una_rama_recreada() {
        let temporary = repository();
        git(
            temporary.path(),
            &["commit", "--quiet", "--allow-empty", "-m", "base"],
        );
        git(temporary.path(), &["branch", "tema"]);
        let target = reference(temporary.path(), "refs/heads/tema").unwrap();
        let before = rename_snapshot(temporary.path(), "tema").unwrap();
        git(
            temporary.path(),
            &["branch", "--move", "--", "tema", "nuevo"],
        );
        let after = rename_snapshot(temporary.path(), "nuevo").unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_rename("repo", before, after);

        git(temporary.path(), &["branch", "tema", &target]);
        assert_eq!(stacks.undo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(
            reference(temporary.path(), "refs/heads/tema"),
            Some(target.clone())
        );
        assert_eq!(
            reference(temporary.path(), "refs/heads/nuevo"),
            Some(target.clone())
        );

        git(temporary.path(), &["branch", "--delete", "--force", "tema"]);
        git(
            temporary.path(),
            &["branch", "--delete", "--force", "nuevo"],
        );
        git(temporary.path(), &["branch", "nuevo", &target]);
        assert_eq!(stacks.undo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(reference(temporary.path(), "refs/heads/tema"), None);
        assert_eq!(
            reference(temporary.path(), "refs/heads/nuevo"),
            Some(target)
        );
        assert_eq!(stacks.read("repo").undo.len(), 1);
    }

    #[test]
    fn conserva_el_oid_del_objeto_tag_anotado() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        git(
            temporary.path(),
            &["tag", "--annotate", "--message", "estable", "v1"],
        );
        let tag_object = reference(temporary.path(), "refs/tags/v1").unwrap();
        let commit = reference(temporary.path(), "refs/tags/v1^{}").unwrap();
        assert_ne!(tag_object, commit);
        let stacks = UndoStacks::default();
        stacks.remember_created_ref(
            "repo",
            temporary.path(),
            "refs/tags/v1".to_owned(),
            "undo.createTag",
            json!({ "tag": "v1" }),
        );

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/tags/v1"), None);
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            reference(temporary.path(), "refs/tags/v1").as_deref(),
            Some(tag_object.as_str())
        );
    }

    #[test]
    fn deshace_y_rehace_un_tag_ligero() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        git(temporary.path(), &["tag", "v-ligero"]);
        let target = reference(temporary.path(), "refs/tags/v-ligero").unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_created_ref(
            "repo",
            temporary.path(),
            "refs/tags/v-ligero".to_owned(),
            "undo.createTag",
            json!({ "tag": "v-ligero" }),
        );

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/tags/v-ligero"), None);
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            reference(temporary.path(), "refs/tags/v-ligero"),
            Some(target)
        );
    }

    #[test]
    fn restaura_y_vuelve_a_borrar_una_rama_eliminada() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        git(temporary.path(), &["branch", "borrada"]);
        let target = reference(temporary.path(), "refs/heads/borrada").unwrap();
        git(temporary.path(), &["branch", "--delete", "borrada"]);
        let stacks = UndoStacks::default();
        stacks.remember_deleted_ref(
            "repo",
            "refs/heads/borrada".to_owned(),
            target.clone(),
            "undo.deleteBranch",
            json!({ "branch": "borrada" }),
        );

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(
            reference(temporary.path(), "refs/heads/borrada"),
            Some(target)
        );
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/heads/borrada"), None);
    }

    #[test]
    fn restaura_el_objeto_exacto_de_un_tag_anotado_eliminado() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        git(
            temporary.path(),
            &["tag", "--annotate", "--message", "estable", "v-borrada"],
        );
        let tag_object = reference(temporary.path(), "refs/tags/v-borrada").unwrap();
        let commit = reference(temporary.path(), "refs/tags/v-borrada^{}").unwrap();
        assert_ne!(tag_object, commit);
        git(temporary.path(), &["tag", "--delete", "v-borrada"]);
        let stacks = UndoStacks::default();
        stacks.remember_deleted_ref(
            "repo",
            "refs/tags/v-borrada".to_owned(),
            tag_object.clone(),
            "undo.deleteTag",
            json!({ "tag": "v-borrada" }),
        );

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(
            reference(temporary.path(), "refs/tags/v-borrada"),
            Some(tag_object)
        );
        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(reference(temporary.path(), "refs/tags/v-borrada"), None);
    }

    #[test]
    fn borrar_no_pisa_un_nombre_reocupado_ni_una_ref_restaurada_que_se_movio() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "uno\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "uno"]);
        let deleted = reference(temporary.path(), "HEAD").unwrap();
        git(temporary.path(), &["branch", "tema"]);
        git(temporary.path(), &["branch", "--delete", "tema"]);
        let stacks = UndoStacks::default();
        stacks.remember_deleted_ref(
            "repo",
            "refs/heads/tema".to_owned(),
            deleted.clone(),
            "undo.deleteBranch",
            json!({ "branch": "tema" }),
        );
        fs::write(temporary.path().join("archivo.txt"), "dos\n").unwrap();
        git(temporary.path(), &["commit", "--quiet", "-am", "dos"]);
        let intruder = reference(temporary.path(), "HEAD").unwrap();
        git(temporary.path(), &["branch", "tema", &intruder]);

        assert_eq!(stacks.undo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(
            reference(temporary.path(), "refs/heads/tema"),
            Some(intruder.clone())
        );
        assert_eq!(stacks.read("repo").undo.len(), 1);

        git(temporary.path(), &["branch", "--delete", "tema"]);
        stacks.undo("repo", temporary.path()).unwrap();
        git(temporary.path(), &["branch", "--force", "tema", &intruder]);
        assert_eq!(stacks.redo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(
            reference(temporary.path(), "refs/heads/tema"),
            Some(intruder)
        );
        assert_eq!(stacks.read("repo").redo.len(), 1);
    }

    #[test]
    fn una_referencia_movida_o_reocupada_hace_stale_sin_sobrescribir() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "uno\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "uno"]);
        let original = reference(temporary.path(), "HEAD").unwrap();
        git(temporary.path(), &["branch", "tema", &original]);
        let stacks = UndoStacks::default();
        stacks.remember_created_ref(
            "repo",
            temporary.path(),
            "refs/heads/tema".to_owned(),
            "undo.createBranch",
            json!({ "branch": "tema" }),
        );
        fs::write(temporary.path().join("archivo.txt"), "dos\n").unwrap();
        git(temporary.path(), &["commit", "--quiet", "-am", "dos"]);
        let moved = reference(temporary.path(), "HEAD").unwrap();
        git(temporary.path(), &["branch", "--force", "tema", &moved]);

        assert_eq!(stacks.undo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(
            reference(temporary.path(), "refs/heads/tema"),
            Some(moved.clone())
        );
        assert_eq!(stacks.read("repo").undo.len(), 1);

        git(temporary.path(), &["branch", "--force", "tema", &original]);
        stacks.undo("repo", temporary.path()).unwrap();
        git(temporary.path(), &["branch", "tema", &moved]);
        assert_eq!(stacks.redo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(reference(temporary.path(), "refs/heads/tema"), Some(moved));
        assert_eq!(stacks.read("repo").redo.len(), 1);
    }

    #[test]
    fn deshace_y_rehace_un_commit_con_reset_suave_atomico() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        let before = output(temporary.path(), &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        fs::write(temporary.path().join("archivo.txt"), "cambio\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let stacks = UndoStacks::default();
        let after = commit_and_remember(temporary.path(), &stacks, false);

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["rev-parse", "HEAD"]).trim(),
            before
        );
        assert!(output(temporary.path(), &["diff", "--cached"]).contains("+cambio"));
        assert_eq!(stacks.read("repo").redo.len(), 1);

        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["rev-parse", "HEAD"]).trim(),
            after
        );
        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn deshace_y_rehace_el_primer_commit_sin_perder_el_indice() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "primero\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let stacks = UndoStacks::default();
        let after = commit_and_remember(temporary.path(), &stacks, false);

        stacks.undo("repo", temporary.path()).unwrap();
        assert!(Command::new("git")
            .args(["rev-parse", "--verify", "HEAD"])
            .current_dir(temporary.path())
            .status()
            .unwrap()
            .code()
            .is_some_and(|code| code != 0));
        assert!(output(temporary.path(), &["diff", "--cached", "--stat"]).contains("archivo.txt"));

        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["rev-parse", "HEAD"]).trim(),
            after
        );
    }

    #[test]
    fn deshace_y_rehace_amend_restaurando_el_commit_anterior() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "original"]);
        let before = output(temporary.path(), &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        fs::write(temporary.path().join("archivo.txt"), "amend\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let stacks = UndoStacks::default();
        let after = commit_and_remember(temporary.path(), &stacks, true);

        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["rev-parse", "HEAD"]).trim(),
            before
        );
        assert!(output(temporary.path(), &["diff", "--cached"]).contains("+amend"));

        stacks.redo("repo", temporary.path()).unwrap();
        assert_eq!(
            output(temporary.path(), &["rev-parse", "HEAD"]).trim(),
            after
        );
    }

    #[test]
    fn un_cambio_posterior_hace_stale_sin_mover_head() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "uno\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let stacks = UndoStacks::default();
        let after = commit_and_remember(temporary.path(), &stacks, false);
        fs::write(temporary.path().join("otro.txt"), "dos\n").unwrap();
        git(temporary.path(), &["add", "otro.txt"]);

        assert_eq!(stacks.undo("repo", temporary.path()), Err(UndoError::Stale));
        assert_eq!(
            output(temporary.path(), &["rev-parse", "HEAD"]).trim(),
            after
        );
    }

    #[test]
    fn una_escritura_nueva_vacia_redo() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "uno\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let stacks = UndoStacks::default();
        commit_and_remember(temporary.path(), &stacks, false);
        stacks.undo("repo", temporary.path()).unwrap();
        assert_eq!(stacks.read("repo").redo.len(), 1);

        stacks.clear_redo("repo");
        assert!(stacks.read("repo").redo.is_empty());
    }
}

fn ensure_idle(repository: &Path) -> Result<(), UndoError> {
    let current = super::repository::discover(repository).map_err(|_| UndoError::GitFailed)?;
    if !matches!(current.operation(), super::repository::RepoOperation::None)
        || super::stash::recovery_kind(repository).is_some()
    {
        return Err(UndoError::Stale);
    }
    Ok(())
}

fn ensure_branch(repository: &Path, expected: &str) -> Result<(), UndoError> {
    let actual = git_text(repository, &["symbolic-ref", "--short", "-q", "HEAD"])
        .unwrap_or_else(|| "HEAD".to_owned());
    if actual == expected {
        Ok(())
    } else {
        Err(UndoError::Stale)
    }
}

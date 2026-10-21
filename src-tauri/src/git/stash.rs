//! Guardados reales, dirigidos por el OID y la foto de trabajo observados.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::Path;
use std::process::{Output, Stdio};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::diagnostics::Diagnostic;
use super::refs::{self, RefsSnapshot};
use super::repository::{self, RepoOperation};
use super::status::{self, ResetPrecondition, WorkingStatus};

pub(super) mod paths;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStashOptions {
    include_untracked: Option<bool>,
    keep_staged: Option<bool>,
    paths: Option<Vec<String>>,
    precondition: ResetPrecondition,
}

impl CreateStashOptions {
    pub(super) fn includes_untracked(&self) -> bool {
        self.include_untracked == Some(true)
    }

    pub(super) fn literal_paths(&self) -> Vec<String> {
        self.paths
            .iter()
            .flatten()
            .map(|path| format!(":(literal){path}"))
            .collect()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStashOptions {
    drop: Option<bool>,
    paths: Option<Vec<String>>,
    pub(super) expected_stash: String,
    precondition: ResetPrecondition,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StashError {
    Stale(String),
    NothingToStash,
    PartialConflict(Diagnostic),
    PartialUnsupported,
    Conflict {
        stash: String,
        branch: String,
        count: usize,
        diagnostic: Diagnostic,
    },
    AutoConflict {
        count: usize,
        diagnostic: Diagnostic,
    },
    BlockedByWip {
        stash: String,
        branch: String,
        count: usize,
        diagnostic: Diagnostic,
    },
    RecoveryMissing,
    StillConflicted(usize),
    GitFailed,
    Diagnostic(Diagnostic),
}

struct CommandOutput {
    output: Output,
    diagnostic: Diagnostic,
}

impl std::ops::Deref for CommandOutput {
    type Target = Output;

    fn deref(&self) -> &Self::Target {
        &self.output
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StashRecoveryKind {
    Apply,
    Pop,
    AutoStash,
}

#[derive(Debug)]
struct RecoveryRefs {
    prefix: String,
}

impl RecoveryRefs {
    fn manual() -> Self {
        Self {
            prefix: "refs/gitthul/stash-recovery".to_owned(),
        }
    }

    fn autostash(repository: &Path) -> Result<Self, StashError> {
        let repo = gix::open(repository).map_err(|error| {
            StashError::Diagnostic(Diagnostic::cause("stash.recoveryGitDir", &error))
        })?;
        let git_dir = std::fs::canonicalize(repo.git_dir()).map_err(|error| {
            StashError::Diagnostic(Diagnostic::io("stash.recoveryGitDir", &error))
        })?;
        let identity = Sha256::digest(git_dir.as_os_str().as_encoded_bytes());
        Ok(Self {
            prefix: format!("refs/gitthul/autostash-recovery/{identity:x}"),
        })
    }

    fn for_kind(repository: &Path, kind: StashRecoveryKind) -> Result<Self, StashError> {
        match kind {
            StashRecoveryKind::AutoStash => Self::autostash(repository),
            StashRecoveryKind::Apply | StashRecoveryKind::Pop => Ok(Self::manual()),
        }
    }

    fn reference(&self, suffix: &str) -> String {
        format!("{}/{suffix}", self.prefix)
    }

    fn present(&self, repository: &Path) -> bool {
        command(
            repository,
            &[
                "for-each-ref",
                "--count=1",
                "--format=%(refname)",
                &format!("{}/", self.prefix),
            ],
        )
        .is_ok_and(|output| output.status.success() && !output.stdout.is_empty())
    }
}

/// Evidence captured before Git may create or reapply its own autostash.
pub(super) struct AutostashObservation {
    head: Option<String>,
    stash: Option<String>,
    pending: Option<String>,
    tracked_changes: bool,
}

impl AutostashObservation {
    pub(super) fn capture(repository: &Path) -> Result<Self, StashError> {
        let repo = gix::open(repository).map_err(|error| {
            StashError::Diagnostic(Diagnostic::cause("stash.observeAutostash", &error))
        })?;
        let pending = [
            "MERGE_AUTOSTASH",
            "rebase-merge/autostash",
            "rebase-apply/autostash",
        ]
        .into_iter()
        .find_map(|relative| {
            std::fs::read_to_string(repo.git_dir().join(relative))
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .and_then(|value| resolve(repository, &format!("{value}^{{commit}}")))
        });
        let tracked = command(
            repository,
            &[
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "-z",
                "--untracked-files=no",
                "--no-renames",
            ],
        )?;
        if !tracked.status.success() {
            return Err(StashError::Diagnostic(tracked.diagnostic));
        }
        Ok(Self {
            head: resolve(repository, "HEAD"),
            stash: resolve(repository, "refs/stash"),
            pending,
            tracked_changes: !tracked.stdout.is_empty(),
        })
    }

    /// Only register a newly materialized Git autostash with a proven origin.
    pub(super) fn recover_if_conflicted(&self, repository: &Path) -> Result<bool, StashError> {
        if (!self.tracked_changes && self.pending.is_none()) || recovery_kind(repository).is_some()
        {
            return Ok(false);
        }
        let current = repository::discover(repository).map_err(StashError::Diagnostic)?;
        if !matches!(current.operation(), RepoOperation::None)
            || read_status(repository)?.conflicted_count() == 0
        {
            return Ok(false);
        }
        let Some(target) = resolve(repository, "refs/stash") else {
            return Ok(false);
        };
        if self.stash.as_deref() == Some(target.as_str()) {
            return Ok(false);
        }
        if let Some(pending) = &self.pending {
            if pending != &target {
                return Ok(false);
            }
        } else if resolve(repository, &format!("{target}^1")) != self.head {
            return Ok(false);
        }
        let subject = command(
            repository,
            &["log", "-g", "-1", "--format=%gs", "refs/stash"],
        )?;
        if !subject.status.success() {
            return Err(StashError::Diagnostic(subject.diagnostic));
        }
        if subject.stdout.as_slice().trim_ascii() != b"autostash" {
            return Ok(false);
        }
        adopt_autostash_recovery(repository, &target)?;
        Ok(true)
    }
}

pub(super) fn diagnostic(error: StashError, stage: &str) -> Diagnostic {
    match error {
        StashError::Diagnostic(diagnostic)
        | StashError::Conflict { diagnostic, .. }
        | StashError::AutoConflict { diagnostic, .. }
        | StashError::BlockedByWip { diagnostic, .. } => diagnostic,
        error => Diagnostic::new(stage, format!("{error:?}")),
    }
}

fn read_status(repository: &Path) -> Result<WorkingStatus, StashError> {
    status::read(repository).map_err(|error| {
        StashError::Diagnostic(match error {
            status::ReadStatusError::Diagnostic(diagnostic) => diagnostic,
            error => Diagnostic::new("stash.readStatus", format!("{error:?}")),
        })
    })
}

/// Git already applied this known autostash after finishing an integration.
/// Abort removes that application, keeping the new HEAD and the original stash.
pub(super) fn adopt_autostash_recovery(
    repository: &Path,
    expected_stash: &str,
) -> Result<(), StashError> {
    ensure_recovery_absent(repository)?;
    verify_stash(repository, "refs/stash", expected_stash)?;
    let current = repository::discover(repository).map_err(StashError::Diagnostic)?;
    if !matches!(current.operation(), RepoOperation::None)
        || read_status(repository)?.conflicted_count() == 0
    {
        return Err(StashError::Stale("autostash conflict".to_owned()));
    }
    let parents = command(
        repository,
        &["rev-list", "--parents", "--max-count=1", expected_stash],
    )?;
    if !parents.status.success() {
        return Err(StashError::Diagnostic(parents.diagnostic));
    }
    // Git's autostash contains tracked work and index only. A third parent
    // would introduce untracked restoration/cleanup outside this baseline.
    if parents
        .stdout
        .split(|byte| byte.is_ascii_whitespace())
        .filter(|part| !part.is_empty())
        .count()
        != 3
    {
        return Err(StashError::Stale("autostash parents".to_owned()));
    }
    let head = resolve(repository, "HEAD").ok_or(StashError::GitFailed)?;
    verify_stash(repository, "refs/stash", expected_stash)?;
    let recovery_refs = RecoveryRefs::autostash(repository)?;
    publish_autostash_recovery(repository, &recovery_refs, &head, expected_stash, &head)?;
    Ok(())
}

pub fn create(
    repository: &Path,
    message: &str,
    options: &CreateStashOptions,
) -> Result<RefsSnapshot, StashError> {
    verify_worktree(repository, &options.precondition)?;
    let before = resolve(repository, "refs/stash");
    let mut args = vec!["stash", "push", "--quiet"];
    if options.includes_untracked() {
        args.push("--include-untracked");
    }
    if options.keep_staged == Some(true) {
        args.push("--keep-index");
    }
    args.extend(["-m", message]);
    let literal_paths = options.literal_paths();
    if !literal_paths.is_empty() {
        args.push("--");
        args.extend(literal_paths.iter().map(String::as_str));
    }

    let output = command(repository, &args)?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    let after = resolve(repository, "refs/stash");
    if after.is_none() || after == before {
        return Err(StashError::NothingToStash);
    }
    refs::read(repository).map_err(|error| StashError::Diagnostic(refs_diagnostic(error)))
}

pub fn apply(
    repository: &Path,
    index: usize,
    options: &ApplyStashOptions,
) -> Result<WorkingStatus, StashError> {
    // Partial application must go through its prepared, scoped checkpoint path.
    if options.paths.is_some() {
        return Err(StashError::PartialUnsupported);
    }
    verify_worktree(repository, &options.precondition)?;
    let selector = format!("stash@{{{index}}}");
    verify_stash(repository, &selector, &options.expected_stash)?;
    apply_with_recovery(
        repository,
        &options.expected_stash,
        &selector,
        if options.drop == Some(true) {
            StashRecoveryKind::Pop
        } else {
            StashRecoveryKind::Apply
        },
        &options.precondition,
    )
}

/// Checkout knows the exact stash it created; never pop an unrelated new top.
pub(super) fn apply_autostash(
    repository: &Path,
    expected_stash: &str,
) -> Result<WorkingStatus, StashError> {
    verify_stash(repository, "refs/stash", expected_stash)?;
    apply_with_recovery(
        repository,
        expected_stash,
        expected_stash,
        StashRecoveryKind::AutoStash,
        &status::reset_precondition(repository),
    )
}

fn apply_with_recovery(
    repository: &Path,
    expected_stash: &str,
    selector: &str,
    kind: StashRecoveryKind,
    precondition: &ResetPrecondition,
) -> Result<WorkingStatus, StashError> {
    prepare_recovery_kind(repository, expected_stash, kind)?;
    let mut output = command(repository, &["stash", "apply", "--index", expected_stash])?;
    // Git cannot restore a staged stash patch onto a diverged index. It stops
    // before the three-way merge and explicitly asks to retry without --index.
    // Only retry that failure, and only while all user content is unchanged.
    if !output.status.success()
        && String::from_utf8_lossy(&output.stderr)
            .contains("conflicts in index. Try without --index.")
        && status::reset_precondition(repository) == *precondition
    {
        output = command(repository, &["stash", "apply", expected_stash])?;
    }
    if !output.status.success() {
        let current = status::read(repository).map_err(|error| {
            StashError::Diagnostic(match error {
                status::ReadStatusError::Diagnostic(diagnostic) => diagnostic,
                error => Diagnostic::new("stash.readStatus", format!("{error:?}")),
            })
        })?;
        let count = current.conflicted_count();
        if count > 0 {
            if kind == StashRecoveryKind::AutoStash {
                return Err(StashError::AutoConflict {
                    count,
                    diagnostic: output.diagnostic,
                });
            }
            return Err(StashError::Conflict {
                stash: selector.to_owned(),
                branch: branch(repository),
                count,
                diagnostic: output.diagnostic,
            });
        }
        let changed = current.change_count();
        let diagnostic = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        let blocked = changed > 0
            && (diagnostic.contains("would be overwritten")
                || diagnostic.contains("local changes")
                || diagnostic.contains("already exists, no checkout"));
        abort_recovery(repository)?;
        if blocked {
            return Err(StashError::BlockedByWip {
                stash: selector.to_owned(),
                branch: branch(repository),
                count: changed,
                diagnostic: output.diagnostic,
            });
        }
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    if kind != StashRecoveryKind::Apply {
        drop_stash_oid(repository, expected_stash)?;
    }
    clear_recovery(repository)?;
    status::read(repository).map_err(|error| {
        StashError::Diagnostic(match error {
            status::ReadStatusError::Diagnostic(diagnostic) => diagnostic,
            error => Diagnostic::new("stash.readStatus", format!("{error:?}")),
        })
    })
}

/** Termina una aplicación conflictiva; Pop retira el stash solo en este punto. */
pub fn finish_recovery(repository: &Path) -> Result<(), StashError> {
    let recovery = read_recovery(repository)?;
    let conflicts = status::read(repository)
        .map_err(|error| {
            StashError::Diagnostic(match error {
                status::ReadStatusError::Diagnostic(diagnostic) => diagnostic,
                error => Diagnostic::new("stash.readStatus", format!("{error:?}")),
            })
        })?
        .conflicted_count();
    if conflicts > 0 {
        return Err(StashError::StillConflicted(conflicts));
    }
    if recovery.kind != StashRecoveryKind::Apply {
        drop_stash_oid(repository, &recovery.target)?;
    }
    let cleared = clear_recovery_state(repository, &recovery);
    if recovery.kind == StashRecoveryKind::AutoStash {
        if let Err(error) = cleared {
            if let Err(preserve_error) = ensure_stash_visible(repository, &recovery.target) {
                return Err(StashError::Diagnostic(
                    diagnostic(error, "stash.finishRecovery").with_context(format!(
                        "Preserving the originating autostash also failed: {}",
                        diagnostic(preserve_error, "stash.preserveAutostash")
                    )),
                ));
            }
            return Err(error);
        }
    }
    cleared
}

/** Restaura HEAD, índice, árbol rastreado y no seguidos capturados antes del stash. */
pub fn abort_recovery(repository: &Path) -> Result<(), StashError> {
    let recovery = read_recovery(repository)?;
    if resolve(repository, "HEAD").as_deref() != Some(recovery.head.as_str()) {
        return Err(StashError::Stale("HEAD".to_owned()));
    }

    if recovery.kind == StashRecoveryKind::AutoStash {
        ensure_stash_visible(repository, &recovery.target)?;
    }

    let reset = command(repository, &["reset", "--hard", &recovery.head])?;
    if !reset.status.success() {
        return Err(StashError::Diagnostic(reset.diagnostic));
    }

    let mut untracked = untracked_paths(repository, &recovery.target)?;
    untracked.extend(untracked_paths(repository, &recovery.before)?);
    clean_paths(repository, &untracked)?;

    if recovery.before != recovery.head {
        let restored = command(repository, &["stash", "apply", "--index", &recovery.before])?;
        if !restored.status.success() {
            return Err(StashError::Diagnostic(restored.diagnostic));
        }
    }
    clear_recovery_state(repository, &recovery)
}

pub fn recovery_kind(repository: &Path) -> Option<StashRecoveryKind> {
    read_recovery(repository).ok().map(|recovery| recovery.kind)
}

pub(super) fn abort_restore_trees(
    repository: &Path,
) -> Result<(Vec<String>, Vec<String>), StashError> {
    let recovery = read_recovery(repository)?;
    let mut trees = vec![recovery.head.clone()];
    let mut untracked = Vec::new();
    if recovery.before != recovery.head {
        trees.extend([recovery.before.clone(), format!("{}^2", recovery.before)]);
        let third = format!("{}^3", recovery.before);
        if resolve(repository, &third).is_some() {
            untracked.push(third);
        }
    }
    // The target's untracked parent can be cleaned even when a file wasn't
    // restored by the failed application. Include ignored collisions too.
    let third = format!("{}^3", recovery.target);
    if resolve(repository, &third).is_some() {
        untracked.push(third);
    }
    Ok((trees, untracked))
}

#[derive(Debug)]
struct StashRecovery {
    before: String,
    target: String,
    head: String,
    kind: StashRecoveryKind,
    refs: RecoveryRefs,
}

#[cfg(test)]
fn prepare_recovery(repository: &Path, target: &str, pop: bool) -> Result<(), StashError> {
    prepare_recovery_kind(
        repository,
        target,
        if pop {
            StashRecoveryKind::Pop
        } else {
            StashRecoveryKind::Apply
        },
    )
}

fn ensure_recovery_absent(repository: &Path) -> Result<(), StashError> {
    if RecoveryRefs::manual().present(repository)
        || RecoveryRefs::autostash(repository)?.present(repository)
    {
        return Err(StashError::Stale("stash recovery".to_owned()));
    }
    Ok(())
}

fn prepare_recovery_kind(
    repository: &Path,
    target: &str,
    kind: StashRecoveryKind,
) -> Result<(), StashError> {
    ensure_recovery_absent(repository)?;
    let recovery_refs = RecoveryRefs::for_kind(repository, kind)?;
    let head = resolve(repository, "HEAD").ok_or(StashError::GitFailed)?;
    let status = command(
        repository,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--no-renames",
        ],
    )?;
    if !status.status.success() {
        return Err(StashError::Diagnostic(status.diagnostic));
    }
    // With a clean index/worktree there is nothing to stash temporarily.
    // HEAD already provides the exact state needed to abort a conflicted pop.
    let before = if status.stdout.is_empty() {
        head.clone()
    } else {
        let previous_top = resolve(repository, "refs/stash");
        let snapshot = recovery_snapshot(
            repository,
            &[
                "stash",
                "push",
                "--quiet",
                "--include-untracked",
                "-m",
                "GitThul recovery",
            ],
        )?;
        if !snapshot.status.success() {
            return Err(StashError::Diagnostic(snapshot.diagnostic));
        }
        resolve(repository, "refs/stash")
            .filter(|current| Some(current) != previous_top.as_ref())
            .unwrap_or_else(|| head.clone())
    };

    if kind == StashRecoveryKind::AutoStash {
        // Restore the baseline while the temporary snapshot is still in the
        // stash. A failed atomic registration must leave that work unchanged.
        if before != head {
            let restored = command(repository, &["stash", "apply", "--index", &before])?;
            if !restored.status.success() {
                return Err(StashError::Diagnostic(restored.diagnostic));
            }
        }
        let published =
            publish_autostash_recovery(repository, &recovery_refs, &before, target, &head);
        if before != head {
            drop_stash_oid(repository, &before)?;
        }
        return published;
    }

    update_ref(repository, &recovery_refs.reference("before"), &before)?;
    update_ref(repository, &recovery_refs.reference("target"), target)?;
    update_ref(repository, &recovery_refs.reference("head"), &head)?;
    if kind == StashRecoveryKind::Pop {
        update_ref(repository, &recovery_refs.reference("pop"), target)?;
    }
    if before != head {
        let restored = command(repository, &["stash", "apply", "--index", &before])?;
        if !restored.status.success() {
            return Err(StashError::Diagnostic(restored.diagnostic));
        }
        drop_stash_oid(repository, &before)?;
    }
    Ok(())
}

fn read_recovery(repository: &Path) -> Result<StashRecovery, StashError> {
    let autostash_refs = RecoveryRefs::autostash(repository)?;
    let automatic = autostash_refs.present(repository);
    let recovery_refs = if automatic {
        autostash_refs
    } else {
        RecoveryRefs::manual()
    };
    let before = resolve(repository, &recovery_refs.reference("before"))
        .ok_or(StashError::RecoveryMissing)?;
    let target = resolve(repository, &recovery_refs.reference("target"))
        .ok_or(StashError::RecoveryMissing)?;
    let head =
        resolve(repository, &recovery_refs.reference("head")).ok_or(StashError::RecoveryMissing)?;
    let kind = if automatic {
        if resolve(repository, &recovery_refs.reference("autostash")).as_deref()
            != Some(target.as_str())
        {
            return Err(StashError::RecoveryMissing);
        }
        StashRecoveryKind::AutoStash
    } else if resolve(repository, &recovery_refs.reference("pop")).is_some() {
        StashRecoveryKind::Pop
    } else {
        StashRecoveryKind::Apply
    };
    Ok(StashRecovery {
        before,
        target,
        head,
        kind,
        refs: recovery_refs,
    })
}

fn clear_recovery(repository: &Path) -> Result<(), StashError> {
    let recovery = read_recovery(repository)?;
    clear_recovery_state(repository, &recovery)
}

fn clear_recovery_state(repository: &Path, recovery: &StashRecovery) -> Result<(), StashError> {
    if recovery.kind == StashRecoveryKind::AutoStash {
        return autostash_ref_transaction(
            repository,
            &format!(
                "start\ndelete {} {}\ndelete {} {}\ndelete {} {}\ndelete {} {}\nprepare\ncommit\n",
                recovery.refs.reference("before"),
                recovery.before,
                recovery.refs.reference("target"),
                recovery.target,
                recovery.refs.reference("head"),
                recovery.head,
                recovery.refs.reference("autostash"),
                recovery.target,
            ),
        );
    }
    for suffix in ["pop", "before", "target", "head"] {
        let reference = recovery.refs.reference(suffix);
        let output = command(repository, &["update-ref", "-d", &reference])?;
        if !output.status.success() {
            return Err(StashError::Diagnostic(output.diagnostic));
        }
    }
    Ok(())
}

fn publish_autostash_recovery(
    repository: &Path,
    recovery_refs: &RecoveryRefs,
    before: &str,
    target: &str,
    head: &str,
) -> Result<(), StashError> {
    autostash_ref_transaction(
        repository,
        &format!(
            "start\ncreate {} {}\ncreate {} {}\ncreate {} {}\ncreate {} {}\nprepare\ncommit\n",
            recovery_refs.reference("before"),
            before,
            recovery_refs.reference("target"),
            target,
            recovery_refs.reference("head"),
            head,
            recovery_refs.reference("autostash"),
            target,
        ),
    )
}

fn autostash_ref_transaction(repository: &Path, input: &str) -> Result<(), StashError> {
    let args = ["update-ref", "--no-deref", "--stdin"];
    let mut child = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            StashError::Diagnostic(Diagnostic::command_io(
                "stash.publishRecovery",
                &args,
                &error,
            ))
        })?;
    let write = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("Git stdin unavailable"))
        .and_then(|mut stdin| stdin.write_all(input.as_bytes()));
    if let Err(error) = write {
        let _ = child.kill();
        let _ = child.wait();
        return Err(StashError::Diagnostic(Diagnostic::command_io(
            "stash.publishRecovery",
            &args,
            &error,
        )));
    }
    let output = child.wait_with_output().map_err(|error| {
        StashError::Diagnostic(Diagnostic::command_io(
            "stash.publishRecovery",
            &args,
            &error,
        ))
    })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(StashError::Diagnostic(Diagnostic::command(
            "stash.publishRecovery",
            &args,
            &output,
        )))
    }
}

fn update_ref(repository: &Path, reference: &str, oid: &str) -> Result<(), StashError> {
    let output = command(repository, &["update-ref", reference, oid])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(StashError::Diagnostic(output.diagnostic))
    }
}

fn drop_stash_oid(repository: &Path, oid: &str) -> Result<(), StashError> {
    let output = command(repository, &["stash", "list", "--format=%H"])?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    let Some(index) = String::from_utf8(output.output.stdout)
        .map_err(|error| StashError::Diagnostic(Diagnostic::new("stash.decodeList", error)))?
        .lines()
        .position(|candidate| candidate == oid)
    else {
        return Ok(());
    };
    let selector = format!("stash@{{{index}}}");
    let dropped = command(repository, &["stash", "drop", "--quiet", &selector])?;
    if dropped.status.success() {
        Ok(())
    } else {
        Err(StashError::Diagnostic(dropped.diagnostic))
    }
}

/// Recovery refs keep the object alive, but cancellation must also leave the
/// original work discoverable through the ordinary stash list.
fn ensure_stash_visible(repository: &Path, oid: &str) -> Result<(), StashError> {
    let output = command(repository, &["stash", "list", "--format=%H"])?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    if String::from_utf8(output.output.stdout)
        .map_err(|error| StashError::Diagnostic(Diagnostic::new("stash.decodeList", error)))?
        .lines()
        .any(|candidate| candidate == oid)
    {
        return Ok(());
    }
    let stored = command(repository, &["stash", "store", "-m", "autostash", oid])?;
    if stored.status.success() {
        Ok(())
    } else {
        Err(StashError::Diagnostic(stored.diagnostic))
    }
}

fn untracked_paths(repository: &Path, stash_oid: &str) -> Result<BTreeSet<String>, StashError> {
    let third_parent = format!("{stash_oid}^3");
    let Some(tree) = resolve(repository, &third_parent) else {
        return Ok(BTreeSet::new());
    };
    let output = command(repository, &["ls-tree", "-r", "-z", "--name-only", &tree])?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| {
            String::from_utf8(path.to_vec())
                .map_err(|error| StashError::Diagnostic(Diagnostic::new("stash.decodeList", error)))
        })
        .collect()
}

fn clean_paths(repository: &Path, paths: &BTreeSet<String>) -> Result<(), StashError> {
    if paths.is_empty() {
        return Ok(());
    }
    let literal = paths
        .iter()
        .map(|path| format!(":(literal){path}"))
        .collect::<Vec<_>>();
    let mut args = vec!["clean", "-f", "-d", "--"];
    args.extend(literal.iter().map(String::as_str));
    let output = command(repository, &args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(StashError::Diagnostic(output.diagnostic))
    }
}

pub fn drop(
    repository: &Path,
    index: usize,
    expected_stash: &str,
) -> Result<RefsSnapshot, StashError> {
    let selector = format!("stash@{{{index}}}");
    verify_stash(repository, &selector, expected_stash)?;
    let output = command(repository, &["stash", "drop", "--quiet", &selector])?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    refs::read(repository).map_err(|error| StashError::Diagnostic(refs_diagnostic(error)))
}

pub fn rename(
    repository: &Path,
    index: usize,
    expected_stash: &str,
    message: &str,
) -> Result<RefsSnapshot, StashError> {
    let selector = format!("stash@{{{index}}}");
    verify_stash(repository, &selector, expected_stash)?;
    let output = command(repository, &["stash", "list", "-z", "--format=%H%x00%gs"])?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    let fields = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .map(|field| {
            String::from_utf8(field.to_vec())
                .map_err(|error| StashError::Diagnostic(Diagnostic::new("stash.decodeList", error)))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut entries = fields
        .chunks_exact(2)
        .map(|fields| (fields[0].clone(), fields[1].clone()))
        .collect::<Vec<_>>();
    if entries.len() * 2 != fields.len() || index >= entries.len() {
        return Err(StashError::Stale(selector));
    }
    entries[index].1 = renamed_subject(&entries[index].1, message);

    let cleared = command(repository, &["stash", "clear"])?;
    if !cleared.status.success() {
        return Err(StashError::Diagnostic(cleared.diagnostic));
    }
    for (sha, subject) in entries.iter().rev() {
        let stored = command(repository, &["stash", "store", "-m", subject, sha])?;
        if !stored.status.success() {
            return Err(StashError::Diagnostic(stored.diagnostic));
        }
    }
    refs::read(repository).map_err(|error| StashError::Diagnostic(refs_diagnostic(error)))
}

fn refs_diagnostic(error: refs::ReadRefsError) -> Diagnostic {
    match error {
        refs::ReadRefsError::GitFailed(diagnostic) => diagnostic,
        error => Diagnostic::new("stash.refreshRefs", error),
    }
}

fn renamed_subject(current: &str, message: &str) -> String {
    for prefix in ["WIP on ", "On "] {
        if let Some((branch, _)) = current
            .strip_prefix(prefix)
            .and_then(|text| text.split_once(": "))
        {
            return format!("On {branch}: {}", message.trim());
        }
    }
    message.trim().to_owned()
}

fn verify_worktree(repository: &Path, expected: &ResetPrecondition) -> Result<(), StashError> {
    if status::reset_precondition(repository) != *expected {
        return Err(StashError::Stale("HEAD".to_owned()));
    }
    Ok(())
}

fn verify_stash(repository: &Path, selector: &str, expected: &str) -> Result<(), StashError> {
    if resolve(repository, selector).as_deref() != Some(expected) {
        return Err(StashError::Stale(selector.to_owned()));
    }
    Ok(())
}

fn resolve(repository: &Path, reference: &str) -> Option<String> {
    let output = command(repository, &["rev-parse", "--verify", reference]).ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8(output.output.stdout)
            .ok()?
            .trim()
            .to_owned(),
    )
}

fn branch(repository: &Path) -> String {
    let output = command(repository, &["symbolic-ref", "--quiet", "--short", "HEAD"]);
    output
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.output.stdout).ok())
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "HEAD".to_owned())
}

fn command(repository: &Path, args: &[&str]) -> Result<CommandOutput, StashError> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            StashError::Diagnostic(Diagnostic::command_io("stash.spawn", args, &error))
        })?;
    let diagnostic = Diagnostic::command("stash.execute", args, &output);
    Ok(CommandOutput { output, diagnostic })
}

/** La captura privada no depende de que el repositorio tenga identidad para commits. */
fn recovery_snapshot(repository: &Path, args: &[&str]) -> Result<CommandOutput, StashError> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "GitThul recovery")
        .env("GIT_AUTHOR_EMAIL", "recovery@gitthul.invalid")
        .env("GIT_COMMITTER_NAME", "GitThul recovery")
        .env("GIT_COMMITTER_EMAIL", "recovery@gitthul.invalid")
        .output()
        .map_err(|error| {
            StashError::Diagnostic(Diagnostic::command_io("stash.spawn", args, &error))
        })?;
    let diagnostic = Diagnostic::command("stash.execute", args, &output);
    Ok(CommandOutput { output, diagnostic })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::process::Command;

    use tempfile::TempDir;

    use super::*;

    fn git(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn repository() -> TempDir {
        let temporary = TempDir::new().unwrap();
        git(temporary.path(), &["init", "-b", "main"]);
        git(temporary.path(), &["config", "user.name", "GitThul"]);
        git(
            temporary.path(),
            &["config", "user.email", "gitthul@example.test"],
        );
        fs::write(temporary.path().join("tracked.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "tracked.txt"]);
        git(temporary.path(), &["commit", "-m", "inicio"]);
        temporary
    }

    fn create_options(path: &Path) -> CreateStashOptions {
        CreateStashOptions {
            include_untracked: Some(true),
            keep_staged: Some(false),
            paths: None,
            precondition: status::reset_precondition(path),
        }
    }

    #[test]
    fn clean_recovery_uses_head_without_rewriting_index_or_stash_log() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "stash edit\n").unwrap();
        create(path, "saved", &create_options(path)).unwrap();
        let target = resolve(path, "stash@{0}").unwrap();
        let head = resolve(path, "HEAD").unwrap();
        let index = path.join(".git/index");
        let index_bytes = fs::read(&index).unwrap();
        let index_modified = fs::metadata(&index).unwrap().modified().unwrap();
        let log = fs::read(path.join(".git/logs/refs/stash")).unwrap();
        prepare_recovery(path, &target, true).unwrap();
        let recovery = read_recovery(path).unwrap();
        assert_eq!(recovery.before, head);
        assert_eq!(recovery.target, target);
        assert_eq!(fs::read(&index).unwrap(), index_bytes);
        assert_eq!(
            fs::metadata(&index).unwrap().modified().unwrap(),
            index_modified
        );
        assert_eq!(fs::read(path.join(".git/logs/refs/stash")).unwrap(), log);
        abort_recovery(path).unwrap();
        assert_eq!(resolve(path, "stash@{0}").unwrap(), target);
    }

    #[test]
    fn unmerged_index_is_not_treated_as_clean_recovery() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "stash edit\n").unwrap();
        create(path, "saved", &create_options(path)).unwrap();
        let target = resolve(path, "stash@{0}").unwrap();
        git(path, &["checkout", "-b", "other"]);
        fs::write(path.join("tracked.txt"), "other\n").unwrap();
        git(path, &["commit", "-am", "other"]);
        git(path, &["checkout", "main"]);
        fs::write(path.join("tracked.txt"), "main\n").unwrap();
        git(path, &["commit", "-am", "main"]);
        assert!(!command(path, &["merge", "other"]).unwrap().status.success());
        let index = fs::read(path.join(".git/index")).unwrap();
        let content = fs::read(path.join("tracked.txt")).unwrap();
        assert!(matches!(
            prepare_recovery(path, &target, true),
            Err(StashError::GitFailed | StashError::Diagnostic(_))
        ));
        assert!(recovery_kind(path).is_none());
        assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), content);
        assert_eq!(resolve(path, "stash@{0}").unwrap(), target);
        assert!(path.join(".git/MERGE_HEAD").exists());
    }

    #[test]
    fn crea_y_aplica_sin_descartar_el_guardado() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "cambio\n").unwrap();
        fs::write(path.join("untracked.fixture"), "nuevo\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let stash = resolve(path, "stash@{0}").unwrap();
        assert!(
            !path.join("untracked.fixture").exists(),
            "{}",
            git(path, &["status", "--porcelain"])
        );

        let options = ApplyStashOptions {
            paths: None,
            drop: Some(false),
            expected_stash: stash,
            precondition: status::reset_precondition(path),
        };
        apply(path, 0, &options).unwrap();

        assert_eq!(
            fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "cambio\n"
        );
        assert!(path.join("untracked.fixture").exists());
        assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
    }

    #[test]
    fn pop_descarta_solo_despues_de_aplicar_limpio() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "cambio\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(true),
            expected_stash: resolve(path, "stash@{0}").unwrap(),
            precondition: status::reset_precondition(path),
        };

        apply(path, 0, &options).unwrap();
        assert!(git(path, &["stash", "list"]).is_empty());
    }

    #[test]
    fn oid_o_arbol_obsoletos_no_escriben() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "cambio\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let clean = status::reset_precondition(path);
        fs::write(path.join("tracked.txt"), "externo\n").unwrap();
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(true),
            expected_stash: resolve(path, "stash@{0}").unwrap(),
            precondition: clean,
        };
        assert!(matches!(
            apply(path, 0, &options),
            Err(StashError::Stale(_))
        ));
        assert!(matches!(drop(path, 0, "0"), Err(StashError::Stale(_))));
        assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
    }

    #[test]
    fn una_seleccion_guarda_solo_sus_rutas_literales() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("other.txt"), "base\n").unwrap();
        git(path, &["add", "other.txt"]);
        git(path, &["commit", "-m", "segundo"]);
        fs::write(path.join("tracked.txt"), "guardado\n").unwrap();
        fs::write(path.join("other.txt"), "visible\n").unwrap();
        let mut options = create_options(path);
        options.paths = Some(vec!["tracked.txt".to_owned()]);

        create(path, "parcial", &options).unwrap();

        assert_eq!(
            fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            fs::read_to_string(path.join("other.txt")).unwrap(),
            "visible\n"
        );
        assert_eq!(git(path, &["stash", "show", "--name-only"]), "tracked.txt");
    }

    #[test]
    fn staged_stash_on_diverged_branch_opens_conflicts_and_keeps_recovery() {
        for pop in [false, true] {
            for finish in [false, true] {
                let temporary = repository();
                let path = temporary.path();
                fs::write(path.join("tracked.txt"), "staged stash\n").unwrap();
                git(path, &["add", "tracked.txt"]);
                create(path, "saved", &create_options(path)).unwrap();
                let target = resolve(path, "stash@{0}").unwrap();
                fs::write(path.join("tracked.txt"), "branch edit\n").unwrap();
                git(path, &["commit", "-am", "diverged"]);
                let options = ApplyStashOptions {
                    paths: None,
                    drop: Some(pop),
                    expected_stash: target.clone(),
                    precondition: status::reset_precondition(path),
                };

                // This used to fail before producing any unmerged index entries.
                assert!(matches!(
                    apply(path, 0, &options),
                    Err(StashError::Conflict { count: 1, .. })
                ));
                assert_eq!(resolve(path, "stash@{0}").unwrap(), target);
                assert_eq!(status::read(path).unwrap().conflicted_count(), 1);
                assert_eq!(
                    recovery_kind(path),
                    Some(if pop {
                        StashRecoveryKind::Pop
                    } else {
                        StashRecoveryKind::Apply
                    })
                );
                if finish {
                    fs::write(path.join("tracked.txt"), "resolved\n").unwrap();
                    git(path, &["add", "tracked.txt"]);
                    finish_recovery(path).unwrap();
                    assert_eq!(resolve(path, "stash@{0}").is_none(), pop);
                    assert_eq!(git(path, &["show", ":tracked.txt"]), "resolved");
                } else {
                    abort_recovery(path).unwrap();
                    assert_eq!(
                        fs::read_to_string(path.join("tracked.txt")).unwrap(),
                        "branch edit\n"
                    );
                    assert!(git(path, &["status", "--porcelain"]).is_empty());
                    assert_eq!(resolve(path, "stash@{0}").unwrap(), target);
                }
                assert!(recovery_kind(path).is_none());
            }
        }
    }

    #[test]
    fn clean_apply_preserves_staged_and_unstaged_stash_content() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "staged\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        fs::write(path.join("tracked.txt"), "staged\nunstaged\n").unwrap();
        create(path, "saved", &create_options(path)).unwrap();
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(false),
            expected_stash: resolve(path, "stash@{0}").unwrap(),
            precondition: status::reset_precondition(path),
        };
        apply(path, 0, &options).unwrap();
        assert_eq!(git(path, &["show", ":tracked.txt"]), "staged");
        assert_eq!(
            fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "staged\nunstaged\n"
        );
        assert!(recovery_kind(path).is_none());
    }

    #[test]
    fn native_autostash_conflicts_keep_updated_head_and_wip_on_abort() {
        for integration in ["merge", "rebase"] {
            let temporary = repository();
            let path = temporary.path();
            git(path, &["switch", "-qc", "topic"]);
            fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
            git(path, &["commit", "-qam", "incoming"]);
            let updated_head = resolve(path, "HEAD").unwrap();
            git(path, &["switch", "-q", "main"]);
            fs::write(path.join("tracked.txt"), "original WIP\n").unwrap();
            fs::write(path.join("untracked.txt"), "keep untracked\n").unwrap();
            let observed = AutostashObservation::capture(path).unwrap();
            let output = command(path, &[integration, "--autostash", "topic"]).unwrap();
            assert!(output.status.success());
            assert!(read_status(path).unwrap().conflicted_count() > 0);
            assert!(observed.recover_if_conflicted(path).unwrap());
            let target = resolve(path, "refs/stash").unwrap();
            assert_eq!(recovery_kind(path), Some(StashRecoveryKind::AutoStash));
            assert_eq!(read_recovery(path).unwrap().before, updated_head);
            assert_eq!(
                git(path, &["show", &format!("{target}:tracked.txt")]),
                "original WIP"
            );

            abort_recovery(path).unwrap();

            assert_eq!(resolve(path, "HEAD").unwrap(), updated_head);
            assert_eq!(resolve(path, "refs/stash").unwrap(), target);
            assert_eq!(
                fs::read_to_string(path.join("tracked.txt")).unwrap(),
                "incoming\n"
            );
            assert_eq!(
                fs::read_to_string(path.join("untracked.txt")).unwrap(),
                "keep untracked\n"
            );
            assert!(git(path, &["ls-files", "-u"]).is_empty());
            assert!(recovery_kind(path).is_none());
        }
    }

    #[test]
    fn observation_covers_autostash_reapplication_after_merge_continue() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("autofile.txt"), "base\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-qm", "autostash file"]);
        git(path, &["switch", "-qc", "topic"]);
        fs::write(path.join("tracked.txt"), "topic\n").unwrap();
        fs::write(path.join("autofile.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "topic"]);
        git(path, &["switch", "-q", "main"]);
        fs::write(path.join("tracked.txt"), "main\n").unwrap();
        git(path, &["commit", "-qam", "main"]);
        fs::write(path.join("autofile.txt"), "original WIP\n").unwrap();
        let started = command(path, &["merge", "--autostash", "topic"]).unwrap();
        assert!(!started.status.success());
        fs::write(path.join("tracked.txt"), "resolved integration\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        let observed = AutostashObservation::capture(path).unwrap();
        assert!(observed.pending.is_some());
        let continued = crate::process::command("git")
            .args(["merge", "--continue"])
            .env("GIT_EDITOR", "true")
            .current_dir(path)
            .output()
            .unwrap();
        assert!(continued.status.success());
        assert!(observed.recover_if_conflicted(path).unwrap());
        let completed_head = resolve(path, "HEAD").unwrap();
        let target = resolve(path, "refs/stash").unwrap();
        abort_recovery(path).unwrap();
        assert_eq!(resolve(path, "HEAD").unwrap(), completed_head);
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);
        assert_eq!(
            fs::read_to_string(path.join("autofile.txt")).unwrap(),
            "incoming\n"
        );
        assert_eq!(
            fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "resolved integration\n"
        );
    }

    #[test]
    fn observation_does_not_adopt_unproven_external_stash_conflicts() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["switch", "-qc", "topic"]);
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        git(path, &["switch", "-q", "main"]);
        fs::write(path.join("tracked.txt"), "external WIP\n").unwrap();
        let observed = AutostashObservation::capture(path).unwrap();
        git(path, &["stash", "push", "-qm", "external stash"]);
        git(path, &["switch", "-q", "topic"]);
        assert!(!command(path, &["stash", "apply"]).unwrap().status.success());
        let before = git(path, &["status", "--porcelain=v2"]);
        assert!(!observed.recover_if_conflicted(path).unwrap());
        assert!(recovery_kind(path).is_none());
        assert_eq!(git(path, &["status", "--porcelain=v2"]), before);
    }

    #[test]
    fn adopted_autostash_refuses_stale_head_without_altering_conflicts() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["switch", "-qc", "topic"]);
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        let incoming = resolve(path, "HEAD").unwrap();
        git(path, &["switch", "-q", "main"]);
        let original = resolve(path, "HEAD").unwrap();
        fs::write(path.join("tracked.txt"), "original WIP\n").unwrap();
        let observed = AutostashObservation::capture(path).unwrap();
        assert!(command(path, &["merge", "--autostash", "topic"])
            .unwrap()
            .status
            .success());
        assert!(observed.recover_if_conflicted(path).unwrap());
        git(
            path,
            &["update-ref", "refs/heads/main", &original, &incoming],
        );
        let index = git(path, &["ls-files", "--stage"]);
        let working = fs::read(path.join("tracked.txt")).unwrap();
        let stash = git(path, &["stash", "list", "--format=%H"]);
        assert_eq!(abort_recovery(path), Err(StashError::Stale("HEAD".into())));
        assert_eq!(git(path, &["ls-files", "--stage"]), index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), working);
        assert_eq!(git(path, &["stash", "list", "--format=%H"]), stash);
        assert_eq!(recovery_kind(path), Some(StashRecoveryKind::AutoStash));
    }

    #[test]
    fn autostash_recovery_is_owned_by_gitdir_even_with_matching_worktree_heads() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "saved WIP\n").unwrap();
        git(path, &["stash", "push", "-qm", "saved WIP"]);
        let target = resolve(path, "refs/stash").unwrap();
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        let head = resolve(path, "HEAD").unwrap();
        let linked_root = TempDir::new().unwrap();
        let linked = linked_root.path().join("linked");
        git(
            path,
            &[
                "worktree",
                "add",
                "--detach",
                linked.to_str().unwrap(),
                "HEAD",
            ],
        );

        assert!(matches!(
            apply_autostash(path, &target),
            Err(StashError::AutoConflict { count: 1, .. })
        ));
        let owner_refs = read_recovery(path).unwrap().refs;
        let owner_index = git(path, &["ls-files", "--stage"]);
        let owner_work = fs::read(path.join("tracked.txt")).unwrap();
        assert_eq!(resolve(&linked, "HEAD").unwrap(), head);
        assert_eq!(recovery_kind(&linked), None);
        assert_eq!(finish_recovery(&linked), Err(StashError::RecoveryMissing));
        assert_eq!(abort_recovery(&linked), Err(StashError::RecoveryMissing));
        assert!(matches!(
            crate::git::operation::abort_operation(&linked),
            Err(crate::git::operation::OperationError::NoOperation)
        ));
        assert_eq!(git(path, &["ls-files", "--stage"]), owner_index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), owner_work);

        assert!(matches!(
            apply_autostash(&linked, &target),
            Err(StashError::AutoConflict { count: 1, .. })
        ));
        assert_ne!(
            read_recovery(&linked).unwrap().refs.prefix,
            owner_refs.prefix
        );
        abort_recovery(&linked).unwrap();
        assert_eq!(recovery_kind(&linked), None);
        assert_eq!(recovery_kind(path), Some(StashRecoveryKind::AutoStash));
        assert!(owner_refs.present(path));
        assert_eq!(git(path, &["ls-files", "--stage"]), owner_index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), owner_work);

        abort_recovery(path).unwrap();
        assert_eq!(recovery_kind(path), None);
        assert_eq!(resolve(path, "HEAD").unwrap(), head);
        assert_eq!(resolve(&linked, "HEAD").unwrap(), head);
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);
        assert!(git(path, &["ls-files", "-u"]).is_empty());
        assert!(git(&linked, &["ls-files", "-u"]).is_empty());
    }

    #[test]
    fn locked_autostash_registration_is_atomic_and_leaves_work_recoverable() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["switch", "-qc", "topic"]);
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        git(path, &["switch", "-q", "main"]);
        fs::write(path.join("tracked.txt"), "original WIP\n").unwrap();
        let observed = AutostashObservation::capture(path).unwrap();
        assert!(command(path, &["merge", "--autostash", "topic"])
            .unwrap()
            .status
            .success());
        let target = resolve(path, "refs/stash").unwrap();
        let index = git(path, &["ls-files", "--stage"]);
        let working = fs::read(path.join("tracked.txt")).unwrap();
        let recovery_refs = RecoveryRefs::autostash(path).unwrap();
        let lock = path.join(git(
            path,
            &[
                "rev-parse",
                "--git-path",
                &format!("{}.lock", recovery_refs.reference("target")),
            ],
        ));
        fs::create_dir_all(lock.parent().unwrap()).unwrap();
        fs::write(&lock, "held by another process").unwrap();
        assert!(matches!(
            observed.recover_if_conflicted(path),
            Err(StashError::Diagnostic(_))
        ));
        assert!(!recovery_refs.present(path));
        assert_eq!(git(path, &["ls-files", "--stage"]), index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), working);
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);
        fs::remove_file(&lock).unwrap();
        assert!(observed.recover_if_conflicted(path).unwrap());
        let recovery = read_recovery(path).unwrap();
        // A second writer cannot overwrite a published recovery, even if it
        // raced past the initial presence check.
        assert!(
            publish_autostash_recovery(path, &recovery.refs, &target, &target, &target).is_err()
        );
        assert_eq!(read_recovery(path).unwrap().head, recovery.head);
        fs::write(&lock, "held by another process").unwrap();
        assert!(clear_recovery_state(path, &recovery).is_err());
        assert_eq!(recovery_kind(path), Some(StashRecoveryKind::AutoStash));
        assert_eq!(read_recovery(path).unwrap().before, recovery.before);
        assert_eq!(read_recovery(path).unwrap().target, recovery.target);
        assert_eq!(read_recovery(path).unwrap().head, recovery.head);
    }

    #[test]
    fn failed_autostash_preparation_restores_its_temporary_baseline_snapshot() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "saved WIP\n").unwrap();
        git(path, &["stash", "push", "-qm", "saved WIP"]);
        let target = resolve(path, "refs/stash").unwrap();
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        fs::write(path.join("untracked.txt"), "baseline untracked\n").unwrap();
        let before = git(path, &["status", "--porcelain=v2"]);
        let recovery_refs = RecoveryRefs::autostash(path).unwrap();
        let lock = path.join(git(
            path,
            &[
                "rev-parse",
                "--git-path",
                &format!("{}.lock", recovery_refs.reference("head")),
            ],
        ));
        fs::create_dir_all(lock.parent().unwrap()).unwrap();
        fs::write(&lock, "held by another process").unwrap();
        assert!(matches!(
            apply_autostash(path, &target),
            Err(StashError::Diagnostic(_))
        ));
        assert!(!recovery_refs.present(path));
        assert_eq!(git(path, &["status", "--porcelain=v2"]), before);
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);
        assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
        assert_eq!(
            fs::read_to_string(path.join("untracked.txt")).unwrap(),
            "baseline untracked\n"
        );
    }

    #[test]
    fn clearing_autostash_never_follows_a_private_symbolic_ref_to_a_branch() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "saved WIP\n").unwrap();
        git(path, &["stash", "push", "-qm", "saved WIP"]);
        let target = resolve(path, "refs/stash").unwrap();
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        let updated_head = resolve(path, "HEAD").unwrap();
        assert!(matches!(
            apply_autostash(path, &target),
            Err(StashError::AutoConflict { .. })
        ));
        let recovery_refs = read_recovery(path).unwrap().refs;
        git(
            path,
            &[
                "symbolic-ref",
                &recovery_refs.reference("head"),
                "refs/heads/main",
            ],
        );

        abort_recovery(path).unwrap();
        assert_eq!(resolve(path, "refs/heads/main").unwrap(), updated_head);
        assert_eq!(resolve(path, "HEAD").unwrap(), updated_head);
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);
        assert!(!recovery_refs.present(path));
    }

    #[test]
    fn autostash_finish_failure_and_external_drop_leave_wip_visible_on_abort() {
        for failed_finish in [true, false] {
            let temporary = repository();
            let path = temporary.path();
            fs::write(path.join("tracked.txt"), "saved WIP\n").unwrap();
            git(path, &["stash", "push", "-qm", "saved WIP"]);
            let target = resolve(path, "refs/stash").unwrap();
            fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
            git(path, &["commit", "-qam", "incoming"]);
            let updated_head = resolve(path, "HEAD").unwrap();
            assert!(matches!(
                apply_autostash(path, &target),
                Err(StashError::AutoConflict { .. })
            ));
            if failed_finish {
                fs::write(path.join("tracked.txt"), "resolved WIP\n").unwrap();
                git(path, &["add", "tracked.txt"]);
                let recovery_refs = read_recovery(path).unwrap().refs;
                let lock = path.join(git(
                    path,
                    &[
                        "rev-parse",
                        "--git-path",
                        &format!("{}.lock", recovery_refs.reference("autostash")),
                    ],
                ));
                fs::write(&lock, "held by another process").unwrap();
                let error = finish_recovery(path).unwrap_err();
                let value = serde_json::to_value(diagnostic(error, "test")).unwrap();
                assert_eq!(
                    value["command"]["args"],
                    serde_json::json!(["update-ref", "--no-deref", "--stdin"])
                );
                assert_eq!(value["exitCode"], 128);
                assert_eq!(resolve(path, "refs/stash").unwrap(), target);
                assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
                assert_eq!(recovery_kind(path), Some(StashRecoveryKind::AutoStash));
                fs::remove_file(lock).unwrap();
            } else {
                git(path, &["stash", "drop", "--quiet"]);
                assert!(git(path, &["stash", "list"]).is_empty());
                assert_eq!(read_recovery(path).unwrap().target, target);
            }

            abort_recovery(path).unwrap();

            assert_eq!(resolve(path, "HEAD").unwrap(), updated_head);
            assert_eq!(resolve(path, "refs/stash").unwrap(), target);
            assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
            assert_eq!(
                git(path, &["show", &format!("{target}:tracked.txt")]),
                "saved WIP"
            );
            assert_eq!(
                fs::read_to_string(path.join("tracked.txt")).unwrap(),
                "incoming\n"
            );
            assert!(git(path, &["ls-files", "-u"]).is_empty());
            assert!(recovery_kind(path).is_none());
        }
    }

    #[test]
    fn autostash_abort_undo_restores_conflicts_and_keeps_other_worktree_recovery() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "saved WIP\n").unwrap();
        git(path, &["stash", "push", "-qm", "saved WIP"]);
        let target = resolve(path, "refs/stash").unwrap();
        fs::write(path.join("tracked.txt"), "incoming\n").unwrap();
        git(path, &["commit", "-qam", "incoming"]);
        let linked_root = TempDir::new().unwrap();
        let linked = linked_root.path().join("linked");
        git(
            path,
            &[
                "worktree",
                "add",
                "--detach",
                linked.to_str().unwrap(),
                "HEAD",
            ],
        );
        assert!(matches!(
            apply_autostash(path, &target),
            Err(StashError::AutoConflict { .. })
        ));
        assert!(matches!(
            apply_autostash(&linked, &target),
            Err(StashError::AutoConflict { .. })
        ));
        let owner_index = git(path, &["ls-files", "--stage"]);
        let owner_work = fs::read(path.join("tracked.txt")).unwrap();
        let linked_refs = read_recovery(&linked).unwrap().refs;
        let linked_index = git(&linked, &["ls-files", "--stage"]);
        let stacks = crate::git::undo::UndoStacks::default();
        crate::git::operation_with_recovery(
            "owner",
            path,
            &stacks,
            crate::git::OperationAction::Abort,
        )
        .unwrap();
        assert_eq!(recovery_kind(path), None);
        assert!(git(path, &["ls-files", "-u"]).is_empty());
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);

        stacks.undo("owner", path).unwrap();
        assert_eq!(recovery_kind(path), Some(StashRecoveryKind::AutoStash));
        assert_eq!(git(path, &["ls-files", "--stage"]), owner_index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), owner_work);
        stacks.redo("owner", path).unwrap();
        assert_eq!(recovery_kind(path), None);
        assert!(git(path, &["ls-files", "-u"]).is_empty());
        assert_eq!(resolve(path, "refs/stash").unwrap(), target);
        assert!(linked_refs.present(&linked));
        assert_eq!(git(&linked, &["ls-files", "--stage"]), linked_index);

        abort_recovery(&linked).unwrap();
        let owner_index = git(path, &["ls-files", "--stage"]);
        let owner_work = fs::read(path.join("tracked.txt")).unwrap();
        assert!(matches!(
            stacks.undo("owner", path),
            Err(crate::git::undo::UndoError::Stale)
        ));
        assert_eq!(git(path, &["ls-files", "--stage"]), owner_index);
        assert_eq!(fs::read(path.join("tracked.txt")).unwrap(), owner_work);
        assert_eq!(recovery_kind(path), None);
        assert_eq!(recovery_kind(&linked), None);
    }

    #[test]
    fn un_conflicto_conserva_el_guardado_para_recuperarlo() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "guardado\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let expected_stash = resolve(path, "stash@{0}").unwrap();
        fs::write(path.join("tracked.txt"), "actual\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        git(path, &["commit", "-m", "actual"]);
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(true),
            expected_stash,
            precondition: status::reset_precondition(path),
        };

        assert!(matches!(
            apply(path, 0, &options),
            Err(StashError::Conflict { count: 1, .. })
        ));
        assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
        assert!(git(path, &["diff", "--name-only", "--diff-filter=U"]).contains("tracked.txt"));
        assert_eq!(recovery_kind(path), Some(StashRecoveryKind::Pop));
        assert_eq!(
            serde_json::to_value(status::read(path).unwrap()).unwrap()["recoveryOperation"],
            "pop"
        );
    }

    #[test]
    fn pop_bloqueado_por_wip_explicita_la_causa_y_restaura_el_arbol() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "guardado\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let expected_stash = resolve(path, "stash@{0}").unwrap();
        fs::write(path.join("tracked.txt"), "wip local\n").unwrap();
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(true),
            expected_stash,
            precondition: status::reset_precondition(path),
        };

        assert!(matches!(
            apply(path, 0, &options),
            Err(StashError::BlockedByWip { count: 1, .. })
        ));
        assert_eq!(
            fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "wip local\n"
        );
        assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
        assert_eq!(recovery_kind(path), None);
    }

    #[test]
    fn cancelar_pop_restaura_stage_arbol_y_no_seguidos_previos() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("other.txt"), "base\n").unwrap();
        git(path, &["add", "other.txt"]);
        git(path, &["commit", "-m", "otro archivo"]);

        fs::write(path.join("tracked.txt"), "guardado\n").unwrap();
        fs::write(path.join("from-stash.txt"), "no seguido del stash\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let expected_stash = resolve(path, "stash@{0}").unwrap();

        fs::write(path.join("tracked.txt"), "actual\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        git(path, &["commit", "-m", "actual"]);
        git(path, &["config", "--unset", "user.name"]);
        git(path, &["config", "--unset", "user.email"]);
        fs::write(path.join("other.txt"), "preparado\n").unwrap();
        git(path, &["add", "other.txt"]);
        fs::write(path.join("other.txt"), "preparado\nsin preparar\n").unwrap();
        fs::write(path.join("pre-untracked.txt"), "previo\n").unwrap();

        let before_status = git(path, &["status", "--porcelain=v1"]);
        let before_staged = git(path, &["diff", "--cached"]);
        let before_unstaged = git(path, &["diff"]);
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(true),
            expected_stash,
            precondition: status::reset_precondition(path),
        };

        assert!(matches!(
            apply(path, 0, &options),
            Err(StashError::Conflict { count: 1, .. })
        ));
        assert!(path.join("from-stash.txt").exists());

        abort_recovery(path).unwrap();

        assert_eq!(git(path, &["status", "--porcelain=v1"]), before_status);
        assert_eq!(git(path, &["diff", "--cached"]), before_staged);
        assert_eq!(git(path, &["diff"]), before_unstaged);
        assert_eq!(
            fs::read_to_string(path.join("pre-untracked.txt")).unwrap(),
            "previo\n"
        );
        assert!(!path.join("from-stash.txt").exists());
        assert_eq!(git(path, &["stash", "list"]).lines().count(), 1);
        assert_eq!(recovery_kind(path), None);
    }

    #[test]
    fn terminar_pop_resuelto_retira_el_stash_y_la_recuperacion() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "guardado\n").unwrap();
        create(path, "trabajo", &create_options(path)).unwrap();
        let expected_stash = resolve(path, "stash@{0}").unwrap();
        fs::write(path.join("tracked.txt"), "actual\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        git(path, &["commit", "-m", "actual"]);
        let options = ApplyStashOptions {
            paths: None,
            drop: Some(true),
            expected_stash,
            precondition: status::reset_precondition(path),
        };

        assert!(matches!(
            apply(path, 0, &options),
            Err(StashError::Conflict { .. })
        ));
        fs::write(path.join("tracked.txt"), "resuelto\n").unwrap();
        git(path, &["add", "tracked.txt"]);

        finish_recovery(path).unwrap();

        assert!(git(path, &["stash", "list"]).is_empty());
        assert_eq!(recovery_kind(path), None);
    }

    #[test]
    fn renombrar_conserva_oid_orden_y_rama_de_toda_la_pila() {
        let temporary = repository();
        let path = temporary.path();
        for message in ["primero", "segundo", "tercero"] {
            fs::write(path.join("tracked.txt"), format!("{message}\n")).unwrap();
            create(path, message, &create_options(path)).unwrap();
        }
        let before = git(path, &["stash", "list", "--format=%H"]);
        let selected = git(path, &["rev-parse", "stash@{1}"]);

        rename(path, 1, &selected, "nuevo nombre").unwrap();

        assert_eq!(git(path, &["stash", "list", "--format=%H"]), before);
        assert!(git(path, &["stash", "list", "--format=%gs"]).contains("nuevo nombre"));
    }
    #[test]
    fn silent_stash_failure_preserves_exit_and_command_without_free_inputs() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("tracked.txt"), "PRIVATE_FILE_CONTENT\n").unwrap();
        let options = create_options(root);
        fs::write(root.join(".git/refs/stash.lock"), "held").unwrap();
        let error = create(root, "PRIVATE_STASH_MESSAGE", &options).unwrap_err();
        let StashError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["command"]["args"][0], "stash");
        assert!(value["exitCode"].as_i64().unwrap() != 0);
        assert_eq!(value["stderr"], "");
        assert!(!value.to_string().contains("PRIVATE_STASH_MESSAGE"));
        assert!(!value.to_string().contains("PRIVATE_FILE_CONTENT"));
        assert!(value.get("stdout").is_none());
    }
    #[test]
    fn stash_command_preserves_index_lock_error_without_stdout() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("tracked.txt"), "PRIVATE_FILE_CONTENT\n").unwrap();
        fs::write(root.join(".git/index.lock"), "held").unwrap();
        let output = command(
            root,
            &["stash", "push", "--quiet", "-m", "PRIVATE_STASH_MESSAGE"],
        )
        .unwrap();
        assert!(!output.status.success());
        let exit_code = output
            .status
            .code()
            .expect("Git lock refusal exits normally");
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let value = serde_json::to_value(output.diagnostic).unwrap();
        assert_eq!(value["kind"], "gitCommand");
        assert_eq!(value["stage"], "stash.execute");
        assert_eq!(value["command"]["program"], "git");
        assert_eq!(
            value["command"]["args"],
            serde_json::json!(["stash", "push", "--quiet", "-m", "[redacted argument]"])
        );
        // Git versions/platforms use different refusal codes; preserve the
        // exact native status rather than assuming one fixed nonzero value.
        assert_eq!(value["exitCode"], exit_code);
        assert_eq!(value["stderr"], stderr);
        assert!(value["stderr"].as_str().unwrap().contains("index.lock"));
        assert_eq!(fs::read(root.join(".git/index.lock")).unwrap(), b"held");
        assert!(!value.to_string().contains("PRIVATE_STASH_MESSAGE"));
        assert!(!value.to_string().contains("PRIVATE_FILE_CONTENT"));
        assert!(value.get("stdout").is_none());
    }
}

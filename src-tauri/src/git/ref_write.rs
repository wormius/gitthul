//! Escrituras locales de referencias, serializadas por repositorio.

use std::path::Path;
use std::process::Output;

use super::diagnostics::Diagnostic;

use serde::Deserialize;

use super::{history, stash, status};

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RefTarget {
    Branch { name: String },
    RemoteBranch { name: String, remote: String },
    Tag { name: String },
    Commit { sha: String },
}

impl RefTarget {
    pub(super) fn revision(&self) -> String {
        match self {
            Self::Branch { name } => format!("refs/heads/{name}"),
            Self::RemoteBranch { name, .. } => format!("refs/remotes/{name}"),
            Self::Tag { name } => format!("refs/tags/{name}"),
            Self::Commit { sha } => sha.clone(),
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Branch { name } | Self::RemoteBranch { name, .. } | Self::Tag { name } => name,
            Self::Commit { sha } => sha,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchOptions {
    checkout: Option<bool>,
}

impl CreateBranchOptions {
    pub fn checks_out(&self) -> bool {
        self.checkout == Some(true)
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagOptions {
    message: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutOptions {
    auto_stash: Option<bool>,
    remote_mode: Option<RemoteCheckoutMode>,
    expected_local_tip: Option<String>,
    expected_remote_tip: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum RemoteCheckoutMode {
    #[default]
    Switch,
    FastForward,
    Reset,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum CheckoutUndoStrategy {
    Lightweight { created_reference: Option<String> },
    Checkpoint,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBranchOptions {
    force: Option<bool>,
    expected_tip: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagOptions {
    expected_tip: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameBranchOptions {
    expected_tip: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WriteRefError {
    InvalidBranchName,
    InvalidTagName,
    TagIdentityMissing,
    DirtyTree(usize),
    CheckoutBlocked,
    RestoreFailed { output: String, count: usize },
    Stale,
    CurrentBranch,
    NotMerged { target: String, count: usize },
    Exists,
    RevisionNotFound(String),
    GitFailed(String),
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<WriteRefError>, Diagnostic),
}

impl WriteRefError {
    fn with_diagnostic(self, diagnostic: Diagnostic) -> Self {
        Self::WithDiagnostic(Box::new(self), diagnostic)
    }

    #[cfg(test)]
    fn into_classification(self) -> Self {
        match self {
            Self::WithDiagnostic(error, _) => error.into_classification(),
            _ => self,
        }
    }
}

fn revision_failure(
    error: history::ReadHistoryError,
    classification: WriteRefError,
) -> WriteRefError {
    let diagnostic = match error {
        history::ReadHistoryError::Diagnostic(diagnostic)
        | history::ReadHistoryError::WithDiagnostic(_, diagnostic) => diagnostic,
        error => Diagnostic::new("refWrite.resolveCommit", format!("{error:?}")),
    };
    classification.with_diagnostic(diagnostic)
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

pub fn create_branch(
    repository: &Path,
    name: &str,
    from: &RefTarget,
    options: &CreateBranchOptions,
) -> Result<(), WriteRefError> {
    validate_branch_name(repository, name)?;
    let repo = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    if repo.find_reference(&format!("refs/heads/{name}")).is_ok() {
        return Err(WriteRefError::Exists);
    }
    let revision = from.revision();
    let target = history::resolve_commit(&repo, &revision).map_err(|error| {
        revision_failure(
            error,
            WriteRefError::RevisionNotFound(from.label().to_owned()),
        )
    })?;
    let target = target.to_string();

    let output = if options.checkout == Some(true) {
        command(repository, &["switch", "--quiet", "-c", name, &target])?
    } else {
        command(repository, &["branch", "--", name, &target])?
    };
    if output.status.success() {
        return Ok(());
    }
    if repo.find_reference(&format!("refs/heads/{name}")).is_ok() {
        return Err(WriteRefError::Exists);
    }
    if options.checks_out() && checkout_would_overwrite(&output.stderr) {
        return Err(WriteRefError::CheckoutBlocked.with_diagnostic(output.diagnostic));
    }
    Err(WriteRefError::Diagnostic(output.diagnostic))
}

/// Only classify a refusal that Git explicitly reports. Local changes may be
/// compatible with a switch, including when creating a branch from HEAD.
fn checkout_would_overwrite(stderr: &[u8]) -> bool {
    String::from_utf8_lossy(stderr).lines().any(|line| {
        matches!(
            line,
            "error: Your local changes to the following files would be overwritten by checkout:"
                | "error: The following untracked working tree files would be overwritten by checkout:"
        )
    })
}

pub fn create_tag(
    repository: &Path,
    name: &str,
    at: &RefTarget,
    options: &CreateTagOptions,
) -> Result<(), WriteRefError> {
    validate_tag_name(repository, name)?;
    let repo = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    if repo.find_reference(&format!("refs/tags/{name}")).is_ok() {
        return Err(WriteRefError::Exists);
    }
    let revision = at.revision();
    let target = history::resolve_commit(&repo, &revision)
        .map_err(|error| {
            revision_failure(
                error,
                WriteRefError::RevisionNotFound(at.label().to_owned()),
            )
        })?
        .to_string();

    let output = match &options.message {
        Some(message) => {
            let identity = command(repository, &["var", "GIT_COMMITTER_IDENT"])?;
            if !identity.status.success() {
                return Err(WriteRefError::TagIdentityMissing.with_diagnostic(identity.diagnostic));
            }
            command(
                repository,
                &[
                    "tag",
                    "--annotate",
                    "--message",
                    message,
                    "--",
                    name,
                    &target,
                ],
            )?
        }
        None => command(repository, &["tag", "--", name, &target])?,
    };
    if output.status.success() {
        return Ok(());
    }
    let refreshed = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    if refreshed
        .find_reference(&format!("refs/tags/{name}"))
        .is_ok()
    {
        return Err(WriteRefError::Exists);
    }
    Err(WriteRefError::Diagnostic(output.diagnostic))
}

pub fn checkout(
    repository: &Path,
    target: &RefTarget,
    options: &CheckoutOptions,
) -> Result<(), WriteRefError> {
    checkout_inner(repository, target, options, true, None)
}

pub(super) fn checkout_clean(
    repository: &Path,
    target: &RefTarget,
    options: &CheckoutOptions,
    expected_absent_reference: Option<&str>,
) -> Result<(), WriteRefError> {
    checkout_inner(
        repository,
        target,
        options,
        false,
        expected_absent_reference,
    )
}

fn checkout_inner(
    repository: &Path,
    target: &RefTarget,
    options: &CheckoutOptions,
    allow_auto_stash: bool,
    expected_absent_reference: Option<&str>,
) -> Result<(), WriteRefError> {
    let repo = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    let revision = target.revision();
    let oid = history::resolve_commit(&repo, &revision)
        .map_err(|error| {
            revision_failure(
                error,
                WriteRefError::RevisionNotFound(target.label().to_owned()),
            )
        })?
        .to_string();

    let remote_local = if let RefTarget::RemoteBranch { name, remote } = target {
        if options
            .expected_remote_tip
            .as_deref()
            .is_some_and(|expected| expected != oid)
        {
            return Err(WriteRefError::Stale);
        }
        let prefix = format!("{remote}/");
        let local = name
            .strip_prefix(&prefix)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| WriteRefError::RevisionNotFound(name.to_owned()))?;
        let local_tip = repo
            .find_reference(&format!("refs/heads/{local}"))
            .ok()
            .and_then(|mut reference| reference.peel_to_commit().ok())
            .map(|commit| commit.id().to_string());
        if expected_absent_reference == Some(format!("refs/heads/{local}").as_str())
            && local_tip.is_some()
        {
            return Err(WriteRefError::Stale);
        }
        if options.expected_local_tip.as_deref() != local_tip.as_deref()
            && options.expected_local_tip.is_some()
        {
            return Err(WriteRefError::Stale);
        }
        if options.remote_mode == Some(RemoteCheckoutMode::FastForward)
            && local_tip.as_deref().is_some_and(|tip| tip != oid)
        {
            let ancestor = command(
                repository,
                &[
                    "merge-base",
                    "--is-ancestor",
                    local_tip.as_deref().unwrap(),
                    &oid,
                ],
            )?;
            if !ancestor.status.success() {
                return Err(if ancestor.status.code() == Some(1) {
                    WriteRefError::Stale
                } else {
                    WriteRefError::Diagnostic(ancestor.diagnostic)
                });
            }
        }
        Some((local.to_owned(), local_tip))
    } else {
        None
    };
    let dirty = status::checkout_change_count(repository).map_err(|error| {
        WriteRefError::Diagnostic(Diagnostic::new(
            "checkout.readChangeCount",
            format!("{error:?}"),
        ))
    })?;
    if dirty > 0 && (!allow_auto_stash || options.auto_stash != Some(true)) {
        return Err(WriteRefError::DirtyTree(dirty));
    }

    let stash_before = command_text(repository, &["rev-parse", "--verify", "refs/stash"]);
    let stashed = if dirty > 0 {
        let output = command(repository, &["stash", "push", "--quiet"])?;
        if !output.status.success() {
            return Err(WriteRefError::Diagnostic(output.diagnostic));
        }
        command_text(repository, &["rev-parse", "--verify", "refs/stash"])
            .filter(|after| Some(after) != stash_before.as_ref())
    } else {
        None
    };

    let output = match target {
        RefTarget::Branch { name } => command(repository, &["switch", "--quiet", name])?,
        RefTarget::RemoteBranch { name, remote: _ } => {
            let (local, local_tip) = remote_local
                .as_ref()
                .ok_or_else(|| WriteRefError::RevisionNotFound(name.to_owned()))?;
            if local_tip.is_some() {
                let switched = command(repository, &["switch", "--quiet", local])?;
                if !switched.status.success() {
                    switched
                } else {
                    let mode = options.remote_mode.unwrap_or_default();
                    let aligned = match mode {
                        RemoteCheckoutMode::Switch => switched,
                        RemoteCheckoutMode::FastForward => {
                            command(repository, &["merge", "--quiet", "--ff-only", &revision])?
                        }
                        RemoteCheckoutMode::Reset => {
                            command(repository, &["reset", "--hard", "--quiet", &oid])?
                        }
                    };
                    if aligned.status.success() && mode != RemoteCheckoutMode::Switch {
                        command(repository, &["branch", "--set-upstream-to", name, local])?
                    } else {
                        aligned
                    }
                }
            } else {
                command(
                    repository,
                    &["switch", "--quiet", "--track", "-c", local, &revision],
                )?
            }
        }
        RefTarget::Tag { .. } | RefTarget::Commit { .. } => {
            command(repository, &["switch", "--quiet", "--detach", &oid])?
        }
    };
    if output.status.success() {
        if let Some(stashed) = &stashed {
            stash::apply_autostash(repository, stashed)
                .map_err(|error| restore_failed(repository, error, None))?;
        }
        return Ok(());
    }

    let checkout_error = output.diagnostic.to_string();
    if let Some(stashed) = &stashed {
        stash::apply_autostash(repository, stashed)
            .map_err(|error| restore_failed(repository, error, Some(&checkout_error)))?;
    }
    if checkout_would_overwrite(&output.stderr) {
        return Err(WriteRefError::CheckoutBlocked.with_diagnostic(output.diagnostic));
    }
    Err(WriteRefError::Diagnostic(output.diagnostic))
}

/// Para un cambio de HEAD limpio eso es innecesario: el undo de checkout ya
/// revalida HEAD, índice y cambios locales. Se conserva el checkpoint cuando hay
/// cambios que pasarán por auto-stash o cuando el checkout alineará una rama
/// local existente mediante fast-forward/reset, o si hay hooks que puedan
/// modificar otros archivos.
pub(super) fn checkout_undo_strategy(
    repository: &Path,
    target: &RefTarget,
    options: &CheckoutOptions,
) -> CheckoutUndoStrategy {
    if super::undo_checkpoint::checkout_requires_full(repository).unwrap_or(true) {
        return CheckoutUndoStrategy::Checkpoint;
    }
    if status::checkout_change_count(repository).map_or(true, |count| count > 0) {
        return CheckoutUndoStrategy::Checkpoint;
    }
    let RefTarget::RemoteBranch { name, remote } = target else {
        return CheckoutUndoStrategy::Lightweight {
            created_reference: None,
        };
    };
    let prefix = format!("{remote}/");
    let Some(local) = name.strip_prefix(&prefix).filter(|value| !value.is_empty()) else {
        return CheckoutUndoStrategy::Checkpoint;
    };
    let local_reference = format!("refs/heads/{local}");
    let exists = gix::open(repository)
        .ok()
        .is_some_and(|repo| repo.find_reference(&local_reference).is_ok());
    if exists && options.remote_mode.unwrap_or_default() != RemoteCheckoutMode::Switch {
        CheckoutUndoStrategy::Checkpoint
    } else {
        CheckoutUndoStrategy::Lightweight {
            created_reference: (!exists).then_some(local_reference),
        }
    }
}

pub fn delete_branch(
    repository: &Path,
    name: &str,
    options: &DeleteBranchOptions,
) -> Result<Option<String>, WriteRefError> {
    let reference = format!("refs/heads/{name}");
    let Some(raw_oid) = optional_ref_text(repository, &reference)? else {
        return if options.expected_tip.is_some() {
            Err(WriteRefError::Stale)
        } else {
            Ok(None)
        };
    };
    let repo = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    let actual = history::resolve_commit(&repo, &reference)
        .map_err(|error| revision_failure(error, WriteRefError::Stale))?
        .to_string();
    if options
        .expected_tip
        .as_deref()
        .is_some_and(|tip| tip != actual)
    {
        return Err(WriteRefError::Stale);
    }
    if command_text(repository, &["symbolic-ref", "--quiet", "HEAD"]).as_deref()
        == Some(reference.as_str())
    {
        return Err(WriteRefError::CurrentBranch);
    }
    if options.force != Some(true) {
        let Some(head) = command_text(repository, &["rev-parse", "--verify", "HEAD"]) else {
            return Err(WriteRefError::Diagnostic(Diagnostic::new(
                "deleteBranch.readHead",
                "HEAD could not be resolved",
            )));
        };
        let merged = command(repository, &["merge-base", "--is-ancestor", &actual, &head])?;
        if !merged.status.success() {
            if merged.status.code() != Some(1) {
                return Err(WriteRefError::Diagnostic(merged.diagnostic));
            }
            let count = command_text(
                repository,
                &["rev-list", "--count", &format!("{head}..{actual}")],
            )
            .and_then(|value| value.parse().ok())
            .unwrap_or(1);
            let target = command_text(repository, &["branch", "--show-current"])
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| head.chars().take(8).collect());
            return Err(WriteRefError::NotMerged { target, count });
        }
    }
    update_ref_delete(repository, &reference, &raw_oid)?;
    Ok(Some(raw_oid))
}

pub fn delete_tag(
    repository: &Path,
    name: &str,
    options: &DeleteTagOptions,
) -> Result<Option<String>, WriteRefError> {
    let reference = format!("refs/tags/{name}");
    let Some(raw_oid) = optional_ref_text(repository, &reference)? else {
        return if options.expected_tip.is_some() {
            Err(WriteRefError::Stale)
        } else {
            Ok(None)
        };
    };
    let repo = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    let actual = history::resolve_commit(&repo, &reference)
        .map_err(|error| revision_failure(error, WriteRefError::Stale))?
        .to_string();
    if options
        .expected_tip
        .as_deref()
        .is_some_and(|tip| tip != actual)
    {
        return Err(WriteRefError::Stale);
    }
    update_ref_delete(repository, &reference, &raw_oid)?;
    Ok(Some(raw_oid))
}

pub fn rename_branch(
    repository: &Path,
    from: &str,
    to: &str,
    options: &RenameBranchOptions,
) -> Result<(), WriteRefError> {
    validate_branch_name(repository, to)?;
    let source = format!("refs/heads/{from}");
    let destination = format!("refs/heads/{to}");
    let repo = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    if optional_ref_text(repository, &source)?.is_none() {
        return if options.expected_tip.is_some() {
            Err(WriteRefError::Stale)
        } else {
            Ok(())
        };
    }
    let actual = history::resolve_commit(&repo, &source)
        .map_err(|error| revision_failure(error, WriteRefError::Stale))?
        .to_string();
    if options
        .expected_tip
        .as_deref()
        .is_some_and(|tip| tip != actual)
    {
        return Err(WriteRefError::Stale);
    }
    if from == to {
        return Ok(());
    }
    if repo.find_reference(&destination).is_ok() {
        return Err(WriteRefError::Exists);
    }

    let output = command(repository, &["branch", "--move", "--", from, to])?;
    if output.status.success() {
        return Ok(());
    }
    let refreshed = gix::open(repository)
        .map_err(|error| WriteRefError::Diagnostic(Diagnostic::cause("refWrite.open", &error)))?;
    if refreshed.find_reference(&destination).is_ok() {
        return Err(WriteRefError::Exists);
    }
    Err(WriteRefError::Diagnostic(output.diagnostic))
}

fn update_ref_delete(
    repository: &Path,
    reference: &str,
    expected: &str,
) -> Result<(), WriteRefError> {
    let output = command(repository, &["update-ref", "-d", reference, expected])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WriteRefError::Stale.with_diagnostic(output.diagnostic))
    }
}

fn restore_failed(
    repository: &Path,
    error: stash::StashError,
    checkout_error: Option<&str>,
) -> WriteRefError {
    let diagnostic = stash::diagnostic(error, "checkout.restoreAutostash");
    let restore_error = diagnostic.to_string();
    WriteRefError::RestoreFailed {
        output: checkout_error.map_or_else(
            || restore_error.clone(),
            |checkout_error| format!("{checkout_error}\n{restore_error}"),
        ),
        count: status::read(repository)
            .map(|current| current.conflicted_count())
            .unwrap_or(0),
    }
    .with_diagnostic(diagnostic)
}

fn validate_branch_name(repository: &Path, name: &str) -> Result<(), WriteRefError> {
    let output = command(repository, &["check-ref-format", "--branch", name])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WriteRefError::InvalidBranchName)
    }
}

fn validate_tag_name(repository: &Path, name: &str) -> Result<(), WriteRefError> {
    let reference = format!("refs/tags/{name}");
    let output = command(repository, &["check-ref-format", &reference])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WriteRefError::InvalidTagName)
    }
}

fn command(repository: &Path, args: &[&str]) -> Result<CommandOutput, WriteRefError> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            WriteRefError::Diagnostic(Diagnostic::command_io("refWrite.spawn", args, &error))
        })?;
    let diagnostic = Diagnostic::command("refWrite.execute", args, &output);
    Ok(CommandOutput { output, diagnostic })
}

fn optional_ref_text(repository: &Path, reference: &str) -> Result<Option<String>, WriteRefError> {
    let output = command(repository, &["rev-parse", "--verify", "--quiet", reference])?;
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err(WriteRefError::Diagnostic(output.diagnostic));
    }
    String::from_utf8(output.output.stdout)
        .map(|text| Some(text.trim().to_owned()))
        .map_err(|error| {
            WriteRefError::Diagnostic(Diagnostic::new("refWrite.decodeReference", error))
        })
}

fn command_text(repository: &Path, args: &[&str]) -> Option<String> {
    let output = command(repository, args).ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Autora")
            .env("GIT_AUTHOR_EMAIL", "autora@example.com")
            .env("GIT_COMMITTER_NAME", "Comitter")
            .env("GIT_COMMITTER_EMAIL", "committer@example.com")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn repository() -> tempfile::TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        git(temporary.path(), &["config", "user.name", "Autora"]);
        git(
            temporary.path(),
            &["config", "user.email", "autora@example.com"],
        );
        fs::write(temporary.path().join("README.md"), "inicio\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "inicio"]);
        temporary
    }

    #[test]
    fn crea_desde_rama_tag_y_commit_en_el_oid_exacto() {
        let temporary = repository();
        let head = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["tag", "v1"]);

        for (name, from) in [
            (
                "desde-rama",
                RefTarget::Branch {
                    name: "main".into(),
                },
            ),
            ("desde-tag", RefTarget::Tag { name: "v1".into() }),
            ("desde-commit", RefTarget::Commit { sha: head.clone() }),
        ] {
            create_branch(
                temporary.path(),
                name,
                &from,
                &CreateBranchOptions::default(),
            )
            .unwrap();
            assert_eq!(git(temporary.path(), &["rev-parse", name]), head);
        }
    }

    #[test]
    fn crea_y_cambia_en_una_sola_operacion() {
        let temporary = repository();
        create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Branch {
                name: "main".into(),
            },
            &CreateBranchOptions {
                checkout: Some(true),
            },
        )
        .unwrap();
        assert_eq!(
            git(temporary.path(), &["branch", "--show-current"]),
            "nueva"
        );
    }

    #[test]
    fn rechaza_nombre_colision_y_origen_ausente_sin_escribir() {
        let temporary = repository();
        let before = git(temporary.path(), &["show-ref"]);
        assert_eq!(
            create_branch(
                temporary.path(),
                "nombre..malo",
                &RefTarget::Branch {
                    name: "main".into()
                },
                &CreateBranchOptions::default(),
            ),
            Err(WriteRefError::InvalidBranchName)
        );
        assert_eq!(
            create_branch(
                temporary.path(),
                "main",
                &RefTarget::Branch {
                    name: "main".into()
                },
                &CreateBranchOptions::default(),
            ),
            Err(WriteRefError::Exists)
        );
        assert_eq!(
            create_branch(
                temporary.path(),
                "nueva",
                &RefTarget::Tag {
                    name: "ausente".into()
                },
                &CreateBranchOptions::default(),
            )
            .map_err(WriteRefError::into_classification),
            Err(WriteRefError::RevisionNotFound("ausente".into()))
        );
        assert_eq!(git(temporary.path(), &["show-ref"]), before);
    }

    #[test]
    fn checkout_rechazado_no_deja_una_rama_parcial() {
        let temporary = repository();
        // The refusal is actionable even when Git's optional advice is disabled.
        git(
            temporary.path(),
            &["config", "advice.commitBeforeMerge", "false"],
        );
        git(temporary.path(), &["branch", "origen"]);
        fs::write(temporary.path().join("README.md"), "principal\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "principal"]);
        fs::write(temporary.path().join("README.md"), "cambio en índice\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        fs::write(temporary.path().join("README.md"), "cambio local\n").unwrap();
        let refs_before = git(temporary.path(), &["show-ref"]);
        let index_before = fs::read(temporary.path().join(".git/index")).unwrap();
        let staged_before = git(temporary.path(), &["diff", "--cached", "--binary"]);
        let worktree_before = fs::read(temporary.path().join("README.md")).unwrap();

        let error = create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Branch {
                name: "origen".into(),
            },
            &CreateBranchOptions {
                checkout: Some(true),
            },
        )
        .unwrap_err();

        assert_checkout_blocked(&error, "Your local changes");
        let WriteRefError::WithDiagnostic(_, diagnostic) = &error else {
            unreachable!("assert_checkout_blocked requires the original diagnostic")
        };
        let captured_output = diagnostic.to_string();
        let captured_diagnostic = serde_json::to_value(diagnostic).unwrap();
        let ipc =
            serde_json::to_value(super::super::map_create_branch_error(error, "nueva")).unwrap();
        assert_eq!(ipc["code"], "branch.checkoutBlocked");
        assert_eq!(ipc["params"], serde_json::json!({ "branch": "nueva" }));
        assert_eq!(ipc["diagnostic"], captured_diagnostic);
        assert_eq!(ipc["diagnostic"]["exitCode"], 1);
        assert_eq!(ipc["output"], captured_output);
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        assert_eq!(git(temporary.path(), &["show-ref"]), refs_before);
        assert_eq!(
            fs::read(temporary.path().join(".git/index")).unwrap(),
            index_before
        );
        assert_eq!(
            git(temporary.path(), &["diff", "--cached", "--binary"]),
            staged_before
        );
        assert_eq!(
            fs::read(temporary.path().join("README.md")).unwrap(),
            worktree_before
        );
        let missing = Command::new("git")
            .args(["show-ref", "--verify", "--quiet", "refs/heads/nueva"])
            .current_dir(temporary.path())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .unwrap();
        assert!(!missing.success());
    }

    fn assert_checkout_blocked(error: &WriteRefError, stderr_marker: &str) {
        let WriteRefError::WithDiagnostic(classification, diagnostic) = error else {
            panic!("expected classified rejection with original evidence: {error:?}");
        };
        assert_eq!(**classification, WriteRefError::CheckoutBlocked);
        let diagnostic = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(diagnostic["command"]["args"][0], "switch");
        assert_eq!(diagnostic["exitCode"], 1);
        assert!(diagnostic["stderr"]
            .as_str()
            .unwrap()
            .contains(stderr_marker));
        assert_eq!(diagnostic["stage"], "refWrite.execute");
    }

    #[test]
    fn crear_y_cambiar_rechaza_colision_sin_seguimiento_sin_tocar_archivos_o_indice() {
        let temporary = repository();
        git(temporary.path(), &["switch", "--quiet", "-c", "origen"]);
        fs::write(temporary.path().join("nuevo.txt"), "archivo del origen\n").unwrap();
        git(temporary.path(), &["add", "nuevo.txt"]);
        git(
            temporary.path(),
            &["commit", "--quiet", "-m", "nuevo archivo"],
        );
        git(temporary.path(), &["switch", "--quiet", "main"]);
        fs::write(
            temporary.path().join("nuevo.txt"),
            "archivo local sin seguimiento\n",
        )
        .unwrap();
        let refs_before = git(temporary.path(), &["show-ref"]);
        let index_before = fs::read(temporary.path().join(".git/index")).unwrap();
        let worktree_before = fs::read(temporary.path().join("nuevo.txt")).unwrap();

        let error = create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Branch {
                name: "origen".into(),
            },
            &CreateBranchOptions {
                checkout: Some(true),
            },
        )
        .unwrap_err();

        assert_checkout_blocked(&error, "untracked working tree files");
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        assert_eq!(git(temporary.path(), &["show-ref"]), refs_before);
        assert_eq!(
            fs::read(temporary.path().join(".git/index")).unwrap(),
            index_before
        );
        assert_eq!(
            fs::read(temporary.path().join("nuevo.txt")).unwrap(),
            worktree_before
        );
        assert_eq!(git(temporary.path(), &["ls-files", "nuevo.txt"]), "");
    }

    #[test]
    fn crear_sin_cambiar_permite_cambios_que_impedirian_el_checkout() {
        let temporary = repository();
        git(temporary.path(), &["branch", "origen"]);
        fs::write(temporary.path().join("README.md"), "principal\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "principal"]);
        fs::write(temporary.path().join("README.md"), "cambio local\n").unwrap();
        let head_before = git(temporary.path(), &["rev-parse", "HEAD"]);
        let target = git(temporary.path(), &["rev-parse", "origen"]);
        let index_before = fs::read(temporary.path().join(".git/index")).unwrap();

        create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Branch {
                name: "origen".into(),
            },
            &CreateBranchOptions::default(),
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        assert_eq!(git(temporary.path(), &["rev-parse", "HEAD"]), head_before);
        assert_eq!(git(temporary.path(), &["rev-parse", "nueva"]), target);
        assert_eq!(
            fs::read(temporary.path().join(".git/index")).unwrap(),
            index_before
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join("README.md")).unwrap(),
            "cambio local\n"
        );
    }

    #[test]
    fn crear_y_cambiar_desde_head_permite_trabajo_pendiente_compatible() {
        let temporary = repository();
        fs::write(temporary.path().join("README.md"), "cambio en índice\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        fs::write(temporary.path().join("README.md"), "cambio local\n").unwrap();
        fs::write(
            temporary.path().join("notas.txt"),
            "nota local sin seguimiento\n",
        )
        .unwrap();
        let head_before = git(temporary.path(), &["rev-parse", "HEAD"]);
        let staged_before = git(temporary.path(), &["diff", "--cached", "--binary"]);

        create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Commit {
                sha: head_before.clone(),
            },
            &CreateBranchOptions {
                checkout: Some(true),
            },
        )
        .unwrap();

        assert_eq!(
            git(temporary.path(), &["branch", "--show-current"]),
            "nueva"
        );
        assert_eq!(git(temporary.path(), &["rev-parse", "HEAD"]), head_before);
        assert_eq!(
            git(temporary.path(), &["diff", "--cached", "--binary"]),
            staged_before
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join("README.md")).unwrap(),
            "cambio local\n"
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join("notas.txt")).unwrap(),
            "nota local sin seguimiento\n"
        );
    }

    #[test]
    fn crear_y_cambiar_permite_wip_que_no_colisiona_con_el_destino() {
        let temporary = repository();
        git(temporary.path(), &["branch", "origen"]);
        fs::write(temporary.path().join("otro.txt"), "archivo de main\n").unwrap();
        git(temporary.path(), &["add", "otro.txt"]);
        git(
            temporary.path(),
            &["commit", "--quiet", "-m", "otro archivo"],
        );
        fs::write(temporary.path().join("README.md"), "cambio local\n").unwrap();
        let target = git(temporary.path(), &["rev-parse", "origen"]);

        create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Branch {
                name: "origen".into(),
            },
            &CreateBranchOptions {
                checkout: Some(true),
            },
        )
        .unwrap();

        assert_eq!(
            git(temporary.path(), &["branch", "--show-current"]),
            "nueva"
        );
        assert_eq!(git(temporary.path(), &["rev-parse", "HEAD"]), target);
        assert_eq!(
            fs::read_to_string(temporary.path().join("README.md")).unwrap(),
            "cambio local\n"
        );
        assert!(!temporary.path().join("otro.txt").exists());
    }

    #[test]
    fn clasificacion_checkout_no_confunde_otros_errores_con_cambios_locales() {
        assert!(!checkout_would_overwrite(
            b"fatal: invalid reference: ausente\n"
        ));
        assert!(!checkout_would_overwrite(
            b"error: unable to read index file\n"
        ));
        assert!(!checkout_would_overwrite(b"fatal: branch already exists\n"));
    }

    #[test]
    fn checkout_con_stash_no_pierde_archivos_sin_seguimiento_que_colisionan() {
        let temporary = repository();
        git(temporary.path(), &["switch", "--quiet", "-c", "origen"]);
        fs::write(temporary.path().join("nuevo.txt"), "archivo del origen\n").unwrap();
        git(temporary.path(), &["add", "nuevo.txt"]);
        git(
            temporary.path(),
            &["commit", "--quiet", "-m", "nuevo archivo"],
        );
        git(temporary.path(), &["switch", "--quiet", "main"]);
        fs::write(
            temporary.path().join("nuevo.txt"),
            "archivo local sin seguimiento\n",
        )
        .unwrap();
        let refs_before = git(temporary.path(), &["show-ref"]);
        let index_before = git(temporary.path(), &["ls-files", "--stage"]);

        let error = checkout(
            temporary.path(),
            &RefTarget::Branch {
                name: "origen".into(),
            },
            &CheckoutOptions {
                auto_stash: Some(true),
                ..CheckoutOptions::default()
            },
        )
        .unwrap_err();

        assert_checkout_blocked(&error, "untracked working tree files");
        let ipc = serde_json::to_value(super::super::map_checkout_error(error, "origen")).unwrap();
        assert_eq!(ipc["code"], "branch.checkoutBlocked");
        assert_eq!(ipc["params"], serde_json::json!({ "branch": "origen" }));
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        assert_eq!(git(temporary.path(), &["show-ref"]), refs_before);
        assert_eq!(
            git(temporary.path(), &["ls-files", "--stage"]),
            index_before
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join("nuevo.txt")).unwrap(),
            "archivo local sin seguimiento\n"
        );
    }

    #[test]
    fn crea_tags_ligero_y_anotado_en_el_oid_exacto() {
        let temporary = repository();
        let head = git(temporary.path(), &["rev-parse", "HEAD"]);

        create_tag(
            temporary.path(),
            "ligero",
            &RefTarget::Branch {
                name: "main".into(),
            },
            &CreateTagOptions::default(),
        )
        .unwrap();
        create_tag(
            temporary.path(),
            "anotado",
            &RefTarget::Commit { sha: head.clone() },
            &CreateTagOptions {
                message: Some("entrega\nlista".into()),
            },
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["rev-parse", "ligero"]), head);
        assert_eq!(git(temporary.path(), &["rev-parse", "anotado^{}"]), head);
        assert_eq!(
            git(
                temporary.path(),
                &["for-each-ref", "--format=%(contents)", "refs/tags/anotado"]
            ),
            "entrega\nlista"
        );
    }

    #[test]
    fn rechaza_tag_invalido_colision_y_destino_ausente_sin_escribir() {
        let temporary = repository();
        git(temporary.path(), &["tag", "existente"]);
        let before = git(temporary.path(), &["show-ref", "--tags"]);

        assert_eq!(
            create_tag(
                temporary.path(),
                "nombre..malo",
                &RefTarget::Branch {
                    name: "main".into(),
                },
                &CreateTagOptions::default(),
            ),
            Err(WriteRefError::InvalidTagName)
        );
        assert_eq!(
            create_tag(
                temporary.path(),
                "existente",
                &RefTarget::Branch {
                    name: "main".into(),
                },
                &CreateTagOptions::default(),
            ),
            Err(WriteRefError::Exists)
        );
        assert_eq!(
            create_tag(
                temporary.path(),
                "nuevo",
                &RefTarget::Tag {
                    name: "ausente".into(),
                },
                &CreateTagOptions::default(),
            )
            .map_err(WriteRefError::into_classification),
            Err(WriteRefError::RevisionNotFound("ausente".into()))
        );
        assert_eq!(git(temporary.path(), &["show-ref", "--tags"]), before);
    }

    #[test]
    fn tag_anotado_sin_identidad_no_escribe() {
        let temporary = repository();
        git(temporary.path(), &["config", "user.name", ""]);
        git(temporary.path(), &["config", "user.email", ""]);

        assert_eq!(
            create_tag(
                temporary.path(),
                "anotado",
                &RefTarget::Branch {
                    name: "main".into(),
                },
                &CreateTagOptions {
                    message: Some("mensaje".into()),
                },
            )
            .map_err(WriteRefError::into_classification),
            Err(WriteRefError::TagIdentityMissing)
        );
        let missing = Command::new("git")
            .args(["show-ref", "--verify", "--quiet", "refs/tags/anotado"])
            .current_dir(temporary.path())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .unwrap();
        assert!(!missing.success());
    }

    #[test]
    fn destinos_homonimos_conservan_el_tipo_de_referencia() {
        let temporary = repository();
        let first = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["tag", "igual"]);
        fs::write(temporary.path().join("segundo.txt"), "segundo\n").unwrap();
        git(temporary.path(), &["add", "segundo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "segundo"]);
        let second = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "igual"]);
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/igual", &first],
        );

        create_branch(
            temporary.path(),
            "desde-rama-igual",
            &RefTarget::Branch {
                name: "igual".into(),
            },
            &CreateBranchOptions::default(),
        )
        .unwrap();
        create_branch(
            temporary.path(),
            "desde-tag-igual",
            &RefTarget::Tag {
                name: "igual".into(),
            },
            &CreateBranchOptions::default(),
        )
        .unwrap();
        create_branch(
            temporary.path(),
            "desde-remota-igual",
            &RefTarget::RemoteBranch {
                name: "origin/igual".into(),
                remote: "origin".into(),
            },
            &CreateBranchOptions::default(),
        )
        .unwrap();

        assert_eq!(
            git(temporary.path(), &["rev-parse", "desde-rama-igual"]),
            second
        );
        assert_eq!(
            git(temporary.path(), &["rev-parse", "desde-tag-igual"]),
            first
        );
        assert_eq!(
            git(temporary.path(), &["rev-parse", "desde-remota-igual"]),
            first
        );
    }

    #[test]
    fn checkout_remoto_crea_la_local_que_lo_sigue() {
        let temporary = repository();
        let remote_tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        );
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/dev", &remote_tip],
        );

        checkout(
            temporary.path(),
            &RefTarget::RemoteBranch {
                name: "origin/dev".into(),
                remote: "origin".into(),
            },
            &CheckoutOptions::default(),
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");
        assert_eq!(git(temporary.path(), &["rev-parse", "dev"]), remote_tip);
        assert_eq!(
            git(
                temporary.path(),
                &[
                    "for-each-ref",
                    "--format=%(upstream:short)",
                    "refs/heads/dev"
                ]
            ),
            "origin/dev"
        );
    }

    #[test]
    fn checkout_limpio_usa_undo_ligero_y_reserva_checkpoint_para_reescrituras() {
        let temporary = repository();
        let path = temporary.path();
        let tip = git(path, &["rev-parse", "HEAD"]);
        git(path, &["branch", "dev"]);
        git(path, &["update-ref", "refs/remotes/origin/nueva", &tip]);
        git(path, &["update-ref", "refs/remotes/origin/dev", &tip]);

        assert_eq!(
            checkout_undo_strategy(
                path,
                &RefTarget::Branch { name: "dev".into() },
                &CheckoutOptions::default(),
            ),
            CheckoutUndoStrategy::Lightweight {
                created_reference: None
            }
        );
        assert_eq!(
            checkout_undo_strategy(
                path,
                &RefTarget::RemoteBranch {
                    name: "origin/nueva".into(),
                    remote: "origin".into(),
                },
                &CheckoutOptions {
                    remote_mode: Some(RemoteCheckoutMode::FastForward),
                    ..CheckoutOptions::default()
                },
            ),
            CheckoutUndoStrategy::Lightweight {
                created_reference: Some("refs/heads/nueva".into())
            }
        );
        assert_eq!(
            checkout_undo_strategy(
                path,
                &RefTarget::RemoteBranch {
                    name: "origin/dev".into(),
                    remote: "origin".into(),
                },
                &CheckoutOptions {
                    remote_mode: Some(RemoteCheckoutMode::FastForward),
                    ..CheckoutOptions::default()
                },
            ),
            CheckoutUndoStrategy::Checkpoint
        );

        fs::write(path.join("README.md"), "cambio local\n").unwrap();
        assert_eq!(
            checkout_undo_strategy(
                path,
                &RefTarget::Branch { name: "dev".into() },
                &CheckoutOptions::default(),
            ),
            CheckoutUndoStrategy::Checkpoint
        );
    }

    #[test]
    fn checkout_remoto_avanza_la_local_atrasada_y_verifica_las_puntas() {
        let temporary = repository();
        let first = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "dev"]);
        git(
            temporary.path(),
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        );
        fs::write(temporary.path().join("segundo.txt"), "segundo\n").unwrap();
        git(temporary.path(), &["add", "segundo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "segundo"]);
        let remote_tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/dev", &remote_tip],
        );

        checkout(
            temporary.path(),
            &RefTarget::RemoteBranch {
                name: "origin/dev".into(),
                remote: "origin".into(),
            },
            &CheckoutOptions {
                remote_mode: Some(RemoteCheckoutMode::FastForward),
                expected_local_tip: Some(first),
                expected_remote_tip: Some(remote_tip.clone()),
                ..CheckoutOptions::default()
            },
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");
        assert_eq!(git(temporary.path(), &["rev-parse", "dev"]), remote_tip);
        assert_eq!(
            git(
                temporary.path(),
                &[
                    "for-each-ref",
                    "--format=%(upstream:short)",
                    "refs/heads/dev"
                ]
            ),
            "origin/dev"
        );
    }

    #[test]
    fn checkout_remoto_no_avanza_si_la_local_tiene_commits_propios() {
        let temporary = repository();
        let remote_tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        );
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/dev", &remote_tip],
        );
        fs::write(temporary.path().join("local.txt"), "local\n").unwrap();
        git(temporary.path(), &["add", "local.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "local"]);
        let local_tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "dev"]);

        let result = checkout(
            temporary.path(),
            &RefTarget::RemoteBranch {
                name: "origin/dev".into(),
                remote: "origin".into(),
            },
            &CheckoutOptions {
                remote_mode: Some(RemoteCheckoutMode::FastForward),
                expected_local_tip: Some(local_tip.clone()),
                expected_remote_tip: Some(remote_tip),
                ..CheckoutOptions::default()
            },
        );

        assert_eq!(
            result.map_err(WriteRefError::into_classification),
            Err(WriteRefError::Stale)
        );
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        assert_eq!(git(temporary.path(), &["rev-parse", "dev"]), local_tip);
    }

    #[test]
    fn checkout_remoto_restablece_la_local_solo_con_las_puntas_esperadas() {
        let temporary = repository();
        let remote_tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        );
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/dev", &remote_tip],
        );
        fs::write(temporary.path().join("local.txt"), "local\n").unwrap();
        git(temporary.path(), &["add", "local.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "local"]);
        let local_tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "dev"]);

        checkout(
            temporary.path(),
            &RefTarget::RemoteBranch {
                name: "origin/dev".into(),
                remote: "origin".into(),
            },
            &CheckoutOptions {
                remote_mode: Some(RemoteCheckoutMode::Reset),
                expected_local_tip: Some(local_tip),
                expected_remote_tip: Some(remote_tip.clone()),
                ..CheckoutOptions::default()
            },
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");
        assert_eq!(git(temporary.path(), &["rev-parse", "dev"]), remote_tip);
    }

    #[test]
    fn checkout_cambia_a_rama_y_desacopla_tag() {
        let temporary = repository();
        git(temporary.path(), &["branch", "dev"]);
        git(temporary.path(), &["tag", "v1"]);

        checkout(
            temporary.path(),
            &RefTarget::Branch { name: "dev".into() },
            &CheckoutOptions::default(),
        )
        .unwrap();
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");

        checkout(
            temporary.path(),
            &RefTarget::Tag { name: "v1".into() },
            &CheckoutOptions::default(),
        )
        .unwrap();
        assert!(git(temporary.path(), &["branch", "--show-current"]).is_empty());
        assert_eq!(
            git(temporary.path(), &["rev-parse", "HEAD"]),
            git(temporary.path(), &["rev-parse", "refs/tags/v1"])
        );
    }

    #[test]
    fn checkout_sucio_exige_o_restaura_el_guardado_automatico() {
        let temporary = repository();
        git(temporary.path(), &["branch", "dev"]);
        fs::write(temporary.path().join("README.md"), "cambio\n").unwrap();
        fs::write(temporary.path().join("sin-seguir.txt"), "queda\n").unwrap();

        assert_eq!(
            checkout(
                temporary.path(),
                &RefTarget::Branch { name: "dev".into() },
                &CheckoutOptions::default(),
            ),
            Err(WriteRefError::DirtyTree(2))
        );
        checkout(
            temporary.path(),
            &RefTarget::Branch { name: "dev".into() },
            &CheckoutOptions {
                auto_stash: Some(true),
                ..CheckoutOptions::default()
            },
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");
        assert_eq!(
            fs::read_to_string(temporary.path().join("README.md")).unwrap(),
            "cambio\n"
        );
        assert!(temporary.path().join("sin-seguir.txt").exists());
        assert!(git(temporary.path(), &["stash", "list"]).is_empty());
    }

    #[test]
    fn checkout_fallido_restaura_el_guardado_automatico() {
        let temporary = repository();
        git(temporary.path(), &["branch", "ocupada"]);
        let worktrees = tempfile::tempdir().unwrap();
        let linked = worktrees.path().join("linked");
        git(
            temporary.path(),
            &[
                "worktree",
                "add",
                "--quiet",
                linked.to_str().unwrap(),
                "ocupada",
            ],
        );
        fs::write(temporary.path().join("README.md"), "cambio que vuelve\n").unwrap();

        let result = checkout(
            temporary.path(),
            &RefTarget::Branch {
                name: "ocupada".into(),
            },
            &CheckoutOptions {
                auto_stash: Some(true),
                ..CheckoutOptions::default()
            },
        );

        assert!(matches!(
            result,
            Err(WriteRefError::GitFailed(_) | WriteRefError::Diagnostic(_))
        ));
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        assert_eq!(
            fs::read_to_string(temporary.path().join("README.md")).unwrap(),
            "cambio que vuelve\n"
        );
        assert!(git(temporary.path(), &["stash", "list"]).is_empty());
    }

    #[test]
    fn conflicto_al_restaurar_conserva_el_stash_de_respaldo() {
        let temporary = repository();
        git(temporary.path(), &["branch", "dev"]);
        fs::write(temporary.path().join("README.md"), "principal\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "principal"]);
        fs::write(temporary.path().join("README.md"), "cambio local\n").unwrap();

        let result = checkout(
            temporary.path(),
            &RefTarget::Branch { name: "dev".into() },
            &CheckoutOptions {
                auto_stash: Some(true),
                ..CheckoutOptions::default()
            },
        );

        assert!(matches!(
            result.map_err(WriteRefError::into_classification),
            Err(WriteRefError::RestoreFailed { count: 1, .. })
        ));
        assert_eq!(
            stash::recovery_kind(temporary.path()),
            Some(stash::StashRecoveryKind::AutoStash)
        );
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");
        assert_eq!(git(temporary.path(), &["stash", "list"]).lines().count(), 1);
        assert!(fs::read_to_string(temporary.path().join("README.md"))
            .unwrap()
            .contains("<<<<<<<"));
    }

    #[test]
    fn checkout_autostash_can_abort_or_finish_without_changing_destination_head() {
        for abort in [true, false] {
            let temporary = repository();
            let path = temporary.path();
            fs::write(path.join("README.md"), "previous saved WIP\n").unwrap();
            git(path, &["stash", "push", "-qm", "previous entry"]);
            let other_stash = git(path, &["rev-parse", "refs/stash"]);
            git(path, &["branch", "dev"]);
            let destination = git(path, &["rev-parse", "dev"]);
            fs::write(path.join("README.md"), "principal\n").unwrap();
            git(path, &["commit", "-qam", "principal"]);
            fs::write(path.join("README.md"), "staged WIP\n").unwrap();
            git(path, &["add", "README.md"]);
            fs::write(path.join("README.md"), "unstaged WIP\n").unwrap();
            fs::write(path.join("untracked.txt"), "keep untracked\n").unwrap();

            let result = checkout(
                path,
                &RefTarget::Branch { name: "dev".into() },
                &CheckoutOptions {
                    auto_stash: Some(true),
                    ..CheckoutOptions::default()
                },
            );
            let WriteRefError::WithDiagnostic(error, diagnostic) = result.unwrap_err() else {
                panic!("restore failure must retain its original diagnostic")
            };
            assert!(matches!(
                *error,
                WriteRefError::RestoreFailed { count: 1, .. }
            ));
            assert_eq!(serde_json::to_value(diagnostic).unwrap()["exitCode"], 1);
            let target = git(path, &["rev-parse", "refs/stash"]);
            assert_eq!(
                git(path, &["show", &format!("{target}^2:README.md")]),
                "staged WIP"
            );
            assert_eq!(
                git(path, &["show", &format!("{target}:README.md")]),
                "unstaged WIP"
            );
            assert_eq!(
                serde_json::to_value(status::read(path).unwrap()).unwrap()["recoveryOperation"],
                "autoStash"
            );
            // Native metadata is empty; the recovery remains available on a fresh read.
            assert!(matches!(
                crate::git::repository::discover(path).unwrap().operation(),
                crate::git::repository::RepoOperation::None
            ));
            if abort {
                crate::git::operation::abort_operation(path).unwrap();
                assert_eq!(git(path, &["rev-parse", "refs/stash"]), target);
                assert!(git(path, &["diff", "--name-only", "--diff-filter=U"]).is_empty());
                assert!(git(path, &["diff", "HEAD"]).is_empty());
            } else {
                // A subsequent stash entry must survive finishing this exact target.
                git(
                    path,
                    &["stash", "store", "-m", "another entry", &other_stash],
                );
                fs::write(path.join("README.md"), "resolved WIP\n").unwrap();
                git(path, &["add", "README.md"]);
                crate::git::operation::continue_operation(path).unwrap();
                assert_eq!(git(path, &["stash", "list"]).lines().count(), 2);
                assert!(git(path, &["stash", "list"]).contains("another entry"));
                assert_eq!(git(path, &["show", ":README.md"]), "resolved WIP");
            }
            assert_eq!(git(path, &["rev-parse", "HEAD"]), destination);
            assert_eq!(git(path, &["branch", "--show-current"]), "dev");
            assert_eq!(
                fs::read_to_string(path.join("untracked.txt")).unwrap(),
                "keep untracked\n"
            );
            assert!(stash::recovery_kind(path).is_none());
        }
    }

    #[test]
    fn borra_rama_solo_con_la_punta_observada() {
        let temporary = repository();
        let observed = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "vieja"]);
        fs::write(temporary.path().join("avance.txt"), "avance\n").unwrap();
        git(temporary.path(), &["add", "avance.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "avance"]);
        let advanced = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "--force", "vieja", &advanced]);

        assert_eq!(
            delete_branch(
                temporary.path(),
                "vieja",
                &DeleteBranchOptions {
                    force: Some(true),
                    expected_tip: Some(observed),
                },
            ),
            Err(WriteRefError::Stale)
        );
        assert_eq!(git(temporary.path(), &["rev-parse", "vieja"]), advanced);
        delete_branch(
            temporary.path(),
            "vieja",
            &DeleteBranchOptions {
                force: Some(true),
                expected_tip: Some(advanced),
            },
        )
        .unwrap();
        assert!(command_text(
            temporary.path(),
            &["rev-parse", "--verify", "refs/heads/vieja"]
        )
        .is_none());
    }

    #[test]
    fn protege_rama_activa_y_no_fusionada() {
        let temporary = repository();
        let main = git(temporary.path(), &["rev-parse", "HEAD"]);
        assert_eq!(
            delete_branch(
                temporary.path(),
                "main",
                &DeleteBranchOptions {
                    force: Some(true),
                    expected_tip: Some(main),
                },
            ),
            Err(WriteRefError::CurrentBranch)
        );

        git(temporary.path(), &["switch", "--quiet", "-c", "lado"]);
        fs::write(temporary.path().join("lado.txt"), "lado\n").unwrap();
        git(temporary.path(), &["add", "lado.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "lado"]);
        let side = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["switch", "--quiet", "main"]);

        assert_eq!(
            delete_branch(
                temporary.path(),
                "lado",
                &DeleteBranchOptions {
                    force: Some(false),
                    expected_tip: Some(side),
                },
            ),
            Err(WriteRefError::NotMerged {
                target: "main".into(),
                count: 1,
            })
        );
    }

    #[test]
    fn borra_tag_anotado_por_su_destino_observado() {
        let temporary = repository();
        let target = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &["tag", "--annotate", "--message", "uno", "v1"],
        );

        assert_eq!(
            delete_tag(
                temporary.path(),
                "v1",
                &DeleteTagOptions {
                    expected_tip: Some("f".repeat(40)),
                },
            ),
            Err(WriteRefError::Stale)
        );
        delete_tag(
            temporary.path(),
            "v1",
            &DeleteTagOptions {
                expected_tip: Some(target),
            },
        )
        .unwrap();
        assert!(
            command_text(temporary.path(), &["rev-parse", "--verify", "refs/tags/v1"]).is_none()
        );
        assert_eq!(
            delete_tag(
                temporary.path(),
                "v1",
                &DeleteTagOptions {
                    expected_tip: Some("f".repeat(40)),
                },
            ),
            Err(WriteRefError::Stale)
        );
    }

    #[test]
    fn renombra_rama_activa_con_configuracion_y_reflog() {
        let temporary = repository();
        let tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &["config", "branch.main.remote", "origin"],
        );
        git(
            temporary.path(),
            &["config", "branch.main.merge", "refs/heads/main"],
        );

        rename_branch(
            temporary.path(),
            "main",
            "principal",
            &RenameBranchOptions {
                expected_tip: Some(tip.clone()),
            },
        )
        .unwrap();

        assert_eq!(
            git(temporary.path(), &["branch", "--show-current"]),
            "principal"
        );
        assert_eq!(git(temporary.path(), &["rev-parse", "principal"]), tip);
        assert_eq!(
            git(temporary.path(), &["config", "branch.principal.remote"]),
            "origin"
        );
        assert!(temporary
            .path()
            .join(".git/logs/refs/heads/principal")
            .exists());
        assert!(!temporary.path().join(".git/logs/refs/heads/main").exists());
    }

    #[test]
    fn rename_rechaza_colision_ausencia_y_punta_cambiada() {
        let temporary = repository();
        let observed = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "origen"]);
        git(temporary.path(), &["branch", "tomada"]);
        fs::write(temporary.path().join("avance.txt"), "avance\n").unwrap();
        git(temporary.path(), &["add", "avance.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "avance"]);
        let advanced = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(
            temporary.path(),
            &["branch", "--force", "origen", &advanced],
        );

        assert_eq!(
            rename_branch(
                temporary.path(),
                "origen",
                "nueva",
                &RenameBranchOptions {
                    expected_tip: Some(observed),
                },
            ),
            Err(WriteRefError::Stale)
        );
        assert_eq!(
            rename_branch(
                temporary.path(),
                "origen",
                "tomada",
                &RenameBranchOptions {
                    expected_tip: Some(advanced.clone()),
                },
            ),
            Err(WriteRefError::Exists)
        );
        assert_eq!(
            rename_branch(
                temporary.path(),
                "ausente",
                "nueva",
                &RenameBranchOptions {
                    expected_tip: Some(advanced),
                },
            ),
            Err(WriteRefError::Stale)
        );
        assert!(command_text(
            temporary.path(),
            &["rev-parse", "--verify", "refs/heads/origen"]
        )
        .is_some());
    }

    #[test]
    fn renombra_rama_tomada_por_otro_worktree() {
        let temporary = repository();
        let tip = git(temporary.path(), &["rev-parse", "HEAD"]);
        git(temporary.path(), &["branch", "ocupada"]);
        let worktrees = tempfile::tempdir().unwrap();
        let linked = worktrees.path().join("linked");
        git(
            temporary.path(),
            &[
                "worktree",
                "add",
                "--quiet",
                linked.to_str().unwrap(),
                "ocupada",
            ],
        );

        rename_branch(
            temporary.path(),
            "ocupada",
            "renombrada",
            &RenameBranchOptions {
                expected_tip: Some(tip),
            },
        )
        .unwrap();

        assert_eq!(git(&linked, &["branch", "--show-current"]), "renombrada");
    }
    #[test]
    fn annotated_tag_failure_preserves_git_evidence_and_excludes_message() {
        let temporary = repository();
        let root = temporary.path();
        fs::create_dir_all(root.join(".git/refs/tags")).unwrap();
        fs::write(root.join(".git/refs/tags/blocked.lock"), "held").unwrap();
        let error = create_tag(
            root,
            "blocked",
            &RefTarget::Branch {
                name: "main".into(),
            },
            &CreateTagOptions {
                message: Some("PRIVATE_TAG_MESSAGE".into()),
            },
        )
        .unwrap_err();
        let WriteRefError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["command"]["args"][0], "tag");
        assert_eq!(value["exitCode"], 128);
        assert!(value["stderr"].as_str().unwrap().contains("blocked.lock"));
        assert!(!value.to_string().contains("PRIVATE_TAG_MESSAGE"));
        assert!(value.get("stdout").is_none());
    }
    #[test]
    fn delete_branch_does_not_report_success_when_reference_probe_failed() {
        let temporary = tempfile::tempdir().unwrap();
        let error =
            delete_branch(temporary.path(), "main", &DeleteBranchOptions::default()).unwrap_err();
        let WriteRefError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["exitCode"], 128);
        assert_eq!(value["command"]["args"][0], "rev-parse");
        assert!(value["stderr"]
            .as_str()
            .unwrap()
            .contains("not a git repository"));
    }
}

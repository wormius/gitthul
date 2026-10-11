//! Escrituras locales de referencias, serializadas por repositorio.

use std::path::Path;
use std::process::Output;

use serde::Deserialize;

use super::{history, status};

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
    RestoreFailed { output: String, count: usize },
    Stale,
    CurrentBranch,
    NotMerged { target: String, count: usize },
    Exists,
    RevisionNotFound(String),
    GitFailed(String),
}

pub fn create_branch(
    repository: &Path,
    name: &str,
    from: &RefTarget,
    options: &CreateBranchOptions,
) -> Result<(), WriteRefError> {
    validate_branch_name(repository, name)?;
    let repo = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    if repo.find_reference(&format!("refs/heads/{name}")).is_ok() {
        return Err(WriteRefError::Exists);
    }
    let revision = from.revision();
    let target = history::resolve_commit(&repo, &revision)
        .map_err(|_| WriteRefError::RevisionNotFound(from.label().to_owned()))?;
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
    Err(WriteRefError::GitFailed(
        String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    ))
}

pub fn create_tag(
    repository: &Path,
    name: &str,
    at: &RefTarget,
    options: &CreateTagOptions,
) -> Result<(), WriteRefError> {
    validate_tag_name(repository, name)?;
    let repo = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    if repo.find_reference(&format!("refs/tags/{name}")).is_ok() {
        return Err(WriteRefError::Exists);
    }
    let revision = at.revision();
    let target = history::resolve_commit(&repo, &revision)
        .map_err(|_| WriteRefError::RevisionNotFound(at.label().to_owned()))?
        .to_string();

    let output = match &options.message {
        Some(message) => {
            let identity = command(repository, &["var", "GIT_COMMITTER_IDENT"])?;
            if !identity.status.success() {
                return Err(WriteRefError::TagIdentityMissing);
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
    let refreshed = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    if refreshed
        .find_reference(&format!("refs/tags/{name}"))
        .is_ok()
    {
        return Err(WriteRefError::Exists);
    }
    Err(WriteRefError::GitFailed(
        String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    ))
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
    let repo = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    let revision = target.revision();
    let oid = history::resolve_commit(&repo, &revision)
        .map_err(|_| WriteRefError::RevisionNotFound(target.label().to_owned()))?
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
                return Err(WriteRefError::Stale);
            }
        }
        Some((local.to_owned(), local_tip))
    } else {
        None
    };
    let dirty = status::checkout_change_count(repository)
        .map_err(|_| WriteRefError::GitFailed(String::new()))?;
    if dirty > 0 && (!allow_auto_stash || options.auto_stash != Some(true)) {
        return Err(WriteRefError::DirtyTree(dirty));
    }

    let stash_before = command_text(repository, &["rev-parse", "--verify", "refs/stash"]);
    let stashed = if dirty > 0 {
        let output = command(repository, &["stash", "push", "--quiet"])?;
        if !output.status.success() {
            return Err(WriteRefError::GitFailed(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
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
        if stashed.is_some() {
            let restore = command(repository, &["stash", "pop", "--quiet", "--index"])?;
            if !restore.status.success() {
                return Err(restore_failed(repository, &restore));
            }
        }
        return Ok(());
    }

    let checkout_error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if stashed.is_some() {
        let restore = command(repository, &["stash", "pop", "--quiet", "--index"])?;
        if !restore.status.success() {
            let restore_error = String::from_utf8_lossy(&restore.stderr).trim().to_owned();
            return Err(WriteRefError::RestoreFailed {
                output: format!(
                    "{checkout_error}\nNo se pudo restaurar el guardado automático: {restore_error}"
                ),
                count: status::read(repository)
                    .map(|current| current.conflicted_count())
                    .unwrap_or(0),
            });
        }
    }
    Err(WriteRefError::GitFailed(checkout_error))
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
    let Some(raw_oid) = command_text(repository, &["rev-parse", "--verify", &reference]) else {
        return if options.expected_tip.is_some() {
            Err(WriteRefError::Stale)
        } else {
            Ok(None)
        };
    };
    let repo = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    let actual = history::resolve_commit(&repo, &reference)
        .map_err(|_| WriteRefError::GitFailed(String::new()))?
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
            return Err(WriteRefError::GitFailed(String::new()));
        };
        let merged = command(repository, &["merge-base", "--is-ancestor", &actual, &head])?;
        if !merged.status.success() {
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
    let Some(raw_oid) = command_text(repository, &["rev-parse", "--verify", &reference]) else {
        return if options.expected_tip.is_some() {
            Err(WriteRefError::Stale)
        } else {
            Ok(None)
        };
    };
    let repo = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    let actual = history::resolve_commit(&repo, &reference)
        .map_err(|_| WriteRefError::GitFailed(String::new()))?
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
    let repo = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    let actual = match history::resolve_commit(&repo, &source) {
        Ok(actual) => actual.to_string(),
        Err(_) if options.expected_tip.is_some() => return Err(WriteRefError::Stale),
        Err(_) => return Ok(()),
    };
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
    let refreshed = gix::open(repository).map_err(|_| WriteRefError::GitFailed(String::new()))?;
    if refreshed.find_reference(&destination).is_ok() {
        return Err(WriteRefError::Exists);
    }
    Err(WriteRefError::GitFailed(
        String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    ))
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
        Err(WriteRefError::Stale)
    }
}

fn restore_failed(repository: &Path, output: &Output) -> WriteRefError {
    WriteRefError::RestoreFailed {
        output: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        count: status::read(repository)
            .map(|current| current.conflicted_count())
            .unwrap_or(0),
    }
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

fn command(repository: &Path, args: &[&str]) -> Result<Output, WriteRefError> {
    crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .map_err(|_| WriteRefError::GitFailed(String::new()))
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
            ),
            Err(WriteRefError::RevisionNotFound("ausente".into()))
        );
        assert_eq!(git(temporary.path(), &["show-ref"]), before);
    }

    #[test]
    fn checkout_rechazado_no_deja_una_rama_parcial() {
        let temporary = repository();
        git(temporary.path(), &["branch", "origen"]);
        fs::write(temporary.path().join("README.md"), "principal\n").unwrap();
        git(temporary.path(), &["add", "README.md"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "principal"]);
        fs::write(temporary.path().join("README.md"), "cambio local\n").unwrap();

        let result = create_branch(
            temporary.path(),
            "nueva",
            &RefTarget::Branch {
                name: "origen".into(),
            },
            &CreateBranchOptions {
                checkout: Some(true),
            },
        );

        assert!(matches!(result, Err(WriteRefError::GitFailed(_))));
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
        let missing = Command::new("git")
            .args(["show-ref", "--verify", "--quiet", "refs/heads/nueva"])
            .current_dir(temporary.path())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .unwrap();
        assert!(!missing.success());
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
            ),
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
            ),
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

        assert_eq!(result, Err(WriteRefError::Stale));
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

        assert!(matches!(result, Err(WriteRefError::GitFailed(_))));
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
            result,
            Err(WriteRefError::RestoreFailed { count: 1, .. })
        ));
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "dev");
        assert_eq!(git(temporary.path(), &["stash", "list"]).lines().count(), 1);
        assert!(fs::read_to_string(temporary.path().join("README.md"))
            .unwrap()
            .contains("<<<<<<<"));
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
}

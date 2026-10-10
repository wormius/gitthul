//! Inicio de merge y rebase contra las puntas exactas mostradas en la vista previa.

use std::path::Path;
use std::process::{Command, Output};

use serde::Deserialize;

use super::history;
use super::repository::{self, RepoOperation, Repository};
use super::status;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPrecondition {
    source_ref: String,
    target_ref: String,
    source_oid: String,
    target_oid: String,
}

impl IntegrationPrecondition {
    pub(super) fn source_oid(&self) -> &str {
        &self.source_oid
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSequencePrecondition {
    target_ref: String,
    target_oid: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOptions {
    no_fast_forward: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum IntegrationError {
    Stale(String),
    InProgress {
        kind: String,
        source: String,
        target: String,
    },
    MergeConflict {
        source: String,
        target: String,
        count: usize,
    },
    RebaseConflict {
        source: String,
        target: String,
        sha: String,
        count: usize,
    },
    CherryPickConflict {
        sha: String,
        target: String,
        count: usize,
    },
    RevertConflict {
        sha: String,
        target: String,
        count: usize,
    },
    MainlineRequired(String),
    MainlineInvalid {
        sha: String,
        parent: usize,
        count: usize,
    },
    GitFailed,
}

pub fn merge(
    repository: &Path,
    source: &str,
    options: &MergeOptions,
    precondition: &IntegrationPrecondition,
) -> Result<Repository, IntegrationError> {
    verify(repository, source, precondition)?;
    let mut args = vec!["merge", "--no-edit"];
    if options.no_fast_forward {
        args.push("--no-ff");
    }
    args.push(&precondition.source_oid);
    let output = command(repository, &args)?;
    if output.status.success() {
        return rediscover(repository);
    }
    let count = conflict_count(repository)?;
    if count > 0 {
        return Err(IntegrationError::MergeConflict {
            source: precondition.source_ref.clone(),
            target: precondition.target_ref.clone(),
            count,
        });
    }
    Err(IntegrationError::GitFailed)
}

pub fn rebase(
    repository: &Path,
    onto: &str,
    precondition: &IntegrationPrecondition,
) -> Result<Repository, IntegrationError> {
    verify(repository, onto, precondition)?;
    let output = command(repository, &["rebase", &precondition.source_oid])?;
    if output.status.success() {
        return rediscover(repository);
    }
    let count = conflict_count(repository)?;
    if count > 0 {
        return Err(IntegrationError::RebaseConflict {
            source: precondition.target_ref.clone(),
            target: precondition.source_ref.clone(),
            sha: read_short(repository, "REBASE_HEAD").unwrap_or_else(|| "HEAD".to_owned()),
            count,
        });
    }
    Err(IntegrationError::GitFailed)
}

pub fn cherry_pick(
    repository: &Path,
    shas: &[String],
    precondition: &CommitSequencePrecondition,
    mainline: Option<usize>,
) -> Result<Repository, IntegrationError> {
    verify_sequence(repository, shas, precondition, mainline)?;
    let mut args = vec!["cherry-pick", "--no-edit"];
    let mainline_value = mainline.map(|parent| parent.to_string());
    if let Some(value) = mainline_value.as_deref() {
        args.extend(["-m", value]);
    }
    args.extend(shas.iter().map(String::as_str));
    let output = command(repository, &args)?;
    if output.status.success() {
        return rediscover(repository);
    }
    let count = conflict_count(repository)?;
    if count > 0 {
        return Err(IntegrationError::CherryPickConflict {
            sha: read_short(repository, "CHERRY_PICK_HEAD").unwrap_or_else(|| "HEAD".to_owned()),
            target: precondition.target_ref.clone(),
            count,
        });
    }
    Err(IntegrationError::GitFailed)
}

pub fn revert(
    repository: &Path,
    shas: &[String],
    precondition: &CommitSequencePrecondition,
    mainline: Option<usize>,
) -> Result<Repository, IntegrationError> {
    verify_sequence(repository, shas, precondition, mainline)?;
    let mut args = vec!["revert", "--no-edit"];
    let mainline_value = mainline.map(|parent| parent.to_string());
    if let Some(value) = mainline_value.as_deref() {
        args.extend(["-m", value]);
    }
    args.extend(shas.iter().map(String::as_str));
    let output = command(repository, &args)?;
    if output.status.success() {
        return rediscover(repository);
    }
    let count = conflict_count(repository)?;
    if count > 0 {
        return Err(IntegrationError::RevertConflict {
            sha: read_short(repository, "REVERT_HEAD").unwrap_or_else(|| "HEAD".to_owned()),
            target: precondition.target_ref.clone(),
            count,
        });
    }
    Err(IntegrationError::GitFailed)
}

fn verify(
    repository: &Path,
    source: &str,
    precondition: &IntegrationPrecondition,
) -> Result<(), IntegrationError> {
    if source != precondition.source_ref {
        return Err(IntegrationError::Stale(source.to_owned()));
    }
    let current = repository::discover(repository).map_err(|_| IntegrationError::GitFailed)?;
    if let Some((kind, operation_source, operation_target)) = operation_parts(current.operation()) {
        return Err(IntegrationError::InProgress {
            kind,
            source: operation_source,
            target: operation_target,
        });
    }
    if current.head != precondition.target_ref {
        return Err(IntegrationError::Stale(precondition.target_ref.clone()));
    }
    let repo = gix::open(repository).map_err(|_| IntegrationError::GitFailed)?;
    let source_oid = history::resolve_commit(&repo, &precondition.source_ref)
        .map_err(|_| IntegrationError::Stale(precondition.source_ref.clone()))?;
    let target_oid = history::resolve_commit(&repo, &precondition.target_ref)
        .map_err(|_| IntegrationError::Stale(precondition.target_ref.clone()))?;
    if source_oid.to_string() != precondition.source_oid {
        return Err(IntegrationError::Stale(precondition.source_ref.clone()));
    }
    if target_oid.to_string() != precondition.target_oid {
        return Err(IntegrationError::Stale(precondition.target_ref.clone()));
    }
    Ok(())
}

fn verify_sequence(
    repository: &Path,
    shas: &[String],
    precondition: &CommitSequencePrecondition,
    mainline: Option<usize>,
) -> Result<(), IntegrationError> {
    if shas.is_empty() {
        return Err(IntegrationError::GitFailed);
    }
    let current = repository::discover(repository).map_err(|_| IntegrationError::GitFailed)?;
    if let Some((kind, operation_source, operation_target)) = operation_parts(current.operation()) {
        return Err(IntegrationError::InProgress {
            kind,
            source: operation_source,
            target: operation_target,
        });
    }
    if current.head != precondition.target_ref {
        return Err(IntegrationError::Stale(precondition.target_ref.clone()));
    }
    let repo = gix::open(repository).map_err(|_| IntegrationError::GitFailed)?;
    let target_oid = history::resolve_commit(&repo, &precondition.target_ref)
        .map_err(|_| IntegrationError::Stale(precondition.target_ref.clone()))?;
    if target_oid.to_string() != precondition.target_oid {
        return Err(IntegrationError::Stale(precondition.target_ref.clone()));
    }
    for sha in shas {
        let id = history::resolve_commit(&repo, sha)
            .map_err(|_| IntegrationError::Stale(sha.clone()))?;
        let parent_count = repo
            .find_commit(id)
            .map_err(|_| IntegrationError::Stale(sha.clone()))?
            .decode()
            .map_err(|_| IntegrationError::GitFailed)?
            .parents()
            .count();
        if parent_count > 1 {
            let Some(parent) = mainline.filter(|_| shas.len() == 1) else {
                return Err(IntegrationError::MainlineRequired(sha.clone()));
            };
            if parent == 0 || parent > parent_count {
                return Err(IntegrationError::MainlineInvalid {
                    sha: sha.clone(),
                    parent,
                    count: parent_count,
                });
            }
        } else if let Some(parent) = mainline {
            return Err(IntegrationError::MainlineInvalid {
                sha: sha.clone(),
                parent,
                count: parent_count,
            });
        }
    }
    Ok(())
}

fn operation_parts(operation: &RepoOperation) -> Option<(String, String, String)> {
    match operation {
        RepoOperation::Merge { source, target, .. } => {
            Some(("merge".to_owned(), source.clone(), target.clone()))
        }
        RepoOperation::Rebase { source, target, .. } => {
            Some(("rebase".to_owned(), source.clone(), target.clone()))
        }
        RepoOperation::CherryPick { source, target, .. } => {
            Some(("cherryPick".to_owned(), source.clone(), target.clone()))
        }
        RepoOperation::Revert { source, target, .. } => {
            Some(("revert".to_owned(), source.clone(), target.clone()))
        }
        RepoOperation::Bisect => Some(("bisect".to_owned(), "HEAD".to_owned(), "HEAD".to_owned())),
        RepoOperation::None => None,
    }
}

fn conflict_count(repository: &Path) -> Result<usize, IntegrationError> {
    status::read(repository)
        .map(|status| status.conflicted_count())
        .map_err(|_| IntegrationError::GitFailed)
}

fn rediscover(repository: &Path) -> Result<Repository, IntegrationError> {
    repository::discover(repository).map_err(|_| IntegrationError::GitFailed)
}

fn read_short(repository: &Path, revision: &str) -> Option<String> {
    let output = command(repository, &["rev-parse", "--verify", revision]).ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .chars()
            .take(8)
            .collect()
    })
}

fn command(repository: &Path, args: &[&str]) -> Result<Output, IntegrationError> {
    Command::new("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| IntegrationError::GitFailed)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn git(repository: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .output()
            .expect("Git CLI disponible");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn commit(repository: &Path, file: &str, contents: &str) -> String {
        fs::write(repository.join(file), contents).unwrap();
        git(repository, &["add", file]);
        git(repository, &["commit", "-m", contents.trim()]);
        git(repository, &["rev-parse", "HEAD"])
    }

    fn repository() -> TempDir {
        let temporary = TempDir::new().unwrap();
        git(temporary.path(), &["init", "-b", "main"]);
        git(temporary.path(), &["config", "user.name", "GitThul Tests"]);
        git(
            temporary.path(),
            &["config", "user.email", "tests@gitthul.invalid"],
        );
        commit(temporary.path(), "base.txt", "base\n");
        temporary
    }

    fn precondition(repository: &Path, source: &str, target: &str) -> IntegrationPrecondition {
        IntegrationPrecondition {
            source_ref: source.to_owned(),
            target_ref: target.to_owned(),
            source_oid: git(repository, &["rev-parse", source]),
            target_oid: git(repository, &["rev-parse", target]),
        }
    }

    fn sequence_precondition(repository: &Path, target: &str) -> CommitSequencePrecondition {
        CommitSequencePrecondition {
            target_ref: target.to_owned(),
            target_oid: git(repository, &["rev-parse", target]),
        }
    }

    fn merged_repository() -> (TempDir, String, String) {
        let temporary = repository();
        let path = temporary.path();
        let base = git(path, &["rev-parse", "HEAD"]);
        git(path, &["checkout", "-b", "side"]);
        commit(path, "side.txt", "side\n");
        git(path, &["checkout", "main"]);
        commit(path, "main.txt", "main\n");
        git(path, &["merge", "--no-edit", "side"]);
        let merged = git(path, &["rev-parse", "HEAD"]);
        (temporary, base, merged)
    }

    #[test]
    fn merge_hace_avance_rapido_o_commit_de_dos_padres() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["checkout", "-b", "feature"]);
        let feature = commit(path, "feature.txt", "feature\n");
        git(path, &["checkout", "main"]);
        let first = precondition(path, "feature", "main");
        merge(path, "feature", &MergeOptions::default(), &first).unwrap();
        assert_eq!(git(path, &["rev-parse", "HEAD"]), feature);

        git(path, &["checkout", "-b", "other"]);
        commit(path, "other.txt", "other\n");
        git(path, &["checkout", "main"]);
        commit(path, "main.txt", "main\n");
        let second = precondition(path, "other", "main");
        merge(path, "other", &MergeOptions::default(), &second).unwrap();
        assert_eq!(
            git(path, &["rev-list", "--parents", "-n", "1", "HEAD"])
                .split_whitespace()
                .count(),
            3
        );
    }

    #[test]
    fn rebase_reescribe_la_rama_activa_sobre_el_origen() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["checkout", "-b", "feature"]);
        let feature = commit(path, "feature.txt", "feature\n");
        git(path, &["checkout", "main"]);
        commit(path, "main.txt", "main\n");
        let expected = precondition(path, "feature", "main");

        rebase(path, "feature", &expected).unwrap();

        assert_eq!(git(path, &["merge-base", "HEAD", "feature"]), feature);
        assert_eq!(git(path, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    }

    #[test]
    fn conserva_conflictos_reales_para_resolver() {
        for kind in ["merge", "rebase"] {
            let temporary = repository();
            let path = temporary.path();
            fs::write(path.join("base.txt"), "feature\n").unwrap();
            git(path, &["checkout", "-b", "feature"]);
            fs::write(path.join("base.txt"), "feature\n").unwrap();
            git(path, &["add", "base.txt"]);
            git(path, &["commit", "-m", "feature"]);
            git(path, &["checkout", "main"]);
            fs::write(path.join("base.txt"), "main\n").unwrap();
            git(path, &["add", "base.txt"]);
            git(path, &["commit", "-m", "main"]);
            let expected = precondition(path, "feature", "main");

            let result = if kind == "merge" {
                merge(path, "feature", &MergeOptions::default(), &expected)
            } else {
                rebase(path, "feature", &expected)
            };
            assert!(matches!(
                result,
                Err(IntegrationError::MergeConflict { count: 1, .. })
                    | Err(IntegrationError::RebaseConflict { count: 1, .. })
            ));
            assert_eq!(conflict_count(path).unwrap(), 1);
        }
    }

    #[test]
    fn rechaza_la_vista_previa_si_alguna_punta_cambio() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["branch", "feature"]);
        let expected = precondition(path, "feature", "main");
        git(path, &["checkout", "feature"]);
        commit(path, "feature.txt", "nuevo\n");
        git(path, &["checkout", "main"]);
        let before = git(path, &["rev-parse", "HEAD"]);

        assert!(matches!(
            merge(path, "feature", &MergeOptions::default(), &expected),
            Err(IntegrationError::Stale(reference)) if reference == "feature"
        ));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), before);
    }

    #[test]
    fn cherry_pick_y_revert_respetan_el_orden_recibido() {
        let picked = repository();
        let path = picked.path();
        git(path, &["checkout", "-b", "source"]);
        let first = commit(path, "first.txt", "primero\n");
        let second = commit(path, "second.txt", "segundo\n");
        git(path, &["checkout", "main"]);
        let expected = sequence_precondition(path, "main");

        cherry_pick(path, &[first, second], &expected, None).unwrap();

        assert_eq!(git(path, &["log", "-2", "--format=%s"]), "segundo\nprimero");

        let reverted = repository();
        let path = reverted.path();
        let first = commit(path, "first.txt", "primero\n");
        let second = commit(path, "second.txt", "segundo\n");
        let expected = sequence_precondition(path, "main");

        revert(path, &[second, first], &expected, None).unwrap();

        assert!(!path.join("first.txt").exists());
        assert!(!path.join("second.txt").exists());
        assert_eq!(
            git(path, &["log", "-2", "--format=%s"]),
            "Revert \"primero\"\nRevert \"segundo\""
        );
    }

    #[test]
    fn cherry_pick_y_revert_conservan_su_conflicto_real() {
        for kind in ["cherryPick", "revert"] {
            let temporary = repository();
            let path = temporary.path();
            let selected = if kind == "cherryPick" {
                git(path, &["checkout", "-b", "source"]);
                let selected = commit(path, "base.txt", "source\n");
                git(path, &["checkout", "main"]);
                commit(path, "base.txt", "target\n");
                selected
            } else {
                let selected = commit(path, "base.txt", "selected\n");
                commit(path, "base.txt", "later\n");
                selected
            };
            let expected = sequence_precondition(path, "main");
            let result = if kind == "cherryPick" {
                cherry_pick(path, &[selected], &expected, None)
            } else {
                revert(path, &[selected], &expected, None)
            };

            assert!(matches!(
                result,
                Err(IntegrationError::CherryPickConflict { count: 1, .. })
                    | Err(IntegrationError::RevertConflict { count: 1, .. })
            ));
            assert_eq!(conflict_count(path).unwrap(), 1);
        }
    }

    #[test]
    fn valida_toda_la_secuencia_y_head_antes_de_escribir() {
        let temporary = repository();
        let path = temporary.path();
        git(path, &["checkout", "-b", "source"]);
        let valid = commit(path, "source.txt", "source\n");
        git(path, &["checkout", "main"]);
        let expected = sequence_precondition(path, "main");
        let before = git(path, &["rev-parse", "HEAD"]);

        assert!(matches!(
            cherry_pick(
                path,
                &[valid.clone(), "no-existe".to_owned()],
                &expected,
                None,
            ),
            Err(IntegrationError::Stale(reference)) if reference == "no-existe"
        ));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), before);

        commit(path, "later.txt", "later\n");
        let changed = git(path, &["rev-parse", "HEAD"]);
        assert!(matches!(
            revert(path, &[valid], &expected, None),
            Err(IntegrationError::Stale(reference)) if reference == "main"
        ));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), changed);

        git(path, &["checkout", "-b", "side"]);
        commit(path, "side.txt", "side\n");
        git(path, &["checkout", "main"]);
        commit(path, "main.txt", "main\n");
        git(path, &["merge", "--no-edit", "side"]);
        let merge_commit = git(path, &["rev-parse", "HEAD"]);
        let merge_expected = sequence_precondition(path, "main");

        assert!(matches!(
            revert(path, &[merge_commit.clone()], &merge_expected, None),
            Err(IntegrationError::MainlineRequired(sha)) if sha == merge_commit
        ));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), merge_commit);
    }

    #[test]
    fn cherry_pick_de_merge_respeta_cual_padre_es_la_linea_principal() {
        for parent in [1, 2] {
            let (temporary, base, merged) = merged_repository();
            let path = temporary.path();
            git(path, &["checkout", "-b", "target", &base]);
            let expected = sequence_precondition(path, "target");

            cherry_pick(path, &[merged], &expected, Some(parent)).unwrap();

            assert_eq!(path.join("side.txt").exists(), parent == 1);
            assert_eq!(path.join("main.txt").exists(), parent == 2);
        }
    }

    #[test]
    fn revert_de_merge_respeta_cual_padre_es_la_linea_principal() {
        for parent in [1, 2] {
            let (temporary, _, merged) = merged_repository();
            let path = temporary.path();
            let expected = sequence_precondition(path, "main");

            revert(path, &[merged], &expected, Some(parent)).unwrap();

            assert_eq!(path.join("side.txt").exists(), parent == 2);
            assert_eq!(path.join("main.txt").exists(), parent == 1);
        }
    }

    #[test]
    fn rechaza_mainline_ausente_o_invalida_antes_de_escribir() {
        let (temporary, _, merged) = merged_repository();
        let path = temporary.path();
        let expected = sequence_precondition(path, "main");
        let before = git(path, &["rev-parse", "HEAD"]);

        assert!(matches!(
            revert(path, &[merged.clone()], &expected, Some(3)),
            Err(IntegrationError::MainlineInvalid {
                parent: 3,
                count: 2,
                ..
            })
        ));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), before);

        let ordinary = commit(path, "ordinary.txt", "ordinary\n");
        let changed = sequence_precondition(path, "main");
        assert!(matches!(
            revert(path, &[ordinary.clone()], &changed, Some(1)),
            Err(IntegrationError::MainlineInvalid {
                parent: 1,
                count: 1,
                ..
            })
        ));
        assert_eq!(git(path, &["rev-parse", "HEAD"]), ordinary);
    }
}

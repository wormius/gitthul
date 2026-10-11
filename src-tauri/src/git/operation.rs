//! Cierre y recuperación de operaciones que Git dejó a medias.

use std::path::Path;
use std::process::Command;

use super::repository::{self, RepoOperation, Repository};
use super::stash::{self, StashError};
use super::status;

#[derive(Debug, PartialEq, Eq)]
pub enum OperationError {
    GitFailed,
    NoOperation,
    StillConflicted(usize),
    Stash(StashError),
}

pub fn continue_operation(repository: &Path) -> Result<Repository, OperationError> {
    let conflicts = status::read(repository)
        .map_err(|_| OperationError::GitFailed)?
        .conflicted_count();
    if conflicts > 0 {
        return Err(OperationError::StillConflicted(conflicts));
    }
    let current = repository::discover(repository).map_err(|_| OperationError::GitFailed)?;
    let Some(args) = continue_args(current.operation()) else {
        if stash::recovery_kind(repository).is_some() {
            stash::finish_recovery(repository).map_err(OperationError::Stash)?;
            return rediscover(repository);
        }
        return Err(OperationError::NoOperation);
    };
    run(repository, args)?;
    rediscover(repository)
}

pub fn abort_operation(repository: &Path) -> Result<Repository, OperationError> {
    let current = repository::discover(repository).map_err(|_| OperationError::GitFailed)?;
    let Some(args) = abort_args(current.operation()) else {
        if stash::recovery_kind(repository).is_some() {
            stash::abort_recovery(repository).map_err(OperationError::Stash)?;
            return rediscover(repository);
        }
        return Err(OperationError::NoOperation);
    };
    run(repository, args)?;
    rediscover(repository)
}

/// Olvida la integración sin crear commits ni restaurar el índice o el árbol.
pub fn quit_operation(repository: &Path) -> Result<Repository, OperationError> {
    let conflicts = status::read(repository)
        .map_err(|_| OperationError::GitFailed)?
        .conflicted_count();
    if conflicts > 0 {
        return Err(OperationError::StillConflicted(conflicts));
    }
    let current = repository::discover(repository).map_err(|_| OperationError::GitFailed)?;
    let args: &[&str] = match current.operation() {
        RepoOperation::Merge { .. } => &["merge", "--quit"],
        RepoOperation::Rebase { .. } => &["rebase", "--quit"],
        RepoOperation::CherryPick { .. } => &["cherry-pick", "--quit"],
        RepoOperation::Revert { .. } => &["revert", "--quit"],
        RepoOperation::None if stash::recovery_kind(repository).is_some() => {
            stash::finish_recovery(repository).map_err(OperationError::Stash)?;
            return rediscover(repository);
        }
        RepoOperation::None | RepoOperation::Bisect => return Err(OperationError::NoOperation),
    };
    run(repository, args)?;
    rediscover(repository)
}

fn continue_args(operation: &RepoOperation) -> Option<&'static [&'static str]> {
    match operation {
        RepoOperation::Merge { .. } => Some(&["merge", "--continue"]),
        RepoOperation::Rebase { .. } => Some(&["rebase", "--continue"]),
        RepoOperation::CherryPick { .. } => Some(&["cherry-pick", "--continue"]),
        RepoOperation::Revert { .. } => Some(&["revert", "--continue"]),
        RepoOperation::None | RepoOperation::Bisect => None,
    }
}

fn abort_args(operation: &RepoOperation) -> Option<&'static [&'static str]> {
    match operation {
        RepoOperation::Merge { .. } => Some(&["merge", "--abort"]),
        RepoOperation::Rebase { .. } => Some(&["rebase", "--abort"]),
        RepoOperation::CherryPick { .. } => Some(&["cherry-pick", "--abort"]),
        RepoOperation::Revert { .. } => Some(&["revert", "--abort"]),
        RepoOperation::Bisect => Some(&["bisect", "reset"]),
        RepoOperation::None => None,
    }
}

fn rediscover(repository: &Path) -> Result<Repository, OperationError> {
    repository::discover(repository).map_err(|_| OperationError::GitFailed)
}

fn run(repository: &Path, args: &[&str]) -> Result<(), OperationError> {
    let output = git_command(repository)
        .args(args)
        .output()
        .map_err(|_| OperationError::GitFailed)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(OperationError::GitFailed)
    }
}

fn git_command(repository: &Path) -> Command {
    let mut command = crate::process::command("git");
    command
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("LC_ALL", "C");
    command
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{
        abort_args, abort_operation, continue_args, continue_operation, quit_operation,
        OperationError,
    };
    use crate::git::repository::RepoOperation;

    fn git(repository: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .output()
            .expect("Git CLI disponible")
            .status
            .success()
    }

    fn conflicted(operation: &str) -> TempDir {
        let temporary = TempDir::new().expect("directorio temporal");
        let repository = temporary.path();
        assert!(git(repository, &["init", "-b", "main"]));
        assert!(git(repository, &["config", "user.name", "GitThul Tests"]));
        assert!(git(
            repository,
            &["config", "user.email", "tests@gitthul.invalid"]
        ));
        fs::write(repository.join("file.txt"), "base\n").expect("base");
        assert!(git(repository, &["add", "file.txt"]));
        assert!(git(repository, &["commit", "-m", "base"]));
        assert!(git(repository, &["checkout", "-b", "topic"]));
        fs::write(repository.join("file.txt"), "topic\n").expect("topic");
        assert!(git(repository, &["add", "file.txt"]));
        assert!(git(repository, &["commit", "-m", "topic"]));
        assert!(git(repository, &["checkout", "main"]));
        fs::write(repository.join("file.txt"), "main\n").expect("main");
        assert!(git(repository, &["add", "file.txt"]));
        assert!(git(repository, &["commit", "-m", "main"]));
        let started = match operation {
            "merge" => git(repository, &["merge", "topic"]),
            "rebase" => git(repository, &["rebase", "topic"]),
            _ => unreachable!(),
        };
        assert!(!started);
        temporary
    }

    #[test]
    fn merge_no_continua_con_conflictos_y_despues_crea_el_commit_sin_editor() {
        let temporary = conflicted("merge");
        let repository = temporary.path();
        assert!(matches!(
            continue_operation(repository),
            Err(OperationError::StillConflicted(1))
        ));
        fs::write(repository.join("file.txt"), "resuelto\n").expect("resolución");
        assert!(git(repository, &["add", "file.txt"]));

        let result = continue_operation(repository).expect("continuar merge");
        assert!(matches!(result.operation(), RepoOperation::None));
        let parents = Command::new("git")
            .args(["rev-list", "--parents", "-n", "1", "HEAD"])
            .current_dir(repository)
            .output()
            .expect("padres");
        assert_eq!(
            String::from_utf8(parents.stdout)
                .expect("padres utf8")
                .split_whitespace()
                .count(),
            3
        );
    }

    #[test]
    fn dejar_en_preparados_cierra_git_sin_tocar_head_indice_o_archivos() {
        for kind in ["merge", "rebase"] {
            let temporary = conflicted(kind);
            let repository = temporary.path();
            assert!(matches!(
                quit_operation(repository),
                Err(OperationError::StillConflicted(1))
            ));
            fs::write(repository.join("file.txt"), "resuelto\n").unwrap();
            assert!(git(repository, &["add", "file.txt"]));
            // Conserva también ediciones posteriores al stage y archivos nuevos.
            fs::write(
                repository.join("file.txt"),
                "resuelto\nedición sin preparar\n",
            )
            .unwrap();
            fs::write(repository.join("untracked.txt"), "nuevo\n").unwrap();
            let read = |args: &[&str]| {
                let result = Command::new("git")
                    .args(args)
                    .current_dir(repository)
                    .output()
                    .unwrap();
                assert!(result.status.success());
                result.stdout
            };
            let head = read(&["rev-parse", "HEAD"]);
            let index = read(&["write-tree"]);
            let status = read(&["status", "--porcelain=v2"]);
            let result = quit_operation(repository).unwrap();
            assert!(matches!(result.operation(), RepoOperation::None));
            assert_eq!(read(&["rev-parse", "HEAD"]), head);
            assert_eq!(read(&["write-tree"]), index);
            assert_eq!(read(&["status", "--porcelain=v2"]), status);
            assert!(!repository.join(".git/MERGE_HEAD").exists());
            assert!(!repository.join(".git/rebase-merge").exists());
            assert!(!repository.join(".git/rebase-apply").exists());
            assert_eq!(
                fs::read_to_string(repository.join("file.txt")).unwrap(),
                "resuelto\nedición sin preparar\n"
            );
            assert_eq!(
                fs::read_to_string(repository.join("untracked.txt")).unwrap(),
                "nuevo\n"
            );
            assert!(git(repository, &["commit", "-m", "resolución preparada"]));
            assert_eq!(
                String::from_utf8(read(&["show", "-s", "--format=%P", "HEAD"]))
                    .unwrap()
                    .split_whitespace()
                    .count(),
                1
            );
        }
    }

    #[test]
    fn aborta_merge_y_rebase_hasta_el_head_y_archivo_originales() {
        for kind in ["merge", "rebase"] {
            let temporary = conflicted(kind);
            let repository = temporary.path();
            let expected_head = String::from_utf8(
                Command::new("git")
                    .args(["rev-parse", "ORIG_HEAD"])
                    .current_dir(repository)
                    .output()
                    .expect("orig head")
                    .stdout,
            )
            .expect("oid utf8")
            .trim()
            .to_owned();

            let result = abort_operation(repository).expect("abortar");
            assert!(matches!(result.operation(), RepoOperation::None));
            assert_eq!(
                String::from_utf8(
                    Command::new("git")
                        .args(["rev-parse", "HEAD"])
                        .current_dir(repository)
                        .output()
                        .expect("head")
                        .stdout,
                )
                .expect("oid utf8")
                .trim(),
                expected_head
            );
            assert_eq!(
                fs::read_to_string(repository.join("file.txt")).expect("archivo restaurado"),
                "main\n"
            );
        }
    }

    #[test]
    fn cada_tipo_elige_su_comando_y_bisect_solo_se_puede_abortar() {
        let named = |kind| match kind {
            "merge" => RepoOperation::Merge {
                source: "source".to_owned(),
                target: "target".to_owned(),
                sha: None,
            },
            "rebase" => RepoOperation::Rebase {
                source: "source".to_owned(),
                target: "target".to_owned(),
                sha: None,
            },
            "cherryPick" => RepoOperation::CherryPick {
                source: "source".to_owned(),
                target: "target".to_owned(),
                sha: None,
            },
            "revert" => RepoOperation::Revert {
                source: "source".to_owned(),
                target: "target".to_owned(),
                sha: None,
            },
            _ => unreachable!(),
        };
        assert_eq!(
            continue_args(&named("merge")),
            Some(&["merge", "--continue"][..])
        );
        assert_eq!(
            continue_args(&named("rebase")),
            Some(&["rebase", "--continue"][..])
        );
        assert_eq!(
            continue_args(&named("cherryPick")),
            Some(&["cherry-pick", "--continue"][..])
        );
        assert_eq!(
            continue_args(&named("revert")),
            Some(&["revert", "--continue"][..])
        );
        assert_eq!(continue_args(&RepoOperation::Bisect), None);
        assert_eq!(
            abort_args(&RepoOperation::Bisect),
            Some(&["bisect", "reset"][..])
        );
    }
}

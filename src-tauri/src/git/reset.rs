//! Reset explícito contra el commit exacto que confirmó la persona.

use std::collections::HashSet;
use std::path::Path;
use std::process::{Command, Output};

use serde::Deserialize;

use super::history;
use super::repository::{self, RepoOperation, Repository};
use super::status::{self, ResetPrecondition};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ResetError {
    Stale(String),
    InProgress {
        kind: String,
        source: String,
        target: String,
    },
    TargetNotFound(String),
    UntrackedCollision {
        sha: String,
        count: usize,
    },
    GitFailed(String),
}

pub fn reset(
    repository: &Path,
    to: &str,
    mode: ResetMode,
    expected_branch: &str,
    precondition: &ResetPrecondition,
) -> Result<Repository, ResetError> {
    verify(repository, mode, expected_branch, precondition)?;
    let repo = gix::open(repository).map_err(|error| ResetError::GitFailed(error.to_string()))?;
    let target = history::resolve_commit(&repo, to)
        .map_err(|_| ResetError::TargetNotFound(to.to_owned()))?
        .to_string();

    if mode == ResetMode::Hard {
        let count = untracked_collisions(repository, &target)?;
        if count > 0 {
            return Err(ResetError::UntrackedCollision {
                sha: short_sha(&target),
                count,
            });
        }
    }

    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    let output = command(repository, &["reset", flag, &target])?;
    if !output.status.success() {
        return Err(ResetError::GitFailed(
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ));
    }
    repository::discover(repository).map_err(|error| ResetError::GitFailed(format!("{error:?}")))
}

fn verify(
    repository: &Path,
    mode: ResetMode,
    expected_branch: &str,
    precondition: &ResetPrecondition,
) -> Result<(), ResetError> {
    let current_repository = repository::discover(repository)
        .map_err(|error| ResetError::GitFailed(format!("{error:?}")))?;
    if let Some((kind, source, target)) = operation_parts(current_repository.operation()) {
        return Err(ResetError::InProgress {
            kind,
            source,
            target,
        });
    }
    if current_repository.head != expected_branch {
        return Err(ResetError::Stale(expected_branch.to_owned()));
    }

    let current = if mode == ResetMode::Hard {
        status::tracked_reset_precondition(repository)
    } else if mode == ResetMode::Mixed {
        let commit = status::commit_precondition(repository);
        ResetPrecondition {
            head: commit.head,
            index_tree: commit.index_tree,
            worktree_tree: None,
            untracked_tree: None,
        }
    } else {
        ResetPrecondition {
            head: status::head_oid(repository),
            index_tree: None,
            worktree_tree: None,
            untracked_tree: None,
        }
    };
    let stale = current.head != precondition.head
        || (mode != ResetMode::Soft && current.index_tree != precondition.index_tree)
        || (mode == ResetMode::Hard && current.worktree_tree != precondition.worktree_tree);
    if stale {
        return Err(ResetError::Stale(expected_branch.to_owned()));
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

/**
 * Un archivo sin seguimiento no debe desaparecer para hacer sitio al árbol destino.
 * Se comparan bytes de ruta, no texto, para conservar nombres que no sean UTF-8.
 */
fn untracked_collisions(repository: &Path, target: &str) -> Result<usize, ResetError> {
    let target_paths = nul_output(repository, &["ls-tree", "-r", "-z", "--name-only", target])?;
    let mut untracked = nul_output(
        repository,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    untracked.extend(nul_output(
        repository,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
        ],
    )?);
    let untracked: HashSet<Vec<u8>> = untracked.into_iter().collect();

    Ok(untracked
        .iter()
        .filter(|path| {
            target_paths.iter().any(|target_path| {
                same_or_parent(path.as_slice(), target_path)
                    || same_or_parent(target_path, path.as_slice())
            })
        })
        .count())
}

fn same_or_parent(parent: &[u8], child: &[u8]) -> bool {
    child == parent || (child.starts_with(parent) && child.get(parent.len()).copied() == Some(b'/'))
}

fn nul_output(repository: &Path, args: &[&str]) -> Result<Vec<Vec<u8>>, ResetError> {
    let output = command(repository, args)?;
    if !output.status.success() {
        return Err(ResetError::GitFailed(
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .map(<[u8]>::to_vec)
        .collect())
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(8).collect()
}

fn command(repository: &Path, args: &[&str]) -> Result<Output, ResetError> {
    Command::new("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| ResetError::GitFailed(error.to_string()))
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

    fn commit(repository: &Path, contents: &str) -> String {
        fs::write(repository.join("tracked.txt"), contents).unwrap();
        git(repository, &["add", "tracked.txt"]);
        git(repository, &["commit", "-m", contents.trim()]);
        git(repository, &["rev-parse", "HEAD"])
    }

    fn repository() -> (TempDir, String, String) {
        let temporary = TempDir::new().unwrap();
        git(temporary.path(), &["init", "-b", "main"]);
        let first = commit(temporary.path(), "first\n");
        let second = commit(temporary.path(), "second\n");
        (temporary, first, second)
    }

    #[test]
    fn preserves_git_stderr_when_reset_cannot_lock_the_index() {
        let (temporary, first, _) = repository();
        let root = temporary.path();
        let before = status::reset_precondition(root);
        fs::write(root.join(".git/index.lock"), "locked").unwrap();
        let error = reset(root, &first, ResetMode::Mixed, "main", &before).unwrap_err();
        assert!(matches!(error, ResetError::GitFailed(output) if output.contains("index.lock")));
    }

    #[test]
    fn los_tres_modos_mueven_solo_lo_que_prometen() {
        for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
            let (temporary, first, second) = repository();
            let root = temporary.path();
            fs::write(root.join("tracked.txt"), "working\n").unwrap();
            let before = status::reset_precondition(root);

            reset(root, &first, mode, "main", &before).unwrap();
            assert_eq!(git(root, &["rev-parse", "HEAD"]), first);
            let index = git(root, &["show", ":tracked.txt"]);
            let worktree = fs::read_to_string(root.join("tracked.txt")).unwrap();
            match mode {
                ResetMode::Soft => {
                    assert_eq!(index, "second");
                    assert_eq!(worktree, "working\n");
                }
                ResetMode::Mixed => {
                    assert_eq!(index, "first");
                    assert_eq!(worktree, "working\n");
                }
                ResetMode::Hard => {
                    assert_eq!(index, "first");
                    assert_eq!(worktree, "first\n");
                }
            }
            assert_ne!(git(root, &["rev-parse", "HEAD"]), second);
        }
    }

    #[test]
    fn revalida_solamente_el_estado_que_cada_modo_reemplaza() {
        let (temporary, first, _) = repository();
        let root = temporary.path();
        let before = status::reset_precondition(root);
        fs::write(root.join("tracked.txt"), "changed after dialog\n").unwrap();
        reset(root, &first, ResetMode::Mixed, "main", &before).unwrap();

        let (temporary, first, _) = repository();
        let root = temporary.path();
        let before = status::reset_precondition(root);
        fs::write(root.join("tracked.txt"), "staged after dialog\n").unwrap();
        git(root, &["add", "tracked.txt"]);
        assert!(matches!(
            reset(root, &first, ResetMode::Mixed, "main", &before),
            Err(ResetError::Stale(reference)) if reference == "main"
        ));

        let (temporary, first, _) = repository();
        let root = temporary.path();
        let before = status::reset_precondition(root);
        fs::write(root.join("tracked.txt"), "changed after dialog\n").unwrap();
        assert!(matches!(
            reset(root, &first, ResetMode::Hard, "main", &before),
            Err(ResetError::Stale(reference)) if reference == "main"
        ));
    }

    #[test]
    fn hard_no_borra_un_archivo_sin_seguimiento_que_colisiona() {
        let temporary = TempDir::new().unwrap();
        let root = temporary.path();
        git(root, &["init", "-b", "main"]);
        fs::write(root.join("collision.txt"), "tracked\n").unwrap();
        git(root, &["add", "collision.txt"]);
        git(root, &["commit", "-m", "with collision"]);
        let target = git(root, &["rev-parse", "HEAD"]);
        git(root, &["rm", "collision.txt"]);
        git(root, &["commit", "-m", "without collision"]);
        fs::write(root.join("collision.txt"), "keep me\n").unwrap();
        let before = status::reset_precondition(root);

        assert!(matches!(
            reset(root, &target, ResetMode::Hard, "main", &before),
            Err(ResetError::UntrackedCollision { sha, count })
                if sha == short_sha(&target) && count == 1
        ));
        assert_eq!(
            fs::read_to_string(root.join("collision.txt")).unwrap(),
            "keep me\n"
        );
    }
}

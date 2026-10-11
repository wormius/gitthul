//! Guardados reales, dirigidos por el OID y la foto de trabajo observados.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Output;

use serde::{Deserialize, Serialize};

use super::refs::{self, RefsSnapshot};
use super::status::{self, ResetPrecondition, WorkingStatus};

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
    pub(super) expected_stash: String,
    precondition: ResetPrecondition,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StashError {
    Stale(String),
    NothingToStash,
    Conflict {
        stash: String,
        branch: String,
        count: usize,
    },
    BlockedByWip {
        stash: String,
        branch: String,
        count: usize,
    },
    RecoveryMissing,
    StillConflicted(usize),
    GitFailed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StashRecoveryKind {
    Apply,
    Pop,
}

const RECOVERY_BEFORE: &str = "refs/gitthul/stash-recovery/before";
const RECOVERY_TARGET: &str = "refs/gitthul/stash-recovery/target";
const RECOVERY_HEAD: &str = "refs/gitthul/stash-recovery/head";
const RECOVERY_POP: &str = "refs/gitthul/stash-recovery/pop";

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
        return Err(StashError::GitFailed);
    }
    let after = resolve(repository, "refs/stash");
    if after.is_none() || after == before {
        return Err(StashError::NothingToStash);
    }
    refs::read(repository).map_err(|_| StashError::GitFailed)
}

pub fn apply(
    repository: &Path,
    index: usize,
    options: &ApplyStashOptions,
) -> Result<WorkingStatus, StashError> {
    verify_worktree(repository, &options.precondition)?;
    let selector = format!("stash@{{{index}}}");
    verify_stash(repository, &selector, &options.expected_stash)?;
    prepare_recovery(
        repository,
        &options.expected_stash,
        options.drop == Some(true),
    )?;
    let mut output = command(repository, &["stash", "apply", "--index", RECOVERY_TARGET])?;
    // Git cannot restore a staged stash patch onto a diverged index. It stops
    // before the three-way merge and explicitly asks to retry without --index.
    // Only retry that failure, and only while all user content is unchanged.
    if !output.status.success()
        && String::from_utf8_lossy(&output.stderr)
            .contains("conflicts in index. Try without --index.")
        && status::reset_precondition(repository) == options.precondition
    {
        output = command(repository, &["stash", "apply", RECOVERY_TARGET])?;
    }
    if !output.status.success() {
        let current = status::read(repository).map_err(|_| StashError::GitFailed)?;
        let count = current.conflicted_count();
        if count > 0 {
            return Err(StashError::Conflict {
                stash: selector,
                branch: branch(repository),
                count,
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
                stash: selector,
                branch: branch(repository),
                count: changed,
            });
        }
        return Err(StashError::GitFailed);
    }
    if options.drop == Some(true) {
        drop_stash_oid(repository, &options.expected_stash)?;
    }
    clear_recovery(repository)?;
    status::read(repository).map_err(|_| StashError::GitFailed)
}

/** Termina una aplicación conflictiva; Pop retira el stash solo en este punto. */
pub fn finish_recovery(repository: &Path) -> Result<(), StashError> {
    let recovery = read_recovery(repository)?;
    let conflicts = status::read(repository)
        .map_err(|_| StashError::GitFailed)?
        .conflicted_count();
    if conflicts > 0 {
        return Err(StashError::StillConflicted(conflicts));
    }
    if recovery.kind == StashRecoveryKind::Pop {
        drop_stash_oid(repository, &recovery.target)?;
    }
    clear_recovery(repository)
}

/** Restaura HEAD, índice, árbol rastreado y no seguidos capturados antes del stash. */
pub fn abort_recovery(repository: &Path) -> Result<(), StashError> {
    let recovery = read_recovery(repository)?;
    if resolve(repository, "HEAD").as_deref() != Some(recovery.head.as_str()) {
        return Err(StashError::Stale("HEAD".to_owned()));
    }

    let reset = command(repository, &["reset", "--hard", RECOVERY_HEAD])?;
    if !reset.status.success() {
        return Err(StashError::GitFailed);
    }

    let mut untracked = untracked_paths(repository, &recovery.target)?;
    untracked.extend(untracked_paths(repository, &recovery.before)?);
    clean_paths(repository, &untracked)?;

    if recovery.before != recovery.head {
        let restored = command(repository, &["stash", "apply", "--index", RECOVERY_BEFORE])?;
        if !restored.status.success() {
            return Err(StashError::GitFailed);
        }
    }
    clear_recovery(repository)
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
}

fn prepare_recovery(repository: &Path, target: &str, pop: bool) -> Result<(), StashError> {
    if recovery_kind(repository).is_some() {
        return Err(StashError::Stale("stash recovery".to_owned()));
    }
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
        return Err(StashError::GitFailed);
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
            return Err(StashError::GitFailed);
        }
        resolve(repository, "refs/stash")
            .filter(|current| Some(current) != previous_top.as_ref())
            .unwrap_or_else(|| head.clone())
    };

    update_ref(repository, RECOVERY_BEFORE, &before)?;
    update_ref(repository, RECOVERY_TARGET, target)?;
    update_ref(repository, RECOVERY_HEAD, &head)?;
    if pop {
        update_ref(repository, RECOVERY_POP, target)?;
    }

    if before != head {
        let restored = command(repository, &["stash", "apply", "--index", RECOVERY_BEFORE])?;
        if !restored.status.success() {
            return Err(StashError::GitFailed);
        }
        drop_stash_oid(repository, &before)?;
    }
    Ok(())
}

fn read_recovery(repository: &Path) -> Result<StashRecovery, StashError> {
    let before = resolve(repository, RECOVERY_BEFORE).ok_or(StashError::RecoveryMissing)?;
    let target = resolve(repository, RECOVERY_TARGET).ok_or(StashError::RecoveryMissing)?;
    let head = resolve(repository, RECOVERY_HEAD).ok_or(StashError::RecoveryMissing)?;
    let kind = if resolve(repository, RECOVERY_POP).is_some() {
        StashRecoveryKind::Pop
    } else {
        StashRecoveryKind::Apply
    };
    Ok(StashRecovery {
        before,
        target,
        head,
        kind,
    })
}

fn clear_recovery(repository: &Path) -> Result<(), StashError> {
    for reference in [
        RECOVERY_POP,
        RECOVERY_BEFORE,
        RECOVERY_TARGET,
        RECOVERY_HEAD,
    ] {
        let output = command(repository, &["update-ref", "-d", reference])?;
        if !output.status.success() {
            return Err(StashError::GitFailed);
        }
    }
    Ok(())
}

fn update_ref(repository: &Path, reference: &str, oid: &str) -> Result<(), StashError> {
    let output = command(repository, &["update-ref", reference, oid])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(StashError::GitFailed)
    }
}

fn drop_stash_oid(repository: &Path, oid: &str) -> Result<(), StashError> {
    let output = command(repository, &["stash", "list", "--format=%H"])?;
    if !output.status.success() {
        return Err(StashError::GitFailed);
    }
    let Some(index) = String::from_utf8(output.stdout)
        .map_err(|_| StashError::GitFailed)?
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
        Err(StashError::GitFailed)
    }
}

fn untracked_paths(repository: &Path, stash_oid: &str) -> Result<BTreeSet<String>, StashError> {
    let third_parent = format!("{stash_oid}^3");
    let Some(tree) = resolve(repository, &third_parent) else {
        return Ok(BTreeSet::new());
    };
    let output = command(repository, &["ls-tree", "-r", "-z", "--name-only", &tree])?;
    if !output.status.success() {
        return Err(StashError::GitFailed);
    }
    output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8(path.to_vec()).map_err(|_| StashError::GitFailed))
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
        Err(StashError::GitFailed)
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
        return Err(StashError::GitFailed);
    }
    refs::read(repository).map_err(|_| StashError::GitFailed)
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
        return Err(StashError::GitFailed);
    }
    let fields = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .map(|field| String::from_utf8(field.to_vec()).map_err(|_| StashError::GitFailed))
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
        return Err(StashError::GitFailed);
    }
    for (sha, subject) in entries.iter().rev() {
        let stored = command(repository, &["stash", "store", "-m", subject, sha])?;
        if !stored.status.success() {
            return Err(StashError::GitFailed);
        }
    }
    refs::read(repository).map_err(|_| StashError::GitFailed)
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
    Some(String::from_utf8(output.stdout).ok()?.trim().to_owned())
}

fn branch(repository: &Path) -> String {
    let output = command(repository, &["symbolic-ref", "--quiet", "--short", "HEAD"]);
    output
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "HEAD".to_owned())
}

fn command(repository: &Path, args: &[&str]) -> Result<Output, StashError> {
    crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| StashError::GitFailed)
}

/** La captura privada no depende de que el repositorio tenga identidad para commits. */
fn recovery_snapshot(repository: &Path, args: &[&str]) -> Result<Output, StashError> {
    crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "GitThul recovery")
        .env("GIT_AUTHOR_EMAIL", "recovery@gitthul.invalid")
        .env("GIT_COMMITTER_NAME", "GitThul recovery")
        .env("GIT_COMMITTER_EMAIL", "recovery@gitthul.invalid")
        .output()
        .map_err(|_| StashError::GitFailed)
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
            Err(StashError::GitFailed)
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
}

use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::{ignore, run_local_write, GitWriteLocks};

fn git(repository: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .current_dir(repository)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", repository.join("absent-global-config"))
        .env("LC_ALL", "C")
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}: {:?}", args, output);
    output.stdout
}

fn repository() -> TempDir {
    let temporary = tempfile::tempdir().unwrap();
    git(
        temporary.path(),
        &["init", "--quiet", "--initial-branch=main"],
    );
    git(temporary.path(), &["config", "user.name", "GitThul Test"]);
    git(
        temporary.path(),
        &["config", "user.email", "gitthul@example.invalid"],
    );
    git(temporary.path(), &["config", "core.autocrlf", "false"]);
    temporary
}

fn ignore_write(
    repository: &Path,
    locks: &GitWriteLocks,
    pattern: &str,
    untrack: bool,
) -> Result<Value, super::GitCommandError> {
    let pattern = pattern.to_owned();
    let options = serde_json::from_value(json!({ "untrack": untrack })).unwrap();
    tauri::async_runtime::block_on(run_local_write(
        repository.to_string_lossy().into_owned(),
        locks.clone(),
        "undo.ignore",
        vec![".gitignore".to_owned()],
        move |repository| ignore::ignore(repository, &pattern, &options),
    ))
    .map(|status| serde_json::to_value(status).unwrap())
}

#[test]
fn ignore_untracked_updates_real_status_and_undo_redo_without_touching_file() {
    let temporary = repository();
    let root = temporary.path();
    let id = root.to_string_lossy();
    fs::create_dir(root.join("carpeta con espacios")).unwrap();
    let name = "carpeta con espacios/archivo ñ.txt";
    fs::write(root.join(name), "local work\n").unwrap();
    let locks = GitWriteLocks::default();

    let status = ignore_write(root, &locks, name, false).unwrap();
    assert!(status["staged"].as_array().unwrap().is_empty());
    let unstaged = status["unstaged"].as_array().unwrap();
    assert_eq!(unstaged.len(), 1);
    assert_eq!(unstaged[0]["path"], ".gitignore");
    assert!(git(root, &["ls-files", "--cached"]).is_empty());
    assert_eq!(fs::read(root.join(name)).unwrap(), b"local work\n");
    assert_eq!(
        serde_json::to_value(locks.undo.read(&id)).unwrap()["undo"][0]["labelKey"],
        "undo.ignore"
    );

    locks.undo.undo(&id, root).unwrap();
    assert!(!root.join(".gitignore").exists());
    assert!(git(root, &["status", "--porcelain"]).starts_with(b"?? "));
    fs::write(root.join(name), "later local work\n").unwrap();
    locks.undo.redo(&id, root).unwrap();
    assert!(git(root, &["ls-files", "--others", "--exclude-standard"]).ends_with(b".gitignore\n"));
    assert_eq!(fs::read(root.join(name)).unwrap(), b"later local work\n");

    fs::write(root.join(".gitignore"), "manual rule\n").unwrap();
    assert_eq!(
        locks.undo.undo(&id, root),
        Err(super::undo::UndoError::Stale)
    );
    assert_eq!(fs::read(root.join(".gitignore")).unwrap(), b"manual rule\n");
}

#[test]
fn ignore_untrack_undo_restores_exact_index_and_keeps_later_worktree_edits() {
    let temporary = repository();
    let root = temporary.path();
    let id = root.to_string_lossy();
    fs::write(root.join("tracked.log"), "committed\n").unwrap();
    git(root, &["add", "tracked.log"]);
    git(root, &["commit", "--quiet", "-m", "base"]);
    fs::write(root.join("tracked.log"), "prepared\n").unwrap();
    fs::write(root.join("other.txt"), "unrelated prepared\n").unwrap();
    git(root, &["add", "tracked.log", "other.txt"]);
    fs::write(root.join("tracked.log"), "working\n").unwrap();
    let locks = GitWriteLocks::default();

    let status = ignore_write(root, &locks, "tracked.log", true).unwrap();
    assert!(status["staged"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| { entry["path"] == "tracked.log" && entry["change"] == "deleted" }));
    assert!(git(root, &["ls-files", "--", "tracked.log"]).is_empty());
    assert_eq!(git(root, &["show", ":other.txt"]), b"unrelated prepared\n");
    assert_eq!(fs::read(root.join("tracked.log")).unwrap(), b"working\n");

    fs::write(root.join("tracked.log"), "later working\n").unwrap();
    locks.undo.undo(&id, root).unwrap();
    assert!(!root.join(".gitignore").exists());
    assert_eq!(git(root, &["show", ":tracked.log"]), b"prepared\n");
    assert_eq!(git(root, &["show", ":other.txt"]), b"unrelated prepared\n");
    assert_eq!(
        fs::read(root.join("tracked.log")).unwrap(),
        b"later working\n"
    );
    locks.undo.redo(&id, root).unwrap();
    assert!(git(root, &["ls-files", "--", "tracked.log"]).is_empty());
    assert_eq!(
        fs::read(root.join("tracked.log")).unwrap(),
        b"later working\n"
    );
}

#[test]
fn ignore_in_linked_worktree_keeps_main_ignore_file_and_index_untouched() {
    let temporary = repository();
    let root = temporary.path();
    fs::write(root.join("tracked.txt"), "committed\n").unwrap();
    git(root, &["add", "tracked.txt"]);
    git(root, &["commit", "--quiet", "-m", "base"]);
    let linked_parent = tempfile::tempdir().unwrap();
    let linked = linked_parent.path().join("linked");
    git(
        root,
        &[
            "worktree",
            "add",
            "--quiet",
            "-b",
            "linked",
            linked.to_str().unwrap(),
        ],
    );
    let main_index = git(root, &["write-tree"]);
    let locks = GitWriteLocks::default();
    ignore_write(&linked, &locks, "tracked.txt", true).unwrap();

    assert!(!root.join(".gitignore").exists());
    assert!(linked.join(".gitignore").exists());
    assert_eq!(git(root, &["write-tree"]), main_index);
    assert!(git(&linked, &["ls-files", "--", "tracked.txt"]).is_empty());
    assert_eq!(
        fs::read(linked.join("tracked.txt")).unwrap(),
        b"committed\n"
    );
    locks.undo.undo(&linked.to_string_lossy(), &linked).unwrap();
    assert!(!linked.join(".gitignore").exists());
    assert_eq!(git(&linked, &["show", ":tracked.txt"]), b"committed\n");
    assert_eq!(git(root, &["write-tree"]), main_index);
}

#[test]
fn ignore_keeps_real_missing_repository_errors() {
    let temporary = tempfile::tempdir().unwrap();
    let locks = GitWriteLocks::default();
    assert_eq!(
        ignore_write(&temporary.path().join("missing"), &locks, "file.txt", false)
            .unwrap_err()
            .code,
        "repo.notFound"
    );
    assert_eq!(
        ignore_write(temporary.path(), &locks, "file.txt", false)
            .unwrap_err()
            .code,
        "repo.notARepository"
    );
}

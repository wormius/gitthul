use std::{fs, path::Path, process::Output};

use serde_json::Value;
use tempfile::TempDir;

use super::{ref_write, refs, run_set_upstream, GitWriteLocks};

fn output(repository: &Path, args: &[&str]) -> Output {
    crate::process::command("git")
        .current_dir(repository)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", repository.join("absent-global-config"))
        .env("LC_ALL", "C")
        .output()
        .unwrap()
}

fn git(repository: &Path, args: &[&str]) -> Vec<u8> {
    let result = output(repository, args);
    assert!(result.status.success(), "git {args:?}: {result:?}");
    result.stdout
}

fn repository() -> TempDir {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    git(root, &["init", "--quiet", "--initial-branch=main"]);
    git(root, &["config", "user.name", "GitThul Test"]);
    git(root, &["config", "user.email", "test@example.invalid"]);
    git(root, &["config", "core.autocrlf", "false"]);
    fs::create_dir(root.join("empty-hooks")).unwrap();
    git(
        root,
        &[
            "config",
            "core.hooksPath",
            root.join("empty-hooks").to_str().unwrap(),
        ],
    );
    fs::write(root.join("file.txt"), b"committed\n").unwrap();
    git(root, &["add", "--", "file.txt"]);
    git(root, &["commit", "--quiet", "-m", "base"]);
    git(root, &["branch", "topic"]);
    git(
        root,
        &[
            "remote",
            "add",
            "origin",
            root.join("uncontacted.git").to_str().unwrap(),
        ],
    );
    git(root, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(root, &["update-ref", "refs/remotes/origin/other", "HEAD"]);
    temporary
}

fn config(repository: &Path) -> Vec<u8> {
    let repo = gix::open(repository).unwrap();
    fs::read(repo.common_dir().join("config")).unwrap()
}

fn tracking(repository: &Path, branch: &str) -> Option<String> {
    let snapshot = serde_json::to_value(refs::read(repository).unwrap()).unwrap();
    snapshot["branches"]
        .as_array()
        .unwrap()
        .iter()
        .find(|candidate| candidate["kind"] == "local" && candidate["name"] == branch)
        .unwrap()["upstream"]
        .as_str()
        .map(str::to_owned)
}

fn set(repository: &Path, branch: &str, upstream: Option<&str>) {
    ref_write::set_upstream(repository, branch, upstream).unwrap();
}

fn change(repository: &Path, branch: &str, upstream: Option<&str>, locks: &GitWriteLocks) -> Value {
    serde_json::to_value(
        tauri::async_runtime::block_on(run_set_upstream(
            repository.to_string_lossy().into_owned(),
            branch.to_owned(),
            upstream.map(str::to_owned),
            locks.clone(),
        ))
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn upstream_set_unset_and_repeated_operations_preserve_exact_configuration() {
    let temporary = repository();
    let root = temporary.path();
    set(root, "topic", None);
    set(root, "topic", Some("origin/main"));
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/main"));
    assert_eq!(
        git(root, &["config", "--get", "branch.topic.remote"]),
        b"origin\n"
    );
    assert_eq!(
        git(root, &["config", "--get", "branch.topic.merge"]),
        b"refs/heads/main\n"
    );
    let before = config(root);
    set(root, "topic", Some("refs/remotes/origin/main"));
    assert_eq!(config(root), before);
    set(root, "topic", Some("origin/other"));
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/other"));
    assert_eq!(
        git(root, &["config", "--get-all", "branch.topic.merge"]),
        b"refs/heads/other\n"
    );
    set(root, "topic", None);
    assert_eq!(tracking(root, "topic"), None);
    assert_eq!(
        output(root, &["config", "--get", "branch.topic.remote"])
            .status
            .code(),
        Some(1)
    );
    assert_eq!(
        output(root, &["config", "--get", "branch.topic.merge"])
            .status
            .code(),
        Some(1)
    );
    let before = config(root);
    set(root, "topic", None);
    assert_eq!(config(root), before);
    assert!(!root.join("uncontacted.git").exists());
}

#[test]
fn upstream_non_current_branch_keeps_head_index_local_files_and_other_branch_configuration() {
    let temporary = repository();
    let root = temporary.path();
    set(root, "main", Some("origin/main"));
    git(
        root,
        &[
            "config",
            "branch.topic.description",
            "keep this description",
        ],
    );
    fs::write(root.join("file.txt"), b"staged\n").unwrap();
    git(root, &["add", "--", "file.txt"]);
    fs::write(root.join("file.txt"), b"working\r\n").unwrap();
    fs::write(root.join("archivo nuevo ñ.txt"), b"new\0local\xff").unwrap();
    let index = fs::read(root.join(".git/index")).unwrap();
    let head = fs::read(root.join(".git/HEAD")).unwrap();
    let references = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    );
    set(root, "topic", Some("origin/other"));
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/other"));
    assert_eq!(tracking(root, "main").as_deref(), Some("origin/main"));
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    assert_eq!(
        git(
            root,
            &[
                "for-each-ref",
                "--format=%(refname) %(objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags"
            ]
        ),
        references
    );
    assert_eq!(fs::read(root.join("file.txt")).unwrap(), b"working\r\n");
    assert_eq!(
        fs::read(root.join("archivo nuevo ñ.txt")).unwrap(),
        b"new\0local\xff"
    );
    assert_eq!(git(root, &["show", ":file.txt"]), b"staged\n");
    assert_eq!(
        git(root, &["config", "--get", "branch.topic.description"]),
        b"keep this description\n"
    );
}

#[test]
fn upstream_remote_alias_resolves_exactly_and_existing_local_upstream_can_be_removed() {
    let temporary = repository();
    let root = temporary.path();
    git(
        root,
        &["branch", "--set-upstream-to=refs/heads/main", "--", "topic"],
    );
    let before = config(root);
    let ref_write::WriteRefError::Diagnostic(diagnostic) =
        ref_write::set_upstream(root, "topic", Some("refs/heads/main")).unwrap_err()
    else {
        panic!("Expected unsupported local upstream diagnostic")
    };
    assert_eq!(
        serde_json::to_value(diagnostic).unwrap()["stage"],
        "setUpstream.unsupportedLocalUpstream"
    );
    assert_eq!(config(root), before);
    assert_eq!(
        git(root, &["config", "--get", "branch.topic.remote"]),
        b".\n"
    );
    set(root, "topic", None);
    assert_eq!(
        output(root, &["config", "--get", "branch.topic.remote"])
            .status
            .code(),
        Some(1)
    );
    git(
        root,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
    set(root, "topic", Some("refs/remotes/origin/HEAD"));
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/main"));
}

#[test]
fn upstream_ambiguous_short_name_requires_full_reference_without_changing_configuration() {
    let temporary = repository();
    let root = temporary.path();
    git(root, &["branch", "origin/main"]);
    let before = config(root);
    assert!(ref_write::set_upstream(root, "topic", Some("origin/main")).is_err());
    assert_eq!(config(root), before);
    set(root, "topic", Some("refs/remotes/origin/main"));
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/main"));
    let before = config(root);
    assert!(ref_write::set_upstream(root, "topic", Some("refs/heads/origin/main")).is_err());
    assert_eq!(config(root), before);
}

#[test]
fn upstream_missing_names_and_option_revision_expressions_never_mutate_configuration() {
    let temporary = repository();
    let root = temporary.path();
    let before = config(root);
    for branch in [
        "missing",
        "",
        "--delete",
        "-u",
        "HEAD",
        "@{-1}",
        "../main",
        "two names",
        "bad\nname",
        "bad\0name",
    ] {
        assert!(
            ref_write::set_upstream(root, branch, Some("origin/main")).is_err(),
            "{branch:?}"
        );
        assert_eq!(config(root), before);
    }
    for target in [
        "missing",
        "origin/missing",
        "",
        "--unset-upstream",
        "@{upstream}",
        "HEAD",
        "refs/tags/main",
        "origin/main:other",
        "origin/main\nother",
        "origin/main\0other",
    ] {
        assert!(
            ref_write::set_upstream(root, "topic", Some(target)).is_err(),
            "{target:?}"
        );
        assert_eq!(config(root), before);
    }
}

#[test]
fn upstream_shell_metacharacters_in_existing_branch_names_remain_literal_arguments() {
    let temporary = repository();
    let root = temporary.path();
    git(root, &["branch", "topic;echo-marker"]);
    git(
        root,
        &["update-ref", "refs/remotes/origin/$(echo-marker)", "HEAD"],
    );
    set(root, "topic;echo-marker", Some("origin/$(echo-marker)"));
    assert_eq!(
        tracking(root, "topic;echo-marker").as_deref(),
        Some("origin/$(echo-marker)")
    );
    assert!(!root.join("echo-marker").exists());
    assert_eq!(git(root, &["branch", "--show-current"]), b"main\n");
}

#[test]
fn upstream_pruned_target_can_be_unset_without_network_access() {
    let temporary = repository();
    let root = temporary.path();
    set(root, "topic", Some("origin/main"));
    git(root, &["update-ref", "-d", "refs/remotes/origin/main"]);
    assert!(ref_write::set_upstream(root, "topic", Some("origin/main")).is_err());
    set(root, "topic", None);
    assert_eq!(tracking(root, "topic"), None);
}

#[test]
fn upstream_multi_merge_and_partial_configuration_require_explicit_repair_before_mutation() {
    let temporary = repository();
    let root = temporary.path();
    set(root, "topic", Some("origin/main"));
    git(
        root,
        &["config", "--add", "branch.topic.merge", "refs/heads/other"],
    );
    let before = config(root);
    for target in [Some("origin/main"), Some("origin/other"), None] {
        assert!(ref_write::set_upstream(root, "topic", target).is_err());
        assert_eq!(config(root), before);
    }
    git(root, &["config", "--unset-all", "branch.topic.merge"]);
    let before = config(root);
    for target in [None, Some("origin/other")] {
        assert!(ref_write::set_upstream(root, "topic", target).is_err());
        assert_eq!(config(root), before);
    }
}

#[test]
fn upstream_linked_worktree_updates_common_config_and_preserves_its_own_index_and_worktree_settings(
) {
    let temporary = repository();
    let folder = tempfile::tempdir().unwrap();
    let root = temporary.path();
    let linked = folder.path().join("linked");
    git(
        root,
        &[
            "worktree",
            "add",
            "--quiet",
            linked.to_str().unwrap(),
            "topic",
        ],
    );
    git(root, &["config", "extensions.worktreeConfig", "true"]);
    git(
        &linked,
        &["config", "--worktree", "user.name", "Worktree identity"],
    );
    let repo = gix::open(&linked).unwrap();
    let worktree_config = repo.git_dir().join("config.worktree");
    let index = repo.git_dir().join("index");
    let original_settings = fs::read(&worktree_config).unwrap();
    let original_index = fs::read(&index).unwrap();
    fs::write(linked.join("file.txt"), b"linked local edits\n").unwrap();
    set(&linked, "topic", Some("origin/main"));
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/main"));
    assert_eq!(tracking(&linked, "topic").as_deref(), Some("origin/main"));
    assert_eq!(fs::read(&worktree_config).unwrap(), original_settings);
    assert_eq!(fs::read(&index).unwrap(), original_index);
    assert_eq!(
        fs::read(linked.join("file.txt")).unwrap(),
        b"linked local edits\n"
    );
    set(&linked, "topic", None);
    assert_eq!(tracking(root, "topic"), None);
    assert_eq!(fs::read(&worktree_config).unwrap(), original_settings);
}

#[test]
fn upstream_conflicting_worktree_overrides_are_rejected_before_touching_either_config() {
    let temporary = repository();
    let root = temporary.path();
    git(root, &["config", "extensions.worktreeConfig", "true"]);
    git(
        root,
        &["config", "--worktree", "branch.topic.remote", "origin"],
    );
    git(
        root,
        &[
            "config",
            "--worktree",
            "branch.topic.merge",
            "refs/heads/main",
        ],
    );
    let worktree_file = gix::open(root).unwrap().git_dir().join("config.worktree");
    let common = config(root);
    let worktree = fs::read(&worktree_file).unwrap();
    // An equivalent singleton relation is a genuine no-op in this scope.
    set(root, "topic", Some("origin/main"));
    for target in [Some("origin/other"), None] {
        assert!(ref_write::set_upstream(root, "topic", target).is_err());
        assert_eq!(config(root), common);
        assert_eq!(fs::read(&worktree_file).unwrap(), worktree);
    }
}

#[test]
fn upstream_included_configuration_is_preserved_instead_of_partly_overridden() {
    let temporary = repository();
    let root = temporary.path();
    let include = root.join(".git/upstream-settings.inc");
    fs::write(
        &include,
        b"[branch \"topic\"]\n\tremote = origin\n\tmerge = refs/heads/main\n",
    )
    .unwrap();
    git(root, &["config", "include.path", "upstream-settings.inc"]);
    let common = config(root);
    let included = fs::read(&include).unwrap();
    set(root, "topic", Some("origin/main"));
    for target in [Some("origin/other"), None] {
        assert!(ref_write::set_upstream(root, "topic", target).is_err());
        assert_eq!(config(root), common);
        assert_eq!(fs::read(&include).unwrap(), included);
    }
}

#[test]
fn upstream_configuration_lock_failure_retains_native_exit_status_and_stderr() {
    let temporary = repository();
    let root = temporary.path();
    let before = config(root);
    fs::write(root.join(".git/config.lock"), b"another process\n").unwrap();
    let ref_write::WriteRefError::Diagnostic(diagnostic) =
        ref_write::set_upstream(root, "topic", Some("origin/main")).unwrap_err()
    else {
        panic!("Expected native command evidence")
    };
    let value = serde_json::to_value(diagnostic).unwrap();
    assert_eq!(value["stage"], "setUpstream.write");
    assert_ne!(value["exitCode"], 0);
    assert!(value["stderr"].as_str().unwrap().contains("lock config"));
    assert_eq!(config(root), before);
}

#[test]
fn upstream_command_returns_real_refs_and_undo_redo_restore_configuration_only() {
    let temporary = repository();
    let root = temporary.path();
    let locks = GitWriteLocks::default();
    let id = root.to_string_lossy();
    fs::write(root.join("file.txt"), b"staged before upstream\n").unwrap();
    git(root, &["add", "--", "file.txt"]);
    fs::write(root.join("file.txt"), b"working before upstream\n").unwrap();
    let index = fs::read(root.join(".git/index")).unwrap();
    let before = config(root);
    let snapshot = change(root, "topic", Some("origin/main"), &locks);
    assert!(snapshot["branches"]
        .as_array()
        .unwrap()
        .iter()
        .any(|branch| branch["name"] == "topic" && branch["upstream"] == "origin/main"));
    let after = config(root);
    assert_eq!(
        serde_json::to_value(locks.undo.read(&id)).unwrap()["undo"][0]["labelKey"],
        "undo.upstream"
    );
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    fs::write(root.join("file.txt"), b"later working edits\n").unwrap();
    locks.undo.undo(&id, root).unwrap();
    assert_eq!(config(root), before);
    assert_eq!(tracking(root, "topic"), None);
    assert_eq!(
        fs::read(root.join("file.txt")).unwrap(),
        b"later working edits\n"
    );
    locks.undo.redo(&id, root).unwrap();
    assert_eq!(config(root), after);
    assert_eq!(tracking(root, "topic").as_deref(), Some("origin/main"));
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(root.join("file.txt")).unwrap(),
        b"later working edits\n"
    );
}

#[test]
fn upstream_command_reports_missing_repository_instead_of_a_simulated_reference_snapshot() {
    let temporary = tempfile::tempdir().unwrap();
    let error = tauri::async_runtime::block_on(run_set_upstream(
        temporary
            .path()
            .join("missing")
            .to_string_lossy()
            .into_owned(),
        "main".to_owned(),
        Some("origin/main".to_owned()),
        GitWriteLocks::default(),
    ))
    .unwrap_err();
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "repo.notFound"
    );
}

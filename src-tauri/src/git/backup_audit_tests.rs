//! Independent end-to-end checks for autonomous repository backup boundaries.
use super::backup_store::{BackupError, BackupPolicy, BackupStore, CaptureOutcome};
use std::{fs, path::Path, sync::atomic::AtomicBool};

fn git(repository: &Path, arguments: &[&str]) -> String {
    let output = crate::process::command("git")
        .current_dir(repository)
        .args(arguments)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{arguments:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn repository(path: &Path) {
    fs::create_dir(path).unwrap();
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.name", "Backup Audit"]);
    git(path, &["config", "user.email", "audit@example.invalid"]);
    git(path, &["config", "core.autocrlf", "false"]);
    fs::write(path.join("tracked.txt"), "committed\n").unwrap();
    git(path, &["add", "."]);
    git(path, &["commit", "-m", "initial"]);
}

fn capture(store: &BackupStore, source: &Path) -> String {
    match store.capture(source, &AtomicBool::new(false)).unwrap() {
        CaptureOutcome::Created { point } => point.id,
        outcome => panic!("unexpected {outcome:?}"),
    }
}

#[test]
fn split_index_backup_restores_without_source_shared_index_or_remote() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    git(&source, &["update-index", "--split-index"]);
    fs::write(source.join("tracked.txt"), "staged\n").unwrap();
    git(&source, &["add", "tracked.txt"]);
    fs::write(source.join("tracked.txt"), "working\n").unwrap();
    fs::write(source.join("untracked.txt"), "untracked\n").unwrap();
    let status = git(
        &source,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    );
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let id = capture(&store, &source);
    fs::remove_dir_all(&source).unwrap();
    let restored = temporary.path().join("restored");
    store
        .restore(&id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(
        git(
            &restored,
            &["status", "--porcelain=v1", "--untracked-files=all"]
        ),
        status
    );
    assert_eq!(git(&restored, &["show", ":tracked.txt"]), "staged\n");
    assert_eq!(git(&restored, &["show", "HEAD:tracked.txt"]), "committed\n");
    git(&restored, &["fsck", "--full", "--strict"]);
}

#[test]
fn a_published_point_remains_valid_after_the_store_is_reopened() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    let root = temporary.path().join("backups");
    let store = BackupStore::new(root.clone(), BackupPolicy::default()).unwrap();
    let id = capture(&store, &source);
    let bytes = store.list().unwrap().total_bytes;
    drop(store);
    let reopened = BackupStore::new(root, BackupPolicy::default()).unwrap();
    let catalog = reopened.list().unwrap();
    assert_eq!(catalog.corrupt_points, 0);
    assert_eq!(catalog.total_bytes, bytes);
    assert_eq!(catalog.points[0].id, id);
    assert!(matches!(
        reopened.capture(&source, &AtomicBool::new(false)).unwrap(),
        CaptureOutcome::TooSoon { .. }
    ));
    fs::remove_dir_all(&source).unwrap();
    let restored = temporary.path().join("restored");
    reopened
        .restore(&id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(git(&restored, &["show", "HEAD:tracked.txt"]), "committed\n");
}

#[test]
fn a_linked_worktree_does_not_inherit_the_main_worktrees_operation_files_or_local_refs() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    let linked = temporary.path().join("linked");
    repository(&source);
    git(
        &source,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    let oid = git(&source, &["rev-parse", "HEAD"]).trim().to_owned();
    for name in [
        "MERGE_RR",
        "BISECT_EXPECTED_REV",
        "BISECT_TERMS",
        "BISECT_ANCESTORS_OK",
        "BISECT_HEAD",
    ] {
        fs::write(source.join(".git").join(name), format!("{oid}\n")).unwrap();
    }
    fs::write(
        source.join(".git/SQUASH_MSG"),
        "main worktree squash message",
    )
    .unwrap();
    for name in [
        "refs/bisect/bad",
        "refs/rewritten/main",
        "refs/worktree/main",
    ] {
        git(&source, &["update-ref", name, &oid]);
    }
    git(&linked, &["update-ref", "refs/worktree/selected", &oid]);
    let linked_gitdir =
        std::path::PathBuf::from(git(&linked, &["rev-parse", "--absolute-git-dir"]).trim());
    fs::write(
        linked_gitdir.join("SQUASH_MSG"),
        "selected worktree squash message",
    )
    .unwrap();
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let id = capture(&store, &linked);
    fs::remove_dir_all(&linked).unwrap();
    fs::remove_dir_all(&source).unwrap();
    let restored = temporary.path().join("restored");
    store
        .restore(&id, &restored, &AtomicBool::new(false))
        .unwrap();
    for name in [
        "MERGE_RR",
        "BISECT_EXPECTED_REV",
        "BISECT_TERMS",
        "BISECT_ANCESTORS_OK",
        "BISECT_HEAD",
        "refs/bisect/bad",
        "refs/rewritten/main",
        "refs/worktree/main",
    ] {
        assert!(
            !restored.join(".git").join(name).exists(),
            "inherited main-only {name}"
        );
    }
    assert_eq!(
        fs::read_to_string(restored.join(".git/SQUASH_MSG")).unwrap(),
        "selected worktree squash message"
    );
    assert_eq!(
        git(&restored, &["rev-parse", "refs/worktree/selected"]).trim(),
        oid
    );
    assert_eq!(git(&restored, &["branch", "--show-current"]), "linked\n");
}

#[test]
fn a_deleted_historical_submodule_is_preserved_or_explicitly_refuses_an_incomplete_point() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    let module_source = temporary.path().join("module-source");
    repository(&source);
    repository(&module_source);
    fs::write(
        module_source.join("historical-module.txt"),
        "historical module payload\n",
    )
    .unwrap();
    git(&module_source, &["add", "."]);
    git(&module_source, &["commit", "-m", "module history"]);
    git(
        &source,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            module_source.to_str().unwrap(),
            "vendor",
        ],
    );
    git(&source, &["commit", "-am", "module introduced"]);
    let oid = git(&source.join("vendor"), &["rev-parse", "HEAD"])
        .trim()
        .to_owned();
    git(&source, &["submodule", "deinit", "--force", "vendor"]);
    git(&source, &["rm", "--force", "vendor"]);
    git(
        &source,
        &["commit", "-m", "module removed from current tree"],
    );
    assert!(source.join(".git/modules/vendor/objects").exists());
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let outcome = store.capture(&source, &AtomicBool::new(false));
    match outcome {
        Err(BackupError::Incomplete) => assert!(store.list().unwrap().points.is_empty()),
        Ok(CaptureOutcome::Created { point }) => {
            fs::remove_dir_all(source).unwrap();
            fs::remove_dir_all(module_source).unwrap();
            let restored = temporary.path().join("restored");
            store
                .restore(&point.id, &restored, &AtomicBool::new(false))
                .unwrap();
            assert!(
                restored.join(".git/modules/vendor/objects").is_dir(),
                "historical module database was omitted from a supposedly complete point"
            );
            git(
                &restored,
                &[
                    "--git-dir=.git/modules/vendor",
                    "cat-file",
                    "-e",
                    &format!("{oid}^{{commit}}"),
                ],
            );
            assert_eq!(
                git(
                    &restored,
                    &[
                        "--git-dir=.git/modules/vendor",
                        "show",
                        &format!("{oid}:historical-module.txt")
                    ]
                ),
                "historical module payload\n"
            );
        }
        other => panic!("unexpected backup outcome: {other:?}"),
    }
}

#[test]
fn an_unreachable_historical_submodule_commit_requires_its_complete_object_closure() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    let module_source = temporary.path().join("module-source");
    repository(&source);
    repository(&module_source);
    fs::write(
        module_source.join("historical-only.txt"),
        "historical module payload\n",
    )
    .unwrap();
    git(&module_source, &["add", "."]);
    git(
        &module_source,
        &["commit", "-m", "historical module commit"],
    );
    git(
        &source,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            module_source.to_str().unwrap(),
            "vendor",
        ],
    );
    git(&source, &["commit", "-am", "old module gitlink"]);
    let module = source.join("vendor");
    let historical_commit = git(&module, &["rev-parse", "HEAD"]).trim().to_owned();
    let historical_blob = git(&module, &["rev-parse", "HEAD:historical-only.txt"])
        .trim()
        .to_owned();
    git(&module, &["checkout", "--orphan", "new"]);
    git(&module, &["rm", "-r", "--force", "."]);
    fs::write(module.join("current.txt"), "current module payload\n").unwrap();
    git(&module, &["add", "."]);
    git(
        &module,
        &[
            "-c",
            "user.name=Backup Audit",
            "-c",
            "user.email=audit@example.invalid",
            "commit",
            "-m",
            "new orphan module",
        ],
    );
    git(&module, &["branch", "--delete", "--force", "main"]);
    git(&module, &["remote", "remove", "origin"]);
    git(&module, &["reflog", "expire", "--expire=now", "--all"]);
    git(&source, &["add", "vendor"]);
    git(&source, &["commit", "-m", "new module gitlink"]);
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let first = capture(&store, &source);
    // Move this fixture's point outside the 24-hour cadence without modifying source state.
    let manifest_path = store
        .directory()
        .join("points")
        .join(format!("{first}.json"));
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    let created_at = manifest["point"]["createdAt"].as_u64().unwrap();
    manifest["point"]["createdAt"] = serde_json::json!(created_at - 24 * 60 * 60 * 1000 - 1);
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let module_gitdir =
        std::path::PathBuf::from(git(&module, &["rev-parse", "--absolute-git-dir"]).trim());
    let object = module_gitdir
        .join("objects")
        .join(&historical_blob[..2])
        .join(&historical_blob[2..]);
    assert!(
        object.is_file(),
        "fixture must contain a loose historical blob"
    );
    fs::remove_file(object).unwrap();
    git(
        &module,
        &["cat-file", "-e", &format!("{historical_commit}^{{commit}}")],
    );
    git(&module, &["fsck", "--full", "--strict", "--no-dangling"]);
    let closure = crate::process::command("git")
        .current_dir(&module)
        .args(["rev-list", "--objects", "--quiet", &historical_commit])
        .output()
        .unwrap();
    assert!(
        !closure.status.success(),
        "the commit exists but its historical blob is missing"
    );
    assert_eq!(
        store.capture(&source, &AtomicBool::new(false)).unwrap_err(),
        BackupError::Incomplete
    );
    let catalog = store.list().unwrap();
    assert_eq!(catalog.points.len(), 1);
    assert_eq!(catalog.points[0].id, first);
    fs::remove_dir_all(source).unwrap();
    fs::remove_dir_all(module_source).unwrap();
    let restored = temporary.path().join("restored");
    store
        .restore(&first, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(
        git(
            &restored.join("vendor"),
            &["show", &format!("{historical_commit}:historical-only.txt")]
        ),
        "historical module payload\n"
    );
}

#[test]
fn included_local_configuration_is_flattened_before_source_configuration_is_deleted() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    let configuration = temporary.path().join("included.config");
    fs::write(&configuration, "[user]\n\tname = Included Author\n[remote \"lost\"]\n\turl = https://example.invalid/unavailable.git\n").unwrap();
    git(
        &source,
        &["config", "include.path", configuration.to_str().unwrap()],
    );
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let id = capture(&store, &source);
    fs::remove_dir_all(source).unwrap();
    fs::remove_file(configuration).unwrap();
    let restored = temporary.path().join("restored");
    store
        .restore(&id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(
        git(&restored, &["config", "--local", "--get", "user.name"]),
        "Included Author\n"
    );
    assert_eq!(
        git(
            &restored,
            &["config", "--local", "--get", "remote.lost.url"]
        ),
        "https://example.invalid/unavailable.git\n"
    );
    assert!(!fs::read_to_string(restored.join(".git/config"))
        .unwrap()
        .contains("include.path"));
}

#[test]
fn interrupted_capture_staging_is_removed_before_new_capture_uses_the_global_budget() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    let store = BackupStore::new(
        temporary.path().join("backups"),
        BackupPolicy {
            enabled: true,
            max_mi_b: 1,
        },
    )
    .unwrap();
    let abandoned = store.directory().join("staging/capture-interrupted");
    fs::create_dir(&abandoned).unwrap();
    fs::write(abandoned.join("large.part"), vec![42; 2 * 1024 * 1024]).unwrap();
    let id = capture(&store, &source);
    assert!(!abandoned.exists());
    assert_eq!(
        fs::read_dir(store.directory().join("staging"))
            .unwrap()
            .count(),
        0
    );
    assert!(store.list().unwrap().total_bytes < 1024 * 1024);
    fs::remove_dir_all(source).unwrap();
    store
        .restore(
            &id,
            &temporary.path().join("restored"),
            &AtomicBool::new(false),
        )
        .unwrap();
}

#[test]
fn interrupted_staging_is_cleaned_even_when_the_existing_backup_is_too_recent() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let first = capture(&store, &source);
    let abandoned = store.directory().join("staging/capture-interrupted");
    fs::create_dir(&abandoned).unwrap();
    fs::write(abandoned.join("leftover.part"), vec![42; 1024]).unwrap();
    assert!(matches!(
        store.capture(&source, &AtomicBool::new(false)).unwrap(),
        CaptureOutcome::TooSoon { .. }
    ));
    assert!(!abandoned.exists());
    assert_eq!(store.list().unwrap().points[0].id, first);
}

#[test]
fn a_corrupted_manifest_does_not_hide_or_block_restoration_of_an_independent_valid_point() {
    let temporary = tempfile::tempdir().unwrap();
    let healthy = temporary.path().join("healthy");
    let broken = temporary.path().join("broken");
    repository(&healthy);
    repository(&broken);
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let healthy_id = capture(&store, &healthy);
    let broken_id = capture(&store, &broken);
    fs::write(
        store
            .directory()
            .join("points")
            .join(format!("{broken_id}.json")),
        "interrupted or corrupt manifest",
    )
    .unwrap();
    fs::remove_dir_all(&healthy).unwrap();
    fs::remove_dir_all(&broken).unwrap();
    assert!(store
        .list()
        .unwrap()
        .points
        .iter()
        .any(|point| point.id == healthy_id));
    let restored = temporary.path().join("restored");
    store
        .restore(&healthy_id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(git(&restored, &["show", "HEAD:tracked.txt"]), "committed\n");
    let broken_destination = temporary.path().join("broken-restored");
    assert!(store
        .restore(&broken_id, &broken_destination, &AtomicBool::new(false))
        .is_err());
    assert!(!broken_destination.exists());
    assert!(store
        .directory()
        .join("points")
        .join(format!("{broken_id}.json"))
        .exists());
}

#[test]
fn an_unrecognized_chunk_entry_does_not_hide_or_block_a_valid_restore_point() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let id = capture(&store, &source);
    let stray = store.directory().join("chunks/partial-abandoned");
    fs::write(&stray, "unrecognized damaged storage entry").unwrap();
    fs::remove_dir_all(&source).unwrap();
    assert!(store
        .list()
        .unwrap()
        .points
        .iter()
        .any(|point| point.id == id));
    let restored = temporary.path().join("restored");
    store
        .restore(&id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(git(&restored, &["show", "HEAD:tracked.txt"]), "committed\n");
    assert!(
        stray.exists(),
        "ambiguous files must not be removed automatically"
    );
}

#[test]
fn changed_corrupt_payload_is_reported_without_hiding_independent_healthy_points() {
    let temporary = tempfile::tempdir().unwrap();
    let healthy = temporary.path().join("healthy");
    let broken = temporary.path().join("broken");
    repository(&healthy);
    repository(&broken);
    fs::write(
        broken.join("exclusive.txt"),
        "unique data only in the damaged backup",
    )
    .unwrap();
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let healthy_id = capture(&store, &healthy);
    let broken_id = capture(&store, &broken);
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(
            store
                .directory()
                .join("points")
                .join(format!("{broken_id}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    let exclusive = manifest["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| {
            let path: Vec<u8> = entry["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|byte| byte.as_u64().unwrap() as u8)
                .collect();
            path == b"exclusive.txt"
        })
        .unwrap();
    let chunk = exclusive["content"]["chunks"][0].as_str().unwrap();
    fs::write(
        store.directory().join("chunks").join(chunk),
        "corrupted compressed data",
    )
    .unwrap();
    let catalog = store.list().unwrap();
    assert_eq!(catalog.corrupt_points, 1);
    assert_eq!(catalog.points.len(), 1);
    assert_eq!(catalog.points[0].id, healthy_id);
    fs::remove_dir_all(&healthy).unwrap();
    fs::remove_dir_all(&broken).unwrap();
    let restored = temporary.path().join("restored");
    store
        .restore(&healthy_id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(git(&restored, &["show", "HEAD:tracked.txt"]), "committed\n");
}

#[cfg(target_os = "linux")]
#[test]
fn verifying_a_backup_does_not_trigger_repository_change_notifications() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let (events, received) = std::sync::mpsc::channel();
    let _watcher = super::watch::start(&source, move |event| {
        let _ = events.send(event);
    })
    .unwrap();
    capture(&store, &source);
    assert!(
        received
            .recv_timeout(std::time::Duration::from_millis(400))
            .is_err(),
        "read-only backup verification should not refresh GitWorking or the graph"
    );
}

#[cfg(unix)]
#[test]
fn ignored_parent_link_cannot_turn_a_tracked_path_into_copied_external_data() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    repository(&source);
    fs::create_dir(source.join("directory")).unwrap();
    fs::write(source.join("directory/file.txt"), "tracked\n").unwrap();
    fs::write(source.join(".gitignore"), "/directory\n").unwrap();
    git(
        &source,
        &["add", "--force", "directory/file.txt", ".gitignore"],
    );
    git(&source, &["commit", "-m", "tracked directory"]);
    fs::remove_dir_all(source.join("directory")).unwrap();
    let external = temporary.path().join("external");
    fs::create_dir(&external).unwrap();
    fs::write(external.join("file.txt"), "private external bytes\n").unwrap();
    std::os::unix::fs::symlink(&external, source.join("directory")).unwrap();
    assert!(git(
        &source,
        &["ls-files", "--cached", "--others", "--exclude-standard"]
    )
    .contains("directory/file.txt"));
    let store =
        BackupStore::new(temporary.path().join("backups"), BackupPolicy::default()).unwrap();
    let id = capture(&store, &source);
    assert_eq!(
        fs::read_to_string(external.join("file.txt")).unwrap(),
        "private external bytes\n"
    );
    fs::remove_dir_all(&source).unwrap();
    fs::remove_dir_all(&external).unwrap();
    let restored = temporary.path().join("restored");
    store
        .restore(&id, &restored, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(fs::read_link(restored.join("directory")).unwrap(), external);
    assert!(fs::symlink_metadata(restored.join("directory"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(!restored.join("directory/file.txt").exists());
    assert_eq!(
        git(&restored, &["show", "HEAD:directory/file.txt"]),
        "tracked\n"
    );
}

//! Apply a verified selection as one binary-safe patch, without touching the index.

use super::*;

pub(in crate::git) struct Prepared {
    pub(in crate::git) paths: BTreeSet<String>,
    patch: Vec<u8>,
}

pub(in crate::git) fn prepare(
    repository: &Path,
    index: usize,
    options: &ApplyStashOptions,
) -> Result<Option<Prepared>, StashError> {
    let Some(requested) = &options.paths else {
        return Ok(None);
    };
    if requested.is_empty() || options.drop == Some(true) {
        return Err(StashError::PartialUnsupported);
    }
    verify(repository, index, options)?;
    let base = format!("{}^1", options.expected_stash);
    let changes = command(
        repository,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--no-relative",
            &base,
            &options.expected_stash,
            "--",
        ],
    )?;
    if !changes.status.success() {
        return Err(StashError::Diagnostic(changes.diagnostic));
    }
    let mut entries = changes
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty());
    let mut tracked = BTreeSet::new();
    let mut selected = BTreeSet::new();
    let mut found = BTreeSet::new();
    while let Some(kind) = entries.next() {
        let from = decode(entries.next())?;
        let to = if kind.starts_with(b"R") || kind.starts_with(b"C") {
            decode(entries.next())?
        } else {
            from.clone()
        };
        if requested.contains(&to) {
            found.insert(to.clone());
            tracked.insert(to.clone());
            selected.insert(to);
            if kind.starts_with(b"R") {
                tracked.insert(from.clone());
                selected.insert(from);
            }
        }
    }
    let untracked = untracked_paths(repository, &options.expected_stash)?;
    let untracked: BTreeSet<_> = untracked
        .into_iter()
        .filter(|path| requested.contains(path))
        .collect();
    selected.extend(untracked.iter().cloned());
    found.extend(untracked.iter().cloned());
    if requested.iter().any(|path| !found.contains(path)) {
        return Err(StashError::Stale("stash paths".to_owned()));
    }
    let mut patch = Vec::new();
    if !tracked.is_empty() {
        patch.extend(patch_for(
            repository,
            &["diff", &base, &options.expected_stash],
            &tracked,
        )?);
    }
    if !untracked.is_empty() {
        let third = format!("{}^3", options.expected_stash);
        patch.extend(patch_for(
            repository,
            &["diff-tree", "--root", "--no-commit-id", "-r", "-p", &third],
            &untracked,
        )?);
    }
    // Worktree-only git apply ignores gitlinks, so never report those as applied.
    if patch.is_empty()
        || patch.split(|byte| *byte == b'\n').any(|line| {
            line == b"old mode 160000"
                || line == b"new mode 160000"
                || line == b"new file mode 160000"
                || line == b"deleted file mode 160000"
                || (line.starts_with(b"index ") && line.ends_with(b" 160000"))
        })
    {
        return Err(StashError::PartialUnsupported);
    }
    let prepared = Prepared {
        paths: selected,
        patch,
    };
    verify_selected_clean(repository, &prepared.paths)?;
    apply_patch(repository, &prepared.patch, true)?;
    Ok(Some(prepared))
}

pub(in crate::git) fn apply(
    repository: &Path,
    index: usize,
    options: &ApplyStashOptions,
    prepared: &Prepared,
) -> Result<WorkingStatus, StashError> {
    // Check again after the recovery capture. Git applies all hunks only after
    // checking every file; no --reject, --3way or overwrite checkout is used.
    verify(repository, index, options)?;
    verify_selected_clean(repository, &prepared.paths)?;
    apply_patch(repository, &prepared.patch, false)?;
    read_status(repository)
}

fn verify(repository: &Path, index: usize, options: &ApplyStashOptions) -> Result<(), StashError> {
    verify_worktree(repository, &options.precondition)?;
    verify_stash(
        repository,
        &format!("stash@{{{index}}}"),
        &options.expected_stash,
    )?;
    ensure_recovery_absent(repository)?;
    let current = repository::discover(repository).map_err(StashError::Diagnostic)?;
    if !matches!(current.operation(), RepoOperation::None)
        || read_status(repository)?.conflicted_count() > 0
    {
        return Err(StashError::PartialUnsupported);
    }
    Ok(())
}

fn decode(path: Option<&[u8]>) -> Result<String, StashError> {
    let path = path.ok_or(StashError::PartialUnsupported)?;
    String::from_utf8(path.to_vec())
        .map_err(|error| StashError::Diagnostic(Diagnostic::new("stash.decodePaths", error)))
}

fn verify_selected_clean(repository: &Path, paths: &BTreeSet<String>) -> Result<(), StashError> {
    let literal: Vec<_> = paths
        .iter()
        .map(|path| format!(":(literal){path}"))
        .collect();
    // Hidden index flags can conceal local edits from diff; preserve them and
    // decline the write rather than temporarily clearing user-owned flags.
    let mut args = vec!["ls-files", "-v", "-z", "--"];
    args.extend(literal.iter().map(String::as_str));
    let flags = command(repository, &args)?;
    if !flags.status.success() {
        return Err(StashError::Diagnostic(flags.diagnostic));
    }
    if flags.stdout.split(|byte| *byte == 0).any(|entry| {
        entry
            .first()
            .is_some_and(|tag| tag.is_ascii_lowercase() || *tag == b'S')
    }) {
        return Err(StashError::PartialConflict(Diagnostic::new(
            "stash.applyPaths",
            "Selected paths have assume-unchanged or skip-worktree flags",
        )));
    }
    for staged in [false, true] {
        let mut args = vec![
            "--no-optional-locks",
            "diff",
            "--quiet",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--ignore-submodules=none",
        ];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.extend(literal.iter().map(String::as_str));
        let output = command(repository, &args)?;
        if output.status.code() == Some(1) {
            return Err(StashError::PartialConflict(output.diagnostic));
        }
        if !output.status.success() {
            return Err(StashError::Diagnostic(output.diagnostic));
        }
    }
    Ok(())
}

fn patch_for(
    repository: &Path,
    prefix: &[&str],
    paths: &BTreeSet<String>,
) -> Result<Vec<u8>, StashError> {
    let literal: Vec<_> = paths
        .iter()
        .map(|path| format!(":(literal){path}"))
        .collect();
    let mut args = prefix.to_vec();
    args.extend([
        "--binary",
        "--full-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--no-relative",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--submodule=short",
        "--",
    ]);
    args.extend(literal.iter().map(String::as_str));
    let output = command(repository, &args)?;
    if !output.status.success() {
        return Err(StashError::Diagnostic(output.diagnostic));
    }
    Ok(output.output.stdout)
}

fn apply_patch(repository: &Path, patch: &[u8], check: bool) -> Result<(), StashError> {
    let mut args = vec!["apply", "--binary", "--whitespace=nowarn"];
    if check {
        args.push("--check");
    }
    args.push("-");
    let mut child = crate::process::command("git")
        .args(&args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            StashError::Diagnostic(Diagnostic::command_io("stash.applyPaths", &args, &error))
        })?;
    let input = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("Git stdin unavailable"))
        .and_then(|mut stdin| stdin.write_all(patch));
    let output = child.wait_with_output().map_err(|error| {
        StashError::Diagnostic(Diagnostic::command_io("stash.applyPaths", &args, &error))
    })?;
    if !output.status.success() {
        return Err(StashError::PartialConflict(
            Diagnostic::command_with_inputs(
                "stash.applyPaths",
                &args,
                &output,
                &[&String::from_utf8_lossy(patch)],
            ),
        ));
    }
    input.map_err(|error| {
        StashError::Diagnostic(Diagnostic::command_io("stash.applyPaths", &args, &error))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn git(path: &Path, args: &[&str]) -> String {
        let output = crate::process::command("git")
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", path.join("absent-global-config"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn fixture() -> TempDir {
        let temp = TempDir::new().unwrap();
        let p = temp.path();
        git(p, &["init", "-b", "main"]);
        git(p, &["config", "user.name", "Fixture"]);
        git(p, &["config", "user.email", "fixture@example.test"]);
        git(p, &["config", "core.autocrlf", "false"]);
        for name in ["a.txt", "b.txt", "delete.txt", "old.txt", "wip.txt"] {
            fs::write(p.join(name), format!("{name} base\n")).unwrap();
        }
        fs::write(p.join("binary.dat"), [0, 1, 2, 3]).unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "base"]);
        temp
    }

    fn options(p: &Path, selected: &[&str]) -> ApplyStashOptions {
        ApplyStashOptions {
            paths: Some(selected.iter().map(|path| (*path).to_owned()).collect()),
            drop: None,
            expected_stash: git(p, &["rev-parse", "stash@{0}"]),
            precondition: status::reset_precondition(p),
        }
    }

    fn run(p: &Path, selected: &[&str]) -> Result<WorkingStatus, StashError> {
        let options = options(p, selected);
        let patch = prepare(p, 0, &options)?.unwrap();
        apply(p, 0, &options, &patch)
    }

    #[test]
    fn selected_stash_files_preserve_index_and_unrelated_wip_across_successive_applications() {
        let temp = fixture();
        let p = temp.path();
        fs::write(p.join("a.txt"), "saved a\n").unwrap();
        fs::write(p.join("b.txt"), "saved b\n").unwrap();
        git(p, &["add", "a.txt"]);
        git(p, &["stash", "push", "-qm", "saved"]);
        fs::write(p.join("wip.txt"), "staged wip\n").unwrap();
        git(p, &["add", "wip.txt"]);
        fs::write(p.join("wip.txt"), "unstaged wip\n").unwrap();
        fs::write(p.join("local.txt"), "untracked wip\n").unwrap();
        let index = git(p, &["write-tree"]);
        let stash = git(p, &["stash", "list", "--format=%H"]);
        run(p, &["a.txt"]).unwrap();
        assert_eq!(fs::read_to_string(p.join("a.txt")).unwrap(), "saved a\n");
        assert_eq!(fs::read_to_string(p.join("b.txt")).unwrap(), "b.txt base\n");
        run(p, &["b.txt"]).unwrap();
        assert_eq!(fs::read_to_string(p.join("b.txt")).unwrap(), "saved b\n");
        assert_eq!(git(p, &["write-tree"]), index);
        assert_eq!(git(p, &["stash", "list", "--format=%H"]), stash);
        assert_eq!(
            fs::read_to_string(p.join("wip.txt")).unwrap(),
            "unstaged wip\n"
        );
        assert_eq!(
            fs::read_to_string(p.join("local.txt")).unwrap(),
            "untracked wip\n"
        );
        assert!(matches!(
            run(p, &["a.txt"]),
            Err(StashError::PartialConflict(_))
        ));
    }

    #[test]
    fn mixed_selection_handles_renames_deletions_binary_and_untracked_with_undo_redo() {
        let temp = fixture();
        let p = temp.path();
        git(p, &["mv", "old.txt", "renamed.txt"]);
        fs::remove_file(p.join("delete.txt")).unwrap();
        fs::write(p.join("binary.dat"), [0, 255, 42, 9]).unwrap();
        fs::create_dir(p.join("new")).unwrap();
        fs::write(p.join("new/untracked.txt"), "saved new\n").unwrap();
        fs::write(p.join("a.txt"), "unselected\n").unwrap();
        git(p, &["stash", "push", "-uqm", "mixed"]);
        fs::write(p.join("wip.txt"), "keep wip\n").unwrap();
        let before = status::reset_precondition(p);
        let options = options(
            p,
            &[
                "renamed.txt",
                "delete.txt",
                "binary.dat",
                "new/untracked.txt",
            ],
        );
        let stacks = crate::git::undo::UndoStacks::default();
        crate::git::apply_stash_with_recovery("fixture", p, &stacks, 0, &options).unwrap();
        assert!(!p.join("old.txt").exists());
        assert!(!p.join("delete.txt").exists());
        assert_eq!(fs::read(p.join("binary.dat")).unwrap(), [0, 255, 42, 9]);
        assert_eq!(
            fs::read_to_string(p.join("renamed.txt")).unwrap(),
            "old.txt base\n"
        );
        assert_eq!(fs::read_to_string(p.join("a.txt")).unwrap(), "a.txt base\n");
        let after = status::reset_precondition(p);
        stacks.undo("fixture", p).unwrap();
        assert_eq!(status::reset_precondition(p), before);
        assert!(!p.join("new/untracked.txt").exists());
        stacks.redo("fixture", p).unwrap();
        assert_eq!(status::reset_precondition(p), after);
        assert_eq!(git(p, &["rev-parse", "stash@{0}"]), options.expected_stash);
    }

    #[test]
    fn conflicting_selection_and_ignored_collision_leave_every_file_unchanged() {
        for ignored in [false, true] {
            let temp = fixture();
            let p = temp.path();
            fs::write(p.join("a.txt"), "saved a\n").unwrap();
            fs::write(p.join("incoming.txt"), "saved incoming\n").unwrap();
            git(p, &["stash", "push", "-uqm", "saved"]);
            fs::write(p.join("incoming.txt"), "keep collision\n").unwrap();
            if ignored {
                fs::write(p.join(".git/info/exclude"), "incoming.txt\n").unwrap();
            }
            let before = status::reset_precondition(p);
            assert!(matches!(
                run(p, &["a.txt", "incoming.txt"]),
                Err(StashError::PartialConflict(_))
            ));
            assert_eq!(status::reset_precondition(p), before);
            assert_eq!(fs::read_to_string(p.join("a.txt")).unwrap(), "a.txt base\n");
            assert_eq!(
                fs::read_to_string(p.join("incoming.txt")).unwrap(),
                "keep collision\n"
            );
        }
        let temp = fixture();
        let p = temp.path();
        fs::write(p.join("a.txt"), "saved a\n").unwrap();
        fs::write(p.join("b.txt"), "saved b\n").unwrap();
        git(p, &["stash", "push", "-qm", "saved"]);
        fs::write(p.join("b.txt"), "conflicting local work\n").unwrap();
        let before = status::reset_precondition(p);
        assert!(matches!(
            run(p, &["a.txt", "b.txt"]),
            Err(StashError::PartialConflict(_))
        ));
        assert_eq!(status::reset_precondition(p), before);
    }

    #[test]
    fn rejects_stale_ref_or_content_after_preparing_patch() {
        for replace_stash in [false, true] {
            let temp = fixture();
            let p = temp.path();
            fs::write(p.join("a.txt"), "saved a\n").unwrap();
            git(p, &["stash", "push", "-qm", "saved"]);
            let options = options(p, &["a.txt"]);
            let prepared = prepare(p, 0, &options).unwrap().unwrap();
            fs::write(p.join("b.txt"), "newer work\n").unwrap();
            if replace_stash {
                git(p, &["stash", "push", "-qm", "newer stash"]);
            }
            let before = status::reset_precondition(p);
            assert!(matches!(
                apply(p, 0, &options, &prepared),
                Err(StashError::Stale(_))
            ));
            assert_eq!(status::reset_precondition(p), before);
            assert_eq!(fs::read_to_string(p.join("a.txt")).unwrap(), "a.txt base\n");
        }
    }

    #[test]
    fn selected_staged_changes_and_hidden_index_flags_are_never_overwritten() {
        for mode in ["staged", "assume-unchanged", "skip-worktree"] {
            let temp = fixture();
            let p = temp.path();
            fs::write(p.join("a.txt"), "saved a\n").unwrap();
            git(p, &["stash", "push", "-qm", "saved"]);
            fs::write(p.join("a.txt"), "local work\n").unwrap();
            if mode == "staged" {
                git(p, &["add", "a.txt"]);
                // Worktree equals HEAD, but the index contains valuable WIP.
                fs::write(p.join("a.txt"), "a.txt base\n").unwrap();
            } else {
                git(p, &["update-index", &format!("--{mode}"), "a.txt"]);
            }
            let index = git(p, &["ls-files", "--stage", "-v"]);
            let contents = fs::read(p.join("a.txt")).unwrap();
            assert!(matches!(
                run(p, &["a.txt"]),
                Err(StashError::PartialConflict(_))
            ));
            assert_eq!(git(p, &["ls-files", "--stage", "-v"]), index);
            assert_eq!(fs::read(p.join("a.txt")).unwrap(), contents);
        }
    }

    #[test]
    fn literal_paths_cannot_expand_the_selection_and_unknown_paths_are_rejected() {
        let temp = fixture();
        let p = temp.path();
        let name = if cfg!(windows) {
            "literal space.txt"
        } else {
            "literal[ab]*.txt"
        };
        fs::write(p.join(name), "selected\n").unwrap();
        fs::write(p.join("literalab.txt"), "unselected\n").unwrap();
        git(p, &["stash", "push", "-uqm", "names"]);
        run(p, &[name]).unwrap();
        assert!(p.join(name).exists());
        assert!(!p.join("literalab.txt").exists());
        assert!(matches!(run(p, &["../escape"]), Err(StashError::Stale(_))));
        let mut invalid = options(p, &["literalab.txt"]);
        invalid.drop = Some(true);
        assert!(matches!(
            prepare(p, 0, &invalid),
            Err(StashError::PartialUnsupported)
        ));
    }

    #[test]
    fn crlf_conversion_is_preserved_when_applying_selected_files() {
        let temp = fixture();
        let p = temp.path();
        fs::write(p.join(".gitattributes"), "a.txt text eol=crlf\n").unwrap();
        git(p, &["add", ".gitattributes"]);
        git(p, &["commit", "-qm", "CRLF policy"]);
        fs::write(p.join("a.txt"), "saved a\r\n").unwrap();
        git(p, &["stash", "push", "-qm", "saved CRLF"]);
        assert_eq!(fs::read(p.join("a.txt")).unwrap(), b"a.txt base\r\n");
        run(p, &["a.txt"]).unwrap();
        assert_eq!(fs::read(p.join("a.txt")).unwrap(), b"saved a\r\n");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_and_executable_modes_are_applied_without_following_link_targets() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let temp = fixture();
        let p = temp.path();
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("private.txt");
        fs::write(&target, "outside unchanged\n").unwrap();
        symlink("a.txt", p.join("link")).unwrap();
        git(p, &["add", "link"]);
        git(p, &["commit", "-qm", "link"]);
        fs::remove_file(p.join("link")).unwrap();
        symlink(&target, p.join("link")).unwrap();
        fs::set_permissions(p.join("a.txt"), fs::Permissions::from_mode(0o755)).unwrap();
        git(p, &["stash", "push", "-qm", "modes"]);
        run(p, &["link", "a.txt"]).unwrap();
        assert_eq!(fs::read_link(p.join("link")).unwrap(), target);
        assert_eq!(fs::read_to_string(&target).unwrap(), "outside unchanged\n");
        assert_ne!(
            fs::metadata(p.join("a.txt")).unwrap().permissions().mode() & 0o111,
            0
        );
    }

    #[test]
    fn gitlink_selection_is_rejected_instead_of_silently_skipped() {
        let temp = fixture();
        let p = temp.path();
        let base = git(p, &["rev-parse", "HEAD"]);
        git(
            p,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{base},module"),
            ],
        );
        fs::create_dir(p.join("module")).unwrap();
        fs::write(p.join("a.txt"), "force stash creation\n").unwrap();
        git(p, &["stash", "push", "-qm", "gitlink"]);
        assert!(matches!(
            run(p, &["module"]),
            Err(StashError::PartialUnsupported)
        ));
    }
}

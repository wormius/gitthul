//! Root ignore rules and optional removal of their exact matches from the index.

use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
};

use serde::Deserialize;

use super::{diagnostics::Diagnostic, write::WriteError};

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum PatternKind {
    #[default]
    Path,
    Extension,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreOptions {
    #[serde(default)]
    pub(super) untrack: bool,
    #[serde(default)]
    pub(super) pattern_kind: PatternKind,
}

pub fn ignore(repository: &Path, pattern: &str, options: &IgnoreOptions) -> Result<(), WriteError> {
    // The caller serializes writes; revalidate the worktree after acquiring that lock.
    let root =
        fs::canonicalize(repository).map_err(|error| io_error("ignore.canonicalize", &error))?;
    let repo = gix::open(&root).map_err(|error| {
        WriteError::Diagnostic(Diagnostic::cause("ignore.openRepository", &error))
    })?;
    let workdir = repo.workdir().ok_or(WriteError::InvalidPath)?;
    if fs::canonicalize(workdir).map_err(|error| io_error("ignore.canonicalizeWorktree", &error))?
        != root
    {
        return Err(WriteError::InvalidPath);
    }
    let rule = ignore_rule(&root, pattern, options.pattern_kind)?;
    let path = root.join(".gitignore");
    let before = read_ignore(&path)?;
    // Select with only the requested rule. Existing .gitignore/global rules must
    // never remove additional staged files as a side effect of this operation.
    let tracked = if options.untrack {
        matching_tracked(&root, &rule)?
    } else {
        Vec::new()
    };
    let original = before
        .as_ref()
        .map_or(&[][..], |(bytes, _)| bytes.as_slice());
    if let Some(bytes) = append_rule(original, &rule) {
        let mut temporary = tempfile::NamedTempFile::new_in(&root)
            .map_err(|error| io_error("ignore.prepareFile", &error))?;
        temporary
            .write_all(&bytes)
            .map_err(|error| io_error("ignore.writeFile", &error))?;
        if let Some((_, permissions)) = &before {
            temporary
                .as_file()
                .set_permissions(permissions.clone())
                .map_err(|error| io_error("ignore.preservePermissions", &error))?;
        }
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| io_error("ignore.flushFile", &error))?;
        // Refuse an external edit observed while preparing the replacement.
        // Atomic replacement also prevents following a newly substituted symlink.
        let current = read_ignore(&path)?;
        if current != before {
            return Err(WriteError::Stale(".gitignore".to_owned()));
        }
        temporary
            .persist(&path)
            .map_err(|error| io_error("ignore.replaceFile", &error.error))?;
    }
    if !tracked.is_empty() {
        remove_from_index(&root, &tracked)?;
    }
    Ok(())
}

fn ignore_rule(repository: &Path, pattern: &str, kind: PatternKind) -> Result<String, WriteError> {
    if pattern.is_empty()
        || pattern.contains(['\0', '\r', '\n', '\\'])
        || pattern.starts_with('/')
        || (pattern.as_bytes().get(1) == Some(&b':') && pattern.as_bytes()[0].is_ascii_alphabetic())
    {
        return Err(WriteError::InvalidPath);
    }
    if matches!(kind, PatternKind::Extension) {
        if !pattern.starts_with("*.") || pattern.contains('/') {
            return Err(WriteError::InvalidPath);
        }
        return Ok(format!("*{}", escape_rule(&pattern[1..])));
    }
    let relative = pattern.strip_suffix('/').unwrap_or(pattern);
    super::diff::validate_path(relative).map_err(|_| WriteError::InvalidPath)?;
    if relative.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git")
    }) {
        return Err(WriteError::InvalidPath);
    }
    // Do not follow a selected symlink to determine whether it is a directory.
    let directory = pattern.ends_with('/')
        || fs::symlink_metadata(repository.join(relative)).is_ok_and(|metadata| metadata.is_dir());
    Ok(format!(
        "/{}{}",
        escape_rule(relative),
        if directory { "/" } else { "" }
    ))
}

fn escape_rule(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '*' | '?' | '[' | ']' | '#' | '!' | ' ') {
            result.push('\\');
        }
        result.push(character);
    }
    result
}

type IgnoreImage = (Vec<u8>, fs::Permissions);

fn read_ignore(path: &Path) -> Result<Option<IgnoreImage>, WriteError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("ignore.inspectFile", &error)),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(WriteError::InvalidPath);
    }
    let bytes = fs::read(path).map_err(|error| io_error("ignore.readFile", &error))?;
    Ok(Some((bytes, metadata.permissions())))
}

fn append_rule(original: &[u8], rule: &str) -> Option<Vec<u8>> {
    let mut already_ignored = false;
    for line in original.split(|byte| *byte == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line == rule.as_bytes() {
            already_ignored = true;
        } else if line.starts_with(b"!") {
            // A later negation may override an earlier identical rule. Append
            // after it instead of incorrectly treating the operation as a no-op.
            already_ignored = false;
        }
    }
    if already_ignored {
        return None;
    }
    let crlf = original
        .iter()
        .position(|byte| *byte == b'\n')
        .map_or(original.ends_with(b"\r"), |index| {
            index > 0 && original[index - 1] == b'\r'
        });
    let newline: &[u8] = if crlf { b"\r\n" } else { b"\n" };
    let mut result = original.to_vec();
    if !result.is_empty() && !result.ends_with(b"\n") {
        if crlf && result.ends_with(b"\r") {
            result.push(b'\n');
        } else {
            result.extend_from_slice(newline);
        }
    }
    result.extend_from_slice(rule.as_bytes());
    result.extend_from_slice(newline);
    Some(result)
}

fn matching_tracked(repository: &Path, rule: &str) -> Result<Vec<u8>, WriteError> {
    let exclude = format!("--exclude={rule}");
    let args = ["ls-files", "--cached", "--ignored", "-z", &exclude];
    let output = git_command(repository)
        .args(args)
        .output()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io("ignore.listTracked", &args, &error))
        })?;
    require_success("ignore.listTracked", &args, &output)?;
    // Git emits raw NUL-delimited paths, including non-UTF-8 names. Passing them
    // directly to update-index avoids shell, quoting and pathspec interpretation.
    Ok(output.stdout)
}

fn remove_from_index(repository: &Path, paths: &[u8]) -> Result<(), WriteError> {
    let args = ["update-index", "--force-remove", "-z", "--stdin"];
    let mut child = git_command(repository)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io("ignore.untrackSpawn", &args, &error))
        })?;
    let input_result = child
        .stdin
        .take()
        .ok_or_else(|| {
            WriteError::Diagnostic(Diagnostic::new(
                "ignore.untrackInput",
                "Git did not open stdin",
            ))
        })
        .and_then(|mut pipe| {
            pipe.write_all(paths).map_err(|error| {
                WriteError::Diagnostic(Diagnostic::command_io("ignore.untrackInput", &args, &error))
            })
        });
    let output = child.wait_with_output().map_err(|error| {
        WriteError::Diagnostic(Diagnostic::command_io("ignore.untrackWait", &args, &error))
    })?;
    require_success("ignore.untrack", &args, &output)?;
    input_result
}

fn require_success(stage: &str, args: &[&str], output: &Output) -> Result<(), WriteError> {
    if output.status.success() {
        Ok(())
    } else {
        Err(WriteError::Diagnostic(Diagnostic::command(
            stage, args, output,
        )))
    }
}

fn git_command(repository: &Path) -> Command {
    let mut command = crate::process::command("git");
    command
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    command
}

fn io_error(stage: &str, error: &std::io::Error) -> WriteError {
    WriteError::Diagnostic(Diagnostic::io(stage, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn repository() -> TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(temporary.path(), &["init", "--quiet"]);
        git(temporary.path(), &["config", "core.autocrlf", "false"]);
        git(temporary.path(), &["config", "user.name", "GitThul test"]);
        git(
            temporary.path(),
            &["config", "user.email", "test@example.invalid"],
        );
        temporary
    }

    fn git(repository: &Path, args: &[&str]) -> Vec<u8> {
        let output = git_command(repository).args(args).output().unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn write(repository: &Path, path: &str, bytes: &[u8]) {
        let path = repository.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn is_ignored(repository: &Path, path: &str) -> bool {
        git_command(repository)
            .env_remove("GIT_LITERAL_PATHSPECS")
            .args(["check-ignore", "--quiet", "--no-index", "--", path])
            .status()
            .unwrap()
            .success()
    }

    fn untrack() -> IgnoreOptions {
        IgnoreOptions {
            untrack: true,
            ..IgnoreOptions::default()
        }
    }

    fn extension(untrack: bool) -> IgnoreOptions {
        IgnoreOptions {
            untrack,
            pattern_kind: PatternKind::Extension,
        }
    }

    #[test]
    fn nested_unicode_file_is_ignored_without_staging_or_changing_local_bytes() {
        let temporary = repository();
        let root = temporary.path();
        let name = "carpeta con espacios/árbol nuevo.txt";
        write(root, name, b"new local bytes\r\n");
        write(root, "otra/árbol nuevo.txt", b"unrelated");
        ignore(root, name, &IgnoreOptions::default()).unwrap();
        assert!(is_ignored(root, name));
        assert!(!is_ignored(root, "otra/árbol nuevo.txt"));
        assert_eq!(fs::read(root.join(name)).unwrap(), b"new local bytes\r\n");
        assert!(git(root, &["ls-files", "--cached", "-z"]).is_empty());
        assert!(git(root, &["status", "--porcelain"])
            .windows(b"?? .gitignore".len())
            .any(|bytes| bytes == b"?? .gitignore"));
    }

    #[test]
    fn ignore_preserves_existing_bytes_crlf_and_missing_final_newline_without_duplicates() {
        let temporary = repository();
        let root = temporary.path();
        let existing = b"# comentario\r\noriginal\xff";
        write(root, ".gitignore", existing);
        ignore(root, "new.txt", &IgnoreOptions::default()).unwrap();
        let expected = [existing.as_slice(), b"\r\n/new.txt\r\n"].concat();
        assert_eq!(fs::read(root.join(".gitignore")).unwrap(), expected);
        ignore(root, "new.txt", &IgnoreOptions::default()).unwrap();
        assert_eq!(fs::read(root.join(".gitignore")).unwrap(), expected);
    }

    #[test]
    fn duplicate_rule_without_final_newline_is_left_byte_for_byte_unchanged() {
        let temporary = repository();
        write(temporary.path(), ".gitignore", b"# original\n/file.txt");
        ignore(temporary.path(), "file.txt", &IgnoreOptions::default()).unwrap();
        assert_eq!(
            fs::read(temporary.path().join(".gitignore")).unwrap(),
            b"# original\n/file.txt"
        );
    }

    #[test]
    fn a_previous_duplicate_rule_does_not_lose_to_a_later_negation() {
        let temporary = repository();
        let root = temporary.path();
        write(root, ".gitignore", b"/file.txt\n!/file.txt\n");
        assert!(!is_ignored(root, "file.txt"));
        ignore(root, "file.txt", &IgnoreOptions::default()).unwrap();
        assert!(is_ignored(root, "file.txt"));
        assert_eq!(
            fs::read(root.join(".gitignore")).unwrap(),
            b"/file.txt\n!/file.txt\n/file.txt\n"
        );
    }

    #[test]
    fn a_duplicate_rule_still_allows_a_later_untrack() {
        let temporary = repository();
        let root = temporary.path();
        write(root, "file.txt", b"local\n");
        git(root, &["add", "--", "file.txt"]);
        ignore(root, "file.txt", &IgnoreOptions::default()).unwrap();
        let before = fs::read(root.join(".gitignore")).unwrap();
        ignore(root, "file.txt", &untrack()).unwrap();
        assert!(git(root, &["ls-files", "--cached", "-z"]).is_empty());
        assert_eq!(fs::read(root.join(".gitignore")).unwrap(), before);
        assert_eq!(fs::read(root.join("file.txt")).unwrap(), b"local\n");
    }

    #[test]
    fn extension_and_directory_rules_match_the_requested_scope() {
        let temporary = repository();
        let root = temporary.path();
        write(root, "cache/nested/a.txt", b"cache");
        ignore(root, "*.log", &extension(false)).unwrap();
        ignore(root, "cache", &IgnoreOptions::default()).unwrap();
        for path in ["a.log", "nested/b.log", "cache/nested/a.txt"] {
            assert!(is_ignored(root, path), "{path}");
        }
        for path in ["a.logger", "other/cache/a.txt", "cached.txt"] {
            assert!(!is_ignored(root, path), "{path}");
        }
        assert_eq!(
            fs::read(root.join(".gitignore")).unwrap(),
            b"*.log\n/cache/\n"
        );
    }

    #[test]
    fn ignore_without_untrack_preserves_existing_staged_content() {
        let temporary = repository();
        let root = temporary.path();
        write(root, "file.txt", b"staged\n");
        git(root, &["add", "--", "file.txt"]);
        write(root, "file.txt", b"unstaged\n");
        let index = git(root, &["ls-files", "--stage", "-z"]);
        ignore(root, "file.txt", &IgnoreOptions::default()).unwrap();
        assert_eq!(git(root, &["ls-files", "--stage", "-z"]), index);
        assert_eq!(git(root, &["show", ":file.txt"]), b"staged\n");
        assert_eq!(fs::read(root.join("file.txt")).unwrap(), b"unstaged\n");
    }

    #[test]
    fn untrack_prepares_deletions_and_preserves_unrelated_index_and_worktree_bytes() {
        let temporary = repository();
        let root = temporary.path();
        write(root, "file.txt", b"committed\n");
        write(root, "other.txt", b"original\n");
        git(root, &["add", "."]);
        git(root, &["commit", "--quiet", "-m", "base"]);
        write(root, "file.txt", b"staged version\n");
        write(root, "other.txt", b"unrelated staged\n");
        git(root, &["add", "."]);
        write(root, "file.txt", b"local version\r\n");
        write(root, "other.txt", b"unrelated local\n");
        let other_index = git(root, &["ls-files", "--stage", "-z", "--", "other.txt"]);
        ignore(root, "file.txt", &untrack()).unwrap();
        assert_eq!(git(root, &["ls-files", "--cached", "-z"]), b"other.txt\0");
        assert_eq!(
            git(
                root,
                &["diff", "--cached", "--name-status", "--", "file.txt"]
            ),
            b"D\tfile.txt\n"
        );
        assert_eq!(
            git(root, &["ls-files", "--stage", "-z", "--", "other.txt"]),
            other_index
        );
        assert_eq!(
            fs::read(root.join("file.txt")).unwrap(),
            b"local version\r\n"
        );
        assert_eq!(
            fs::read(root.join("other.txt")).unwrap(),
            b"unrelated local\n"
        );
    }

    #[test]
    fn untrack_extension_does_not_use_other_existing_ignore_rules() {
        let temporary = repository();
        let root = temporary.path();
        for name in ["a.log", "nested/b.log", "other.txt", "nested/c.txt"] {
            write(root, name, name.as_bytes());
        }
        git(root, &["add", "."]);
        write(root, ".gitignore", b"*.txt\n");
        ignore(root, "*.log", &extension(true)).unwrap();
        assert_eq!(
            git(root, &["ls-files", "--cached", "-z"]),
            b"nested/c.txt\0other.txt\0"
        );
        assert_eq!(fs::read(root.join("a.log")).unwrap(), b"a.log");
        assert_eq!(
            fs::read(root.join("nested/b.log")).unwrap(),
            b"nested/b.log"
        );
    }

    #[test]
    fn untrack_directory_keeps_names_outside_that_root_directory() {
        let temporary = repository();
        let root = temporary.path();
        for name in [
            "cache/a.txt",
            "cache/nested/b.txt",
            "other/cache/a.txt",
            "cache.txt",
        ] {
            write(root, name, b"bytes");
        }
        git(root, &["add", "."]);
        ignore(root, "cache/", &untrack()).unwrap();
        assert_eq!(
            git(root, &["ls-files", "--cached", "-z"]),
            b"cache.txt\0other/cache/a.txt\0"
        );
        assert_eq!(fs::read(root.join("cache/nested/b.txt")).unwrap(), b"bytes");
    }

    #[test]
    fn extension_metacharacters_are_literal_after_the_initial_wildcard() {
        let temporary = repository();
        let root = temporary.path();
        ignore(root, "*.l[og]", &extension(false)).unwrap();
        assert!(is_ignored(root, "file.l[og]"));
        assert!(is_ignored(root, "nested/file.l[og]"));
        assert!(!is_ignored(root, "file.lo"));
        assert!(!is_ignored(root, "file.lg"));
    }

    #[test]
    fn rejects_unsafe_or_multiline_input_before_writing() {
        let temporary = repository();
        let root = temporary.path();
        for path in [
            "",
            "../outside",
            "a/../b",
            "./file",
            "/absolute",
            "a//b",
            ".git/config",
            "a/.git/config",
            "a/./b",
            "bad\n*.txt",
            "bad\r*.txt",
            "bad\0name",
            "C:/outside",
            "..\\outside",
        ] {
            assert_eq!(
                ignore(root, path, &untrack()),
                Err(WriteError::InvalidPath),
                "{path:?}"
            );
        }
        for pattern in ["*", "file.log", "*.log/other", "*.log\n*.txt"] {
            assert_eq!(
                ignore(root, pattern, &extension(true)),
                Err(WriteError::InvalidPath)
            );
        }
        assert!(!root.join(".gitignore").exists());
    }

    #[test]
    fn dash_looking_names_are_literal() {
        let temporary = repository();
        let root = temporary.path();
        for name in ["--all", "ordinary.txt"] {
            write(root, name, name.as_bytes());
        }
        git(root, &["add", "."]);
        ignore(root, "--all", &untrack()).unwrap();
        assert_eq!(
            git(root, &["ls-files", "--cached", "-z"]),
            b"ordinary.txt\0"
        );
        assert_eq!(fs::read(root.join("--all")).unwrap(), b"--all");
    }

    #[cfg(not(windows))]
    #[test]
    fn pathspec_looking_names_are_literal() {
        let temporary = repository();
        let root = temporary.path();
        for name in ["--all", ":(glob)**", "ordinary.txt"] {
            write(root, name, name.as_bytes());
        }
        git(root, &["add", "."]);
        ignore(root, "--all", &untrack()).unwrap();
        ignore(root, ":(glob)**", &untrack()).unwrap();
        assert_eq!(
            git(root, &["ls-files", "--cached", "-z"]),
            b"ordinary.txt\0"
        );
        assert_eq!(fs::read(root.join("--all")).unwrap(), b"--all");
    }

    #[cfg(not(windows))]
    #[test]
    fn literal_wildcard_comment_negation_and_space_names_never_expand() {
        let temporary = repository();
        let root = temporary.path();
        let selected = ["*.log", "a[12].txt", "#comment", "!negative", "trailing "];
        let others = ["other.log", "a1.txt", "a2.txt", "negative", "trailing"];
        for name in selected.into_iter().chain(others) {
            write(root, name, name.as_bytes());
        }
        git(root, &["add", "."]);
        for name in selected {
            ignore(root, name, &untrack()).unwrap();
            assert!(is_ignored(root, name), "{name}");
            assert_eq!(fs::read(root.join(name)).unwrap(), name.as_bytes());
        }
        for name in others {
            assert!(!is_ignored(root, name), "{name}");
            assert!(!git(root, &["ls-files", "--cached", "-z", "--", name]).is_empty());
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_ignore_file_without_touching_its_external_target_or_index() {
        use std::os::unix::fs::symlink;
        let temporary = repository();
        let outside = tempfile::tempdir().unwrap();
        let root = temporary.path();
        let target = outside.path().join("private.txt");
        fs::write(&target, b"outside\n").unwrap();
        write(root, "file.txt", b"local\n");
        git(root, &["add", "."]);
        let index = git(root, &["ls-files", "--stage", "-z"]);
        symlink(&target, root.join(".gitignore")).unwrap();
        assert_eq!(
            ignore(root, "file.txt", &untrack()),
            Err(WriteError::InvalidPath)
        );
        assert_eq!(fs::read(&target).unwrap(), b"outside\n");
        assert_eq!(git(root, &["ls-files", "--stage", "-z"]), index);
        assert!(fs::symlink_metadata(root.join(".gitignore"))
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn refuses_directory_ignore_file_and_non_repository() {
        let temporary = repository();
        let root = temporary.path();
        fs::create_dir(root.join(".gitignore")).unwrap();
        assert_eq!(
            ignore(root, "file.txt", &untrack()),
            Err(WriteError::InvalidPath)
        );
        let other = tempfile::tempdir().unwrap();
        assert!(matches!(
            ignore(other.path(), "file.txt", &untrack()),
            Err(WriteError::Diagnostic(_))
        ));
        assert!(!other.path().join(".gitignore").exists());
    }

    #[test]
    fn untrack_lock_failure_keeps_git_diagnostics_and_preserves_index_and_local_file() {
        let temporary = repository();
        let root = temporary.path();
        write(root, "file.txt", b"local\n");
        git(root, &["add", "--", "file.txt"]);
        let before = git(root, &["ls-files", "--stage", "-z"]);
        write(root, ".git/index.lock", b"owned by another process\n");
        let error = ignore(root, "file.txt", &untrack()).unwrap_err();
        let WriteError::Diagnostic(diagnostic) = error else {
            panic!("Git lock failure must retain command evidence");
        };
        let evidence = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(evidence["stage"], "ignore.untrack");
        assert_ne!(evidence["exitCode"], 0);
        assert!(evidence["stderr"].as_str().unwrap().contains("index.lock"));
        assert_eq!(git(root, &["ls-files", "--stage", "-z"]), before);
        assert_eq!(fs::read(root.join("file.txt")).unwrap(), b"local\n");
        // The caller records this partial write in its recovery snapshot.
        assert_eq!(fs::read(root.join(".gitignore")).unwrap(), b"/file.txt\n");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn preserves_ignore_permissions_and_untracks_non_utf8_matches_without_reading_them() {
        use std::os::unix::{ffi::OsStringExt, fs::PermissionsExt};
        let temporary = repository();
        let root = temporary.path();
        let name = std::ffi::OsString::from_vec(b"private-\xff.log".to_vec());
        fs::write(root.join(&name), b"local bytes\0\xff").unwrap();
        git(root, &["add", "."]);
        write(root, ".gitignore", b"# original\n");
        fs::set_permissions(root.join(".gitignore"), fs::Permissions::from_mode(0o640)).unwrap();
        ignore(root, "*.log", &extension(true)).unwrap();
        assert!(git(root, &["ls-files", "--cached", "-z"]).is_empty());
        assert_eq!(fs::read(root.join(&name)).unwrap(), b"local bytes\0\xff");
        assert_eq!(
            fs::metadata(root.join(".gitignore"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
    }
}

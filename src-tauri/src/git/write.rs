//! Escrituras locales acotadas y revalidadas contra el diff que vio la interfaz.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;

use super::diagnostics::Diagnostic;

use super::diff::{
    self, ChangeType, DiffContent, DiffLine, DiffLineKind, DiffPrecondition, DiffSource, FileDiff,
    ReadDiffError,
};

#[derive(Debug, PartialEq, Eq)]
pub enum WriteError {
    RecoveryUnavailable,
    GitFailed,
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<WriteError>, Diagnostic),
    Cancelled,
    InvalidPath,
    InvalidPathEncoding,
    MalformedDiff,
    Stale(String),
    UnsupportedSelection,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct LineRef {
    side: LineSide,
    line: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
enum LineSide {
    Old,
    New,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialRequest {
    pub(super) path: String,
    #[serde(default)]
    hunk_ids: Vec<String>,
    #[serde(default)]
    lines: Vec<LineRef>,
    precondition: DiffPrecondition,
    #[serde(default)]
    ignore_whitespace: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardTarget {
    pub(super) path: String,
    precondition: DiffPrecondition,
}

pub fn stage(repository: &Path, paths: &[String]) -> Result<(), WriteError> {
    let paths = expand_paths(repository, paths, DiffSource::Worktree)?;
    if paths.is_empty() {
        return Ok(());
    }
    let tracked = git_command(repository)
        .args(["ls-files", "--cached", "-z", "--"])
        .args(&paths)
        .output()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io(
                "write.readTracked",
                &["ls-files", "--cached", "-z", "--"],
                &error,
            ))
        })?;
    if !tracked.status.success() {
        return Err(WriteError::Diagnostic(Diagnostic::command(
            "write.readTracked",
            &["ls-files", "--cached", "-z", "--"],
            &tracked,
        )));
    }
    let tracked: HashSet<&[u8]> = tracked.stdout.split(|byte| *byte == 0).collect();
    let (tracked_paths, new_paths): (Vec<_>, Vec<_>) = paths
        .iter()
        .map(String::as_str)
        .partition(|path| tracked.contains(path.as_bytes()));

    // `add -A` puede preparar un archivo versionado y aun así fallar porque su
    // carpeta está ignorada. `-u` actualiza solo el índice existente sin ese error.
    // Las altas conservan las reglas de ignore y nunca se fuerzan.
    for (mode, selected) in [("-A", new_paths), ("-u", tracked_paths)] {
        if selected.is_empty() {
            continue;
        }
        let mut args = vec!["add", mode, "--"];
        args.extend(selected);
        run_git(repository, &args, None)?;
    }
    Ok(())
}

pub fn unstage(repository: &Path, paths: &[String]) -> Result<(), WriteError> {
    let paths = expand_paths(repository, paths, DiffSource::Index)?;
    if paths.is_empty() {
        return Ok(());
    }
    let has_head = git_success(repository, &["rev-parse", "--verify", "HEAD"])?;
    let mut args = if has_head {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "-r", "-f", "--ignore-unmatch", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    run_git(repository, &args, None)
}

pub fn stage_partial(repository: &Path, request: PartialRequest) -> Result<(), WriteError> {
    apply_partial(repository, request, DiffSource::Worktree, false, true)
}

pub fn unstage_partial(repository: &Path, request: PartialRequest) -> Result<(), WriteError> {
    apply_partial(repository, request, DiffSource::Index, true, true)
}

pub fn discard_partial(repository: &Path, request: PartialRequest) -> Result<(), WriteError> {
    apply_partial(repository, request, DiffSource::Worktree, true, false)
}

pub(super) fn recovery_paths(
    repository: &Path,
    paths: &[String],
) -> Result<Vec<String>, WriteError> {
    let mut result = paths.to_vec();
    for path in paths {
        let file = current_diff(repository, path, DiffSource::Worktree, false)?;
        if let Some(previous) = file.previous_path {
            result.push(previous);
        }
    }
    result.sort();
    result.dedup();
    Ok(result)
}

/// Discard exactly the WIP the caller confirmed, including the index and new files.
pub fn discard_all(
    repository: &Path,
    expected: &super::status::ResetPrecondition,
) -> Result<(), WriteError> {
    let current = super::status::reset_precondition(repository);
    if &current != expected
        || current.index_tree.is_none()
        || current.worktree_tree.is_none()
        || current.untracked_tree.is_none()
    {
        return Err(WriteError::Stale("WIP".to_owned()));
    }
    let repo = super::repository::discover(repository).map_err(WriteError::Diagnostic)?;
    if !matches!(repo.operation(), super::repository::RepoOperation::None) {
        return Err(WriteError::UnsupportedSelection);
    }
    let args = if current.head.is_some() {
        vec!["ls-files", "--others", "--exclude-standard", "-z"]
    } else {
        vec![
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ]
    };
    let output = git_command(repository)
        .args(&args)
        .output()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io(
                "discardAll.listFiles",
                &args,
                &error,
            ))
        })?;
    if !output.status.success() {
        return Err(WriteError::Diagnostic(Diagnostic::command(
            "discardAll.listFiles",
            &args,
            &output,
        )));
    }
    let paths = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8(path.to_vec()).map_err(|_| WriteError::InvalidPathEncoding))
        .collect::<Result<HashSet<_>, _>>()?;
    for path in &paths {
        diff::validate_path(path).map_err(map_diff_error)?;
        // A nested repository is not an ordinary untracked file. Refuse before any write.
        if fs::symlink_metadata(repository.join(path)).is_ok_and(|m| m.is_dir()) {
            return Err(WriteError::UnsupportedSelection);
        }
    }
    if current.head.is_some() {
        // Empty commits have no paths for restore to match.
        if git_has_paths(repository, &["ls-files", "--cached", "-z"])?
            || git_has_paths(repository, &["ls-tree", "-r", "--name-only", "-z", "HEAD"])?
        {
            run_git(
                repository,
                &[
                    "restore",
                    "--source=HEAD",
                    "--staged",
                    "--worktree",
                    "--",
                    ".",
                ],
                None,
            )?;
        }
    } else {
        run_git(repository, &["read-tree", "--empty"], None)?;
    }
    let tracked = git_command(repository)
        .args(["ls-files", "--cached", "-z"])
        .output()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io(
                "discardAll.readTracked",
                &["ls-files", "--cached", "-z"],
                &error,
            ))
        })?;
    if !tracked.status.success() {
        return Err(WriteError::Diagnostic(Diagnostic::command(
            "discardAll.readTracked",
            &["ls-files", "--cached", "-z"],
            &tracked,
        )));
    }
    let tracked: HashSet<&[u8]> = tracked.stdout.split(|byte| *byte == 0).collect();
    for path in paths {
        // A staged deletion can leave an untracked copy which restore has just restored.
        if !tracked.contains(path.as_bytes()) {
            remove_untracked(repository, &path)?;
        }
    }
    Ok(())
}

pub fn discard(repository: &Path, targets: Vec<DiscardTarget>) -> Result<(), WriteError> {
    let mut current = Vec::with_capacity(targets.len());
    for target in targets {
        diff::validate_path(&target.path).map_err(map_diff_error)?;
        let file = current_diff(repository, &target.path, DiffSource::Worktree, false)?;
        ensure_current(&target.path, &target.precondition, &file)?;
        current.push(file);
    }

    // Primero se restauran las rutas que Git conoce. Solo después se retiran
    // no rastreados: un fallo de Git no debe borrar el único ejemplar de nada.
    for file in current
        .iter()
        .filter(|file| file.precondition.before.is_some())
    {
        if file.change == ChangeType::Renamed {
            let previous = file
                .previous_path
                .as_deref()
                .ok_or(WriteError::MalformedDiff)?;
            checkout_index(repository, previous)?;
            remove_untracked(repository, &file.path)?;
        } else {
            checkout_index(repository, &file.path)?;
        }
    }
    for file in current
        .iter()
        .filter(|file| file.precondition.before.is_none())
    {
        remove_untracked(repository, &file.path)?;
    }
    Ok(())
}

fn apply_partial(
    repository: &Path,
    request: PartialRequest,
    source: DiffSource,
    reverse: bool,
    cached: bool,
) -> Result<(), WriteError> {
    diff::validate_path(&request.path).map_err(map_diff_error)?;
    let file = current_diff(repository, &request.path, source, request.ignore_whitespace)?;
    ensure_current(&request.path, &request.precondition, &file)?;
    if matches!(
        file.content,
        DiffContent::Text {
            supports_partial: false,
            ..
        }
    ) {
        return Err(WriteError::UnsupportedSelection);
    }
    if [&file.precondition.before, &file.precondition.after]
        .into_iter()
        .flatten()
        .any(|side| {
            matches!(
                side.mode,
                diff::GitFileMode::SymbolicLink | diff::GitFileMode::GitLink
            )
        })
    {
        return Err(WriteError::UnsupportedSelection);
    }
    let patch = selected_patch(&file, &request.hunk_ids, &request.lines, reverse)?;
    apply_patch(
        repository,
        patch.as_bytes(),
        cached,
        request.ignore_whitespace,
    )
}

fn current_diff(
    repository: &Path,
    path: &str,
    source: DiffSource,
    ignore_whitespace: bool,
) -> Result<FileDiff, WriteError> {
    diff::current(repository, path.to_owned(), source, ignore_whitespace).map_err(map_diff_error)
}

fn ensure_current(
    path: &str,
    expected: &DiffPrecondition,
    current: &FileDiff,
) -> Result<(), WriteError> {
    if expected == &current.precondition {
        Ok(())
    } else {
        Err(WriteError::Stale(path.to_owned()))
    }
}

fn expand_paths(
    repository: &Path,
    requested: &[String],
    source: DiffSource,
) -> Result<Vec<String>, WriteError> {
    let mut result = Vec::new();
    for path in requested {
        diff::validate_path(path).map_err(map_diff_error)?;
        let file = current_diff(repository, path, source.clone(), false)?;
        if let Some(previous) = file.previous_path {
            result.push(previous);
        }
        result.push(path.clone());
    }
    result.sort();
    result.dedup();
    Ok(result)
}

fn selected_patch(
    file: &FileDiff,
    hunk_ids: &[String],
    lines: &[LineRef],
    reverse: bool,
) -> Result<String, WriteError> {
    if hunk_ids.is_empty() && lines.is_empty() {
        return Err(WriteError::UnsupportedSelection);
    }
    let DiffContent::Text { hunks, .. } = &file.content else {
        return Err(WriteError::UnsupportedSelection);
    };
    let wanted_hunks = hunk_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let wanted_lines = lines.iter().cloned().collect::<HashSet<_>>();
    let available_hunks = hunks
        .iter()
        .map(|hunk| hunk.id.as_str())
        .collect::<HashSet<_>>();
    let available_lines = hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .filter_map(line_reference)
        .collect::<HashSet<_>>();
    if !wanted_hunks.is_subset(&available_hunks) || !wanted_lines.is_subset(&available_lines) {
        return Err(WriteError::UnsupportedSelection);
    }
    // Build the patch against the side Git will actually modify. In reverse
    // operations, unselected additions are already present and must be context;
    // unselected deletions are absent and must not appear in the patch.
    let (base, target) = if reverse {
        (&file.precondition.after, &file.precondition.before)
    } else {
        (&file.precondition.before, &file.precondition.after)
    };
    let all_selected = hunks.iter().all(|hunk| {
        wanted_hunks.contains(hunk.id.as_str())
            || hunk.lines.iter().all(|line| {
                line.kind == DiffLineKind::Context || line_is_selected(line, &wanted_lines)
            })
    });
    let deleted = target.is_none() && all_selected;
    let path = quoted_patch_path(&file.path);
    let mut result = format!("diff --git {path} {path}\n");
    if base.is_none() || deleted {
        let snapshot = base
            .as_ref()
            .or(target.as_ref())
            .ok_or(WriteError::MalformedDiff)?;
        let mode = serde_json::to_value(snapshot.mode).map_err(|_| WriteError::MalformedDiff)?;
        let mode = mode.as_str().ok_or(WriteError::MalformedDiff)?;
        result.push_str(&format!(
            "{} file mode {mode}\n",
            if deleted { "deleted" } else { "new" }
        ));
    }
    result.push_str(&format!(
        "--- {}\n+++ {}\n",
        if base.is_none() { "/dev/null" } else { &path },
        if deleted { "/dev/null" } else { &path }
    ));
    let mut selected_delta = 0_i64;
    let mut any = false;

    for hunk in hunks {
        let whole = wanted_hunks.contains(hunk.id.as_str());
        let mut body = Vec::new();
        let mut selected = false;
        let mut new_count = 0_u64;
        let mut delta = 0_i64;
        let mut index = 0;
        while index < hunk.lines.len() {
            if hunk.lines[index].kind == DiffLineKind::Context {
                push_patch_line(&mut body, ' ', &hunk.lines[index]);
                new_count += 1;
                index += 1;
                continue;
            }

            let removed_start = index;
            while hunk
                .lines
                .get(index)
                .is_some_and(|line| line.kind == DiffLineKind::Removed)
            {
                index += 1;
            }
            let added_start = index;
            while hunk
                .lines
                .get(index)
                .is_some_and(|line| line.kind == DiffLineKind::Added)
            {
                index += 1;
            }
            let removed = &hunk.lines[removed_start..added_start];
            let added = &hunk.lines[added_start..index];
            let (removed, added) = if reverse {
                (added, removed)
            } else {
                (removed, added)
            };
            for offset in 0..removed.len().max(added.len()) {
                if let Some(line) = removed.get(offset) {
                    if whole || line_is_selected(line, &wanted_lines) {
                        push_patch_line(&mut body, '-', line);
                        selected = true;
                        delta -= 1;
                    } else {
                        push_patch_line(&mut body, ' ', line);
                        new_count += 1;
                    }
                }
                if let Some(line) = added.get(offset) {
                    if whole || line_is_selected(line, &wanted_lines) {
                        push_patch_line(&mut body, '+', line);
                        selected = true;
                        new_count += 1;
                        delta += 1;
                    }
                }
            }
        }
        if !selected {
            continue;
        }
        any = true;
        let (old_start, old_count) = if reverse {
            (hunk.new_start, hunk.new_lines)
        } else {
            (hunk.old_start, hunk.old_lines)
        };
        let new_start = (old_start as i64 + selected_delta + i64::from(old_count == 0)
            - i64::from(new_count == 0))
        .max(0) as u64;
        result.push_str(&format!(
            "@@ -{},{} +{},{} @@{}\n",
            old_start,
            old_count,
            new_start,
            new_count,
            if hunk.header.is_empty() {
                String::new()
            } else {
                format!(" {}", hunk.header)
            }
        ));
        for line in body {
            result.push_str(&line);
        }
        selected_delta += delta;
    }
    if any {
        Ok(result)
    } else {
        Err(WriteError::UnsupportedSelection)
    }
}

/// Git patch headers use C quoting with octal escapes for path bytes.
fn quoted_patch_path(path: &str) -> String {
    let mut quoted = String::from("\"");
    for byte in path.bytes() {
        match byte {
            b'"' | b'\\' => {
                quoted.push('\\');
                quoted.push(byte as char);
            }
            32..=126 => quoted.push(byte as char),
            _ => quoted.push_str(&format!("\\{byte:03o}")),
        }
    }
    quoted.push('"');
    quoted
}

fn line_is_selected(line: &DiffLine, wanted: &HashSet<LineRef>) -> bool {
    line_reference(line).is_some_and(|reference| wanted.contains(&reference))
}

fn line_reference(line: &DiffLine) -> Option<LineRef> {
    match line.kind {
        DiffLineKind::Removed => line.old_line.map(|number| LineRef {
            side: LineSide::Old,
            line: number,
        }),
        DiffLineKind::Added => line.new_line.map(|number| LineRef {
            side: LineSide::New,
            line: number,
        }),
        DiffLineKind::Context => None,
    }
}

fn push_patch_line(output: &mut Vec<String>, prefix: char, line: &DiffLine) {
    output.push(format!(
        "{prefix}{}{}",
        line.text,
        match line.ending {
            diff::LineEnding::Lf => "\n",
            diff::LineEnding::CrLf => "\r\n",
        }
    ));
    if line.no_newline {
        output.push("\\ No newline at end of file\n".to_owned());
    }
}

fn apply_patch(
    repository: &Path,
    patch: &[u8],
    cached: bool,
    ignore_whitespace: bool,
) -> Result<(), WriteError> {
    let mut args = vec!["apply"];
    if cached {
        args.push("--cached");
    }
    if ignore_whitespace {
        args.push("--ignore-space-change");
    }
    args.extend(["-p0", "--recount", "--whitespace=nowarn", "-"]);
    run_git(repository, &args, Some(patch))
}

fn checkout_index(repository: &Path, path: &str) -> Result<(), WriteError> {
    run_git(repository, &["checkout-index", "-f", "--", path], None)
}

fn remove_untracked(repository: &Path, path: &str) -> Result<(), WriteError> {
    let target = repository.join(path);
    let metadata = match fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(WriteError::Diagnostic(Diagnostic::io(
                "discard.inspectPath",
                &error,
            )))
        }
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir(&target).map_err(|error| {
            WriteError::Diagnostic(Diagnostic::io("discard.removeDirectory", &error))
        })
    } else {
        fs::remove_file(&target)
            .map_err(|error| WriteError::Diagnostic(Diagnostic::io("discard.removeFile", &error)))
    }
}

fn git_success(repository: &Path, args: &[&str]) -> Result<bool, WriteError> {
    let output = git_command(repository)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io("write.probe", args, &error))
        })?;
    if output.status.success() {
        return Ok(true);
    }
    // An unborn HEAD is expected. Corrupt configuration, inaccessible metadata
    // or an invalid repository must not be interpreted as an empty repository.
    if output.status.code() == Some(128)
        && String::from_utf8_lossy(&output.stderr).contains("Needed a single revision")
    {
        return Ok(false);
    }
    Err(WriteError::Diagnostic(Diagnostic::command(
        "write.probe",
        args,
        &output,
    )))
}

fn git_has_paths(repository: &Path, args: &[&str]) -> Result<bool, WriteError> {
    let output = git_command(repository)
        .args(args)
        .output()
        .map_err(|error| {
            WriteError::Diagnostic(Diagnostic::command_io("write.hasPaths", args, &error))
        })?;
    if !output.status.success() {
        return Err(WriteError::Diagnostic(Diagnostic::command(
            "write.hasPaths",
            args,
            &output,
        )));
    }
    Ok(!output.stdout.is_empty())
}

fn run_git(repository: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<(), WriteError> {
    let mut command = git_command(repository);
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command.spawn().map_err(|error| {
        WriteError::Diagnostic(Diagnostic::command_io("write.spawn", args, &error))
    })?;
    let input_result = if let Some(input) = stdin {
        child
            .stdin
            .take()
            .ok_or_else(|| {
                WriteError::Diagnostic(Diagnostic::new("write.input", "Git did not open stdin"))
            })
            .and_then(|mut pipe| {
                pipe.write_all(input).map_err(|error| {
                    WriteError::Diagnostic(Diagnostic::command_io("write.input", args, &error))
                })
            })
    } else {
        Ok(())
    };
    // Always close input and reap Git. Its stderr explains early rejection more
    // accurately than the BrokenPipe generated while sending the selected patch.
    let output = child.wait_with_output().map_err(|error| {
        WriteError::Diagnostic(Diagnostic::command_io("write.wait", args, &error))
    })?;
    if !output.status.success() {
        return Err(WriteError::Diagnostic(Diagnostic::command(
            "write.execute",
            args,
            &output,
        )));
    }
    input_result
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

fn map_diff_error(error: ReadDiffError) -> WriteError {
    match error {
        ReadDiffError::Cancelled => WriteError::Cancelled,
        ReadDiffError::InvalidPath => WriteError::InvalidPath,
        ReadDiffError::UnsupportedEncoding(_) => WriteError::UnsupportedSelection,
        ReadDiffError::InvalidPathEncoding => WriteError::InvalidPathEncoding,
        ReadDiffError::RevisionNotFound(_) => WriteError::GitFailed,
        ReadDiffError::MalformedOutput => WriteError::MalformedDiff,
        ReadDiffError::Diagnostic(diagnostic) => WriteError::Diagnostic(diagnostic),
        ReadDiffError::WithDiagnostic(error, diagnostic) => {
            WriteError::WithDiagnostic(Box::new(map_diff_error(*error)), diagnostic)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{
        discard, discard_partial, stage, stage_partial, unstage, unstage_partial, DiscardTarget,
        LineRef, LineSide, PartialRequest, WriteError,
    };
    use crate::git::diff::{self, DiffContent, DiffSource};

    #[test]
    fn discard_all_clears_both_layers_and_new_files_but_keeps_ignored() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("tracked"), "base").unwrap();
        fs::write(root.join(".gitignore"), "ignored\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "base"]);
        fs::write(root.join("tracked"), "staged").unwrap();
        fs::write(root.join("added"), "added").unwrap();
        git(root, &["add", "."]);
        fs::write(root.join("tracked"), "unstaged").unwrap();
        fs::write(root.join("new"), "new").unwrap();
        fs::write(root.join("ignored"), "keep").unwrap();
        let before = crate::git::undo_checkpoint::Checkpoint::capture(root, &[]).unwrap();
        let expected = crate::git::status::reset_precondition(root);
        super::discard_all(root, &expected).unwrap();
        assert_eq!(output(root, &["status", "--porcelain"]), "");
        assert_eq!(fs::read_to_string(root.join("tracked")).unwrap(), "base");
        assert!(!root.join("new").exists());
        assert!(!root.join("added").exists());
        assert_eq!(fs::read_to_string(root.join("ignored")).unwrap(), "keep");
        let after = crate::git::undo_checkpoint::Checkpoint::after(root, &before).unwrap();
        let stacks = crate::git::undo::UndoStacks::default();
        let id = root.to_str().unwrap();
        stacks.remember_checkpoint(id, before, after, "undo.discard");
        stacks.undo(id, root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("tracked")).unwrap(),
            "unstaged"
        );
        assert_eq!(fs::read_to_string(root.join("added")).unwrap(), "added");
        assert_eq!(fs::read_to_string(root.join("new")).unwrap(), "new");
    }

    #[test]
    fn discard_all_restores_a_staged_deletion_with_an_untracked_copy() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("tracked"), "base").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "base"]);
        git(root, &["rm", "--cached", "tracked"]);
        fs::write(root.join("tracked"), "untracked edit").unwrap();
        super::discard_all(root, &crate::git::status::reset_precondition(root)).unwrap();
        assert_eq!(fs::read_to_string(root.join("tracked")).unwrap(), "base");
        assert_eq!(output(root, &["status", "--porcelain"]), "");
    }

    #[test]
    fn discard_all_rejects_stale_wip_before_writing() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("new"), "before").unwrap();
        let expected = crate::git::status::reset_precondition(root);
        fs::write(root.join("new"), "after").unwrap();
        assert!(matches!(
            super::discard_all(root, &expected),
            Err(WriteError::Stale(_))
        ));
        assert_eq!(fs::read_to_string(root.join("new")).unwrap(), "after");
    }

    #[test]
    fn discard_all_handles_only_untracked_files_after_an_empty_commit() {
        let temporary = repository();
        let root = temporary.path();
        git(root, &["commit", "--allow-empty", "-qm", "empty"]);
        fs::write(root.join("new"), "new").unwrap();
        super::discard_all(root, &crate::git::status::reset_precondition(root)).unwrap();
        assert!(!root.join("new").exists());
    }

    #[test]
    fn discard_all_handles_an_unborn_branch() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("added"), "added").unwrap();
        git(root, &["add", "."]);
        fs::write(root.join("new"), "new").unwrap();
        super::discard_all(root, &crate::git::status::reset_precondition(root)).unwrap();
        assert_eq!(output(root, &["status", "--porcelain"]), "");
        assert!(!root.join("added").exists());
        assert!(!root.join("new").exists());
    }

    fn repository() -> TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(temporary.path(), &["init", "--quiet"]);
        git(temporary.path(), &["config", "user.name", "GitThul"]);
        git(temporary.path(), &["config", "core.autocrlf", "false"]);
        git(
            temporary.path(),
            &["config", "user.email", "gitthul@example.invalid"],
        );
        temporary
    }

    fn git(repository: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("LC_ALL", "C")
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn output(repository: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("LC_ALL", "C")
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap()
    }

    fn commit_file(repository: &Path, path: &str, contents: &str) {
        fs::write(repository.join(path), contents).unwrap();
        git(repository, &["add", "--", path]);
        git(repository, &["commit", "--quiet", "-m", "base"]);
    }

    fn partial(repository: &Path, path: &str, source: DiffSource) -> PartialRequest {
        let current = diff::current(repository, path.to_owned(), source, false).unwrap();
        PartialRequest {
            path: path.to_owned(),
            hunk_ids: Vec::new(),
            lines: Vec::new(),
            precondition: current.precondition,
            ignore_whitespace: false,
        }
    }

    #[test]
    fn restages_tracked_files_in_ignored_directories_with_new_files() {
        let temporary = repository();
        let root = temporary.path();
        fs::create_dir(root.join(".settings")).unwrap();
        commit_file(root, ".settings/config", "before\n");
        commit_file(root, ".gitignore", ".settings/\n");
        fs::write(root.join(".settings/config"), "after\n").unwrap();
        fs::write(root.join("new.txt"), "new\n").unwrap();
        fs::write(root.join(".settings/ignored"), "ignored\n").unwrap();
        let paths = vec![".settings/config".to_owned(), "new.txt".to_owned()];

        stage(root, &paths).unwrap();
        unstage(root, &paths).unwrap();
        stage(root, &paths).unwrap();

        assert_eq!(
            output(root, &["diff", "--cached", "--name-status"]),
            "M\t.settings/config\nA\tnew.txt\n"
        );
        assert!(output(root, &["diff"]).is_empty());
        assert!(output(root, &["ls-files", "--", ".settings/ignored"]).is_empty());
    }

    #[test]
    fn stages_tracked_deletions_in_ignored_directories() {
        let temporary = repository();
        let root = temporary.path();
        fs::create_dir(root.join(".settings")).unwrap();
        commit_file(root, ".settings/config", "before\n");
        commit_file(root, ".gitignore", ".settings/\n");
        fs::remove_file(root.join(".settings/config")).unwrap();

        stage(root, &[".settings/config".to_owned()]).unwrap();

        assert_eq!(
            output(root, &["diff", "--cached", "--name-status"]),
            "D\t.settings/config\n"
        );
    }

    #[test]
    fn stage_does_not_force_new_ignored_files() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, ".gitignore", "ignored.txt\n");
        fs::write(root.join("ignored.txt"), "ignored\n").unwrap();

        assert!(stage(root, &["ignored.txt".to_owned()]).is_err());
        assert!(output(root, &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn prepara_y_retira_un_archivo_sin_tocar_el_otro_lado() {
        let temporary = repository();
        commit_file(temporary.path(), "mixed.txt", "uno\ndos\ntres\n");
        fs::write(temporary.path().join("mixed.txt"), "uno\nDOS\ntres\n").unwrap();
        stage(temporary.path(), &["mixed.txt".to_owned()]).unwrap();
        fs::write(temporary.path().join("mixed.txt"), "uno\nDOS\nTRES\n").unwrap();

        unstage(temporary.path(), &["mixed.txt".to_owned()]).unwrap();

        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
        let worktree = output(temporary.path(), &["diff"]);
        assert!(worktree.contains("+DOS"));
        assert!(worktree.contains("+TRES"));
    }

    #[test]
    fn conserva_origen_y_destino_de_un_renombre_completo() {
        let temporary = repository();
        commit_file(temporary.path(), "old name.txt", "igual\n");
        git(temporary.path(), &["mv", "old name.txt", "new name.txt"]);
        stage(temporary.path(), &["new name.txt".to_owned()]).unwrap();
        assert!(
            output(temporary.path(), &["diff", "--cached", "--name-status"])
                .starts_with("R100\told name.txt\tnew name.txt")
        );

        unstage(temporary.path(), &["new name.txt".to_owned()]).unwrap();
        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn prepara_y_retira_solo_un_hunk() {
        let temporary = repository();
        let base = (1..=20)
            .map(|line| format!("linea {line}\n"))
            .collect::<String>();
        commit_file(temporary.path(), "dos-hunks.txt", &base);
        let changed = base
            .replace("linea 2\n", "LINEA 2\n")
            .replace("linea 18\n", "LINEA 18\n");
        fs::write(temporary.path().join("dos-hunks.txt"), changed).unwrap();
        let mut request = partial(temporary.path(), "dos-hunks.txt", DiffSource::Worktree);
        let file = diff::current(
            temporary.path(),
            "dos-hunks.txt".to_owned(),
            DiffSource::Worktree,
            false,
        )
        .unwrap();
        let DiffContent::Text { hunks, .. } = file.content else {
            panic!()
        };
        request.hunk_ids.push(hunks[0].id.clone());
        stage_partial(temporary.path(), request).unwrap();
        let staged = output(temporary.path(), &["diff", "--cached"]);
        assert!(staged.contains("+LINEA 2"));
        assert!(!staged.contains("+LINEA 18"));

        let mut request = partial(temporary.path(), "dos-hunks.txt", DiffSource::Index);
        let file = diff::current(
            temporary.path(),
            "dos-hunks.txt".to_owned(),
            DiffSource::Index,
            false,
        )
        .unwrap();
        let DiffContent::Text { hunks, .. } = file.content else {
            panic!()
        };
        request.hunk_ids.push(hunks[0].id.clone());
        unstage_partial(temporary.path(), request).unwrap();
        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
        assert!(output(temporary.path(), &["diff"]).contains("+LINEA 18"));
    }

    #[test]
    fn prepara_y_descarta_lineas_independientes_del_mismo_hunk() {
        let temporary = repository();
        commit_file(temporary.path(), "lineas.txt", "a\nb\nc\nd\n");
        fs::write(temporary.path().join("lineas.txt"), "a\nB\nC\nd\n").unwrap();
        let mut request = partial(temporary.path(), "lineas.txt", DiffSource::Worktree);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 2,
            },
            LineRef {
                side: LineSide::New,
                line: 2,
            },
        ];
        stage_partial(temporary.path(), request).unwrap();
        assert!(output(temporary.path(), &["show", ":lineas.txt"]).contains("B\nc"));

        let mut request = partial(temporary.path(), "lineas.txt", DiffSource::Worktree);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 3,
            },
            LineRef {
                side: LineSide::New,
                line: 3,
            },
        ];
        discard_partial(temporary.path(), request).unwrap();
        assert_eq!(
            fs::read_to_string(temporary.path().join("lineas.txt")).unwrap(),
            "a\nB\nc\nd\n"
        );
    }

    #[test]
    fn unstage_selection_keeps_other_changes_in_the_same_hunk_and_worktree() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, "mixed.txt", "a\nb\nc\nd\n");
        let working = "a\nB\nC\nd\n";
        fs::write(root.join("mixed.txt"), working).unwrap();
        stage(root, &["mixed.txt".into()]).unwrap();
        let mut request = partial(root, "mixed.txt", DiffSource::Index);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 2,
            },
            LineRef {
                side: LineSide::New,
                line: 2,
            },
        ];
        unstage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":mixed.txt"]), "a\nb\nC\nd\n");
        assert_eq!(fs::read_to_string(root.join("mixed.txt")).unwrap(), working);
        assert_eq!(output(root, &["status", "--porcelain"]), "MM mixed.txt\n");
        let mut request = partial(root, "mixed.txt", DiffSource::Worktree);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 2,
            },
            LineRef {
                side: LineSide::New,
                line: 2,
            },
        ];
        stage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":mixed.txt"]), working);
        assert!(output(root, &["diff"]).is_empty());
    }

    #[test]
    fn individual_additions_and_removals_are_independent() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, "mixed.txt", "a\nb\nc\nd\n");
        fs::write(root.join("mixed.txt"), "a\nB\nC\nd\n").unwrap();
        let mut request = partial(root, "mixed.txt", DiffSource::Worktree);
        request.lines = vec![LineRef {
            side: LineSide::New,
            line: 2,
        }];
        stage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":mixed.txt"]), "a\nb\nB\nc\nd\n");
        let mut request = partial(root, "mixed.txt", DiffSource::Index);
        request.lines = vec![LineRef {
            side: LineSide::New,
            line: 3,
        }];
        unstage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":mixed.txt"]), "a\nb\nc\nd\n");
        let mut request = partial(root, "mixed.txt", DiffSource::Worktree);
        request.lines = vec![LineRef {
            side: LineSide::Old,
            line: 2,
        }];
        stage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":mixed.txt"]), "a\nc\nd\n");
        let mut request = partial(root, "mixed.txt", DiffSource::Index);
        request.lines = vec![LineRef {
            side: LineSide::Old,
            line: 2,
        }];
        unstage_partial(root, request).unwrap();
        assert!(output(root, &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn partial_new_file_can_be_unstaged_line_by_line_until_it_is_untracked() {
        let temporary = repository();
        let root = temporary.path();
        let path = if cfg!(windows) {
            "nuevo ü con espacios.txt"
        } else {
            "nuevo ü\t.txt"
        };
        let working = "uno\ndos\ntres\n";
        fs::write(root.join(path), working).unwrap();
        let mut request = partial(root, path, DiffSource::Worktree);
        request.lines = vec![
            LineRef {
                side: LineSide::New,
                line: 1,
            },
            LineRef {
                side: LineSide::New,
                line: 3,
            },
        ];
        stage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", &format!(":{path}")]), "uno\ntres\n");
        let mut request = partial(root, path, DiffSource::Index);
        request.lines = vec![LineRef {
            side: LineSide::New,
            line: 1,
        }];
        unstage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", &format!(":{path}")]), "tres\n");
        let mut request = partial(root, path, DiffSource::Index);
        request.lines = vec![LineRef {
            side: LineSide::New,
            line: 1,
        }];
        unstage_partial(root, request).unwrap();
        assert!(output(root, &["ls-files"]).is_empty());
        assert_eq!(fs::read_to_string(root.join(path)).unwrap(), working);
    }

    #[test]
    fn deleted_file_can_be_staged_and_restored_partially() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, "deleted.txt", "uno\ndos\ntres\n");
        fs::remove_file(root.join("deleted.txt")).unwrap();
        let mut request = partial(root, "deleted.txt", DiffSource::Worktree);
        request.lines = vec![LineRef {
            side: LineSide::Old,
            line: 2,
        }];
        stage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":deleted.txt"]), "uno\ntres\n");
        stage(root, &["deleted.txt".into()]).unwrap();
        let mut request = partial(root, "deleted.txt", DiffSource::Index);
        request.lines = vec![LineRef {
            side: LineSide::Old,
            line: 2,
        }];
        unstage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":deleted.txt"]), "dos\n");
        assert!(!root.join("deleted.txt").exists());
    }

    #[test]
    fn partial_unstage_handles_line_offsets_across_multiple_hunks() {
        let temporary = repository();
        let root = temporary.path();
        let base = (1..=30).map(|n| format!("line {n}\n")).collect::<String>();
        commit_file(root, "many.txt", &base);
        let working = base
            .replace("line 2\n", "line 2\nadded A\nadded B\n")
            .replace("line 20\n", "line 20\nadded C\nadded D\n");
        fs::write(root.join("many.txt"), &working).unwrap();
        stage(root, &["many.txt".into()]).unwrap();
        let mut request = partial(root, "many.txt", DiffSource::Index);
        request.lines = vec![
            LineRef {
                side: LineSide::New,
                line: 3,
            },
            LineRef {
                side: LineSide::New,
                line: 23,
            },
        ];
        unstage_partial(root, request).unwrap();
        assert_eq!(
            output(root, &["show", ":many.txt"]),
            working.replace("added A\n", "").replace("added C\n", "")
        );
        assert_eq!(fs::read_to_string(root.join("many.txt")).unwrap(), working);
    }

    #[test]
    fn partial_discard_of_additions_keeps_unselected_lines() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, "add.txt", "start\nend\n");
        fs::write(root.join("add.txt"), "start\none\ntwo\nthree\nend\n").unwrap();
        let mut request = partial(root, "add.txt", DiffSource::Worktree);
        request.lines = vec![LineRef {
            side: LineSide::New,
            line: 3,
        }];
        discard_partial(root, request).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("add.txt")).unwrap(),
            "start\none\nthree\nend\n"
        );
        assert_eq!(output(root, &["show", ":add.txt"]), "start\nend\n");
    }

    #[test]
    fn stages_and_unstages_a_selection_in_a_windows_batch_file() {
        let temporary = repository();
        let root = temporary.path();
        let base = (1..=12)
            .map(|n| format!("echo line {n}\r\n"))
            .collect::<String>();
        commit_file(root, "gradlew.bat", &base);
        let working = (5..=9).fold(base.clone(), |text, n| {
            text.replace(
                &format!("echo line {n}\r\n"),
                &format!("echo line {n} 1>&2\r\n"),
            )
        });
        fs::write(root.join("gradlew.bat"), &working).unwrap();
        let mut request = partial(root, "gradlew.bat", DiffSource::Worktree);
        request.lines = (5..=8)
            .flat_map(|line| {
                [
                    LineRef {
                        side: LineSide::Old,
                        line,
                    },
                    LineRef {
                        side: LineSide::New,
                        line,
                    },
                ]
            })
            .collect();
        stage_partial(root, request).unwrap();
        let staged = working.replace("echo line 9 1>&2\r\n", "echo line 9\r\n");
        assert_eq!(output(root, &["show", ":gradlew.bat"]), staged);
        assert_eq!(output(root, &["status", "--porcelain"]), "MM gradlew.bat\n");
        let mut request = partial(root, "gradlew.bat", DiffSource::Index);
        request.lines = (6..=7)
            .flat_map(|line| {
                [
                    LineRef {
                        side: LineSide::Old,
                        line,
                    },
                    LineRef {
                        side: LineSide::New,
                        line,
                    },
                ]
            })
            .collect();
        unstage_partial(root, request).unwrap();
        assert_eq!(
            output(root, &["show", ":gradlew.bat"]),
            staged
                .replace("echo line 6 1>&2\r\n", "echo line 6\r\n")
                .replace("echo line 7 1>&2\r\n", "echo line 7\r\n")
        );
        assert_eq!(
            fs::read_to_string(root.join("gradlew.bat")).unwrap(),
            working
        );
    }

    #[test]
    fn partial_unstage_preserves_a_missing_final_newline() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, "eof.txt", "a\nb\nc");
        fs::write(root.join("eof.txt"), "A\nb\nC").unwrap();
        stage(root, &["eof.txt".into()]).unwrap();
        let mut request = partial(root, "eof.txt", DiffSource::Index);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 1,
            },
            LineRef {
                side: LineSide::New,
                line: 1,
            },
        ];
        unstage_partial(root, request).unwrap();
        assert_eq!(output(root, &["show", ":eof.txt"]), "a\nb\nC");
        assert_eq!(fs::read_to_string(root.join("eof.txt")).unwrap(), "A\nb\nC");
    }

    #[test]
    fn whitespace_hidden_in_context_does_not_block_partial_staging() {
        let temporary = repository();
        let root = temporary.path();
        commit_file(root, "space.txt", "a  b\nc\nd\ne\n");
        fs::write(root.join("space.txt"), "a b\nC\nd\nE\n").unwrap();
        let file = diff::current(root, "space.txt".into(), DiffSource::Worktree, true).unwrap();
        stage_partial(
            root,
            PartialRequest {
                path: "space.txt".into(),
                precondition: file.precondition,
                ignore_whitespace: true,
                hunk_ids: vec![],
                lines: vec![
                    LineRef {
                        side: LineSide::Old,
                        line: 2,
                    },
                    LineRef {
                        side: LineSide::New,
                        line: 2,
                    },
                ],
            },
        )
        .unwrap();
        assert_eq!(output(root, &["show", ":space.txt"]), "a  b\nC\nd\ne\n");
    }

    #[test]
    fn descarte_completo_conserva_el_indice_y_retira_no_rastreados() {
        let temporary = repository();
        commit_file(temporary.path(), "mixed.txt", "base\n");
        fs::write(temporary.path().join("mixed.txt"), "stage\n").unwrap();
        git(temporary.path(), &["add", "mixed.txt"]);
        fs::write(temporary.path().join("mixed.txt"), "worktree\n").unwrap();
        fs::write(temporary.path().join("nuevo.txt"), "nuevo\n").unwrap();
        let mixed = diff::current(
            temporary.path(),
            "mixed.txt".to_owned(),
            DiffSource::Worktree,
            false,
        )
        .unwrap();
        let new = diff::current(
            temporary.path(),
            "nuevo.txt".to_owned(),
            DiffSource::Worktree,
            false,
        )
        .unwrap();

        discard(
            temporary.path(),
            vec![
                DiscardTarget {
                    path: "mixed.txt".to_owned(),
                    precondition: mixed.precondition,
                },
                DiscardTarget {
                    path: "nuevo.txt".to_owned(),
                    precondition: new.precondition,
                },
            ],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(temporary.path().join("mixed.txt")).unwrap(),
            "stage\n"
        );
        assert_eq!(output(temporary.path(), &["show", ":mixed.txt"]), "stage\n");
        assert!(!temporary.path().join("nuevo.txt").exists());
    }

    #[test]
    fn rechaza_una_seleccion_obsoleta_antes_de_escribir() {
        let temporary = repository();
        commit_file(temporary.path(), "stale.txt", "base\n");
        fs::write(temporary.path().join("stale.txt"), "primero\n").unwrap();
        let mut request = partial(temporary.path(), "stale.txt", DiffSource::Worktree);
        request.lines.push(LineRef {
            side: LineSide::New,
            line: 1,
        });
        fs::write(temporary.path().join("stale.txt"), "después\n").unwrap();

        assert_eq!(
            stage_partial(temporary.path(), request),
            Err(WriteError::Stale("stale.txt".to_owned()))
        );
        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn prepara_parcialmente_un_no_rastreado_y_lo_retira_sin_head() {
        let temporary = repository();
        fs::write(temporary.path().join("nuevo.txt"), "uno\ndos\n").unwrap();
        let mut request = partial(temporary.path(), "nuevo.txt", DiffSource::Worktree);
        request.lines.push(LineRef {
            side: LineSide::New,
            line: 1,
        });

        stage_partial(temporary.path(), request).unwrap();

        assert_eq!(output(temporary.path(), &["show", ":nuevo.txt"]), "uno\n");
        assert_eq!(
            fs::read_to_string(temporary.path().join("nuevo.txt")).unwrap(),
            "uno\ndos\n"
        );
        unstage(temporary.path(), &["nuevo.txt".to_owned()]).unwrap();
        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn conserva_crlf_al_preparar_una_linea() {
        let temporary = repository();
        commit_file(temporary.path(), "crlf.txt", "uno\r\ndos\r\n");
        fs::write(temporary.path().join("crlf.txt"), b"UNO\r\ndos\r\n").unwrap();
        let mut request = partial(temporary.path(), "crlf.txt", DiffSource::Worktree);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 1,
            },
            LineRef {
                side: LineSide::New,
                line: 1,
            },
        ];

        stage_partial(temporary.path(), request).unwrap();

        assert_eq!(
            output(temporary.path(), &["show", ":crlf.txt"]),
            "UNO\r\ndos\r\n"
        );
    }

    #[test]
    fn conserva_la_ausencia_de_newline_final() {
        let temporary = repository();
        commit_file(temporary.path(), "sin-final.txt", "uno\ndos");
        fs::write(temporary.path().join("sin-final.txt"), b"UNO\ndos").unwrap();
        let mut request = partial(temporary.path(), "sin-final.txt", DiffSource::Worktree);
        request.lines = vec![
            LineRef {
                side: LineSide::Old,
                line: 1,
            },
            LineRef {
                side: LineSide::New,
                line: 1,
            },
        ];

        stage_partial(temporary.path(), request).unwrap();

        assert_eq!(
            output(temporary.path(), &["show", ":sin-final.txt"]),
            "UNO\ndos"
        );
    }
    #[test]
    fn failed_stage_keeps_index_lock_stderr_and_command() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("private.txt"), "PRIVATE_FILE_CONTENT\n").unwrap();
        fs::write(root.join(".git/index.lock"), "held").unwrap();
        let error = stage(root, &["private.txt".into()]).unwrap_err();
        let WriteError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["stage"], "write.execute");
        assert_eq!(value["exitCode"], 128);
        assert_eq!(value["command"]["args"][0], "add");
        assert!(value["stderr"].as_str().unwrap().contains("index.lock"));
        assert!(!value.to_string().contains("PRIVATE_FILE_CONTENT"));
        assert!(value.get("stdout").is_none());
    }
}

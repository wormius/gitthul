//! Lectura de diffs de árbol e índice con Git CLI como autoridad.
//!
//! `--raw -z` decide identidad, modos, renombres y tipo de cambio. El parche
//! unificado solo aporta hunks: sus cabeceras humanas nunca se usan para
//! recuperar rutas.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{diagnostics::Diagnostic, encoding};

const DEFAULT_CONTEXT: u32 = 3;
const MAX_CONTEXT: u32 = 1_000;
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
const MAX_CHANGED_LINES: u64 = 50_000;

#[derive(Debug, PartialEq, Eq)]
pub enum ReadDiffError {
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<Self>, Diagnostic),
    Cancelled,
    InvalidPath,
    InvalidPathEncoding,
    UnsupportedEncoding(String),
    RevisionNotFound(String),
    MalformedOutput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffSource {
    Worktree,
    Index,
    Commit { sha: String },
    Stash { sha: String },
    Range { from: Option<String>, to: String },
    WorkingRange { from: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ResolvedSource {
    Worktree,
    Index,
    Commit {
        before: Option<String>,
        after: String,
    },
    Stash {
        after: String,
    },
    Range {
        before: String,
        after: String,
    },
    WorkingRange {
        before: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub(super) path: String,
    pub(super) source: DiffSource,
    pub(super) context: Option<u32>,
    #[serde(default)]
    pub(super) ignore_whitespace: bool,
    pub(super) encoding: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub(super) path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) previous_path: Option<String>,
    pub(super) change: ChangeType,
    pub(super) source: DiffSource,
    pub(super) precondition: DiffPrecondition,
    pub(super) content: DiffContent,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_path: Option<String>,
    change: ChangeType,
    binary: bool,
    insertions: u64,
    deletions: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    TypeChanged,
    Conflicted,
    Unmodified,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiffPrecondition {
    pub(super) before: Option<DiffSideSnapshot>,
    pub(super) after: Option<DiffSideSnapshot>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(super) struct DiffSideSnapshot {
    pub(super) oid: String,
    pub(super) mode: GitFileMode,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(super) enum GitFileMode {
    #[serde(rename = "100644")]
    Regular,
    #[serde(rename = "100755")]
    Executable,
    #[serde(rename = "120000")]
    SymbolicLink,
    #[serde(rename = "160000")]
    GitLink,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum DiffContent {
    Text {
        hunks: Vec<Hunk>,
        truncated: bool,
        encoding: &'static str,
        #[serde(rename = "detectedEncoding")]
        detected_encoding: &'static str,
        #[serde(rename = "decodingErrors")]
        decoding_errors: bool,
        #[serde(rename = "supportsPartial")]
        supports_partial: bool,
    },
    Binary {
        #[serde(rename = "oldSize")]
        old_size: Option<u64>,
        #[serde(rename = "newSize")]
        new_size: Option<u64>,
        #[serde(rename = "mediaType")]
        media_type: &'static str,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Hunk {
    pub(super) id: String,
    pub(super) old_start: u64,
    pub(super) old_lines: u64,
    pub(super) new_start: u64,
    pub(super) new_lines: u64,
    pub(super) header: String,
    pub(super) lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiffLine {
    pub(super) kind: DiffLineKind,
    pub(super) old_line: Option<u64>,
    pub(super) new_line: Option<u64>,
    pub(super) text: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    words: Vec<WordSpan>,
    #[serde(skip)]
    pub(super) no_newline: bool,
    #[serde(skip)]
    pub(super) ending: LineEnding,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum LineEnding {
    #[default]
    Lf,
    CrLf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Clone, Copy, Debug, Serialize)]
struct WordSpan {
    start: usize,
    end: usize,
}

#[derive(Debug)]
struct RawEntry {
    previous_path: Option<Vec<u8>>,
    change: ChangeType,
    before: Option<DiffSideSnapshot>,
    after: Option<DiffSideSnapshot>,
}

#[derive(Clone, Copy, Debug, Default)]
struct NumStat {
    binary: bool,
    changed_lines: u64,
}

#[derive(Clone, Copy, Debug, Default)]
struct FileStats {
    binary: bool,
    insertions: u64,
    deletions: u64,
}

/// Lists the net changes of exactly the source used by the file viewer.
/// Histories may differ while their two endpoint trees are identical.
pub fn read_files_cancellable(
    repository: &Path,
    source: &DiffSource,
    cancelled: &AtomicBool,
) -> Result<Vec<FileChange>, ReadDiffError> {
    ensure_not_cancelled(cancelled)?;
    let resolved = resolve_source(repository, source)?;
    let raw = raw_diff_with_identity(repository, &resolved, cancelled)?;
    let mut args = diff_args(&resolved, "--numstat");
    args.extend([
        "-z".to_owned(),
        "--no-ext-diff".to_owned(),
        "--no-textconv".to_owned(),
        "--find-renames".to_owned(),
        "--find-copies".to_owned(),
        "--".to_owned(),
    ]);
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = git_output_cancellable(repository, &borrowed, false, cancelled)?;
    let stats = parse_file_stats(&output.stdout)
        .map_err(|error| parse_error("diff.parseFileStatistics", error))?;
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for (path, entry) in collect_raw_entries(&raw.stdout)
        .map_err(|error| parse_error("diff.parseFileChanges", error))?
    {
        ensure_not_cancelled(cancelled)?;
        if !seen.insert(path.clone()) {
            continue;
        }
        let stats = stats.get(&path).copied().unwrap_or_default();
        files.push(FileChange {
            path: strict_path(&path)?,
            previous_path: entry
                .previous_path
                .as_deref()
                .map(strict_path)
                .transpose()?,
            change: entry.change,
            binary: stats.binary,
            insertions: stats.insertions,
            deletions: stats.deletions,
        });
    }
    if is_worktree_source(&resolved) {
        let untracked = git_output_cancellable(
            repository,
            &["ls-files", "--others", "--exclude-standard", "-z", "--"],
            false,
            cancelled,
        )?;
        for path in untracked
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
        {
            ensure_not_cancelled(cancelled)?;
            let path = strict_path(path)?;
            if let Some(position) = files.iter().position(|file| file.path == path) {
                // A path removed from the index can still exist in the starting
                // revision. Compare its actual working bytes instead of listing
                // Git's index-based deletion and an unrelated untracked addition.
                let diff = read_cancellable(
                    repository,
                    DiffRequest {
                        path: path.clone(),
                        source: source.clone(),
                        context: Some(0),
                        ignore_whitespace: false,
                        encoding: None,
                    },
                    cancelled,
                )?;
                if diff.change == ChangeType::Unmodified {
                    files.remove(position);
                } else {
                    let (binary, insertions, deletions) = match diff.content {
                        DiffContent::Binary { .. } => (true, 0, 0),
                        DiffContent::Text { hunks, .. } => (
                            false,
                            hunks
                                .iter()
                                .flat_map(|hunk| &hunk.lines)
                                .filter(|line| line.kind == DiffLineKind::Added)
                                .count() as u64,
                            hunks
                                .iter()
                                .flat_map(|hunk| &hunk.lines)
                                .filter(|line| line.kind == DiffLineKind::Removed)
                                .count() as u64,
                        ),
                    };
                    files[position] = FileChange {
                        path,
                        previous_path: diff.previous_path,
                        change: diff.change,
                        binary,
                        insertions,
                        deletions,
                    };
                }
                continue;
            }
            let absolute = repository.join(&path);
            let metadata = fs::symlink_metadata(&absolute).map_err(|error| {
                ReadDiffError::Diagnostic(Diagnostic::io("diff.inspectWorktreePath", &error))
            })?;
            let content = if metadata.file_type().is_symlink() {
                let target = fs::read_link(&absolute).map_err(|error| {
                    ReadDiffError::Diagnostic(Diagnostic::io("diff.readSymlink", &error))
                })?;
                path_bytes(&target)?.to_vec()
            } else {
                let mut content = Vec::new();
                fs::File::open(&absolute)
                    .map_err(|error| {
                        ReadDiffError::Diagnostic(Diagnostic::io("diff.openWorktreeFile", &error))
                    })?
                    .take(MAX_TEXT_BYTES + 1)
                    .read_to_end(&mut content)
                    .map_err(|error| {
                        ReadDiffError::Diagnostic(Diagnostic::io("diff.readWorktreeFile", &error))
                    })?;
                content
            };
            let binary = encoding::is_binary(&content);
            files.push(FileChange {
                path,
                previous_path: None,
                change: ChangeType::Untracked,
                binary,
                insertions: if binary || content.len() as u64 > MAX_TEXT_BYTES {
                    0
                } else {
                    content.split_inclusive(|byte| *byte == b'\n').count() as u64
                },
                deletions: 0,
            });
        }
    }
    ensure_not_cancelled(cancelled)?;
    Ok(files)
}

pub fn read(repository: &Path, request: DiffRequest) -> Result<FileDiff, ReadDiffError> {
    read_cancellable(repository, request, &AtomicBool::new(false))
}

pub fn read_cancellable(
    repository: &Path,
    request: DiffRequest,
    cancelled: &AtomicBool,
) -> Result<FileDiff, ReadDiffError> {
    ensure_not_cancelled(cancelled)?;
    validate_path(&request.path)?;
    let resolved = resolve_source(repository, &request.source)?;
    ensure_not_cancelled(cancelled)?;
    let path = request.path.as_bytes();
    let raw = raw_diff_for_path(repository, &resolved, &request.path, cancelled)?;
    ensure_not_cancelled(cancelled)?;
    let mut entry = parse_raw_entry(&raw.stdout, path)
        .map_err(|error| parse_error("diff.parseFileIdentity", error))?;
    if !matches!(resolved, ResolvedSource::Stash { .. })
        && entry
            .as_ref()
            .is_some_and(|entry| entry.change == ChangeType::Added)
    {
        let identity = raw_diff_with_identity(repository, &resolved, cancelled)?;
        ensure_not_cancelled(cancelled)?;
        if let Some(candidate) = parse_raw_entry(&identity.stdout, path)
            .map_err(|error| parse_error("diff.parseRenamedIdentity", error))?
        {
            if matches!(candidate.change, ChangeType::Renamed | ChangeType::Copied) {
                entry = Some(candidate);
            }
        }
    }
    // An empty historical diff means the path did not change in that commit.
    // Only a path absent from the index can be untracked in a live comparison.
    let outside_index = is_worktree_source(&resolved)
        && fs::symlink_metadata(repository.join(&request.path)).is_ok()
        && git_output_cancellable(
            repository,
            &["ls-files", "--cached", "-z", "--", &request.path],
            false,
            cancelled,
        )?
        .stdout
        .is_empty();
    let untracked = entry.is_none() && outside_index;
    let recreated = outside_index
        && matches!(resolved, ResolvedSource::WorkingRange { .. })
        && entry
            .as_ref()
            .is_some_and(|entry| entry.change == ChangeType::Deleted);

    let mut entry = entry.unwrap_or(RawEntry {
        previous_path: None,
        change: if untracked {
            ChangeType::Untracked
        } else {
            ChangeType::Unmodified
        },
        before: None,
        after: None,
    });

    if is_worktree_source(&resolved) {
        entry.after = worktree_snapshot(repository, &request.path, entry.after.as_ref())?;
        ensure_not_cancelled(cancelled)?;
    }
    if recreated {
        entry.change =
            if entry.before == entry.after {
                ChangeType::Unmodified
            } else if entry.before.as_ref().zip(entry.after.as_ref()).is_some_and(
                |(before, after)| {
                    before.mode != after.mode
                        && !matches!(
                            (before.mode, after.mode),
                            (GitFileMode::Regular, GitFileMode::Executable)
                                | (GitFileMode::Executable, GitFileMode::Regular)
                        )
                },
            ) {
                ChangeType::TypeChanged
            } else {
                ChangeType::Modified
            };
    }

    let previous_path = entry
        .previous_path
        .as_deref()
        .map(strict_path)
        .transpose()?;
    let paths = previous_path.as_ref().map_or_else(
        || vec![request.path.as_str()],
        |previous| vec![previous, &request.path],
    );
    let no_index = untracked && is_worktree_source(&resolved);
    let detect_identity = matches!(entry.change, ChangeType::Renamed | ChangeType::Copied);
    let stats = numstat(
        repository,
        &request,
        &resolved,
        &paths,
        no_index,
        detect_identity,
        cancelled,
    )?;
    ensure_not_cancelled(cancelled)?;
    let before_size = object_size(repository, entry.before.as_ref())?;
    ensure_not_cancelled(cancelled)?;
    let after_size = if is_worktree_source(&resolved) {
        worktree_size(repository, &request.path, entry.after.as_ref())?
    } else {
        object_size(repository, entry.after.as_ref())?
    };
    ensure_not_cancelled(cancelled)?;
    let precondition = DiffPrecondition {
        before: entry.before,
        after: entry.after,
    };

    let requested = request.encoding.as_deref().filter(|name| *name != "auto");
    if let Some(name) = requested {
        if encoding::canonical(name).is_none() {
            return Err(ReadDiffError::UnsupportedEncoding(name.to_owned()));
        }
    }
    let oversized = before_size.is_some_and(|size| size > MAX_TEXT_BYTES)
        || after_size.is_some_and(|size| size > MAX_TEXT_BYTES);
    let content = if oversized || stats.changed_lines > MAX_CHANGED_LINES {
        if stats.binary {
            DiffContent::Binary {
                old_size: before_size,
                new_size: after_size,
                media_type: media_type(&request.path),
            }
        } else {
            DiffContent::Text {
                hunks: Vec::new(),
                truncated: true,
                encoding: requested.and_then(encoding::canonical).unwrap_or("utf-8"),
                detected_encoding: "utf-8",
                decoding_errors: false,
                supports_partial: false,
            }
        }
    } else {
        let before = side_bytes(repository, precondition.before.as_ref(), None, cancelled)?;
        let after = side_bytes(
            repository,
            precondition.after.as_ref(),
            if is_worktree_source(&resolved) {
                Some(&request.path)
            } else {
                None
            },
            cancelled,
        )?;
        let unicode = [&before, &after].iter().any(|bytes| {
            let name = encoding::detect(bytes);
            name.starts_with("utf-16") || name.starts_with("utf-32")
        });
        if encoding::is_binary(&before) || encoding::is_binary(&after) || (stats.binary && !unicode)
        {
            DiffContent::Binary {
                old_size: before_size,
                new_size: after_size,
                media_type: media_type(&request.path),
            }
        } else {
            let old =
                encoding::decode(&before, requested).map_err(ReadDiffError::UnsupportedEncoding)?;
            let new =
                encoding::decode(&after, requested).map_err(ReadDiffError::UnsupportedEncoding)?;
            let shown = if after.is_empty() { &old } else { &new };
            // Only the original UTF-8 patch can safely be applied by Git by hunk/line.
            let supports_partial = !recreated
                && old.encoding == "utf-8"
                && new.encoding == "utf-8"
                && !old.errors
                && !new.errors
                && [&precondition.before, &precondition.after]
                    .into_iter()
                    .flatten()
                    .all(|side| {
                        matches!(side.mode, GitFileMode::Regular | GitFileMode::Executable)
                    });
            let patch = if supports_partial && !matches!(resolved, ResolvedSource::Stash { .. }) {
                patch_with_source(
                    repository,
                    &request,
                    &resolved,
                    &paths,
                    no_index,
                    detect_identity,
                    Some(cancelled),
                )?
                .stdout
            } else {
                decoded_patch(repository, &request, &old.text, &new.text, cancelled)?
            };
            let text = String::from_utf8(patch).map_err(|_| ReadDiffError::MalformedOutput)?;
            DiffContent::Text {
                hunks: parse_hunks(&text)
                    .map_err(|error| parse_error("diff.parsePatchHunks", error))?,
                truncated: false,
                encoding: shown.encoding,
                detected_encoding: shown.detected,
                decoding_errors: old.errors || new.errors,
                supports_partial,
            }
        }
    };

    Ok(FileDiff {
        path: request.path,
        previous_path,
        change: entry.change,
        source: request.source,
        precondition,
        content,
    })
}

fn side_bytes(
    repository: &Path,
    snapshot: Option<&DiffSideSnapshot>,
    worktree: Option<&str>,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, ReadDiffError> {
    let Some(snapshot) = snapshot else {
        return Ok(Vec::new());
    };
    if snapshot.mode == GitFileMode::GitLink {
        return Ok(Vec::new());
    }
    if let Some(path) = worktree {
        if snapshot.mode == GitFileMode::SymbolicLink {
            return fs::read_link(repository.join(path))
                .map(|path| path.to_string_lossy().as_bytes().to_vec())
                .map_err(|error| {
                    ReadDiffError::Diagnostic(Diagnostic::io("diff.readSymlink", &error))
                });
        }
        return fs::read(repository.join(path)).map_err(|error| {
            ReadDiffError::Diagnostic(Diagnostic::io("diff.readWorktreeFile", &error))
        });
    }
    Ok(git_output_cancellable(
        repository,
        &["cat-file", "blob", &snapshot.oid],
        false,
        cancelled,
    )?
    .stdout)
}

fn decoded_patch(
    repository: &Path,
    request: &DiffRequest,
    before: &str,
    after: &str,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, ReadDiffError> {
    let temporary = tempfile::TempDir::new().map_err(|error| {
        ReadDiffError::Diagnostic(Diagnostic::io("diff.createTemporaryDirectory", &error))
    })?;
    let old = temporary.path().join("before.txt");
    let new = temporary.path().join("after.txt");
    fs::write(&old, before).map_err(|error| {
        ReadDiffError::Diagnostic(Diagnostic::io("diff.writeTemporaryBefore", &error))
    })?;
    fs::write(&new, after).map_err(|error| {
        ReadDiffError::Diagnostic(Diagnostic::io("diff.writeTemporaryAfter", &error))
    })?;
    let context = format!(
        "--unified={}",
        request.context.unwrap_or(DEFAULT_CONTEXT).min(MAX_CONTEXT)
    );
    let mut args = vec![
        "diff",
        "--no-index",
        "--text",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        &context,
    ];
    if request.ignore_whitespace {
        args.push("--ignore-space-change");
    }
    args.extend([
        "--",
        old.to_str().ok_or(ReadDiffError::InvalidPathEncoding)?,
        new.to_str().ok_or(ReadDiffError::InvalidPathEncoding)?,
    ]);
    Ok(git_output_cancellable(repository, &args, true, cancelled)?.stdout)
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> Result<(), ReadDiffError> {
    if cancelled.load(Ordering::Relaxed) {
        Err(ReadDiffError::Cancelled)
    } else {
        Ok(())
    }
}

pub(super) fn current(
    repository: &Path,
    path: String,
    source: DiffSource,
    ignore_whitespace: bool,
) -> Result<FileDiff, ReadDiffError> {
    read(
        repository,
        DiffRequest {
            path,
            source,
            context: Some(DEFAULT_CONTEXT),
            ignore_whitespace,
            encoding: None,
        },
    )
}

fn resolve_source(repository: &Path, source: &DiffSource) -> Result<ResolvedSource, ReadDiffError> {
    match source {
        DiffSource::Worktree => Ok(ResolvedSource::Worktree),
        DiffSource::Index => Ok(ResolvedSource::Index),
        DiffSource::Commit { sha } | DiffSource::Stash { sha } => {
            let after = resolve_commit(repository, sha)?;
            if matches!(source, DiffSource::Stash { .. }) {
                return Ok(ResolvedSource::Stash { after });
            }
            let repo = gix::open(repository).map_err(|error| {
                ReadDiffError::Diagnostic(Diagnostic::cause("diff.openRepository", &error))
            })?;
            let id = gix::ObjectId::from_hex(after.as_bytes()).map_err(|error| {
                ReadDiffError::Diagnostic(Diagnostic::new("diff.parseCommitId", error))
            })?;
            let before = repo
                .find_commit(id)
                .map_err(|error| {
                    ReadDiffError::WithDiagnostic(
                        Box::new(ReadDiffError::RevisionNotFound(sha.clone())),
                        Diagnostic::cause("diff.findCommit", &error),
                    )
                })?
                .decode()
                .map_err(|error| {
                    ReadDiffError::Diagnostic(Diagnostic::cause("diff.decodeCommit", &error))
                })?
                .parents()
                .next()
                .map(|parent| parent.to_string());
            Ok(ResolvedSource::Commit { before, after })
        }
        DiffSource::Range { from, to } => Ok(ResolvedSource::Range {
            before: match from {
                Some(from) => resolve_commit(repository, from)?,
                None => output_text(&git_output(
                    repository,
                    &["hash-object", "-t", "tree", "--stdin"],
                    false,
                )?)?,
            },
            after: resolve_commit(repository, to)?,
        }),
        DiffSource::WorkingRange { from } => Ok(ResolvedSource::WorkingRange {
            before: resolve_commit(repository, from)?,
        }),
    }
}

fn is_worktree_source(source: &ResolvedSource) -> bool {
    matches!(
        source,
        ResolvedSource::Worktree | ResolvedSource::WorkingRange { .. }
    )
}

fn resolve_commit(repository: &Path, revision: &str) -> Result<String, ReadDiffError> {
    let commit = format!("{revision}^{{commit}}");
    let output =
        git_output(repository, &["rev-parse", "--verify", &commit], false).map_err(|error| {
            match error {
                ReadDiffError::Diagnostic(diagnostic) => ReadDiffError::WithDiagnostic(
                    Box::new(ReadDiffError::RevisionNotFound(revision.to_owned())),
                    diagnostic,
                ),
                error => error,
            }
        })?;
    output_text(&output)
}

pub(super) fn validate_path(path: &str) -> Result<(), ReadDiffError> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ReadDiffError::InvalidPath);
    }
    Ok(())
}

fn raw_diff_for_path(
    repository: &Path,
    source: &ResolvedSource,
    path: &str,
    cancelled: &AtomicBool,
) -> Result<Output, ReadDiffError> {
    if matches!(source, ResolvedSource::Stash { .. }) {
        // Git combines the tracked tree and untracked parent before deciding
        // identity. Comparing only the third parent invents tracked deletions
        // and false renames. Stash show has no pathspec; select by raw -z below.
        return raw_diff_with_identity(repository, source, cancelled);
    }
    let mut args = diff_args(source, "--raw");
    args.extend([
        "-z".to_owned(),
        "--abbrev=64".to_owned(),
        "--".to_owned(),
        path.to_owned(),
    ]);
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    git_output_cancellable(repository, &borrowed, false, cancelled)
}

fn raw_diff_with_identity(
    repository: &Path,
    source: &ResolvedSource,
    cancelled: &AtomicBool,
) -> Result<Output, ReadDiffError> {
    let mut args = diff_args(source, "--raw");
    args.extend([
        "-z".to_owned(),
        "--abbrev=64".to_owned(),
        "--find-renames".to_owned(),
        "--find-copies".to_owned(),
    ]);
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    git_output_cancellable(repository, &borrowed, false, cancelled)
}

fn patch_with_source(
    repository: &Path,
    request: &DiffRequest,
    source: &ResolvedSource,
    paths: &[&str],
    no_index: bool,
    detect_identity: bool,
    cancelled: Option<&AtomicBool>,
) -> Result<Output, ReadDiffError> {
    let context = request.context.unwrap_or(DEFAULT_CONTEXT).min(MAX_CONTEXT);
    let unified = format!("--unified={context}");
    let mut owned = if no_index {
        vec!["diff".to_owned()]
    } else {
        diff_args(source, "--patch")
    };
    if no_index {
        owned.push("--no-index".to_owned());
        owned.push("--patch".to_owned());
    }
    owned.extend([
        "--no-ext-diff".to_owned(),
        "--no-textconv".to_owned(),
        "--no-color".to_owned(),
        "--no-prefix".to_owned(),
        unified,
    ]);
    if detect_identity {
        owned.extend(["--find-renames".to_owned(), "--find-copies".to_owned()]);
    }
    if request.ignore_whitespace {
        owned.push("--ignore-space-change".to_owned());
    }
    owned.push("--".to_owned());
    if no_index {
        owned.push("/dev/null".to_owned());
    }
    owned.extend(paths.iter().map(|path| (*path).to_owned()));
    let args = owned.iter().map(String::as_str).collect::<Vec<_>>();
    match cancelled {
        Some(cancelled) => git_output_cancellable(repository, &args, no_index, cancelled),
        None => git_output(repository, &args, no_index),
    }
}

fn numstat(
    repository: &Path,
    request: &DiffRequest,
    source: &ResolvedSource,
    paths: &[&str],
    no_index: bool,
    detect_identity: bool,
    cancelled: &AtomicBool,
) -> Result<NumStat, ReadDiffError> {
    let mut owned = if no_index {
        vec!["diff".to_owned()]
    } else {
        diff_args(source, "--numstat")
    };
    if no_index {
        owned.push("--no-index".to_owned());
        owned.push("--numstat".to_owned());
    }
    owned.extend([
        "-z".to_owned(),
        "--no-ext-diff".to_owned(),
        "--no-textconv".to_owned(),
    ]);
    if detect_identity {
        owned.extend(["--find-renames".to_owned(), "--find-copies".to_owned()]);
    }
    if request.ignore_whitespace {
        owned.push("--ignore-space-change".to_owned());
    }
    owned.push("--".to_owned());
    if no_index {
        owned.push("/dev/null".to_owned());
    }
    if !matches!(source, ResolvedSource::Stash { .. }) {
        owned.extend(paths.iter().map(|path| (*path).to_owned()));
    }
    let args = owned.iter().map(String::as_str).collect::<Vec<_>>();
    let output = git_output_cancellable(repository, &args, no_index, cancelled)?;
    if matches!(source, ResolvedSource::Stash { .. }) {
        let stats = parse_file_stats(&output.stdout)?
            .get(request.path.as_bytes())
            .copied()
            .unwrap_or_default();
        return Ok(NumStat {
            binary: stats.binary,
            changed_lines: stats.insertions + stats.deletions,
        });
    }
    parse_numstat(&output.stdout).map_err(|error| parse_error("diff.parseNumstat", error))
}

fn diff_args(source: &ResolvedSource, format: &str) -> Vec<String> {
    match source {
        ResolvedSource::Worktree => vec!["diff".to_owned(), format.to_owned()],
        ResolvedSource::Index => vec!["diff".to_owned(), "--cached".to_owned(), format.to_owned()],
        ResolvedSource::Stash { after, .. } => vec![
            "stash".to_owned(),
            "show".to_owned(),
            "--include-untracked".to_owned(),
            format.to_owned(),
            after.clone(),
        ],
        ResolvedSource::Commit {
            before: Some(before),
            after,
        }
        | ResolvedSource::Range { before, after } => vec![
            "diff".to_owned(),
            format.to_owned(),
            before.clone(),
            after.clone(),
        ],
        ResolvedSource::WorkingRange { before } => {
            vec!["diff".to_owned(), format.to_owned(), before.clone()]
        }
        ResolvedSource::Commit {
            before: None,
            after,
        } => vec![
            "diff-tree".to_owned(),
            "--root".to_owned(),
            "-r".to_owned(),
            "--no-commit-id".to_owned(),
            format.to_owned(),
            after.clone(),
        ],
    }
}

fn git_output(
    repository: &Path,
    args: &[&str],
    one_is_success: bool,
) -> Result<Output, ReadDiffError> {
    let output = git_command(repository)
        .args(args)
        .output()
        .map_err(|error| {
            ReadDiffError::Diagnostic(Diagnostic::command_io("diff.command", args, &error))
        })?;
    if output.status.success() || (one_is_success && output.status.code() == Some(1)) {
        Ok(output)
    } else {
        Err(ReadDiffError::Diagnostic(Diagnostic::command(
            "diff.command",
            args,
            &output,
        )))
    }
}

fn git_output_cancellable(
    repository: &Path,
    args: &[&str],
    one_is_success: bool,
    cancelled: &AtomicBool,
) -> Result<Output, ReadDiffError> {
    ensure_not_cancelled(cancelled)?;
    let mut child = git_command(repository)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ReadDiffError::Diagnostic(Diagnostic::command_io("diff.command", args, &error))
        })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ReadDiffError::Diagnostic(Diagnostic::new(
            "diff.stdoutPipe",
            "Git stdout pipe was unavailable",
        ))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        ReadDiffError::Diagnostic(Diagnostic::new(
            "diff.stderrPipe",
            "Git stderr pipe was unavailable",
        ))
    })?;
    let stdout_reader = thread::spawn(move || read_all(stdout, "diff.readStdout"));
    let stderr_reader = thread::spawn(move || read_all(stderr, "diff.readStderr"));

    let status = loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(ReadDiffError::Cancelled);
        }
        match child.try_wait().map_err(|error| {
            ReadDiffError::Diagnostic(Diagnostic::command_io("diff.waitCommand", args, &error))
        })? {
            Some(status) => break status,
            None => thread::sleep(Duration::from_millis(5)),
        }
    };

    let stdout = stdout_reader.join().map_err(|_| {
        ReadDiffError::Diagnostic(Diagnostic::new(
            "diff.joinOutputReader",
            "Git output reader terminated unexpectedly",
        ))
    })??;
    let stderr = stderr_reader.join().map_err(|_| {
        ReadDiffError::Diagnostic(Diagnostic::new(
            "diff.joinOutputReader",
            "Git output reader terminated unexpectedly",
        ))
    })??;
    let output = Output {
        status,
        stdout,
        stderr,
    };
    if output.status.success() || (one_is_success && output.status.code() == Some(1)) {
        Ok(output)
    } else {
        Err(ReadDiffError::Diagnostic(Diagnostic::command(
            "diff.command",
            args,
            &output,
        )))
    }
}

fn read_all(mut reader: impl Read, stage: &str) -> Result<Vec<u8>, ReadDiffError> {
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|error| ReadDiffError::Diagnostic(Diagnostic::io(stage, &error)))?;
    Ok(bytes)
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

fn parse_error(stage: &str, error: ReadDiffError) -> ReadDiffError {
    match error {
        ReadDiffError::MalformedOutput => ReadDiffError::WithDiagnostic(
            Box::new(ReadDiffError::MalformedOutput),
            Diagnostic::new(stage, "Git returned malformed structured output"),
        ),
        error => error,
    }
}

fn parse_raw_entry(bytes: &[u8], wanted: &[u8]) -> Result<Option<RawEntry>, ReadDiffError> {
    Ok(collect_raw_entries(bytes)?
        .into_iter()
        .find_map(|(path, entry)| (path == wanted).then_some(entry)))
}

fn collect_raw_entries(bytes: &[u8]) -> Result<Vec<(Vec<u8>, RawEntry)>, ReadDiffError> {
    let fields = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut index = 0;
    let mut entries = Vec::new();
    while index < fields.len() && !fields[index].is_empty() {
        let header = fields[index];
        index += 1;
        if header.first() != Some(&b':') {
            return Err(ReadDiffError::MalformedOutput);
        }
        let parts = header[1..].split(|byte| *byte == b' ').collect::<Vec<_>>();
        if parts.len() != 5 {
            return Err(ReadDiffError::MalformedOutput);
        }
        let status = parts[4];
        let code = *status.first().ok_or(ReadDiffError::MalformedOutput)?;
        let first_path = *fields.get(index).ok_or(ReadDiffError::MalformedOutput)?;
        index += 1;
        let (previous_path, destination) = if matches!(code, b'R' | b'C') {
            let destination = *fields.get(index).ok_or(ReadDiffError::MalformedOutput)?;
            index += 1;
            (Some(first_path.to_vec()), destination)
        } else {
            (None, first_path)
        };
        entries.push((
            destination.to_vec(),
            RawEntry {
                previous_path,
                change: change_type(code)?,
                before: snapshot(parts[2], parts[0])?,
                after: snapshot(parts[3], parts[1])?,
            },
        ));
    }
    Ok(entries)
}

fn parse_file_stats(bytes: &[u8]) -> Result<HashMap<Vec<u8>, FileStats>, ReadDiffError> {
    let fields = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut stats = HashMap::new();
    let mut index = 0;
    while index < fields.len() && !fields[index].is_empty() {
        let mut parts = fields[index].splitn(3, |byte| *byte == b'\t');
        index += 1;
        let added = parts.next().ok_or(ReadDiffError::MalformedOutput)?;
        let removed = parts.next().ok_or(ReadDiffError::MalformedOutput)?;
        let inline = parts.next().ok_or(ReadDiffError::MalformedOutput)?;
        let path = if inline.is_empty() {
            let destination = fields
                .get(index + 1)
                .ok_or(ReadDiffError::MalformedOutput)?;
            index += 2;
            *destination
        } else {
            inline
        };
        let binary = added == b"-" && removed == b"-";
        stats.insert(
            path.to_vec(),
            FileStats {
                binary,
                insertions: if binary { 0 } else { parse_u64(added)? },
                deletions: if binary { 0 } else { parse_u64(removed)? },
            },
        );
    }
    Ok(stats)
}

fn snapshot(oid: &[u8], mode: &[u8]) -> Result<Option<DiffSideSnapshot>, ReadDiffError> {
    if oid.iter().all(|byte| *byte == b'0') || mode == b"000000" {
        return Ok(None);
    }
    Ok(Some(DiffSideSnapshot {
        oid: String::from_utf8(oid.to_vec()).map_err(|_| ReadDiffError::MalformedOutput)?,
        mode: parse_mode(mode)?,
    }))
}

fn parse_mode(mode: &[u8]) -> Result<GitFileMode, ReadDiffError> {
    match mode {
        b"100644" => Ok(GitFileMode::Regular),
        b"100755" => Ok(GitFileMode::Executable),
        b"120000" => Ok(GitFileMode::SymbolicLink),
        b"160000" => Ok(GitFileMode::GitLink),
        _ => Err(ReadDiffError::MalformedOutput),
    }
}

fn change_type(code: u8) -> Result<ChangeType, ReadDiffError> {
    match code {
        b'A' => Ok(ChangeType::Added),
        b'M' => Ok(ChangeType::Modified),
        b'D' => Ok(ChangeType::Deleted),
        b'R' => Ok(ChangeType::Renamed),
        b'C' => Ok(ChangeType::Copied),
        b'T' => Ok(ChangeType::TypeChanged),
        b'U' => Ok(ChangeType::Conflicted),
        _ => Err(ReadDiffError::MalformedOutput),
    }
}

fn worktree_snapshot(
    repository: &Path,
    path: &str,
    raw: Option<&DiffSideSnapshot>,
) -> Result<Option<DiffSideSnapshot>, ReadDiffError> {
    let absolute = repository.join(path);
    let Ok(metadata) = fs::symlink_metadata(&absolute) else {
        return Ok(None);
    };
    let mode = raw
        .map(|snapshot| snapshot.mode)
        .unwrap_or_else(|| mode_of(&metadata));
    let oid = match mode {
        GitFileMode::SymbolicLink => {
            let target = fs::read_link(&absolute).map_err(|error| {
                ReadDiffError::Diagnostic(Diagnostic::io("diff.readSymlink", &error))
            })?;
            hash_bytes(repository, path_bytes(&target)?)?
        }
        GitFileMode::GitLink => {
            let output = git_output(&absolute, &["rev-parse", "--verify", "HEAD"], false)?;
            output_text(&output)?
        }
        GitFileMode::Regular | GitFileMode::Executable => {
            let path_option = format!("--path={path}");
            let output = git_output(
                repository,
                &["hash-object", &path_option, "--", path],
                false,
            )?;
            output_text(&output)?
        }
    };
    Ok(Some(DiffSideSnapshot { oid, mode }))
}

fn mode_of(metadata: &fs::Metadata) -> GitFileMode {
    if metadata.file_type().is_symlink() {
        return GitFileMode::SymbolicLink;
    }
    if metadata.is_dir() {
        return GitFileMode::GitLink;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 != 0 {
            return GitFileMode::Executable;
        }
    }
    GitFileMode::Regular
}

fn path_bytes(path: &Path) -> Result<&[u8], ReadDiffError> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        Ok(path.as_os_str().as_bytes())
    }
    #[cfg(not(unix))]
    {
        path.to_str()
            .map(str::as_bytes)
            .ok_or(ReadDiffError::InvalidPathEncoding)
    }
}

fn hash_bytes(repository: &Path, bytes: &[u8]) -> Result<String, ReadDiffError> {
    let args = ["hash-object", "--stdin"];
    let mut child = git_command(repository)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ReadDiffError::Diagnostic(Diagnostic::command_io("diff.hashObject", &args, &error))
        })?;
    let write = child
        .stdin
        .take()
        .ok_or_else(|| {
            ReadDiffError::Diagnostic(Diagnostic::new(
                "diff.hashObjectStdin",
                "Git stdin pipe was unavailable",
            ))
        })?
        .write_all(bytes);
    if let Err(error) = write {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ReadDiffError::Diagnostic(Diagnostic::command_io(
            "diff.writeHashInput",
            &args,
            &error,
        )));
    }
    let output = child.wait_with_output().map_err(|error| {
        ReadDiffError::Diagnostic(Diagnostic::command_io("diff.waitHashObject", &args, &error))
    })?;
    if !output.status.success() {
        return Err(ReadDiffError::Diagnostic(Diagnostic::command(
            "diff.hashObject",
            &args,
            &output,
        )));
    }
    output_text(&output)
}

fn output_text(output: &Output) -> Result<String, ReadDiffError> {
    let value = std::str::from_utf8(&output.stdout)
        .map(str::trim)
        .map_err(|error| {
            ReadDiffError::WithDiagnostic(
                Box::new(ReadDiffError::MalformedOutput),
                Diagnostic::new("diff.parseOutput", error),
            )
        })?;
    if value.is_empty() {
        Err(ReadDiffError::WithDiagnostic(
            Box::new(ReadDiffError::MalformedOutput),
            Diagnostic::new(
                "diff.parseOutput",
                "Git returned an empty object identifier",
            ),
        ))
    } else {
        Ok(value.to_owned())
    }
}

fn object_size(
    repository: &Path,
    snapshot: Option<&DiffSideSnapshot>,
) -> Result<Option<u64>, ReadDiffError> {
    let Some(snapshot) = snapshot else {
        return Ok(None);
    };
    let output = git_output(repository, &["cat-file", "-s", &snapshot.oid], false)?;
    Ok(Some(
        output_text(&output)?
            .parse()
            .map_err(|_| ReadDiffError::MalformedOutput)?,
    ))
}

fn worktree_size(
    repository: &Path,
    path: &str,
    snapshot: Option<&DiffSideSnapshot>,
) -> Result<Option<u64>, ReadDiffError> {
    let Some(snapshot) = snapshot else {
        return Ok(None);
    };
    if snapshot.mode == GitFileMode::GitLink {
        return object_size(repository, Some(snapshot));
    }
    fs::symlink_metadata(repository.join(path))
        .map(|metadata| Some(metadata.len()))
        .map_err(|error| {
            ReadDiffError::Diagnostic(Diagnostic::io("diff.inspectWorktreeSize", &error))
        })
}

fn parse_numstat(bytes: &[u8]) -> Result<NumStat, ReadDiffError> {
    let header = bytes.split(|byte| *byte == 0).next().unwrap_or_default();
    if header.is_empty() {
        return Ok(NumStat::default());
    }
    let mut parts = header.splitn(3, |byte| *byte == b'\t');
    let added = parts.next().ok_or(ReadDiffError::MalformedOutput)?;
    let deleted = parts.next().ok_or(ReadDiffError::MalformedOutput)?;
    let _path = parts.next().ok_or(ReadDiffError::MalformedOutput)?;
    if added == b"-" && deleted == b"-" {
        return Ok(NumStat {
            binary: true,
            changed_lines: 0,
        });
    }
    Ok(NumStat {
        binary: false,
        changed_lines: parse_u64(added)? + parse_u64(deleted)?,
    })
}

fn parse_hunks(patch: &str) -> Result<Vec<Hunk>, ReadDiffError> {
    let lines = patch.split_terminator('\n').collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let Some(header) = lines[index].strip_prefix("@@ -") else {
            index += 1;
            continue;
        };
        let (old_start, old_lines, new_start, new_lines, context) = parse_hunk_header(header)?;
        index += 1;
        let mut old_line = old_start;
        let mut new_line = new_start;
        let mut old_seen = 0;
        let mut new_seen = 0;
        let mut body = Vec::new();
        while old_seen < old_lines || new_seen < new_lines {
            let line = *lines.get(index).ok_or(ReadDiffError::MalformedOutput)?;
            index += 1;
            let (kind, raw_text, old_number, new_number) = match line.as_bytes().first().copied() {
                Some(b' ') => {
                    let numbers = (Some(old_line), Some(new_line));
                    old_line += 1;
                    new_line += 1;
                    old_seen += 1;
                    new_seen += 1;
                    (DiffLineKind::Context, &line[1..], numbers.0, numbers.1)
                }
                Some(b'-') => {
                    let number = old_line;
                    old_line += 1;
                    old_seen += 1;
                    (DiffLineKind::Removed, &line[1..], Some(number), None)
                }
                Some(b'+') => {
                    let number = new_line;
                    new_line += 1;
                    new_seen += 1;
                    (DiffLineKind::Added, &line[1..], None, Some(number))
                }
                Some(b'\\') => continue,
                _ => return Err(ReadDiffError::MalformedOutput),
            };
            let (text, ending) = raw_text
                .strip_suffix('\r')
                .map_or((raw_text, LineEnding::Lf), |text| (text, LineEnding::CrLf));
            body.push(DiffLine {
                kind,
                old_line: old_number,
                new_line: new_number,
                text: text.to_owned(),
                words: Vec::new(),
                no_newline: false,
                ending,
            });

            if lines
                .get(index)
                .is_some_and(|line| line.starts_with("\\ No newline"))
            {
                if let Some(last) = body.last_mut() {
                    last.no_newline = true;
                }
                index += 1;
            }
        }
        annotate_words(&mut body);
        let number = result.len();
        result.push(Hunk {
            id: format!("hunk-{old_start}-{old_lines}-{new_start}-{new_lines}-{number}"),
            old_start,
            old_lines,
            new_start,
            new_lines,
            header: context,
            lines: body,
        });
    }
    Ok(result)
}

fn parse_hunk_header(header: &str) -> Result<(u64, u64, u64, u64, String), ReadDiffError> {
    let (ranges, context) = header
        .split_once(" @@")
        .ok_or(ReadDiffError::MalformedOutput)?;
    let (old, new) = ranges
        .split_once(" +")
        .ok_or(ReadDiffError::MalformedOutput)?;
    let (old_start, old_lines) = parse_range(old)?;
    let (new_start, new_lines) = parse_range(new)?;
    Ok((
        old_start,
        old_lines,
        new_start,
        new_lines,
        context.trim().to_owned(),
    ))
}

fn parse_range(range: &str) -> Result<(u64, u64), ReadDiffError> {
    match range.split_once(',') {
        Some((start, lines)) => Ok((parse_u64(start.as_bytes())?, parse_u64(lines.as_bytes())?)),
        None => Ok((parse_u64(range.as_bytes())?, 1)),
    }
}

fn parse_u64(bytes: &[u8]) -> Result<u64, ReadDiffError> {
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or(ReadDiffError::MalformedOutput)
}

fn annotate_words(lines: &mut [DiffLine]) {
    let mut index = 0;
    while index < lines.len() {
        if !matches!(lines[index].kind, DiffLineKind::Removed) {
            index += 1;
            continue;
        }
        let removed_start = index;
        while index < lines.len() && matches!(lines[index].kind, DiffLineKind::Removed) {
            index += 1;
        }
        let added_start = index;
        while index < lines.len() && matches!(lines[index].kind, DiffLineKind::Added) {
            index += 1;
        }
        let pairs = (added_start - removed_start).min(index - added_start);
        for offset in 0..pairs {
            let old_index = removed_start + offset;
            let new_index = added_start + offset;
            let (left, right) = lines.split_at_mut(new_index);
            if let Some((old_span, new_span)) = changed_spans(&left[old_index].text, &right[0].text)
            {
                left[old_index].words.push(old_span);
                right[0].words.push(new_span);
            }
        }
    }
}

fn changed_spans(old: &str, new: &str) -> Option<(WordSpan, WordSpan)> {
    let old_chars = old.chars().collect::<Vec<_>>();
    let new_chars = new.chars().collect::<Vec<_>>();
    let mut prefix = 0;
    while prefix < old_chars.len()
        && prefix < new_chars.len()
        && old_chars[prefix] == new_chars[prefix]
    {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old_chars.len().saturating_sub(prefix)
        && suffix < new_chars.len().saturating_sub(prefix)
        && old_chars[old_chars.len() - 1 - suffix] == new_chars[new_chars.len() - 1 - suffix]
    {
        suffix += 1;
    }
    if prefix == old_chars.len() && prefix == new_chars.len() {
        return None;
    }
    let utf16 = |chars: &[char]| chars.iter().map(|character| character.len_utf16()).sum();
    Some((
        WordSpan {
            start: utf16(&old_chars[..prefix]),
            end: utf16(&old_chars[..old_chars.len() - suffix]),
        },
        WordSpan {
            start: utf16(&new_chars[..prefix]),
            end: utf16(&new_chars[..new_chars.len() - suffix]),
        },
    ))
}

fn strict_path(bytes: &[u8]) -> Result<String, ReadDiffError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| ReadDiffError::InvalidPathEncoding)
}

pub(super) fn media_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("zip") => "application/zip",
        Some("gz") => "application/gzip",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::sync::atomic::AtomicBool;

    use tempfile::TempDir;

    use super::{
        read, read_cancellable, read_files_cancellable, ChangeType, DiffContent, DiffLineKind,
        DiffRequest, DiffSource, GitFileMode, ReadDiffError,
    };

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

    #[test]
    fn cancela_antes_de_iniciar_un_diff_obsoleto() {
        let temporary = repository();
        let cancelled = AtomicBool::new(true);

        assert!(matches!(
            read_cancellable(
                temporary.path(),
                request("archivo.txt", DiffSource::Worktree),
                &cancelled,
            ),
            Err(ReadDiffError::Cancelled)
        ));
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

    fn git_text(repository: &Path, args: &[&str]) -> String {
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
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn request(path: &str, source: DiffSource) -> DiffRequest {
        DiffRequest {
            path: path.to_owned(),
            source,
            context: Some(1),
            ignore_whitespace: false,
            encoding: None,
        }
    }

    #[test]
    fn stash_untracked_files_read_their_saved_blobs_and_pop_restores_every_side() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "base\n").unwrap();
        fs::write(path.join("deleted.txt"), "deleted base\n").unwrap();
        fs::write(path.join("keep.txt"), "same\n").unwrap();
        fs::write(path.join("old-name.txt"), "rename base\n").unwrap();
        fs::write(path.join(".gitignore"), "ignored.txt\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-qm", "base"]);
        fs::write(path.join("tracked.txt"), "staged\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        fs::write(path.join("tracked.txt"), "working\n").unwrap();
        fs::remove_file(path.join("deleted.txt")).unwrap();
        git(path, &["mv", "old-name.txt", "renamed.txt"]);
        fs::write(path.join("ignored.txt"), "must stay\n").unwrap();
        fs::create_dir(path.join("folder")).unwrap();
        let new_files: &[(&str, &[u8])] = &[
            ("folder/nuevo [1].txt", b"new text\nsecond line"),
            ("empty.txt", b""),
            ("copy.txt", b"same\n"),
            ("image.png", b"\x89PNG\0\x01\x02\x03"),
            ("utf16.txt", b"\xff\xfeh\0o\0l\0a\0\n\0"),
        ];
        for (name, bytes) in new_files {
            fs::write(path.join(name), bytes).unwrap();
        }
        let options = serde_json::from_value(serde_json::json!({
            "includeUntracked": true,
            "precondition": super::super::status::reset_precondition(path),
        }))
        .unwrap();
        let undo = super::super::undo::UndoStacks::default();
        crate::git::create_stash_with_recovery("fixture", path, &undo, "saved", &options).unwrap();
        let sha = git_text(path, &["rev-parse", "refs/stash"]);
        let source = DiffSource::Stash { sha: sha.clone() };
        assert_eq!(git_text(path, &["status", "--porcelain"]), "");
        assert!(path.join("ignored.txt").exists());
        assert_eq!(git_text(path, &["stash", "list"]).lines().count(), 1);
        let files = read_files_cancellable(path, &source, &AtomicBool::new(false)).unwrap();
        assert_eq!(files.len(), new_files.len() + 3);

        for (name, bytes) in new_files {
            assert!(!path.join(name).exists());
            assert!(files
                .iter()
                .any(|file| file.path == *name && file.change == ChangeType::Added));
            let saved = read(path, request(name, source.clone())).unwrap();
            assert_eq!(saved.change, ChangeType::Added, "{name}");
            assert_eq!(saved.precondition.before, None);
            let blob = saved.precondition.after.as_ref().unwrap();
            assert_eq!(
                super::git_output(path, &["cat-file", "blob", &blob.oid], false)
                    .unwrap()
                    .stdout,
                *bytes
            );
            let contents =
                super::super::files::read_blob_encoded(path, (*name).into(), &blob.oid, None)
                    .unwrap();
            let contents = serde_json::to_value(contents).unwrap();
            assert_eq!(contents["size"], bytes.len());
            match (&saved.content, *name) {
                (
                    DiffContent::Binary {
                        old_size, new_size, ..
                    },
                    "image.png",
                ) => {
                    assert_eq!(*old_size, None);
                    assert_eq!(*new_size, Some(bytes.len() as u64));
                    assert_eq!(contents["binary"], true);
                }
                (DiffContent::Text { hunks, .. }, "empty.txt") => assert!(hunks.is_empty()),
                (
                    DiffContent::Text {
                        encoding, hunks, ..
                    },
                    "utf16.txt",
                ) => {
                    assert_eq!(*encoding, "utf-16le");
                    assert_eq!(contents["text"], "hola\n");
                    assert!(!hunks.is_empty());
                }
                (DiffContent::Text { hunks, .. }, _) => assert!(!hunks.is_empty()),
                other => panic!("unexpected stash content: {other:?}"),
            }
            // Today's disk contents cannot replace the immutable saved version.
            fs::create_dir_all(path.join(name).parent().unwrap()).unwrap();
            fs::write(path.join(name), b"later content\n").unwrap();
            let again = read(path, request(name, source.clone())).unwrap();
            assert_eq!(again.precondition, saved.precondition);
            assert_eq!(
                serde_json::to_value(again.content).unwrap(),
                serde_json::to_value(saved.content).unwrap()
            );
            fs::remove_file(path.join(name)).unwrap();
        }
        let tracked = read(path, request("tracked.txt", source.clone())).unwrap();
        assert_eq!(tracked.change, ChangeType::Modified);
        let renamed = read(path, request("renamed.txt", source.clone())).unwrap();
        assert_eq!(renamed.change, ChangeType::Renamed);
        assert_eq!(renamed.previous_path.as_deref(), Some("old-name.txt"));
        assert_eq!(
            read(path, request("deleted.txt", source)).unwrap().change,
            ChangeType::Deleted
        );
        let pop = serde_json::from_value(serde_json::json!({
            "drop": true,
            "expectedStash": sha,
            "precondition": super::super::status::reset_precondition(path),
        }))
        .unwrap();
        crate::git::apply_stash_with_recovery("fixture", path, &undo, 0, &pop).unwrap();
        for (name, bytes) in new_files {
            assert_eq!(fs::read(path.join(name)).unwrap(), *bytes);
        }
        assert_eq!(
            fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "working\n"
        );
        assert_eq!(git_text(path, &["show", ":tracked.txt"]), "staged");
        assert!(!path.join("deleted.txt").exists());
        assert!(!path.join("old-name.txt").exists());
        assert_eq!(
            fs::read_to_string(path.join("renamed.txt")).unwrap(),
            "rename base\n"
        );
        assert_eq!(git_text(path, &["stash", "list"]), "");
        assert_eq!(
            read(path, request("copy.txt", DiffSource::Stash { sha }))
                .unwrap()
                .change,
            ChangeType::Added
        );
    }

    #[test]
    fn tracked_only_stash_keeps_normal_commit_diff_semantics() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "base\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-qm", "base"]);
        fs::write(path.join("tracked.txt"), "saved\n").unwrap();
        git(path, &["stash", "push", "-qm", "tracked only"]);
        let sha = git_text(path, &["rev-parse", "refs/stash"]);
        let stash = read(
            path,
            request("tracked.txt", DiffSource::Stash { sha: sha.clone() }),
        )
        .unwrap();
        let commit = read(path, request("tracked.txt", DiffSource::Commit { sha })).unwrap();
        assert_eq!(stash.precondition, commit.precondition);
        assert_eq!(
            serde_json::to_value(stash.content).unwrap(),
            serde_json::to_value(commit.content).unwrap()
        );
    }

    fn commit_all(path: &Path, message: &str) -> String {
        git(path, &["add", "--all"]);
        git(path, &["commit", "--quiet", "-m", message]);
        git_text(path, &["rev-parse", "HEAD"])
    }

    #[test]
    fn comparison_of_recommitted_merged_branch_has_no_files_when_trees_match() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("app.txt"), "base\n").unwrap();
        let base = commit_all(path, "base");
        git(path, &["switch", "--quiet", "-c", "dev"]);
        git(path, &["switch", "--quiet", "-c", "feature"]);
        fs::write(path.join("app.txt"), "feature one\n").unwrap();
        commit_all(path, "one");
        fs::write(path.join("added.txt"), "feature two\n").unwrap();
        commit_all(path, "two");
        fs::write(path.join("app.txt"), "feature three\n").unwrap();
        let feature = commit_all(path, "three");
        git(path, &["switch", "--quiet", "dev"]);
        git(
            path,
            &["merge", "--quiet", "--no-ff", "feature", "-m", "merge"],
        );
        git(path, &["reset", "--soft", &base]);
        let dev = commit_all(path, "recommit WIP");
        assert_ne!(dev, feature);
        assert_eq!(
            git_text(path, &["rev-parse", "dev^{tree}"]),
            git_text(path, &["rev-parse", "feature^{tree}"])
        );
        assert!(git_text(path, &["diff", "--name-only", "dev", "feature", "--"]).is_empty());
        for (from, to) in [("dev", "feature"), ("feature", "dev")] {
            assert!(read_files_cancellable(
                path,
                &DiffSource::Range {
                    from: Some(from.into()),
                    to: to.into()
                },
                &AtomicBool::new(false)
            )
            .unwrap()
            .is_empty());
        }
    }

    #[test]
    fn comparison_lists_net_file_identity_statistics_and_modes_in_both_directions() {
        let temporary = repository();
        let path = temporary.path();
        for (file, content) in [
            ("old name.txt", "rename me\n"),
            ("deleted.txt", "old\nline\n"),
            ("modified.txt", "before\n"),
            ("script.sh", "echo fixture\n"),
        ] {
            fs::write(path.join(file), content).unwrap();
        }
        fs::write(path.join("asset.bin"), [0, 1, 2]).unwrap();
        let base = commit_all(path, "base");
        git(path, &["mv", "old name.txt", "new name.txt"]);
        fs::remove_file(path.join("deleted.txt")).unwrap();
        fs::write(path.join("modified.txt"), "after\nmore\n").unwrap();
        fs::write(path.join("added.txt"), "brand new\nanother addition\n").unwrap();
        fs::write(path.join("asset.bin"), [0, 4, 5]).unwrap();
        git(path, &["add", "--all"]);
        git(path, &["update-index", "--chmod=+x", "script.sh"]);
        git(path, &["commit", "--quiet", "-m", "changed"]);
        let head = git_text(path, &["rev-parse", "HEAD"]);
        let forward = DiffSource::Range {
            from: Some(base.clone()),
            to: head.clone(),
        };
        let files = read_files_cancellable(path, &forward, &AtomicBool::new(false)).unwrap();
        assert_eq!(files.len(), 6);
        let renamed = files
            .iter()
            .find(|file| file.path == "new name.txt")
            .unwrap();
        assert_eq!(renamed.previous_path.as_deref(), Some("old name.txt"));
        assert_eq!(renamed.change, ChangeType::Renamed);
        assert_eq!((renamed.insertions, renamed.deletions), (0, 0));
        let modified = files
            .iter()
            .find(|file| file.path == "modified.txt")
            .unwrap();
        assert_eq!((modified.insertions, modified.deletions), (2, 1));
        assert!(files
            .iter()
            .any(|file| file.path == "asset.bin" && file.binary));
        let mode = files.iter().find(|file| file.path == "script.sh").unwrap();
        assert_eq!(mode.change, ChangeType::Modified);
        assert_eq!((mode.insertions, mode.deletions), (0, 0));
        for file in &files {
            let diff = read(path, request(&file.path, forward.clone())).unwrap();
            assert_eq!(diff.change, file.change);
            assert_eq!(diff.previous_path, file.previous_path);
        }
        let reverse = read_files_cancellable(
            path,
            &DiffSource::Range {
                from: Some(head),
                to: base,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(reverse
            .iter()
            .any(|file| file.path == "added.txt" && file.change == ChangeType::Deleted));
        assert!(reverse
            .iter()
            .any(|file| file.path == "deleted.txt" && file.change == ChangeType::Added));
        assert!(reverse.iter().any(|file| file.path == "old name.txt"
            && file.change == ChangeType::Renamed
            && file.previous_path.as_deref() == Some("new name.txt")));
    }

    #[test]
    fn combined_root_range_starts_with_an_empty_tree_and_omits_transient_changes() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("root.txt"), "root\n").unwrap();
        commit_all(path, "root");
        fs::write(path.join("transient.txt"), "temporary\n").unwrap();
        commit_all(path, "add temporary");
        fs::remove_file(path.join("transient.txt")).unwrap();
        fs::write(path.join("last.txt"), "last\n").unwrap();
        let last = commit_all(path, "last");
        let source = DiffSource::Range {
            from: None,
            to: last,
        };
        let files = read_files_cancellable(path, &source, &AtomicBool::new(false)).unwrap();
        assert_eq!(
            files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["last.txt", "root.txt"]
        );
        assert!(files.iter().all(|file| file.change == ChangeType::Added));
        let root = read(path, request("root.txt", source)).unwrap();
        assert!(root.precondition.before.is_none());
        assert_eq!(root.change, ChangeType::Added);
    }

    #[test]
    fn working_comparison_nets_staged_and_unstaged_changes_and_includes_only_unignored_new_files() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("tracked.txt"), "base\n").unwrap();
        fs::write(path.join(".gitignore"), "ignored.txt\n").unwrap();
        let base = commit_all(path, "base");
        fs::write(path.join("tracked.txt"), "staged\n").unwrap();
        git(path, &["add", "tracked.txt"]);
        fs::write(path.join("tracked.txt"), "base\n").unwrap();
        fs::write(path.join("new.txt"), "new\n").unwrap();
        fs::write(path.join("ignored.txt"), "ignored\n").unwrap();
        let files = read_files_cancellable(
            path,
            &DiffSource::WorkingRange { from: base },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new.txt");
        assert_eq!(files[0].change, ChangeType::Untracked);
        assert_eq!((files[0].insertions, files[0].deletions), (1, 0));
    }

    #[test]
    fn working_comparison_recognizes_recreated_untracked_revision_files() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("restored.txt"), "base\n").unwrap();
        let base = commit_all(path, "base");
        git(path, &["rm", "--quiet", "--cached", "restored.txt"]);
        let source = DiffSource::WorkingRange { from: base };
        assert!(
            read_files_cancellable(path, &source, &AtomicBool::new(false))
                .unwrap()
                .is_empty()
        );
        let diff = read(path, request("restored.txt", source.clone())).unwrap();
        assert_eq!(diff.change, ChangeType::Unmodified);
        let DiffContent::Text { hunks, .. } = diff.content else {
            panic!("expected text")
        };
        assert!(hunks.is_empty());
        fs::write(path.join("restored.txt"), "new\nline\n").unwrap();
        let files = read_files_cancellable(path, &source, &AtomicBool::new(false)).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].change, ChangeType::Modified);
        assert_eq!((files[0].insertions, files[0].deletions), (2, 1));
        let diff = read(path, request("restored.txt", source)).unwrap();
        assert_eq!(diff.change, ChangeType::Modified);
        let DiffContent::Text { hunks, .. } = diff.content else {
            panic!("expected text")
        };
        assert!(hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .any(|line| line.kind == DiffLineKind::Added && line.text == "new"));
    }

    #[cfg(unix)]
    #[test]
    fn comparison_keeps_tabs_and_newlines_as_literal_path_bytes() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("base.txt"), "base\n").unwrap();
        let base = commit_all(path, "base");
        for file in ["new\tname.txt", "new\nname.txt"] {
            fs::write(path.join(file), "new\nlines\n").unwrap();
        }
        let head = commit_all(path, "literal paths");
        let files = read_files_cancellable(
            path,
            &DiffSource::Range {
                from: Some(base),
                to: head,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .all(|file| file.insertions == 2 && file.deletions == 0));
        assert!(files.iter().any(|file| file.path == "new\tname.txt"));
        assert!(files.iter().any(|file| file.path == "new\nname.txt"));
    }

    #[test]
    fn file_comparison_preserves_cancellation_and_invalid_revision_errors() {
        let temporary = repository();
        assert!(matches!(
            read_files_cancellable(temporary.path(), &DiffSource::Index, &AtomicBool::new(true)),
            Err(ReadDiffError::Cancelled)
        ));
        assert!(
            matches!(read_files_cancellable(temporary.path(), &DiffSource::Range { from: Some("missing".into()), to: "missing".into() }, &AtomicBool::new(false)), Err(ReadDiffError::WithDiagnostic(error, _)) if *error == ReadDiffError::RevisionNotFound("missing".into()))
        );
    }

    #[test]
    fn encoding_override_redecodes_worktree_index_and_history() {
        let temporary = repository();
        let repository = temporary.path();
        let path = "legacy.txt";
        fs::write(repository.join(path), b"caf\xe9 base\n").unwrap();
        git_text(repository, &["add", path]);
        git_text(repository, &["commit", "-m", "base"]);
        fs::write(repository.join(path), b"caf\xe9 cambiado \x80\n").unwrap();
        for source in [
            DiffSource::Worktree,
            DiffSource::Index,
            DiffSource::Commit { sha: "HEAD".into() },
        ] {
            if source == DiffSource::Index {
                git_text(repository, &["add", path]);
            }
            let mut query = request(path, source);
            query.encoding = Some("utf-8".into());
            let file = read(repository, query).unwrap();
            let DiffContent::Text {
                hunks,
                decoding_errors,
                supports_partial,
                ..
            } = file.content
            else {
                panic!("text");
            };
            assert!(decoding_errors);
            assert!(!supports_partial);
            assert!(hunks
                .iter()
                .flat_map(|hunk| &hunk.lines)
                .any(|line| line.text.contains('�')));
        }
        let mut query = request(path, DiffSource::Index);
        query.encoding = Some("windows-1252".into());
        let DiffContent::Text {
            hunks,
            decoding_errors,
            ..
        } = read(repository, query).unwrap().content
        else {
            panic!("text");
        };
        assert!(!decoding_errors);
        assert!(hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .any(|line| line.text.contains("café cambiado €")));
    }

    #[test]
    fn utf16_and_utf32_have_text_hunks_even_when_git_calls_them_binary() {
        for name in ["utf-16le", "utf-16be", "utf-32le", "utf-32be"] {
            let temporary = repository();
            let repository = temporary.path();
            let path = "unicode.txt";
            fs::write(
                repository.join(path),
                super::encoding::encode("café base 😀\n", name, true).unwrap(),
            )
            .unwrap();
            git_text(repository, &["add", path]);
            git_text(repository, &["commit", "-m", "base"]);
            fs::write(
                repository.join(path),
                super::encoding::encode("niño nuevo 😀\n", name, true).unwrap(),
            )
            .unwrap();
            let DiffContent::Text {
                hunks,
                encoding,
                decoding_errors,
                supports_partial,
                ..
            } = read(repository, request(path, DiffSource::Worktree))
                .unwrap()
                .content
            else {
                panic!("{name} was treated as binary");
            };
            assert_eq!(encoding, name);
            assert!(!decoding_errors);
            assert!(!supports_partial);
            assert!(hunks
                .iter()
                .flat_map(|hunk| &hunk.lines)
                .any(|line| line.kind == DiffLineKind::Added && line.text == "niño nuevo 😀"));
        }
    }

    /// Read-only audit of the disposable repository generated by the Python script.
    #[test]
    #[ignore = "manual encoding lab; set GITTHUL_ENCODING_LAB to the generated folder"]
    fn manual_encoding_lab() {
        let root = std::path::PathBuf::from(
            std::env::var("GITTHUL_ENCODING_LAB").expect("set the fixture folder"),
        );
        let repository = root.join("diff");
        let resolver = root.join("resolver");
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
        for row in manifest.as_array().unwrap() {
            let path = row["archivo"].as_str().unwrap();
            let name = row["encoding"].as_str().unwrap();
            let expected = row["texto_esperado"].as_str().unwrap();
            let file = super::super::files::read_file_encoded(
                &repository,
                path.to_owned(),
                None,
                Some(name),
            )
            .unwrap();
            let file = serde_json::to_value(file).unwrap();
            assert_eq!(file["binary"], false, "{path}");
            assert_eq!(file["decodingErrors"], false, "{path}");
            assert!(file["text"].as_str().unwrap().contains(expected), "{path}");
            let automatic =
                super::super::files::read_file_encoded(&repository, path.to_owned(), None, None)
                    .unwrap();
            let automatic = serde_json::to_value(automatic).unwrap();
            assert_eq!(automatic["binary"], false, "automatic detection: {path}");
            let mut query = request(
                path,
                if name == "windows-1252" {
                    DiffSource::Index
                } else {
                    DiffSource::Worktree
                },
            );
            query.encoding = Some(name.to_owned());
            let diff = read(&repository, query).unwrap();
            let DiffContent::Text {
                hunks,
                decoding_errors,
                ..
            } = diff.content
            else {
                panic!("{path}");
            };
            assert!(!decoding_errors, "{path}");
            assert!(!hunks.is_empty(), "{path}");
            let conflict_path = path.replace("textos/", "conflictos/");
            let conflict =
                super::super::conflict::read_encoded(&resolver, &conflict_path, Some(name))
                    .unwrap();
            let conflict = serde_json::to_value(conflict).unwrap();
            assert_eq!(conflict["binary"], false, "{path}");
            assert_eq!(conflict["decodingErrors"], false, "{path}");
            assert!(
                conflict["ours"].as_str().unwrap().contains(expected),
                "{path}"
            );
        }
    }

    #[test]
    fn separa_el_diff_del_indice_y_del_arbol_de_trabajo() {
        let temporary = repository();
        fs::write(temporary.path().join("mixto.txt"), "uno\ndos\ntres\n").unwrap();
        git(temporary.path(), &["add", "mixto.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        fs::write(temporary.path().join("mixto.txt"), "uno\nDOS\ntres\n").unwrap();
        git(temporary.path(), &["add", "mixto.txt"]);
        fs::write(temporary.path().join("mixto.txt"), "uno\nDOS\nTRES\n").unwrap();

        let staged = read(temporary.path(), request("mixto.txt", DiffSource::Index)).unwrap();
        let unstaged = read(temporary.path(), request("mixto.txt", DiffSource::Worktree)).unwrap();

        let DiffContent::Text { hunks, .. } = staged.content else {
            panic!("se esperaba texto");
        };
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| { matches!(line.kind, DiffLineKind::Removed) && line.text == "dos" }));
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| matches!(line.kind, DiffLineKind::Added) && line.text == "DOS"));
        assert_eq!(hunks[0].lines[1].old_line, Some(2));
        assert_eq!(hunks[0].lines[2].new_line, Some(2));
        assert!(!hunks[0].lines[1].words.is_empty());

        let DiffContent::Text { hunks, .. } = unstaged.content else {
            panic!("se esperaba texto");
        };
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| { matches!(line.kind, DiffLineKind::Removed) && line.text == "tres" }));
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| matches!(line.kind, DiffLineKind::Added) && line.text == "TRES"));
        assert_ne!(unstaged.precondition.before, unstaged.precondition.after);
    }

    #[test]
    fn conserva_la_identidad_de_un_renombre_con_espacios() {
        let temporary = repository();
        fs::write(temporary.path().join("nombre anterior.txt"), "igual\n").unwrap();
        git(temporary.path(), &["add", "."]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        git(
            temporary.path(),
            &["mv", "nombre anterior.txt", "nombre nuevo.txt"],
        );

        let diff = read(
            temporary.path(),
            request("nombre nuevo.txt", DiffSource::Index),
        )
        .unwrap();

        assert_eq!(diff.change, ChangeType::Renamed);
        assert_eq!(diff.previous_path.as_deref(), Some("nombre anterior.txt"));
        assert_eq!(diff.precondition.before, diff.precondition.after);
        let DiffContent::Text { hunks, .. } = diff.content else {
            panic!("se esperaba texto");
        };
        assert!(hunks.is_empty());
    }

    #[test]
    fn representa_lados_ausentes_en_agregados_y_eliminados() {
        let temporary = repository();
        fs::write(temporary.path().join("eliminado.txt"), "adios\n").unwrap();
        git(temporary.path(), &["add", "."]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        fs::remove_file(temporary.path().join("eliminado.txt")).unwrap();
        fs::write(temporary.path().join("agregado.txt"), "hola\n").unwrap();
        git(temporary.path(), &["add", "agregado.txt"]);

        let added = read(temporary.path(), request("agregado.txt", DiffSource::Index)).unwrap();
        let deleted = read(
            temporary.path(),
            request("eliminado.txt", DiffSource::Worktree),
        )
        .unwrap();

        assert_eq!(added.change, ChangeType::Added);
        assert!(added.precondition.before.is_none());
        assert!(added.precondition.after.is_some());
        assert_eq!(deleted.change, ChangeType::Deleted);
        assert!(deleted.precondition.before.is_some());
        assert!(deleted.precondition.after.is_none());
    }

    #[test]
    fn archivo_sin_cambios_en_el_ultimo_commit_no_es_untracked() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(
            path.join("heredado.txt"),
            "contenido de un commit anterior\n",
        )
        .unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "archivo original"]);
        let base = git_text(path, &["rev-parse", "HEAD"]);
        fs::write(path.join("otro.txt"), "otro archivo\n").unwrap();
        git(path, &["add", "."]);
        git(
            path,
            &["commit", "--quiet", "-m", "cambia solo otro archivo"],
        );
        let head = git_text(path, &["rev-parse", "HEAD"]);
        for source in [
            DiffSource::Commit { sha: head.clone() },
            DiffSource::Range {
                from: Some(base.clone()),
                to: head.clone(),
            },
            DiffSource::Index,
            DiffSource::Worktree,
            DiffSource::WorkingRange { from: base },
        ] {
            let diff = read(path, request("heredado.txt", source)).unwrap();
            assert_eq!(diff.change, ChangeType::Unmodified);
            let DiffContent::Text { hunks, .. } = diff.content else {
                panic!("se esperaba texto");
            };
            assert!(hunks.is_empty());
        }
        // Opening the active tree must read HEAD, even if the working copy differs.
        fs::write(path.join("heredado.txt"), "cambio local\n").unwrap();
        let contents =
            super::super::files::read_file(path, "heredado.txt".to_owned(), Some(&head)).unwrap();
        assert_eq!(
            serde_json::to_value(contents).unwrap()["text"],
            "contenido de un commit anterior\n"
        );
        let diff = read(
            path,
            request("heredado.txt", DiffSource::Commit { sha: head }),
        )
        .unwrap();
        assert_eq!(diff.change, ChangeType::Unmodified);
    }

    #[test]
    fn lee_un_no_rastreado_con_no_index() {
        let temporary = repository();
        fs::write(
            temporary.path().join("sin rastrear.txt"),
            "primera\nsegunda\n",
        )
        .unwrap();

        let diff = read(
            temporary.path(),
            request("sin rastrear.txt", DiffSource::Worktree),
        )
        .unwrap();

        assert_eq!(diff.change, ChangeType::Untracked);
        assert!(diff.precondition.before.is_none());
        assert!(diff.precondition.after.is_some());
        let DiffContent::Text { hunks, .. } = diff.content else {
            panic!("se esperaba texto");
        };
        assert_eq!(hunks[0].old_lines, 0);
        assert_eq!(hunks[0].new_lines, 2);
    }

    #[test]
    fn detecta_binarios_y_sus_tamanos() {
        let temporary = repository();
        fs::write(temporary.path().join("imagen.png"), [0, 1, 2, 0, 3]).unwrap();
        git(temporary.path(), &["add", "imagen.png"]);

        let diff = read(temporary.path(), request("imagen.png", DiffSource::Index)).unwrap();
        let json = serde_json::to_value(&diff.content).unwrap();

        let DiffContent::Binary {
            old_size,
            new_size,
            media_type,
        } = diff.content
        else {
            panic!("se esperaba binario");
        };
        assert_eq!(old_size, None);
        assert_eq!(new_size, Some(5));
        assert_eq!(media_type, "image/png");

        assert_eq!(json["kind"], "binary");
        assert_eq!(json["oldSize"], serde_json::Value::Null);
        assert_eq!(json["newSize"], 5);
        assert_eq!(json["mediaType"], "image/png");
        assert!(json.get("old_size").is_none());
        assert!(json.get("media_type").is_none());
    }

    #[test]
    fn un_parche_latin1_sigue_siendo_texto_y_conserva_sus_caracteres() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("antiguo.java"), b"class Cafe { // Espa\xf1a\n}\n").unwrap();
        git(path, &["add", "antiguo.java"]);
        git(path, &["commit", "--quiet", "-m", "base"]);
        fs::write(path.join("antiguo.java"), b"class Cafe { // ni\xf1o\n}\n").unwrap();
        git(path, &["add", "antiguo.java"]);

        let diff = read(path, request("antiguo.java", DiffSource::Index)).unwrap();
        let DiffContent::Text {
            hunks, encoding, ..
        } = diff.content
        else {
            panic!("se esperaba texto Latin-1");
        };

        assert_eq!(encoding, "windows-1252");
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == DiffLineKind::Added && line.text.contains("niño")));
    }

    #[cfg(unix)]
    #[test]
    fn incluye_el_modo_en_la_precondicion() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = repository();
        let path = temporary.path().join("script.sh");
        fs::write(&path, "#!/bin/sh\n").unwrap();
        git(temporary.path(), &["add", "script.sh"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        let diff = read(temporary.path(), request("script.sh", DiffSource::Worktree)).unwrap();

        assert_eq!(diff.precondition.before.unwrap().mode, GitFileMode::Regular);
        assert_eq!(
            diff.precondition.after.unwrap().mode,
            GitFileMode::Executable
        );
    }

    #[test]
    fn rechaza_rutas_que_escapan_del_repositorio() {
        let temporary = repository();
        assert!(matches!(
            read(temporary.path(), request("../fuera", DiffSource::Worktree)),
            Err(ReadDiffError::InvalidPath)
        ));
    }

    #[test]
    fn lee_diff_de_root_commit_y_rango_con_extremos_exactos() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("historia.txt"), "uno\ndos\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "root"]);
        let root = git_text(path, &["rev-parse", "HEAD"]);

        let root_diff = read(
            path,
            request("historia.txt", DiffSource::Commit { sha: root.clone() }),
        )
        .unwrap();
        assert_eq!(root_diff.change, ChangeType::Added);
        assert!(root_diff.precondition.before.is_none());
        assert!(root_diff.precondition.after.is_some());

        fs::write(path.join("historia.txt"), "uno\nDOS\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "segundo"]);
        let second = git_text(path, &["rev-parse", "HEAD"]);

        let commit_diff = read(
            path,
            request(
                "historia.txt",
                DiffSource::Commit {
                    sha: second.clone(),
                },
            ),
        )
        .unwrap();
        let range_diff = read(
            path,
            request(
                "historia.txt",
                DiffSource::Range {
                    from: Some(root),
                    to: second,
                },
            ),
        )
        .unwrap();
        assert_eq!(commit_diff.precondition, range_diff.precondition);
        let DiffContent::Text { hunks, .. } = range_diff.content else {
            panic!("se esperaba texto");
        };
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == DiffLineKind::Added && line.text == "DOS"));
    }

    #[test]
    fn compara_una_revision_con_todo_el_wip() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("seguido.txt"), "base\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "base"]);
        let base = git_text(path, &["rev-parse", "HEAD"]);

        fs::write(path.join("seguido.txt"), "preparado\n").unwrap();
        git(path, &["add", "seguido.txt"]);
        fs::write(path.join("seguido.txt"), "sin preparar\n").unwrap();
        fs::write(path.join("nuevo.txt"), "nuevo\n").unwrap();

        let seguido = read(
            path,
            request(
                "seguido.txt",
                DiffSource::WorkingRange { from: base.clone() },
            ),
        )
        .unwrap();
        let DiffContent::Text { hunks, .. } = seguido.content else {
            panic!("se esperaba texto");
        };
        assert!(hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == DiffLineKind::Added && line.text == "sin preparar"));

        let nuevo = read(
            path,
            request("nuevo.txt", DiffSource::WorkingRange { from: base }),
        )
        .unwrap();
        assert_eq!(nuevo.change, ChangeType::Untracked);
        assert!(nuevo.precondition.before.is_none());
        assert!(nuevo.precondition.after.is_some());
    }

    #[test]
    fn un_commit_merge_usa_primer_padre_y_conserva_renombre_historico() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("base.txt"), "base\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "base"]);
        let main = git_text(path, &["branch", "--show-current"]);
        git(path, &["switch", "--quiet", "-c", "lateral"]);
        git(path, &["mv", "base.txt", "lado.txt"]);
        git(path, &["commit", "--quiet", "-am", "lado"]);
        git(path, &["switch", "--quiet", &main]);
        fs::write(path.join("principal.txt"), "principal\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "principal"]);
        git(
            path,
            &["merge", "--quiet", "--no-ff", "lateral", "-m", "fusión"],
        );
        let merge = git_text(path, &["rev-parse", "HEAD"]);

        let diff = read(path, request("lado.txt", DiffSource::Commit { sha: merge })).unwrap();
        assert_eq!(diff.change, ChangeType::Renamed);
        assert_eq!(diff.previous_path.as_deref(), Some("base.txt"));
    }

    #[test]
    fn respeta_whitespace_y_rechaza_una_revision_inexistente() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("espacios.txt"), "uno dos\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "base"]);
        let base = git_text(path, &["rev-parse", "HEAD"]);
        fs::write(path.join("espacios.txt"), "uno  dos\n").unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "--quiet", "-m", "espacios"]);
        let head = git_text(path, &["rev-parse", "HEAD"]);
        let mut whitespace_request = request(
            "espacios.txt",
            DiffSource::Range {
                from: Some(base),
                to: head,
            },
        );
        whitespace_request.ignore_whitespace = true;
        let diff = read(path, whitespace_request).unwrap();
        let DiffContent::Text { hunks, .. } = diff.content else {
            panic!("se esperaba texto");
        };
        assert!(hunks.is_empty());

        assert!(matches!(
            read(
                path,
                request(
                    "espacios.txt",
                    DiffSource::Commit {
                        sha: "no-existe".to_owned(),
                    },
                ),
            )
            .unwrap_err(),
            ReadDiffError::WithDiagnostic(error, _) if *error == ReadDiffError::RevisionNotFound("no-existe".to_owned())
        ));
    }
}

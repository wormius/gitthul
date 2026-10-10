//! Disk-backed checkpoints for compound Git operations, including unfinished integrations.
//! References are locked with a Git transaction before any restoration takes place.
use super::{recovery_store, undo::UndoError};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Arc,
};

const META: &[&str] = &[
    "index",
    "FETCH_HEAD",
    "ORIG_HEAD",
    "MERGE_HEAD",
    "MERGE_MSG",
    "MERGE_MODE",
    "MERGE_AUTOSTASH",
    "SQUASH_MSG",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "AUTO_MERGE",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "logs/refs/stash",
    "config",
    "config.worktree",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum Reference {
    Direct(String),
    Symbolic(String),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Image {
    backup: PathBuf,
    digest: String,
    mode: u32,
    readonly: bool,
    symlink: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Checkpoint {
    directory: PathBuf,
    refs: BTreeMap<String, Reference>,
    files: BTreeMap<String, Image>,
    metadata: BTreeMap<String, Image>,
    index_signature: String,
    /// None covers the complete worktree; Some covers exactly these literal paths,
    /// including absent files. Unrelated working files are never restored.
    #[serde(default)]
    scope: Option<BTreeSet<String>>,
    #[serde(default)]
    pub(super) recovery: recovery_store::RecoveryMetadata,
}

/// Wake the repository watcher after a terminal session adds an undo entry.
pub(super) fn notify_undo_change(repository: &Path) -> Result<(), UndoError> {
    let path = git_path(repository, "gitthul-undo-revision")?;
    let parent = path.parent().ok_or(UndoError::GitFailed)?;
    let mut marker = tempfile::NamedTempFile::new_in(parent).map_err(|_| UndoError::GitFailed)?;
    marker
        .write_all(b"changed\n")
        .map_err(|_| UndoError::GitFailed)?;
    marker
        .as_file()
        .sync_all()
        .map_err(|_| UndoError::GitFailed)?;
    marker.persist(path).map_err(|_| UndoError::GitFailed)?;
    Ok(())
}

fn command(repository: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(repository)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    c
}
fn internal_ref_command(repository: &Path) -> Result<(Command, tempfile::TempDir), UndoError> {
    // Capturing/restoring private references is internal bookkeeping. User
    // reference hooks still run for the real Git operation, but must not mutate
    // the worktree while a checkpoint is being captured or restored.
    let hooks = tempfile::tempdir().map_err(|_| UndoError::GitFailed)?;
    let mut cmd = command(repository);
    cmd.args([
        "-c",
        &format!("core.hooksPath={}", hooks.path().to_string_lossy()),
    ]);
    Ok((cmd, hooks))
}
fn output(repository: &Path, args: &[&str]) -> Result<Vec<u8>, UndoError> {
    let out = command(repository)
        .args(args)
        .output()
        .map_err(|_| UndoError::GitFailed)?;
    if !out.status.success() {
        return Err(UndoError::GitFailed);
    }
    Ok(out.stdout)
}
fn git_path(repository: &Path, name: &str) -> Result<PathBuf, UndoError> {
    let out = output(repository, &["rev-parse", "--git-path", name])?;
    Ok(repository.join(
        String::from_utf8(out)
            .map_err(|_| UndoError::GitFailed)?
            .trim(),
    ))
}
fn git_paths(repository: &Path, names: &[&str]) -> Result<Vec<PathBuf>, UndoError> {
    let args: Vec<_> = names
        .iter()
        .flat_map(|name| ["--git-path", *name])
        .collect();
    let mut args_with_command = vec!["rev-parse"];
    args_with_command.extend(args);
    let bytes = output(repository, &args_with_command)?;
    let text = String::from_utf8(bytes).map_err(|_| UndoError::GitFailed)?;
    let paths: Vec<_> = text.lines().map(|line| repository.join(line)).collect();
    if paths.len() != names.len() {
        return Err(UndoError::GitFailed);
    }
    Ok(paths)
}
fn references(repository: &Path) -> Result<BTreeMap<String, Reference>, UndoError> {
    let out = output(
        repository,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(symref)",
        ],
    )?;
    let mut refs = BTreeMap::new();
    for line in String::from_utf8(out)
        .map_err(|_| UndoError::GitFailed)?
        .lines()
    {
        let parts: Vec<_> = line.split('\0').collect();
        if parts.len() != 3 {
            return Err(UndoError::GitFailed);
        }
        if parts[0].starts_with("refs/gitthul/undo/") {
            continue;
        }
        refs.insert(
            parts[0].to_owned(),
            if parts[2].is_empty() {
                Reference::Direct(parts[1].to_owned())
            } else {
                Reference::Symbolic(parts[2].to_owned())
            },
        );
    }
    let head =
        fs::read_to_string(git_path(repository, "HEAD")?).map_err(|_| UndoError::GitFailed)?;
    refs.insert(
        "HEAD".to_owned(),
        if let Some(target) = head.trim().strip_prefix("ref: ") {
            Reference::Symbolic(target.to_owned())
        } else {
            Reference::Direct(head.trim().to_owned())
        },
    );
    Ok(refs)
}
fn paths(repository: &Path, trees: &[String]) -> Result<BTreeSet<String>, UndoError> {
    let mut bytes = output(
        repository,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;
    for tree in trees {
        bytes.extend(output(
            repository,
            &["ls-tree", "-r", "--name-only", "-z", tree],
        )?);
    }
    bytes
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8(p.to_vec()).map_err(|_| UndoError::GitFailed))
        .collect()
}
fn path_list(bytes: &[u8]) -> Result<BTreeSet<String>, UndoError> {
    bytes
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8(p.to_vec()).map_err(|_| UndoError::GitFailed))
        .collect()
}

/// Both ends of renames are needed, including staged deletions. Stash recovery
/// includes untracked files; checkout's auto-stash only touches tracked files.
fn local_changes(
    repository: &Path,
    include_untracked: bool,
) -> Result<BTreeSet<String>, UndoError> {
    let mut args = vec![
        "ls-files",
        "--modified",
        "--deleted",
        "--exclude-standard",
        "-z",
    ];
    if include_untracked {
        args.push("--others");
    }
    let mut selected = path_list(&output(repository, &args)?)?;
    selected.extend(path_list(&output(
        repository,
        &[
            "diff",
            "--cached",
            "--name-only",
            "--no-renames",
            "-z",
            "--",
        ],
    )?)?);
    Ok(selected)
}

fn changed_paths(repository: &Path, from: &str, to: &str) -> Result<BTreeSet<String>, UndoError> {
    path_list(&output(
        repository,
        &["diff", "--name-only", "--no-renames", "-z", from, to, "--"],
    )?)
}

fn paths_overlap(path: &str, other: &BTreeSet<String>) -> bool {
    if Path::new(path)
        .ancestors()
        .filter_map(Path::to_str)
        .any(|ancestor| other.contains(ancestor))
    {
        return true;
    }
    let prefix = format!("{path}/");
    other
        .range(prefix.clone()..)
        .next()
        .is_some_and(|name| name.starts_with(&prefix))
}

/// Incoming tracked paths may replace ignored files or directories. Include
/// those collisions without backing up unrelated ignored build artifacts.
fn include_collisions(repository: &Path, selected: &mut BTreeSet<String>) -> Result<(), UndoError> {
    if selected.is_empty() {
        return Ok(());
    }
    let mut collisions = BTreeSet::new();
    let mut directories = Vec::new();
    for name in selected.iter() {
        let path = safe_path(repository, name)?;
        if fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) {
            directories.push(path);
        }
        for parent in Path::new(name).ancestors().skip(1) {
            if parent.as_os_str().is_empty() {
                break;
            }
            if fs::symlink_metadata(repository.join(parent)).is_ok_and(|meta| meta.is_file()) {
                collisions.insert(parent.to_str().ok_or(UndoError::GitFailed)?.to_owned());
            }
        }
    }
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(|_| UndoError::GitFailed)? {
            let path = entry.map_err(|_| UndoError::GitFailed)?.path();
            let name = path
                .strip_prefix(repository)
                .map_err(|_| UndoError::GitFailed)?
                .to_str()
                .ok_or(UndoError::GitFailed)?;
            safe_path(repository, name)?;
            if fs::symlink_metadata(&path)
                .map_err(|_| UndoError::GitFailed)?
                .is_dir()
            {
                directories.push(path);
            } else {
                collisions.insert(name.to_owned());
            }
        }
    }
    selected.extend(collisions);
    Ok(())
}

/// Additions only interact at overlapping paths. Deletions/type changes can
/// also imply directory renames, so conservatively cover their non-root parents.
fn structural_interaction(
    repository: &Path,
    args: &[&str],
    other: &BTreeSet<String>,
    directory_additions: bool,
) -> Result<bool, UndoError> {
    if other.is_empty() {
        return Ok(false);
    }
    let mut command = vec![
        "diff",
        "--name-status",
        "--no-renames",
        "--diff-filter=ADT",
        "-z",
    ];
    command.extend_from_slice(args);
    command.push("--");
    let bytes = output(repository, &command)?;
    let fields: Vec<_> = bytes
        .split(|b| *b == 0)
        .filter(|field| !field.is_empty())
        .collect();
    if fields.len() % 2 != 0 {
        return Err(UndoError::GitFailed);
    }
    for entry in fields.chunks_exact(2) {
        if !matches!(entry[0], b"A" | b"D" | b"T") {
            return Err(UndoError::GitFailed);
        }
        let path = std::str::from_utf8(entry[1]).map_err(|_| UndoError::GitFailed)?;
        if paths_overlap(path, other) {
            return Ok(true);
        }
        // Inferred directory renames relocate new files. Content modifications
        // stay at their existing path unless that path itself was renamed or
        // deleted, which the direct overlap check above already catches.
        if directory_additions && matches!(entry[0], b"D" | b"T") {
            if let Some(parent) = Path::new(path).parent() {
                for parent in parent
                    .ancestors()
                    .filter_map(Path::to_str)
                    .filter(|p| !p.is_empty())
                {
                    if paths_overlap(parent, other) {
                        return Ok(true);
                    }
                }
            }
        }
    }
    Ok(false)
}
pub(super) fn conflicted_paths(repository: &Path) -> Result<BTreeSet<String>, UndoError> {
    path_list(&output(
        repository,
        &["diff", "--name-only", "--diff-filter=U", "-z", "--"],
    )?)
}
pub(super) fn checkout_requires_full(repository: &Path) -> Result<bool, UndoError> {
    hooks_require_full(
        repository,
        &[
            "post-checkout",
            "post-merge",
            "post-index-change",
            "reference-transaction",
        ],
    )
}
fn hooks_require_full(repository: &Path, hooks: &[&str]) -> Result<bool, UndoError> {
    let names: Vec<_> = hooks.iter().map(|hook| format!("hooks/{hook}")).collect();
    let names: Vec<_> = names.iter().map(String::as_str).collect();
    Ok(git_paths(repository, &names)?
        .iter()
        .any(|path| path.exists()))
}
pub(super) fn index_write_requires_full(repository: &Path) -> Result<bool, UndoError> {
    hooks_require_full(repository, &["post-index-change"])
}
fn hidden_index_paths(repository: &Path) -> Result<BTreeSet<String>, UndoError> {
    let entries = output(repository, &["ls-files", "-v", "-z"])?;
    let mut paths = BTreeSet::new();
    for entry in entries.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        if entry.len() < 3 || entry[1] != b' ' {
            return Err(UndoError::GitFailed);
        }
        if entry[0].is_ascii_lowercase() || entry[0] == b'S' {
            paths.insert(
                std::str::from_utf8(&entry[2..])
                    .map_err(|_| UndoError::GitFailed)?
                    .to_owned(),
            );
        }
    }
    Ok(paths)
}
fn safe_path(root: &Path, name: &str) -> Result<PathBuf, UndoError> {
    super::diff::validate_path(name).map_err(|_| UndoError::Stale)?;
    let mut path = root.to_owned();
    let count = Path::new(name).components().count();
    for (i, component) in Path::new(name).components().enumerate() {
        if component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
        {
            return Err(UndoError::Stale);
        }
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_symlink() && i + 1 != count => return Err(UndoError::Stale),
            Ok(_) => (),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                ()
            }
            Err(_) => return Err(UndoError::GitFailed),
        }
    }
    Ok(path)
}
pub(super) fn digest(path: &Path) -> Result<String, UndoError> {
    let mut file = fs::File::open(path).map_err(|_| UndoError::GitFailed)?;
    let mut hash = gix::hash::hasher(gix::hash::Kind::Sha1);
    let mut bytes = [0u8; 65536];
    loop {
        let count = file.read(&mut bytes).map_err(|_| UndoError::GitFailed)?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    hash.try_finalize()
        .map(|oid| oid.to_string())
        .map_err(|_| UndoError::GitFailed)
}
fn source_digest(path: &Path, symlink: bool) -> Result<String, UndoError> {
    if !symlink {
        return digest(path);
    }
    let target = fs::read_link(path).map_err(|_| UndoError::GitFailed)?;
    let mut hash = gix::hash::hasher(gix::hash::Kind::Sha1);
    hash.update(target.to_str().ok_or(UndoError::GitFailed)?.as_bytes());
    hash.try_finalize()
        .map(|oid| oid.to_string())
        .map_err(|_| UndoError::GitFailed)
}
fn image(path: &Path, directory: &Path, number: usize) -> Result<Option<Image>, UndoError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(None)
        }
        Err(_) => return Err(UndoError::GitFailed),
    };
    let symlink = meta.file_type().is_symlink();
    if !meta.is_file() && !symlink {
        return Err(UndoError::GitFailed);
    }
    let saved_digest = source_digest(path, symlink)?;
    let objects = directory
        .parent()
        .ok_or(UndoError::GitFailed)?
        .join("contents");
    recovery_store::private_directory(&objects)?;
    let shared = objects.join(&saved_digest);
    let mode = {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            meta.permissions().mode()
        }
        #[cfg(not(unix))]
        {
            0
        }
    };
    // Deduplicate BEFORE copying and syncing. The old path did both for every
    // unchanged file on each capture, even when its backup already existed.
    match fs::symlink_metadata(&shared) {
        Ok(m) => {
            if !m.is_file() || digest(&shared)? != saved_digest {
                return Err(UndoError::Stale);
            }
            return Ok(Some(Image {
                backup: shared,
                digest: saved_digest,
                mode,
                readonly: meta.permissions().readonly(),
                symlink,
            }));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err(UndoError::GitFailed),
    }
    let backup = directory.join(number.to_string());
    // The backup stays private even if the source file is world-readable.
    let mut saved = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup)
        .map_err(|_| UndoError::GitFailed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        saved
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| UndoError::GitFailed)?;
    }
    if symlink {
        let target = fs::read_link(path).map_err(|_| UndoError::GitFailed)?;
        saved
            .write_all(target.to_str().ok_or(UndoError::GitFailed)?.as_bytes())
            .map_err(|_| UndoError::GitFailed)?;
    } else {
        let mut source = fs::File::open(path).map_err(|_| UndoError::GitFailed)?;
        std::io::copy(&mut source, &mut saved).map_err(|_| UndoError::GitFailed)?;
    }
    saved.sync_all().map_err(|_| UndoError::GitFailed)?;
    if digest(&backup)? != saved_digest || source_digest(path, symlink)? != saved_digest {
        return Err(UndoError::Stale);
    }
    match fs::hard_link(&backup, &shared) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if fs::symlink_metadata(&shared)
                .map_err(|_| UndoError::GitFailed)?
                .file_type()
                .is_symlink()
                || digest(&shared)? != saved_digest
            {
                return Err(UndoError::Stale);
            }
        }
        Err(_) => {
            return Ok(Some(Image {
                backup,
                digest: saved_digest,
                mode,
                readonly: meta.permissions().readonly(),
                symlink,
            }))
        }
    }
    drop(saved);
    fs::remove_file(&backup).map_err(|_| UndoError::GitFailed)?;
    Ok(Some(Image {
        backup: shared,
        digest: saved_digest,
        mode,
        readonly: meta.permissions().readonly(),
        symlink,
    }))
}
fn metadata_paths(repository: &Path) -> Result<BTreeMap<String, PathBuf>, UndoError> {
    fn visit(
        path: &Path,
        name: &str,
        result: &mut BTreeMap<String, PathBuf>,
    ) -> Result<(), UndoError> {
        match fs::symlink_metadata(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(UndoError::GitFailed),
            Ok(m) if m.is_dir() => {
                for entry in fs::read_dir(path).map_err(|_| UndoError::GitFailed)? {
                    let entry = entry.map_err(|_| UndoError::GitFailed)?;
                    let child = entry
                        .file_name()
                        .into_string()
                        .map_err(|_| UndoError::GitFailed)?;
                    visit(&entry.path(), &format!("{name}/{child}"), result)?;
                }
            }
            Ok(m) if m.is_file() => {
                result.insert(name.to_owned(), path.to_owned());
            }
            Ok(_) => return Err(UndoError::GitFailed),
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    // Git resolves common-dir/worktree-specific metadata correctly. Ask once
    // for all paths rather than spawning a process for each metadata file.
    for (name, path) in META.iter().zip(git_paths(repository, META)?) {
        visit(&path, name, &mut result)?;
    }
    Ok(result)
}
fn same_image(a: &Image, b: &Image) -> bool {
    a.symlink == b.symlink && a.digest == b.digest && a.mode == b.mode && a.readonly == b.readonly
}
fn same_map(a: &BTreeMap<String, Image>, b: &BTreeMap<String, Image>) -> bool {
    a.len() == b.len()
        && a.iter()
            .all(|(name, image)| b.get(name).is_some_and(|other| same_image(image, other)))
}

impl Checkpoint {
    pub(super) fn recovery_repository(&self) -> &Path {
        &self.recovery.repository
    }
    pub(super) fn recovery_directory(&self) -> &Path {
        &self.directory
    }
    pub(super) fn recovery_files(&self) -> Vec<String> {
        self.files.keys().cloned().collect()
    }
    pub(super) fn recovery_scope(&self) -> Option<Vec<String>> {
        self.scope
            .as_ref()
            .map(|scope| scope.iter().cloned().collect())
    }
    pub(super) fn recovery_backups(&self) -> BTreeSet<PathBuf> {
        self.files
            .values()
            .chain(self.metadata.values())
            .map(|image| image.backup.clone())
            .collect()
    }
    pub(super) fn recovery_verify_repository(&self, repository: &Path) -> Result<(), UndoError> {
        let (path, git_dir, identity) = recovery_store::repository_identity(repository)?;
        if path != self.recovery.repository
            || git_dir != self.recovery.git_dir
            || identity != self.recovery.git_dir_identity
        {
            return Err(UndoError::Stale);
        }
        for name in self.files.keys().chain(self.scope.iter().flatten()) {
            safe_path(repository, name)?;
        }
        Ok(())
    }
    pub(super) fn recovery_check_contents(
        &self,
        checked: &mut BTreeSet<PathBuf>,
    ) -> Result<(), UndoError> {
        for image in self.files.values().chain(self.metadata.values()) {
            if checked.insert(image.backup.clone()) && digest(&image.backup)? != image.digest {
                return Err(UndoError::Stale);
            }
        }
        Ok(())
    }
    fn recovery_relative(&self) -> Result<Self, UndoError> {
        let bucket = self.directory.parent().ok_or(UndoError::Stale)?;
        let mut manifest = self.clone();
        manifest.directory = PathBuf::from(self.directory.file_name().ok_or(UndoError::Stale)?);
        for image in manifest
            .files
            .values_mut()
            .chain(manifest.metadata.values_mut())
        {
            image.backup = image
                .backup
                .strip_prefix(bucket)
                .map_err(|_| UndoError::Stale)?
                .to_owned();
        }
        Ok(manifest)
    }
    pub(super) fn recovery_persist(&self) -> Result<(), UndoError> {
        let path = self.directory.join("manifest.json");
        let mut manifest = self.recovery_relative()?;
        // Labels can be attached durably before an operation starts, without
        // changing the shared Arc. A later scope expansion keeps that label.
        if manifest.recovery.label.is_none()
            && fs::symlink_metadata(&path).is_ok_and(|meta| {
                meta.is_file() && !meta.file_type().is_symlink() && meta.len() <= 64 * 1024 * 1024
            })
        {
            if let Ok(previous) = fs::read(&path) {
                if let Ok(previous) = serde_json::from_slice::<Self>(&previous) {
                    manifest.recovery.label = previous.recovery.label;
                }
            }
        }
        recovery_store::write_json(&path, &manifest)
    }

    pub(super) fn recovery_set_label(&self, label: &str) -> Result<(), UndoError> {
        let _guard = recovery_store::lock();
        let mut labelled = self.clone();
        labelled.recovery.label = Some(label.to_owned());
        labelled.recovery_persist()
    }
    pub(super) fn recovery_mark_pending(&self, label: &str) -> Result<(), UndoError> {
        let _guard = recovery_store::lock();
        let mut pending = self.clone();
        pending.recovery.state = "pending".to_owned();
        pending.recovery.label = Some(label.to_owned());
        pending.recovery_persist()
    }
    pub(super) fn recovery_complete_preview(&self) -> Result<(), UndoError> {
        let _guard = recovery_store::lock();
        let mut completed = self.clone();
        completed.recovery.state = "completed".to_owned();
        completed.recovery_persist()?;
        drop(_guard);
        recovery_store::cleanup_bucket_if_enabled(&self.directory);
        Ok(())
    }
    pub(super) fn recovery_complete_pair(
        before: &Self,
        after: &Self,
        label: &str,
    ) -> Result<(), UndoError> {
        let _guard = recovery_store::lock();
        for (checkpoint, related) in [(before, after), (after, before)] {
            let mut completed = checkpoint.clone();
            completed.recovery.state = "completed".to_owned();
            completed.recovery.label = Some(label.to_owned());
            completed.recovery.related_checkpoint = Some(
                related
                    .directory
                    .file_name()
                    .ok_or(UndoError::Stale)?
                    .to_string_lossy()
                    .into_owned(),
            );
            completed.recovery_persist()?;
        }
        Ok(())
    }
    pub(super) fn recovery_read(
        directory: &Path,
        bucket: &Path,
        allow_legacy: bool,
        verify_contents: bool,
    ) -> Result<Self, UndoError> {
        fn literal(name: &str) -> Result<(), UndoError> {
            super::diff::validate_path(name).map_err(|_| UndoError::Stale)?;
            if name.contains('\0')
                || Path::new(name).components().any(|component| {
                    !matches!(component, std::path::Component::Normal(_))
                        || component
                            .as_os_str()
                            .to_string_lossy()
                            .eq_ignore_ascii_case(".git")
                })
            {
                return Err(UndoError::Stale);
            }
            Ok(())
        }
        fn valid_ref(name: &str) -> bool {
            name.starts_with("refs/")
                && !name.starts_with("refs/gitthul/undo/")
                && gix::validate::reference::name(gix::bstr::BStr::new(name)).is_ok()
        }

        let metadata = fs::symlink_metadata(directory).map_err(|_| UndoError::GitFailed)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(UndoError::Stale);
        }
        let manifest_path = directory.join("manifest.json");
        let metadata = fs::symlink_metadata(&manifest_path).map_err(|_| UndoError::GitFailed)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > 64 * 1024 * 1024
        {
            return Err(UndoError::Stale);
        }
        let mut checkpoint: Self =
            serde_json::from_slice(&fs::read(&manifest_path).map_err(|_| UndoError::GitFailed)?)
                .map_err(|_| UndoError::Stale)?;
        let legacy_bucket = checkpoint.directory.parent().map(Path::to_owned);
        if !allow_legacy
            && (checkpoint.recovery.version != 1
                || !checkpoint.recovery.repository.is_absolute()
                || !checkpoint.recovery.git_dir.is_absolute()
                || checkpoint.recovery.git_dir_identity.is_empty()
                || checkpoint.recovery.created_at == 0
                || !matches!(
                    checkpoint.recovery.state.as_str(),
                    "pending" | "completed" | "legacy"
                ))
        {
            return Err(UndoError::Stale);
        }
        for name in checkpoint
            .files
            .keys()
            .chain(checkpoint.scope.iter().flatten())
        {
            literal(name)?;
        }
        for name in checkpoint.metadata.keys() {
            literal(name)?;
            if !META.contains(&name.as_str())
                && !["rebase-merge/", "rebase-apply/", "sequencer/"]
                    .iter()
                    .any(|prefix| name.starts_with(prefix))
            {
                return Err(UndoError::Stale);
            }
        }
        if !checkpoint.refs.contains_key("HEAD") {
            return Err(UndoError::Stale);
        }
        for (name, reference) in &checkpoint.refs {
            if name != "HEAD" && !valid_ref(name) {
                return Err(UndoError::Stale);
            }
            match reference {
                Reference::Direct(oid)
                    if (oid.len() == 40 || oid.len() == 64)
                        && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
                        && !oid.bytes().all(|byte| byte == b'0') =>
                {
                    ()
                }
                Reference::Symbolic(target) if valid_ref(target) => (),
                _ => return Err(UndoError::Stale),
            }
        }
        let mut known_backups: BTreeMap<PathBuf, String> = BTreeMap::new();
        let checkpoint_name = directory
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(UndoError::Stale)?;
        for image in checkpoint
            .files
            .values_mut()
            .chain(checkpoint.metadata.values_mut())
        {
            if image.digest.len() != 40
                || !image.digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(UndoError::Stale);
            }
            let relative = if image.backup.is_absolute() && allow_legacy {
                image
                    .backup
                    .strip_prefix(legacy_bucket.as_ref().ok_or(UndoError::Stale)?)
                    .map_err(|_| UndoError::Stale)?
                    .to_owned()
            } else {
                image.backup.clone()
            };
            let components: Vec<_> = relative.components().collect();
            if components.len() != 2 {
                return Err(UndoError::Stale);
            }
            let (std::path::Component::Normal(parent), std::path::Component::Normal(name)) =
                (components[0], components[1])
            else {
                return Err(UndoError::Stale);
            };
            let parent = parent.to_str().ok_or(UndoError::Stale)?;
            let name = name.to_str().ok_or(UndoError::Stale)?;
            if !((parent == "contents" && name == image.digest)
                || (parent == checkpoint_name
                    && !name.is_empty()
                    && name.bytes().all(|byte| byte.is_ascii_digit())))
            {
                return Err(UndoError::Stale);
            }
            let parent_path = bucket.join(parent);
            let parent_meta =
                fs::symlink_metadata(&parent_path).map_err(|_| UndoError::GitFailed)?;
            if !parent_meta.is_dir() || parent_meta.file_type().is_symlink() {
                return Err(UndoError::Stale);
            }
            image.backup = bucket.join(relative);
            if known_backups
                .insert(image.backup.clone(), image.digest.clone())
                .is_some_and(|previous| previous != image.digest)
            {
                return Err(UndoError::Stale);
            }
            let meta = fs::symlink_metadata(&image.backup).map_err(|_| UndoError::GitFailed)?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || (verify_contents && digest(&image.backup)? != image.digest)
            {
                return Err(UndoError::Stale);
            }
        }
        // Unknown files and symlinks make cleanup conservative. They are never followed.
        for entry in fs::read_dir(directory).map_err(|_| UndoError::GitFailed)? {
            let entry = entry.map_err(|_| UndoError::GitFailed)?;
            let name = entry.file_name();
            let name = name.to_str().ok_or(UndoError::Stale)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|_| UndoError::GitFailed)?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || !(name == "manifest.json"
                    || name == "restoring-from.json"
                    || (!name.is_empty() && name.bytes().all(|byte| byte.is_ascii_digit())))
            {
                return Err(UndoError::Stale);
            }
        }
        checkpoint.directory = directory.to_owned();
        Ok(checkpoint)
    }
    pub(super) fn recovery_copy_to(
        &self,
        directory: &Path,
        bucket: &Path,
    ) -> Result<(), UndoError> {
        let mut copied = self.clone();
        copied.directory = directory.to_owned();
        let mut files: BTreeMap<PathBuf, PathBuf> = BTreeMap::new();
        for image in copied
            .files
            .values_mut()
            .chain(copied.metadata.values_mut())
        {
            if let Some(backup) = files.get(&image.backup) {
                image.backup = backup.clone();
                continue;
            }
            let backup = directory.join(files.len().to_string());
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&backup)
                .map_err(|_| UndoError::GitFailed)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                output
                    .set_permissions(fs::Permissions::from_mode(0o600))
                    .map_err(|_| UndoError::GitFailed)?;
            }
            let mut input = fs::File::open(&image.backup).map_err(|_| UndoError::GitFailed)?;
            std::io::copy(&mut input, &mut output).map_err(|_| UndoError::GitFailed)?;
            output.sync_all().map_err(|_| UndoError::GitFailed)?;
            if digest(&backup)? != image.digest {
                return Err(UndoError::Stale);
            }
            files.insert(image.backup.clone(), backup.clone());
            image.backup = backup;
        }
        if directory.parent() != Some(bucket) {
            return Err(UndoError::Stale);
        }
        copied.recovery_persist()
    }

    pub(super) fn capture(repository: &Path, trees: &[String]) -> Result<Arc<Self>, UndoError> {
        Self::capture_paths(repository, trees, &BTreeSet::new(), None)
    }
    /// References and Git metadata, including the index, for operations that
    /// do not write working files. User hooks can require full coverage.
    pub(super) fn capture_refs(repository: &Path) -> Result<Arc<Self>, UndoError> {
        if hooks_require_full(repository, &["post-index-change", "reference-transaction"])? {
            return Self::capture(repository, &[]);
        }
        Self::capture_paths(repository, &[], &BTreeSet::new(), Some(BTreeSet::new()))
    }
    /// Exact disk-backed recovery for an operation with a known set of writes.
    /// References, integration metadata and the whole index are still protected.
    pub(super) fn capture_selected(
        repository: &Path,
        mut selected: BTreeSet<String>,
    ) -> Result<Arc<Self>, UndoError> {
        if hooks_require_full(repository, &["post-index-change", "reference-transaction"])? {
            return Self::capture_paths(repository, &[], &selected, None);
        }
        include_collisions(repository, &mut selected)?;
        Self::capture_paths(repository, &[], &BTreeSet::new(), Some(selected))
    }

    pub(super) fn capture_create_stash(
        repository: &Path,
        options: &super::stash::CreateStashOptions,
    ) -> Result<Arc<Self>, UndoError> {
        // Stash push cleans up local changes against HEAD; it cannot modify
        // clean tracked files. Keep all changed tracked paths, including both
        // ends of staged renames, for partial stashes and --keep-index too.
        if git_path(repository, "hooks/post-index-change")?.exists() {
            return Self::capture(repository, &["HEAD".to_owned()]);
        }
        let mut selected = local_changes(repository, false)?;
        if options.includes_untracked() {
            // A partial stash cannot remove untracked files outside its literal
            // selection. Avoid copying those files just because -u is enabled.
            let literal_paths = options.literal_paths();
            let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z"];
            if !literal_paths.is_empty() {
                args.push("--");
                args.extend(literal_paths.iter().map(String::as_str));
            }
            selected.extend(path_list(&output(repository, &args)?)?);
        }
        Self::capture_selected(repository, selected)
    }

    pub(super) fn capture_checkout(
        repository: &Path,
        target: &super::ref_write::RefTarget,
    ) -> Result<Arc<Self>, UndoError> {
        let mut trees = vec![target.revision()];
        if let super::ref_write::RefTarget::RemoteBranch { name, remote } = target {
            if let Some(local) = name.strip_prefix(&format!("{remote}/")) {
                let reference = format!("refs/heads/{local}");
                if command(repository)
                    .args(["rev-parse", "--verify", &reference])
                    .output()
                    .map_err(|_| UndoError::GitFailed)?
                    .status
                    .success()
                {
                    // Remote checkout can first switch to an existing local
                    // branch, then align it. Protect that intermediate tree too.
                    trees.push(reference);
                }
            }
        }
        // A user hook can write beyond the paths Git itself checks out.
        if checkout_requires_full(repository)? {
            return Self::capture(repository, &trees);
        }
        let mut selected = local_changes(repository, false)?;
        for tree in trees {
            selected.extend(changed_paths(repository, "HEAD", &tree)?);
        }
        Self::capture_selected(repository, selected)
    }

    pub(super) fn capture_stash(repository: &Path, stash: &str) -> Result<Arc<Self>, UndoError> {
        let mut selected = local_changes(repository, true)?;
        let base = format!("{stash}^1");
        let index = format!("{stash}^2");
        let mut trees = vec![stash.to_owned(), index.clone()];
        let mut incoming = changed_paths(repository, &base, stash)?;
        incoming.extend(changed_paths(repository, &base, &index)?);
        let branch_changes = changed_paths(repository, &base, "HEAD")?;
        let ours: BTreeSet<_> = branch_changes.union(&selected).cloned().collect();
        let incoming_additions = [&index, stash].iter().try_fold(false, |found, tree| {
            if found {
                return Ok(true);
            }
            output(
                repository,
                &[
                    "diff",
                    "--name-only",
                    "--no-renames",
                    "--diff-filter=A",
                    "-z",
                    &base,
                    tree,
                    "--",
                ],
            )
            .map(|paths| !paths.is_empty())
        })?;
        // Merge can infer directory renames or create conflict paths such as
        // file~Stashed changes. Keep full coverage when structure interacts
        // with the incoming changes; unrelated branch changes are not written.
        let needs_full = git_path(repository, "hooks/post-index-change")?.exists()
            || structural_interaction(repository, &["--cached"], &incoming, incoming_additions)?
            || structural_interaction(repository, &[], &incoming, incoming_additions)?
            || structural_interaction(repository, &[&base, "HEAD"], &incoming, incoming_additions)?
            || structural_interaction(repository, &[&base, stash], &ours, true)?
            || structural_interaction(repository, &[&base, &index], &ours, true)?;
        selected.extend(incoming);
        // The third parent contains untracked files. Capture their current
        // contents (including ignored collisions) or their absence before pop.
        let third = format!("{stash}^3");
        if command(repository)
            .args(["rev-parse", "--verify", &third])
            .output()
            .map_err(|_| UndoError::GitFailed)?
            .status
            .success()
        {
            trees.push(third.clone());
            selected.extend(path_list(&output(
                repository,
                &["ls-tree", "-r", "--name-only", "-z", &third],
            )?)?);
        }
        if needs_full {
            return Self::capture(repository, &trees);
        }
        Self::capture_selected(repository, selected)
    }

    pub(super) fn capture_stash_abort(repository: &Path) -> Result<Arc<Self>, UndoError> {
        let (trees, untracked) =
            super::stash::abort_restore_trees(repository).map_err(|_| UndoError::GitFailed)?;
        if git_path(repository, "hooks/post-index-change")?.exists() {
            return Self::capture(
                repository,
                &trees.into_iter().chain(untracked).collect::<Vec<_>>(),
            );
        }
        // reset --hard restores all dirty tracked paths; the recovery stash
        // can additionally recreate its working/index versions and untracked
        // parent. Include absent paths as well, so abort itself is reversible.
        let mut selected = local_changes(repository, true)?;
        selected.extend(conflicted_paths(repository)?);
        // reset --hard can overwrite paths hidden from status/diff by index
        // flags. Protect their raw contents too, even when ls-files -m omits
        // them. This includes populated sparse-checkout paths.
        selected.extend(hidden_index_paths(repository)?);
        for tree in trees {
            selected.extend(changed_paths(repository, "HEAD", &tree)?);
        }
        for tree in untracked {
            selected.extend(path_list(&output(
                repository,
                &["ls-tree", "-r", "--name-only", "-z", &tree],
            )?)?);
        }
        Self::capture_selected(repository, selected)
    }

    pub(super) fn capture_reset(
        repository: &Path,
        target: &str,
        mode: super::reset::ResetMode,
    ) -> Result<Arc<Self>, UndoError> {
        if mode != super::reset::ResetMode::Hard {
            return Self::capture_refs(repository);
        }
        Self::capture_restore(repository, target, false)
    }

    pub(super) fn capture_restore(
        repository: &Path,
        target: &str,
        untracked: bool,
    ) -> Result<Arc<Self>, UndoError> {
        let target_exists = command(repository)
            .args(["rev-parse", "--verify", target])
            .output()
            .map_err(|_| UndoError::GitFailed)?
            .status
            .success();
        if checkout_requires_full(repository)? {
            return Self::capture(
                repository,
                &if target_exists {
                    vec![target.to_owned()]
                } else {
                    Vec::new()
                },
            );
        }
        let mut selected = local_changes(repository, untracked)?;
        selected.extend(hidden_index_paths(repository)?);
        if command(repository)
            .args(["rev-parse", "--verify", "HEAD"])
            .output()
            .map_err(|_| UndoError::GitFailed)?
            .status
            .success()
        {
            selected.extend(changed_paths(repository, "HEAD", target)?);
        } else if target_exists {
            selected.extend(path_list(&output(
                repository,
                &["ls-tree", "-r", "--name-only", "-z", target],
            )?)?);
        }
        Self::capture_selected(repository, selected)
    }

    pub(super) fn capture_commit(repository: &Path) -> Result<Arc<Self>, UndoError> {
        if hooks_require_full(
            repository,
            &[
                "pre-commit",
                "prepare-commit-msg",
                "commit-msg",
                "post-commit",
                "post-rewrite",
                "post-index-change",
                "reference-transaction",
            ],
        )? || git_path(repository, "MERGE_AUTOSTASH")?.exists()
        {
            return Self::capture(repository, &[]);
        }
        Self::capture_refs(repository)
    }

    pub(super) fn capture_merge_abort(repository: &Path) -> Result<Arc<Self>, UndoError> {
        if git_path(repository, "MERGE_AUTOSTASH")?.exists() {
            return Self::capture(repository, &[]);
        }
        Self::capture_restore(repository, "ORIG_HEAD", true)
    }

    fn merge_scope(repository: &Path, target: &str) -> Result<Option<BTreeSet<String>>, UndoError> {
        if checkout_requires_full(repository)?
            || hooks_require_full(
                repository,
                &[
                    "pre-merge-commit",
                    "pre-commit",
                    "prepare-commit-msg",
                    "commit-msg",
                    "post-commit",
                    "post-rewrite",
                    "pre-rebase",
                ],
            )?
            || !local_changes(repository, false)?.is_empty()
            || !command(repository)
                .args(["merge-base", "--is-ancestor", "HEAD", target])
                .output()
                .map_err(|_| UndoError::GitFailed)?
                .status
                .success()
        {
            return Ok(None);
        }
        let mut selected = changed_paths(repository, "HEAD", target)?;
        selected.extend(hidden_index_paths(repository)?);
        Ok(Some(selected))
    }

    pub(super) fn capture_merge(repository: &Path, target: &str) -> Result<Arc<Self>, UndoError> {
        match Self::merge_scope(repository, target)? {
            Some(paths) => Self::capture_selected(repository, paths),
            None => Self::capture(repository, &[target.to_owned()]),
        }
    }

    /// Fetch has only changed refs/metadata. Add exactly one worktree capture
    /// before integration, preserving the original pre-fetch refs and metadata.
    pub(super) fn prepare_pull(
        repository: &Path,
        before: &mut Arc<Self>,
        target: &str,
        strategy: super::network::PullStrategy,
    ) -> Result<(), UndoError> {
        let mut scope =
            if before.scope.is_none() || strategy == super::network::PullStrategy::Rebase {
                None
            } else {
                Self::merge_scope(repository, target)?
            };
        if let Some(paths) = scope.as_mut() {
            include_collisions(repository, paths)?;
        }
        let mut names = match &scope {
            Some(paths) => paths.clone(),
            None => paths(repository, &[target.to_owned()])?,
        };
        if scope.is_none() {
            include_collisions(repository, &mut names)?;
        }
        let _guard = recovery_store::lock();
        let checkpoint = Arc::make_mut(before);
        for name in names {
            if checkpoint.files.contains_key(&name) {
                continue;
            }
            let path = safe_path(repository, &name)?;
            if fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) {
                continue;
            }
            if let Some(file) = image(
                &path,
                &checkpoint.directory,
                checkpoint.files.len() + checkpoint.metadata.len(),
            )? {
                checkpoint.files.insert(name, file);
            }
        }
        checkpoint.scope = scope;
        checkpoint.recovery_persist()?;
        recovery_store::register(before);
        Ok(())
    }

    pub(super) fn after(repository: &Path, before: &Self) -> Result<Arc<Self>, UndoError> {
        Self::capture_paths(
            repository,
            &[],
            &before.files.keys().cloned().collect(),
            before.scope.clone(),
        )
    }
    pub(super) fn after_refs(repository: &Path, before: &Self) -> Result<Arc<Self>, UndoError> {
        Self::after(repository, before)
    }
    fn capture_paths(
        repository: &Path,
        trees: &[String],
        extra: &BTreeSet<String>,
        scope: Option<BTreeSet<String>>,
    ) -> Result<Arc<Self>, UndoError> {
        recovery_store::cleanup_for_repository(repository);
        let _guard = recovery_store::lock();
        // All copies are private application data and survive an interrupted process.
        let (root, recovery) = recovery_store::location(repository)?;
        let temporary = tempfile::Builder::new()
            .prefix("checkpoint-")
            .tempdir_in(&root)
            .map_err(|_| UndoError::GitFailed)?;
        let directory = temporary.path().to_owned();
        let refs = references(repository)?;
        let mut files = BTreeMap::new();
        let mut selected = match &scope {
            Some(selected) => selected.clone(),
            None => paths(repository, trees)?,
        };
        if scope.is_none() {
            selected.extend(extra.iter().cloned());
            include_collisions(repository, &mut selected)?;
        }
        for name in selected.union(extra) {
            let path = safe_path(repository, &name)?;
            // An incoming file may currently be a directory. Its children are
            // captured separately; there is no file image at this path yet.
            if fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) {
                continue;
            }
            if let Some(file) = image(&path, &directory, files.len())? {
                files.insert(name.clone(), file);
            }
        }
        let mut metadata = BTreeMap::new();
        for (name, path) in metadata_paths(repository)? {
            if let Some(file) = image(&path, &directory, files.len() + metadata.len())? {
                metadata.insert(name, file);
            }
        }
        let index_signature = index_signature(repository)?;
        let snapshot = Self {
            directory,
            refs,
            files,
            metadata,
            index_signature,
            scope,
            recovery,
        };
        snapshot.verify(repository, &snapshot)?;
        snapshot.recovery_persist()?;
        if root.join("contents").exists() {
            recovery_store::sync_directory(&root.join("contents"))?;
        }
        recovery_store::sync_directory(&root)?;
        // Keep all referenced objects (including non-tip stashes) reachable during recovery.
        let mut objects: BTreeSet<String> = snapshot
            .refs
            .values()
            .filter_map(|r| {
                if let Reference::Direct(oid) = r {
                    Some(oid.clone())
                } else {
                    None
                }
            })
            .collect();
        if let Some(log) = snapshot.metadata.get("logs/refs/stash") {
            let bytes = fs::read_to_string(&log.backup).map_err(|_| UndoError::GitFailed)?;
            for line in bytes.lines() {
                for oid in line.split_whitespace().take(2) {
                    if !oid.bytes().all(|b| b == b'0') {
                        objects.insert(oid.to_owned());
                    }
                }
            }
        }
        let entries = output(repository, &["ls-files", "--stage", "-z"])?;
        let mut blobs = BTreeSet::new();
        for entry in entries.split(|b| *b == 0).filter(|e| !e.is_empty()) {
            let header = entry
                .split(|b| *b == b'\t')
                .next()
                .ok_or(UndoError::GitFailed)?;
            let words: Vec<_> = header.split(|b| *b == b' ').collect();
            if words.len() != 3 {
                return Err(UndoError::GitFailed);
            }
            if words[0] != b"160000" {
                blobs.insert(
                    String::from_utf8(words[1].to_vec()).map_err(|_| UndoError::GitFailed)?,
                );
            }
        }
        let mut tree = command(repository)
            .args(["mktree", "-z"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| UndoError::GitFailed)?;
        {
            let mut input = tree.stdin.take().ok_or(UndoError::GitFailed)?;
            for (i, oid) in blobs.iter().enumerate() {
                write!(input, "100644 blob {oid}\t{i}\0").map_err(|_| UndoError::GitFailed)?;
            }
        }
        let tree = tree.wait_with_output().map_err(|_| UndoError::GitFailed)?;
        if !tree.status.success() {
            return Err(UndoError::GitFailed);
        }
        objects.insert(
            String::from_utf8(tree.stdout)
                .map_err(|_| UndoError::GitFailed)?
                .trim()
                .to_owned(),
        );
        for name in [
            "ORIG_HEAD",
            "MERGE_HEAD",
            "MERGE_AUTOSTASH",
            "REBASE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "AUTO_MERGE",
            "rebase-merge/autostash",
            "rebase-apply/autostash",
        ] {
            if let Some(file) = snapshot.metadata.get(name) {
                for oid in fs::read_to_string(&file.backup)
                    .map_err(|_| UndoError::GitFailed)?
                    .lines()
                {
                    if (oid.len() == 40 || oid.len() == 64)
                        && oid.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        objects.insert(oid.to_owned());
                    }
                }
            }
        }
        // Share protection by object, just as file contents are shared. Creating
        // every branch/stash protection again per checkpoint made the private
        // ref namespace grow by hundreds of loose refs for each operation.
        // Legacy protections remain valid and are never deleted here.
        let protected = output(
            repository,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(objectname)%00%(symref)",
                "refs/gitthul/undo/objects/",
            ],
        )?;
        for line in std::str::from_utf8(&protected)
            .map_err(|_| UndoError::GitFailed)?
            .lines()
        {
            let mut fields = line.split('\0');
            let name = fields.next().ok_or(UndoError::GitFailed)?;
            let oid = fields.next().ok_or(UndoError::GitFailed)?;
            let symref = fields.next().ok_or(UndoError::GitFailed)?;
            if symref.is_empty() && name.strip_prefix("refs/gitthul/undo/objects/") == Some(oid) {
                objects.remove(oid);
            }
        }
        if objects.is_empty() {
            let _ = temporary.keep();
            let snapshot = Arc::new(snapshot);
            recovery_store::register(&snapshot);
            return Ok(snapshot);
        }
        // Idempotent updates also permit another worktree to have created the
        // same protection since the read above. Never dereference a symref.
        let mut input = String::from("start\n");
        for oid in &objects {
            input.push_str(&format!("update refs/gitthul/undo/objects/{oid} {oid}\n"));
        }
        input.push_str("prepare\ncommit\n");
        let (mut cmd, _hooks) = internal_ref_command(repository)?;
        let mut child = cmd
            .args(["update-ref", "--no-deref", "--stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| UndoError::GitFailed)?;
        child
            .stdin
            .take()
            .ok_or(UndoError::GitFailed)?
            .write_all(input.as_bytes())
            .map_err(|_| UndoError::GitFailed)?;
        if !child.wait().map_err(|_| UndoError::GitFailed)?.success() {
            return Err(UndoError::GitFailed);
        }
        let _ = temporary.keep();
        let snapshot = Arc::new(snapshot);
        recovery_store::register(&snapshot);
        Ok(snapshot)
    }
    pub(super) fn same(&self, other: &Self) -> bool {
        self.scope == other.scope
            && self.refs == other.refs
            && self.index_signature == other.index_signature
            && same_map(&self.files, &other.files)
            && same_map(
                &without_index(&self.metadata),
                &without_index(&other.metadata),
            )
    }
    fn verify(&self, repository: &Path, other: &Self) -> Result<(), UndoError> {
        if references(repository)? != self.refs
            || index_signature(repository)? != self.index_signature
        {
            return Err(UndoError::Stale);
        }
        if self.scope != other.scope {
            return Err(UndoError::Stale);
        }
        let current_paths = match &self.scope {
            Some(selected) => selected.clone(),
            None => paths(repository, &[])?,
        };
        // Added untracked files are never removed or overwritten without being part of the saved state.
        let names: BTreeSet<_> = current_paths
            .iter()
            .chain(self.files.keys())
            .chain(other.files.keys())
            .collect();
        for name in names {
            let path = safe_path(repository, name)?;
            verify_file(&path, self.files.get(name))?;
        }
        let current_meta = metadata_paths(repository)?;
        let names: BTreeSet<_> = current_meta
            .keys()
            .chain(self.metadata.keys())
            .chain(other.metadata.keys())
            .filter(|name| name.as_str() != "index")
            .map(String::as_str)
            .collect();
        let names: Vec<_> = names.into_iter().collect();
        for (name, path) in names.iter().zip(git_paths(repository, &names)?) {
            verify_file(&path, self.metadata.get(*name))?;
        }
        // A branch used by another worktree must never be rewound by this worktree.
        let worktrees = output(repository, &["worktree", "list", "--porcelain", "-z"])?;
        let root = fs::canonicalize(repository).map_err(|_| UndoError::GitFailed)?;
        let mut current_path = None;
        for field in worktrees.split(|b| *b == 0) {
            if let Some(path) = field.strip_prefix(b"worktree ") {
                current_path = Some(PathBuf::from(String::from_utf8_lossy(path).as_ref()));
            }
            if let Some(branch) = field.strip_prefix(b"branch ") {
                let branch = String::from_utf8_lossy(branch);
                if self.refs.get(branch.as_ref()) != other.refs.get(branch.as_ref())
                    && current_path
                        .as_ref()
                        .and_then(|p| fs::canonicalize(p).ok())
                        .as_ref()
                        != Some(&root)
                {
                    return Err(UndoError::Stale);
                }
            }
        }
        Ok(())
    }
    pub(super) fn apply(
        repository: &Path,
        expected: &Self,
        target: &Self,
    ) -> Result<(), UndoError> {
        let _guard = recovery_store::lock();
        expected.recovery_verify_repository(repository)?;
        target.recovery_verify_repository(repository)?;
        expected.verify(repository, target)?;
        for image in target.files.values().chain(target.metadata.values()) {
            if fs::symlink_metadata(&image.backup)
                .map_err(|_| UndoError::GitFailed)?
                .file_type()
                .is_symlink()
                || digest(&image.backup)? != image.digest
            {
                return Err(UndoError::Stale);
            }
        }
        let index_lock = FileLock::new(git_path(repository, "index.lock")?)?;
        let config_lock = FileLock::new(git_path(repository, "config.lock")?)?;
        let mut transaction = RefTransaction::prepare(repository, &expected.refs, &target.refs)?;
        expected.verify(repository, target)?;
        // A manifest identifies both sides even if the process is interrupted during restoration.
        let marker = expected.recovery_relative()?;
        recovery_store::write_json(&target.directory.join("restoring-from.json"), &marker)?;
        let result = restore_files(repository, &expected.files, &target.files, false)
            .and_then(|_| restore_files(repository, &expected.metadata, &target.metadata, true));
        if let Err(error) = result {
            let _ = restore_files(repository, &target.files, &expected.files, false);
            let _ = restore_files(repository, &target.metadata, &expected.metadata, true);
            return Err(error);
        }
        if let Err(error) = transaction.commit() {
            let _ = restore_files(repository, &target.files, &expected.files, false);
            let _ = restore_files(repository, &target.metadata, &expected.metadata, true);
            return Err(error);
        }
        if let Err(error) = restore_head(repository, &expected.refs, &target.refs) {
            if let Ok(mut rollback) =
                RefTransaction::prepare(repository, &target.refs, &expected.refs)
            {
                let _ = rollback.commit();
            }
            let _ = restore_files(repository, &target.files, &expected.files, false);
            let _ = restore_files(repository, &target.metadata, &expected.metadata, true);
            return Err(error);
        }
        // Git appends reflogs when committing refs. Stash order and messages need the exact saved log.
        if let Some(log) = target.metadata.get("logs/refs/stash") {
            install(&git_path(repository, "logs/refs/stash")?, log)?;
        } else {
            remove_file(&git_path(repository, "logs/refs/stash")?)?;
        }
        drop(config_lock);
        drop(index_lock);
        fs::remove_file(target.directory.join("restoring-from.json"))
            .map_err(|_| UndoError::GitFailed)?;
        recovery_store::sync_directory(&target.directory)?;
        Ok(())
    }
}
fn restore_head(
    repository: &Path,
    from: &BTreeMap<String, Reference>,
    to: &BTreeMap<String, Reference>,
) -> Result<(), UndoError> {
    if from.get("HEAD") == to.get("HEAD") {
        return Ok(());
    }
    let encode = |reference: Option<&Reference>| -> Result<String, UndoError> {
        match reference {
            Some(Reference::Symbolic(name)) => Ok(format!("ref: {name}\n")),
            Some(Reference::Direct(oid)) => Ok(format!("{oid}\n")),
            None => Err(UndoError::GitFailed),
        }
    };
    // update-ref reserves HEAD itself when updating its current branch. Its transaction
    // must finish first; index.lock still prevents checkout throughout the restoration.
    let mut lock = FileLock::new(git_path(repository, "HEAD.lock")?)?;
    let path = git_path(repository, "HEAD")?;
    if fs::read_to_string(&path).map_err(|_| UndoError::GitFailed)? != encode(from.get("HEAD"))? {
        return Err(UndoError::Stale);
    }
    lock._file
        .write_all(encode(to.get("HEAD"))?.as_bytes())
        .map_err(|_| UndoError::GitFailed)?;
    lock._file.sync_all().map_err(|_| UndoError::GitFailed)?;
    lock.install(&path)
}

fn without_index(map: &BTreeMap<String, Image>) -> BTreeMap<String, Image> {
    map.iter()
        .filter(|(name, _)| name.as_str() != "index")
        .map(|(name, image)| (name.clone(), image.clone()))
        .collect()
}
fn index_signature(repository: &Path) -> Result<String, UndoError> {
    let bytes = output(repository, &["ls-files", "--stage", "-v", "-z"])?;
    let mut hash = gix::hash::hasher(gix::hash::Kind::Sha1);
    hash.update(&bytes);
    hash.try_finalize()
        .map(|oid| oid.to_string())
        .map_err(|_| UndoError::GitFailed)
}

fn verify_file(path: &Path, expected: Option<&Image>) -> Result<(), UndoError> {
    match (fs::symlink_metadata(path), expected) {
        (Err(e), None)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(())
        }
        (Ok(meta), Some(image)) if meta.is_file() || meta.file_type().is_symlink() => {
            let mode = {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    meta.permissions().mode()
                }
                #[cfg(not(unix))]
                {
                    0
                }
            };
            if meta.file_type().is_symlink() == image.symlink
                && source_digest(path, image.symlink)? == image.digest
                && mode == image.mode
                && meta.permissions().readonly() == image.readonly
            {
                Ok(())
            } else {
                Err(UndoError::Stale)
            }
        }
        (Ok(meta), None) if meta.is_dir() => Ok(()),
        _ => Err(UndoError::Stale),
    }
}
fn remove_file(path: &Path) -> Result<(), UndoError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(())
        }
        Err(_) => Err(UndoError::GitFailed),
    }
}
fn install(path: &Path, image: &Image) -> Result<(), UndoError> {
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir()) {
        fs::remove_dir(path).map_err(|_| UndoError::Stale)?;
    }
    let parent = path.parent().ok_or(UndoError::GitFailed)?;
    fs::create_dir_all(parent).map_err(|_| UndoError::GitFailed)?;
    if image.symlink {
        let target = fs::read_to_string(&image.backup).map_err(|_| UndoError::GitFailed)?;
        let temporary = tempfile::tempdir_in(parent).map_err(|_| UndoError::GitFailed)?;
        let link = temporary.path().join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).map_err(|_| UndoError::GitFailed)?;
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &link).map_err(|_| UndoError::GitFailed)?;
        fs::rename(link, path).map_err(|_| UndoError::GitFailed)?;
        return Ok(());
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| UndoError::GitFailed)?;
    let mut file = fs::File::open(&image.backup).map_err(|_| UndoError::GitFailed)?;
    std::io::copy(&mut file, &mut temporary).map_err(|_| UndoError::GitFailed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(image.mode))
            .map_err(|_| UndoError::GitFailed)?;
    }
    #[cfg(not(unix))]
    {
        let mut permissions = temporary
            .as_file()
            .metadata()
            .map_err(|_| UndoError::GitFailed)?
            .permissions();
        permissions.set_readonly(image.readonly);
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|_| UndoError::GitFailed)?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| UndoError::GitFailed)?;
    temporary.persist(path).map_err(|_| UndoError::GitFailed)?;
    Ok(())
}
fn restore_files(
    repository: &Path,
    from: &BTreeMap<String, Image>,
    to: &BTreeMap<String, Image>,
    metadata: bool,
) -> Result<(), UndoError> {
    let resolve = |name: &str| {
        if metadata {
            git_path(repository, name)
        } else {
            safe_path(repository, name)
        }
    };
    for name in from.keys().rev().filter(|name| !to.contains_key(*name)) {
        let path = resolve(name)?;
        remove_file(&path)?;
        // Only remove empty directories created by the operation; unrelated files stop pruning.
        let boundary = if metadata {
            git_path(repository, "")?
        } else {
            repository.to_owned()
        };
        let mut parent = path.parent();
        while let Some(path) = parent {
            if path == boundary || !path.starts_with(&boundary) || fs::remove_dir(path).is_err() {
                break;
            }
            parent = path.parent();
        }
    }
    for (name, image) in to {
        if !from.get(name).is_some_and(|old| same_image(old, image)) {
            install(&resolve(name)?, image)?;
        }
    }
    Ok(())
}
struct FileLock {
    path: PathBuf,
    _file: fs::File,
    owned: bool,
}
impl FileLock {
    fn new(path: PathBuf) -> Result<Self, UndoError> {
        let file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|_| UndoError::Stale)?;
        Ok(Self {
            path,
            _file: file,
            owned: true,
        })
    }
}
impl FileLock {
    fn install(&mut self, target: &Path) -> Result<(), UndoError> {
        fs::rename(&self.path, target).map_err(|_| UndoError::GitFailed)?;
        self.owned = false;
        Ok(())
    }
}
impl Drop for FileLock {
    fn drop(&mut self) {
        if self.owned {
            let _ = fs::remove_file(&self.path);
        }
    }
}
struct RefTransaction {
    _hooks: tempfile::TempDir,
    child: Child,
    input: ChildStdin,
    reader: BufReader<ChildStdout>,
    committed: bool,
}
impl RefTransaction {
    fn prepare(
        repository: &Path,
        from: &BTreeMap<String, Reference>,
        to: &BTreeMap<String, Reference>,
    ) -> Result<Self, UndoError> {
        let (mut cmd, hooks) = internal_ref_command(repository)?;
        let mut child = cmd
            .args([
                "update-ref",
                "--stdin",
                "-m",
                "GitThul: recovery checkpoint",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(if cfg!(test) {
                Stdio::inherit()
            } else {
                Stdio::null()
            })
            .spawn()
            .map_err(|_| UndoError::GitFailed)?;
        let input = child.stdin.take().ok_or(UndoError::GitFailed)?;
        let reader = BufReader::new(child.stdout.take().ok_or(UndoError::GitFailed)?);
        let mut txn = Self {
            _hooks: hooks,
            child,
            input,
            reader,
            committed: false,
        };
        txn.send("start\n")?;
        txn.expect("start: ok")?;
        txn.send("option no-deref\n")?;
        let names: BTreeSet<_> = from.keys().chain(to.keys()).collect();
        for name in names {
            if name == "HEAD" {
                continue;
            }
            let old = from.get(name);
            let new = to.get(name);
            if old == new {
                continue;
            }
            let line = match (old, new) {
                (Some(Reference::Symbolic(old)), Some(Reference::Symbolic(new))) if old == new => {
                    format!("symref-verify {name} {old}\n")
                }
                (Some(Reference::Symbolic(old)), Some(Reference::Symbolic(new))) => {
                    format!("symref-update {name} {new} ref {old}\n")
                }
                (Some(Reference::Direct(old)), Some(Reference::Symbolic(new))) => {
                    format!("symref-update {name} {new} oid {old}\n")
                }
                (None, Some(Reference::Symbolic(new))) => format!("symref-create {name} {new}\n"),
                (Some(Reference::Symbolic(old)), None) => format!("symref-delete {name} {old}\n"),
                (Some(Reference::Direct(old)), Some(Reference::Direct(new))) if old == new => {
                    format!("verify {name} {old}\n")
                }
                (Some(Reference::Direct(old)), Some(Reference::Direct(new))) => {
                    format!("update {name} {new} {old}\n")
                }
                (None, Some(Reference::Direct(new))) => format!("create {name} {new}\n"),
                (Some(Reference::Direct(old)), None) => format!("delete {name} {old}\n"),
                (Some(Reference::Symbolic(_)), Some(Reference::Direct(new))) => {
                    format!("update {name} {new}\n")
                }
                (None, None) => continue,
            };
            txn.send("option no-deref\n")?;
            txn.send(&line)?;
        }
        txn.send("prepare\n")?;
        txn.expect("prepare: ok")?;
        Ok(txn)
    }
    fn send(&mut self, text: &str) -> Result<(), UndoError> {
        self.input
            .write_all(text.as_bytes())
            .and_then(|_| self.input.flush())
            .map_err(|_| UndoError::Stale)
    }
    fn expect(&mut self, expected: &str) -> Result<(), UndoError> {
        let mut line = String::new();
        self.reader
            .read_line(&mut line)
            .map_err(|_| UndoError::GitFailed)?;
        if line.trim() == expected {
            Ok(())
        } else {
            Err(UndoError::Stale)
        }
    }
    fn commit(&mut self) -> Result<(), UndoError> {
        self.send("commit\n")?;
        self.expect("commit: ok")?;
        self.committed = true;
        Ok(())
    }
}
impl Drop for RefTransaction {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.send("abort\n");
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::undo::UndoStacks;
    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-q", "-b", "main"]);
        git(dir.path(), &["config", "user.name", "Recovery test"]);
        git(
            dir.path(),
            &["config", "user.email", "recovery@example.invalid"],
        );
        fs::write(dir.path().join("a"), "base\n").unwrap();
        git(dir.path(), &["add", "."]);
        git(dir.path(), &["commit", "-qm", "base"]);
        dir
    }
    #[test]
    #[ignore = "manual profiling on an isolated copy of a supplied local repository"]
    fn local_repository_stash_performance() {
        let source = std::env::var("GITTHUL_STASH_BENCH_SOURCE").expect("local source repository");
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("repo");
        let p = p.as_path();
        git(
            dir.path(),
            &[
                "clone",
                "--shared",
                "--no-checkout",
                "-q",
                &source,
                p.to_str().unwrap(),
            ],
        );
        git(p, &["reset", "--hard", "-q", "HEAD"]);
        // Include accumulated protective refs and the exact stash stack.
        let source = Path::new(&source);
        let source_refs = text(
            source,
            &["for-each-ref", "--format=%(refname) %(objectname)"],
        );
        let clone_refs = text(p, &["for-each-ref", "--format=%(refname)"]);
        let mut input = String::from("start\n");
        let source_names: BTreeSet<_> = source_refs
            .lines()
            .map(|l| l.split_once(' ').unwrap().0)
            .collect();
        for reference in clone_refs.lines().filter(|r| !source_names.contains(r)) {
            input.push_str(&format!("delete {reference}\n"));
        }
        for reference in source_refs.lines() {
            input.push_str(&format!("update {reference}\n"));
        }
        input.push_str("prepare\ncommit\n");
        let mut child = command(p)
            .args(["update-ref", "--no-deref", "--stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success());
        fs::copy(
            git_path(source, "logs/refs/stash").unwrap(),
            git_path(p, "logs/refs/stash").unwrap(),
        )
        .unwrap();
        let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
        let options = serde_json::from_value(serde_json::json!({
            "drop": true, "expectedStash": oid,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        let start = std::time::Instant::now();
        let before = Checkpoint::capture_stash(p, &oid).unwrap();
        let capture = start.elapsed();
        let start = std::time::Instant::now();
        let result = super::super::stash::apply(p, 0, &options);
        let apply = start.elapsed();
        assert!(matches!(
            result,
            Err(super::super::stash::StashError::Conflict { .. })
        ));
        let start = std::time::Instant::now();
        let after = Checkpoint::after(p, &before).unwrap();
        let after_time = start.elapsed();
        eprintln!(
            "pop: before={capture:?} Git={apply:?} after={after_time:?}; files={}/{}; scope={:?}",
            before.files.len(),
            after.files.len(),
            before.scope.as_ref().map(BTreeSet::len)
        );
        let pop_stacks = UndoStacks::default();
        pop_stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.applyStash");
        cycle(p, &pop_stacks, &before, &after);
        let start = std::time::Instant::now();
        let abort_before = Checkpoint::capture_stash_abort(p).unwrap();
        let capture = start.elapsed();
        let start = std::time::Instant::now();
        super::super::operation::abort_operation(p).unwrap();
        let abort = start.elapsed();
        let start = std::time::Instant::now();
        let abort_after = Checkpoint::after(p, &abort_before).unwrap();
        eprintln!(
            "abort: before={capture:?} Git={abort:?} after={:?}; files={}/{}",
            start.elapsed(),
            abort_before.files.len(),
            abort_after.files.len()
        );
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint(
            "repo",
            abort_before.clone(),
            abort_after.clone(),
            "undo.abort",
        );
        cycle(p, &stacks, &abort_before, &abort_after);
        assert!(text(p, &["status", "--porcelain"]).is_empty());
        assert_eq!(text(p, &["rev-parse", "stash@{0}"]).trim(), oid);
    }

    #[test]
    #[ignore = "manual stash creation performance benchmark"]
    fn stash_creation_performance() {
        let dir = repo();
        let p = dir.path();
        for i in 0..2000 {
            fs::write(
                p.join(format!("file-{i}")),
                format!("{i}\n{}", "unchanged content\n".repeat(256)),
            )
            .unwrap();
        }
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "large tree"]);
        let oid = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
        for i in 0..200 {
            git(p, &["update-ref", &format!("refs/heads/branch-{i}"), &oid]);
        }
        fs::write(p.join("a"), "staged\n").unwrap();
        git(p, &["add", "a"]);
        fs::write(p.join("a"), "staged and working\n").unwrap();
        fs::write(p.join("untracked"), "new file\n").unwrap();
        let options = serde_json::from_value(serde_json::json!({
            "includeUntracked": true,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        let stacks = UndoStacks::default();
        let start = std::time::Instant::now();
        crate::git::create_stash_with_recovery("repo", p, &stacks, "saved", &options).unwrap();
        let elapsed = start.elapsed();
        let mut counts = Vec::new();
        for entry in fs::read_dir(git_path(p, "gitthul-recovery").unwrap())
            .unwrap()
            .flatten()
        {
            let manifest = entry.path().join("manifest.json");
            if manifest.exists() {
                let checkpoint: Checkpoint =
                    serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
                counts.push(checkpoint.files.len());
            }
        }
        counts.sort();
        eprintln!("stash creation including recovery and refs: {elapsed:?}; checkpoint file counts: {counts:?}");
        stacks.undo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(p.join("a")).unwrap(),
            "staged and working\n"
        );
        assert_eq!(text(p, &["show", ":a"]), "staged\n");
        assert!(p.join("untracked").exists());
        stacks.redo("repo", p).unwrap();
    }
    #[test]
    #[ignore = "manual conflicted stash pop performance benchmark"]
    fn conflicted_stash_pop_performance() {
        for unrelated_addition in [false, true] {
            let dir = repo();
            let p = dir.path();
            for i in 0..2000 {
                fs::write(
                    p.join(format!("file-{i}")),
                    format!("{i}\n{}", "unchanged content\n".repeat(256)),
                )
                .unwrap();
            }
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "large tree"]);
            fs::write(p.join("a"), "stash edit\n").unwrap();
            fs::write(p.join("from-stash"), "stash untracked\n").unwrap();
            git(p, &["stash", "push", "-qu", "-m", "saved"]);
            let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
            fs::write(p.join("a"), "branch edit\n").unwrap();
            if unrelated_addition {
                fs::write(p.join("unrelated-added"), "unrelated\n").unwrap();
            }
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "current branch"]);
            let options = serde_json::from_value(serde_json::json!({
                "drop": true, "expectedStash": oid,
                "precondition": super::super::status::reset_precondition(p),
            }))
            .unwrap();
            let stacks = UndoStacks::default();
            let start = std::time::Instant::now();
            let error =
                crate::git::apply_stash_with_recovery("repo", p, &stacks, 0, &options).unwrap_err();
            let elapsed = start.elapsed();
            assert_eq!(error.code, "stash.conflict");
            let mut counts = Vec::new();
            for entry in fs::read_dir(git_path(p, "gitthul-recovery").unwrap())
                .unwrap()
                .flatten()
            {
                let manifest = entry.path().join("manifest.json");
                if manifest.exists() {
                    let checkpoint: Checkpoint =
                        serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
                    counts.push(checkpoint.files.len());
                }
            }
            counts.sort();
            eprintln!("conflicted pop, unrelated addition={unrelated_addition}: {elapsed:?}; checkpoint files: {counts:?}");
            assert_eq!(
                super::super::stash::recovery_kind(p),
                Some(super::super::stash::StashRecoveryKind::Pop)
            );
            stacks.undo("repo", p).unwrap();
            assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "branch edit\n");
            assert!(!p.join("from-stash").exists());
            stacks.redo("repo", p).unwrap();
            super::super::stash::abort_recovery(p).unwrap();
            assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "branch edit\n");
        }
    }
    #[test]
    #[ignore = "manual recovery performance benchmark"]
    fn recovery_performance() {
        let dir = repo();
        let p = dir.path();
        for i in 0..2000 {
            fs::write(
                p.join(format!("file-{i}")),
                "unchanged content\n".repeat(256),
            )
            .unwrap();
        }
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "large tree"]);
        let oid = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
        for i in 0..200 {
            git(p, &["update-ref", &format!("refs/heads/branch-{i}"), &oid]);
        }
        let start = std::time::Instant::now();
        let before = Checkpoint::capture(p, &[]).unwrap();
        fs::write(p.join("a"), "resolved\n").unwrap();
        git(p, &["add", "a"]);
        let after = Checkpoint::after(p, &before).unwrap();
        eprintln!(
            "full checkpoint pair: {:?}; {} + {} files",
            start.elapsed(),
            before.files.len(),
            after.files.len()
        );
        // Start with empty storage again to measure the first scoped capture.
        fs::remove_dir_all(git_path(p, "gitthul-recovery").unwrap()).unwrap();
        let start = std::time::Instant::now();
        let before = Checkpoint::capture_selected(p, BTreeSet::from(["a".into()])).unwrap();
        fs::write(p.join("a"), "resolved again\n").unwrap();
        git(p, &["add", "a"]);
        let after = Checkpoint::after(p, &before).unwrap();
        eprintln!(
            "scoped checkpoint pair: {:?}; {} + {} files",
            start.elapsed(),
            before.files.len(),
            after.files.len()
        );
    }
    #[test]
    fn stash_creation_only_backs_up_changes_and_restores_every_option_combination() {
        for include_untracked in [false, true] {
            for keep_staged in [false, true] {
                for partial in [false, true] {
                    let dir = repo();
                    let p = dir.path();
                    fs::write(p.join("b"), "base b\n").unwrap();
                    fs::write(p.join("untouched"), "clean\n").unwrap();
                    git(p, &["add", "."]);
                    git(p, &["commit", "-qm", "fixture"]);
                    fs::write(p.join("a"), "staged a\n").unwrap();
                    fs::write(p.join("b"), "staged b\n").unwrap();
                    git(p, &["add", "a", "b"]);
                    fs::write(p.join("a"), "working a\n").unwrap();
                    fs::write(p.join("b"), "working b\n").unwrap();
                    fs::write(p.join("untracked"), "new file\n").unwrap();
                    let before_status = text(p, &["status", "--porcelain=v2", "-z"]);
                    let before_index = text(p, &["ls-files", "--stage", "-z"]);
                    let options = serde_json::from_value(serde_json::json!({
                        "includeUntracked": include_untracked,
                        "keepStaged": keep_staged,
                        "paths": if partial { Some(vec!["a"]) } else { None },
                        "precondition": super::super::status::reset_precondition(p),
                    }))
                    .unwrap();
                    let stacks = UndoStacks::default();
                    crate::git::create_stash_with_recovery("repo", p, &stacks, "saved", &options)
                        .unwrap();
                    let after_status = text(p, &["status", "--porcelain=v2", "-z"]);
                    let after_index = text(p, &["ls-files", "--stage", "-z"]);
                    for entry in fs::read_dir(git_path(p, "gitthul-recovery").unwrap())
                        .unwrap()
                        .flatten()
                    {
                        let manifest = entry.path().join("manifest.json");
                        if manifest.exists() {
                            let checkpoint: Checkpoint =
                                serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
                            let scope = checkpoint
                                .scope
                                .as_ref()
                                .expect("creation must use scoped recovery");
                            assert!(!checkpoint.files.contains_key("untouched"));
                            assert_eq!(scope.contains("untracked"), include_untracked && !partial);
                            assert!(scope.contains("a") && scope.contains("b"));
                        }
                    }
                    for _ in 0..2 {
                        stacks.undo("repo", p).unwrap();
                        assert_eq!(text(p, &["status", "--porcelain=v2", "-z"]), before_status);
                        assert_eq!(text(p, &["ls-files", "--stage", "-z"]), before_index);
                        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "working a\n");
                        assert_eq!(fs::read_to_string(p.join("b")).unwrap(), "working b\n");
                        assert_eq!(
                            fs::read_to_string(p.join("untracked")).unwrap(),
                            "new file\n"
                        );
                        assert!(text(p, &["stash", "list"]).is_empty());
                        stacks.redo("repo", p).unwrap();
                        assert_eq!(text(p, &["status", "--porcelain=v2", "-z"]), after_status);
                        assert_eq!(text(p, &["ls-files", "--stage", "-z"]), after_index);
                        assert_eq!(text(p, &["stash", "list"]).lines().count(), 1);
                    }
                }
            }
        }
    }

    #[test]
    fn stash_creation_recovers_staged_renames_deletions_and_recreated_paths() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join("deleted"), "base deleted\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "fixture"]);
        git(p, &["mv", "a", "renamed"]);
        fs::write(p.join("a"), "recreated original\n").unwrap();
        fs::write(p.join("renamed"), "renamed working\n").unwrap();
        fs::remove_file(p.join("deleted")).unwrap();
        let before_status = text(p, &["status", "--porcelain=v2", "-z"]);
        let before_index = text(p, &["ls-files", "--stage", "-z"]);
        let options = serde_json::from_value(serde_json::json!({
            "includeUntracked": false,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        let stacks = UndoStacks::default();
        crate::git::create_stash_with_recovery("repo", p, &stacks, "saved", &options).unwrap();
        stacks.undo("repo", p).unwrap();
        assert_eq!(text(p, &["status", "--porcelain=v2", "-z"]), before_status);
        assert_eq!(text(p, &["ls-files", "--stage", "-z"]), before_index);
        assert_eq!(
            fs::read_to_string(p.join("a")).unwrap(),
            "recreated original\n"
        );
        assert_eq!(
            fs::read_to_string(p.join("renamed")).unwrap(),
            "renamed working\n"
        );
        assert!(!p.join("deleted").exists());
        stacks.redo("repo", p).unwrap();
    }

    #[test]
    fn stash_creation_scopes_untracked_files_using_literal_git_paths() {
        let dir = repo();
        let p = dir.path();
        fs::create_dir(p.join("selected[1]")).unwrap();
        fs::create_dir(p.join("selected1")).unwrap();
        fs::write(p.join("selected[1]/new file"), "selected\n").unwrap();
        fs::write(p.join("selected1/unrelated"), "unrelated\n").unwrap();
        let options = serde_json::from_value(serde_json::json!({
            "includeUntracked": true,
            "paths": ["selected[1]"],
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        let before = Checkpoint::capture_create_stash(p, &options).unwrap();
        assert_eq!(
            before.scope.as_ref().unwrap(),
            &BTreeSet::from(["selected[1]/new file".to_owned()])
        );
        let stacks = UndoStacks::default();
        crate::git::create_stash_with_recovery("repo", p, &stacks, "saved", &options).unwrap();
        assert!(!p.join("selected[1]/new file").exists());
        fs::write(p.join("selected1/unrelated"), "later external edit\n").unwrap();
        stacks.undo("repo", p).unwrap();
        assert!(p.join("selected[1]/new file").exists());
        assert_eq!(
            fs::read_to_string(p.join("selected1/unrelated")).unwrap(),
            "later external edit\n"
        );
        stacks.redo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(p.join("selected1/unrelated")).unwrap(),
            "later external edit\n"
        );
    }

    #[test]
    fn selected_resolution_restores_unmerged_stages_and_preserves_unrelated_edits() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join("untouched"), "original\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "untouched"]);
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("a"), "topic\n").unwrap();
        git(p, &["commit", "-qam", "topic"]);
        git(p, &["switch", "-q", "main"]);
        fs::write(p.join("a"), "main\n").unwrap();
        git(p, &["commit", "-qam", "main"]);
        assert!(!command(p)
            .args(["merge", "topic"])
            .output()
            .unwrap()
            .status
            .success());
        let unresolved_index = text(p, &["ls-files", "--stage", "-z"]);
        let locks = crate::git::GitWriteLocks::default();
        let id = p.to_str().unwrap().to_owned();
        tauri::async_runtime::block_on(crate::git::run_resolve_write(
            id.clone(),
            locks.clone(),
            Some(vec!["a".to_owned()]),
            |p, id, snapshots| {
                super::super::resolve::content(p, id, "a", "resolved\n", snapshots).map(|_| None)
            },
        ))
        .unwrap();
        // Changes outside the declared write set are preserved, even after capture.
        fs::write(p.join("untouched"), "new local edit\n").unwrap();
        fs::write(p.join("new-untracked"), "private\n").unwrap();
        locks.undo.undo(&id, p).unwrap();
        assert_eq!(text(p, &["ls-files", "--stage", "-z"]), unresolved_index);
        assert!(p.join(".git/MERGE_HEAD").exists());
        locks.undo.redo(&id, p).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "resolved\n");
        assert_eq!(
            fs::read_to_string(p.join("untouched")).unwrap(),
            "new local edit\n"
        );
        assert_eq!(
            fs::read_to_string(p.join("new-untracked")).unwrap(),
            "private\n"
        );
        let root = git_path(p, "gitthul-recovery").unwrap();
        for entry in fs::read_dir(root).unwrap().flatten() {
            let manifest = entry.path().join("manifest.json");
            if manifest.exists() {
                let snapshot: Checkpoint =
                    serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
                assert_eq!(snapshot.scope, Some(BTreeSet::from(["a".to_owned()])));
                assert_eq!(snapshot.files.len(), 1);
            }
        }
    }

    #[test]
    fn selected_checkpoints_reject_collisions_staging_locks_and_damaged_backups() {
        for failure in ["collision", "staging", "lock", "backup"] {
            let dir = repo();
            let p = dir.path();
            let before =
                Checkpoint::capture_selected(p, BTreeSet::from(["created".into()])).unwrap();
            fs::write(p.join("created"), "new\n").unwrap();
            let after = Checkpoint::after(p, &before).unwrap();
            let stacks = UndoStacks::default();
            stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.resolve");
            stacks.undo("repo", p).unwrap();
            match failure {
                "collision" => fs::write(p.join("created"), "external edit\n").unwrap(),
                "staging" => {
                    fs::write(p.join("a"), "external edit\n").unwrap();
                    git(p, &["add", "a"]);
                }
                "lock" => fs::write(p.join(".git/index.lock"), "locked").unwrap(),
                "backup" => fs::write(&after.files["created"].backup, "damaged").unwrap(),
                _ => unreachable!(),
            }
            assert_eq!(stacks.redo("repo", p), Err(UndoError::Stale), "{failure}");
            assert_ne!(
                fs::read_to_string(p.join("created")).ok().as_deref(),
                Some("new\n")
            );
        }
    }

    #[test]
    fn stash_scope_covers_both_versions_and_untracked_parent() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join("untouched"), "unchanged\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "untouched"]);
        fs::write(p.join("a"), "staged\n").unwrap();
        git(p, &["add", "a"]);
        // The staged version differs but the working version matches the base.
        fs::write(p.join("a"), "base\n").unwrap();
        fs::write(p.join("from-stash"), "untracked\n").unwrap();
        git(p, &["stash", "push", "-qu", "-m", "saved"]);
        let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
        let before = Checkpoint::capture_stash(p, &oid).unwrap();
        assert!(!before.files.contains_key("untouched"));
        assert_eq!(
            before.scope.as_ref().unwrap(),
            &BTreeSet::from(["a".into(), "from-stash".into()])
        );
        let options = serde_json::from_value(serde_json::json!({
            "drop": true, "expectedStash": oid,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        super::super::stash::apply(p, 0, &options).unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.applyStash");
        git(p, &["gc", "--prune=now"]);
        cycle(p, &stacks, &before, &after);
        assert_eq!(
            fs::read_to_string(p.join("from-stash")).unwrap(),
            "untracked\n"
        );
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "base\n");
        assert!(text(p, &["stash", "list"]).is_empty());
        assert_eq!(text(p, &["show", ":a"]), "staged\n");
    }

    #[test]
    fn checkout_scope_preserves_local_changes_and_ignored_incoming_files() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join(".gitignore"), "incoming\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "ignore"]);
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("incoming"), "tracked incoming\n").unwrap();
        git(p, &["add", "-f", "incoming"]);
        git(p, &["commit", "-qm", "incoming"]);
        git(p, &["switch", "-q", "main"]);
        fs::write(p.join("incoming"), "local ignored\n").unwrap();
        fs::write(p.join("a"), "local working edit\n").unwrap();
        fs::write(p.join("unrelated-untracked"), "private\n").unwrap();
        let target = super::super::ref_write::RefTarget::Branch {
            name: "topic".into(),
        };
        let before = Checkpoint::capture_checkout(p, &target).unwrap();
        assert!(!before.files.contains_key(".gitignore"));
        assert!(!before.files.contains_key("unrelated-untracked"));
        let options = serde_json::from_value(serde_json::json!({"autoStash": true})).unwrap();
        super::super::ref_write::checkout(p, &target, &options).unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.checkoutState");
        stacks.undo("repo", p).unwrap();
        assert_eq!(text(p, &["branch", "--show-current"]).trim(), "main");
        assert_eq!(
            fs::read_to_string(p.join("incoming")).unwrap(),
            "local ignored\n"
        );
        stacks.redo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(p.join("incoming")).unwrap(),
            "tracked incoming\n"
        );
        assert_eq!(
            fs::read_to_string(p.join("a")).unwrap(),
            "local working edit\n"
        );
    }

    #[test]
    fn remote_checkout_scope_covers_the_intermediate_local_branch() {
        let dir = repo();
        let p = dir.path();
        let main = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("local-only"), "local branch\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "local-only"]);
        git(p, &["switch", "-q", "main"]);
        git(p, &["update-ref", "refs/remotes/origin/topic", &main]);
        let target = super::super::ref_write::RefTarget::RemoteBranch {
            name: "origin/topic".into(),
            remote: "origin".into(),
        };
        let before = Checkpoint::capture_checkout(p, &target).unwrap();
        assert!(before.scope.as_ref().unwrap().contains("local-only"));
        git(p, &["switch", "-q", "topic"]);
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.checkoutState");
        cycle(p, &stacks, &before, &after);
    }

    #[test]
    fn refs_only_capture_and_content_reuse_do_not_copy_working_files() {
        let dir = repo();
        let p = dir.path();
        let before = Checkpoint::capture_refs(p).unwrap();
        assert!(before.files.is_empty());
        git(p, &["branch", "created"]);
        let after = Checkpoint::after_refs(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.remote");
        cycle(p, &stacks, &before, &after);
        let first = Checkpoint::capture_selected(p, BTreeSet::from(["a".into()])).unwrap();
        let second = Checkpoint::after(p, &first).unwrap();
        assert_eq!(first.files["a"].backup, second.files["a"].backup);
        assert_eq!(fs::read_dir(&second.directory).unwrap().count(), 1); // manifest only
        fs::write(&first.files["a"].backup, "damaged").unwrap();
        assert!(matches!(
            Checkpoint::after(p, &first),
            Err(UndoError::Stale)
        ));
    }

    #[test]
    fn object_protection_is_shared_and_preserves_unreachable_index_blobs() {
        let dir = repo();
        let p = dir.path();
        let before = Checkpoint::capture_selected(p, BTreeSet::from(["a".into()])).unwrap();
        let protected = text(
            p,
            &[
                "for-each-ref",
                "--format=%(refname) %(objectname)",
                "refs/gitthul/undo/objects/",
            ],
        );
        let head = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
        let alias = format!("refs/gitthul/undo/objects/{head}");
        git(p, &["symbolic-ref", &alias, "refs/heads/main"]);
        let _same = Checkpoint::after(p, &before).unwrap();
        assert!(!command(p)
            .args(["symbolic-ref", "-q", &alias])
            .status()
            .unwrap()
            .success());
        assert_eq!(
            text(
                p,
                &[
                    "for-each-ref",
                    "--format=%(refname) %(objectname)",
                    "refs/gitthul/undo/objects/"
                ]
            ),
            protected
        );
        fs::write(p.join("a"), "index-only version\n").unwrap();
        git(p, &["add", "a"]);
        let blob = text(p, &["rev-parse", ":a"]).trim().to_owned();
        fs::write(p.join("a"), "working version\n").unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.resolve");
        stacks.undo("repo", p).unwrap();
        git(p, &["gc", "--prune=now"]);
        git(p, &["cat-file", "-e", &blob]);
        stacks.redo("repo", p).unwrap();
        assert_eq!(text(p, &["show", ":a"]), "index-only version\n");
        assert_eq!(
            fs::read_to_string(p.join("a")).unwrap(),
            "working version\n"
        );
    }

    #[test]
    fn content_conflict_keeps_partial_coverage_with_deleted_and_renamed_siblings() {
        let dir = repo();
        let p = dir.path();
        fs::create_dir(p.join("dir")).unwrap();
        for name in ["changed", "deleted", "renamed"] {
            fs::write(p.join("dir").join(name), format!("base {name}\n")).unwrap();
        }
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "directory"]);
        fs::write(p.join("dir/changed"), "stash edit\n").unwrap();
        git(p, &["stash", "push", "-q"]);
        let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
        git(p, &["rm", "dir/deleted"]);
        fs::create_dir(p.join("moved")).unwrap();
        git(p, &["mv", "dir/renamed", "moved/renamed"]);
        fs::write(p.join("dir/changed"), "branch edit\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "directory changes"]);
        let before = Checkpoint::capture_stash(p, &oid).unwrap();
        assert_eq!(before.scope, Some(BTreeSet::from(["dir/changed".into()])));
        let options = serde_json::from_value(serde_json::json!({
            "drop": true, "expectedStash": oid,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        let stacks = UndoStacks::default();
        assert_eq!(
            crate::git::apply_stash_with_recovery("repo", p, &stacks, 0, &options)
                .unwrap_err()
                .code,
            "stash.conflict"
        );
        assert_eq!(
            conflicted_paths(p).unwrap(),
            BTreeSet::from(["dir/changed".into()])
        );
        stacks.undo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(p.join("dir/changed")).unwrap(),
            "branch edit\n"
        );
        stacks.redo("repo", p).unwrap();
        assert!(!p.join("dir/deleted").exists());
        assert!(p.join("moved/renamed").exists());
        crate::git::operation_with_recovery("repo", p, &stacks, crate::git::OperationAction::Abort)
            .unwrap();
        stacks.undo("repo", p).unwrap();
        assert!(!conflicted_paths(p).unwrap().is_empty());
        stacks.redo("repo", p).unwrap();
        assert!(conflicted_paths(p).unwrap().is_empty());
    }

    #[test]
    fn abort_checkpoint_protects_edits_hidden_by_index_flags() {
        for flag in ["--assume-unchanged", "--skip-worktree"] {
            let dir = repo();
            let p = dir.path();
            fs::write(p.join("hidden"), "base\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "hidden file"]);
            fs::write(p.join("a"), "stash edit\n").unwrap();
            git(p, &["stash", "push", "-q"]);
            let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
            fs::write(p.join("a"), "branch edit\n").unwrap();
            git(p, &["commit", "-qam", "branch edit"]);
            git(p, &["update-index", flag, "hidden"]);
            fs::write(p.join("hidden"), "hidden local edit\n").unwrap();
            let options = serde_json::from_value(serde_json::json!({
                "drop": true, "expectedStash": oid,
                "precondition": super::super::status::reset_precondition(p),
            }))
            .unwrap();
            let stacks = UndoStacks::default();
            assert_eq!(
                crate::git::apply_stash_with_recovery("repo", p, &stacks, 0, &options)
                    .unwrap_err()
                    .code,
                "stash.conflict"
            );
            assert_eq!(
                fs::read_to_string(p.join("hidden")).unwrap(),
                "hidden local edit\n"
            );
            let before = Checkpoint::capture_stash_abort(p).unwrap();
            assert!(before.scope.as_ref().unwrap().contains("hidden"));
            crate::git::operation_with_recovery(
                "repo",
                p,
                &stacks,
                crate::git::OperationAction::Abort,
            )
            .unwrap();
            let aborted_content = fs::read_to_string(p.join("hidden")).unwrap();
            assert_eq!(
                aborted_content,
                if flag == "--assume-unchanged" {
                    "base\n"
                } else {
                    "hidden local edit\n"
                }
            );
            stacks.undo("repo", p).unwrap();
            assert_eq!(
                fs::read_to_string(p.join("hidden")).unwrap(),
                "hidden local edit\n"
            );
            assert!(!conflicted_paths(p).unwrap().is_empty());
            stacks.redo("repo", p).unwrap();
            assert_eq!(
                fs::read_to_string(p.join("hidden")).unwrap(),
                aborted_content
            );
        }
    }

    #[test]
    fn scoped_stash_abort_restores_wip_and_can_restore_the_conflict() {
        let dir = repo();
        let p = dir.path();
        for name in ["wip", "untouched", "removed"] {
            fs::write(p.join(name), format!("base {name}\n")).unwrap();
        }
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "other files"]);
        fs::write(p.join("a"), "stash edit\n").unwrap();
        fs::write(p.join("from-stash"), "incoming untracked\n").unwrap();
        git(p, &["stash", "push", "-qu"]);
        let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
        fs::write(p.join("a"), "branch edit\n").unwrap();
        git(p, &["commit", "-qam", "branch edit"]);
        fs::write(p.join("wip"), "staged\n").unwrap();
        git(p, &["add", "wip"]);
        fs::write(p.join("wip"), "working\n").unwrap();
        fs::remove_file(p.join("removed")).unwrap();
        fs::write(p.join("pre-untracked"), "existing\n").unwrap();
        let before_index = text(p, &["ls-files", "--stage", "-z"]);
        let before_status = text(p, &["status", "--porcelain=v2", "-z"]);
        let options = serde_json::from_value(serde_json::json!({
            "drop": true, "expectedStash": oid,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        let stacks = UndoStacks::default();
        assert_eq!(
            crate::git::apply_stash_with_recovery("repo", p, &stacks, 0, &options)
                .unwrap_err()
                .code,
            "stash.conflict"
        );
        let conflict_index = text(p, &["ls-files", "--stage", "-z"]);
        let conflict_content = fs::read(p.join("a")).unwrap();
        let before_abort = Checkpoint::capture_stash_abort(p).unwrap();
        assert!(!before_abort.scope.as_ref().unwrap().contains("untouched"));
        assert_eq!(
            before_abort.scope.as_ref().unwrap(),
            &BTreeSet::from([
                "a".into(),
                "wip".into(),
                "removed".into(),
                "from-stash".into(),
                "pre-untracked".into()
            ])
        );
        crate::git::operation_with_recovery("repo", p, &stacks, crate::git::OperationAction::Abort)
            .unwrap();
        assert_eq!(text(p, &["ls-files", "--stage", "-z"]), before_index);
        assert_eq!(text(p, &["status", "--porcelain=v2", "-z"]), before_status);
        assert_eq!(fs::read_to_string(p.join("wip")).unwrap(), "working\n");
        assert!(!p.join("from-stash").exists());
        assert!(!p.join("removed").exists());
        git(p, &["gc", "--prune=now"]);
        stacks.undo("repo", p).unwrap();
        assert_eq!(text(p, &["ls-files", "--stage", "-z"]), conflict_index);
        assert_eq!(fs::read(p.join("a")).unwrap(), conflict_content);
        assert_eq!(
            fs::read_to_string(p.join("from-stash")).unwrap(),
            "incoming untracked\n"
        );
        assert!(super::super::stash::recovery_kind(p).is_some());
        stacks.redo("repo", p).unwrap();
        assert!(super::super::stash::recovery_kind(p).is_none());
        assert_eq!(text(p, &["rev-parse", "stash@{0}"]).trim(), oid);
        assert_eq!(text(p, &["status", "--porcelain=v2", "-z"]), before_status);
    }

    #[test]
    fn conflicted_pop_does_not_capture_unrelated_branch_changes() {
        for finish in [false, true] {
            let dir = repo();
            let p = dir.path();
            fs::create_dir(p.join("unrelated")).unwrap();
            fs::write(p.join("unrelated/deleted"), "old\n").unwrap();
            fs::write(p.join("unrelated/modified"), "old\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "other files"]);
            fs::write(p.join("a"), "stash edit\n").unwrap();
            git(p, &["add", "a"]);
            fs::write(p.join("from-stash"), "new\n").unwrap();
            git(p, &["stash", "push", "-qu"]);
            let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
            fs::write(p.join("a"), "branch edit\n").unwrap();
            fs::remove_file(p.join("unrelated/deleted")).unwrap();
            fs::write(p.join("unrelated/modified"), "branch edit\n").unwrap();
            fs::write(p.join("unrelated/added"), "added\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "diverged"]);
            let options = serde_json::from_value(serde_json::json!({
                "drop": true, "expectedStash": oid,
                "precondition": super::super::status::reset_precondition(p),
            }))
            .unwrap();
            let stacks = UndoStacks::default();
            assert_eq!(
                crate::git::apply_stash_with_recovery("repo", p, &stacks, 0, &options)
                    .unwrap_err()
                    .code,
                "stash.conflict"
            );
            let conflicted_index = fs::read(p.join(".git/index")).unwrap();
            let conflicted_file = fs::read(p.join("a")).unwrap();
            for entry in fs::read_dir(git_path(p, "gitthul-recovery").unwrap())
                .unwrap()
                .flatten()
            {
                let manifest = entry.path().join("manifest.json");
                if manifest.exists() {
                    let checkpoint: Checkpoint =
                        serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
                    assert_eq!(
                        checkpoint.scope,
                        Some(BTreeSet::from(["a".into(), "from-stash".into()]))
                    );
                    assert!(checkpoint.files.len() <= 2);
                }
            }
            // An edit outside the write set survives both directions.
            fs::write(p.join("unrelated/modified"), "later edit\n").unwrap();
            stacks.undo("repo", p).unwrap();
            assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "branch edit\n");
            assert!(!p.join("from-stash").exists());
            assert!(super::super::stash::recovery_kind(p).is_none());
            stacks.redo("repo", p).unwrap();
            assert_eq!(fs::read(p.join(".git/index")).unwrap(), conflicted_index);
            assert_eq!(fs::read(p.join("a")).unwrap(), conflicted_file);
            assert_eq!(fs::read_to_string(p.join("from-stash")).unwrap(), "new\n");
            assert_eq!(
                fs::read_to_string(p.join("unrelated/modified")).unwrap(),
                "later edit\n"
            );
            assert!(!p.join("unrelated/deleted").exists());
            assert_eq!(
                fs::read_to_string(p.join("unrelated/added")).unwrap(),
                "added\n"
            );
            assert_eq!(text(p, &["rev-parse", "stash@{0}"]).trim(), oid);
            if finish {
                fs::write(p.join("a"), "resolved\n").unwrap();
                git(p, &["add", "a"]);
                for action in [
                    crate::git::OperationAction::Continue,
                    crate::git::OperationAction::Quit,
                ] {
                    let before_finish = Checkpoint::capture_refs(p).unwrap();
                    assert!(before_finish.files.is_empty());
                    crate::git::operation_with_recovery("repo", p, &stacks, action).unwrap();
                    let after_finish = Checkpoint::after(p, &before_finish).unwrap();
                    assert!(text(p, &["stash", "list"]).is_empty());
                    assert_eq!(text(p, &["show", ":a"]), "resolved\n");
                    cycle(p, &stacks, &before_finish, &after_finish);
                    stacks.undo("repo", p).unwrap();
                    assert!(super::super::stash::recovery_kind(p).is_some());
                    assert_eq!(text(p, &["rev-parse", "stash@{0}"]).trim(), oid);
                }
                stacks.redo("repo", p).unwrap();
            } else {
                super::super::stash::abort_recovery(p).unwrap();
                assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "branch edit\n");
                assert!(!p.join("from-stash").exists());
                assert_eq!(text(p, &["rev-parse", "stash@{0}"]).trim(), oid);
            }
            assert!(super::super::stash::recovery_kind(p).is_none());
        }
    }

    #[test]
    fn directory_renames_interacting_with_sibling_additions_keep_full_coverage() {
        for stash_renames in [false, true] {
            let dir = repo();
            let p = dir.path();
            fs::create_dir(p.join("old-dir")).unwrap();
            fs::write(p.join("old-dir/file"), "base\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "directory"]);
            if stash_renames {
                git(p, &["mv", "old-dir", "new-dir"]);
            } else {
                fs::write(p.join("old-dir/added"), "incoming\n").unwrap();
                git(p, &["add", "."]);
            }
            git(p, &["stash", "push", "-q"]);
            let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
            if stash_renames {
                fs::write(p.join("old-dir/added"), "incoming\n").unwrap();
                git(p, &["add", "."]);
            } else {
                git(p, &["mv", "old-dir", "new-dir"]);
            }
            git(p, &["commit", "-qm", "current branch"]);
            let before = Checkpoint::capture_stash(p, &oid).unwrap();
            assert!(before.scope.is_none());
            let _ = command(p).args(["stash", "apply", &oid]).output().unwrap();
            assert!(p.join("new-dir/added").exists());
            let after = Checkpoint::after(p, &before).unwrap();
            let stacks = UndoStacks::default();
            stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.applyStash");
            cycle(p, &stacks, &before, &after);
        }
    }

    #[test]
    fn file_directory_conflicts_keep_merge_generated_paths_recoverable() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join("a"), "stash edit\n").unwrap();
        git(p, &["stash", "push", "-q"]);
        let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
        git(p, &["rm", "a"]);
        fs::create_dir(p.join("a")).unwrap();
        fs::write(p.join("a/file"), "directory\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "file becomes directory"]);
        let before = Checkpoint::capture_stash(p, &oid).unwrap();
        assert!(before.scope.is_none());
        let options = serde_json::from_value(serde_json::json!({
            "drop": true, "expectedStash": oid,
            "precondition": super::super::status::reset_precondition(p),
        }))
        .unwrap();
        assert!(matches!(
            super::super::stash::apply(p, 0, &options),
            Err(super::super::stash::StashError::Conflict { .. })
        ));
        let after = Checkpoint::after(p, &before).unwrap();
        assert!(after.files.keys().any(|path| path.starts_with("a~")));
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.applyStash");
        cycle(p, &stacks, &before, &after);
        crate::git::operation_with_recovery("repo", p, &stacks, crate::git::OperationAction::Abort)
            .unwrap();
        assert!(p.join("a/file").exists());
        stacks.undo("repo", p).unwrap();
        assert!(conflicted_paths(p)
            .unwrap()
            .iter()
            .any(|path| path.starts_with("a~")));
        stacks.redo("repo", p).unwrap();
        assert!(conflicted_paths(p).unwrap().is_empty());
    }

    #[test]
    fn divergent_stash_with_structural_changes_keeps_full_coverage() {
        let dir = repo();
        let p = dir.path();
        fs::create_dir(p.join("old-dir")).unwrap();
        fs::write(p.join("old-dir/file"), "base\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "directory"]);
        fs::write(p.join("old-dir/file"), "stash edit\n").unwrap();
        git(p, &["stash", "push", "-q"]);
        let oid = text(p, &["rev-parse", "stash@{0}"]).trim().to_owned();
        git(p, &["mv", "old-dir", "new-dir"]);
        git(p, &["commit", "-qm", "rename directory"]);
        let before = Checkpoint::capture_stash(p, &oid).unwrap();
        assert!(before.scope.is_none());
        assert!(before.files.contains_key("new-dir/file"));
        let _ = command(p).args(["stash", "apply", &oid]).output().unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.applyStash");
        cycle(p, &stacks, &before, &after);
    }

    #[cfg(unix)]
    #[test]
    fn checkout_with_custom_hook_protects_its_other_writes() {
        use std::os::unix::fs::PermissionsExt;
        let dir = repo();
        let p = dir.path();
        git(p, &["branch", "topic"]);
        fs::create_dir(p.join("custom-hooks")).unwrap();
        let hook = p.join("custom-hooks/post-checkout");
        fs::write(&hook, "#!/bin/sh\nprintf 'hook edit\\n' > a\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        git(p, &["config", "core.hooksPath", "custom-hooks"]);
        let target = super::super::ref_write::RefTarget::Branch {
            name: "topic".into(),
        };
        assert!(matches!(
            super::super::ref_write::checkout_undo_strategy(p, &target, &Default::default(),),
            super::super::ref_write::CheckoutUndoStrategy::Checkpoint
        ));
        let before = Checkpoint::capture_checkout(p, &target).unwrap();
        assert!(before.scope.is_none());
        git(p, &["switch", "-q", "topic"]);
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "hook edit\n");
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.checkoutState");
        cycle(p, &stacks, &before, &after);
    }

    #[test]
    fn linked_worktree_metadata_and_partial_failures_remain_recoverable() {
        let dir = repo();
        let other = tempfile::tempdir().unwrap();
        let p = other.path().join("linked");
        git(
            dir.path(),
            &["worktree", "add", "-qb", "topic", p.to_str().unwrap()],
        );
        let before = Checkpoint::capture_selected(&p, BTreeSet::from(["a".into()])).unwrap();
        let stacks = UndoStacks::default();
        let result: Result<(), crate::git::GitCommandError> = crate::git::with_prepared_checkpoint(
            "repo",
            &p,
            &stacks,
            "undo.resolve",
            before,
            || {
                fs::write(p.join("a"), "partial write\n").unwrap();
                Err(crate::git::GitCommandError::internal("partial failure"))
            },
        );
        assert!(result.is_err());
        stacks.undo("repo", &p).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "base\n");
        stacks.redo("repo", &p).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "partial write\n");
        assert_eq!(fs::read_to_string(dir.path().join("a")).unwrap(), "base\n");
    }

    fn git(path: &Path, args: &[&str]) {
        assert!(
            command(path).args(args).status().unwrap().success(),
            "{args:?}"
        );
    }
    fn text(path: &Path, args: &[&str]) -> String {
        String::from_utf8(output(path, args).unwrap()).unwrap()
    }
    fn step(path: &Path, stacks: &UndoStacks, args: &[&str], trees: &[String]) {
        let before = Checkpoint::capture(path, trees).unwrap();
        git(path, args);
        let after = Checkpoint::after(path, &before).unwrap();
        stacks.remember_checkpoint("repo", before, after, "undo.reset");
    }
    fn cycle(path: &Path, stacks: &UndoStacks, before: &Checkpoint, after: &Checkpoint) {
        for _ in 0..2 {
            stacks.undo("repo", path).unwrap();
            before.verify(path, after).unwrap();
            stacks.redo("repo", path).unwrap();
            after.verify(path, before).unwrap();
        }
    }
    #[test]
    fn reset_modes_recover_head_index_worktree_and_untracked_exactly() {
        for mode in ["--soft", "--mixed", "--hard"] {
            let dir = repo();
            let p = dir.path();
            let base = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
            fs::create_dir(p.join("nested")).unwrap();
            fs::write(p.join("nested/b"), "new\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "second"]);
            fs::write(p.join("a"), "staged\n").unwrap();
            git(p, &["add", "a"]);
            fs::write(p.join("a"), "working\n").unwrap();
            fs::write(p.join("untracked"), [0, 255, 3]).unwrap();
            let reset_mode = match mode {
                "--soft" => super::super::reset::ResetMode::Soft,
                "--mixed" => super::super::reset::ResetMode::Mixed,
                _ => super::super::reset::ResetMode::Hard,
            };
            let before = Checkpoint::capture_reset(p, &base, reset_mode).unwrap();
            if reset_mode != super::super::reset::ResetMode::Hard {
                assert!(before.files.is_empty());
            }
            assert!(!before.files.contains_key("untracked"));
            let stacks = UndoStacks::default();
            crate::git::reset_with_recovery(
                "repo",
                p,
                &stacks,
                &base,
                reset_mode,
                "main",
                &super::super::status::reset_precondition(p),
            )
            .unwrap();
            let after = Checkpoint::after(p, &before).unwrap();
            cycle(p, &stacks, &before, &after);
        }
    }

    #[test]
    fn discard_all_recovers_both_layers_deletions_and_unborn_files() {
        for unborn in [false, true] {
            let dir = repo();
            let p = dir.path();
            if unborn {
                git(p, &["checkout", "--orphan", "unborn"]);
            } else {
                fs::write(p.join("untouched"), "keep\n").unwrap();
                fs::write(p.join("removed"), "restore\n").unwrap();
                git(p, &["add", "."]);
                git(p, &["commit", "-qm", "other files"]);
                fs::remove_file(p.join("removed")).unwrap();
                git(p, &["add", "removed"]);
            }
            fs::write(p.join("a"), "staged\n").unwrap();
            git(p, &["add", "a"]);
            fs::write(p.join("a"), "working\n").unwrap();
            fs::write(p.join("new"), [0, 255, 1]).unwrap();
            let before = Checkpoint::capture_restore(p, "HEAD", true).unwrap();
            assert!(!before.files.contains_key("untouched"));
            let index = text(p, &["ls-files", "--stage", "-z"]);
            let stacks = UndoStacks::default();
            crate::git::discard_all_with_recovery(
                "repo",
                p,
                &stacks,
                &super::super::status::reset_precondition(p),
            )
            .unwrap();
            let after = Checkpoint::after(p, &before).unwrap();
            assert!(!p.join("new").exists());
            if unborn {
                assert!(!p.join("a").exists());
            } else {
                assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "base\n");
                assert_eq!(fs::read_to_string(p.join("removed")).unwrap(), "restore\n");
                fs::write(p.join("untouched"), "later edit\n").unwrap();
            }
            cycle(p, &stacks, &before, &after);
            stacks.undo("repo", p).unwrap();
            assert_eq!(text(p, &["ls-files", "--stage", "-z"]), index);
            assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "working\n");
            assert_eq!(fs::read(p.join("new")).unwrap(), [0, 255, 1]);
            if !unborn {
                assert_eq!(
                    fs::read_to_string(p.join("untouched")).unwrap(),
                    "later edit\n"
                );
                assert!(!p.join("removed").exists());
            }
        }
    }

    #[test]
    fn fast_forward_merge_only_recovers_incoming_paths() {
        let dir = repo();
        let p = dir.path();
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("incoming"), "topic\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "topic"]);
        git(p, &["switch", "-q", "main"]);
        let before = Checkpoint::capture_merge(p, "topic").unwrap();
        assert_eq!(before.scope, Some(BTreeSet::from(["incoming".into()])));
        assert!(before.files.is_empty());
        let stacks = UndoStacks::default();
        crate::git::with_prepared_checkpoint(
            "repo",
            p,
            &stacks,
            "undo.merge",
            before.clone(),
            || {
                git(p, &["merge", "--ff-only", "topic"]);
                Ok(())
            },
        )
        .unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        fs::write(p.join("a"), "later edit\n").unwrap();
        cycle(p, &stacks, &before, &after);
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "later edit\n");
        // WIP/autostash and divergent integrations have a less predictable write set.
        assert!(Checkpoint::capture_merge(p, "topic")
            .unwrap()
            .scope
            .is_none());
        git(p, &["commit", "-qam", "diverged"]);
        assert!(Checkpoint::capture_merge(p, "topic")
            .unwrap()
            .scope
            .is_none());
    }

    #[test]
    fn incoming_file_directory_collisions_preserve_ignored_children() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join(".gitignore"), "incoming\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "ignore"]);
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("incoming"), "topic\n").unwrap();
        git(p, &["add", "-f", "incoming"]);
        git(p, &["commit", "-qm", "incoming"]);
        git(p, &["switch", "-q", "main"]);
        fs::create_dir(p.join("incoming")).unwrap();
        fs::write(p.join("incoming/private"), "ignored content\n").unwrap();
        let before = Checkpoint::capture_merge(p, "topic").unwrap();
        assert!(before.files.contains_key("incoming/private"));
        // Git may refuse such a collision. Exercise exact recovery for either
        // implementation of the write, without relying on that refusal.
        fs::remove_dir_all(p.join("incoming")).unwrap();
        git(p, &["merge", "--ff-only", "topic"]);
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.merge");
        cycle(p, &stacks, &before, &after);
        stacks.undo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(p.join("incoming/private")).unwrap(),
            "ignored content\n"
        );
    }

    #[test]
    fn pull_expands_once_and_preserves_the_pre_fetch_references() {
        for strategy in [
            super::super::network::PullStrategy::Merge,
            super::super::network::PullStrategy::Rebase,
        ] {
            let dir = repo();
            let p = dir.path();
            let base = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
            git(p, &["update-ref", "refs/remotes/origin/main", &base]);
            git(p, &["switch", "-qc", "topic"]);
            fs::write(p.join("incoming"), "topic\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "topic"]);
            let target = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
            git(p, &["switch", "-q", "main"]);
            let mut before = Checkpoint::capture_refs(p).unwrap();
            let directory = before.directory.clone();
            assert!(before.files.is_empty());
            git(p, &["update-ref", "refs/remotes/origin/main", &target]);
            Checkpoint::prepare_pull(p, &mut before, "refs/remotes/origin/main", strategy).unwrap();
            assert_eq!(before.directory, directory);
            assert_eq!(
                before.refs["refs/remotes/origin/main"],
                Reference::Direct(base.clone())
            );
            if strategy == super::super::network::PullStrategy::Merge {
                assert_eq!(before.scope, Some(BTreeSet::from(["incoming".into()])));
            } else {
                assert!(before.scope.is_none());
                assert!(before.files.contains_key("a"));
            }
            git(p, &["merge", "--ff-only", "refs/remotes/origin/main"]);
            let after = Checkpoint::after(p, &before).unwrap();
            let stacks = UndoStacks::default();
            stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.pull");
            cycle(p, &stacks, &before, &after);
            stacks.undo("repo", p).unwrap();
            assert_eq!(
                text(p, &["rev-parse", "refs/remotes/origin/main"]).trim(),
                base
            );
            assert!(!p.join("incoming").exists());
        }
    }

    #[test]
    fn closing_merge_recovers_metadata_without_copying_the_worktree() {
        for action in [
            crate::git::OperationAction::Continue,
            crate::git::OperationAction::Quit,
            crate::git::OperationAction::Abort,
        ] {
            let dir = repo();
            let p = dir.path();
            git(p, &["switch", "-qc", "topic"]);
            fs::write(p.join("a"), "topic\n").unwrap();
            git(p, &["commit", "-qam", "topic"]);
            git(p, &["switch", "-q", "main"]);
            fs::write(p.join("a"), "main\n").unwrap();
            git(p, &["commit", "-qam", "main"]);
            assert!(!command(p)
                .args(["merge", "topic"])
                .output()
                .unwrap()
                .status
                .success());
            fs::write(p.join("a"), "resolved\n").unwrap();
            git(p, &["add", "a"]);
            let before = match action {
                crate::git::OperationAction::Abort => Checkpoint::capture_merge_abort(p),
                crate::git::OperationAction::Continue => Checkpoint::capture_commit(p),
                _ => Checkpoint::capture_refs(p),
            }
            .unwrap();
            if !matches!(action, crate::git::OperationAction::Abort) {
                assert!(before.files.is_empty());
            }
            let stacks = UndoStacks::default();
            crate::git::operation_with_recovery("repo", p, &stacks, action).unwrap();
            let after = Checkpoint::after(p, &before).unwrap();
            assert!(!git_path(p, "MERGE_HEAD").unwrap().exists());
            cycle(p, &stacks, &before, &after);
            stacks.undo("repo", p).unwrap();
            assert!(git_path(p, "MERGE_HEAD").unwrap().exists());
            assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "resolved\n");
        }
    }

    #[test]
    fn stage_and_unstage_recovery_preserve_subsequent_worktree_edits() {
        for integrating in [false, true] {
            let dir = repo();
            let p = dir.path();
            if integrating {
                let head = text(p, &["rev-parse", "HEAD"]);
                fs::write(git_path(p, "MERGE_HEAD").unwrap(), head).unwrap();
            }
            fs::write(p.join("a"), "staged\n").unwrap();
            let before_index = text(p, &["ls-files", "--stage", "-z"]);
            let locks = crate::git::GitWriteLocks::default();
            let id = p.to_string_lossy().to_string();
            tauri::async_runtime::block_on(crate::git::run_local_write(
                id.clone(),
                locks.clone(),
                "undo.stage",
                vec!["a".into()],
                |p| super::super::write::stage(p, &["a".into()]),
            ))
            .unwrap();
            let staged_index = text(p, &["ls-files", "--stage", "-z"]);
            fs::write(p.join("a"), "later edit\n").unwrap();
            locks.undo.undo(&id, p).unwrap();
            assert_eq!(text(p, &["ls-files", "--stage", "-z"]), before_index);
            locks.undo.redo(&id, p).unwrap();
            assert_eq!(text(p, &["ls-files", "--stage", "-z"]), staged_index);
            tauri::async_runtime::block_on(crate::git::run_local_write(
                id.clone(),
                locks.clone(),
                "undo.unstage",
                vec!["a".into()],
                |p| super::super::write::unstage(p, &["a".into()]),
            ))
            .unwrap();
            locks.undo.undo(&id, p).unwrap();
            assert_eq!(text(p, &["ls-files", "--stage", "-z"]), staged_index);
            locks.undo.redo(&id, p).unwrap();
            assert_eq!(text(p, &["ls-files", "--stage", "-z"]), before_index);
            assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "later edit\n");
        }
    }

    #[test]
    fn merge_autostash_abort_keeps_full_coverage_and_objects_alive() {
        let dir = repo();
        let p = dir.path();
        fs::write(p.join("wip"), "base\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "other file"]);
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("a"), "topic\n").unwrap();
        git(p, &["commit", "-qam", "topic"]);
        git(p, &["switch", "-q", "main"]);
        fs::write(p.join("a"), "main\n").unwrap();
        git(p, &["commit", "-qam", "main"]);
        fs::write(p.join("wip"), "local work\n").unwrap();
        assert!(!command(p)
            .args(["merge", "--autostash", "topic"])
            .output()
            .unwrap()
            .status
            .success());
        let autostash = fs::read_to_string(git_path(p, "MERGE_AUTOSTASH").unwrap()).unwrap();
        let before = Checkpoint::capture_merge_abort(p).unwrap();
        assert!(before.scope.is_none());
        assert!(Checkpoint::capture_commit(p).unwrap().scope.is_none());
        let stacks = UndoStacks::default();
        crate::git::operation_with_recovery("repo", p, &stacks, crate::git::OperationAction::Abort)
            .unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        assert_eq!(fs::read_to_string(p.join("wip")).unwrap(), "local work\n");
        git(p, &["gc", "--prune=now"]);
        git(p, &["cat-file", "-e", autostash.trim()]);
        cycle(p, &stacks, &before, &after);
        stacks.undo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(git_path(p, "MERGE_AUTOSTASH").unwrap()).unwrap(),
            autostash
        );
        assert!(!conflicted_paths(p).unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn reference_hooks_run_for_user_writes_but_never_internal_recovery() {
        use std::os::unix::fs::PermissionsExt;
        let dir = repo();
        let p = dir.path();
        let hook = git_path(p, "hooks/reference-transaction").unwrap();
        fs::write(&hook, "#!/bin/sh\nprintf 'hook edit\\n' >> a\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        let before = Checkpoint::capture_refs(p).unwrap();
        assert!(before.scope.is_none());
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "base\n");
        git(p, &["branch", "topic"]);
        let content = fs::read_to_string(p.join("a")).unwrap();
        assert!(content.contains("hook edit\n"));
        let after = Checkpoint::after(p, &before).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), content);
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.branch");
        cycle(p, &stacks, &before, &after);
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), content);
    }
    #[test]
    fn merge_rebase_cherry_pick_and_revert_are_reversible() {
        for op in ["merge", "rebase", "cherry-pick", "revert"] {
            let dir = repo();
            let p = dir.path();
            git(p, &["switch", "-qc", "topic"]);
            fs::write(p.join("b"), "topic\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "topic"]);
            let topic = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
            git(p, &["switch", "-q", "main"]);
            fs::write(p.join("c"), "main\n").unwrap();
            git(p, &["add", "."]);
            git(p, &["commit", "-qm", "main"]);
            let target = if op == "revert" {
                "HEAD".to_owned()
            } else {
                topic
            };
            let before = Checkpoint::capture(p, std::slice::from_ref(&target)).unwrap();
            let stacks = UndoStacks::default();
            let args = if op == "revert" {
                vec![op, "--no-edit", &target]
            } else if op == "merge" {
                vec![op, "--no-edit", &target]
            } else {
                vec![op, &target]
            };
            step(p, &stacks, &args, std::slice::from_ref(&target));
            let after = Checkpoint::after(p, &before).unwrap();
            cycle(p, &stacks, &before, &after);
        }
    }
    #[test]
    fn stash_push_pop_drop_and_rename_restore_the_entire_stack() {
        for args in [
            vec!["stash", "push", "-u", "-m", "saved"],
            vec!["stash", "pop", "--index"],
            vec!["stash", "drop", "stash@{1}"],
        ] {
            let dir = repo();
            let p = dir.path();
            for i in 0..3 {
                fs::write(p.join("a"), format!("stash {i}\n")).unwrap();
                git(p, &["stash", "push", "-qm", &format!("stash {i}")]);
            }
            if args[1] == "push" {
                fs::write(p.join("a"), "staged\n").unwrap();
                git(p, &["add", "a"]);
                fs::write(p.join("a"), "working\n").unwrap();
                fs::write(p.join("new"), "untracked\n").unwrap();
            }
            let before = Checkpoint::capture(p, &[]).unwrap();
            let stacks = UndoStacks::default();
            step(p, &stacks, &args, &[]);
            let after = Checkpoint::after(p, &before).unwrap();
            git(p, &["gc", "--prune=now"]);
            cycle(p, &stacks, &before, &after);
        }
        let dir = repo();
        let p = dir.path();
        fs::write(p.join("a"), "saved\n").unwrap();
        git(p, &["stash", "push", "-qm", "old name"]);
        let before = Checkpoint::capture(p, &[]).unwrap();
        let oid = text(p, &["rev-parse", "refs/stash"]).trim().to_owned();
        crate::git::stash::rename(p, 0, &oid, "new name").unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.renameStash");
        cycle(p, &stacks, &before, &after);
    }
    #[test]
    fn conflicted_merge_and_abort_restore_conflicts_and_can_continue() {
        let dir = repo();
        let p = dir.path();
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("a"), "topic\n").unwrap();
        git(p, &["commit", "-qam", "topic"]);
        git(p, &["switch", "-q", "main"]);
        fs::write(p.join("a"), "main\n").unwrap();
        git(p, &["commit", "-qam", "main"]);
        let before = Checkpoint::capture(p, &[]).unwrap();
        assert!(!command(p)
            .args(["merge", "topic"])
            .status()
            .unwrap()
            .success());
        let conflicted = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), conflicted.clone(), "undo.merge");
        cycle(p, &stacks, &before, &conflicted);
        step(p, &stacks, &["merge", "--abort"], &[]);
        stacks.undo("repo", p).unwrap();
        conflicted.verify(p, &before).unwrap();
        fs::write(p.join("a"), "resolved\n").unwrap();
        git(p, &["add", "a"]);
        git(p, &["commit", "-qm", "resolved"]);
    }
    #[test]
    fn recovery_refuses_new_edits_collisions_and_index_locks() {
        let dir = repo();
        let p = dir.path();
        let stacks = UndoStacks::default();
        step(p, &stacks, &["reset", "--hard", "HEAD"], &[]);
        fs::write(p.join("a"), "change\n").unwrap();
        git(p, &["commit", "-qam", "change"]);
        let old = text(p, &["rev-parse", "HEAD"]).trim().to_owned();
        step(p, &stacks, &["reset", "--hard", "HEAD~1"], &[]);
        fs::write(p.join("new"), "never remove\n").unwrap();
        assert_eq!(stacks.undo("repo", p), Err(UndoError::Stale));
        assert_eq!(fs::read_to_string(p.join("new")).unwrap(), "never remove\n");
        fs::remove_file(p.join("new")).unwrap();
        fs::write(p.join(".git/index.lock"), "external lock").unwrap();
        assert_eq!(stacks.undo("repo", p), Err(UndoError::Stale));
        fs::remove_file(p.join(".git/index.lock")).unwrap();
        stacks.undo("repo", p).unwrap();
        assert_eq!(text(p, &["rev-parse", "HEAD"]).trim(), old);
    }
    #[test]
    fn an_interrupted_rebase_can_be_undone_redone_and_continued() {
        let dir = repo();
        let p = dir.path();
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("a"), "topic\n").unwrap();
        git(p, &["commit", "-qam", "topic"]);
        git(p, &["switch", "-q", "main"]);
        fs::write(p.join("a"), "main\n").unwrap();
        git(p, &["commit", "-qam", "main"]);
        let before = Checkpoint::capture(p, &[]).unwrap();
        assert!(!command(p)
            .args(["rebase", "topic"])
            .status()
            .unwrap()
            .success());
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.rebase");
        cycle(p, &stacks, &before, &after);
        fs::write(p.join("a"), "resolved\n").unwrap();
        git(p, &["add", "a"]);
        git(p, &["-c", "core.editor=true", "rebase", "--continue"]);
        assert!(!p.join(".git/rebase-merge").exists());
    }

    #[test]
    fn checkout_and_branch_reset_restore_the_original_symbolic_head() {
        let dir = repo();
        let p = dir.path();
        git(p, &["switch", "-qc", "topic"]);
        fs::write(p.join("a"), "topic\n").unwrap();
        git(p, &["commit", "-qam", "topic"]);
        git(p, &["switch", "-q", "main"]);
        let before = Checkpoint::capture(p, &[]).unwrap();
        git(p, &["switch", "-q", "topic"]);
        git(p, &["reset", "--hard", "main"]);
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.checkoutState");
        cycle(p, &stacks, &before, &after);
    }

    #[test]
    fn refreshing_index_stat_information_does_not_disable_recovery() {
        let dir = repo();
        let p = dir.path();
        let stacks = UndoStacks::default();
        fs::write(p.join("a"), "second\n").unwrap();
        git(p, &["commit", "-qam", "second"]);
        step(p, &stacks, &["reset", "--hard", "HEAD~1"], &[]);
        git(p, &["status", "--porcelain"]);
        stacks.undo("repo", p).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "second\n");
    }

    #[test]
    fn damaged_backups_are_rejected_before_any_repository_write() {
        let dir = repo();
        let p = dir.path();
        let before = Checkpoint::capture(p, &[]).unwrap();
        fs::write(p.join("a"), "changed\n").unwrap();
        git(p, &["commit", "-qam", "changed"]);
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before.clone(), after.clone(), "undo.terminal");
        fs::write(&before.files["a"].backup, "damaged").unwrap();
        assert_eq!(stacks.undo("repo", p), Err(UndoError::Stale));
        after.verify(p, &after).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_recovery_never_writes_to_its_external_target() {
        let dir = repo();
        let p = dir.path();
        let external = tempfile::tempdir().unwrap();
        let target = external.path().join("private");
        fs::write(&target, "private\n").unwrap();
        std::os::unix::fs::symlink(&target, p.join("link")).unwrap();
        git(p, &["add", "link"]);
        git(p, &["commit", "-qm", "link"]);
        let before = Checkpoint::capture(p, &[]).unwrap();
        let stacks = UndoStacks::default();
        step(p, &stacks, &["reset", "--hard", "HEAD~1"], &[]);
        let after = Checkpoint::after(p, &before).unwrap();
        cycle(p, &stacks, &before, &after);
        assert_eq!(fs::read_to_string(target).unwrap(), "private\n");
    }

    #[test]
    fn a_terminal_session_records_a_recoverable_local_checkpoint() {
        let dir = repo();
        let p = dir.path();
        let locks = crate::git::GitWriteLocks::default();
        let ticket = crate::git::begin_terminal_recovery(p.to_str().unwrap(), locks.clone())
            .unwrap()
            .unwrap();
        fs::write(p.join("a"), "terminal\n").unwrap();
        git(p, &["commit", "-qam", "terminal"]);
        ticket.finish();
        let id = fs::canonicalize(p).unwrap().to_string_lossy().to_string();
        locks.undo.undo(&id, p).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "base\n");
        locks.undo.redo(&id, p).unwrap();
        assert_eq!(fs::read_to_string(p.join("a")).unwrap(), "terminal\n");
    }

    #[test]
    fn pull_saves_an_ignored_file_before_the_incoming_tree_replaces_it() {
        let dir = repo();
        let p = dir.path();
        let remote = tempfile::tempdir().unwrap();
        git(remote.path(), &["init", "--bare", "-q", "-b", "main"]);
        fs::write(p.join(".gitignore"), "private\n").unwrap();
        git(p, &["add", ".gitignore"]);
        git(p, &["commit", "-qm", "ignore"]);
        git(
            p,
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        git(p, &["push", "-qu", "origin", "main"]);
        let other = tempfile::tempdir().unwrap();
        git(
            other.path(),
            &["clone", "-q", remote.path().to_str().unwrap(), "."],
        );
        git(other.path(), &["config", "user.name", "Other"]);
        git(
            other.path(),
            &["config", "user.email", "other@example.invalid"],
        );
        fs::write(other.path().join("private"), "incoming\n").unwrap();
        git(other.path(), &["add", "-f", "private"]);
        git(other.path(), &["commit", "-qm", "incoming"]);
        git(other.path(), &["push", "-q"]);
        fs::write(p.join("private"), "local ignored\n").unwrap();
        let mut before = Checkpoint::capture_refs(p).unwrap();
        let mut prepare = |tree: &str, strategy| {
            Checkpoint::prepare_pull(p, &mut before, tree, strategy)
                .map_err(|_| crate::git::network::NetworkError::GitFailed)
        };
        crate::git::network::pull_configured(
            p,
            &crate::git::network::PullOptions::default(),
            "pull-recovery-test",
            tauri::ipc::Channel::new(|_| Ok(())),
            &crate::git::network::NetworkProcesses::default(),
            None,
            Some(&mut prepare),
        )
        .unwrap();
        let after = Checkpoint::after(p, &before).unwrap();
        let stacks = UndoStacks::default();
        stacks.remember_checkpoint("repo", before, after, "undo.pull");
        let published = text(remote.path(), &["rev-parse", "refs/heads/main"]);
        stacks.undo("repo", p).unwrap();
        assert_eq!(
            fs::read_to_string(p.join("private")).unwrap(),
            "local ignored\n"
        );
        stacks.redo("repo", p).unwrap();
        assert_eq!(fs::read_to_string(p.join("private")).unwrap(), "incoming\n");
        assert_eq!(
            text(remote.path(), &["rev-parse", "refs/heads/main"]),
            published
        );
    }
}

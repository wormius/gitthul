//! Exact local snapshots. Never run reset --hard or clean to recover user files.
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use super::{
    status,
    undo::{git_text, UndoError},
};

const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
struct FileImage {
    bytes: Vec<u8>,
    permissions: fs::Permissions,
}

#[derive(Clone, Debug)]
pub(super) struct LocalSnapshot {
    head_ref: Option<String>,
    state: status::CommitPrecondition,
    index: Option<FileImage>,
    files: BTreeMap<String, Option<FileImage>>,
}

fn read_file(path: &Path, remaining: &mut u64) -> Result<Option<FileImage>, UndoError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(UndoError::GitFailed),
    };
    // Symlinks, directories and oversized files require a different recovery strategy.
    if !meta.is_file() || meta.len() > *remaining {
        return Err(UndoError::GitFailed);
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| UndoError::GitFailed)?
        .take(*remaining + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UndoError::GitFailed)?;
    *remaining = remaining
        .checked_sub(bytes.len() as u64)
        .ok_or(UndoError::GitFailed)?;
    Ok(Some(FileImage {
        bytes,
        permissions: meta.permissions(),
    }))
}

fn index_path(repository: &Path) -> Result<PathBuf, UndoError> {
    let path =
        git_text(repository, &["rev-parse", "--git-path", "index"]).ok_or(UndoError::GitFailed)?;
    Ok(repository.join(path))
}

fn safe_path(repository: &Path, name: &str) -> Result<PathBuf, UndoError> {
    super::diff::validate_path(name).map_err(|_| UndoError::Stale)?;
    let mut path = repository.to_path_buf();
    for part in Path::new(name).components() {
        if part
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
        {
            return Err(UndoError::Stale);
        }
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(UndoError::Stale),
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(UndoError::GitFailed),
        }
    }
    Ok(path)
}

impl LocalSnapshot {
    pub(super) fn capture(repository: &Path, paths: &[String]) -> Result<Self, UndoError> {
        let mut remaining = MAX_BYTES;
        let state = status::commit_precondition(repository);
        if state.index_tree.is_none() {
            return Err(UndoError::GitFailed);
        }
        let index = read_file(&index_path(repository)?, &mut remaining)?;
        let mut files = BTreeMap::new();
        for name in paths {
            if !files.contains_key(name) {
                let image = read_file(&safe_path(repository, name)?, &mut remaining)?;
                // A discard can replace a tiny working file with a much larger staged blob.
                // Reserve that size before writing, so the resulting snapshot also fits.
                if let Some(size) = git_text(repository, &["cat-file", "-s", &format!(":{name}")]) {
                    let size: u64 = size.parse().map_err(|_| UndoError::GitFailed)?;
                    let current_size = image.as_ref().map_or(0, |image| image.bytes.len() as u64);
                    remaining = remaining
                        .checked_sub(size.saturating_sub(current_size))
                        .ok_or(UndoError::GitFailed)?;
                }
                files.insert(name.clone(), image);
            }
        }
        Ok(Self {
            head_ref: git_text(repository, &["symbolic-ref", "-q", "HEAD"]),
            state,
            index,
            files,
        })
    }

    pub(super) fn same(&self, other: &Self) -> bool {
        self.head_ref == other.head_ref
            && self.state == other.state
            && self.files.len() == other.files.len()
            && self.files.iter().all(|(name, value)| {
                other
                    .files
                    .get(name)
                    .is_some_and(|other| same_file(value, other))
            })
    }

    pub(super) fn apply(
        repository: &Path,
        expected: &Self,
        target: &Self,
    ) -> Result<(), UndoError> {
        let paths: Vec<_> = expected.files.keys().cloned().collect();
        let index_path = index_path(repository)?;
        let lock_path = index_path.with_file_name("index.lock");
        let mut lock = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| UndoError::Stale)?;
        let mut owns_lock = true;
        let result = (|| {
            let current = Self::capture(repository, &paths)?;
            if !expected.same(&current) {
                return Err(UndoError::Stale);
            }
            // Prepare every replacement before modifying any original file.
            let mut replacements = Vec::new();
            for (name, image) in &target.files {
                let path = safe_path(repository, name)?;
                if same_file(image, &current.files[name]) {
                    continue;
                }
                let temporary = if let Some(image) = image {
                    let parent = path.parent().ok_or(UndoError::Stale)?;
                    if !parent.is_dir() {
                        return Err(UndoError::Stale);
                    }
                    Some(prepare(parent, image)?)
                } else {
                    None
                };
                replacements.push((name, path, temporary));
            }
            if let Some(image) = &target.index {
                lock.write_all(&image.bytes)
                    .map_err(|_| UndoError::GitFailed)?;
                lock.set_permissions(image.permissions.clone())
                    .map_err(|_| UndoError::GitFailed)?;
                lock.sync_all().map_err(|_| UndoError::GitFailed)?;
            }
            if !expected.same(&Self::capture(repository, &paths)?) {
                return Err(UndoError::Stale);
            }
            let mut changed = Vec::new();
            for (name, path, temporary) in replacements {
                let result = match temporary {
                    Some(temporary) => temporary
                        .persist(&path)
                        .map(|_| ())
                        .map_err(|_| UndoError::GitFailed),
                    None => fs::remove_file(&path).map_err(|_| UndoError::GitFailed),
                };
                if result.is_err() {
                    rollback(repository, &current, &changed);
                    return result;
                }
                changed.push(name.clone());
            }
            // Discard does not alter the index; do not replace it unnecessarily.
            if expected.state.index_tree != target.state.index_tree {
                let result = if target.index.is_some() {
                    let renamed = fs::rename(&lock_path, &index_path);
                    if renamed.is_ok() {
                        owns_lock = false;
                    }
                    renamed
                } else {
                    fs::remove_file(&index_path)
                };
                if result.is_err() {
                    rollback(repository, &current, &changed);
                    return Err(UndoError::GitFailed);
                }
            }
            Ok(())
        })();
        drop(lock);
        if owns_lock {
            let _ = fs::remove_file(lock_path);
        }
        result
    }
}

fn same_file(a: &Option<FileImage>, b: &Option<FileImage>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.bytes == b.bytes && a.permissions == b.permissions,
        _ => false,
    }
}

fn prepare(parent: &Path, image: &FileImage) -> Result<tempfile::NamedTempFile, UndoError> {
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| UndoError::GitFailed)?;
    temporary
        .write_all(&image.bytes)
        .map_err(|_| UndoError::GitFailed)?;
    temporary
        .as_file()
        .set_permissions(image.permissions.clone())
        .map_err(|_| UndoError::GitFailed)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| UndoError::GitFailed)?;
    Ok(temporary)
}

fn rollback(repository: &Path, snapshot: &LocalSnapshot, names: &[String]) {
    // The original snapshots stay in the undo stack even if the filesystem stops accepting writes.
    for name in names.iter().rev() {
        if let Ok(path) = safe_path(repository, name) {
            if let Some(image) = &snapshot.files[name] {
                if let Some(parent) = path.parent() {
                    if let Ok(file) = prepare(parent, image) {
                        let _ = file.persist(path);
                    }
                }
            } else {
                let _ = fs::remove_file(path);
            }
        }
    }
}

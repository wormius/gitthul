//! Autonomous repository backups. No manifest depends on the source Git object database.
//! Storage is content addressed, compressed, private and separate from operation recovery.
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const CHUNK_BYTES: usize = 1024 * 1024;
const MANIFEST_BYTES: u64 = 32 * 1024 * 1024;
const COMMAND_BYTES: u64 = 64 * 1024 * 1024;
const DAY: u64 = 24 * 60 * 60 * 1000;
const VERSION: u32 = 1;
#[cfg(test)]
thread_local! { static READ_BYTES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct BackupPolicy {
    pub enabled: bool,
    #[serde(rename = "maxMiB")]
    pub max_mi_b: u64,
}
impl Default for BackupPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_mi_b: 1024,
        }
    }
}
impl BackupPolicy {
    pub(crate) fn validate(&self) -> Result<(), BackupError> {
        if !(1..=1_048_576).contains(&self.max_mi_b) {
            return Err(BackupError::InvalidPath);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BackupError {
    Cancelled,
    Changed,
    NoSpace,
    Incomplete,
    InvalidPath,
    Corrupt,
    GitFailed,
    Io,
}
impl From<std::io::Error> for BackupError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}
impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for BackupError {}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupPoint {
    pub id: String,
    pub repository_id: String,
    pub repository_path: PathBuf,
    pub repository_name: String,
    /// UTC Unix milliseconds, independent of the machine timezone.
    pub created_at: u64,
    /// Compressed bytes referenced by this point (shared chunks count only once here).
    pub size_bytes: u64,
    pub file_count: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupCatalog {
    pub total_bytes: u64,
    pub points: Vec<BackupPoint>,
    pub corrupt_points: usize,
}
#[derive(Clone, Debug)]
pub(crate) enum CaptureOutcome {
    Created { point: BackupPoint },
    Unchanged,
    TooSoon { next_at: u64 },
    NoSpace,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    point: BackupPoint,
    fingerprint: String,
    #[serde(default)]
    source_signature: String,
    #[serde(default)]
    chunk_signatures: BTreeMap<String, String>,
    entries: Vec<Entry>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    #[serde(default)]
    source_stamp: String,
    path: Vec<u8>,
    mode: u32,
    content: Content,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Content {
    Directory,
    File {
        size: u64,
        digest: String,
        chunks: Vec<String>,
    },
    Symlink {
        target: Vec<u8>,
        #[serde(default)]
        directory: bool,
    },
}
#[derive(Clone)]
enum Source {
    Directory,
    File(PathBuf),
    Bytes(Vec<u8>),
    Symlink { target: Vec<u8>, directory: bool },
}
#[derive(Clone)]
struct SourceEntry {
    mode: u32,
    source: Source,
}
type Sources = BTreeMap<Vec<u8>, SourceEntry>;

/// A single scheduler owns this instance; its gate also serializes restore and deletion.
/// Native callers run these methods on spawn_blocking, never on the window thread.
pub(crate) struct BackupStore {
    _root_lock: File,
    root: PathBuf,
    policy: Mutex<BackupPolicy>,
    gate: Mutex<()>,
}
impl Drop for BackupStore {
    fn drop(&mut self) {
        // A concurrently spawned Git child may briefly inherit this descriptor before
        // exec closes it. Explicit unlock releases the ownership even during that window.
        let _ = self._root_lock.unlock();
    }
}
impl BackupStore {
    pub(crate) fn new(root: PathBuf, policy: BackupPolicy) -> Result<Self, BackupError> {
        policy.validate()?;
        private_directory(&root)?;
        let root = fs::canonicalize(root)?;
        let lock_path = root.join("store.lock");
        if fs::symlink_metadata(&lock_path)
            .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
        {
            return Err(BackupError::InvalidPath);
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let root_lock = options.open(lock_path)?;
        root_lock.try_lock().map_err(|_| BackupError::Io)?;
        for name in ["chunks", "points", "staging"] {
            private_directory(&root.join(name))?;
        }
        Ok(Self {
            _root_lock: root_lock,
            root,
            policy: Mutex::new(policy),
            gate: Mutex::new(()),
        })
    }
    #[cfg(test)]
    pub(crate) fn directory(&self) -> &Path {
        &self.root
    }
    pub(crate) fn update_policy(&self, policy: BackupPolicy) -> Result<(), BackupError> {
        policy.validate()?;
        let _gate = self.gate.lock().map_err(|_| BackupError::Io)?;
        self.cleanup_staging()?;
        *self.policy.lock().map_err(|_| BackupError::Io)? = policy;
        // Invalid manifests suspend cleanup; retained points are never guessed at.
        let manifests = self.manifests()?;
        self.prune(&manifests, now(), self.policy()?.max_mi_b * 1024 * 1024)?;
        Ok(())
    }
    fn policy(&self) -> Result<BackupPolicy, BackupError> {
        self.policy
            .lock()
            .map(|p| p.clone())
            .map_err(|_| BackupError::Io)
    }
    pub(crate) fn list(&self) -> Result<BackupCatalog, BackupError> {
        let _gate = self.gate.lock().map_err(|_| BackupError::Io)?;
        let mut points = Vec::new();
        let mut corrupt_points = 0;
        for entry in fs::read_dir(self.root.join("points"))? {
            let entry = entry?;
            match self.read_manifest(&entry.path()) {
                Ok(manifest) => points.push(manifest.point),
                Err(_) => corrupt_points += 1,
            }
        }
        points.sort_by_key(|p| std::cmp::Reverse(p.created_at));
        for entry in fs::read_dir(self.root.join("chunks"))? {
            let entry = entry?;
            let meta = fs::symlink_metadata(entry.path())?;
            if !valid_id(&entry.file_name().to_string_lossy())
                || !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() > (2 * CHUNK_BYTES) as u64
            {
                corrupt_points += 1;
            }
        }
        Ok(BackupCatalog {
            total_bytes: self.total_bytes_tolerant()?,
            points,
            corrupt_points,
        })
    }
    pub(crate) fn capture(
        &self,
        repository: &Path,
        cancel: &AtomicBool,
    ) -> Result<CaptureOutcome, BackupError> {
        self.capture_at(repository, cancel, now())
    }
    fn capture_at(
        &self,
        repository: &Path,
        cancel: &AtomicBool,
        at: u64,
    ) -> Result<CaptureOutcome, BackupError> {
        let _gate = self.gate.lock().map_err(|_| BackupError::Io)?;
        cancelled(cancel)?;
        let policy = self.policy()?;
        self.cleanup_staging()?;
        if !policy.enabled {
            return Ok(CaptureOutcome::Unchanged);
        }
        let requested = fs::canonicalize(repository)?;
        if git(
            &requested,
            &["rev-parse", "--is-bare-repository"],
            None,
            cancel,
        )?
        .starts_with(b"true")
        {
            return Err(BackupError::Incomplete);
        }
        let repository = git_path(&requested, "--show-toplevel", cancel)?;
        if !requested.starts_with(&repository)
            || repository.starts_with(&self.root)
            || self.root.starts_with(&repository)
        {
            return Err(BackupError::InvalidPath);
        }
        let git_dir = git_path(&repository, "--absolute-git-dir", cancel)?;
        let repository_id = repository_identity(&git_dir)?;
        let manifests = self.manifests()?;
        let latest = manifests
            .iter()
            .filter(|m| m.point.repository_id == repository_id)
            .max_by_key(|m| m.point.created_at);
        if let Some(latest) = latest {
            let next_at = latest.point.created_at.saturating_add(DAY);
            if at < next_at {
                return Ok(CaptureOutcome::TooSoon { next_at });
            }
        }
        let sources = collect_repository(&repository, cancel)?;
        let stamps = source_stamps(&sources, cancel)?;
        let source_signature = stamps_signature(&stamps);
        if latest.is_some_and(|m| m.source_signature == source_signature) {
            return Ok(CaptureOutcome::Unchanged);
        }
        let previous: BTreeMap<_, _> = latest
            .into_iter()
            .flat_map(|m| &m.entries)
            .map(|e| (e.path.clone(), e))
            .collect();
        let objects_changed = sources.keys().any(|path| {
            immutable_object(&decode_path(path).unwrap_or_default())
                && previous
                    .get(path)
                    .is_none_or(|e| Some(&e.source_stamp) != stamps.get(path))
        }) || previous.keys().any(|path| {
            immutable_object(&decode_path(path).unwrap_or_default()) && !sources.contains_key(path)
        });
        if objects_changed {
            validate_external_content(&repository, &sources, cancel)?;
        }
        self.prune(&manifests, at, policy.max_mi_b * 1024 * 1024)?;
        let manifests = self.manifests()?;
        let latest = manifests
            .iter()
            .filter(|m| m.point.repository_id == repository_id)
            .max_by_key(|m| m.point.created_at);
        let mut remaining = (policy.max_mi_b * 1024 * 1024).saturating_sub(self.total_bytes()?);
        let pending = tempfile::Builder::new()
            .prefix("capture-")
            .tempdir_in(self.root.join("staging"))?;
        let chunk_stage = pending.path().join("chunks");
        private_directory(&chunk_stage)?;
        let mut entries = Vec::with_capacity(sources.len());
        for (path, source) in &sources {
            cancelled(cancel)?;
            let content = if let Some(entry) = previous
                .get(path)
                .filter(|e| Some(&e.source_stamp) == stamps.get(path))
            {
                entry.content.clone()
            } else {
                match &source.source {
                    Source::Directory => Content::Directory,
                    Source::Symlink { target, directory } => Content::Symlink {
                        target: target.clone(),
                        directory: *directory,
                    },
                    Source::File(file) => self.capture_reader(
                        File::open(file)?,
                        &chunk_stage,
                        cancel,
                        &mut remaining,
                    )?,
                    Source::Bytes(bytes) => {
                        self.capture_reader(bytes.as_slice(), &chunk_stage, cancel, &mut remaining)?
                    }
                }
            };
            entries.push(Entry {
                source_stamp: stamps.get(path).cloned().ok_or(BackupError::Changed)?,
                path: path.clone(),
                mode: source.mode,
                content,
            });
        }
        let captured_fingerprint = fingerprint(&entries)?;
        if let Some(latest) = latest.filter(|m| m.fingerprint == captured_fingerprint) {
            let mut updated = latest.clone();
            updated.source_signature = source_signature;
            updated.entries = entries;
            if serde_json::to_vec(&updated)
                .map_err(|_| BackupError::Io)?
                .len() as u64
                <= remaining
            {
                write_json_replace(
                    &self
                        .root
                        .join("points")
                        .join(format!("{}.json", updated.point.id)),
                    &updated,
                )?;
                sync_directory(&self.root.join("points"))?;
            }
            return Ok(CaptureOutcome::Unchanged);
        }
        // Revalidate inventory and exact metadata stamps; refs/index are hashed by bytes.
        // Immutable Git/LFS objects and unchanged working files reuse their verified contents.
        let after = collect_repository(&repository, cancel)?;
        if source_stamps(&after, cancel)? != stamps {
            return Err(BackupError::Changed);
        }
        let mut chunk_signatures = BTreeMap::new();
        for id in entry_chunks(&entries) {
            cancelled(cancel)?;
            let path = if chunk_stage.join(&id).exists() {
                chunk_stage.join(&id)
            } else {
                self.root.join("chunks").join(&id)
            };
            let stamp = chunk_signature(&path)?;
            if latest.and_then(|m| m.chunk_signatures.get(&id)) != Some(&stamp) {
                read_chunk(&path, &id)?;
            }
            chunk_signatures.insert(id, stamp);
        }
        let verify = pending.path().join("verify");
        private_directory(&verify)?;
        // Objects are checked in an autonomous .git, with neither alternates nor source paths.
        self.verify_materialize(
            &entries,
            &sources,
            &verify,
            &chunk_stage,
            cancel,
            &mut remaining,
        )?;
        verify_repositories(&entries, &verify, cancel, latest.is_none())?;
        verify_changed_git_objects(&entries, &previous, &verify, cancel)?;
        for entry in entries.iter().filter(|entry| {
            git_metadata_path(&decode_path(&entry.path).unwrap_or_default())
                && previous
                    .get(&entry.path)
                    .is_none_or(|old| old.source_stamp != entry.source_stamp)
        }) {
            if let Content::File {
                digest: expected, ..
            } = &entry.content
            {
                if hash_reader(File::open(verify.join(decode_path(&entry.path)?))?, cancel)?.0
                    != *expected
                {
                    return Err(BackupError::Changed);
                }
            }
        }
        if source_stamps(&collect_repository(&repository, cancel)?, cancel)? != stamps {
            return Err(BackupError::Changed);
        }
        cancelled(cancel)?;
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).map_err(|_| BackupError::Io)?;
        let id = digest(&[repository_id.as_bytes(), &at.to_le_bytes(), &nonce].concat());
        let sizes = self.chunk_sizes(Some(&chunk_stage))?;
        let chunks = entry_chunks(&entries);
        let point = BackupPoint {
            id: id.clone(),
            repository_id,
            repository_path: repository.clone(),
            repository_name: repository
                .file_name()
                .unwrap_or(OsStr::new("repository"))
                .to_string_lossy()
                .into_owned(),
            created_at: at,
            size_bytes: chunks
                .iter()
                .map(|id| sizes.get(id).copied().ok_or(BackupError::Corrupt))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .sum(),
            file_count: entries
                .iter()
                .filter(|e| !matches!(e.content, Content::Directory))
                .count() as u64,
        };
        let mut candidate = Manifest {
            version: VERSION,
            point: point.clone(),
            fingerprint: captured_fingerprint,
            source_signature,
            chunk_signatures,
            entries,
        };
        let manifest_size = serde_json::to_vec(&candidate)
            .map_err(|_| BackupError::Io)?
            .len() as u64;
        if manifest_size > MANIFEST_BYTES {
            return Err(BackupError::Incomplete);
        }
        if manifest_size > remaining {
            return Ok(CaptureOutcome::NoSpace);
        }
        let mut all = manifests.clone();
        all.push(candidate.clone());
        let keep = retained(&all, at);
        let budget = policy.max_mi_b * 1024 * 1024;
        let keep = fit_budget(&all, keep, &sizes, budget)?;
        if !keep.contains(&id) {
            return Ok(CaptureOutcome::NoSpace);
        }
        if referenced_bytes(&all, &keep, &sizes)? > budget {
            return Ok(CaptureOutcome::NoSpace);
        }
        // Publish chunks before the manifest. A crash can leave only disposable orphan chunks.
        for chunk in fs::read_dir(&chunk_stage)? {
            cancelled(cancel)?;
            let chunk = chunk?;
            let target = self.root.join("chunks").join(chunk.file_name());
            if !target.exists() {
                fs::rename(chunk.path(), target)?;
            }
        }
        sync_directory(&self.root.join("chunks"))?;
        for id in entry_chunks(&candidate.entries) {
            candidate.chunk_signatures.insert(
                id.clone(),
                chunk_signature(&self.root.join("chunks").join(id))?,
            );
        }
        write_json_atomic(
            &self.root.join("points").join(format!("{id}.json")),
            &candidate,
        )?;
        sync_directory(&self.root.join("points"))?;
        // Old latest becomes removable only after the new point is durable and verified.
        self.delete_except(&all, &keep)?;
        Ok(CaptureOutcome::Created { point })
    }
    pub(crate) fn restore(
        &self,
        id: &str,
        destination: &Path,
        cancel: &AtomicBool,
    ) -> Result<(), BackupError> {
        let _gate = self.gate.lock().map_err(|_| BackupError::Io)?;
        cancelled(cancel)?;
        if !valid_id(id) || !destination.is_absolute() {
            return Err(BackupError::InvalidPath);
        }
        let name = destination.file_name().ok_or(BackupError::InvalidPath)?;
        let parent = fs::canonicalize(destination.parent().ok_or(BackupError::InvalidPath)?)?;
        let destination = parent.join(name);
        if destination.starts_with(&self.root) || self.root.starts_with(&destination) {
            return Err(BackupError::InvalidPath);
        }
        // create_dir is exclusive: existing directories, files and symlinks are never replaced.
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(BackupError::InvalidPath);
        }
        let manifest = self.read_manifest(&self.root.join("points").join(format!("{id}.json")))?;
        create_private_directory(&destination)?;
        let ownership = disk_identity(&destination)?;
        let result = (|| {
            self.materialize(&manifest.entries, &destination, None, cancel, false)?;
            verify_repositories(&manifest.entries, &destination, cancel, true)?;
            cancelled(cancel)?;
            if disk_identity(&destination)? != ownership {
                return Err(BackupError::InvalidPath);
            }
            sync_directory(&destination)?;
            Ok(())
        })();
        if result.is_err() && disk_identity(&destination).is_ok_and(|id| id == ownership) {
            let _ = fs::remove_dir_all(&destination);
        }
        result
    }
    /// Explicit deletion is separate from automatic retention; it may remove a last backup.
    #[cfg(test)]
    pub(crate) fn delete(&self, id: &str) -> Result<(), BackupError> {
        let _gate = self.gate.lock().map_err(|_| BackupError::Io)?;
        if !valid_id(id) {
            return Err(BackupError::InvalidPath);
        }
        let manifests = self.manifests()?;
        if !manifests.iter().any(|m| m.point.id == id) {
            return Err(BackupError::InvalidPath);
        }
        let keep = manifests
            .iter()
            .filter(|m| m.point.id != id)
            .map(|m| m.point.id.clone())
            .collect();
        self.delete_except(&manifests, &keep)
    }
    fn capture_reader(
        &self,
        mut reader: impl Read,
        staged: &Path,
        cancel: &AtomicBool,
        remaining: &mut u64,
    ) -> Result<Content, BackupError> {
        let mut chunks = Vec::new();
        let mut size = 0u64;
        let mut file_hash = Sha256::new();
        let mut buffer = vec![0; CHUNK_BYTES];
        loop {
            cancelled(cancel)?;
            let mut filled = 0;
            while filled < buffer.len() {
                let read = reader.read(&mut buffer[filled..])?;
                if read == 0 {
                    break;
                }
                filled += read;
                cancelled(cancel)?;
            }
            if filled == 0 {
                break;
            }
            let bytes = &buffer[..filled];
            size += filled as u64;
            #[cfg(test)]
            READ_BYTES.with(|counter| counter.set(counter.get() + bytes.len() as u64));
            file_hash.update(bytes);
            let id = digest(bytes);
            let existing = self.root.join("chunks").join(&id);
            if existing.exists() {
                // Existing shared data is verified; corruption must not spread to another point.
                if read_chunk(&existing, &id)? != bytes {
                    return Err(BackupError::Corrupt);
                }
            } else if !staged.join(&id).exists() {
                let mut encoded = GzEncoder::new(Vec::new(), Compression::fast());
                encoded.write_all(bytes)?;
                let compressed = encoded.finish()?;
                if compressed.len() as u64 > *remaining {
                    return Err(BackupError::NoSpace);
                }
                *remaining -= compressed.len() as u64;
                let mut file = create_private_file(&staged.join(&id))?;
                file.write_all(&compressed)?;
                file.sync_all()?;
            }
            chunks.push(id);
            thread::yield_now();
        }
        Ok(Content::File {
            size,
            digest: hex(&file_hash.finalize()),
            chunks,
        })
    }
    fn verify_materialize(
        &self,
        entries: &[Entry],
        sources: &Sources,
        destination: &Path,
        staged: &Path,
        cancel: &AtomicBool,
        remaining: &mut u64,
    ) -> Result<(), BackupError> {
        validate_entries(entries)?;
        for entry in entries {
            cancelled(cancel)?;
            let relative = decode_path(&entry.path)?;
            if !git_metadata_path(&relative) {
                continue;
            }
            let path = destination.join(&relative);
            ensure_safe_parent(destination, &relative)?;
            match &entry.content {
                Content::Directory => private_directory(&path)?,
                Content::File {
                    size,
                    digest: expected,
                    chunks,
                } => {
                    // Git objects are immutable. Hard links give fsck an autonomous database
                    // without a second full object copy; unlinking the source cannot remove it.
                    let object = immutable_object(&relative);
                    let source = sources.get(&entry.path).ok_or(BackupError::Changed)?;
                    let linked = object
                        && match &source.source {
                            Source::File(source) => fs::hard_link(source, &path).is_ok(),
                            _ => false,
                        };
                    let mut file = if linked {
                        None
                    } else {
                        if *size > *remaining {
                            return Err(BackupError::NoSpace);
                        }
                        *remaining -= size;
                        Some(create_private_file(&path)?)
                    };
                    if linked {
                        continue;
                    }
                    // New or modified chunks were checked before publication; metadata is
                    // materialized here so Git can validate its independent references.
                    let mut actual_size = 0u64;
                    let mut hash = Sha256::new();
                    for id in chunks {
                        cancelled(cancel)?;
                        let candidate = if staged.join(id).exists() {
                            staged.join(id)
                        } else {
                            self.root.join("chunks").join(id)
                        };
                        let bytes = read_chunk(&candidate, id)?;
                        actual_size += bytes.len() as u64;
                        hash.update(&bytes);
                        if let Some(file) = &mut file {
                            file.write_all(&bytes)?;
                        }
                    }
                    if actual_size != *size || hex(&hash.finalize()) != *expected {
                        return Err(BackupError::Corrupt);
                    }
                    if let Some(file) = file {
                        file.sync_all()?;
                        set_mode(&path, entry.mode)?;
                    }
                }
                Content::Symlink { .. } => return Err(BackupError::Incomplete),
            }
        }
        Ok(())
    }
    fn materialize(
        &self,
        entries: &[Entry],
        destination: &Path,
        staged: Option<&Path>,
        cancel: &AtomicBool,
        git_only: bool,
    ) -> Result<(), BackupError> {
        validate_entries(entries)?;
        for entry in entries
            .iter()
            .filter(|e| !matches!(e.content, Content::Symlink { .. }))
        {
            cancelled(cancel)?;
            let relative = decode_path(&entry.path)?;
            if git_only && !git_metadata_path(&relative) {
                continue;
            }
            let path = destination.join(&relative);
            ensure_safe_parent(destination, &relative)?;
            match &entry.content {
                Content::Directory => {
                    private_directory(&path)?;
                }
                Content::File {
                    size,
                    digest: expected,
                    chunks,
                } => {
                    let mut file = create_private_file(&path)?;
                    let mut actual_size = 0u64;
                    let mut hash = Sha256::new();
                    for id in chunks {
                        cancelled(cancel)?;
                        let candidate = staged
                            .map(|s| s.join(id))
                            .filter(|p| p.exists())
                            .unwrap_or_else(|| self.root.join("chunks").join(id));
                        let bytes = read_chunk(&candidate, id)?;
                        actual_size += bytes.len() as u64;
                        hash.update(&bytes);
                        file.write_all(&bytes)?;
                    }
                    if actual_size != *size || hex(&hash.finalize()) != *expected {
                        return Err(BackupError::Corrupt);
                    }
                    file.sync_all()?;
                    set_mode(&path, entry.mode)?;
                }
                Content::Symlink { .. } => unreachable!(),
            }
        }
        // Links are last and no entry is permitted underneath a link.
        for entry in entries
            .iter()
            .filter(|e| matches!(e.content, Content::Symlink { .. }))
        {
            cancelled(cancel)?;
            let relative = decode_path(&entry.path)?;
            if git_only && !git_metadata_path(&relative) {
                continue;
            }
            ensure_safe_parent(destination, &relative)?;
            if let Content::Symlink { target, directory } = &entry.content {
                create_symlink(&decode_os(target)?, &destination.join(relative), *directory)?;
            }
        }
        Ok(())
    }
    fn manifests(&self) -> Result<Vec<Manifest>, BackupError> {
        fs::read_dir(self.root.join("points"))?
            .map(|entry| self.read_manifest(&entry?.path()))
            .collect()
    }
    fn read_manifest(&self, path: &Path) -> Result<Manifest, BackupError> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MANIFEST_BYTES
        {
            return Err(BackupError::Corrupt);
        }
        let manifest: Manifest =
            serde_json::from_reader(File::open(path)?).map_err(|_| BackupError::Corrupt)?;
        if manifest.version != VERSION
            || !valid_id(&manifest.point.id)
            || !valid_id(&manifest.point.repository_id)
            || path.file_name() != Some(OsStr::new(&format!("{}.json", manifest.point.id)))
            || !manifest.point.repository_path.is_absolute()
            || !valid_id(&manifest.fingerprint)
            || (!manifest.source_signature.is_empty() && !valid_id(&manifest.source_signature))
            || manifest
                .chunk_signatures
                .iter()
                .any(|(id, stamp)| !valid_id(id) || !valid_id(stamp))
        {
            return Err(BackupError::Corrupt);
        }
        validate_entries(&manifest.entries)?;
        if fingerprint(&manifest.entries)? != manifest.fingerprint {
            return Err(BackupError::Corrupt);
        }
        for id in entry_chunks(&manifest.entries) {
            let path = self.root.join("chunks").join(&id);
            let signature = chunk_signature(&path)?;
            if manifest.chunk_signatures.get(&id) != Some(&signature) {
                read_chunk(&path, &id)?;
            }
        }
        Ok(manifest)
    }
    /// Caller schedules this at startup and daily, also when no source repository is open.
    pub(crate) fn maintenance(&self) -> Result<(), BackupError> {
        let _gate = self.gate.lock().map_err(|_| BackupError::Io)?;
        self.cleanup_staging()?;
        let manifests = self.manifests()?;
        self.prune(&manifests, now(), self.policy()?.max_mi_b * 1024 * 1024)
    }
    fn cleanup_staging(&self) -> Result<(), BackupError> {
        // The native manager owns one Store per data root and serializes its mutations. Crash leftovers
        // cannot become restore points, and must not consume storage outside the budget.
        for entry in fs::read_dir(self.root.join("staging"))? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("capture-") && !name.starts_with("manifest-") {
                return Err(BackupError::Corrupt);
            }
            if entry.file_type()?.is_dir() {
                fs::remove_dir_all(entry.path())?;
            } else {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
    fn chunk_sizes(&self, staged: Option<&Path>) -> Result<HashMap<String, u64>, BackupError> {
        let mut sizes = HashMap::new();
        for directory in [Some(self.root.join("chunks")), staged.map(Path::to_owned)]
            .into_iter()
            .flatten()
        {
            for file in fs::read_dir(directory)? {
                let file = file?;
                let id = file.file_name().to_string_lossy().into_owned();
                let meta = fs::symlink_metadata(file.path())?;
                if !valid_id(&id) || !meta.is_file() || meta.file_type().is_symlink() {
                    return Err(BackupError::Corrupt);
                }
                sizes.insert(id, meta.len());
            }
        }
        Ok(sizes)
    }
    fn total_bytes_tolerant(&self) -> Result<u64, BackupError> {
        Ok(directory_bytes(&self.root.join("chunks"))?
            + directory_bytes(&self.root.join("points"))?
            + directory_bytes(&self.root.join("staging"))?)
    }
    fn total_bytes(&self) -> Result<u64, BackupError> {
        let mut size = self.chunk_sizes(None)?.values().sum();
        for file in fs::read_dir(self.root.join("points"))? {
            size += file?.metadata()?.len();
        }
        size += directory_bytes(&self.root.join("staging"))?;
        Ok(size)
    }
    fn prune(&self, manifests: &[Manifest], at: u64, budget: u64) -> Result<(), BackupError> {
        let sizes = self.chunk_sizes(None)?;
        let keep = fit_budget(manifests, retained(manifests, at), &sizes, budget)?;
        let referenced: HashSet<_> = manifests
            .iter()
            .flat_map(|m| entry_chunks(&m.entries))
            .collect();
        if keep.len() == manifests.len() && referenced.len() == sizes.len() {
            return Ok(());
        }
        let mut checked = HashSet::new();
        for manifest in manifests {
            for chunk in entry_chunks(&manifest.entries) {
                if checked.insert(chunk.clone()) {
                    let path = self.root.join("chunks").join(&chunk);
                    let signature = chunk_signature(&path)?;
                    if !manifests
                        .iter()
                        .any(|m| m.chunk_signatures.get(&chunk) == Some(&signature))
                    {
                        read_chunk(&path, &chunk)?;
                    }
                }
            }
        }
        self.delete_except(manifests, &keep)
    }
    fn delete_except(
        &self,
        manifests: &[Manifest],
        keep: &HashSet<String>,
    ) -> Result<(), BackupError> {
        let mut referenced = HashSet::new();
        for manifest in manifests {
            if keep.contains(&manifest.point.id) {
                referenced.extend(entry_chunks(&manifest.entries));
            } else {
                fs::remove_file(
                    self.root
                        .join("points")
                        .join(format!("{}.json", manifest.point.id)),
                )?;
            }
        }
        sync_directory(&self.root.join("points"))?;
        for file in fs::read_dir(self.root.join("chunks"))? {
            let file = file?;
            if !referenced.contains(&file.file_name().to_string_lossy().into_owned()) {
                fs::remove_file(file.path())?;
            }
        }
        Ok(())
    }
}

fn collect_repository(repository: &Path, cancel: &AtomicBool) -> Result<Sources, BackupError> {
    if std::env::var_os("GIT_ALTERNATE_OBJECT_DIRECTORIES").is_some_and(|v| !v.is_empty()) {
        return Err(BackupError::Incomplete);
    }
    let mut sources = BTreeMap::new();
    collect_one(
        repository,
        Path::new(""),
        &mut sources,
        &mut HashSet::new(),
        cancel,
    )?;
    Ok(sources)
}
fn collect_one(
    repository: &Path,
    prefix: &Path,
    sources: &mut Sources,
    visited: &mut HashSet<PathBuf>,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    cancelled(cancel)?;
    let git_dir = git_path(repository, "--absolute-git-dir", cancel)?;
    if !visited.insert(git_dir.clone()) || visited.len() > 128 {
        return Err(BackupError::Incomplete);
    }
    let common = git_path(repository, "--git-common-dir", cancel)?;
    if common.join("shallow").exists() || common.join("objects/info/http-alternates").exists() {
        return Err(BackupError::Incomplete);
    }
    let config = flattened_config(repository, &git_dir, cancel)?;
    let git_prefix = prefix.join(".git");
    // Preserve the shared metadata, then overlay the selected worktree's index/HEAD/reflog.
    collect_git_directory(&common, &git_prefix, sources, cancel)?;
    if git_dir != common {
        // HEAD/index and in-progress operations in common belong to the main worktree.
        for name in [
            "HEAD",
            "index",
            "ORIG_HEAD",
            "MERGE_HEAD",
            "MERGE_MSG",
            "MERGE_MODE",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "REBASE_HEAD",
            "AUTO_MERGE",
            "COMMIT_EDITMSG",
            "FETCH_HEAD",
            "logs/HEAD",
            "rebase-merge",
            "rebase-apply",
            "sequencer",
            "BISECT_LOG",
            "BISECT_NAMES",
            "BISECT_START",
            "BISECT_EXPECTED_REV",
            "BISECT_TERMS",
            "BISECT_ANCESTORS_OK",
            "BISECT_HEAD",
            "MERGE_RR",
            "MERGE_AUTOSTASH",
            "SQUASH_MSG",
            "description",
            "info/sparse-checkout",
            "refs/bisect",
            "refs/rewritten",
            "refs/worktree",
            "logs/refs/bisect",
            "logs/refs/rewritten",
            "logs/refs/worktree",
        ] {
            let path = encode_path(&git_prefix.join(name));
            sources.retain(|key, _| {
                !key.starts_with(&[path.as_slice(), b"/"].concat()) && *key != path
            });
        }
        sources.retain(|key, _| {
            let path = decode_path(key).unwrap_or_default();
            !(path.parent() == Some(git_prefix.as_path())
                && path
                    .file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with("sharedindex.")))
        });
        collect_git_directory(&git_dir, &git_prefix, sources, cancel)?;
    }
    if common.join("packed-refs").exists() {
        let bytes = fs::read(common.join("packed-refs"))?;
        let mut cleaned = Vec::new();
        let mut skip_peeled = false;
        for line in bytes.split_inclusive(|b| *b == b'\n') {
            if line.starts_with(b"^") && skip_peeled {
                continue;
            }
            skip_peeled = line
                .windows(b" refs/gitthul/".len())
                .any(|w| w == b" refs/gitthul/");
            if !skip_peeled {
                cleaned.extend_from_slice(line);
            }
        }
        sources.insert(
            encode_path(&git_prefix.join("packed-refs")),
            SourceEntry {
                mode: 0o600,
                source: Source::Bytes(cleaned),
            },
        );
    }
    if let Ok(hooks) = git(
        repository,
        &["config", "--path", "--get", "core.hooksPath"],
        None,
        cancel,
    ) {
        let hooks = output_path(&hooks, repository)?;
        let path = encode_path(&git_prefix.join("hooks"));
        sources
            .retain(|key, _| !key.starts_with(&[path.as_slice(), b"/"].concat()) && *key != path);
        if hooks.exists() {
            collect_tree(&hooks, &git_prefix.join("hooks"), sources, cancel, true)?;
        }
    }
    sources.insert(
        encode_path(&git_prefix.join("config")),
        SourceEntry {
            mode: 0o600,
            source: Source::Bytes(config),
        },
    );
    sources.remove(&encode_path(&git_prefix.join("config.worktree")));
    for name in [
        "objects",
        "objects/info",
        "objects/pack",
        "refs",
        "hooks",
        "info",
    ] {
        sources
            .entry(encode_path(&git_prefix.join(name)))
            .or_insert(SourceEntry {
                mode: 0o700,
                source: Source::Directory,
            });
    }
    let object_path = git(
        repository,
        &["rev-parse", "--git-path", "objects"],
        None,
        cancel,
    )?;
    let object_path = output_path(&object_path, repository)?;
    collect_objects(
        &object_path,
        &git_prefix.join("objects"),
        sources,
        &mut HashSet::new(),
        cancel,
    )?;
    collect_lfs(repository, &common, &git_prefix, sources, cancel)?;
    let paths = git(
        repository,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
        None,
        cancel,
    )?;
    let index = git(repository, &["ls-files", "--stage", "-z"], None, cancel)?;
    let mut submodules = BTreeMap::new();
    for record in index.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        if record.starts_with(b"160000 ") {
            let tab = record
                .iter()
                .position(|b| *b == b'\t')
                .ok_or(BackupError::Incomplete)?;
            let fields =
                std::str::from_utf8(&record[..tab]).map_err(|_| BackupError::Incomplete)?;
            let oid = fields
                .split_whitespace()
                .nth(1)
                .ok_or(BackupError::Incomplete)?
                .to_owned();
            let path = decode_path(&record[tab + 1..])?;
            submodules
                .entry(path)
                .or_insert_with(BTreeSet::new)
                .insert(oid);
        }
    }
    for path in paths.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        let path = decode_path(path)?;
        if submodules.contains_key(&path) {
            continue;
        }
        if let Some(ancestor) = blocked_ancestor(repository, &path)? {
            // A tracked directory replaced by a link/file remains part of WIP even
            // if that replacement matches .gitignore. Never read through its link.
            add_source(
                &repository.join(&ancestor),
                &prefix.join(&ancestor),
                sources,
            )?;
            continue;
        }
        let source = repository.join(&path);
        match fs::symlink_metadata(&source) {
            Ok(meta) => {
                if meta.is_dir() {
                    // Nested untracked repositories cannot silently become a partial directory.
                    if source.join(".git").exists() {
                        return Err(BackupError::Incomplete);
                    }
                    collect_tree(&source, &prefix.join(&path), sources, cancel, false)?;
                } else {
                    add_source(&source, &prefix.join(&path), sources)?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (), // Deleted tracked file.
            Err(_) => return Err(BackupError::Io),
        }
    }
    for (path, oids) in submodules {
        if blocked_ancestor(repository, &path)?.is_some() {
            return Err(BackupError::Incomplete);
        }
        let child = repository.join(&path);
        if fs::symlink_metadata(&child).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(BackupError::Incomplete);
        }
        // A missing/deinitialized submodule has no autonomous working repository to restore.
        if !child.join(".git").exists() {
            return Err(BackupError::Incomplete);
        }
        let input = format!("{}\n", oids.into_iter().collect::<Vec<_>>().join("\n"));
        git(
            &child,
            &[
                "rev-list",
                "--objects",
                "--stdin",
                "--quiet",
                "--missing=error",
            ],
            Some(input.as_bytes()),
            cancel,
        )
        .map_err(|error| {
            if error == BackupError::Cancelled {
                error
            } else {
                BackupError::Incomplete
            }
        })?;
        collect_one(&child, &prefix.join(&path), sources, visited, cancel)?;
    }
    ensure_cached_modules_covered(&common.join("modules"), visited, cancel, 0)?;
    Ok(())
}
fn ensure_cached_modules_covered(
    path: &Path,
    visited: &HashSet<PathBuf>,
    cancel: &AtomicBool,
    depth: u32,
) -> Result<(), BackupError> {
    cancelled(cancel)?;
    if depth > 128 {
        return Err(BackupError::Incomplete);
    }
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(BackupError::Io),
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err(BackupError::Incomplete)
        }
        Ok(_) => (),
    }
    if path.join("HEAD").is_file() && path.join("config").is_file() {
        if !visited.contains(&fs::canonicalize(path)?) {
            return Err(BackupError::Incomplete);
        }
        return ensure_cached_modules_covered(&path.join("modules"), visited, cancel, depth + 1);
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        ensure_cached_modules_covered(&entry.path(), visited, cancel, depth + 1)?;
    }
    Ok(())
}
fn blocked_ancestor(repository: &Path, relative: &Path) -> Result<Option<PathBuf>, BackupError> {
    let mut ancestor = PathBuf::new();
    for part in relative.parent().unwrap_or(Path::new("")).components() {
        ancestor.push(part);
        match fs::symlink_metadata(repository.join(&ancestor)) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Ok(Some(ancestor))
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(BackupError::Io),
        }
    }
    Ok(None)
}
fn collect_git_directory(
    source: &Path,
    destination: &Path,
    sources: &mut Sources,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    for file in fs::read_dir(source)? {
        cancelled(cancel)?;
        let file = file?;
        let name = file.file_name();
        let label = name.to_string_lossy();
        if label.ends_with(".lock") {
            return Err(BackupError::Changed);
        }
        if matches!(
            label.as_ref(),
            "objects"
                | "worktrees"
                | "modules"
                | "lfs"
                | "gitdir"
                | "commondir"
                | "gitthul-recovery"
                | "gitthul-undo-revision"
                | "config.worktree"
        ) {
            continue;
        }
        if file.file_type()?.is_symlink() {
            return Err(BackupError::Incomplete);
        }
        collect_tree(&file.path(), &destination.join(name), sources, cancel, true)?;
    }
    Ok(())
}
fn collect_tree(
    source: &Path,
    destination: &Path,
    sources: &mut Sources,
    cancel: &AtomicBool,
    metadata: bool,
) -> Result<(), BackupError> {
    cancelled(cancel)?;
    if sources.len() >= 200_000 {
        return Err(BackupError::Incomplete);
    }
    if metadata
        && source
            .file_name()
            .is_some_and(|n| n.to_string_lossy().ends_with(".promisor"))
    {
        return Err(BackupError::Incomplete);
    }
    if metadata {
        if destination
            .components()
            .collect::<Vec<_>>()
            .windows(2)
            .any(|p| {
                p[0].as_os_str() == OsStr::new("refs") && p[1].as_os_str() == OsStr::new("gitthul")
            })
        {
            return Ok(());
        }
    }
    let meta = fs::symlink_metadata(source)?;
    if meta.is_dir() {
        sources.insert(
            encode_path(destination),
            SourceEntry {
                mode: mode(&meta),
                source: Source::Directory,
            },
        );
        for file in fs::read_dir(source)? {
            let file = file?;
            if metadata && file.file_name().to_string_lossy().ends_with(".lock") {
                return Err(BackupError::Changed);
            }
            collect_tree(
                &file.path(),
                &destination.join(file.file_name()),
                sources,
                cancel,
                metadata,
            )?;
        }
    } else if metadata && meta.file_type().is_symlink() {
        return Err(BackupError::Incomplete);
    } else {
        add_source(source, destination, sources)?;
    }
    Ok(())
}
fn add_source(source: &Path, destination: &Path, sources: &mut Sources) -> Result<(), BackupError> {
    let meta = fs::symlink_metadata(source)?;
    let kind = if meta.file_type().is_symlink() {
        Source::Symlink {
            target: encode_os(fs::read_link(source)?.as_os_str()),
            directory: directory_symlink(&meta),
        }
    } else if meta.is_file() {
        Source::File(source.to_owned())
    } else {
        return Err(BackupError::Incomplete);
    };
    sources.insert(
        encode_path(destination),
        SourceEntry {
            mode: mode(&meta),
            source: kind,
        },
    );
    Ok(())
}
fn collect_objects(
    source: &Path,
    destination: &Path,
    sources: &mut Sources,
    visited: &mut HashSet<PathBuf>,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    let source = fs::canonicalize(source).map_err(|_| BackupError::Incomplete)?;
    if !visited.insert(source.clone()) {
        return Ok(());
    }
    if visited.len() > 128 {
        return Err(BackupError::Incomplete);
    }
    if source.join("info/http-alternates").exists() {
        return Err(BackupError::Incomplete);
    }
    for file in fs::read_dir(&source)? {
        cancelled(cancel)?;
        let file = file?;
        let name = file.file_name();
        if name == OsStr::new("info") {
            if source.join("info/alternates").exists() {
                let alternates = fs::read(source.join("info/alternates"))?;
                for alternate in alternates.split(|b| *b == b'\n').filter(|p| !p.is_empty()) {
                    // Git quoted paths require its parser; refuse rather than capture an incomplete database.
                    if alternate.starts_with(b"\"") {
                        return Err(BackupError::Incomplete);
                    }
                    let path = PathBuf::from(decode_os(alternate)?);
                    let path = if path.is_absolute() {
                        path
                    } else {
                        source.join(path)
                    };
                    collect_objects(&path, destination, sources, visited, cancel)?;
                }
            }
            continue;
        }
        if name.to_string_lossy().ends_with(".lock") {
            return Err(BackupError::Changed);
        }
        let prefix = destination.join(&name);
        let mut additions = BTreeMap::new();
        collect_tree(&file.path(), &prefix, &mut additions, cancel, true)?;
        for (path, entry) in additions {
            if let Some(existing) = sources.get(&path) {
                if !matches!(entry.source, Source::Directory) {
                    if source_digest(&entry, cancel)? != source_digest(existing, cancel)? {
                        return Err(BackupError::Incomplete);
                    }
                }
            } else {
                sources.insert(path, entry);
            }
        }
    }
    Ok(())
}
fn flattened_config(
    repository: &Path,
    git_dir: &Path,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, BackupError> {
    let mut settings = git(
        repository,
        &["config", "--null", "--local", "--includes", "--list"],
        None,
        cancel,
    )?;
    if git_dir.join("config.worktree").exists() {
        let file = git_dir.join("config.worktree");
        let more = git_os(
            repository,
            &[
                OsStr::new("config"),
                OsStr::new("--file"),
                file.as_os_str(),
                OsStr::new("--null"),
                OsStr::new("--includes"),
                OsStr::new("--list"),
            ],
            None,
            cancel,
        )?;
        settings.extend(more);
    }
    let mut result = String::new();
    for item in settings.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        let newline = item.iter().position(|b| *b == b'\n').unwrap_or(item.len());
        let key = std::str::from_utf8(&item[..newline]).map_err(|_| BackupError::Incomplete)?;
        let value = if newline == item.len() {
            "true"
        } else {
            std::str::from_utf8(&item[newline + 1..]).map_err(|_| BackupError::Incomplete)?
        };
        let lower = key.to_ascii_lowercase();
        if lower == "extensions.partialclone"
            || (lower.ends_with(".promisor")
                && !matches!(
                    value.to_ascii_lowercase().as_str(),
                    "false" | "off" | "no" | "0"
                ))
        {
            return Err(BackupError::Incomplete);
        }
        if lower.starts_with("include.")
            || lower.starts_with("includeif.")
            || matches!(
                lower.as_str(),
                "core.worktree"
                    | "core.bare"
                    | "core.hookspath"
                    | "core.fsmonitor"
                    | "extensions.worktreeconfig"
                    | "extensions.relativeworktrees"
                    | "lfs.storage"
            )
        {
            continue;
        }
        let (section, rest) = key.split_once('.').ok_or(BackupError::Incomplete)?;
        let (subsection, name) = match rest.rsplit_once('.') {
            Some((sub, name)) => (Some(sub), name),
            None => (None, rest),
        };
        if !section
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
            || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(BackupError::Incomplete);
        }
        result.push('[');
        result.push_str(section);
        if let Some(subsection) = subsection {
            result.push_str(" \"");
            result.push_str(&config_escape(subsection));
            result.push('"');
        }
        result.push_str("]\n\t");
        result.push_str(name);
        result.push_str(" = \"");
        result.push_str(&config_escape(value));
        result.push_str("\"\n");
    }
    result.push_str("[core]\n\tbare = false\n");
    Ok(result.into_bytes())
}
fn config_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
        .replace('\r', "\\n")
}

fn collect_lfs(
    repository: &Path,
    common: &Path,
    prefix: &Path,
    sources: &mut Sources,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    let configured = git(
        repository,
        &["config", "--path", "--get", "lfs.storage"],
        None,
        cancel,
    )
    .ok();
    let storage = configured
        .as_deref()
        .map(|p| output_path(p, common))
        .transpose()?
        .unwrap_or_else(|| common.join("lfs"));
    if storage.join("objects").exists() {
        collect_tree(
            &storage.join("objects"),
            &prefix.join("lfs/objects"),
            sources,
            cancel,
            true,
        )?;
    }
    Ok(())
}
fn validate_external_content(
    repository: &Path,
    sources: &Sources,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    for path in sources.keys() {
        let path = decode_path(path)?;
        if path.file_name() == Some(OsStr::new("HEAD"))
            && path.parent().and_then(Path::file_name) == Some(OsStr::new(".git"))
        {
            let working = repository.join(
                path.parent()
                    .and_then(Path::parent)
                    .unwrap_or(Path::new("")),
            );
            let common = git_path(&working, "--git-common-dir", cancel)?;
            validate_lfs(&working, &common, sources, repository, cancel)?;
        }
    }
    Ok(())
}
fn validate_lfs(
    repository: &Path,
    common: &Path,
    sources: &Sources,
    root: &Path,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    let configured = git(
        repository,
        &["config", "--path", "--get", "lfs.storage"],
        None,
        cancel,
    )
    .ok();
    let storage = configured
        .as_deref()
        .map(|p| output_path(p, common))
        .transpose()?
        .unwrap_or_else(|| common.join("lfs"));
    // Inspect small blobs once for each changed capture, including old versions/stashes.
    let objects = git(
        repository,
        &[
            "cat-file",
            "--batch-all-objects",
            "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ],
        None,
        cancel,
    )?;
    validate_submodule_history(repository, &objects, sources, root, cancel)?;
    let mut small = Vec::new();
    for line in objects.split(|b| *b == b'\n').filter(|p| !p.is_empty()) {
        let line = std::str::from_utf8(line).map_err(|_| BackupError::Incomplete)?;
        let mut fields = line.split_whitespace();
        let id = fields.next().ok_or(BackupError::Incomplete)?;
        if fields.next() == Some("blob")
            && fields
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .is_some_and(|size| size <= 1024)
        {
            small.push(id);
        }
    }
    for batch in small.chunks(512) {
        let input = format!("{}\n", batch.join("\n"));
        let data = git(
            repository,
            &["cat-file", "--batch"],
            Some(input.as_bytes()),
            cancel,
        )?;
        let mut at = 0usize;
        for _ in batch {
            let newline = data[at..]
                .iter()
                .position(|b| *b == b'\n')
                .ok_or(BackupError::Incomplete)?
                + at;
            let header =
                std::str::from_utf8(&data[at..newline]).map_err(|_| BackupError::Incomplete)?;
            let size = header
                .split_whitespace()
                .nth(2)
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or(BackupError::Incomplete)?;
            let end = newline
                .checked_add(1 + size)
                .ok_or(BackupError::Incomplete)?;
            let blob = data.get(newline + 1..end).ok_or(BackupError::Incomplete)?;
            at = end + 1;
            if blob.starts_with(b"version https://git-lfs.github.com/spec/v1\n") {
                let text = std::str::from_utf8(blob).map_err(|_| BackupError::Incomplete)?;
                let oid = text
                    .lines()
                    .find_map(|l| l.strip_prefix("oid sha256:"))
                    .filter(|id| valid_id(id))
                    .ok_or(BackupError::Incomplete)?;
                let length = text
                    .lines()
                    .find_map(|l| l.strip_prefix("size "))
                    .and_then(|s| s.parse::<u64>().ok())
                    .ok_or(BackupError::Incomplete)?;
                let object = storage
                    .join("objects")
                    .join(&oid[..2])
                    .join(&oid[2..4])
                    .join(oid);
                let meta = fs::symlink_metadata(&object).map_err(|_| BackupError::Incomplete)?;
                if !meta.is_file() || meta.file_type().is_symlink() || meta.len() != length {
                    return Err(BackupError::Incomplete);
                }
                if hash_reader(File::open(&object)?, cancel)?.0 != oid {
                    return Err(BackupError::Incomplete);
                }
            }
        }
    }
    Ok(())
}

fn validate_submodule_history(
    repository: &Path,
    objects: &[u8],
    sources: &Sources,
    root: &Path,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    let mut trees = Vec::new();
    for line in objects.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
        let line = std::str::from_utf8(line).map_err(|_| BackupError::Incomplete)?;
        let mut fields = line.split_whitespace();
        let oid = fields.next().ok_or(BackupError::Incomplete)?;
        if fields.next() == Some("tree") {
            let size = fields
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .ok_or(BackupError::Incomplete)?;
            if size > COMMAND_BYTES - 256 {
                return Err(BackupError::Incomplete);
            }
            trees.push((oid, size));
        }
    }
    let oid_bytes = if git(
        repository,
        &["rev-parse", "--show-object-format"],
        None,
        cancel,
    )?
    .starts_with(b"sha256")
    {
        32
    } else {
        20
    };
    let mut batches = Vec::new();
    let mut batch = Vec::new();
    let mut predicted = 0u64;
    for (oid, size) in trees {
        if !batch.is_empty() && (batch.len() >= 1024 || predicted + size + 128 > COMMAND_BYTES / 2)
        {
            batches.push(std::mem::take(&mut batch));
            predicted = 0;
        }
        batch.push(oid);
        predicted += size + 128;
    }
    if !batch.is_empty() {
        batches.push(batch);
    }
    let mut gitlinks = BTreeSet::new();
    for batch in batches {
        let input = format!("{}\n", batch.join("\n"));
        let data = git(
            repository,
            &["cat-file", "--batch"],
            Some(input.as_bytes()),
            cancel,
        )?;
        let mut at = 0usize;
        for _ in batch {
            let newline = data
                .get(at..)
                .ok_or(BackupError::Incomplete)?
                .iter()
                .position(|b| *b == b'\n')
                .ok_or(BackupError::Incomplete)?
                + at;
            let size = std::str::from_utf8(&data[at..newline])
                .map_err(|_| BackupError::Incomplete)?
                .split_whitespace()
                .nth(2)
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or(BackupError::Incomplete)?;
            let end = newline
                .checked_add(size + 1)
                .ok_or(BackupError::Incomplete)?;
            let mut tree = data.get(newline + 1..end).ok_or(BackupError::Incomplete)?;
            while !tree.is_empty() {
                let space = tree
                    .iter()
                    .position(|b| *b == b' ')
                    .ok_or(BackupError::Incomplete)?;
                let nul = tree
                    .iter()
                    .position(|b| *b == 0)
                    .ok_or(BackupError::Incomplete)?;
                let oid = tree
                    .get(nul + 1..nul + 1 + oid_bytes)
                    .ok_or(BackupError::Incomplete)?;
                if &tree[..space] == b"160000" {
                    gitlinks.insert(hex(oid));
                }
                tree = &tree[nul + 1 + oid_bytes..];
            }
            at = end + 1;
        }
    }
    if gitlinks.is_empty() {
        return Ok(());
    }
    let mut modules = Vec::new();
    for path in sources.keys() {
        let path = decode_path(path)?;
        if path.file_name() == Some(OsStr::new("HEAD"))
            && path.parent().and_then(Path::file_name) == Some(OsStr::new(".git"))
        {
            let working = root.join(
                path.parent()
                    .and_then(Path::parent)
                    .unwrap_or(Path::new("")),
            );
            if working != repository {
                modules.push(working);
            }
        }
    }
    for module in modules {
        if gitlinks.is_empty() {
            break;
        }
        let input = format!(
            "{}\n",
            gitlinks.iter().cloned().collect::<Vec<_>>().join("\n")
        );
        let results = git(
            &module,
            &["cat-file", "--batch-check"],
            Some(input.as_bytes()),
            cancel,
        )?;
        let mut found = Vec::new();
        for line in results.split(|b| *b == b'\n') {
            if let Ok(line) = std::str::from_utf8(line) {
                let mut fields = line.split_whitespace();
                if let (Some(oid), Some("commit")) = (fields.next(), fields.next()) {
                    found.push(oid.to_owned());
                }
            }
        }
        if !found.is_empty() {
            let closure = format!("{}\n", found.join("\n"));
            git(
                &module,
                &[
                    "rev-list",
                    "--objects",
                    "--stdin",
                    "--quiet",
                    "--missing=error",
                ],
                Some(closure.as_bytes()),
                cancel,
            )
            .map_err(|error| {
                if error == BackupError::Cancelled {
                    error
                } else {
                    BackupError::Incomplete
                }
            })?;
            for oid in found {
                gitlinks.remove(&oid);
            }
        }
    }
    if gitlinks.is_empty() {
        Ok(())
    } else {
        Err(BackupError::Incomplete)
    }
}
fn immutable_object(path: &Path) -> bool {
    is_git_object(path)
        || path.components().collect::<Vec<_>>().windows(3).any(|p| {
            p[0].as_os_str() == OsStr::new(".git")
                && p[1].as_os_str() == OsStr::new("lfs")
                && p[2].as_os_str() == OsStr::new("objects")
        })
}
fn is_git_object(path: &Path) -> bool {
    path.components().collect::<Vec<_>>().windows(2).any(|p| {
        p[0].as_os_str() == OsStr::new(".git") && p[1].as_os_str() == OsStr::new("objects")
    })
}
fn source_stamps(
    sources: &Sources,
    cancel: &AtomicBool,
) -> Result<BTreeMap<Vec<u8>, String>, BackupError> {
    sources
        .iter()
        .map(|(path, entry)| Ok((path.clone(), source_stamp(path, entry, cancel)?)))
        .collect()
}
fn stamps_signature(stamps: &BTreeMap<Vec<u8>, String>) -> String {
    let mut hash = Sha256::new();
    for (path, stamp) in stamps {
        hash.update((path.len() as u64).to_le_bytes());
        hash.update(path);
        hash.update(stamp);
    }
    hex(&hash.finalize())
}
#[cfg(test)]
fn source_signature(sources: &Sources, cancel: &AtomicBool) -> Result<String, BackupError> {
    Ok(stamps_signature(&source_stamps(sources, cancel)?))
}
fn source_stamp(
    path: &[u8],
    entry: &SourceEntry,
    cancel: &AtomicBool,
) -> Result<String, BackupError> {
    let mut hash = Sha256::new();
    cancelled(cancel)?;
    hash.update((path.len() as u64).to_le_bytes());
    hash.update(path);
    hash.update(entry.mode.to_le_bytes());
    match &entry.source {
        Source::Directory => hash.update([0]),
        Source::Bytes(bytes) => {
            hash.update([1]);
            hash.update(Sha256::digest(bytes));
        }
        Source::Symlink { target, directory } => {
            hash.update([2]);
            hash.update([u8::from(*directory)]);
            hash.update(Sha256::digest(target));
        }
        Source::File(source) => {
            hash.update([3]);
            // Git refs/index/config must be checked by bytes, independent of timestamps.
            let relative = decode_path(path)?;
            let is_object = relative
                .components()
                .collect::<Vec<_>>()
                .windows(2)
                .any(|p| {
                    p[0].as_os_str() == OsStr::new(".git")
                        && p[1].as_os_str() == OsStr::new("objects")
                });
            let is_object = is_object
                || relative
                    .components()
                    .collect::<Vec<_>>()
                    .windows(3)
                    .any(|p| {
                        p[0].as_os_str() == OsStr::new(".git")
                            && p[1].as_os_str() == OsStr::new("lfs")
                            && p[2].as_os_str() == OsStr::new("objects")
                    });
            if git_metadata_path(&relative) && !is_object {
                hash.update(hash_reader(File::open(source)?, cancel)?.0);
            } else {
                let meta = fs::symlink_metadata(source)?;
                if !meta.is_file() || meta.file_type().is_symlink() {
                    return Err(BackupError::Changed);
                }
                hash.update(meta.len().to_le_bytes());
                let modified = meta
                    .modified()?
                    .duration_since(UNIX_EPOCH)
                    .map_err(|_| BackupError::Io)?;
                hash.update(modified.as_nanos().to_le_bytes());
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    hash.update(meta.dev().to_le_bytes());
                    hash.update(meta.ino().to_le_bytes());
                    if !is_object {
                        hash.update(meta.ctime().to_le_bytes());
                        hash.update(meta.ctime_nsec().to_le_bytes());
                    }
                }
                #[cfg(not(unix))]
                {
                    if let Ok(created) = meta.created() {
                        hash.update(
                            created
                                .duration_since(UNIX_EPOCH)
                                .map_err(|_| BackupError::Io)?
                                .as_nanos()
                                .to_le_bytes(),
                        );
                    }
                }
            }
        }
    }
    Ok(hex(&hash.finalize()))
}
fn chunk_signature(path: &Path) -> Result<String, BackupError> {
    let meta = fs::symlink_metadata(path).map_err(|_| BackupError::Corrupt)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(BackupError::Corrupt);
    }
    let mut hash = Sha256::new();
    hash.update(meta.len().to_le_bytes());
    hash.update(
        meta.modified()?
            .duration_since(UNIX_EPOCH)
            .map_err(|_| BackupError::Io)?
            .as_nanos()
            .to_le_bytes(),
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        hash.update(meta.dev().to_le_bytes());
        hash.update(meta.ino().to_le_bytes());
        hash.update(meta.ctime().to_le_bytes());
        hash.update(meta.ctime_nsec().to_le_bytes());
    }
    #[cfg(not(unix))]
    {
        hash.update(
            meta.created()?
                .duration_since(UNIX_EPOCH)
                .map_err(|_| BackupError::Io)?
                .as_nanos()
                .to_le_bytes(),
        );
    }
    Ok(hex(&hash.finalize()))
}

fn source_digest(source: &SourceEntry, cancel: &AtomicBool) -> Result<String, BackupError> {
    match &source.source {
        Source::File(path) => Ok(hash_reader(File::open(path)?, cancel)?.0),
        Source::Bytes(bytes) => Ok(digest(bytes)),
        Source::Directory => Ok(String::new()),
        Source::Symlink { target, directory } => Ok(digest(
            &[target.as_slice(), &[u8::from(*directory)]].concat(),
        )),
    }
}
fn fingerprint(entries: &[Entry]) -> Result<String, BackupError> {
    let mut hash = Sha256::new();
    for entry in entries {
        hash.update((entry.path.len() as u64).to_le_bytes());
        hash.update(&entry.path);
        hash.update(entry.mode.to_le_bytes());
        match &entry.content {
            Content::Directory => hash.update([0]),
            Content::File {
                size,
                digest,
                chunks,
            } => {
                hash.update([1]);
                hash.update(size.to_le_bytes());
                hash.update(digest.as_bytes());
                hash.update((chunks.len() as u64).to_le_bytes());
                for chunk in chunks {
                    hash.update(chunk.as_bytes());
                }
            }
            Content::Symlink { target, directory } => {
                hash.update([2]);
                hash.update([u8::from(*directory)]);
                hash.update((target.len() as u64).to_le_bytes());
                hash.update(target);
            }
        }
    }
    Ok(hex(&hash.finalize()))
}
fn entry_chunks(entries: &[Entry]) -> HashSet<String> {
    entries
        .iter()
        .flat_map(|e| match &e.content {
            Content::File { chunks, .. } => chunks.clone(),
            _ => Vec::new(),
        })
        .collect()
}
fn retained(manifests: &[Manifest], at: u64) -> HashSet<String> {
    let mut repositories: BTreeMap<&str, Vec<&Manifest>> = BTreeMap::new();
    for manifest in manifests {
        repositories
            .entry(&manifest.point.repository_id)
            .or_default()
            .push(manifest);
    }
    let mut keep = HashSet::new();
    for points in repositories.values_mut() {
        points.sort_by_key(|m| std::cmp::Reverse(m.point.created_at));
        if let Some(latest) = points.first() {
            keep.insert(latest.point.id.clone());
        }
        let mut days = BTreeSet::new();
        let mut weeks = BTreeSet::new();
        let mut months = BTreeSet::new();
        for point in points {
            let age = at.saturating_sub(point.point.created_at);
            let day = point.point.created_at / DAY;
            // UTC calendar buckets make retention stable across locale/timezone changes.
            if age < 7 * DAY && days.insert(day) {
                keep.insert(point.point.id.clone());
            }
            if age < 28 * DAY && weeks.insert(day / 7) && weeks.len() <= 4 {
                keep.insert(point.point.id.clone());
            }
            if age < 93 * DAY && months.insert(month_bucket(day)) && months.len() <= 3 {
                keep.insert(point.point.id.clone());
            }
        }
    }
    keep
}
fn month_bucket(days: u64) -> i64 {
    // Civil date from Unix days; Gregorian calendar, avoiding a new timezone dependency.
    let z = days as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    year * 12 + month - 1
}
fn fit_budget(
    manifests: &[Manifest],
    mut keep: HashSet<String>,
    sizes: &HashMap<String, u64>,
    budget: u64,
) -> Result<HashSet<String>, BackupError> {
    let mut latest: HashMap<&str, &Manifest> = HashMap::new();
    for manifest in manifests {
        let entry = latest
            .entry(&manifest.point.repository_id)
            .or_insert(manifest);
        if manifest.point.created_at > entry.point.created_at {
            *entry = manifest;
        }
    }
    let protected: HashSet<_> = latest.values().map(|m| &m.point.id).collect();
    let mut removable: Vec<_> = manifests
        .iter()
        .filter(|m| keep.contains(&m.point.id) && !protected.contains(&m.point.id))
        .collect();
    removable.sort_by_key(|m| m.point.created_at);
    for point in removable {
        if referenced_bytes(manifests, &keep, sizes)? <= budget {
            break;
        }
        keep.remove(&point.point.id);
    }
    Ok(keep)
}
fn referenced_bytes(
    manifests: &[Manifest],
    keep: &HashSet<String>,
    sizes: &HashMap<String, u64>,
) -> Result<u64, BackupError> {
    let mut chunks = HashSet::new();
    let mut manifest_bytes = 0u64;
    for manifest in manifests.iter().filter(|m| keep.contains(&m.point.id)) {
        chunks.extend(entry_chunks(&manifest.entries));
        manifest_bytes += serde_json::to_vec(manifest)
            .map_err(|_| BackupError::Corrupt)?
            .len() as u64;
    }
    for chunk in chunks {
        manifest_bytes = manifest_bytes
            .checked_add(*sizes.get(&chunk).ok_or(BackupError::Corrupt)?)
            .ok_or(BackupError::Corrupt)?;
    }
    Ok(manifest_bytes)
}

fn verify_changed_git_objects(
    entries: &[Entry],
    previous: &BTreeMap<Vec<u8>, &Entry>,
    destination: &Path,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    let mut packs = BTreeSet::new();
    for entry in entries {
        cancelled(cancel)?;
        if previous
            .get(&entry.path)
            .is_some_and(|old| old.source_stamp == entry.source_stamp)
            || !matches!(entry.content, Content::File { .. })
        {
            continue;
        }
        let relative = decode_path(&entry.path)?;
        if !is_git_object(&relative) {
            continue;
        }
        let parts: Vec<_> = relative.components().map(|p| p.as_os_str()).collect();
        let position = parts
            .windows(2)
            .position(|p| p[0] == OsStr::new(".git") && p[1] == OsStr::new("objects"))
            .ok_or(BackupError::Corrupt)?;
        let tail = &parts[position + 2..];
        if tail.len() == 2 && tail[0] == OsStr::new("pack") {
            if matches!(
                relative.extension().and_then(OsStr::to_str),
                Some("pack" | "idx")
            ) {
                let repository: PathBuf = parts[..position].iter().collect();
                let path: PathBuf = parts[position..].iter().collect();
                packs.insert((repository, path.with_extension("idx")));
            }
        } else if tail.len() == 2 {
            let directory = tail[0].to_string_lossy();
            let filename = tail[1].to_string_lossy();
            let oid = format!("{directory}{filename}");
            if directory.len() == 2
                && matches!(oid.len(), 40 | 64)
                && oid.bytes().all(|b| b.is_ascii_hexdigit())
            {
                verify_loose_object(&destination.join(relative), &oid, cancel)?;
            }
        }
    }
    for (repository, index) in packs {
        git_os(
            &destination.join(repository),
            &[OsStr::new("verify-pack"), index.as_os_str()],
            None,
            cancel,
        )
        .map_err(|e| {
            if e == BackupError::Cancelled {
                e
            } else {
                BackupError::Incomplete
            }
        })?;
    }
    Ok(())
}
fn verify_loose_object(
    path: &Path,
    expected_oid: &str,
    cancel: &AtomicBool,
) -> Result<(), BackupError> {
    let mut decoded = flate2::read::ZlibDecoder::new(File::open(path)?);
    let mut header = Vec::new();
    loop {
        let mut byte = [0];
        decoded
            .read_exact(&mut byte)
            .map_err(|_| BackupError::Incomplete)?;
        header.push(byte[0]);
        if byte[0] == 0 {
            break;
        }
        if header.len() > 128 {
            return Err(BackupError::Incomplete);
        }
    }
    let text =
        std::str::from_utf8(&header[..header.len() - 1]).map_err(|_| BackupError::Incomplete)?;
    let (kind, size) = text.split_once(' ').ok_or(BackupError::Incomplete)?;
    if !matches!(kind, "blob" | "tree" | "commit" | "tag") {
        return Err(BackupError::Incomplete);
    }
    let expected_size = size.parse::<u64>().map_err(|_| BackupError::Incomplete)?;
    let mut sha1 = (expected_oid.len() == 40).then(|| gix::hash::hasher(gix::hash::Kind::Sha1));
    let mut sha256 = Sha256::new();
    if let Some(hash) = &mut sha1 {
        hash.update(&header);
    } else {
        sha256.update(&header);
    }
    let mut size = 0u64;
    let mut buffer = vec![0; CHUNK_BYTES];
    loop {
        cancelled(cancel)?;
        let read = decoded
            .read(&mut buffer)
            .map_err(|_| BackupError::Incomplete)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        if size > expected_size {
            return Err(BackupError::Incomplete);
        }
        if let Some(hash) = &mut sha1 {
            hash.update(&buffer[..read]);
        } else {
            sha256.update(&buffer[..read]);
        }
        thread::yield_now();
    }
    let actual = if let Some(hash) = sha1 {
        hash.try_finalize()
            .map_err(|_| BackupError::Incomplete)?
            .to_string()
    } else {
        hex(&sha256.finalize())
    };
    if size != expected_size || actual != expected_oid {
        return Err(BackupError::Incomplete);
    }
    Ok(())
}
fn verify_repositories(
    entries: &[Entry],
    destination: &Path,
    cancel: &AtomicBool,
    full: bool,
) -> Result<(), BackupError> {
    let mut repositories = Vec::new();
    for entry in entries {
        let path = decode_path(&entry.path)?;
        if path.file_name() == Some(OsStr::new("HEAD"))
            && path.parent().and_then(Path::file_name) == Some(OsStr::new(".git"))
        {
            repositories.push(
                destination.join(
                    path.parent()
                        .and_then(Path::parent)
                        .unwrap_or(Path::new("")),
                ),
            );
        }
    }
    if repositories.is_empty() {
        return Err(BackupError::Corrupt);
    }
    // A real, empty directory also works with Windows verbatim paths. Device
    // names such as NUL are not ordinary directories and cannot safely disable hooks.
    let hooks = tempfile::Builder::new()
        .prefix(".gitthul-verify-hooks-")
        .tempdir_in(destination)?;
    let hooks_setting = format!("core.hooksPath={}", hooks.path().to_string_lossy());
    for repository in repositories {
        git(
            &repository,
            &[
                "-c",
                "core.fsmonitor=false",
                "-c",
                &hooks_setting,
                "fsck",
                if full {
                    "--full"
                } else {
                    "--connectivity-only"
                },
                "--strict",
                "--no-dangling",
            ],
            None,
            cancel,
        )
        .map_err(|error| {
            if error == BackupError::Cancelled {
                error
            } else {
                BackupError::Incomplete
            }
        })?;
    }
    Ok(())
}
fn git_metadata_path(path: &Path) -> bool {
    path.components()
        .any(|c| c.as_os_str() == OsStr::new(".git"))
}
fn git_path(
    repository: &Path,
    argument: &str,
    cancel: &AtomicBool,
) -> Result<PathBuf, BackupError> {
    let output = git(repository, &["rev-parse", argument], None, cancel)?;
    fs::canonicalize(output_path(&output, repository)?).map_err(|_| BackupError::GitFailed)
}
fn output_path(bytes: &[u8], relative_to: &Path) -> Result<PathBuf, BackupError> {
    let bytes = bytes
        .strip_suffix(b"\n")
        .unwrap_or(bytes)
        .strip_suffix(b"\r")
        .unwrap_or(bytes.strip_suffix(b"\n").unwrap_or(bytes));
    let path = PathBuf::from(decode_os(bytes)?);
    Ok(if path.is_absolute() {
        path
    } else {
        relative_to.join(path)
    })
}
fn git(
    repository: &Path,
    arguments: &[&str],
    input: Option<&[u8]>,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, BackupError> {
    let arguments: Vec<_> = arguments.iter().map(OsStr::new).collect();
    git_os(repository, &arguments, input, cancel)
}
fn git_os(
    repository: &Path,
    arguments: &[&OsStr],
    input: Option<&[u8]>,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, BackupError> {
    cancelled(cancel)?;
    let mut child = crate::process::command("git")
        .current_dir(repository)
        .args(["-c", "core.fsmonitor=false"])
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| BackupError::GitFailed)?;
    let stdout = child.stdout.take().ok_or(BackupError::GitFailed)?;
    let stdin = child.stdin.take();
    let input = input.map(<[u8]>::to_owned);
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(COMMAND_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| BackupError::Io)?;
        if bytes.len() as u64 > COMMAND_BYTES {
            Err(BackupError::Incomplete)
        } else {
            Ok(bytes)
        }
    });
    let writer = thread::spawn(move || -> Result<(), BackupError> {
        if let (Some(mut stdin), Some(input)) = (stdin, input) {
            stdin.write_all(&input)?;
        }
        Ok(())
    });
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            let _ = writer.join();
            return Err(BackupError::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                let _ = writer.join();
                return Err(BackupError::GitFailed);
            }
        }
    };
    let bytes = reader.join().map_err(|_| BackupError::Io)??;
    writer.join().map_err(|_| BackupError::Io)??;
    if !status.success() {
        return Err(BackupError::GitFailed);
    }
    Ok(bytes)
}
fn repository_identity(git_dir: &Path) -> Result<String, BackupError> {
    let meta = fs::metadata(git_dir)?;
    let mut bytes = encode_path(git_dir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        bytes.extend(meta.dev().to_le_bytes());
        bytes.extend(meta.ino().to_le_bytes());
    }
    #[cfg(not(unix))]
    {
        bytes.extend(
            meta.created()?
                .duration_since(UNIX_EPOCH)
                .map_err(|_| BackupError::Io)?
                .as_nanos()
                .to_le_bytes(),
        );
    }
    Ok(digest(&bytes))
}
fn cancelled(cancel: &AtomicBool) -> Result<(), BackupError> {
    if cancel.load(Ordering::Relaxed) {
        Err(BackupError::Cancelled)
    } else {
        Ok(())
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
fn digest(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn valid_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn hash_reader(mut reader: impl Read, cancel: &AtomicBool) -> Result<(String, u64), BackupError> {
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = vec![0; CHUNK_BYTES];
    loop {
        cancelled(cancel)?;
        let size = reader.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        #[cfg(test)]
        READ_BYTES.with(|counter| counter.set(counter.get() + size as u64));
        hash.update(&buffer[..size]);
        total += size as u64;
        thread::yield_now();
    }
    Ok((hex(&hash.finalize()), total))
}
fn read_chunk(path: &Path, expected: &str) -> Result<Vec<u8>, BackupError> {
    let meta = fs::symlink_metadata(path).map_err(|_| BackupError::Corrupt)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > (CHUNK_BYTES * 2) as u64 {
        return Err(BackupError::Corrupt);
    }
    let mut decoded = Vec::new();
    GzDecoder::new(File::open(path)?)
        .take(CHUNK_BYTES as u64 + 1)
        .read_to_end(&mut decoded)
        .map_err(|_| BackupError::Corrupt)?;
    #[cfg(test)]
    READ_BYTES.with(|counter| counter.set(counter.get() + decoded.len() as u64));
    if decoded.len() > CHUNK_BYTES || digest(&decoded) != expected {
        return Err(BackupError::Corrupt);
    }
    Ok(decoded)
}
fn validate_entries(entries: &[Entry]) -> Result<(), BackupError> {
    if entries.len() > 200_000 {
        return Err(BackupError::Incomplete);
    }
    let mut paths = HashSet::new();
    let mut links = HashSet::new();
    for entry in entries {
        let path = decode_path(&entry.path)?;
        if !entry.source_stamp.is_empty() && !valid_id(&entry.source_stamp) {
            return Err(BackupError::Corrupt);
        }
        if !paths.insert(path.clone()) {
            return Err(BackupError::Corrupt);
        }
        match &entry.content {
            Content::Symlink { target, .. } => {
                decode_os(target)?;
                links.insert(path);
            }
            Content::File {
                size,
                digest,
                chunks,
            } => {
                if !valid_id(digest)
                    || chunks.iter().any(|id| !valid_id(id))
                    || (*size > 0 && chunks.is_empty())
                    || (*size == 0 && !chunks.is_empty())
                    || chunks.len() as u64 != size.div_ceil(CHUNK_BYTES as u64)
                {
                    return Err(BackupError::Corrupt);
                }
            }
            Content::Directory => (),
        }
    }
    for path in &paths {
        for parent in path.ancestors().skip(1) {
            if links.contains(parent) {
                return Err(BackupError::Corrupt);
            }
        }
    }
    Ok(())
}
fn encode_path(path: &Path) -> Vec<u8> {
    // Absolute paths identify the source repository and retain their native
    // representation, including Windows verbatim prefixes. Relative entries use
    // one separator so filesystem paths and synthetic .git paths share a key.
    #[cfg(windows)]
    if !path.is_absolute() {
        let normalized: PathBuf = path.components().collect();
        return encode_os(normalized.as_os_str())
            .into_iter()
            .map(|byte| if byte == b'\\' { b'/' } else { byte })
            .collect();
    }
    encode_os(path.as_os_str())
}
fn encode_os(value: &OsStr) -> Vec<u8> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        value.as_bytes().to_vec()
    }
    #[cfg(not(unix))]
    {
        value.to_string_lossy().as_bytes().to_vec()
    }
}
fn decode_os(bytes: &[u8]) -> Result<OsString, BackupError> {
    if bytes.contains(&0) {
        return Err(BackupError::InvalidPath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(OsString::from_vec(bytes.to_vec()))
    }
    #[cfg(not(unix))]
    {
        String::from_utf8(bytes.to_vec())
            .map(OsString::from)
            .map_err(|_| BackupError::InvalidPath)
    }
}
fn decode_path(bytes: &[u8]) -> Result<PathBuf, BackupError> {
    let path = PathBuf::from(decode_os(bytes)?);
    if bytes.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(BackupError::InvalidPath);
    }
    // A manifest copied between operating systems must not gain an absolute/drive path.
    if bytes.starts_with(b"/")
        || bytes.starts_with(b"\\")
        || bytes.get(1) == Some(&b':')
        || bytes
            .split(|b| *b == b'/' || *b == b'\\')
            .any(|p| p == b".." || p == b".")
    {
        return Err(BackupError::InvalidPath);
    }
    Ok(path)
}
fn ensure_safe_parent(root: &Path, relative: &Path) -> Result<(), BackupError> {
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || fs::canonicalize(root)? != root {
        return Err(BackupError::InvalidPath);
    }
    let mut path = root.to_owned();
    for component in relative.parent().unwrap_or(Path::new("")).components() {
        path.push(component.as_os_str());
        match fs::symlink_metadata(&path) {
            Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
                return Err(BackupError::InvalidPath)
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&path)?,
            Err(_) => return Err(BackupError::Io),
        }
    }
    Ok(())
}
fn disk_identity(path: &Path) -> Result<String, BackupError> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(BackupError::InvalidPath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(format!("{}:{}", meta.dev(), meta.ino()))
    }
    #[cfg(not(unix))]
    {
        Ok(format!(
            "{}",
            meta.created()?
                .duration_since(UNIX_EPOCH)
                .map_err(|_| BackupError::Io)?
                .as_nanos()
        ))
    }
}
fn create_private_directory(path: &Path) -> Result<(), BackupError> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|_| BackupError::InvalidPath)
}
fn private_directory(path: &Path) -> Result<(), BackupError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err(BackupError::InvalidPath)
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(path)?,
        Err(_) => return Err(BackupError::Io),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn directory_bytes(path: &Path) -> Result<u64, BackupError> {
    let mut size = 0u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        if meta.is_dir() && !meta.file_type().is_symlink() {
            size = size.saturating_add(directory_bytes(&entry.path())?);
        } else if meta.is_file() && !meta.file_type().is_symlink() {
            size = size.saturating_add(meta.len());
        }
    }
    Ok(size)
}
fn create_private_file(path: &Path) -> Result<File, BackupError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}
fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), BackupError> {
    let staging = path
        .parent()
        .and_then(Path::parent)
        .ok_or(BackupError::InvalidPath)?
        .join("staging");
    let mut file = tempfile::Builder::new()
        .prefix("manifest-")
        .tempfile_in(staging)?;
    serde_json::to_writer(&mut file, value).map_err(|_| BackupError::Io)?;
    file.flush()?;
    file.as_file().sync_all()?;
    file.persist_noclobber(path).map_err(|_| BackupError::Io)?;
    Ok(())
}
fn write_json_replace(path: &Path, value: &impl Serialize) -> Result<(), BackupError> {
    let staging = path
        .parent()
        .and_then(Path::parent)
        .ok_or(BackupError::InvalidPath)?
        .join("staging");
    let mut file = tempfile::Builder::new()
        .prefix("manifest-")
        .tempfile_in(staging)?;
    serde_json::to_writer(&mut file, value).map_err(|_| BackupError::Io)?;
    file.flush()?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|_| BackupError::Io)?;
    Ok(())
}
fn sync_directory(path: &Path) -> Result<(), BackupError> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
fn mode(meta: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o777
    }
    #[cfg(not(unix))]
    {
        if meta.permissions().readonly() {
            0o444
        } else {
            0o644
        }
    }
}
fn set_mode(path: &Path, bits: u32) -> Result<(), BackupError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(bits & 0o777))?;
    }
    #[cfg(not(unix))]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_readonly(bits & 0o222 == 0);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}
fn directory_symlink(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;
        meta.file_type().is_symlink_dir()
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}
fn create_symlink(target: &OsStr, path: &Path, directory: bool) -> Result<(), BackupError> {
    #[cfg(unix)]
    {
        let _ = directory;
        std::os::unix::fs::symlink(target, path)?;
        Ok(())
    }
    #[cfg(windows)]
    {
        if directory {
            std::os::windows::fs::symlink_dir(target, path)
        } else {
            std::os::windows::fs::symlink_file(target, path)
        }
        .map_err(|_| BackupError::Incomplete)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, path, directory);
        Err(BackupError::Incomplete)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const START: u64 = 1_797_120_000_000;
    fn run(repository: &Path, args: &[&str]) -> String {
        let output = crate::process::command("git")
            .current_dir(repository)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env(
                "GIT_CONFIG_GLOBAL",
                repository.join("fixture-global-config"),
            )
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    #[test]
    fn synthetic_and_walked_metadata_paths_share_one_manifest_key() {
        for suffix in ["objects/pack", "objects/info", "refs/worktree", "logs/HEAD"] {
            let synthetic = Path::new(".git").join(suffix);
            let walked = suffix
                .split('/')
                .fold(PathBuf::from(".git"), |path, name| path.join(name));
            assert_eq!(encode_path(&synthetic), encode_path(&walked));
            assert_eq!(encode_path(&synthetic), format!(".git/{suffix}").as_bytes());
        }
    }

    #[cfg(windows)]
    #[test]
    fn relative_path_keys_do_not_change_absolute_verbatim_paths_or_symlink_targets() {
        let absolute = Path::new(r"\\?\C:\Users\runneradmin\repository\.git");
        assert_eq!(encode_path(absolute), encode_os(absolute.as_os_str()));
        let target = OsStr::new(r"..\directory\file.txt");
        assert_eq!(decode_os(&encode_os(target)).unwrap(), target);
    }

    #[cfg(windows)]
    #[test]
    fn a_manifest_with_duplicate_windows_path_spellings_is_still_rejected() {
        let entries = [br".git\objects\pack".as_slice(), b".git/objects/pack"].map(|path| Entry {
            source_stamp: String::new(),
            path: path.to_vec(),
            mode: 0o700,
            content: Content::Directory,
        });
        assert_eq!(validate_entries(&entries), Err(BackupError::Corrupt));
    }

    #[test]
    fn collected_metadata_has_one_entry_for_each_decoded_path() {
        let (_root, repository, _store) = fixture();
        let sources = collect_repository(&repository, &AtomicBool::new(false)).unwrap();
        let paths: HashSet<_> = sources
            .keys()
            .map(|path| decode_path(path).unwrap())
            .collect();
        assert_eq!(paths.len(), sources.len());
        assert_eq!(
            sources
                .keys()
                .filter(|path| decode_path(path).unwrap() == Path::new(".git/objects/pack"))
                .count(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_literal_backslash_in_a_unix_filename_is_not_changed_into_a_separator() {
        assert_eq!(encode_path(Path::new(r"literal\name")), br"literal\name");
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, BackupStore) {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("original");
        fs::create_dir(&repository).unwrap();
        run(&repository, &["init", "-b", "main"]);
        run(&repository, &["config", "user.name", "Backup Fixture"]);
        run(
            &repository,
            &["config", "user.email", "backup@example.invalid"],
        );
        run(&repository, &["config", "core.autocrlf", "false"]);
        run(&repository, &["config", "core.filemode", "true"]);
        fs::write(repository.join("tracked.txt"), "original\n").unwrap();
        fs::write(repository.join(".gitignore"), "ignored/\n").unwrap();
        run(&repository, &["add", "."]);
        run(&repository, &["commit", "-m", "initial"]);
        let store = BackupStore::new(root.path().join("backups"), BackupPolicy::default()).unwrap();
        (root, repository, store)
    }
    fn create(store: &BackupStore, repository: &Path, at: u64) -> BackupPoint {
        match store
            .capture_at(repository, &AtomicBool::new(false), at)
            .unwrap()
        {
            CaptureOutcome::Created { point } => point,
            result => panic!("unexpected {result:?}"),
        }
    }
    #[test]
    fn restores_entire_repository_after_source_is_deleted_with_index_worktree_stash_and_history() {
        let (root, repository, store) = fixture();
        run(&repository, &["branch", "feature"]);
        run(&repository, &["tag", "v1"]);
        fs::write(repository.join("tracked.txt"), "stashed content\n").unwrap();
        fs::write(repository.join("stash-untracked.txt"), "stash untracked\n").unwrap();
        run(
            &repository,
            &[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                "complete stash",
            ],
        );
        fs::write(repository.join("tracked.txt"), "staged\n").unwrap();
        run(&repository, &["add", "tracked.txt"]);
        fs::write(repository.join("tracked.txt"), "unstaged\n").unwrap();
        fs::write(repository.join("untracked.txt"), b"untracked\0bytes\xff").unwrap();
        fs::create_dir(repository.join("ignored")).unwrap();
        fs::write(repository.join("ignored/cache"), "excluded").unwrap();
        run(
            &repository,
            &["update-index", "--assume-unchanged", ".gitignore"],
        );
        run(
            &repository,
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/missing.git",
            ],
        );
        let before_refs = run(&repository, &["show-ref"]);
        let before_index = fs::read(repository.join(".git/index")).unwrap();
        let before_status = run(
            &repository,
            &["status", "--porcelain=v1", "--untracked-files=all"],
        );
        let point = create(&store, &repository, START);
        fs::remove_dir_all(&repository).unwrap();
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(fs::read(restored.join(".git/index")).unwrap(), before_index);
        assert_eq!(run(&restored, &["show-ref"]), before_refs);
        assert_eq!(
            run(
                &restored,
                &["status", "--porcelain=v1", "--untracked-files=all"]
            ),
            before_status
        );
        assert_eq!(
            fs::read(restored.join("untracked.txt")).unwrap(),
            b"untracked\0bytes\xff"
        );
        assert_eq!(
            fs::read_to_string(restored.join("tracked.txt")).unwrap(),
            "unstaged\n"
        );
        assert_eq!(run(&restored, &["show", ":tracked.txt"]), "staged\n");
        assert!(!restored.join("ignored").exists());
        assert_eq!(
            run(&restored, &["show", "stash@{0}^3:stash-untracked.txt"]),
            "stash untracked\n"
        );
        assert_eq!(
            run(
                &restored,
                &["config", "--local", "--get", "remote.origin.url"]
            ),
            "https://example.invalid/missing.git\n"
        );
        run(&restored, &["fsck", "--full", "--strict"]);
    }
    #[test]
    fn only_changed_daily_points_are_created_and_storage_reuses_content() {
        let (_root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        let first_bytes = store.list().unwrap().total_bytes;
        assert!(
            matches!(store.capture_at(&repository, &AtomicBool::new(false), START + 1).unwrap(), CaptureOutcome::TooSoon { next_at } if next_at == START + DAY)
        );
        assert!(matches!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START + DAY)
                .unwrap(),
            CaptureOutcome::Unchanged
        ));
        assert_eq!(store.list().unwrap().total_bytes, first_bytes);
        fs::write(repository.join("untracked.txt"), "new\n").unwrap();
        let second = create(&store, &repository, START + DAY);
        let list = store.list().unwrap();
        assert_eq!(list.points.len(), 2);
        assert!(
            store.chunk_sizes(None).unwrap().values().sum::<u64>()
                < first.size_bytes + second.size_bytes
        );
        let before = store.chunk_sizes(None).unwrap().len();
        fs::write(repository.join("untracked.txt"), "another\n").unwrap();
        create(&store, &repository, START + 2 * DAY);
        assert!(store.chunk_sizes(None).unwrap().len() <= before + 2);
    }
    #[test]
    fn rejected_budget_and_cancellation_preserve_last_valid_point_and_clean_temporary_files() {
        let (root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        store
            .update_policy(BackupPolicy {
                enabled: true,
                max_mi_b: 1,
            })
            .unwrap();
        let mut bytes = vec![0; 2 * CHUNK_BYTES];
        getrandom::getrandom(&mut bytes).unwrap();
        fs::write(repository.join("large.bin"), bytes).unwrap();
        let result = store.capture_at(&repository, &AtomicBool::new(false), START + DAY);
        assert!(matches!(
            result,
            Err(BackupError::NoSpace) | Ok(CaptureOutcome::NoSpace)
        ));
        assert_eq!(store.list().unwrap().points[0].id, first.id);
        assert_eq!(fs::read_dir(store.root.join("staging")).unwrap().count(), 0);
        assert!(store.total_bytes().unwrap() <= 1024 * 1024);
        assert_eq!(
            store
                .capture(&repository, &AtomicBool::new(true))
                .unwrap_err(),
            BackupError::Cancelled
        );
        fs::remove_dir_all(&repository).unwrap();
        store
            .restore(
                &first.id,
                &root.path().join("recovered"),
                &AtomicBool::new(false),
            )
            .unwrap();
    }
    #[test]
    fn retention_uses_daily_weekly_monthly_without_duplicates_and_never_expires_last_point() {
        let (_root, repository, store) = fixture();
        let mut all = Vec::new();
        for day in 0..101 {
            fs::write(repository.join("untracked.txt"), format!("{day}\n")).unwrap();
            all.push(create(&store, &repository, START + day * DAY));
        }
        let points = store.list().unwrap().points;
        assert!(points.len() <= 14 && points.len() >= 7, "{}", points.len());
        assert_eq!(
            points.iter().map(|p| &p.id).collect::<HashSet<_>>().len(),
            points.len()
        );
        let latest = all.last().unwrap().id.clone();
        let gate = store.gate.lock().unwrap();
        let manifests = store.manifests().unwrap();
        store.prune(&manifests, START + 1000 * DAY, 1).unwrap();
        drop(gate);
        let remaining = store.list().unwrap().points;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, latest);
        fs::remove_dir_all(repository).unwrap();
        assert_eq!(store.list().unwrap().points[0].id, latest);
    }
    #[test]
    fn budget_is_global_and_keeps_latest_of_deleted_other_repository() {
        let (root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        fs::remove_dir_all(&repository).unwrap();
        let second = root.path().join("another");
        fs::create_dir(&second).unwrap();
        run(&second, &["init", "-b", "main"]);
        run(&second, &["config", "user.name", "Fixture"]);
        run(&second, &["config", "user.email", "test@example.invalid"]);
        fs::write(second.join("new.txt"), "new").unwrap();
        run(&second, &["add", "."]);
        run(&second, &["commit", "-m", "new"]);
        let second_point = create(&store, &second, START + DAY);
        let gate = store.gate.lock().unwrap();
        let manifests = store.manifests().unwrap();
        store.prune(&manifests, START + 1000 * DAY, 1).unwrap();
        drop(gate);
        let points = store.list().unwrap().points;
        assert_eq!(points.len(), 2);
        assert!(points.iter().any(|p| p.id == first.id));
        assert!(points.iter().any(|p| p.id == second_point.id));
    }
    #[test]
    fn alternates_are_flattened_and_survive_deleting_both_source_repositories() {
        let (root, original, store) = fixture();
        run(&original, &["gc"]);
        let clone = root.path().join("shared");
        let output = crate::process::command("git")
            .args([
                OsStr::new("clone"),
                OsStr::new("--shared"),
                original.as_os_str(),
                clone.as_os_str(),
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        let point = create(&store, &clone, START);
        fs::remove_dir_all(&clone).unwrap();
        fs::remove_dir_all(&original).unwrap();
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert!(!restored.join(".git/objects/info/alternates").exists());
        assert_eq!(run(&restored, &["show", "HEAD:tracked.txt"]), "original\n");
        run(&restored, &["fsck", "--full"]);
    }
    #[test]
    fn linked_worktree_becomes_an_independent_repository_with_its_own_head_and_index() {
        let (root, main, store) = fixture();
        let linked = root.path().join("linked");
        run(
            &main,
            &[
                "worktree",
                "add",
                "-b",
                "linked-branch",
                linked.to_str().unwrap(),
            ],
        );
        fs::write(linked.join("tracked.txt"), "linked staged\n").unwrap();
        run(&linked, &["add", "tracked.txt"]);
        fs::write(linked.join("tracked.txt"), "linked unstaged\n").unwrap();
        let before = run(&linked, &["status", "--porcelain=v1"]);
        let point = create(&store, &linked, START);
        fs::remove_dir_all(&linked).unwrap();
        fs::remove_dir_all(&main).unwrap();
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert!(restored.join(".git").is_dir());
        assert!(!restored.join(".git/commondir").exists());
        assert_eq!(
            run(&restored, &["branch", "--show-current"]),
            "linked-branch\n"
        );
        assert_eq!(run(&restored, &["status", "--porcelain=v1"]), before);
        assert_eq!(run(&restored, &["show", ":tracked.txt"]), "linked staged\n");
    }
    #[test]
    fn initialized_submodule_is_independent_and_missing_submodule_prevents_publication() {
        let (root, repository, store) = fixture();
        let source = root.path().join("module-source");
        fs::create_dir(&source).unwrap();
        run(&source, &["init", "-b", "main"]);
        run(&source, &["config", "user.name", "Module"]);
        run(&source, &["config", "user.email", "module@example.invalid"]);
        fs::write(source.join("module.txt"), "module data\n").unwrap();
        run(&source, &["add", "."]);
        run(&source, &["commit", "-m", "module"]);
        run(
            &repository,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source.to_str().unwrap(),
                "vendor",
            ],
        );
        run(&repository, &["commit", "-am", "submodule"]);
        fs::write(repository.join("vendor/untracked.txt"), "module WIP\n").unwrap();
        let point = create(&store, &repository, START);
        fs::remove_dir_all(&repository).unwrap();
        fs::remove_dir_all(&source).unwrap();
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert!(restored.join("vendor/.git").is_dir());
        assert_eq!(
            run(&restored.join("vendor"), &["show", "HEAD:module.txt"]),
            "module data\n"
        );
        assert_eq!(
            fs::read_to_string(restored.join("vendor/untracked.txt")).unwrap(),
            "module WIP\n"
        );
        run(&restored, &["submodule", "deinit", "--force", "vendor"]);
        assert!(matches!(
            store.capture_at(&restored, &AtomicBool::new(false), START + DAY),
            Err(BackupError::Incomplete)
        ));
    }
    #[test]
    fn local_lfs_objects_are_saved_and_missing_historical_lfs_payload_rejects_capture() {
        let (root, repository, store) = fixture();
        let payload = b"large binary fixture\0bytes";
        let oid = digest(payload);
        let pointer = format!(
            "version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {}\n",
            payload.len()
        );
        fs::write(repository.join("lfs.bin"), pointer).unwrap();
        run(&repository, &["add", "lfs.bin"]);
        run(&repository, &["commit", "-m", "LFS pointer"]);
        assert!(matches!(
            store.capture_at(&repository, &AtomicBool::new(false), START),
            Err(BackupError::Incomplete)
        ));
        assert!(store.list().unwrap().points.is_empty());
        let object = repository
            .join(".git/lfs/objects")
            .join(&oid[..2])
            .join(&oid[2..4])
            .join(&oid);
        fs::create_dir_all(object.parent().unwrap()).unwrap();
        fs::write(&object, payload).unwrap();
        let point = create(&store, &repository, START);
        fs::remove_dir_all(&repository).unwrap();
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            fs::read(
                restored
                    .join(".git/lfs/objects")
                    .join(&oid[..2])
                    .join(&oid[2..4])
                    .join(&oid)
            )
            .unwrap(),
            payload
        );
    }
    #[test]
    fn invalid_manifest_paths_and_existing_restore_destinations_never_overwrite_files() {
        let (root, repository, store) = fixture();
        let point = create(&store, &repository, START);
        let existing = root.path().join("existing");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("keep.txt"), "safe").unwrap();
        assert_eq!(
            store
                .restore(&point.id, &existing, &AtomicBool::new(false))
                .unwrap_err(),
            BackupError::InvalidPath
        );
        assert_eq!(
            fs::read_to_string(existing.join("keep.txt")).unwrap(),
            "safe"
        );
        assert_eq!(
            store
                .restore(
                    "../escape",
                    &root.path().join("target"),
                    &AtomicBool::new(false)
                )
                .unwrap_err(),
            BackupError::InvalidPath
        );
        for path in [
            b"../escape".as_slice(),
            b"/escape",
            b"C:\\escape",
            b"folder/../../escape",
            b"folder\\..\\escape",
        ] {
            assert!(decode_path(path).is_err(), "{path:?}");
        }
        let path = store.root.join("points").join(format!("{}.json", point.id));
        let mut manifest: Manifest = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest.entries.push(Entry {
            source_stamp: String::new(),
            path: b"../outside".to_vec(),
            mode: 0o600,
            content: Content::Directory,
        });
        fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(store
            .restore(
                &point.id,
                &root.path().join("target"),
                &AtomicBool::new(false)
            )
            .is_err());
        assert!(!root.path().join("outside").exists());
        assert!(!root.path().join("target").exists());
    }
    #[test]
    fn corrupted_shared_data_is_not_published_or_restored_and_cleanup_is_conservative() {
        let (root, repository, store) = fixture();
        let point = create(&store, &repository, START);
        let manifests = store.manifests().unwrap();
        let id = entry_chunks(&manifests[0].entries)
            .into_iter()
            .next()
            .unwrap();
        fs::write(store.root.join("chunks").join(id), "corrupt").unwrap();
        let destination = root.path().join("failed");
        assert!(store
            .restore(&point.id, &destination, &AtomicBool::new(false))
            .is_err());
        assert!(!destination.exists());
        fs::write(repository.join("new.txt"), "new").unwrap();
        assert!(matches!(
            store.capture_at(&repository, &AtomicBool::new(false), START + DAY),
            Err(BackupError::Corrupt)
        ));
        assert_eq!(store.list().unwrap().corrupt_points, 1);
        assert!(store
            .root
            .join("points")
            .join(format!("{}.json", point.id))
            .exists());
        fs::write(
            store.root.join("points").join(format!("{}.json", point.id)),
            "invalid manifest",
        )
        .unwrap();
        assert_eq!(
            store
                .update_policy(BackupPolicy {
                    max_mi_b: 1,
                    enabled: true
                })
                .unwrap_err(),
            BackupError::Corrupt
        );
        assert!(store
            .root
            .join("points")
            .join(format!("{}.json", point.id))
            .exists());
    }
    #[test]
    fn source_git_lock_refuses_a_capture_and_preserves_current_point() {
        let (_root, repository, store) = fixture();
        let point = create(&store, &repository, START);
        fs::write(repository.join(".git/index.lock"), b"busy").unwrap();
        assert_eq!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START + DAY)
                .unwrap_err(),
            BackupError::Changed
        );
        assert_eq!(store.list().unwrap().points[0].id, point.id);
    }
    #[test]
    fn explicit_deletion_removes_only_its_point_and_unshared_chunks() {
        let (_root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        fs::write(repository.join("untracked.txt"), "second").unwrap();
        let second = create(&store, &repository, START + DAY);
        let before = store.chunk_sizes(None).unwrap().len();
        store.delete(&first.id).unwrap();
        assert_eq!(store.list().unwrap().points[0].id, second.id);
        assert!(store.chunk_sizes(None).unwrap().len() <= before);
        store.delete(&second.id).unwrap();
        assert!(store.list().unwrap().points.is_empty());
        assert_eq!(store.total_bytes().unwrap(), 0);
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_are_preserved_without_copying_external_contents_and_traversal_is_rejected() {
        let (root, repository, store) = fixture();
        fs::write(
            root.path().join("external.txt"),
            "external data not in backup",
        )
        .unwrap();
        std::os::unix::fs::symlink("../external.txt", repository.join("link.txt")).unwrap();
        let point = create(&store, &repository, START);
        let manifest = store.manifests().unwrap().remove(0);
        assert!(manifest
            .entries
            .iter()
            .any(|e| e.path == b"link.txt" && matches!(e.content, Content::Symlink { .. })));
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            fs::read_link(restored.join("link.txt")).unwrap(),
            Path::new("../external.txt")
        );
        let malicious = vec![
            Entry {
                source_stamp: String::new(),
                path: b"link".to_vec(),
                mode: 0o777,
                content: Content::Symlink {
                    target: b"../".to_vec(),
                    directory: false,
                },
            },
            Entry {
                source_stamp: String::new(),
                path: b"link/outside".to_vec(),
                mode: 0o600,
                content: Content::Directory,
            },
        ];
        assert_eq!(
            validate_entries(&malicious).unwrap_err(),
            BackupError::Corrupt
        );
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn non_utf8_filenames_round_trip_without_loss() {
        use std::os::unix::ffi::OsStringExt;
        let (root, repository, store) = fixture();
        let filename = OsString::from_vec(b"binary-\xff.txt".to_vec());
        fs::write(repository.join(&filename), "raw name").unwrap();
        let point = create(&store, &repository, START);
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            fs::read_to_string(restored.join(filename)).unwrap(),
            "raw name"
        );
    }
    #[test]
    fn abandoned_capture_and_manifest_files_are_removed_before_budget_checks() {
        let (_root, repository, store) = fixture();
        let abandoned = store.root.join("staging/capture-abandoned");
        fs::create_dir(&abandoned).unwrap();
        fs::write(
            abandoned.join("large-temporary.bin"),
            vec![7; 2 * CHUNK_BYTES],
        )
        .unwrap();
        fs::write(
            store.root.join("staging/manifest-abandoned"),
            "not published",
        )
        .unwrap();
        store
            .update_policy(BackupPolicy {
                enabled: true,
                max_mi_b: 1,
            })
            .unwrap();
        assert_eq!(fs::read_dir(store.root.join("staging")).unwrap().count(), 0);
        create(&store, &repository, START);
        assert!(store.list().unwrap().total_bytes <= 1024 * 1024);
    }
    #[test]
    fn metadata_only_changes_refresh_fast_cache_without_creating_a_new_point() {
        let (_root, repository, store) = fixture();
        let point = create(&store, &repository, START);
        let before = store.manifests().unwrap()[0].source_signature.clone();
        thread::sleep(Duration::from_millis(10));
        fs::write(repository.join("tracked.txt"), "original\n").unwrap();
        assert!(matches!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START + DAY)
                .unwrap(),
            CaptureOutcome::Unchanged
        ));
        let manifests = store.manifests().unwrap();
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].point.id, point.id);
        assert_ne!(manifests[0].source_signature, before);
        assert_eq!(
            manifests[0].source_signature,
            source_signature(
                &collect_repository(&repository, &AtomicBool::new(false)).unwrap(),
                &AtomicBool::new(false)
            )
            .unwrap()
        );
    }
    #[cfg(unix)]
    #[test]
    fn ignored_symlink_replacing_a_tracked_directory_is_saved_without_following_it() {
        let (root, repository, store) = fixture();
        fs::create_dir(repository.join("directory")).unwrap();
        fs::write(repository.join("directory/tracked.txt"), "original file\n").unwrap();
        run(&repository, &["add", "directory"]);
        run(&repository, &["commit", "-m", "directory"]);
        fs::remove_dir_all(repository.join("directory")).unwrap();
        let external = root.path().join("external");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("tracked.txt"), "must not be copied").unwrap();
        std::os::unix::fs::symlink("../external", repository.join("directory")).unwrap();
        fs::write(repository.join(".gitignore"), "directory\n").unwrap();
        let point = create(&store, &repository, START);
        let manifest = store.manifests().unwrap().remove(0);
        assert!(manifest
            .entries
            .iter()
            .any(|e| e.path == b"directory" && matches!(e.content, Content::Symlink { .. })));
        assert!(!manifest
            .entries
            .iter()
            .any(|e| e.path == b"directory/tracked.txt"));
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            fs::read_link(restored.join("directory")).unwrap(),
            Path::new("../external")
        );
    }
    #[test]
    fn cleanup_runs_before_unchanged_or_too_soon_return() {
        let (_root, repository, store) = fixture();
        create(&store, &repository, START);
        for (at, soon) in [(START + 1, true), (START + DAY, false)] {
            let abandoned = store.root.join("staging/capture-abandoned");
            fs::create_dir(&abandoned).unwrap();
            fs::write(abandoned.join("leftover"), vec![2; CHUNK_BYTES]).unwrap();
            assert!(store.list().unwrap().total_bytes > CHUNK_BYTES as u64);
            let result = store
                .capture_at(&repository, &AtomicBool::new(false), at)
                .unwrap();
            if soon {
                assert!(matches!(result, CaptureOutcome::TooSoon { .. }));
            } else {
                assert!(matches!(result, CaptureOutcome::Unchanged));
            }
            assert_eq!(fs::read_dir(store.root.join("staging")).unwrap().count(), 0);
        }
    }
    #[test]
    fn opening_a_subdirectory_still_captures_the_entire_repository() {
        let (root, repository, store) = fixture();
        fs::create_dir(repository.join("subdirectory")).unwrap();
        fs::write(repository.join("subdirectory/local.txt"), "nested").unwrap();
        let point = create(&store, &repository.join("subdirectory"), START);
        assert_eq!(
            point.repository_path,
            fs::canonicalize(&repository).unwrap()
        );
        fs::remove_dir_all(&repository).unwrap();
        let restored = root.path().join("restored");
        store
            .restore(&point.id, &restored, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            fs::read_to_string(restored.join("tracked.txt")).unwrap(),
            "original\n"
        );
        assert_eq!(
            fs::read_to_string(restored.join("subdirectory/local.txt")).unwrap(),
            "nested"
        );
    }
    #[test]
    fn corruption_in_latest_point_prevents_pruning_the_older_healthy_point() {
        let (_root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        fs::write(repository.join("new.txt"), "only second backup\n").unwrap();
        let second = create(&store, &repository, START + DAY);
        let manifests = store.manifests().unwrap();
        let latest = manifests.iter().find(|m| m.point.id == second.id).unwrap();
        let entry = latest
            .entries
            .iter()
            .find(|e| e.path == b"new.txt")
            .unwrap();
        let chunk = match &entry.content {
            Content::File { chunks, .. } => &chunks[0],
            _ => panic!(),
        };
        fs::write(store.root.join("chunks").join(chunk), "broken newest data").unwrap();
        assert_eq!(
            store
                .update_policy(BackupPolicy {
                    enabled: true,
                    max_mi_b: 1
                })
                .unwrap_err(),
            BackupError::Corrupt
        );
        assert!(store
            .root
            .join("points")
            .join(format!("{}.json", first.id))
            .exists());
        assert!(store
            .root
            .join("points")
            .join(format!("{}.json", second.id))
            .exists());
    }
    #[test]
    fn every_supported_true_promisor_boolean_refuses_an_incomplete_capture() {
        let (_root, repository, store) = fixture();
        for truth in ["true", "TRUE", "yes", "on", "1", ""] {
            run(&repository, &["config", "remote.origin.promisor", truth]);
            assert_eq!(
                store
                    .capture_at(&repository, &AtomicBool::new(false), START)
                    .unwrap_err(),
                BackupError::Incomplete,
                "{truth}"
            );
        }
        run(
            &repository,
            &["config", "--unset", "remote.origin.promisor"],
        );
        fs::write(repository.join(".git/objects/pack/missing.promisor"), "").unwrap();
        assert_eq!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START)
                .unwrap_err(),
            BackupError::Incomplete
        );
        assert!(store.list().unwrap().points.is_empty());
    }
    #[test]
    fn unhealthy_point_or_unexpected_chunk_does_not_hide_or_block_a_healthy_restore() {
        let (root, repository, store) = fixture();
        let point = create(&store, &repository, START);
        fs::write(
            store
                .root
                .join("points")
                .join(format!("{}.json", "0".repeat(64))),
            "broken manifest",
        )
        .unwrap();
        fs::write(
            store.root.join("chunks/abandoned-partial-file"),
            "unexpected data",
        )
        .unwrap();
        let catalog = store.list().unwrap();
        assert_eq!(catalog.points.len(), 1);
        assert_eq!(catalog.corrupt_points, 2);
        fs::remove_dir_all(&repository).unwrap();
        let destination = root.path().join("restored");
        store
            .restore(&point.id, &destination, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("tracked.txt")).unwrap(),
            "original\n"
        );
        assert!(store.maintenance().is_err());
        assert!(store.root.join("chunks/abandoned-partial-file").exists());
    }
    #[test]
    fn small_wip_change_reuses_large_unchanged_git_objects_and_working_files() {
        let (_root, repository, store) = fixture();
        let mut big = vec![0; 50 * CHUNK_BYTES];
        getrandom::getrandom(&mut big).unwrap();
        fs::write(repository.join("large.bin"), &big).unwrap();
        drop(big);
        run(&repository, &["add", "large.bin"]);
        run(&repository, &["commit", "-m", "large object"]);
        run(&repository, &["gc"]);
        READ_BYTES.with(|counter| counter.set(0));
        let started = std::time::Instant::now();
        let first = create(&store, &repository, START);
        let first_elapsed = started.elapsed();
        let initial_bytes = READ_BYTES.with(std::cell::Cell::get);
        fs::write(repository.join("untracked.txt"), vec![8; 1024]).unwrap();
        READ_BYTES.with(|counter| counter.set(0));
        let started = std::time::Instant::now();
        let second = create(&store, &repository, START + DAY);
        let second_elapsed = started.elapsed();
        let incremental_bytes = READ_BYTES.with(std::cell::Cell::get);
        assert!(initial_bytes >= 100 * CHUNK_BYTES as u64, "{initial_bytes}");
        assert!(
            incremental_bytes < CHUNK_BYTES as u64,
            "small WIP reread {incremental_bytes}"
        );
        eprintln!("50 MiB fixture: first {first_elapsed:?} / {initial_bytes} checked bytes; 1 KiB delta {second_elapsed:?} / {incremental_bytes} checked bytes; first point {} compressed, second {}", first.size_bytes, second.size_bytes);
    }
    #[test]
    fn bare_repository_is_explicitly_rejected_instead_of_becoming_a_dirty_worktree() {
        let (_root, repository, store) = fixture();
        run(&repository, &["config", "core.bare", "true"]);
        assert_eq!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START)
                .unwrap_err(),
            BackupError::Incomplete
        );
        assert!(store.list().unwrap().points.is_empty());
    }
    #[test]
    fn deleting_a_previously_backed_up_lfs_payload_refuses_a_new_incomplete_point() {
        let (_root, repository, store) = fixture();
        let payload = b"complete LFS fixture";
        let oid = digest(payload);
        let pointer = format!(
            "version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {}\n",
            payload.len()
        );
        fs::write(repository.join("lfs.bin"), pointer).unwrap();
        run(&repository, &["add", "lfs.bin"]);
        run(&repository, &["commit", "-m", "LFS"]);
        let object = repository
            .join(".git/lfs/objects")
            .join(&oid[..2])
            .join(&oid[2..4])
            .join(&oid);
        fs::create_dir_all(object.parent().unwrap()).unwrap();
        fs::write(&object, payload).unwrap();
        let first = create(&store, &repository, START);
        fs::remove_file(object).unwrap();
        assert_eq!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START + DAY)
                .unwrap_err(),
            BackupError::Incomplete
        );
        assert_eq!(store.list().unwrap().points[0].id, first.id);
    }
    #[test]
    fn deleted_historical_submodule_without_captured_storage_is_not_declared_complete() {
        let (root, repository, store) = fixture();
        let module = root.path().join("module-source");
        fs::create_dir(&module).unwrap();
        run(&module, &["init", "-b", "main"]);
        run(&module, &["config", "user.name", "Module"]);
        run(&module, &["config", "user.email", "test@example.invalid"]);
        fs::write(module.join("module.txt"), "history").unwrap();
        run(&module, &["add", "."]);
        run(&module, &["commit", "-m", "module"]);
        run(
            &repository,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                module.to_str().unwrap(),
                "vendor",
            ],
        );
        run(&repository, &["commit", "-am", "module"]);
        let first = create(&store, &repository, START);
        run(&repository, &["rm", "-f", "vendor"]);
        run(&repository, &["commit", "-am", "remove module"]);
        assert_eq!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START + DAY)
                .unwrap_err(),
            BackupError::Incomplete
        );
        fs::remove_dir_all(repository.join(".git/modules")).unwrap();
        assert_eq!(
            store
                .capture_at(&repository, &AtomicBool::new(false), START + DAY)
                .unwrap_err(),
            BackupError::Incomplete
        );
        assert_eq!(store.list().unwrap().points[0].id, first.id);
    }
    #[test]
    fn a_commit_during_capture_invalidates_the_new_point_without_delaying_the_commit() {
        let (_root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        let mut big = vec![0; 40 * CHUNK_BYTES];
        getrandom::getrandom(&mut big).unwrap();
        fs::write(repository.join("large-untracked.bin"), big).unwrap();
        let store = std::sync::Arc::new(store);
        let capture_store = store.clone();
        let capture_repository = repository.clone();
        let capture = thread::spawn(move || {
            capture_store.capture_at(&capture_repository, &AtomicBool::new(false), START + DAY)
        });
        let started = std::time::Instant::now();
        let mut observed = false;
        while started.elapsed() < Duration::from_secs(30) {
            for pending in fs::read_dir(store.root.join("staging")).unwrap() {
                let directory = pending.unwrap().path().join("chunks");
                if let Ok(entries) = fs::read_dir(directory) {
                    observed |= entries
                        .filter_map(Result::ok)
                        .any(|e| e.metadata().is_ok_and(|m| m.len() > 1_000_000));
                }
            }
            if observed || capture.is_finished() {
                break;
            }
            thread::sleep(Duration::from_millis(2));
        }
        assert!(observed, "capture did not reach large file");
        fs::write(
            repository.join("tracked.txt"),
            "committed while backup was running\n",
        )
        .unwrap();
        run(&repository, &["add", "tracked.txt"]);
        run(&repository, &["commit", "-m", "concurrent commit"]);
        let result = capture.join().unwrap();
        assert_eq!(result.unwrap_err(), BackupError::Changed);
        assert_eq!(store.list().unwrap().points[0].id, first.id);
        assert_eq!(
            run(&repository, &["show", "HEAD:tracked.txt"]),
            "committed while backup was running\n"
        );
    }
    #[test]
    fn cancelling_a_running_capture_cleans_staging_and_preserves_the_previous_point() {
        let (_root, repository, store) = fixture();
        let first = create(&store, &repository, START);
        let mut big = vec![0; 10 * CHUNK_BYTES];
        getrandom::getrandom(&mut big).unwrap();
        fs::write(repository.join("large-untracked.bin"), big).unwrap();
        let store = std::sync::Arc::new(store);
        let capture_store = store.clone();
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let capture_cancel = cancel.clone();
        let capture = thread::spawn(move || {
            capture_store.capture_at(&repository, &capture_cancel, START + DAY)
        });
        let started = std::time::Instant::now();
        while fs::read_dir(store.root.join("staging")).unwrap().count() == 0
            && !capture.is_finished()
            && started.elapsed() < Duration::from_secs(30)
        {
            thread::sleep(Duration::from_millis(2));
        }
        cancel.store(true, Ordering::Relaxed);
        assert_eq!(capture.join().unwrap().unwrap_err(), BackupError::Cancelled);
        assert_eq!(store.list().unwrap().points[0].id, first.id);
        assert_eq!(fs::read_dir(store.root.join("staging")).unwrap().count(), 0);
    }
    #[test]
    fn exclusive_root_lock_blocks_a_second_store_and_releases_when_owner_exits() {
        let (_root, repository, store) = fixture();
        let point = create(&store, &repository, START);
        let path = store.root.clone();
        assert!(matches!(
            BackupStore::new(path.clone(), BackupPolicy::default()),
            Err(BackupError::Io)
        ));
        drop(store);
        let reopened = BackupStore::new(path, BackupPolicy::default()).unwrap();
        assert_eq!(reopened.list().unwrap().points[0].id, point.id);
    }
}

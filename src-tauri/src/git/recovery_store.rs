//! Persistent, private recovery storage. Retention never removes live or unfinished snapshots.
use super::{undo::UndoError, undo_checkpoint::Checkpoint};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, OnceLock, Weak},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(test)]
use std::path::Component;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct RecoveryPolicy {
    pub auto_cleanup: bool,
    pub max_checkpoints: usize,
    pub max_age_days: u64,
    #[serde(rename = "maxMiB")]
    pub max_mi_b: u64,
}
impl Default for RecoveryPolicy {
    fn default() -> Self {
        Self {
            auto_cleanup: true,
            max_checkpoints: 100,
            max_age_days: 30,
            max_mi_b: 1024,
        }
    }
}
impl RecoveryPolicy {
    pub(super) fn validate(&self) -> Result<(), UndoError> {
        if !(1..=10_000).contains(&self.max_checkpoints)
            || !(1..=3650).contains(&self.max_age_days)
            || !(1..=1_048_576).contains(&self.max_mi_b)
        {
            return Err(UndoError::Stale);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RecoveryMetadata {
    pub version: u32,
    pub repository: PathBuf,
    pub git_dir: PathBuf,
    pub git_dir_identity: String,
    pub created_at: u64,
    pub state: String,
    pub label: Option<String>,
    pub related_checkpoint: Option<String>,
}
#[derive(Clone, Default)]
struct Configuration {
    root: Option<PathBuf>,
    policy: RecoveryPolicy,
}
static CONFIG: OnceLock<Mutex<Configuration>> = OnceLock::new();
static GATE: Mutex<()> = Mutex::new(());
static LIVE: OnceLock<Mutex<HashMap<PathBuf, Vec<Weak<Checkpoint>>>>> = OnceLock::new();
#[cfg(test)]
thread_local! { static TEST_CONFIG: std::cell::RefCell<Option<Configuration>> = const { std::cell::RefCell::new(None) }; }
fn configuration() -> Configuration {
    #[cfg(test)]
    if let Some(config) = TEST_CONFIG.with(|config| config.borrow().clone()) {
        return config;
    }
    CONFIG
        .get_or_init(|| Mutex::new(Configuration::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}
pub(super) fn lock() -> MutexGuard<'static, ()> {
    GATE.lock().unwrap_or_else(|e| e.into_inner())
}
pub(super) fn configure(root: PathBuf, policy: RecoveryPolicy) -> Result<(), UndoError> {
    policy.validate()?;
    let _guard = lock();
    private_directory(&root)?;
    let root = fs::canonicalize(root).map_err(|_| UndoError::GitFailed)?;
    set_configuration(Configuration {
        root: Some(root),
        policy,
    });
    Ok(())
}
fn set_configuration(config: Configuration) {
    #[cfg(test)]
    {
        TEST_CONFIG.with(|current| *current.borrow_mut() = Some(config));
    }
    #[cfg(not(test))]
    {
        *CONFIG
            .get_or_init(|| Mutex::new(Configuration::default()))
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = config;
    }
}
pub(super) fn root_path() -> Result<PathBuf, UndoError> {
    configuration().root.ok_or(UndoError::GitFailed)
}
pub(super) fn policy() -> RecoveryPolicy {
    configuration().policy
}
/// Validation must finish before the settings file or emergency backups change.
/// Updating this policy never changes the already configured storage location.
pub(super) struct PreparedPolicy(RecoveryPolicy);

pub(super) fn prepare_policy(policy: RecoveryPolicy) -> Result<PreparedPolicy, UndoError> {
    policy.validate()?;
    Ok(PreparedPolicy(policy))
}

/// Publish only in-memory state after persistence. Storage availability belongs
/// to the next read/cleanup, not to the result of an already committed setting.
pub(super) fn apply_policy(prepared: PreparedPolicy) -> bool {
    let _guard = lock();
    let mut config = configuration();
    let changed = config.policy != prepared.0;
    config.policy = prepared.0;
    set_configuration(config);
    changed
}

#[cfg(test)]
pub(super) fn update_policy(policy: RecoveryPolicy) -> Result<(), UndoError> {
    apply_policy(prepare_policy(policy)?);
    Ok(())
}
pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
pub(super) fn private_directory(path: &Path) -> Result<(), UndoError> {
    if path.exists() {
        let meta = fs::symlink_metadata(path).map_err(|_| UndoError::GitFailed)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(UndoError::Stale);
        }
    } else {
        fs::create_dir_all(path).map_err(|_| UndoError::GitFailed)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| UndoError::GitFailed)?;
    }
    Ok(())
}
pub(super) fn repository_identity(
    repository: &Path,
) -> Result<(PathBuf, PathBuf, String), UndoError> {
    let repository = fs::canonicalize(repository).map_err(|_| UndoError::GitFailed)?;
    let out = crate::process::command("git")
        .current_dir(&repository)
        .args(["rev-parse", "--absolute-git-dir"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|_| UndoError::GitFailed)?;
    if !out.status.success() {
        return Err(UndoError::GitFailed);
    }
    let git_dir = PathBuf::from(
        String::from_utf8(out.stdout)
            .map_err(|_| UndoError::GitFailed)?
            .trim(),
    );
    let git_dir = fs::canonicalize(git_dir).map_err(|_| UndoError::GitFailed)?;
    let meta = fs::metadata(&git_dir).map_err(|_| UndoError::GitFailed)?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    };
    #[cfg(not(unix))]
    let identity = {
        let created = meta
            .created()
            .map_err(|_| UndoError::GitFailed)?
            .duration_since(UNIX_EPOCH)
            .map_err(|_| UndoError::GitFailed)?;
        format!("{}:{}", created.as_secs(), created.subsec_nanos())
    };
    Ok((repository, git_dir, identity))
}
fn bucket_name(git_dir: &Path, instance: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(git_dir.as_os_str().as_encoded_bytes());
    hash.update([0]);
    hash.update(instance.as_bytes());
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub(super) fn location(repository: &Path) -> Result<(PathBuf, RecoveryMetadata), UndoError> {
    let (repository, git_dir, git_dir_identity) = repository_identity(repository)?;
    let metadata = RecoveryMetadata {
        version: 1,
        repository,
        git_dir: git_dir.clone(),
        git_dir_identity: git_dir_identity.clone(),
        created_at: now(),
        state: "pending".to_owned(),
        label: None,
        related_checkpoint: None,
    };
    match root_path() {
        Ok(root) => {
            private_directory(&root)?;
            let bucket = root.join(bucket_name(&git_dir, &git_dir_identity));
            private_directory(&bucket)?;
            Ok((bucket, metadata))
        }
        #[cfg(test)]
        Err(_) => {
            let bucket = git_dir.join("gitthul-recovery");
            private_directory(&bucket)?;
            Ok((bucket, metadata))
        }
        #[cfg(not(test))]
        Err(error) => Err(error),
    }
}
pub(super) fn register(checkpoint: &Arc<Checkpoint>) {
    let mut live = LIVE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    live.retain(|_, entries| {
        entries.retain(|entry| entry.strong_count() > 0);
        !entries.is_empty()
    });
    let entries = live
        .entry(checkpoint.recovery_directory().to_owned())
        .or_default();
    if !entries
        .iter()
        .any(|entry| entry.ptr_eq(&Arc::downgrade(checkpoint)))
    {
        entries.push(Arc::downgrade(checkpoint));
    }
}
fn is_live(path: &Path) -> bool {
    LIVE.get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(path)
        .is_some_and(|entries| entries.iter().any(|entry| entry.strong_count() > 0))
}
pub(super) fn write_json(path: &Path, value: &impl Serialize) -> Result<(), UndoError> {
    let parent = path.parent().ok_or(UndoError::Stale)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| UndoError::GitFailed)?;
    serde_json::to_writer(&mut file, value).map_err(|_| UndoError::GitFailed)?;
    file.flush().map_err(|_| UndoError::GitFailed)?;
    file.as_file()
        .sync_all()
        .map_err(|_| UndoError::GitFailed)?;
    file.persist(path).map_err(|_| UndoError::GitFailed)?;
    sync_directory(parent)
}
pub(super) fn sync_directory(path: &Path) -> Result<(), UndoError> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|_| UndoError::GitFailed)?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn valid_bucket(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn valid_checkpoint(name: &str) -> bool {
    name.strip_prefix("checkpoint-").is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix.len() <= 128
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}
#[cfg(test)]
fn resolve_id(root: &Path, id: &str) -> Result<(PathBuf, PathBuf), UndoError> {
    if id.contains('\\') || id.contains('\0') {
        return Err(UndoError::Stale);
    }
    let components: Vec<_> = Path::new(id).components().collect();
    if components.len() != 2 {
        return Err(UndoError::Stale);
    }
    let (Component::Normal(bucket), Component::Normal(checkpoint)) = (components[0], components[1])
    else {
        return Err(UndoError::Stale);
    };
    let bucket = bucket.to_str().ok_or(UndoError::Stale)?;
    let checkpoint = checkpoint.to_str().ok_or(UndoError::Stale)?;
    if !valid_bucket(bucket) || !valid_checkpoint(checkpoint) {
        return Err(UndoError::Stale);
    }
    let bucket = root.join(bucket);
    let directory = bucket.join(checkpoint);
    for path in [root, bucket.as_path(), directory.as_path()] {
        let meta = fs::symlink_metadata(path).map_err(|_| UndoError::GitFailed)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(UndoError::Stale);
        }
    }
    Ok((directory, bucket))
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecoveryEntry {
    pub id: String,
    pub repository: PathBuf,
    pub git_dir: PathBuf,
    pub created_at: u64,
    pub state: String,
    pub label: Option<String>,
    pub bytes: u64,
    pub protected: bool,
    pub active: bool,
    pub files: Vec<String>,
    pub scope: Option<Vec<String>>,
    pub includes_state: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecoveryOverview {
    pub root: PathBuf,
    pub entries: Vec<RecoveryEntry>,
    pub total_bytes: u64,
    pub protected_count: usize,
    pub over_budget: bool,
    pub uncertain_buckets: usize,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecoveryCleanup {
    pub removed_checkpoints: usize,
    pub removed_bytes: u64,
    pub protected_checkpoints: usize,
    pub uncertain_buckets: usize,
}
struct Snapshot {
    path: PathBuf,
    checkpoint: Checkpoint,
    protected: bool,
    bytes: u64,
    contents: BTreeSet<PathBuf>,
}
struct Bucket {
    snapshots: Vec<Snapshot>,
    bytes: u64,
    uncertain: bool,
}
fn regular_size(path: &Path) -> Result<u64, UndoError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| UndoError::GitFailed)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(UndoError::Stale);
    }
    Ok(metadata.len())
}
fn directory_bytes(path: &Path) -> Result<u64, UndoError> {
    let mut total = 0u64;
    for entry in fs::read_dir(path).map_err(|_| UndoError::GitFailed)? {
        let entry = entry.map_err(|_| UndoError::GitFailed)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| UndoError::GitFailed)?;
        if metadata.file_type().is_symlink() {
            return Err(UndoError::Stale);
        }
        total = total.saturating_add(if metadata.is_dir() {
            directory_bytes(&entry.path())?
        } else if metadata.is_file() {
            metadata.len()
        } else {
            return Err(UndoError::Stale);
        });
    }
    Ok(total)
}
fn scan_bucket(path: &Path) -> Bucket {
    let mut result = Bucket {
        snapshots: Vec::new(),
        bytes: 0,
        uncertain: false,
    };
    let Ok(metadata) = fs::symlink_metadata(path) else {
        result.uncertain = true;
        return result;
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        result.uncertain = true;
        return result;
    }
    match directory_bytes(path) {
        Ok(bytes) => result.bytes = bytes,
        Err(_) => result.uncertain = true,
    }
    let mut checked_contents = BTreeSet::new();
    let Ok(entries) = fs::read_dir(path) else {
        result.uncertain = true;
        return result;
    };
    for entry in entries {
        let Ok(entry) = entry else {
            result.uncertain = true;
            continue;
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            result.uncertain = true;
            continue;
        };
        if name == "contents" {
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                result.uncertain = true;
                continue;
            };
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                result.uncertain = true;
                continue;
            }
            let Ok(contents) = fs::read_dir(entry.path()) else {
                result.uncertain = true;
                continue;
            };
            for content in contents {
                let Ok(content) = content else {
                    result.uncertain = true;
                    continue;
                };
                let digest = content.file_name();
                let digest = digest.to_string_lossy();
                if digest.len() != 40
                    || !digest.bytes().all(|b| b.is_ascii_hexdigit())
                    || regular_size(&content.path()).is_err()
                    || super::undo_checkpoint::digest(&content.path())
                        .map_or(true, |actual| actual != digest)
                {
                    result.uncertain = true;
                }
                checked_contents.insert(content.path());
            }
            continue;
        }
        if !valid_checkpoint(name) {
            result.uncertain = true;
            continue;
        }
        let directory = entry.path();
        let checkpoint = match Checkpoint::recovery_read(&directory, path, false, false) {
            Ok(value) => value,
            Err(_) => {
                result.uncertain = true;
                continue;
            }
        };
        if bucket_name(
            &checkpoint.recovery.git_dir,
            &checkpoint.recovery.git_dir_identity,
        ) != path.file_name().unwrap_or_default().to_string_lossy()
        {
            result.uncertain = true;
            continue;
        }
        if checkpoint
            .recovery_check_contents(&mut checked_contents)
            .is_err()
        {
            result.uncertain = true;
            continue;
        }
        let local_bytes = match directory_bytes(&directory) {
            Ok(bytes) => bytes,
            Err(_) => {
                result.uncertain = true;
                continue;
            }
        };
        let contents: BTreeSet<_> = checkpoint
            .recovery_backups()
            .into_iter()
            .filter(|backup| backup.parent() == Some(path.join("contents").as_path()))
            .collect();
        let mut bytes = local_bytes;
        for content in &contents {
            match regular_size(content) {
                Ok(size) => bytes = bytes.saturating_add(size),
                Err(_) => result.uncertain = true,
            }
        }
        // A restoration journal can reference another snapshot and shared contents.
        // Keep the entire bucket until the interrupted restoration is resolved.
        if directory.join("restoring-from.json").exists() {
            result.uncertain = true;
        }
        let protected = checkpoint.recovery.state != "completed" || is_live(&directory);
        result.snapshots.push(Snapshot {
            path: directory,
            checkpoint,
            protected,
            bytes,
            contents,
        });
    }
    // Two manifests are published separately. An interrupted completion must keep
    // both sides, and a live side protects its complete pair.
    let positions: HashMap<_, _> = result
        .snapshots
        .iter()
        .enumerate()
        .map(|(index, item)| {
            (
                item.path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                index,
            )
        })
        .collect();
    let mut protect = BTreeSet::new();
    for (index, item) in result.snapshots.iter().enumerate() {
        if let Some(related) = &item.checkpoint.recovery.related_checkpoint {
            let Some(partner) = positions.get(related) else {
                result.uncertain = true;
                continue;
            };
            let other = &result.snapshots[*partner];
            if !valid_checkpoint(related)
                || *partner == index
                || other.checkpoint.recovery.related_checkpoint.as_deref()
                    != item.path.file_name().and_then(|name| name.to_str())
                || item.checkpoint.recovery.state != "completed"
                || other.checkpoint.recovery.state != "completed"
            {
                result.uncertain = true;
            }
            if item.protected || other.protected {
                protect.insert(index);
                protect.insert(*partner);
            }
        }
    }
    for index in protect {
        result.snapshots[index].protected = true;
    }
    if result.uncertain {
        for snapshot in &mut result.snapshots {
            snapshot.protected = true;
        }
    }
    result
}
fn buckets(root: &Path) -> Result<Vec<(PathBuf, Bucket)>, UndoError> {
    let metadata = fs::symlink_metadata(root).map_err(|_| UndoError::GitFailed)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(UndoError::Stale);
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| UndoError::GitFailed)? {
        let entry = entry.map_err(|_| UndoError::GitFailed)?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if valid_bucket(&name) {
            result.push((entry.path(), scan_bucket(&entry.path())));
        } else {
            result.push((
                entry.path(),
                Bucket {
                    snapshots: Vec::new(),
                    bytes: 0,
                    uncertain: true,
                },
            ));
        }
    }
    Ok(result)
}
pub(super) fn list() -> Result<RecoveryOverview, UndoError> {
    let _guard = lock();
    overview(&root_path()?)
}
fn overview(root: &Path) -> Result<RecoveryOverview, UndoError> {
    let mut result = RecoveryOverview {
        root: root.to_owned(),
        entries: Vec::new(),
        total_bytes: 0,
        protected_count: 0,
        over_budget: false,
        uncertain_buckets: 0,
    };
    let policy = policy();
    for (_, bucket) in buckets(root)? {
        result.total_bytes = result.total_bytes.saturating_add(bucket.bytes);
        result.over_budget |= bucket.bytes > policy.max_mi_b.saturating_mul(1024 * 1024)
            || bucket.snapshots.len() > policy.max_checkpoints;
        result.uncertain_buckets += usize::from(bucket.uncertain);
        for snapshot in bucket.snapshots {
            let metadata = &snapshot.checkpoint.recovery;
            result.protected_count += usize::from(snapshot.protected);
            result.entries.push(RecoveryEntry {
                id: snapshot
                    .path
                    .strip_prefix(root)
                    .map_err(|_| UndoError::Stale)?
                    .to_string_lossy()
                    .replace('\\', "/"),
                repository: metadata.repository.clone(),
                git_dir: metadata.git_dir.clone(),
                created_at: metadata.created_at,
                state: metadata.state.clone(),
                label: metadata.label.clone(),
                bytes: snapshot.bytes,
                protected: snapshot.protected,
                active: is_live(&snapshot.path),
                files: snapshot.checkpoint.recovery_files(),
                scope: snapshot.checkpoint.recovery_scope(),
                includes_state: true,
            });
        }
    }
    result.entries.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(result)
}
fn add_pair(bucket: &Bucket, index: usize, removed: &mut BTreeSet<usize>) {
    removed.insert(index);
    if let Some(related) = &bucket.snapshots[index]
        .checkpoint
        .recovery
        .related_checkpoint
    {
        if let Some(partner) = bucket
            .snapshots
            .iter()
            .position(|item| item.path.file_name().and_then(|name| name.to_str()) == Some(related))
        {
            removed.insert(partner);
        }
    }
}

fn retained_bytes(bucket: &Bucket, removed: &BTreeSet<usize>) -> Result<u64, UndoError> {
    let mut total = 0u64;
    let mut contents = BTreeSet::new();
    for (index, snapshot) in bucket.snapshots.iter().enumerate() {
        if removed.contains(&index) {
            continue;
        }
        total = total.saturating_add(directory_bytes(&snapshot.path)?);
        contents.extend(snapshot.contents.iter().cloned());
    }
    for content in contents {
        total = total.saturating_add(regular_size(&content)?);
    }
    Ok(total)
}
fn collect_contents(
    path: &Path,
    snapshots: &[Snapshot],
    removed: &BTreeSet<usize>,
) -> Result<(), UndoError> {
    let contents = path.join("contents");
    if !contents.exists() {
        return Ok(());
    }
    let reachable: BTreeSet<_> = snapshots
        .iter()
        .enumerate()
        .filter(|(index, _)| !removed.contains(index))
        .flat_map(|(_, snapshot)| snapshot.contents.iter().cloned())
        .collect();
    for entry in fs::read_dir(&contents).map_err(|_| UndoError::GitFailed)? {
        let entry = entry.map_err(|_| UndoError::GitFailed)?;
        regular_size(&entry.path())?;
        if !reachable.contains(&entry.path()) {
            fs::remove_file(entry.path()).map_err(|_| UndoError::GitFailed)?;
        }
    }
    sync_directory(&contents)
}
pub(super) fn cleanup() -> Result<RecoveryCleanup, UndoError> {
    let _guard = lock();
    let root = root_path()?;
    cleanup_buckets(buckets(&root)?, policy())
}

/// Manual cache cleaning removes every safely disposable checkpoint. Live undo,
/// pending operations and uncertain/corrupt buckets retain their protections.
pub(super) fn clear_cache() -> Result<RecoveryCleanup, UndoError> {
    let _guard = lock();
    let root = root_path()?;
    cleanup_buckets(
        buckets(&root)?,
        RecoveryPolicy {
            auto_cleanup: true,
            max_checkpoints: 0,
            max_age_days: 0,
            max_mi_b: 0,
        },
    )
}
fn cleanup_buckets(
    selected: Vec<(PathBuf, Bucket)>,
    policy: RecoveryPolicy,
) -> Result<RecoveryCleanup, UndoError> {
    let cutoff = now().saturating_sub(policy.max_age_days.saturating_mul(86_400_000));
    let mut result = RecoveryCleanup::default();
    for (path, bucket) in selected {
        result.protected_checkpoints += bucket
            .snapshots
            .iter()
            .filter(|entry| entry.protected)
            .count();
        if bucket.uncertain {
            result.uncertain_buckets += 1;
            continue;
        }
        let mut eligible: Vec<_> = bucket
            .snapshots
            .iter()
            .enumerate()
            .filter(|(_, entry)| !entry.protected)
            .map(|(index, _)| index)
            .collect();
        eligible.sort_by_key(|index| bucket.snapshots[*index].checkpoint.recovery.created_at);
        let mut removed = BTreeSet::new();
        for index in &eligible {
            if bucket.snapshots[*index].checkpoint.recovery.created_at < cutoff {
                add_pair(&bucket, *index, &mut removed);
            }
        }
        for index in &eligible {
            if bucket.snapshots.len().saturating_sub(removed.len()) <= policy.max_checkpoints
                && retained_bytes(&bucket, &removed)? <= policy.max_mi_b.saturating_mul(1024 * 1024)
            {
                break;
            }
            add_pair(&bucket, *index, &mut removed);
        }
        for index in &removed {
            fs::remove_dir_all(&bucket.snapshots[*index].path).map_err(|_| UndoError::GitFailed)?;
        }
        collect_contents(&path, &bucket.snapshots, &removed)?;
        sync_directory(&path)?;
        result.removed_checkpoints += removed.len();
        result.removed_bytes = result
            .removed_bytes
            .saturating_add(bucket.bytes.saturating_sub(directory_bytes(&path)?));
    }
    Ok(result)
}

static AUTO_CLEANED: OnceLock<Mutex<HashMap<PathBuf, std::time::Instant>>> = OnceLock::new();
pub(super) fn cleanup_for_repository(repository: &Path) {
    if !policy().auto_cleanup {
        return;
    }
    let Ok(root) = root_path() else {
        return;
    };
    let Ok((_, git_dir, instance)) = repository_identity(repository) else {
        return;
    };
    cleanup_bucket_path(root.join(bucket_name(&git_dir, &instance)));
}
pub(super) fn cleanup_bucket_if_enabled(checkpoint: &Path) {
    if let Some(bucket) = checkpoint.parent() {
        cleanup_bucket_path(bucket.to_owned());
    }
}
fn cleanup_bucket_path(bucket: PathBuf) {
    if !policy().auto_cleanup || !bucket.exists() {
        return;
    }
    let Ok(root) = root_path() else {
        return;
    };
    if bucket.parent() != Some(root.as_path()) {
        return;
    }
    let mut cleaned = AUTO_CLEANED
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if cleaned
        .get(&bucket)
        .is_some_and(|last| last.elapsed() < std::time::Duration::from_secs(2))
    {
        return;
    }
    cleaned.insert(bucket.clone(), std::time::Instant::now());
    drop(cleaned);
    let _guard = lock();
    let _ = cleanup_buckets(vec![(bucket.clone(), scan_bucket(&bucket))], policy());
}

#[cfg(test)]
pub(super) fn load(id: &str) -> Result<Arc<Checkpoint>, UndoError> {
    let _guard = lock();
    let root = root_path()?;
    let (directory, bucket) = resolve_id(&root, id)?;
    let checkpoint = Checkpoint::recovery_read(&directory, &bucket, false, true)?;
    if bucket_name(
        &checkpoint.recovery.git_dir,
        &checkpoint.recovery.git_dir_identity,
    ) != bucket.file_name().unwrap_or_default().to_string_lossy()
    {
        return Err(UndoError::Stale);
    }
    let checkpoint = Arc::new(checkpoint);
    register(&checkpoint);
    Ok(checkpoint)
}
#[cfg(test)]
pub(super) fn remove(id: &str) -> Result<RecoveryCleanup, UndoError> {
    let _guard = lock();
    let root = root_path()?;
    let (directory, bucket_path) = resolve_id(&root, id)?;
    let bucket = scan_bucket(&bucket_path);
    if bucket.uncertain || is_live(&directory) || directory.join("restoring-from.json").exists() {
        return Err(UndoError::Stale);
    }
    let index = bucket
        .snapshots
        .iter()
        .position(|entry| entry.path == directory)
        .ok_or(UndoError::Stale)?;
    if let Some(related) = &bucket.snapshots[index]
        .checkpoint
        .recovery
        .related_checkpoint
    {
        let partner = bucket
            .snapshots
            .iter()
            .find(|item| item.path.file_name().and_then(|name| name.to_str()) == Some(related))
            .ok_or(UndoError::Stale)?;
        if is_live(&partner.path) {
            return Err(UndoError::Stale);
        }
        let mut detached = partner.checkpoint.clone();
        detached.recovery.related_checkpoint = None;
        detached.recovery_persist()?;
    }
    fs::remove_dir_all(&directory).map_err(|_| UndoError::GitFailed)?;
    let removed = BTreeSet::from([index]);
    collect_contents(&bucket_path, &bucket.snapshots, &removed)?;
    sync_directory(&bucket_path)?;
    Ok(RecoveryCleanup {
        removed_checkpoints: 1,
        removed_bytes: bucket.bytes.saturating_sub(directory_bytes(&bucket_path)?),
        protected_checkpoints: bucket
            .snapshots
            .iter()
            .enumerate()
            .filter(|(i, item)| *i != index && item.protected)
            .count(),
        uncertain_buckets: 0,
    })
}
#[cfg(test)]
pub(super) fn export(id: &str, destination: &Path) -> Result<PathBuf, UndoError> {
    let _guard = lock();
    let root = root_path()?;
    let (directory, bucket) = resolve_id(&root, id)?;
    let checkpoint = Checkpoint::recovery_read(&directory, &bucket, false, true)?;
    let destination_meta = fs::symlink_metadata(destination).map_err(|_| UndoError::GitFailed)?;
    if !destination_meta.is_dir() || destination_meta.file_type().is_symlink() {
        return Err(UndoError::Stale);
    }
    let destination = fs::canonicalize(destination).map_err(|_| UndoError::GitFailed)?;
    if destination.starts_with(&root) {
        return Err(UndoError::Stale);
    }
    let staging = tempfile::Builder::new()
        .prefix("gitthul-recovery-export-")
        .tempdir_in(&destination)
        .map_err(|_| UndoError::GitFailed)?;
    let staged_checkpoint = staging
        .path()
        .join(directory.file_name().ok_or(UndoError::Stale)?);
    private_directory(&staged_checkpoint)?;
    checkpoint.recovery_copy_to(&staged_checkpoint, staging.path())?;
    write_json(
        &staging.path().join("README.json"),
        &serde_json::json!({"format":"gitthul-recovery-export-v1","note":"Contains captured files and Git metadata. Referenced commits and stashes also require the original Git object database.","repository":checkpoint.recovery.repository}),
    )?;
    let result = staging.keep();
    sync_directory(&destination)?;
    Ok(result)
}
#[cfg(test)]
pub(super) fn import_legacy(repository: &Path) -> Result<usize, UndoError> {
    let _guard = lock();
    let (target, identity) = location(repository)?;
    let source = identity.git_dir.join("gitthul-recovery");
    if !source.exists() {
        return Ok(0);
    }
    let metadata = fs::symlink_metadata(&source).map_err(|_| UndoError::GitFailed)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || source == target {
        return Err(UndoError::Stale);
    }
    let mut imported = 0;
    for entry in fs::read_dir(&source).map_err(|_| UndoError::GitFailed)? {
        let entry = entry.map_err(|_| UndoError::GitFailed)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or(UndoError::Stale)?;
        if name == "contents" {
            continue;
        }
        if !valid_checkpoint(name) {
            return Err(UndoError::Stale);
        }
        let mut checkpoint = Checkpoint::recovery_read(&entry.path(), &source, true, true)?;
        let target_directory = target.join(name);
        if target_directory.exists() {
            let existing = Checkpoint::recovery_read(&target_directory, &target, false, true)?;
            if existing.same(&checkpoint) {
                continue;
            }
            return Err(UndoError::Stale);
        }
        checkpoint.recovery = identity.clone();
        checkpoint.recovery.label = Some("undo.imported".to_owned());
        // Legacy records do not prove that the original operation completed.
        checkpoint.recovery.state = "legacy".to_owned();
        let staging = tempfile::Builder::new()
            .prefix("import-")
            .tempdir_in(&target)
            .map_err(|_| UndoError::GitFailed)?;
        let staged_directory = staging.path().join(name);
        private_directory(&staged_directory)?;
        checkpoint.recovery_copy_to(&staged_directory, staging.path())?;
        // Imported records have private local backups, so publishing the directory is atomic.
        Checkpoint::recovery_read(&staged_directory, staging.path(), false, true)?;
        fs::rename(&staged_directory, &target_directory).map_err(|_| UndoError::GitFailed)?;
        sync_directory(&target)?;
        imported += 1;
    }
    Ok(imported)
}

#[cfg(test)]
pub(super) struct RecoveryTestGuard(Option<Configuration>);
#[cfg(test)]
impl Drop for RecoveryTestGuard {
    fn drop(&mut self) {
        TEST_CONFIG.with(|config| *config.borrow_mut() = self.0.take());
    }
}
#[cfg(test)]
pub(super) fn test_store(
    root: PathBuf,
    policy: RecoveryPolicy,
) -> Result<RecoveryTestGuard, UndoError> {
    let previous = TEST_CONFIG.with(|config| config.borrow().clone());
    configure(root, policy)?;
    Ok(RecoveryTestGuard(previous))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    fn git(repository: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(repository)
            .args(["-c", "commit.gpgsign=false"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn repository(parent: &Path, name: &str) -> PathBuf {
        let path = parent.join(name);
        fs::create_dir_all(&path).unwrap();
        git(&path, &["init", "--initial-branch=main"]);
        git(&path, &["config", "user.name", "Recovery Test"]);
        git(&path, &["config", "user.email", "recovery@example.invalid"]);
        fs::write(path.join("tracked.txt"), "committed\n").unwrap();
        git(&path, &["add", "."]);
        git(&path, &["commit", "-m", "initial"]);
        path
    }
    fn policy_without_auto() -> RecoveryPolicy {
        RecoveryPolicy {
            auto_cleanup: false,
            max_checkpoints: 2,
            ..RecoveryPolicy::default()
        }
    }

    #[test]
    fn preparing_or_rejecting_a_policy_does_not_enable_cleanup_before_persistence() {
        let temporary = tempfile::tempdir().unwrap();
        let original = policy_without_auto();
        let _guard = test_store(temporary.path().join("recovery"), original.clone()).unwrap();
        let root = root_path().unwrap();
        let preserved = root.join("uncertain-data");
        fs::write(&preserved, b"must survive a rejected settings write").unwrap();

        let prepared = prepare_policy(RecoveryPolicy::default()).unwrap();
        assert_eq!(policy(), original);
        assert_eq!(root_path().unwrap(), root);
        // A failed settings write drops the prepared update without committing it.
        drop(prepared);
        assert!(prepare_policy(RecoveryPolicy {
            max_mi_b: 0,
            ..Default::default()
        })
        .is_err());
        assert_eq!(policy(), original);
        assert_eq!(
            fs::read(&preserved).unwrap(),
            b"must survive a rejected settings write"
        );
    }

    #[test]
    fn committing_a_saved_policy_does_not_reopen_or_modify_an_unavailable_root() {
        let temporary = tempfile::tempdir().unwrap();
        let _guard = test_store(temporary.path().join("recovery"), policy_without_auto()).unwrap();
        let root = root_path().unwrap();
        let prepared = prepare_policy(RecoveryPolicy::default()).unwrap();
        // Model the directory becoming unavailable after the durable settings
        // write. Reconfiguring it here used to turn that success into an error.
        fs::remove_dir(&root).unwrap();
        fs::write(&root, b"unavailable recovery directory").unwrap();

        assert!(apply_policy(prepared));
        assert_eq!(policy(), RecoveryPolicy::default());
        assert_eq!(root_path().unwrap(), root);
        assert_eq!(fs::read(&root).unwrap(), b"unavailable recovery directory");
        assert!(list().is_err());
        assert!(!apply_policy(
            prepare_policy(RecoveryPolicy::default()).unwrap()
        ));
    }

    #[test]
    fn applying_a_policy_preserves_the_current_configured_location() {
        let temporary = tempfile::tempdir().unwrap();
        let _guard = test_store(temporary.path().join("first"), policy_without_auto()).unwrap();
        let prepared = prepare_policy(RecoveryPolicy::default()).unwrap();
        let replacement = temporary.path().join("current");
        configure(replacement.clone(), policy_without_auto()).unwrap();
        let replacement = fs::canonicalize(replacement).unwrap();

        assert!(apply_policy(prepared));
        assert_eq!(root_path().unwrap(), replacement);
        assert_eq!(policy(), RecoveryPolicy::default());
    }

    #[test]
    fn external_store_loads_relative_manifests_after_session_and_export_survives_missing_repo() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        fs::write(repo.join("tracked.txt"), "valuable work\n").unwrap();
        let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(checkpoint.recovery_directory().join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert!(!Path::new(manifest["directory"].as_str().unwrap()).is_absolute());
        assert!(!repo.join(".git/gitthul-recovery").exists());
        let id = list().unwrap().entries[0].id.clone();
        checkpoint.recovery_complete_preview().unwrap();
        drop(checkpoint);
        let loaded = load(&id).unwrap();
        assert!(loaded.recovery_verify_repository(&repo).is_ok());
        drop(loaded);
        fs::rename(&repo, temporary.path().join("moved")).unwrap();
        let loaded = load(&id).unwrap();
        assert!(loaded.recovery_verify_repository(&repo).is_err());
        let exports = temporary.path().join("exports");
        fs::create_dir(&exports).unwrap();
        #[cfg(unix)]
        let before_mode = {
            use std::os::unix::fs::PermissionsExt;
            fs::metadata(&exports).unwrap().permissions().mode()
        };
        let exported = export(&id, &exports).unwrap();
        let directory = exported.join(loaded.recovery_directory().file_name().unwrap());
        let copied = Checkpoint::recovery_read(&directory, &exported, false, true).unwrap();
        assert_eq!(copied.recovery_files(), vec!["tracked.txt".to_owned()]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                before_mode,
                fs::metadata(&exports).unwrap().permissions().mode()
            );
        }
    }
    #[test]
    fn retention_never_removes_live_pending_or_shared_reachable_contents() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(
            temporary.path().join("data"),
            RecoveryPolicy {
                max_checkpoints: 1,
                ..policy_without_auto()
            },
        )
        .unwrap();
        let first = Checkpoint::capture(&repo, &[]).unwrap();
        let second = Checkpoint::capture(&repo, &[]).unwrap();
        Checkpoint::recovery_complete_pair(&first, &second, "undo.reset").unwrap();
        let pending = Checkpoint::capture(&repo, &[]).unwrap();
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        assert!(list().unwrap().over_budget);
        drop(first);
        drop(second);
        assert_eq!(cleanup().unwrap().removed_checkpoints, 2);
        let id = list().unwrap().entries[0].id.clone();
        drop(pending);
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        let reloaded = load(&id).unwrap();
        assert_eq!(reloaded.recovery_files(), vec!["tracked.txt".to_owned()]);
        assert!(remove(&id).is_err());
        drop(reloaded);
        assert_eq!(remove(&id).unwrap().removed_checkpoints, 1);
        assert!(list().unwrap().entries.is_empty());
    }
    #[test]
    fn completed_retention_uses_count_and_age_and_collects_only_unreachable_contents() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let mut oldest = PathBuf::new();
        for index in 0..5 {
            fs::write(repo.join("tracked.txt"), format!("change {index}\n")).unwrap();
            let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
            if index == 0 {
                oldest = checkpoint.recovery_directory().to_owned();
            }
            checkpoint.recovery_complete_preview().unwrap();
        }
        let summary = cleanup().unwrap();
        assert_eq!(summary.removed_checkpoints, 3);
        assert!(summary.removed_bytes > 0);
        assert!(!oldest.exists());
        let overview = list().unwrap();
        assert_eq!(overview.entries.len(), 2);
        for entry in overview.entries {
            assert!(load(&entry.id).is_ok());
        }
        let overview = list().unwrap();
        let root = root_path().unwrap();
        for entry in overview.entries {
            let path = root.join(entry.id).join("manifest.json");
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            manifest["recovery"]["createdAt"] = 1.into();
            write_json(&path, &manifest).unwrap();
        }
        assert_eq!(cleanup().unwrap().removed_checkpoints, 2);
    }

    #[test]
    fn manual_cache_cleaning_preserves_pending_points_and_emergency_backups() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let data = temporary.path().join("data");
        let backup = data.join("backups/keep");
        fs::create_dir_all(backup.parent().unwrap()).unwrap();
        fs::write(&backup, b"independent emergency backup").unwrap();
        let _guard = test_store(data.join("recovery"), RecoveryPolicy::default()).unwrap();
        let completed = Checkpoint::capture(&repo, &[]).unwrap();
        completed.recovery_complete_preview().unwrap();
        let pending = Checkpoint::capture(&repo, &[]).unwrap();
        assert_eq!(clear_cache().unwrap().removed_checkpoints, 0);
        drop(completed);
        drop(pending);
        let result = clear_cache().unwrap();
        assert_eq!(result.removed_checkpoints, 1);
        assert_eq!(list().unwrap().entries.len(), 1);
        assert_eq!(fs::read(&backup).unwrap(), b"independent emergency backup");
        assert_eq!(clear_cache().unwrap().removed_checkpoints, 0);
    }
    #[test]
    fn malformed_manifest_and_interrupted_journal_make_entire_bucket_conservative() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(
            temporary.path().join("data"),
            RecoveryPolicy {
                max_checkpoints: 1,
                ..policy_without_auto()
            },
        )
        .unwrap();
        let first = Checkpoint::capture(&repo, &[]).unwrap();
        let second = Checkpoint::capture(&repo, &[]).unwrap();
        first.recovery_complete_preview().unwrap();
        second.recovery_complete_preview().unwrap();
        let path = first.recovery_directory().join("manifest.json");
        let previous = fs::read(&path).unwrap();
        fs::write(&path, b"corrupt").unwrap();
        drop(first);
        drop(second);
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        assert_eq!(cleanup().unwrap().uncertain_buckets, 1);
        fs::write(&path, previous).unwrap();
        fs::write(
            path.parent().unwrap().join("restoring-from.json"),
            b"interrupted",
        )
        .unwrap();
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        assert_eq!(list().unwrap().protected_count, 2);
    }
    #[test]
    fn malicious_paths_and_references_are_rejected_without_touching_outside_files() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
        let id = list().unwrap().entries[0].id.clone();
        let path = checkpoint.recovery_directory().join("manifest.json");
        let original: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        drop(checkpoint);
        for evil in [
            "../outside",
            "/tmp/outside",
            "contents/../../outside",
            "contents\\outside",
        ] {
            let mut manifest = original.clone();
            manifest["files"]["tracked.txt"]["backup"] = evil.into();
            write_json(&path, &manifest).unwrap();
            assert!(load(&id).is_err());
            assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        }
        let mut manifest = original.clone();
        let image = manifest["metadata"]["index"].clone();
        manifest["metadata"]["objects/unsafe"] = image;
        write_json(&path, &manifest).unwrap();
        assert!(load(&id).is_err());
        let mut manifest = original;
        manifest["refs"]["refs/heads/main\nupdate refs/heads/evil"] =
            serde_json::json!({"Direct":"1111111111111111111111111111111111111111"});
        write_json(&path, &manifest).unwrap();
        assert!(load(&id).is_err());
        assert!(load("../checkpoint-x").is_err());
        assert!(load(&format!("{id}/../manifest.json")).is_err());
    }
    #[test]
    fn legacy_import_copies_only_is_idempotent_and_never_expires_unknown_operations() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
        let path = checkpoint.recovery_directory().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        // Exercise the original format, including its absolute image paths.
        manifest.as_object_mut().unwrap().remove("recovery");
        manifest["directory"] = checkpoint
            .recovery_directory()
            .to_string_lossy()
            .into_owned()
            .into();
        let bucket = checkpoint.recovery_directory().parent().unwrap();
        for group in ["files", "metadata"] {
            for image in manifest[group].as_object_mut().unwrap().values_mut() {
                image["backup"] = bucket
                    .join(image["backup"].as_str().unwrap())
                    .to_string_lossy()
                    .into_owned()
                    .into();
            }
        }
        write_json(&path, &manifest).unwrap();
        let original = fs::read(&path).unwrap();
        drop(checkpoint);
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        assert_eq!(import_legacy(&repo).unwrap(), 1);
        assert_eq!(import_legacy(&repo).unwrap(), 0);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(list().unwrap().entries[0].state, "legacy");
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        assert!(load(&list().unwrap().entries[0].id).is_ok());
    }
    #[test]
    fn worktrees_and_recreated_git_directories_do_not_share_recovery_identity() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let original = Checkpoint::capture(&repo, &[]).unwrap();
        let linked = temporary.path().join("linked");
        git(
            &repo,
            &["worktree", "add", "--detach", linked.to_str().unwrap()],
        );
        let worktree = Checkpoint::capture(&linked, &[]).unwrap();
        assert_ne!(
            original.recovery_directory().parent(),
            worktree.recovery_directory().parent()
        );
        let old_git = temporary.path().join("old-git");
        fs::rename(repo.join(".git"), old_git).unwrap();
        git(&repo, &["init", "--initial-branch=main"]);
        let new = Checkpoint::capture(&repo, &[]).unwrap();
        assert_ne!(
            original.recovery_directory().parent(),
            new.recovery_directory().parent()
        );
        assert!(original.recovery_verify_repository(&repo).is_err());
    }

    #[test]
    fn interrupted_pair_completion_protects_both_sides_and_live_pairs_stay_together() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(
            temporary.path().join("data"),
            RecoveryPolicy {
                max_checkpoints: 1,
                ..policy_without_auto()
            },
        )
        .unwrap();
        let first = Checkpoint::capture(&repo, &[]).unwrap();
        let second = Checkpoint::capture(&repo, &[]).unwrap();
        let path = first.recovery_directory().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest["recovery"]["state"] = "completed".into();
        manifest["recovery"]["relatedCheckpoint"] = second
            .recovery_directory()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned()
            .into();
        write_json(&path, &manifest).unwrap();
        drop(first);
        drop(second);
        let result = cleanup().unwrap();
        assert_eq!(result.removed_checkpoints, 0);
        assert_eq!(result.uncertain_buckets, 1);
        assert_eq!(list().unwrap().protected_count, 2);
    }
    #[test]
    fn damaged_content_stops_cleanup_and_ordinary_capture_failure_leaves_no_invalid_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let index = repo.join(".git/index");
        let original_index = fs::read(&index).unwrap();
        fs::write(&index, b"invalid index").unwrap();
        assert!(Checkpoint::capture(&repo, &[]).is_err());
        assert_eq!(list().unwrap().uncertain_buckets, 0);
        assert!(list().unwrap().entries.is_empty());
        fs::write(index, original_index).unwrap();
        let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
        checkpoint.recovery_complete_preview().unwrap();
        let backup = checkpoint.recovery_backups().into_iter().next().unwrap();
        fs::write(&backup, b"damaged").unwrap();
        drop(checkpoint);
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        assert_eq!(cleanup().unwrap().uncertain_buckets, 1);
    }
    #[test]
    fn size_limit_removes_completed_copies_without_touching_working_files() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(
            temporary.path().join("data"),
            RecoveryPolicy {
                max_mi_b: 1,
                ..policy_without_auto()
            },
        )
        .unwrap();
        let contents = vec![b'x'; 2 * 1024 * 1024];
        fs::write(repo.join("tracked.txt"), &contents).unwrap();
        let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
        checkpoint.recovery_complete_preview().unwrap();
        drop(checkpoint);
        let result = cleanup().unwrap();
        assert_eq!(result.removed_checkpoints, 1);
        assert!(result.removed_bytes >= 2 * 1024 * 1024);
        assert_eq!(fs::read(repo.join("tracked.txt")).unwrap(), contents);
    }
    #[cfg(unix)]
    #[test]
    fn unix_literal_backslash_filename_roundtrips_without_becoming_path_traversal() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let name = "literal\\name.txt";
        fs::write(repo.join(name), b"valuable").unwrap();
        git(&repo, &["add", "--", name]);
        let checkpoint = Checkpoint::capture(&repo, &[]).unwrap();
        let id = list().unwrap().entries[0].id.clone();
        let loaded = load(&id).unwrap();
        assert!(loaded.recovery_files().contains(&name.to_owned()));
        assert!(loaded.recovery_verify_repository(&repo).is_ok());
        let exports = temporary.path().join("exports");
        fs::create_dir(&exports).unwrap();
        assert!(export(&id, &exports).is_ok());
        drop(checkpoint);
    }

    #[test]
    fn pending_operation_keeps_label_through_scope_expansion_and_recovery_baseline_is_protected() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let mut before = Checkpoint::capture(&repo, &[]).unwrap();
        before.recovery_set_label("undo.pull").unwrap();
        Checkpoint::prepare_pull(
            &repo,
            &mut before,
            "HEAD",
            super::super::network::PullStrategy::Merge,
        )
        .unwrap();
        let path = before.recovery_directory().join("manifest.json");
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["recovery"]["label"], "undo.pull");
        before.recovery_complete_preview().unwrap();
        before.recovery_mark_pending("undo.recovery").unwrap();
        let id = list().unwrap().entries[0].id.clone();
        drop(before);
        assert_eq!(cleanup().unwrap().removed_checkpoints, 0);
        assert_eq!(load(&id).unwrap().recovery.state, "pending");
        assert_eq!(
            list().unwrap().entries[0].label.as_deref(),
            Some("undo.recovery")
        );
    }

    #[test]
    fn successful_retry_replaces_old_interrupted_journal_and_allows_retention_again() {
        let temporary = tempfile::tempdir().unwrap();
        let repo = repository(temporary.path(), "repo");
        let _guard = test_store(temporary.path().join("data"), policy_without_auto()).unwrap();
        let target = Checkpoint::capture(&repo, &[]).unwrap();
        let marker = target.recovery_directory().join("restoring-from.json");
        fs::write(&marker, b"older interrupted restoration").unwrap();
        fs::write(repo.join("tracked.txt"), b"state before retry\n").unwrap();
        let baseline = Checkpoint::after(&repo, &target).unwrap();
        baseline.recovery_mark_pending("undo.recovery").unwrap();
        fs::write(repo.join("tracked.txt"), b"concurrent edit\n").unwrap();
        assert_eq!(
            Checkpoint::apply(&repo, &baseline, &target),
            Err(UndoError::Stale)
        );
        assert_eq!(fs::read(&marker).unwrap(), b"older interrupted restoration");
        fs::write(repo.join("tracked.txt"), b"state before retry\n").unwrap();
        Checkpoint::apply(&repo, &baseline, &target).unwrap();
        assert!(!marker.exists());
        assert_eq!(fs::read(repo.join("tracked.txt")).unwrap(), b"committed\n");
        target.recovery_complete_preview().unwrap();
        let after = Checkpoint::after(&repo, &baseline).unwrap();
        let stacks = super::super::undo::UndoStacks::default();
        let id = repo.to_string_lossy().into_owned();
        stacks.remember_checkpoint(&id, baseline, after, "undo.recovery");
        drop(target);
        let summary = cleanup().unwrap();
        assert_eq!(summary.uncertain_buckets, 0);
        assert_eq!(summary.removed_checkpoints, 1);
        stacks.undo(&id, &repo).unwrap();
        assert_eq!(
            fs::read(repo.join("tracked.txt")).unwrap(),
            b"state before retry\n"
        );
    }
    #[test]
    fn policy_rejects_invalid_limits_and_serializes_expected_contract() {
        for policy in [
            RecoveryPolicy {
                max_checkpoints: 0,
                ..RecoveryPolicy::default()
            },
            RecoveryPolicy {
                max_age_days: 0,
                ..RecoveryPolicy::default()
            },
            RecoveryPolicy {
                max_mi_b: 0,
                ..RecoveryPolicy::default()
            },
            RecoveryPolicy {
                max_mi_b: 1_048_577,
                ..RecoveryPolicy::default()
            },
        ] {
            assert!(policy.validate().is_err());
        }
        let json = serde_json::to_value(RecoveryPolicy::default()).unwrap();
        assert_eq!(json["maxMiB"], 1024);
        assert_eq!(json["maxCheckpoints"], 100);
    }
}

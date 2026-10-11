//! Resolución de conflictos contra las etapas reales del índice.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::{diff, encoding};

#[derive(Clone, Default)]
pub struct ResolutionSnapshots {
    entries: Arc<Mutex<HashMap<(String, String), ResolutionSnapshot>>>,
}

impl ResolutionSnapshots {
    pub fn clear_repository(&self, repository_id: &str) {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|(id, _), _| id != repository_id);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ResolutionSnapshot {
    stages: Vec<IndexEntry>,
    resolved: Option<IndexEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct IndexEntry {
    mode: String,
    oid: String,
    stage: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Resolution {
    path: String,
    origin: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ResolveError {
    UnsupportedEncoding(String),
    Unrepresentable { path: String, encoding: String },
    GitFailed,
    InvalidPath,
    InvalidPathEncoding,
    NotConflicted(String),
    Stale(String),
    WriteFailed(String),
}

/// La comprobación se ejecuta dentro del bloqueo de escritura del repositorio.
#[cfg(test)]
pub fn content_checked(
    repository: &Path,
    repository_id: &str,
    path: &str,
    contents: &str,
    expected_revision: Option<&str>,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    content_checked_encoded(
        repository,
        repository_id,
        path,
        contents,
        expected_revision,
        None,
        snapshots,
    )
}

pub fn content_checked_encoded(
    repository: &Path,
    repository_id: &str,
    path: &str,
    contents: &str,
    expected_revision: Option<&str>,
    requested: Option<&str>,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    if let Some(expected) = expected_revision {
        let actual = super::conflict::revision(repository, path)
            .map_err(|_| ResolveError::Stale(path.to_owned()))?;
        if actual != expected {
            return Err(ResolveError::Stale(path.to_owned()));
        }
    }
    content_encoded(
        repository,
        repository_id,
        path,
        contents,
        requested,
        snapshots,
    )
}

#[cfg(test)]
pub fn content(
    repository: &Path,
    repository_id: &str,
    path: &str,
    contents: &str,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    content_encoded(repository, repository_id, path, contents, None, snapshots)
}

fn content_encoded(
    repository: &Path,
    repository_id: &str,
    path: &str,
    contents: &str,
    requested: Option<&str>,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    let stages = conflicted_entries(repository, path)?;
    let preferred = oid_at(&stages, 2)
        .or_else(|| oid_at(&stages, 3))
        .or_else(|| oid_at(&stages, 1));
    let original = match preferred {
        Some(oid) => git_output(repository, &["cat-file", "blob", oid])?.stdout,
        None => Vec::new(),
    };
    let name = match requested.filter(|name| *name != "auto") {
        Some(name) => encoding::canonical(name)
            .ok_or_else(|| ResolveError::UnsupportedEncoding(name.to_owned()))?,
        None => encoding::detect(&original),
    };
    let bytes =
        encoding::encode(contents, name, encoding::bom(&original).is_some()).map_err(|_| {
            ResolveError::Unrepresentable {
                path: path.to_owned(),
                encoding: name.to_owned(),
            }
        })?;
    write_regular_file(repository, path, &bytes, preferred_mode(&stages))?;
    stage(repository, path)?;
    remember(repository, repository_id, path, stages, snapshots)
}

/// Prepara el contenido que ya existe en el árbol de trabajo sin tocar sus
/// bytes. Es el camino de «Marcar como resuelto»: a diferencia de un `git add`
/// genérico, conserva las etapas 1/2/3 para que `unresolve` pueda restaurarlas.
pub fn mark(
    repository: &Path,
    repository_id: &str,
    path: &str,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    let stages = conflicted_entries(repository, path)?;
    stage(repository, path)?;
    remember(repository, repository_id, path, stages, snapshots)
}

/// Valida todo el lote antes de escribir y actualiza el índice una sola vez.
/// Las rutas viajan por stdin para no depender del límite de argumentos del SO.
pub fn mark_many(
    repository: &Path,
    repository_id: &str,
    paths: &[String],
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut conflicts: HashMap<_, _> = all_conflicted_entries(repository)?.into_iter().collect();
    let mut selected = HashMap::new();
    let mut input = Vec::new();
    for path in paths {
        validate_path(path)?;
        if selected.contains_key(path) {
            continue;
        }
        let stages = conflicts
            .remove(path)
            .ok_or_else(|| ResolveError::NotConflicted(path.clone()))?;
        selected.insert(path.clone(), stages);
        input.extend_from_slice(path.as_bytes());
        input.push(0);
    }
    run_git(
        repository,
        &["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
        Some(&input),
    )?;
    let output = git_output(repository, &["ls-files", "--stage", "-z"])?;
    let mut resolved = HashMap::new();
    for (path, entry) in parse_index_entries(&output.stdout, None)? {
        if selected.contains_key(&path) {
            if entry.stage != 0 {
                return Err(ResolveError::WriteFailed(path));
            }
            resolved.insert(path, entry);
        }
    }
    let mut entries = snapshots
        .entries
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for (path, stages) in selected {
        let resolved = resolved.remove(&path);
        entries.insert(
            (repository_id.to_owned(), path),
            ResolutionSnapshot { stages, resolved },
        );
    }
    Ok(())
}

pub fn keep_side(
    repository: &Path,
    repository_id: &str,
    path: &str,
    side: ConflictSide,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    let stages = conflicted_entries(repository, path)?;
    let wanted_stage = match side {
        ConflictSide::Ours => 2,
        ConflictSide::Theirs => 3,
    };
    if stages.iter().any(|entry| entry.stage == wanted_stage) {
        checkout_stage(repository, path, wanted_stage)?;
    } else {
        remove_worktree_path(repository, path)?;
    }
    stage(repository, path)?;
    remember(repository, repository_id, path, stages, snapshots)
}

pub fn auto(
    repository: &Path,
    repository_id: &str,
    snapshots: &ResolutionSnapshots,
) -> Result<Vec<Resolution>, ResolveError> {
    let conflicts = all_conflicted_entries(repository)?;
    let mut resolved = Vec::new();
    for (path, stages) in conflicts {
        let base = oid_at(&stages, 1);
        let ours = oid_at(&stages, 2);
        let theirs = oid_at(&stages, 3);
        let side = if ours == theirs {
            Some(ConflictSide::Ours)
        } else if ours == base {
            Some(ConflictSide::Theirs)
        } else if theirs == base {
            Some(ConflictSide::Ours)
        } else {
            None
        };
        let Some(side) = side else { continue };
        let wanted_stage = match side {
            ConflictSide::Ours => 2,
            ConflictSide::Theirs => 3,
        };
        if stages.iter().any(|entry| entry.stage == wanted_stage) {
            checkout_stage(repository, &path, wanted_stage)?;
        } else {
            remove_worktree_path(repository, &path)?;
        }
        stage(repository, &path)?;
        remember(repository, repository_id, &path, stages, snapshots)?;
        resolved.push(Resolution {
            path,
            origin: "auto",
        });
    }
    Ok(resolved)
}

pub fn unresolve(
    repository: &Path,
    repository_id: &str,
    path: &str,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    validate_path(path)?;
    let key = (repository_id.to_owned(), path.to_owned());
    let snapshot = snapshots
        .entries
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&key)
        .cloned()
        .ok_or_else(|| ResolveError::NotConflicted(path.to_owned()))?;
    let current = index_entries(repository, path, false)?;
    let current_stage_zero = current.into_iter().find(|entry| entry.stage == 0);
    if current_stage_zero != snapshot.resolved {
        return Err(ResolveError::Stale(path.to_owned()));
    }
    restore_stages(repository, path, &snapshot.stages)
}

fn remember(
    repository: &Path,
    repository_id: &str,
    path: &str,
    stages: Vec<IndexEntry>,
    snapshots: &ResolutionSnapshots,
) -> Result<(), ResolveError> {
    let current = index_entries(repository, path, false)?;
    if current.iter().any(|entry| entry.stage != 0) {
        return Err(ResolveError::WriteFailed(path.to_owned()));
    }
    let resolved = current.into_iter().find(|entry| entry.stage == 0);
    snapshots
        .entries
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(
            (repository_id.to_owned(), path.to_owned()),
            ResolutionSnapshot { stages, resolved },
        );
    Ok(())
}

fn conflicted_entries(repository: &Path, path: &str) -> Result<Vec<IndexEntry>, ResolveError> {
    validate_path(path)?;
    let entries = index_entries(repository, path, true)?;
    if entries.is_empty() {
        Err(ResolveError::NotConflicted(path.to_owned()))
    } else {
        Ok(entries)
    }
}

fn all_conflicted_entries(
    repository: &Path,
) -> Result<Vec<(String, Vec<IndexEntry>)>, ResolveError> {
    let output = git_output(repository, &["ls-files", "--unmerged", "-z"])?;
    let rows = parse_index_entries(&output.stdout, None)?;
    let mut grouped: Vec<(String, Vec<IndexEntry>)> = Vec::new();
    for (path, entry) in rows {
        validate_path(&path)?;
        match grouped.last_mut() {
            Some((current, entries)) if current == &path => entries.push(entry),
            _ => grouped.push((path, vec![entry])),
        }
    }
    Ok(grouped)
}

fn index_entries(
    repository: &Path,
    path: &str,
    unmerged: bool,
) -> Result<Vec<IndexEntry>, ResolveError> {
    let mode = if unmerged { "--unmerged" } else { "--stage" };
    let output = git_output(repository, &["ls-files", mode, "-z", "--", path])?;
    Ok(parse_index_entries(&output.stdout, Some(path))?
        .into_iter()
        .map(|(_, entry)| entry)
        .collect())
}

fn parse_index_entries(
    bytes: &[u8],
    requested_path: Option<&str>,
) -> Result<Vec<(String, IndexEntry)>, ResolveError> {
    let mut result = Vec::new();
    for record in bytes.split(|byte| *byte == 0).filter(|row| !row.is_empty()) {
        let separator = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or(ResolveError::GitFailed)?;
        let (header, raw_path) = record.split_at(separator);
        let path =
            std::str::from_utf8(&raw_path[1..]).map_err(|_| ResolveError::InvalidPathEncoding)?;
        if requested_path.is_some_and(|requested| requested != path) {
            return Err(ResolveError::GitFailed);
        }
        let mut fields = header.split(|byte| *byte == b' ');
        let mode = text_field(fields.next())?;
        let oid = text_field(fields.next())?;
        let stage = text_field(fields.next())?
            .parse::<u8>()
            .ok()
            .filter(|stage| *stage <= 3)
            .ok_or(ResolveError::GitFailed)?;
        if fields.next().is_some() {
            return Err(ResolveError::GitFailed);
        }
        result.push((path.to_owned(), IndexEntry { mode, oid, stage }));
    }
    Ok(result)
}

fn text_field(field: Option<&[u8]>) -> Result<String, ResolveError> {
    std::str::from_utf8(field.ok_or(ResolveError::GitFailed)?)
        .map(str::to_owned)
        .map_err(|_| ResolveError::GitFailed)
}

fn oid_at(entries: &[IndexEntry], stage: u8) -> Option<&str> {
    entries
        .iter()
        .find(|entry| entry.stage == stage)
        .map(|entry| entry.oid.as_str())
}

fn preferred_mode(entries: &[IndexEntry]) -> Option<&str> {
    entries
        .iter()
        .find(|entry| entry.stage == 2)
        .or_else(|| entries.iter().find(|entry| entry.stage == 3))
        .or_else(|| entries.iter().find(|entry| entry.stage == 1))
        .map(|entry| entry.mode.as_str())
}

fn write_regular_file(
    repository: &Path,
    path: &str,
    contents: &[u8],
    mode: Option<&str>,
) -> Result<(), ResolveError> {
    let target = repository.join(path);
    ensure_parent_within_repository(repository, &target, path)?;
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() {
            fs::remove_file(&target).map_err(|_| ResolveError::WriteFailed(path.to_owned()))?;
        } else if !metadata.is_file() {
            return Err(ResolveError::WriteFailed(path.to_owned()));
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| ResolveError::WriteFailed(path.to_owned()))?;
    }
    fs::write(&target, contents).map_err(|_| ResolveError::WriteFailed(path.to_owned()))?;
    set_mode(&target, mode).map_err(|_| ResolveError::WriteFailed(path.to_owned()))
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: Option<&str>) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if matches!(mode, Some("100755")) {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: Option<&str>) -> std::io::Result<()> {
    Ok(())
}

fn checkout_stage(repository: &Path, path: &str, stage: u8) -> Result<(), ResolveError> {
    let stage = format!("--stage={stage}");
    run_git(
        repository,
        &["checkout-index", "--force", &stage, "--", path],
        None,
    )
    .map_err(|_| ResolveError::WriteFailed(path.to_owned()))
}

fn remove_worktree_path(repository: &Path, path: &str) -> Result<(), ResolveError> {
    let target = repository.join(path);
    ensure_parent_within_repository(repository, &target, path)?;
    match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {
            fs::remove_file(target).map_err(|_| ResolveError::WriteFailed(path.to_owned()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err(ResolveError::WriteFailed(path.to_owned())),
    }
}

fn ensure_parent_within_repository(
    repository: &Path,
    target: &Path,
    path: &str,
) -> Result<(), ResolveError> {
    let root = repository
        .canonicalize()
        .map_err(|_| ResolveError::WriteFailed(path.to_owned()))?;
    let mut ancestor = target.parent().ok_or(ResolveError::InvalidPath)?;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or(ResolveError::InvalidPath)?;
    }
    let ancestor = ancestor
        .canonicalize()
        .map_err(|_| ResolveError::WriteFailed(path.to_owned()))?;
    if ancestor.starts_with(root) {
        Ok(())
    } else {
        Err(ResolveError::WriteFailed(path.to_owned()))
    }
}

fn stage(repository: &Path, path: &str) -> Result<(), ResolveError> {
    run_git(repository, &["add", "-A", "--", path], None)
        .map_err(|_| ResolveError::WriteFailed(path.to_owned()))
}

fn restore_stages(
    repository: &Path,
    path: &str,
    stages: &[IndexEntry],
) -> Result<(), ResolveError> {
    let mut input = format!("0 {}\t{}\0", "0".repeat(40), path).into_bytes();
    for entry in stages {
        input.extend_from_slice(
            format!("{} {} {}\t{}\0", entry.mode, entry.oid, entry.stage, path).as_bytes(),
        );
    }
    run_git(
        repository,
        &["update-index", "-z", "--index-info"],
        Some(&input),
    )
    .map_err(|_| ResolveError::WriteFailed(path.to_owned()))
}

fn validate_path(path: &str) -> Result<(), ResolveError> {
    diff::validate_path(path).map_err(|_| ResolveError::InvalidPath)
}

fn git_output(repository: &Path, args: &[&str]) -> Result<Output, ResolveError> {
    let output = git_command(repository, args)
        .output()
        .map_err(|_| ResolveError::GitFailed)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(ResolveError::GitFailed)
    }
}

fn run_git(repository: &Path, args: &[&str], input: Option<&[u8]>) -> Result<(), ResolveError> {
    let mut command = git_command(repository, args);
    command.stdout(Stdio::null()).stderr(Stdio::null());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command.spawn().map_err(|_| ResolveError::GitFailed)?;
    if let Some(input) = input {
        child
            .stdin
            .take()
            .ok_or(ResolveError::GitFailed)?
            .write_all(input)
            .map_err(|_| ResolveError::GitFailed)?;
    }
    if child.wait().map_err(|_| ResolveError::GitFailed)?.success() {
        Ok(())
    } else {
        Err(ResolveError::GitFailed)
    }
}

fn git_command(repository: &Path, args: &[&str]) -> Command {
    let mut command = crate::process::command("git");
    command
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    command
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use std::process::{Command, Stdio};

    use tempfile::TempDir;

    use super::{
        auto, content, keep_side, mark, unresolve, ConflictSide, ResolutionSnapshots, ResolveError,
    };

    fn git(repository: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .output()
            .expect("Git CLI disponible")
            .status
            .success()
    }

    fn output(repository: &Path, args: &[&str]) -> Vec<u8> {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .expect("Git CLI disponible");
        assert!(output.status.success());
        output.stdout
    }

    #[test]
    fn saves_legacy_and_unicode_encodings_and_rejects_unmappable_text_before_writing() {
        for name in [
            "windows-1252",
            "iso-8859-1",
            "shift_jis",
            "utf-16le",
            "utf-32be",
        ] {
            let temporary = repository_with_conflict(false);
            let repository = temporary.path();
            let original =
                super::encoding::encode("ours\n", name, name.starts_with("utf-")).unwrap();
            fs::write(repository.join("blob.txt"), &original).unwrap();
            let oid =
                String::from_utf8(output(repository, &["hash-object", "-w", "blob.txt"])).unwrap();
            let mut child = Command::new("git")
                .args(["update-index", "--index-info"])
                .current_dir(repository)
                .stdin(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(format!("100644 {} 2\tfile.txt\n", oid.trim()).as_bytes())
                .unwrap();
            assert!(child.wait().unwrap().success());
            let worktree_before = fs::read(repository.join("file.txt")).unwrap();
            let index_before = output(repository, &["ls-files", "--stage"]);
            let snapshots = ResolutionSnapshots::default();
            if !name.starts_with("utf-") {
                assert!(matches!(
                    super::content_checked_encoded(
                        repository,
                        "repo",
                        "file.txt",
                        "😀\n",
                        None,
                        Some(name),
                        &snapshots
                    ),
                    Err(ResolveError::Unrepresentable { .. })
                ));
                assert_eq!(
                    fs::read(repository.join("file.txt")).unwrap(),
                    worktree_before
                );
                assert_eq!(output(repository, &["ls-files", "--stage"]), index_before);
            }
            let text = if name == "shift_jis" {
                "日本語\n"
            } else {
                "café resuelto\n"
            };
            super::content_checked_encoded(
                repository,
                "repo",
                "file.txt",
                text,
                None,
                Some(name),
                &snapshots,
            )
            .unwrap();
            let expected = super::encoding::encode(text, name, name.starts_with("utf-")).unwrap();
            assert_eq!(
                fs::read(repository.join("file.txt")).unwrap(),
                expected,
                "{name}"
            );
            assert_eq!(
                output(repository, &["show", ":file.txt"]),
                expected,
                "{name}"
            );
            assert!(output(repository, &["ls-files", "--unmerged"]).is_empty());
        }
    }

    fn repository_with_conflict(theirs_deletes: bool) -> TempDir {
        let temporary = TempDir::new().expect("directorio temporal");
        let repository = temporary.path();
        assert!(git(repository, &["init", "-b", "main"]));
        fs::write(repository.join("file.txt"), "base\n").expect("base");
        assert!(git(repository, &["add", "file.txt"]));
        assert!(git(repository, &["commit", "-m", "base"]));
        assert!(git(repository, &["checkout", "-b", "theirs"]));
        if theirs_deletes {
            assert!(git(repository, &["rm", "file.txt"]));
        } else {
            fs::write(repository.join("file.txt"), "theirs\n").expect("theirs");
            assert!(git(repository, &["add", "file.txt"]));
        }
        assert!(git(repository, &["commit", "-m", "theirs"]));
        assert!(git(repository, &["checkout", "main"]));
        fs::write(repository.join("file.txt"), "ours\n").expect("ours");
        assert!(git(repository, &["add", "file.txt"]));
        assert!(git(repository, &["commit", "-m", "ours"]));
        assert!(!git(repository, &["merge", "theirs"]));
        temporary
    }

    #[test]
    fn revalida_las_etapas_antes_de_escribir_sin_tocar_el_archivo_si_cambiaron() {
        let temporary = repository_with_conflict(false);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();
        let revision = crate::git::conflict::revision(repository, "file.txt").unwrap();
        let before = fs::read(repository.join("file.txt")).unwrap();
        assert_eq!(
            super::content_checked(
                repository,
                &id,
                "file.txt",
                "incorrecto",
                Some("obsoleto"),
                &snapshots
            ),
            Err(ResolveError::Stale("file.txt".to_owned()))
        );
        assert_eq!(fs::read(repository.join("file.txt")).unwrap(), before);
        assert_eq!(
            crate::git::conflict::revision(repository, "file.txt").unwrap(),
            revision
        );
        super::content_checked(
            repository,
            &id,
            "file.txt",
            "resuelto\r\nsin salto",
            Some(&revision),
            &snapshots,
        )
        .unwrap();
        assert_eq!(
            fs::read(repository.join("file.txt")).unwrap(),
            b"resuelto\r\nsin salto"
        );
        assert_eq!(
            super::content_checked(
                repository,
                &id,
                "file.txt",
                "otro",
                Some(&revision),
                &snapshots
            ),
            Err(ResolveError::Stale("file.txt".to_owned()))
        );
    }

    #[test]
    fn escribe_la_resolucion_y_restaura_las_etapas_sin_perder_el_borrador() {
        let temporary = repository_with_conflict(false);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();

        content(repository, &id, "file.txt", "resuelto\n", &snapshots).expect("resolver");
        assert!(output(repository, &["ls-files", "--unmerged"]).is_empty());
        assert_eq!(
            fs::read_to_string(repository.join("file.txt")).expect("borrador"),
            "resuelto\n"
        );

        unresolve(repository, &id, "file.txt", &snapshots).expect("desresolver");
        assert_eq!(
            output(repository, &["ls-files", "--unmerged", "--", "file.txt"])
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.is_empty())
                .count(),
            3
        );
        assert_eq!(
            fs::read_to_string(repository.join("file.txt")).expect("borrador conservado"),
            "resuelto\n"
        );
    }

    #[test]
    fn no_desresuelve_si_el_indice_cambio_fuera_de_la_resolucion() {
        let temporary = repository_with_conflict(false);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();
        content(repository, &id, "file.txt", "resuelto\n", &snapshots).expect("resolver");
        fs::write(repository.join("file.txt"), "externo\n").expect("cambio externo");
        assert!(git(repository, &["add", "file.txt"]));

        assert_eq!(
            unresolve(repository, &id, "file.txt", &snapshots),
            Err(ResolveError::Stale("file.txt".to_owned()))
        );
    }

    #[test]
    fn marcar_el_contenido_actual_conserva_las_etapas_para_desresolver() {
        let temporary = repository_with_conflict(false);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();
        let before = fs::read_to_string(repository.join("file.txt")).expect("contenido actual");

        mark(repository, &id, "file.txt", &snapshots).expect("marcar");

        assert!(output(repository, &["ls-files", "--unmerged"]).is_empty());
        assert_eq!(
            fs::read_to_string(repository.join("file.txt")).expect("contenido conservado"),
            before
        );

        unresolve(repository, &id, "file.txt", &snapshots).expect("desresolver");
        assert!(!output(repository, &["ls-files", "--unmerged"]).is_empty());
    }

    #[test]
    fn marcar_lote_conserva_contenido_y_permite_desresolver_cada_archivo() {
        let temporary = repository_with_conflict(false);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();
        let before = fs::read(repository.join("file.txt")).unwrap();
        let stages = super::conflicted_entries(repository, "file.txt").unwrap();
        let mut paths = vec!["file.txt".to_owned()];
        for index in 1..8 {
            let path = format!("archivo [{index}] con espacios.txt");
            fs::write(repository.join(&path), &before).unwrap();
            super::restore_stages(repository, &path, &stages).unwrap();
            paths.push(path);
        }
        fs::remove_file(repository.join(&paths[7])).unwrap();
        super::mark_many(repository, &id, &paths, &snapshots).unwrap();
        assert!(output(repository, &["ls-files", "--unmerged"]).is_empty());
        for path in &paths[..7] {
            assert_eq!(fs::read(repository.join(path)).unwrap(), before);
        }
        for path in &paths {
            unresolve(repository, &id, path, &snapshots).unwrap();
            assert_eq!(super::conflicted_entries(repository, path).unwrap(), stages);
        }
    }

    #[test]
    fn marcar_lote_obsoleto_no_prepara_ningun_archivo() {
        let temporary = repository_with_conflict(false);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let before = output(repository, &["ls-files", "--stage", "-z"]);
        assert_eq!(
            super::mark_many(
                repository,
                "repo",
                &["file.txt".to_owned(), "inexistente.txt".to_owned()],
                &snapshots,
            ),
            Err(ResolveError::NotConflicted("inexistente.txt".to_owned()))
        );
        assert_eq!(output(repository, &["ls-files", "--stage", "-z"]), before);
    }

    #[test]
    fn conservar_un_lado_respeta_que_ese_lado_haya_borrado_el_archivo() {
        let temporary = repository_with_conflict(true);
        let repository = temporary.path();
        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();

        keep_side(
            repository,
            &id,
            "file.txt",
            ConflictSide::Theirs,
            &snapshots,
        )
        .expect("conservar borrado de theirs");
        assert!(!repository.join("file.txt").exists());
        assert!(output(repository, &["ls-files", "--unmerged"]).is_empty());
        unresolve(repository, &id, "file.txt", &snapshots).expect("restaurar conflicto");
        assert!(!output(repository, &["ls-files", "--unmerged"]).is_empty());
    }

    #[test]
    fn autoresuelve_solo_la_relacion_inequivoca_de_las_tres_etapas() {
        let temporary = TempDir::new().expect("directorio temporal");
        let repository = temporary.path();
        assert!(git(repository, &["init", "-b", "main"]));
        fs::write(repository.join("seed"), "seed\n").expect("seed");
        assert!(git(repository, &["add", "seed"]));
        assert!(git(repository, &["commit", "-m", "base"]));
        let base = hash_blob(repository, b"base\n");
        let theirs = hash_blob(repository, b"theirs\n");
        let other_ours = hash_blob(repository, b"ours\n");
        let other_theirs = hash_blob(repository, b"other\n");
        let input = format!(
            "100644 {base} 1\tauto.txt\n100644 {base} 2\tauto.txt\n100644 {theirs} 3\tauto.txt\n\
             100644 {base} 1\tmanual.txt\n100644 {other_ours} 2\tmanual.txt\n100644 {other_theirs} 3\tmanual.txt\n"
        );
        let mut command = Command::new("git");
        let mut child = command
            .args(["update-index", "--index-info"])
            .current_dir(repository)
            .stdin(Stdio::piped())
            .spawn()
            .expect("update-index");
        child
            .stdin
            .take()
            .expect("stdin")
            .write_all(input.as_bytes())
            .expect("etapas");
        assert!(child.wait().expect("resultado").success());

        let snapshots = ResolutionSnapshots::default();
        let id = repository.to_string_lossy();
        let resolved = auto(repository, &id, &snapshots).expect("autoresolver");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].path, "auto.txt");
        let remaining = String::from_utf8(output(repository, &["ls-files", "--unmerged"]))
            .expect("índice utf8");
        assert!(!remaining.contains("auto.txt"));
        assert!(remaining.contains("manual.txt"));
        assert_eq!(
            fs::read_to_string(repository.join("auto.txt")).expect("lado elegido"),
            "theirs\n"
        );
    }

    fn hash_blob(repository: &Path, contents: &[u8]) -> String {
        let mut command = Command::new("git");
        let mut child = command
            .args(["hash-object", "-w", "--stdin"])
            .current_dir(repository)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("hash-object");
        child
            .stdin
            .take()
            .expect("stdin")
            .write_all(contents)
            .expect("blob");
        let output = child.wait_with_output().expect("oid");
        assert!(output.status.success());
        String::from_utf8(output.stdout)
            .expect("oid utf8")
            .trim()
            .to_owned()
    }
}

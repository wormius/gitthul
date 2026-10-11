//! Lectura del índice y el árbol de trabajo mediante formatos máquina de Git.
//!
//! Las rutas se conservan como campos terminados en NUL. Nunca se separan por
//! espacios ni se pasan por una conversión con pérdida antes de cruzar status
//! con numstat.

use std::collections::HashMap;
use std::path::Path;
use std::process::Output;

use serde::{Deserialize, Serialize};

use super::stash::{self, StashRecoveryKind};

#[derive(Debug, PartialEq, Eq)]
pub enum ReadStatusError {
    GitFailed,
    InvalidPathEncoding,
    MalformedOutput,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingStatus {
    staged: Vec<FileChange>,
    unstaged: Vec<FileChange>,
    conflicted: Vec<FileChange>,
    clean: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit_precondition: Option<CommitPrecondition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reset_precondition: Option<ResetPrecondition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_operation: Option<StashRecoveryKind>,
}

impl WorkingStatus {
    pub(super) fn conflicted_count(&self) -> usize {
        self.conflicted.len()
    }

    pub(super) fn change_count(&self) -> usize {
        self.staged.len() + self.unstaged.len() + self.conflicted.len()
    }
}

/// Cuenta las entradas que el checkout presenta como cambios locales.
///
/// El checkout no necesita numstat, detección de renombres, huellas de undo ni
/// recorrer el contenido de los archivos sin seguimiento. `read()` sí construye
/// toda esa información para GitWorking, pero usarla sólo para decidir si hace
/// falta un auto-stash convierte un `git switch` en varias lecturas completas del
/// repositorio.
pub(super) fn checkout_change_count(repository: &Path) -> Result<usize, ReadStatusError> {
    let output = git_output(
        repository,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--no-renames",
        ],
    )?;
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .map(|entry| match entry {
            [b'1' | b'2', b' ', index, worktree, ..] => {
                usize::from(*index != b'.') + usize::from(*worktree != b'.')
            }
            [b'?', b' ', ..] => 1,
            // `read()` presenta los conflictos aparte y el conteo histórico de
            // checkout sólo incluye staged + unstaged.
            _ => 0,
        })
        .sum())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPrecondition {
    pub(super) head: Option<String>,
    pub(super) index_tree: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPrecondition {
    pub(super) head: Option<String>,
    pub(super) index_tree: Option<String>,
    pub(super) worktree_tree: Option<String>,
    #[serde(default)]
    pub(super) untracked_tree: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_path: Option<String>,
    change: ChangeType,
    binary: bool,
    insertions: u64,
    deletions: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict: Option<ConflictKind>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    TypeChanged,
    Conflicted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ConflictKind {
    BothModified,
    BothAdded,
    BothDeleted,
    DeletedByUs,
    DeletedByThem,
    AddedByUs,
    AddedByThem,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct FileStats {
    binary: bool,
    insertions: u64,
    deletions: u64,
}

pub fn read(repository: &Path) -> Result<WorkingStatus, ReadStatusError> {
    let status = git_output(
        repository,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--ignored=matching",
            "--renames",
        ],
    )?;
    let unstaged_stats = parse_numstat(&git_output(
        repository,
        &["diff", "--numstat", "-z", "--find-renames", "--"],
    )?)?;
    let staged_stats = parse_numstat(&git_output(
        repository,
        &[
            "diff",
            "--cached",
            "--numstat",
            "-z",
            "--find-renames",
            "--",
        ],
    )?)?;

    let mut parsed = parse_status(&status.stdout, &staged_stats, &unstaged_stats)?;
    let commit = commit_precondition(repository);
    parsed.reset_precondition = Some(ResetPrecondition {
        head: commit.head.clone(),
        index_tree: commit.index_tree.clone(),
        worktree_tree: worktree_fingerprint(repository),
        untracked_tree: untracked_fingerprint(repository),
    });
    parsed.commit_precondition = Some(commit);
    parsed.recovery_operation = stash::recovery_kind(repository);
    Ok(parsed)
}

pub(super) fn head_oid(repository: &Path) -> Option<String> {
    git_text(repository, &["rev-parse", "--verify", "HEAD"])
}

pub(super) fn reset_precondition(repository: &Path) -> ResetPrecondition {
    let mut precondition = tracked_reset_precondition(repository);
    precondition.untracked_tree = untracked_fingerprint(repository);
    precondition
}

pub(super) fn tracked_reset_precondition(repository: &Path) -> ResetPrecondition {
    ResetPrecondition {
        head: git_text(repository, &["rev-parse", "--verify", "HEAD"]),
        index_tree: index_fingerprint(repository),
        worktree_tree: worktree_fingerprint(repository),
        untracked_tree: None,
    }
}

pub(super) fn commit_precondition(repository: &Path) -> CommitPrecondition {
    CommitPrecondition {
        head: git_text(repository, &["rev-parse", "--verify", "HEAD"]),
        index_tree: index_fingerprint(repository),
    }
}

/**
 * Identifica el contenido completo del índice sin pedirle a Git que escriba.
 *
 * `git write-tree` parecía una lectura apropiada, pero rellena la extensión cache-tree del índice.
 * El watcher interpretaba esa escritura como un cambio real y volvía a cargar GitWorking en bucle.
 * Las filas de `ls-files --stage -z` ya contienen modo, OID, etapa y ruta literal; su SHA-1 es una
 * precondición opaca igualmente exacta para commit y undo, sin modificar `.git/index`.
 */
fn index_fingerprint(repository: &Path) -> Option<String> {
    let output = crate::process::command("git")
        .args(["ls-files", "--stage", "-z"])
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut digest = gix::hash::hasher(gix::hash::Kind::Sha1);
    digest.update(b"gitthul-index-v1\0");
    digest.update(&output.stdout);
    digest.try_finalize().ok().map(|oid| oid.to_string())
}

/** Identifica solo los cambios rastreados del árbol de trabajo, sin escribir. */
fn worktree_fingerprint(repository: &Path) -> Option<String> {
    let output = crate::process::command("git")
        .args([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--full-index",
            "--no-color",
            "--no-renames",
            "--",
        ])
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut digest = gix::hash::hasher(gix::hash::Kind::Sha1);
    digest.update(b"gitthul-worktree-v1\0");
    digest.update(&output.stdout);
    digest.try_finalize().ok().map(|oid| oid.to_string())
}

fn untracked_fingerprint(repository: &Path) -> Option<String> {
    use std::io::Read;
    let output = git_output(
        repository,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )
    .ok()?;
    let mut paths: Vec<_> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .collect();
    paths.sort();
    let mut digest = gix::hash::hasher(gix::hash::Kind::Sha1);
    digest.update(b"gitthul-untracked-v1\0");
    for path in paths {
        digest.update(path);
        digest.update(&[0]);
        let target = repository.join(std::str::from_utf8(path).ok()?);
        let metadata = std::fs::symlink_metadata(&target).ok()?;
        if metadata.file_type().is_symlink() {
            digest.update(b"symlink\0");
            digest.update(std::fs::read_link(&target).ok()?.to_str()?.as_bytes());
        } else if metadata.is_file() {
            digest.update(b"file\0");
            let mut file = std::fs::File::open(target).ok()?;
            let mut buffer = [0; 65536];
            loop {
                let count = file.read(&mut buffer).ok()?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
            }
        } else {
            // Nested repositories are represented but never removed by discard_all.
            digest.update(b"directory\0");
        }
        digest.update(&[0]);
    }
    digest.try_finalize().ok().map(|oid| oid.to_string())
}

fn git_text(repository: &Path, args: &[&str]) -> Option<String> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8(output.stdout).ok()?.trim().to_owned())
}

fn git_output(repository: &Path, args: &[&str]) -> Result<Output, ReadStatusError> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| ReadStatusError::GitFailed)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(ReadStatusError::GitFailed)
    }
}

fn parse_status(
    bytes: &[u8],
    staged_stats: &HashMap<Vec<u8>, FileStats>,
    unstaged_stats: &HashMap<Vec<u8>, FileStats>,
) -> Result<WorkingStatus, ReadStatusError> {
    let fields = nul_fields(bytes);
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut conflicted = Vec::new();
    let mut index = 0;

    while index < fields.len() {
        let record = fields[index];
        index += 1;
        match record.first().copied() {
            Some(b'1') => {
                let parts = split_record(record, 9)?;
                add_ordinary(
                    parts[1],
                    parts[8],
                    None,
                    staged_stats,
                    unstaged_stats,
                    &mut staged,
                    &mut unstaged,
                )?;
            }
            Some(b'2') => {
                let parts = split_record(record, 10)?;
                let previous = *fields.get(index).ok_or(ReadStatusError::MalformedOutput)?;
                index += 1;
                add_ordinary(
                    parts[1],
                    parts[9],
                    Some(previous),
                    staged_stats,
                    unstaged_stats,
                    &mut staged,
                    &mut unstaged,
                )?;
            }
            Some(b'u') => {
                let parts = split_record(record, 11)?;
                let xy = parts[1];
                let conflict = conflict_kind(xy).ok_or(ReadStatusError::MalformedOutput)?;
                conflicted.push(change(
                    parts[10],
                    None,
                    ChangeType::Conflicted,
                    None,
                    Some(conflict),
                )?);
            }
            Some(b'?') if record.get(1) == Some(&b' ') => {
                unstaged.push(change(
                    &record[2..],
                    None,
                    ChangeType::Untracked,
                    None,
                    None,
                )?);
            }
            // Un ignorado no es un cambio accionable y no pertenece a WorkingStatus.
            Some(b'!') if record.get(1) == Some(&b' ') => {}
            _ => return Err(ReadStatusError::MalformedOutput),
        }
    }

    let clean = staged.is_empty() && unstaged.is_empty() && conflicted.is_empty();
    Ok(WorkingStatus {
        staged,
        unstaged,
        conflicted,
        clean,
        commit_precondition: None,
        reset_precondition: None,
        recovery_operation: None,
    })
}

#[allow(clippy::too_many_arguments)]
fn add_ordinary(
    xy: &[u8],
    path: &[u8],
    previous_path: Option<&[u8]>,
    staged_stats: &HashMap<Vec<u8>, FileStats>,
    unstaged_stats: &HashMap<Vec<u8>, FileStats>,
    staged: &mut Vec<FileChange>,
    unstaged: &mut Vec<FileChange>,
) -> Result<(), ReadStatusError> {
    if xy.len() != 2 {
        return Err(ReadStatusError::MalformedOutput);
    }
    if let Some(kind) = change_type(xy[0])? {
        let previous_path = rename_origin(kind, previous_path);
        staged.push(change(
            path,
            previous_path,
            kind,
            staged_stats.get(path).copied(),
            None,
        )?);
    }
    if let Some(kind) = change_type(xy[1])? {
        let previous_path = rename_origin(kind, previous_path);
        unstaged.push(change(
            path,
            previous_path,
            kind,
            unstaged_stats.get(path).copied(),
            None,
        )?);
    }
    Ok(())
}

fn change(
    path: &[u8],
    previous_path: Option<&[u8]>,
    change: ChangeType,
    stats: Option<FileStats>,
    conflict: Option<ConflictKind>,
) -> Result<FileChange, ReadStatusError> {
    let stats = stats.unwrap_or_default();
    Ok(FileChange {
        path: strict_path(path)?,
        previous_path: previous_path.map(strict_path).transpose()?,
        change,
        binary: stats.binary,
        insertions: stats.insertions,
        deletions: stats.deletions,
        conflict,
    })
}

fn rename_origin(kind: ChangeType, previous_path: Option<&[u8]>) -> Option<&[u8]> {
    matches!(kind, ChangeType::Renamed | ChangeType::Copied)
        .then_some(previous_path)
        .flatten()
}

fn change_type(value: u8) -> Result<Option<ChangeType>, ReadStatusError> {
    match value {
        b'.' => Ok(None),
        b'A' => Ok(Some(ChangeType::Added)),
        b'M' => Ok(Some(ChangeType::Modified)),
        b'D' => Ok(Some(ChangeType::Deleted)),
        b'R' => Ok(Some(ChangeType::Renamed)),
        b'C' => Ok(Some(ChangeType::Copied)),
        b'T' => Ok(Some(ChangeType::TypeChanged)),
        _ => Err(ReadStatusError::MalformedOutput),
    }
}

fn conflict_kind(xy: &[u8]) -> Option<ConflictKind> {
    match xy {
        b"UU" => Some(ConflictKind::BothModified),
        b"AA" => Some(ConflictKind::BothAdded),
        b"DD" => Some(ConflictKind::BothDeleted),
        b"DU" => Some(ConflictKind::DeletedByUs),
        b"UD" => Some(ConflictKind::DeletedByThem),
        b"AU" => Some(ConflictKind::AddedByUs),
        b"UA" => Some(ConflictKind::AddedByThem),
        _ => None,
    }
}

fn parse_numstat(output: &Output) -> Result<HashMap<Vec<u8>, FileStats>, ReadStatusError> {
    let fields = nul_fields(&output.stdout);
    let mut result = HashMap::new();
    let mut index = 0;
    while index < fields.len() {
        let header = fields[index];
        index += 1;
        let mut parts = header.splitn(3, |byte| *byte == b'\t');
        let added = parts.next().ok_or(ReadStatusError::MalformedOutput)?;
        let deleted = parts.next().ok_or(ReadStatusError::MalformedOutput)?;
        let path = parts.next().ok_or(ReadStatusError::MalformedOutput)?;
        let binary = added == b"-" && deleted == b"-";
        let stats = if binary {
            FileStats {
                binary: true,
                ..FileStats::default()
            }
        } else {
            FileStats {
                binary: false,
                insertions: parse_number(added)?,
                deletions: parse_number(deleted)?,
            }
        };
        let destination = if path.is_empty() {
            // En un renombrado numstat añade origen y destino como dos campos NUL.
            let _source = fields.get(index).ok_or(ReadStatusError::MalformedOutput)?;
            let destination = fields
                .get(index + 1)
                .ok_or(ReadStatusError::MalformedOutput)?;
            index += 2;
            *destination
        } else {
            path
        };
        result.insert(destination.to_vec(), stats);
    }
    Ok(result)
}

fn parse_number(bytes: &[u8]) -> Result<u64, ReadStatusError> {
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or(ReadStatusError::MalformedOutput)
}

fn strict_path(bytes: &[u8]) -> Result<String, ReadStatusError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| ReadStatusError::InvalidPathEncoding)
}

fn split_record(record: &[u8], expected: usize) -> Result<Vec<&[u8]>, ReadStatusError> {
    let parts = record
        .splitn(expected, |byte| *byte == b' ')
        .collect::<Vec<_>>();
    if parts.len() == expected {
        Ok(parts)
    } else {
        Err(ReadStatusError::MalformedOutput)
    }
}

fn nul_fields(bytes: &[u8]) -> Vec<&[u8]> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::{Command, Stdio};

    use tempfile::TempDir;

    use super::{read, reset_precondition, ChangeType, ConflictKind, ReadStatusError};

    fn git(directory: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(directory)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("Git CLI disponible")
            .success()
    }

    fn repository() -> TempDir {
        let temporary = TempDir::new().expect("carpeta temporal");
        assert!(git(temporary.path(), &["init", "--initial-branch=main"]));
        assert!(git(temporary.path(), &["config", "core.autocrlf", "false"]));
        temporary
    }

    fn commit_all(directory: &Path, message: &str) {
        assert!(git(directory, &["add", "--all"]));
        assert!(git(directory, &["commit", "-m", message]));
    }

    #[test]
    fn separa_indice_arbol_no_seguidos_y_renombrados_con_rutas_dificiles() {
        let temporary = repository();
        let root = temporary.path();
        let unusual = if cfg!(windows) {
            "linea ü nueva.txt"
        } else {
            "linea\nnueva.txt"
        };
        fs::write(root.join("ambos.txt"), "base\n").unwrap();
        fs::write(root.join("borrado.txt"), "base\n").unwrap();
        fs::write(root.join("nombre anterior.txt"), "base\n").unwrap();
        fs::write(root.join(unusual), "base\n").unwrap();
        fs::write(root.join(".gitignore"), "*.ignored\n").unwrap();
        commit_all(root, "base");

        fs::write(root.join("ambos.txt"), "preparado\n").unwrap();
        assert!(git(root, &["add", "ambos.txt"]));
        fs::write(root.join("ambos.txt"), "preparado y modificado\n").unwrap();
        fs::remove_file(root.join("borrado.txt")).unwrap();
        assert!(git(
            root,
            &["mv", "nombre anterior.txt", "nombre nuevo.txt"]
        ));
        fs::write(root.join(unusual), "cambio\n").unwrap();
        fs::write(root.join("sin seguir.txt"), "nuevo\n").unwrap();
        fs::write(root.join("oculto.ignored"), "no mostrar\n").unwrap();

        let status = read(root).expect("status real");
        assert!(!status.clean);
        let commit = status.commit_precondition.as_ref().unwrap();
        assert!(commit.head.is_some());
        assert!(commit.index_tree.is_some());
        let reset = status.reset_precondition.as_ref().unwrap();
        assert_eq!(reset.head, commit.head);
        assert_eq!(reset.index_tree, commit.index_tree);
        assert!(reset.worktree_tree.is_some());
        assert!(status.staged.iter().any(|entry| {
            entry.path == "ambos.txt"
                && entry.change == ChangeType::Modified
                && entry.insertions == 1
                && entry.deletions == 1
        }));
        assert!(status.unstaged.iter().any(|entry| {
            entry.path == "ambos.txt"
                && entry.change == ChangeType::Modified
                && entry.insertions == 1
                && entry.deletions == 1
        }));
        assert!(status
            .unstaged
            .iter()
            .any(|entry| { entry.path == "borrado.txt" && entry.change == ChangeType::Deleted }));
        assert!(status.staged.iter().any(|entry| {
            entry.path == "nombre nuevo.txt"
                && entry.previous_path.as_deref() == Some("nombre anterior.txt")
                && entry.change == ChangeType::Renamed
        }));
        assert!(status.unstaged.iter().any(|entry| entry.path == unusual));
        assert!(status
            .unstaged
            .iter()
            .any(|entry| entry.path == "sin seguir.txt" && entry.change == ChangeType::Untracked));
        assert!(!status
            .unstaged
            .iter()
            .any(|entry| entry.path == "oculto.ignored"));
    }

    #[test]
    fn la_precondicion_es_estable_cambia_con_el_indice_y_no_lo_reescribe() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("archivo.txt"), "base\n").unwrap();
        commit_all(root, "base");
        fs::write(root.join("archivo.txt"), "uno\n").unwrap();
        assert!(git(root, &["add", "archivo.txt"]));
        let index = root.join(".git/index");
        let before_bytes = fs::read(&index).unwrap();

        let first = read(root)
            .unwrap()
            .commit_precondition
            .unwrap()
            .index_tree
            .unwrap();
        let second = read(root)
            .unwrap()
            .commit_precondition
            .unwrap()
            .index_tree
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(fs::read(&index).unwrap(), before_bytes);

        fs::write(root.join("archivo.txt"), "dos\n").unwrap();
        assert!(git(root, &["add", "archivo.txt"]));
        let changed = read(root)
            .unwrap()
            .commit_precondition
            .unwrap()
            .index_tree
            .unwrap();
        assert_ne!(changed, first);
    }

    #[test]
    fn la_huella_del_arbol_cambia_solo_con_lo_no_preparado() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("archivo.txt"), "base\n").unwrap();
        commit_all(root, "base");
        let first = reset_precondition(root);

        fs::write(root.join("archivo.txt"), "cambio\n").unwrap();
        let unstaged = reset_precondition(root);
        assert_eq!(unstaged.index_tree, first.index_tree);
        assert_ne!(unstaged.worktree_tree, first.worktree_tree);

        assert!(git(root, &["add", "archivo.txt"]));
        let staged = reset_precondition(root);
        assert_ne!(staged.index_tree, first.index_tree);
        assert_eq!(staged.worktree_tree, first.worktree_tree);
    }

    #[test]
    fn detecta_binarios_con_la_misma_senal_de_numstat() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("asset.bin"), [0, 1, 2]).unwrap();
        commit_all(root, "base");
        fs::write(root.join("asset.bin"), [0, 3, 4]).unwrap();

        let status = read(root).unwrap();
        let binary = status
            .unstaged
            .iter()
            .find(|entry| entry.path == "asset.bin")
            .unwrap();
        assert!(binary.binary);
        assert_eq!((binary.insertions, binary.deletions), (0, 0));
    }

    #[test]
    fn clasifica_un_conflicto_real_sin_duplicarlo_en_xy() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("conflicto.txt"), "base\n").unwrap();
        commit_all(root, "base");
        assert!(git(root, &["switch", "-c", "lado"]));
        fs::write(root.join("conflicto.txt"), "lado\n").unwrap();
        commit_all(root, "lado");
        assert!(git(root, &["switch", "main"]));
        fs::write(root.join("conflicto.txt"), "principal\n").unwrap();
        commit_all(root, "principal");
        assert!(!git(root, &["merge", "lado"]));

        let status = read(root).unwrap();
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert_eq!(status.conflicted.len(), 1);
        assert_eq!(status.conflicted[0].change, ChangeType::Conflicted);
        assert_eq!(
            status.conflicted[0].conflict,
            Some(ConflictKind::BothModified)
        );
    }

    #[test]
    fn cubre_toda_la_tabla_xy_de_conflictos_de_porcelain_v2() {
        use super::conflict_kind;

        assert_eq!(conflict_kind(b"UU"), Some(ConflictKind::BothModified));
        assert_eq!(conflict_kind(b"AA"), Some(ConflictKind::BothAdded));
        assert_eq!(conflict_kind(b"DD"), Some(ConflictKind::BothDeleted));
        assert_eq!(conflict_kind(b"DU"), Some(ConflictKind::DeletedByUs));
        assert_eq!(conflict_kind(b"UD"), Some(ConflictKind::DeletedByThem));
        assert_eq!(conflict_kind(b"AU"), Some(ConflictKind::AddedByUs));
        assert_eq!(conflict_kind(b"UA"), Some(ConflictKind::AddedByThem));
        assert_eq!(conflict_kind(b"XX"), None);
    }

    #[test]
    fn tipa_los_dos_lados_xy_y_los_registros_de_copia() {
        use std::collections::HashMap;

        use super::parse_status;

        let porcelain = b"1 AM N... 000000 100644 100644 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 agregado.txt\0\
1 T. N... 100644 100755 100755 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 modo.txt\0\
2 C. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 C100 copia.txt\0origen.txt\0\
2 .R N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 movido.txt\0anterior.txt\0";
        let status = parse_status(porcelain, &HashMap::new(), &HashMap::new()).unwrap();

        assert_eq!(
            status
                .staged
                .iter()
                .map(|entry| (
                    entry.path.as_str(),
                    entry.change,
                    entry.previous_path.as_deref()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("agregado.txt", ChangeType::Added, None),
                ("modo.txt", ChangeType::TypeChanged, None),
                ("copia.txt", ChangeType::Copied, Some("origen.txt")),
            ]
        );
        assert_eq!(
            status
                .unstaged
                .iter()
                .map(|entry| (
                    entry.path.as_str(),
                    entry.change,
                    entry.previous_path.as_deref()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("agregado.txt", ChangeType::Modified, None),
                ("movido.txt", ChangeType::Renamed, Some("anterior.txt")),
            ]
        );
    }

    #[test]
    fn rejects_non_utf8_path_bytes_on_every_platform() {
        assert_eq!(
            super::strict_path(b"invalid-\xff.txt"),
            Err(ReadStatusError::InvalidPathEncoding)
        );
    }

    // APFS/HFS+ cannot store this fixture; byte decoding is tested on all platforms.
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn rechaza_una_ruta_no_utf8_sin_reemplazar_sus_bytes() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let temporary = repository();
        let path = temporary
            .path()
            .join(OsString::from_vec(b"invalido-\xff.txt".to_vec()));
        fs::write(path, "contenido\n").unwrap();

        assert_eq!(
            read(temporary.path()),
            Err(ReadStatusError::InvalidPathEncoding)
        );
    }
}

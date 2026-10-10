//! Contenido, árbol e historial de archivos reales.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;

use super::{diff, encoding, history};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    path: String,
    text: Option<String>,
    binary: bool,
    size: usize,
    media_type: &'static str,
    encoding: &'static str,
    detected_encoding: &'static str,
    decoding_errors: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    path: String,
    kind: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadFileError {
    UnsupportedEncoding(String),
    PathEncoding,
    CommitEncoding,
    PathNotFound,
    RevisionNotFound(String),
    GitFailed,
    MalformedOutput,
}

#[cfg(test)]
pub fn read_file(
    repository: &Path,
    path: String,
    at: Option<&str>,
) -> Result<FileContents, ReadFileError> {
    read_file_encoded(repository, path, at, None)
}

pub fn read_file_encoded(
    repository: &Path,
    path: String,
    at: Option<&str>,
    requested: Option<&str>,
) -> Result<FileContents, ReadFileError> {
    diff::validate_path(&path).map_err(|_| ReadFileError::PathNotFound)?;
    let bytes = if let Some(revision) = at {
        let revision = resolve_commit(repository, revision)?;
        let object = format!("{revision}:{path}");
        let output = git(repository, &["cat-file", "blob", &object])
            .map_err(|_| ReadFileError::PathNotFound)?;
        output.stdout
    } else {
        fs::read(repository.join(&path)).map_err(|_| ReadFileError::PathNotFound)?
    };
    decode_file(path, &bytes, requested)
}

pub fn read_blob_encoded(
    repository: &Path,
    path: String,
    blob: &str,
    requested: Option<&str>,
) -> Result<FileContents, ReadFileError> {
    diff::validate_path(&path).map_err(|_| ReadFileError::PathNotFound)?;
    gix::ObjectId::from_hex(blob.as_bytes()).map_err(|_| ReadFileError::MalformedOutput)?;
    let output = git(repository, &["cat-file", "blob", blob])?;
    decode_file(path, &output.stdout, requested)
}

fn decode_file(
    path: String,
    bytes: &[u8],
    requested: Option<&str>,
) -> Result<FileContents, ReadFileError> {
    let size = bytes.len();
    let decoded = encoding::decode(bytes, requested).map_err(ReadFileError::UnsupportedEncoding)?;
    let binary = encoding::is_binary(bytes);
    let encoding = if binary { "binary" } else { decoded.encoding };
    let detected_encoding = decoded.detected;
    let decoding_errors = !binary && decoded.errors;
    let text = if binary { None } else { Some(decoded.text) };
    let binary = text.is_none();
    Ok(FileContents {
        path: path.clone(),
        text,
        binary,
        size,
        media_type: if binary {
            diff::media_type(&path)
        } else {
            "text/plain"
        },
        encoding,
        detected_encoding,
        decoding_errors,
    })
}

pub fn read_tree(repository: &Path, at: Option<&str>) -> Result<Vec<TreeEntry>, ReadFileError> {
    let revision = match at {
        Some(revision) => resolve_commit(repository, revision)?,
        None => match resolve_commit(repository, "HEAD") {
            Ok(revision) => revision,
            Err(ReadFileError::RevisionNotFound(_)) => return Ok(Vec::new()),
            Err(error) => return Err(error),
        },
    };
    let output = git(
        repository,
        &["ls-tree", "-r", "-z", "--name-only", &revision, "--"],
    )?;
    let mut directories = BTreeSet::new();
    let mut files = BTreeSet::new();
    for bytes in nul_fields(&output.stdout) {
        let path = strict_path(bytes)?;
        files.insert(path.clone());
        let mut current = Path::new(&path).parent();
        while let Some(parent) = current {
            if parent.as_os_str().is_empty() {
                break;
            }
            directories.insert(
                parent
                    .to_str()
                    .ok_or(ReadFileError::PathEncoding)?
                    .to_owned(),
            );
            current = parent.parent();
        }
    }
    Ok(directories
        .into_iter()
        .map(|path| TreeEntry {
            path,
            kind: "directory",
        })
        .chain(
            files
                .into_iter()
                .map(|path| TreeEntry { path, kind: "file" }),
        )
        .collect())
}

pub fn read_history(repository: &Path, path: &str) -> Result<Vec<history::Commit>, ReadFileError> {
    diff::validate_path(path).map_err(|_| ReadFileError::PathNotFound)?;
    let output = git_allow_unborn(
        repository,
        &["log", "--follow", "--format=%H%x00", "-z", "--", path],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let repo = gix::open(repository).map_err(|_| ReadFileError::GitFailed)?;
    nul_fields(&output.stdout)
        .into_iter()
        .map(|sha| {
            let id = gix::ObjectId::from_hex(sha).map_err(|_| ReadFileError::MalformedOutput)?;
            history::read_commit(&repo, id).map_err(|error| match error {
                history::ReadHistoryError::InvalidEncoding => ReadFileError::CommitEncoding,
                history::ReadHistoryError::Cancelled
                | history::ReadHistoryError::StartNotFound
                | history::ReadHistoryError::GitFailed => ReadFileError::GitFailed,
            })
        })
        .collect()
}

fn resolve_commit(repository: &Path, revision: &str) -> Result<String, ReadFileError> {
    let commit = format!("{revision}^{{commit}}");
    let output = git(repository, &["rev-parse", "--verify", &commit])
        .map_err(|_| ReadFileError::RevisionNotFound(revision.to_owned()))?;
    let value = std::str::from_utf8(&output.stdout)
        .map(str::trim)
        .map_err(|_| ReadFileError::RevisionNotFound(revision.to_owned()))?;
    if value.is_empty() {
        Err(ReadFileError::RevisionNotFound(revision.to_owned()))
    } else {
        Ok(value.to_owned())
    }
}

fn strict_path(bytes: &[u8]) -> Result<String, ReadFileError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| ReadFileError::PathEncoding)
}

fn nul_fields(bytes: &[u8]) -> Vec<&[u8]> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect()
}

fn git(repository: &Path, args: &[&str]) -> Result<Output, ReadFileError> {
    let output = git_allow_unborn(repository, args)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(ReadFileError::GitFailed)
    }
}

fn git_allow_unborn(repository: &Path, args: &[&str]) -> Result<Output, ReadFileError> {
    Command::new("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| ReadFileError::GitFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_ok(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Autora")
            .env("GIT_AUTHOR_EMAIL", "autora@example.com")
            .env("GIT_COMMITTER_NAME", "Comitter")
            .env("GIT_COMMITTER_EMAIL", "committer@example.com")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn repository() -> tempfile::TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git_ok(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        temporary
    }

    fn commit(path: &Path, message: &str) -> String {
        git_ok(path, &["add", "--all"]);
        git_ok(path, &["commit", "--quiet", "-m", message]);
        git_ok(path, &["rev-parse", "HEAD"])
    }

    #[test]
    fn lee_texto_binario_revision_y_arbol_anidado() {
        let temporary = repository();
        let path = temporary.path();
        fs::create_dir(path.join("src")).unwrap();
        fs::write(path.join("src/app.txt"), "primero\n").unwrap();
        fs::write(path.join("asset.bin"), [0, 1, 2]).unwrap();
        let first = commit(path, "inicial");
        fs::write(path.join("src/app.txt"), "segundo\n").unwrap();

        assert_eq!(
            read_file(path, "src/app.txt".into(), None)
                .unwrap()
                .text
                .as_deref(),
            Some("segundo\n")
        );
        assert_eq!(
            read_file(path, "src/app.txt".into(), Some(&first))
                .unwrap()
                .text
                .as_deref(),
            Some("primero\n")
        );
        assert!(
            read_file(path, "asset.bin".into(), Some(&first))
                .unwrap()
                .binary
        );
        let tree = read_tree(path, Some(&first)).unwrap();
        assert!(tree.contains(&TreeEntry {
            path: "src".into(),
            kind: "directory"
        }));
        assert!(tree.contains(&TreeEntry {
            path: "src/app.txt".into(),
            kind: "file"
        }));
    }

    #[test]
    fn reads_the_observed_index_blob_even_after_index_and_worktree_change() {
        let temporary = repository();
        let root = temporary.path();
        fs::write(root.join("mixed.txt"), "a\nb\nc\n").unwrap();
        commit(root, "base");
        fs::write(root.join("mixed.txt"), "a\nB\nc\n").unwrap();
        git_ok(root, &["add", "mixed.txt"]);
        let blob = git_ok(root, &["rev-parse", ":mixed.txt"]);
        fs::write(root.join("mixed.txt"), "a\nB\nC\n").unwrap();
        git_ok(root, &["add", "mixed.txt"]);
        fs::remove_file(root.join("mixed.txt")).unwrap();
        let file = read_blob_encoded(root, "mixed.txt".into(), &blob, None).unwrap();
        assert_eq!(file.text.as_deref(), Some("a\nB\nc\n"));
        assert_eq!(file.size, 6);
        assert!(matches!(
            read_blob_encoded(root, "mixed.txt".into(), "HEAD:secret", None),
            Err(ReadFileError::MalformedOutput)
        ));
    }

    #[test]
    fn explicit_decoding_exposes_invalid_bytes_without_rewriting_the_file() {
        let temporary = repository();
        let bytes = b"caf\xe9 \x80\n";
        fs::write(temporary.path().join("legacy.txt"), bytes).unwrap();
        let file =
            super::read_file_encoded(temporary.path(), "legacy.txt".into(), None, Some("utf-8"))
                .unwrap();
        assert_eq!(file.encoding, "utf-8");
        assert!(file.decoding_errors);
        assert_eq!(file.text.as_deref(), Some("caf� �\n"));
        assert_eq!(
            fs::read(temporary.path().join("legacy.txt")).unwrap(),
            bytes
        );
    }

    #[test]
    fn lee_latin1_como_texto_y_reporta_su_codificacion() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(
            path.join("antiguo.java"),
            b"// Espa\xf1a\nclass Antiguo {}\n",
        )
        .unwrap();

        let contents = read_file(path, "antiguo.java".into(), None).unwrap();

        assert!(!contents.binary);
        assert_eq!(contents.encoding, "windows-1252");
        assert_eq!(
            contents.text.as_deref(),
            Some("// España\nclass Antiguo {}\n")
        );
        assert_eq!(contents.media_type, "text/plain");
    }

    #[test]
    fn historial_sigue_un_renombre_y_unborn_devuelve_arbol_vacio() {
        let unborn = repository();
        assert!(read_tree(unborn.path(), None).unwrap().is_empty());

        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("anterior.txt"), "uno\n").unwrap();
        let first = commit(path, "inicial");
        git_ok(path, &["mv", "anterior.txt", "nuevo.txt"]);
        let second = commit(path, "renombra");
        fs::write(path.join("nuevo.txt"), "dos\n").unwrap();
        let third = commit(path, "modifica");
        let history = read_history(path, "nuevo.txt").unwrap();
        assert_eq!(
            history.iter().map(|commit| &commit.sha).collect::<Vec<_>>(),
            vec![&third, &second, &first]
        );
    }

    #[test]
    fn distingue_ruta_y_revision_ausentes() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("archivo.txt"), "uno\n").unwrap();
        commit(path, "inicial");
        assert_eq!(
            read_file(path, "ausente.txt".into(), None).unwrap_err(),
            ReadFileError::PathNotFound
        );
        assert_eq!(
            read_tree(path, Some("no-existe")).unwrap_err(),
            ReadFileError::RevisionNotFound("no-existe".to_owned())
        );
    }
}

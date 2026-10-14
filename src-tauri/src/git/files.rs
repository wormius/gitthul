//! Contenido, árbol e historial de archivos reales.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::Output;

use serde::Serialize;

use super::{diagnostics::Diagnostic, diff, encoding, history};

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
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<Self>, Diagnostic),
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
        let listed = git(repository, &["ls-tree", "-z", &revision, "--", &path])?;
        if listed.stdout.is_empty() {
            return Err(ReadFileError::WithDiagnostic(
                Box::new(ReadFileError::PathNotFound),
                Diagnostic::new(
                    "file.findPathInTree",
                    "Requested path does not exist in the commit tree",
                ),
            ));
        }
        let object = format!("{revision}:{path}");
        git(repository, &["cat-file", "blob", &object])?.stdout
    } else {
        fs::read(repository.join(&path)).map_err(|error| {
            let diagnostic = Diagnostic::io("file.readWorktree", &error);
            if error.kind() == std::io::ErrorKind::NotFound {
                ReadFileError::WithDiagnostic(Box::new(ReadFileError::PathNotFound), diagnostic)
            } else {
                ReadFileError::Diagnostic(diagnostic)
            }
        })?
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
    gix::ObjectId::from_hex(blob.as_bytes()).map_err(|error| {
        ReadFileError::WithDiagnostic(
            Box::new(ReadFileError::MalformedOutput),
            Diagnostic::new("file.validateBlobId", error),
        )
    })?;
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
            Err(error) => {
                let repo = gix::open(repository).map_err(|cause| {
                    ReadFileError::Diagnostic(Diagnostic::cause("tree.openRepository", &cause))
                })?;
                let head = repo.head().map_err(|cause| {
                    ReadFileError::Diagnostic(Diagnostic::cause("tree.readHead", &cause))
                })?;
                if head.is_unborn() {
                    return Ok(Vec::new());
                }
                return Err(error);
            }
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
    let repo = gix::open(repository).map_err(|error| {
        ReadFileError::Diagnostic(Diagnostic::cause("fileHistory.openRepository", &error))
    })?;
    if repo
        .head()
        .map_err(|error| {
            ReadFileError::Diagnostic(Diagnostic::cause("fileHistory.readHead", &error))
        })?
        .is_unborn()
    {
        return Ok(Vec::new());
    }
    let output = git(
        repository,
        &["log", "--follow", "--format=%H%x00", "-z", "--", path],
    )?;
    nul_fields(&output.stdout)
        .into_iter()
        .map(|sha| {
            let id = gix::ObjectId::from_hex(sha).map_err(|error| {
                ReadFileError::Diagnostic(Diagnostic::new("fileHistory.parseCommitId", error))
            })?;
            history::read_commit(&repo, id).map_err(map_history_error)
        })
        .collect()
}

fn map_history_error(error: history::ReadHistoryError) -> ReadFileError {
    match error {
        history::ReadHistoryError::InvalidEncoding => ReadFileError::CommitEncoding,
        history::ReadHistoryError::Diagnostic(diagnostic) => ReadFileError::Diagnostic(diagnostic),
        history::ReadHistoryError::WithDiagnostic(error, diagnostic) => {
            ReadFileError::WithDiagnostic(Box::new(map_history_error(*error)), diagnostic)
        }
        history::ReadHistoryError::Cancelled | history::ReadHistoryError::StartNotFound => {
            ReadFileError::GitFailed
        }
    }
}

fn resolve_commit(repository: &Path, revision: &str) -> Result<String, ReadFileError> {
    let commit = format!("{revision}^{{commit}}");
    let output =
        git(repository, &["rev-parse", "--verify", &commit]).map_err(|error| match error {
            ReadFileError::Diagnostic(diagnostic) => ReadFileError::WithDiagnostic(
                Box::new(ReadFileError::RevisionNotFound(revision.to_owned())),
                diagnostic,
            ),
            error => error,
        })?;
    let value = std::str::from_utf8(&output.stdout)
        .map(str::trim)
        .map_err(|error| {
            ReadFileError::WithDiagnostic(
                Box::new(ReadFileError::MalformedOutput),
                Diagnostic::new("file.resolveCommitOutput", error),
            )
        })?;
    if value.is_empty() {
        Err(ReadFileError::WithDiagnostic(
            Box::new(ReadFileError::MalformedOutput),
            Diagnostic::new(
                "file.resolveCommitOutput",
                "Git returned an empty object identifier",
            ),
        ))
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
        Err(ReadFileError::Diagnostic(Diagnostic::command(
            "file.command",
            args,
            &output,
        )))
    }
}

fn git_allow_unborn(repository: &Path, args: &[&str]) -> Result<Output, ReadFileError> {
    crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            ReadFileError::Diagnostic(Diagnostic::command_io("file.command", args, &error))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

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
        let invalid = read_blob_encoded(root, "mixed.txt".into(), "HEAD:secret", None).unwrap_err();
        let ReadFileError::WithDiagnostic(classification, diagnostic) = invalid else {
            panic!("expected classified diagnostic")
        };
        assert_eq!(*classification, ReadFileError::MalformedOutput);
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["stage"], "file.validateBlobId");
        assert!(!value.to_string().contains("HEAD:secret"));
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
        assert!(matches!(
            read_file(path, "ausente.txt".into(), None).unwrap_err(),
            ReadFileError::WithDiagnostic(error, _) if *error == ReadFileError::PathNotFound
        ));
        assert!(matches!(
            read_tree(path, Some("no-existe")).unwrap_err(),
            ReadFileError::WithDiagnostic(error, _) if *error == ReadFileError::RevisionNotFound("no-existe".to_owned())
        ));
    }
    #[test]
    fn corrupt_history_is_reported_with_git_evidence_instead_of_an_empty_list() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(
            path.join("archivo.txt"),
            "private file contents
",
        )
        .unwrap();
        let sha = commit(path, "private commit message");
        fs::remove_file(path.join(".git/objects").join(&sha[..2]).join(&sha[2..])).unwrap();
        let error = read_history(path, "archivo.txt").unwrap_err();
        let ReadFileError::Diagnostic(diagnostic) = error else {
            panic!("expected diagnostic, got {error:?}")
        };
        let value = serde_json::to_value(&diagnostic).unwrap();
        assert_eq!(value["stage"], "file.command");
        assert_eq!(value["command"]["args"][0], "log");
        assert_ne!(value["exitCode"], 0);
        assert!(value["stderr"].as_str().unwrap().contains("bad object"));
        let text = value.to_string();
        assert!(!text.contains("private file contents"));
        assert!(!text.contains("private commit message"));
        assert!(!text.contains("stdout"));
        let unborn = repository();
        assert!(read_history(unborn.path(), "archivo.txt")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_missing_blob_preserves_cat_file_failure_instead_of_claiming_the_path_is_absent() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(
            path.join("archivo.txt"),
            "private blob contents
",
        )
        .unwrap();
        let sha = commit(path, "initial");
        let blob = git_ok(path, &["rev-parse", "HEAD:archivo.txt"]);
        fs::remove_file(path.join(".git/objects").join(&blob[..2]).join(&blob[2..])).unwrap();
        let error = read_file(path, "archivo.txt".into(), Some(&sha)).unwrap_err();
        let ReadFileError::Diagnostic(diagnostic) = error else {
            panic!("expected diagnostic, got {error:?}")
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["command"]["args"][0], "cat-file");
        assert_ne!(value["exitCode"], 0);
        assert!(!value["stderr"].as_str().unwrap().is_empty());
        assert!(!value.to_string().contains("private blob contents"));
    }
}

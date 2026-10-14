//! Detalle de un commit real y cambios contra su primer padre.

use std::collections::HashMap;
use std::path::Path;
use std::process::Output;

use serde::Serialize;

use super::{diagnostics::Diagnostic, history, refs};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    commit: history::Commit,
    files: Vec<FileChange>,
    refs: Vec<String>,
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
}

#[derive(Clone, Copy, Debug, Default)]
struct FileStats {
    binary: bool,
    insertions: u64,
    deletions: u64,
}

#[derive(Clone, Debug)]
struct RawChange {
    path: Vec<u8>,
    previous_path: Option<Vec<u8>>,
    change: ChangeType,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadDetailError {
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<Self>, Diagnostic),
    CommitEncoding,
    RefEncoding,
    PathEncoding,
    NotFound,
    GitFailed,
    MalformedOutput,
}

pub fn read(path: &Path, sha: &str) -> Result<CommitDetails, ReadDetailError> {
    let repo = gix::open(path).map_err(|error| {
        ReadDetailError::Diagnostic(Diagnostic::cause("commit.openRepository", &error))
    })?;
    let id = gix::ObjectId::from_hex(sha.as_bytes()).map_err(|error| {
        ReadDetailError::WithDiagnostic(
            Box::new(ReadDetailError::NotFound),
            Diagnostic::new("commit.validateObjectId", error),
        )
    })?;
    let object = repo.find_commit(id).map_err(|error| {
        ReadDetailError::WithDiagnostic(
            Box::new(ReadDetailError::NotFound),
            Diagnostic::cause("commit.findObject", &error),
        )
    })?;
    let parent = object
        .decode()
        .map_err(|error| {
            ReadDetailError::Diagnostic(Diagnostic::cause("commit.decodeObject", &error))
        })?
        .parents()
        .next();
    let commit = history::read_commit(&repo, id).map_err(map_history_error)?;
    let files = if is_stash(path, sha)? {
        read_stash_files(path, sha)?
    } else {
        read_files(
            path,
            sha,
            parent.as_ref().map(ToString::to_string).as_deref(),
        )?
    };
    let refs = refs::names_at(path, id).map_err(|error| match error {
        refs::ReadRefsError::InvalidEncoding => ReadDetailError::RefEncoding,
        refs::ReadRefsError::GitFailed(diagnostic) => ReadDetailError::Diagnostic(diagnostic),
        error => ReadDetailError::Diagnostic(Diagnostic::new("commit.readReferences", error)),
    })?;
    Ok(CommitDetails {
        commit,
        files,
        refs,
    })
}

fn map_history_error(error: history::ReadHistoryError) -> ReadDetailError {
    match error {
        history::ReadHistoryError::InvalidEncoding => ReadDetailError::CommitEncoding,
        history::ReadHistoryError::StartNotFound => ReadDetailError::NotFound,
        history::ReadHistoryError::Diagnostic(diagnostic) => {
            ReadDetailError::Diagnostic(diagnostic)
        }
        history::ReadHistoryError::WithDiagnostic(error, diagnostic) => {
            ReadDetailError::WithDiagnostic(Box::new(map_history_error(*error)), diagnostic)
        }
        history::ReadHistoryError::Cancelled => ReadDetailError::GitFailed,
    }
}

fn is_stash(repository: &Path, sha: &str) -> Result<bool, ReadDetailError> {
    let output = git(repository, &["stash", "list", "--format=%H"])?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|candidate| candidate == sha))
}

fn read_stash_files(repository: &Path, sha: &str) -> Result<Vec<FileChange>, ReadDetailError> {
    let raw = stash_diff_output(repository, sha, "--raw")?;
    let stats = stash_diff_output(repository, sha, "--numstat")?;
    let stats = parse_numstat(&stats.stdout)
        .map_err(|error| parse_error("commit.parseFileStatistics", error))?;
    parse_raw(&raw.stdout)
        .map_err(|error| parse_error("commit.parseFileChanges", error))?
        .into_iter()
        .map(|entry| {
            let file_stats = stats.get(&entry.path).copied().unwrap_or_default();
            Ok(FileChange {
                path: strict_path(&entry.path)?,
                previous_path: entry
                    .previous_path
                    .as_deref()
                    .map(strict_path)
                    .transpose()?,
                change: entry.change,
                binary: file_stats.binary,
                insertions: file_stats.insertions,
                deletions: file_stats.deletions,
            })
        })
        .collect()
}

fn stash_diff_output(
    repository: &Path,
    sha: &str,
    format: &str,
) -> Result<Output, ReadDetailError> {
    let mut args = vec![
        "stash",
        "show",
        format,
        "-z",
        "--include-untracked",
        "--format=",
    ];
    if format == "--raw" {
        args.push("--abbrev=64");
    }
    args.push(sha);
    git(repository, &args)
}

fn read_files(
    repository: &Path,
    sha: &str,
    parent: Option<&str>,
) -> Result<Vec<FileChange>, ReadDetailError> {
    let raw = diff_output(repository, parent, sha, "--raw")?;
    let stats = diff_output(repository, parent, sha, "--numstat")?;
    let stats = parse_numstat(&stats.stdout)
        .map_err(|error| parse_error("commit.parseFileStatistics", error))?;
    parse_raw(&raw.stdout)
        .map_err(|error| parse_error("commit.parseFileChanges", error))?
        .into_iter()
        .map(|entry| {
            let file_stats = stats.get(&entry.path).copied().unwrap_or_default();
            Ok(FileChange {
                path: strict_path(&entry.path)?,
                previous_path: entry
                    .previous_path
                    .as_deref()
                    .map(strict_path)
                    .transpose()?,
                change: entry.change,
                binary: file_stats.binary,
                insertions: file_stats.insertions,
                deletions: file_stats.deletions,
            })
        })
        .collect()
}

fn diff_output(
    repository: &Path,
    parent: Option<&str>,
    sha: &str,
    format: &str,
) -> Result<Output, ReadDetailError> {
    let mut args = if let Some(parent) = parent {
        vec![
            "diff",
            format,
            "-z",
            "--find-renames",
            "--find-copies",
            parent,
            sha,
        ]
    } else {
        vec![
            "diff-tree",
            "--root",
            "-r",
            "--no-commit-id",
            format,
            "-z",
            "--find-renames",
            "--find-copies",
            sha,
        ]
    };
    if format == "--raw" {
        args.insert(2, "--abbrev=64");
    }
    args.push("--");
    git(repository, &args)
}

fn parse_error(stage: &str, error: ReadDetailError) -> ReadDetailError {
    match error {
        ReadDetailError::MalformedOutput => ReadDetailError::WithDiagnostic(
            Box::new(ReadDetailError::MalformedOutput),
            Diagnostic::new(stage, "Git returned malformed structured output"),
        ),
        error => error,
    }
}

fn parse_raw(bytes: &[u8]) -> Result<Vec<RawChange>, ReadDetailError> {
    let fields = nul_fields(bytes);
    let mut result = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let header = fields[index];
        index += 1;
        if header.first() != Some(&b':') {
            return Err(ReadDetailError::MalformedOutput);
        }
        let parts = header[1..].split(|byte| *byte == b' ').collect::<Vec<_>>();
        if parts.len() != 5 {
            return Err(ReadDetailError::MalformedOutput);
        }
        let code = *parts[4].first().ok_or(ReadDetailError::MalformedOutput)?;
        let first_path = fields
            .get(index)
            .ok_or(ReadDetailError::MalformedOutput)?
            .to_vec();
        index += 1;
        let (previous_path, path) = if matches!(code, b'R' | b'C') {
            let destination = fields
                .get(index)
                .ok_or(ReadDetailError::MalformedOutput)?
                .to_vec();
            index += 1;
            (Some(first_path), destination)
        } else {
            (None, first_path)
        };
        result.push(RawChange {
            path,
            previous_path,
            change: change_type(code)?,
        });
    }
    Ok(result)
}

fn parse_numstat(bytes: &[u8]) -> Result<HashMap<Vec<u8>, FileStats>, ReadDetailError> {
    let fields = nul_fields(bytes);
    let mut result = HashMap::new();
    let mut index = 0;
    while index < fields.len() {
        let header = fields[index];
        index += 1;
        let mut parts = header.splitn(3, |byte| *byte == b'\t');
        let added = parts.next().ok_or(ReadDetailError::MalformedOutput)?;
        let deleted = parts.next().ok_or(ReadDetailError::MalformedOutput)?;
        let inline_path = parts.next().ok_or(ReadDetailError::MalformedOutput)?;
        let path = if inline_path.is_empty() {
            let _source = fields.get(index).ok_or(ReadDetailError::MalformedOutput)?;
            let destination = fields
                .get(index + 1)
                .ok_or(ReadDetailError::MalformedOutput)?;
            index += 2;
            *destination
        } else {
            inline_path
        };
        let binary = added == b"-" && deleted == b"-";
        result.insert(
            path.to_vec(),
            if binary {
                FileStats {
                    binary: true,
                    ..FileStats::default()
                }
            } else {
                FileStats {
                    binary: false,
                    insertions: number(added)?,
                    deletions: number(deleted)?,
                }
            },
        );
    }
    Ok(result)
}

fn change_type(code: u8) -> Result<ChangeType, ReadDetailError> {
    match code {
        b'A' => Ok(ChangeType::Added),
        b'M' => Ok(ChangeType::Modified),
        b'D' => Ok(ChangeType::Deleted),
        b'R' => Ok(ChangeType::Renamed),
        b'C' => Ok(ChangeType::Copied),
        b'T' => Ok(ChangeType::TypeChanged),
        _ => Err(ReadDetailError::MalformedOutput),
    }
}

fn number(bytes: &[u8]) -> Result<u64, ReadDetailError> {
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or(ReadDetailError::MalformedOutput)
}

fn strict_path(bytes: &[u8]) -> Result<String, ReadDetailError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| ReadDetailError::PathEncoding)
}

fn nul_fields(bytes: &[u8]) -> Vec<&[u8]> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect()
}

fn git(repository: &Path, args: &[&str]) -> Result<Output, ReadDetailError> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            ReadDetailError::Diagnostic(Diagnostic::command_io("commit.command", args, &error))
        })?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(ReadDetailError::Diagnostic(Diagnostic::command(
            "commit.command",
            args,
            &output,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs;
    use std::process::{Command, Stdio};

    fn git_ok(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Autora")
            .env("GIT_AUTHOR_EMAIL", "autora@example.com")
            .env("GIT_COMMITTER_NAME", "Comitter")
            .env("GIT_COMMITTER_EMAIL", "committer@example.com")
            .stdin(Stdio::null())
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
    fn lee_root_refs_renombre_y_binario_con_estadisticas_exactas() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("base.txt"), "uno\n").unwrap();
        let root = commit(path, "raíz");
        git_ok(path, &["tag", "v1", &root]);
        let details = read(path, &root).unwrap();
        assert_eq!(details.commit.sha, root);
        assert_eq!(details.refs, ["main", "v1"]);
        assert_eq!(details.files[0].change, ChangeType::Added);
        assert_eq!(
            (details.files[0].insertions, details.files[0].deletions),
            (1, 0)
        );

        git_ok(path, &["mv", "base.txt", "nuevo nombre.txt"]);
        fs::write(path.join("asset.bin"), [0, 1, 2]).unwrap();
        let second = commit(path, "cambios");
        git_ok(path, &["branch", "lateral", &second]);
        let details = read(path, &second).unwrap();
        assert!(details.refs.contains(&"lateral".to_owned()));
        assert!(details.files.iter().any(|file| {
            file.path == "nuevo nombre.txt"
                && file.previous_path.as_deref() == Some("base.txt")
                && file.change == ChangeType::Renamed
        }));
        assert!(details
            .files
            .iter()
            .any(|file| file.path == "asset.bin" && file.binary));
    }

    #[test]
    fn un_merge_se_compara_solo_con_su_primer_padre() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("base.txt"), "base\n").unwrap();
        commit(path, "base");
        git_ok(path, &["switch", "--quiet", "-c", "lateral"]);
        fs::write(path.join("lado.txt"), "lado\n").unwrap();
        commit(path, "lado");
        git_ok(path, &["switch", "--quiet", "main"]);
        fs::write(path.join("main.txt"), "main\n").unwrap();
        commit(path, "main");
        git_ok(
            path,
            &["merge", "--quiet", "--no-ff", "lateral", "-m", "fusión"],
        );
        let merge = git_ok(path, &["rev-parse", "HEAD"]);
        let details = read(path, &merge).unwrap();
        assert_eq!(details.commit.parents.len(), 2);
        assert_eq!(
            details
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["lado.txt"]
        );
    }

    #[test]
    fn un_stash_incluye_cambios_del_indice_arbol_y_no_seguidos() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("seguido.txt"), "base\n").unwrap();
        commit(path, "base");
        fs::write(path.join("seguido.txt"), "preparado\n").unwrap();
        git_ok(path, &["add", "seguido.txt"]);
        fs::write(path.join("seguido.txt"), "sin preparar\n").unwrap();
        fs::write(path.join("nuevo.txt"), "nuevo\n").unwrap();
        git_ok(
            path,
            &["stash", "push", "--include-untracked", "-m", "guardado"],
        );
        let stash = git_ok(path, &["rev-parse", "refs/stash"]);

        let details = read(path, &stash).unwrap();
        let files = details
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<BTreeSet<_>>();

        assert_eq!(files, BTreeSet::from(["nuevo.txt", "seguido.txt"]));
    }

    #[test]
    fn distingue_commit_inexistente() {
        let temporary = repository();
        assert!(matches!(
            read(temporary.path(), &"f".repeat(40)).unwrap_err(),
            ReadDetailError::WithDiagnostic(error, _) if *error == ReadDetailError::NotFound
        ));
    }

    #[cfg(unix)]
    #[test]
    fn conserva_rutas_con_salto() {
        let temporary = repository();
        let path = temporary.path();
        fs::write(path.join("línea\nnueva.txt"), "contenido\n").unwrap();
        let valid = commit(path, "ruta literal");
        let details = read(path, &valid).unwrap();
        assert_eq!(details.files[0].path, "línea\nnueva.txt");
    }

    #[test]
    fn rejects_non_utf8_path_bytes_on_every_platform() {
        assert_eq!(
            super::strict_path(b"invalid-\xff.txt"),
            Err(ReadDetailError::PathEncoding)
        );
    }

    // APFS/HFS+ reject this filename before Git can create the fixture.
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn rechaza_rutas_no_utf8() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let temporary = repository();
        let path = temporary.path();
        fs::write(
            path.join(OsString::from_vec(b"invalido-\xff.txt".to_vec())),
            "contenido\n",
        )
        .unwrap();
        let invalid = commit(path, "ruta no utf8");
        assert_eq!(
            read(path, &invalid).unwrap_err(),
            ReadDetailError::PathEncoding
        );
    }
    #[test]
    fn malformed_commit_diagnostics_preserve_the_parser_cause_without_commit_contents() {
        use std::io::Write;
        let temporary = repository();
        let mut child = Command::new("git")
            .args([
                "hash-object",
                "--literally",
                "-t",
                "commit",
                "-w",
                "--stdin",
            ])
            .current_dir(temporary.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                b"private malformed commit contents
",
            )
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let sha = String::from_utf8(output.stdout).unwrap().trim().to_owned();
        let error = read(temporary.path(), &sha).unwrap_err();
        let ReadDetailError::Diagnostic(diagnostic) = error else {
            panic!("expected diagnostic, got {error:?}")
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["stage"], "commit.decodeObject");
        assert!(value["causes"][0]
            .as_str()
            .unwrap()
            .contains("parsing failed"));
        assert!(!value
            .to_string()
            .contains("private malformed commit contents"));
    }
}

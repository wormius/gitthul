//! Lectura de las tres etapas de un conflicto directamente desde el índice.

use std::path::Path;
use std::process::Output;

use serde::Serialize;

use super::{encoding, repository};

const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_LINES: usize = 50_000;

#[derive(Debug, PartialEq, Eq)]
pub enum ReadConflictError {
    UnsupportedEncoding(String),
    NotConflicted,
    InvalidPathEncoding,
    GitFailed,
    MalformedOutput,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictContents {
    encoding: &'static str,
    detected_encoding: &'static str,
    decoding_errors: bool,
    revision: String,
    path: String,
    kind: ConflictKind,
    base: Option<String>,
    ours: Option<String>,
    theirs: Option<String>,
    ours_label: String,
    theirs_label: String,
    sizes: ConflictSizes,
    binary: bool,
    too_large: bool,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct ConflictSizes {
    ours: ConflictSize,
    theirs: ConflictSize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
struct ConflictSize {
    bytes: usize,
    lines: usize,
}

#[cfg(test)]
pub fn read(repository: &Path, path: &str) -> Result<ConflictContents, ReadConflictError> {
    read_encoded(repository, path, None)
}

pub fn read_encoded(
    repository: &Path,
    path: &str,
    requested: Option<&str>,
) -> Result<ConflictContents, ReadConflictError> {
    let stages = read_stages(repository, path)?;
    let kind = conflict_kind(&stages)?;
    let base = read_stage(repository, stages[1].as_deref())?;
    let ours = read_stage(repository, stages[2].as_deref())?;
    let theirs = read_stage(repository, stages[3].as_deref())?;
    let sizes = ConflictSizes {
        ours: size(ours.as_deref()),
        theirs: size(theirs.as_deref()),
    };
    let binary = [&base, &ours, &theirs]
        .into_iter()
        .flatten()
        .any(|contents| encoding::is_binary(contents));
    let too_large = [&base, &ours, &theirs]
        .into_iter()
        .flatten()
        .map(|contents| size(Some(contents)))
        .any(|size| size.bytes > MAX_BYTES || size.lines > MAX_LINES);
    let fallback = stages[3]
        .as_deref()
        .map(short_oid)
        .unwrap_or_else(|| "HEAD".to_owned());
    let (ours_label, theirs_label) =
        repository::conflict_labels(repository).unwrap_or_else(|| ("HEAD".to_owned(), fallback));

    let preferred = ours
        .as_deref()
        .or(theirs.as_deref())
        .or(base.as_deref())
        .unwrap_or_default();
    let detected_encoding = encoding::detect(&preferred[..preferred.len().min(8192)]);
    let encoding = match requested.filter(|name| *name != "auto") {
        Some(name) => encoding::canonical(name)
            .ok_or_else(|| ReadConflictError::UnsupportedEncoding(name.to_owned()))?,
        None => detected_encoding,
    };
    let decode = |bytes: Option<Vec<u8>>| -> Result<Option<encoding::Decoded>, ReadConflictError> {
        if binary || too_large {
            return Ok(None);
        }
        bytes
            .map(|bytes| {
                encoding::decode(&bytes, requested).map_err(ReadConflictError::UnsupportedEncoding)
            })
            .transpose()
    };
    let base = decode(base)?;
    let ours = decode(ours)?;
    let theirs = decode(theirs)?;
    let preferred = ours.as_ref().or(theirs.as_ref()).or(base.as_ref());
    let encoding = preferred.map_or(encoding, |decoded| decoded.encoding);
    let detected_encoding = preferred.map_or(detected_encoding, |decoded| decoded.detected);
    let decoding_errors = [&base, &ours, &theirs]
        .into_iter()
        .flatten()
        .any(|text| text.errors);
    Ok(ConflictContents {
        encoding,
        detected_encoding,
        decoding_errors,
        revision: stage_revision(&stages),
        path: path.to_owned(),
        kind,
        base: base.map(|decoded| decoded.text),
        ours: ours.map(|decoded| decoded.text),
        theirs: theirs.map(|decoded| decoded.text),
        ours_label,
        theirs_label,
        sizes,
        binary,
        too_large,
    })
}

fn stage_revision(stages: &[Option<String>; 4]) -> String {
    stages[1..]
        .iter()
        .map(|stage| stage.as_deref().unwrap_or("-"))
        .collect::<Vec<_>>()
        .join(":")
}

pub fn revision(repository: &Path, path: &str) -> Result<String, ReadConflictError> {
    read_stages(repository, path).map(|stages| stage_revision(&stages))
}

fn read_stages(
    repository: &Path,
    requested_path: &str,
) -> Result<[Option<String>; 4], ReadConflictError> {
    let output = git_output(
        repository,
        &["ls-files", "--unmerged", "-z", "--", requested_path],
    )?;
    let mut stages: [Option<String>; 4] = Default::default();
    for record in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|row| !row.is_empty())
    {
        let separator = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or(ReadConflictError::MalformedOutput)?;
        let (header, path) = record.split_at(separator);
        let path = &path[1..];
        let path = std::str::from_utf8(path).map_err(|_| ReadConflictError::InvalidPathEncoding)?;
        if path != requested_path {
            return Err(ReadConflictError::MalformedOutput);
        }
        let mut fields = header.split(|byte| *byte == b' ');
        let _mode = fields.next().ok_or(ReadConflictError::MalformedOutput)?;
        let oid = fields.next().ok_or(ReadConflictError::MalformedOutput)?;
        let stage = fields
            .next()
            .and_then(|stage| std::str::from_utf8(stage).ok())
            .and_then(|stage| stage.parse::<usize>().ok())
            .filter(|stage| (1..=3).contains(stage))
            .ok_or(ReadConflictError::MalformedOutput)?;
        if fields.next().is_some() || stages[stage].is_some() {
            return Err(ReadConflictError::MalformedOutput);
        }
        stages[stage] = Some(
            std::str::from_utf8(oid)
                .map_err(|_| ReadConflictError::MalformedOutput)?
                .to_owned(),
        );
    }
    if stages.iter().skip(1).all(Option::is_none) {
        Err(ReadConflictError::NotConflicted)
    } else {
        Ok(stages)
    }
}

fn read_stage(repository: &Path, oid: Option<&str>) -> Result<Option<Vec<u8>>, ReadConflictError> {
    let Some(oid) = oid else {
        return Ok(None);
    };
    Ok(Some(
        git_output(repository, &["cat-file", "blob", oid])?.stdout,
    ))
}

fn conflict_kind(stages: &[Option<String>; 4]) -> Result<ConflictKind, ReadConflictError> {
    match (
        stages[1].is_some(),
        stages[2].is_some(),
        stages[3].is_some(),
    ) {
        (true, true, true) => Ok(ConflictKind::BothModified),
        (false, true, true) => Ok(ConflictKind::BothAdded),
        (true, false, false) => Ok(ConflictKind::BothDeleted),
        (true, false, true) => Ok(ConflictKind::DeletedByUs),
        (true, true, false) => Ok(ConflictKind::DeletedByThem),
        (false, true, false) => Ok(ConflictKind::AddedByUs),
        (false, false, true) => Ok(ConflictKind::AddedByThem),
        (false, false, false) => Err(ReadConflictError::NotConflicted),
    }
}

fn size(contents: Option<&[u8]>) -> ConflictSize {
    let Some(contents) = contents else {
        return ConflictSize::default();
    };
    ConflictSize {
        bytes: contents.len(),
        lines: contents.iter().filter(|byte| **byte == b'\n').count() + 1,
    }
}

fn short_oid(oid: &str) -> String {
    oid.chars().take(8).collect()
}

fn git_output(repository: &Path, args: &[&str]) -> Result<Output, ReadConflictError> {
    let output = crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| ReadConflictError::GitFailed)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(ReadConflictError::GitFailed)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{conflict_kind, read, ConflictKind, ReadConflictError, MAX_BYTES};

    fn git(directory: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(directory)
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

    fn conflicted(contents: (&[u8], &[u8], &[u8])) -> (TempDir, String) {
        let temporary = TempDir::new().unwrap();
        let path = "dir/archivo con espacio.txt";
        fs::create_dir(temporary.path().join("dir")).unwrap();
        assert!(git(temporary.path(), &["init", "--initial-branch=main"]));
        fs::write(temporary.path().join(path), contents.0).unwrap();
        assert!(git(temporary.path(), &["add", "--", path]));
        assert!(git(temporary.path(), &["commit", "-m", "base"]));
        assert!(git(temporary.path(), &["switch", "-c", "tema"]));
        fs::write(temporary.path().join(path), contents.1).unwrap();
        assert!(git(temporary.path(), &["commit", "-am", "tema"]));
        assert!(git(temporary.path(), &["switch", "main"]));
        fs::write(temporary.path().join(path), contents.2).unwrap();
        assert!(git(temporary.path(), &["commit", "-am", "main"]));
        assert!(!git(temporary.path(), &["merge", "tema"]));
        (temporary, path.to_owned())
    }

    #[test]
    fn legacy_conflicts_are_text_and_can_be_reinterpreted() {
        let (repository, path) =
            conflicted((b"caf\xe9 base\n", b"caf\xe9 theirs\n", b"caf\xe9 ours\n"));
        let correct = super::read_encoded(repository.path(), &path, Some("windows-1252")).unwrap();
        assert!(!correct.binary);
        assert!(!correct.decoding_errors);
        assert_eq!(correct.ours.as_deref(), Some("café ours\n"));
        let invalid = super::read_encoded(repository.path(), &path, Some("utf-8")).unwrap();
        assert!(!invalid.binary);
        assert!(invalid.decoding_errors);
        assert_eq!(invalid.ours.as_deref(), Some("caf� ours\n"));
        assert_eq!(correct.revision, invalid.revision);
    }

    #[test]
    fn lee_las_tres_etapas_y_etiqueta_la_operacion_real() {
        let (repository, path) = conflicted((b"base\n", b"tema\n", b"main\n"));
        let conflict = read(repository.path(), &path).unwrap();

        assert_eq!(conflict.kind, ConflictKind::BothModified);
        assert_eq!(conflict.path, path);
        assert_eq!(conflict.base.as_deref(), Some("base\n"));
        assert_eq!(conflict.ours.as_deref(), Some("main\n"));
        assert_eq!(conflict.theirs.as_deref(), Some("tema\n"));
        assert_eq!(conflict.ours_label, "main");
        assert_eq!(conflict.sizes.ours.bytes, 5);
        assert!(!conflict.binary);
        assert!(!conflict.too_large);
    }

    #[test]
    fn binarios_y_archivos_grandes_no_cruzan_como_texto() {
        let (repository, path) = conflicted((&[0, 1], &[0, 2], &[0, 3]));
        let conflict = read(repository.path(), &path).unwrap();
        assert!(conflict.binary);
        assert_eq!(conflict.ours, None);
        assert_eq!(conflict.theirs, None);

        let oversized = vec![b'x'; MAX_BYTES + 1];
        let (repository, path) = conflicted((b"base", &oversized, b"main"));
        let conflict = read(repository.path(), &path).unwrap();
        assert!(conflict.too_large);
        assert_eq!(conflict.base, None);
        assert_eq!(conflict.ours, None);
        assert_eq!(conflict.theirs, None);
    }

    #[test]
    fn reconoce_los_siete_mapas_de_etapas_y_una_ruta_que_ya_no_esta_en_conflicto() {
        let oid = || Some("a".repeat(40));
        for (stages, expected) in [
            ([None, oid(), oid(), oid()], ConflictKind::BothModified),
            ([None, None, oid(), oid()], ConflictKind::BothAdded),
            ([None, oid(), None, None], ConflictKind::BothDeleted),
            ([None, oid(), None, oid()], ConflictKind::DeletedByUs),
            ([None, oid(), oid(), None], ConflictKind::DeletedByThem),
            ([None, None, oid(), None], ConflictKind::AddedByUs),
            ([None, None, None, oid()], ConflictKind::AddedByThem),
        ] {
            assert_eq!(conflict_kind(&stages), Ok(expected));
        }

        let repository = TempDir::new().unwrap();
        assert!(git(repository.path(), &["init", "--initial-branch=main"]));
        assert_eq!(
            read(repository.path(), "ausente.txt"),
            Err(ReadConflictError::NotConflicted)
        );
    }
}

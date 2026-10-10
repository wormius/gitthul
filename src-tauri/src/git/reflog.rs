//! Lectura del reflog de HEAD y recuperación no destructiva mediante una rama.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use super::ref_write::{self, CreateBranchOptions, RefTarget, WriteRefError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    selector: String,
    sha: String,
    at: i64,
    summary: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReflogError {
    InvalidEncoding,
    MalformedOutput,
    GitFailed(String),
    Stale,
    Write(WriteRefError),
}

pub fn read(repository: &Path) -> Result<Vec<ReflogEntry>, ReflogError> {
    let output = Command::new("git")
        .current_dir(repository)
        .env("LC_ALL", "C")
        .args([
            "reflog",
            "show",
            "--max-count=100",
            "--format=%gD%x00%H%x00%ct%x00%gs%x00",
            "HEAD",
        ])
        .output()
        .map_err(|error| ReflogError::GitFailed(error.to_string()))?;

    if !output.status.success() {
        return Err(ReflogError::GitFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }

    output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter(|record| !record.is_empty())
        .map(parse_record)
        .collect()
}

fn parse_record(record: &[u8]) -> Result<ReflogEntry, ReflogError> {
    let fields = record.split(|byte| *byte == 0).collect::<Vec<_>>();
    if fields.len() != 5 || !fields[4].is_empty() {
        return Err(ReflogError::MalformedOutput);
    }

    let text = |field: &[u8]| {
        std::str::from_utf8(field)
            .map(str::to_owned)
            .map_err(|_| ReflogError::InvalidEncoding)
    };
    let at = text(fields[2])?
        .parse::<i64>()
        .map_err(|_| ReflogError::MalformedOutput)?
        .saturating_mul(1000);

    Ok(ReflogEntry {
        selector: text(fields[0])?,
        sha: text(fields[1])?,
        at,
        summary: text(fields[3])?,
    })
}

pub fn recover(
    repository: &Path,
    name: &str,
    selector: &str,
    expected_sha: &str,
) -> Result<(), ReflogError> {
    if !valid_head_selector(selector) {
        return Err(ReflogError::Stale);
    }

    let revision = format!("{selector}^{{commit}}");
    let output = Command::new("git")
        .current_dir(repository)
        .env("LC_ALL", "C")
        .args(["rev-parse", "--verify", "--end-of-options", &revision])
        .output()
        .map_err(|error| ReflogError::GitFailed(error.to_string()))?;
    let actual = std::str::from_utf8(&output.stdout)
        .map_err(|_| ReflogError::InvalidEncoding)?
        .trim();
    if !output.status.success() || actual != expected_sha {
        return Err(ReflogError::Stale);
    }

    ref_write::create_branch(
        repository,
        name,
        &RefTarget::Commit {
            sha: expected_sha.to_owned(),
        },
        &CreateBranchOptions::default(),
    )
    .map_err(ReflogError::Write)
}

fn valid_head_selector(selector: &str) -> bool {
    selector
        .strip_prefix("HEAD@{")
        .and_then(|rest| rest.strip_suffix('}'))
        .is_some_and(|index| !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn git(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .args(args)
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
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        git(temporary.path(), &["config", "user.name", "Autora"]);
        git(
            temporary.path(),
            &["config", "user.email", "autora@example.com"],
        );
        fs::write(temporary.path().join("archivo.txt"), "uno\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "primero"]);
        fs::write(temporary.path().join("archivo.txt"), "dos\n").unwrap();
        git(temporary.path(), &["commit", "--quiet", "-am", "segundo"]);
        temporary
    }

    #[test]
    fn selector_accepts_only_head_indices() {
        assert!(valid_head_selector("HEAD@{0}"));
        assert!(valid_head_selector("HEAD@{12}"));
        assert!(!valid_head_selector("main@{0}"));
        assert!(!valid_head_selector("HEAD@{-1}"));
        assert!(!valid_head_selector("--help"));
    }

    #[test]
    fn lee_head_y_recupera_en_rama_sin_mover_nada_mas() {
        let temporary = repository();
        let entries = read(temporary.path()).unwrap();
        let previous = entries
            .iter()
            .find(|entry| entry.selector == "HEAD@{1}")
            .unwrap();
        let head_before = git(temporary.path(), &["rev-parse", "HEAD"]);
        let status_before = git(temporary.path(), &["status", "--porcelain=v1"]);

        recover(
            temporary.path(),
            "recuperada",
            &previous.selector,
            &previous.sha,
        )
        .unwrap();

        assert_eq!(git(temporary.path(), &["rev-parse", "HEAD"]), head_before);
        assert_eq!(
            git(temporary.path(), &["status", "--porcelain=v1"]),
            status_before
        );
        assert_eq!(
            git(temporary.path(), &["rev-parse", "recuperada"]),
            previous.sha
        );
        assert_eq!(git(temporary.path(), &["branch", "--show-current"]), "main");
    }

    #[test]
    fn rechaza_un_selector_que_se_movio_antes_de_escribir() {
        let temporary = repository();
        let observed = read(temporary.path()).unwrap().remove(0);
        fs::write(temporary.path().join("archivo.txt"), "tres\n").unwrap();
        git(temporary.path(), &["commit", "--quiet", "-am", "tercero"]);

        assert_eq!(
            recover(
                temporary.path(),
                "no-debe-existir",
                &observed.selector,
                &observed.sha,
            ),
            Err(ReflogError::Stale)
        );
        let missing = Command::new("git")
            .current_dir(temporary.path())
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                "refs/heads/no-debe-existir",
            ])
            .status()
            .unwrap();
        assert!(!missing.success());
    }
}

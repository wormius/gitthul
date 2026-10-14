//! Administración de remotos con precondiciones sobre la vista segura que leyó la interfaz.

use std::path::Path;
use std::process::Output;

use serde::Deserialize;

use super::diagnostics::Diagnostic;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInput {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePrecondition {
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WriteRemoteError {
    InvalidName,
    InvalidUrl,
    Exists,
    NotFound,
    Stale,
    Diagnostic(Diagnostic),
}

#[derive(Debug, PartialEq, Eq)]
struct ObservedRemote {
    fetch_url: String,
    push_url: String,
}

pub fn add(repository: &Path, remote: &RemoteInput) -> Result<(), WriteRemoteError> {
    validate_name(repository, &remote.name)?;
    validate_url(&remote.fetch_url)?;
    validate_url(&remote.push_url)?;
    if observe(repository, &remote.name)?.is_some() {
        return Err(WriteRemoteError::Exists);
    }

    let output = command(
        repository,
        &["remote", "add", "--", &remote.name, &remote.fetch_url],
    )?;
    if !output.status.success() {
        return if observe(repository, &remote.name)?.is_some() {
            Err(WriteRemoteError::Exists)
        } else {
            Err(WriteRemoteError::Diagnostic(Diagnostic::command(
                "remoteWrite.add",
                &["remote", "add"],
                &output,
            )))
        };
    }
    if remote.push_url != remote.fetch_url {
        let output = command(
            repository,
            &[
                "remote",
                "set-url",
                "--push",
                "--",
                &remote.name,
                &remote.push_url,
            ],
        )?;
        if !output.status.success() {
            let _ = command(repository, &["remote", "remove", "--", &remote.name]);
            return Err(WriteRemoteError::Diagnostic(Diagnostic::command(
                "remoteWrite.setPushUrl",
                &["remote", "set-url", "--push"],
                &output,
            )));
        }
    }
    Ok(())
}

pub fn update(
    repository: &Path,
    current_name: &str,
    remote: &RemoteInput,
    expected: &RemotePrecondition,
) -> Result<(), WriteRemoteError> {
    validate_name(repository, &remote.name)?;
    validate_url(&remote.fetch_url)?;
    validate_url(&remote.push_url)?;
    ensure_current(repository, current_name, expected)?;
    if remote.name != current_name && observe(repository, &remote.name)?.is_some() {
        return Err(WriteRemoteError::Exists);
    }

    if remote.name != current_name {
        successful(
            repository,
            &["remote", "rename", "--", current_name, &remote.name],
        )?;
    }
    successful(
        repository,
        &["remote", "set-url", "--", &remote.name, &remote.fetch_url],
    )?;
    successful(
        repository,
        &[
            "remote",
            "set-url",
            "--push",
            "--",
            &remote.name,
            &remote.push_url,
        ],
    )?;
    Ok(())
}

pub fn remove(
    repository: &Path,
    name: &str,
    expected: &RemotePrecondition,
) -> Result<(), WriteRemoteError> {
    ensure_current(repository, name, expected)?;
    successful(repository, &["remote", "remove", "--", name])
}

fn ensure_current(
    repository: &Path,
    name: &str,
    expected: &RemotePrecondition,
) -> Result<(), WriteRemoteError> {
    let Some(observed) = observe(repository, name)? else {
        return Err(WriteRemoteError::NotFound);
    };
    if observed.fetch_url != expected.fetch_url || observed.push_url != expected.push_url {
        return Err(WriteRemoteError::Stale);
    }
    Ok(())
}

fn observe(repository: &Path, name: &str) -> Result<Option<ObservedRemote>, WriteRemoteError> {
    let repo = gix::open(repository).map_err(|error| {
        WriteRemoteError::Diagnostic(Diagnostic::cause("remoteWrite.open", &error))
    })?;
    let Ok(remote) = repo.find_remote(name) else {
        return Ok(None);
    };
    let Some(fetch) = remote.url(gix::remote::Direction::Fetch) else {
        return Err(WriteRemoteError::Diagnostic(Diagnostic::new(
            "remoteWrite.readUrl",
            "Remote has no fetch URL",
        )));
    };
    let fetch_url = fetch.to_string();
    let push_url = remote
        .url(gix::remote::Direction::Push)
        .map(ToString::to_string)
        .unwrap_or_else(|| fetch_url.clone());
    Ok(Some(ObservedRemote {
        fetch_url,
        push_url,
    }))
}

fn validate_name(repository: &Path, name: &str) -> Result<(), WriteRemoteError> {
    if name.is_empty() {
        return Err(WriteRemoteError::InvalidName);
    }
    let reference = format!("refs/remotes/{name}/placeholder");
    let output = command(repository, &["check-ref-format", &reference])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WriteRemoteError::InvalidName)
    }
}

fn validate_url(url: &str) -> Result<(), WriteRemoteError> {
    if url.is_empty() || url.chars().any(char::is_control) {
        Err(WriteRemoteError::InvalidUrl)
    } else {
        Ok(())
    }
}

fn successful(repository: &Path, args: &[&str]) -> Result<(), WriteRemoteError> {
    let output = command(repository, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WriteRemoteError::Diagnostic(Diagnostic::command(
            "remoteWrite.execute",
            args,
            &output,
        )))
    }
}

fn command(repository: &Path, args: &[&str]) -> Result<Output, WriteRemoteError> {
    crate::process::command("git")
        .args(args)
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            WriteRemoteError::Diagnostic(Diagnostic::command_io("remoteWrite.spawn", args, &error))
        })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{add, observe, remove, update, RemoteInput, RemotePrecondition, WriteRemoteError};

    fn git(directory: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(directory)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("LC_ALL", "C")
            .output()
            .unwrap();
        assert!(output.status.success(), "git {:?} falló", args);
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    use std::path::Path;

    fn repository() -> TempDir {
        let temporary = TempDir::new().unwrap();
        git(temporary.path(), &["init", "--quiet"]);
        temporary
    }

    fn input(name: &str, fetch_url: &str, push_url: &str) -> RemoteInput {
        RemoteInput {
            name: name.to_owned(),
            fetch_url: fetch_url.to_owned(),
            push_url: push_url.to_owned(),
        }
    }

    fn expected(fetch_url: &str, push_url: &str) -> RemotePrecondition {
        RemotePrecondition {
            fetch_url: fetch_url.to_owned(),
            push_url: push_url.to_owned(),
        }
    }

    #[test]
    fn adds_a_remote_with_distinct_fetch_and_push_urls() {
        let temporary = repository();
        add(
            temporary.path(),
            &input(
                "origin",
                "https://example.test/read.git",
                "ssh://example.test/write.git",
            ),
        )
        .unwrap();

        assert_eq!(
            observe(temporary.path(), "origin").unwrap().unwrap(),
            super::ObservedRemote {
                fetch_url: "https://example.test/read.git".to_owned(),
                push_url: "ssh://example.test/write.git".to_owned(),
            }
        );
    }

    #[test]
    fn renames_and_edits_a_remote_after_matching_the_observed_urls() {
        let temporary = repository();
        add(
            temporary.path(),
            &input(
                "origin",
                "https://example.test/old.git",
                "https://example.test/old.git",
            ),
        )
        .unwrap();

        update(
            temporary.path(),
            "origin",
            &input(
                "upstream",
                "https://example.test/new.git",
                "ssh://example.test/new.git",
            ),
            &expected(
                "https://example.test/old.git",
                "https://example.test/old.git",
            ),
        )
        .unwrap();

        assert!(observe(temporary.path(), "origin").unwrap().is_none());
        assert_eq!(
            observe(temporary.path(), "upstream")
                .unwrap()
                .unwrap()
                .fetch_url,
            "https://example.test/new.git"
        );
    }

    #[test]
    fn removes_only_the_remote_that_still_matches() {
        let temporary = repository();
        add(
            temporary.path(),
            &input(
                "origin",
                "https://example.test/repo.git",
                "https://example.test/repo.git",
            ),
        )
        .unwrap();

        remove(
            temporary.path(),
            "origin",
            &expected(
                "https://example.test/repo.git",
                "https://example.test/repo.git",
            ),
        )
        .unwrap();
        assert!(observe(temporary.path(), "origin").unwrap().is_none());
    }

    #[test]
    fn rejects_stale_urls_without_writing() {
        let temporary = repository();
        add(
            temporary.path(),
            &input(
                "origin",
                "https://example.test/repo.git",
                "https://example.test/repo.git",
            ),
        )
        .unwrap();
        git(
            temporary.path(),
            &[
                "remote",
                "set-url",
                "origin",
                "https://example.test/external.git",
            ],
        );

        let error = remove(
            temporary.path(),
            "origin",
            &expected(
                "https://example.test/repo.git",
                "https://example.test/repo.git",
            ),
        )
        .unwrap_err();
        assert_eq!(error, WriteRemoteError::Stale);
        assert!(observe(temporary.path(), "origin").unwrap().is_some());
    }

    #[test]
    fn compares_redacted_urls_without_exposing_the_password() {
        let temporary = repository();
        git(
            temporary.path(),
            &[
                "remote",
                "add",
                "origin",
                "https://alice:secret@example.test/repo.git",
            ],
        );
        let observed = observe(temporary.path(), "origin").unwrap().unwrap();
        assert!(!observed.fetch_url.contains("secret"));

        remove(
            temporary.path(),
            "origin",
            &expected(&observed.fetch_url, &observed.push_url),
        )
        .unwrap();
    }

    #[test]
    fn rejects_invalid_values_and_name_collisions() {
        let temporary = repository();
        assert_eq!(
            add(temporary.path(), &input("bad name", "url", "url")).unwrap_err(),
            WriteRemoteError::InvalidName
        );
        assert_eq!(
            add(temporary.path(), &input("origin", "", "url")).unwrap_err(),
            WriteRemoteError::InvalidUrl
        );
        add(temporary.path(), &input("origin", "one", "one")).unwrap();
        add(temporary.path(), &input("backup", "two", "two")).unwrap();
        assert_eq!(
            update(
                temporary.path(),
                "origin",
                &input("backup", "three", "three"),
                &expected("one", "one"),
            )
            .unwrap_err(),
            WriteRemoteError::Exists
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join(".git/config"))
                .unwrap()
                .matches("[remote")
                .count(),
            2
        );
    }
}

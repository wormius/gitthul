//! Escrituras de red ejecutadas por Git CLI.
//!
//! Git conserva la autoridad sobre protocolos, helpers y configuración. Este
//! módulo solo delimita el proceso, transmite progreso máquina y permite
//! cancelarlo sin guardar URLs ni credenciales en estado paralelo.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::auth::CommandConfig;

#[derive(Clone, Default)]
pub struct NetworkProcesses {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl NetworkProcesses {
    pub fn cancel(&self, operation_id: String) {
        self.cancelled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(operation_id.clone());
        let child = self
            .children
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&operation_id)
            .cloned();
        if let Some(child) = child {
            let _ = child
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .kill();
        }
    }

    fn take_cancelled(&self, operation_id: &str) -> bool {
        self.cancelled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(operation_id)
    }

    fn register(&self, operation_id: &str, child: Arc<Mutex<Child>>) {
        self.children
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(operation_id.to_owned(), child);
    }

    fn finish(&self, operation_id: &str) -> bool {
        self.children
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(operation_id);
        self.take_cancelled(operation_id)
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchOptions {
    prune: Option<bool>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PullStrategy {
    #[default]
    Auto,
    Rebase,
    Merge,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullOptions {
    strategy: Option<PullStrategy>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushOptions {
    remote: Option<String>,
    set_upstream: Option<bool>,
    expected_remote_tip: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    strategy: &'static str,
    reason: &'static str,
    received: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum NetworkError {
    RemoteNotFound(String),
    PullNoUpstream(String),
    PushNoUpstream(String),
    PushRejected {
        branch: String,
        remote: String,
        count: u64,
    },
    PushLeaseStale(String),
    AuthenticationFailed(String),
    Unreachable(String),
    MergeConflict {
        source: String,
        target: String,
        count: u64,
    },
    RebaseConflict {
        source: String,
        target: String,
        sha: String,
        count: u64,
    },
    Cancelled,
    GitFailed,
}

#[cfg(test)]
pub fn fetch(
    repository: &Path,
    remote: Option<&str>,
    options: &FetchOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
) -> Result<(), NetworkError> {
    fetch_configured(
        repository,
        remote,
        options,
        operation_id,
        on_progress,
        processes,
        None,
    )
}

pub fn fetch_configured(
    repository: &Path,
    remote: Option<&str>,
    options: &FetchOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
    credentials: Option<&CommandConfig>,
) -> Result<(), NetworkError> {
    // Fetch each remote separately so an authentication failure identifies the
    // remote whose access must be configured. Preserve Git's skipFetchAll rule.
    if remote.is_none() && credentials.is_some() {
        let names = successful_text(repository, &["remote"])?;
        for name in names.lines() {
            let skip = command_output(
                repository,
                &[
                    "config",
                    "--bool",
                    "--get",
                    &format!("remote.{name}.skipFetchAll"),
                ],
            )?;
            if String::from_utf8_lossy(&skip.stdout).trim() == "true" {
                continue;
            }
            fetch_configured(
                repository,
                Some(name),
                options,
                operation_id,
                on_progress.clone(),
                processes,
                credentials,
            )?;
        }
        return Ok(());
    }
    for attempt in 0..3 {
        let result = fetch_once(
            repository,
            remote,
            options,
            operation_id,
            on_progress.clone(),
            processes,
            credentials,
        );
        if credentials.is_some_and(|config| config.cancelled()) {
            return Err(NetworkError::Cancelled);
        }
        match &result {
            Err(NetworkError::AuthenticationFailed(remote))
                if attempt < 2 && credentials.is_some_and(|config| config.retry_auth(remote)) =>
            {
                continue
            }
            _ => {
                return if credentials.is_some_and(|config| config.cancelled()) {
                    Err(NetworkError::Cancelled)
                } else {
                    result
                }
            }
        }
    }
    Err(NetworkError::AuthenticationFailed("remote".into()))
}

fn fetch_once(
    repository: &Path,
    remote: Option<&str>,
    options: &FetchOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
    credentials: Option<&CommandConfig>,
) -> Result<(), NetworkError> {
    if processes.take_cancelled(operation_id) {
        return Err(NetworkError::Cancelled);
    }
    if let Some(remote) = remote {
        let remotes = command_output(repository, &["remote"])?;
        let exists = String::from_utf8_lossy(&remotes.stdout)
            .lines()
            .any(|known| known == remote);
        if !exists {
            return Err(NetworkError::RemoteNotFound(remote.to_owned()));
        }
    }

    let mut command = git_command();
    if let Some(credentials) = credentials {
        credentials.apply(&mut command);
    }
    command.arg("fetch").arg("--progress");
    if options.prune == Some(true) {
        command.arg("--prune");
    }
    match remote {
        Some(remote) => {
            command.arg("--").arg(remote);
        }
        None => {
            command.arg("--all");
        }
    }
    let mut child = command
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| NetworkError::GitFailed)?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    processes.register(operation_id, child.clone());
    if processes
        .cancelled
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(operation_id)
    {
        let _ = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .kill();
    }

    let reader = thread::spawn(move || {
        let mut captured = Vec::new();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                captured.extend_from_slice(&chunk);
                captured.push(b'\n');
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_transfer_progress(&String::from_utf8_lossy(line))
                    {
                        let _ = on_progress.send(progress);
                    }
                }
            }
        }
        captured
    });

    let status = loop {
        let status = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .try_wait()
            .map_err(|_| NetworkError::GitFailed)?;
        if let Some(status) = status {
            break status;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stderr = reader.join().unwrap_or_default();
    let cancelled = processes.finish(operation_id);
    if cancelled {
        return Err(NetworkError::Cancelled);
    }
    if status.success() {
        return Ok(());
    }

    let output = String::from_utf8_lossy(&stderr).to_ascii_lowercase();
    let label = remote.unwrap_or("todos los remotos").to_owned();
    if output.contains("authentication failed")
        || output.contains("could not read username")
        || output.contains("permission denied")
    {
        Err(NetworkError::AuthenticationFailed(label))
    } else if output.contains("could not resolve host")
        || output.contains("failed to connect")
        || output.contains("unable to access")
    {
        Err(NetworkError::Unreachable(label))
    } else {
        Err(NetworkError::GitFailed)
    }
}

#[cfg(test)]
pub fn pull(
    repository: &Path,
    options: &PullOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
) -> Result<PullResult, NetworkError> {
    pull_configured(
        repository,
        options,
        operation_id,
        on_progress,
        processes,
        None,
        None,
    )
}

pub fn pull_configured(
    repository: &Path,
    options: &PullOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
    credentials: Option<&CommandConfig>,
    mut before_integration: Option<&mut dyn FnMut(&str, PullStrategy) -> Result<(), NetworkError>>,
) -> Result<PullResult, NetworkError> {
    if processes.take_cancelled(operation_id) {
        return Err(NetworkError::Cancelled);
    }

    let branch = successful_text(repository, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_else(|_| "HEAD".to_owned());
    if branch == "HEAD" {
        return Err(NetworkError::PullNoUpstream(branch));
    }
    let upstream = successful_text(
        repository,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .map_err(|_| NetworkError::PullNoUpstream(branch.clone()))?;
    let old_upstream = successful_text(repository, &["rev-parse", "@{upstream}"])
        .map_err(|_| NetworkError::PullNoUpstream(branch.clone()))?;
    let ahead = successful_text(repository, &["rev-list", "--count", "@{upstream}..HEAD"])?
        .parse::<u64>()
        .map_err(|_| NetworkError::GitFailed)?;
    let reason = if ahead > 0 {
        "unpublished"
    } else {
        "published"
    };
    let strategy = match options.strategy.unwrap_or_default() {
        PullStrategy::Auto if ahead > 0 => PullStrategy::Rebase,
        PullStrategy::Auto => PullStrategy::Merge,
        strategy => strategy,
    };

    // Fetch first: the recovery layer must see the incoming tree before it can replace files.
    let remote = successful_text(
        repository,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )?;
    fetch_configured(
        repository,
        Some(&remote),
        &FetchOptions::default(),
        operation_id,
        on_progress.clone(),
        processes,
        credentials,
    )?;
    if let Some(prepare) = before_integration.as_mut() {
        prepare(&upstream, strategy)?;
    }
    let mut command = git_command();
    match strategy {
        PullStrategy::Rebase => {
            command.arg("rebase");
        }
        PullStrategy::Merge => {
            command.arg("merge").arg("--no-edit");
            match successful_text(repository, &["config", "--get", "pull.ff"])
                .ok()
                .as_deref()
            {
                Some("only") => {
                    command.arg("--ff-only");
                }
                Some("false") => {
                    command.arg("--no-ff");
                }
                Some("true") => {
                    command.arg("--ff");
                }
                _ => (),
            }
        }
        PullStrategy::Auto => unreachable!("la estrategia automática ya quedó resuelta"),
    }
    if let Ok(autostash) =
        successful_text(repository, &["config", "--bool", "--get", "pull.autostash"])
    {
        command.arg(if autostash == "true" {
            "--autostash"
        } else {
            "--no-autostash"
        });
    }
    command.arg(&upstream);
    let mut child = command
        .current_dir(repository)
        .env("GIT_EDITOR", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| NetworkError::GitFailed)?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    processes.register(operation_id, child.clone());
    if processes
        .cancelled
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(operation_id)
    {
        let _ = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .kill();
    }

    let reader = thread::spawn(move || {
        let mut captured = Vec::new();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                captured.extend_from_slice(&chunk);
                captured.push(b'\n');
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_transfer_progress(&String::from_utf8_lossy(line))
                    {
                        let _ = on_progress.send(progress);
                    }
                }
            }
        }
        captured
    });
    let status = loop {
        let status = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .try_wait()
            .map_err(|_| NetworkError::GitFailed)?;
        if let Some(status) = status {
            break status;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stderr = reader.join().unwrap_or_default();
    let cancelled = processes.finish(operation_id);
    if cancelled {
        return Err(NetworkError::Cancelled);
    }
    if !status.success() {
        let output = String::from_utf8_lossy(&stderr).to_ascii_lowercase();
        if output.contains("authentication failed")
            || output.contains("could not read username")
            || output.contains("permission denied")
        {
            return Err(NetworkError::AuthenticationFailed(upstream));
        }
        if output.contains("could not resolve host")
            || output.contains("failed to connect")
            || output.contains("unable to access")
        {
            return Err(NetworkError::Unreachable(upstream));
        }
        let count = unmerged_count(repository);
        if count > 0 {
            return match strategy {
                PullStrategy::Rebase => Err(NetworkError::RebaseConflict {
                    source: branch,
                    target: upstream,
                    sha: successful_text(repository, &["rev-parse", "--short", "REBASE_HEAD"])
                        .unwrap_or_default(),
                    count,
                }),
                PullStrategy::Merge => Err(NetworkError::MergeConflict {
                    source: upstream,
                    target: branch,
                    count,
                }),
                PullStrategy::Auto => unreachable!("la estrategia automática ya quedó resuelta"),
            };
        }
        return Err(NetworkError::GitFailed);
    }

    let new_upstream = successful_text(repository, &["rev-parse", "@{upstream}"])?;
    let received = if old_upstream == new_upstream {
        0
    } else {
        successful_text(
            repository,
            &[
                "rev-list",
                "--count",
                &format!("{old_upstream}..{new_upstream}"),
            ],
        )?
        .parse::<u64>()
        .map_err(|_| NetworkError::GitFailed)?
    };
    Ok(PullResult {
        strategy: match strategy {
            PullStrategy::Rebase => "rebase",
            PullStrategy::Merge => "merge",
            PullStrategy::Auto => unreachable!("la estrategia automática ya quedó resuelta"),
        },
        reason,
        received,
    })
}

#[cfg(test)]
pub fn push(
    repository: &Path,
    branch: &str,
    options: &PushOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
) -> Result<(), NetworkError> {
    push_configured(
        repository,
        branch,
        options,
        operation_id,
        on_progress,
        processes,
        None,
    )
}

pub fn push_configured(
    repository: &Path,
    branch: &str,
    options: &PushOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
    credentials: Option<&CommandConfig>,
) -> Result<(), NetworkError> {
    for attempt in 0..3 {
        let result = push_once(
            repository,
            branch,
            options,
            operation_id,
            on_progress.clone(),
            processes,
            credentials,
        );
        if credentials.is_some_and(|config| config.cancelled()) {
            return Err(NetworkError::Cancelled);
        }
        match &result {
            Err(NetworkError::AuthenticationFailed(remote))
                if attempt < 2 && credentials.is_some_and(|config| config.retry_auth(remote)) =>
            {
                continue
            }
            _ => {
                return if credentials.is_some_and(|config| config.cancelled()) {
                    Err(NetworkError::Cancelled)
                } else {
                    result
                }
            }
        }
    }
    Err(NetworkError::AuthenticationFailed("remote".into()))
}

fn push_once(
    repository: &Path,
    branch: &str,
    options: &PushOptions,
    operation_id: &str,
    on_progress: Channel<TransferProgress>,
    processes: &NetworkProcesses,
    credentials: Option<&CommandConfig>,
) -> Result<(), NetworkError> {
    if processes.take_cancelled(operation_id) {
        return Err(NetworkError::Cancelled);
    }

    let current = successful_text(repository, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map_err(|_| NetworkError::PushNoUpstream(branch.to_owned()))?;
    if current != branch {
        return Err(NetworkError::GitFailed);
    }

    let publish = options.set_upstream == Some(true);
    let (remote, remote_ref, tracking_ref) = if publish {
        let remote = options
            .remote
            .as_deref()
            .filter(|remote| !remote.is_empty())
            .ok_or_else(|| NetworkError::PushNoUpstream(branch.to_owned()))?;
        ensure_remote(repository, remote)?;
        (remote.to_owned(), format!("refs/heads/{branch}"), None)
    } else {
        read_upstream(repository, branch)?
    };

    let head = successful_text(repository, &["rev-parse", &format!("refs/heads/{branch}")])?;
    let known_remote_tip = tracking_ref
        .as_deref()
        .and_then(|reference| successful_text(repository, &["rev-parse", reference]).ok());
    let behind = tracking_ref
        .as_deref()
        .and_then(|reference| {
            successful_text(
                repository,
                &["rev-list", "--count", &format!("{head}..{reference}")],
            )
            .ok()
        })
        .and_then(|count| count.parse::<u64>().ok())
        .unwrap_or(0);

    let mut command = git_command();
    if let Some(credentials) = credentials {
        credentials.apply(&mut command);
    }
    command.arg("push").arg("--progress");
    if publish {
        command.arg("--set-upstream");
    }
    if let Some(expected) = options.expected_remote_tip.as_deref() {
        if known_remote_tip.as_deref() != Some(expected) {
            return Err(NetworkError::PushLeaseStale(format!(
                "{remote}/{}",
                remote_ref.trim_start_matches("refs/heads/")
            )));
        }
        command.arg(format!("--force-with-lease={remote_ref}:{expected}"));
    }
    command
        .arg("--")
        .arg(&remote)
        .arg(format!("refs/heads/{branch}:{remote_ref}"));

    let mut child = command
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| NetworkError::GitFailed)?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    processes.register(operation_id, child.clone());
    if processes
        .cancelled
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(operation_id)
    {
        let _ = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .kill();
    }

    let reader = thread::spawn(move || {
        let mut captured = Vec::new();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                captured.extend_from_slice(&chunk);
                captured.push(b'\n');
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_transfer_progress(&String::from_utf8_lossy(line))
                    {
                        let _ = on_progress.send(progress);
                    }
                }
            }
        }
        captured
    });

    let status = loop {
        let status = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .try_wait()
            .map_err(|_| NetworkError::GitFailed)?;
        if let Some(status) = status {
            break status;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stderr = reader.join().unwrap_or_default();
    let cancelled = processes.finish(operation_id);
    if cancelled {
        return Err(NetworkError::Cancelled);
    }
    if status.success() {
        return Ok(());
    }

    let output = String::from_utf8_lossy(&stderr).to_ascii_lowercase();
    if output.contains("authentication failed")
        || output.contains("could not read username")
        || output.contains("permission denied")
    {
        Err(NetworkError::AuthenticationFailed(remote))
    } else if output.contains("could not resolve host")
        || output.contains("failed to connect")
        || output.contains("unable to access")
    {
        Err(NetworkError::Unreachable(remote))
    } else if options.expected_remote_tip.is_some()
        && (output.contains("stale info") || output.contains("[rejected]"))
    {
        Err(NetworkError::PushLeaseStale(format!(
            "{remote}/{}",
            remote_ref.trim_start_matches("refs/heads/")
        )))
    } else if output.contains("[rejected]")
        || output.contains("non-fast-forward")
        || output.contains("fetch first")
    {
        Err(NetworkError::PushRejected {
            branch: branch.to_owned(),
            remote,
            count: behind,
        })
    } else {
        Err(NetworkError::GitFailed)
    }
}

fn ensure_remote(repository: &Path, remote: &str) -> Result<(), NetworkError> {
    let remotes = command_output(repository, &["remote"])?;
    if String::from_utf8_lossy(&remotes.stdout)
        .lines()
        .any(|known| known == remote)
    {
        Ok(())
    } else {
        Err(NetworkError::RemoteNotFound(remote.to_owned()))
    }
}

fn read_upstream(
    repository: &Path,
    branch: &str,
) -> Result<(String, String, Option<String>), NetworkError> {
    let format = "%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)";
    let text = successful_text(
        repository,
        &[
            "for-each-ref",
            &format!("--format={format}"),
            &format!("refs/heads/{branch}"),
        ],
    )?;
    let mut fields = text.split('\0');
    let remote = fields.next().unwrap_or_default();
    let remote_ref = fields.next().unwrap_or_default();
    let tracking_ref = fields.next().unwrap_or_default();
    if remote.is_empty() || remote_ref.is_empty() || tracking_ref.is_empty() {
        return Err(NetworkError::PushNoUpstream(branch.to_owned()));
    }
    ensure_remote(repository, remote)?;
    Ok((
        remote.to_owned(),
        remote_ref.to_owned(),
        Some(tracking_ref.to_owned()),
    ))
}

fn command_output(repository: &Path, args: &[&str]) -> Result<std::process::Output, NetworkError> {
    git_command()
        .args(args)
        .current_dir(repository)
        .output()
        .map_err(|_| NetworkError::GitFailed)
}

fn git_command() -> Command {
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C");
    command
}

fn successful_text(repository: &Path, args: &[&str]) -> Result<String, NetworkError> {
    let output = command_output(repository, args)?;
    if !output.status.success() {
        return Err(NetworkError::GitFailed);
    }
    String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|_| NetworkError::GitFailed)
}

fn unmerged_count(repository: &Path) -> u64 {
    successful_text(repository, &["diff", "--name-only", "--diff-filter=U"])
        .map(|paths| paths.lines().filter(|path| !path.is_empty()).count() as u64)
        .unwrap_or(0)
}

fn parse_transfer_progress(line: &str) -> Option<TransferProgress> {
    let phase = if line.contains("Counting objects:") || line.contains("Enumerating objects:") {
        "counting"
    } else if line.contains("Compressing objects:") {
        "compressing"
    } else if line.contains("Writing objects:") {
        "sending"
    } else if line.contains("Receiving objects:") {
        "receiving"
    } else if line.contains("Resolving deltas:") {
        "resolving"
    } else if line.contains("Updating files:") {
        "checkout"
    } else {
        return None;
    };
    let counts = line
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')'))
        .and_then(|(counts, _)| counts.split_once('/'))
        .and_then(|(received, total)| Some((received.parse().ok()?, total.parse().ok()?)));
    Some(TransferProgress {
        phase,
        received: counts.map_or(0, |counts| counts.0),
        total: counts.map(|counts| counts.1),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tauri::ipc::Channel;
    use tempfile::TempDir;

    use super::{
        fetch, git_command, parse_transfer_progress, pull, push, FetchOptions, NetworkError,
        NetworkProcesses, PullOptions, PullResult, PullStrategy, PushOptions, TransferProgress,
    };

    #[test]
    fn red_hereda_helpers_y_agente_ssh_sin_habilitar_prompt_de_terminal() {
        let command = git_command();
        let configured = command
            .get_envs()
            .map(|(key, value)| (key.to_owned(), value.map(ToOwned::to_owned)))
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(
            configured.get(std::ffi::OsStr::new("GIT_TERMINAL_PROMPT")),
            Some(&Some(std::ffi::OsString::from("0")))
        );
        for inherited in [
            "GIT_CONFIG_NOSYSTEM",
            "GIT_CONFIG_SYSTEM",
            "GIT_CONFIG_GLOBAL",
            "GIT_ASKPASS",
            "SSH_ASKPASS",
            "SSH_AUTH_SOCK",
            "GIT_SSH",
            "GIT_SSH_COMMAND",
        ] {
            assert!(
                !configured.contains_key(std::ffi::OsStr::new(inherited)),
                "{inherited} debe heredarse sin override"
            );
        }
    }

    fn git(directory: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(directory)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .output()
            .expect("Git CLI disponible");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn fixture() -> (TempDir, std::path::PathBuf, std::path::PathBuf) {
        let temporary = TempDir::new().unwrap();
        let source = temporary.path().join("source");
        fs::create_dir(&source).unwrap();
        git(&source, &["init", "--initial-branch=main"]);
        git(&source, &["config", "user.name", "GitThul Tests"]);
        git(&source, &["config", "user.email", "tests@gitthul.invalid"]);
        fs::write(source.join("README.md"), "uno\n").unwrap();
        git(&source, &["add", "README.md"]);
        git(&source, &["commit", "-m", "inicio"]);
        let remote = temporary.path().join("remote.git");
        git(
            temporary.path(),
            &[
                "clone",
                "--bare",
                source.to_str().unwrap(),
                remote.to_str().unwrap(),
            ],
        );
        git(
            &source,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        let local = temporary.path().join("local");
        git(
            temporary.path(),
            &["clone", remote.to_str().unwrap(), local.to_str().unwrap()],
        );
        git(&local, &["config", "user.name", "GitThul Tests"]);
        git(&local, &["config", "user.email", "tests@gitthul.invalid"]);
        (temporary, source, local)
    }

    #[test]
    fn interpreta_el_progreso_maquina_de_git() {
        assert_eq!(
            parse_transfer_progress("Receiving objects:  42% (21/50), 1.00 KiB"),
            Some(TransferProgress {
                phase: "receiving",
                received: 21,
                total: Some(50),
            })
        );
        assert_eq!(
            parse_transfer_progress("Enumerating objects: 12, done."),
            Some(TransferProgress {
                phase: "counting",
                received: 0,
                total: None,
            })
        );
        assert_eq!(
            parse_transfer_progress("Writing objects:  50% (2/4), 1.00 KiB"),
            Some(TransferProgress {
                phase: "sending",
                received: 2,
                total: Some(4),
            })
        );
        assert!(parse_transfer_progress("From /tmp/remote").is_none());
    }

    #[test]
    fn trae_el_remoto_exacto() {
        let (_temporary, source, local) = fixture();
        fs::write(source.join("README.md"), "dos\n").unwrap();
        git(&source, &["add", "README.md"]);
        git(&source, &["commit", "-m", "segundo"]);
        git(&source, &["push", "origin", "main"]);
        let expected = git(&source, &["rev-parse", "HEAD"]);
        fetch(
            &local,
            Some("origin"),
            &FetchOptions::default(),
            "fetch-origin",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();

        assert_eq!(
            git(&local, &["rev-parse", "refs/remotes/origin/main"]),
            expected
        );
    }

    #[test]
    fn prune_retira_una_rama_remota_desaparecida() {
        let (_temporary, source, local) = fixture();
        git(&source, &["switch", "-c", "temporal"]);
        git(&source, &["push", "origin", "temporal"]);
        fetch(
            &local,
            Some("origin"),
            &FetchOptions::default(),
            "fetch-branch",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();
        git(&source, &["push", "origin", "--delete", "temporal"]);

        fetch(
            &local,
            Some("origin"),
            &FetchOptions { prune: Some(true) },
            "fetch-prune",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();

        let status = Command::new("git")
            .args(["rev-parse", "--verify", "refs/remotes/origin/temporal"])
            .current_dir(&local)
            .output()
            .unwrap()
            .status;
        assert!(!status.success());
    }

    #[test]
    fn trae_todos_los_remotos_sin_confundir_sus_refs() {
        let (temporary, source, local) = fixture();
        let backup = temporary.path().join("backup.git");
        git(
            temporary.path(),
            &[
                "clone",
                "--bare",
                source.to_str().unwrap(),
                backup.to_str().unwrap(),
            ],
        );
        git(
            &local,
            &["remote", "add", "backup", backup.to_str().unwrap()],
        );
        fs::write(source.join("README.md"), "dos\n").unwrap();
        git(&source, &["add", "README.md"]);
        git(&source, &["commit", "-m", "segundo"]);
        git(&source, &["push", "origin", "main"]);
        git(&source, &["push", backup.to_str().unwrap(), "main"]);
        let expected = git(&source, &["rev-parse", "HEAD"]);

        fetch(
            &local,
            None,
            &FetchOptions::default(),
            "fetch-all",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();

        assert_eq!(
            git(&local, &["rev-parse", "refs/remotes/origin/main"]),
            expected
        );
        assert_eq!(
            git(&local, &["rev-parse", "refs/remotes/backup/main"]),
            expected
        );
    }

    #[test]
    fn remoto_ausente_y_cancelacion_temprana_no_escriben() {
        let (_temporary, _source, local) = fixture();
        let before = git(&local, &["show-ref"]);
        let processes = NetworkProcesses::default();
        let missing = fetch(
            &local,
            Some("desconocido"),
            &FetchOptions::default(),
            "missing",
            Channel::new(|_| Ok(())),
            &processes,
        )
        .unwrap_err();
        assert_eq!(
            missing,
            NetworkError::RemoteNotFound("desconocido".to_owned())
        );

        processes.cancel("cancelled".to_owned());
        let cancelled = fetch(
            &local,
            None,
            &FetchOptions::default(),
            "cancelled",
            Channel::new(|_| Ok(())),
            &processes,
        )
        .unwrap_err();
        assert_eq!(cancelled, NetworkError::Cancelled);
        assert_eq!(git(&local, &["show-ref"]), before);
    }

    #[test]
    fn pull_auto_rebasa_commits_locales_no_publicados() {
        let (_temporary, source, local) = fixture();
        fs::write(local.join("local.txt"), "local\n").unwrap();
        git(&local, &["add", "local.txt"]);
        git(&local, &["commit", "-m", "local"]);
        fs::write(source.join("remote.txt"), "remote\n").unwrap();
        git(&source, &["add", "remote.txt"]);
        git(&source, &["commit", "-m", "remoto"]);
        git(&source, &["push", "origin", "main"]);

        let result = pull(
            &local,
            &PullOptions::default(),
            "pull-rebase",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();

        assert_eq!(
            result,
            PullResult {
                strategy: "rebase",
                reason: "unpublished",
                received: 1,
            }
        );
        assert_eq!(git(&local, &["rev-list", "--count", "HEAD"]), "3");
        assert!(local.join("local.txt").exists());
        assert!(local.join("remote.txt").exists());
    }

    #[test]
    fn pull_auto_hace_fast_forward_y_lo_clasifica_como_merge_publicado() {
        let (_temporary, source, local) = fixture();
        fs::write(source.join("remote.txt"), "remote\n").unwrap();
        git(&source, &["add", "remote.txt"]);
        git(&source, &["commit", "-m", "remoto"]);
        let expected = git(&source, &["rev-parse", "HEAD"]);
        git(&source, &["push", "origin", "main"]);

        let result = pull(
            &local,
            &PullOptions::default(),
            "pull-fast-forward",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();

        assert_eq!(result.strategy, "merge");
        assert_eq!(result.reason, "published");
        assert_eq!(result.received, 1);
        assert_eq!(git(&local, &["rev-parse", "HEAD"]), expected);
    }

    #[test]
    fn pull_respeta_merge_explicito_aunque_lo_local_no_este_publicado() {
        let (_temporary, source, local) = fixture();
        fs::write(local.join("local.txt"), "local\n").unwrap();
        git(&local, &["add", "local.txt"]);
        git(&local, &["commit", "-m", "local"]);
        fs::write(source.join("remote.txt"), "remote\n").unwrap();
        git(&source, &["add", "remote.txt"]);
        git(&source, &["commit", "-m", "remoto"]);
        git(&source, &["push", "origin", "main"]);

        let result = pull(
            &local,
            &PullOptions {
                strategy: Some(PullStrategy::Merge),
            },
            "pull-merge",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();

        assert_eq!(result.strategy, "merge");
        assert_eq!(result.reason, "unpublished");
        assert_eq!(git(&local, &["rev-list", "--count", "HEAD"]), "4");
    }

    #[test]
    fn pull_tipa_upstream_ausente_y_conflicto_sin_ocultar_el_estado_git() {
        let (_temporary, source, local) = fixture();
        git(&local, &["branch", "--unset-upstream"]);
        assert_eq!(
            pull(
                &local,
                &PullOptions::default(),
                "pull-no-upstream",
                Channel::new(|_| Ok(())),
                &NetworkProcesses::default(),
            )
            .unwrap_err(),
            NetworkError::PullNoUpstream("main".to_owned())
        );
        git(&local, &["branch", "--set-upstream-to=origin/main"]);

        fs::write(local.join("README.md"), "local\n").unwrap();
        git(&local, &["add", "README.md"]);
        git(&local, &["commit", "-m", "local"]);
        fs::write(source.join("README.md"), "remoto\n").unwrap();
        git(&source, &["add", "README.md"]);
        git(&source, &["commit", "-m", "remoto"]);
        git(&source, &["push", "origin", "main"]);

        let conflict = pull(
            &local,
            &PullOptions::default(),
            "pull-conflict",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap_err();
        assert!(matches!(
            conflict,
            NetworkError::RebaseConflict {
                source,
                target,
                count: 1,
                ..
            } if source == "main" && target == "origin/main"
        ));
        assert_eq!(
            git(&local, &["diff", "--name-only", "--diff-filter=U"]),
            "README.md"
        );
    }

    #[test]
    fn push_publica_en_el_upstream_exacto_y_permite_configurarlo_explicito() {
        let (_temporary, _source, local) = fixture();
        fs::write(local.join("local.txt"), "local\n").unwrap();
        git(&local, &["add", "local.txt"]);
        git(&local, &["commit", "-m", "local"]);
        let expected = git(&local, &["rev-parse", "HEAD"]);

        push(
            &local,
            "main",
            &PushOptions::default(),
            "push-upstream",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();
        assert_eq!(
            git(&local, &["ls-remote", "origin", "refs/heads/main"]),
            format!("{expected}\trefs/heads/main")
        );

        git(&local, &["switch", "-c", "publicada"]);
        assert_eq!(
            push(
                &local,
                "publicada",
                &PushOptions::default(),
                "push-no-upstream",
                Channel::new(|_| Ok(())),
                &NetworkProcesses::default(),
            )
            .unwrap_err(),
            NetworkError::PushNoUpstream("publicada".to_owned())
        );
        push(
            &local,
            "publicada",
            &PushOptions {
                remote: Some("origin".to_owned()),
                set_upstream: Some(true),
                expected_remote_tip: None,
            },
            "push-publish",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();
        assert_eq!(
            git(&local, &["rev-parse", "--abbrev-ref", "@{upstream}"]),
            "origin/publicada"
        );
    }

    #[test]
    fn rechazo_no_escribe_y_force_with_lease_protege_la_punta_observada() {
        let (_temporary, source, local) = fixture();
        let observed = git(&local, &["rev-parse", "refs/remotes/origin/main"]);
        fs::write(source.join("remote.txt"), "remote\n").unwrap();
        git(&source, &["add", "remote.txt"]);
        git(&source, &["commit", "-m", "remoto"]);
        git(&source, &["push", "origin", "main"]);
        let remote_tip = git(&source, &["rev-parse", "HEAD"]);
        fs::write(local.join("local.txt"), "local\n").unwrap();
        git(&local, &["add", "local.txt"]);
        git(&local, &["commit", "-m", "local"]);

        let rejected = push(
            &local,
            "main",
            &PushOptions::default(),
            "push-rejected",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap_err();
        assert!(
            matches!(
                &rejected,
                NetworkError::PushRejected { branch, remote, .. }
                    if branch == "main" && remote == "origin"
            ),
            "{rejected:?}"
        );
        assert_eq!(git(&source, &["rev-parse", "HEAD"]), remote_tip);

        let stale = push(
            &local,
            "main",
            &PushOptions {
                remote: None,
                set_upstream: None,
                expected_remote_tip: Some(observed),
            },
            "push-stale-lease",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap_err();
        assert_eq!(
            stale,
            NetworkError::PushLeaseStale("origin/main".to_owned())
        );
        assert_eq!(git(&source, &["rev-parse", "HEAD"]), remote_tip);

        fetch(
            &local,
            Some("origin"),
            &FetchOptions::default(),
            "fetch-before-force",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();
        push(
            &local,
            "main",
            &PushOptions {
                remote: None,
                set_upstream: None,
                expected_remote_tip: Some(remote_tip),
            },
            "push-valid-lease",
            Channel::new(|_| Ok(())),
            &NetworkProcesses::default(),
        )
        .unwrap();
        assert_eq!(
            git(&local, &["ls-remote", "origin", "refs/heads/main"]),
            format!("{}\trefs/heads/main", git(&local, &["rev-parse", "HEAD"]))
        );
    }
}

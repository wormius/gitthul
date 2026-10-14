//! Escrituras de red ejecutadas por Git CLI.
//!
//! Git conserva la autoridad sobre protocolos, helpers y configuración. Este
//! módulo solo delimita el proceso, transmite progreso máquina y permite
//! cancelarlo sin guardar URLs ni credenciales en estado paralelo.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::auth::CommandConfig;

use super::diagnostics::Diagnostic;
use super::stash;

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
    Stash(stash::StashError),
    Cancelled,
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<NetworkError>, Diagnostic),
}

impl NetworkError {
    fn with_diagnostic(self, diagnostic: Diagnostic) -> Self {
        Self::WithDiagnostic(Box::new(self), diagnostic)
    }

    fn classification(&self) -> &Self {
        match self {
            Self::WithDiagnostic(error, _) => error.classification(),
            _ => self,
        }
    }
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
            let skip = optional_text(
                repository,
                &[
                    "config",
                    "--bool",
                    "--get",
                    &format!("remote.{name}.skipFetchAll"),
                ],
            )?;
            if skip.as_deref() == Some("true") {
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
        match result.as_ref().err().map(NetworkError::classification) {
            Some(NetworkError::AuthenticationFailed(remote))
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
        let remotes = successful_text(repository, &["remote"])?;
        let exists = remotes.lines().any(|known| known == remote);
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
    let args = diagnostic_args(&command);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut child = command
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            NetworkError::Diagnostic(Diagnostic::command_io("network.spawn", &args, &error))
        })?;
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
        let mut captured = StderrCapture::default();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                captured.push(&chunk);
                captured.push(b"\n");
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_transfer_progress(&String::from_utf8_lossy(line))
                    {
                        let _ = on_progress.send(progress);
                    }
                }
            }
        }
        captured.finish()
    });

    let (status, stderr) = wait_transfer(&child, reader, processes, operation_id, &args)?;
    if status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&stderr);
    let diagnostic = Diagnostic::command_stderr("network.execute", &args, status, &stderr);
    let output = stderr.to_ascii_lowercase();
    let label = remote.unwrap_or("todos los remotos").to_owned();
    if output.contains("authentication failed")
        || output.contains("could not read username")
        || output.contains("permission denied")
    {
        Err(NetworkError::AuthenticationFailed(label).with_diagnostic(diagnostic))
    } else if output.contains("could not resolve host")
        || output.contains("failed to connect")
        || output.contains("unable to access")
    {
        Err(NetworkError::Unreachable(label).with_diagnostic(diagnostic))
    } else {
        Err(NetworkError::Diagnostic(diagnostic))
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

    let branch = optional_text(repository, &["symbolic-ref", "--quiet", "--short", "HEAD"])?
        .unwrap_or_else(|| "HEAD".to_owned());
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
    .map_err(|error| attach_classification(error, NetworkError::PullNoUpstream(branch.clone())))?;
    let old_upstream =
        successful_text(repository, &["rev-parse", "@{upstream}"]).map_err(|error| {
            attach_classification(error, NetworkError::PullNoUpstream(branch.clone()))
        })?;
    let ahead = successful_text(repository, &["rev-list", "--count", "@{upstream}..HEAD"])?
        .parse::<u64>()
        .map_err(|error| NetworkError::Diagnostic(Diagnostic::new("pull.parseAhead", error)))?;
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
            match optional_text(repository, &["config", "--get", "pull.ff"])?.as_deref() {
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
    if let Some(autostash) =
        optional_text(repository, &["config", "--bool", "--get", "pull.autostash"])?
    {
        command.arg(if autostash == "true" {
            "--autostash"
        } else {
            "--no-autostash"
        });
    }
    command.arg(&upstream);
    let args = diagnostic_args(&command);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let autostash =
        stash::AutostashObservation::capture(repository).map_err(NetworkError::Stash)?;
    let mut child = command
        .current_dir(repository)
        .env("GIT_EDITOR", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            NetworkError::Diagnostic(Diagnostic::command_io("network.spawn", &args, &error))
        })?;
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
        let mut captured = StderrCapture::default();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                captured.push(&chunk);
                captured.push(b"\n");
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_transfer_progress(&String::from_utf8_lossy(line))
                    {
                        let _ = on_progress.send(progress);
                    }
                }
            }
        }
        captured.finish()
    });
    let completed = wait_transfer(&child, reader, processes, operation_id, &args);
    let recovery = autostash.recover_if_conflicted(repository);
    // Preserve cancellation and transfer failures even if registering recovery
    // also fails. The attempt still runs before returning the transfer result.
    let (status, stderr) = completed?;
    let auto_conflicted = recovery.map_err(NetworkError::Stash)?;
    let stderr = String::from_utf8_lossy(&stderr);
    let diagnostic = Diagnostic::command_stderr("network.execute", &args, status, &stderr);
    if auto_conflicted {
        let count = super::status::read(repository)
            .map_err(|error| match error {
                super::status::ReadStatusError::Diagnostic(diagnostic) => {
                    NetworkError::Diagnostic(diagnostic)
                }
                error => NetworkError::Diagnostic(Diagnostic::new(
                    "pull.autostashStatus",
                    format!("{error:?}"),
                )),
            })?
            .conflicted_count();
        return Err(NetworkError::Stash(stash::StashError::AutoConflict {
            count,
            diagnostic,
        }));
    }
    if !status.success() {
        let output = stderr.to_ascii_lowercase();
        if output.contains("authentication failed")
            || output.contains("could not read username")
            || output.contains("permission denied")
        {
            return Err(NetworkError::AuthenticationFailed(upstream).with_diagnostic(diagnostic));
        }
        if output.contains("could not resolve host")
            || output.contains("failed to connect")
            || output.contains("unable to access")
        {
            return Err(NetworkError::Unreachable(upstream).with_diagnostic(diagnostic));
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
                }
                .with_diagnostic(diagnostic)),
                PullStrategy::Merge => Err(NetworkError::MergeConflict {
                    source: upstream,
                    target: branch,
                    count,
                }
                .with_diagnostic(diagnostic)),
                PullStrategy::Auto => unreachable!("la estrategia automática ya quedó resuelta"),
            };
        }
        return Err(NetworkError::Diagnostic(diagnostic));
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
        .map_err(|error| NetworkError::Diagnostic(Diagnostic::new("pull.parseReceived", error)))?
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
        match result.as_ref().err().map(NetworkError::classification) {
            Some(NetworkError::AuthenticationFailed(remote))
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

    let current = optional_text(repository, &["symbolic-ref", "--quiet", "--short", "HEAD"])?
        .ok_or_else(|| NetworkError::PushNoUpstream(branch.to_owned()))?;
    if current != branch {
        return Err(NetworkError::Diagnostic(Diagnostic::new(
            "push.precondition",
            "Current branch changed before push",
        )));
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

    let args = diagnostic_args(&command);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut child = command
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            NetworkError::Diagnostic(Diagnostic::command_io("network.spawn", &args, &error))
        })?;
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
        let mut captured = StderrCapture::default();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                captured.push(&chunk);
                captured.push(b"\n");
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_transfer_progress(&String::from_utf8_lossy(line))
                    {
                        let _ = on_progress.send(progress);
                    }
                }
            }
        }
        captured.finish()
    });

    let (status, stderr) = wait_transfer(&child, reader, processes, operation_id, &args)?;
    if status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&stderr);
    let diagnostic = Diagnostic::command_stderr("network.execute", &args, status, &stderr);
    let output = stderr.to_ascii_lowercase();
    if output.contains("authentication failed")
        || output.contains("could not read username")
        || output.contains("permission denied")
    {
        Err(NetworkError::AuthenticationFailed(remote).with_diagnostic(diagnostic))
    } else if output.contains("could not resolve host")
        || output.contains("failed to connect")
        || output.contains("unable to access")
    {
        Err(NetworkError::Unreachable(remote).with_diagnostic(diagnostic))
    } else if options.expected_remote_tip.is_some()
        && (output.contains("stale info") || output.contains("[rejected]"))
    {
        Err(NetworkError::PushLeaseStale(format!(
            "{remote}/{}",
            remote_ref.trim_start_matches("refs/heads/")
        ))
        .with_diagnostic(diagnostic))
    } else if output.contains("[rejected]")
        || output.contains("non-fast-forward")
        || output.contains("fetch first")
    {
        Err(NetworkError::PushRejected {
            branch: branch.to_owned(),
            remote,
            count: behind,
        }
        .with_diagnostic(diagnostic))
    } else {
        Err(NetworkError::Diagnostic(diagnostic))
    }
}

fn ensure_remote(repository: &Path, remote: &str) -> Result<(), NetworkError> {
    let remotes = successful_text(repository, &["remote"])?;
    if remotes.lines().any(|known| known == remote) {
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

const STDERR_CAPTURE_LIMIT: usize = 16_000;

#[derive(Default)]
pub(super) struct StderrCapture {
    bytes: Vec<u8>,
    pending_line: Vec<u8>,
    in_private_key: bool,
    truncated: bool,
}

fn private_key_markers() -> &'static (regex::Regex, regex::Regex) {
    static MARKERS: std::sync::OnceLock<(regex::Regex, regex::Regex)> = std::sync::OnceLock::new();
    MARKERS.get_or_init(|| {
        (
            regex::Regex::new(r"-----BEGIN [^-]*PRIVATE KEY-----")
                .expect("fixed private key begin pattern"),
            regex::Regex::new(r"-----END [^-]*PRIVATE KEY-----")
                .expect("fixed private key end pattern"),
        )
    })
}

impl StderrCapture {
    pub(super) fn push(&mut self, chunk: &[u8]) {
        // Keep split lines together until redaction, so truncation cannot drop
        // the credential prefix and retain an unrecognizable secret suffix.
        for part in chunk.split_inclusive(|byte| matches!(*byte, b'\r' | b'\n')) {
            self.pending_line.extend_from_slice(part);
            if part
                .last()
                .is_some_and(|byte| matches!(*byte, b'\r' | b'\n'))
            {
                self.flush_line();
            }
        }
    }

    fn flush_line(&mut self) {
        let pending = std::mem::take(&mut self.pending_line);
        let text = String::from_utf8_lossy(&pending);
        let (begin, end) = private_key_markers();
        let mut remaining = text.as_ref();
        let mut exposed = String::new();
        while !remaining.is_empty() {
            if self.in_private_key {
                if let Some(marker) = end.find(remaining) {
                    self.in_private_key = false;
                    remaining = &remaining[marker.end()..];
                } else {
                    break;
                }
            } else if let Some(marker) = begin.find(remaining) {
                exposed.push_str(&remaining[..marker.start()]);
                exposed.push_str("[redacted private key]");
                self.in_private_key = true;
                remaining = &remaining[marker.end()..];
            } else {
                exposed.push_str(remaining);
                break;
            }
        }
        // Redact complete tokens, URLs and headers before retaining the tail.
        let safe = crate::log_privacy::text(&exposed);
        self.push_safe(safe.as_bytes());
    }

    fn push_safe(&mut self, chunk: &[u8]) {
        if chunk.len() >= STDERR_CAPTURE_LIMIT {
            self.bytes.clear();
            self.bytes
                .extend_from_slice(&chunk[chunk.len() - STDERR_CAPTURE_LIMIT..]);
            self.truncated = true;
            return;
        }
        let overflow = (self.bytes.len() + chunk.len()).saturating_sub(STDERR_CAPTURE_LIMIT);
        if overflow > 0 {
            self.bytes.drain(..overflow);
            self.truncated = true;
        }
        self.bytes.extend_from_slice(chunk);
    }

    pub(super) fn finish(mut self) -> Vec<u8> {
        self.flush_line();
        if self.truncated {
            let mut result = b"[truncated: earlier stderr omitted]\n".to_vec();
            result.extend_from_slice(&self.bytes);
            result
        } else {
            self.bytes
        }
    }
}

fn wait_transfer(
    child: &Arc<Mutex<Child>>,
    reader: thread::JoinHandle<Vec<u8>>,
    processes: &NetworkProcesses,
    operation_id: &str,
    args: &[&str],
) -> Result<(ExitStatus, Vec<u8>), NetworkError> {
    let result = loop {
        let waited = child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .try_wait();
        match waited {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(error) => {
                // Reap and remove registration even if waiting failed, so a
                // stale process cannot intercept a later cancellation.
                let mut child = child.lock().unwrap_or_else(|error| error.into_inner());
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
        }
    };
    let stderr = reader.join().unwrap_or_default();
    if processes.finish(operation_id) {
        return Err(NetworkError::Cancelled);
    }
    let status = result.map_err(|error| {
        NetworkError::Diagnostic(Diagnostic::command_io("network.wait", args, &error))
    })?;
    Ok((status, stderr))
}

fn attach_classification(error: NetworkError, classification: NetworkError) -> NetworkError {
    match error {
        NetworkError::Diagnostic(diagnostic) | NetworkError::WithDiagnostic(_, diagnostic) => {
            classification.with_diagnostic(diagnostic)
        }
        error => error,
    }
}

// Git config --get and symbolic-ref --quiet use 1 for an absent optional value.
// Other exits (for example malformed config or invalid repository) must survive.
fn optional_text(repository: &Path, args: &[&str]) -> Result<Option<String>, NetworkError> {
    let output = command_output(repository, args)?;
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err(NetworkError::Diagnostic(Diagnostic::command(
            "network.probe",
            args,
            &output,
        )));
    }
    String::from_utf8(output.stdout)
        .map(|text| Some(text.trim().to_owned()))
        .map_err(|error| NetworkError::Diagnostic(Diagnostic::new("network.decodeProbe", error)))
}

fn diagnostic_args(command: &Command) -> Vec<String> {
    let mut skip_config_value = false;
    command
        .get_args()
        .filter_map(|arg| {
            let arg = arg.to_string_lossy();
            if skip_config_value {
                skip_config_value = false;
                return None;
            }
            if arg == "-c" {
                skip_config_value = true;
                return None;
            }
            Some(arg.into_owned())
        })
        .collect()
}

fn command_output(repository: &Path, args: &[&str]) -> Result<std::process::Output, NetworkError> {
    git_command()
        .args(args)
        .current_dir(repository)
        .output()
        .map_err(|error| {
            NetworkError::Diagnostic(Diagnostic::command_io("network.read", args, &error))
        })
}

fn git_command() -> Command {
    let mut command = crate::process::command("git");
    command.env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C");
    command
}

fn successful_text(repository: &Path, args: &[&str]) -> Result<String, NetworkError> {
    let output = command_output(repository, args)?;
    if !output.status.success() {
        return Err(NetworkError::Diagnostic(Diagnostic::command(
            "network.read",
            args,
            &output,
        )));
    }
    String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|error| NetworkError::Diagnostic(Diagnostic::new("network.decode", error)))
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
    use super::stash;
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
    fn pull_con_conflicto_al_reaplicar_autostash_conserva_integracion_y_recuperacion() {
        for (strategy, local_commit) in [
            (PullStrategy::Auto, false),
            (PullStrategy::Auto, true),
            (PullStrategy::Merge, true),
            (PullStrategy::Rebase, true),
        ] {
            for abort in [true, false] {
                let (_temporary, source, local) = fixture();
                git(&local, &["config", "core.autocrlf", "false"]);
                fs::write(local.join("README.md"), "older stash\n").unwrap();
                git(&local, &["stash", "push", "-m", "previous stash"]);
                let previous = git(&local, &["rev-parse", "refs/stash"]);
                if local_commit {
                    fs::write(local.join("local.txt"), "local\n").unwrap();
                    git(&local, &["add", "local.txt"]);
                    git(&local, &["commit", "-m", "local"]);
                }
                let original_head = git(&local, &["rev-parse", "HEAD"]);
                fs::write(source.join("README.md"), "incoming\n").unwrap();
                git(&source, &["add", "README.md"]);
                git(&source, &["commit", "-m", "remote"]);
                git(&source, &["push", "origin", "main"]);
                let incoming = git(&source, &["rev-parse", "HEAD"]);
                fs::write(local.join("README.md"), "staged work\n").unwrap();
                git(&local, &["add", "README.md"]);
                fs::write(local.join("README.md"), "unstaged work\n").unwrap();
                fs::write(local.join("untracked.txt"), "keep me\n").unwrap();
                git(&local, &["config", "pull.autostash", "true"]);

                let error = pull(
                    &local,
                    &PullOptions {
                        strategy: Some(strategy),
                    },
                    "pull-autostash",
                    Channel::new(|_| Ok(())),
                    &NetworkProcesses::default(),
                )
                .unwrap_err();

                let NetworkError::Stash(stash::StashError::AutoConflict {
                    count: 1,
                    diagnostic,
                }) = error
                else {
                    panic!("expected auto-stash conflict: {error:?}");
                };
                let captured_diagnostic = serde_json::to_value(&diagnostic).unwrap();
                let evidence = serde_json::to_value(super::super::map_network_error(
                    NetworkError::Stash(stash::StashError::AutoConflict {
                        count: 1,
                        diagnostic,
                    }),
                ))
                .unwrap();
                assert_eq!(evidence["code"], "stash.autoConflict");
                assert_eq!(evidence["params"]["count"], 1);
                assert_eq!(evidence["diagnostic"], captured_diagnostic);
                assert_eq!(evidence["diagnostic"]["kind"], "gitCommand");
                assert_eq!(evidence["diagnostic"]["stage"], "network.execute");
                assert_eq!(evidence["diagnostic"]["command"]["program"], "git");
                assert_eq!(
                    evidence["diagnostic"]["command"]["args"],
                    if strategy == PullStrategy::Rebase
                        || (strategy == PullStrategy::Auto && local_commit)
                    {
                        serde_json::json!(["rebase", "--autostash", "origin/main"])
                    } else {
                        serde_json::json!(["merge", "--no-edit", "--autostash", "origin/main"])
                    }
                );
                assert_eq!(evidence["diagnostic"]["exitCode"], 0);
                // Git's explanation changed in 2.55; keep its evidence without
                // requiring one version's human-facing advice.
                assert!(evidence["diagnostic"]["stderr"]
                    .as_str()
                    .unwrap()
                    .contains("conflicts"));
                let unmerged = git(&local, &["ls-files", "-u"]);
                assert_eq!(unmerged.lines().count(), 3);
                assert!(unmerged.lines().all(|line| line.ends_with("\tREADME.md")));
                assert!(matches!(
                    super::super::repository::discover(&local)
                        .unwrap()
                        .operation(),
                    super::super::repository::RepoOperation::None
                ));
                assert_eq!(
                    stash::recovery_kind(&local),
                    Some(stash::StashRecoveryKind::AutoStash)
                );
                let integrated_head = git(&local, &["rev-parse", "HEAD"]);
                assert_ne!(integrated_head, original_head);
                assert_eq!(
                    git(&local, &["merge-base", "HEAD", "origin/main"]),
                    incoming
                );
                let auto = git(&local, &["rev-parse", "refs/stash"]);
                assert_ne!(auto, previous);
                assert_eq!(
                    git(&local, &["show", "stash@{0}:README.md"]),
                    "unstaged work"
                );
                assert_eq!(
                    git(&local, &["show", "stash@{0}^2:README.md"]),
                    "staged work"
                );
                assert_eq!(git(&local, &["rev-parse", "stash@{1}"]), previous);

                if abort {
                    stash::abort_recovery(&local).unwrap();
                    assert_eq!(git(&local, &["rev-parse", "refs/stash"]), auto);
                    assert_eq!(
                        fs::read_to_string(local.join("README.md")).unwrap(),
                        "incoming\n"
                    );
                } else {
                    fs::write(local.join("README.md"), "resolved work\n").unwrap();
                    git(&local, &["add", "README.md"]);
                    stash::finish_recovery(&local).unwrap();
                    assert_eq!(git(&local, &["rev-parse", "refs/stash"]), previous);
                    assert_eq!(
                        fs::read_to_string(local.join("README.md")).unwrap(),
                        "resolved work\n"
                    );
                }
                assert_eq!(git(&local, &["rev-parse", "HEAD"]), integrated_head);
                assert!(git(&local, &["ls-files", "-u"]).is_empty());
                assert_eq!(
                    fs::read_to_string(local.join("untracked.txt")).unwrap(),
                    "keep me\n"
                );
                assert_eq!(stash::recovery_kind(&local), None);
            }
        }
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
            .unwrap_err()
            .classification(),
            &NetworkError::PullNoUpstream("main".to_owned())
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
            conflict.classification(),
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
        assert_eq!(stash::recovery_kind(&local), None);
        assert!(matches!(
            super::super::repository::discover(&local)
                .unwrap()
                .operation(),
            super::super::repository::RepoOperation::Rebase { .. }
        ));
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
                rejected.classification(),
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
            stale.classification(),
            &NetworkError::PushLeaseStale("origin/main".to_owned())
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
    #[test]
    fn fetch_failure_preserves_command_exit_and_stderr_from_a_local_remote() {
        let (temporary, _, local) = fixture();
        let missing = temporary.path().join("missing.git");
        git(
            &local,
            &["remote", "set-url", "origin", missing.to_str().unwrap()],
        );
        let processes = NetworkProcesses::default();
        let error = fetch(
            &local,
            Some("origin"),
            &FetchOptions::default(),
            "fetch-diagnostic",
            Channel::new(|_| Ok(())),
            &processes,
        )
        .unwrap_err();
        let NetworkError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let diagnostic = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(diagnostic["exitCode"], 128);
        assert_eq!(diagnostic["command"]["args"][0], "fetch");
        assert!(diagnostic["stderr"]
            .as_str()
            .unwrap()
            .contains("does not appear to be a git repository"));
        assert!(diagnostic.get("stdout").is_none());
        assert!(processes.children.lock().unwrap().is_empty());
        assert!(!processes.take_cancelled("fetch-diagnostic"));
    }

    #[test]
    fn authentication_classification_survives_diagnostic_attachment() {
        let error = NetworkError::AuthenticationFailed("origin".into()).with_diagnostic(
            super::Diagnostic::new("network.execute", "authentication failed"),
        );
        assert!(
            matches!(error.classification(), NetworkError::AuthenticationFailed(remote) if remote == "origin")
        );
    }
    #[test]
    fn optional_config_probes_distinguish_absence_from_invalid_values() {
        let (_temporary, _, local) = fixture();
        assert_eq!(
            super::optional_text(&local, &["config", "--get", "pull.ff"]).unwrap(),
            None
        );
        git(&local, &["config", "pull.autostash", "invalid-boolean"]);
        let error = super::optional_text(&local, &["config", "--bool", "--get", "pull.autostash"])
            .unwrap_err();
        let NetworkError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["stage"], "network.probe");
        assert_eq!(value["command"]["args"][0], "config");
        assert!(value["exitCode"].as_i64().unwrap() != 0);
        assert!(value["stderr"]
            .as_str()
            .unwrap()
            .contains("bad boolean config value"));
    }
    #[test]
    fn transfer_stderr_retains_final_failure_after_long_progress() {
        let mut captured = super::StderrCapture::default();
        for _ in 0..1000 {
            captured.push(b"Receiving objects: 99% (990/1000)\n");
        }
        captured
            .push(b"fatal: Authentication failed for https://user:secret@example.invalid/repo\n");
        let stderr = String::from_utf8_lossy(&captured.finish()).into_owned();
        assert!(stderr.starts_with("[truncated: earlier stderr omitted]"));
        assert!(stderr.ends_with(
            "fatal: Authentication failed for https://[redacted]@example.invalid/repo\n"
        ));
        assert!(stderr.len() <= super::STDERR_CAPTURE_LIMIT + 40);
        let status = crate::process::command("git")
            .args(["invalid-gitthul-command"])
            .output()
            .unwrap()
            .status;
        let value = serde_json::to_value(super::Diagnostic::command_stderr(
            "network.execute",
            &["fetch"],
            status,
            &stderr,
        ))
        .unwrap();
        assert!(value["stderr"]
            .as_str()
            .unwrap()
            .contains("Authentication failed"));
        assert!(!value.to_string().contains("user:secret"));
    }
    #[test]
    fn stderr_capture_redacts_large_private_key_before_tail_truncation() {
        let secret = format!("{}FAKE_PRIVATE_KEY_FOOTER", "A".repeat(20_000));
        let input = format!("-----BEGIN PRIVATE KEY-----\n{secret}\n-----END PRIVATE KEY-----\nfatal: Authentication failed\n");
        let mut capture = super::StderrCapture::default();
        capture.push(input.as_bytes());
        let output = String::from_utf8(capture.finish()).unwrap();
        assert!(output.contains("[redacted private key]"));
        assert!(!output.contains("FAKE_PRIVATE_KEY_FOOTER"));
        assert!(!output.contains("AAAA"));
        assert!(output.ends_with("fatal: Authentication failed\n"));
    }

    #[test]
    fn stderr_capture_tracks_private_key_across_crlf_and_fragmented_chunks() {
        let mut capture = super::StderrCapture::default();
        capture.push(b"before\r\n-----BEGIN RSA PRI");
        let middle = format!(
            "VATE KEY-----\r\n{}FAKE_PRIVATE_KEY_FOOTER\r\n-----END RSA PRI",
            "B".repeat(20_000)
        );
        capture.push(middle.as_bytes());
        capture.push(b"VATE KEY-----\r\nfatal: Authentication failed\r\n");
        let output = String::from_utf8(capture.finish()).unwrap();
        assert!(output.contains("before"));
        assert!(output.contains("[redacted private key]"));
        assert!(!output.contains("FAKE_PRIVATE_KEY_FOOTER"));
        assert!(!output.contains("BBBB"));
        assert!(output.ends_with("fatal: Authentication failed\r\n"));
    }

    #[test]
    fn stderr_capture_redacts_huge_and_fragmented_tokens_before_tail_retention() {
        let mut capture = super::StderrCapture::default();
        capture.push(b"ghp_");
        capture.push(format!("{}FAKETOKENFOOTER", "C".repeat(20_000)).as_bytes());
        capture.push(b"\nfatal: Authentication failed\n");
        let output = String::from_utf8(capture.finish()).unwrap();
        assert!(output.contains("[redacted]"));
        assert!(!output.contains("FAKETOKENFOOTER"));
        assert!(!output.contains("CCCC"));
        assert!(output.ends_with("fatal: Authentication failed\n"));
    }
}

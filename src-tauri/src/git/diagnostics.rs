//! Structured evidence travels with a failure; collecting it never runs extra Git commands.
use crate::log_privacy;
use serde::Serialize;
use std::{
    error::Error,
    fmt, io,
    process::{ExitStatus, Output},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Command {
    program: &'static str,
    args: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Diagnostic {
    pub(super) diagnostic_id: String,
    kind: &'static str,
    stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<Command>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signal: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stderr: Option<String>,
    causes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    io_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_code: Option<i32>,
}

impl Diagnostic {
    pub(super) fn task(stage: &str, error: &tauri::Error) -> Self {
        match error {
            tauri::Error::JoinError(error) => Self::new(
                stage,
                if error.is_cancelled() {
                    "Background task was cancelled"
                } else {
                    "Background task panicked (payload omitted; see runtime.native)"
                },
            ),
            error => Self::cause(stage, error),
        }
    }

    pub(super) fn new(stage: &str, error: impl fmt::Display) -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Self {
            diagnostic_id: format!(
                "native-{}-{at}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ),
            kind: "native",
            stage: log_privacy::bounded(stage, 1000),
            command: None,
            exit_code: None,
            signal: None,
            stderr: None,
            causes: vec![log_privacy::bounded(&error.to_string(), 4000)],
            io_kind: None,
            os_code: None,
        }
    }

    pub(super) fn cause(stage: &str, error: &(dyn Error + 'static)) -> Self {
        let mut result = Self::new(stage, super::diagnostic_privacy::error_message(error));
        let mut source = error.source();
        while let Some(error) = source {
            if result.causes.len() >= 5 {
                result.causes.push("[cause depth limit]".into());
                break;
            }
            result.causes.push(log_privacy::bounded(
                &super::diagnostic_privacy::error_message(error),
                4000,
            ));
            if let Some(error) = error.downcast_ref::<io::Error>() {
                result.io_kind = Some(format!("{:?}", error.kind()));
                result.os_code = error.raw_os_error();
            }
            source = error.source();
        }
        result
    }

    pub(super) fn io(stage: &str, error: &io::Error) -> Self {
        let mut result = Self::cause(stage, error);
        result.kind = "io";
        result.io_kind = Some(format!("{:?}", error.kind()));
        result.os_code = error.raw_os_error();
        result
    }

    pub(super) fn command(stage: &str, args: &[&str], output: &Output) -> Self {
        Self::command_stderr(
            stage,
            args,
            output.status,
            &String::from_utf8_lossy(&output.stderr),
        )
    }

    pub(super) fn command_with_inputs(
        stage: &str,
        args: &[&str],
        output: &Output,
        inputs: &[&str],
    ) -> Self {
        let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let mut inputs = inputs
            .iter()
            .filter(|input| !input.is_empty())
            .collect::<Vec<_>>();
        inputs.sort_by_key(|input| std::cmp::Reverse(input.len()));
        for input in inputs {
            stderr = stderr.replace(*input, "[redacted input]");
        }
        Self::command_stderr(stage, args, output.status, &stderr)
    }

    pub(super) fn command_stderr(
        stage: &str,
        args: &[&str],
        status: ExitStatus,
        stderr: &str,
    ) -> Self {
        let mut result = Self::new(stage, "Git terminó sin completar el paso");
        result.kind = "gitCommand";
        result.command = Some(Command {
            program: "git",
            args: safe_args(args),
        });
        result.exit_code = status.code();
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            result.signal = status.signal();
        }
        result.stderr = Some(bounded_stderr(&mask_inputs(stderr.trim(), args)));
        result
    }

    pub(super) fn with_context(mut self, context: impl fmt::Display) -> Self {
        if self.causes.len() < 6 {
            self.causes
                .push(log_privacy::bounded(&context.to_string(), 4000));
        }
        self
    }

    pub(super) fn command_io(stage: &str, args: &[&str], error: &io::Error) -> Self {
        let mut result = Self::io(stage, error);
        result.command = Some(Command {
            program: "git",
            args: safe_args(args),
        });
        result
    }
}

fn bounded_stderr(value: &str) -> String {
    let value = log_privacy::text(value);
    if value.len() <= 8000 {
        return value;
    }
    let marker = "\n[truncated: middle stderr omitted]\n";
    let mut head = 1500;
    while !value.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = value.len() - (8000 - head - marker.len());
    while !value.is_char_boundary(tail) {
        tail += 1;
    }
    format!("{}{marker}{}", &value[..head], &value[tail..])
}

// Global Git options may consume a value before the actual command name.
fn subcommand<'a>(args: &[&'a str]) -> Option<(usize, &'a str)> {
    let mut skip_value = false;
    for (index, argument) in args.iter().enumerate() {
        if skip_value {
            skip_value = false;
            continue;
        }
        if matches!(
            *argument,
            "-c" | "--config-env" | "-C" | "--git-dir" | "--work-tree" | "--namespace"
        ) {
            skip_value = true;
            continue;
        }
        if !argument.starts_with('-') {
            return Some((index, argument));
        }
    }
    None
}

fn sensitive_inputs<'a>(args: &'a [&'a str]) -> Vec<&'a str> {
    let command = subcommand(args);
    let mainline = command.is_some_and(|(_, name)| matches!(name, "cherry-pick" | "revert"));
    let branch_command = command
        .filter(|(_, name)| matches!(*name, "switch" | "checkout"))
        .map(|(index, _)| index);
    let mut inputs = Vec::new();
    let mut pending = None;
    for (index, argument) in args.iter().enumerate() {
        if let Some(config) = pending.take() {
            let input = if config {
                argument
                    .split_once('=')
                    .map(|(_, value)| value)
                    .unwrap_or(argument)
            } else {
                argument
            };
            if !(mainline && input.parse::<u32>().is_ok()) && !input.is_empty() {
                inputs.push(input);
            }
            continue;
        }
        if matches!(*argument, "user.name" | "user.email")
            && command.is_some_and(|(_, name)| name == "config")
        {
            pending = Some(false);
        } else if matches!(*argument, "-m" | "--message" | "--author" | "--committer") {
            pending = Some(false);
        } else if *argument == "--config-env"
            || (*argument == "-c" && !branch_command.is_some_and(|command| index > command))
        {
            pending = Some(true);
        } else if let Some((key, value)) = argument.split_once('=') {
            if matches!(
                key,
                "--message" | "--author" | "--committer" | "--config-env"
            ) && !value.is_empty()
            {
                inputs.push(value);
            }
        } else if argument.starts_with("-m")
            && argument.len() > 2
            && !(mainline && argument[2..].parse::<u32>().is_ok())
        {
            inputs.push(&argument[2..]);
        }
    }
    inputs
}

fn mask_inputs(value: &str, args: &[&str]) -> String {
    let mut value = value.to_owned();
    let mut inputs = sensitive_inputs(args);
    inputs.sort_by_key(|input| std::cmp::Reverse(input.len()));
    for input in inputs {
        value = value.replace(input, "[redacted input]");
    }
    value
}

fn safe_args(args: &[&str]) -> Vec<String> {
    let command = subcommand(args);
    let mainline = command.is_some_and(|(_, name)| matches!(name, "cherry-pick" | "revert"));
    let branch_command = command
        .filter(|(_, name)| matches!(*name, "switch" | "checkout"))
        .map(|(index, _)| index);
    let mut pending = None;
    let mut found = args
        .iter()
        .take(32)
        .enumerate()
        .map(|(index, argument)| {
            if let Some(config) = pending.take() {
                if config {
                    return argument
                        .split_once('=')
                        .map(|(key, _)| {
                            format!("{}=[redacted argument]", log_privacy::bounded(key, 128))
                        })
                        .unwrap_or("[redacted argument]".into());
                }
                if !(mainline && argument.parse::<u32>().is_ok()) {
                    return "[redacted argument]".into();
                }
            }
            if matches!(*argument, "user.name" | "user.email")
                && command.is_some_and(|(_, name)| name == "config")
            {
                pending = Some(false);
            } else if matches!(*argument, "-m" | "--message" | "--author" | "--committer") {
                pending = Some(false);
            } else if *argument == "--config-env"
                || (*argument == "-c" && !branch_command.is_some_and(|command| index > command))
            {
                pending = Some(true);
            }
            if argument.starts_with("--message=")
                || argument.starts_with("--author=")
                || argument.starts_with("--committer=")
                || argument.starts_with("--config-env=")
                || (argument.starts_with("-m")
                    && argument.len() > 2
                    && !(mainline && argument[2..].parse::<u32>().is_ok()))
            {
                return "[redacted argument]".into();
            }
            log_privacy::bounded(argument, 256)
        })
        .collect::<Vec<_>>();
    if args.len() > 32 {
        found.push("[arguments truncated]".into());
    }
    found
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.stage)?;
        if let Some(command) = &self.command {
            write!(
                formatter,
                "\n{} {}",
                command.program,
                command.args.join(" ")
            )?;
        }
        if let Some(code) = self.exit_code {
            write!(formatter, "\nexitCode={code}")?;
        }
        if let Some(signal) = self.signal {
            write!(formatter, "\nsignal={signal}")?;
        }
        for cause in &self.causes {
            write!(formatter, "\n{cause}")?;
        }
        if let Some(stderr) = &self.stderr {
            if !stderr.is_empty() {
                write!(formatter, "\n{stderr}")?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_exit_stderr_and_safely_masks_free_arguments_without_stdout() {
        let repository = tempfile::tempdir().unwrap();
        let output = crate::process::command("git")
            .args(["rev-parse", "--verify", "refs/heads/missing"])
            .current_dir(repository.path())
            .output()
            .unwrap();
        let diagnostic = Diagnostic::command(
            "resolve revision",
            &[
                "commit",
                "-m",
                "private message",
                "-c",
                "user.email=private@example.invalid",
                "https://u:secret@example.invalid/r",
            ],
            &output,
        );
        let value = serde_json::to_value(&diagnostic).unwrap();
        let text = value.to_string();
        assert_eq!(value["exitCode"], output.status.code().unwrap());
        assert!(text.contains("resolve revision"));
        assert!(
            !text.contains("private message")
                && !text.contains("private@example.invalid")
                && !text.contains("u:secret")
        );
        assert!(value.get("stdout").is_none());
    }
    #[test]
    fn task_failure_preserves_category_without_arbitrary_panic_payload() {
        let error = tauri::async_runtime::block_on(async {
            tauri::async_runtime::spawn_blocking(|| panic!("PRIVATE_PANIC_CONTENT"))
                .await
                .unwrap_err()
        });
        let value = serde_json::to_value(Diagnostic::task("status.task", &error)).unwrap();
        assert_eq!(value["stage"], "status.task");
        assert!(value.to_string().contains("panicked"));
        assert!(!value.to_string().contains("PRIVATE_PANIC_CONTENT"));
    }
    #[test]
    fn preserves_io_kind_and_os_code() {
        let diagnostic =
            Diagnostic::command_io("spawn git", &["status"], &io::Error::from_raw_os_error(2));
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["osCode"], 2);
        assert_eq!(value["ioKind"], "NotFound");
    }
    #[test]
    fn long_stderr_keeps_the_final_failure_and_marks_the_gap() {
        let value = format!(
            "start\n{}\nfatal: cannot update reference",
            "ñ".repeat(12000)
        );
        let bounded = bounded_stderr(&value);
        assert!(bounded.len() <= 8000);
        assert!(bounded.starts_with("start"));
        assert!(bounded.ends_with("fatal: cannot update reference"));
        assert!(bounded.contains("[truncated: middle stderr omitted]"));
    }
    #[test]
    fn protects_echoed_inputs_and_preserves_mainline_and_config_keys() {
        let args = [
            "commit",
            "-m",
            "free private message",
            "-c",
            "credential.helper=private script",
        ];
        let rendered = safe_args(&args).join(" ");
        assert!(rendered.contains("credential.helper="));
        assert!(!rendered.contains("private script"));
        assert_eq!(
            mask_inputs("fatal: free private message private script", &args),
            "fatal: [redacted input] [redacted input]"
        );
        assert_eq!(
            safe_args(&["cherry-pick", "-m", "1", "HEAD"]),
            ["cherry-pick", "-m", "1", "HEAD"]
        );
    }
    #[test]
    fn branch_creation_name_is_diagnostic_evidence_while_global_config_stays_private() {
        let args = [
            "-c",
            "credential.helper=PRIVATE_CREDENTIAL_HELPER",
            "switch",
            "--quiet",
            "-c",
            "rama",
            "HEAD",
        ];
        let safe = safe_args(&args);
        assert_eq!(safe[5], "rama");
        assert!(!safe.join(" ").contains("PRIVATE_CREDENTIAL_HELPER"));
        let misleading = safe_args(&[
            "-c",
            "switch",
            "-c",
            "credential.helper=PRIVATE_CREDENTIAL_HELPER",
            "fetch",
        ]);
        assert!(!misleading.join(" ").contains("PRIVATE_CREDENTIAL_HELPER"));
        assert_eq!(
            mask_inputs("fatal: rama PRIVATE_CREDENTIAL_HELPER", &args),
            "fatal: rama [redacted input]"
        );
        assert_eq!(
            safe_args(&["switch", "--track", "-c", "rama", "origin/main"]),
            ["switch", "--track", "-c", "rama", "origin/main"]
        );
    }
}

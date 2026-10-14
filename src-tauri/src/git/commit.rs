//! Commit y amend revalidados contra HEAD e índice.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;

use super::diagnostics::Diagnostic;
use super::status::{self, CommitPrecondition};

#[derive(Debug, PartialEq, Eq)]
pub enum CommitError {
    GitFailed(String),
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<CommitError>, Diagnostic),
    IdentityMissing,
    Locked,
    NothingStaged,
    Stale,
}

impl CommitError {
    #[cfg(test)]
    fn classification(&self) -> &Self {
        match self {
            Self::WithDiagnostic(error, _) => error.classification(),
            _ => self,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    summary: String,
    body: String,
    #[serde(default)]
    amend: bool,
    #[serde(default)]
    amend_message_only: bool,
    author: Option<Person>,
    precondition: CommitPrecondition,
}

impl CommitRequest {
    pub(super) fn amend(&self) -> bool {
        self.amend
    }

    pub(super) fn summary(&self) -> &str {
        &self.summary
    }
}

#[derive(Debug, Deserialize)]
struct Person {
    name: String,
    email: String,
}

pub fn commit(repository: &Path, request: CommitRequest) -> Result<String, CommitError> {
    if request.summary.trim().is_empty() {
        return Err(CommitError::GitFailed(
            "El resumen del commit está vacío".to_owned(),
        ));
    }

    if request.precondition != status::commit_precondition(repository) {
        return Err(CommitError::Stale);
    }

    if !request.amend && nothing_staged(repository)? {
        return Err(CommitError::NothingStaged);
    }

    let mut command = git_command(repository);
    command.args(["commit", "--file=-", "--cleanup=verbatim"]);
    if request.amend {
        command.arg("--amend");
        if request.amend_message_only {
            command.arg("--only");
        }
    }
    if let Some(author) = &request.author {
        if author.name.trim().is_empty() || author.email.trim().is_empty() {
            return Err(CommitError::IdentityMissing);
        }
        if request.amend {
            command.arg("--reset-author");
        }
        command
            .env("GIT_AUTHOR_NAME", author.name.trim())
            .env("GIT_AUTHOR_EMAIL", author.email.trim())
            .env("GIT_COMMITTER_NAME", author.name.trim())
            .env("GIT_COMMITTER_EMAIL", author.email.trim());
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let args: Vec<String> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut child = command.spawn().map_err(|error| {
        CommitError::Diagnostic(Diagnostic::command_io("commit.spawn", &args, &error))
    })?;
    let message = message(&request.summary, &request.body);
    let input_result = child
        .stdin
        .take()
        .ok_or_else(|| CommitError::GitFailed("Git no abrió la entrada del mensaje".to_owned()))
        .and_then(|mut stdin| {
            stdin.write_all(message.as_bytes()).map_err(|error| {
                CommitError::Diagnostic(Diagnostic::command_io("commit.writeInput", &args, &error))
            })
        });
    // Close stdin and reap Git even if it rejected the message early. Its real
    // failure (for example, missing identity) takes precedence over BrokenPipe.
    let output = child.wait_with_output().map_err(|error| {
        CommitError::Diagnostic(Diagnostic::command_io("commit.wait", &args, &error))
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.trim().is_empty() {
            input_result?;
        }
        let diagnostic = Diagnostic::command_with_inputs(
            "commit.execute",
            &args,
            &output,
            &[request.summary.trim(), request.body.trim(), &message],
        );
        return Err(match classify_failure(&stderr) {
            CommitError::GitFailed(_) => CommitError::Diagnostic(diagnostic),
            error => CommitError::WithDiagnostic(Box::new(error), diagnostic),
        });
    }
    input_result?;

    git_text(repository, &["rev-parse", "--verify", "HEAD"])
}

fn nothing_staged(repository: &Path) -> Result<bool, CommitError> {
    let args = ["diff", "--cached", "--quiet", "--exit-code"];
    let output = git_command(repository)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            CommitError::Diagnostic(Diagnostic::command_io("commit.checkIndex", &args, &error))
        })?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(CommitError::Diagnostic(Diagnostic::command(
            "commit.checkIndex",
            &args,
            &output,
        ))),
    }
}

fn message(summary: &str, body: &str) -> String {
    let summary = summary.trim();
    let body = body.trim();
    if body.is_empty() {
        format!("{summary}\n")
    } else {
        format!("{summary}\n\n{body}\n")
    }
}

fn classify_failure(stderr: &str) -> CommitError {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("author identity unknown")
        || lower.contains("unable to auto-detect email address")
        || lower.contains("empty ident name")
    {
        CommitError::IdentityMissing
    } else if lower.contains("index.lock") || lower.contains("another git process") {
        CommitError::Locked
    } else if lower.contains("nothing to commit") || lower.contains("no changes added to commit") {
        CommitError::NothingStaged
    } else {
        CommitError::GitFailed(stderr.trim().to_owned())
    }
}

fn git_text(repository: &Path, args: &[&str]) -> Result<String, CommitError> {
    let output = git_command(repository)
        .args(args)
        .output()
        .map_err(|error| {
            CommitError::Diagnostic(Diagnostic::command_io("commit.readHead", args, &error))
        })?;
    if !output.status.success() {
        return Err(CommitError::Diagnostic(Diagnostic::command(
            "commit.readHead",
            args,
            &output,
        )));
    }
    String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|error| CommitError::Diagnostic(Diagnostic::new("commit.decodeHead", error)))
}

fn git_command(repository: &Path) -> Command {
    let mut command = crate::process::command("git");
    command
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("LC_ALL", "C");
    command
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{commit, CommitError, CommitRequest, Person};
    use crate::git::status;

    fn repository(with_identity: bool) -> TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        if with_identity {
            git(temporary.path(), &["config", "user.name", "GitThul"]);
            git(
                temporary.path(),
                &["config", "user.email", "gitthul@example.invalid"],
            );
        }
        temporary
    }

    fn git(repository: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("LC_ALL", "C")
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn output(repository: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("LC_ALL", "C")
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap()
    }

    fn request(repository: &Path, amend: bool) -> CommitRequest {
        CommitRequest {
            summary: "P2.4: commit real".to_owned(),
            body: "Primera línea.\n\nSegunda línea.".to_owned(),
            amend,
            amend_message_only: false,
            author: None,
            precondition: status::commit_precondition(repository),
        }
    }

    fn stage(repository: &Path, contents: &str) {
        fs::write(repository.join("archivo.txt"), contents).unwrap();
        git(repository, &["add", "archivo.txt"]);
    }

    #[test]
    fn commit_manual_completa_merge_resuelto_con_ambos_padres() {
        let temporary = repository(true);
        let path = temporary.path();
        stage(path, "base\n");
        git(path, &["commit", "--quiet", "-m", "base"]);
        git(path, &["checkout", "--quiet", "-b", "feature"]);
        stage(path, "feature\n");
        git(path, &["commit", "--quiet", "-m", "feature"]);
        let source = output(path, &["rev-parse", "HEAD"]).trim().to_owned();
        git(path, &["checkout", "--quiet", "main"]);
        stage(path, "main\n");
        git(path, &["commit", "--quiet", "-m", "main"]);
        let target = output(path, &["rev-parse", "HEAD"]).trim().to_owned();
        let merge = Command::new("git")
            .current_dir(path)
            .args(["merge", "--no-edit", "feature"])
            .output()
            .unwrap();
        assert!(!merge.status.success());
        stage(path, "resuelto\n");
        assert!(path.join(".git/MERGE_HEAD").exists());
        assert_eq!(output(path, &["rev-parse", "HEAD"]).trim(), target);

        commit(path, request(path, false)).unwrap();

        assert_eq!(
            output(path, &["show", "-s", "--format=%P", "HEAD"]).trim(),
            format!("{target} {source}")
        );
        assert!(!path.join(".git/MERGE_HEAD").exists());
        assert!(output(path, &["status", "--porcelain"]).is_empty());
    }

    #[test]
    fn crea_el_primer_commit_con_el_arbol_y_mensaje_exactos() {
        let temporary = repository(true);
        stage(temporary.path(), "uno\n");

        let sha = commit(temporary.path(), request(temporary.path(), false)).unwrap();

        assert_eq!(output(temporary.path(), &["rev-parse", "HEAD"]).trim(), sha);
        assert_eq!(
            output(temporary.path(), &["show", "-s", "--format=%B", "HEAD"]),
            "P2.4: commit real\n\nPrimera línea.\n\nSegunda línea.\n\n"
        );
        assert!(output(temporary.path(), &["diff", "--cached"]).is_empty());
    }

    #[test]
    fn amend_conserva_padres_y_autor_y_cambia_el_committer() {
        let temporary = repository(true);
        stage(temporary.path(), "uno\n");
        let first = commit(temporary.path(), request(temporary.path(), false)).unwrap();
        git(temporary.path(), &["config", "user.name", "Otra persona"]);
        git(
            temporary.path(),
            &["config", "user.email", "otra@example.invalid"],
        );
        stage(temporary.path(), "uno\ndos\n");

        let amended = commit(temporary.path(), request(temporary.path(), true)).unwrap();

        assert_ne!(amended, first);
        assert_eq!(
            output(
                temporary.path(),
                &["show", "-s", "--format=%an|%ae", "HEAD"]
            ),
            "GitThul|gitthul@example.invalid\n"
        );
        assert_eq!(
            output(
                temporary.path(),
                &["show", "-s", "--format=%cn|%ce", "HEAD"]
            ),
            "Otra persona|otra@example.invalid\n"
        );
        assert!(
            output(temporary.path(), &["show", "-s", "--format=%P", "HEAD"])
                .trim()
                .is_empty()
        );
    }

    #[test]
    fn amend_solo_de_mensaje_funciona_sin_cambios_preparados() {
        let temporary = repository(true);
        stage(temporary.path(), "uno\n");
        commit(temporary.path(), request(temporary.path(), false)).unwrap();
        let mut amend = request(temporary.path(), true);
        amend.summary = "P2.4: mensaje corregido".to_owned();

        commit(temporary.path(), amend).unwrap();

        assert_eq!(
            output(temporary.path(), &["show", "-s", "--format=%s", "HEAD"]),
            "P2.4: mensaje corregido\n"
        );
    }

    #[test]
    fn amend_solo_mensaje_conserva_indice_y_worktree() {
        let temporary = repository(true);
        let root = temporary.path();
        stage(root, "original\n");
        commit(root, request(root, false)).unwrap();
        let tree = output(root, &["rev-parse", "HEAD^{tree}"]);
        stage(root, "preparado\n");
        fs::write(root.join("archivo.txt"), "sin preparar\n").unwrap();
        let index = output(root, &["write-tree"]);
        let status = output(root, &["status", "--porcelain"]);
        let mut amend = request(root, true);
        amend.amend_message_only = true;
        amend.body = "descripción larga\n".repeat(40);
        commit(root, amend).unwrap();
        assert_eq!(output(root, &["rev-parse", "HEAD^{tree}"]), tree);
        assert_eq!(output(root, &["write-tree"]), index);
        assert_eq!(output(root, &["status", "--porcelain"]), status);
        assert!(output(root, &["show", "-s", "--format=%B", "HEAD"])
            .contains(&"descripción larga\n".repeat(40).trim().to_owned()));
        assert_eq!(
            fs::read_to_string(root.join("archivo.txt")).unwrap(),
            "sin preparar\n"
        );
    }

    #[test]
    fn el_perfil_explicito_suple_la_configuracion_ausente() {
        let temporary = repository(false);
        stage(temporary.path(), "uno\n");
        let mut request = request(temporary.path(), false);
        request.author = Some(Person {
            name: "Ada Márquez".to_owned(),
            email: "ada@example.invalid".to_owned(),
        });

        commit(temporary.path(), request).unwrap();

        assert_eq!(
            output(
                temporary.path(),
                &["show", "-s", "--format=%an|%ae|%cn|%ce", "HEAD"]
            ),
            "Ada Márquez|ada@example.invalid|Ada Márquez|ada@example.invalid\n"
        );
    }

    #[test]
    fn el_perfil_elegido_tambien_es_el_autor_al_enmendar() {
        let temporary = repository(true);
        let root = temporary.path();
        stage(root, "one\n");
        commit(root, request(root, false)).unwrap();
        let mut amend = request(root, true);
        amend.author = Some(Person {
            name: "Selected".into(),
            email: "selected@example.invalid".into(),
        });
        commit(root, amend).unwrap();
        assert_eq!(
            output(root, &["show", "-s", "--format=%an|%ae|%cn|%ce", "HEAD"]),
            "Selected|selected@example.invalid|Selected|selected@example.invalid\n"
        );
    }

    #[test]
    fn rechaza_identidad_ausente_y_un_indice_vacio() {
        let without_identity = repository(false);
        git(without_identity.path(), &["config", "user.name", ""]);
        git(without_identity.path(), &["config", "user.email", ""]);
        stage(without_identity.path(), "uno\n");
        assert_eq!(
            commit(
                without_identity.path(),
                request(without_identity.path(), false)
            )
            .unwrap_err()
            .classification(),
            &CommitError::IdentityMissing
        );

        let empty = repository(true);
        assert_eq!(
            commit(empty.path(), request(empty.path(), false)),
            Err(CommitError::NothingStaged)
        );
    }

    #[test]
    fn conserva_error_de_identidad_si_git_cierra_stdin_antes_del_mensaje_largo() {
        let temporary = repository(true);
        let root = temporary.path();
        stage(root, "original\n");
        git(root, &["commit", "--quiet", "-m", "base"]);
        stage(root, "preparado\n");
        fs::write(root.join("archivo.txt"), "sin preparar\n").unwrap();
        git(root, &["config", "user.name", ""]);
        git(root, &["config", "user.email", ""]);

        let head = output(root, &["rev-parse", "HEAD"]);
        // Stabilize Git's cache-tree extension before comparing index bytes.
        let index_tree = output(root, &["write-tree"]);
        let index = fs::read(root.join(".git/index")).unwrap();
        let worktree = fs::read(root.join("archivo.txt")).unwrap();
        let staged_diff = output(root, &["diff", "--cached", "--binary"]);
        let unstaged_diff = output(root, &["diff", "--binary"]);
        let mut input = request(root, false);
        // Exceeds pipe capacity so Git's early identity failure closes stdin
        // while write_all is still sending, independent of process scheduling.
        input.body = "mensaje largo\n".repeat(512 * 1024);

        assert_eq!(
            commit(root, input).unwrap_err().classification(),
            &CommitError::IdentityMissing
        );

        assert_eq!(output(root, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
        assert_eq!(output(root, &["write-tree"]), index_tree);
        assert_eq!(fs::read(root.join("archivo.txt")).unwrap(), worktree);
        assert_eq!(output(root, &["diff", "--cached", "--binary"]), staged_diff);
        assert_eq!(output(root, &["diff", "--binary"]), unstaged_diff);
        assert!(!root.join(".git/index.lock").exists());
    }

    #[cfg(unix)]
    #[test]
    fn conserva_error_de_stdin_si_un_hook_rechaza_el_commit_sin_stderr() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = repository(true);
        let root = temporary.path();
        stage(root, "preparado\n");
        let hook = root.join(".git/hooks/pre-commit");
        fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        let mut input = request(root, false);
        input.body = "mensaje largo\n".repeat(512 * 1024);

        assert!(matches!(
            commit(root, input),
            Err(CommitError::Diagnostic(diagnostic))
                if serde_json::to_value(&diagnostic).unwrap()["stage"] == "commit.writeInput"
        ));
        assert!(!root.join(".git/index.lock").exists());
    }

    #[test]
    fn rechaza_head_o_indice_obsoletos_antes_de_escribir() {
        let temporary = repository(true);
        stage(temporary.path(), "uno\n");
        let stale = request(temporary.path(), false);
        stage(temporary.path(), "dos\n");

        assert_eq!(commit(temporary.path(), stale), Err(CommitError::Stale));
        assert!(!Command::new("git")
            .current_dir(temporary.path())
            .args(["rev-parse", "--verify", "HEAD"])
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn rechaza_un_head_obsoleto_aunque_el_arbol_del_indice_coincida() {
        let temporary = repository(true);
        stage(temporary.path(), "uno\n");
        commit(temporary.path(), request(temporary.path(), false)).unwrap();
        stage(temporary.path(), "dos\n");
        let stale = request(temporary.path(), false);
        git(temporary.path(), &["commit", "--quiet", "-m", "externo"]);

        assert_eq!(commit(temporary.path(), stale), Err(CommitError::Stale));
    }

    #[cfg(unix)]
    #[test]
    fn ejecuta_los_hooks_del_git_instalado() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = repository(true);
        stage(temporary.path(), "uno\n");
        let hook = temporary.path().join(".git/hooks/pre-commit");
        fs::write(&hook, "#!/bin/sh\nprintf ejecutado > .git/hook-ejecutado\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

        commit(temporary.path(), request(temporary.path(), false)).unwrap();

        assert_eq!(
            fs::read_to_string(temporary.path().join(".git/hook-ejecutado")).unwrap(),
            "ejecutado"
        );
    }
    #[test]
    fn identity_failure_keeps_diagnostic_without_commit_message_or_body() {
        let temporary = repository(false);
        let root = temporary.path();
        git(root, &["config", "user.name", ""]);
        git(root, &["config", "user.email", ""]);
        stage(root, "PRIVATE_FILE_CONTENT\n");
        let mut input = request(root, false);
        input.summary = "PRIVATE_COMMIT_SUMMARY".into();
        input.body = "PRIVATE_COMMIT_BODY".into();
        let error = commit(root, input).unwrap_err();
        assert_eq!(error.classification(), &CommitError::IdentityMissing);
        let CommitError::WithDiagnostic(_, diagnostic) = error else {
            panic!("Missing diagnostic");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        let text = value.to_string();
        assert_eq!(value["stage"], "commit.execute");
        assert_eq!(value["exitCode"], 128);
        assert!(text.contains("Author identity unknown"));
        assert!(!text.contains("PRIVATE_COMMIT_SUMMARY"));
        assert!(!text.contains("PRIVATE_COMMIT_BODY"));
        assert!(!text.contains("PRIVATE_FILE_CONTENT"));
        assert!(value.get("stdout").is_none());
    }
    #[cfg(unix)]
    #[test]
    fn commit_hook_cannot_expose_free_message_inputs_through_stderr() {
        use std::os::unix::fs::PermissionsExt;
        let temporary = repository(true);
        let root = temporary.path();
        stage(root, "private file contents\n");
        let hook = root.join(".git/hooks/commit-msg");
        fs::write(
            &hook,
            "#!/bin/sh\ncat \"$1\" >&2\nprintf '\\ncommit message rejected\\n' >&2\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        let mut input = request(root, false);
        input.summary = "PRIVATE_COMMIT_SUMMARY".into();
        input.body = "PRIVATE_COMMIT_BODY".into();
        let error = commit(root, input).unwrap_err();
        let CommitError::Diagnostic(diagnostic) = error else {
            panic!("Unexpected classification: {error:?}");
        };
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["exitCode"], 1);
        assert!(value["stderr"]
            .as_str()
            .unwrap()
            .contains("commit message rejected"));
        assert!(!value.to_string().contains("PRIVATE_COMMIT_SUMMARY"));
        assert!(!value.to_string().contains("PRIVATE_COMMIT_BODY"));
        assert!(value.get("stdout").is_none());
    }
}

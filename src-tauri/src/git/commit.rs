//! Commit y amend revalidados contra HEAD e índice.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;

use super::status::{self, CommitPrecondition};

#[derive(Debug, PartialEq, Eq)]
pub enum CommitError {
    GitFailed(String),
    IdentityMissing,
    Locked,
    NothingStaged,
    Stale,
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

    let mut child = command.spawn().map_err(|error| {
        CommitError::GitFailed(format!("No se pudo iniciar git commit: {error}"))
    })?;
    let message = message(&request.summary, &request.body);
    child
        .stdin
        .take()
        .ok_or_else(|| CommitError::GitFailed("Git no abrió la entrada del mensaje".to_owned()))?
        .write_all(message.as_bytes())
        .map_err(|error| {
            CommitError::GitFailed(format!("No se pudo enviar el mensaje: {error}"))
        })?;
    let output = child.wait_with_output().map_err(|error| {
        CommitError::GitFailed(format!("Git no devolvió un resultado: {error}"))
    })?;
    if !output.status.success() {
        return Err(classify_failure(&String::from_utf8_lossy(&output.stderr)));
    }

    git_text(repository, &["rev-parse", "--verify", "HEAD"]).ok_or_else(|| {
        CommitError::GitFailed("Git creó el commit pero HEAD no se pudo leer".to_owned())
    })
}

fn nothing_staged(repository: &Path) -> Result<bool, CommitError> {
    let status = git_command(repository)
        .args(["diff", "--cached", "--quiet", "--exit-code"])
        .status()
        .map_err(|error| {
            CommitError::GitFailed(format!("No se pudo comparar el índice: {error}"))
        })?;
    match status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(CommitError::GitFailed(
            "Git no pudo comparar el índice con HEAD".to_owned(),
        )),
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

fn git_text(repository: &Path, args: &[&str]) -> Option<String> {
    let output = git_command(repository).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8(output.stdout).ok()?.trim().to_owned())
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
            ),
            Err(CommitError::IdentityMissing)
        );

        let empty = repository(true);
        assert_eq!(
            commit(empty.path(), request(empty.path(), false)),
            Err(CommitError::NothingStaged)
        );
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
}

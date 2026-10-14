//! Vista previa de integración entre dos referencias sin modificar el repositorio.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use super::{diagnostics::Diagnostic, history};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationKind {
    Merge,
    Rebase,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPreview {
    kind: IntegrationKind,
    source: String,
    target: String,
    commits: Vec<history::Commit>,
    fast_forward: bool,
    conflicts: Option<Vec<String>>,
    precondition: IntegrationPrecondition,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationPrecondition {
    source_ref: String,
    target_ref: String,
    source_oid: String,
    target_oid: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadPreviewError {
    Diagnostic(Diagnostic),
    WithDiagnostic(Box<Self>, Diagnostic),
    Cancelled,
    InvalidEncoding,
    RevisionNotFound(String),
    MalformedOutput,
}

pub fn read(
    path: &Path,
    kind: IntegrationKind,
    source: String,
    target: String,
    cancelled: &AtomicBool,
) -> Result<IntegrationPreview, ReadPreviewError> {
    let repo = gix::open(path).map_err(|error| {
        ReadPreviewError::Diagnostic(Diagnostic::cause("preview.openRepository", &error))
    })?;
    let source_id = history::resolve_commit(&repo, &source)
        .map_err(|error| map_revision_error(error, &source))?;
    let target_id = history::resolve_commit(&repo, &target)
        .map_err(|error| map_revision_error(error, &target))?;

    if cancelled.load(Ordering::Relaxed) {
        return Err(ReadPreviewError::Cancelled);
    }

    let source_only = commits_between(path, source_id, target_id)?;
    let target_only = commits_between(path, target_id, source_id)?;
    let fast_forward = target_only.is_empty();
    let selected = match kind {
        IntegrationKind::Merge => source_only,
        IntegrationKind::Rebase => target_only,
    };
    let mut commits = Vec::with_capacity(selected.len());
    for id in selected {
        if cancelled.load(Ordering::Relaxed) {
            return Err(ReadPreviewError::Cancelled);
        }
        commits.push(history::read_commit(&repo, id).map_err(map_history_error)?);
    }

    Ok(IntegrationPreview {
        kind,
        source: source.clone(),
        target: target.clone(),
        commits,
        fast_forward,
        // Predecir conflictos con fidelidad exige ejecutar la estrategia de integración. La
        // lectura no escribe objetos ni índice, así que solo afirma ausencia en avance rápido.
        conflicts: fast_forward.then(Vec::new),
        precondition: IntegrationPrecondition {
            source_ref: source,
            target_ref: target,
            source_oid: source_id.to_string(),
            target_oid: target_id.to_string(),
        },
    })
}

fn commits_between(
    path: &Path,
    included: gix::ObjectId,
    excluded: gix::ObjectId,
) -> Result<Vec<gix::ObjectId>, ReadPreviewError> {
    let included = included.to_string();
    let excluded = excluded.to_string();
    let args = ["rev-list", "--topo-order", &included, "--not", &excluded];
    let output = crate::process::command("git")
        .args(args)
        .current_dir(path)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .map_err(|error| {
            ReadPreviewError::Diagnostic(Diagnostic::command_io(
                "preview.listCommits",
                &args,
                &error,
            ))
        })?;
    if !output.status.success() {
        return Err(ReadPreviewError::Diagnostic(Diagnostic::command(
            "preview.listCommits",
            &args,
            &output,
        )));
    }
    output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| gix::ObjectId::from_hex(line).map_err(|_| ReadPreviewError::MalformedOutput))
        .collect()
}

fn map_history_error(error: history::ReadHistoryError) -> ReadPreviewError {
    match error {
        history::ReadHistoryError::Diagnostic(diagnostic) => {
            ReadPreviewError::Diagnostic(diagnostic)
        }
        history::ReadHistoryError::WithDiagnostic(error, diagnostic) => {
            ReadPreviewError::WithDiagnostic(Box::new(map_history_error(*error)), diagnostic)
        }
        history::ReadHistoryError::Cancelled => ReadPreviewError::Cancelled,
        history::ReadHistoryError::InvalidEncoding => ReadPreviewError::InvalidEncoding,
        history::ReadHistoryError::StartNotFound => ReadPreviewError::MalformedOutput,
    }
}

fn map_revision_error(error: history::ReadHistoryError, revision: &str) -> ReadPreviewError {
    match error {
        history::ReadHistoryError::StartNotFound => {
            ReadPreviewError::RevisionNotFound(revision.to_owned())
        }
        history::ReadHistoryError::WithDiagnostic(error, diagnostic) => {
            ReadPreviewError::WithDiagnostic(
                Box::new(map_revision_error(*error, revision)),
                diagnostic,
            )
        }
        error => map_history_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(path: &Path, args: &[&str]) -> String {
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

    fn commit(path: &Path, file: &str, message: &str) -> String {
        fs::write(path.join(file), format!("{message}\n")).unwrap();
        git(path, &["add", file]);
        git(path, &["commit", "--quiet", "-m", message]);
        git(path, &["rev-parse", "HEAD"])
    }

    fn divergent_repository() -> tempfile::TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        commit(temporary.path(), "base.txt", "base");
        git(temporary.path(), &["branch", "feature"]);
        commit(temporary.path(), "main.txt", "main uno");
        git(temporary.path(), &["switch", "--quiet", "feature"]);
        commit(temporary.path(), "feature.txt", "feature uno");
        commit(temporary.path(), "feature.txt", "feature dos");
        git(temporary.path(), &["switch", "--quiet", "main"]);
        temporary
    }

    #[test]
    fn contrasta_ambos_lados_con_rev_list_sin_escribir() {
        let temporary = divergent_repository();
        let before_refs = git(temporary.path(), &["show-ref"]);
        let before_objects = git(temporary.path(), &["count-objects", "-v"]);
        let cancelled = AtomicBool::new(false);

        let merge = read(
            temporary.path(),
            IntegrationKind::Merge,
            "feature".into(),
            "main".into(),
            &cancelled,
        )
        .unwrap();
        let rebase = read(
            temporary.path(),
            IntegrationKind::Rebase,
            "feature".into(),
            "main".into(),
            &cancelled,
        )
        .unwrap();

        let expected_merge = git(
            temporary.path(),
            &["rev-list", "--topo-order", "feature", "--not", "main"],
        );
        let expected_rebase = git(
            temporary.path(),
            &["rev-list", "--topo-order", "main", "--not", "feature"],
        );

        assert_eq!(
            merge
                .commits
                .iter()
                .map(|commit| commit.sha.as_str())
                .collect::<Vec<_>>(),
            expected_merge.lines().collect::<Vec<_>>()
        );
        assert_eq!(
            rebase
                .commits
                .iter()
                .map(|commit| commit.sha.as_str())
                .collect::<Vec<_>>(),
            expected_rebase.lines().collect::<Vec<_>>()
        );
        assert!(!merge.fast_forward);
        assert_eq!(merge.conflicts, None);
        assert_eq!(git(temporary.path(), &["show-ref"]), before_refs);
        assert_eq!(
            git(temporary.path(), &["count-objects", "-v"]),
            before_objects
        );
    }

    #[test]
    fn reconoce_avance_rapido_y_no_promete_conflictos_en_divergencia() {
        let temporary = divergent_repository();
        let cancelled = AtomicBool::new(false);
        git(temporary.path(), &["branch", "behind", "main~1"]);

        let preview = read(
            temporary.path(),
            IntegrationKind::Merge,
            "main".into(),
            "behind".into(),
            &cancelled,
        )
        .unwrap();

        assert!(preview.fast_forward);
        assert_eq!(preview.conflicts, Some(Vec::new()));
        assert_eq!(preview.commits.len(), 1);
    }

    #[test]
    fn distingue_revision_inexistente_y_cancelacion() {
        let temporary = divergent_repository();
        let active = AtomicBool::new(false);
        let missing = read(
            temporary.path(),
            IntegrationKind::Merge,
            "no-existe".into(),
            "main".into(),
            &active,
        )
        .unwrap_err();
        let ReadPreviewError::WithDiagnostic(classification, diagnostic) = missing else {
            panic!("expected classified diagnostic")
        };
        assert_eq!(
            *classification,
            ReadPreviewError::RevisionNotFound("no-existe".into())
        );
        assert_eq!(
            serde_json::to_value(diagnostic).unwrap()["stage"],
            "history.resolveStart"
        );

        let cancelled = AtomicBool::new(true);
        let error = read(
            temporary.path(),
            IntegrationKind::Merge,
            "feature".into(),
            "main".into(),
            &cancelled,
        )
        .unwrap_err();
        assert_eq!(error, ReadPreviewError::Cancelled);
    }
}

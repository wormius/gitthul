//! Ciclo de vida de worktrees enlazados. Git conserva las protecciones de datos y bloqueo.
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, State};

use super::{ref_write::RefTarget, refs, GitCommandError, GitWriteLocks, RepoSummary};

#[derive(Default, Deserialize)]
pub struct RemoveOptions {
    #[serde(default)]
    force: bool,
}

fn run(repository: &Path, args: &[&str]) -> Result<Output, GitCommandError> {
    Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| GitCommandError::internal("No se pudo ejecutar Git para gestionar worktrees"))
}

fn successful(repository: &Path, args: &[&str]) -> Result<(), GitCommandError> {
    let output = run(repository, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(GitCommandError::git(
            "unknown",
            json!({}),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ))
    }
}

fn list(repository: &Path) -> Result<Vec<refs::Worktree>, GitCommandError> {
    refs::read_worktrees(repository)
        .map_err(|_| GitCommandError::internal("No se pudieron leer los worktrees"))
}

fn create(repository: &Path, path: &str, branch: &RefTarget) -> Result<(), GitCommandError> {
    if !Path::new(path).is_absolute() {
        return Err(GitCommandError::internal(
            "La carpeta del worktree debe ser una ruta absoluta",
        ));
    }
    if Path::new(path).exists()
        && std::fs::read_dir(path).map_or(true, |mut entries| entries.next().is_some())
    {
        return Err(GitCommandError::new(
            "worktree.pathNotEmpty",
            json!({ "path": path }),
        ));
    }
    match branch {
        RefTarget::Branch { name } => {
            // No permitir opciones ni la sintaxis @{-1} que expande check-ref-format --branch.
            if name.starts_with('-') || name == "HEAD" {
                return Err(GitCommandError::internal("Nombre de rama no válido"));
            }
            successful(
                repository,
                &["check-ref-format", &format!("refs/heads/{name}")],
            )?;
            if let Some(taken) = list(repository)?.iter().find(|entry| entry.branch == *name) {
                return Err(GitCommandError::new(
                    "worktree.branchInUse",
                    json!({ "branch": name, "path": taken.path }),
                ));
            }
            let exists = run(
                repository,
                &["show-ref", "--verify", "--quiet", &branch.revision()],
            )?;
            match exists.status.code() {
                Some(0) => successful(repository, &["worktree", "add", "--", path, name]),
                Some(1) => successful(
                    repository,
                    &["worktree", "add", "-b", name, "--", path, "HEAD"],
                ),
                _ => Err(GitCommandError::internal("No se pudo consultar la rama")),
            }
        }
        _ => successful(
            repository,
            &[
                "worktree",
                "add",
                "--detach",
                "--",
                path,
                &branch.revision(),
            ],
        ),
    }
}

fn target(repository: &Path, path: &str) -> Result<refs::Worktree, GitCommandError> {
    // Se usa la ruta completa del listado, nunca el nombre abreviado aceptado por Git.
    let entry = list(repository)?
        .into_iter()
        .find(|entry| entry.path == path)
        .ok_or_else(|| {
            GitCommandError::internal("El worktree ya no pertenece a este repositorio")
        })?;
    if entry.is_main {
        return Err(GitCommandError::internal(
            "No se puede quitar ni bloquear el worktree principal",
        ));
    }
    Ok(entry)
}

fn remove(repository: &Path, path: &str, options: &RemoveOptions) -> Result<(), GitCommandError> {
    let entry = target(repository, path)?;
    if entry.locked {
        return Err(GitCommandError::internal(
            "Desbloquea el worktree antes de quitarlo",
        ));
    }
    if std::fs::canonicalize(repository).ok() == std::fs::canonicalize(path).ok() {
        return Err(GitCommandError::internal(
            "Abre otro worktree antes de quitar el actual",
        ));
    }
    if options.force {
        successful(repository, &["worktree", "remove", "--force", "--", path])
    } else {
        successful(repository, &["worktree", "remove", "--", path])
    }
}

fn lock(repository: &Path, path: &str, locked: bool) -> Result<(), GitCommandError> {
    let entry = target(repository, path)?;
    if entry.locked == locked {
        return Ok(());
    }
    successful(
        repository,
        &[
            "worktree",
            if locked { "lock" } else { "unlock" },
            "--",
            path,
        ],
    )
}

fn snapshot(repository: &Path) -> Result<refs::RefsSnapshot, GitCommandError> {
    refs::read(repository)
        .map_err(|_| GitCommandError::internal("No se pudieron actualizar las referencias"))
}

fn repository_path(id: &str) -> Result<PathBuf, GitCommandError> {
    super::existing_repository(id)
}

#[tauri::command]
pub async fn git_create_worktree(
    app: AppHandle,
    id: String,
    path: String,
    branch: RefTarget,
    locks: State<'_, GitWriteLocks>,
) -> Result<RepoSummary, GitCommandError> {
    let repository = repository_path(&id)?;
    let mutex = locks.repository(&id);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = mutex.lock().unwrap_or_else(|error| error.into_inner());
        create(&repository, &path, &branch)?;
        let mut created = super::repository::discover(&path)
            .map_err(|_| GitCommandError::internal("No se pudo leer el worktree creado"))?;
        created.last_opened_at = Some(super::now_millis());
        let summary = created.summary();
        let mut registry = super::read_registry(&app)?;
        registry.repositories.retain(|entry| entry.id != summary.id);
        registry.repositories.push(summary.clone());
        registry.sort();
        super::write_registry(&app, &registry)?;
        Ok(summary)
    })
    .await
    .map_err(|_| GitCommandError::internal("La creación del worktree se interrumpió"))?
}

#[tauri::command]
pub async fn git_remove_worktree(
    app: AppHandle,
    id: String,
    path: String,
    options: Option<RemoveOptions>,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = repository_path(&id)?;
    let mutex = locks.repository(&id);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = mutex.lock().unwrap_or_else(|error| error.into_inner());
        remove(&repository, &path, &options.unwrap_or_default()).map_err(|error| {
            GitCommandError::git(
                "worktree.removeFailed",
                json!({ "path": path }),
                error.output.unwrap_or_default(),
            )
        })?;
        let mut registry = super::read_registry(&app)?;
        registry.repositories.retain(|entry| entry.path != path);
        super::write_registry(&app, &registry)?;
        snapshot(&repository)
    })
    .await
    .map_err(|_| GitCommandError::internal("La eliminación del worktree se interrumpió"))?
}

#[tauri::command]
pub async fn git_lock_worktree(
    id: String,
    path: String,
    locked: bool,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = repository_path(&id)?;
    let mutex = locks.repository(&id);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = mutex.lock().unwrap_or_else(|error| error.into_inner());
        lock(&repository, &path, locked)?;
        snapshot(&repository)
    })
    .await
    .map_err(|_| GitCommandError::internal("El bloqueo del worktree se interrumpió"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        successful(root.path(), &["init", "-b", "main"]).unwrap();
        successful(
            root.path(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        root
    }

    fn branch(name: &str) -> RefTarget {
        RefTarget::Branch { name: name.into() }
    }

    #[test]
    fn creates_new_and_existing_branches_and_preserves_history_on_remove() {
        let root = fixture();
        let destination = tempfile::tempdir().unwrap();
        let path = destination.path().join("linked with spaces");
        let path = path.to_str().unwrap();
        create(root.path(), path, &branch("topic")).unwrap();
        let discovered = super::super::repository::discover(path).unwrap();
        assert_eq!(discovered.head, "topic");
        assert!(discovered.worktree_of.is_some());
        remove(root.path(), path, &RemoveOptions::default()).unwrap();
        assert!(!Path::new(path).exists());
        successful(root.path(), &["show-ref", "--verify", "refs/heads/topic"]).unwrap();
        create(root.path(), path, &branch("topic")).unwrap();
        assert_eq!(list(root.path()).unwrap().len(), 2);
    }

    #[test]
    fn refuses_occupied_branch_nonempty_path_and_invalid_names() {
        let root = fixture();
        let destination = tempfile::tempdir().unwrap();
        let path = destination.path().join("linked");
        let path = path.to_str().unwrap();
        assert_eq!(
            create(root.path(), path, &branch("main")).unwrap_err().code,
            "worktree.branchInUse"
        );
        for name in ["--force", "../bad", "@{-1}", "HEAD"] {
            assert!(create(root.path(), path, &branch(name)).is_err());
        }
        std::fs::create_dir(path).unwrap();
        std::fs::write(Path::new(path).join("keep"), "user data").unwrap();
        assert_eq!(
            create(root.path(), path, &branch("topic"))
                .unwrap_err()
                .code,
            "worktree.pathNotEmpty"
        );
        assert_eq!(
            std::fs::read_to_string(Path::new(path).join("keep")).unwrap(),
            "user data"
        );
    }

    #[test]
    fn protects_dirty_locked_main_current_and_unrelated_worktrees() {
        let root = fixture();
        let destination = tempfile::tempdir().unwrap();
        let path = destination.path().join("linked");
        let path = path.to_str().unwrap();
        create(root.path(), path, &branch("topic")).unwrap();
        lock(root.path(), path, true).unwrap();
        lock(root.path(), path, true).unwrap();
        assert!(target(root.path(), path).unwrap().locked);
        assert!(remove(root.path(), path, &RemoveOptions { force: true }).is_err());
        lock(root.path(), path, false).unwrap();
        std::fs::write(Path::new(path).join("untracked"), "keep").unwrap();
        assert!(remove(root.path(), path, &RemoveOptions::default()).is_err());
        assert!(Path::new(path).join("untracked").exists());
        assert!(remove(
            root.path(),
            root.path().to_str().unwrap(),
            &RemoveOptions::default()
        )
        .is_err());
        assert!(remove(Path::new(path), path, &RemoveOptions { force: true }).is_err());
        let unrelated = fixture();
        assert!(remove(
            root.path(),
            unrelated.path().to_str().unwrap(),
            &RemoveOptions { force: true }
        )
        .is_err());
        assert!(lock(root.path(), root.path().to_str().unwrap(), true).is_err());
        std::fs::remove_file(Path::new(path).join("untracked")).unwrap();
        remove(root.path(), path, &RemoveOptions::default()).unwrap();
    }

    #[test]
    fn creates_detached_worktree_and_serializes_siblings() {
        let root = fixture();
        let destination = tempfile::tempdir().unwrap();
        let path = destination.path().join("linked");
        let path = path.to_str().unwrap();
        let sha =
            String::from_utf8(run(root.path(), &["rev-parse", "HEAD"]).unwrap().stdout).unwrap();
        create(
            root.path(),
            path,
            &RefTarget::Commit {
                sha: sha.trim().into(),
            },
        )
        .unwrap();
        assert_eq!(target(root.path(), path).unwrap().branch, "HEAD");
        let locks = GitWriteLocks::default();
        assert!(std::sync::Arc::ptr_eq(
            &locks.repository(root.path().to_str().unwrap()),
            &locks.repository(path)
        ));
        remove(root.path(), path, &RemoveOptions::default()).unwrap();
    }
}

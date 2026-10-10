//! Observación nativa de worktree y metadatos Git con agrupación de ráfagas.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

const DEBOUNCE: Duration = Duration::from_millis(120);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChange {
    worktree: bool,
    git: bool,
}

impl RepositoryChange {
    fn merge(&mut self, other: Self) {
        self.worktree |= other.worktree;
        self.git |= other.git;
    }

    fn any(self) -> bool {
        self.worktree || self.git
    }
}

enum WatchMessage {
    Change(RepositoryChange),
    Stop,
}

pub struct RepositoryWatcher {
    watcher: Option<RecommendedWatcher>,
    messages: Sender<WatchMessage>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for RepositoryWatcher {
    fn drop(&mut self) {
        self.watcher.take();
        let _ = self.messages.send(WatchMessage::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn start<F>(repository: &Path, emit: F) -> Result<RepositoryWatcher, ()>
where
    F: Fn(RepositoryChange) + Send + 'static,
{
    let repository = repository.canonicalize().map_err(|_| ())?;
    let git_roots = git_roots(&repository)?;
    let (messages, incoming) = mpsc::channel();
    let callback = messages.clone();
    let repository_for_events = repository.clone();
    let git_for_events = git_roots.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else {
            crate::logging::native_with_context("warn", "git.watch", "El observador de archivos falló; el estado visible puede necesitar actualización manual", None, Some(serde_json::json!({ "repository": repository_for_events.to_string_lossy(), "phase": "event" })));
            return;
        };
        // Leer status, refs o historia abre y cierra archivos de `.git`. Algunos backends de
        // `notify` entregan esos accesos aunque no cambie un byte; tratarlos como modificación
        // crea un bucle lectura → aviso → recarga → lectura que hace parpadear GitWorking.
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let change = classify(&event.paths, &repository_for_events, &git_for_events);
        if change.any() {
            let _ = callback.send(WatchMessage::Change(change));
        }
    })
    .map_err(|_| ())?;

    watcher
        .watch(&repository, RecursiveMode::Recursive)
        .map_err(|_| ())?;
    for root in git_roots
        .iter()
        .filter(|root| !root.starts_with(&repository))
    {
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|_| ())?;
    }

    let worker = thread::spawn(move || {
        while let Ok(message) = incoming.recv() {
            let WatchMessage::Change(mut pending) = message else {
                break;
            };
            loop {
                match incoming.recv_timeout(DEBOUNCE) {
                    Ok(WatchMessage::Change(change)) => pending.merge(change),
                    Ok(WatchMessage::Stop) => return,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            emit(pending);
        }
    });

    Ok(RepositoryWatcher {
        watcher: Some(watcher),
        messages,
        worker: Some(worker),
    })
}

fn classify(paths: &[PathBuf], repository: &Path, git_roots: &[PathBuf]) -> RepositoryChange {
    let mut change = RepositoryChange::default();
    for path in paths {
        if git_roots.iter().any(|root| {
            path.strip_prefix(root).ok().is_some_and(|relative| {
                relative.starts_with("gitthul-recovery")
                    || relative.starts_with("refs/gitthul/stash-recovery")
                    || relative.starts_with("logs/refs/gitthul/stash-recovery")
                    || relative.starts_with("refs/gitthul/undo")
                    || relative.starts_with("logs/refs/gitthul/undo")
            })
        }) {
            continue;
        }
        if git_roots.iter().any(|root| path.starts_with(root)) {
            change.git = true;
        } else if path.starts_with(repository) {
            change.worktree = true;
        }
    }
    change
}

fn git_roots(repository: &Path) -> Result<Vec<PathBuf>, ()> {
    let mut roots = HashSet::new();
    for argument in ["--git-dir", "--git-common-dir"] {
        let output = Command::new("git")
            .args(["rev-parse", argument])
            .current_dir(repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|_| ())?;
        if !output.status.success() {
            return Err(());
        }
        let text = String::from_utf8(output.stdout).map_err(|_| ())?;
        let path = PathBuf::from(text.trim());
        let absolute = if path.is_absolute() {
            path
        } else {
            repository.join(path)
        };
        roots.insert(absolute.canonicalize().map_err(|_| ())?);
    }
    Ok(roots.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::sync::mpsc;
    use std::time::Duration;

    use tempfile::TempDir;

    use super::start;
    use crate::git::status;

    #[test]
    fn recovery_storage_is_quiet_but_history_marker_refreshes_git() {
        let root = Path::new("/repo");
        let git = root.join(".git");
        for name in [
            "gitthul-recovery/checkpoint/data",
            "refs/gitthul/stash-recovery/before",
            "logs/refs/gitthul/stash-recovery/before",
            "refs/gitthul/undo/one",
            "logs/refs/gitthul/undo/one",
        ] {
            let change = super::classify(&[git.join(name)], root, &[git.clone()]);
            assert!(!change.git && !change.worktree);
        }
        let change = super::classify(&[git.join("gitthul-undo-revision")], root, &[git.clone()]);
        assert!(change.git && !change.worktree);
    }

    fn repository() -> TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        git(temporary.path(), &["config", "user.name", "GitThul"]);
        git(
            temporary.path(),
            &["config", "user.email", "gitthul@example.invalid"],
        );
        fs::write(temporary.path().join("archivo.txt"), "base\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        git(temporary.path(), &["commit", "--quiet", "-m", "base"]);
        temporary
    }

    fn git(repository: &Path, args: &[&str]) {
        assert!(Command::new("git")
            .args(args)
            .current_dir(repository)
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn agrupa_una_rafaga_del_worktree_en_un_solo_aviso() {
        let temporary = repository();
        let (events, received) = mpsc::channel();
        let _watcher = start(temporary.path(), move |event| events.send(event).unwrap()).unwrap();

        for content in ["uno\n", "dos\n", "tres\n"] {
            fs::write(temporary.path().join("archivo.txt"), content).unwrap();
        }

        let event = received.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(event.worktree);
        assert!(received.recv_timeout(Duration::from_millis(250)).is_err());
    }

    #[test]
    fn distingue_los_cambios_del_indice() {
        let temporary = repository();
        let (events, received) = mpsc::channel();
        let _watcher = start(temporary.path(), move |event| events.send(event).unwrap()).unwrap();
        fs::write(temporary.path().join("archivo.txt"), "cambio\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);

        let event = received.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(event.worktree || event.git);
        let second = received.recv_timeout(Duration::from_millis(500)).ok();
        assert!(event.git || second.is_some_and(|event| event.git));
    }

    #[test]
    fn leer_status_no_dispara_al_propio_observador() {
        let temporary = repository();
        fs::write(temporary.path().join("archivo.txt"), "preparado\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let (events, received) = mpsc::channel();
        let _watcher = start(temporary.path(), move |event| events.send(event).unwrap()).unwrap();

        status::read(temporary.path()).expect("status no mutante");

        assert!(received.recv_timeout(Duration::from_millis(400)).is_err());
    }

    #[test]
    fn observa_el_gitdir_externo_de_un_worktree_enlazado() {
        let temporary = tempfile::tempdir().unwrap();
        let main = temporary.path().join("principal");
        fs::create_dir(&main).unwrap();
        git(&main, &["init", "--quiet", "--initial-branch=main"]);
        git(&main, &["config", "user.name", "GitThul"]);
        git(&main, &["config", "user.email", "gitthul@example.invalid"]);
        fs::write(main.join("archivo.txt"), "base\n").unwrap();
        git(&main, &["add", "archivo.txt"]);
        git(&main, &["commit", "--quiet", "-m", "base"]);
        let linked = temporary.path().join("enlazado");
        git(
            &main,
            &[
                "worktree",
                "add",
                "--quiet",
                "-b",
                "enlazado",
                linked.to_str().unwrap(),
            ],
        );
        let (events, received) = mpsc::channel();
        let _watcher = start(&linked, move |event| events.send(event).unwrap()).unwrap();

        fs::write(linked.join("archivo.txt"), "cambio\n").unwrap();
        git(&linked, &["add", "archivo.txt"]);

        let first = received.recv_timeout(Duration::from_secs(3)).unwrap();
        let second = received.recv_timeout(Duration::from_millis(500)).ok();
        assert!(first.git || second.is_some_and(|event| event.git));
    }
}

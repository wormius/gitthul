//! Ciclo mínimo de repositorios reales.
//!
//! Este módulo descubre metadatos baratos con gitoxide. El registro conserva
//! una última ficha para poder seguir mostrando rutas ausentes, pero cada lista
//! refresca las carpetas disponibles: el estado Git real siempre manda.

mod commit;
mod conflict;
mod detail;
mod diff;
mod encoding;
mod files;
mod history;
mod integration;
mod network;
mod operation;
mod preview;
pub(crate) mod recovery;
mod recovery_store;
mod ref_write;
mod reflog;
mod refs;
mod registry;
pub(crate) mod remote_write;
mod repository;
mod reset;
mod resolve;
mod stash;
mod status;
mod undo;
mod undo_checkpoint;
mod undo_local;
mod watch;
pub mod worktrees;
mod write;

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, State};

pub use network::NetworkProcesses;
pub use repository::{RepoSummary, Repository};

#[derive(Debug, serde::Deserialize, Serialize)]
pub struct GitIdentity {
    name: String,
    email: String,
}

#[tauri::command]
pub async fn git_write_identity(
    id: String,
    identity: GitIdentity,
    locks: State<'_, GitWriteLocks>,
) -> Result<GitIdentity, GitCommandError> {
    let repository = existing_repository(&id)?;
    let lock = locks.repository(&id);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().unwrap_or_else(|error| error.into_inner());
        set_identity(&repository, &identity)?;
        Ok(identity)
    })
    .await
    .map_err(|_| GitCommandError::internal("No se pudo aplicar la identidad"))?
}

fn set_identity(
    repository: &std::path::Path,
    identity: &GitIdentity,
) -> Result<(), GitCommandError> {
    use std::io::Write;
    if [identity.name.as_str(), identity.email.as_str()]
        .iter()
        .any(|value| value.trim().is_empty() || value.chars().any(char::is_control))
    {
        return Err(GitCommandError::new("commit.identityMissing", json!({})));
    }
    let repo = gix::open(repository)
        .map_err(|_| GitCommandError::internal("No se pudo abrir el repositorio"))?;
    let worktree_config = crate::process::command("git")
        .current_dir(repository)
        .args(["config", "--bool", "--get", "extensions.worktreeConfig"])
        .output()
        .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true");
    let config = if worktree_config {
        repo.git_dir().join("config.worktree")
    } else {
        repo.common_dir().join("config")
    };
    let mut pending = config.as_os_str().to_os_string();
    pending.push(".lock");
    let pending = std::path::PathBuf::from(pending);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|_| GitCommandError::internal("La configuración de Git está bloqueada"))?;
    let result = (|| {
        let contents = match std::fs::read(&config) {
            Ok(contents) => contents,
            Err(e) if worktree_config && e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(_) => {
                return Err(GitCommandError::internal(
                    "No se pudo leer la configuración",
                ))
            }
        };
        file.write_all(&contents)
            .map_err(|_| GitCommandError::internal("No se pudo escribir la configuración"))?;
        drop(file);
        for (key, value) in [
            ("user.name", &identity.name),
            ("user.email", &identity.email),
        ] {
            let status = crate::process::command("git")
                .arg("config")
                .arg("--file")
                .arg(&pending)
                .args(["--replace-all", key, value.trim()])
                .status()
                .map_err(|_| GitCommandError::internal("No se pudo aplicar la identidad"))?;
            if !status.success() {
                return Err(GitCommandError::internal("No se pudo aplicar la identidad"));
            }
        }
        std::fs::rename(&pending, &config)
            .map_err(|_| GitCommandError::internal("No se pudo guardar la identidad"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&pending);
    }
    result
}

#[tauri::command]
pub fn git_read_identity(id: String) -> Result<Option<GitIdentity>, GitCommandError> {
    let repository = existing_repository(&id)?;
    let read = |key: &str| -> Option<String> {
        let output = crate::process::command("git")
            .args(["config", "--get", key])
            .current_dir(&repository)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout)
            .ok()
            .map(|value| value.trim().to_owned())
    };
    let (Some(name), Some(email)) = (read("user.name"), read("user.email")) else {
        return Ok(None);
    };
    if name.is_empty() || email.is_empty() {
        return Ok(None);
    }
    Ok(Some(GitIdentity { name, email }))
}

use crate::{auth, store};

const FILE_NAME: &str = "repositories.json";

#[derive(Clone, Default)]
pub struct CloneProcesses {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Clone, Default)]
pub struct GitWriteLocks {
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    undo: undo::UndoStacks,
    resolutions: resolve::ResolutionSnapshots,
}

#[derive(Clone, Default)]
pub struct GitWatchers {
    watchers: Arc<Mutex<HashMap<String, watch::RepositoryWatcher>>>,
}

#[derive(Clone, Default)]
pub struct GitReadOperations {
    active: Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl GitReadOperations {
    fn begin(&self, operation_id: &str) -> Arc<std::sync::atomic::AtomicBool> {
        let cancelled_early = self
            .cancelled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(operation_id);
        let flag = Arc::new(std::sync::atomic::AtomicBool::new(cancelled_early));
        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(operation_id.to_owned(), flag.clone());
        flag
    }

    fn finish(&self, operation_id: &str) {
        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(operation_id);
        self.cancelled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(operation_id);
    }

    fn cancel(&self, operation_id: String) {
        if let Some(flag) = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&operation_id)
        {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        } else {
            self.cancelled
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(operation_id);
        }
    }
}

impl GitWriteLocks {
    pub(crate) fn repository(&self, id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().unwrap_or_else(|error| error.into_inner());
        // Los worktrees comparten referencias y metadatos: también comparten el bloqueo.
        let key = gix::open(id)
            .ok()
            .and_then(|repo| std::fs::canonicalize(repo.common_dir()).ok())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| id.to_owned());
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandError {
    code: &'static str,
    params: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
}

impl GitCommandError {
    fn new(code: &'static str, params: Value) -> Self {
        Self {
            code,
            params,
            output: None,
        }
    }

    fn internal(context: &'static str) -> Self {
        Self {
            code: "unknown",
            params: json!({}),
            output: Some(context.to_owned()),
        }
    }

    fn git(code: &'static str, params: Value, output: String) -> Self {
        Self {
            code,
            params,
            output: (!output.is_empty()).then_some(output),
        }
    }
}

fn read_registry(app: &AppHandle) -> Result<registry::Registry, GitCommandError> {
    let value = store::read(app, FILE_NAME)
        .map_err(|_| GitCommandError::internal("No se pudo leer el registro de repositorios"))?;
    registry::Registry::from_value(value)
        .map_err(|_| GitCommandError::internal("El registro de repositorios no es válido"))
}

fn write_registry(app: &AppHandle, registry: &registry::Registry) -> Result<(), GitCommandError> {
    let value = serde_json::to_value(registry).map_err(|_| {
        GitCommandError::internal("No se pudo serializar el registro de repositorios")
    })?;
    store::write(app, FILE_NAME, &value)
        .map_err(|_| GitCommandError::internal("No se pudo guardar el registro de repositorios"))
}

#[tauri::command]
pub fn git_list_repositories(app: AppHandle) -> Result<Vec<RepoSummary>, GitCommandError> {
    let mut registry = read_registry(&app)?;
    if refresh_registry(&mut registry) {
        write_registry(&app, &registry)?;
    }
    Ok(registry.repositories)
}

#[tauri::command]
pub fn git_read_repository(id: String) -> Result<Repository, GitCommandError> {
    let path = std::path::Path::new(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    repository::discover(path)
        .map_err(|_| GitCommandError::new("repo.notARepository", json!({ "path": id })))
}

/**
 * Migra fichas creadas antes de que el id nativo fuera la ruta canónica.
 *
 * Las rutas ausentes permanecen intactas para que la interfaz pueda repararlas. Si dos fichas
 * históricas convergen al mismo repositorio real, se consolidan sin perder la apertura más reciente.
 */
fn refresh_registry(registry: &mut registry::Registry) -> bool {
    let original = registry.repositories.clone();
    let mut refreshed: Vec<RepoSummary> = Vec::with_capacity(original.len());

    for known in original.iter().cloned() {
        let current = repository::discover(&known.path)
            .map(|repository| RepoSummary {
                last_opened_at: known.last_opened_at,
                ..repository.summary()
            })
            .unwrap_or(known);

        if let Some(existing) = refreshed.iter_mut().find(|repo| repo.id == current.id) {
            existing.last_opened_at = existing.last_opened_at.max(current.last_opened_at);
        } else {
            refreshed.push(current);
        }
    }

    registry::sort_repositories(&mut refreshed);
    registry.repositories = refreshed;
    registry.repositories != original
}

#[tauri::command]
pub fn git_open_repository(app: AppHandle, path: String) -> Result<Repository, GitCommandError> {
    let mut repository = repository::discover(&path)
        .map_err(|_| GitCommandError::new("repo.notARepository", json!({ "path": path })))?;
    let mut registry = read_registry(&app)?;

    if let Some(known) = registry
        .repositories
        .iter()
        .find(|known| known.id == repository.id)
    {
        return Err(GitCommandError::new(
            "repo.alreadyExists",
            json!({ "repo": known.name, "path": known.path }),
        ));
    }

    repository.last_opened_at = Some(now_millis());
    registry.repositories.push(repository.summary());
    registry.sort();
    write_registry(&app, &registry)?;
    Ok(repository)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepositoryOptions {
    name: String,
    initial_branch: String,
}

#[tauri::command]
pub fn git_create_repository(
    app: AppHandle,
    path: String,
    options: CreateRepositoryOptions,
) -> Result<Repository, GitCommandError> {
    use repository::CreateError;

    let mut registry = read_registry(&app)?;
    let target = std::fs::canonicalize(&path)
        .ok()
        .map(|parent| parent.join(&options.name).to_string_lossy().into_owned());
    if let Some(known) = target.as_ref().and_then(|target| {
        registry
            .repositories
            .iter()
            .find(|known| &known.id == target)
    }) {
        return Err(GitCommandError::new(
            "repo.alreadyExists",
            json!({ "repo": known.name, "path": known.path }),
        ));
    }

    let mut repository = repository::create(&path, &options.name, &options.initial_branch)
        .map_err(|error| match error {
            CreateError::DestinationExists(target) => GitCommandError::new(
                "create.destinationExists",
                json!({ "path": target.to_string_lossy() }),
            ),
            CreateError::InvalidBranch => GitCommandError::new(
                "create.invalidBranch",
                json!({ "branch": options.initial_branch }),
            ),
            CreateError::InvalidDestination => {
                GitCommandError::new("create.parentNotFound", json!({ "path": path }))
            }
            CreateError::GitFailed => GitCommandError::internal("Git no pudo crear el repositorio"),
        })?;
    repository.last_opened_at = Some(now_millis());
    registry.repositories.push(repository.summary());
    registry.sort();
    if let Err(error) = write_registry(&app, &registry) {
        let _ = std::fs::remove_dir_all(&repository.path);
        return Err(error);
    }
    Ok(repository)
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepositoryRequest {
    url: String,
    path: String,
    name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn git_clone_repository(
    app: AppHandle,
    processes: State<'_, CloneProcesses>,
    mut request: CloneRepositoryRequest,
    operation_id: String,
    on_progress: Channel<CloneProgress>,
) -> Result<Repository, GitCommandError> {
    let mut registry = read_registry(&app)?;
    let target = std::fs::canonicalize(&request.path)
        .ok()
        .map(|parent| parent.join(&request.name).to_string_lossy().into_owned());
    if let Some(known) = target.as_ref().and_then(|target| {
        registry
            .repositories
            .iter()
            .find(|known| &known.id == target)
    }) {
        return Err(GitCommandError::new(
            "repo.alreadyExists",
            json!({ "repo": known.name, "path": known.path }),
        ));
    }
    let credentials = target.as_ref().and_then(|target| {
        auth::CommandConfig::for_clone(
            &app,
            &request.url,
            std::path::Path::new(target),
            &operation_id,
        )
        .ok()
    });
    let processes = processes.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        for attempt in 0..3 {
            if let Some(config) = &credentials {
                if let Some(source) = config.clone_source() {
                    request.url = source;
                }
            }
            let result = run_clone(
                request.clone(),
                operation_id.clone(),
                on_progress.clone(),
                &processes,
                credentials.as_ref(),
            );
            if credentials
                .as_ref()
                .is_some_and(|config| config.cancelled())
            {
                return Err(GitCommandError::new("operation.cancelled", json!({})));
            }
            if attempt < 2
                && result
                    .as_ref()
                    .is_err_and(|error| error.code == "auth.failed")
                && credentials
                    .as_ref()
                    .is_some_and(|config| config.retry_auth("origin"))
            {
                continue;
            }
            return result;
        }
        Err(GitCommandError::internal(
            "No se pudo autenticar la clonación",
        ))
    })
    .await
    .map_err(|_| GitCommandError::internal("La tarea de clonación se interrumpió"))??;

    let mut repository = result;
    repository.last_opened_at = Some(now_millis());
    registry.repositories.push(repository.summary());
    registry.sort();
    if let Err(error) = write_registry(&app, &registry) {
        let _ = std::fs::remove_dir_all(&repository.path);
        return Err(error);
    }
    Ok(repository)
}

#[tauri::command]
pub fn git_cancel_clone(
    app: AppHandle,
    processes: State<'_, CloneProcesses>,
    operation_id: String,
) {
    auth::cancel(&app, &operation_id);
    let child = processes
        .children
        .lock()
        .ok()
        .and_then(|map| map.get(&operation_id).cloned());
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    } else if let Ok(mut cancelled) = processes.cancelled.lock() {
        cancelled.insert(operation_id);
    }
}

fn run_clone(
    request: CloneRepositoryRequest,
    operation_id: String,
    on_progress: Channel<CloneProgress>,
    processes: &CloneProcesses,
    credentials: Option<&auth::CommandConfig>,
) -> Result<Repository, GitCommandError> {
    let parent = std::fs::canonicalize(&request.path).map_err(|_| {
        GitCommandError::new("create.parentNotFound", json!({ "path": request.path }))
    })?;
    if !parent.is_dir() || !repository::is_single_component(&request.name) {
        return Err(GitCommandError::new(
            "create.parentNotFound",
            json!({ "path": request.path }),
        ));
    }
    if !looks_like_clone_source(&parent, &request.url) {
        return Err(GitCommandError::new(
            "clone.invalidUrl",
            json!({ "url": request.url }),
        ));
    }
    let target = parent.join(&request.name);
    if target.exists() {
        return Err(GitCommandError::new(
            "clone.destinationNotEmpty",
            json!({ "path": target.to_string_lossy() }),
        ));
    }

    let source_label = clone_source_label(&request.url);
    if clone_source_contains_credentials(&request.url) {
        return Err(GitCommandError::new(
            "clone.credentialsInUrl",
            json!({ "url": source_label }),
        ));
    }

    let mut command = crate::process::command("git");
    if let Some(credentials) = credentials {
        credentials.apply(&mut command);
    }
    let mut child = command
        .arg("clone")
        .arg("--progress")
        .arg("--")
        .arg(&request.url)
        // The parent is already checked and set as cwd. Git for Windows
        // rejects canonical verbatim paths as clone destinations.
        .arg(&request.name)
        .current_dir(&parent)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| GitCommandError::internal("Git no pudo iniciar la clonación"))?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    processes
        .children
        .lock()
        .map_err(|_| GitCommandError::internal("No se pudo registrar la clonación"))?
        .insert(operation_id.clone(), child.clone());
    if processes
        .cancelled
        .lock()
        .is_ok_and(|mut cancelled| cancelled.remove(&operation_id))
    {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }

    let reader = thread::spawn(move || {
        let mut captured = Vec::new();
        if let Some(stderr) = stderr {
            for chunk in BufReader::new(stderr).split(b'\r').map_while(Result::ok) {
                if captured.len() < 65_536 {
                    let remaining = 65_536 - captured.len();
                    captured.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                    captured.push(b'\n');
                }
                for line in chunk.split(|byte| *byte == b'\n') {
                    if let Some(progress) = parse_clone_progress(&String::from_utf8_lossy(line)) {
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
            .map_err(|_| GitCommandError::internal("No se pudo consultar la clonación"))?
            .try_wait()
            .map_err(|_| GitCommandError::internal("No se pudo esperar la clonación"))?;
        if let Some(status) = status {
            break status;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let stderr = reader.join().unwrap_or_default();
    if let Ok(mut map) = processes.children.lock() {
        map.remove(&operation_id);
    }

    if !status.success() {
        if target.exists() {
            let _ = std::fs::remove_dir_all(&target);
        }
        let output = String::from_utf8_lossy(&stderr).into_owned();
        return Err(classify_clone_error(&source_label, output));
    }
    repository::discover(&target).map_err(|_| {
        let _ = std::fs::remove_dir_all(&target);
        GitCommandError::internal("El repositorio clonado no se pudo leer")
    })
}

fn clone_source_contains_credentials(source: &str) -> bool {
    let Ok(url) = gix::url::parse(source.as_bytes()) else {
        return false;
    };
    matches!(url.scheme, gix::url::Scheme::Http | gix::url::Scheme::Https)
        && (url.user.is_some() || url.password.is_some())
}

fn clone_source_label(source: &str) -> String {
    let Ok(mut url) = gix::url::parse(source.as_bytes()) else {
        return source.to_owned();
    };
    url.set_user(None);
    url.set_password(None);
    url.to_string()
}

fn classify_clone_error(remote: &str, output: String) -> GitCommandError {
    let normalized = output.to_ascii_lowercase();
    if normalized.contains("authentication failed")
        || normalized.contains("could not read username")
        || normalized.contains("permission denied (publickey)")
        || normalized.contains("invalid username or password")
    {
        GitCommandError::git("auth.failed", json!({ "remote": remote }), output)
    } else if normalized.contains("repository not found")
        || normalized.contains("does not appear to be a git repository")
        || normalized.contains("could not read from remote repository")
        || normalized.contains("the requested url returned error: 403")
    {
        GitCommandError::git("clone.unavailable", json!({ "remote": remote }), output)
    } else if normalized.contains("could not resolve host")
        || normalized.contains("failed to connect")
        || normalized.contains("unable to access")
    {
        GitCommandError::git("network.unreachable", json!({ "remote": remote }), output)
    } else {
        GitCommandError::git("unknown", json!({}), output)
    }
}

fn looks_like_clone_source(parent: &std::path::Path, source: &str) -> bool {
    let source = source.trim();
    if source.is_empty() {
        return false;
    }
    let path = std::path::Path::new(source);
    path.is_absolute()
        || parent.join(path).exists()
        || source.contains("://")
        || source
            .split_once(':')
            .is_some_and(|(host, path)| host.contains('@') && !path.is_empty())
}

fn parse_clone_progress(line: &str) -> Option<CloneProgress> {
    let phase = if line.contains("Counting objects:") || line.contains("Enumerating objects:") {
        "counting"
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
    Some(CloneProgress {
        phase,
        received: counts.map_or(0, |counts| counts.0),
        total: counts.map(|counts| counts.1),
    })
}

#[tauri::command]
pub fn git_forget_repository(app: AppHandle, id: String) -> Result<(), GitCommandError> {
    let mut registry = read_registry(&app)?;
    registry
        .repositories
        .retain(|repository| repository.id != id);
    write_registry(&app, &registry)
}

#[tauri::command]
pub fn git_mark_opened(app: AppHandle, id: String, at: Option<u64>) -> Result<(), GitCommandError> {
    let mut registry = read_registry(&app)?;
    let Some(repository) = registry
        .repositories
        .iter_mut()
        .find(|repository| repository.id == id)
    else {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    };

    repository.last_opened_at = Some(at.unwrap_or_else(now_millis));
    registry.sort();
    write_registry(&app, &registry)
}

#[tauri::command]
pub async fn git_read_status(id: String) -> Result<status::WorkingStatus, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }

    tauri::async_runtime::spawn_blocking(move || status::read(&path))
        .await
        .map_err(|_| GitCommandError::internal("La tarea de status se interrumpió"))?
        .map_err(|error| match error {
            status::ReadStatusError::InvalidPathEncoding => {
                GitCommandError::new("path.encodingUnsupported", json!({ "repo": id }))
            }
            status::ReadStatusError::GitFailed | status::ReadStatusError::MalformedOutput => {
                GitCommandError::internal("Git no pudo leer el status")
            }
        })
}

#[tauri::command]
pub async fn git_read_conflict(
    id: String,
    path: String,
    encoding: Option<String>,
) -> Result<conflict::ConflictContents, GitCommandError> {
    let repository = existing_repository(&id)?;
    tauri::async_runtime::spawn_blocking({
        let requested_path = path.clone();
        move || conflict::read_encoded(&repository, &requested_path, encoding.as_deref())
    })
    .await
    .map_err(|_| GitCommandError::internal("La lectura del conflicto se interrumpió"))?
    .map_err(|error| match error {
        conflict::ReadConflictError::UnsupportedEncoding(encoding) => {
            GitCommandError::new("text.encodingUnsupported", json!({ "encoding": encoding }))
        }
        conflict::ReadConflictError::NotConflicted => {
            GitCommandError::new("resolve.notConflicted", json!({ "path": path }))
        }
        conflict::ReadConflictError::InvalidPathEncoding => {
            GitCommandError::new("path.encodingUnsupported", json!({ "repo": id }))
        }
        conflict::ReadConflictError::GitFailed | conflict::ReadConflictError::MalformedOutput => {
            GitCommandError::internal("Git no pudo leer las etapas del conflicto")
        }
    })
}

#[tauri::command]
pub async fn git_read_diff(
    id: String,
    request: diff::DiffRequest,
    operation_id: String,
    reads: State<'_, GitReadOperations>,
) -> Result<diff::FileDiff, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }

    let reads = reads.inner().clone();
    let cancelled = reads.begin(&operation_id);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        diff::read_cancellable(&path, request, &cancelled)
    })
    .await;
    reads.finish(&operation_id);
    joined
        .map_err(|_| GitCommandError::internal("La tarea de diff se interrumpió"))?
        .map_err(|error| map_diff_error(error, &id))
}

#[tauri::command]
pub async fn git_read_diff_files(
    id: String,
    source: diff::DiffSource,
    operation_id: String,
    reads: State<'_, GitReadOperations>,
) -> Result<Vec<diff::FileChange>, GitCommandError> {
    let path = existing_repository(&id)?;
    let reads = reads.inner().clone();
    let cancelled = reads.begin(&operation_id);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        diff::read_files_cancellable(&path, &source, &cancelled)
    })
    .await;
    reads.finish(&operation_id);
    joined
        .map_err(|_| GitCommandError::internal("La comparación de archivos se interrumpió"))?
        .map_err(|error| map_diff_error(error, &id))
}

fn map_diff_error(error: diff::ReadDiffError, id: &str) -> GitCommandError {
    match error {
        diff::ReadDiffError::Cancelled => GitCommandError::new("operation.cancelled", json!({})),
        diff::ReadDiffError::InvalidPathEncoding => {
            GitCommandError::new("path.encodingUnsupported", json!({ "repo": id }))
        }
        diff::ReadDiffError::RevisionNotFound(revision) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        diff::ReadDiffError::UnsupportedEncoding(encoding) => {
            GitCommandError::new("text.encodingUnsupported", json!({ "encoding": encoding }))
        }
        diff::ReadDiffError::InvalidPath
        | diff::ReadDiffError::GitFailed
        | diff::ReadDiffError::MalformedOutput => {
            GitCommandError::internal("Git no pudo leer el diff")
        }
    }
}

#[tauri::command]
pub async fn git_read_refs(id: String) -> Result<refs::RefsSnapshot, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }

    let repository_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || refs::read(&path))
        .await
        .map_err(|_| GitCommandError::internal("La lectura de referencias se interrumpió"))?
        .map_err(|error| match error {
            refs::ReadRefsError::InvalidEncoding => {
                GitCommandError::new("ref.encodingUnsupported", json!({ "repo": repository_id }))
            }
            refs::ReadRefsError::GitFailed | refs::ReadRefsError::MalformedOutput => {
                GitCommandError::internal("Git no pudo leer las referencias")
            }
        })
}

#[tauri::command]
pub async fn git_read_commits(
    id: String,
    page: Option<history::CommitPageRequest>,
    operation_id: String,
    reads: State<'_, GitReadOperations>,
) -> Result<history::CommitPage, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }

    let reads = reads.inner().clone();
    let cancelled = reads.begin(&operation_id);
    let request = page.unwrap_or_default();
    let start = request.start.clone();
    let joined =
        tauri::async_runtime::spawn_blocking(move || history::read(&path, request, &cancelled))
            .await;
    reads.finish(&operation_id);
    let result =
        joined.map_err(|_| GitCommandError::internal("La lectura de historia se interrumpió"))?;
    result.map_err(|error| match error {
        history::ReadHistoryError::Cancelled => {
            GitCommandError::internal("La lectura de historia fue cancelada")
        }
        history::ReadHistoryError::InvalidEncoding => {
            GitCommandError::new("history.encodingUnsupported", json!({ "repo": id }))
        }
        history::ReadHistoryError::StartNotFound => {
            GitCommandError::new("history.startNotFound", json!({ "start": start }))
        }
        history::ReadHistoryError::GitFailed => {
            GitCommandError::internal("Git no pudo leer la historia")
        }
    })
}

#[tauri::command]
pub async fn git_read_commit(
    id: String,
    sha: String,
) -> Result<detail::CommitDetails, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }

    let repository_id = id.clone();
    let requested = sha.clone();
    tauri::async_runtime::spawn_blocking(move || detail::read(&path, &sha))
        .await
        .map_err(|_| GitCommandError::internal("La lectura del commit se interrumpió"))?
        .map_err(|error| match error {
            detail::ReadDetailError::CommitEncoding => GitCommandError::new(
                "history.encodingUnsupported",
                json!({ "repo": repository_id }),
            ),
            detail::ReadDetailError::RefEncoding => {
                GitCommandError::new("ref.encodingUnsupported", json!({ "repo": repository_id }))
            }
            detail::ReadDetailError::PathEncoding => {
                GitCommandError::new("path.encodingUnsupported", json!({ "repo": repository_id }))
            }
            detail::ReadDetailError::NotFound => {
                GitCommandError::new("history.startNotFound", json!({ "start": requested }))
            }
            detail::ReadDetailError::GitFailed | detail::ReadDetailError::MalformedOutput => {
                GitCommandError::internal("Git no pudo leer el detalle del commit")
            }
        })
}

fn map_file_error(error: files::ReadFileError, id: &str, path: &str) -> GitCommandError {
    match error {
        files::ReadFileError::UnsupportedEncoding(encoding) => {
            GitCommandError::new("text.encodingUnsupported", json!({ "encoding": encoding }))
        }
        files::ReadFileError::PathEncoding => {
            GitCommandError::new("path.encodingUnsupported", json!({ "repo": id }))
        }
        files::ReadFileError::CommitEncoding => {
            GitCommandError::new("history.encodingUnsupported", json!({ "repo": id }))
        }
        files::ReadFileError::PathNotFound => {
            GitCommandError::new("path.notFound", json!({ "path": path }))
        }
        files::ReadFileError::RevisionNotFound(revision) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        files::ReadFileError::GitFailed | files::ReadFileError::MalformedOutput => {
            GitCommandError::internal("Git no pudo leer archivos históricos")
        }
    }
}

fn existing_repository(id: &str) -> Result<std::path::PathBuf, GitCommandError> {
    let path = std::path::PathBuf::from(id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }
    Ok(path)
}

#[tauri::command]
pub async fn git_read_file(
    id: String,
    path: String,
    at: Option<String>,
    encoding: Option<String>,
    blob: Option<String>,
) -> Result<files::FileContents, GitCommandError> {
    let repository = existing_repository(&id)?;
    let error_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || match blob {
        Some(blob) => files::read_blob_encoded(&repository, path, &blob, encoding.as_deref()),
        None => files::read_file_encoded(&repository, path, at.as_deref(), encoding.as_deref()),
    })
    .await
    .map_err(|_| GitCommandError::internal("La lectura del archivo se interrumpió"))?
    .map_err(|error| map_file_error(error, &id, &error_path))
}

#[tauri::command]
pub async fn git_read_tree(
    id: String,
    at: Option<String>,
) -> Result<Vec<files::TreeEntry>, GitCommandError> {
    let repository = existing_repository(&id)?;
    let revision = at.clone().unwrap_or_else(|| "HEAD".to_owned());
    tauri::async_runtime::spawn_blocking(move || files::read_tree(&repository, at.as_deref()))
        .await
        .map_err(|_| GitCommandError::internal("La lectura del árbol se interrumpió"))?
        .map_err(|error| map_file_error(error, &id, &revision))
}

#[tauri::command]
pub async fn git_read_file_history(
    id: String,
    path: String,
) -> Result<Vec<history::Commit>, GitCommandError> {
    let repository = existing_repository(&id)?;
    let error_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || files::read_history(&repository, &path))
        .await
        .map_err(|_| {
            GitCommandError::internal("La lectura del historial de archivo se interrumpió")
        })?
        .map_err(|error| map_file_error(error, &id, &error_path))
}

#[tauri::command]
pub async fn git_preview_integration(
    id: String,
    kind: preview::IntegrationKind,
    source: String,
    target: String,
    operation_id: String,
    reads: State<'_, GitReadOperations>,
) -> Result<preview::IntegrationPreview, GitCommandError> {
    let repository = existing_repository(&id)?;
    let reads = reads.inner().clone();
    let cancelled = reads.begin(&operation_id);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        preview::read(&repository, kind, source, target, &cancelled)
    })
    .await;
    reads.finish(&operation_id);
    let result = joined
        .map_err(|_| GitCommandError::internal("La vista previa de integración se interrumpió"))?;
    result.map_err(|error| match error {
        preview::ReadPreviewError::Cancelled => {
            GitCommandError::internal("La vista previa de integración fue cancelada")
        }
        preview::ReadPreviewError::InvalidEncoding => {
            GitCommandError::new("history.encodingUnsupported", json!({ "repo": id }))
        }
        preview::ReadPreviewError::RevisionNotFound(revision) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        preview::ReadPreviewError::GitFailed | preview::ReadPreviewError::MalformedOutput => {
            GitCommandError::internal("Git no pudo calcular la vista previa de integración")
        }
    })
}

pub(crate) struct TerminalRecovery {
    id: String,
    locks: GitWriteLocks,
    before: Arc<undo_checkpoint::Checkpoint>,
}

pub(crate) fn begin_terminal_recovery(
    cwd: &str,
    locks: GitWriteLocks,
) -> Result<Option<TerminalRecovery>, GitCommandError> {
    let Ok(repository) = repository::discover(std::path::Path::new(cwd)) else {
        return Ok(None);
    };
    let id = repository.id;
    let lock = locks.repository(&id);
    let _guard = lock.lock().unwrap_or_else(|error| error.into_inner());
    let before = undo_checkpoint::Checkpoint::capture(std::path::Path::new(&id), &[])
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    before
        .recovery_set_label("undo.terminal")
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    Ok(Some(TerminalRecovery { id, locks, before }))
}

impl TerminalRecovery {
    pub(crate) fn finish(self) {
        let lock = self.locks.repository(&self.id);
        let _guard = lock.lock().unwrap_or_else(|error| error.into_inner());
        // On failure the before manifest and copies remain on disk for recovery.
        if let Ok(after) =
            undo_checkpoint::Checkpoint::after(std::path::Path::new(&self.id), &self.before)
        {
            self.locks
                .undo
                .remember_checkpoint(&self.id, self.before, after, "undo.terminal");
            if undo_checkpoint::notify_undo_change(std::path::Path::new(&self.id)).is_err() {
                crate::logging::native_with_context(
                    "warn",
                    "git.recovery",
                    "La recuperación del terminal se guardó, pero no se pudo avisar a la interfaz",
                    None,
                    Some(json!({ "repository": self.id, "phase": "event" })),
                );
            }
        } else {
            crate::logging::native_with_context("error", "git.recovery", "No se pudo completar el punto de recuperación del terminal; se conserva la copia anterior en disco", None, Some(json!({ "repository": self.id, "phase": "failure" })));
        }
    }
}

/// The write lock is owned by the caller. Always record partial failures too.
fn with_checkpoint<T>(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    label: &'static str,
    trees: &[String],
    operation: impl FnOnce() -> Result<T, GitCommandError>,
) -> Result<T, GitCommandError> {
    let before = undo_checkpoint::Checkpoint::capture(repository, trees)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(id, repository, undo, label, before, operation)
}

fn with_ref_checkpoint<T>(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    label: &'static str,
    operation: impl FnOnce() -> Result<T, GitCommandError>,
) -> Result<T, GitCommandError> {
    let before = undo_checkpoint::Checkpoint::capture_refs(repository)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(id, repository, undo, label, before, operation)
}

fn with_prepared_checkpoint<T>(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    label: &'static str,
    before: Arc<undo_checkpoint::Checkpoint>,
    operation: impl FnOnce() -> Result<T, GitCommandError>,
) -> Result<T, GitCommandError> {
    before
        .recovery_set_label(label)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    let result = operation();
    let after = undo_checkpoint::Checkpoint::after(repository, &before)
        .map_err(|_| GitCommandError::internal("La operación terminó pero no se pudo completar el historial. La copia previa permanece en el almacén de recuperación de GitThul."))?;
    undo.remember_checkpoint(id, before, after, label);
    result
}

#[tauri::command]
pub async fn git_merge(
    id: String,
    source: String,
    options: integration::MergeOptions,
    precondition: integration::IntegrationPrecondition,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let before =
            undo_checkpoint::Checkpoint::capture_merge(&repository, precondition.source_oid())
                .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
        let result = with_prepared_checkpoint(
            &repository_id,
            &repository,
            &undo,
            "undo.merge",
            before,
            || {
                integration::merge(&repository, &source, &options, &precondition)
                    .map_err(map_integration_error)
            },
        );
        resolutions.clear_repository(&repository_id);
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("La fusión se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_rebase(
    id: String,
    onto: String,
    precondition: integration::IntegrationPrecondition,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let result = with_checkpoint(
            &repository_id,
            &repository,
            &undo,
            "undo.rebase",
            std::slice::from_ref(&onto),
            || {
                integration::rebase(&repository, &onto, &precondition)
                    .map_err(map_integration_error)
            },
        );
        resolutions.clear_repository(&repository_id);
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("El rebase se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_cherry_pick(
    id: String,
    shas: Vec<String>,
    precondition: integration::CommitSequencePrecondition,
    mainline: Option<usize>,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let result = with_checkpoint(
            &repository_id,
            &repository,
            &undo,
            "undo.cherryPick",
            &shas,
            || {
                integration::cherry_pick(&repository, &shas, &precondition, mainline)
                    .map_err(map_integration_error)
            },
        );
        resolutions.clear_repository(&repository_id);
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("El cherry-pick se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_revert(
    id: String,
    shas: Vec<String>,
    precondition: integration::CommitSequencePrecondition,
    mainline: Option<usize>,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let result = with_checkpoint(
            &repository_id,
            &repository,
            &undo,
            "undo.revert",
            &shas,
            || {
                integration::revert(&repository, &shas, &precondition, mainline)
                    .map_err(map_integration_error)
            },
        );
        resolutions.clear_repository(&repository_id);
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("El revert se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_reset(
    id: String,
    to: String,
    mode: reset::ResetMode,
    expected_branch: String,
    precondition: status::ResetPrecondition,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let result = reset_with_recovery(
            &repository_id,
            &repository,
            &undo,
            &to,
            mode,
            &expected_branch,
            &precondition,
        );
        resolutions.clear_repository(&repository_id);
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("El reset se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_create_stash(
    id: String,
    message: String,
    options: stash::CreateStashOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        create_stash_with_recovery(&id, &repository, &undo, &message, &options)
    })
    .await
    .map_err(|_| GitCommandError::internal("Guardar los cambios se interrumpió"))?
}

fn reset_with_recovery(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    to: &str,
    mode: reset::ResetMode,
    branch: &str,
    precondition: &status::ResetPrecondition,
) -> Result<Repository, GitCommandError> {
    let before = undo_checkpoint::Checkpoint::capture_reset(repository, to, mode)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(id, repository, undo, "undo.reset", before, || {
        reset::reset(repository, to, mode, branch, precondition).map_err(map_reset_error)
    })
}

fn create_stash_with_recovery(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    message: &str,
    options: &stash::CreateStashOptions,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let before = undo_checkpoint::Checkpoint::capture_create_stash(repository, options)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(id, repository, undo, "undo.stash", before, || {
        stash::create(repository, message, options).map_err(map_stash_error)
    })
}

#[tauri::command]
pub async fn git_apply_stash(
    id: String,
    index: usize,
    options: stash::ApplyStashOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        apply_stash_with_recovery(&id, &repository, &undo, index, &options)
    })
    .await
    .map_err(|_| GitCommandError::internal("Aplicar el guardado se interrumpió"))?
}

fn apply_stash_with_recovery(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    index: usize,
    options: &stash::ApplyStashOptions,
) -> Result<status::WorkingStatus, GitCommandError> {
    let before = undo_checkpoint::Checkpoint::capture_stash(repository, &options.expected_stash)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(id, repository, undo, "undo.applyStash", before, || {
        stash::apply(repository, index, options).map_err(map_stash_error)
    })
}

#[tauri::command]
pub async fn git_drop_stash(
    id: String,
    index: usize,
    expected_stash: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        with_ref_checkpoint(&id, &repository, &undo, "undo.dropStash", || {
            stash::drop(&repository, index, &expected_stash).map_err(map_stash_error)
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("Descartar el guardado se interrumpió"))?
}

#[tauri::command]
pub async fn git_rename_stash(
    id: String,
    index: usize,
    message: String,
    expected_stash: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let before = undo_checkpoint::Checkpoint::capture_refs(&repository)
            .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
        before
            .recovery_set_label("undo.renameStash")
            .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
        let result =
            stash::rename(&repository, index, &expected_stash, &message).map_err(map_stash_error);
        let after =
            undo_checkpoint::Checkpoint::after_refs(&repository, &before).map_err(|_| {
                GitCommandError::internal(
                    "El guardado se renombró, pero no se pudo completar el historial de deshacer",
                )
            })?;
        undo.remember_checkpoint(&id, before, after, "undo.renameStash");
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("Renombrar el guardado se interrumpió"))?
}

fn map_reset_error(error: reset::ResetError) -> GitCommandError {
    match error {
        reset::ResetError::Stale(reference) => {
            GitCommandError::new("ref.stale", json!({ "ref": reference }))
        }
        reset::ResetError::InProgress {
            kind,
            source,
            target,
        } => GitCommandError::new(
            "operation.inProgress",
            json!({ "kind": kind, "source": source, "target": target }),
        ),
        reset::ResetError::TargetNotFound(sha) => {
            GitCommandError::new("history.startNotFound", json!({ "start": sha }))
        }
        reset::ResetError::UntrackedCollision { sha, count } => GitCommandError::new(
            "reset.untrackedCollision",
            json!({ "sha": sha, "count": count }),
        ),
        reset::ResetError::GitFailed(output) => GitCommandError::git("unknown", json!({}), output),
    }
}

fn map_integration_error(error: integration::IntegrationError) -> GitCommandError {
    match error {
        integration::IntegrationError::Stale(reference) => {
            GitCommandError::new("ref.stale", json!({ "ref": reference }))
        }
        integration::IntegrationError::InProgress {
            kind,
            source,
            target,
        } => GitCommandError::new(
            "operation.inProgress",
            json!({ "kind": kind, "source": source, "target": target }),
        ),
        integration::IntegrationError::MergeConflict {
            source,
            target,
            count,
        } => GitCommandError::new(
            "merge.conflict",
            json!({ "source": source, "target": target, "count": count }),
        ),
        integration::IntegrationError::RebaseConflict {
            source,
            target,
            sha,
            count,
        } => GitCommandError::new(
            "rebase.conflict",
            json!({ "source": source, "target": target, "sha": sha, "count": count }),
        ),
        integration::IntegrationError::CherryPickConflict { sha, target, count } => {
            GitCommandError::new(
                "cherryPick.conflict",
                json!({ "sha": sha, "target": target, "count": count }),
            )
        }
        integration::IntegrationError::RevertConflict { sha, target, count } => {
            GitCommandError::new(
                "revert.conflict",
                json!({ "sha": sha, "target": target, "count": count }),
            )
        }
        integration::IntegrationError::MainlineRequired(sha) => {
            GitCommandError::new("history.mainlineRequired", json!({ "sha": sha }))
        }
        integration::IntegrationError::MainlineInvalid { sha, parent, count } => {
            GitCommandError::new(
                "history.mainlineInvalid",
                json!({ "sha": sha, "parent": parent, "count": count }),
            )
        }
        integration::IntegrationError::GitFailed => {
            GitCommandError::internal("Git no pudo iniciar la integración")
        }
    }
}

fn map_stash_error(error: stash::StashError) -> GitCommandError {
    match error {
        stash::StashError::Stale(reference) => {
            GitCommandError::new("ref.stale", json!({ "ref": reference }))
        }
        stash::StashError::NothingToStash => {
            GitCommandError::new("stash.nothingToStash", json!({}))
        }
        stash::StashError::Conflict {
            stash,
            branch,
            count,
        } => GitCommandError::new(
            "stash.conflict",
            json!({ "stash": stash, "branch": branch, "count": count }),
        ),
        stash::StashError::BlockedByWip {
            stash,
            branch,
            count,
        } => GitCommandError::new(
            "stash.dirtyTree",
            json!({ "stash": stash, "branch": branch, "count": count }),
        ),
        stash::StashError::StillConflicted(count) => {
            GitCommandError::new("resolve.stillConflicted", json!({ "count": count }))
        }
        stash::StashError::RecoveryMissing => {
            GitCommandError::internal("No hay una recuperación de stash en curso")
        }
        stash::StashError::GitFailed => {
            GitCommandError::internal("Git no pudo completar la operación con el guardado")
        }
    }
}

#[tauri::command]
pub fn git_cancel_history(operation_id: String, reads: State<'_, GitReadOperations>) {
    reads.cancel(operation_id);
}

#[tauri::command]
pub fn git_cancel_diff(operation_id: String, reads: State<'_, GitReadOperations>) {
    reads.cancel(operation_id);
}

#[tauri::command]
pub async fn git_fetch(
    app: AppHandle,
    id: String,
    remote: Option<String>,
    options: network::FetchOptions,
    operation_id: String,
    on_progress: Channel<network::TransferProgress>,
    processes: State<'_, NetworkProcesses>,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let processes = processes.inner().clone();
    let credentials = Some(
        auth::CommandConfig::configuration(&app, &repository, &operation_id)
            .map_err(|_| GitCommandError::internal("No se pudo iniciar la autenticación"))?,
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        with_ref_checkpoint(&id, &repository, &undo, "undo.fetch", || {
            network::fetch_configured(
                &repository,
                remote.as_deref(),
                &options,
                &operation_id,
                on_progress,
                &processes,
                credentials.as_ref(),
            )
            .map_err(map_network_error)?;
            refs::read(&repository)
                .map_err(|_| GitCommandError::internal("No se pudieron leer las referencias"))
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La tarea de fetch se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_pull(
    app: AppHandle,
    id: String,
    options: network::PullOptions,
    operation_id: String,
    on_progress: Channel<network::TransferProgress>,
    processes: State<'_, NetworkProcesses>,
    locks: State<'_, GitWriteLocks>,
) -> Result<network::PullResult, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let processes = processes.inner().clone();
    let credentials = Some(
        auth::CommandConfig::configuration(&app, &repository, &operation_id)
            .map_err(|_| GitCommandError::internal("No se pudo iniciar la autenticación"))?,
    );
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut before = undo_checkpoint::Checkpoint::capture_refs(&repository)
            .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
        before
            .recovery_set_label("undo.pull")
            .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
        let mut prepare = |tree: &str, strategy| {
            undo_checkpoint::Checkpoint::prepare_pull(&repository, &mut before, tree, strategy)
                .map_err(|_| network::NetworkError::GitFailed)
        };
        let result = network::pull_configured(
            &repository,
            &options,
            &operation_id,
            on_progress,
            &processes,
            credentials.as_ref(),
            Some(&mut prepare),
        )
        .map_err(map_network_error);
        let after = undo_checkpoint::Checkpoint::after(&repository, &before).map_err(|_| {
            GitCommandError::internal(
                "La copia previa del pull permanece en el almacén de recuperación de GitThul",
            )
        })?;
        undo.remember_checkpoint(&id, before, after, "undo.pull");
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("La tarea de pull se interrumpió"))?
}

#[tauri::command]
pub async fn git_push(
    app: AppHandle,
    id: String,
    branch: String,
    options: network::PushOptions,
    operation_id: String,
    on_progress: Channel<network::TransferProgress>,
    processes: State<'_, NetworkProcesses>,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let processes = processes.inner().clone();
    let credentials = Some(
        auth::CommandConfig::configuration(&app, &repository, &operation_id)
            .map_err(|_| GitCommandError::internal("No se pudo iniciar la autenticación"))?,
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        network::push_configured(
            &repository,
            &branch,
            &options,
            &operation_id,
            on_progress,
            &processes,
            credentials.as_ref(),
        )?;
        undo.remember_barrier(&id);
        refs::read(&repository).map_err(|_| network::NetworkError::GitFailed)
    })
    .await
    .map_err(|_| GitCommandError::internal("La tarea de push se interrumpió"))?;
    result.map_err(map_network_error)
}

fn map_network_error(error: network::NetworkError) -> GitCommandError {
    match error {
        network::NetworkError::RemoteNotFound(remote) => {
            GitCommandError::new("remote.notFound", json!({ "remote": remote }))
        }
        network::NetworkError::PullNoUpstream(branch) => {
            GitCommandError::new("pull.noUpstream", json!({ "branch": branch }))
        }
        network::NetworkError::PushNoUpstream(branch) => {
            GitCommandError::new("push.noUpstream", json!({ "branch": branch }))
        }
        network::NetworkError::PushRejected {
            branch,
            remote,
            count,
        } => GitCommandError::new(
            "push.rejected",
            json!({ "branch": branch, "remote": remote, "count": count }),
        ),
        network::NetworkError::PushLeaseStale(reference) => {
            GitCommandError::new("ref.stale", json!({ "ref": reference }))
        }
        network::NetworkError::AuthenticationFailed(remote) => {
            GitCommandError::new("auth.failed", json!({ "remote": remote }))
        }
        network::NetworkError::Unreachable(remote) => {
            GitCommandError::new("network.unreachable", json!({ "remote": remote }))
        }
        network::NetworkError::Cancelled => GitCommandError::new("operation.cancelled", json!({})),
        network::NetworkError::MergeConflict {
            source,
            target,
            count,
        } => GitCommandError::new(
            "merge.conflict",
            json!({ "source": source, "target": target, "count": count }),
        ),
        network::NetworkError::RebaseConflict {
            source,
            target,
            sha,
            count,
        } => GitCommandError::new(
            "rebase.conflict",
            json!({ "source": source, "target": target, "sha": sha, "count": count }),
        ),
        network::NetworkError::GitFailed => {
            GitCommandError::internal("Git no pudo completar la operación de red")
        }
    }
}

#[tauri::command]
pub fn git_cancel_network(
    app: AppHandle,
    operation_id: String,
    processes: State<'_, NetworkProcesses>,
) {
    auth::cancel(&app, &operation_id);
    processes.cancel(operation_id);
}

#[tauri::command]
pub async fn git_add_remote(
    id: String,
    remote: remote_write::RemoteInput,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        with_ref_checkpoint(&id, &repository, &undo, "undo.remote", || {
            remote_write::add(&repository, &remote)
                .map_err(|error| map_remote_write_error(error, &remote.name))?;
            read_refs_after_remote_write(&repository)
                .map_err(|error| map_remote_write_error(error, &remote.name))
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La creación del remoto se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_update_remote(
    id: String,
    current_name: String,
    remote: remote_write::RemoteInput,
    expected: remote_write::RemotePrecondition,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        with_ref_checkpoint(&id, &repository, &undo, "undo.remote", || {
            remote_write::update(&repository, &current_name, &remote, &expected)
                .map_err(|error| map_remote_write_error(error, &remote.name))?;
            read_refs_after_remote_write(&repository)
                .map_err(|error| map_remote_write_error(error, &remote.name))
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La edición del remoto se interrumpió"))?;
    result
}

#[tauri::command]
pub async fn git_remove_remote(
    id: String,
    name: String,
    expected: remote_write::RemotePrecondition,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        with_ref_checkpoint(&id, &repository, &undo, "undo.remote", || {
            remote_write::remove(&repository, &name, &expected)
                .map_err(|error| map_remote_write_error(error, &name))?;
            read_refs_after_remote_write(&repository)
                .map_err(|error| map_remote_write_error(error, &name))
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La eliminación del remoto se interrumpió"))?;
    result
}

fn read_refs_after_remote_write(
    repository: &std::path::Path,
) -> Result<refs::RefsSnapshot, remote_write::WriteRemoteError> {
    refs::read(repository).map_err(|_| remote_write::WriteRemoteError::GitFailed)
}

fn map_remote_write_error(error: remote_write::WriteRemoteError, remote: &str) -> GitCommandError {
    match error {
        remote_write::WriteRemoteError::InvalidName => {
            GitCommandError::new("remote.invalidName", json!({ "remote": remote }))
        }
        remote_write::WriteRemoteError::InvalidUrl => {
            GitCommandError::new("remote.invalidUrl", json!({ "remote": remote }))
        }
        remote_write::WriteRemoteError::Exists => {
            GitCommandError::new("remote.exists", json!({ "remote": remote }))
        }
        remote_write::WriteRemoteError::NotFound => {
            GitCommandError::new("remote.notFound", json!({ "remote": remote }))
        }
        remote_write::WriteRemoteError::Stale => {
            GitCommandError::new("remote.stale", json!({ "remote": remote }))
        }
        remote_write::WriteRemoteError::GitFailed => {
            GitCommandError::internal("Git no pudo modificar el remoto")
        }
    }
}

#[tauri::command]
pub async fn git_create_branch(
    id: String,
    name: String,
    from: ref_write::RefTarget,
    options: ref_write::CreateBranchOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let branch = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let before_checkout = options
            .checks_out()
            .then(|| undo::checkout_snapshot(&repository))
            .flatten();
        ref_write::create_branch(&repository, &name, &from, &options)?;
        if options.checks_out() {
            let after_checkout = undo::checkout_snapshot(&repository);
            if let (Some(before), Some(after)) = (before_checkout, after_checkout) {
                undo.remember_created_ref(
                    &repository_id,
                    &repository,
                    format!("refs/heads/{name}"),
                    "undo.createBranch",
                    json!({ "branch": name.clone(), "from": from.label() }),
                );
                undo.remember_checkout(&repository_id, before, after);
            } else {
                undo.clear_redo(&repository_id);
            }
        } else {
            undo.remember_created_ref(
                &repository_id,
                &repository,
                format!("refs/heads/{name}"),
                "undo.createBranch",
                json!({ "branch": name }),
            );
        }
        refs::read(&repository).map_err(|error| match error {
            refs::ReadRefsError::InvalidEncoding => ref_write::WriteRefError::GitFailed(
                "El nombre de una referencia no es UTF-8".to_owned(),
            ),
            refs::ReadRefsError::GitFailed | refs::ReadRefsError::MalformedOutput => {
                ref_write::WriteRefError::GitFailed(String::new())
            }
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La creación de rama se interrumpió"))?;
    result.map_err(|error| match error {
        ref_write::WriteRefError::InvalidBranchName => {
            GitCommandError::new("create.invalidBranch", json!({ "branch": branch }))
        }
        ref_write::WriteRefError::InvalidTagName
        | ref_write::WriteRefError::TagIdentityMissing
        | ref_write::WriteRefError::DirtyTree(_)
        | ref_write::WriteRefError::RestoreFailed { .. }
        | ref_write::WriteRefError::Stale
        | ref_write::WriteRefError::CurrentBranch
        | ref_write::WriteRefError::NotMerged { .. } => {
            GitCommandError::internal("Error inesperado al crear la rama")
        }
        ref_write::WriteRefError::Exists => {
            GitCommandError::new("branch.exists", json!({ "branch": branch }))
        }
        ref_write::WriteRefError::RevisionNotFound(revision) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        ref_write::WriteRefError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
    })
}

#[tauri::command]
pub fn git_read_reflog(id: String) -> Result<Vec<reflog::ReflogEntry>, GitCommandError> {
    let repository = existing_repository(&id)?;
    reflog::read(&repository).map_err(|error| match error {
        reflog::ReflogError::InvalidEncoding => {
            GitCommandError::new("history.encodingUnsupported", json!({ "repo": id }))
        }
        reflog::ReflogError::MalformedOutput | reflog::ReflogError::GitFailed(_) => {
            GitCommandError::internal("Git no pudo leer el historial de recuperación")
        }
        reflog::ReflogError::Stale | reflog::ReflogError::Write(_) => {
            GitCommandError::internal("Error inesperado al leer el historial de recuperación")
        }
    })
}

#[tauri::command]
pub async fn git_recover_reflog_entry(
    id: String,
    name: String,
    selector: String,
    expected_sha: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let branch = name.clone();
    let stale_selector = selector.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reflog::recover(&repository, &name, &selector, &expected_sha)?;
        undo.remember_created_ref(
            &repository_id,
            &repository,
            format!("refs/heads/{name}"),
            "undo.recoverBranch",
            json!({ "branch": name }),
        );
        refs::read(&repository).map_err(|_| {
            reflog::ReflogError::GitFailed("No se pudieron releer las referencias".to_owned())
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La recuperación se interrumpió"))?;

    result.map_err(|error| match error {
        reflog::ReflogError::Stale => {
            GitCommandError::new("ref.stale", json!({ "ref": stale_selector }))
        }
        reflog::ReflogError::Write(ref_write::WriteRefError::InvalidBranchName) => {
            GitCommandError::new("create.invalidBranch", json!({ "branch": branch }))
        }
        reflog::ReflogError::Write(ref_write::WriteRefError::Exists) => {
            GitCommandError::new("branch.exists", json!({ "branch": branch }))
        }
        reflog::ReflogError::Write(ref_write::WriteRefError::RevisionNotFound(revision)) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        reflog::ReflogError::InvalidEncoding
        | reflog::ReflogError::MalformedOutput
        | reflog::ReflogError::GitFailed(_)
        | reflog::ReflogError::Write(_) => {
            GitCommandError::internal("Git no pudo crear la rama de recuperación")
        }
    })
}

#[tauri::command]
pub async fn git_create_tag(
    id: String,
    name: String,
    at: ref_write::RefTarget,
    options: ref_write::CreateTagOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let tag = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        ref_write::create_tag(&repository, &name, &at, &options)?;
        undo.remember_created_ref(
            &repository_id,
            &repository,
            format!("refs/tags/{name}"),
            "undo.createTag",
            json!({ "tag": name }),
        );
        refs::read(&repository).map_err(|error| match error {
            refs::ReadRefsError::InvalidEncoding => ref_write::WriteRefError::GitFailed(
                "El nombre de una referencia no es UTF-8".to_owned(),
            ),
            refs::ReadRefsError::GitFailed | refs::ReadRefsError::MalformedOutput => {
                ref_write::WriteRefError::GitFailed(String::new())
            }
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La creación de tag se interrumpió"))?;
    result.map_err(|error| match error {
        ref_write::WriteRefError::InvalidTagName => {
            GitCommandError::new("tag.invalidName", json!({ "tag": tag }))
        }
        ref_write::WriteRefError::TagIdentityMissing => {
            GitCommandError::new("tag.identityMissing", json!({}))
        }
        ref_write::WriteRefError::Exists => {
            GitCommandError::new("tag.exists", json!({ "tag": tag }))
        }
        ref_write::WriteRefError::RevisionNotFound(revision) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        ref_write::WriteRefError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
        ref_write::WriteRefError::InvalidBranchName
        | ref_write::WriteRefError::DirtyTree(_)
        | ref_write::WriteRefError::RestoreFailed { .. }
        | ref_write::WriteRefError::Stale
        | ref_write::WriteRefError::CurrentBranch
        | ref_write::WriteRefError::NotMerged { .. } => {
            GitCommandError::internal("Error inesperado al crear el tag")
        }
    })
}

#[tauri::command]
pub async fn git_checkout(
    id: String,
    target: ref_write::RefTarget,
    options: ref_write::CheckoutOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let label = target.label().to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match ref_write::checkout_undo_strategy(&repository, &target, &options) {
            ref_write::CheckoutUndoStrategy::Lightweight { created_reference } => {
                let before = undo::checkout_snapshot(&repository).ok_or_else(|| {
                    ref_write::WriteRefError::GitFailed(
                        "No se pudo registrar el estado anterior".to_owned(),
                    )
                })?;
                if let Err(error) = ref_write::checkout_clean(
                    &repository,
                    &target,
                    &options,
                    created_reference.as_deref(),
                ) {
                    if !matches!(error, ref_write::WriteRefError::DirtyTree(_)) {
                        return Err(error);
                    }
                    // El árbol cambió fuera de GitThul entre la selección de la
                    // estrategia y la escritura. Aún no se ha mutado nada: toma
                    // ahora el checkpoint fuerte y reintenta con auto-stash.
                    let checkpoint =
                        undo_checkpoint::Checkpoint::capture_checkout(&repository, &target)
                            .map_err(|_| {
                                ref_write::WriteRefError::GitFailed(
                                    "No se pudo crear el punto de recuperación".to_owned(),
                                )
                            })?;
                    checkpoint.recovery_set_label("undo.checkoutState").map_err(|_| {
                        ref_write::WriteRefError::GitFailed("No se pudo guardar el punto de recuperación".to_owned())
                    })?;
                    let result = ref_write::checkout(&repository, &target, &options);
                    let after = undo_checkpoint::Checkpoint::after(&repository, &checkpoint)
                        .map_err(|_| {
                            ref_write::WriteRefError::GitFailed(
                                "La copia previa permanece en el almacén de recuperación de GitThul".to_owned(),
                            )
                        })?;
                    undo.remember_checkpoint(
                        &repository_id,
                        checkpoint,
                        after,
                        "undo.checkoutState",
                    );
                    result?;
                    return refs::read(&repository).map_err(|error| match error {
                        refs::ReadRefsError::InvalidEncoding => {
                            ref_write::WriteRefError::GitFailed(
                                "El nombre de una referencia no es UTF-8".to_owned(),
                            )
                        }
                        refs::ReadRefsError::GitFailed | refs::ReadRefsError::MalformedOutput => {
                            ref_write::WriteRefError::GitFailed(String::new())
                        }
                    });
                }
                let after = undo::checkout_snapshot(&repository).ok_or_else(|| {
                    ref_write::WriteRefError::GitFailed(
                        "No se pudo registrar el estado posterior".to_owned(),
                    )
                })?;
                if let Some(reference) = created_reference {
                    let branch = reference
                        .strip_prefix("refs/heads/")
                        .unwrap_or(&reference)
                        .to_owned();
                    undo.remember_created_ref(
                        &repository_id,
                        &repository,
                        reference,
                        "undo.createBranch",
                        json!({ "branch": branch }),
                    );
                }
                undo.remember_checkout(&repository_id, before, after);
            }
            ref_write::CheckoutUndoStrategy::Checkpoint => {
                let before = undo_checkpoint::Checkpoint::capture_checkout(&repository, &target)
                    .map_err(|_| {
                        ref_write::WriteRefError::GitFailed(
                            "No se pudo crear el punto de recuperación".to_owned(),
                        )
                    })?;
                before.recovery_set_label("undo.checkoutState").map_err(|_| {
                    ref_write::WriteRefError::GitFailed("No se pudo guardar el punto de recuperación".to_owned())
                })?;
                let result = ref_write::checkout(&repository, &target, &options);
                let after =
                    undo_checkpoint::Checkpoint::after(&repository, &before).map_err(|_| {
                        ref_write::WriteRefError::GitFailed(
                            "La copia previa permanece en el almacén de recuperación de GitThul".to_owned(),
                        )
                    })?;
                undo.remember_checkpoint(&repository_id, before, after, "undo.checkoutState");
                result?;
            }
        }
        refs::read(&repository).map_err(|error| match error {
            refs::ReadRefsError::InvalidEncoding => ref_write::WriteRefError::GitFailed(
                "El nombre de una referencia no es UTF-8".to_owned(),
            ),
            refs::ReadRefsError::GitFailed | refs::ReadRefsError::MalformedOutput => {
                ref_write::WriteRefError::GitFailed(String::new())
            }
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("El cambio de referencia se interrumpió"))?;
    result.map_err(|error| match error {
        ref_write::WriteRefError::DirtyTree(count) => GitCommandError::new(
            "checkout.dirtyTree",
            json!({ "branch": label, "count": count }),
        ),
        ref_write::WriteRefError::RestoreFailed { output, count } => GitCommandError::git(
            "checkout.restoreFailed",
            json!({ "branch": label, "count": count }),
            output,
        ),
        ref_write::WriteRefError::RevisionNotFound(revision) => {
            GitCommandError::new("history.startNotFound", json!({ "start": revision }))
        }
        ref_write::WriteRefError::Stale => {
            GitCommandError::new("ref.stale", json!({ "ref": label }))
        }
        ref_write::WriteRefError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
        ref_write::WriteRefError::InvalidBranchName
        | ref_write::WriteRefError::InvalidTagName
        | ref_write::WriteRefError::TagIdentityMissing
        | ref_write::WriteRefError::Exists
        | ref_write::WriteRefError::CurrentBranch
        | ref_write::WriteRefError::NotMerged { .. } => {
            GitCommandError::internal("Error inesperado al cambiar de referencia")
        }
    })
}

#[tauri::command]
pub async fn git_delete_branch(
    id: String,
    name: String,
    options: ref_write::DeleteBranchOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let branch = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(target) = ref_write::delete_branch(&repository, &name, &options)? {
            undo.remember_deleted_ref(
                &repository_id,
                format!("refs/heads/{name}"),
                target,
                "undo.deleteBranch",
                json!({ "branch": name }),
            );
        }
        refs::read(&repository).map_err(|_| ref_write::WriteRefError::GitFailed(String::new()))
    })
    .await
    .map_err(|_| GitCommandError::internal("El borrado de rama se interrumpió"))?;
    result.map_err(|error| match error {
        ref_write::WriteRefError::Stale => {
            GitCommandError::new("ref.stale", json!({ "ref": branch }))
        }
        ref_write::WriteRefError::CurrentBranch => {
            GitCommandError::new("branch.current", json!({ "branch": branch }))
        }
        ref_write::WriteRefError::NotMerged { target, count } => GitCommandError::new(
            "branch.notMerged",
            json!({ "branch": branch, "target": target, "count": count }),
        ),
        ref_write::WriteRefError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
        _ => GitCommandError::internal("Error inesperado al borrar la rama"),
    })
}

#[tauri::command]
pub async fn git_delete_tag(
    id: String,
    name: String,
    options: ref_write::DeleteTagOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let tag = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(target) = ref_write::delete_tag(&repository, &name, &options)? {
            undo.remember_deleted_ref(
                &repository_id,
                format!("refs/tags/{name}"),
                target,
                "undo.deleteTag",
                json!({ "tag": name }),
            );
        }
        refs::read(&repository).map_err(|_| ref_write::WriteRefError::GitFailed(String::new()))
    })
    .await
    .map_err(|_| GitCommandError::internal("El borrado de tag se interrumpió"))?;
    result.map_err(|error| match error {
        ref_write::WriteRefError::Stale => GitCommandError::new("ref.stale", json!({ "ref": tag })),
        ref_write::WriteRefError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
        _ => GitCommandError::internal("Error inesperado al borrar el tag"),
    })
}

#[tauri::command]
pub async fn git_rename_branch(
    id: String,
    from: String,
    to: String,
    options: ref_write::RenameBranchOptions,
    locks: State<'_, GitWriteLocks>,
) -> Result<refs::RefsSnapshot, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let source = from.clone();
    let destination = to.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let before = undo::rename_snapshot(&repository, &from);
        ref_write::rename_branch(&repository, &from, &to, &options)?;
        let after = undo::rename_snapshot(&repository, &to);
        if from != to {
            if let (Some(before), Some(after)) = (before, after) {
                undo.remember_rename(&repository_id, before, after);
            } else {
                undo.clear_redo(&repository_id);
            }
        }
        refs::read(&repository).map_err(|_| ref_write::WriteRefError::GitFailed(String::new()))
    })
    .await
    .map_err(|_| GitCommandError::internal("El rename de rama se interrumpió"))?;
    result.map_err(|error| match error {
        ref_write::WriteRefError::InvalidBranchName => {
            GitCommandError::new("create.invalidBranch", json!({ "branch": destination }))
        }
        ref_write::WriteRefError::Exists => {
            GitCommandError::new("branch.exists", json!({ "branch": destination }))
        }
        ref_write::WriteRefError::Stale => {
            GitCommandError::new("ref.stale", json!({ "ref": source }))
        }
        ref_write::WriteRefError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
        _ => GitCommandError::internal("Error inesperado al renombrar la rama"),
    })
}

#[tauri::command]
pub async fn git_stage(
    id: String,
    paths: Vec<String>,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.stage",
        Vec::new(),
        move |repository| write::stage(repository, &paths),
    )
    .await
}

#[tauri::command]
pub async fn git_unstage(
    id: String,
    paths: Vec<String>,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.unstage",
        Vec::new(),
        move |repository| write::unstage(repository, &paths),
    )
    .await
}

#[tauri::command]
pub async fn git_stage_hunks(
    id: String,
    request: write::PartialRequest,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.stage",
        Vec::new(),
        move |repository| write::stage_partial(repository, request),
    )
    .await
}

#[tauri::command]
pub async fn git_unstage_hunks(
    id: String,
    request: write::PartialRequest,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.unstage",
        Vec::new(),
        move |repository| write::unstage_partial(repository, request),
    )
    .await
}

#[tauri::command]
pub async fn git_stage_lines(
    id: String,
    request: write::PartialRequest,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.stage",
        Vec::new(),
        move |repository| write::stage_partial(repository, request),
    )
    .await
}

#[tauri::command]
pub async fn git_unstage_lines(
    id: String,
    request: write::PartialRequest,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.unstage",
        Vec::new(),
        move |repository| write::unstage_partial(repository, request),
    )
    .await
}

#[tauri::command]
pub async fn git_discard_all(
    id: String,
    precondition: status::ResetPrecondition,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    let repository = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        discard_all_with_recovery(&id, &repository, &undo, &precondition)?;
        status::read(&repository).map_err(|_| GitCommandError::internal("No se pudo leer el WIP"))
    })
    .await
    .map_err(|_| GitCommandError::internal("El descarte se interrumpió"))?
}

#[tauri::command]
pub async fn git_discard(
    id: String,
    targets: Vec<write::DiscardTarget>,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.discard",
        targets.iter().map(|target| target.path.clone()).collect(),
        move |repository| write::discard(repository, targets),
    )
    .await
}

fn discard_all_with_recovery(
    id: &str,
    repository: &std::path::Path,
    undo: &undo::UndoStacks,
    precondition: &status::ResetPrecondition,
) -> Result<(), GitCommandError> {
    let before = undo_checkpoint::Checkpoint::capture_restore(repository, "HEAD", true)
        .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(id, repository, undo, "undo.discard", before, || {
        write::discard_all(repository, precondition)
            .map_err(|error| map_local_write_error(error, id))
    })
}

#[tauri::command]
pub async fn git_discard_lines(
    id: String,
    request: write::PartialRequest,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_local_write(
        id,
        locks.inner().clone(),
        "undo.discard",
        vec![request.path.clone()],
        move |repository| write::discard_partial(repository, request),
    )
    .await
}

#[tauri::command]
pub async fn git_resolve_conflict(
    id: String,
    path: String,
    content: String,
    expected_revision: Option<String>,
    encoding: Option<String>,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_resolve_write(
        id,
        locks.inner().clone(),
        Some(vec![path.clone()]),
        move |repository, id, snapshots| {
            resolve::content_checked_encoded(
                repository,
                id,
                &path,
                &content,
                expected_revision.as_deref(),
                encoding.as_deref(),
                snapshots,
            )
            .map(|_| None)
        },
    )
    .await
    .map(|result| result.status)
}

#[tauri::command]
pub async fn git_mark_conflict_resolved(
    id: String,
    path: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_resolve_write(
        id,
        locks.inner().clone(),
        Some(vec![path.clone()]),
        move |repository, id, snapshots| {
            resolve::mark(repository, id, &path, snapshots).map(|_| None)
        },
    )
    .await
    .map(|result| result.status)
}

#[tauri::command]
pub async fn git_mark_conflicts_resolved(
    id: String,
    paths: Vec<String>,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_resolve_write(
        id,
        locks.inner().clone(),
        Some(paths.clone()),
        move |repository, id, snapshots| {
            resolve::mark_many(repository, id, &paths, snapshots).map(|_| None)
        },
    )
    .await
    .map(|result| result.status)
}

#[tauri::command]
pub async fn git_unresolve_conflict(
    id: String,
    path: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_resolve_write(
        id,
        locks.inner().clone(),
        Some(vec![path.clone()]),
        move |repository, id, snapshots| {
            resolve::unresolve(repository, id, &path, snapshots).map(|_| None)
        },
    )
    .await
    .map(|result| result.status)
}

#[tauri::command]
pub async fn git_keep_side(
    id: String,
    path: String,
    side: resolve::ConflictSide,
    locks: State<'_, GitWriteLocks>,
) -> Result<status::WorkingStatus, GitCommandError> {
    run_resolve_write(
        id,
        locks.inner().clone(),
        Some(vec![path.clone()]),
        move |repository, id, snapshots| {
            resolve::keep_side(repository, id, &path, side, snapshots).map(|_| None)
        },
    )
    .await
    .map(|result| result.status)
}

#[derive(Serialize)]
pub struct AutoResolveResult {
    resolved: Vec<resolve::Resolution>,
    status: status::WorkingStatus,
}

#[tauri::command]
pub async fn git_auto_resolve(
    id: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<AutoResolveResult, GitCommandError> {
    let result = run_resolve_write(
        id,
        locks.inner().clone(),
        None,
        move |repository, id, snapshots| resolve::auto(repository, id, snapshots).map(Some),
    )
    .await?;
    Ok(AutoResolveResult {
        resolved: result.resolved.unwrap_or_default(),
        status: result.status,
    })
}

#[tauri::command]
pub async fn git_continue_operation(
    id: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    run_operation_write(id, locks.inner().clone(), OperationAction::Continue).await
}

#[tauri::command]
pub async fn git_abort_operation(
    id: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    run_operation_write(id, locks.inner().clone(), OperationAction::Abort).await
}

#[tauri::command]
pub async fn git_quit_operation(
    id: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    run_operation_write(id, locks.inner().clone(), OperationAction::Quit).await
}

#[tauri::command]
pub async fn git_commit(
    id: String,
    request: commit::CommitRequest,
    locks: State<'_, GitWriteLocks>,
) -> Result<String, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let integrating = repository::discover(&path)
            .is_ok_and(|repo| !matches!(repo.operation(), repository::RepoOperation::None));
        let checkpoint = if integrating {
            Some(
                undo_checkpoint::Checkpoint::capture_commit(&path).map_err(|_| {
                    commit::CommitError::GitFailed(
                        "No se pudo crear el punto de recuperación".to_owned(),
                    )
                })?,
            )
        } else {
            None
        };
        if let Some(checkpoint) = &checkpoint {
            checkpoint
                .recovery_set_label("undo.continue")
                .map_err(|_| {
                    commit::CommitError::GitFailed(
                        "No se pudo guardar el punto de recuperación".to_owned(),
                    )
                })?;
        }
        let before = status::commit_precondition(&path);
        let amend = request.amend();
        let summary = request.summary().to_owned();
        let branch = git_head_label(&path);
        let sha = commit::commit(&path, request)?;
        if let Some(before_checkpoint) = checkpoint {
            let after =
                undo_checkpoint::Checkpoint::after(&path, &before_checkpoint).map_err(|_| {
                    commit::CommitError::GitFailed(
                        "La copia previa permanece en el almacén de recuperación de GitThul"
                            .to_owned(),
                    )
                })?;
            undo.remember_checkpoint(&repository_id, before_checkpoint, after, "undo.continue");
        } else {
            undo.remember_commit(&repository_id, before, sha.clone(), amend, branch, summary);
        }
        Ok(sha)
    })
    .await
    .map_err(|_| GitCommandError::internal("El commit Git se interrumpió"))?;
    result.map_err(|error| match error {
        commit::CommitError::IdentityMissing => {
            GitCommandError::new("commit.identityMissing", json!({}))
        }
        commit::CommitError::NothingStaged => {
            GitCommandError::new("commit.nothingStaged", json!({}))
        }
        commit::CommitError::Stale => GitCommandError::new("commit.stale", json!({})),
        commit::CommitError::Locked => GitCommandError::new("repo.locked", json!({ "repo": id })),
        commit::CommitError::GitFailed(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
    })
}

fn git_head_label(repository: &std::path::Path) -> String {
    let output = crate::process::command("git")
        .args(["symbolic-ref", "--short", "-q", "HEAD"])
        .current_dir(repository)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output();
    output
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "HEAD".to_owned())
}

#[tauri::command]
pub fn git_read_undo_stack(id: String, locks: State<'_, GitWriteLocks>) -> undo::UndoSnapshot {
    locks.undo.read(&id)
}

#[tauri::command]
pub async fn git_undo(
    id: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    run_undo_operation(id, locks.inner().clone(), true).await
}

#[tauri::command]
pub async fn git_redo(
    id: String,
    locks: State<'_, GitWriteLocks>,
) -> Result<Repository, GitCommandError> {
    run_undo_operation(id, locks.inner().clone(), false).await
}

async fn run_undo_operation(
    id: String,
    locks: GitWriteLocks,
    undoing: bool,
) -> Result<Repository, GitCommandError> {
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }
    let repository_lock = locks.repository(&id);
    let stacks = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if undoing {
            stacks.undo(&repository_id, &path)?;
        } else {
            stacks.redo(&repository_id, &path)?;
        }
        resolutions.clear_repository(&repository_id);
        repository::discover(&path).map_err(|_| undo::UndoError::GitFailed)
    })
    .await
    .map_err(|_| GitCommandError::internal("Deshacer Git se interrumpió"))?
    .map_err(|error| match error {
        undo::UndoError::Stale => GitCommandError::new("undo.stale", json!({})),
        undo::UndoError::GitFailed => {
            GitCommandError::internal("Git no pudo deshacer la operación")
        }
    })
}

#[tauri::command]
pub async fn git_watch_repository(
    id: String,
    operation_id: String,
    on_change: Channel<watch::RepositoryChange>,
    watchers: State<'_, GitWatchers>,
) -> Result<(), GitCommandError> {
    let watchers = watchers.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::PathBuf::from(&id);
        if !path.exists() {
            return Err(GitCommandError::new(
                "repo.notFound",
                json!({ "repo": id, "path": id }),
            ));
        }
        if repository::discover(&path).is_err() {
            return Err(GitCommandError::new(
                "repo.notARepository",
                json!({ "path": id }),
            ));
        }
        let watcher = watch::start(&path, move |event| {
            let _ = on_change.send(event);
        })
        .map_err(|_| GitCommandError::internal("No se pudo observar el repositorio"))?;
        let previous = watchers
            .watchers
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(operation_id, watcher);
        drop(previous);
        Ok(())
    })
    .await
    .map_err(|_| GitCommandError::internal("No se pudo iniciar el observador del repositorio"))?
}

#[tauri::command]
pub async fn git_unwatch_repository(
    operation_id: String,
    watchers: State<'_, GitWatchers>,
) -> Result<(), GitCommandError> {
    let watcher = watchers
        .watchers
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&operation_id);
    if let Some(watcher) = watcher {
        tauri::async_runtime::spawn_blocking(move || drop(watcher))
            .await
            .map_err(|_| {
                GitCommandError::internal("No se pudo detener el observador del repositorio")
            })?;
    }
    Ok(())
}

async fn run_local_write<F>(
    id: String,
    locks: GitWriteLocks,
    label: &'static str,
    paths: Vec<String>,
    operation: F,
) -> Result<status::WorkingStatus, GitCommandError>
where
    F: FnOnce(&std::path::Path) -> Result<(), write::WriteError> + Send + 'static,
{
    let path = std::path::PathBuf::from(&id);
    if !path.exists() {
        return Err(GitCommandError::new(
            "repo.notFound",
            json!({ "repo": id, "path": id }),
        ));
    }
    if repository::discover(&path).is_err() {
        return Err(GitCommandError::new(
            "repo.notARepository",
            json!({ "path": id }),
        ));
    }
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let paths = if label == "undo.discard" {
            write::recovery_paths(&path, &paths)?
        } else {
            Vec::new() // Stage/unstage write only the index.
        };
        let integrating = repository::discover(&path)
            .is_ok_and(|repo| !matches!(repo.operation(), repository::RepoOperation::None));
        let result = if integrating
            || undo_checkpoint::index_write_requires_full(&path)
                .map_err(|_| write::WriteError::RecoveryUnavailable)?
        {
            // Unmerged stages need the integration metadata, but only these
            // paths can be written. Do not also create a LocalSnapshot.
            let before =
                undo_checkpoint::Checkpoint::capture_selected(&path, paths.into_iter().collect())
                    .map_err(|_| write::WriteError::RecoveryUnavailable)?;
            before
                .recovery_set_label(label)
                .map_err(|_| write::WriteError::RecoveryUnavailable)?;
            let result = operation(&path);
            let after = undo_checkpoint::Checkpoint::after(&path, &before)
                .map_err(|_| write::WriteError::RecoveryUnavailable)?;
            undo.remember_checkpoint(&repository_id, before, after, label);
            result
        } else {
            let before = undo_local::LocalSnapshot::capture(&path, &paths)
                .map_err(|_| write::WriteError::RecoveryUnavailable)?;
            let result = operation(&path);
            if let Ok(after) = undo_local::LocalSnapshot::capture(&path, &paths) {
                undo.remember_local(&repository_id, before, after, label);
            } else {
                undo.clear_redo(&repository_id);
            }
            result
        };
        result?;
        status::read(&path).map_err(|error| match error {
            status::ReadStatusError::InvalidPathEncoding => write::WriteError::InvalidPathEncoding,
            status::ReadStatusError::GitFailed | status::ReadStatusError::MalformedOutput => {
                write::WriteError::GitFailed
            }
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La escritura Git se interrumpió"))?;

    result.map_err(|error| map_local_write_error(error, &id))
}

fn map_local_write_error(error: write::WriteError, id: &str) -> GitCommandError {
    match error {
        write::WriteError::GitFailedWithOutput(output) => {
            GitCommandError::git("unknown", json!({}), output)
        }
        write::WriteError::RecoveryUnavailable => {
            GitCommandError::new("undo.snapshotUnavailable", json!({}))
        }
        write::WriteError::Stale(path) => {
            GitCommandError::new("write.stale", json!({ "path": path }))
        }
        write::WriteError::InvalidPathEncoding => {
            GitCommandError::new("path.encodingUnsupported", json!({ "repo": id }))
        }
        write::WriteError::InvalidPath
        | write::WriteError::MalformedDiff
        | write::WriteError::UnsupportedSelection
        | write::WriteError::FileSystemFailed
        | write::WriteError::GitFailed => {
            GitCommandError::internal("Git no pudo aplicar el cambio")
        }
    }
}

struct ResolveWriteResult {
    resolved: Option<Vec<resolve::Resolution>>,
    status: status::WorkingStatus,
}

async fn run_resolve_write<F>(
    id: String,
    locks: GitWriteLocks,
    paths: Option<Vec<String>>,
    operation: F,
) -> Result<ResolveWriteResult, GitCommandError>
where
    F: FnOnce(
            &std::path::Path,
            &str,
            &resolve::ResolutionSnapshots,
        ) -> Result<Option<Vec<resolve::Resolution>>, resolve::ResolveError>
        + Send
        + 'static,
{
    let path = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let snapshots = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let selected = match paths {
            Some(paths) => paths.into_iter().collect(),
            None => undo_checkpoint::conflicted_paths(&path)
                .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?,
        };
        let before = undo_checkpoint::Checkpoint::capture_selected(&path, selected)
            .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
        with_prepared_checkpoint(&repository_id, &path, &undo, "undo.resolve", before, || {
            let resolved =
                operation(&path, &repository_id, &snapshots).map_err(map_resolve_error)?;
            let status = status::read(&path)
                .map_err(|error| match error {
                    status::ReadStatusError::InvalidPathEncoding => {
                        resolve::ResolveError::InvalidPathEncoding
                    }
                    status::ReadStatusError::GitFailed
                    | status::ReadStatusError::MalformedOutput => resolve::ResolveError::GitFailed,
                })
                .map_err(map_resolve_error)?;
            Ok(ResolveWriteResult { resolved, status })
        })
    })
    .await
    .map_err(|_| GitCommandError::internal("La resolución Git se interrumpió"))?;

    result
}

fn map_resolve_error(error: resolve::ResolveError) -> GitCommandError {
    match error {
        resolve::ResolveError::NotConflicted(path) => {
            GitCommandError::new("resolve.notConflicted", json!({ "path": path }))
        }
        resolve::ResolveError::Stale(path) => {
            GitCommandError::new("write.stale", json!({ "path": path }))
        }
        resolve::ResolveError::UnsupportedEncoding(encoding) => {
            GitCommandError::new("text.encodingUnsupported", json!({ "encoding": encoding }))
        }
        resolve::ResolveError::Unrepresentable { path, encoding } => GitCommandError::new(
            "resolve.unrepresentable",
            json!({ "path": path, "encoding": encoding }),
        ),
        resolve::ResolveError::WriteFailed(path) => {
            GitCommandError::new("resolve.writeFailed", json!({ "path": path }))
        }
        resolve::ResolveError::InvalidPathEncoding => {
            GitCommandError::new("path.encodingUnsupported", json!({ "repo": "" }))
        }
        resolve::ResolveError::InvalidPath | resolve::ResolveError::GitFailed => {
            GitCommandError::internal("Git no pudo resolver el conflicto")
        }
    }
}

enum OperationAction {
    Continue,
    Abort,
    Quit,
}

async fn run_operation_write(
    id: String,
    locks: GitWriteLocks,
    action: OperationAction,
) -> Result<Repository, GitCommandError> {
    let path = existing_repository(&id)?;
    let repository_lock = locks.repository(&id);
    let undo = locks.undo.clone();
    let resolutions = locks.resolutions.clone();
    let repository_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = repository_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let result = operation_with_recovery(&repository_id, &path, &undo, action);
        if result.is_ok() {
            resolutions.clear_repository(&repository_id);
        }
        result
    })
    .await
    .map_err(|_| GitCommandError::internal("La operación Git se interrumpió"))?;

    result
}

fn operation_with_recovery(
    id: &str,
    path: &std::path::Path,
    undo: &undo::UndoStacks,
    action: OperationAction,
) -> Result<Repository, GitCommandError> {
    let current = repository::discover(path)
        .map_err(|_| GitCommandError::internal("Git no pudo leer la operación"))?;
    let before = if matches!(action, OperationAction::Quit)
        || (matches!(action, OperationAction::Continue)
            && stash::recovery_kind(path).is_some()
            && matches!(current.operation(), repository::RepoOperation::None))
    {
        undo_checkpoint::Checkpoint::capture_refs(path)
    } else if matches!(action, OperationAction::Continue)
        && matches!(current.operation(), repository::RepoOperation::Merge { .. })
    {
        undo_checkpoint::Checkpoint::capture_commit(path)
    } else if matches!(action, OperationAction::Abort)
        && matches!(current.operation(), repository::RepoOperation::Merge { .. })
    {
        undo_checkpoint::Checkpoint::capture_merge_abort(path)
    } else if matches!(action, OperationAction::Abort)
        && stash::recovery_kind(path).is_some()
        && matches!(current.operation(), repository::RepoOperation::None)
    {
        undo_checkpoint::Checkpoint::capture_stash_abort(path)
    } else {
        undo_checkpoint::Checkpoint::capture(path, &[])
    }
    .map_err(|_| GitCommandError::new("undo.snapshotUnavailable", json!({})))?;
    with_prepared_checkpoint(
        id,
        path,
        undo,
        match action {
            OperationAction::Continue => "undo.continue",
            OperationAction::Abort => "undo.abort",
            OperationAction::Quit => "undo.quit",
        },
        before,
        || {
            match action {
                OperationAction::Continue => operation::continue_operation(path),
                OperationAction::Abort => operation::abort_operation(path),
                OperationAction::Quit => operation::quit_operation(path),
            }
            .map_err(map_operation_error)
        },
    )
}

fn map_operation_error(error: operation::OperationError) -> GitCommandError {
    match error {
        operation::OperationError::StillConflicted(count) => {
            GitCommandError::new("resolve.stillConflicted", json!({ "count": count }))
        }
        operation::OperationError::GitFailed => {
            GitCommandError::internal("Git no pudo cerrar la operación")
        }
        operation::OperationError::NoOperation => {
            GitCommandError::internal("No hay una operación Git en curso")
        }
        operation::OperationError::Stash(error) => map_stash_error(error),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod registry_refresh_tests {
    use std::fs;
    use std::process::Command;

    use serde_json::json;
    use tempfile::TempDir;

    use super::{refresh_registry, registry::Registry};

    #[test]
    fn migra_ids_historicos_y_consolida_sin_borrar_rutas_ausentes() {
        let temporary = TempDir::new().expect("carpeta temporal");
        let repository = temporary.path().join("real");
        fs::create_dir(&repository).unwrap();
        let status = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(&repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .expect("Git CLI disponible");
        assert!(status.success());

        let path = repository.to_string_lossy().into_owned();
        let missing = temporary
            .path()
            .join("ausente")
            .to_string_lossy()
            .into_owned();
        let mut registry = Registry::from_value(json!({
            "version": 1,
            "repositories": [
                { "id": "gitthul", "name": "viejo", "path": path, "head": "master", "lastOpenedAt": 10 },
                { "id": "duplicado", "name": "otro", "path": path, "head": "main", "lastOpenedAt": 20 },
                { "id": "ausente", "name": "ausente", "path": missing, "head": "main", "lastOpenedAt": null }
            ]
        }))
        .expect("registro histórico");

        assert!(refresh_registry(&mut registry));
        assert_eq!(registry.repositories.len(), 2);
        let current = registry
            .repositories
            .iter()
            .find(|known| known.path == fs::canonicalize(&repository).unwrap().to_string_lossy())
            .expect("ficha canónica");
        assert_eq!(
            current.id,
            fs::canonicalize(&repository).unwrap().to_string_lossy()
        );
        assert_eq!(current.name, "real");
        assert_eq!(current.head, "main");
        assert_eq!(current.last_opened_at, Some(20));
        assert!(registry
            .repositories
            .iter()
            .any(|known| known.id == "ausente" && known.path == missing));
        assert!(!refresh_registry(&mut registry));
    }
}

#[cfg(test)]
mod repository_read_tests {
    use std::fs;
    use std::process::Command;

    use tempfile::TempDir;

    use super::git_read_repository;

    #[test]
    fn lee_identidad_real_y_distingue_ausencia_de_carpeta_no_git() {
        let temporary = TempDir::new().expect("carpeta temporal");
        let repository = temporary.path().join("real");
        fs::create_dir(&repository).unwrap();
        let status = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(&repository)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .expect("Git CLI disponible");
        assert!(status.success());

        let path = fs::canonicalize(&repository)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let read = git_read_repository(path.clone()).expect("repositorio real");
        assert_eq!(read.id, path);
        assert_eq!(read.name, "real");
        assert_eq!(read.head, "main");

        let ordinary = temporary.path().join("carpeta");
        fs::create_dir(&ordinary).unwrap();
        assert_eq!(
            git_read_repository(ordinary.to_string_lossy().into_owned())
                .expect_err("no es repositorio")
                .code,
            "repo.notARepository"
        );
        assert_eq!(
            git_read_repository(
                temporary
                    .path()
                    .join("ausente")
                    .to_string_lossy()
                    .into_owned()
            )
            .expect_err("ruta ausente")
            .code,
            "repo.notFound"
        );
    }
}

#[cfg(test)]
mod clone_tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tauri::ipc::Channel;
    use tempfile::TempDir;

    use super::{
        classify_clone_error, clone_source_contains_credentials, clone_source_label,
        parse_clone_progress, run_clone, CloneProcesses, CloneRepositoryRequest,
    };

    fn git(directory: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(directory)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .status()
            .expect("Git CLI disponible");
        assert!(status.success(), "git {args:?}");
    }

    #[test]
    fn interpreta_el_progreso_maquina_de_git_clone() {
        let receiving = parse_clone_progress("Receiving objects:  42% (21/50), 1.00 KiB").unwrap();
        assert_eq!(receiving.phase, "receiving");
        assert_eq!(receiving.received, 21);
        assert_eq!(receiving.total, Some(50));
        assert!(parse_clone_progress("Cloning into 'destino'...").is_none());
    }

    #[test]
    fn distingue_una_fuente_invalida_sin_exponerla_a_git() {
        let temporary = TempDir::new().expect("carpeta temporal");
        let error = run_clone(
            CloneRepositoryRequest {
                url: "esto no es un remoto".to_owned(),
                path: temporary.path().to_string_lossy().into_owned(),
                name: "copia".to_owned(),
            },
            "invalida".to_owned(),
            Channel::new(|_| Ok(())),
            &CloneProcesses::default(),
            None,
        )
        .expect_err("fuente inválida");
        assert_eq!(error.code, "clone.invalidUrl");
        assert!(!temporary.path().join("copia").exists());
    }

    #[test]
    fn clona_un_remoto_local_real_sin_tocar_la_red() {
        let temporary = TempDir::new().expect("carpeta temporal");
        let source = temporary.path().join("origen");
        fs::create_dir(&source).unwrap();
        git(&source, &["init", "--initial-branch=main"]);
        fs::write(source.join(".gitattributes"), "*.md text eol=lf\n").unwrap();
        fs::write(source.join("README.md"), "contenido\n").unwrap();
        git(&source, &["add", "README.md", ".gitattributes"]);
        git(&source, &["commit", "-m", "inicio"]);
        let bare = temporary.path().join("remoto.git");
        git(
            temporary.path(),
            &[
                "clone",
                "--bare",
                source.to_str().unwrap(),
                bare.to_str().unwrap(),
            ],
        );

        let repository = run_clone(
            CloneRepositoryRequest {
                url: bare.to_string_lossy().into_owned(),
                path: temporary.path().to_string_lossy().into_owned(),
                name: "copia".to_owned(),
            },
            "prueba".to_owned(),
            Channel::new(|_| Ok(())),
            &CloneProcesses::default(),
            None,
        )
        .expect("clon local");

        assert_eq!(repository.head, "main");
        assert_eq!(
            fs::read_to_string(temporary.path().join("copia/README.md")).unwrap(),
            "contenido\n"
        );
    }

    #[test]
    fn clasifica_fallos_de_credenciales_acceso_red_y_ausencia() {
        assert_eq!(
            classify_clone_error("github.example", "fatal: Authentication failed".to_owned()).code,
            "auth.failed"
        );
        assert_eq!(
            classify_clone_error("github.example", "ERROR: Repository not found".to_owned()).code,
            "clone.unavailable"
        );
        assert_eq!(
            classify_clone_error(
                "github.example",
                "ssh: Could not resolve hostname github.example".to_owned()
            )
            .code,
            "network.unreachable"
        );
        assert_eq!(
            classify_clone_error("github.example", "fatal: otro fallo".to_owned()).code,
            "unknown"
        );
    }

    #[test]
    fn rechaza_secretos_en_https_y_redacta_la_etiqueta() {
        let source = "https://token@github.example/equipo/privado.git";
        assert!(clone_source_contains_credentials(source));
        assert_eq!(
            clone_source_label(source),
            "https://github.example/equipo/privado.git"
        );
        assert!(!clone_source_contains_credentials(
            "git@github.example:equipo/privado.git"
        ));
    }
}

#[cfg(test)]
mod identity_tests {
    use super::{set_identity, GitIdentity};
    use std::{fs, process::Command};
    #[test]
    fn profile_uses_worktree_config_when_enabled() {
        let folder = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git")
                .current_dir(folder.path())
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        };
        git(&["init", "-q"]);
        git(&["config", "user.name", "Shared name"]);
        git(&["config", "user.email", "shared@example.invalid"]);
        git(&["config", "extensions.worktreeConfig", "true"]);
        // A common config lock must not prevent editing config.worktree.
        fs::write(folder.path().join(".git/config.lock"), b"other process").unwrap();
        set_identity(
            folder.path(),
            &GitIdentity {
                name: "Worktree name".into(),
                email: "worktree@example.invalid".into(),
            },
        )
        .unwrap();
        assert_eq!(git(&["config", "--get", "user.name"]), "Worktree name");
        assert_eq!(
            git(&["config", "--get", "user.email"]),
            "worktree@example.invalid"
        );
        assert_eq!(
            git(&["config", "--local", "--get", "user.name"]),
            "Shared name"
        );
        assert_eq!(
            fs::read(folder.path().join(".git/config.lock")).unwrap(),
            b"other process"
        );
        assert!(!folder.path().join(".git/config.worktree.lock").exists());
    }
    #[test]
    fn profile_updates_only_repository_config_and_preserves_other_fields() {
        let folder = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(folder.path())
            .status()
            .unwrap()
            .success());
        let config = folder.path().join(".git/config");
        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str("\n[remote \"origin\"]\n\turl = https://example.invalid/project.git\n[user]\n\tname = Old\n\temail = old@example.invalid\n");
        fs::write(&config, text).unwrap();
        set_identity(
            folder.path(),
            &GitIdentity {
                name: "New name".into(),
                email: "new@example.invalid".into(),
            },
        )
        .unwrap();
        let get = |key: &str| {
            String::from_utf8(
                Command::new("git")
                    .current_dir(folder.path())
                    .args(["config", "--local", "--get", key])
                    .output()
                    .unwrap()
                    .stdout,
            )
            .unwrap()
            .trim()
            .to_owned()
        };
        assert_eq!(get("user.name"), "New name");
        assert_eq!(get("user.email"), "new@example.invalid");
        assert_eq!(
            get("remote.origin.url"),
            "https://example.invalid/project.git"
        );
        assert!(!folder.path().join(".git/config.lock").exists());
    }
    #[test]
    fn profile_rejects_invalid_identity_and_existing_config_lock_without_partial_write() {
        let folder = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(folder.path())
            .status()
            .unwrap()
            .success());
        let config = folder.path().join(".git/config");
        let before = fs::read(&config).unwrap();
        assert!(set_identity(
            folder.path(),
            &GitIdentity {
                name: "Valid".into(),
                email: "\nunsafe".into()
            }
        )
        .is_err());
        assert_eq!(fs::read(&config).unwrap(), before);
        fs::write(folder.path().join(".git/config.lock"), b"other process").unwrap();
        assert!(set_identity(
            folder.path(),
            &GitIdentity {
                name: "Valid".into(),
                email: "valid@example.invalid".into()
            }
        )
        .is_err());
        assert_eq!(fs::read(&config).unwrap(), before);
        assert_eq!(
            fs::read(folder.path().join(".git/config.lock")).unwrap(),
            b"other process"
        );
    }
}

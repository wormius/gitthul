//! Autenticación por repositorio. Secretos en llavero o memoria de la operación;
//! el auxiliar recibe únicamente un canal local con nonce aleatorio.
use crate::{keyring, store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

const FILE: &str = "access.json";
const ADDRESS: &str = "GITTHUL_AUTH_ADDRESS";
const NONCE: &str = "GITTHUL_AUTH_NONCE";
const HELPER: &str = "!\"$GITTHUL_AUTH_EXECUTABLE\" auth-helper";
const LIMIT: u64 = 128 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    id: String,
    alias: String,
    path: String,
    public_key: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    url: String,
    method: String,
    username: String,
    key_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Binding {
    repository: String,
    access: Access,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Catalog {
    keys: Vec<SshKey>,
    bindings: Vec<Binding>,
}
#[derive(Deserialize)]
pub struct Answer {
    username: String,
    secret: String,
    remember: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Challenge {
    id: String,
    operation_id: String,
    repository: String,
    url: String,
    kind: String,
    prompt: String,
    username: String,
}
struct Pending {
    operation: String,
    stopped: Arc<AtomicBool>,
    sender: mpsc::Sender<Option<Answer>>,
}
#[derive(Default)]
pub struct Authentication {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    catalog: Mutex<()>,
    pending: Mutex<HashMap<String, Pending>>,
}

fn error() -> String {
    "No se pudo completar la configuración de acceso".into()
}
fn valid(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(char::is_control)
}
fn catalog(app: &AppHandle) -> Result<Catalog, String> {
    let value = store::read(app, FILE)?;
    if value.as_object().is_some_and(|value| value.is_empty()) {
        return Ok(Catalog::default());
    }
    serde_json::from_value(value).map_err(|_| error())
}
fn save(app: &AppHandle, value: &Catalog) -> Result<(), String> {
    store::write(
        app,
        FILE,
        &serde_json::to_value(value).map_err(|_| error())?,
    )
}
fn repository_path(path: &str) -> Result<String, String> {
    let path = fs::canonicalize(path).map_err(|_| error())?;
    gix::open(&path).map_err(|_| error())?;
    Ok(path.to_string_lossy().into_owned())
}
fn endpoint(value: &str) -> Result<String, String> {
    if !valid(value) {
        return Err(error());
    }
    let mut url = gix::url::parse(value.as_bytes()).map_err(|_| error())?;
    if url.password.is_some() {
        return Err("La URL no debe contener secretos".into());
    }
    url.set_password(None);
    // El usuario SSH forma parte del destino; en HTTPS es dato de la credencial.
    if matches!(url.scheme, gix::url::Scheme::Https | gix::url::Scheme::Http) {
        url.set_user(None);
    }
    Ok(url.to_string())
}
fn secret_id(repo: &str, url: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(repo);
    hash.update([0]);
    hash.update(url);
    format!("repo-{:x}", hash.finalize())
}
fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| error())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
#[tauri::command]
pub fn auth_answer(
    id: String,
    answer: Option<Answer>,
    state: State<'_, Authentication>,
) -> Result<(), String> {
    if let Some(answer) = &answer {
        if answer.secret.len() > 65_535
            || answer.username.chars().any(char::is_control)
            || answer.secret.contains(['\0', '\r', '\n'])
        {
            return Err(error());
        }
    }
    let pending = state
        .pending
        .lock()
        .map_err(|_| error())?
        .remove(&id)
        .ok_or_else(error)?;
    if answer.is_none() {
        pending.stopped.store(true, Ordering::Relaxed);
    }
    pending.sender.send(answer).map_err(|_| error())
}
pub(crate) fn cancel(app: &AppHandle, operation: &str) {
    let state = app.state::<Authentication>();
    if let Ok(active) = state.active.lock() {
        if let Some(stopped) = active.get(operation) {
            stopped.store(true, Ordering::Relaxed);
        }
    }
    let mut pending = state.pending.lock().unwrap_or_else(|e| e.into_inner());
    let ids = pending
        .iter()
        .filter(|(_, p)| p.operation == operation)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    for id in ids {
        if let Some(p) = pending.remove(&id) {
            p.stopped.store(true, Ordering::Relaxed);
            let _ = p.sender.send(None);
        }
        let _ = app.emit("gitthul:auth", serde_json::json!({"dismiss": id}));
    }
}
#[tauri::command]
pub fn auth_list_keys(
    app: AppHandle,
    state: State<'_, Authentication>,
) -> Result<Vec<SshKey>, String> {
    let _guard = state.catalog.lock().map_err(|_| error())?;
    Ok(catalog(&app)?.keys)
}
#[tauri::command]
pub fn auth_read_access(
    app: AppHandle,
    state: State<'_, Authentication>,
    repository: String,
    url: String,
) -> Result<Access, String> {
    let repository = repository_path(&repository)?;
    let url = endpoint(&url)?;
    let _guard = state.catalog.lock().map_err(|_| error())?;
    Ok(catalog(&app)?
        .bindings
        .into_iter()
        .find(|b| b.repository == repository && b.access.url == url)
        .map(|b| b.access)
        .unwrap_or(Access {
            url,
            method: "system".into(),
            username: String::new(),
            key_id: String::new(),
        }))
}
fn set_access(
    app: &AppHandle,
    repository: &str,
    access: Access,
    secret: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<Authentication>();
    let _guard = state.catalog.lock().map_err(|_| error())?;
    let mut data = catalog(app)?;
    let scheme = gix::url::parse(access.url.as_bytes())
        .map_err(|_| error())?
        .scheme;
    match access.method.as_str() {
        "https" if scheme == gix::url::Scheme::Https && valid(&access.username) => {
            if let Some(secret) = secret {
                if !valid(secret) {
                    return Err(error());
                }
                keyring::write_remote_secret(&secret_id(repository, &access.url), secret).map_err(
                    |_| {
                        "El llavero no está disponible; puedes continuar sin recordar el acceso"
                            .to_owned()
                    },
                )?;
            } else if keyring::read_remote_secret(&secret_id(repository, &access.url))
                .map_err(|_| error())?
                .is_none()
            {
                return Err(error());
            }
        }
        "ssh"
            if scheme == gix::url::Scheme::Ssh
                && data.keys.iter().any(|k| k.id == access.key_id) => {}
        "system" => {}
        _ => return Err("El método de acceso no corresponde al protocolo del remoto".into()),
    }
    if access.method != "https"
        && data.bindings.iter().any(|b| {
            b.repository == repository && b.access.url == access.url && b.access.method == "https"
        })
    {
        keyring::forget_remote_secret(&secret_id(repository, &access.url)).map_err(|_| error())?;
    }
    data.bindings
        .retain(|b| b.repository != repository || b.access.url != access.url);
    if access.method != "system" {
        data.bindings.push(Binding {
            repository: repository.into(),
            access,
        });
    }
    save(app, &data)
}
#[tauri::command]
pub fn auth_save_access(
    app: AppHandle,
    repository: String,
    mut access: Access,
    secret: Option<String>,
) -> Result<(), String> {
    let repository = repository_path(&repository)?;
    access.url = endpoint(&access.url)?;
    let secret = secret.map(Zeroizing::new);
    set_access(
        &app,
        &repository,
        access,
        secret.as_deref().map(|s| s.as_str()),
    )
}
#[tauri::command]
pub fn auth_forget_access(app: AppHandle, repository: String, url: String) -> Result<(), String> {
    let repository = repository_path(&repository)?;
    let url = endpoint(&url)?;
    set_access(
        &app,
        &repository,
        Access {
            url,
            method: "system".into(),
            username: String::new(),
            key_id: String::new(),
        },
        None,
    )
}
fn public_key(path: &Path) -> Result<String, String> {
    let public = fs::read_to_string(path.with_file_name(format!(
        "{}.pub",
        path.file_name().ok_or_else(error)?.to_string_lossy()
    )))
    .map_err(|_| "Selecciona una llave privada con su archivo .pub al lado".to_owned())?;
    if public.len() > 65_535 || !public.starts_with("ssh-") && !public.starts_with("ecdsa-") {
        return Err(error());
    }
    let check = crate::process::command("ssh-keygen")
        .args(["-l", "-f"])
        .arg(path.with_file_name(format!(
            "{}.pub",
            path.file_name().ok_or_else(error)?.to_string_lossy()
        )))
        .output()
        .map_err(|_| error())?;
    if !check.status.success() {
        return Err(error());
    }
    Ok(public.trim().into())
}
#[tauri::command]
pub async fn auth_import_key(
    app: AppHandle,
    alias: String,
    path: String,
) -> Result<SshKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid(alias.trim()) {
            return Err(error());
        }
        let path = fs::canonicalize(path).map_err(|_| error())?;
        if !path.is_file() {
            return Err(error());
        }
        let key = SshKey {
            id: random_id()?,
            alias: alias.trim().into(),
            public_key: public_key(&path)?,
            path: path.to_string_lossy().into_owned(),
        };
        let state = app.state::<Authentication>();
        let _guard = state.catalog.lock().map_err(|_| error())?;
        let mut data = catalog(&app)?;
        data.keys.push(key.clone());
        save(&app, &data)?;
        Ok(key)
    })
    .await
    .map_err(|_| error())?
}
#[tauri::command]
pub async fn auth_generate_key(
    app: AppHandle,
    alias: String,
    passphrase: String,
) -> Result<SshKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid(alias.trim()) || passphrase.contains(['\0', '\r', '\n']) {
            return Err(error());
        }
        let passphrase = Zeroizing::new(passphrase);
        let id = random_id()?;
        let folder = store::file_path(&app, "ssh")?;
        fs::create_dir_all(&folder).map_err(|_| error())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).map_err(|_| error())?;
        }
        let path = folder.join(&id);
        let bridge = CommandConfig::for_generation(&app, passphrase)?;
        let mut command = crate::process::command("ssh-keygen");
        command
            .args(["-q", "-t", "ed25519", "-C", alias.trim(), "-f"])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        bridge.apply_environment(&mut command);
        let result = command
            .status()
            .map_err(|_| "No se encontró ssh-keygen".to_owned());
        if !result.is_ok_and(|status| status.success()) {
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(path.with_extension("pub"));
            return Err("No se pudo generar la llave SSH".into());
        }
        let key = SshKey {
            id,
            alias: alias.trim().into(),
            public_key: public_key(&path)?,
            path: path.to_string_lossy().into_owned(),
        };
        let state = app.state::<Authentication>();
        let _guard = state.catalog.lock().map_err(|_| error())?;
        let mut data = catalog(&app)?;
        data.keys.push(key.clone());
        save(&app, &data)?;
        Ok(key)
    })
    .await
    .map_err(|_| error())?
}
#[tauri::command]
pub fn auth_remove_key(
    app: AppHandle,
    state: State<'_, Authentication>,
    id: String,
) -> Result<(), String> {
    let _guard = state.catalog.lock().map_err(|_| error())?;
    let mut data = catalog(&app)?;
    data.keys.retain(|k| k.id != id);
    data.bindings.retain(|b| b.access.key_id != id);
    save(&app, &data)
    // El archivo privado permanece en disco, tanto importado como generado.
}

#[derive(Serialize, Deserialize)]
struct WireRequest {
    nonce: String,
    operation: String,
    fields: HashMap<String, String>,
    prompt: String,
    arguments: Vec<String>,
}
#[derive(Default, Serialize, Deserialize)]
struct WireResponse {
    username: String,
    secret: String,
    key_path: String,
}
struct Session {
    app: AppHandle,
    repository: String,
    operation: String,
    endpoints: Arc<Mutex<Vec<String>>>,
    answers: HashMap<String, (String, Zeroizing<String>, bool)>,
    generation: Option<Zeroizing<String>>,
    stopped: Arc<AtomicBool>,
    rejected: Arc<AtomicBool>,
    rejected_urls: Vec<String>,
}
pub struct CommandConfig {
    session_endpoints: Arc<Mutex<Vec<String>>>,
    rejected: Arc<AtomicBool>,
    repository: String,
    endpoints: Arc<Mutex<Vec<(String, String)>>>,
    address: String,
    nonce: String,
    executable: PathBuf,
    stopped: Arc<AtomicBool>,
    app: AppHandle,
    operation: String,
    worker: Option<thread::JoinHandle<()>>,
}
impl CommandConfig {
    pub(crate) fn configuration(
        app: &AppHandle,
        repo: &Path,
        operation: &str,
    ) -> Result<Self, String> {
        let mut endpoints = Vec::new();
        let repository = repository_path(&repo.to_string_lossy())?;
        let git = gix::open(&repository).map_err(|_| error())?;
        for name in git.remote_names() {
            if let Ok(remote) = git.find_remote(&name) {
                for direction in [gix::remote::Direction::Fetch, gix::remote::Direction::Push] {
                    if let Some(url) = remote.url(direction) {
                        if let Ok(url) = endpoint(&url.to_string()) {
                            if !endpoints.contains(&(name.to_string(), url.clone())) {
                                endpoints.push((name.to_string(), url));
                            }
                        }
                    }
                }
            }
        }
        Self::start(app, repository, operation.into(), endpoints, None)
    }
    pub(crate) fn for_clone(
        app: &AppHandle,
        url: &str,
        target: &Path,
        operation: &str,
    ) -> Result<Self, String> {
        Self::start(
            app,
            target.to_string_lossy().into_owned(),
            operation.into(),
            vec![("origin".into(), endpoint(url)?)],
            None,
        )
    }
    fn for_generation(app: &AppHandle, passphrase: Zeroizing<String>) -> Result<Self, String> {
        Self::start(app, String::new(), random_id()?, vec![], Some(passphrase))
    }
    fn start(
        app: &AppHandle,
        repository: String,
        operation: String,
        endpoints: Vec<(String, String)>,
        generation: Option<Zeroizing<String>>,
    ) -> Result<Self, String> {
        let nonce = random_id()?;
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| error())?;
        listener.set_nonblocking(true).map_err(|_| error())?;
        let address = listener.local_addr().map_err(|_| error())?.to_string();
        let stopped = Arc::new(AtomicBool::new(false));
        app.state::<Authentication>()
            .active
            .lock()
            .map_err(|_| error())?
            .insert(operation.clone(), stopped.clone());
        let rejected = Arc::new(AtomicBool::new(false));
        let mut session = Session {
            app: app.clone(),
            repository: repository.clone(),
            operation: operation.clone(),
            endpoints: Arc::new(Mutex::new(
                endpoints.iter().map(|(_, url)| url.clone()).collect(),
            )),
            answers: HashMap::new(),
            generation,
            stopped: stopped.clone(),
            rejected: rejected.clone(),
            rejected_urls: Vec::new(),
        };
        let session_endpoints = session.endpoints.clone();
        let expected = nonce.clone();
        let shutdown = stopped.clone();
        let worker = thread::spawn(move || {
            while !shutdown.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        let mut line = String::new();
                        if BufReader::new(&stream)
                            .take(LIMIT)
                            .read_line(&mut line)
                            .is_ok()
                        {
                            if let Ok(request) = serde_json::from_str::<WireRequest>(&line) {
                                if request.nonce == expected {
                                    let response = session.respond(request).unwrap_or_default();
                                    let mut payload = Zeroizing::new(
                                        serde_json::to_string(&response).unwrap_or_default(),
                                    );
                                    payload.push('\n');
                                    let _ = stream.write_all(payload.as_bytes());
                                }
                            }
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            rejected,
            repository,
            endpoints: Arc::new(Mutex::new(endpoints)),
            session_endpoints,
            address,
            nonce,
            executable: env::current_exe().map_err(|_| error())?,
            stopped,
            app: app.clone(),
            operation,
            worker: Some(worker),
        })
    }
    pub(crate) fn clone_source(&self) -> Option<String> {
        self.endpoints
            .lock()
            .ok()?
            .first()
            .map(|(_, url)| url.clone())
    }
    pub(crate) fn cancelled(&self) -> bool {
        self.stopped.load(Ordering::Relaxed)
    }
    pub(crate) fn retry_auth(&self, remote: &str) -> bool {
        if self.cancelled() {
            return false;
        }
        if self.rejected.swap(false, Ordering::Relaxed) {
            return true;
        }
        let endpoints = self
            .endpoints
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let urls = endpoints
            .iter()
            .filter(|(name, url)| {
                (name == remote || remote.starts_with(&format!("{name}/")) || endpoints.len() == 1)
                    && gix::url::parse(url.as_bytes())
                        .is_ok_and(|u| u.scheme == gix::url::Scheme::Ssh)
            })
            .collect::<Vec<_>>();
        let Some((name, url)) = urls.first() else {
            return false;
        };
        let session = Session {
            app: self.app.clone(),
            repository: self.repository.clone(),
            operation: self.operation.clone(),
            endpoints: Arc::new(Mutex::new(vec![])),
            answers: HashMap::new(),
            generation: None,
            stopped: self.stopped.clone(),
            rejected: self.rejected.clone(),
            rejected_urls: vec![],
        };
        let Some(answer) = session.ask(url, "ssh", "", "") else {
            return false;
        };
        if let Some(key_id) = answer.secret.strip_prefix("ssh-key:") {
            return set_access(
                &self.app,
                &self.repository,
                Access {
                    url: url.clone(),
                    method: "ssh".into(),
                    username: String::new(),
                    key_id: key_id.into(),
                },
                None,
            )
            .is_ok();
        }
        let Ok(new_url) = endpoint(&answer.secret) else {
            return false;
        };
        if !new_url.starts_with("https://") {
            return false;
        }
        if Path::new(&self.repository).exists() {
            let Ok(repo) = gix::open(&self.repository) else {
                return false;
            };
            let Ok(remote) = repo.find_remote(name.as_str()) else {
                return false;
            };
            let Some(fetch) = remote
                .url(gix::remote::Direction::Fetch)
                .map(|u| u.to_string())
            else {
                return false;
            };
            let push = remote
                .url(gix::remote::Direction::Push)
                .map(|u| u.to_string())
                .unwrap_or_else(|| fetch.clone());
            if &fetch != url && &push != url {
                return false;
            }
            let input = crate::git::remote_write::RemoteInput {
                name: name.clone(),
                fetch_url: if &fetch == url {
                    new_url.clone()
                } else {
                    fetch.clone()
                },
                push_url: if &push == url {
                    new_url.clone()
                } else {
                    push.clone()
                },
            };
            if crate::git::remote_write::update(
                Path::new(&self.repository),
                name,
                &input,
                &crate::git::remote_write::RemotePrecondition {
                    fetch_url: fetch,
                    push_url: push,
                },
            )
            .is_err()
            {
                return false;
            }
        }
        if let Ok(mut endpoints) = self.endpoints.lock() {
            for (candidate, old) in endpoints.iter_mut() {
                if candidate == name && old == url {
                    *old = new_url.clone();
                }
            }
        }
        if let Ok(mut endpoints) = self.session_endpoints.lock() {
            if !endpoints.contains(&new_url) {
                endpoints.push(new_url);
            }
        }
        true
    }
    fn apply_environment(&self, command: &mut Command) {
        command
            .env(ADDRESS, &self.address)
            .env(NONCE, &self.nonce)
            .env("GITTHUL_AUTH_EXECUTABLE", &self.executable)
            .env("GITTHUL_AUTH_ASKPASS", "1")
            .env("GIT_ASKPASS", &self.executable)
            .env("SSH_ASKPASS", &self.executable)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env(
                "DISPLAY",
                env::var_os("DISPLAY").unwrap_or_else(|| "gitthul".into()),
            );
    }
    pub(crate) fn apply(&self, command: &mut Command) {
        self.apply_environment(command);
        configure_https_bridge(
            command,
            &self.endpoints.lock().unwrap_or_else(|e| e.into_inner()),
        );
        let ssh = catalog(&self.app).ok().is_some_and(|data| {
            data.bindings.iter().any(|b| {
                b.repository == self.repository
                    && b.access.method == "ssh"
                    && self.endpoints.lock().is_ok_and(|endpoints| {
                        endpoints.iter().any(|(_, url)| *url == b.access.url)
                    })
            })
        });
        if ssh {
            let original = env::var("GIT_SSH_COMMAND")
                .ok()
                .or_else(|| {
                    crate::process::command("git")
                        .args(["config", "--get", "core.sshCommand"])
                        .current_dir(&self.repository)
                        .output()
                        .ok()
                        .filter(|o| o.status.success())
                        .and_then(|o| String::from_utf8(o.stdout).ok())
                        .map(|s| s.trim().into())
                })
                .or_else(|| env::var("GIT_SSH").ok().map(|s| shell_quote(&s)))
                .unwrap_or_else(|| "ssh".into());
            command
                .env("GITTHUL_SYSTEM_SSH_COMMAND", original)
                .env(
                    "GIT_SSH_COMMAND",
                    format!(
                        "{} auth-ssh",
                        shell_quote(&self.executable.to_string_lossy())
                    ),
                )
                .env("GIT_SSH_VARIANT", "ssh");
        }
    }
}
impl Drop for CommandConfig {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        cancel(&self.app, &self.operation);
        if let Ok(mut active) = self.app.state::<Authentication>().active.lock() {
            active.remove(&self.operation);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn configure_https_bridge(command: &mut Command, endpoints: &[(String, String)]) {
    command.args([
        "-c",
        "credential.helper=",
        "-c",
        "credential.useHttpPath=true",
        "-c",
        &format!("credential.helper={HELPER}"),
    ]);
    // A host-specific useHttpPath=false wins over the generic setting above.
    // Only the bridge needs the full path to select a repository-bound access;
    // credential fill below must keep the user's original helper configuration.
    for (_, url) in endpoints {
        if url.starts_with("https://") {
            command.args(["-c", &format!("credential.{url}.useHttpPath=true")]);
        }
    }
}
fn system_credentials_command(repository: &Path, executable: &Path) -> Command {
    let mut command = crate::process::command("git");
    command
        .args(["credential", "fill"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", executable)
        .env("GITTHUL_AUTH_ASKPASS", "1")
        .env_remove(ADDRESS)
        .env_remove(NONCE)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if repository.is_dir() {
        command.current_dir(repository);
    } else if let Some(parent) = repository.parent() {
        command.current_dir(parent);
    }
    command
}
fn fill_system_credentials(
    mut command: Command,
    fields: &HashMap<String, String>,
    stopped: &AtomicBool,
) -> Option<WireResponse> {
    let mut child = command.spawn().ok()?;
    let mut input = String::new();
    for (key, value) in fields {
        if ["protocol", "host", "path", "username"].contains(&key.as_str()) {
            input.push_str(&format!("{key}={value}\n"));
        }
    }
    input.push('\n');
    child.stdin.take()?.write_all(input.as_bytes()).ok()?;
    let stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::new());
        let _ = stdout.take(LIMIT).read_to_end(&mut bytes);
        bytes
    });
    let status = loop {
        if stopped.load(Ordering::Relaxed) {
            let _ = child.kill();
        }
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let bytes = reader.join().ok()?;
    if !status.success() {
        return None;
    }
    let text = Zeroizing::new(String::from_utf8(bytes.to_vec()).ok()?);
    let mut response = WireResponse::default();
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("username=") {
            response.username = value.into();
        }
        if let Some(value) = line.strip_prefix("password=") {
            response.secret = value.into();
        }
    }
    (!response.username.is_empty() && !response.secret.is_empty()).then_some(response)
}
impl Session {
    fn ask(&self, url: &str, kind: &str, prompt: &str, username: &str) -> Option<Answer> {
        if self.stopped.load(Ordering::Relaxed) {
            return None;
        }
        let id = random_id().ok()?;
        let (sender, receiver) = mpsc::channel();
        let state = self.app.state::<Authentication>();
        state.pending.lock().ok()?.insert(
            id.clone(),
            Pending {
                operation: self.operation.clone(),
                stopped: self.stopped.clone(),
                sender,
            },
        );
        let request = Challenge {
            id: id.clone(),
            operation_id: self.operation.clone(),
            repository: self.repository.clone(),
            url: url.into(),
            kind: kind.into(),
            prompt: prompt.into(),
            username: username.into(),
        };
        let result = if self.app.emit("gitthul:auth", &request).is_ok() {
            loop {
                if self.stopped.load(Ordering::Relaxed) {
                    break None;
                }
                match receiver.recv_timeout(Duration::from_secs(1)) {
                    Ok(answer) => break answer,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => break None,
                }
            }
        } else {
            None
        };
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&id);
        }
        let _ = self
            .app
            .emit("gitthul:auth", serde_json::json!({ "dismiss": id }));
        result
    }
    fn system_credentials(&self, fields: &HashMap<String, String>) -> Option<WireResponse> {
        let command =
            system_credentials_command(Path::new(&self.repository), &env::current_exe().ok()?);
        fill_system_credentials(command, fields, &self.stopped)
    }
    fn respond(&mut self, request: WireRequest) -> Option<WireResponse> {
        if request.operation == "askpass" {
            if let Some(secret) = &self.generation {
                return Some(WireResponse {
                    secret: secret.to_string(),
                    ..Default::default()
                });
            }
            let kind = if request.prompt.to_lowercase().contains("passphrase") {
                "passphrase"
            } else if request.prompt.to_lowercase().contains("authenticity")
                || request
                    .prompt
                    .to_lowercase()
                    .contains("continue connecting")
            {
                "host"
            } else {
                return None;
            };
            let answer = self.ask("", kind, &request.prompt, "")?;
            return Some(WireResponse {
                secret: answer.secret,
                ..Default::default()
            });
        }
        if request.operation == "ssh" {
            let state = self.app.state::<Authentication>();
            let _guard = state.catalog.lock().ok()?;
            let data = catalog(&self.app).ok()?;
            let url = ssh_endpoint(&self.endpoints.lock().ok()?, &request.arguments)?;
            let binding = data.bindings.iter().find(|b| {
                b.repository == self.repository && b.access.url == url && b.access.method == "ssh"
            })?;
            let key = data
                .keys
                .iter()
                .find(|key| key.id == binding.access.key_id)?;
            return Some(WireResponse {
                key_path: key.path.clone(),
                ..Default::default()
            });
        }
        let url = request_endpoint(&self.endpoints.lock().ok()?, &request.fields)?;
        let id = secret_id(&self.repository, &url);
        if request.operation == "erase" {
            self.answers.remove(&url);
            self.rejected.store(true, Ordering::Relaxed);
            self.rejected_urls.push(url.clone());
            let _ = keyring::forget_remote_secret(&id);
            return Some(WireResponse::default());
        }
        if request.operation == "store" {
            if let Some((username, secret, true)) = self.answers.get(&url) {
                let access = Access {
                    url,
                    method: "https".into(),
                    username: username.clone(),
                    key_id: String::new(),
                };
                if set_access(&self.app, &self.repository, access, Some(secret.as_str())).is_err() {
                    let _ = self.app.emit("gitthul:auth-storage-error", ());
                }
            }
            return Some(WireResponse::default());
        }
        if request.operation != "get" {
            return None;
        }
        if let Some((username, secret, _)) = self.answers.get(&url) {
            return Some(WireResponse {
                username: username.clone(),
                secret: secret.to_string(),
                ..Default::default()
            });
        }
        let state = self.app.state::<Authentication>();
        let binding = {
            let _guard = state.catalog.lock().ok()?;
            catalog(&self.app).ok()?.bindings.into_iter().find(|b| {
                b.repository == self.repository && b.access.url == url && b.access.method == "https"
            })
        };
        if let Some(binding) = &binding {
            if let Ok(Some(secret)) = keyring::read_remote_secret(&id) {
                return Some(WireResponse {
                    username: binding.access.username.clone(),
                    secret: secret.to_string(),
                    ..Default::default()
                });
            }
        }
        if binding.is_none() && !self.rejected_urls.contains(&url) {
            if let Some(response) = self.system_credentials(&request.fields) {
                return Some(response);
            }
        }
        let username = binding
            .map(|b| b.access.username)
            .or_else(|| request.fields.get("username").cloned())
            .unwrap_or_default();
        let answer = self.ask(&url, "https", "", &username)?;
        if !valid(&answer.username) || !valid(&answer.secret) {
            return None;
        }
        let response = WireResponse {
            username: answer.username.clone(),
            secret: answer.secret.clone(),
            ..Default::default()
        };
        self.answers.insert(
            url,
            (
                answer.username,
                Zeroizing::new(answer.secret),
                answer.remember,
            ),
        );
        Some(response)
    }
}
fn request_endpoint(endpoints: &[String], fields: &HashMap<String, String>) -> Option<String> {
    if fields.get("protocol")? != "https" {
        return None;
    }
    let candidate = gix::url::parse(format!("https://{}/", fields.get("host")?).as_bytes()).ok()?;
    // Git's credential_from_url removes leading/trailing path slashes. Keep
    // the configured URL as the binding key, but compare its credential form.
    endpoints
        .iter()
        .find(|value| {
            let Ok(url) = gix::url::parse(value.as_bytes()) else {
                return false;
            };
            url.scheme == candidate.scheme
                && url.host == candidate.host
                && url.port == candidate.port
                && url.path.to_string().trim_matches('/')
                    == fields
                        .get("path")
                        .map(String::as_str)
                        .unwrap_or("")
                        .trim_matches('/')
        })
        .cloned()
}
fn ssh_endpoint(endpoints: &[String], args: &[String]) -> Option<String> {
    let port = args
        .windows(2)
        .find(|pair| pair[0] == "-p")
        .and_then(|pair| pair[1].parse::<u16>().ok())
        .unwrap_or(22);
    let command = args.last()?;
    let path = command
        .strip_prefix("git-upload-pack ")
        .or_else(|| command.strip_prefix("git-receive-pack "))?
        .trim()
        .trim_matches('\'')
        .replace("'\\''", "'");
    let host = args.get(args.len().checked_sub(2)?)?;
    endpoints
        .iter()
        .find(|value| {
            let Ok(url) = gix::url::parse(value.as_bytes()) else {
                return false;
            };
            url.scheme == gix::url::Scheme::Ssh
                && url.port.unwrap_or(22) == port
                && url.host.as_deref().is_some_and(|h| {
                    host == h || host == &format!("{}@{h}", url.user.as_deref().unwrap_or("git"))
                })
                && &url.path[..] == path.as_bytes()
        })
        .cloned()
}
fn wire(request: WireRequest) -> Option<WireResponse> {
    let address = env::var(ADDRESS).ok()?;
    if !address.starts_with("127.0.0.1:") {
        return None;
    }
    let mut stream = TcpStream::connect(address).ok()?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3600)))
        .ok()?;
    let mut payload = Zeroizing::new(serde_json::to_string(&request).ok()?);
    payload.push('\n');
    stream.write_all(payload.as_bytes()).ok()?;
    let mut result = Zeroizing::new(String::new());
    BufReader::new(stream)
        .take(LIMIT)
        .read_line(&mut result)
        .ok()?;
    serde_json::from_str(&result).ok()
}
pub fn run_if_requested() -> bool {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let helper = args.first().is_some_and(|arg| arg == "auth-helper");
    let ssh = args.first().is_some_and(|arg| arg == "auth-ssh");
    if !helper && !ssh && env::var_os("GITTHUL_AUTH_ASKPASS").is_none() {
        return false;
    }
    let Some(nonce) = env::var(NONCE).ok() else {
        return true;
    };
    let mut fields = HashMap::new();
    if helper {
        for line in std::io::stdin()
            .lock()
            .take(LIMIT)
            .lines()
            .map_while(Result::ok)
        {
            if line.is_empty() {
                break;
            }
            if let Some((k, v)) = line.split_once('=') {
                fields.insert(k.into(), v.into());
            }
        }
    }
    let request = WireRequest {
        nonce,
        operation: if helper {
            args.get(1).cloned().unwrap_or_default()
        } else if ssh {
            "ssh".into()
        } else {
            "askpass".into()
        },
        fields,
        prompt: if helper || ssh {
            String::new()
        } else {
            args.join(" ")
        },
        arguments: if ssh { args[1..].to_vec() } else { vec![] },
    };
    let response = wire(request).unwrap_or_default();
    if ssh {
        let original = env::var("GITTHUL_SYSTEM_SSH_COMMAND").unwrap_or_else(|_| "ssh".into());
        let mut command = crate::process::command("sh");
        command.args(["-c", &format!("{original} \"$@\""), "--"]);
        if !response.key_path.is_empty() {
            command.args(["-o", "IdentitiesOnly=yes", "-i", &response.key_path]);
        }
        let status = command.args(&args[1..]).status();
        std::process::exit(status.ok().and_then(|s| s.code()).unwrap_or(1));
    }
    if helper {
        if !response.username.is_empty() && !response.secret.is_empty() {
            println!(
                "username={}\npassword={}\n",
                response.username, response.secret
            );
        }
    } else {
        if response.secret.is_empty()
            && args
                .first()
                .is_some_and(|s| !s.to_lowercase().contains("passphrase"))
        {
            std::process::exit(1);
        }
        println!("{}", response.secret);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_context_matches_git_path_normalization_and_keeps_original_binding() {
        for (url, path) in [
            ("https://example.invalid:8443/group/repo/", "group/repo"),
            (
                "https://example.invalid:8443/group/my%20repo/",
                "group/my repo",
            ),
            ("https://example.invalid:8443/", ""),
        ] {
            let urls = vec![url.to_string()];
            let mut fields = HashMap::from([
                ("protocol".into(), "https".into()),
                ("host".into(), "example.invalid:8443".into()),
            ]);
            if !path.is_empty() {
                fields.insert("path".into(), path.into());
            }
            assert_eq!(request_endpoint(&urls, &fields), Some(url.into()));
            fields.insert("host".into(), "example.invalid:9443".into());
            assert!(request_endpoint(&urls, &fields).is_none());
            fields.insert("host".into(), "example.invalid:8443".into());
            fields.insert("path".into(), "other/repo".into());
            assert!(request_endpoint(&urls, &fields).is_none());
        }
    }
    #[cfg(unix)]
    #[test]
    fn bridge_retains_remote_path_but_system_helper_receives_its_original_scope() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        let global = temp.path().join("gitconfig");
        let bridge = temp.path().join("bridge");
        let helper = temp.path().join("git-credential-libsecret");
        let bridge_input = temp.path().join("bridge-input");
        let helper_input = temp.path().join("helper-input");
        for (executable, record) in [(&bridge, &bridge_input), (&helper, &helper_input)] {
            fs::write(
                executable,
                format!(
                    "#!/bin/sh\ncat > {}\nprintf 'username=test-user\\npassword=fake-token\\n\\n'\n",
                    shell_quote(&record.to_string_lossy())
                ),
            )
            .unwrap();
            fs::set_permissions(executable, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let url = "https://example.invalid:8443/group/repo/";
        for use_path in [false, true] {
            fs::write(
                &global,
                format!(
                    "[credential]\nhelper = {}\n[credential \"https://example.invalid:8443\"]\nuseHttpPath = {use_path}\n",
                    helper.display()
                ),
            )
            .unwrap();
            let mut command = Command::new("git");
            configure_https_bridge(&mut command, &[("origin".into(), url.into())]);
            command
                .args(["credential", "fill"])
                .env("GITTHUL_AUTH_EXECUTABLE", &bridge)
                .env("GIT_CONFIG_GLOBAL", &global)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_TERMINAL_PROMPT", "0")
                .current_dir(&repo)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            let mut child = command.spawn().unwrap();
            writeln!(child.stdin.take().unwrap(), "url={url}\n").unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let input = fs::read_to_string(&bridge_input).unwrap();
            let fields = input
                .lines()
                .filter_map(|line| line.split_once('='))
                .map(|(key, value)| (key.into(), value.into()))
                .collect();
            assert_eq!(request_endpoint(&[url.into()], &fields), Some(url.into()));
            assert!(input.contains("path=group/repo\n"));
            // This is the same second Git process used by Session, without the
            // bridge overrides. The fake helper stands in for the global libsecret.
            let mut system = system_credentials_command(&repo, Path::new("/bin/false"));
            system
                .env("GIT_CONFIG_GLOBAL", &global)
                .env("GIT_CONFIG_NOSYSTEM", "1");
            let response =
                fill_system_credentials(system, &fields, &AtomicBool::new(false)).unwrap();
            assert_eq!(response.username, "test-user");
            assert_eq!(response.secret, "fake-token");
            let input = fs::read_to_string(&helper_input).unwrap();
            assert!(input.contains("host=example.invalid:8443\n"));
            assert_eq!(input.contains("path=group/repo\n"), use_path);
        }
    }
    #[test]
    fn ssh_keys_match_the_remote_port() {
        let urls = vec![
            "ssh://git@example.invalid:22/repo.git".into(),
            "ssh://git@example.invalid:2222/repo.git".into(),
        ];
        assert_eq!(
            ssh_endpoint(
                &urls,
                &[
                    "-p".into(),
                    "2222".into(),
                    "git@example.invalid".into(),
                    "git-upload-pack '/repo.git'".into(),
                ]
            ),
            Some(urls[1].clone())
        );
    }
    #[test]
    fn credentials_are_bound_to_local_repository_and_full_remote() {
        assert_ne!(
            secret_id("/repo/a", "https://github.com/a/repo"),
            secret_id("/repo/b", "https://github.com/a/repo")
        );
        assert_ne!(
            secret_id("/repo/a", "https://github.com/a/repo"),
            secret_id("/repo/a", "https://github.com/b/repo")
        );
        let urls = vec!["https://github.com/a/repo.git".into()];
        let fields = HashMap::from([
            ("protocol".into(), "https".into()),
            ("host".into(), "github.com".into()),
            ("path".into(), "b/repo.git".into()),
        ]);
        assert!(request_endpoint(&urls, &fields).is_none());
    }
    #[test]
    fn ssh_keys_are_selected_by_remote_path_even_on_same_host() {
        let urls = vec![
            "git@github.com:one/repo.git".into(),
            "git@github.com:two/repo.git".into(),
        ];
        assert_eq!(
            ssh_endpoint(
                &urls,
                &[
                    "git@github.com".into(),
                    "git-upload-pack 'two/repo.git'".into()
                ]
            ),
            Some(urls[1].clone())
        );
    }
    #[test]
    fn authenticated_urls_are_not_stored() {
        assert!(endpoint("https://user:token@github.com/a/repo").is_err());
        assert_eq!(
            endpoint("https://user@github.com/a/repo").unwrap(),
            "https://github.com/a/repo"
        );
    }
}

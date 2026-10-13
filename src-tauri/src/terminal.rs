//! Sesiones de shell reales sobre PTY. La interfaz solo transporta bytes y tamaño.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, ExitStatus, MasterPty, PtySize,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{ipc::Channel, State};

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    observing_cwd: Arc<AtomicBool>,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        self.observing_cwd.store(false, Ordering::Release);
        let _ = self.killer.kill();
    }
}

enum SessionState {
    Starting(Arc<AtomicBool>),
    Ready(TerminalSession),
}

#[derive(Clone, Default)]
pub struct TerminalSessions {
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
}

struct SessionRequest {
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    on_cwd: Channel<String>,
    on_exit: Channel<TerminalExit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalError {
    code: &'static str,
    params: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    code: u32,
    signal: Option<String>,
    success: bool,
}

impl TerminalError {
    fn new(code: &'static str, params: Value, error: impl std::fmt::Display) -> Self {
        Self {
            code,
            params,
            output: Some(error.to_string()),
        }
    }

    fn session_not_found(session_id: &str) -> Self {
        Self {
            code: "terminal.sessionNotFound",
            params: json!({ "session": session_id }),
            output: None,
        }
    }
}

#[tauri::command]
pub async fn terminal_create_session(
    sessions: State<'_, TerminalSessions>,
    locks: State<'_, crate::git::GitWriteLocks>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    on_cwd: Channel<String>,
    on_exit: Channel<TerminalExit>,
) -> Result<(), TerminalError> {
    create_session(
        sessions.inner().clone(),
        locks.inner().clone(),
        SessionRequest {
            session_id,
            cwd,
            cols,
            rows,
            on_data,
            on_cwd,
            on_exit,
        },
    )
    .await
}

async fn create_session(
    sessions: TerminalSessions,
    locks: crate::git::GitWriteLocks,
    request: SessionRequest,
) -> Result<(), TerminalError> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let previous = sessions.sessions.lock().map_err(lock_error)?.insert(
        request.session_id.clone(),
        SessionState::Starting(Arc::clone(&cancelled)),
    );
    if let Some(SessionState::Starting(previous)) = &previous {
        previous.store(true, Ordering::Release);
    }
    let session_id = request.session_id.clone();
    let worker_sessions = sessions.clone();
    let worker_cancelled = Arc::clone(&cancelled);
    // Recovery reads and copies the repository before the shell can change it.
    // Keep both that work and PTY creation off Tauri's UI/event thread.
    let result = tauri::async_runtime::spawn_blocking(move || {
        drop(previous);
        create_session_blocking(worker_sessions, locks, request, worker_cancelled)
    })
    .await
    .unwrap_or_else(|error| Err(TerminalError::new("terminal.openFailed", json!({}), error)));

    let mut map = sessions.sessions.lock().map_err(lock_error)?;
    if matches!(map.get(&session_id), Some(SessionState::Starting(current)) if Arc::ptr_eq(current, &cancelled))
    {
        map.remove(&session_id);
    }
    result
}

fn create_session_blocking(
    sessions: TerminalSessions,
    locks: crate::git::GitWriteLocks,
    request: SessionRequest,
    cancelled: Arc<AtomicBool>,
) -> Result<(), TerminalError> {
    let SessionRequest {
        session_id,
        cwd,
        cols,
        rows,
        on_data,
        on_cwd,
        on_exit,
    } = request;
    if cancelled.load(Ordering::Acquire) {
        return Ok(());
    }
    if !cwd.is_empty() && !Path::new(&cwd).is_dir() {
        return Err(TerminalError::new(
            "terminal.cwdNotFound",
            json!({ "path": cwd }),
            "working directory does not exist",
        ));
    }

    let recovery = crate::git::begin_terminal_recovery(&cwd, locks).map_err(|error| {
        TerminalError::new("terminal.openFailed", json!({}), format!("{error:?}"))
    })?;
    if cancelled.load(Ordering::Acquire) {
        return Ok(());
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| TerminalError::new("terminal.openFailed", json!({}), error))?;

    let mut command = CommandBuilder::new_default_prog();
    configure_terminal_environment(&mut command);
    if !cwd.is_empty() {
        command.cwd(shell_working_directory(&cwd).as_ref());
    }

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| TerminalError::new("terminal.openFailed", json!({}), error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| TerminalError::new("terminal.openFailed", json!({}), error))?;
    let mut child = pair.slave.spawn_command(command).map_err(|error| {
        TerminalError::new("terminal.spawnFailed", json!({ "path": cwd }), error)
    })?;
    let killer = child.clone_killer();
    let process_id = child.process_id();
    let observing_cwd = Arc::new(AtomicBool::new(true));

    let log_context = json!({ "request": format!("sessionId={session_id}"), "repository": cwd, "phase": "event" });
    let reader_log_context = log_context.clone();
    let (publish_output, output_ready) = std::sync::mpsc::channel();
    // Drain before publishing the session: closing it may make ConPTY write a
    // final frame immediately, including when startup was cancelled meanwhile.
    thread::spawn(move || {
        // The writer must be published before the UI can answer PTY queries.
        let deliver = output_ready.recv().unwrap_or(false);
        if let Err(error) = drain_terminal_output(reader.as_mut(), |bytes| {
            deliver && on_data.send(bytes.to_vec()).is_ok()
        }) {
            crate::logging::native_with_context(
                "warn",
                "terminal.native",
                "La lectura del PTY se interrumpió",
                Some(format!("ioKind={:?}", error.kind())),
                Some(reader_log_context),
            );
        }
    });
    thread::spawn(move || {
        match child.wait() {
            Ok(status) => {
                if let Some(recovery) = recovery { recovery.finish(); }
                let _ = on_exit.send(terminal_exit(status));
            }
            Err(_) => crate::logging::native_with_context("error", "terminal.native", "No se pudo observar la salida del proceso; comprueba el repositorio antes de continuar", None, Some(log_context)),
        }
    });

    let session = TerminalSession {
        master: pair.master,
        writer,
        killer,
        observing_cwd: Arc::clone(&observing_cwd),
    };
    let mut map = sessions.sessions.lock().map_err(lock_error)?;
    let current = matches!(map.get(&session_id), Some(SessionState::Starting(token)) if Arc::ptr_eq(token, &cancelled));
    if !current || cancelled.load(Ordering::Acquire) {
        drop(map);
        let _ = publish_output.send(false);
        drop(session);
        return Ok(());
    }
    map.insert(session_id, SessionState::Ready(session));
    drop(map);
    let _ = publish_output.send(true);
    if let Some(process_id) = process_id {
        thread::spawn(move || observe_cwd(process_id, on_cwd, observing_cwd));
    }

    Ok(())
}

fn shell_working_directory(cwd: &str) -> Cow<'_, str> {
    #[cfg(windows)]
    {
        let shell_path = windows_shell_path(cwd);
        if shell_path != cwd {
            // CMD mistakes a canonical verbatim drive path for UNC and falls
            // back to Windows. Only remove the prefix when ordinary Win32
            // parsing still resolves the same directory; names requiring the
            // verbatim namespace must keep their original meaning.
            let same_directory = Path::new(shell_path.as_ref())
                .canonicalize()
                .ok()
                .zip(Path::new(cwd).canonicalize().ok())
                .is_some_and(|(shell, original)| shell == original);
            if same_directory {
                return shell_path;
            }
        }
    }
    Cow::Borrowed(cwd)
}

#[cfg(any(windows, test))]
fn windows_shell_path(cwd: &str) -> Cow<'_, str> {
    if let Some(unc) = cwd.strip_prefix(r"\\?\UNC\") {
        return Cow::Owned(format!(r"\\{unc}"));
    }
    if let Some(drive) = cwd.strip_prefix(r"\\?\") {
        let bytes = drive.as_bytes();
        if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1..3] == *b":\\" {
            return Cow::Borrowed(drive);
        }
    }
    Cow::Borrowed(cwd)
}

fn drain_terminal_output(
    reader: &mut dyn Read,
    mut deliver: impl FnMut(&[u8]) -> bool,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 8192];
    let mut delivering = true;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(count) => {
                if delivering && !deliver(&buffer[..count]) {
                    // ConPTY can emit a final frame during shutdown. Keep
                    // draining after the UI disconnects so close cannot block
                    // waiting for its output pipe on older Windows.
                    delivering = false;
                }
            }
            // Linux PTYs signal the normal end of a slave with EIO.
            Err(error) if cfg!(unix) && error.raw_os_error() == Some(5) => return Ok(()),
            Err(error) => return Err(error),
        }
    }
}

fn configure_terminal_environment(command: &mut CommandBuilder) {
    // Las capacidades pertenecen a xterm.js, no a la terminal que lanzó la app
    // (ni a un lanzador gráfico, que puede dejar TERM vacío o en `dumb`).
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "GitThul");
    command.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    // El tamaño lo comunica el PTY; no heredar dimensiones ni termcap del padre.
    command.env_remove("COLUMNS");
    command.env_remove("LINES");
    command.env_remove("TERMCAP");
}

fn terminal_exit(status: ExitStatus) -> TerminalExit {
    TerminalExit {
        code: status.exit_code(),
        signal: status.signal().map(str::to_owned),
        success: status.success(),
    }
}

fn observe_cwd(process_id: u32, on_cwd: Channel<String>, active: Arc<AtomicBool>) {
    let mut previous = None;
    while active.load(Ordering::Acquire) {
        if let Some(cwd) = process_cwd(process_id) {
            let cwd = cwd.to_string_lossy().into_owned();
            if previous.as_deref() != Some(cwd.as_str()) {
                if on_cwd.send(cwd.clone()).is_err() {
                    break;
                }
                previous = Some(cwd);
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(target_os = "linux")]
fn process_cwd(process_id: u32) -> Option<std::path::PathBuf> {
    std::fs::read_link(format!("/proc/{process_id}/cwd"))
        .ok()
        .filter(|path| path.is_dir())
}

#[cfg(not(target_os = "linux"))]
fn process_cwd(_process_id: u32) -> Option<std::path::PathBuf> {
    None
}

#[tauri::command]
pub fn terminal_write(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
    data: String,
) -> Result<(), TerminalError> {
    let mut map = sessions.sessions.lock().map_err(lock_error)?;
    let Some(SessionState::Ready(session)) = map.get_mut(&session_id) else {
        return Err(TerminalError::session_not_found(&session_id));
    };
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| {
            TerminalError::new(
                "terminal.writeFailed",
                json!({ "session": session_id }),
                error,
            )
        })
}

#[tauri::command]
pub fn terminal_resize(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), TerminalError> {
    let map = sessions.sessions.lock().map_err(lock_error)?;
    let Some(SessionState::Ready(session)) = map.get(&session_id) else {
        return Err(TerminalError::session_not_found(&session_id));
    };
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| {
            TerminalError::new(
                "terminal.resizeFailed",
                json!({ "session": session_id }),
                error,
            )
        })
}

#[tauri::command]
pub async fn terminal_close_session(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
) -> Result<(), TerminalError> {
    close_session(sessions.inner().clone(), session_id).await
}

async fn close_session(
    sessions: TerminalSessions,
    session_id: String,
) -> Result<(), TerminalError> {
    let removed = sessions
        .sessions
        .lock()
        .map_err(lock_error)?
        .remove(&session_id);
    match removed {
        Some(SessionState::Starting(cancelled)) => cancelled.store(true, Ordering::Release),
        Some(SessionState::Ready(session)) => {
            tauri::async_runtime::spawn_blocking(move || drop(session))
                .await
                .map_err(|error| TerminalError::new("terminal.stateFailed", json!({}), error))?;
        }
        None => {}
    }
    Ok(())
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> TerminalError {
    TerminalError::new("terminal.stateFailed", json!({}), error)
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::task::{Context, Poll, Waker};
    use std::thread;
    use std::time::{Duration, Instant};

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    fn request(session_id: &str, cwd: String) -> super::SessionRequest {
        super::SessionRequest {
            session_id: session_id.to_owned(),
            cwd,
            cols: 80,
            rows: 24,
            on_data: tauri::ipc::Channel::new(|_| Ok(())),
            on_cwd: tauri::ipc::Channel::new(|_| Ok(())),
            on_exit: tauri::ipc::Channel::new(|_| Ok(())),
        }
    }

    #[test]
    fn slow_repository_preparation_yields_and_can_be_closed_before_the_shell_starts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        assert!(crate::process::command("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(&path)
            .status()
            .unwrap()
            .success());
        for index in 0..256 {
            std::fs::write(path.join(format!("file-{index}.txt")), vec![b'x'; 8192]).unwrap();
        }
        let id = path.to_str().unwrap().to_owned();
        let locks = crate::git::GitWriteLocks::default();
        let repository_lock = locks.repository(&id);
        let held_lock = Arc::clone(&repository_lock);
        let (locked, ready) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let timed_out = Arc::new(AtomicBool::new(false));
        let timeout_flag = Arc::clone(&timed_out);
        let holding = thread::spawn(move || {
            let _guard = held_lock.lock().unwrap();
            locked.send(()).unwrap();
            if wait_release.recv_timeout(Duration::from_secs(5)).is_err() {
                timeout_flag.store(true, Ordering::Release);
            }
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();

        let sessions = super::TerminalSessions::default();
        let mut starting = Box::pin(super::create_session(
            sessions.clone(),
            locks,
            request("pending", id),
        ));
        let mut context = Context::from_waker(Waker::noop());
        let start = Instant::now();
        assert!(matches!(
            starting.as_mut().poll(&mut context),
            Poll::Pending
        ));
        eprintln!(
            "Terminal startup returned to its caller in {:?}",
            start.elapsed()
        );
        let deadline = Instant::now() + Duration::from_secs(4);
        while Arc::strong_count(&repository_lock) <= 3 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(Arc::strong_count(&repository_lock) > 3);
        tauri::async_runtime::block_on(super::close_session(sessions.clone(), "pending".into()))
            .unwrap();
        assert!(sessions.sessions.lock().unwrap().is_empty());
        release.send(()).unwrap();
        holding.join().unwrap();
        tauri::async_runtime::block_on(starting).unwrap();
        assert!(!timed_out.load(Ordering::Acquire));
        assert!(sessions.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn a_failed_background_start_removes_its_pending_session() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = super::TerminalSessions::default();
        let result = tauri::async_runtime::block_on(super::create_session(
            sessions.clone(),
            crate::git::GitWriteLocks::default(),
            request(
                "missing",
                directory
                    .path()
                    .join("absent")
                    .to_string_lossy()
                    .into_owned(),
            ),
        ));
        assert_eq!(result.unwrap_err().code, "terminal.cwdNotFound");
        assert!(sessions.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn a_background_session_transports_commands_and_closes_its_real_shell() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        let sessions = super::TerminalSessions::default();
        let (output, incoming) = mpsc::channel();
        let (exited, exit) = mpsc::channel();
        let mut request = request("background", path.to_string_lossy().into_owned());
        request.on_data = tauri::ipc::Channel::new(move |body| {
            let bytes = match body {
                tauri::ipc::InvokeResponseBody::Raw(bytes) => bytes,
                tauri::ipc::InvokeResponseBody::Json(json) => serde_json::from_str(&json).unwrap(),
            };
            let _ = output.send(bytes);
            Ok(())
        });
        request.on_exit = tauri::ipc::Channel::new(move |_| {
            let _ = exited.send(());
            Ok(())
        });
        tauri::async_runtime::block_on(super::create_session(
            sessions.clone(),
            crate::git::GitWriteLocks::default(),
            request,
        ))
        .unwrap();
        {
            let mut map = sessions.sessions.lock().unwrap();
            let Some(super::SessionState::Ready(session)) = map.get_mut("background") else {
                panic!("the shell must be ready after background startup");
            };
            #[cfg(windows)]
            session.writer.write_all(b"\x1b[1;1R").unwrap();
            #[cfg(windows)]
            let probe = b"set \"gitthul_marker=background-ready\"\recho gitthul-%gitthul_marker%\r"
                .as_slice();
            #[cfg(not(windows))]
            let probe = b"printf 'gitthul-%s\\n' 'background-ready'\r".as_slice();
            session.writer.write_all(probe).unwrap();
            session.writer.flush().unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut received = Vec::new();
        let mut ready = false;
        while Instant::now() < deadline {
            if let Ok(bytes) = incoming.recv_timeout(Duration::from_millis(100)) {
                received.extend(bytes);
                ready = String::from_utf8_lossy(&received).contains("gitthul-background-ready");
                if ready {
                    break;
                }
            }
        }
        tauri::async_runtime::block_on(super::close_session(sessions.clone(), "background".into()))
            .unwrap();
        exit.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(ready, "the background shell must respond to its command");
        assert!(sessions.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn windows_shell_paths_preserve_drive_unicode_spaces_and_unc() {
        for (cwd, expected) in [
            (r"\\?\C:\Users\Usuario\Repo", r"C:\Users\Usuario\Repo"),
            (
                r"\\?\D:\Área de trabajo\日本語",
                r"D:\Área de trabajo\日本語",
            ),
            (r"C:\Área de trabajo\日本語", r"C:\Área de trabajo\日本語"),
            (
                r"\\?\UNC\servidor\carpeta compartida\Repo",
                r"\\servidor\carpeta compartida\Repo",
            ),
            (
                r"\\servidor\carpeta compartida\Repo",
                r"\\servidor\carpeta compartida\Repo",
            ),
            (r"\\?\Volume{device}\Repo", r"\\?\Volume{device}\Repo"),
            (r"\\.\C:\Repo", r"\\.\C:\Repo"),
        ] {
            assert_eq!(super::windows_shell_path(cwd), expected);
        }
    }

    #[test]
    #[cfg(windows)]
    fn shell_cwd_keeps_names_that_require_verbatim_semantics() {
        let temporary = tempfile::tempdir().unwrap();
        let canonical = temporary.path().canonicalize().unwrap();
        let special = canonical.join("literal.");
        std::fs::create_dir(&special).unwrap();
        let cwd = special.to_str().unwrap();
        assert_eq!(super::shell_working_directory(cwd), cwd);
    }

    #[test]
    #[cfg(unix)]
    fn shell_recibe_capacidades_del_emulador_sin_dimensiones_del_padre() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args([
            "-c",
            "printf '%s|%s|%s|%s|%s|%s\\n' \"$TERM\" \"$COLORTERM\" \"$TERM_PROGRAM\" \"$COLUMNS\" \"$LINES\" \"$TERMCAP\"",
        ]);
        command.env("TERM", "dumb");
        command.env("COLORTERM", "");
        command.env("TERM_PROGRAM", "otra-terminal");
        command.env("COLUMNS", "200");
        command.env("LINES", "60");
        command.env("TERMCAP", "capacidades-del-padre");
        super::configure_terminal_environment(&mut command);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut buffer = [0_u8; 1024];
            let mut output = Vec::new();
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                output.extend_from_slice(&buffer[..count]);
            }
            let _ = sender.send(output);
        });
        let result = receiver.recv_timeout(Duration::from_secs(5));
        if result.is_err() {
            let _ = child.kill();
        }
        assert!(child.wait().unwrap().success());
        let output = String::from_utf8(result.expect("el shell debe responder")).unwrap();
        assert_eq!(output.trim(), "xterm-256color|truecolor|GitThul|||");
    }

    #[test]
    fn drains_output_to_eof_after_the_ui_disconnects() {
        let output = vec![b'x'; 32768];
        let mut reader = std::io::Cursor::new(&output);
        let mut deliveries = 0;
        super::drain_terminal_output(&mut reader, |_| {
            deliveries += 1;
            false
        })
        .unwrap();
        assert_eq!(reader.position(), output.len() as u64);
        assert_eq!(deliveries, 1);
    }

    #[test]
    fn pty_real_transporta_entrada_salida_y_resize() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("shell cwd área_日本語");
        std::fs::create_dir(&directory).unwrap();
        let canonical = directory.canonicalize().unwrap();
        let cwd = canonical.to_str().unwrap();
        let shell_cwd = super::shell_working_directory(cwd);
        #[cfg(windows)]
        assert!(!shell_cwd.starts_with(r"\\?\"));

        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        #[cfg(windows)]
        let mut command = {
            let mut command = CommandBuilder::new("cmd.exe");
            command.args(["/D", "/Q"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = CommandBuilder::new_default_prog();
        super::configure_terminal_environment(&mut command);
        command.cwd(shell_cwd.as_ref());
        let mut child = pair.slave.spawn_command(command).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();

        // Start draining before resize/write: ConPTY can synchronously repaint
        // enough output to fill its pipe before those operations return.
        let (sender, receiver) = mpsc::channel();
        let reading = thread::spawn(move || {
            let mut buffer = [0_u8; 1024];
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                let _ = sender.send(buffer[..count].to_vec());
            }
        });

        // portable-pty enables PSEUDOCONSOLE_INHERIT_CURSOR. In the app,
        // xterm answers its initial DSR query; this headless host must answer
        // too, before resizing or closing ConPTY can wait for that response.
        #[cfg(windows)]
        {
            writer.write_all(b"\x1b[1;1R").unwrap();
            writer.flush().unwrap();
        }

        let marker = "gitthul-pty-real";
        let expected = format!("{marker}={shell_cwd}");
        let cols = u16::try_from(expected.len() + 16)
            .unwrap_or(u16::MAX)
            .max(97);
        pair.master
            .resize(PtySize {
                rows: 31,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        assert_eq!(pair.master.get_size().unwrap().rows, 31);
        assert_eq!(pair.master.get_size().unwrap().cols, cols);

        #[cfg(windows)]
        let probe = format!("chcp 65001 >nul\recho {marker}=%CD%\r");
        #[cfg(not(windows))]
        let probe = format!("printf '%s=%s\\n' '{marker}' \"$PWD\"\r");
        writer.write_all(probe.as_bytes()).unwrap();
        writer.flush().unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut output = String::new();
        while Instant::now() < deadline && !output.contains(&expected) {
            if let Ok(bytes) = receiver.recv_timeout(Duration::from_millis(100)) {
                output.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        child.kill().unwrap();
        child.wait().unwrap();
        drop(writer);
        drop(pair);
        reading.join().unwrap();
        assert!(
            output.contains(&expected),
            "salida PTY inesperada: {output:?}"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn observa_el_cwd_real_del_shell_despues_de_cd() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let command = CommandBuilder::new_default_prog();
        let mut child = pair.slave.spawn_command(command).unwrap();
        let process_id = child.process_id().expect("el PTY nativo debe exponer pid");
        let mut writer = pair.master.take_writer().unwrap();
        let target = std::env::temp_dir().canonicalize().unwrap();

        writer
            .write_all(format!("cd -- {}\r", target.display()).as_bytes())
            .unwrap();
        writer.flush().unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut observed = None;
        while Instant::now() < deadline {
            observed = super::process_cwd(process_id);
            if observed.as_ref() == Some(&target) {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }

        child.kill().unwrap();
        child.wait().unwrap();
        assert_eq!(observed, Some(target));
    }

    #[test]
    fn conserva_codigo_exito_y_senal_de_salida() {
        let success = super::terminal_exit(portable_pty::ExitStatus::with_exit_code(0));
        let failure = super::terminal_exit(portable_pty::ExitStatus::with_exit_code(7));
        let signal = super::terminal_exit(portable_pty::ExitStatus::with_signal("TERM"));

        assert!(success.success);
        assert_eq!(failure.code, 7);
        assert!(!failure.success);
        assert_eq!(signal.signal.as_deref(), Some("TERM"));
        assert!(!signal.success);
    }
}

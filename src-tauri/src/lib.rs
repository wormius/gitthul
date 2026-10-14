//! Punto de entrada de la aplicación de escritorio.
//!
//! Aquí se registran la superficie IPC, el motor Git híbrido, el llavero, la
//! persistencia local, los registros, las funciones del sistema y las sesiones
//! PTY.

mod auth;
mod git;
mod keyring;
mod library;
mod log_privacy;
mod logging;
mod process;
mod releases;
mod session;
mod settings;
mod store;
mod system;
mod terminal;
#[cfg(target_os = "linux")]
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // GTK usa el nombre del programa para WM_CLASS y el app_id de Wayland.
    // Establecerlo antes de inicializar GTK alinea la ventana con el lanzador.
    #[cfg(target_os = "linux")]
    gtk::glib::set_prgname(Some(context.config().identifier.as_str()));

    let builder = tauri::Builder::default();
    // El segundo lanzamiento debe activar la ventana existente. GTK conserva
    // solo la identidad visual; el plugin controla la instancia única.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            #[cfg(target_os = "linux")]
            {
                let window_to_present = window.clone();
                // Presentar en el hilo GTK restaura y enfoca en una operación.
                // set_focus puede ignorarse mientras se procesa unminimize.
                let _ = window.run_on_main_thread(move || {
                    use gtk::prelude::GtkWindowExt;
                    if let Ok(native) = window_to_present.gtk_window() {
                        native.present();
                    }
                });
            }
            #[cfg(not(target_os = "linux"))]
            {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|_app| {
            let _ = logging::initialize(_app.handle());
            git::recovery::initialize(_app.handle());
            git::backup::initialize(_app.handle());
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(main) = _app.get_webview_window("main") {
                    window::compact_native_titlebar(&main)?;
                }
            }
            Ok(())
        })
        .manage(auth::Authentication::default())
        .manage(git::CloneProcesses::default())
        .manage(git::NetworkProcesses::default())
        .manage(git::GitWriteLocks::default())
        .manage(git::GitWatchers::default())
        .manage(git::GitReadOperations::default())
        .manage(git::backup::BackupManager::default())
        .manage(terminal::TerminalSessions::default())
        .invoke_handler(tauri::generate_handler![
            git::recovery::recovery_read,
            git::recovery::recovery_cleanup,
            git::backup::backup_read,
            git::backup::backup_schedule,
            git::backup::backup_restore,
            releases::releases_check,
            auth::auth_answer,
            auth::auth_list_keys,
            auth::auth_import_key,
            auth::auth_generate_key,
            auth::auth_remove_key,
            auth::auth_read_access,
            auth::auth_save_access,
            auth::auth_forget_access,
            settings::settings_read,
            settings::settings_write,
            library::library_read,
            library::library_write,
            session::session_read,
            session::session_write,
            keyring::keyring_is_available,
            keyring::keyring_has,
            keyring::keyring_set,
            keyring::keyring_delete,
            logging::log_append,
            logging::log_environment,
            logging::log_read,
            logging::log_export,
            logging::log_clear,
            logging::log_open_directory,
            git::git_list_repositories,
            git::git_read_repository,
            git::git_read_identity,
            git::git_write_identity,
            git::git_open_repository,
            git::git_create_repository,
            git::git_clone_repository,
            git::git_cancel_clone,
            git::git_forget_repository,
            git::git_mark_opened,
            git::git_read_status,
            git::git_read_conflict,
            git::git_read_diff,
            git::git_read_diff_files,
            git::git_cancel_diff,
            git::git_read_refs,
            git::git_read_commits,
            git::git_read_commit,
            git::git_cancel_history,
            git::git_fetch,
            git::git_pull,
            git::git_push,
            git::git_cancel_network,
            git::worktrees::git_create_worktree,
            git::worktrees::git_remove_worktree,
            git::worktrees::git_lock_worktree,
            git::git_add_remote,
            git::git_update_remote,
            git::git_remove_remote,
            git::git_read_file,
            git::git_read_tree,
            git::git_read_file_history,
            git::git_preview_integration,
            git::git_merge,
            git::git_rebase,
            git::git_cherry_pick,
            git::git_revert,
            git::git_reset,
            git::git_create_stash,
            git::git_apply_stash,
            git::git_drop_stash,
            git::git_rename_stash,
            git::git_stage,
            git::git_unstage,
            git::git_stage_hunks,
            git::git_unstage_hunks,
            git::git_stage_lines,
            git::git_unstage_lines,
            git::git_discard,
            git::git_discard_all,
            git::git_discard_lines,
            git::git_resolve_conflict,
            git::git_mark_conflict_resolved,
            git::git_mark_conflicts_resolved,
            git::git_unresolve_conflict,
            git::git_keep_side,
            git::git_auto_resolve,
            git::git_continue_operation,
            git::git_abort_operation,
            git::git_quit_operation,
            git::git_commit,
            git::git_checkout,
            git::git_create_branch,
            git::git_read_reflog,
            git::git_recover_reflog_entry,
            git::git_create_tag,
            git::git_delete_branch,
            git::git_delete_tag,
            git::git_rename_branch,
            git::git_read_undo_stack,
            git::git_undo,
            git::git_redo,
            git::git_watch_repository,
            git::git_unwatch_repository,
            system::system_open_directory,
            system::system_resolve_child_path,
            terminal::terminal_create_session,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close_session
        ])
        .build(context)
        .expect("error al arrancar la ventana de GitThul")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                use tauri::Manager;
                app.state::<git::backup::BackupManager>().shutdown();
            }
        });
}

/// Ejecuta los modos auxiliares de credenciales, SSH y askpass de Git.
///
/// Devuelve `true` cuando el proceso era el auxiliar y ya no debe abrir Tauri.
pub fn run_credential_helper_if_requested() -> bool {
    auth::run_if_requested()
}

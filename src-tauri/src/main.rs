// En Windows, no abrir una consola además de la ventana en compilaciones de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if !gitthul_lib::run_credential_helper_if_requested() {
        gitthul_lib::run();
    }
}

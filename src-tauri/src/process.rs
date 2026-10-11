//! Procesos internos que no necesitan una consola ni una ventana propia.
//!
//! El terminal integrado crea su shell mediante el PTY y no usa esta fábrica.

use std::{ffi::OsStr, process::Command};

/// Prepara un comando interno conservando argumentos, pipes y códigos de salida.
/// En Windows evita que los ejecutables de consola abran una ventana al iniciarse.
pub(crate) fn command(program: impl AsRef<OsStr>) -> Command {
    let command = Command::new(program);
    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = command;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };
    command
}

#[cfg(test)]
mod tests {
    use std::{
        env,
        io::{Read, Write},
        process::Stdio,
    };

    #[test]
    fn preserves_arguments_pipes_and_exit_code() {
        const CHILD_ENV: &str = "GITTHUL_TEST_PROCESS_PIPES_CHILD";
        const TEST_NAME: &str = "process::tests::preserves_arguments_pipes_and_exit_code";
        const ARGUMENT: &str = "argumento con espacios, ñ, & y comillas \"literales\"";
        const INPUT: &[u8] = b"stdin\0with raw bytes\xff\n";
        const ERROR: &[u8] = b"stderr\0with raw bytes\xfe\n";

        if env::var_os(CHILD_ENV).as_deref() == Some(std::ffi::OsStr::new("child")) {
            // --skip admite un valor libre sin que libtest lo interprete como opción.
            let arguments: Vec<_> = env::args().collect();
            assert!(arguments
                .windows(2)
                .any(|pair| pair[0] == "--skip" && pair[1] == ARGUMENT));
            let mut input = Vec::new();
            std::io::stdin().read_to_end(&mut input).unwrap();
            assert_eq!(input, INPUT);
            let mut stdout = std::io::stdout().lock();
            stdout.write_all(ARGUMENT.as_bytes()).unwrap();
            stdout.write_all(&input).unwrap();
            stdout.flush().unwrap();
            let mut stderr = std::io::stderr().lock();
            stderr.write_all(ERROR).unwrap();
            stderr.flush().unwrap();
            // Termina solo el subproceso para comprobar un código distinto de cero.
            std::process::exit(23);
        }

        let mut child = super::command(env::current_exe().unwrap())
            .args(["--exact", TEST_NAME, "--nocapture", "--skip", ARGUMENT])
            .env(CHILD_ENV, "child")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(INPUT).unwrap();
        let output = child.wait_with_output().unwrap();

        assert_eq!(output.status.code(), Some(23), "{output:?}");
        let expected_stdout = [ARGUMENT.as_bytes(), INPUT].concat();
        // libtest escribe su encabezado antes de la salida del proceso hijo.
        assert!(output.stdout.ends_with(&expected_stdout), "{output:?}");
        assert_eq!(output.stderr, ERROR);
    }

    #[cfg(windows)]
    #[test]
    fn background_command_has_no_console() {
        const CHILD_ENV: &str = "GITTHUL_TEST_PROCESS_NO_CONSOLE_CHILD";
        const TEST_NAME: &str = "process::tests::background_command_has_no_console";

        if env::var_os(CHILD_ENV).as_deref() == Some(std::ffi::OsStr::new("child")) {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetConsoleWindow() -> *mut std::ffi::c_void;
            }

            // El ejecutable de pruebas es de consola: el hijo debe carecer de ella.
            assert!(unsafe { GetConsoleWindow() }.is_null());
            return;
        }

        let output = super::command(env::current_exe().unwrap())
            .args(["--exact", TEST_NAME, "--nocapture"])
            .env(CHILD_ENV, "child")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "{output:?}"
        );
    }
}

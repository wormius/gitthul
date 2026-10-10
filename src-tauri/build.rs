fn main() {
    tauri_build::build();
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("-windows-msvc")) {
        // Tauri's application resources do not reach the library's unit-test
        // executable. It also needs Common Controls v6 to load dialog imports.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            r#"cargo:rustc-link-arg=/MANIFESTDEPENDENCY:"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'""#
        );
    }
}

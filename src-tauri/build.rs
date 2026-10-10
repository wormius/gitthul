fn main() {
    tauri_build::build();
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("-windows-msvc")) {
        // Tauri's application resources do not reach the library's unit-test
        // executable. It also needs Common Controls v6 to load dialog imports.
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-common-controls.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}

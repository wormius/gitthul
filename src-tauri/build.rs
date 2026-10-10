fn main() {
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("-windows-msvc")) {
        // Preserve Tauri's icons/version resources, but embed the manifest once
        // through the linker so the application and test executables share it.
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("failed to build Tauri resources");
        // Tauri's application resources do not reach the library's unit-test
        // executable. It also needs Common Controls v6 to load dialog imports.
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-common-controls.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    } else {
        tauri_build::build();
    }
}

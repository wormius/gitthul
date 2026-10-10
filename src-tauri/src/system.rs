//! Operaciones del sistema que requieren validar datos antes de salir de la aplicación.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

fn validate_directory(path: &Path) -> Result<(), String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("no se pudo consultar {}: {error}", path.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} no es un directorio", path.display()));
    }

    Ok(())
}

#[tauri::command]
pub fn system_open_directory(app: AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    validate_directory(path)?;

    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("no se pudo abrir {}: {error}", path.display()))
}

#[tauri::command]
pub fn system_resolve_child_path(parent: String, child: String) -> Result<String, String> {
    if child.is_empty()
        || child == "."
        || child == ".."
        || child.contains(['/', '\\', '\0', '\r', '\n'])
    {
        return Err("el nombre hijo no es válido".to_owned());
    }
    let parent = std::fs::canonicalize(&parent)
        .map_err(|error| format!("no se pudo resolver {parent}: {error}"))?;
    validate_directory(&parent)?;
    Ok(parent.join(child).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{system_resolve_child_path, validate_directory};

    #[test]
    fn accepts_an_existing_directory() {
        let directory = tempdir().expect("directorio temporal");

        assert_eq!(validate_directory(directory.path()), Ok(()));
    }

    #[test]
    fn rejects_a_file_and_a_missing_path() {
        let directory = tempdir().expect("directorio temporal");
        let file = directory.path().join("archivo.txt");
        fs::write(&file, "contenido").expect("archivo temporal");

        assert!(validate_directory(&file)
            .expect_err("un archivo no es una carpeta")
            .contains("no es un directorio"));
        assert!(validate_directory(&directory.path().join("ausente"))
            .expect_err("una ruta ausente se rechaza")
            .contains("no se pudo consultar"));
    }

    #[test]
    fn resolves_a_child_from_the_canonical_parent() {
        let directory = tempdir().expect("directorio temporal");
        assert_eq!(
            system_resolve_child_path(
                directory.path().to_string_lossy().into_owned(),
                "repo".to_owned()
            )
            .expect("ruta hija"),
            directory.path().join("repo").to_string_lossy()
        );
        assert!(system_resolve_child_path(
            directory.path().to_string_lossy().into_owned(),
            "../fuera".to_owned()
        )
        .is_err());
    }
}

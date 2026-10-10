//! Archivos de estado en la carpeta de configuración.
//!
//! Rust no sabe qué hay dentro de ninguno: recibe y devuelve JSON tal cual. La
//! forma la define el dominio en TypeScript, que es quien la valida al leer, y
//! duplicar aquí esa estructura obligaría a tocar dos sitios cada vez que
//! aparezca un ajuste o un dato nuevo de biblioteca.
//!
//! Son dos archivos y no uno porque las cadencias son distintas: los ajustes se
//! tocan una vez cada varios meses y la biblioteca cada vez que se abre un
//! repositorio. Con un solo archivo, cada apertura reescribiría el tema.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

pub(crate) fn file_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(name))
        .map_err(|error| format!("no se pudo resolver la carpeta de configuración: {error}"))
}

/// Devuelve un objeto vacío la primera vez: no haber arrancado nunca no es un
/// error, y el frontend ya sabe caer a sus valores por defecto.
pub fn read(app: &AppHandle, name: &str) -> Result<Value, String> {
    let path = file_path(app, name)?;

    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("{} no es JSON válido: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(Value::Object(serde_json::Map::new()))
        }
        Err(error) => Err(format!("no se pudo leer {}: {error}", path.display())),
    }
}

/// Escribe primero un archivo temporal y luego lo renombra.
///
/// Un corte de luz a mitad de la escritura dejaría el archivo truncado, y con
/// él una ventana que arranca sin tema ni idioma. El renombrado es atómico en
/// los tres sistemas, así que o se ve el archivo viejo entero o el nuevo entero.
pub fn write(app: &AppHandle, name: &str, value: &Value) -> Result<(), String> {
    let path = file_path(app, name)?;

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|error| format!("no se pudo crear {}: {error}", dir.display()))?;
    }

    let temporary = path.with_extension("json.tmp");
    let contents = serde_json::to_string_pretty(value)
        .map_err(|error| format!("no se pudo serializar {}: {error}", path.display()))?;

    {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("no se pudo crear {}: {error}", temporary.display()))?;

        file.write_all(contents.as_bytes())
            .map_err(|error| format!("no se pudo escribir {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("no se pudo confirmar {}: {error}", temporary.display()))?;
    }

    fs::rename(&temporary, &path)
        .map_err(|error| format!("no se pudo reemplazar {}: {error}", path.display()))
}

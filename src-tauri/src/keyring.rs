//! Acceso opaco al llavero seguro del sistema operativo.
//!
//! La ventana puede consultar si existe una entrada y sustituirla o borrarla,
//! pero nunca recuperar su valor. El helper interno de Git es la única costura
//! que lo lee y lo entrega directamente al pipe del proceso Git.

use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const SERVICE: &str = "org.gitthul.GitThul";
const AVAILABILITY_PROBE: &str = "internal:availability-probe";

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CredentialKind {
    Remote,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRef {
    kind: CredentialKind,
    id: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct KeyringCommandError {
    code: &'static str,
}

impl KeyringCommandError {
    fn invalid_ref() -> Self {
        Self {
            code: "keyring.invalidRef",
        }
    }

    fn unavailable() -> Self {
        Self {
            code: "keyring.unavailable",
        }
    }

    fn failed() -> Self {
        Self {
            code: "keyring.failed",
        }
    }
}

#[tauri::command]
pub fn keyring_is_available() -> bool {
    Entry::new(SERVICE, AVAILABILITY_PROBE)
        .map(|entry| availability(&entry))
        .unwrap_or(false)
}

#[tauri::command]
pub fn keyring_has(credential: CredentialRef) -> Result<bool, KeyringCommandError> {
    has_entry(&entry(&credential)?)
}

#[tauri::command]
pub fn keyring_set(credential: CredentialRef, secret: String) -> Result<(), KeyringCommandError> {
    if secret.is_empty() {
        return Err(KeyringCommandError::failed());
    }
    let secret = Zeroizing::new(secret);
    set_entry(&entry(&credential)?, secret.as_str())
}

#[tauri::command]
pub fn keyring_delete(credential: CredentialRef) -> Result<(), KeyringCommandError> {
    delete_entry(&entry(&credential)?)
}

fn entry(reference: &CredentialRef) -> Result<Entry, KeyringCommandError> {
    let id = reference.id.trim();
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err(KeyringCommandError::invalid_ref());
    }
    let kind = match reference.kind {
        CredentialKind::Remote => "remote",
    };
    Entry::new(SERVICE, &format!("{kind}:{id}")).map_err(map_error)
}

fn availability(entry: &Entry) -> bool {
    match entry.get_password() {
        Ok(_) | Err(Error::NoEntry) | Err(Error::BadEncoding(_)) | Err(Error::Ambiguous(_)) => true,
        Err(_) => false,
    }
}

fn has_entry(entry: &Entry) -> Result<bool, KeyringCommandError> {
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(map_error(error)),
    }
}

/// Lee una credencial remota solo para el helper que habla directamente con
/// Git. Esta función no forma parte de la superficie IPC.
pub fn read_remote_secret(id: &str) -> Result<Option<Zeroizing<String>>, KeyringCommandError> {
    let reference = CredentialRef {
        kind: CredentialKind::Remote,
        id: id.to_owned(),
    };
    read_entry(&entry(&reference)?)
}

pub(crate) fn write_remote_secret(id: &str, secret: &str) -> Result<(), KeyringCommandError> {
    set_entry(
        &entry(&CredentialRef {
            kind: CredentialKind::Remote,
            id: id.into(),
        })?,
        secret,
    )
}

pub(crate) fn forget_remote_secret(id: &str) -> Result<(), KeyringCommandError> {
    delete_entry(&entry(&CredentialRef {
        kind: CredentialKind::Remote,
        id: id.into(),
    })?)
}

fn read_entry(entry: &Entry) -> Result<Option<Zeroizing<String>>, KeyringCommandError> {
    match entry.get_password() {
        Ok(secret) => Ok(Some(Zeroizing::new(secret))),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(map_error(error)),
    }
}

fn set_entry(entry: &Entry, secret: &str) -> Result<(), KeyringCommandError> {
    entry.set_password(secret).map_err(map_error)
}

fn delete_entry(entry: &Entry) -> Result<(), KeyringCommandError> {
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(map_error(error)),
    }
}

fn map_error(error: Error) -> KeyringCommandError {
    match error {
        Error::NoStorageAccess(_) | Error::PlatformFailure(_) => KeyringCommandError::unavailable(),
        Error::Invalid(_, _) | Error::TooLong(_, _) => KeyringCommandError::invalid_ref(),
        _ => KeyringCommandError::failed(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Once;

    use keyring::{mock, mock::MockCredential, Entry, Error};

    use super::{
        availability, delete_entry, entry, has_entry, read_entry, set_entry, CredentialKind,
        CredentialRef, KeyringCommandError, SERVICE,
    };

    fn install_mock() {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            keyring::set_default_credential_builder(mock::default_credential_builder());
        });
    }

    fn mock_entry(user: &str) -> Entry {
        install_mock();
        Entry::new(SERVICE, user).unwrap()
    }

    #[test]
    fn consulta_escribe_y_borra_sin_devolver_el_secreto() {
        let entry = mock_entry("remote:example.com");

        assert!(!has_entry(&entry).unwrap());
        set_entry(&entry, "token-de-prueba").unwrap();
        assert!(has_entry(&entry).unwrap());
        assert_eq!(
            read_entry(&entry).unwrap().as_deref().map(String::as_str),
            Some("token-de-prueba")
        );
        delete_entry(&entry).unwrap();
        assert!(!has_entry(&entry).unwrap());
        delete_entry(&entry).unwrap();
    }

    #[test]
    fn valida_la_referencia_antes_de_tocar_el_almacen() {
        install_mock();
        for id in ["", "   ", "host\ninyectado"] {
            let result = entry(&CredentialRef {
                kind: CredentialKind::Remote,
                id: id.to_owned(),
            });
            assert!(matches!(
                result,
                Err(KeyringCommandError {
                    code: "keyring.invalidRef"
                })
            ));
        }
    }

    #[test]
    fn distingue_ausencia_de_almacen_no_disponible_sin_serializar_la_causa() {
        let entry = mock_entry("remote:unavailable.example");
        let credential = entry
            .get_credential()
            .downcast_ref::<MockCredential>()
            .unwrap();
        credential.set_error(Error::NoStorageAccess("bloqueado".into()));

        assert!(!availability(&entry));

        credential.set_error(Error::PlatformFailure("detalle sensible".into()));
        assert_eq!(
            has_entry(&entry),
            Err(KeyringCommandError {
                code: "keyring.unavailable"
            })
        );
    }
}

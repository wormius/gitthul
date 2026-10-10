//! Consulta de novedades suspendida hasta confirmar el repositorio público.
//!
//! La frontera IPC responde sin crear un cliente HTTP ni consultar servicios,
//! incluso cuando se invoca directamente con preferencias antiguas.

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ReleaseCheck {
    NotConfigured,
}

#[tauri::command]
pub async fn releases_check(channel: String) -> Result<ReleaseCheck, String> {
    if channel != "stable" && channel != "beta" {
        return Err("canal de versiones no válido".into());
    }
    Ok(ReleaseCheck::NotConfigured)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_ipc_checks_are_not_configured_for_both_channels() {
        for channel in ["stable", "beta"] {
            let result = tauri::async_runtime::block_on(releases_check(channel.into())).unwrap();
            assert_eq!(result, ReleaseCheck::NotConfigured);
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                serde_json::json!({ "status": "notConfigured" })
            );
        }
    }

    #[test]
    fn rejects_unknown_channels_without_network() {
        assert!(tauri::async_runtime::block_on(releases_check("nightly".into())).is_err());
    }
}

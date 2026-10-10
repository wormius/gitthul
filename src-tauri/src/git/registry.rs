use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::RepoSummary;

const VERSION: u8 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    version: u8,
    pub repositories: Vec<RepoSummary>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: VERSION,
            repositories: Vec::new(),
        }
    }
}

impl Registry {
    pub fn from_value(value: Value) -> Result<Self, serde_json::Error> {
        if value.as_object().is_some_and(|object| object.is_empty()) {
            return Ok(Self::default());
        }

        let registry: Self = serde_json::from_value(value)?;
        if registry.version != VERSION {
            return Err(<serde_json::Error as serde::de::Error>::custom(
                "versión de registro desconocida",
            ));
        }
        Ok(registry)
    }

    pub fn sort(&mut self) {
        sort_repositories(&mut self.repositories);
    }
}

pub fn sort_repositories(repositories: &mut [RepoSummary]) {
    repositories.sort_by(|left, right| {
        right
            .last_opened_at
            .cmp(&left.last_opened_at)
            .then_with(|| left.name.cmp(&right.name))
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::Registry;

    #[test]
    fn acepta_el_archivo_ausente_como_registro_vacio() {
        let registry = Registry::from_value(json!({})).expect("registro inicial");
        assert!(registry.repositories.is_empty());
    }

    #[test]
    fn rechaza_una_version_que_no_conoce() {
        assert!(Registry::from_value(json!({ "version": 2, "repositories": [] })).is_err());
    }
}

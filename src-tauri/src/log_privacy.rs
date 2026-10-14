//! Redact at the native persistence boundary, including legacy exported entries.
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

fn rules() -> &'static Vec<(Regex, &'static str)> {
    static RULES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    RULES.get_or_init(|| {
        [
            (r"(?s)-----BEGIN [^-]*PRIVATE KEY-----.*?(?:-----END [^-]*PRIVATE KEY-----|$)", "[redacted private key]"),
            (r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b", "[redacted]"),
            (r"(?i)([a-z][a-z0-9+.-]*://)[^\s/]+@", "${1}[redacted]@"),
            (r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+", "${1} [redacted]"),
            (r#"(?i)([?&](?:access_token|refresh_token|token|password|passphrase|secret|api_key|client_secret)=)[^&\s"']*"#, "${1}[redacted]"),
            (r#"(?i)((?:password|passwd|passphrase|token|secret|authorization|api[_-]?key|cookie)["']?\s*[=:]\s*)"[^"\r\n]*""#, "${1}\"[redacted]\""),
            (r#"(?i)((?:password|passwd|passphrase|token|secret|authorization|api[_-]?key|cookie)["']?\s*[=:]\s*)'[^'\r\n]*'"#, "${1}'[redacted]'"),
            (r#"(?i)((?:password|passwd|passphrase|token|secret|authorization|api[_-]?key|cookie)["']?\s*[=:]\s*)[^\s,;"'}]+"#, "${1}[redacted]"),
        ]
        .into_iter()
        .map(|(pattern, replacement)| (Regex::new(pattern).expect("fixed privacy pattern"), replacement))
        .collect()
    })
}

pub(crate) fn text(value: &str) -> String {
    let mut found = if value.trim_start().starts_with(['{', '[']) {
        if let Ok(mut json) = serde_json::from_str::<Value>(value) {
            self::value(&mut json);
            json.to_string()
        } else {
            value.to_owned()
        }
    } else {
        value.to_owned()
    };
    for (pattern, replacement) in rules() {
        found = pattern.replace_all(&found, *replacement).into_owned();
    }
    found
}

fn secret_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().replace(['_', '-'], "").as_str(),
        "password"
            | "passwd"
            | "passphrase"
            | "token"
            | "accesstoken"
            | "refreshtoken"
            | "secret"
            | "authorization"
            | "apikey"
            | "privatekey"
            | "credential"
            | "credentials"
            | "clientsecret"
            | "cookie"
            | "setcookie"
            | "clipboard"
            | "terminalinput"
            | "stdin"
            | "commitmessage"
            | "summary"
            | "body"
    )
}

pub(crate) fn value(value: &mut Value) {
    match value {
        Value::String(value) => *value = text(value),
        Value::Array(items) => items.iter_mut().for_each(self::value),
        Value::Object(items) => {
            for (key, item) in items {
                if secret_key(key) {
                    *item = Value::String("[redacted]".into());
                } else {
                    self::value(item);
                }
            }
        }
        _ => {}
    }
}

pub(crate) fn bounded(value: &str, limit: usize) -> String {
    let value = text(value);
    if value.len() <= limit {
        return value;
    }
    let mut end = limit.saturating_sub("\n[truncated]".len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[truncated]", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_and_nested_diagnostics_redact_credentials() {
        let mut input = serde_json::json!({
            "cause": { "password": "private words", "stderr": "https://user:secret@example.invalid/x?token=hidden Bearer abc123" },
            "stage": "open repository"
        });
        value(&mut input);
        let output = input.to_string();
        for secret in ["private words", "user:secret", "token=hidden", "abc123"] {
            assert!(!output.contains(secret));
        }
        assert!(output.contains("open repository"));
        assert!(bounded(&"ñ".repeat(100), 50).ends_with("[truncated]"));
        assert_eq!(
            text("https://user@example.invalid:private-password@host.invalid/repo"),
            "https://[redacted]@host.invalid/repo"
        );
    }
}

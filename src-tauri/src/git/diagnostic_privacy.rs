//! Native parser failures may quote their input even through transparent wrappers.
//! Keep the error category and safe location metadata without recording those bytes.

use std::error::Error;

pub(super) fn error_message(error: &(dyn Error + 'static)) -> String {
    let mut current = Some(error);
    for _ in 0..16 {
        let Some(cause) = current else {
            return error.to_string();
        };
        if let Some(message) = sensitive_message(cause) {
            return message;
        }
        // gitoxide's boxed errors can retain a typed root that std::Error::source
        // skips. Inspect its frames before formatting the enclosing Display.
        if let Some(error) = cause.downcast_ref::<gix::error::Error>() {
            for (index, frame) in error.sources().enumerate() {
                if index >= 32 {
                    return "Native gitoxide error chain exceeded the diagnostic inspection limit"
                        .into();
                }
                if let Some(message) = sensitive_message(frame) {
                    return message;
                }
            }
        }
        current = cause.source();
    }
    "Native error cause chain exceeded the diagnostic inspection limit".to_owned()
}

fn sensitive_message(error: &(dyn Error + 'static)) -> Option<String> {
    if let Some(error) = error.downcast_ref::<serde_json::Error>() {
        if error.classify() == serde_json::error::Category::Data {
            return Some(format!(
                "JSON schema validation failed (category=Data, line={}, column={}; input omitted)",
                error.line(),
                error.column()
            ));
        }
    }

    // thiserror's transparent variants forward source() to their inner source,
    // so the sensitive payload itself can be absent from the standard chain.
    if let Some(error) = error.downcast_ref::<gix::config::file::init::Error>() {
        return match error {
            gix::config::file::init::Error::Parse(error) => sensitive_message(error),
            gix::config::file::init::Error::Includes(error) => sensitive_message(error),
            _ => None,
        };
    }
    if let Some(error) = error.downcast_ref::<gix::config::file::includes::Error>() {
        if let gix::config::file::includes::Error::Parse(error) = error {
            return sensitive_message(error);
        }
    }
    if let Some(error) = error.downcast_ref::<gix::config::Error>() {
        use gix::config::Error::*;
        return match error {
            ConfigBoolean(error) => sensitive_message(error),
            ConfigUnsigned(error) => sensitive_message(error),
            ConfigTypedString(error) => sensitive_message(error),
            ConfigCompression(error) => sensitive_message(error),
            RefsNamespace(error) => sensitive_message(error),
            CoreAbbrev(error) => sensitive_message(error),
            Init(error) => sensitive_message(error),
            ResolveIncludes(error) => sensitive_message(error),
            UnsupportedObjectFormat { .. } => {
                Some("Git repository object format is unsupported (input omitted)".into())
            }
            PathInterpolation { .. } => {
                Some("Git worktree configuration path interpolation failed (input omitted)".into())
            }
            FromEnv(_) => {
                Some("Git environment configuration could not be loaded (input omitted)".into())
            }
            ConfigOverrides { .. } => {
                Some("Git configuration overrides could not be applied (input omitted)".into())
            }
            _ => None,
        };
    }
    if let Some(gix::odb::loose::find::Error::Decode(error)) =
        error.downcast_ref::<gix::odb::loose::find::Error>()
    {
        return sensitive_message(error);
    }

    if let Some(error) = error.downcast_ref::<gix::config::parse::Error>() {
        return Some(format!(
            "Git configuration parse failed at line {} (input omitted)",
            error.line_number()
        ));
    }
    if let Some(error) = error.downcast_ref::<gix::config::value::Error>() {
        return Some(format!(
            "Git configuration value could not be decoded: {} (input omitted)",
            error.message
        ));
    }
    if let Some(error) = error.downcast_ref::<gix::error::ValidationError>() {
        if error.input.is_some() {
            return Some(match &error.message {
                std::borrow::Cow::Borrowed(message) => {
                    format!("Native validation failed: {message} (input omitted)")
                }
                std::borrow::Cow::Owned(_) => {
                    "Native validation failed [gix::error::ValidationError] (input omitted)".into()
                }
            });
        }
    }
    if let Some(error) = error.downcast_ref::<gix::objs::decode::LooseHeaderDecodeError>() {
        return match error {
            gix::objs::decode::LooseHeaderDecodeError::ParseIntegerError { message, .. } => Some(
                format!("Git object header size parse failed: {message} (input omitted)"),
            ),
            gix::objs::decode::LooseHeaderDecodeError::ObjectHeader(_) => {
                Some("Git object header has an unknown object kind (input omitted)".into())
            }
            gix::objs::decode::LooseHeaderDecodeError::InvalidHeader { .. } => None,
        };
    }
    if error.is::<gix::objs::kind::Error>() {
        return Some("Git object kind validation failed (input omitted)".into());
    }
    if let Some(error) = error.downcast_ref::<gix::refs::file::loose::reference::decode::Error>() {
        return Some(
            match error {
                gix::refs::file::loose::reference::decode::Error::Parse { .. } => {
                    "Git loose reference object identifier could not be parsed (input omitted)"
                }
                gix::refs::file::loose::reference::decode::Error::RefnameValidation { .. } => {
                    "Git symbolic reference target name is invalid (input omitted)"
                }
            }
            .into(),
        );
    }
    if let Some(error) = error.downcast_ref::<gix::refs::packed::iter::Error>() {
        return Some(match error {
            gix::refs::packed::iter::Error::Header { .. } => {
                "Git packed references header could not be parsed (input omitted)".into()
            }
            gix::refs::packed::iter::Error::Reference { line_number, .. } => format!(
                "Git packed reference could not be parsed at line {line_number} (input omitted)"
            ),
        });
    }
    if let Some(gix::refs::file::iter::loose_then_packed::Error::PackedReference {
        line_number,
        ..
    }) = error.downcast_ref::<gix::refs::file::iter::loose_then_packed::Error>()
    {
        return Some(format!(
            "Git packed reference could not be parsed at line {line_number} (input omitted)"
        ));
    }
    if let Some(error) = error.downcast_ref::<gix::url::parse::Error>() {
        let category = match error {
            gix::url::parse::Error::Utf8 { .. } => "invalid UTF-8",
            gix::url::parse::Error::Url { .. } => "invalid syntax",
            gix::url::parse::Error::TooLong { .. } => "host is too long",
            gix::url::parse::Error::MissingRepositoryPath { .. } => "repository path is missing",
            gix::url::parse::Error::RelativeUrl { .. } => "relative URL is disallowed",
        };
        return Some(format!(
            "Git URL validation failed: {category} (input omitted)"
        ));
    }
    if let Some(gix::refspec::parse::Error::PatternUnsupported { .. }) =
        error.downcast_ref::<gix::refspec::parse::Error>()
    {
        return Some("Git refspec contains an unsupported glob pattern (input omitted)".into());
    }
    if let Some(gix::discover::is_git::Error::GitFile(error)) =
        error.downcast_ref::<gix::discover::is_git::Error>()
    {
        return sensitive_message(error);
    }
    if let Some(gix::discover::path::from_gitdir_file::Error::Parse(error)) =
        error.downcast_ref::<gix::discover::path::from_gitdir_file::Error>()
    {
        return sensitive_message(error);
    }
    if error.is::<gix::discover::parse::gitdir::Error>() {
        return Some("Git directory pointer could not be parsed (input omitted)".into());
    }
    macro_rules! configuration_errors {
        ($($kind:ty),+ $(,)?) => {
            $(if error.is::<$kind>() {
                return Some(concat!("Git configuration validation failed [", stringify!($kind), "] (input omitted)").into());
            })+
        };
    }
    configuration_errors!(
        gix::config::key::GenericError,
        gix::config::key::GenericErrorWithValue,
        gix::config::protocol::allow::Error,
        gix::config::encoding::Error,
        gix::config::abbrev::Error,
        gix::config::checkout::workers::Error,
        gix::config::time::Error,
        gix::config::lock_timeout::Error,
        gix::config::duration::Error,
        gix::config::boolean::Error,
        gix::config::unsigned_integer::Error,
        gix::config::url::Error,
        gix::config::string::Error,
        gix::config::refspec::Error,
        gix::config::refs_namespace::Error,
        gix::config::ssl_version::Error,
        gix::config::remote::symbolic_name::Error,
    );
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_parser_and_transparent_parent_preserve_line_without_private_config_bytes() {
        let input = b"[core]\n?private-long-config-value\n";
        let error = gix::config::parse::Events::from_bytes(input, None).unwrap_err();
        assert!(error.to_string().contains("private"));
        let safe = error_message(&error);
        assert!(safe.contains("line 2"));
        assert!(!safe.contains("private"));
        let wrapper = gix::config::file::init::Error::from(error);
        let safe = error_message(&wrapper);
        assert!(safe.contains("configuration parse"));
        assert!(!safe.contains("private"));
        let temporary = tempfile::tempdir().unwrap();
        let output = std::process::Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(temporary.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        std::fs::write(temporary.path().join(".git/config"), input).unwrap();
        let error = gix::open(temporary.path()).unwrap_err();
        let diagnostic = super::super::diagnostics::Diagnostic::cause("fixture.open", &error);
        let value = serde_json::to_value(diagnostic).unwrap();
        assert!(value.to_string().contains("configuration parse"));
        assert!(value.to_string().contains("line 2"));
        assert!(!value.to_string().contains("private"));
    }

    #[test]
    fn object_header_and_ref_parsers_omit_their_arbitrary_input() {
        let object = gix::objs::decode::loose_header(b"commit private-object-size\0").unwrap_err();
        assert!(object.to_string().contains("private-object-size"));
        assert!(error_message(&object).contains("object header size"));
        assert!(!error_message(&object).contains("private-object-size"));
        let name = "refs/heads/main".try_into().unwrap();
        let reference = gix::refs::file::loose::Reference::try_from_path(
            name,
            b"private-reference-value",
            gix::hash::Kind::Sha1,
        )
        .unwrap_err();
        assert!(reference.to_string().contains("private-reference-value"));
        assert!(error_message(&reference).contains("reference object identifier"));
        assert!(!error_message(&reference).contains("private-reference-value"));
        let packed = gix::refs::packed::iter::Error::Reference {
            invalid_line: b"private-packed-reference".as_slice().into(),
            line_number: 7,
        };
        assert!(error_message(&packed).contains("line 7"));
        assert!(!error_message(&packed).contains("private-packed-reference"));
        let temporary = tempfile::tempdir().unwrap();
        std::fs::write(
            temporary.path().join(".git"),
            b"private-gitdir-file-content",
        )
        .unwrap();
        let error = gix::discover(temporary.path()).unwrap_err();
        let diagnostic = super::super::diagnostics::Diagnostic::cause("fixture.discover", &error);
        assert!(!serde_json::to_value(diagnostic)
            .unwrap()
            .to_string()
            .contains("private-gitdir-file-content"));
    }

    #[test]
    fn validation_inputs_are_omitted_while_safe_categorical_messages_and_io_survive() {
        let error =
            gix::error::ValidationError::new_with_input("invalid time", "private-date-value");
        assert!(error_message(&error).contains("invalid time"));
        assert!(!error_message(&error).contains("private-date-value"));
        let safe = gix::error::ValidationError::new("Closing '>' not found");
        assert_eq!(error_message(&safe), "Closing '>' not found");
        let io = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(error_message(&io), io.to_string());
    }
    #[test]
    fn registry_schema_error_omits_the_supplied_invalid_value() {
        let error = super::super::registry::Registry::from_value(serde_json::json!({
            "version": "PRIVATE_REGISTRY_VALUE", "repositories": [],
        }))
        .unwrap_err();
        assert!(error.to_string().contains("PRIVATE_REGISTRY_VALUE"));
        assert!(error.source().is_none());
        let diagnostic = super::super::diagnostics::Diagnostic::cause("registry.decode", &error);
        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["stage"], "registry.decode");
        assert!(value.to_string().contains("category=Data"));
        assert!(value.to_string().contains("line=0"));
        assert!(!value.to_string().contains("PRIVATE_REGISTRY_VALUE"));
    }
}

//! Explain non-obvious changes without normalizing the patch used by Git writes.
use std::collections::BTreeSet;

use serde::Serialize;
use unicode_normalization::{is_nfc, is_nfd, UnicodeNormalization};

use super::encoding::{self, Decoded};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TextChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    encoding: Option<EncodingChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bom: Option<BomChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_newline: Option<PresenceChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    whitespace: Option<WhitespaceChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unicode_normalization: Option<NormalizationChange>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    invisible_characters: Vec<InvisibleCharacterChange>,
}

#[derive(Debug, Serialize)]
struct EncodingChange {
    before: &'static str,
    after: &'static str,
}

#[derive(Debug, Serialize)]
struct BomChange {
    before: Option<&'static str>,
    after: Option<&'static str>,
}

#[derive(Debug, Serialize)]
struct PresenceChange {
    before: bool,
    after: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum WhitespaceChange {
    Trailing,
    Indentation,
    SpacesAndTabs,
}

#[derive(Debug, Serialize)]
struct NormalizationChange {
    before: &'static str,
    after: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InvisibleCharacterChange {
    code_point: String,
    before: usize,
    after: usize,
}

pub(super) fn analyze(
    before: &[u8],
    after: &[u8],
    old: &Decoded,
    new: &Decoded,
) -> Option<TextChanges> {
    // A replacement character is not evidence that the original text matches.
    if old.errors || new.errors {
        return None;
    }
    let mut changes = TextChanges::default();
    if old.detected != new.detected {
        changes.encoding = Some(EncodingChange {
            before: old.detected,
            after: new.detected,
        });
    }
    let old_bom = encoding::bom(before).map(|(name, _)| name);
    let new_bom = encoding::bom(after).map(|(name, _)| name);
    if old_bom != new_bom {
        changes.bom = Some(BomChange {
            before: old_bom,
            after: new_bom,
        });
    }
    let old_final = old.text.ends_with('\n');
    let new_final = new.text.ends_with('\n');
    if old_final != new_final {
        changes.final_newline = Some(PresenceChange {
            before: old_final,
            after: new_final,
        });
    }
    // Analyze text-only differences independently of CRLF and the final newline.
    let old_lines = old.text.replace("\r\n", "\n");
    let new_lines = new.text.replace("\r\n", "\n");
    let old_body = old_lines.strip_suffix('\n').unwrap_or(&old_lines);
    let new_body = new_lines.strip_suffix('\n').unwrap_or(&new_lines);
    if old_body != new_body {
        let trim_end = |line: &str| line.trim_end_matches([' ', '\t']).to_owned();
        let trim_start = |line: &str| line.trim_start_matches([' ', '\t']).to_owned();
        if old_body
            .split('\n')
            .map(trim_end)
            .eq(new_body.split('\n').map(trim_end))
        {
            changes.whitespace = Some(WhitespaceChange::Trailing);
        } else if old_body
            .split('\n')
            .map(trim_start)
            .eq(new_body.split('\n').map(trim_start))
        {
            changes.whitespace = Some(WhitespaceChange::Indentation);
        } else if old_body
            .chars()
            .filter(|c| !matches!(c, ' ' | '\t'))
            .eq(new_body.chars().filter(|c| !matches!(c, ' ' | '\t')))
        {
            changes.whitespace = Some(WhitespaceChange::SpacesAndTabs);
        }
        if !old_body.is_ascii() || !new_body.is_ascii() {
            if old_body.nfc().eq(new_body.nfc()) {
                changes.unicode_normalization = Some(NormalizationChange {
                    before: normalization_form(old_body),
                    after: normalization_form(new_body),
                });
            }
            if old_body
                .chars()
                .filter_map(visible_character)
                .eq(new_body.chars().filter_map(visible_character))
            {
                let characters = old_body
                    .chars()
                    .chain(new_body.chars())
                    .filter(|c| is_invisible(*c))
                    .collect::<BTreeSet<_>>();
                changes.invisible_characters = characters
                    .into_iter()
                    .map(|character| InvisibleCharacterChange {
                        code_point: format!("U+{:04X}", u32::from(character)),
                        before: old_body.chars().filter(|c| *c == character).count(),
                        after: new_body.chars().filter(|c| *c == character).count(),
                    })
                    .collect();
            }
        }
    }
    (changes.encoding.is_some()
        || changes.bom.is_some()
        || changes.final_newline.is_some()
        || changes.whitespace.is_some()
        || changes.unicode_normalization.is_some()
        || !changes.invisible_characters.is_empty())
    .then_some(changes)
}

fn normalization_form(text: &str) -> &'static str {
    if is_nfc(text) {
        "NFC"
    } else if is_nfd(text) {
        "NFD"
    } else {
        "mixed"
    }
}

fn is_invisible(character: char) -> bool {
    matches!(character, '\u{00a0}' | '\u{034f}' | '\u{061c}' | '\u{200b}'..='\u{200f}'
        | '\u{202a}'..='\u{202f}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

fn visible_character(character: char) -> Option<char> {
    match character {
        '\u{00a0}' | '\u{202f}' => Some(' '),
        character if is_invisible(character) => None,
        character => Some(character),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn details(before: &[u8], after: &[u8]) -> Value {
        let old = encoding::decode(before, None).unwrap();
        let new = encoding::decode(after, None).unwrap();
        serde_json::to_value(analyze(before, after, &old, &new)).unwrap()
    }

    #[test]
    fn explains_whitespace_without_treating_semantic_edits_as_whitespace() {
        assert_eq!(
            details(b"total = 12\n", b"total = 12 \t\n")["whitespace"],
            "trailing"
        );
        assert_eq!(
            details(b"    total = 12\n", b"\ttotal = 12\n")["whitespace"],
            "indentation"
        );
        assert_eq!(
            details(b"total = 12\n", b"total  =\t12\n")["whitespace"],
            "spacesAndTabs"
        );
        assert!(details(b"total = 12\n", b"total = 13 \n").is_null());
        assert!(details(b"a\nb\n", b"ab\n").is_null());
    }

    #[test]
    fn distinguishes_final_newline_bom_and_encoding() {
        assert_eq!(
            details(b"same", b"same\n")["finalNewline"],
            json!({"before":false,"after":true})
        );
        assert_eq!(
            details(b"same\n", b"same")["finalNewline"],
            json!({"before":true,"after":false})
        );
        assert_eq!(
            details(b"same\n", b"\xef\xbb\xbfsame\n")["bom"],
            json!({"before":null,"after":"utf-8"})
        );
        assert_eq!(
            details(b"\xef\xbb\xbfsame\n", b"same\n")["bom"],
            json!({"before":"utf-8","after":null})
        );
        let utf16 = encoding::encode("same\n", "utf-16le", true).unwrap();
        let result = details(b"same\n", &utf16);
        assert_eq!(
            result["encoding"],
            json!({"before":"utf-8","after":"utf-16le"})
        );
        assert_eq!(result["bom"]["after"], "utf-16le");
    }

    #[test]
    fn explains_canonical_unicode_and_invisible_code_points() {
        assert_eq!(
            details("café\n".as_bytes(), "cafe\u{301}\n".as_bytes())["unicodeNormalization"],
            json!({"before":"NFC","after":"NFD"})
        );
        assert!(details("ﬀ\n".as_bytes(), b"ff\n").is_null());
        let invisible = details(
            b"text with space\n",
            "text\u{200b} with\u{a0}space\n".as_bytes(),
        );
        assert_eq!(
            invisible["invisibleCharacters"],
            json!([
                {"codePoint":"U+00A0","before":0,"after":1},
                {"codePoint":"U+200B","before":0,"after":1}
            ])
        );
        assert!(details(b"text with space\n", "other\u{200b} text\n".as_bytes()).is_null());
        assert!(details(b"same\n", b"same\n").is_null());
    }

    #[test]
    fn invalid_decoding_never_proves_equivalence() {
        let old = encoding::decode(b"same \xff\n", Some("utf-8")).unwrap();
        let new = encoding::decode(b"same \xfe \n", Some("utf-8")).unwrap();
        assert!(old.errors && new.errors);
        assert!(analyze(b"same \xff\n", b"same \xfe \n", &old, &new).is_none());
    }
}

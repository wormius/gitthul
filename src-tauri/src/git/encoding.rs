//! Shared byte decoding for file views, diffs and conflict stages.
use encoding_rs::Encoding;

pub const ENCODINGS: &[&str] = &[
    "utf-8",
    "utf-16le",
    "utf-16be",
    "utf-32le",
    "utf-32be",
    "us-ascii",
    "iso-8859-1",
    "windows-1250",
    "windows-1251",
    "windows-1252",
    "windows-1253",
    "windows-1254",
    "windows-1255",
    "windows-1256",
    "windows-1257",
    "windows-1258",
    "windows-874",
    "iso-8859-2",
    "iso-8859-3",
    "iso-8859-4",
    "iso-8859-5",
    "iso-8859-6",
    "iso-8859-7",
    "iso-8859-8",
    "iso-8859-8-i",
    "iso-8859-10",
    "iso-8859-13",
    "iso-8859-14",
    "iso-8859-15",
    "iso-8859-16",
    "koi8-r",
    "koi8-u",
    "ibm866",
    "macintosh",
    "x-mac-cyrillic",
    "shift_jis",
    "euc-jp",
    "iso-2022-jp",
    "euc-kr",
    "gbk",
    "gb18030",
    "big5",
];

pub struct Decoded {
    pub text: String,
    pub encoding: &'static str,
    pub detected: &'static str,
    pub errors: bool,
}

pub fn canonical(label: &str) -> Option<&'static str> {
    ENCODINGS
        .iter()
        .copied()
        .find(|name| name.eq_ignore_ascii_case(label))
}

pub fn bom(bytes: &[u8]) -> Option<(&'static str, usize)> {
    for (prefix, name) in [
        (&[0xff, 0xfe, 0, 0][..], "utf-32le"),
        (&[0, 0, 0xfe, 0xff][..], "utf-32be"),
        (&[0xef, 0xbb, 0xbf][..], "utf-8"),
        (&[0xff, 0xfe][..], "utf-16le"),
        (&[0xfe, 0xff][..], "utf-16be"),
    ] {
        if bytes.starts_with(prefix) {
            return Some((name, prefix.len()));
        }
    }
    None
}

pub fn detect(bytes: &[u8]) -> &'static str {
    if let Some((name, _)) = bom(bytes) {
        return name;
    }
    if !bytes.contains(&0) && !bytes.contains(&0x1b) && std::str::from_utf8(bytes).is_ok() {
        return "utf-8";
    }
    // NUL distribution recognizes common UTF-16/32 text without a BOM.
    for (width, position, name) in [
        (4, 0, "utf-32le"),
        (4, 3, "utf-32be"),
        (2, 0, "utf-16le"),
        (2, 1, "utf-16be"),
    ] {
        let chunks = bytes.chunks_exact(width);
        if chunks.len() >= 2 && bytes.len() % width == 0 {
            let ascii = chunks
                .clone()
                .filter(|chunk| {
                    chunk[position] != 0
                        && chunk
                            .iter()
                            .enumerate()
                            .all(|(i, b)| i == position || *b == 0)
                })
                .count();
            if ascii * 5 >= chunks.len() * 3 {
                return name;
            }
        }
    }
    // Non-Latin UTF-32 has two zero bytes in each BMP scalar as well.
    for (name, little) in [("utf-32le", true), ("utf-32be", false)] {
        let chunks = bytes.chunks_exact(4);
        if chunks.len() < 2 || !chunks.remainder().is_empty() {
            continue;
        }
        let zero_high = chunks
            .clone()
            .filter(|unit| {
                if little {
                    unit[2] == 0 && unit[3] == 0
                } else {
                    unit[0] == 0 && unit[1] == 0
                }
            })
            .count();
        let readable = chunks.clone().all(|unit| {
            let unit: [u8; 4] = unit.try_into().unwrap();
            char::from_u32(if little {
                u32::from_le_bytes(unit)
            } else {
                u32::from_be_bytes(unit)
            })
            .is_some_and(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
        });
        if readable && zero_high * 5 >= chunks.len() * 3 {
            return name;
        }
    }
    // UTF-16 source files with mostly CJK characters still have encoded line breaks.
    if bytes.len() >= 4 && bytes.len() % 2 == 0 {
        for (name, little) in [("utf-16le", true), ("utf-16be", false)] {
            let whitespace = bytes.chunks_exact(2).any(|unit| {
                let scalar = if little {
                    u16::from_le_bytes([unit[0], unit[1]])
                } else {
                    u16::from_be_bytes([unit[0], unit[1]])
                };
                matches!(scalar, 9 | 10 | 13 | 32)
            });
            if whitespace {
                let codec = Encoding::for_label(name.as_bytes()).unwrap();
                let (text, errors) = codec.decode_without_bom_handling(bytes);
                if !errors
                    && text
                        .chars()
                        .all(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
                {
                    return name;
                }
            }
        }
    }
    if !bytes.contains(&0x1b) && std::str::from_utf8(bytes).is_ok() {
        return "utf-8";
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    canonical(&detector.guess(None, true).name().to_ascii_lowercase()).unwrap_or("windows-1252")
}

pub fn is_binary(bytes: &[u8]) -> bool {
    if !bytes.contains(&0) {
        return false;
    }
    let name = detect(bytes);
    !name.starts_with("utf-16") && !name.starts_with("utf-32")
}

pub fn decode(bytes: &[u8], requested: Option<&str>) -> Result<Decoded, String> {
    let detected = detect(bytes);
    let name = match requested.filter(|name| *name != "auto") {
        Some(name) => canonical(name).ok_or_else(|| name.to_owned())?,
        None => detected,
    };
    // A manual selection must not be silently overridden by another encoding's BOM.
    let bytes = match bom(bytes) {
        Some((bom_name, skip)) if bom_name == name => &bytes[skip..],
        _ => bytes,
    };
    let (text, errors) = match name {
        "iso-8859-1" => (bytes.iter().copied().map(char::from).collect(), false),
        "us-ascii" => (
            bytes
                .iter()
                .map(|b| if *b < 128 { char::from(*b) } else { '\u{fffd}' })
                .collect(),
            bytes.iter().any(|b| *b >= 128),
        ),
        "utf-32le" | "utf-32be" => {
            let mut errors = false;
            let mut text = String::new();
            for chunk in bytes.chunks(4) {
                let character = <[u8; 4]>::try_from(chunk).ok().and_then(|unit| {
                    char::from_u32(if name == "utf-32le" {
                        u32::from_le_bytes(unit)
                    } else {
                        u32::from_be_bytes(unit)
                    })
                });
                errors |= character.is_none();
                text.push(character.unwrap_or('\u{fffd}'));
            }
            (text, errors)
        }
        _ => {
            let decoder = Encoding::for_label(name.as_bytes()).ok_or_else(|| name.to_owned())?;
            let (text, errors) = decoder.decode_without_bom_handling(bytes);
            (text.into_owned(), errors)
        }
    };
    Ok(Decoded {
        text,
        encoding: name,
        detected,
        errors,
    })
}

/// Reject unmappable characters before touching disk; never emit numeric entities.
pub fn encode(text: &str, name: &str, with_bom: bool) -> Result<Vec<u8>, ()> {
    let name = canonical(name).ok_or(())?;
    let mut bytes = match name {
        "utf-16le" | "utf-16be" => text
            .encode_utf16()
            .flat_map(|unit| {
                if name == "utf-16le" {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                }
            })
            .collect(),
        "utf-32le" | "utf-32be" => text
            .chars()
            .flat_map(|character| {
                if name == "utf-32le" {
                    (character as u32).to_le_bytes()
                } else {
                    (character as u32).to_be_bytes()
                }
            })
            .collect(),
        "iso-8859-1" | "us-ascii" => text
            .chars()
            .map(|character| {
                u8::try_from(character as u32)
                    .ok()
                    .filter(|byte| name != "us-ascii" || *byte < 128)
                    .ok_or(())
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            let encoder = Encoding::for_label(name.as_bytes()).ok_or(())?;
            let (bytes, _, errors) = encoder.encode(text);
            if errors {
                return Err(());
            }
            bytes.into_owned()
        }
    };
    if with_bom {
        let prefix: &[u8] = match name {
            "utf-8" => &[0xef, 0xbb, 0xbf],
            "utf-16le" => &[0xff, 0xfe],
            "utf-16be" => &[0xfe, 0xff],
            "utf-32le" => &[0xff, 0xfe, 0, 0],
            "utf-32be" => &[0, 0, 0xfe, 0xff],
            _ => &[],
        };
        bytes.splice(0..0, prefix.iter().copied());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_encodings_decode_and_roundtrip_ascii() {
        for name in ENCODINGS {
            let bytes = encode("GitThul\n", name, false).unwrap();
            let decoded = decode(&bytes, Some(name)).unwrap();
            assert_eq!(decoded.text, "GitThul\n", "{name}");
            assert!(!decoded.errors, "{name}");
        }
    }
    #[test]
    fn unicode_boms_and_legacy_are_detected() {
        for name in ["utf-8", "utf-16le", "utf-16be", "utf-32le", "utf-32be"] {
            let bytes = encode("España 😀\n", name, true).unwrap();
            assert!(!is_binary(&bytes));
            assert_eq!(decode(&bytes, None).unwrap().text, "España 😀\n");
            assert_eq!(detect(&bytes), name);
            assert_eq!(detect(&encode("Hello world\n", name, false).unwrap()), name);
            assert_eq!(
                detect(&encode("日本語の文字\n", name, false).unwrap()),
                name
            );
        }
        for name in ["utf-16le", "utf-16be", "utf-32le", "utf-32be"] {
            let bytes = encode("日本語の文字\n", name, false).unwrap();
            assert_eq!(detect(&bytes), name);
            assert!(!is_binary(&bytes));
        }
        assert_eq!(
            decode(b"precio \x80 y \x93hola\x94", Some("windows-1252"))
                .unwrap()
                .text,
            "precio € y “hola”"
        );
        assert_eq!(decode(b"\x80", Some("iso-8859-1")).unwrap().text, "\u{80}");
        assert!(is_binary(&[0, 1, 2, 0, 3]));
    }
    #[test]
    fn malformed_sequences_are_visible_and_unmappable_output_is_rejected() {
        let decoded = decode(b"caf\xe9\n\xc3(\xff", Some("utf-8")).unwrap();
        assert!(decoded.errors);
        assert_eq!(decoded.text, "caf�\n�(�");
        assert!(decode(&[0x00, 0xd8], Some("utf-16le")).unwrap().errors);
        assert!(decode(&[0xff], Some("utf-32le")).unwrap().errors);
        assert!(encode("😀", "windows-1252", false).is_err());
        assert!(decode(b"x", Some("made-up")).is_err());
    }
}

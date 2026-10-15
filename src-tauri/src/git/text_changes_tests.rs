use std::{fs, path::Path, process::Command};

use serde_json::{json, Value};

use super::{
    diff::{self, DiffRequest, DiffSource},
    encoding,
};

fn git(root: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("LC_ALL", "C")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn read(root: &Path, name: &str, source: DiffSource, ignore_whitespace: bool) -> Value {
    serde_json::to_value(
        diff::read(
            root,
            DiffRequest {
                path: name.to_owned(),
                source,
                context: Some(3),
                ignore_whitespace,
                encoding: None,
            },
        )
        .unwrap(),
    )
    .unwrap()
}

fn reverse(value: &Value) -> Value {
    if let Some(array) = value.as_array() {
        return Value::Array(array.iter().map(reverse).collect());
    }
    if let Some(object) = value.as_object() {
        let mut result = object.clone();
        if let (Some(before), Some(after)) = (object.get("before"), object.get("after")) {
            result.insert("before".to_owned(), after.clone());
            result.insert("after".to_owned(), before.clone());
        }
        return Value::Object(result);
    }
    value.clone()
}

#[test]
fn invisible_changes_keep_their_bytes_and_explanations_in_every_git_source() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    git(root, &["init", "-q"]);
    git(root, &["config", "user.name", "GitThul Tests"]);
    git(root, &["config", "user.email", "tests@example.invalid"]);
    git(root, &["config", "core.autocrlf", "false"]);
    fs::write(root.join(".gitattributes"), "* -text\n").unwrap();
    let cases = vec![
        (
            "trailing.txt",
            b"total = 12\n".to_vec(),
            b"total = 12 \t\n".to_vec(),
            "whitespace",
            json!("trailing"),
        ),
        (
            "indent.txt",
            b"    total = 12\n".to_vec(),
            b"\ttotal = 12\n".to_vec(),
            "whitespace",
            json!("indentation"),
        ),
        (
            "spaces.txt",
            b"total = 12\n".to_vec(),
            b"total  =\t12\n".to_vec(),
            "whitespace",
            json!("spacesAndTabs"),
        ),
        (
            "final.txt",
            b"same\n".to_vec(),
            b"same".to_vec(),
            "finalNewline",
            json!({"before":true,"after":false}),
        ),
        (
            "bom.txt",
            b"same\n".to_vec(),
            b"\xef\xbb\xbfsame\n".to_vec(),
            "bom",
            json!({"before":null,"after":"utf-8"}),
        ),
        (
            "encoding.txt",
            b"same text\n".to_vec(),
            encoding::encode("same text\n", "utf-16le", true).unwrap(),
            "encoding",
            json!({"before":"utf-8","after":"utf-16le"}),
        ),
        (
            "unicode.txt",
            "café\n".as_bytes().to_vec(),
            "cafe\u{301}\n".as_bytes().to_vec(),
            "unicodeNormalization",
            json!({"before":"NFC","after":"NFD"}),
        ),
        (
            "invisible.txt",
            b"same text\n".to_vec(),
            "same\u{200b} text\n".as_bytes().to_vec(),
            "invisibleCharacters",
            json!([{"codePoint":"U+200B","before":0,"after":1}]),
        ),
    ];
    for (name, before, _, _, _) in &cases {
        fs::write(root.join(name), before).unwrap();
    }
    fs::write(root.join("old-name.txt"), "unique rename content\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "base"]);
    let base = String::from_utf8(git(root, &["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();
    for (name, _, after, _, _) in &cases {
        fs::write(root.join(name), after).unwrap();
    }
    let check = |source: DiffSource, reversed: bool| {
        for (name, _, _, field, expected) in &cases {
            let result = read(root, name, source.clone(), false);
            assert_eq!(
                result["content"]["textChanges"][*field],
                if reversed {
                    reverse(expected)
                } else {
                    expected.clone()
                },
                "{name}, {source:?}"
            );
        }
    };
    check(DiffSource::Worktree, false);
    check(DiffSource::WorkingRange { from: base.clone() }, false);
    assert_eq!(
        read(root, "trailing.txt", DiffSource::Worktree, true)["content"]["textChanges"]
            ["whitespace"],
        "trailing"
    );
    git(root, &["add", "."]);
    git(root, &["mv", "old-name.txt", "new-name.txt"]);
    check(DiffSource::Index, false);
    let renamed = read(root, "new-name.txt", DiffSource::Index, false);
    assert_eq!(renamed["previousPath"], "old-name.txt");
    assert_eq!(
        renamed["precondition"]["before"]["oid"],
        renamed["precondition"]["after"]["oid"]
    );
    for (name, _, after, _, _) in &cases {
        assert_eq!(git(root, &["show", &format!(":{name}")]), *after);
        assert_eq!(fs::read(root.join(name)).unwrap(), *after);
    }
    git(root, &["commit", "-qm", "invisible changes"]);
    let head = String::from_utf8(git(root, &["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();
    check(DiffSource::Commit { sha: head.clone() }, false);
    check(
        DiffSource::Range {
            from: Some(base),
            to: head,
        },
        false,
    );
    for (name, before, _, _, _) in &cases {
        fs::write(root.join(name), before).unwrap();
    }
    git(root, &["stash", "push", "-qm", "reverse invisible changes"]);
    let stash = String::from_utf8(git(root, &["rev-parse", "refs/stash"]))
        .unwrap()
        .trim()
        .to_owned();
    check(DiffSource::Stash { sha: stash }, true);
}

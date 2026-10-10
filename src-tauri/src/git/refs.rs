//! Foto de referencias leída desde gitoxide y formatos máquina de Git.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use gix::bstr::ByteSlice;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    name: String,
    email: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    branch: Option<String>,
    sha: String,
    detached: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    id: String,
    name: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote: Option<String>,
    tip: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    upstream: Option<String>,
    ahead: usize,
    behind: usize,
    is_head: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    checked_out_in: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    id: String,
    name: String,
    target: String,
    annotated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tagger: Option<Person>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tagged_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    index: usize,
    sha: String,
    base: String,
    message: String,
    branch: String,
    created_at: i64,
    file_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub(super) path: String,
    pub(super) name: String,
    pub(super) branch: String,
    pub(super) head: String,
    pub(super) is_main: bool,
    pub(super) locked: bool,
    pub(super) missing: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    name: String,
    fetch_url: String,
    push_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefsSnapshot {
    head: Head,
    branches: Vec<Branch>,
    tags: Vec<Tag>,
    stashes: Vec<Stash>,
    worktrees: Vec<Worktree>,
    remotes: Vec<Remote>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadRefsError {
    InvalidEncoding,
    GitFailed,
    MalformedOutput,
}

pub fn read(path: &Path) -> Result<RefsSnapshot, ReadRefsError> {
    let repo = gix::open(path).map_err(|_| ReadRefsError::GitFailed)?;
    let head = read_head(&repo)?;
    let worktrees = read_worktrees(path)?;
    let checked_out = worktrees
        .iter()
        .filter(|worktree| !worktree.is_main && worktree.branch != "HEAD")
        .map(|worktree| {
            (
                format!("refs/heads/{}", worktree.branch),
                worktree.path.clone(),
            )
        })
        .collect::<HashMap<_, _>>();
    let head_name = repo
        .head()
        .ok()
        .and_then(|head| head.referent_name().map(|name| name.as_bstr().to_owned()));

    let mut branches = Vec::new();
    let references = repo.references().map_err(|_| ReadRefsError::GitFailed)?;
    for reference in references
        .local_branches()
        .map_err(|_| ReadRefsError::GitFailed)?
    {
        branches.push(read_branch(
            path,
            &repo,
            reference.map_err(|_| ReadRefsError::GitFailed)?,
            true,
            head_name.as_ref().map(|name| name.as_slice()),
            &checked_out,
        )?);
    }
    let references = repo.references().map_err(|_| ReadRefsError::GitFailed)?;
    for reference in references
        .remote_branches()
        .map_err(|_| ReadRefsError::GitFailed)?
    {
        let reference = reference.map_err(|_| ReadRefsError::GitFailed)?;
        // `refs/remotes/origin/HEAD` es un alias simbólico del remoto, no una
        // rama operable. El panel ya conoce la rama real a la que apunta.
        if reference.try_id().is_none() {
            continue;
        }
        branches.push(read_branch(
            path,
            &repo,
            reference,
            false,
            head_name.as_ref().map(|name| name.as_slice()),
            &checked_out,
        )?);
    }
    branches.sort_by(|left, right| (left.kind, &left.name).cmp(&(right.kind, &right.name)));

    let mut tags = Vec::new();
    let references = repo.references().map_err(|_| ReadRefsError::GitFailed)?;
    for reference in references.tags().map_err(|_| ReadRefsError::GitFailed)? {
        if let Some(tag) = read_tag(&repo, reference.map_err(|_| ReadRefsError::GitFailed)?)? {
            tags.push(tag);
        }
    }
    tags.sort_by(|left, right| left.name.cmp(&right.name));

    Ok(RefsSnapshot {
        head,
        branches,
        tags,
        stashes: read_stashes(path)?,
        worktrees,
        remotes: read_remotes(&repo)?,
    })
}

pub fn names_at(path: &Path, target: gix::ObjectId) -> Result<Vec<String>, ReadRefsError> {
    let repo = gix::open(path).map_err(|_| ReadRefsError::GitFailed)?;
    let mut branches = Vec::new();
    let references = repo.references().map_err(|_| ReadRefsError::GitFailed)?;
    for reference in references
        .local_branches()
        .map_err(|_| ReadRefsError::GitFailed)?
        .chain(
            repo.references()
                .map_err(|_| ReadRefsError::GitFailed)?
                .remote_branches()
                .map_err(|_| ReadRefsError::GitFailed)?,
        )
    {
        let mut reference = reference.map_err(|_| ReadRefsError::GitFailed)?;
        if reference.try_id().is_none() {
            continue;
        }
        let name = utf8(reference.name().shorten())?;
        if reference
            .peel_to_commit()
            .map_err(|_| ReadRefsError::GitFailed)?
            .id()
            == target
        {
            branches.push(name);
        }
    }
    branches.sort();

    let mut tags = Vec::new();
    let references = repo.references().map_err(|_| ReadRefsError::GitFailed)?;
    for reference in references.tags().map_err(|_| ReadRefsError::GitFailed)? {
        let mut reference = reference.map_err(|_| ReadRefsError::GitFailed)?;
        let name = utf8(reference.name().shorten())?;
        // Igual que la foto P3.1: un tag puede señalar un blob o árbol y no
        // pertenece a las etiquetas del grafo de commits.
        if reference
            .peel_to_commit()
            .is_ok_and(|commit| commit.id() == target)
        {
            tags.push(name);
        }
    }
    tags.sort();
    branches.extend(tags);
    Ok(branches)
}

fn read_head(repo: &gix::Repository) -> Result<Head, ReadRefsError> {
    let head = repo.head().map_err(|_| ReadRefsError::GitFailed)?;
    let detached = head.is_detached();
    let branch = head
        .referent_name()
        .map(|name| utf8(name.shorten().as_bstr()))
        .transpose()?;
    let sha = head.id().map(|id| id.to_string()).unwrap_or_default();
    Ok(Head {
        branch,
        sha,
        detached,
    })
}

fn read_branch(
    path: &Path,
    repo: &gix::Repository,
    mut reference: gix::Reference<'_>,
    local: bool,
    head_name: Option<&[u8]>,
    checked_out: &HashMap<String, String>,
) -> Result<Branch, ReadRefsError> {
    let id = utf8(reference.name().as_bstr())?;
    let name = utf8(reference.name().shorten())?;
    let upstream = if local {
        reference
            .remote_tracking_ref_name(gix::remote::Direction::Fetch)
            .transpose()
            .map_err(|_| ReadRefsError::GitFailed)?
            .map(|name| utf8(name.shorten()))
            .transpose()?
    } else {
        None
    };
    let remote = if local {
        None
    } else {
        remote_for(repo, &name)?
    };
    let tip = reference
        .peel_to_commit()
        .map_err(|_| ReadRefsError::GitFailed)?
        .id()
        .to_string();
    let (ahead, behind) = upstream
        .as_deref()
        .map(|upstream| divergence(path, &id, upstream))
        .transpose()?
        .unwrap_or((0, 0));
    Ok(Branch {
        is_head: head_name.is_some_and(|head| head == id.as_bytes()),
        checked_out_in: checked_out.get(&id).cloned(),
        id,
        name,
        kind: if local { "local" } else { "remote" },
        remote,
        tip,
        upstream,
        ahead,
        behind,
    })
}

fn remote_for(repo: &gix::Repository, branch: &str) -> Result<Option<String>, ReadRefsError> {
    let mut names = repo
        .remote_names()
        .into_iter()
        .map(|name| utf8(name.as_bstr()))
        .collect::<Result<Vec<_>, _>>()?;
    names.sort_by_key(|name| std::cmp::Reverse(name.len()));
    Ok(names.into_iter().find(|name| {
        branch
            .strip_prefix(name)
            .is_some_and(|rest| rest.starts_with('/'))
    }))
}

fn read_remotes(repo: &gix::Repository) -> Result<Vec<Remote>, ReadRefsError> {
    let mut remotes = Vec::new();
    for name in repo.remote_names() {
        let remote = repo
            .find_remote(name.as_bstr())
            .map_err(|_| ReadRefsError::GitFailed)?;
        if let Some(fetch) = remote.url(gix::remote::Direction::Fetch) {
            let fetch_url = fetch.to_string();
            let push_url = remote
                .url(gix::remote::Direction::Push)
                .map(ToString::to_string)
                .unwrap_or_else(|| fetch_url.clone());
            remotes.push(Remote {
                name: utf8(name.as_bstr())?,
                fetch_url,
                push_url,
            });
        }
    }
    Ok(remotes)
}

fn divergence(path: &Path, local: &str, upstream: &str) -> Result<(usize, usize), ReadRefsError> {
    let range = format!("{local}...{upstream}");
    let output = git(path, ["rev-list", "--left-right", "--count", &range])?;
    let text = std::str::from_utf8(&output.stdout).map_err(|_| ReadRefsError::MalformedOutput)?;
    let mut counts = text.split_ascii_whitespace();
    let ahead = counts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or(ReadRefsError::MalformedOutput)?;
    let behind = counts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or(ReadRefsError::MalformedOutput)?;
    Ok((ahead, behind))
}

fn read_tag(
    repo: &gix::Repository,
    mut reference: gix::Reference<'_>,
) -> Result<Option<Tag>, ReadRefsError> {
    let id = utf8(reference.name().as_bstr())?;
    let name = utf8(reference.name().shorten())?;
    let object_id = reference.try_id().ok_or(ReadRefsError::MalformedOutput)?;
    let object = repo
        .find_object(object_id)
        .map_err(|_| ReadRefsError::GitFailed)?;
    let annotated = object.kind == gix::object::Kind::Tag;
    let target = reference
        .peel_to_id()
        .map_err(|_| ReadRefsError::GitFailed)?;
    if repo
        .find_object(target)
        .map_err(|_| ReadRefsError::GitFailed)?
        .kind
        != gix::object::Kind::Commit
    {
        return Ok(None);
    }
    let target = target.to_string();
    let (message, tagger, tagged_at) = if annotated {
        let tag = object.into_tag();
        let decoded = tag.decode().map_err(|_| ReadRefsError::MalformedOutput)?;
        let signature = decoded
            .tagger()
            .map_err(|_| ReadRefsError::MalformedOutput)?;
        let tagger = signature
            .map(|signature| {
                Ok(Person {
                    name: utf8(signature.name.trim())?,
                    email: utf8(signature.email.trim())?,
                })
            })
            .transpose()?;
        let tagged_at = signature
            .map(|signature| signature.time())
            .transpose()
            .map_err(|_| ReadRefsError::MalformedOutput)?
            .map(|time| time.seconds.saturating_mul(1000));
        (Some(utf8(decoded.message.trim_end())?), tagger, tagged_at)
    } else {
        (None, None, None)
    };
    Ok(Some(Tag {
        id,
        name,
        target,
        annotated,
        message,
        tagger,
        tagged_at,
    }))
}

fn read_stashes(path: &Path) -> Result<Vec<Stash>, ReadRefsError> {
    let output = git_allow_missing(
        path,
        ["stash", "list", "--format=%gd%x00%H%x00%P%x00%gs%x00%ct"],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| ReadRefsError::InvalidEncoding)?;
    text.lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let fields = line.split('\0').collect::<Vec<_>>();
            if fields.len() != 5 {
                return Err(ReadRefsError::MalformedOutput);
            }
            let index = fields[0]
                .strip_prefix("stash@{")
                .and_then(|value| value.strip_suffix('}'))
                .and_then(|value| value.parse().ok())
                .ok_or(ReadRefsError::MalformedOutput)?;
            let base = fields[2]
                .split_whitespace()
                .next()
                .ok_or(ReadRefsError::MalformedOutput)?
                .to_owned();
            let (branch, message) = stash_subject(fields[3]);
            let created_at = fields[4]
                .parse::<i64>()
                .map_err(|_| ReadRefsError::MalformedOutput)?
                .saturating_mul(1000);
            Ok(Stash {
                index,
                sha: fields[1].to_owned(),
                base,
                message,
                branch,
                created_at,
                file_count: stash_file_count(path, fields[0])?,
            })
        })
        .collect()
}

/**
 * Primer padre de cada entrada del reflog de stash.
 *
 * No basta con `refs/stash`: solo apunta al guardado más reciente. Los anteriores
 * pueden conservar el único camino hacia el commit donde nacieron, y el grafo
 * necesita esos orígenes para no dibujar una derivación sin nodo de llegada.
 */
pub(super) fn stash_bases(path: &Path) -> Result<Vec<String>, ReadRefsError> {
    let output = git_allow_missing(path, ["stash", "list", "--format=%P"])?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| ReadRefsError::InvalidEncoding)?;
    Ok(text
        .lines()
        .filter_map(|parents| parents.split_whitespace().next())
        .map(str::to_owned)
        .collect())
}

fn stash_subject(subject: &str) -> (String, String) {
    for prefix in ["On ", "WIP on "] {
        if let Some(value) = subject.strip_prefix(prefix) {
            if let Some((branch, message)) = value.split_once(": ") {
                return (branch.to_owned(), message.to_owned());
            }
        }
    }
    ("HEAD".to_owned(), subject.to_owned())
}

fn stash_file_count(path: &Path, selector: &str) -> Result<usize, ReadRefsError> {
    let output = git(
        path,
        [
            "stash",
            "show",
            "--name-only",
            "--include-untracked",
            "--format=",
            "-z",
            selector,
        ],
    )?;
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .count())
}

pub(super) fn read_worktrees(path: &Path) -> Result<Vec<Worktree>, ReadRefsError> {
    let output = git(path, ["worktree", "list", "--porcelain", "-z"])?;
    let mut records = Vec::new();
    let mut current = Vec::new();
    for field in output.stdout.split(|byte| *byte == 0) {
        if field.is_empty() {
            if !current.is_empty() {
                records.push(std::mem::take(&mut current));
            }
        } else {
            current.push(field);
        }
    }
    if !current.is_empty() {
        records.push(current);
    }
    records
        .into_iter()
        .enumerate()
        .map(|(index, fields)| parse_worktree(fields, index == 0))
        .collect()
}

fn parse_worktree(fields: Vec<&[u8]>, is_main: bool) -> Result<Worktree, ReadRefsError> {
    let value = |key: &[u8]| {
        fields
            .iter()
            .find_map(|field| field.strip_prefix(key))
            .map(utf8)
            .transpose()
    };
    let path = value(b"worktree ")?.ok_or(ReadRefsError::MalformedOutput)?;
    let branch = value(b"branch ")?
        .and_then(|branch| branch.strip_prefix("refs/heads/").map(ToOwned::to_owned))
        .unwrap_or_else(|| "HEAD".to_owned());
    let head = value(b"HEAD ")?.unwrap_or_default();
    let path_buf = PathBuf::from(&path);
    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ReadRefsError::InvalidEncoding)?
        .to_owned();
    Ok(Worktree {
        missing: fields.iter().any(|field| field.starts_with(b"prunable")) || !path_buf.exists(),
        locked: fields.iter().any(|field| field.starts_with(b"locked")),
        path,
        name,
        branch,
        head,
        is_main,
    })
}

fn utf8(value: &[u8]) -> Result<String, ReadRefsError> {
    value
        .to_str()
        .map(ToOwned::to_owned)
        .map_err(|_| ReadRefsError::InvalidEncoding)
}

fn git<const N: usize>(path: &Path, args: [&str; N]) -> Result<Output, ReadRefsError> {
    let output = git_allow_missing(path, args)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(ReadRefsError::GitFailed)
    }
}

fn git_allow_missing<const N: usize>(
    path: &Path,
    args: [&str; N],
) -> Result<Output, ReadRefsError> {
    Command::new("git")
        .args(args)
        .current_dir(path)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| ReadRefsError::GitFailed)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    #[cfg(all(unix, not(target_os = "macos")))]
    use std::ffi::OsString;
    #[cfg(all(unix, not(target_os = "macos")))]
    use std::os::unix::ffi::OsStringExt;

    use tempfile::TempDir;

    use super::{read, ReadRefsError};

    #[test]
    fn rejects_non_utf8_ref_bytes_on_every_platform() {
        assert!(matches!(
            super::utf8(b"refs/heads/invalid-\xff"),
            Err(ReadRefsError::InvalidEncoding)
        ));
    }

    fn repository() -> TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        git(temporary.path(), &["config", "user.name", "GitThul"]);
        git(
            temporary.path(),
            &["config", "user.email", "gitthul@example.invalid"],
        );
        temporary
    }

    fn git(repository: &Path, args: &[&str]) {
        assert!(Command::new("git")
            .args(args)
            .current_dir(repository)
            .status()
            .unwrap()
            .success());
    }

    fn output(repository: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn commit(repository: &Path, message: &str, contents: &str) -> String {
        fs::write(repository.join("archivo.txt"), contents).unwrap();
        git(repository, &["add", "archivo.txt"]);
        git(repository, &["commit", "--quiet", "-m", message]);
        output(repository, &["rev-parse", "HEAD"])
    }

    #[test]
    fn lee_refs_tags_stash_y_worktrees_con_divergencia_real() {
        let temporary = repository();
        let base = commit(temporary.path(), "base", "base\n");
        git(temporary.path(), &["branch", "dev"]);
        git(
            temporary.path(),
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/repo.git",
            ],
        );
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/main", &base],
        );
        git(
            temporary.path(),
            &["branch", "--set-upstream-to=origin/main", "main"],
        );
        let local = commit(temporary.path(), "local", "local\n");

        git(temporary.path(), &["switch", "--quiet", "--detach", &base]);
        let remote = commit(temporary.path(), "remote", "remote\n");
        git(
            temporary.path(),
            &["update-ref", "refs/remotes/origin/main", &remote],
        );
        git(temporary.path(), &["switch", "--quiet", "main"]);
        git(temporary.path(), &["tag", "ligero"]);
        git(
            temporary.path(),
            &["tag", "-a", "anotado", &base, "-m", "entrega estable"],
        );
        fs::write(temporary.path().join("guardado.txt"), "guardado\n").unwrap();
        git(temporary.path(), &["add", "guardado.txt"]);
        git(
            temporary.path(),
            &["stash", "push", "--quiet", "-m", "antes de probar"],
        );
        let linked_parent = tempfile::tempdir().unwrap();
        let linked = linked_parent.path().join("enlazado");
        git(
            temporary.path(),
            &[
                "worktree",
                "add",
                "--quiet",
                linked.to_str().unwrap(),
                "dev",
            ],
        );

        let snapshot = read(temporary.path()).unwrap();
        assert_eq!(snapshot.head.branch.as_deref(), Some("main"));
        assert_eq!(snapshot.head.sha, local);
        let main = snapshot
            .branches
            .iter()
            .find(|branch| branch.id == "refs/heads/main")
            .unwrap();
        assert!(main.is_head);
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert_eq!((main.ahead, main.behind), (1, 1));
        let remote_branch = snapshot
            .branches
            .iter()
            .find(|branch| branch.id == "refs/remotes/origin/main")
            .unwrap();
        assert_eq!(remote_branch.remote.as_deref(), Some("origin"));
        let dev = snapshot
            .branches
            .iter()
            .find(|branch| branch.id == "refs/heads/dev")
            .unwrap();
        assert_eq!(
            fs::canonicalize(dev.checked_out_in.as_deref().unwrap()).unwrap(),
            fs::canonicalize(&linked).unwrap()
        );

        let annotated = snapshot
            .tags
            .iter()
            .find(|tag| tag.name == "anotado")
            .unwrap();
        assert!(annotated.annotated);
        assert_eq!(annotated.target, base);
        assert_eq!(annotated.message.as_deref(), Some("entrega estable"));
        assert_eq!(annotated.tagger.as_ref().unwrap().name, "GitThul");
        assert!(annotated.tagged_at.is_some());
        assert!(
            !snapshot
                .tags
                .iter()
                .find(|tag| tag.name == "ligero")
                .unwrap()
                .annotated
        );

        assert_eq!(snapshot.stashes.len(), 1);
        assert_eq!(snapshot.stashes[0].base, local);
        assert_eq!(snapshot.stashes[0].branch, "main");
        assert_eq!(snapshot.stashes[0].message, "antes de probar");
        assert_eq!(snapshot.stashes[0].file_count, 1);
        assert_eq!(snapshot.worktrees.len(), 2);
        assert!(snapshot.worktrees[0].is_main);
        assert_eq!(snapshot.remotes.len(), 1);
    }

    #[test]
    fn representa_head_unborn_y_detached_sin_inventar_una_rama() {
        let temporary = repository();
        let unborn = read(temporary.path()).unwrap();
        assert_eq!(unborn.head.branch.as_deref(), Some("main"));
        assert!(unborn.head.sha.is_empty());
        assert!(!unborn.head.detached);

        let sha = commit(temporary.path(), "primero", "uno\n");
        git(temporary.path(), &["switch", "--quiet", "--detach", &sha]);
        let detached = read(temporary.path()).unwrap();
        assert_eq!(detached.head.branch, None);
        assert_eq!(detached.head.sha, sha);
        assert!(detached.head.detached);
    }

    #[test]
    fn lee_refs_empaquetadas_y_un_repositorio_bare() {
        let temporary = repository();
        let sha = commit(temporary.path(), "base", "base\n");
        git(temporary.path(), &["branch", "empaquetada"]);
        git(temporary.path(), &["tag", "v1"]);
        let blob = output(temporary.path(), &["hash-object", "-w", "archivo.txt"]);
        git(temporary.path(), &["tag", "objeto-no-commit", &blob]);
        git(temporary.path(), &["pack-refs", "--all", "--prune"]);
        let packed = read(temporary.path()).unwrap();
        assert!(packed
            .branches
            .iter()
            .any(|branch| branch.name == "empaquetada" && branch.tip == sha));
        assert!(!packed.tags.iter().any(|tag| tag.name == "objeto-no-commit"));

        let parent = tempfile::tempdir().unwrap();
        let bare = parent.path().join("bare.git");
        git(
            parent.path(),
            &[
                "clone",
                "--quiet",
                "--bare",
                temporary.path().to_str().unwrap(),
                bare.to_str().unwrap(),
            ],
        );
        let snapshot = read(&bare).unwrap();
        assert_eq!(snapshot.head.branch.as_deref(), Some("main"));
        assert_eq!(snapshot.head.sha, sha);
        assert!(snapshot.worktrees[0].is_main);
    }

    // APFS/HFS+ reject invalid UTF-8 filenames before Git can create the ref.
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn rechaza_un_nombre_de_ref_no_utf8_sin_reemplazarlo() {
        let temporary = repository();
        let sha = commit(temporary.path(), "base", "base\n");
        let mut reference = b"refs/heads/invalida-".to_vec();
        reference.push(0xff);
        let status = Command::new("git")
            .arg("update-ref")
            .arg(OsString::from_vec(reference))
            .arg(sha)
            .current_dir(temporary.path())
            .status()
            .unwrap();
        assert!(status.success());

        assert!(matches!(
            read(temporary.path()),
            Err(ReadRefsError::InvalidEncoding)
        ));
    }
}

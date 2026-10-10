//! Recorrido estable y paginado del grafo de commits con gitoxide.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use gix::bstr::ByteSlice;
use gix::revision::walk::Sorting;
use serde::{Deserialize, Serialize};

use super::refs;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPageRequest {
    pub search: Option<HistorySearch>,
    pub start: Option<String>,
    pub since: Option<u64>,
    pub skip: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HistorySearch {
    field: String,
    text: String,
    #[serde(default, rename = "scanSkip")]
    scan_skip: Option<usize>,
    #[serde(default, rename = "scanLimit")]
    scan_limit: Option<usize>,
}

fn fold_search(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter_map(|c| match c {
            '\u{0300}'..='\u{036f}' => None,
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => Some('a'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'í' | 'ì' | 'î' | 'ï' => Some('i'),
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => Some('o'),
            'ú' | 'ù' | 'û' | 'ü' => Some('u'),
            'ñ' => Some('n'),
            'ç' => Some('c'),
            'ý' | 'ÿ' => Some('y'),
            other => Some(other),
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    name: String,
    email: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub(super) sha: String,
    pub(super) parents: Vec<String>,
    summary: String,
    body: String,
    author: Person,
    authored_at: i64,
    committer: Person,
    committed_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPage {
    commits: Vec<Commit>,
    total: usize,
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    search_cursor: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadHistoryError {
    Cancelled,
    InvalidEncoding,
    StartNotFound,
    GitFailed,
}

#[derive(Debug)]
struct Node {
    id: gix::ObjectId,
    parents: Vec<gix::ObjectId>,
    committed_at: i64,
}

pub fn read(
    path: &Path,
    request: CommitPageRequest,
    cancelled: &AtomicBool,
) -> Result<CommitPage, ReadHistoryError> {
    let repo = gix::open(path).map_err(|_| ReadHistoryError::GitFailed)?;
    let tips = tips(&repo, path, request.start.as_deref())?;
    if tips.is_empty() {
        return Ok(CommitPage {
            commits: Vec::new(),
            total: 0,
            has_more: false,
            search_cursor: None,
        });
    }

    let mut platform = repo.rev_walk(tips);
    if let Some(since) = request.since {
        let seconds = since.saturating_add(999) / 1_000;
        let seconds = i64::try_from(seconds).map_err(|_| ReadHistoryError::GitFailed)?;
        platform = platform.sorting(Sorting::ByCommitTimeCutoff {
            order: Default::default(),
            seconds,
        });
    } else {
        platform = platform.sorting(Sorting::ByCommitTime(Default::default()));
    }

    // Search streams commit metadata and stops after one page plus a lookahead.
    // It does not build or count the complete graph for every keystroke.
    if let Some(search) = &request.search {
        let needle = fold_search(&search.text);
        let skip = request.skip.unwrap_or(0);
        let limit = request.limit.unwrap_or(20).clamp(1, 100);
        let mut matched = 0usize;
        let mut authors = BTreeSet::new();
        let mut commits = Vec::new();
        let scan_skip = search.scan_skip.unwrap_or(0);
        let scan_limit = search.scan_limit.map(|limit| limit.clamp(1, 2000));
        let mut scanned = 0usize;
        for info in platform.all().map_err(|_| ReadHistoryError::GitFailed)? {
            if cancelled.load(Ordering::Relaxed) {
                return Err(ReadHistoryError::Cancelled);
            }
            let info = info.map_err(|_| ReadHistoryError::GitFailed)?;
            if scanned < scan_skip {
                scanned += 1;
                continue;
            }
            if scan_limit.is_some_and(|limit| scanned - scan_skip >= limit)
                || (scan_limit.is_some() && commits.len() >= limit)
            {
                return Ok(CommitPage {
                    commits,
                    total: matched,
                    has_more: true,
                    search_cursor: Some(scanned),
                });
            }
            scanned += 1;
            let commit = read_commit(&repo, info.id)?;
            let value = match search.field.as_str() {
                "messages" => format!("{}\n{}", commit.summary, commit.body),
                "authors" => format!("{} <{}>", commit.author.name, commit.author.email),
                "shas" => commit.sha.clone(),
                _ => return Err(ReadHistoryError::GitFailed),
            };
            if !fold_search(&value).contains(&needle) {
                continue;
            }
            if search.field == "authors" && !authors.insert(value) {
                continue;
            }
            matched += 1;
            if matched <= skip {
                continue;
            }
            if commits.len() == limit {
                return Ok(CommitPage {
                    commits,
                    total: matched,
                    has_more: true,
                    search_cursor: None,
                });
            }
            commits.push(commit);
        }
        return Ok(CommitPage {
            commits,
            total: matched,
            has_more: false,
            search_cursor: scan_limit.map(|_| scanned),
        });
    }

    let mut nodes = Vec::new();
    let walk = platform.all().map_err(|_| ReadHistoryError::GitFailed)?;
    for (index, info) in walk.enumerate() {
        if index % 128 == 0 && cancelled.load(Ordering::Relaxed) {
            return Err(ReadHistoryError::Cancelled);
        }
        let info = info.map_err(|_| ReadHistoryError::GitFailed)?;
        nodes.push(Node {
            id: info.id,
            parents: info.parent_ids.into_iter().collect(),
            committed_at: info.commit_time.unwrap_or_default(),
        });
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(ReadHistoryError::Cancelled);
    }

    let ordered = topological_order(nodes);
    let total = ordered.len();
    let skip = request.skip.unwrap_or(0).min(total);
    let end = request
        .limit
        .map(|limit| skip.saturating_add(limit).min(total))
        .unwrap_or(total);
    let mut commits = Vec::with_capacity(end - skip);
    for id in &ordered[skip..end] {
        if cancelled.load(Ordering::Relaxed) {
            return Err(ReadHistoryError::Cancelled);
        }
        commits.push(read_commit(&repo, *id)?);
    }

    Ok(CommitPage {
        commits,
        total,
        has_more: end < total,
        search_cursor: None,
    })
}

fn tips(
    repo: &gix::Repository,
    path: &Path,
    start: Option<&str>,
) -> Result<Vec<gix::ObjectId>, ReadHistoryError> {
    if let Some(start) = start {
        return resolve_commit(repo, start).map(|id| vec![id]);
    }

    let references = repo.references().map_err(|_| ReadHistoryError::GitFailed)?;
    let references = references.all().map_err(|_| ReadHistoryError::GitFailed)?;
    let mut result = BTreeSet::new();
    for reference in references {
        let mut reference = reference.map_err(|_| ReadHistoryError::GitFailed)?;
        let name = reference.name().as_bstr();
        if !(name.starts_with(b"refs/heads/")
            || name.starts_with(b"refs/remotes/")
            || name.starts_with(b"refs/tags/"))
        {
            continue;
        }
        if let Ok(commit) = reference.peel_to_commit() {
            result.insert(commit.id);
        }
    }
    if let Ok(head) = resolve_commit(repo, "HEAD") {
        result.insert(head);
    }
    for base in refs::stash_bases(path).map_err(|_| ReadHistoryError::GitFailed)? {
        if let Ok(id) = resolve_commit(repo, &base) {
            result.insert(id);
        }
    }
    Ok(result.into_iter().collect())
}

pub(super) fn resolve_commit(
    repo: &gix::Repository,
    revision: &str,
) -> Result<gix::ObjectId, ReadHistoryError> {
    if let Ok(id) = gix::ObjectId::from_hex(revision.as_bytes()) {
        let object = repo
            .find_object(id)
            .map_err(|_| ReadHistoryError::StartNotFound)?;
        return object
            .peel_to_commit()
            .map(|commit| commit.id)
            .map_err(|_| ReadHistoryError::StartNotFound);
    }
    for name in [
        revision.to_owned(),
        format!("refs/heads/{revision}"),
        format!("refs/tags/{revision}"),
        format!("refs/remotes/{revision}"),
    ] {
        if let Ok(mut reference) = repo.find_reference(&name) {
            return reference
                .peel_to_commit()
                .map(|commit| commit.id)
                .map_err(|_| ReadHistoryError::StartNotFound);
        }
    }
    Err(ReadHistoryError::StartNotFound)
}

fn topological_order(nodes: Vec<Node>) -> Vec<gix::ObjectId> {
    let mut by_id = nodes
        .into_iter()
        .map(|node| (node.id, node))
        .collect::<HashMap<_, _>>();
    let mut children = HashMap::<gix::ObjectId, usize>::new();
    for node in by_id.values() {
        children.entry(node.id).or_default();
        for parent in &node.parents {
            if by_id.contains_key(parent) {
                *children.entry(*parent).or_default() += 1;
            }
        }
    }
    let mut ready = BTreeSet::<(i64, String, gix::ObjectId)>::new();
    for node in by_id.values() {
        if children.get(&node.id).copied().unwrap_or_default() == 0 {
            ready.insert((node.committed_at, node.id.to_string(), node.id));
        }
    }

    let mut ordered = Vec::with_capacity(by_id.len());
    while let Some((_, _, id)) = ready.pop_last() {
        let Some(node) = by_id.remove(&id) else {
            continue;
        };
        ordered.push(id);
        for parent in node.parents {
            let Some(count) = children.get_mut(&parent) else {
                continue;
            };
            *count -= 1;
            if *count == 0 {
                if let Some(parent_node) = by_id.get(&parent) {
                    ready.insert((parent_node.committed_at, parent.to_string(), parent));
                }
            }
        }
    }
    ordered
}

pub(super) fn read_commit(
    repo: &gix::Repository,
    id: gix::ObjectId,
) -> Result<Commit, ReadHistoryError> {
    let object = repo
        .find_commit(id)
        .map_err(|_| ReadHistoryError::GitFailed)?;
    let decoded = object.decode().map_err(|_| ReadHistoryError::GitFailed)?;
    let (summary, body) = split_message(utf8(decoded.message)?);
    let author = decoded.author().map_err(|_| ReadHistoryError::GitFailed)?;
    let committer = decoded
        .committer()
        .map_err(|_| ReadHistoryError::GitFailed)?;

    Ok(Commit {
        sha: id.to_string(),
        parents: decoded.parents().map(|parent| parent.to_string()).collect(),
        summary: summary.to_owned(),
        body: body.to_owned(),
        author: person(author)?,
        authored_at: author
            .time()
            .unwrap_or_default()
            .seconds
            .saturating_mul(1_000),
        committer: person(committer)?,
        committed_at: committer
            .time()
            .unwrap_or_default()
            .seconds
            .saturating_mul(1_000),
    })
}

fn split_message(message: &str) -> (&str, &str) {
    // gitoxide's title is the entire first paragraph and retains a trailing LF
    // when there is no blank-line separator. Our summary is always one line.
    let Some(end) = message.find(['\r', '\n']) else {
        return (message, "");
    };
    let rest = &message[end..];
    let rest = rest.strip_prefix("\r\n").unwrap_or(&rest[1..]);
    // Remove only the optional separator so intentional blank body lines survive.
    let body = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
        .or_else(|| rest.strip_prefix('\r'))
        .unwrap_or(rest)
        .trim_end_matches(['\r', '\n']);
    (&message[..end], body)
}

fn person(signature: gix::actor::SignatureRef<'_>) -> Result<Person, ReadHistoryError> {
    Ok(Person {
        name: utf8(signature.name)?.to_owned(),
        email: utf8(signature.email)?.to_owned(),
    })
}

fn utf8(bytes: &gix::bstr::BStr) -> Result<&str, ReadHistoryError> {
    bytes
        .to_str()
        .map_err(|_| ReadHistoryError::InvalidEncoding)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn git(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Autora")
            .env("GIT_AUTHOR_EMAIL", "autora@example.com")
            .env("GIT_COMMITTER_NAME", "Comitter")
            .env("GIT_COMMITTER_EMAIL", "committer@example.com")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn repository() -> tempfile::TempDir {
        let temporary = tempfile::tempdir().unwrap();
        git(
            temporary.path(),
            &["init", "--quiet", "--initial-branch=main"],
        );
        temporary
    }

    fn commit(path: &Path, message: &str, timestamp: i64) -> String {
        std::fs::write(path.join("archivo.txt"), format!("{message}\n")).unwrap();
        git(path, &["add", "archivo.txt"]);
        let date = format!("@{timestamp} +0000");
        let output = Command::new("git")
            .args(["commit", "--quiet", "-m", message])
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Autora")
            .env("GIT_AUTHOR_EMAIL", "autora@example.com")
            .env("GIT_COMMITTER_NAME", "Comitter")
            .env("GIT_COMMITTER_EMAIL", "committer@example.com")
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        git(path, &["rev-parse", "HEAD"])
    }

    fn commit_file(path: &Path, file: &str, message: &str) -> String {
        std::fs::write(path.join(file), format!("{message}\n")).unwrap();
        git(path, &["add", file]);
        git(path, &["commit", "--quiet", "-m", message]);
        git(path, &["rev-parse", "HEAD"])
    }

    #[test]
    fn search_pages_filter_messages_authors_and_shas_without_counting_the_graph() {
        let temporary = repository();
        let path = temporary.path();
        let first = commit(path, "Corrección primera", 1_700_000_000);
        let second = commit(path, "Corrección segunda", 1_700_000_100);
        let third = commit(path, "otro asunto", 1_700_000_200);
        let cancelled = AtomicBool::new(false);
        let request = |field: &str, text: &str, skip: usize| CommitPageRequest {
            search: Some(HistorySearch {
                field: field.to_owned(),
                text: text.to_owned(),
                scan_skip: None,
                scan_limit: None,
            }),
            skip: Some(skip),
            limit: Some(1),
            ..Default::default()
        };
        let page = read(path, request("messages", "CORRECCION", 0), &cancelled).unwrap();
        assert_eq!(page.commits[0].sha, second);
        assert!(page.has_more);
        let page = read(path, request("messages", "CORRECCION", 1), &cancelled).unwrap();
        assert_eq!(page.commits[0].sha, first);
        assert!(!page.has_more);
        let page = read(path, request("authors", "autora@example", 0), &cancelled).unwrap();
        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].sha, third);
        assert!(!page.has_more); // One author, even though three commits match.
        let page = read(path, request("shas", &first[..10], 0), &cancelled).unwrap();
        assert_eq!(page.commits[0].sha, first);
        assert!(!page.has_more);
        assert_eq!(fold_search("A\u{0301}ÉÑüç"), "aenuc");
        assert_eq!(
            read(
                path,
                request("messages", "correccion", 0),
                &AtomicBool::new(true)
            )
            .unwrap_err(),
            ReadHistoryError::Cancelled
        );
    }

    #[test]
    fn bounded_search_resumes_after_empty_windows_and_result_limits() {
        let temporary = repository();
        let path = temporary.path();
        let first = commit(path, "needle first", 1_700_000_000);
        let second = commit(path, "needle second", 1_700_000_100);
        commit(path, "unrelated", 1_700_000_200);
        let request = |cursor, budget| CommitPageRequest {
            search: Some(HistorySearch {
                field: "messages".to_owned(),
                text: "needle".to_owned(),
                scan_skip: Some(cursor),
                scan_limit: Some(budget),
            }),
            limit: Some(1),
            ..Default::default()
        };
        let cancelled = AtomicBool::new(false);
        let empty = read(path, request(0, 1), &cancelled).unwrap();
        assert!(empty.commits.is_empty());
        assert!(empty.has_more);
        assert_eq!(empty.search_cursor, Some(1));
        let page = read(path, request(empty.search_cursor.unwrap(), 10), &cancelled).unwrap();
        assert_eq!(page.commits[0].sha, second);
        assert!(page.has_more);
        assert_eq!(page.search_cursor, Some(2));
        let last = read(path, request(page.search_cursor.unwrap(), 10), &cancelled).unwrap();
        assert_eq!(last.commits[0].sha, first);
        assert!(!last.has_more);
        assert_eq!(last.search_cursor, Some(3));
    }

    #[test]
    fn pagina_sin_repetir_y_mantiene_hijos_antes_que_padres() {
        let temporary = repository();
        let first = commit(temporary.path(), "primero", 1_700_000_000);
        let second = commit(temporary.path(), "segundo", 1_700_000_000);
        git(temporary.path(), &["branch", "antigua", &first]);
        let third = commit(temporary.path(), "tercero", 1_699_999_000);
        let cancelled = AtomicBool::new(false);

        let first_page = read(
            temporary.path(),
            CommitPageRequest {
                limit: Some(2),
                ..Default::default()
            },
            &cancelled,
        )
        .unwrap();
        let second_page = read(
            temporary.path(),
            CommitPageRequest {
                skip: Some(2),
                limit: Some(2),
                ..Default::default()
            },
            &cancelled,
        )
        .unwrap();

        assert_eq!(first_page.total, 3);
        assert!(first_page.has_more);
        assert_eq!(
            first_page
                .commits
                .iter()
                .map(|commit| &commit.sha)
                .collect::<Vec<_>>(),
            vec![&third, &second]
        );
        assert_eq!(second_page.commits[0].sha, first);
        assert!(!second_page.has_more);
    }

    #[test]
    fn respeta_start_since_y_conserva_mensaje_y_firmas() {
        let temporary = repository();
        let first = commit(temporary.path(), "primero", 1_700_000_000);
        git(temporary.path(), &["branch", "lateral"]);
        let second = commit(temporary.path(), "resumen\n\ncuerpo", 1_700_000_100);
        let cancelled = AtomicBool::new(false);

        let page = read(
            temporary.path(),
            CommitPageRequest {
                start: Some("lateral".into()),
                since: Some(1_700_000_050_000),
                ..Default::default()
            },
            &cancelled,
        )
        .unwrap();
        assert_eq!(page.total, 0);

        let page = read(
            temporary.path(),
            CommitPageRequest {
                start: Some(second),
                ..Default::default()
            },
            &cancelled,
        )
        .unwrap();
        assert_eq!(page.commits[0].summary, "resumen");
        assert_eq!(page.commits[0].body, "cuerpo");
        assert_eq!(page.commits[0].author.name, "Autora");
        assert_eq!(page.commits[0].committer.email, "committer@example.com");
        assert_eq!(page.commits[1].sha, first);
    }

    #[test]
    fn el_resumen_de_un_commit_normal_no_incluye_el_salto_final_de_git() {
        let temporary = repository();
        commit(temporary.path(), "resumen para amend", 1_700_000_000);

        let page = read(
            temporary.path(),
            CommitPageRequest::default(),
            &AtomicBool::new(false),
        )
        .unwrap();

        assert_eq!(page.commits[0].summary, "resumen para amend");
        assert_eq!(page.commits[0].body, "");
    }

    #[test]
    fn separa_la_primera_linea_y_conserva_el_resto_del_mensaje() {
        let temporary = repository();
        let path = temporary.path();
        let tree = git(path, &["write-tree"]);
        let cases = [
            ("resumen", ""),
            ("resumen\n", ""),
            ("resumen\r\n", ""),
            ("resumen\n\n", ""),
            ("resumen\n\ncuerpo\n", "cuerpo"),
            (
                "resumen\nsegunda línea\ntercera línea\n",
                "segunda línea\ntercera línea",
            ),
            (
                "resumen\r\nsegunda línea\r\ntercera línea\r\n",
                "segunda línea\r\ntercera línea",
            ),
            ("resumen\r\n\r\ncuerpo\r\n", "cuerpo"),
            ("resumen\n\n\ncuerpo\n", "\ncuerpo"),
            ("resumen\rcuerpo\r", "cuerpo"),
        ];

        for (message, expected_body) in cases {
            let input = format!(
                "tree {tree}\nauthor Autora <autora@example.com> 1700000000 +0000\ncommitter Comitter <committer@example.com> 1700000000 +0000\n\n{message}"
            );
            let mut child = Command::new("git")
                .args(["hash-object", "-t", "commit", "-w", "--stdin"])
                .current_dir(path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.as_bytes())
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            let sha = String::from_utf8(output.stdout).unwrap();
            git(path, &["update-ref", "refs/heads/main", sha.trim()]);

            let page = read(path, CommitPageRequest::default(), &AtomicBool::new(false)).unwrap();

            assert_eq!(page.commits[0].summary, "resumen", "{message:?}");
            assert_eq!(page.commits[0].body, expected_body, "{message:?}");
        }
    }

    #[test]
    fn distingue_inicio_inexistente_y_cancelacion() {
        let temporary = repository();
        commit(temporary.path(), "primero", 1_700_000_000);
        assert_eq!(
            read(
                temporary.path(),
                CommitPageRequest {
                    start: Some("no-existe".into()),
                    ..Default::default()
                },
                &AtomicBool::new(false),
            )
            .unwrap_err(),
            ReadHistoryError::StartNotFound
        );
        assert_eq!(
            read(
                temporary.path(),
                CommitPageRequest::default(),
                &AtomicBool::new(true),
            )
            .unwrap_err(),
            ReadHistoryError::Cancelled
        );
    }

    #[test]
    fn conserva_un_head_desacoplado_aunque_no_haya_otra_referencia() {
        let temporary = repository();
        let head = commit(temporary.path(), "suelto", 1_700_000_000);
        git(temporary.path(), &["switch", "--detach", "--quiet", &head]);
        git(temporary.path(), &["update-ref", "-d", "refs/heads/main"]);

        let page = read(
            temporary.path(),
            CommitPageRequest::default(),
            &AtomicBool::new(false),
        )
        .unwrap();

        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].sha, head);
    }

    #[test]
    fn coincide_con_rev_list_en_un_merge_y_un_repositorio_unborn() {
        let unborn = repository();
        let empty = read(
            unborn.path(),
            CommitPageRequest::default(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(empty.total, 0);

        let temporary = repository();
        commit_file(temporary.path(), "base.txt", "base");
        git(temporary.path(), &["switch", "--quiet", "-c", "lateral"]);
        let side = commit_file(temporary.path(), "lado.txt", "lado");
        git(temporary.path(), &["switch", "--quiet", "main"]);
        let main = commit_file(temporary.path(), "main.txt", "principal");
        git(
            temporary.path(),
            &["merge", "--quiet", "--no-ff", "lateral", "-m", "fusion"],
        );

        let page = read(
            temporary.path(),
            CommitPageRequest::default(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let expected = git(
            temporary.path(),
            &["rev-list", "--branches", "--remotes", "--tags"],
        )
        .lines()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
        let actual = page
            .commits
            .iter()
            .map(|commit| commit.sha.clone())
            .collect::<BTreeSet<_>>();
        assert_eq!(actual, expected);
        let positions = page
            .commits
            .iter()
            .enumerate()
            .map(|(index, commit)| (commit.sha.as_str(), index))
            .collect::<HashMap<_, _>>();
        for commit in &page.commits {
            for parent in &commit.parents {
                assert!(positions[commit.sha.as_str()] < positions[parent.as_str()]);
            }
        }
        assert!(page.commits[0].parents.contains(&main));
        assert!(page.commits[0].parents.contains(&side));
    }

    #[test]
    fn no_mezcla_los_commits_internos_de_un_stash_en_el_historial() {
        let temporary = repository();
        let path = temporary.path();
        let base = commit_file(path, "seguido.txt", "base");
        std::fs::write(path.join("seguido.txt"), "cambio\n").unwrap();
        std::fs::write(path.join("nuevo.txt"), "nuevo\n").unwrap();
        git(
            path,
            &["stash", "push", "--include-untracked", "-m", "guardado"],
        );

        let stash = git(path, &["rev-parse", "refs/stash"]);
        let parents = git(path, &["show", "-s", "--format=%P", &stash]);
        let page = read(path, CommitPageRequest::default(), &AtomicBool::new(false)).unwrap();
        let actual = page
            .commits
            .iter()
            .map(|commit| commit.sha.as_str())
            .collect::<BTreeSet<_>>();

        assert_eq!(actual, BTreeSet::from([base.as_str()]));
        assert!(!actual.contains(stash.as_str()));
        for parent in parents.split_whitespace().skip(1) {
            assert!(!actual.contains(parent));
        }
    }

    #[test]
    fn conserva_el_origen_de_un_stash_de_una_rama_ya_borrada() {
        let temporary = repository();
        let path = temporary.path();
        commit_file(path, "raiz.txt", "raíz");
        git(path, &["checkout", "-q", "-b", "temporal"]);
        let base = commit_file(path, "lateral.txt", "lateral");
        std::fs::write(path.join("lateral.txt"), "guardado\n").unwrap();
        git(path, &["stash", "push", "-m", "huérfano"]);
        git(path, &["checkout", "-q", "main"]);
        git(path, &["branch", "-D", "temporal"]);

        let page = read(path, CommitPageRequest::default(), &AtomicBool::new(false)).unwrap();

        assert!(page.commits.iter().any(|commit| commit.sha == base));
    }

    #[cfg(unix)]
    #[test]
    fn rechaza_un_mensaje_no_utf8_sin_reemplazar_bytes() {
        let temporary = repository();
        std::fs::write(temporary.path().join("archivo.txt"), "contenido\n").unwrap();
        git(temporary.path(), &["add", "archivo.txt"]);
        let tree = git(temporary.path(), &["write-tree"]);
        let mut input = format!(
            "tree {tree}\nauthor Autora <autora@example.com> 1700000000 +0000\ncommitter Comitter <committer@example.com> 1700000000 +0000\n\ninvalido-"
        )
        .into_bytes();
        input.extend_from_slice(&[0xff, b'\n']);
        let mut child = Command::new("git")
            .args(["hash-object", "-t", "commit", "-w", "--stdin"])
            .current_dir(temporary.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&input).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let sha = String::from_utf8(output.stdout).unwrap();
        git(
            temporary.path(),
            &["update-ref", "refs/heads/main", sha.trim()],
        );

        assert_eq!(
            read(
                temporary.path(),
                CommitPageRequest::default(),
                &AtomicBool::new(false),
            )
            .unwrap_err(),
            ReadHistoryError::InvalidEncoding
        );
    }

    #[test]
    fn ordena_cien_mil_nodos_sin_cargar_objetos_git() {
        let nodes = (0..100_000_u64)
            .map(|index| {
                let id = gix::ObjectId::from_hex(format!("{index:040x}").as_bytes()).unwrap();
                let parents = (index > 0)
                    .then(|| {
                        gix::ObjectId::from_hex(format!("{:040x}", index - 1).as_bytes()).unwrap()
                    })
                    .into_iter()
                    .collect();
                Node {
                    id,
                    parents,
                    committed_at: index as i64,
                }
            })
            .collect();
        let ordered = topological_order(nodes);
        assert_eq!(ordered.len(), 100_000);
        assert_eq!(ordered[0].to_string(), format!("{:040x}", 99_999));
        assert_eq!(ordered[99_999].to_string(), format!("{:040x}", 0));
    }
}

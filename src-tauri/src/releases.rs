//! Consulta pública de versiones estables. No descarga ni instala paquetes.

use std::time::{Duration, Instant};

use semver::Version;
use serde::{Deserialize, Serialize};

const RELEASES_API: &str = "https://api.github.com/repos/wormius/gitthul/releases";
const RELEASE_PREFIX: &str = "https://github.com/wormius/gitthul/releases/tag/";
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 10;
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ReleaseCheck {
    Available { version: String, url: String },
    Current,
    Empty,
}

fn select_release(releases: &[GithubRelease], current: &Version) -> ReleaseCheck {
    let latest = releases
        .iter()
        .filter(|release| {
            !release.draft
                && !release.prerelease
                && release
                    .published_at
                    .as_ref()
                    .is_some_and(|date| !date.trim().is_empty())
        })
        .filter_map(|release| {
            let version = Version::parse(
                release
                    .tag_name
                    .strip_prefix('v')
                    .unwrap_or(&release.tag_name),
            )
            .ok()?;
            if !version.pre.is_empty() {
                return None;
            }
            // El enlace debe corresponder exactamente al tag en el repositorio oficial.
            let expected = format!("{RELEASE_PREFIX}{}", release.tag_name);
            if release.html_url != expected {
                return None;
            }
            Some((version, release))
        })
        .max_by(|(a, _), (b, _)| a.cmp_precedence(b));

    match latest {
        Some((version, release)) if version.cmp_precedence(current).is_gt() => {
            ReleaseCheck::Available {
                version: version.to_string(),
                url: release.html_url.clone(),
            }
        }
        Some(_) => ReleaseCheck::Current,
        None => ReleaseCheck::Empty,
    }
}

fn release_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("GitThul/", env!("CARGO_PKG_VERSION")))
        .timeout(CHECK_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())
}

async fn check_releases(
    client: &reqwest::Client,
    endpoint: &str,
    current: &Version,
) -> Result<ReleaseCheck, String> {
    let deadline = Instant::now() + CHECK_TIMEOUT;
    let mut releases = Vec::new();
    for page in 1..=MAX_PAGES {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or("se agotó el tiempo de consulta de versiones")?;
        let mut response = client
            .get(format!("{endpoint}?per_page={PAGE_SIZE}&page={page}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(remaining)
            .send()
            .await
            .map_err(|error| format!("no se pudo consultar GitHub: {error}"))?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(format!("GitHub respondió HTTP {}", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_PAGE_BYTES as u64)
        {
            return Err("respuesta de versiones demasiado grande".into());
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            if body.len() + chunk.len() > MAX_PAGE_BYTES {
                return Err("respuesta de versiones demasiado grande".into());
            }
            body.extend_from_slice(&chunk);
        }
        let entries: Vec<GithubRelease> = serde_json::from_slice(&body)
            .map_err(|error| format!("respuesta de versiones no válida: {error}"))?;
        if entries.len() > PAGE_SIZE {
            return Err("respuesta de versiones supera el tamaño de página".into());
        }
        let complete = entries.len() < PAGE_SIZE;
        releases.extend(entries);
        if complete {
            return Ok(select_release(&releases, current));
        }
    }
    // Una lista truncada no permite afirmar que la versión instalada es la más reciente.
    Err("no se pudo completar la consulta de todas las versiones".into())
}

#[tauri::command]
pub async fn releases_check() -> Result<ReleaseCheck, String> {
    let client = release_client()?;
    let current = Version::parse(env!("CARGO_PKG_VERSION")).map_err(|error| error.to_string())?;
    check_releases(&client, RELEASES_API, &current).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };
    use std::thread;

    fn release(tag: &str) -> GithubRelease {
        GithubRelease {
            tag_name: tag.into(),
            html_url: format!("{RELEASE_PREFIX}{tag}"),
            draft: false,
            prerelease: false,
            published_at: Some("2026-10-10T00:00:00Z".into()),
        }
    }

    fn current() -> Version {
        Version::parse("1.0.0").unwrap()
    }

    #[test]
    fn selects_stable_semver_instead_of_api_order_or_lexical_order() {
        let mut flagged = release("v9.0.0");
        flagged.prerelease = true;
        let entries = vec![
            release("v8.0.0-beta.10"),
            release("v1.0.9"),
            release("1.0.10"),
            flagged,
            release("v1.0.8"),
        ];
        assert_eq!(
            select_release(&entries, &current()),
            ReleaseCheck::Available {
                version: "1.0.10".into(),
                url: format!("{RELEASE_PREFIX}1.0.10")
            }
        );
    }

    #[test]
    fn excludes_drafts_unpublished_invalid_tags_and_all_prereleases() {
        let mut draft = release("v9.0.0");
        draft.draft = true;
        let mut unpublished = release("v7.0.0");
        unpublished.published_at = None;
        let mut missing_date = release("v6.0.0");
        missing_date.published_at = Some(" ".into());
        let mut flagged = release("v5.0.0");
        flagged.prerelease = true;
        assert_eq!(
            select_release(
                &[
                    draft,
                    unpublished,
                    missing_date,
                    flagged,
                    release("garbage"),
                    release("v1.2"),
                    release("v2.0.0-beta.1"),
                    release("v3.0.0-rc.1"),
                ],
                &current()
            ),
            ReleaseCheck::Empty
        );
        assert_eq!(select_release(&[], &current()), ReleaseCheck::Empty);
    }

    #[test]
    fn accepts_only_the_exact_official_release_url() {
        for url in [
            "https://example.com/v2.0.0",
            "https://github.com/other/gitthul/releases/tag/v2.0.0",
            "https://github.com/wormius/gitthul/releases/tag/v2.0.0?redirect=evil",
            "https://github.com/wormius/gitthul/releases/tag/v2.0.0/extra",
            "https://github.com.evil.test/wormius/gitthul/releases/tag/v2.0.0",
            "http://github.com/wormius/gitthul/releases/tag/v2.0.0",
            "https://user@github.com/wormius/gitthul/releases/tag/v2.0.0",
        ] {
            let mut untrusted = release("v2.0.0");
            untrusted.html_url = url.into();
            assert_eq!(
                select_release(&[untrusted], &current()),
                ReleaseCheck::Empty
            );
        }
    }

    #[test]
    fn equal_older_and_build_metadata_do_not_notify() {
        for tag in ["v0.9.0", "v1.0.0", "v1.0.0+rebuild.3"] {
            assert_eq!(
                select_release(&[release(tag)], &current()),
                ReleaseCheck::Current
            );
        }
        assert!(matches!(
            select_release(&[release("v1.0.1+build.1")], &current()),
            ReleaseCheck::Available { .. }
        ));
    }

    #[test]
    fn serializes_the_ipc_contract() {
        assert_eq!(
            serde_json::to_value(ReleaseCheck::Current).unwrap(),
            serde_json::json!({"status":"current"})
        );
        assert_eq!(
            serde_json::to_value(ReleaseCheck::Empty).unwrap(),
            serde_json::json!({"status":"empty"})
        );
        assert_eq!(
            serde_json::to_value(ReleaseCheck::Available {
                version: "1.1.0".into(),
                url: format!("{RELEASE_PREFIX}v1.1.0")
            })
            .unwrap(),
            serde_json::json!({"status":"available","version":"1.1.0","url":format!("{RELEASE_PREFIX}v1.1.0")})
        );
    }

    // Servidor local para probar el transporte real sin consultar ni modificar GitHub.
    struct Server {
        endpoint: String,
        requests: Arc<Mutex<Vec<String>>>,
        stopped: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl Server {
        fn new(responses: Vec<String>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let endpoint = format!("http://{}/releases", listener.local_addr().unwrap());
            let stopped = Arc::new(AtomicBool::new(false));
            let requests = Arc::new(Mutex::new(Vec::new()));
            let stop = stopped.clone();
            let captured = requests.clone();
            let worker = thread::spawn(move || {
                for response in responses {
                    let mut stream = loop {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        match listener.accept() {
                            Ok((stream, _)) => break stream,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(5));
                            }
                            Err(error) => panic!("accept: {error}"),
                        }
                    };
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    stream
                        .set_write_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut request = Vec::new();
                    let mut buffer = [0; 1024];
                    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                        let count = stream.read(&mut buffer).unwrap();
                        if count == 0 {
                            break;
                        }
                        request.extend_from_slice(&buffer[..count]);
                    }
                    captured
                        .lock()
                        .unwrap()
                        .push(String::from_utf8(request).unwrap());
                    // El cliente puede cerrar la conexión al rechazar una respuesta grande.
                    let _ = stream.write_all(response.as_bytes());
                }
            });
            Self {
                endpoint,
                requests,
                stopped,
                worker: Some(worker),
            }
        }

        fn check(&self) -> Result<ReleaseCheck, String> {
            let client = reqwest::Client::builder()
                .no_proxy()
                .user_agent(concat!("GitThul/", env!("CARGO_PKG_VERSION")))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            tauri::async_runtime::block_on(check_releases(&client, &self.endpoint, &current()))
        }
    }

    impl Drop for Server {
        fn drop(&mut self) {
            self.stopped.store(true, Ordering::Relaxed);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn http(status: u16, body: &str) -> String {
        format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn page(tags: &[&str]) -> String {
        let entries: Vec<_> = tags
            .iter()
            .map(|tag| {
                serde_json::json!({
                    "tag_name":tag,"html_url":format!("{RELEASE_PREFIX}{tag}"),
                    "draft":false,"prerelease":false,"published_at":"2026-10-10T00:00:00Z"
                })
            })
            .collect();
        serde_json::to_string(&entries).unwrap()
    }

    #[test]
    fn follows_pagination_and_compares_all_pages() {
        let server = Server::new(vec![
            http(200, &page(&vec!["v1.0.1"; PAGE_SIZE])),
            http(200, &page(&["v1.2.0", "v1.1.0"])),
        ]);
        assert_eq!(
            server.check().unwrap(),
            ReleaseCheck::Available {
                version: "1.2.0".into(),
                url: format!("{RELEASE_PREFIX}v1.2.0")
            }
        );
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        for (index, request) in requests.iter().enumerate() {
            assert!(request.starts_with(&format!("GET /releases?per_page=100&page={} ", index + 1)));
            let lower = request.to_ascii_lowercase();
            assert!(lower.contains("accept: application/vnd.github+json"));
            assert!(lower.contains("x-github-api-version: 2022-11-28"));
            assert!(lower.contains(&format!(
                "user-agent: gitthul/{}",
                env!("CARGO_PKG_VERSION")
            )));
            assert!(!lower.contains("authorization:"));
        }
    }

    #[test]
    fn empty_http_list_is_not_current() {
        let server = Server::new(vec![http(200, "[]")]);
        assert_eq!(server.check().unwrap(), ReleaseCheck::Empty);
    }

    #[test]
    fn http_failures_and_redirects_are_retryable_errors() {
        for status in [301, 403, 404, 429, 500] {
            let server = Server::new(vec![format!("HTTP/1.1 {status} Test\r\nLocation: https://example.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")]);
            assert!(server
                .check()
                .unwrap_err()
                .contains(&format!("HTTP {status}")));
            assert_eq!(server.requests.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn rejects_malformed_or_incomplete_json() {
        for body in ["not json", "{}", "[{}]", "[{\"tag_name\":\"v1.0.1\"}]"] {
            let server = Server::new(vec![http(200, body)]);
            assert!(server.check().unwrap_err().contains("no válida"));
        }
    }

    #[test]
    fn rejects_oversized_fixed_and_chunked_bodies() {
        let body = " ".repeat(MAX_PAGE_BYTES + 1);
        let server = Server::new(vec![http(200, &body)]);
        assert!(server.check().unwrap_err().contains("demasiado grande"));
        let server = Server::new(vec![format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n",body.len())]);
        assert!(server.check().unwrap_err().contains("demasiado grande"));
    }

    #[test]
    fn page_limit_never_reports_a_truncated_list_as_current() {
        let response = http(200, &page(&vec!["v1.0.0"; PAGE_SIZE]));
        let server = Server::new(vec![response; MAX_PAGES]);
        assert!(server.check().unwrap_err().contains("todas las versiones"));
        assert_eq!(server.requests.lock().unwrap().len(), MAX_PAGES);
        let server = Server::new(vec![http(200, &page(&vec!["v1.0.0"; PAGE_SIZE + 1]))]);
        assert!(server.check().unwrap_err().contains("tamaño de página"));
    }

    #[test]
    #[ignore = "consulta HTTPS real; ejecutar explícitamente con acceso a la red"]
    fn live_public_release_check() {
        let result = tauri::async_runtime::block_on(releases_check()).unwrap();
        println!("Consulta pública: {result:?}");
        assert!(matches!(
            result,
            ReleaseCheck::Current | ReleaseCheck::Available { .. }
        ));
    }
}

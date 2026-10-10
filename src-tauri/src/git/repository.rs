use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub head: String,
    pub last_opened_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_of: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    name: String,
    fetch_url: String,
    push_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepoOperation {
    None,
    Merge {
        source: String,
        target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sha: Option<String>,
    },
    Rebase {
        source: String,
        target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sha: Option<String>,
    },
    CherryPick {
        source: String,
        target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sha: Option<String>,
    },
    Revert {
        source: String,
        target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sha: Option<String>,
    },
    Bisect,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub path: String,
    pub head: String,
    pub last_opened_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_of: Option<String>,
    remotes: Vec<Remote>,
    operation: RepoOperation,
    bare: bool,
    has_submodules: bool,
}

impl Repository {
    pub fn summary(&self) -> RepoSummary {
        RepoSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            path: self.path.clone(),
            head: self.head.clone(),
            last_opened_at: self.last_opened_at,
            worktree_of: self.worktree_of.clone(),
        }
    }

    pub(super) fn operation(&self) -> &RepoOperation {
        &self.operation
    }
}

pub fn discover(path: impl AsRef<Path>) -> Result<Repository, ()> {
    let selected = fs::canonicalize(path).map_err(|_| ())?;
    let repo = gix::discover(&selected).map_err(|_| ())?;
    let root = canonical_root(&repo)?;
    let head = head_name(&repo);
    let worktree_of = linked_worktree_parent(&repo);
    let remotes = remotes(&repo);
    let operation = operation(&repo, &head);
    let bare = repo.workdir().is_none();
    let has_submodules = repo
        .workdir()
        .is_some_and(|workdir| workdir.join(".gitmodules").is_file());
    let path = path_string(&root);

    Ok(Repository {
        id: path.clone(),
        name: repository_name(&root, bare),
        path,
        head,
        last_opened_at: None,
        worktree_of,
        remotes,
        operation,
        bare,
        has_submodules,
    })
}

/// Etiquetas de las etapas 2 y 3 del índice durante una operación.
pub(super) fn conflict_labels(path: &Path) -> Option<(String, String)> {
    let repository = discover(path).ok()?;
    match repository.operation {
        RepoOperation::Merge { source, target, .. }
        | RepoOperation::Rebase { source, target, .. }
        | RepoOperation::CherryPick { source, target, .. }
        | RepoOperation::Revert { source, target, .. } => Some((target, source)),
        RepoOperation::None | RepoOperation::Bisect => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum CreateError {
    InvalidDestination,
    DestinationExists(PathBuf),
    InvalidBranch,
    GitFailed,
}

pub fn create(
    parent: impl AsRef<Path>,
    name: &str,
    initial_branch: &str,
) -> Result<Repository, CreateError> {
    let parent = fs::canonicalize(parent).map_err(|_| CreateError::InvalidDestination)?;
    if !parent.is_dir() || !is_single_component(name) {
        return Err(CreateError::InvalidDestination);
    }
    let target = parent.join(name);
    if target.exists() {
        return Err(CreateError::DestinationExists(target));
    }
    if !git_succeeds(&parent, ["check-ref-format", "--branch", initial_branch]) {
        return Err(CreateError::InvalidBranch);
    }

    let output = Command::new("git")
        .arg("init")
        .arg("--initial-branch")
        .arg(initial_branch)
        .arg("--")
        // The checked parent is already the working directory. A relative
        // destination also avoids verbatim Windows paths in Git's arguments.
        .arg(name)
        .current_dir(&parent)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .map_err(|_| CreateError::GitFailed)?;

    if !output.status.success() {
        if target.exists() {
            let _ = fs::remove_dir_all(&target);
        }
        return Err(CreateError::GitFailed);
    }

    discover(&target).map_err(|_| {
        let _ = fs::remove_dir_all(&target);
        CreateError::GitFailed
    })
}

pub fn is_single_component(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none()
}

fn git_succeeds<'a>(directory: &Path, args: impl IntoIterator<Item = &'a str>) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(directory)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn canonical_root(repo: &gix::Repository) -> Result<PathBuf, ()> {
    let root = repo.workdir().unwrap_or_else(|| repo.git_dir());
    fs::canonicalize(root).map_err(|_| ())
}

fn repository_name(root: &Path, bare: bool) -> String {
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_string(root));
    if bare {
        name.strip_suffix(".git").unwrap_or(&name).to_owned()
    } else {
        name
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn head_name(repo: &gix::Repository) -> String {
    if let Ok(Some(name)) = repo.head_name() {
        return name.shorten().to_str_lossy().into_owned();
    }
    repo.head_id()
        .map(|id| short_sha(&id.to_string()))
        .unwrap_or_else(|_| "HEAD".to_owned())
}

fn linked_worktree_parent(repo: &gix::Repository) -> Option<String> {
    if repo.kind() != gix::repository::Kind::LinkedWorkTree {
        return None;
    }
    let common = fs::canonicalize(repo.common_dir()).ok()?;
    let root = if common.file_name().is_some_and(|name| name == ".git") {
        common.parent()?.to_path_buf()
    } else {
        common
    };
    Some(path_string(&root))
}

fn remotes(repo: &gix::Repository) -> Vec<Remote> {
    repo.remote_names()
        .into_iter()
        .filter_map(|name| {
            let remote = repo.find_remote(name.as_bstr()).ok()?;
            let fetch_url = remote.url(gix::remote::Direction::Fetch)?.to_string();
            let push_url = remote
                .url(gix::remote::Direction::Push)
                .map(ToString::to_string)
                .unwrap_or_else(|| fetch_url.clone());
            Some(Remote {
                name: name.to_str_lossy().into_owned(),
                fetch_url,
                push_url,
            })
        })
        .collect()
}

fn operation(repo: &gix::Repository, target: &str) -> RepoOperation {
    use gix::state::InProgress;

    let Some(state) = repo.state() else {
        return RepoOperation::None;
    };
    let git_dir = repo.git_dir();
    match state {
        InProgress::Bisect => RepoOperation::Bisect,
        InProgress::Merge => operation_with_sha("merge", git_dir.join("MERGE_HEAD"), target),
        InProgress::CherryPick | InProgress::CherryPickSequence => {
            operation_with_sha("cherryPick", git_dir.join("CHERRY_PICK_HEAD"), target)
        }
        InProgress::Revert | InProgress::RevertSequence => {
            operation_with_sha("revert", git_dir.join("REVERT_HEAD"), target)
        }
        InProgress::ApplyMailbox
        | InProgress::ApplyMailboxRebase
        | InProgress::Rebase
        | InProgress::RebaseInteractive => {
            let source = read_first(git_dir.join("rebase-merge/head-name"))
                .or_else(|| read_first(git_dir.join("rebase-apply/head-name")))
                .map(short_ref)
                .unwrap_or_else(|| "HEAD".to_owned());
            let onto = read_first(git_dir.join("rebase-merge/onto"))
                .or_else(|| read_first(git_dir.join("rebase-apply/onto")))
                .map(|value| short_sha(&value))
                .unwrap_or_else(|| target.to_owned());
            RepoOperation::Rebase {
                source,
                target: onto,
                sha: None,
            }
        }
    }
}

fn operation_with_sha(kind: &str, path: PathBuf, target: &str) -> RepoOperation {
    let sha = read_first(path).map(|value| short_sha(&value));
    let source = sha.clone().unwrap_or_else(|| "HEAD".to_owned());
    match kind {
        "merge" => RepoOperation::Merge {
            source,
            target: target.to_owned(),
            sha,
        },
        "cherryPick" => RepoOperation::CherryPick {
            source,
            target: target.to_owned(),
            sha,
        },
        "revert" => RepoOperation::Revert {
            source,
            target: target.to_owned(),
            sha,
        },
        _ => RepoOperation::None,
    }
}

fn read_first(path: PathBuf) -> Option<String> {
    fs::read_to_string(path)
        .ok()?
        .lines()
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn short_sha(value: &str) -> String {
    value.chars().take(8).collect()
}

fn short_ref(value: String) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(&value)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{create, discover, CreateError, RepoOperation};

    fn git(directory: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(directory)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "GitThul Tests")
            .env("GIT_AUTHOR_EMAIL", "tests@gitthul.invalid")
            .env("GIT_COMMITTER_NAME", "GitThul Tests")
            .env("GIT_COMMITTER_EMAIL", "tests@gitthul.invalid")
            .output()
            .expect("Git CLI disponible");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn committed_repository() -> (TempDir, std::path::PathBuf) {
        let temporary = TempDir::new().expect("carpeta temporal");
        let repository = temporary.path().join("ejemplo");
        fs::create_dir(&repository).expect("carpeta del repositorio");
        git(&repository, &["init", "--initial-branch=main"]);
        fs::write(repository.join("README.md"), "# ejemplo\n").expect("archivo inicial");
        git(&repository, &["add", "README.md"]);
        git(&repository, &["commit", "-m", "inicio"]);
        (temporary, repository)
    }

    #[test]
    fn descubre_un_repositorio_y_contrasta_head_con_git_cli() {
        let (_temporary, path) = committed_repository();
        fs::write(path.join(".gitmodules"), "").expect("marcador de submódulos");
        git(
            &path,
            &[
                "remote",
                "add",
                "origin",
                "https://usuario:secreto@example.invalid/equipo/repo.git",
            ],
        );

        let repository = discover(&path).expect("repositorio descubierto");
        let cli_head = git(&path, &["branch", "--show-current"]);

        assert_eq!(repository.head, cli_head);
        assert_eq!(
            repository.path,
            fs::canonicalize(&path).unwrap().to_string_lossy()
        );
        assert!(!repository.bare);
        assert!(repository.has_submodules);
        assert_eq!(repository.remotes.len(), 1);
        assert_eq!(repository.remotes[0].name, "origin");
        assert!(!repository.remotes[0].fetch_url.contains("secreto"));
        assert!(matches!(repository.operation, RepoOperation::None));
    }

    #[test]
    fn descubre_la_raiz_desde_un_directorio_interno() {
        let (_temporary, path) = committed_repository();
        let nested = path.join("packages/app");
        fs::create_dir_all(&nested).expect("directorio interno");

        let repository = discover(&nested).expect("repositorio desde cwd interno");

        assert_eq!(
            repository.path,
            fs::canonicalize(&path).unwrap().to_string_lossy()
        );
    }

    #[test]
    fn reconoce_un_repositorio_bare() {
        let temporary = TempDir::new().expect("carpeta temporal");
        let path = temporary.path().join("central.git");
        git(
            temporary.path(),
            &["init", "--bare", path.to_str().unwrap()],
        );

        let repository = discover(&path).expect("repositorio bare");

        assert!(repository.bare);
        assert_eq!(repository.name, "central");
        assert!(!repository.has_submodules);
        assert_eq!(
            repository.path,
            fs::canonicalize(&path).unwrap().to_string_lossy()
        );
    }

    #[test]
    fn reconoce_el_padre_de_un_worktree_enlazado() {
        let (_temporary, main) = committed_repository();
        let linked = main.parent().unwrap().join("tema");
        git(
            &main,
            &["worktree", "add", "-b", "tema", linked.to_str().unwrap()],
        );

        let repository = discover(&linked).expect("worktree descubierto");

        assert_eq!(
            repository.worktree_of.as_deref(),
            Some(fs::canonicalize(&main).unwrap().to_string_lossy().as_ref())
        );
        assert_eq!(repository.head, "tema");
    }

    #[test]
    fn reconoce_una_fusion_en_curso_y_su_commit_origen() {
        let (_temporary, path) = committed_repository();
        let head = git(&path, &["rev-parse", "HEAD"]);
        fs::write(path.join(".git/MERGE_HEAD"), format!("{head}\n")).expect("estado de merge");
        fs::write(path.join(".git/MERGE_MSG"), "fusión de prueba\n").expect("mensaje de merge");

        let repository = discover(&path).expect("repositorio durante merge");

        match repository.operation {
            RepoOperation::Merge {
                source,
                target,
                sha,
            } => {
                assert_eq!(source, &head[..8]);
                assert_eq!(target, "main");
                assert_eq!(sha.as_deref(), Some(&head[..8]));
            }
            operation => panic!("se esperaba merge, llegó {operation:?}"),
        }
    }

    #[test]
    fn crea_un_repositorio_vacio_con_la_rama_solicitada() {
        let temporary = TempDir::new().expect("carpeta temporal");

        let repository = create(temporary.path(), "nuevo", "trunk").expect("repositorio creado");

        assert_eq!(repository.name, "nuevo");
        assert_eq!(repository.head, "trunk");
        assert_eq!(
            git(
                &temporary.path().join("nuevo"),
                &["branch", "--show-current"]
            ),
            "trunk"
        );
        assert_eq!(
            git(
                &temporary.path().join("nuevo"),
                &["rev-parse", "--is-inside-work-tree"]
            ),
            "true"
        );
    }

    #[test]
    fn no_toca_un_destino_que_ya_existe() {
        let temporary = TempDir::new().expect("carpeta temporal");
        let target = temporary.path().join("ocupado");
        fs::create_dir(&target).expect("destino");
        fs::write(target.join("usuario.txt"), "se conserva\n").expect("archivo del usuario");

        let error = create(temporary.path(), "ocupado", "main").expect_err("destino ocupado");

        assert_eq!(
            error,
            CreateError::DestinationExists(fs::canonicalize(&target).unwrap())
        );
        assert_eq!(
            fs::read_to_string(target.join("usuario.txt")).unwrap(),
            "se conserva\n"
        );
        assert!(!target.join(".git").exists());
    }

    #[test]
    fn rechaza_ramas_y_nombres_de_carpeta_invalidos_sin_dejar_restos() {
        let temporary = TempDir::new().expect("carpeta temporal");

        assert_eq!(
            create(temporary.path(), "nuevo", "rama con espacios").unwrap_err(),
            CreateError::InvalidBranch
        );
        assert_eq!(
            create(temporary.path(), "../fuera", "main").unwrap_err(),
            CreateError::InvalidDestination
        );
        assert!(!temporary.path().join("nuevo").exists());
    }
}

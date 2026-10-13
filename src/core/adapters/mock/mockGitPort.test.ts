import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMerge, type Commit } from '@core/domain/commit';
import { GitOperationError, isCancelled, isGitOperationError } from '@core/domain/errors';
import type { TransferProgress } from '@core/domain/repository';
import {
  CONFLICT_TEXT_LIMIT,
  exceedsConflictLimit,
  type FileChange,
  type WorkingStatus,
} from '@core/domain/status';
import type { CloneProgress, LineRef } from '@core/ports/GitPort';

import { NO_LATENCY } from './latency';
import { createMockGitPort, type MockGitPort } from './mockGitPort';
import * as fixtureWorld from './fixture/world';

let git: MockGitPort;

beforeEach(() => {
  git = createMockGitPort({ latency: NO_LATENCY });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repositorios', () => {
  it('conoce el grande, su worktree y dos más', async () => {
    const repositories = await git.listRepositories();

    expect(repositories.map((repository) => repository.id)).toEqual([
      'gitthul',
      'gitthul-worktree',
      'bitacora',
      'dotfiles',
    ]);
  });

  it('marca el worktree con el repositorio del que sale', async () => {
    const [, worktree] = await git.listRepositories();

    expect(worktree?.worktreeOf).toBe('gitthul');
    expect(worktree?.path).not.toBe('/home/example/projects/gitthul');
  });

  it('un identificador desconocido es un fallo tipado, no una excepción cualquiera', async () => {
    const error: unknown = await git.readRefs('fantasma').catch((reason: unknown) => reason);

    expect(isGitOperationError(error)).toBe(true);
  });

  it('descubre el repositorio desde el cwd de una carpeta interna', async () => {
    const repository = await git.readRepository('/home/example/projects/gitthul/src/features');

    expect(repository.id).toBe('gitthul');
  });
});

describe('abrir una carpeta', () => {
  it('la suma a los conocidos, con su historia y sin marcarla como abierta', async () => {
    const repository = await git.openRepository('/home/example/projects/tesis');

    expect(repository.name).toBe('tesis');
    // Sumarla no es abrirla: eso es un gesto de la vista y no se hace por sorpresa.
    expect(repository.lastOpenedAt).toBeNull();

    const ids = (await git.listRepositories()).map((summary) => summary.id);

    expect(ids).toContain('tesis');
    expect((await git.readCommits('tesis')).total).toBeGreaterThan(0);
  });

  it('la carpeta que ya estaba nombra el repositorio que la ocupa', async () => {
    await expect(git.openRepository('/home/example/projects/gitthul')).rejects.toMatchObject({
      code: 'repo.alreadyExists',
      params: { repo: 'gitthul', path: '/home/example/projects/gitthul' },
    });
  });

  it('la carpeta sin git falla con su ruta y su salida original', async () => {
    const error: unknown = await git
      .openRepository('/home/example/Descargas')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'repo.notARepository',
      params: { path: '/home/example/Descargas' },
    });
    expect(isGitOperationError(error) && error.output).toContain('not a git repository');
  });
});

describe('crear', () => {
  it('nace sin un solo commit y con la rama inicial que se pidió', async () => {
    const repository = await git.createRepository('/home/example/projects', {
      name: 'apuntes',
      initialBranch: 'principal',
    });

    expect(repository.path).toBe('/home/example/projects/apuntes');
    expect(repository.head).toBe('principal');

    const page = await git.readCommits(repository.id);
    const refs = await git.readRefs(repository.id);

    expect(page.total).toBe(0);
    // Sin commits no hay ninguna referencia todavía, igual que tras `git init`.
    expect(refs.branches).toEqual([]);
    expect(refs.head.branch).toBe('principal');
  });

  it('no crea dos veces en la misma carpeta', async () => {
    const options = { name: 'apuntes', initialBranch: 'main' };

    await git.createRepository('/home/example/projects', options);

    await expect(git.createRepository('/home/example/projects', options)).rejects.toMatchObject({
      code: 'repo.alreadyExists',
      params: { path: '/home/example/projects/apuntes' },
    });
  });

  it('dos repositorios con el mismo nombre reciben identificadores distintos', async () => {
    const first = await git.createRepository('/home/example/projects', {
      name: 'apuntes',
      initialBranch: 'main',
    });

    const second = await git.createRepository('/home/example/Documentos', {
      name: 'apuntes',
      initialBranch: 'main',
    });

    expect(first.id).not.toBe(second.id);
  });
});

describe('clonar', () => {
  const request = {
    url: 'https://ejemplo.org/alex/gitthul.git',
    path: '/home/example/projects',
    name: 'gitthul-copia',
  };

  it('informa por fases y termina con una rama al día con su remoto', async () => {
    const seen: CloneProgress[] = [];

    const repository = await git.cloneRepository({
      ...request,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen.map((progress) => progress.phase)).toEqual([
      'counting',
      'receiving',
      'receiving',
      'receiving',
      'receiving',
      'resolving',
      'checkout',
    ]);

    // Mientras se cuentan los objetos nadie sabe cuántos son: la barra va
    // indeterminada, y en cuanto empiezan a llegar deja de estarlo.
    expect(seen[0]?.total).toBeNull();
    expect(seen[1]?.total).not.toBeNull();

    const refs = await git.readRefs(repository.id);
    const local = refs.branches.find((branch) => branch.kind === 'local');

    expect(repository.path).toBe('/home/example/projects/gitthul-copia');
    expect(repository.remotes[0]?.fetchUrl).toBe(request.url);
    expect(local).toMatchObject({ ahead: 0, behind: 0, upstream: 'origin/main' });
  });

  it('una dirección que no se entiende falla antes de mover nada', async () => {
    await expect(
      git.cloneRepository({ ...request, url: 'esto no es una url' }),
    ).rejects.toMatchObject({ code: 'clone.invalidUrl', params: { url: 'esto no es una url' } });

    expect((await git.listRepositories()).some((summary) => summary.name === request.name)).toBe(
      false,
    );
  });

  it('un destino ocupado nombra la carpeta', async () => {
    await expect(
      git.cloneRepository({ ...request, path: '/home/example/projects', name: 'gitthul' }),
    ).rejects.toMatchObject({
      code: 'clone.destinationNotEmpty',
      params: { path: '/home/example/projects/gitthul' },
    });
  });

  /*
   * Cancelar no es fallar: rechaza con `OperationCancelledError`, que no está en
   * el catálogo justamente para que ninguna vista lo pinte. Y lo que quedó a
   * medias no se queda en la lista.
   */
  it('cancelar a mitad no es un fallo del catálogo y no deja rastro', async () => {
    const controller = new AbortController();

    const clone = git.cloneRepository(
      { ...request, onProgress: () => controller.abort() },
      { signal: controller.signal },
    );

    const error: unknown = await clone.catch((reason: unknown) => reason);

    expect(isCancelled(error)).toBe(true);
    expect(isGitOperationError(error)).toBe(false);
    expect((await git.listRepositories()).some((summary) => summary.name === request.name)).toBe(
      false,
    );
  });

  it('el fallo encargado se lanza tal cual, una sola vez', async () => {
    git.failNext(
      'cloneRepository',
      new GitOperationError('auth.failed', { remote: 'ejemplo.org' }),
    );

    await expect(git.cloneRepository(request)).rejects.toMatchObject({ code: 'auth.failed' });
    await expect(git.cloneRepository(request)).resolves.toMatchObject({ name: 'gitthul-copia' });
  });
});

describe('olvidar y marcar como abierto', () => {
  it('olvidar saca de la lista sin tocar a los demás', async () => {
    await git.forgetRepository('dotfiles');

    const ids = (await git.listRepositories()).map((summary) => summary.id);

    expect(ids).not.toContain('dotfiles');
    expect(ids).toContain('gitthul');
    await expect(git.readRepository('dotfiles')).rejects.toMatchObject({ code: 'repo.notFound' });
  });

  it('olvidar algo que no está es un fallo tipado', async () => {
    await expect(git.forgetRepository('fantasma')).rejects.toMatchObject({
      code: 'repo.notFound',
    });
  });

  it('marcar como abierto es lo que ordena los recientes', async () => {
    const before = await git.listRepositories();

    expect(before.find((summary) => summary.id === 'dotfiles')?.lastOpenedAt).toBeNull();

    await git.markOpened('dotfiles', 1_800_000_000_000);

    const after = await git.listRepositories();

    expect(after.find((summary) => summary.id === 'dotfiles')?.lastOpenedAt).toBe(
      1_800_000_000_000,
    );
    // Y no toca el orden en que se conocieron: eso lo ordena la vista.
    expect(after.map((summary) => summary.id)).toEqual(before.map((summary) => summary.id));
  });
});

describe('historia', () => {
  it('tiene los trescientos commits que pide el plan', async () => {
    const page = await git.readCommits('gitthul');

    expect(page.total).toBeGreaterThanOrEqual(300);
    expect(page.commits).toHaveLength(page.total);
    expect(page.hasMore).toBe(false);
  });

  /*
   * El grafo dibuja de arriba abajo y da por hecho que cuando llega a un commit
   * ya vio a sus hijos: si un padre apareciera antes que su hijo, la calle se
   * trazaría hacia atrás.
   */
  it('sale del más nuevo al más viejo y ningún padre aparece antes que su hijo', async () => {
    const { commits } = await git.readCommits('gitthul');
    const position = new Map(commits.map((commit, index) => [commit.sha, index]));

    for (const [index, commit] of commits.entries()) {
      for (const parent of commit.parents) {
        const parentIndex = position.get(parent);

        expect(parentIndex, `el padre ${parent} no está en la historia`).toBeDefined();
        expect(parentIndex).toBeGreaterThan(index);
      }
    }
  });

  it('tiene fusiones de dos padres', async () => {
    const { commits } = await git.readCommits('gitthul');
    const merges = commits.filter(isMerge);

    expect(merges.length).toBeGreaterThan(10);
    expect(merges.every((merge: Commit) => merge.parents.length === 2)).toBe(true);
  });

  it('reparte en páginas sin saltarse ni repetir', async () => {
    const first = await git.readCommits('gitthul', { limit: 50 });
    const second = await git.readCommits('gitthul', { skip: 50, limit: 50 });

    expect(first.commits).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.commits[0]?.sha).not.toBe(first.commits[0]?.sha);

    const shas = new Set([...first.commits, ...second.commits].map((commit) => commit.sha));

    expect(shas.size).toBe(100);
  });

  /*
   * `since` es lo que deja que las estadísticas de Repositorios cuesten lo mismo
   * en un repositorio de trescientos commits que en uno de cien mil. El total de
   * la página acotada es el del periodo; la cifra absoluta se pide sin acotar.
   */
  it('acotar por fecha deja fuera lo anterior y cuenta solo el periodo', async () => {
    const todo = await git.readCommits('gitthul');
    const oldest = todo.commits.at(-1)?.committedAt ?? 0;
    const newest = todo.commits[0]?.committedAt ?? 0;
    const since = oldest + (newest - oldest) / 2;

    const period = await git.readCommits('gitthul', { since });

    expect(period.total).toBeGreaterThan(0);
    expect(period.total).toBeLessThan(todo.total);
    expect(period.commits.every((commit) => commit.committedAt >= since)).toBe(true);
  });

  it('recorrer una rama solo trae lo que esa rama alcanza', async () => {
    const todo = await git.readCommits('gitthul');
    const main = await git.readCommits('gitthul', { start: 'main' });

    expect(main.total).toBeLessThan(todo.total);
    expect(main.commits[0]?.sha).toBe((await git.readRefs('gitthul')).head.sha);
  });

  it('resuelve referencias calificadas sin confundir rama y tag del mismo nombre', async () => {
    const refs = await git.readRefs('gitthul');
    const local = refs.branches.find((branch) => branch.name === 'main');
    const remote = refs.branches.find((branch) => branch.kind === 'remote');
    if (!local || !remote) throw new Error('El fixture requiere ramas local y remota');
    const parent = (await git.readCommit('gitthul', local.tip)).commit.parents[0];
    if (!parent) throw new Error('El fixture requiere un padre de main');
    const tagged = await git.createTag('gitthul', local.name, { kind: 'commit', sha: parent });
    const tag = tagged.tags.find((candidate) => candidate.name === local.name);
    if (!tag) throw new Error('Debe existir el tag main');

    for (const [ref, sha] of [
      [local.id, local.tip],
      [remote.id, remote.tip],
      [tag.id, tag.target],
    ] as const) {
      expect((await git.readCommits('gitthul', { start: ref })).commits[0]?.sha).toBe(sha);
      expect(await git.readDiffFiles('gitthul', { kind: 'commit', sha: ref })).toEqual(
        (await git.readCommit('gitthul', sha)).files,
      );
      expect(
        await git.readDiffFiles('gitthul', { kind: 'range', from: ref, to: local.id }),
      ).toEqual(await git.readDiffFiles('gitthul', { kind: 'range', from: sha, to: local.tip }));
    }

    expect((await git.readCommits('gitthul', { start: local.name })).commits[0]?.sha).toBe(
      local.tip,
    );
    await git.createBranch('gitthul', tag.id, { kind: 'commit', sha: local.tip });
    expect((await git.readCommits('gitthul', { start: tag.id })).commits[0]?.sha).toBe(tag.target);
  });

  it('el detalle de un commit trae sus archivos y las referencias que lo señalan', async () => {
    const refs = await git.readRefs('gitthul');
    const details = await git.readCommit('gitthul', refs.head.sha);

    expect(details.commit.sha).toBe(refs.head.sha);
    expect(details.refs).toContain('main');
  });
});

describe('referencias', () => {
  it('trae ramas locales y remotas, tags, guardados y worktrees', async () => {
    const refs = await git.readRefs('gitthul');

    expect(refs.branches.filter((branch) => branch.kind === 'local').length).toBeGreaterThanOrEqual(
      4,
    );
    expect(refs.branches.some((branch) => branch.kind === 'remote')).toBe(true);
    expect(refs.tags.filter((tag) => tag.annotated)).toHaveLength(2);
    expect(refs.stashes).toHaveLength(2);
    expect(refs.worktrees).toHaveLength(2);
  });

  it('cuenta de verdad lo que hay por subir y por traer', async () => {
    const refs = await git.readRefs('gitthul');
    const main = refs.branches.find((branch) => branch.name === 'main');
    const diverged = refs.branches.find(
      (branch) => branch.kind === 'local' && branch.ahead > 0 && branch.behind > 0,
    );

    expect(main?.ahead).toBeGreaterThan(0);
    expect(main?.behind).toBe(0);
    expect(diverged, 'hace falta una rama divergente para el push rechazado').toBeDefined();
  });

  it('ramas y tags viven en el historial, mientras los stashes solo tienen su fila propia', async () => {
    const refs = await git.readRefs('gitthul');
    const { commits } = await git.readCommits('gitthul');
    const shas = new Set(commits.map((commit) => commit.sha));

    for (const branch of refs.branches) expect(shas.has(branch.tip)).toBe(true);
    for (const tag of refs.tags) expect(shas.has(tag.target)).toBe(true);
    for (const stash of refs.stashes) {
      expect(shas.has(stash.sha)).toBe(false);
      await expect(git.readCommit('gitthul', stash.sha)).resolves.toMatchObject({
        commit: { sha: stash.sha },
      });
    }
  });

  it('la rama tomada por el worktree lo dice, y el HEAD desacoplado también', async () => {
    const refs = await git.readRefs('gitthul');
    const taken = refs.branches.find((branch) => branch.checkedOutIn !== undefined);

    expect(taken?.name).toBe('f2-3-motor-del-grafo');

    const dotfiles = await git.readRefs('dotfiles');

    expect(dotfiles.head.detached).toBe(true);
    expect(dotfiles.head.branch).toBeNull();
  });
});

describe('árbol de trabajo', () => {
  it('el repositorio grande tiene preparados, sin preparar y un binario', async () => {
    const status = await git.readStatus('gitthul');

    expect(status.clean).toBe(false);
    expect(status.staged.length).toBeGreaterThan(0);
    expect(status.unstaged.some((change) => change.change === 'untracked')).toBe(true);
    expect(status.unstaged.some((change) => change.binary)).toBe(true);
    expect(status.conflicted).toEqual([]);
  });

  it('el de la fusión a medias tiene conflictos de varias clases', async () => {
    const repository = await git.readRepository('bitacora');
    const status = await git.readStatus('bitacora');
    const kinds = new Set(status.conflicted.map((change) => change.conflict));

    // La operación a medias dice entre qué dos ramas se quedó: sin eso, la
    // invariante 5 no se puede cumplir en el aviso que la anuncia.
    expect(repository.operation).toEqual({ kind: 'merge', source: 'redaccion', target: 'main' });
    expect(status.conflicted.length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain('bothModified');
    expect(kinds).toContain('deletedByThem');
  });

  it('un conflicto trae sus tres versiones y nombra la rama de cada lado', async () => {
    const conflict = await git.readConflict('bitacora', 'docs/plan.md');

    expect(conflict.oursLabel).toBe('main');
    expect(conflict.theirsLabel).toBe('redaccion');
    expect(conflict.base).not.toBeNull();
    expect(conflict.ours).not.toBe(conflict.theirs);
  });

  it('el lado que borró el archivo no trae texto', async () => {
    const conflict = await git.readConflict('bitacora', 'README.md');

    expect(conflict.kind).toBe('deletedByThem');
    expect(conflict.theirs).toBeNull();
    expect(conflict.ours).not.toBeNull();
  });

  it('el repositorio limpio no tiene nada que enseñar', async () => {
    const status = await git.readStatus('dotfiles');

    expect(status.clean).toBe(true);
  });
});

describe('diffs', () => {
  it('los de texto traen hunks con líneas numeradas y resaltado por palabra', async () => {
    const diff = await git.readDiff('gitthul', {
      path: 'docs/inventario.md',
      source: { kind: 'worktree' },
    });

    expect(diff.content.kind).toBe('text');

    if (diff.content.kind !== 'text') return;

    expect(diff.content.hunks.length).toBeGreaterThan(0);

    for (const hunk of diff.content.hunks) {
      expect(hunk.lines.length).toBeGreaterThan(0);

      for (const line of hunk.lines) {
        if (line.kind === 'added') expect(line.oldLine).toBeNull();
        if (line.kind === 'removed') expect(line.newLine).toBeNull();
        if (line.kind === 'context') {
          expect(line.oldLine).not.toBeNull();
          expect(line.newLine).not.toBeNull();
        }
      }
    }
  });

  /*
   * El visor alterna entre el diff y el archivo completo. Si los números de
   * línea del hunk no cayeran dentro del archivo, la alternancia saltaría a
   * ninguna parte y parecería roto el componente en vez del dato.
   */
  it('los números de línea del hunk caben dentro del archivo', async () => {
    const path = 'src/ui/DataGrid.tsx';
    const diff = await git.readDiff('gitthul', { path, source: { kind: 'worktree' } });
    const file = await git.readFile('gitthul', path);
    const total = (file.text ?? '').split('\n').length;

    if (diff.content.kind !== 'text') throw new Error('se esperaba un diff de texto');

    for (const hunk of diff.content.hunks) {
      expect(hunk.newStart).toBeGreaterThan(0);
      expect(hunk.newStart + hunk.newLines - 1).toBeLessThanOrEqual(total);
    }
  });

  it('el binario no inventa líneas: da su tipo y sus dos tamaños', async () => {
    const diff = await git.readDiff('gitthul', {
      path: 'brand/icons/512x512.png',
      source: { kind: 'worktree' },
    });

    expect(diff.content.kind).toBe('binary');

    if (diff.content.kind !== 'binary') return;

    expect(diff.content.mediaType).toBe('image/png');
    expect(diff.content.oldSize).toBeGreaterThan(0);
    expect(diff.content.newSize).toBeGreaterThan(0);
  });

  it('el archivo binario tampoco trae texto', async () => {
    const file = await git.readFile('gitthul', 'src/design/fonts/space-grotesk-400.woff2');

    expect(file.binary).toBe(true);
    expect(file.text).toBeNull();
  });
});

describe('archivos de un diff entre extremos', () => {
  const change = (path: string, type: FileChange['change'] = 'modified'): FileChange => ({
    path,
    change: type,
    binary: path.endsWith('.png'),
    insertions: 1,
    deletions: 1,
  });
  const readme = change('README.md', 'added');
  const oldPath = change('docs/old.md', 'added');
  const image = change('brand/icons/512x512.png', 'added');
  const temporary = change('temporary.txt', 'added');
  const edited = change('README.md');
  const renamed: FileChange = {
    ...oldPath,
    path: 'docs/new.md',
    previousPath: oldPath.path,
    change: 'renamed',
    insertions: 0,
    deletions: 0,
  };
  const restored: FileChange = {
    ...oldPath,
    change: 'renamed',
    previousPath: renamed.path,
    insertions: 0,
    deletions: 0,
  };

  function comparisons(status?: WorkingStatus) {
    const world = fixtureWorld.buildWorld();
    const repo = world.repos.get('gitthul');
    if (!repo) throw new Error('El fixture requiere gitthul');
    const base = repo.history.commits[0];
    if (!base) throw new Error('El fixture requiere un commit');
    const commits = [
      { ...base, sha: 'root', parents: [] },
      { ...base, sha: 'middle', parents: ['root'] },
      { ...base, sha: 'restored', parents: ['middle'] },
    ];
    const clean: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };
    const candidate = {
      ...repo,
      history: {
        ...repo.history,
        commits: [...commits].reverse(),
        byShaLookup: new Map(commits.map((commit) => [commit.sha, commit])),
        filesBySha: new Map([
          ['root', [readme, oldPath, image]],
          ['middle', [edited, temporary, renamed]],
          ['restored', [readme, { ...temporary, change: 'deleted' as const }, restored]],
        ]),
      },
      refs: { ...repo.refs, head: { ...repo.refs.head, sha: 'root' } },
      status: status ?? clean,
    };
    vi.spyOn(fixtureWorld, 'buildWorld').mockReturnValue({
      ...world,
      repos: new Map(world.repos).set('gitthul', candidate),
    });
  }

  it('dos SHAs diferentes con el mismo árbol no muestran archivos ni hunks', async () => {
    comparisons();
    const source = { kind: 'range' as const, from: 'root', to: 'restored' };
    expect(await git.readDiffFiles('gitthul', source)).toEqual([]);
    const diff = await git.readDiff('gitthul', { path: readme.path, source });
    expect(diff.change).toBe('unmodified');
    expect(diff.content).toMatchObject({ kind: 'text', hunks: [] });
    expect(diff.precondition.after).toEqual(diff.precondition.before);
    const binary = await git.readDiff('gitthul', { path: image.path, source });
    expect(binary.content.kind).toBe('binary');
    if (binary.content.kind === 'binary') {
      expect(binary.content.newSize).toBe(binary.content.oldSize);
    }
  });

  it('comparar una revisión consigo misma no incluye su historial', async () => {
    comparisons();
    expect(
      await git.readDiffFiles('gitthul', { kind: 'range', from: 'middle', to: 'middle' }),
    ).toEqual([]);
  });

  it('conserva cambios netos y el renombre en cada sentido', async () => {
    comparisons();
    const forward = await git.readDiffFiles('gitthul', {
      kind: 'range',
      from: 'root',
      to: 'middle',
    });
    expect(forward).toEqual([
      expect.objectContaining({
        path: 'docs/new.md',
        previousPath: 'docs/old.md',
        change: 'renamed',
      }),
      expect.objectContaining({ path: 'README.md', change: 'modified' }),
      expect.objectContaining({ path: 'temporary.txt', change: 'added' }),
    ]);
    const reverse = await git.readDiffFiles('gitthul', {
      kind: 'range',
      from: 'middle',
      to: 'root',
    });
    expect(reverse).toEqual([
      expect.objectContaining({
        path: 'docs/old.md',
        previousPath: 'docs/new.md',
        change: 'renamed',
      }),
      expect.objectContaining({ path: 'README.md', change: 'modified' }),
      expect.objectContaining({ path: 'temporary.txt', change: 'deleted' }),
    ]);
    const diff = await git.readDiff('gitthul', {
      path: 'docs/old.md',
      source: { kind: 'range', from: 'middle', to: 'root' },
    });
    expect(diff).toMatchObject({ change: 'renamed', previousPath: 'docs/new.md' });
  });

  it('el árbol vacío permite listar el efecto combinado del commit raíz', async () => {
    comparisons();
    const files = await git.readDiffFiles('gitthul', { kind: 'range', from: null, to: 'root' });
    expect(files.map((file) => file.path)).toEqual([
      'brand/icons/512x512.png',
      'docs/old.md',
      'README.md',
    ]);
    expect(files.every((file) => file.change === 'added')).toBe(true);
  });

  it('WIP combina Stage y árbol de trabajo y excluye cambios que se cancelaron', async () => {
    const untracked = change('new.txt', 'untracked');
    comparisons({
      staged: [edited, temporary],
      unstaged: [readme, { ...temporary, change: 'deleted' }, untracked],
      conflicted: [],
      clean: false,
    });
    expect(await git.readDiffFiles('gitthul', { kind: 'workingRange', from: 'root' })).toEqual([
      expect.objectContaining({ path: 'new.txt', change: 'added' }),
    ]);
    const diff = await git.readDiff('gitthul', {
      path: 'temporary.txt',
      source: { kind: 'workingRange', from: 'root' },
    });
    expect(diff.content).toMatchObject({ kind: 'text', hunks: [] });
  });

  it('commit, índice y worktree respetan sus propias listas', async () => {
    const status = await git.readStatus('gitthul');
    const head = (await git.readRefs('gitthul')).head.sha;
    expect(await git.readDiffFiles('gitthul', { kind: 'index' })).toEqual(status.staged);
    expect(await git.readDiffFiles('gitthul', { kind: 'worktree' })).toEqual(status.unstaged);
    expect(await git.readDiffFiles('gitthul', { kind: 'commit', sha: head })).toEqual(
      (await git.readCommit('gitthul', head)).files,
    );
  });

  it('rechaza una revisión inexistente y respeta cancelación', async () => {
    comparisons();
    await expect(
      git.readDiffFiles('gitthul', { kind: 'range', from: 'missing', to: 'root' }),
    ).rejects.toMatchObject({ code: 'unknown' });
    const controller = new AbortController();
    controller.abort();
    const error: unknown = await git
      .readDiffFiles('gitthul', { kind: 'index' }, { signal: controller.signal })
      .catch((reason: unknown) => reason);
    expect(isCancelled(error)).toBe(true);
  });
});

const ROLES = 'src/design/roles.css';
const UNTRACKED = 'src/core/adapters/mock/mockGitPort.ts';

const at = (status: WorkingStatus, list: 'staged' | 'unstaged', path: string) =>
  status[list].find((change) => change.path === path);

const TEST_PRECONDITION = { before: null, after: null } as const;
const partial = (
  path: string,
  selection: { hunkIds?: readonly string[]; lines?: readonly LineRef[] },
) => ({ path, ...selection, precondition: TEST_PRECONDITION });
const discardTarget = (path: string) => ({ path, precondition: TEST_PRECONDITION });

describe('preparar y descartar', () => {
  it('preparar mueve el archivo de lista y quitarlo lo devuelve', async () => {
    const staged = await git.stage('gitthul', [ROLES]);

    expect(at(staged, 'staged', ROLES)).toBeDefined();
    expect(at(staged, 'unstaged', ROLES)).toBeUndefined();

    const unstaged = await git.unstage('gitthul', [ROLES]);

    expect(at(unstaged, 'staged', ROLES)).toBeUndefined();
    expect(at(unstaged, 'unstaged', ROLES)).toMatchObject({ change: 'modified' });
  });

  /*
   * Un archivo nuevo es `added` dentro del stage y `untracked` fuera: es el
   * mismo archivo, y quitarlo del stage lo devuelve a sin seguimiento en vez de
   * dejarlo como una alta a medias.
   */
  it('el archivo sin seguimiento entra como alta y vuelve a salir sin seguimiento', async () => {
    expect(at(await git.stage('gitthul', [UNTRACKED]), 'staged', UNTRACKED)).toMatchObject({
      change: 'added',
    });

    expect(at(await git.unstage('gitthul', [UNTRACKED]), 'unstaged', UNTRACKED)).toMatchObject({
      change: 'untracked',
    });
  });

  it('preparar un hunk deja el archivo en las dos listas, y las dos suman lo que cambió', async () => {
    const before = at(await git.readStatus('gitthul'), 'unstaged', ROLES);
    const status = await git.stageHunks('gitthul', partial(ROLES, { hunkIds: ['hunk-1'] }));

    const staged = at(status, 'staged', ROLES);
    const unstaged = at(status, 'unstaged', ROLES);

    expect(staged?.insertions).toBeGreaterThan(0);
    expect(unstaged?.insertions).toBeGreaterThan(0);
    expect((staged?.insertions ?? 0) + (unstaged?.insertions ?? 0)).toBe(before?.insertions);
    expect((staged?.deletions ?? 0) + (unstaged?.deletions ?? 0)).toBe(before?.deletions);
  });

  it('preparar todos los hunks es preparar el archivo entero', async () => {
    await git.stageHunks('gitthul', partial(ROLES, { hunkIds: ['hunk-1'] }));

    const status = await git.stageHunks(
      'gitthul',
      partial(ROLES, { hunkIds: ['hunk-2', 'hunk-3'] }),
    );

    expect(at(status, 'unstaged', ROLES)).toBeUndefined();
    expect(at(status, 'staged', ROLES)?.insertions).toBe(16);
  });

  it('quitar del stage el último hunk devuelve el archivo entero a sin preparar', async () => {
    await git.stageHunks('gitthul', partial(ROLES, { hunkIds: ['hunk-1', 'hunk-2'] }));

    const status = await git.unstageHunks(
      'gitthul',
      partial(ROLES, { hunkIds: ['hunk-1', 'hunk-2'] }),
    );

    expect(at(status, 'staged', ROLES)).toBeUndefined();
    expect(at(status, 'unstaged', ROLES)?.insertions).toBe(16);
  });

  it('preparar por líneas suma con lo que ya estaba preparado por hunk', async () => {
    await git.stageHunks('gitthul', partial(ROLES, { hunkIds: ['hunk-1'] }));

    const conLinea = await git.stageLines(
      'gitthul',
      partial(ROLES, { lines: [{ side: 'new', line: 26 }] }),
    );
    const soloHunk = await git.unstageLines(
      'gitthul',
      partial(ROLES, { lines: [{ side: 'new', line: 26 }] }),
    );

    expect(at(conLinea, 'staged', ROLES)?.insertions).toBeGreaterThan(
      at(soloHunk, 'staged', ROLES)?.insertions ?? 0,
    );
    expect(at(soloHunk, 'staged', ROLES)).toBeDefined();
  });

  /*
   * Pedir lo imposible devuelve el mismo estado sin escribir ni lanzar, que es
   * la regla que la biblioteca fijó en P1.3: quien lo explica es el diálogo
   * que valida antes, no el puerto.
   */
  it('preparar una línea de contexto o un archivo que no cambió no escribe nada', async () => {
    const before = await git.readStatus('gitthul');

    expect(
      await git.stageLines('gitthul', partial(ROLES, { lines: [{ side: 'new', line: 1 }] })),
    ).toBe(before);
    expect(await git.stage('gitthul', ['docs/lo-que-no-existe.md'])).toBe(before);
    expect(await git.unstage('gitthul', [ROLES])).toBe(before);
  });

  it('descartar deja el archivo como en HEAD: se va de las dos listas', async () => {
    await git.stageHunks('gitthul', partial(ROLES, { hunkIds: ['hunk-1'] }));

    const status = await git.discard('gitthul', [discardTarget(ROLES)]);

    expect(at(status, 'staged', ROLES)).toBeUndefined();
    expect(at(status, 'unstaged', ROLES)).toBeUndefined();
  });

  it('sin nada en ninguna lista el árbol queda limpio', async () => {
    const before = await git.readStatus('gitthul-worktree');
    const status = await git.discard(
      'gitthul-worktree',
      before.unstaged.map((change) => discardTarget(change.path)),
    );

    expect(status.clean).toBe(true);
  });

  it('descartar una línea reduce Seguimiento sin tocar el stage', async () => {
    const before = at(await git.readStatus('gitthul'), 'unstaged', ROLES);

    const status = await git.discardLines(
      'gitthul',
      partial(ROLES, { lines: [{ side: 'new', line: 26 }] }),
    );

    expect(at(status, 'staged', ROLES)).toBeUndefined();
    expect(at(status, 'unstaged', ROLES)?.insertions).toBeLessThan(before?.insertions ?? 0);
  });

  it('descartar todo lo que queda sin preparar limpia el archivo', async () => {
    const newLines = Array.from({ length: 200 }, (_, index) => ({
      side: 'new' as const,
      line: index + 1,
    }));
    const oldLines = Array.from({ length: 200 }, (_, index) => ({
      side: 'old' as const,
      line: index + 1,
    }));

    const status = await git.discardLines(
      'gitthul',
      partial(ROLES, { lines: [...newLines, ...oldLines] }),
    );

    expect(at(status, 'unstaged', ROLES)).toBeUndefined();
    expect(at(status, 'staged', ROLES)).toBeUndefined();
  });

  it('una línea ya preparada no se descarta por aquí: para eso está quitar del stage', async () => {
    await git.stageLines('gitthul', partial(ROLES, { lines: [{ side: 'new', line: 26 }] }));
    const before = await git.readStatus('gitthul');

    expect(
      await git.discardLines('gitthul', partial(ROLES, { lines: [{ side: 'new', line: 26 }] })),
    ).toBe(before);
  });

  it('descartar dos veces la misma línea no repite nada', async () => {
    await git.discardLines('gitthul', partial(ROLES, { lines: [{ side: 'new', line: 26 }] }));
    const before = await git.readStatus('gitthul');

    expect(
      await git.discardLines('gitthul', partial(ROLES, { lines: [{ side: 'new', line: 26 }] })),
    ).toBe(before);
  });

  it('pedir descartar una línea de contexto no escribe nada', async () => {
    const before = await git.readStatus('gitthul');

    expect(
      await git.discardLines('gitthul', partial(ROLES, { lines: [{ side: 'new', line: 1 }] })),
    ).toBe(before);
  });
});

describe('ignorar rutas', () => {
  it('esconde lo que no tenía seguimiento y anota el cambio de .gitignore', async () => {
    const status = await git.ignorePath('gitthul', UNTRACKED);

    expect(at(status, 'unstaged', UNTRACKED)).toBeUndefined();
    expect(at(status, 'unstaged', '.gitignore')).toMatchObject({ change: 'modified' });
    // Lo que ya estaba en el stage no se toca: ignorar no saca del índice.
    expect(at(status, 'staged', 'src/core/ports/GitPort.ts')).toBeDefined();
  });

  it('con untrack, lo que sí tenía seguimiento queda como borrado en el stage', async () => {
    const status = await git.ignorePath('gitthul', ROLES, { untrack: true });

    expect(at(status, 'unstaged', ROLES)).toBeUndefined();
    expect(at(status, 'staged', ROLES)).toMatchObject({ change: 'deleted' });
  });

  /*
   * Un patrón repetido o vacío no tiene código de error propio: se resuelve como
   * las mutaciones imposibles del dominio, con el mismo estado y sin escribir.
   */
  it('repetir el patrón o dejarlo vacío no vuelve a escribir', async () => {
    const first = await git.ignorePath('gitthul', UNTRACKED);

    expect(await git.ignorePath('gitthul', UNTRACKED)).toBe(first);
    expect(await git.ignorePath('gitthul', '   ')).toBe(first);
  });
});

describe('commit', () => {
  it('guarda lo preparado, mueve la rama y deja el stage vacío', async () => {
    const before = await git.readRefs('gitthul');
    const sha = await git.commit('gitthul', { summary: 'F0.10: escritura local', body: '' });

    const refs = await git.readRefs('gitthul');
    const status = await git.readStatus('gitthul');
    const details = await git.readCommit('gitthul', sha);

    expect(refs.head.sha).toBe(sha);
    expect(refs.branches.find((branch) => branch.name === 'main')?.tip).toBe(sha);
    expect(details.commit.parents).toEqual([before.head.sha]);
    expect(details.files.map((file) => file.path)).toContain('src/app/shellStore.ts');
    expect(status.staged).toEqual([]);
    expect(status.unstaged).toHaveLength(4);
  });

  it('sin nada preparado no hay commit que hacer', async () => {
    await expect(
      git.commit('dotfiles', { summary: 'nada que guardar', body: '' }),
    ).rejects.toMatchObject({ code: 'commit.nothingStaged' });
  });

  /*
   * `amend` rehace el último commit en vez de encadenar otro: los padres son los
   * suyos y la historia no crece. El autor original se conserva; quien lo rehizo
   * queda como committer, que es lo que distingue a los dos.
   */
  it('rehacer el último no encadena otro commit', async () => {
    const before = await git.readCommits('gitthul');
    const head = await git.readRefs('gitthul');
    const previous = before.commits.find((commit) => commit.sha === head.head.sha);

    const sha = await git.commit('gitthul', {
      summary: 'F0.10: escritura local, mejor contada',
      body: '',
      amend: true,
    });

    const after = await git.readCommits('gitthul');
    const details = await git.readCommit('gitthul', sha);

    expect(after.total).toBe(before.total);
    expect(details.commit.parents).toEqual(previous?.parents);
    expect(details.commit.author).toEqual(previous?.author);
  });

  it('amend solo de mensaje conserva Stage y archivos del commit anterior', async () => {
    const before = await git.readRefs('gitthul');
    const details = await git.readCommit('gitthul', before.head.sha);
    const status = await git.readStatus('gitthul');
    const sha = await git.commit('gitthul', {
      summary: 'Mensaje corregido',
      body: 'Detalle completo',
      amend: true,
      amendMessageOnly: true,
    });
    expect(await git.readStatus('gitthul')).toEqual(status);
    expect((await git.readCommit('gitthul', sha)).files).toEqual(details.files);
    await git.undo('gitthul');
    expect((await git.readRefs('gitthul')).head.sha).toBe(before.head.sha);
    expect(await git.readStatus('gitthul')).toEqual(status);
  });

  it('la identidad que falta se encarga y llega tal cual', async () => {
    git.failNext('commit', new GitOperationError('commit.identityMissing', {}));

    await expect(git.commit('gitthul', { summary: 'sin firma', body: '' })).rejects.toMatchObject({
      code: 'commit.identityMissing',
    });
  });
});

describe('ramas', () => {
  it('la rama nueva nace donde se le dice, y con checkout se vuelve la activa', async () => {
    const refs = await git.createBranch(
      'gitthul',
      'f0-10-escritura',
      { kind: 'branch', name: 'dev' },
      { checkout: true },
    );

    const dev = refs.branches.find((branch) => branch.name === 'dev');
    const nueva = refs.branches.find((branch) => branch.name === 'f0-10-escritura');

    expect(nueva?.tip).toBe(dev?.tip);
    expect(nueva?.isHead).toBe(true);
    expect(refs.head.branch).toBe('f0-10-escritura');
    expect((await git.readRepository('gitthul')).head).toBe('f0-10-escritura');
  });

  it('crear con checkout deshace primero el cambio y después la rama', async () => {
    await git.createBranch(
      'gitthul',
      'f0-10-escritura',
      { kind: 'branch', name: 'dev' },
      { checkout: true },
    );

    const undoEntries = (await git.readUndoStack('gitthul')).undo;
    expect(undoEntries.map((entry) => entry.labelKey)).toEqual([
      'undo.checkout',
      'undo.createBranch',
    ]);
    expect(undoEntries[0]?.params).toEqual({ from: 'main', to: 'f0-10-escritura' });

    await git.undo('gitthul');
    expect((await git.readRefs('gitthul')).head.branch).toBe('main');
    expect(
      (await git.readRefs('gitthul')).branches.some((branch) => branch.name === 'f0-10-escritura'),
    ).toBe(true);

    await git.undo('gitthul');
    expect(
      (await git.readRefs('gitthul')).branches.some((branch) => branch.name === 'f0-10-escritura'),
    ).toBe(false);

    await git.redo('gitthul');
    expect((await git.readRefs('gitthul')).head.branch).toBe('main');
    await git.redo('gitthul');
    expect((await git.readRefs('gitthul')).head.branch).toBe('f0-10-escritura');
  });

  it('una rama repetida falla nombrándola', async () => {
    await expect(
      git.createBranch('gitthul', 'dev', { kind: 'branch', name: 'main' }),
    ).rejects.toMatchObject({ code: 'branch.exists', params: { branch: 'dev' } });
  });

  it('renombrar arrastra HEAD, el worktree y los guardados', async () => {
    const refs = await git.renameBranch('gitthul', 'main', 'principal');

    expect(refs.branches.some((branch) => branch.name === 'main')).toBe(false);
    expect(refs.head.branch).toBe('principal');
    expect(refs.worktrees.find((worktree) => worktree.isMain)?.branch).toBe('principal');
    expect(refs.stashes.every((stash) => stash.branch === 'principal')).toBe(true);
    expect((await git.readRepository('gitthul')).head).toBe('principal');

    expect((await git.readUndoStack('gitthul')).undo[0]).toMatchObject({
      labelKey: 'undo.renameBranch',
      params: { from: 'main', to: 'principal' },
    });
    await git.undo('gitthul');
    expect((await git.readRefs('gitthul')).head.branch).toBe('main');
    expect(
      (await git.readRefs('gitthul')).worktrees.find((worktree) => worktree.isMain)?.branch,
    ).toBe('main');
    await git.redo('gitthul');
    expect((await git.readRefs('gitthul')).head.branch).toBe('principal');
  });

  it('renombrar sobre un nombre tomado falla, y renombrar lo que no está no escribe', async () => {
    await expect(git.renameBranch('gitthul', 'dev', 'main')).rejects.toMatchObject({
      code: 'branch.exists',
    });

    const refs = await git.readRefs('gitthul');

    expect(await git.renameBranch('gitthul', 'fantasma', 'otra')).toBe(refs);
  });

  it('no renombra una rama distinta de la que se confirmó', async () => {
    await expect(
      git.renameBranch('gitthul', 'dev', 'otra', { expectedTip: 'f'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'ref.stale', params: { ref: 'dev' } });
  });

  it('borrar una rama sin fusionar dice cuántos commits se perderían', async () => {
    await expect(git.deleteBranch('gitthul', 'dev')).rejects.toMatchObject({
      code: 'branch.notMerged',
      params: { branch: 'dev', target: 'main' },
    });

    const refs = await git.deleteBranch('gitthul', 'dev', { force: true });

    expect(refs.branches.some((branch) => branch.name === 'dev')).toBe(false);
  });

  it('la rama activa no se borra ni con fuerza', async () => {
    const refs = await git.readRefs('gitthul');

    expect(await git.deleteBranch('gitthul', 'main', { force: true })).toBe(refs);
  });

  it('no borra una rama distinta de la que se confirmó', async () => {
    await expect(
      git.deleteBranch('gitthul', 'dev', { force: true, expectedTip: 'f'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'ref.stale', params: { ref: 'dev' } });
  });

  it('publicar y dejar de seguir recuentan lo de más y lo de menos', async () => {
    const suelta = await git.setUpstream('gitthul', 'main', null);
    const main = suelta.branches.find((branch) => branch.name === 'main');

    expect(main?.upstream).toBeUndefined();
    expect(main?.ahead).toBe(0);

    const seguida = await git.setUpstream('gitthul', 'main', 'origin/main');
    const otra = seguida.branches.find((branch) => branch.name === 'main');

    expect(otra?.upstream).toBe('origin/main');
    expect(otra?.ahead).toBeGreaterThan(0);
  });
});

describe('tags', () => {
  it('el anotado lleva mensaje y quien lo puso; el ligero es solo un puntero', async () => {
    const refs = await git.createTag(
      'gitthul',
      'v1.0.0',
      { kind: 'branch', name: 'main' },
      {
        message: 'Primera versión',
      },
    );

    const anotado = refs.tags.find((tag) => tag.name === 'v1.0.0');

    expect(anotado).toMatchObject({ annotated: true, message: 'Primera versión' });
    expect(anotado?.tagger).toBeDefined();
    expect(anotado?.target).toBe(refs.head.sha);

    const conLigero = await git.createTag('gitthul', 'v1.0.1', { kind: 'branch', name: 'main' });

    expect(conLigero.tags.find((tag) => tag.name === 'v1.0.1')?.annotated).toBe(false);
  });

  it('un tag repetido falla nombrándolo', async () => {
    await expect(
      git.createTag('gitthul', 'v0.1.0', { kind: 'branch', name: 'main' }),
    ).rejects.toMatchObject({ code: 'tag.exists', params: { tag: 'v0.1.0' } });
  });

  it('borrar quita el tag, y borrar el que no está no escribe', async () => {
    const refs = await git.deleteTag('gitthul', 'v0.1.0');

    expect(refs.tags.some((tag) => tag.name === 'v0.1.0')).toBe(false);
    expect(await git.deleteTag('gitthul', 'v0.1.0')).toBe(refs);
  });

  it('no borra un tag distinto del que se confirmó', async () => {
    await expect(
      git.deleteTag('gitthul', 'v0.1.0', { expectedTip: 'f'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'ref.stale', params: { ref: 'v0.1.0' } });
  });
});

describe('checkout', () => {
  it('una rama remota cambia a la local que la sigue', async () => {
    const refs = await git.checkout(
      'gitthul',
      { kind: 'remoteBranch', name: 'origin/dev', remote: 'origin' },
      { autoStash: true },
    );

    expect(refs.head.branch).toBe('dev');
    expect(refs.branches.find((branch) => branch.name === 'dev')?.upstream).toBe('origin/dev');
  });

  it('con el árbol sucio nombra la rama y cuántos archivos estorban', async () => {
    const status = await git.readStatus('gitthul');

    await expect(git.checkout('gitthul', { kind: 'branch', name: 'dev' })).rejects.toMatchObject({
      code: 'checkout.dirtyTree',
      params: { branch: 'dev', count: status.staged.length + status.unstaged.length },
    });
  });

  it('con autoStash guarda, cambia y deja el árbol como estaba antes de tocarlo', async () => {
    const before = await git.readRefs('gitthul');
    const statusBefore = await git.readStatus('gitthul');
    const refs = await git.checkout(
      'gitthul',
      { kind: 'branch', name: 'dev' },
      { autoStash: true },
    );
    const status = await git.readStatus('gitthul');

    expect(refs.head.branch).toBe('dev');
    expect(refs.branches.find((branch) => branch.name === 'dev')?.isHead).toBe(true);
    expect(refs.stashes).toHaveLength(before.stashes.length);
    expect(status.staged.length + status.unstaged.length).toBe(
      statusBefore.staged.length + statusBefore.unstaged.length,
    );
    expect(status.unstaged.some((change) => change.change === 'untracked')).toBe(true);
    expect(status.unstaged.some((change) => change.change !== 'untracked')).toBe(true);
  });

  it('un tag se revisa con HEAD desacoplado', async () => {
    const refs = await git.checkout('dotfiles', { kind: 'tag', name: 'v3' });

    expect(refs.head.detached).toBe(true);
    expect(refs.head.branch).toBeNull();
    expect(refs.branches.every((branch) => !branch.isHead)).toBe(true);
  });
});

describe('guardados', () => {
  it('guardar saca los cambios del árbol y suma solo su fila sintética', async () => {
    const before = await git.readCommits('gitthul');
    const refs = await git.createStash('gitthul', 'A medio hacer');
    const status = await git.readStatus('gitthul');

    expect(refs.stashes[0]).toMatchObject({ index: 0, message: 'A medio hacer', branch: 'main' });
    expect(refs.stashes.map((stash) => stash.index)).toEqual([0, 1, 2]);
    expect((await git.readCommits('gitthul')).total).toBe(before.total);
    expect(status.staged).toEqual([]);
    expect(status.unstaged.every((change) => change.change === 'untracked')).toBe(true);
  });

  it('con includeUntracked no queda nada en el árbol', async () => {
    await git.createStash('gitthul', 'Todo dentro', { includeUntracked: true });

    expect((await git.readStatus('gitthul')).clean).toBe(true);
  });

  it('con keepStaged lo preparado se queda donde está', async () => {
    await git.createStash('gitthul', 'Solo lo suelto', { keepStaged: true });

    const status = await git.readStatus('gitthul');

    expect(status.staged).toHaveLength(2);
  });

  it('sin nada que guardar no hay guardado', async () => {
    await expect(git.createStash('dotfiles', 'nada')).rejects.toMatchObject({
      code: 'stash.nothingToStash',
    });
  });

  it('aplicar devuelve los archivos sin preparar, y con drop se va de la pila', async () => {
    const before = await git.readRefs('gitthul');
    const status = await git.applyStash('gitthul', 0, { drop: true });
    const refs = await git.readRefs('gitthul');

    expect(status.unstaged.length).toBeGreaterThan(4);
    expect(status.staged).toHaveLength(2);
    expect(refs.stashes).toHaveLength(before.stashes.length - 1);
  });

  it('descartar un guardado renumera los de debajo', async () => {
    const before = await git.readRefs('gitthul');
    const refs = await git.dropStash('gitthul', 0);

    expect(refs.stashes.map((stash) => stash.index)).toEqual([0]);
    expect(refs.stashes[0]?.sha).toBe(before.stashes[1]?.sha);
    expect(await git.dropStash('gitthul', 7)).toBe(refs);
  });
});

describe('historia de un archivo', () => {
  it('trae solo los commits que lo tocaron, del más nuevo al más viejo', async () => {
    const path = 'src/app/tabs.ts';
    const commits = await git.readFileHistory('gitthul', path);
    const files = await Promise.all(
      commits.map(async (commit) => (await git.readCommit('gitthul', commit.sha)).files),
    );

    expect(commits.length).toBeGreaterThan(0);
    expect(files.every((entries) => entries.some((file) => file.path === path))).toBe(true);

    const dates = commits.map((commit) => commit.committedAt);

    expect([...dates].sort((left, right) => right - left)).toEqual(dates);
  });

  it('un archivo que nadie tocó no tiene historia', async () => {
    expect(await git.readFileHistory('gitthul', 'lo/que/nunca/existió.txt')).toEqual([]);
  });
});

/*
 * Una rama que no tiene commits propios: fusionar dentro de ella es un avance
 * rápido, que es el caso que el mundo generado no trae hecho porque todas sus
 * ramas han divergido de verdad.
 */
async function branchBehindMain(port: MockGitPort): Promise<void> {
  const refs = await port.readRefs('dotfiles');

  await port.createBranch('dotfiles', 'viejo', { kind: 'commit', sha: refs.head.sha });
  await port.checkout('dotfiles', { kind: 'branch', name: 'viejo' });
}

describe('vista previa de integración', () => {
  it('dice qué commits trae, hacia dónde, y no escribe nada', async () => {
    const before = await git.readCommits('gitthul');
    const preview = await git.previewIntegration('gitthul', 'merge', 'dev', 'main');

    expect(preview).toMatchObject({ kind: 'merge', source: 'dev', target: 'main' });
    expect(preview.commits).toHaveLength(3);
    expect(preview.fastForward).toBe(false);

    // Un arrastre accidental nunca hace daño: la vista previa no toca el mundo.
    expect((await git.readCommits('gitthul')).total).toBe(before.total);
    expect((await git.readRepository('gitthul')).operation).toEqual({ kind: 'none' });
  });

  it('rebasar mira el otro lado: los commits que se reescriben son los del destino', async () => {
    const merge = await git.previewIntegration('gitthul', 'merge', 'dev', 'main');
    const rebase = await git.previewIntegration('gitthul', 'rebase', 'dev', 'main');

    expect(rebase.commits.length).toBeGreaterThan(merge.commits.length);
    expect(rebase.commits.some((commit) => merge.commits.includes(commit))).toBe(false);
  });

  it('un destino sin commits propios es un avance rápido y no prevé conflictos', async () => {
    await branchBehindMain(git);

    const preview = await git.previewIntegration('dotfiles', 'merge', 'main', 'viejo');

    expect(preview.fastForward).toBe(true);
    expect(preview.conflicts).toEqual([]);
  });

  it('con un renombrado de por medio no promete nada', async () => {
    // `null` no es «no hay conflictos»: es que no se puede saber sin intentarlo,
    // y la vista previa se calla en vez de prometer lo que no sabe.
    expect((await git.previewIntegration('gitthul', 'merge', 'dev', 'main')).conflicts).toBeNull();
  });
});

describe('fusionar', () => {
  it('trae la rama con un commit de fusión de dos padres', async () => {
    const before = await git.readCommits('gitthul');
    const repository = await git.merge('gitthul', 'dev');
    const refs = await git.readRefs('gitthul');
    const head = (await git.readCommit('gitthul', refs.head.sha)).commit;

    expect(repository.operation).toEqual({ kind: 'none' });
    expect(head.parents).toHaveLength(2);
    expect(head.summary).toBe('Fusionar dev dentro de main');
    expect((await git.readCommits('gitthul')).total).toBe(before.total + 1);
  });

  it('el avance rápido no escribe ningún commit', async () => {
    await branchBehindMain(git);

    const before = await git.readCommits('dotfiles');
    const main = (await git.readRefs('dotfiles')).branches.find((branch) => branch.name === 'main');

    await git.merge('dotfiles', 'main');

    const refs = await git.readRefs('dotfiles');

    expect((await git.readCommits('dotfiles')).total).toBe(before.total);
    expect(refs.head.sha).toBe(main?.tip);
  });

  it('con noFastForward la fusión se escribe igual', async () => {
    await branchBehindMain(git);

    const before = await git.readCommits('dotfiles');

    await git.merge('dotfiles', 'main', { noFastForward: true });

    expect((await git.readCommits('dotfiles')).total).toBe(before.total + 1);
  });

  it('lo que git no sabe combinar deja el árbol en conflicto y además falla', async () => {
    const error: unknown = await git
      .merge('gitthul', 'fix/push-rechazado')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'merge.conflict',
      params: { source: 'fix/push-rechazado', target: 'main', count: 2 },
    });

    // Falla **y** deja el árbol a medias: es lo que Resolver se encuentra.
    const status = await git.readStatus('gitthul');
    const repository = await git.readRepository('gitthul');

    expect(repository.operation).toEqual({
      kind: 'merge',
      source: 'fix/push-rechazado',
      target: 'main',
    });
    expect(status.conflicted.map((change) => change.conflict)).toEqual([
      'bothModified',
      'deletedByUs',
    ]);
  });

  it('el conflicto nuevo trae sus tres versiones y nombra cada lado', async () => {
    await git.merge('gitthul', 'fix/push-rechazado').catch(() => null);

    const [first] = (await git.readStatus('gitthul')).conflicted;
    const conflict = await git.readConflict('gitthul', first?.path ?? '');

    expect(conflict.oursLabel).toBe('main');
    expect(conflict.theirsLabel).toBe('fix/push-rechazado');
  });

  it('una operación a medias no deja empezar otra, y la nombra', async () => {
    await expect(git.merge('bitacora', 'redaccion')).rejects.toMatchObject({
      code: 'operation.inProgress',
      params: { kind: 'merge', source: 'redaccion', target: 'main' },
    });
  });
});

describe('rebasar', () => {
  it('reescribe los commits propios encima de la base, sin dejar los viejos', async () => {
    const before = await git.readCommits('gitthul');
    const own = (await git.previewIntegration('gitthul', 'rebase', 'dev', 'main')).commits;

    await git.rebase('gitthul', 'dev');

    const after = await git.readCommits('gitthul');
    const shas = new Set(after.commits.map((commit) => commit.sha));

    expect(after.total).toBe(before.total);
    expect(own.every((commit) => !shas.has(commit.sha))).toBe(true);
  });

  it('un choque para el rebase nombrando el commit donde se paró', async () => {
    const error: unknown = await git
      .rebase('gitthul', 'fix/push-rechazado')
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'rebase.conflict',
      params: { source: 'main', target: 'fix/push-rechazado', count: 2 },
    });
    expect((await git.readRepository('gitthul')).operation).toMatchObject({ kind: 'rebase' });
  });
});

describe('cherry-pick y revertir', () => {
  it('rechaza una línea principal ausente o imposible antes de escribir', async () => {
    const commits = (await git.readCommits('gitthul', { limit: 200 })).commits;
    const merge = commits.find(isMerge);
    const ordinary = commits.find((commit) => !isMerge(commit));
    if (!merge || !ordinary) throw new Error('El fixture debe contener commits simples y de merge');
    const before = await git.readRefs('gitthul');

    await expect(git.cherryPick('gitthul', [merge.sha])).rejects.toMatchObject({
      code: 'history.mainlineRequired',
      params: { sha: merge.sha.slice(0, 7) },
    });
    await expect(git.revert('gitthul', [merge.sha], { mainline: 3 })).rejects.toMatchObject({
      code: 'history.mainlineInvalid',
      params: { sha: merge.sha.slice(0, 7), parent: 3, count: 2 },
    });
    await expect(
      git.cherryPick('gitthul', [merge.sha, ordinary.sha], { mainline: 1 }),
    ).rejects.toMatchObject({ code: 'history.mainlineRequired' });

    expect(await git.readRefs('gitthul')).toEqual(before);
  });

  it('el cherry-pick repite el commit encima de la rama activa, con otro SHA', async () => {
    const source = (await git.readCommits('dotfiles', { limit: 10 })).commits.find(
      (commit) => !isMerge(commit),
    );
    const before = await git.readCommits('dotfiles');

    await git.cherryPick('dotfiles', [source?.sha ?? '']);

    const refs = await git.readRefs('dotfiles');
    const applied = (await git.readCommit('dotfiles', refs.head.sha)).commit;

    expect((await git.readCommits('dotfiles')).total).toBe(before.total + 1);
    expect(applied.summary).toBe(source?.summary);
    expect(applied.sha).not.toBe(source?.sha);
  });

  it('revertir escribe un commit que lo dice y cambia de signo lo que hizo', async () => {
    const source = (await git.readCommits('dotfiles', { limit: 10 })).commits.find(
      (commit) => !isMerge(commit),
    );
    const original = await git.readCommit('dotfiles', source?.sha ?? '');

    await git.revert('dotfiles', [source?.sha ?? '']);

    const refs = await git.readRefs('dotfiles');
    const reverted = await git.readCommit('dotfiles', refs.head.sha);

    expect(reverted.commit.summary).toContain(source?.summary ?? '');
    expect(reverted.files.map((file) => file.insertions)).toEqual(
      original.files.map((file) => file.deletions),
    );
  });

  it('traerlo encima de un archivo que se está editando deja el conflicto', async () => {
    const status = await git.readStatus('gitthul');
    const edited = status.unstaged.find((change) => change.binary)?.path;
    const commits = (await git.readCommits('gitthul')).commits;
    const details = await Promise.all(
      commits.map((commit) => git.readCommit('gitthul', commit.sha)),
    );
    const target = details.find((detail) => detail.files.some((file) => file.path === edited))
      ?.commit.sha;
    if (!target) throw new Error('El fixture debe tener un commit que toque el binario editado');

    await expect(git.cherryPick('gitthul', [target])).rejects.toMatchObject({
      code: 'merge.conflict',
      params: { target: 'main' },
    });

    expect((await git.readStatus('gitthul')).conflicted).toHaveLength(1);
    expect((await git.readRepository('gitthul')).operation).toMatchObject({ kind: 'cherryPick' });
  });
});

describe('restablecer', () => {
  it('en soft mueve la rama y no toca lo que había preparado', async () => {
    const before = await git.readStatus('gitthul');
    const [, , third] = (await git.readCommits('gitthul', { limit: 4 })).commits;

    await git.reset('gitthul', third?.sha ?? '', 'soft');

    expect((await git.readRefs('gitthul')).head.sha).toBe(third?.sha);
    expect((await git.readStatus('gitthul')).staged).toEqual(before.staged);
  });

  it('en mixed vacía el stage sin perder nada del árbol', async () => {
    const before = await git.readStatus('gitthul');
    const [, , third] = (await git.readCommits('gitthul', { limit: 4 })).commits;

    const status = await git
      .reset('gitthul', third?.sha ?? '', 'mixed')
      .then(() => git.readStatus('gitthul'));

    expect(status.staged).toEqual([]);
    expect(status.unstaged).toHaveLength(before.staged.length + before.unstaged.length);
  });

  it('en hard solo sobrevive lo que git no sigue', async () => {
    const [, , third] = (await git.readCommits('gitthul', { limit: 4 })).commits;

    await git.reset('gitthul', third?.sha ?? '', 'hard');

    const status = await git.readStatus('gitthul');

    expect(status.staged).toEqual([]);
    expect(status.unstaged.every((change) => change.change === 'untracked')).toBe(true);
  });
});

describe('continuar y abortar', () => {
  it('abortar devuelve el repositorio exactamente a como estaba', async () => {
    const before = await git.readStatus('gitthul');

    await git.merge('gitthul', 'fix/push-rechazado').catch(() => null);

    const repository = await git.abortOperation('gitthul');

    expect(repository.operation).toEqual({ kind: 'none' });
    expect(await git.readStatus('gitthul')).toEqual(before);
  });

  it('abortar lo que nació en conflicto suelta los conflictos y la marca', async () => {
    const repository = await git.abortOperation('bitacora');

    expect(repository.operation).toEqual({ kind: 'none' });
    expect((await git.readStatus('bitacora')).conflicted).toEqual([]);
  });

  it('continuar sin haber decidido vuelve a fallar igual', async () => {
    await git.merge('gitthul', 'fix/push-rechazado').catch(() => null);

    await expect(git.continueOperation('gitthul')).rejects.toMatchObject({
      code: 'merge.conflict',
      params: { source: 'fix/push-rechazado', target: 'main' },
    });
  });

  it('preparar el archivo en conflicto lo da por resuelto, y entonces continúa', async () => {
    await git.merge('gitthul', 'fix/push-rechazado').catch(() => null);

    for (const change of (await git.readStatus('gitthul')).conflicted) {
      await git.stage('gitthul', [change.path]);
    }

    expect((await git.readStatus('gitthul')).conflicted).toEqual([]);

    const repository = await git.continueOperation('gitthul');

    expect(repository.operation).toEqual({ kind: 'none' });
    expect((await git.readStatus('gitthul')).staged).toEqual([]);
  });
});

describe('red', () => {
  it('traer informa por fases y solo la primera va indeterminada', async () => {
    const seen: TransferProgress[] = [];

    await git.fetch('gitthul', null, { onProgress: (progress) => seen.push(progress) });

    expect(seen.map((progress) => progress.phase)).toEqual(['counting', 'receiving', 'resolving']);
    expect(seen[0]?.total).toBeNull();
    expect(seen[1]?.total).not.toBeNull();
  });

  it('podar quita la remota que ya no tiene local', async () => {
    await git.deleteBranch('gitthul', 'fix/push-rechazado', { force: true });

    const refs = await git.fetch('gitthul', 'origin', { prune: true });

    expect(refs.branches.map((branch) => branch.name)).not.toContain('origin/fix/push-rechazado');
    expect(refs.branches.map((branch) => branch.name)).toContain('origin/dev');
  });

  it('el pull rebasa cuando lo local todavía no está publicado, y lo dice', async () => {
    const result = await git.pull('gitthul');

    expect(result).toEqual({ strategy: 'rebase', reason: 'unpublished', received: 0 });
  });

  it('el pull fusiona cuando ya estaba todo publicado, y lo dice', async () => {
    await git.checkout(
      'gitthul',
      { kind: 'branch', name: 'fix/push-rechazado' },
      { autoStash: true },
    );

    expect(await git.pull('gitthul')).toEqual({
      strategy: 'merge',
      reason: 'published',
      received: 0,
    });
  });

  it('el pull trae lo que había al otro lado y lo integra', async () => {
    await git.checkout('gitthul', { kind: 'branch', name: 'dev' }, { autoStash: true });

    const result = await git.pull('gitthul');
    const dev = (await git.readRefs('gitthul')).branches.find((branch) => branch.name === 'dev');

    expect(result).toMatchObject({ strategy: 'rebase', received: 2 });
    expect(dev).toMatchObject({ behind: 0 });
  });

  it('la estrategia pedida a mano gana, y el motivo se sigue contando', async () => {
    expect(await git.pull('gitthul', { strategy: 'merge' })).toMatchObject({
      strategy: 'merge',
      reason: 'unpublished',
    });
  });

  it('subir deja la rama al día con su remota', async () => {
    const refs = await git.push('gitthul', 'main');
    const main = refs.branches.find((branch) => branch.name === 'main');
    const remote = refs.branches.find((branch) => branch.name === 'origin/main');

    expect(main).toMatchObject({ ahead: 0, behind: 0 });
    expect(remote?.tip).toBe(main?.tip);
  });

  it('el remoto con commits que aquí no están rechaza el push, y la fuerza lo pasa', async () => {
    await expect(git.push('gitthul', 'dev')).rejects.toMatchObject({
      code: 'push.rejected',
      params: { branch: 'dev', remote: 'origin', count: 2 },
    });

    const observed = (await git.readRefs('gitthul')).branches.find(
      (branch) => branch.name === 'origin/dev',
    )?.tip;
    expect(observed).toBeDefined();
    const refs = await git.push('gitthul', 'dev', { expectedRemoteTip: observed });

    expect(refs.branches.find((branch) => branch.name === 'origin/dev')).toMatchObject({
      behind: 0,
    });
  });

  it('una rama sin publicar dice que nadie sabe a dónde mandarla', async () => {
    await expect(git.push('dotfiles', 'main')).rejects.toMatchObject({
      code: 'push.noUpstream',
      params: { branch: 'main' },
    });

    const refs = await git.push('dotfiles', 'main', { remote: 'origin', setUpstream: true });

    expect(refs.branches.find((branch) => branch.name === 'main')?.upstream).toBe('origin/main');
  });

  it('el fallo del remoto se puede encargar sin trucos', async () => {
    git.failNext('push', new GitOperationError('auth.failed', { remote: 'origin' }));

    await expect(git.push('gitthul', 'main')).rejects.toMatchObject({ code: 'auth.failed' });
    await expect(git.push('gitthul', 'main')).resolves.toBeDefined();
  });

  it('cancelar a mitad no es un fallo y no deja el mundo a medias', async () => {
    const before = await git.readRefs('gitthul');
    const controller = new AbortController();

    const pending = git.push(
      'gitthul',
      'main',
      { onProgress: () => controller.abort() },
      { signal: controller.signal },
    );

    const error: unknown = await pending.catch((reason: unknown) => reason);

    expect(isCancelled(error)).toBe(true);
    expect(isGitOperationError(error)).toBe(false);
    expect(await git.readRefs('gitthul')).toEqual(before);
  });

  it('añade, edita y quita remotos sin perder las relaciones al renombrar', async () => {
    const before = await git.readRefs('gitthul');
    const origin = before.remotes.find((remote) => remote.name === 'origin')!;
    await git.addRemote('gitthul', {
      name: 'backup',
      fetchUrl: 'https://example.invalid/backup.git',
      pushUrl: 'ssh://example.invalid/backup.git',
    });
    const renamed = await git.updateRemote(
      'gitthul',
      'origin',
      { name: 'upstream', fetchUrl: origin.fetchUrl, pushUrl: origin.pushUrl },
      { fetchUrl: origin.fetchUrl, pushUrl: origin.pushUrl },
    );

    expect(renamed.remotes.map((remote) => remote.name)).toEqual(['upstream', 'backup']);
    expect(renamed.branches.some((branch) => branch.name === 'upstream/main')).toBe(true);
    expect(renamed.branches.find((branch) => branch.name === 'main')?.upstream).toBe(
      'upstream/main',
    );

    const after = await git.removeRemote('gitthul', 'upstream', {
      fetchUrl: origin.fetchUrl,
      pushUrl: origin.pushUrl,
    });
    expect(after.remotes.map((remote) => remote.name)).toEqual(['backup']);
    expect(after.branches.some((branch) => branch.kind === 'remote')).toBe(false);
    expect(after.branches.find((branch) => branch.name === 'main')?.upstream).toBeUndefined();
  });

  it('rechaza colisiones y precondiciones obsoletas sin escribir', async () => {
    const refs = await git.readRefs('gitthul');
    const origin = refs.remotes.find((remote) => remote.name === 'origin')!;

    await expect(git.addRemote('gitthul', origin)).rejects.toMatchObject({
      code: 'remote.exists',
      params: { remote: 'origin' },
    });
    await expect(
      git.removeRemote('gitthul', 'origin', { fetchUrl: 'cambió', pushUrl: origin.pushUrl }),
    ).rejects.toMatchObject({ code: 'remote.stale', params: { remote: 'origin' } });
    expect(await git.readRefs('gitthul')).toEqual(refs);
  });
});

describe('worktrees', () => {
  const path = '/home/example/projects/gitthul-dev';
  const branch = { kind: 'branch', name: 'dev' } as const;

  it('el worktree nuevo es un repositorio más, y su rama queda tomada', async () => {
    const summary = await git.createWorktree('gitthul', path, branch);
    const refs = await git.readRefs('gitthul');
    const dev = refs.branches.find((candidate) => candidate.name === 'dev');

    expect(summary).toMatchObject({ path, head: 'dev', worktreeOf: 'gitthul' });
    expect(refs.worktrees.map((worktree) => worktree.path)).toContain(path);
    expect(dev?.checkedOutIn).toBe(path);
    expect((await git.listRepositories()).map((repo) => repo.id)).toContain(summary.id);
  });

  it('la carpeta ocupada y la rama tomada fallan nombrándolas', async () => {
    await git.createWorktree('gitthul', path, branch);

    await expect(
      git.createWorktree('gitthul', '/home/example/projects/bitacora', {
        kind: 'branch',
        name: 'main',
      }),
    ).rejects.toMatchObject({
      code: 'worktree.pathNotEmpty',
      params: { path: '/home/example/projects/bitacora' },
    });

    await expect(
      git.createWorktree('gitthul', '/home/example/projects/otro', branch),
    ).rejects.toMatchObject({ code: 'worktree.branchInUse', params: { branch: 'dev', path } });
  });

  it('bloquearlo lo protege de quitarlo, y con fuerza se va con su repositorio', async () => {
    const summary = await git.createWorktree('gitthul', path, branch);

    await git.lockWorktree('gitthul', path, true);

    const kept = await git.removeWorktree('gitthul', path);

    expect(kept.worktrees.map((worktree) => worktree.path)).toContain(path);

    const refs = await git.removeWorktree('gitthul', path, { force: true });

    expect(refs.worktrees.map((worktree) => worktree.path)).not.toContain(path);
    expect(
      refs.branches.find((candidate) => candidate.name === 'dev')?.checkedOutIn,
    ).toBeUndefined();
    expect((await git.listRepositories()).map((repo) => repo.id)).not.toContain(summary.id);
  });

  it('el principal no se quita', async () => {
    const before = await git.readRefs('gitthul');

    expect(await git.removeWorktree('gitthul', '/home/example/projects/gitthul')).toBe(before);
  });
});

describe('deshacer y rehacer', () => {
  it('preparar varios archivos es un solo paso recuperable', async () => {
    const before = await git.readStatus('gitthul');
    const paths = before.unstaged.slice(0, 2).map((file) => file.path);
    const after = await git.stage('gitthul', paths);
    expect((await git.readUndoStack('gitthul')).undo).toHaveLength(1);
    await git.undo('gitthul');
    expect(await git.readStatus('gitthul')).toEqual(before);
    await git.redo('gitthul');
    expect(await git.readStatus('gitthul')).toEqual(after);
  });

  it('descartar guarda el estado y una nueva preparación invalida Rehacer', async () => {
    const before = await git.readStatus('gitthul');
    const path = before.unstaged[0]!.path;
    const diff = await git.readDiff('gitthul', { path, source: { kind: 'worktree' } });
    const after = await git.discard('gitthul', [{ path, precondition: diff.precondition }]);
    await git.undo('gitthul');
    expect(await git.readStatus('gitthul')).toEqual(before);
    await git.redo('gitthul');
    expect(await git.readStatus('gitthul')).toEqual(after);
    await git.undo('gitthul');
    await git.stage('gitthul', [path]);
    expect((await git.readUndoStack('gitthul')).redo).toEqual([]);
  });

  it('la pila crece con lo que se hizo, nombrando sus ramas', async () => {
    await git.merge('gitthul', 'dev');

    const { undo, redo } = await git.readUndoStack('gitthul');

    expect(undo).toHaveLength(1);
    expect(undo[0]).toMatchObject({
      labelKey: 'undo.merge',
      params: { source: 'dev', target: 'main' },
      undoable: true,
    });
    expect(redo).toEqual([]);
  });

  it('deshacer devuelve el repositorio a como estaba, y rehacer lo vuelve a aplicar', async () => {
    const before = await git.readRefs('gitthul');

    await git.merge('gitthul', 'dev');

    const merged = await git.readRefs('gitthul');

    await git.undo('gitthul');

    expect(await git.readRefs('gitthul')).toEqual(before);
    expect((await git.readUndoStack('gitthul')).redo).toHaveLength(1);

    await git.redo('gitthul');

    expect(await git.readRefs('gitthul')).toEqual(merged);
    expect((await git.readUndoStack('gitthul')).undo).toHaveLength(1);
  });

  it('el push establece un límite que no modifica historia compartida', async () => {
    await git.push('gitthul', 'main');

    expect((await git.readUndoStack('gitthul')).undo[0]).toMatchObject({
      labelKey: 'undo.pushShared',
      undoable: false,
    });
    await expect(git.undo('gitthul')).rejects.toMatchObject({ code: 'undo.stale' });

    const [, , third] = (await git.readCommits('gitthul', { limit: 4 })).commits;

    await git.reset('gitthul', third?.sha ?? '', 'mixed');
    await git.createBranch('gitthul', 'suelta', { kind: 'branch', name: 'main' });
    const observed = (await git.readRefs('gitthul')).branches.find(
      (branch) => branch.name === 'origin/main',
    )?.tip;
    await git.push('gitthul', 'main', { expectedRemoteTip: observed });

    expect((await git.readUndoStack('gitthul')).undo.map((entry) => entry.labelKey)).toEqual([
      'undo.pushShared',
      'undo.createBranch',
      'undo.reset',
      'undo.pushShared',
    ]);
  });

  it('escribir algo nuevo vacía lo que había para rehacer', async () => {
    await git.merge('gitthul', 'dev');
    await git.undo('gitthul');

    expect((await git.readUndoStack('gitthul')).redo).toHaveLength(1);

    await git.createBranch('gitthul', 'otra', { kind: 'branch', name: 'main' });

    expect((await git.readUndoStack('gitthul')).redo).toEqual([]);
  });

  it('sin nada que deshacer no pasa nada', async () => {
    const repository = await git.readRepository('dotfiles');

    expect(await git.undo('dotfiles')).toEqual(repository);
    expect(await git.redo('dotfiles')).toEqual(repository);
  });
});

describe('resolución de conflictos', () => {
  /** El repositorio del fixture que nació con una fusión a medias. */
  const REPO = 'bitacora';

  it('bitacora trae las seis clases de conflicto', async () => {
    const { conflicted } = await git.readStatus(REPO);
    const kinds = new Set(conflicted.map((change) => change.conflict));

    expect(kinds).toEqual(
      new Set([
        'bothModified',
        'bothAdded',
        'deletedByUs',
        'deletedByThem',
        'addedByUs',
        'addedByThem',
      ]),
    );
  });

  it('rechaza una resolución obsoleta sin cambiar el conflicto y acepta la revisión leída', async () => {
    const before = await git.readConflict(REPO, 'docs/plan.md');
    await expect(
      git.resolveConflict(REPO, 'docs/plan.md', 'incorrecto', { expectedRevision: 'anterior' }),
    ).rejects.toMatchObject({ code: 'write.stale' });
    expect(await git.readConflict(REPO, 'docs/plan.md')).toEqual(before);
    await git.resolveConflict(REPO, 'docs/plan.md', 'resuelto', {
      expectedRevision: before.revision,
    });
    expect((await git.readStatus(REPO)).conflicted.map((file) => file.path)).not.toContain(
      'docs/plan.md',
    );
  });

  it('resolver un archivo lo pasa al stage y le quita sus tres versiones', async () => {
    const status = await git.resolveConflict(REPO, 'docs/plan.md', 'ya está resuelto\n');

    expect(status.conflicted.map((change) => change.path)).not.toContain('docs/plan.md');
    expect(status.staged.map((change) => change.path)).toContain('docs/plan.md');

    await expect(git.readConflict(REPO, 'docs/plan.md')).rejects.toBeInstanceOf(GitOperationError);
  });

  it('dejar sin resolver lo devuelve a conflicto, con sus tres versiones otra vez', async () => {
    await git.resolveConflict(REPO, 'docs/plan.md', 'ya está resuelto\n');

    const status = await git.unresolveConflict(REPO, 'docs/plan.md');

    expect(status.conflicted.map((change) => change.path)).toContain('docs/plan.md');

    const conflict = await git.readConflict(REPO, 'docs/plan.md');

    expect(conflict.oursLabel).toBe('main');
    expect(conflict.theirsLabel).toBe('redaccion');
  });

  it('marcar el contenido actual permite desresolver después', async () => {
    const marked = await git.markConflictResolved(REPO, 'docs/plan.md');

    expect(marked.staged.map((change) => change.path)).toContain('docs/plan.md');

    const restored = await git.unresolveConflict(REPO, 'docs/plan.md');

    expect(restored.conflicted.map((change) => change.path)).toContain('docs/plan.md');
  });

  it('resolver lo que ya no está en conflicto no escribe ni lanza', async () => {
    const before = await git.readStatus(REPO);
    const after = await git.resolveConflict(REPO, 'no/existe.ts', 'nada');

    expect(after.conflicted).toEqual(before.conflicted);
  });

  it('quedarse con un lado resuelve sin pedir texto', async () => {
    const status = await git.keepSide(REPO, 'brand/icons/icon.ico', 'theirs');

    expect(status.conflicted.map((change) => change.path)).not.toContain('brand/icons/icon.ico');
    expect(status.staged.map((change) => change.path)).toContain('brand/icons/icon.ico');
  });

  it('el archivo que pasa del tope llega sin texto y con sus cifras', async () => {
    const conflict = await git.readConflict(REPO, 'assets/traducciones.po');

    expect(conflict.tooLarge).toBe(true);
    expect(conflict.ours).toBeNull();
    expect(conflict.theirs).toBeNull();
    expect(conflict.sizes.ours.lines).toBeGreaterThan(CONFLICT_TEXT_LIMIT.lines);
    expect(exceedsConflictLimit(conflict.sizes.ours)).toBe(true);
  });

  it('la autoresolución cierra lo inequívoco y no toca lo demás', async () => {
    const { resolved, status } = await git.autoResolve(REPO);

    expect(resolved.map((entry) => entry.path)).toEqual(['.gitignore']);
    expect(resolved.every((entry) => entry.origin === 'auto')).toBe(true);
    expect(status.conflicted.map((change) => change.path)).not.toContain('.gitignore');

    // Lo que pide una decisión se queda: nada de heurísticas que acierten mal.
    expect(status.conflicted.map((change) => change.path)).toContain('docs/plan.md');
    expect(status.conflicted.map((change) => change.path)).toContain('assets/traducciones.po');
  });

  it('la autoresolución es determinista: dos veces, lo mismo', async () => {
    const otro = createMockGitPort({ latency: NO_LATENCY });
    const [uno, dos] = await Promise.all([git.autoResolve(REPO), otro.autoResolve(REPO)]);

    expect(uno.resolved).toEqual(dos.resolved);
  });
});

describe('el diff sigue al stage', () => {
  /** Las líneas que el archivo tiene cambiadas, para preparar solo una. */
  const linesOf = (
    hunks: readonly { lines: readonly { kind: string; newLine: number | null }[] }[],
  ) =>
    hunks.flatMap((hunk) =>
      hunk.lines.flatMap((line) =>
        line.kind === 'added' && line.newLine !== null ? [line.newLine] : [],
      ),
    );

  it('lo preparado sale del árbol de trabajo y aparece en el índice', async () => {
    const before = await git.readDiff('gitthul', {
      path: 'docs/inventario.md',
      source: { kind: 'worktree' },
    });

    if (before.content.kind !== 'text') throw new Error('se esperaba un diff de texto');

    const all = linesOf(before.content.hunks);
    const first = all[0];

    if (first === undefined) throw new Error('el archivo no trae líneas cambiadas');

    await git.stageLines(
      'gitthul',
      partial('docs/inventario.md', { lines: [{ side: 'new', line: first }] }),
    );

    const worktree = await git.readDiff('gitthul', {
      path: 'docs/inventario.md',
      source: { kind: 'worktree' },
    });
    const index = await git.readDiff('gitthul', {
      path: 'docs/inventario.md',
      source: { kind: 'index' },
    });

    if (worktree.content.kind !== 'text' || index.content.kind !== 'text') {
      throw new Error('se esperaban diffs de texto');
    }

    expect(linesOf(worktree.content.hunks)).not.toContain(first);
    expect(linesOf(index.content.hunks)).toEqual([first]);
  });

  it('sin nada preparado, el índice no enseña ningún cambio', async () => {
    const index = await git.readDiff('gitthul', {
      path: 'docs/inventario.md',
      source: { kind: 'index' },
    });

    if (index.content.kind !== 'text') throw new Error('se esperaba un diff de texto');

    expect(index.content.hunks).toEqual([]);
  });

  it('un commit no descuenta el stage: es historia escrita', async () => {
    const [commit] = (await git.readCommits('gitthul', { limit: 1 })).commits;
    const details = await git.readCommit('gitthul', commit?.sha ?? '');
    const file = details.files[0];

    if (!file) throw new Error('el commit no trae archivos');

    const diff = await git.readDiff('gitthul', {
      path: file.path,
      source: { kind: 'commit', sha: commit?.sha ?? '' },
    });

    if (diff.content.kind !== 'text') return;

    expect(diff.content.hunks.length).toBeGreaterThan(0);
  });
});

describe('determinismo y cancelación', () => {
  it('dos adaptadores con la misma semilla cuentan la misma historia', async () => {
    const otro = createMockGitPort({ latency: NO_LATENCY });
    const [uno, dos] = await Promise.all([
      git.readCommits('gitthul', { limit: 20 }),
      otro.readCommits('gitthul', { limit: 20 }),
    ]);

    expect(uno.commits.map((commit) => commit.sha)).toEqual(
      dos.commits.map((commit) => commit.sha),
    );
  });

  it('otra semilla cuenta otra historia', async () => {
    const otro = createMockGitPort({ latency: NO_LATENCY, seed: 1234 });
    const [uno, dos] = await Promise.all([
      git.readCommits('gitthul', { limit: 20 }),
      otro.readCommits('gitthul', { limit: 20 }),
    ]);

    expect(uno.commits[0]?.sha).not.toBe(dos.commits[0]?.sha);
  });

  it('cancelar no es fallar', async () => {
    const lento = createMockGitPort({ latency: { min: 50, max: 50 } });
    const controller = new AbortController();
    const pending = lento.listRepositories({ signal: controller.signal });

    controller.abort();

    const error: unknown = await pending.catch((reason: unknown) => reason);

    expect(isCancelled(error)).toBe(true);
    expect(isGitOperationError(error)).toBe(false);
  });
});

describe('readTree', () => {
  it('devuelve entradas ordenadas por path', async () => {
    const tree = await git.readTree('gitthul');

    const paths = tree.map((entry) => entry.path);

    // Verificar que está ordenado.
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));

    expect(paths).toEqual(sorted);
  });

  it('incluye archivos y directorios', async () => {
    const tree = await git.readTree('gitthul');

    const files = tree.filter((entry) => entry.kind === 'file');
    const dirs = tree.filter((entry) => entry.kind === 'directory');

    expect(files.length).toBeGreaterThan(0);
    expect(dirs.length).toBeGreaterThan(0);
  });

  it('incluye las rutas que los hunks del fixture conocen', async () => {
    const tree = await git.readTree('gitthul');
    const paths = new Set(tree.map((entry) => entry.path));

    // Estas rutas vienen del vocabulario del fixture.
    expect(paths.has('src/app/Shell.tsx')).toBe(true);
    expect(paths.has('src/design/roles.css')).toBe(true);
    expect(paths.has('docs/plan.md')).toBe(true);
    expect(paths.has('package.json')).toBe(true);
    expect(paths.has('README.md')).toBe(true);
  });

  it('incluye directorios extraídos de las rutas de archivo', async () => {
    const tree = await git.readTree('gitthul');
    const dirs = new Set(tree.filter((e) => e.kind === 'directory').map((e) => e.path));

    expect(dirs.has('src')).toBe(true);
    expect(dirs.has('src/app')).toBe(true);
    expect(dirs.has('src/design')).toBe(true);
    expect(dirs.has('docs')).toBe(true);
  });
});

/**
 * Los catorce menús contextuales de la sección 4.2 del subplan.
 *
 * Puro y sin React: cada función recibe su objeto y devuelve `MenuEntry[]`, así
 * que la redacción de cada entrada —que es lo que la invariante 5 vigila— se
 * prueba sin montar nada. Quien los pinta es `ContextMenu`, y quien ejecuta es
 * `useWorkingActions`; aquí solo se decide **qué se ofrece y cómo se llama**.
 *
 * **Una entrada sin flujo detrás se pinta deshabilitada, con su rótulo
 * completo.** Es el criterio que `GitActionBar` fijó en F2.2 con sus siete
 * botones: la acción existe en el menú desde el día en que el menú existe, y lo
 * que llega en su fase es el `run()`. Cada `disabled: true` de este archivo
 * lleva anotada la fase que lo enciende. Y por la misma regla, **ninguna de
 * ellas se declara en el registro de gestos**: un gesto sin `run()` no es un
 * gesto.
 */

import type { Sha } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { DiffSource } from '@core/domain/diff';
import type { Branch, Remote, RefTarget, Stash, Tag, Worktree } from '@core/domain/refs';
import { stashName } from '@core/domain/refs';
import type { FileChange } from '@core/domain/status';
import type { MessageParams } from '@i18n/format';
import type { MessageKey } from '@i18n/messages';
import type { MenuEntry } from '@ui/menuUtils';

import type { GraphNodeForm } from './graphPaint';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Un extremo de una comparación.
 *
 * Viajan juntos lo que el puerto resuelve —`ref`, que puede ser un nombre de
 * rama, uno de tag o un SHA entero— y lo que la cabecera enseña —`label`, que de
 * un commit es su SHA corto—. Sin el segundo, `ComparePanel` tendría que adivinar
 * si lo que le llegó es un nombre o cuarenta caracteres de hexadecimal.
 */
export type CompareSide =
  | {
      /** Omitido por compatibilidad con los caminos de rama/tag ya existentes. */
      kind?: 'revision';
      ref: string;
      label: string;
    }
  | {
      /** El índice y el árbol de trabajo actuales; no se disfraza de SHA. */
      kind: 'wip';
      label: string;
    };

/** Las cinco secciones del panel izquierdo, para su menú de cabecera. */
export type RefSectionKey = 'locals' | 'remotes' | 'tags' | 'stashes' | 'worktrees';

/**
 * Todo lo que los menús saben pedir.
 *
 * Va como un solo objeto y no como parámetros sueltos porque catorce menús
 * comparten casi todas las acciones: copiar, crear una rama, ver el historial y
 * abrir la carpeta salen en media docena de ellos, y repetir sus firmas en cada
 * constructor sería el mismo error que la regla de «un hecho, un archivo».
 */
export interface WorkingMenuActions {
  checkout: (target: RefTarget, label: string) => void;
  activateRemoteBranch: (remote: Branch, local?: Branch) => void;
  createBranch: (from: RefTarget, fromLabel: string) => void;
  renameBranch: (branch: string, expectedTip: Sha) => void;
  deleteBranch: (branch: string, expectedTip: Sha) => void;
  createTag: (at: RefTarget, atLabel: string) => void;
  deleteTag: (tag: string, expectedTip: Sha) => void;
  createWorktree: (branch: string | null) => void;
  openWorktree: (worktree: Worktree) => void;
  lockWorktree: (worktree: Worktree, locked: boolean) => void;
  removeWorktree: (worktree: Worktree) => void;
  fetchRemote: (remote: string) => void;
  addRemote: () => void;
  editRemote: (remote: Remote) => void;
  manageRemoteCredentials: (remote: Remote) => void;
  removeRemote: (remote: Remote) => void;
  cherryPick: (shas: readonly Sha[], contiguous: boolean) => void;
  revert: (shas: readonly Sha[], contiguous: boolean) => void;
  reset: (sha: Sha, mode: 'soft' | 'mixed' | 'hard') => void;
  stage: (paths: readonly string[]) => void;
  unstage: (paths: readonly string[]) => void;
  discard: (paths: readonly string[]) => void;
  /** Abre la vista previa de traer una rama a la rama activa, sin escribir. */
  previewIntegration: (kind: 'merge' | 'rebase', source: string, target: string) => void;
  /** Comparar dos extremos —ramas, tags o commits— en el panel derecho. */
  compare: (source: CompareSide, target: CompareSide) => void;
  ignorePath: (pattern: string, untrack: boolean) => void;
  viewFileHistory: (path: string, at?: Sha) => void;
  /** Abre el visor de diff sobre un archivo, con el origen que toque — CU-5. */
  openDiff: (path: string, source: DiffSource) => void;
  /** Guarda una selección de archivos en stash. */
  stashPaths: (paths: readonly string[]) => void;
  pop: (stash: Stash, drop: boolean) => void;
  dropStash: (stash: Stash) => void;
  reveal: (path: string) => void;
  copy: (text: string) => void;
  goToNode: (sha: Sha) => void;
  setNodeForm: (form: GraphNodeForm) => void;
  setAllSectionsCollapsed: (collapsed: boolean) => void;
}

export interface MenuBuildContext {
  t: Translate;
  actions: WorkingMenuActions;
  /** La rama activa: toda acción de integración la nombra como destino. */
  headBranch: string | null;
  /** El primer remoto, que es el que las frases nombran cuando hay uno solo. */
  defaultRemote: string | null;
  /** Referencias visibles, para distinguir crear, avanzar o alinear una rama local. */
  branches: readonly Branch[];
  /** Enmendar solo la punta actual; abrir el editor todavía no escribe en Git. */
  amend?: { sha: Sha; open: () => void };
}

function separator(key: string): MenuEntry {
  return { kind: 'separator', key };
}

/** Sin rama activa —HEAD desacoplado— no hay destino que nombrar. */
function targetName(context: MenuBuildContext): string {
  return context.headBranch ?? context.t('working.menu.detachedHead');
}

/*
 * ── 1 · Commit ──────────────────────────────────────────────────────────────
 */

export function commitMenu(
  context: MenuBuildContext,
  commit: { sha: Sha; summary: string },
): readonly MenuEntry[] {
  const { t, actions } = context;
  const sha = shortSha(commit.sha);
  const branch = targetName(context);
  const detached = context.headBranch === null;
  const amend = context.amend;

  return [
    ...(amend?.sha === commit.sha
      ? [{ key: 'amend', label: `${t('working.composer.amend')}…`, onSelect: amend.open }]
      : []),
    {
      key: 'cherryPick',
      label: t('working.menu.commit.cherryPick', { sha, branch }),
      disabled: detached,
      onSelect: () => {
        actions.cherryPick([commit.sha], true);
      },
    },
    {
      key: 'revert',
      label: t('working.menu.commit.revert', { sha, branch }),
      disabled: detached,
      onSelect: () => {
        actions.revert([commit.sha], true);
      },
    },
    {
      key: 'reset',
      label: `${t('working.menu.commit.reset', { sha, branch })}…`,
      disabled: detached,
      onSelect: () => actions.reset(commit.sha, 'soft'),
    },
    separator('s1'),
    {
      key: 'createBranch',
      label: t('working.menu.commit.createBranch', { sha }),
      onSelect: () => {
        actions.createBranch({ kind: 'commit', sha: commit.sha }, sha);
      },
    },
    {
      key: 'createTag',
      label: t('working.menu.commit.createTag', { sha }),
      onSelect: () => {
        actions.createTag({ kind: 'commit', sha: commit.sha }, sha);
      },
    },
    // Comparar vive en `ComparePanel`, el estado de comparación del panel
    // derecho: el commit contra la punta de la rama activa.
    {
      key: 'compare',
      label: t('working.menu.commit.compare', { sha, branch }),
      disabled: detached,
      onSelect: () => {
        if (context.headBranch === null) return;

        actions.compare(
          { ref: commit.sha, label: sha },
          { ref: `refs/heads/${context.headBranch}`, label: context.headBranch },
        );
      },
    },
    separator('s2'),
    {
      key: 'copySha',
      label: t('working.menu.copySha'),
      onSelect: () => {
        actions.copy(commit.sha);
      },
    },
    {
      key: 'copyMessage',
      label: t('working.menu.copyMessage'),
      onSelect: () => {
        actions.copy(commit.summary);
      },
    },
  ];
}

/*
 * ── 2 · Selección de N commits ──────────────────────────────────────────────
 */

export function commitSelectionMenu(
  context: MenuBuildContext,
  selection: { shas: readonly Sha[]; contiguous: boolean },
): readonly MenuEntry[] {
  const { t, actions } = context;
  const count = selection.shas.length;
  const branch = targetName(context);
  const detached = context.headBranch === null;

  const items: MenuEntry[] = [
    {
      key: 'cherryPick',
      label: t('working.menu.selection.cherryPick', { count, branch }),
      disabled: detached,
      onSelect: () => {
        actions.cherryPick(selection.shas, selection.contiguous);
      },
    },
    {
      key: 'revert',
      label: t('working.menu.selection.revert', { count, branch }),
      disabled: detached,
      onSelect: () => {
        actions.revert(selection.shas, selection.contiguous);
      },
    },
  ];

  items.push(separator('s1'), {
    key: 'copyShas',
    label: t('working.menu.selection.copyShas', { count }),
    onSelect: () => {
      actions.copy(selection.shas.join('\n'));
    },
  });

  return items;
}

/*
 * ── 3 · Rama local ──────────────────────────────────────────────────────────
 */

export function localBranchMenu(context: MenuBuildContext, branch: Branch): readonly MenuEntry[] {
  const { t, actions } = context;
  const source = branch.name;
  const target = targetName(context);
  const remote = context.defaultRemote;
  const upstream = branch.upstream ?? (remote === null ? null : `${remote}/${branch.name}`);
  const remoteOf = upstream === null ? null : (upstream.split('/')[0] ?? null);

  return [
    {
      key: 'checkout',
      label: t('working.menu.branch.checkout', { branch: source }),
      disabled: branch.isHead,
      onSelect: () => {
        actions.checkout({ kind: 'branch', name: source }, source);
      },
    },
    separator('s1'),
    // Fusionar y rebasar por menú son el segundo camino a la vista previa que
    // F2.7 construye con el arrastre; al pulsar se abre el panel de vista previa.
    {
      key: 'merge',
      label: t('working.menu.merge', { source, target }),
      disabled: context.headBranch === null || branch.isHead,
      onSelect: () => {
        if (context.headBranch === null || branch.isHead) return;

        actions.previewIntegration('merge', source, target);
      },
    },
    {
      key: 'rebase',
      label: t('working.menu.rebase', { source, target }),
      disabled: context.headBranch === null || branch.isHead,
      onSelect: () => {
        if (context.headBranch === null || branch.isHead) return;

        actions.previewIntegration('rebase', source, target);
      },
    },
    {
      key: 'compare',
      label: t('working.menu.compare', { source, target }),
      disabled: context.headBranch === null || branch.isHead,
      onSelect: () => {
        actions.compare(
          { ref: branch.id, label: source },
          { ref: `refs/heads/${target}`, label: target },
        );
      },
    },
    separator('s2'),
    // Publicar y fijar la remota de seguimiento comparten fase con Push: F2.9.
    {
      key: 'publish',
      label: t('working.menu.branch.publish', {
        branch: source,
        remote: remote ?? t('working.menu.noRemote'),
      }),
      disabled: true,
      onSelect: () => undefined,
    },
    {
      key: 'fetch',
      label: t('working.menu.branch.fetch', { branch: upstream ?? source }),
      disabled: remoteOf === null,
      onSelect: () => {
        if (remoteOf !== null) actions.fetchRemote(remoteOf);
      },
    },
    {
      key: 'setUpstream',
      label: t('working.menu.branch.setUpstream', { branch: upstream ?? source }),
      disabled: true,
      onSelect: () => undefined,
    },
    separator('s3'),
    {
      key: 'createBranch',
      label: t('working.menu.branch.createBranch', { branch: source }),
      onSelect: () => {
        actions.createBranch({ kind: 'branch', name: source }, source);
      },
    },
    {
      key: 'createTag',
      label: t('working.menu.branch.createTag', { branch: source }),
      onSelect: () => {
        actions.createTag({ kind: 'branch', name: source }, source);
      },
    },
    {
      key: 'createWorktree',
      label: t('working.menu.branch.createWorktree', { branch: source }),
      onSelect: () => {
        actions.createWorktree(source);
      },
    },
    separator('s4'),
    {
      key: 'rename',
      label: t('working.menu.branch.rename', { branch: source }),
      onSelect: () => {
        actions.renameBranch(source, branch.tip);
      },
    },
    {
      key: 'delete',
      label: t('working.menu.branch.delete', { branch: source }),
      danger: true,
      disabled: branch.isHead,
      onSelect: () => {
        actions.deleteBranch(source, branch.tip);
      },
    },
    separator('s5'),
    {
      key: 'copyName',
      label: t('working.menu.copyName'),
      onSelect: () => {
        actions.copy(source);
      },
    },
    {
      key: 'goToNode',
      label: t('working.menu.goToNode'),
      onSelect: () => {
        actions.goToNode(branch.tip);
      },
    },
  ];
}

/*
 * ── 4 · Rama remota ─────────────────────────────────────────────────────────
 */

export function remoteBranchMenu(context: MenuBuildContext, branch: Branch): readonly MenuEntry[] {
  const { t, actions } = context;
  const source = branch.name;
  const target = targetName(context);
  const remote = branch.remote ?? context.defaultRemote;
  const remoteName = remote ?? source.split('/')[0] ?? source;
  const shortName = source.startsWith(`${remoteName}/`)
    ? source.slice(remoteName.length + 1)
    : source;
  const local = context.branches.find(
    (candidate) =>
      candidate.kind === 'local' &&
      (candidate.upstream === branch.name || candidate.name === shortName),
  );
  const checkoutHint =
    local === undefined
      ? t('working.menu.remoteBranch.checkoutHint', { branch: source })
      : local.tip === branch.tip
        ? t('working.menu.remoteBranch.checkoutHintExisting', { branch: local.name })
        : local.ahead === 0 && local.behind > 0
          ? t('working.menu.remoteBranch.checkoutHintFastForward', {
              branch: local.name,
              remote: source,
            })
          : t('working.menu.remoteBranch.checkoutHintDiverged', {
              branch: local.name,
              remote: source,
            });

  return [
    {
      key: 'checkout',
      label: t('working.menu.remoteBranch.checkout', { branch: source }),
      description: checkoutHint,
      onSelect: () => {
        actions.activateRemoteBranch(branch, local);
      },
    },
    separator('s1'),
    {
      key: 'merge',
      label: t('working.menu.merge', { source, target }),
      disabled: context.headBranch === null,
      onSelect: () => {
        if (context.headBranch === null) return;

        actions.previewIntegration('merge', source, target);
      },
    },
    {
      key: 'rebase',
      label: t('working.menu.rebase', { source, target }),
      disabled: context.headBranch === null,
      onSelect: () => {
        if (context.headBranch === null) return;

        actions.previewIntegration('rebase', source, target);
      },
    },
    {
      key: 'compare',
      label: t('working.menu.compare', { source, target }),
      disabled: context.headBranch === null,
      onSelect: () => {
        actions.compare(
          { ref: branch.id, label: source },
          { ref: `refs/heads/${target}`, label: target },
        );
      },
    },
    separator('s2'),
    {
      key: 'fetch',
      label: t('working.menu.branch.fetch', { branch: source }),
      disabled: remote === null,
      onSelect: () => {
        if (remote !== null) actions.fetchRemote(remote);
      },
    },
    // Borrar una rama en el remoto es un push con `--delete`, y ni `GitPort` lo
    // declara ni Push existe todavía: F2.9.
    {
      key: 'delete',
      label: t('working.menu.remoteBranch.delete', {
        branch: source,
        remote: remote ?? t('working.menu.noRemote'),
      }),
      danger: true,
      disabled: true,
      onSelect: () => undefined,
    },
    separator('s3'),
    {
      key: 'createBranch',
      label: t('working.menu.branch.createBranch', { branch: source }),
      onSelect: () => {
        actions.createBranch(
          { kind: 'remoteBranch', name: source, remote: remote ?? source.split('/')[0] ?? source },
          source,
        );
      },
    },
    {
      key: 'copyName',
      label: t('working.menu.copyName'),
      onSelect: () => {
        actions.copy(source);
      },
    },
  ];
}

/*
 * ── 5 · Tag ─────────────────────────────────────────────────────────────────
 */

export function tagMenu(context: MenuBuildContext, tag: Tag): readonly MenuEntry[] {
  const { t, actions } = context;
  const name = tag.name;
  const branch = targetName(context);
  const remote = context.defaultRemote;

  return [
    {
      key: 'checkout',
      label: t('working.menu.tag.checkout', { tag: name }),
      description: t('working.menu.tag.checkoutHint'),
      onSelect: () => {
        actions.checkout({ kind: 'tag', name }, name);
      },
    },
    separator('s1'),
    {
      key: 'createBranch',
      label: t('working.menu.tag.createBranch', { tag: name }),
      onSelect: () => {
        actions.createBranch({ kind: 'tag', name }, name);
      },
    },
    {
      key: 'compare',
      label: t('working.menu.compare', { source: name, target: branch }),
      disabled: context.headBranch === null,
      onSelect: () => {
        actions.compare(
          { ref: tag.id, label: name },
          { ref: `refs/heads/${branch}`, label: branch },
        );
      },
    },
    separator('s2'),
    {
      key: 'publish',
      label: t('working.menu.tag.publish', {
        tag: name,
        remote: remote ?? t('working.menu.noRemote'),
      }),
      disabled: true,
      onSelect: () => undefined,
    },
    {
      key: 'delete',
      label: t('working.menu.tag.delete', { tag: name }),
      danger: true,
      onSelect: () => {
        actions.deleteTag(name, tag.target);
      },
    },
    separator('s3'),
    {
      key: 'copyName',
      label: t('working.menu.copyName'),
      onSelect: () => {
        actions.copy(name);
      },
    },
    {
      key: 'goToNode',
      label: t('working.menu.goToNode'),
      onSelect: () => {
        actions.goToNode(tag.target);
      },
    },
  ];
}

/*
 * ── 6 · Guardado ────────────────────────────────────────────────────────────
 */

export function stashMenu(context: MenuBuildContext, stash: Stash): readonly MenuEntry[] {
  const { t, actions } = context;
  const name = stashName(stash);
  const branch = targetName(context);

  return [
    // Pop, aplicar y descartar son de F2.8, la fase de las operaciones locales.
    {
      key: 'pop',
      label: t('working.menu.stash.pop', { stash: name, branch }),
      onSelect: () => {
        actions.pop(stash, true);
      },
    },
    {
      key: 'apply',
      label: t('working.menu.stash.apply', { stash: name, branch }),
      onSelect: () => {
        actions.pop(stash, false);
      },
    },
    separator('s1'),
    {
      key: 'createBranch',
      label: t('working.menu.stash.createBranch', { stash: name }),
      onSelect: () => {
        actions.createBranch({ kind: 'commit', sha: stash.sha }, name);
      },
    },
    {
      key: 'files',
      label: t('working.menu.stash.files', { count: stash.fileCount, stash: name }),
      disabled: true,
      onSelect: () => undefined,
    },
    separator('s2'),
    {
      key: 'drop',
      label: t('working.menu.stash.drop', { stash: name }),
      danger: true,
      onSelect: () => {
        actions.dropStash(stash);
      },
    },
  ];
}

/*
 * ── 7 · Worktree ────────────────────────────────────────────────────────────
 */

export function worktreeMenu(context: MenuBuildContext, worktree: Worktree): readonly MenuEntry[] {
  const { t, actions } = context;
  const name = worktree.name;

  const items: MenuEntry[] = [
    {
      key: 'open',
      label: t('working.menu.worktree.open', { worktree: name }),
      disabled: worktree.missing,
      onSelect: () => {
        actions.openWorktree(worktree);
      },
    },
    {
      key: 'reveal',
      label: t('working.menu.revealFolder'),
      disabled: worktree.missing,
      onSelect: () => {
        actions.reveal(worktree.path);
      },
    },
    separator('s1'),
    {
      key: 'lock',
      disabled: worktree.isMain,
      label: worktree.locked
        ? t('working.menu.worktree.unlock', { worktree: name })
        : t('working.menu.worktree.lock', { worktree: name }),
      onSelect: () => {
        actions.lockWorktree(worktree, !worktree.locked);
      },
    },
    separator('s2'),
    {
      key: 'remove',
      label: t('working.menu.worktree.remove', { worktree: name }),
      danger: true,
      disabled: worktree.isMain || worktree.locked,
      onSelect: () => {
        actions.removeWorktree(worktree);
      },
    },
  ];

  // Solo con la carpeta perdida, que es cuando significa algo. Deshabilitada:
  // ningún puerto declara mover un worktree a otra carpeta.
  if (worktree.missing) {
    items.push({
      key: 'locate',
      label: t('working.menu.worktree.locate', { worktree: name }),
      disabled: true,
      onSelect: () => undefined,
    });
  }

  return items;
}

/*
 * ── 8 · Remoto ──────────────────────────────────────────────────────────────
 */

export function remoteMenu(context: MenuBuildContext, remote: Remote): readonly MenuEntry[] {
  const { t, actions } = context;

  return [
    {
      key: 'fetch',
      label: t('working.menu.remote.fetch', { remote: remote.name }),
      onSelect: () => {
        actions.fetchRemote(remote.name);
      },
    },
    {
      key: 'copyUrl',
      label: t('working.menu.remote.copyUrl'),
      onSelect: () => {
        actions.copy(remote.fetchUrl);
      },
    },
    {
      key: 'edit',
      label: t('working.menu.remote.edit', { remote: remote.name }),
      onSelect: () => {
        actions.editRemote(remote);
      },
    },
    {
      key: 'credentials',
      label: t('working.menu.remote.credentials', { remote: remote.name }),
      onSelect: () => actions.manageRemoteCredentials(remote),
    },
    {
      key: 'remove',
      label: t('working.menu.remote.remove', { remote: remote.name }),
      danger: true,
      onSelect: () => {
        actions.removeRemote(remote);
      },
    },
  ];
}

/*
 * ── 9 y 10 · Archivo en Seguimiento y archivo en Stage ──────────────────────
 */

/** El patrón de extensión de una ruta, o `null` si no tiene. */
export function extensionPattern(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');

  return dot > 0 ? `*${name.slice(dot)}` : null;
}

/** La carpeta que contiene la ruta, con barra final; `null` en la raíz. */
export function parentFolder(path: string): string | null {
  const slash = path.lastIndexOf('/');

  return slash > 0 ? path.slice(0, slash + 1) : null;
}

function ignoreItems(
  context: MenuBuildContext,
  path: string,
  untrack: boolean,
): readonly MenuEntry[] {
  const { t, actions } = context;
  const extension = extensionPattern(path);
  const folder = parentFolder(path);

  const items: MenuEntry[] = [
    {
      key: 'file',
      label: t('working.menu.file.ignoreThisFile'),
      onSelect: () => {
        actions.ignorePath(path, untrack);
      },
    },
  ];

  if (extension !== null) {
    items.push({
      key: 'extension',
      label: t('working.menu.file.ignoreExtension', { pattern: extension }),
      onSelect: () => {
        actions.ignorePath(extension, untrack);
      },
    });
  }

  if (folder !== null) {
    items.push({
      key: 'folder',
      label: t('working.menu.file.ignoreFolder', { folder }),
      onSelect: () => {
        actions.ignorePath(folder, untrack);
      },
    });
  }

  return items;
}

/**
 * Sobre cuántos archivos opera el menú de una fila.
 *
 * Con la fila dentro de una selección múltiple, las acciones que se pueden
 * repetir —pasar al stage, quitar, descartar— operan sobre la selección entera y
 * lo dicen con su número. Las que solo tienen sentido sobre un archivo —ignorar
 * su extensión, ver su historial, copiar su ruta— siguen siendo de la fila que se
 * pulsó: «copiar las 3 rutas» no es lo mismo que copiar una, y «ignorar `*.ts`»
 * de tres archivos distintos no significa nada.
 */
function selectionOf(file: FileChange, paths: readonly string[] | undefined): readonly string[] {
  return paths === undefined || paths.length === 0 ? [file.path] : paths;
}

export function unstagedFileMenu(
  context: MenuBuildContext,
  file: FileChange,
  paths?: readonly string[],
): readonly MenuEntry[] {
  const { t, actions } = context;
  const path = file.path;
  const selection = selectionOf(file, paths);
  const count = selection.length;

  return [
    {
      key: 'stage',
      label:
        count > 1
          ? t('working.menu.file.stageSelection', { count })
          : t('working.menu.file.stage', { path }),
      onSelect: () => {
        actions.stage(selection);
      },
    },
    separator('s1'),
    {
      key: 'discard',
      label:
        count > 1
          ? t('working.menu.file.discardSelection', { count })
          : t('working.menu.file.discard', { path }),
      danger: true,
      onSelect: () => {
        actions.discard(selection);
      },
    },
    {
      kind: 'submenu',
      key: 'ignore',
      label: t('working.menu.file.ignore', { path }),
      items: ignoreItems(context, path, false),
    },
    {
      kind: 'submenu',
      key: 'ignoreAndUntrack',
      label: t('working.menu.file.ignoreAndUntrack', { path }),
      items: ignoreItems(context, path, true),
    },
    separator('s2'),
    // Stash selectivo: solo se ofrece con selección múltiple.
    ...(count > 1
      ? [
          {
            key: 'stashPaths',
            label: t('working.menu.file.stashSelection', { count }),
            onSelect: () => {
              actions.stashPaths(selection);
            },
          } satisfies MenuEntry,
          separator('s2b'),
        ]
      : []),
    // Lo de Seguimiento es lo que todavía no está en el índice: su diff es el
    // del árbol de trabajo contra el stage.
    {
      key: 'diff',
      label: t('working.menu.file.viewDiff'),
      onSelect: () => {
        actions.openDiff(path, { kind: 'worktree' });
      },
    },
    {
      key: 'history',
      label: t('working.menu.file.viewHistory'),
      onSelect: () => {
        actions.viewFileHistory(path);
      },
    },
    // Abrir con la aplicación del sistema: `SystemPort` solo declara
    // `revealPath`, así que no hay con qué abrirlo.
    {
      key: 'open',
      label: t('working.menu.file.open'),
      disabled: true,
      onSelect: () => undefined,
    },
    {
      key: 'reveal',
      label: t('working.menu.revealFolder'),
      onSelect: () => {
        actions.reveal(path);
      },
    },
    {
      key: 'copyPath',
      label: t('working.menu.copyPath'),
      onSelect: () => {
        actions.copy(path);
      },
    },
  ];
}

export function stagedFileMenu(
  context: MenuBuildContext,
  file: FileChange,
  paths?: readonly string[],
): readonly MenuEntry[] {
  const { t, actions } = context;
  const path = file.path;
  const selection = selectionOf(file, paths);
  const count = selection.length;

  return [
    {
      key: 'unstage',
      label:
        count > 1
          ? t('working.menu.file.unstageSelection', { count })
          : t('working.menu.file.unstage', { path }),
      onSelect: () => {
        actions.unstage(selection);
      },
    },
    separator('s1'),
    // Lo del stage se compara contra HEAD, que es exactamente lo que se llevaría
    // el commit siguiente.
    {
      key: 'diff',
      label: t('working.menu.file.viewDiff'),
      onSelect: () => {
        actions.openDiff(path, { kind: 'index' });
      },
    },
    {
      key: 'history',
      label: t('working.menu.file.viewHistory'),
      onSelect: () => {
        actions.viewFileHistory(path);
      },
    },
    {
      key: 'copyPath',
      label: t('working.menu.copyPath'),
      onSelect: () => {
        actions.copy(path);
      },
    },
  ];
}

/*
 * ── 11 · Archivo de un commit ───────────────────────────────────────────────
 */

/**
 * El menú de un archivo dentro de un commit o de una comparación.
 *
 * Recibe el origen porque el mismo menú sale en dos sitios con dos orígenes
 * distintos: la lista de cambios de un commit lo abre en ese commit, y la de una
 * comparación en el rango entre sus dos extremos. Ninguno de los dos se puede
 * preparar —son historia ya escrita—, y por eso no ofrecen stage.
 */
export function commitFileMenu(
  context: MenuBuildContext,
  path: string,
  source: DiffSource,
): readonly MenuEntry[] {
  const { t, actions } = context;

  return [
    {
      key: 'diff',
      label: t('working.menu.file.viewDiff'),
      onSelect: () => {
        actions.openDiff(path, source);
      },
    },
    {
      key: 'history',
      label: t('working.menu.file.viewHistory'),
      onSelect: () => {
        actions.viewFileHistory(path, source.kind === 'commit' ? source.sha : undefined);
      },
    },
    separator('s1'),
    // Sin «Abrir el archivo»: el disco tiene la versión de HEAD, no la de este
    // commit, y abrirla ahí engañaría — subplan 4.2.
    {
      key: 'reveal',
      label: t('working.menu.revealFolder'),
      onSelect: () => {
        actions.reveal(path);
      },
    },
    {
      key: 'copyPath',
      label: t('working.menu.copyPath'),
      onSelect: () => {
        actions.copy(path);
      },
    },
  ];
}

/*
 * ── 12 · Carpeta, en modo árbol ─────────────────────────────────────────────
 */

export function folderMenu(
  context: MenuBuildContext,
  folder: { path: string; paths: readonly string[] },
): readonly MenuEntry[] {
  const { t, actions } = context;
  const count = folder.paths.length;
  const name = folder.path;

  return [
    {
      key: 'stage',
      label: t('working.menu.folder.stage', { count, folder: name }),
      onSelect: () => {
        actions.stage(folder.paths);
      },
    },
    {
      key: 'unstage',
      label: t('working.menu.folder.unstage', { count, folder: name }),
      onSelect: () => {
        actions.unstage(folder.paths);
      },
    },
    {
      key: 'discard',
      label: t('working.menu.folder.discard', { count, folder: name }),
      danger: true,
      onSelect: () => {
        actions.discard(folder.paths);
      },
    },
    separator('s1'),
    {
      key: 'ignore',
      label: t('working.menu.folder.ignore', { folder: name }),
      onSelect: () => {
        actions.ignorePath(name, false);
      },
    },
    {
      key: 'ignoreAndUntrack',
      label: t('working.menu.folder.ignoreAndUntrack', { folder: name }),
      onSelect: () => {
        actions.ignorePath(name, true);
      },
    },
    separator('s2'),
    {
      key: 'reveal',
      label: t('working.menu.revealFolder'),
      onSelect: () => {
        actions.reveal(name);
      },
    },
  ];
}

/*
 * ── 13 · Cabecera de la tabla ───────────────────────────────────────────────
 */

/**
 * Lo que la cabecera de `CommitTable` suma al menú de columnas de `DataGrid`.
 *
 * El submenú de columnas y «Restablecer el ancho» los pone el primitivo, que es
 * quien sabe qué columnas hay y cuánto medían; esto es lo único que solo esta
 * tabla puede ofrecer — la forma del nodo del grafo.
 */
export function tableHeaderExtras(
  context: MenuBuildContext,
  state: { form: GraphNodeForm; avatarAllowed: boolean },
): readonly MenuEntry[] {
  const { t, actions } = context;

  const forms: readonly { key: GraphNodeForm; label: MessageKey }[] = [
    { key: 'ring', label: 'working.menu.header.nodeRing' },
    { key: 'avatar', label: 'working.menu.header.nodeAvatar' },
    { key: 'dot', label: 'working.menu.header.nodeDot' },
  ];

  return [
    {
      kind: 'submenu',
      key: 'nodes',
      label: t('working.menu.header.nodes'),
      items: forms
        // El nodo-avatar no se ofrece en «Contraste» — decisión 6 del subplan:
        // un disco no puede llevar la forma que ahí distingue una rama de otra.
        .filter((form) => form.key !== 'avatar' || state.avatarAllowed)
        .map((form) => ({
          key: form.key,
          label: t(form.label),
          checked: state.form === form.key,
          onSelect: () => {
            actions.setNodeForm(form.key);
          },
        })),
    },
    separator('s1'),
  ];
}

/*
 * ── 14 · Cabecera de una sección del panel ──────────────────────────────────
 */

export function sectionHeaderMenu(
  context: MenuBuildContext,
  section: RefSectionKey,
): readonly MenuEntry[] {
  const { t, actions } = context;

  const first: MenuEntry =
    section === 'remotes'
      ? {
          key: 'addRemote',
          label: t('working.menu.section.addRemote'),
          onSelect: actions.addRemote,
        }
      : section === 'tags'
        ? {
            key: 'createTag',
            label: t('working.menu.section.createTag'),
            onSelect: () => {
              actions.createTag(
                context.headBranch === null
                  ? { kind: 'commit', sha: '' }
                  : { kind: 'branch', name: context.headBranch },
                targetName(context),
              );
            },
          }
        : section === 'worktrees'
          ? {
              key: 'createWorktree',
              label: t('working.menu.section.createWorktree'),
              onSelect: () => {
                actions.createWorktree(null);
              },
            }
          : section === 'stashes'
            ? {
                // Guardar los cambios es el botón Stash de la barra: F2.8.
                key: 'stash',
                label: t('working.menu.section.stash'),
                disabled: true,
                onSelect: () => undefined,
              }
            : {
                key: 'createBranch',
                label: t('working.menu.section.createBranch'),
                onSelect: () => {
                  actions.createBranch(
                    context.headBranch === null
                      ? { kind: 'commit', sha: '' }
                      : { kind: 'branch', name: context.headBranch },
                    targetName(context),
                  );
                },
              };

  return [
    first,
    {
      // Traer de todos los remotos es el botón Fetch de la barra: F2.9.
      key: 'fetchAll',
      label: t('working.menu.section.fetchAll'),
      disabled: true,
      onSelect: () => undefined,
    },
    separator('s1'),
    {
      key: 'collapseAll',
      label: t('working.menu.section.collapseAll'),
      onSelect: () => {
        actions.setAllSectionsCollapsed(true);
      },
    },
    {
      key: 'expandAll',
      label: t('working.menu.section.expandAll'),
      onSelect: () => {
        actions.setAllSectionsCollapsed(false);
      },
    },
  ];
}

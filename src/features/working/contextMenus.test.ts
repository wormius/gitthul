import { describe, expect, it, vi } from 'vitest';

import type { Branch, Remote, Stash, Tag, Worktree } from '@core/domain/refs';
import type { FileChange } from '@core/domain/status';
import { interpolate } from '@i18n/format';
import { esMX } from '@i18n/messages/es-MX';
import {
  isAction,
  isSeparator,
  isSubmenu,
  type MenuAction,
  type MenuEntry,
  type MenuSubmenu,
} from '@ui/menuUtils';

import {
  commitFileMenu,
  commitMenu,
  commitSelectionMenu,
  extensionPattern,
  folderMenu,
  localBranchMenu,
  parentFolder,
  remoteBranchMenu,
  remoteMenu,
  sectionHeaderMenu,
  stagedFileMenu,
  stashMenu,
  tableHeaderExtras,
  tagMenu,
  unstagedFileMenu,
  worktreeMenu,
  type MenuBuildContext,
  type WorkingMenuActions,
} from './contextMenus';

/** Traduce de verdad con el catálogo base: así se lee lo que el menú va a decir. */
const t: MenuBuildContext['t'] = (key, params) => interpolate(esMX[key], params);

function makeActions(): WorkingMenuActions {
  return {
    checkout: vi.fn(),
    activateRemoteBranch: vi.fn(),
    createBranch: vi.fn(),
    renameBranch: vi.fn(),
    deleteBranch: vi.fn(),
    createTag: vi.fn(),
    deleteTag: vi.fn(),
    createWorktree: vi.fn(),
    openWorktree: vi.fn(),
    lockWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    fetchRemote: vi.fn(),
    addRemote: vi.fn(),
    editRemote: vi.fn(),
    manageRemoteCredentials: vi.fn(),
    removeRemote: vi.fn(),
    cherryPick: vi.fn(),
    revert: vi.fn(),
    reset: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    discard: vi.fn(),
    previewIntegration: vi.fn(),
    compare: vi.fn(),
    ignorePath: vi.fn(),
    viewFileHistory: vi.fn(),
    openDiff: vi.fn(),
    stashPaths: vi.fn(),
    applyStashPaths: vi.fn(),
    pop: vi.fn(),
    dropStash: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    goToNode: vi.fn(),
    setNodeForm: vi.fn(),
    setAllSectionsCollapsed: vi.fn(),
  };
}

function context(overrides: Partial<MenuBuildContext> = {}): MenuBuildContext {
  return {
    t,
    actions: makeActions(),
    headBranch: 'main',
    defaultRemote: 'origin',
    branches: [],
    ...overrides,
  };
}

/** Los rótulos visibles, en orden, sin separadores. */
function labels(items: readonly MenuEntry[]): string[] {
  return items.flatMap((item) => (isSeparator(item) ? [] : [item.label]));
}

function find(items: readonly MenuEntry[], key: string): MenuAction | MenuSubmenu {
  const entry = items.find((item) => item.key === key);

  if (!entry || isSeparator(entry)) throw new Error(`El menú no tiene la entrada ${key}`);

  return entry;
}

/** Pulsa una entrada del menú, como haría quien la elige. */
function select(items: readonly MenuEntry[], key: string): void {
  const entry = find(items, key);

  if (!isAction(entry)) throw new Error(`La entrada ${key} no es una acción`);

  entry.onSelect();
}

const dev: Branch = {
  id: 'refs/heads/dev',
  name: 'dev',
  kind: 'local',
  tip: 'a1b2c3d4',
  upstream: 'origin/dev',
  ahead: 2,
  behind: 1,
  isHead: false,
};

const originDev: Branch = {
  id: 'refs/remotes/origin/dev',
  name: 'origin/dev',
  kind: 'remote',
  remote: 'origin',
  tip: 'a1b2c3d4',
  ahead: 0,
  behind: 0,
  isHead: false,
};

const tag: Tag = { id: 'refs/tags/v1.2.0', name: 'v1.2.0', target: 'a1b2c3d4', annotated: false };

const stash: Stash = {
  index: 0,
  sha: 'f1e2d3c4',
  base: 'a1b2c3d4',
  message: 'WIP',
  branch: 'main',
  createdAt: 0,
  fileCount: 4,
};

const worktree: Worktree = {
  path: '/home/x/gitthul-dev',
  name: 'gitthul-dev',
  branch: 'dev',
  head: 'a1b2c3d4',
  isMain: false,
  locked: false,
  missing: false,
};

const origin: Remote = {
  name: 'origin',
  fetchUrl: 'https://ejemplo.org/x.git',
  pushUrl: 'https://ejemplo.org/x.git',
};

const file: FileChange = {
  path: 'src/app.ts',
  change: 'modified',
  binary: false,
  insertions: 3,
  deletions: 1,
};

describe('menú del commit', () => {
  const items = commitMenu(context(), { sha: 'a1b2c3d4e5', summary: 'F2.4: etiquetas' });

  it('ofrece amend solo para HEAD y abre su editor, también con HEAD desacoplado', () => {
    const open = vi.fn();
    const amend = { sha: 'head', open };
    for (const headBranch of ['main', null]) {
      const ctx = context({ headBranch, amend });
      const headMenu = commitMenu(ctx, { sha: 'head', summary: 'Último commit' });
      expect(find(headMenu, 'amend').label).toBe('Modificar el último commit (amend)…');
      select(headMenu, 'amend');
      expect(
        commitMenu(ctx, { sha: 'anterior', summary: 'Anterior' }).some(
          (item) => item.key === 'amend',
        ),
      ).toBe(false);
    }
    expect(open).toHaveBeenCalledTimes(2);
    expect(items.some((item) => item.key === 'amend')).toBe(false);
  });

  it('nombra el commit y la rama activa en cada acción — invariante 5', () => {
    expect(labels(items)).toEqual([
      'Hacer cherry-pick de a1b2c3d sobre main',
      'Revertir a1b2c3d en main',
      'Hacer reset de main a a1b2c3d…',
      'Crear una rama desde a1b2c3d',
      'Crear un tag en a1b2c3d',
      'Comparar a1b2c3d con main',
      'Copiar el SHA',
      'Copiar el mensaje',
    ]);
  });

  it('restablecer abre directamente el diálogo en modo suave', () => {
    const actions = makeActions();
    const entries = commitMenu(context({ actions }), { sha: 'a1b2c3d4e5', summary: 'test' });
    expect(isSubmenu(find(entries, 'reset'))).toBe(false);
    select(entries, 'reset');
    expect(actions.reset).toHaveBeenCalledWith('a1b2c3d4e5', 'soft');
  });

  it('comparar el commit con la rama activa funciona desde F2.5', () => {
    const actions = makeActions();
    const menu = commitMenu(context({ actions }), { sha: 'a1b2c3d4e5', summary: 'x' });
    const compare = find(menu, 'compare');

    expect(compare.disabled).toBe(false);
    expect(compare.label).toBe('Comparar a1b2c3d con main');

    if (!isAction(compare)) throw new Error('Comparar es una acción');

    compare.onSelect();

    expect(actions.compare).toHaveBeenCalledWith(
      { ref: 'a1b2c3d4e5', label: 'a1b2c3d' },
      { ref: 'refs/heads/main', label: 'main' },
    );
  });

  it('con HEAD desacoplado, comparar también se apaga: no hay rama que nombrar como destino', () => {
    const detached = commitMenu(context({ headBranch: null }), { sha: 'a1b2c3d4', summary: 'x' });

    expect(find(detached, 'compare').disabled).toBe(true);
  });

  it('con HEAD desacoplado no hay destino que nombrar y las tres se apagan', () => {
    const detached = commitMenu(context({ headBranch: null }), { sha: 'a1b2c3d4', summary: 'x' });

    expect(find(detached, 'cherryPick').disabled).toBe(true);
    expect(find(detached, 'revert').disabled).toBe(true);
    expect(find(detached, 'reset').disabled).toBe(true);
  });

  it('copiar el SHA copia el completo, no el corto que se enseña', () => {
    const actions = makeActions();
    const menu = commitMenu(context({ actions }), { sha: 'a1b2c3d4e5', summary: 'x' });
    const copy = find(menu, 'copySha');

    if (!isAction(copy)) throw new Error('Copiar el SHA es una acción');

    copy.onSelect();

    expect(actions.copy).toHaveBeenCalledWith('a1b2c3d4e5');
  });
});

describe('menú de una selección de commits', () => {
  it('cuenta los commits y nombra la rama destino', () => {
    const items = commitSelectionMenu(context(), { shas: ['aaa', 'bbb', 'ccc'], contiguous: true });

    expect(labels(items)).toEqual([
      'Hacer cherry-pick de 3 commits sobre main',
      'Revertir 3 commits en main',
      'Copiar los 3 SHA',
    ]);
  });

  it('no duplica la comparación que ya abre la selección', () => {
    const items = commitSelectionMenu(context(), {
      shas: ['aaaaaaaa', 'bbbbbbbb'],
      contiguous: true,
    });

    expect(items.some((item) => item.key === 'compare')).toBe(false);
    expect(items.some((item) => item.key === 'combined')).toBe(false);
  });
});

describe('menú de una rama local', () => {
  const items = localBranchMenu(context(), dev);

  it('trae las quince entradas de la sección 4.2, en su orden', () => {
    expect(labels(items)).toEqual([
      'Cambiar a dev',
      'Hacer merge de dev en main',
      'Hacer rebase de main sobre dev',
      'Comparar dev con main',
      'Publicar dev en origin',
      'Hacer fetch de origin/dev',
      'Establecer origin/dev como upstream',
      'Crear una rama desde dev',
      'Crear un tag en la punta de dev',
      'Crear un worktree con dev',
      'Renombrar dev',
      'Eliminar dev',
      'Copiar el nombre',
      'Ir a su nodo',
    ]);
  });

  it('lo que espera a otra fase se pinta deshabilitado, no se esconde', () => {
    expect(find(items, 'publish').disabled).toBe(true);
    expect(find(items, 'setUpstream').disabled).toBe(true);
  });

  it('fusionar y rebasar funcionan desde F2.7', () => {
    const actions = makeActions();
    const menu = localBranchMenu(context({ actions }), dev);

    select(menu, 'merge');
    select(menu, 'rebase');

    expect(actions.previewIntegration).toHaveBeenNthCalledWith(1, 'merge', 'dev', 'main');
    expect(actions.previewIntegration).toHaveBeenNthCalledWith(2, 'rebase', 'dev', 'main');
  });

  it('comparar con la rama activa funciona desde F2.5', () => {
    const actions = makeActions();
    const compare = find(localBranchMenu(context({ actions }), dev), 'compare');

    expect(compare.disabled).toBe(false);

    if (!isAction(compare)) throw new Error('Comparar es una acción');

    compare.onSelect();

    expect(actions.compare).toHaveBeenCalledWith(
      { ref: 'refs/heads/dev', label: 'dev' },
      { ref: 'refs/heads/main', label: 'main' },
    );
  });

  it('traer del remoto sí funciona: el puerto lo soporta desde F0.11', () => {
    const actions = makeActions();
    const fetch = find(localBranchMenu(context({ actions }), dev), 'fetch');

    if (!isAction(fetch)) throw new Error('Traer es una acción');

    expect(fetch.disabled).toBeFalsy();
    fetch.onSelect();

    expect(actions.fetchRemote).toHaveBeenCalledWith('origin');
  });

  it('sobre la rama activa no se ofrece ni cambiarse a ella ni borrarla', () => {
    const head = localBranchMenu(context(), { ...dev, name: 'main', isHead: true });

    expect(find(head, 'checkout').disabled).toBe(true);
    expect(find(head, 'delete').disabled).toBe(true);
  });

  it('borrar conserva la punta que mostraba el menú', () => {
    const actions = makeActions();

    select(localBranchMenu(context({ actions }), dev), 'delete');

    expect(actions.deleteBranch).toHaveBeenCalledWith('dev', dev.tip);
  });

  it('renombrar conserva la punta que mostraba el menú', () => {
    const actions = makeActions();

    select(localBranchMenu(context({ actions }), dev), 'rename');

    expect(actions.renameBranch).toHaveBeenCalledWith('dev', dev.tip);
  });
});

describe('menú de una rama remota', () => {
  const items = remoteBranchMenu(context(), originDev);

  it('compara la referencia remota completa con la rama local activa', () => {
    const actions = makeActions();
    select(remoteBranchMenu(context({ actions }), originDev), 'compare');

    expect(actions.compare).toHaveBeenCalledWith(
      { ref: 'refs/remotes/origin/dev', label: 'origin/dev' },
      { ref: 'refs/heads/main', label: 'main' },
    );
  });

  it('cambia a ella creando la local que la sigue, y lo dice', () => {
    const actions = makeActions();
    const menu = remoteBranchMenu(context({ actions }), originDev);
    const checkout = find(menu, 'checkout');

    expect(checkout.label).toBe('Cambiar a origin/dev');
    expect(isAction(checkout) ? checkout.description : '').toBe(
      'Crea la rama local que sigue a origin/dev',
    );
    select(menu, 'checkout');
    expect(actions.activateRemoteBranch).toHaveBeenCalledWith(originDev, undefined);
  });

  it('borrarla en el remoto espera a Push, en F2.9', () => {
    expect(find(items, 'delete').disabled).toBe(true);
    expect(find(items, 'delete').label).toBe('Eliminar origin/dev en origin');
  });

  it('si la local existe y quedó atrás, explica el avance y usa el flujo de alineación', () => {
    const actions = makeActions();
    const local = { ...dev, tip: 'local', ahead: 0, behind: 3 };
    const remote = { ...originDev, tip: 'remote' };
    const menu = remoteBranchMenu(context({ actions, branches: [local, remote] }), remote);
    const checkout = find(menu, 'checkout');

    expect(isAction(checkout) ? checkout.description : '').toBe(
      'Adelanta dev hasta origin/dev y cambia a la rama local',
    );
    select(menu, 'checkout');
    expect(actions.activateRemoteBranch).toHaveBeenCalledWith(remote, local);
    expect(actions.checkout).not.toHaveBeenCalled();
  });

  it('un upstream ausente no promete fast-forward con conteos no disponibles', () => {
    const local = { ...dev, tip: 'local', ahead: 0, behind: 3, upstreamMissing: true };
    const remote = { ...originDev, tip: 'remote' };
    const checkout = find(
      remoteBranchMenu(context({ branches: [local, remote] }), remote),
      'checkout',
    );

    expect(isAction(checkout) ? checkout.description : '').toBe(
      t('working.menu.remoteBranch.checkoutHintDiverged', {
        branch: local.name,
        remote: remote.name,
      }),
    );
  });
});

describe('menú de un tag', () => {
  const items = tagMenu(context(), tag);

  it('distingue un tag de una rama con el mismo nombre al comparar', () => {
    const actions = makeActions();
    const sameNameTag = { ...tag, id: 'refs/tags/main', name: 'main' };

    const menu = tagMenu(context({ actions }), sameNameTag);
    expect(find(menu, 'compare').label).toBe('Comparar main con main');
    expect(find(menu, 'compare').disabled).toBe(false);
    select(menu, 'compare');

    expect(actions.compare).toHaveBeenCalledWith(
      { ref: 'refs/tags/main', label: 'main' },
      { ref: 'refs/heads/main', label: 'main' },
    );
  });

  it('advierte de que cambiar a él deja HEAD desacoplado', () => {
    const checkout = find(items, 'checkout');

    expect(isAction(checkout) ? checkout.description : '').toBe('Deja HEAD separado de una rama');
  });

  it('solo compara: un tag no ofrece integración', () => {
    expect(items.some((item) => item.key === 'merge' || item.key === 'rebase')).toBe(false);
    expect(find(items, 'compare').disabled).toBe(false);
  });

  it('borrarlo es de esta fase; publicarlo no', () => {
    expect(find(items, 'delete').disabled).toBeFalsy();
    expect(find(items, 'publish').disabled).toBe(true);
  });

  it('borrar conserva el destino que mostraba el menú', () => {
    const actions = makeActions();

    select(tagMenu(context({ actions }), tag), 'delete');

    expect(actions.deleteTag).toHaveBeenCalledWith(tag.name, tag.target);
  });
});

describe('menú de un guardado', () => {
  const items = stashMenu(context(), stash);

  it('nombra el guardado y la rama; pop y aplicar conservan el objeto observado', () => {
    expect(labels(items)).toEqual([
      'Aplicar stash WIP en main y eliminarlo (pop)',
      'Aplicar stash WIP en main sin eliminarlo',
      'Crear una rama desde stash WIP',
      'Ver los 4 archivos de stash WIP',
      'Eliminar stash WIP',
    ]);
    expect(find(items, 'pop').disabled).toBeFalsy();
    expect(find(items, 'apply').disabled).toBeFalsy();
    expect(find(items, 'drop').disabled).toBeFalsy();
    expect(find(items, 'createBranch').disabled).toBeFalsy();
  });

  it('pop y aplicar entregan el OID junto con el índice visible', () => {
    const actions = makeActions();
    const current = stashMenu(context({ actions }), stash);

    select(current, 'pop');
    select(current, 'apply');
    select(current, 'drop');

    expect(actions.pop).toHaveBeenNthCalledWith(1, stash, true);
    expect(actions.pop).toHaveBeenNthCalledWith(2, stash, false);
    expect(actions.dropStash).toHaveBeenCalledWith(stash);
  });
});

describe('menú de un worktree', () => {
  it('bloquea, quita y abre, y solo ofrece localizar cuando falta la carpeta', () => {
    const items = worktreeMenu(context(), worktree);

    expect(labels(items)).toEqual([
      'Abrir gitthul-dev en una pestaña',
      'Abrir la carpeta en el explorador',
      'Bloquear gitthul-dev',
      'Quitar el worktree gitthul-dev',
    ]);
  });

  it('bloqueado ofrece quitarle el bloqueo, no volver a bloquearlo', () => {
    const items = worktreeMenu(context(), { ...worktree, locked: true });

    expect(find(items, 'lock').label).toBe('Quitar el bloqueo de gitthul-dev');
    expect(find(items, 'remove').disabled).toBe(true);
  });

  it('el principal no se puede quitar ni bloquear', () => {
    const items = worktreeMenu(context(), { ...worktree, isMain: true });

    expect(find(items, 'remove').disabled).toBe(true);
    expect(find(items, 'lock').disabled).toBe(true);
  });

  it('con la carpeta perdida aparece Localizar, deshabilitada: ningún puerto la mueve', () => {
    const items = worktreeMenu(context(), { ...worktree, missing: true });

    expect(find(items, 'locate').label).toBe('Localizar la carpeta de gitthul-dev');
    expect(find(items, 'locate').disabled).toBe(true);
  });
});

describe('menú de un remoto', () => {
  it('traer, copiar, editar y quitar pasan por las acciones del mismo remoto', () => {
    const actions = makeActions();
    const items = remoteMenu(context({ actions }), origin);

    expect(labels(items)).toEqual([
      'Hacer fetch de origin',
      'Copiar la dirección',
      'Editar origin',
      'Gestionar autenticación de origin',
      'Quitar origin',
    ]);
    expect(find(items, 'fetch').disabled).toBeFalsy();
    select(items, 'edit');
    select(items, 'credentials');
    expect(actions.manageRemoteCredentials).toHaveBeenCalledWith(origin);
    select(items, 'remove');
    expect(actions.editRemote).toHaveBeenCalledWith(origin);
    expect(actions.removeRemote).toHaveBeenCalledWith(origin);
  });
});

describe('menús de archivo', () => {
  it('distingue la extensión del nombre literal y la carpeta al ignorar', () => {
    const actions = makeActions();
    const items = unstagedFileMenu({ ...context(), actions }, { ...file, path: 'src/*.log' });

    for (const [key, untrack] of [
      ['ignore', false],
      ['ignoreAndUntrack', true],
    ] as const) {
      const ignore = find(items, key);
      if (!isSubmenu(ignore)) throw new Error('Ignorar tiene que ser un submenú');
      select(ignore.items, 'file');
      select(ignore.items, 'extension');
      select(ignore.items, 'folder');
      expect(actions.ignorePath).toHaveBeenNthCalledWith(untrack ? 4 : 1, 'src/*.log', untrack);
      expect(actions.ignorePath).toHaveBeenNthCalledWith(
        untrack ? 5 : 2,
        '*.log',
        untrack,
        'extension',
      );
      expect(actions.ignorePath).toHaveBeenNthCalledWith(untrack ? 6 : 3, 'src/', untrack);
    }
  });

  it('el de Cambios ofrece las dos formas de ignorar, con sus tres alcances', () => {
    const items = unstagedFileMenu(context(), file);
    const ignore = find(items, 'ignore');

    if (!isSubmenu(ignore)) throw new Error('Ignorar tiene que ser un submenú');

    expect(labels(ignore.items)).toEqual(['Este archivo', 'Todos los *.ts', 'La carpeta src/']);
    expect(find(items, 'ignoreAndUntrack').label).toBe('Ignorar y dejar de seguir src/app.ts');
  });

  it('el de Cambios abre el diff contra el stage, y deja el historial vivo', () => {
    const actions = makeActions();
    const items = unstagedFileMenu({ ...context(), actions }, file);

    expect(find(items, 'history').disabled).toBeFalsy();
    expect(find(items, 'diff').disabled).toBeFalsy();

    select(items, 'diff');

    // Lo que está en Cambios es justo lo que **no** está en el índice, así
    // que su diff es el del árbol de trabajo.
    expect(actions.openDiff).toHaveBeenCalledWith('src/app.ts', { kind: 'worktree' });

    // `SystemPort` solo declara `revealPath`: no hay con qué abrir el archivo.
    expect(find(items, 'open').disabled).toBe(true);
    expect(find(items, 'reveal').disabled).toBeFalsy();
  });

  it('el de Stage abre el diff contra HEAD, que es lo que se llevaría el commit', () => {
    const actions = makeActions();

    select(stagedFileMenu({ ...context(), actions }, file), 'diff');

    expect(actions.openDiff).toHaveBeenCalledWith('src/app.ts', { kind: 'index' });
  });

  it('el del archivo de un commit abre el diff con el origen que le pasen', () => {
    const actions = makeActions();
    const range = { kind: 'range', from: 'a1b2c3d', to: 'e4f5g6h' } as const;

    select(commitFileMenu({ ...context(), actions }, 'src/app.ts', range), 'diff');

    expect(actions.openDiff).toHaveBeenCalledWith('src/app.ts', range);
  });

  it('el menú de stash aplica una selección literal sin incluir otros archivos', () => {
    const actions = makeActions();
    const source = { kind: 'stash', sha: 'saved-sha' } as const;
    select(
      commitFileMenu({ ...context(), actions }, 'src/a.ts', source, ['src/a.ts', 'src/b.ts']),
      'applyStashPaths',
    );
    expect(actions.applyStashPaths).toHaveBeenCalledWith('saved-sha', ['src/a.ts', 'src/b.ts']);
    expect(
      commitFileMenu(context(), 'src/a.ts', { kind: 'commit', sha: 'saved-sha' }).some(
        (item) => item.key === 'applyStashPaths',
      ),
    ).toBe(false);
  });

  it('el de Stage solo quita del staging, y nombra el archivo', () => {
    expect(labels(stagedFileMenu(context(), file))).toEqual([
      'Quitar src/app.ts del staging',
      'Ver el diff',
      'Ver el historial',
      'Copiar la ruta',
    ]);
  });

  it('el del archivo de un commit no ofrece abrirlo: el disco tiene la versión de HEAD', () => {
    const items = commitFileMenu(context(), 'src/app.ts', { kind: 'commit', sha: 'a1b2c3d' });

    expect(labels(items)).toEqual([
      'Ver el diff',
      'Ver el historial',
      'Abrir la carpeta en el explorador',
      'Copiar la ruta',
    ]);
    expect(items.some((item) => item.key === 'open')).toBe(false);
  });

  it('el de una carpeta cuenta cuántos archivos toca', () => {
    const items = folderMenu(context(), {
      path: 'src/app/',
      paths: ['src/app/a.ts', 'src/app/b.ts'],
    });

    expect(labels(items)).toEqual([
      'Agregar los 2 archivos de src/app/ al staging',
      'Quitar los 2 archivos de src/app/ del staging',
      'Descartar los cambios de los 2 archivos de src/app/',
      'Ignorar la carpeta src/app/',
      'Ignorar y dejar de seguir la carpeta src/app/',
      'Abrir la carpeta en el explorador',
    ]);
  });
});

describe('cabecera de la tabla', () => {
  it('ofrece las tres formas de nodo, con la activa marcada', () => {
    const items = tableHeaderExtras(context(), { form: 'ring', avatarAllowed: true });
    const nodes = find(items, 'nodes');

    if (!isSubmenu(nodes)) throw new Error('Nodos tiene que ser un submenú');

    expect(labels(nodes.items)).toEqual(['Anillo', 'Avatar', 'Punto']);
    expect(nodes.items.filter((item) => isAction(item) && item.checked)).toHaveLength(1);
  });

  it('en «Contraste» el nodo-avatar no se ofrece — decisión 6', () => {
    const items = tableHeaderExtras(context(), { form: 'ring', avatarAllowed: false });
    const nodes = find(items, 'nodes');

    if (!isSubmenu(nodes)) throw new Error('Nodos tiene que ser un submenú');

    expect(labels(nodes.items)).toEqual(['Anillo', 'Punto']);
  });
});

describe('cabecera de una sección del panel', () => {
  it('la primera entrada cambia con la sección', () => {
    expect(labels(sectionHeaderMenu(context(), 'locals'))[0]).toBe('Crear una rama');
    expect(labels(sectionHeaderMenu(context(), 'remotes'))[0]).toBe('Agregar un remoto');
    expect(labels(sectionHeaderMenu(context(), 'tags'))[0]).toBe('Crear un tag');
    expect(labels(sectionHeaderMenu(context(), 'worktrees'))[0]).toBe('Crear un worktree');
    expect(labels(sectionHeaderMenu(context(), 'stashes'))[0]).toBe('Crear stash');
  });

  it('plegar y desplegar todas funcionan; traer de todos espera a F2.9', () => {
    const items = sectionHeaderMenu(context(), 'locals');

    expect(find(items, 'fetchAll').disabled).toBe(true);
    expect(find(items, 'collapseAll').disabled).toBeFalsy();
    expect(find(items, 'expandAll').disabled).toBeFalsy();
  });
});

describe('patrones de ignorar', () => {
  it('saca la extensión y la carpeta de una ruta', () => {
    expect(extensionPattern('src/app.ts')).toBe('*.ts');
    expect(parentFolder('src/app.ts')).toBe('src/');
  });

  it('sin extensión ni carpeta devuelve nulo, y el submenú se queda con una entrada', () => {
    expect(extensionPattern('Makefile')).toBeNull();
    expect(parentFolder('Makefile')).toBeNull();

    const items = unstagedFileMenu(context(), { ...file, path: 'Makefile' });
    const ignore = find(items, 'ignore');

    if (!isSubmenu(ignore)) throw new Error('Ignorar tiene que ser un submenú');

    expect(labels(ignore.items)).toEqual(['Este archivo']);
  });
});

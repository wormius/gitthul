/**
 * Agrupar referencias para el panel izquierdo y para las etiquetas del grafo.
 *
 * `localBranches` y `refsAt` ya viven en `@core/domain/refs`; aquí entra lo que
 * es de la vista: el árbol de remotos del panel (F2.1) y, desde F2.4, formar
 * referencias lógicas y colapsar en `+N` las que comparten commit.
 */

import type { Sha } from '@core/domain/commit';
import type { Branch, Remote, RefsSnapshot, Tag } from '@core/domain/refs';
import type { TreeNode } from '@ui/treeUtils';

export interface RemoteGroup {
  remote: Remote;
  branches: readonly Branch[];
}

/**
 * Las ramas remotas, agrupadas por remoto — siempre en árbol, incluso con uno
 * solo (CU-3: «un solo remoto es un árbol con una sola rama abierta»).
 */
export function remoteGroups(snapshot: RefsSnapshot): readonly RemoteGroup[] {
  return snapshot.remotes.map((remote) => ({
    remote,
    branches: snapshot.branches.filter(
      (branch) => branch.kind === 'remote' && branch.remote === remote.name,
    ),
  }));
}

/**
 * El nombre corto de una rama remota dentro de su árbol: sin el prefijo del
 * remoto, que ya es el nodo raíz y repetirlo en cada hijo sería ruido.
 */
export function remoteBranchLeafName(branch: Branch, remote: Remote): string {
  const prefix = `${remote.name}/`;

  return branch.name.startsWith(prefix) ? branch.name.slice(prefix.length) : branch.name;
}

/**
 * Construye un árbol de `TreeNode` a partir de nombres de rama con `/` como
 * separador de carpetas. Cada hoja lleva `branch.id` como identidad para que el
 * componente que pinta pueda recuperar el objeto `Branch` original. Los nodos
 * intermedios usan un prefijo para evitar colisiones (una rama `fix` y una
 * carpeta `fix/` podrían coincidir sin él).
 *
 * Ejemplo: `['main', 'fix/hover', 'fix/foco']` produce:
 *   - main (hoja)
 *   - fix/ (carpeta)
 *     - hover (hoja)
 *     - foco (hoja)
 */
export function branchTree(
  branches: readonly Branch[],
  options: { nameOf?: (branch: Branch) => string; folderPrefix?: string } = {},
): TreeNode[] {
  const { nameOf = (b) => b.name, folderPrefix = 'folder:' } = options;

  interface Folder {
    label: string;
    children: Map<string, Folder>;
    leaves: TreeNode[];
  }

  const root: Folder = { label: '', children: new Map(), leaves: [] };

  for (const branch of branches) {
    const name = nameOf(branch);
    const parts = name.split('/');

    if (parts.length === 1) {
      root.leaves.push({ id: branch.id, label: name });
      continue;
    }

    let current = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index]!;
      let child = current.children.get(segment);

      if (!child) {
        child = { label: segment, children: new Map(), leaves: [] };
        current.children.set(segment, child);
      }

      current = child;
    }

    current.leaves.push({ id: branch.id, label: parts[parts.length - 1]! });
  }

  function toNodes(folder: Folder, path: string): TreeNode[] {
    const nodes: TreeNode[] = [];

    for (const [segment, child] of folder.children) {
      const childPath = path === '' ? segment : `${path}/${segment}`;
      const children = toNodes(child, childPath);

      nodes.push({ id: `${folderPrefix}${childPath}`, label: segment, children });
    }

    nodes.push(...folder.leaves);

    return nodes;
  }

  return toNodes(root, '');
}

/**
 * Una etiqueta lógica del grafo: una rama local con su copia remota cuando
 * coinciden, una remota sin copia local o un tag.
 *
 * `name` es siempre lo que se ve; `refName` conserva la referencia inequívoca
 * que necesitan menús y arrastre. Por eso una remota puede enseñar `dev` y
 * seguir operando sobre `origin/dev`.
 */
export interface RefLabelItem {
  /** Estable entre repintados: es la clave de React y la del menú. */
  key: string;
  kind: 'branch' | 'tag';
  /** Nombre corto que se pinta en el chip. */
  name: string;
  /** Nombre real que recibe git: `dev`, `origin/dev` o `v1.2.0`. */
  refName: string;
  local?: Branch;
  /** La copia remota fundida, o la remota sola cuando no hay copia local. */
  remote?: Branch;
  tag?: Tag;
  /** La rama activa del repositorio: suma el punto relleno a sus iconos de tipo. */
  isHead: boolean;
}

/**
 * Las etiquetas lógicas de un commit.
 *
 * Una local y su remota son el mismo chip cuando tienen el mismo nombre lógico
 * y apuntan a este commit. La relación `upstream` decide qué remota es su copia;
 * sin seguimiento declarado se usa la primera del mismo nombre corto. Las
 * remotas restantes conservan su identidad completa en `refName`, aunque el
 * chip enseñe solo el nombre que adoptaría su copia local.
 *
 * El orden decide qué sobrevive visible delante del `+N`: primero la rama
 * activa, luego el resto de locales —fundidas o no—, las remotas sueltas y al
 * final los tags.
 */
export function refLabelsAt(snapshot: RefsSnapshot, sha: Sha): readonly RefLabelItem[] {
  const locals = snapshot.branches.filter(
    (branch) => branch.kind === 'local' && branch.tip === sha,
  );
  const remotes = snapshot.branches.filter(
    (branch) => branch.kind === 'remote' && branch.tip === sha,
  );
  const pairedRemotes = new Set<string>();
  const items: RefLabelItem[] = [];

  for (const local of locals) {
    const twin = remoteTwin(local, remotes, pairedRemotes);

    if (twin) pairedRemotes.add(twin.id);

    items.push({
      key: twin ? `${local.id}+${twin.id}` : local.id,
      kind: 'branch',
      name: local.name,
      refName: local.name,
      local,
      ...(twin === undefined ? {} : { remote: twin }),
      isHead: local.isHead,
    });
  }

  for (const remote of remotes) {
    if (pairedRemotes.has(remote.id)) continue;

    items.push({
      key: remote.id,
      kind: 'branch',
      name: shortRemoteName(remote),
      refName: remote.name,
      remote,
      isHead: false,
    });
  }

  for (const tag of snapshot.tags) {
    if (tag.target !== sha) continue;

    items.push({
      key: tag.id,
      kind: 'tag',
      name: tag.name,
      refName: tag.name,
      tag,
      isHead: false,
    });
  }

  return items.sort((left, right) => rank(left) - rank(right));
}

function remoteTwin(
  local: Branch,
  remotes: readonly Branch[],
  paired: ReadonlySet<string>,
): Branch | undefined {
  if (local.upstreamMissing) return undefined;

  if (local.upstream !== undefined) {
    return remotes.find((remote) => remote.name === local.upstream && !paired.has(remote.id));
  }

  return remotes.find((remote) => shortRemoteName(remote) === local.name && !paired.has(remote.id));
}

function shortRemoteName(branch: Branch): string {
  const prefix = branch.remote === undefined ? '' : `${branch.remote}/`;

  return prefix !== '' && branch.name.startsWith(prefix)
    ? branch.name.slice(prefix.length)
    : branch.name;
}

function rank(item: RefLabelItem): number {
  if (item.isHead) return 0;
  if (item.local) return 1;
  if (item.remote) return 2;

  return 3;
}

export interface RefLabelCollapse {
  /** Las que se pintan en la fila. */
  shown: readonly RefLabelItem[];
  /** Las que viven detrás del `+N` y salen en flotante al pasar el ratón. */
  hidden: readonly RefLabelItem[];
}

/**
 * El colapso a `+N` de la columna Rama/Tag.
 *
 * La columna mide poco más que un rótulo, así que con más de `visible`
 * etiquetas se enseña lo primero de `refLabelsAt` y el resto se cuenta. El
 * despliegue es **flotante**, fuera del flujo: la invariante 1 no admite que
 * pasar el ratón mueva la fila ni un píxel.
 */
export function collapseRefLabels(
  items: readonly RefLabelItem[],
  visible: number,
): RefLabelCollapse {
  if (items.length <= visible) return { shown: items, hidden: [] };

  return { shown: items.slice(0, visible), hidden: items.slice(visible) };
}

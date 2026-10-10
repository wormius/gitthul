/**
 * Lo que `FileList` decide sin pintar nada — CU-6.
 *
 * Filtrar, ordenar, repartir por carpetas y traducir una selección a rutas son
 * reglas con casos de borde propios —una ruta sin carpeta, una carpeta de hijo
 * único, un clic derecho fuera de lo marcado— y por eso viven aquí y no dentro
 * del componente: es la misma razón por la que `graph.ts` no toca un canvas.
 */

import type { ChangeType, FileChange, TreeEntry } from '@core/domain/status';
import type { TreeNode } from '@ui/tree';

/** Lista plana o árbol de carpetas. Lo alterna `working.toggleFileTree`. */
export type FileView = 'flat' | 'tree';

/** Por qué se ordena una lista de archivos. */
export type FileSort = 'path' | 'name' | 'change';

/**
 * Las carpetas se distinguen de los archivos por el prefijo de su
 * identificador, no por una bandera aparte: `Tree` solo conoce cadenas, y una
 * ruta de archivo nunca empieza por esto.
 */
export const FOLDER_PREFIX = 'folder:';

export function isFolderId(id: string): boolean {
  return id.startsWith(FOLDER_PREFIX);
}

/** `folder:src/app/` → `src/app/`, que es como lo nombran los menús. */
export function folderPathOf(id: string): string {
  return id.slice(FOLDER_PREFIX.length);
}

export interface SplitPath {
  /** Carpeta con barra final, o cadena vacía en la raíz. */
  dir: string;
  name: string;
}

/** La ruta partida en carpeta y nombre: la primera se atenúa, el segundo manda. */
export function splitPath(path: string): SplitPath {
  const slash = path.lastIndexOf('/');

  return slash < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

/**
 * Orden de los ocho tipos de cambio cuando se ordena por tipo.
 *
 * No es alfabético ni el del catálogo: es de más a menos urgente de mirar. Un
 * conflicto primero, lo que ni siquiera se sigue al final.
 */
const CHANGE_ORDER: Record<ChangeType, number> = {
  conflicted: 0,
  added: 1,
  modified: 2,
  deleted: 3,
  renamed: 4,
  copied: 5,
  typeChanged: 6,
  untracked: 7,
  unmodified: 8,
};

/** Coincide con la ruta entera, sin distinguir mayúsculas ni acentos de caja. */
export function matchesFilter(path: string, filter: string): boolean {
  const needle = filter.trim().toLocaleLowerCase();

  return needle === '' || path.toLocaleLowerCase().includes(needle);
}

/**
 * Lo que la lista enseña: filtrado y ordenado, en un solo paso.
 *
 * Devuelve el mismo arreglo cuando no hay nada que filtrar ni que reordenar,
 * para no invalidar memos por gusto.
 */
export function visibleFiles(
  files: readonly FileChange[],
  filter: string,
  sort: FileSort,
): readonly FileChange[] {
  const filtered =
    filter.trim() === '' ? files : files.filter((file) => matchesFilter(file.path, filter));

  const compare = (left: FileChange, right: FileChange): number => {
    if (sort === 'name') {
      const byName = splitPath(left.path).name.localeCompare(splitPath(right.path).name);

      return byName === 0 ? left.path.localeCompare(right.path) : byName;
    }

    if (sort === 'change') {
      const byChange = CHANGE_ORDER[left.change] - CHANGE_ORDER[right.change];

      return byChange === 0 ? left.path.localeCompare(right.path) : byChange;
    }

    return left.path.localeCompare(right.path);
  };

  return [...filtered].sort(compare);
}

/**
 * El árbol de carpetas de una lista de archivos.
 *
 * Las carpetas van antes que los archivos en cada nivel —es lo que hace que la
 * estructura se lea de un vistazo— y las hojas conservan el orden que traían,
 * que es el que el criterio de ordenación ya decidió. La expansión encadenada de
 * `src/` → `app/` → `views/` no se resuelve aquí: la hace `flattenTree`, que ya
 * sabe fundir cadenas de hijo único.
 */
export function buildFileTree(files: readonly FileChange[]): readonly TreeNode[] {
  interface Folder {
    id: string;
    label: string;
    folders: Map<string, Folder>;
    leaves: TreeNode[];
  }

  const root: Folder = { id: '', label: '', folders: new Map(), leaves: [] };

  const folderAt = (segments: readonly string[]): Folder => {
    let current = root;
    let prefix = '';

    for (const segment of segments) {
      prefix += `${segment}/`;

      let next = current.folders.get(segment);

      if (!next) {
        next = {
          id: `${FOLDER_PREFIX}${prefix}`,
          label: segment,
          folders: new Map(),
          leaves: [],
        };
        current.folders.set(segment, next);
      }

      current = next;
    }

    return current;
  };

  for (const file of files) {
    const segments = file.path.split('/');
    const name = segments.pop() ?? file.path;

    folderAt(segments).leaves.push({ id: file.path, label: name });
  }

  // Carpetas primero y por nombre; las hojas conservan el orden que traían, que
  // es el que el criterio de ordenación ya decidió.
  const nodesOf = (folder: Folder): readonly TreeNode[] => [
    ...[...folder.folders.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((child) => ({ id: child.id, label: child.label, children: nodesOf(child) })),
    ...folder.leaves,
  ];

  return nodesOf(root);
}

/** Las rutas de archivo que cuelgan de un nodo, en orden de aparición. */
export function leafPaths(node: TreeNode): readonly string[] {
  if (!node.children) return [node.id];

  return node.children.flatMap((child) => leafPaths(child));
}

/**
 * Los archivos de varios commits, fundidos en una sola lista — CU-14.
 *
 * `GitPort` no declara «qué archivos cambian entre dos extremos», así que la
 * lista de una comparación se arma sumando lo que tocó cada commit del rango.
 * Las cifras se suman —tres commits que añadieron diez líneas cada uno son
 * treinta— y **el tipo de cambio lo manda el commit más reciente**, que es el que
 * decide cómo está el archivo al final del rango: un archivo creado y luego
 * borrado dentro del rango sale como borrado.
 *
 * `changes` llega del más reciente al más antiguo, que es el orden en que el
 * puerto devuelve los commits.
 */
export function mergeFileChanges(changes: readonly FileChange[]): readonly FileChange[] {
  const merged = new Map<string, FileChange>();

  for (const change of changes) {
    const previous = merged.get(change.path);

    if (!previous) {
      merged.set(change.path, { ...change });

      continue;
    }

    merged.set(change.path, {
      ...previous,
      binary: previous.binary || change.binary,
      insertions: previous.insertions + change.insertions,
      deletions: previous.deletions + change.deletions,
    });
  }

  return [...merged.values()];
}

/**
 * Sobre qué opera el menú que se abrió en una fila.
 *
 * Pulsar con el botón derecho **dentro** de una selección múltiple opera sobre
 * la selección entera; hacerlo fuera opera solo sobre esa fila. Es la misma
 * regla que `CommitTable` fijó en F2.4 para el menú de varios commits: pulsar
 * dentro de lo marcado no puede significar «olvida los otros dos».
 */
export function menuPaths(
  selected: ReadonlySet<string>,
  target: readonly string[],
  visible: readonly string[],
): readonly string[] {
  const inside = target.some((path) => selected.has(path));

  if (!inside) return target;

  // El orden es el de la lista, no el de los clics: descartar tres archivos
  // tiene que nombrarlos como se ven.
  const fromSelection = visible.filter((path) => selected.has(path));

  return fromSelection.length === 0 ? target : fromSelection;
}

/**
 * Funde el árbol completo del proyecto con los archivos que cambiaron.
 *
 * Los archivos que están en `changes` conservan su tipo de cambio; los que
 * existen en el árbol pero no cambiaron aparecen como `unmodified`. Es lo que
 * la lista enseña cuando «Ver todos» está activo.
 */
export function mergeTreeWithChanges(
  tree: readonly TreeEntry[],
  changes: readonly FileChange[],
): readonly FileChange[] {
  const changesByPath = new Map<string, FileChange>();

  for (const change of changes) {
    changesByPath.set(change.path, change);
  }

  const result: FileChange[] = [];

  for (const entry of tree) {
    if (entry.kind !== 'file') continue;

    const existing = changesByPath.get(entry.path);

    if (existing) {
      result.push(existing);
    } else {
      result.push({
        path: entry.path,
        change: 'unmodified',
        binary: false,
        insertions: 0,
        deletions: 0,
      });
    }
  }

  // También incluir archivos que están en changes pero no en el árbol
  // (por ejemplo archivos sin seguimiento, que no existen en HEAD).
  for (const change of changes) {
    if (!tree.some((entry) => entry.kind === 'file' && entry.path === change.path)) {
      result.push(change);
    }
  }

  return result;
}

/** Las filas de `CommitTable`, y lo que decide qué pinta cada una. Puro, sin React ni DOM. */

import type { Commit } from '@core/domain/commit';
import type { Stash } from '@core/domain/refs';
import type { WorkingStatus } from '@core/domain/status';

export interface WipRow {
  kind: 'wip';
  key: 'wip';
  fileCount: number;
  /** Nombre personalizado; `null` se renderiza como "WIP". */
  label: string | null;
}

export interface CommitRowData {
  kind: 'commit';
  key: string;
  commit: Commit;
}

export interface StashRow {
  kind: 'stash';
  key: string;
  stash: Stash;
}

export type CommitTableRow = WipRow | CommitRowData | StashRow;

/**
 * Cuántos archivos distintos cambiaron, para el rótulo del nodo WIP.
 *
 * Un archivo puede estar preparado y sin preparar a la vez —parte del cambio
 * en el índice, parte todavía no—, y ahí solo cuenta una vez: lo que importa es
 * cuántas rutas cambiaron, no cuántas veces aparecen repartidas entre las tres
 * listas.
 */
export function wipFileCount(status: WorkingStatus): number {
  const paths = new Set<string>();

  for (const change of status.staged) paths.add(change.path);
  for (const change of status.unstaged) paths.add(change.path);
  for (const change of status.conflicted) paths.add(change.path);

  return paths.size;
}

/**
 * Las filas de la tabla: primero el WIP y después commits y guardados en su
 * posición cronológica.
 *
 * Los guardados dejan de formar una pila artificial en el tope del historial:
 * cada uno se intercala por `createdAt`, igual que las filas de commit por
 * `committedAt`, como el recorrido del backend. Si comparten fecha conservan
 * el índice de la pila, con `stash@{0}` primero. Un guardado más viejo que la página cargada queda al
 * final temporalmente y baja a su sitio conforme llega más historia.
 */
export function buildCommitRows(
  commits: readonly Commit[],
  status: WorkingStatus,
  stashes: readonly Stash[],
  wipName?: string | null,
): readonly CommitTableRow[] {
  const rows: CommitTableRow[] = [];

  if (!status.clean) {
    rows.push({ kind: 'wip', key: 'wip', fileCount: wipFileCount(status), label: wipName ?? null });
  }

  const orderedStashes = [...stashes].sort(
    (left, right) => right.createdAt - left.createdAt || left.index - right.index,
  );
  const baseRows = new Map(commits.map((commit, index) => [commit.sha, index]));
  const stashesAt = new Map<number, Stash[]>();
  let position = 0;

  for (const stash of orderedStashes) {
    while (
      position < commits.length &&
      (commits[position]?.committedAt ?? -Infinity) > stash.createdAt
    ) {
      position += 1;
    }
    // Las fechas de Git pueden retroceder o cambiar tras un amend. El stash
    // siempre debe preceder a su base para que la arista termine en ella.
    const insertion = Math.min(position, baseRows.get(stash.base) ?? commits.length);
    const group = stashesAt.get(insertion);
    if (group) group.push(stash);
    else stashesAt.set(insertion, [stash]);
  }
  let stashIndex = 0;

  for (const commit of commits) {
    for (const stash of stashesAt.get(stashIndex) ?? []) {
      rows.push({ kind: 'stash', key: `stash:${String(stash.index)}`, stash });
    }
    rows.push({ kind: 'commit', key: commit.sha, commit });
    stashIndex += 1;
  }

  for (const stash of stashesAt.get(commits.length) ?? []) {
    rows.push({ kind: 'stash', key: `stash:${String(stash.index)}`, stash });
  }

  return rows;
}

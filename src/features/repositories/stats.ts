import type { Commit, Person } from '@core/domain/commit';
import type { Branch, RefsSnapshot } from '@core/domain/refs';
import type { RepoSummary } from '@core/domain/repository';
import { isoDay } from '@core/domain/library';
import type { HeatmapDay } from '@ui/heatmap';

/*
 * Los agregados de Repositorios, en funciones puras.
 *
 * Misma regla que `collection.ts` y que `tabs.ts`: contar commits por día,
 * agrupar autores o mezclar las últimas páginas de cinco repositorios no
 * necesita un DOM, así que se prueba sin uno. Lo que sí necesita un puerto —
 * pedir las páginas— vive en el componente que las pinta.
 */

/**
 * Cuántos meses mira la ventana de estadísticas.
 *
 * **Es parte del contrato de rendimiento y no una limitación provisional.** Con
 * ella, un repositorio de cien mil commits cuesta lo mismo que uno de
 * trescientos, y por eso la interfaz dice «últimos 12 meses» donde corresponde:
 * enseñar un dato acotado como si fuera absoluto sería mentir.
 */
export const STATS_MONTHS = 12;

/** Tope del recorrido acotado. Con doce meses de historia normal sobra. */
export const STATS_COMMIT_LIMIT = 5_000;

/** Cuántos commits se le piden a cada uno. */
export const HOME_COMMITS_PER_REPO = 5;

/** Cuántos quedan a la vista, ya mezclados. */
export const HOME_COMMITS = 10;

/** Contribuidores como mucho. Más de ocho ya es una tabla, no un vistazo. */
export const CONTRIBUTOR_LIMIT = 8;

/**
 * El instante desde el que se recorre.
 *
 * Se ancla al primero del mes para que la ventana no se mueva dentro del mismo
 * día: si dependiera de la hora, dos consultas seguidas podrían traer conjuntos
 * distintos y el total del periodo bailaría sin que nadie hubiera hecho nada.
 */
export function statsSince(now: number): number {
  const date = new Date(now);

  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  date.setMonth(date.getMonth() - STATS_MONTHS + 1);

  return date.getTime();
}

/**
 * Commits por día del calendario de quien mira.
 *
 * Se cuenta por `committedAt` y no por `authoredAt` porque el heatmap contesta
 * «¿qué se ha tocado esto últimamente?», y un commit rebasado o traído con
 * cherry-pick entró en la historia el día que lo hizo, no el día que se escribió.
 */
export function activityDays(commits: readonly Commit[]): readonly HeatmapDay[] {
  const byDay = new Map<string, number>();

  for (const commit of commits) {
    const day = isoDay(commit.committedAt);

    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return [...byDay].map(([date, value]) => ({ date, value }));
}

/**
 * Los días de uso de GitThul, tal como `LibraryPort` los guarda.
 *
 * `from` acota a la misma ventana que enseña la cuadrícula. El archivo conserva
 * catorce meses para que el recorte mensual no deje la ventana corta, pero el
 * total que se pinta debajo tiene que contar lo que se ve: decir «412
 * aperturas» sobre un mapa que solo enseña doce meses sería sumar lo que ya no
 * está a la vista.
 */
export function usageDays(
  usage: Readonly<Record<string, number>>,
  from?: string,
): readonly HeatmapDay[] {
  return Object.entries(usage)
    .filter(([date]) => from === undefined || date >= from)
    .map(([date, value]) => ({ date, value }));
}

export interface Contribution {
  person: Person;
  commits: number;
}

/**
 * Quién firmó cuántos commits del periodo, de más a menos.
 *
 * Se agrupa por correo y no por nombre: la misma persona aparece como «Ada
 * Márquez» y «ada» según la máquina desde la que hiciera el commit, y contarla
 * dos veces convertiría el bloque en una lista de configuraciones de git. El
 * nombre que se enseña es el del commit más reciente, que es el que la persona
 * usa ahora. El desempate va por nombre para que el orden sea estable: dos
 * autores empatados no pueden intercambiarse entre dos lecturas iguales.
 */
export function contributors(
  commits: readonly Commit[],
  limit: number = CONTRIBUTOR_LIMIT,
): readonly Contribution[] {
  const byEmail = new Map<string, Contribution>();

  for (const commit of commits) {
    const key = commit.author.email.trim().toLowerCase();
    const found = byEmail.get(key);

    if (found) found.commits += 1;
    else byEmail.set(key, { person: commit.author, commits: 1 });
  }

  return [...byEmail.values()]
    .sort(
      (left, right) =>
        right.commits - left.commits || left.person.name.localeCompare(right.person.name),
    )
    .slice(0, limit);
}

/** Un commit sin su repositorio no se puede abrir ni situar. */
export interface RepoCommit {
  repo: RepoSummary;
  commit: Commit;
}

export interface RepoPage {
  repo: RepoSummary;
  commits: readonly Commit[];
}

/**
 * Los últimos commits de varios repositorios, en una sola lista.
 *
 * Cada uno llega con el suyo porque la pantalla de inicio tiene que decir de
 * dónde salió: «F1.3: espacios» sin más no significa nada cuando hay cinco
 * repositorios en juego.
 *
 * **Un SHA solo aparece una vez.** Un worktree comparte la historia de su
 * repositorio padre, así que sin esto los dos entrarían con los mismos commits
 * y la lista saldría duplicada de arriba abajo. Se queda con la primera
 * aparición, que tras ordenar es la del repositorio que la página listó antes —
 * y las páginas llegan en orden de última apertura.
 */
export function mergeRecentCommits(
  pages: readonly RepoPage[],
  limit: number = HOME_COMMITS,
): readonly RepoCommit[] {
  const seen = new Set<string>();

  return pages
    .flatMap(({ repo, commits }) => commits.map((commit) => ({ repo, commit })))
    .sort((left, right) => right.commit.committedAt - left.commit.committedAt)
    .filter(({ commit }) => {
      if (seen.has(commit.sha)) return false;

      seen.add(commit.sha);

      return true;
    })
    .slice(0, limit);
}

export interface RefCounts {
  localBranches: number;
  remoteBranches: number;
  tags: number;
  stashes: number;
  worktrees: number;
}

export function refCounts(refs: RefsSnapshot): RefCounts {
  return {
    localBranches: refs.branches.filter((branch) => branch.kind === 'local').length,
    remoteBranches: refs.branches.filter((branch) => branch.kind === 'remote').length,
    tags: refs.tags.length,
    stashes: refs.stashes.length,
    worktrees: refs.worktrees.length,
  };
}

/**
 * La rama a la que apunta HEAD, si apunta a alguna.
 *
 * Se busca por el nombre que da `refs.head` y no por `isHead`, que marca la
 * activa del repositorio **principal**: en un worktree esas dos son ramas
 * distintas, y el adelanto y el retraso que hay que enseñar son los de la suya.
 */
export function headBranch(refs: RefsSnapshot): Branch | undefined {
  const name = refs.head.branch;

  if (name === null) return undefined;

  return refs.branches.find((branch) => branch.kind === 'local' && branch.name === name);
}

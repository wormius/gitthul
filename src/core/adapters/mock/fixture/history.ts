import type { Commit, Person, Sha } from '@core/domain/commit';
import type { ChangeType, FileChange } from '@core/domain/status';

import { createRandom, type Random } from '../random';
import {
  BODIES,
  CHORE_MESSAGES,
  describePath,
  FIX_MESSAGES,
  MERGE_TEMPLATE,
  PATHS,
  PEOPLE,
  PHASE_MESSAGES,
  STASH_MESSAGES,
} from './vocabulary';

/**
 * La historia del repositorio ficticio.
 *
 * Se construye por episodios —la rama sale de la principal, recibe unos
 * commits, la principal avanza mientras tanto y al final se fusiona— porque eso
 * es lo que produce el grafo que el motor de F2.3 tiene que saber dibujar:
 * calles que nacen, conviven y se cierran, con fusiones de dos padres. Una
 * lista de commits en línea recta no probaría nada.
 *
 * Las ramas de los episodios no quedan en las referencias: se borran al
 * fusionar, como en cualquier repositorio real, y lo único que recuerda su
 * nombre es el mensaje de la fusión.
 */

const HOUR = 3_600_000;

const BRANCH_POOL: readonly string[] = [
  'f0-6-primitivos',
  'f0-7-shell',
  'f1-1-repositorios',
  'f1-2-espacios',
  'f2-1-esqueleto',
  'f2-2-tabla',
  'fix/hover-desplaza',
  'fix/foco-del-dialogo',
  'docs/inventario',
  'i18n/de-fr',
];

export interface HistorySpec {
  seed: number;
  /** Cuántos commits produce, aproximadamente: el último episodio se completa. */
  target: number;
  mainBranch: string;
  /** Ramas vivas, sin fusionar, con sus commits propios. */
  openBranches: readonly string[];
  /** Cuántos guardados hay en la pila. Cada uno es un nodo más del grafo. */
  stashCount: number;
  /** Milisegundos del primer commit. */
  startAt: number;
}

/** Un guardado de la pila, con el commit que lo sostiene. */
export interface HistoryStash {
  sha: Sha;
  base: Sha;
  branch: string;
  message: string;
  createdAt: number;
  fileCount: number;
}

export interface History {
  /** Del más nuevo al más viejo, que es como se recorre un log. */
  commits: readonly Commit[];
  byShaLookup: ReadonlyMap<Sha, Commit>;
  filesBySha: ReadonlyMap<Sha, readonly FileChange[]>;
  /** Punta de cada rama local. */
  tips: ReadonlyMap<string, Sha>;
  /**
   * Punta de la rama remota que le corresponde a cada local. Puede quedar
   * atrás, puede ir por delante y puede haber divergido de verdad: los tres
   * casos existen aquí porque los tres se ven distinto en la vista.
   */
  remoteTips: ReadonlyMap<string, Sha>;
  /** Del más reciente al más viejo, como los numera `stash@{n}`. */
  stashes: readonly HistoryStash[];
  /** La línea principal en orden cronológico, para colgar tags y remotos. */
  mainline: readonly Sha[];
}

class Builder {
  readonly commits: Commit[] = [];
  readonly files = new Map<Sha, readonly FileChange[]>();
  private clock: number;

  constructor(
    private readonly random: Random,
    startAt: number,
  ) {
    this.clock = startAt;
  }

  commit(parents: readonly Sha[], summary: string, files?: readonly FileChange[]): Sha {
    const sha = this.random.hex(40);
    const author = this.random.pick(PEOPLE);

    this.clock += this.random.int(1, 9) * HOUR + this.random.int(0, 59) * 60_000;

    const commit: Commit = {
      sha,
      parents,
      summary,
      body: this.random.pick(BODIES),
      author,
      authoredAt: this.clock,
      committer: this.committer(author),
      committedAt: this.clock,
    };

    this.commits.push(commit);
    this.files.set(sha, files ?? this.changedFiles());

    return sha;
  }

  /**
   * Casi siempre firma quien escribió, pero no siempre: un cherry-pick o un
   * rebase dejan autor y committer distintos, y la vista tiene que enseñar los
   * dos cuando no coinciden.
   */
  private committer(author: Person): Person {
    return this.random.chance(0.12) ? this.random.pick(PEOPLE) : author;
  }

  private changedFiles(): readonly FileChange[] {
    const total = this.random.int(1, 4);
    const chosen = new Set<string>();
    const changes: FileChange[] = [];

    while (chosen.size < total) {
      const entry = this.random.pick(PATHS);

      if (chosen.has(entry.path)) continue;

      chosen.add(entry.path);
      changes.push(this.changeFor(entry.path, entry.binary));
    }

    return changes;
  }

  private changeFor(path: string, binary: boolean): FileChange {
    const change: ChangeType = this.random.chance(0.08)
      ? 'added'
      : this.random.chance(0.05)
        ? 'deleted'
        : this.random.chance(0.04)
          ? 'renamed'
          : 'modified';

    const base: FileChange = {
      path,
      change,
      binary,
      insertions: binary ? 0 : this.random.int(1, 60),
      deletions: binary || change === 'added' ? 0 : this.random.int(0, 40),
    };

    if (change !== 'renamed') return base;

    const from = path.split('/');
    const name = from.pop() ?? path;

    return { ...base, previousPath: [...from, `viejo-${name}`].join('/') };
  }

  message(): string {
    return this.random.chance(0.45)
      ? this.random.pick(PHASE_MESSAGES)
      : this.random.chance(0.6)
        ? this.random.pick(FIX_MESSAGES)
        : this.random.pick(CHORE_MESSAGES);
  }
}

export function buildHistory(spec: HistorySpec): History {
  const random = createRandom(spec.seed);
  const builder = new Builder(random, spec.startAt);
  const mainline: Sha[] = [];

  let main = builder.commit(
    [],
    'F0.1: andamiaje de Tauri 2, React 19 y las herramientas de calidad',
  );

  mainline.push(main);

  const advance = (times: number) => {
    for (let step = 0; step < times; step += 1) {
      main = builder.commit([main], builder.message());
      mainline.push(main);
    }
  };

  let episode = 0;

  while (builder.commits.length < spec.target) {
    advance(random.int(1, 3));

    const branch = BRANCH_POOL[episode % BRANCH_POOL.length] ?? 'trabajo';
    const base = main;

    let tip = base;

    for (let step = 0; step < random.int(2, 7); step += 1) {
      tip = builder.commit([tip], builder.message());
    }

    // La rama principal a veces avanza mientras la otra trabaja: sin eso, toda
    // fusión sería un avance rápido y el grafo no tendría nada que dibujar.
    if (random.chance(0.45)) advance(1);

    main = builder.commit(
      [main, tip],
      MERGE_TEMPLATE.replace('{source}', branch).replace('{target}', spec.mainBranch),
      // Una fusión limpia no cambia nada por sí misma.
      random.chance(0.7) ? [] : undefined,
    );
    mainline.push(main);
    episode += 1;
  }

  const tips = new Map<string, Sha>([[spec.mainBranch, main]]);
  const remoteTips = new Map<string, Sha>();

  // Lo normal es llevar trabajo sin subir, así que el remoto de la principal se
  // queda unos commits atrás y la rama sale «por subir» en la interfaz.
  remoteTips.set(
    spec.mainBranch,
    mainline[Math.max(0, mainline.length - 1 - random.int(1, 4))] ?? main,
  );

  spec.openBranches.forEach((branch, index) => {
    const from = mainline[Math.max(0, mainline.length - random.int(2, 12))] ?? main;

    let tip = from;

    for (let step = 0; step < random.int(2, 6); step += 1) {
      tip = builder.commit([tip], builder.message());
    }

    tips.set(branch, tip);

    // La primera diverge de verdad: el remoto tiene commits propios desde el
    // mismo punto de partida. Es el caso que termina en push rechazado.
    if (index === 0) {
      let remote = from;

      for (let step = 0; step < 2; step += 1) {
        remote = builder.commit([remote], builder.message());
      }

      remoteTips.set(branch, remote);
    } else {
      remoteTips.set(branch, tip);
    }
  });

  /*
   * Los guardados cuelgan de la rama sobre la que se hicieron y conservan un
   * commit real para leer su detalle. `readCommits` los excluye del recorrido
   * normal: el grafo ya les reserva una fila sintética y pintarlos dos veces
   * rompería el mismo contrato que cumple el adaptador nativo.
   */
  const stashes: HistoryStash[] = [];

  for (let index = 0; index < spec.stashCount; index += 1) {
    const message = STASH_MESSAGES[index % STASH_MESSAGES.length] ?? 'WIP';
    const sha = builder.commit([main], message);
    const created = builder.commits[builder.commits.length - 1];

    stashes.push({
      sha,
      base: main,
      branch: spec.mainBranch,
      message,
      createdAt: created?.committedAt ?? spec.startAt,
      fileCount: random.int(1, 5),
    });
  }

  const commits = [...builder.commits].reverse();

  return {
    commits,
    byShaLookup: new Map(commits.map((commit) => [commit.sha, commit])),
    filesBySha: builder.files,
    tips,
    remoteTips,
    stashes: stashes.reverse(),
    mainline,
  };
}

/**
 * Cuántos commits alcanza `from` que no alcance `to`.
 *
 * Es lo que la interfaz enseña como «3 por subir» y «2 por traer», y se calcula
 * de verdad recorriendo el grafo en vez de inventar un número: si el falso
 * mintiera aquí, la vista se desarrollaría contra un dato imposible.
 */
export function countAhead(commits: ReadonlyMap<Sha, Commit>, from: Sha, to: Sha): number {
  const reachableFromTo = reachable(commits, to);
  const pending: Sha[] = [from];
  const seen = new Set<Sha>();

  let count = 0;

  while (pending.length > 0) {
    const sha = pending.pop();

    if (sha === undefined || seen.has(sha) || reachableFromTo.has(sha)) continue;

    seen.add(sha);
    count += 1;
    pending.push(...(commits.get(sha)?.parents ?? []));
  }

  return count;
}

function reachable(commits: ReadonlyMap<Sha, Commit>, from: Sha): ReadonlySet<Sha> {
  const seen = new Set<Sha>();
  const pending: Sha[] = [from];

  while (pending.length > 0) {
    const sha = pending.pop();

    if (sha === undefined || seen.has(sha)) continue;

    seen.add(sha);
    pending.push(...(commits.get(sha)?.parents ?? []));
  }

  return seen;
}

/** Un cambio suelto para el árbol de trabajo, con su tamaño ya decidido. */
export function fileChange(path: string, change: ChangeType, seed: number): FileChange {
  const random = createRandom(seed);
  const { binary } = describePath(path);

  return {
    path,
    change,
    binary,
    insertions: binary || change === 'deleted' ? 0 : random.int(1, 40),
    deletions: binary || change === 'added' || change === 'untracked' ? 0 : random.int(0, 25),
  };
}

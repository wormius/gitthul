/**
 * El motor del grafo: en qué calle vive cada fila, de qué color, y qué tramos
 * de línea la cruzan. Puro, sin React y sin DOM, como `tabs.ts` y
 * `collection.ts` — decisión 7 del subplan. Quien pinta es `graphPaint.ts`.
 *
 * ## La invariante que lo sostiene todo
 *
 * La lista llega **del hijo al padre**: cada fila tiene por encima a todos sus
 * hijos y por debajo a sus padres. Eso permite un solo recorrido de arriba
 * abajo con un estado minúsculo: **una calle por rama viva**, donde «viva»
 * significa «hay un commit más abajo al que todavía tiene que bajar». Cada
 * calle recuerda a qué sha está esperando; cuando ese sha aparece, la calle se
 * cierra ahí o continúa con el primer padre.
 *
 * Si la lista llegara desordenada —un padre por encima de su hijo— el recorrido
 * no se rompe: la calle que esperaba a ese padre nunca lo encuentra y baja
 * hasta el final de lo cargado, que es exactamente lo que hay que dibujar
 * cuando el padre todavía no está en la página cargada. La degradación es la
 * misma que la de la paginación, y por eso no hace falta ordenar nada aquí.
 *
 * ## Por qué las calles se reparten así
 *
 * - **La calle del nodo es la más a la izquierda de las que lo esperaban.** Las
 *   demás mueren en él: son las ramas que se fusionaron aquí.
 * - **El primer padre hereda la calle y el color.** Es lo que hace que el color
 *   de una rama la acompañe por todo su histórico y no dependa de dónde esté la
 *   pantalla: el color se asigna **una vez**, al descubrir la punta de la rama,
 *   y viaja con la cadena de primeros padres hasta que se agota.
 * - **Los demás padres reutilizan la calle que ya esperaba ese sha**, y solo
 *   abren una nueva si nadie lo esperaba. Abrir una calle por cada arista
 *   duplicaría líneas que terminan en el mismo sitio.
 * - **Una calle libre se reutiliza siempre por la más a la izquierda**, para no
 *   dejar huecos que ensanchen la columna sin dibujar nada.
 * - **Una calle nunca cambia de sitio a media vida.** Por eso un tramo que solo
 *   pasa de largo es siempre una vertical recta, y los únicos quiebres del
 *   dibujo ocurren en la fila de un nodo.
 *
 * ## Qué se dibuja en una fila
 *
 * Dos cosas, y con eso basta para todo el trazado:
 *
 * - **Pasos** (`GraphPass`): una calle que cruza la fila entera de arriba abajo
 *   sin tocar el nodo. Siempre vertical.
 * - **Enlaces** (`GraphLink`): un tramo que sale del centro del nodo hacia el
 *   borde de arriba (`up`) o el de abajo (`down`), por su propia calle o
 *   desviándose a otra con un quiebre de 90°. Es la forma de cumplir la regla
 *   del plan —de un nodo solo salen líneas hacia arriba, izquierda o derecha, y
 *   solo le llegan por abajo, izquierda o derecha—: el desvío lateral ocurre
 *   **siempre pegado al nodo**, nunca a media calle, así que ninguna línea
 *   aterriza sobre la cabeza de un nodo viniendo de otra calle.
 *
 * ## Por qué el resultado no es un arreglo de objetos por fila
 *
 * Con cien mil commits y una decena de calles vivas, un objeto por tramo son
 * millones de objetos que hay que reservar, recorrer y recoger. Los tramos van
 * en arreglos planos con un índice de desplazamientos por fila —la misma forma
 * que una matriz dispersa—, y `passesAt`/`linksAt` materializan solo la fila
 * que se está pintando. La ventana visible son treinta filas: lo que se
 * reserva al pintar es despreciable, y lo que se reserva al calcular es lineal.
 */

import type { Sha } from '@core/domain/commit';
import { runCooperatively } from '@app/runCooperatively';
import type { RefsSnapshot } from '@core/domain/refs';
import { GRAPH_BRANCH_COUNT } from '@design/tokenCatalog';

import type { CommitTableRow } from './commits';

export type GraphNodeKind = 'commit' | 'wip' | 'stash';
export type GraphLineKind = 'branch' | 'wip' | 'stash';

/** Hacia qué borde de la fila se va el tramo que sale del nodo. */
export type GraphDirection = 'up' | 'down';

export interface GraphNode {
  /** Carril vertical, 0 a la izquierda. */
  lane: number;
  kind: GraphNodeKind;
  /** `1..8`: WIP y stash heredan el índice cromático de su commit de origen. */
  color: number;
}

/** Una calle que cruza la fila sin tocar su nodo. */
export interface GraphPass {
  lane: number;
  color: number;
  kind?: GraphLineKind;
}

/** Un tramo que sale del nodo hacia un borde de la fila, por la calle `lane`. */
export interface GraphLink {
  lane: number;
  color: number;
  direction: GraphDirection;
  kind?: GraphLineKind;
}

export interface GraphLayout {
  readonly rowCount: number;
  /** Cuántas calles llegó a haber vivas a la vez. Es el ancho del dibujo. */
  readonly laneCount: number;
  nodeAt: (row: number) => GraphNode;
  passesAt: (row: number) => readonly GraphPass[];
  linksAt: (row: number) => readonly GraphLink[];
}

const KIND_NAMES: readonly GraphNodeKind[] = ['commit', 'wip', 'stash'];
const KIND_COMMIT = 0;
const KIND_WIP = 1;
const KIND_STASH = 2;

const NO_NODE_LANE = -1;
/** Alterna familias cromáticas antes de volver a tonos vecinos de la paleta. */
const COLOR_ORDER: readonly number[] = [1, 6, 3, 5, 7, 4, 2, 8];

/**
 * Reparte calles, colores y tramos para las filas que `buildCommitRows` produjo.
 *
 * `refs` fija el commit de HEAD al que baja el WIP. Cada stash trae su propio
 * SHA de origen: aunque sus filas estén agrupadas arriba, una calle temporal
 * permanece viva hasta encontrar ese commit y después todo el trazo se alinea
 * con la calle real del origen. Si este aún no está en la página, la calle
 * provisional sigue hasta el borde inferior como cualquier padre no cargado.
 */
export function buildGraph(rows: readonly CommitTableRow[], refs: RefsSnapshot): GraphLayout {
  const steps = graphSteps(rows, refs);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

/** Mismo trazado, cediendo tiempo a la terminal y cancelable al cambiar de repositorio. */
export function buildGraphAsync(
  rows: readonly CommitTableRow[],
  refs: RefsSnapshot,
  signal?: AbortSignal,
): Promise<GraphLayout> {
  return runCooperatively(graphSteps(rows, refs), signal);
}

function* graphSteps(
  rows: readonly CommitTableRow[],
  refs: RefsSnapshot,
): Generator<void, GraphLayout> {
  const rowCount = rows.length;
  let renderedLaneCount = 0;

  const nodeLane = new Int32Array(rowCount);
  const nodeColor = new Int32Array(rowCount);
  const nodeKind = new Int8Array(rowCount);
  const nodeStashId = new Int32Array(rowCount);

  // Desplazamientos al estilo de una matriz dispersa: los tramos de la fila `r`
  // son los del rango `[offset[r], offset[r + 1])` de los arreglos planos.
  const passOffset = new Int32Array(rowCount + 1);
  const linkOffset = new Int32Array(rowCount + 1);
  const passLane: number[] = [];
  const passColor: number[] = [];
  const passKind: number[] = [];
  const passStashId: number[] = [];
  const linkLane: number[] = [];
  const linkColor: number[] = [];
  const linkUp: number[] = [];
  const linkKind: number[] = [];
  const linkStashId: number[] = [];

  /** A qué sha está esperando cada calle. `undefined` es una calle libre. */
  const waiting: (string | undefined)[] = [];
  const laneColor: number[] = [];
  const laneKind: number[] = [];
  const laneStashId: number[] = [];
  /** Índice inverso: qué calles de rama esperan un sha. */
  const lanesBySha = new Map<Sha, number[]>();
  /** Calles de stash que terminan en cada commit de origen. */
  const stashLanesBySha = new Map<Sha, number[]>();
  const stashColorById = new Map<number, number>();
  let nextStashId = 0;

  let colorCursor = 0;

  /**
   * Si hay un WIP, recuerda su calle y color de rama para cambiar únicamente
   * el estilo punteado cuando HEAD lo reciba.
   */
  let wipLaneInfo: { lane: number; branchColor: number } | null = null;
  /** La calle libre más a la izquierda, sin devolver nunca la que se le veta. */
  function takeLane(avoid: number): number {
    for (let lane = 0; lane < waiting.length; lane += 1) {
      if (waiting[lane] === undefined && lane !== avoid) return lane;
    }

    const lane = waiting.length;

    waiting.push(undefined);
    laneColor.push(0);
    laneKind.push(KIND_COMMIT);

    if (lane !== avoid) return lane;

    // Reservar la calle 0 permite que la rama principal nazca a la izquierda
    // aunque, con el árbol limpio, haya stashes antes que el primer commit.
    waiting.push(undefined);
    laneColor.push(0);
    laneKind.push(KIND_COMMIT);

    return lane + 1;
  }

  function claim(lane: number, sha: string): void {
    waiting[lane] = sha;

    const lanes = lanesBySha.get(sha);

    if (lanes) lanes.push(lane);
    else lanesBySha.set(sha, [lane]);
  }

  function claimStash(lane: number, sha: Sha): void {
    waiting[lane] = sha;

    const lanes = stashLanesBySha.get(sha);

    if (lanes) lanes.push(lane);
    else stashLanesBySha.set(sha, [lane]);
  }

  function colorInUse(color: number): boolean {
    for (let lane = 0; lane < waiting.length; lane += 1) {
      if (waiting[lane] !== undefined && laneColor[lane] === color) return true;
    }

    return false;
  }

  /**
   * El tono de una rama recién descubierta.
   *
   * Se reparten por turno, saltando los que ya lleva puestos una rama viva: dos
   * ramas que conviven en pantalla nunca comparten color mientras queden tonos
   * libres. Con más de ocho vivas a la vez se repite, que es justo el caso en
   * el que el trazo y la forma del nodo cargan con la distinción.
   */
  function nextColor(): number {
    for (let step = 0; step < GRAPH_BRANCH_COUNT; step += 1) {
      const candidate = COLOR_ORDER[(colorCursor + step) % GRAPH_BRANCH_COUNT] ?? 1;

      if (!colorInUse(candidate)) {
        colorCursor = (colorCursor + step + 1) % GRAPH_BRANCH_COUNT;

        return candidate;
      }
    }

    const candidate = COLOR_ORDER[colorCursor % GRAPH_BRANCH_COUNT] ?? 1;

    colorCursor = (colorCursor + 1) % GRAPH_BRANCH_COUNT;

    return candidate;
  }

  function pushLink(lane: number, color: number, up: boolean, kind = KIND_COMMIT): void {
    renderedLaneCount = Math.max(renderedLaneCount, lane + 1);
    linkLane.push(lane);
    linkColor.push(color);
    linkUp.push(up ? 1 : 0);
    linkKind.push(kind);
    linkStashId.push(laneStashId[lane] ?? 0);
  }

  /** Toda calle ocupada que no sea la del nodo cruza la fila de largo. */
  function emitPasses(excluded: number): void {
    for (let lane = 0; lane < waiting.length; lane += 1) {
      if (waiting[lane] === undefined || lane === excluded) continue;

      passLane.push(lane);
      renderedLaneCount = Math.max(renderedLaneCount, lane + 1);
      passColor.push(laneColor[lane] ?? 0);
      passKind.push(laneKind[lane] ?? KIND_COMMIT);
      passStashId.push(laneStashId[lane] ?? 0);
    }
  }

  function closeRow(row: number, lane: number, kind: number, color: number): void {
    renderedLaneCount = Math.max(renderedLaneCount, lane + 1);
    nodeLane[row] = lane;
    nodeKind[row] = kind;
    nodeColor[row] = color;
    passOffset[row + 1] = passLane.length;
    linkOffset[row + 1] = linkLane.length;
  }

  let row = 0;

  while (row < rowCount) {
    if (row % 256 === 0) yield;
    const current = rows[row];

    if (current === undefined) break;

    if (current.kind === 'wip') {
      // El WIP es siempre el nodo superior y estrena la calle de HEAD: la que
      // baja hasta el commit activo y sigue con toda la historia de su rama.
      // La calle conserva el color que tendrá HEAD, pero su tipo WIP hace que
      // se pinte punteada y más fina hasta alcanzar el commit activo.
      const lane = takeLane(NO_NODE_LANE);

      emitPasses(lane);

      const branchColor = nextColor();

      wipLaneInfo = { lane, branchColor };
      laneColor[lane] = branchColor;
      laneKind[lane] = KIND_WIP;

      if (refs.head.sha) {
        claim(lane, refs.head.sha);
        pushLink(lane, branchColor, false, KIND_WIP);
      }

      closeRow(row, lane, KIND_WIP, branchColor);
      row += 1;
      continue;
    }

    if (current.kind === 'stash') {
      /*
       * Cada stash vive en su posición cronológica y conserva su origen. La
       * calle 0 se reserva para la rama principal cuando no hay WIP; así los
       * rombos no empujan la historia principal a la derecha al aparecer.
       */
      const existing = stashLanesBySha.get(current.stash.base)?.[0];
      const lane = existing ?? takeLane(0);

      emitPasses(lane);
      laneColor[lane] = 0;
      laneKind[lane] = KIND_STASH;
      if (existing === undefined) {
        laneStashId[lane] = ++nextStashId;
        claimStash(lane, current.stash.base);
      } else {
        pushLink(lane, 0, true, KIND_STASH);
      }
      nodeStashId[row] = laneStashId[lane] ?? 0;
      pushLink(lane, 0, false, KIND_STASH);
      closeRow(row, lane, KIND_STASH, 0);
      row += 1;
      continue;
    }

    const { commit } = current;

    // Las calles de stash terminan en su commit de origen. Se
    // sueltan antes de repartir el nodo, pero conservan su enlace hacia arriba.
    const stashIncoming = stashLanesBySha.get(commit.sha);

    if (stashIncoming) {
      stashLanesBySha.delete(commit.sha);
      stashIncoming.sort((a, b) => a - b);

      for (const lane of stashIncoming) waiting[lane] = undefined;
    }

    // 1 · Las calles de rama que esperaban este commit se cierran aquí. Se
    //     colores antes de soltarlas: una de ellas puede acabar reasignada a
    //     una rama nueva en el mismo paso, y la línea que muere en este nodo
    //     tiene que conservar el color con el que venía bajando.
    const incoming = lanesBySha.get(commit.sha);
    let incomingColors: number[] | null = null;

    if (incoming) {
      lanesBySha.delete(commit.sha);
      incoming.sort((a, b) => a - b);
      incomingColors = [];

      for (const lane of incoming) {
        incomingColors.push(laneColor[lane] ?? 0);
        waiting[lane] = undefined;
      }
    }

    // 2 · La calle del nodo. Sin nadie esperándolo es una punta: rama nueva,
    //     color nuevo. Si la calle venía del WIP se restaura su color real
    //     antes de heredar: la línea punteada termina aquí.
    const wipOriginLane =
      wipLaneInfo && incoming?.includes(wipLaneInfo.lane) ? wipLaneInfo.lane : null;

    if (wipOriginLane !== null && wipLaneInfo) {
      laneColor[wipLaneInfo.lane] = wipLaneInfo.branchColor;
      laneKind[wipLaneInfo.lane] = KIND_COMMIT;
      wipLaneInfo = null;
    }

    const lane = incoming?.[0] ?? takeLane(NO_NODE_LANE);
    const inherited = incoming === undefined ? 0 : (laneColor[lane] ?? 0);
    const color = inherited === 0 ? nextColor() : inherited;

    laneColor[lane] = color;
    laneKind[lane] = KIND_COMMIT;

    // La derivación de stash conserva su propia calle. Reutilizar la del
    // commit de origen hacía que su trazo punteado quedara exactamente encima
    // de la línea continua de la rama cuando había commits entre ambos. Si
    // varios stashes comparten origen, sí comparten entre ellos la primera
    // calle temporal: forman una sola derivación lateral, separada de Git.
    for (const temporaryStashLane of stashIncoming ?? []) {
      // La identidad pertenece a esta derivación, no a su calle reutilizable.
      stashColorById.set(laneStashId[temporaryStashLane] ?? 0, color);
    }

    // 3 · Lo que pasa de largo. Las calles que acaban de morir ya están libres
    //     y la del nodo todavía no está tomada, así que ninguna se cuela.
    emitPasses(lane);

    // 4 · Lo que sube: la propia calle del nodo, cada rama que muere en él y
    //     cada stash agrupado arriba que nació en este commit.
    if (incoming && incomingColors) {
      for (let index = 0; index < incoming.length; index += 1) {
        pushLink(incoming[index] ?? 0, incomingColors[index] ?? 0, true);
      }
    }

    for (const stashLane of stashIncoming ?? []) {
      pushLink(stashLane, color, true, KIND_STASH);
    }

    // 5 · Lo que baja: un tramo por padre. El primero se queda la calle y el
    //     color; los demás se enganchan a la calle que ya esperaba ese padre, o
    //     abren una nueva si nadie lo esperaba.
    const parents = commit.parents;

    for (let index = 0; index < parents.length; index += 1) {
      const parent = parents[index];

      if (parent === undefined) continue;

      // Un commit con el mismo padre dos veces existe y no dibuja dos líneas.
      let repeated = false;

      for (let before = 0; before < index; before += 1) {
        if (parents[before] === parent) repeated = true;
      }

      if (repeated) continue;

      if (index === 0) {
        claim(lane, parent);
        pushLink(lane, color, false);
        continue;
      }

      const waitingLanes = lanesBySha.get(parent);
      const existing = waitingLanes === undefined ? undefined : Math.min(...waitingLanes);

      if (existing !== undefined) {
        pushLink(existing, laneColor[existing] ?? 0, false);
        continue;
      }

      const merged = takeLane(lane);

      laneColor[merged] = nextColor();
      laneKind[merged] = KIND_COMMIT;
      claim(merged, parent);
      pushLink(merged, laneColor[merged] ?? 0, false);
    }

    closeRow(row, lane, KIND_COMMIT, color);
    row += 1;
  }

  /*
   * Las filas sintéticas se encuentran antes que sus commits base, así que al
   * crearlas todavía no conocemos la calle definitiva del origen. Durante el
   * recorrido usan una calle temporal independiente; aquí, cuando ya vimos
   * toda la página, materializamos el color del origen de cada derivación de
   * stash. La línea comparte una sola X hasta su base y
   * allí se bifurca hacia el nodo del commit sin cubrir la rama.
   */
  for (let index = 0; index < rowCount; index += 1) {
    if (index % 4096 === 0) yield;
    if (nodeKind[index] !== KIND_STASH) continue;

    nodeColor[index] = stashColorById.get(nodeStashId[index] ?? 0) ?? 1;
  }

  for (let index = 0; index < passLane.length; index += 1) {
    if (index % 4096 === 0) yield;
    if (passKind[index] !== KIND_STASH) continue;

    passColor[index] = stashColorById.get(passStashId[index] ?? 0) ?? 1;
  }

  for (let index = 0; index < linkLane.length; index += 1) {
    if (index % 4096 === 0) yield;
    if (linkKind[index] !== KIND_STASH) continue;

    linkColor[index] = stashColorById.get(linkStashId[index] ?? 0) ?? 1;
  }

  return {
    rowCount,
    laneCount: renderedLaneCount,

    nodeAt: (index) => {
      const lane = nodeLane[index] ?? 0;
      const kind = KIND_NAMES[nodeKind[index] ?? 0] ?? 'commit';

      return {
        lane,
        kind,
        color: nodeColor[index] ?? 0,
      };
    },

    passesAt: (index) => {
      const from = passOffset[index] ?? 0;
      const to = passOffset[index + 1] ?? from;
      const result: GraphPass[] = [];

      for (let at = from; at < to; at += 1) {
        const lane = passLane[at] ?? 0;
        const kind = KIND_NAMES[passKind[at] ?? KIND_COMMIT] ?? 'commit';

        result.push({
          lane,
          color: passColor[at] ?? 0,
          ...(kind === 'commit' ? {} : { kind }),
        });
      }

      return result;
    },

    linksAt: (index) => {
      const from = linkOffset[index] ?? 0;
      const to = linkOffset[index + 1] ?? from;
      const result: GraphLink[] = [];

      for (let at = from; at < to; at += 1) {
        const lane = linkLane[at] ?? 0;
        const kind = KIND_NAMES[linkKind[at] ?? KIND_COMMIT] ?? 'commit';

        result.push({
          lane,
          color: linkColor[at] ?? 0,
          direction: linkUp[at] === 1 ? 'up' : 'down',
          ...(kind === 'commit' ? {} : { kind }),
        });
      }

      return result;
    },
  };
}

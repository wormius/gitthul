import { describe, expect, it } from 'vitest';

import type { Commit } from '@core/domain/commit';
import type { RefsSnapshot } from '@core/domain/refs';
import type { WorkingStatus } from '@core/domain/status';

import { buildCommitRows } from './commits';
import { buildGraph } from './graph';
import {
  dashPattern,
  drawGraphRow,
  graphInitials,
  graphNodeForm,
  laneCenter,
  lineStyleFor,
  resolveGraphMetrics,
  resolveGraphPalette,
  type GraphMetrics,
  type GraphNodeForm,
  type GraphPalette,
} from './graphPaint';

const CLEAN: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };

const TOKENS: Record<string, string> = {
  '--graph-branch-1': 'branch-1',
  '--graph-branch-2': 'branch-2',
  '--graph-branch-6': 'branch-6',
  '--graph-dash-1': 'none',
  '--graph-dash-2': '8 4',
  '--graph-dash-6': '9 3',
  '--graph-shape-1': 'ring',
  '--graph-shape-2': 'diamond',
  '--graph-shape-6': 'diamond',
  '--graph-wip': 'wip',
  '--graph-stash': 'stash',
  '--graph-lane-width': '12px',
  '--graph-node-radius': '4px',
  '--graph-node-avatar': '14px',
  '--graph-line-width': '1.5px',
  '--graph-corner-radius': '5px',
  '--graph-wip-node': 'monochrome',
  '--text-on-accent': 'on-accent',
  '--font-family-ui': 'Space Grotesk',
};

function commit(sha: string, parents: readonly string[] = []): Commit {
  return {
    sha,
    parents,
    summary: sha,
    body: '',
    author: { name: 'Alex Rivera', email: 'alex@example.org' },
    authoredAt: 0,
    committer: { name: 'Alex Rivera', email: 'alex@example.org' },
    committedAt: 0,
  };
}

function refsAt(headSha: string): RefsSnapshot {
  return {
    head: { branch: 'main', sha: headSha, detached: false },
    branches: [],
    tags: [],
    stashes: [],
    worktrees: [],
    remotes: [],
  };
}

interface Call {
  name: string;
  args: readonly number[];
  /** Con qué color estaba puesto el pincel al hacer la llamada. */
  stroke: string;
  fill: string;
  dash: readonly number[];
  width: number;
}

/**
 * Un contexto de canvas que apunta lo que le piden en vez de dibujarlo.
 *
 * jsdom no dibuja —`setup.ts` hace que `getContext` devuelva `null` a
 * propósito—, así que la única forma de comprobar la geometría del trazado es
 * mirar las órdenes. Y es la comprobación que de verdad importa aquí: lo que el
 * plan exige es que no haya ni una diagonal.
 */
function recorder(): { context: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state = { strokeStyle: '', fillStyle: '', dash: [] as readonly number[], lineWidth: 0 };

  const record =
    (name: string) =>
    (...args: number[]) => {
      calls.push({
        name,
        args,
        stroke: state.strokeStyle,
        fill: state.fillStyle,
        dash: state.dash,
        width: state.lineWidth,
      });
    };

  const fake = {
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',

    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },

    setLineDash(pattern: number[]) {
      state.dash = [...pattern];
    },

    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arcTo: record('arcTo'),
    arc: record('arc'),
    rect: record('rect'),
    stroke: record('stroke'),
    fill: record('fill'),
    fillRect: record('fillRect'),
    clip: record('clip'),
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    fillText: (_text: string, x: number, y: number) => {
      calls.push({
        name: 'fillText',
        args: [x, y],
        stroke: '',
        fill: state.fillStyle,
        dash: [],
        width: state.lineWidth,
      });
    },
  };

  return { context: fake as unknown as CanvasRenderingContext2D, calls };
}

const METRICS: GraphMetrics = resolveGraphMetrics(TOKENS, 24);
const PALETTE: GraphPalette = resolveGraphPalette(TOKENS);

function paint(
  layout: ReturnType<typeof buildGraph>,
  row: number,
  form: GraphNodeForm = 'ring',
): Call[] {
  const { context, calls } = recorder();

  drawGraphRow(context, {
    node: layout.nodeAt(row),
    passes: layout.passesAt(row),
    links: layout.linksAt(row),
    form,
    initials: 'WG',
    metrics: METRICS,
    palette: PALETTE,
  });

  return calls;
}

describe('resolveGraphMetrics', () => {
  it('lee las medidas de la densidad activa', () => {
    expect(resolveGraphMetrics(TOKENS, 24)).toEqual({
      rowHeight: 24,
      laneWidth: 12,
      nodeRadius: 4,
      avatarSize: 14,
      lineWidth: 1.5,
      cornerRadius: 5,
    });
  });

  it('sin CSS resuelto cae a las medidas de «cómodo» en vez de a cero', () => {
    const metrics = resolveGraphMetrics({}, 28);

    expect(metrics.laneWidth).toBe(16);
    expect(metrics.nodeRadius).toBe(5);
    expect(metrics.avatarSize).toBe(18);
  });
});

describe('dashPattern', () => {
  it('`none` es línea continua', () => {
    expect(dashPattern('none')).toEqual([]);
    expect(dashPattern(undefined)).toEqual([]);
  });

  it('lo demás es la lista de tramos y huecos', () => {
    expect(dashPattern('9 3 2 3')).toEqual([9, 3, 2, 3]);
  });
});

describe('lineStyleFor', () => {
  /*
   * Punteado, y no continuo como hasta el 3 de agosto de 2026: ni el árbol de
   * trabajo ni un guardado están escritos en la historia, y con línea continua
   * se leían como un tramo más de la rama.
   */
  it('el WIP y los guardados heredan color, puntean y adelgazan su trazo', () => {
    expect(lineStyleFor(PALETTE, 1, 'stash')).toMatchObject({
      color: 'branch-1',
      dash: [3, 3],
      widthScale: 0.6,
    });
    expect(lineStyleFor(PALETTE, 6, 'wip')).toMatchObject({
      color: 'branch-6',
      dash: [3, 3],
      widthScale: 0.6,
    });
  });

  it('cada rama trae sus tres portadores a la vez', () => {
    expect(lineStyleFor(PALETTE, 2)).toMatchObject({
      color: 'branch-2',
      dash: [8, 4],
      shape: 'diamond',
    });
  });

  it('un índice más allá del octavo da la vuelta al catálogo', () => {
    expect(lineStyleFor(PALETTE, 9).color).toBe(lineStyleFor(PALETTE, 1).color);
  });
});

describe('graphNodeForm', () => {
  it('el nodo-avatar no está disponible con «Contraste» puesto', () => {
    expect(graphNodeForm('avatar', 'contraste')).toBe('ring');
  });

  it('en los demás temas se respeta lo elegido', () => {
    expect(graphNodeForm('avatar', 'sargazo')).toBe('avatar');
    expect(graphNodeForm('dot', 'contraste')).toBe('dot');
  });
});

describe('graphInitials', () => {
  it('toma la primera letra del nombre y la del apellido', () => {
    expect(graphInitials('Alex Rivera')).toBe('AR');
    expect(graphInitials('Alex')).toBe('A');
    expect(graphInitials('   ')).toBe('');
  });
});

describe('drawGraphRow · geometría', () => {
  const commits = [
    commit('m2', ['m1', 'b1']),
    commit('b1', ['m0']),
    commit('m1', ['m0']),
    commit('m0'),
  ];
  const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('m2'));

  /** Todo tramo recto tiene que compartir una coordenada con el anterior. */
  function segments(calls: readonly Call[]): { from: number[]; to: number[] }[] {
    const found: { from: number[]; to: number[] }[] = [];
    let cursor: number[] | null = null;

    for (const call of calls) {
      if (call.name === 'moveTo') cursor = [...call.args];
      else if (call.name === 'lineTo' && cursor) {
        found.push({ from: cursor, to: [...call.args] });
        cursor = [...call.args];
      } else if (call.name === 'arcTo') {
        // La esquina redondeada deja el lápiz en el punto de destino que le
        // pasan como segundo par, que es donde arranca el tramo siguiente.
        cursor = [call.args[2] ?? 0, call.args[3] ?? 0];
      }
    }

    return found;
  }

  it('no dibuja ni una diagonal: todo tramo es horizontal o vertical', () => {
    for (let row = 0; row < layout.rowCount; row += 1) {
      for (const segment of segments(paint(layout, row))) {
        const horizontal = segment.from[1] === segment.to[1];
        const vertical = segment.from[0] === segment.to[0];

        expect(horizontal || vertical, `fila ${String(row)}: ${JSON.stringify(segment)}`).toBe(
          true,
        );
      }
    }
  });

  it('prolonga la etiqueta desde el borde izquierdo hasta el centro del nodo', () => {
    const { context, calls } = recorder();
    const node = layout.nodeAt(0);
    const middle = METRICS.rowHeight / 2;
    const style = lineStyleFor(PALETTE, node.color);

    drawGraphRow(context, {
      node,
      passes: layout.passesAt(0),
      links: layout.linksAt(0),
      connectFromLeft: true,
      form: 'ring',
      initials: '',
      metrics: METRICS,
      palette: PALETTE,
    });

    const startIndex = calls.findIndex(
      (call) => call.name === 'moveTo' && call.args[0] === 0 && call.args[1] === middle,
    );
    const end = calls[startIndex + 1];

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(end).toMatchObject({
      name: 'lineTo',
      args: [laneCenter(node.lane, METRICS), middle],
      stroke: style.color,
      dash: style.dash,
      width: METRICS.lineWidth * 0.5,
    });
  });

  it('pinta el conector fino antes que las líneas gruesas que pueden cubrirlo', () => {
    const { context, calls } = recorder();

    drawGraphRow(context, {
      node: { lane: 2, kind: 'commit', color: 1 },
      passes: [{ lane: 0, color: 2 }],
      links: [{ lane: 0, color: 1, direction: 'down' }],
      connectFromLeft: true,
      form: 'ring',
      initials: '',
      metrics: METRICS,
      palette: PALETTE,
    });

    const strokes = calls.filter((call) => call.name === 'stroke');

    expect(strokes[0]?.width).toBe(METRICS.lineWidth * 0.5);
    expect(strokes[1]?.width).toBe(METRICS.lineWidth);
    expect(strokes[2]?.width).toBe(METRICS.lineWidth);
  });

  it('cambiar de calle se hace con una esquina de 90°, no con una recta oblicua', () => {
    // La fila de la fusión saca un tramo hacia la calle 1: ahí tiene que
    // aparecer el arco, y con el radio recortado a lo que hay disponible.
    const corners = paint(layout, 0).filter((call) => call.name === 'arcTo');

    expect(corners).toHaveLength(1);
    expect(corners[0]?.args[4]).toBeLessThanOrEqual(METRICS.cornerRadius);
    expect(corners[0]?.args[4]).toBeGreaterThan(0);
  });

  it('el tramo que se queda en la calle del nodo va derecho, sin esquina', () => {
    const calls = paint(layout, 1);

    expect(calls.filter((call) => call.name === 'arcTo')).toHaveLength(0);
  });

  it('cada calle se pinta centrada en su carril', () => {
    const moves = paint(layout, 1)
      .filter((call) => call.name === 'moveTo')
      .map((call) => call.args[0]);

    expect(moves).toContain(laneCenter(layout.nodeAt(1).lane, METRICS));
  });

  it('lo que pasa de largo cruza la fila entera, de borde a borde', () => {
    // En la fila de `b1` la principal pasa de largo por la calle 0.
    const crossing = segments(paint(layout, 1)).find(
      (segment) => segment.from[1] === 0 && segment.to[1] === METRICS.rowHeight,
    );

    expect(crossing?.from[0]).toBe(laneCenter(0, METRICS));
  });

  it('el nodo se pinta al final, encima de sus propios tramos', () => {
    const calls = paint(layout, 0);
    const lastStroke = calls.map((call) => call.name).lastIndexOf('stroke');
    const firstFill = calls.map((call) => call.name).indexOf('fill');

    expect(firstFill).toBeGreaterThan(lastStroke);
  });
});

describe('drawGraphRow · los tres portadores', () => {
  const commits = [commit('m1', ['m0', 'b1']), commit('b1', ['m0']), commit('m0')];
  const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('m1'));

  it('la segunda rama trae su color y su patrón de trazo, no solo el color', () => {
    const strokes = paint(layout, 1).filter((call) => call.name === 'stroke');
    const own = strokes.find((call) => call.stroke === 'branch-6');

    expect(own).toBeDefined();
    expect(own?.dash).toEqual([9, 3]);
  });

  it('la forma del nodo la manda el tema', () => {
    // `--graph-shape-2` es un rombo: se pinta girando un cuadrado, no un arco.
    const calls = paint(layout, 1);

    expect(calls.some((call) => call.name === 'rotate')).toBe(true);
    expect(calls.some((call) => call.name === 'fillRect' && call.fill === 'branch-6')).toBe(true);
  });

  it('el anillo deja su hueco borrado, para que se vea el fondo real de la fila', () => {
    // `--graph-shape-1` es el anillo.
    const calls = paint(layout, 0);

    expect(calls.some((call) => call.name === 'clearRect')).toBe(true);
  });

  it('la bolita no consulta la forma del tema', () => {
    const calls = paint(layout, 1, 'dot');

    expect(calls.some((call) => call.name === 'fillRect')).toBe(false);
  });

  it('el nodo-avatar se pinta a su tamaño propio y con las iniciales dentro', () => {
    const calls = paint(layout, 0, 'avatar');
    const disc = calls.find((call) => call.name === 'arc');

    expect(disc?.args[2]).toBe(METRICS.avatarSize / 2);
    expect(calls.some((call) => call.name === 'fillText' && call.fill === 'on-accent')).toBe(true);
  });
});

describe('drawGraphRow · WIP y guardados', () => {
  it('el nodo WIP es un círculo sólido neutro y su calle conserva el tono de HEAD', () => {
    const dirty: WorkingStatus = {
      staged: [],
      unstaged: [{ path: 'a.ts', change: 'modified', binary: false, insertions: 1, deletions: 0 }],
      conflicted: [],
      clean: false,
    };
    const layout = buildGraph(buildCommitRows([commit('a')], dirty, []), refsAt('a'));
    const calls = paint(layout, 0);

    expect(calls.some((call) => call.name === 'fill' && call.fill === 'monochrome')).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.name === 'stroke' &&
          call.stroke === 'branch-1' &&
          call.dash.length > 0 &&
          call.width < METRICS.lineWidth,
      ),
    ).toBe(true);
  });

  it('el guardado es un cuadrado sólido y su calle es punteada, fina y del color de origen', () => {
    const stashes = [
      {
        index: 0,
        sha: 'stash-a',
        base: 'a',
        message: 'WIP',
        branch: 'main',
        createdAt: 0,
        fileCount: 1,
      },
    ];
    const layout = buildGraph(
      buildCommitRows([commit('a', ['b']), commit('b')], CLEAN, stashes),
      refsAt('a'),
    );
    // El stash ahora es la fila 0 (agrupado arriba).
    const calls = paint(layout, 0);

    expect(
      calls.some(
        (call) =>
          call.name === 'stroke' &&
          call.stroke === 'branch-1' &&
          call.dash.length > 0 &&
          call.width < METRICS.lineWidth,
      ),
    ).toBe(true);
    expect(calls.some((call) => call.name === 'fillRect' && call.fill === 'branch-1')).toBe(true);
  });

  it('las líneas de stash se bifurcan al origen sin empalmarse con una rama', () => {
    const commits = [commit('m1', ['m0', 'b1']), commit('b1', ['m0']), commit('m0')];
    const stashes = [
      {
        index: 0,
        sha: 'stash-main',
        base: 'm1',
        message: 'main',
        branch: 'main',
        createdAt: 1,
        fileCount: 1,
      },
      {
        index: 1,
        sha: 'stash-branch',
        base: 'b1',
        message: 'branch',
        branch: 'branch',
        createdAt: 0,
        fileCount: 1,
      },
    ];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, stashes), refsAt('m1'));
    const stashCorners = Array.from({ length: layout.rowCount }, (_, row) => paint(layout, row))
      .flat()
      .filter(
        (call) =>
          call.name === 'arcTo' && call.dash.join(',') === '3,3' && call.width < METRICS.lineWidth,
      );

    expect(stashCorners.length).toBeGreaterThan(0);
  });

  it('si WIP y varios stashes comparten origen, estos superponen una única derivación', () => {
    const dirty: WorkingStatus = {
      staged: [],
      unstaged: [{ path: 'a.ts', change: 'modified', binary: false, insertions: 1, deletions: 0 }],
      conflicted: [],
      clean: false,
    };
    const stashes = [
      {
        index: 0,
        sha: 'stash-b-1',
        base: 'b',
        message: 'WIP',
        branch: 'main',
        createdAt: 0,
        fileCount: 1,
      },
      {
        index: 1,
        sha: 'stash-b-2',
        base: 'b',
        message: 'WIP',
        branch: 'main',
        createdAt: 0,
        fileCount: 1,
      },
      {
        index: 2,
        sha: 'stash-b-3',
        base: 'b',
        message: 'WIP',
        branch: 'main',
        createdAt: 0,
        fileCount: 1,
      },
    ];
    const layout = buildGraph(
      buildCommitRows([commit('a', ['b']), commit('b', ['c']), commit('c')], dirty, stashes),
      refsAt('a'),
    );
    const wipCalls = paint(layout, 0);
    const originCalls = paint(layout, 5);
    const stashCorners = originCalls.filter(
      (call) =>
        call.name === 'arcTo' && call.dash.join(',') === '3,3' && call.width < METRICS.lineWidth,
    );

    expect(wipCalls.filter((call) => call.name === 'arcTo')).toHaveLength(0);
    expect(stashCorners).toHaveLength(1);
    expect(new Set(stashCorners.map((call) => call.args.join(','))).size).toBe(1);
  });
});

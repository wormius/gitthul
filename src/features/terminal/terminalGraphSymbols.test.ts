import { describe, expect, it } from 'vitest';

import type { GraphNodeKind } from '@features/working/graph';
import {
  drawGraphNode,
  drawGraphRow,
  resolveGraphMetrics,
  type GraphRowPaint,
} from '@features/working/graphPaint';

import { terminalGraphPalette } from './terminalGraph';

interface CanvasCall {
  name: string;
  args: number[];
  ink: string;
  dash: number[];
}

function canvasRecorder() {
  const calls: CanvasCall[] = [];
  const state = { fillStyle: '', strokeStyle: '', dash: [] as number[] };
  const record =
    (name: string) =>
    (...args: number[]) => {
      calls.push({
        name,
        args,
        ink: name === 'stroke' ? state.strokeStyle : state.fillStyle,
        dash: [...state.dash],
      });
    };
  const context = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    setLineDash(pattern: number[]) {
      state.dash = [...pattern];
    },
    beginPath: record('beginPath'),
    arc: record('arc'),
    fill: record('fill'),
    fillRect: record('fillRect'),
    clip: record('clip'),
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
  };
  return { calls, context: context as unknown as CanvasRenderingContext2D };
}

const TOKENS = {
  '--text-success': 'success-ink',
  '--text-info': 'info-ink',
  '--text-secondary': 'secondary-ink',
  '--text-primary': 'monochrome-ink',
};
const PALETTE = terminalGraphPalette(TOKENS);
const METRICS = resolveGraphMetrics({}, 28);

function nodePaint(kind: GraphNodeKind, color: number): GraphRowPaint {
  return {
    node: { kind, color, lane: 0 },
    passes: [],
    links: [],
    form: 'ring',
    initials: '',
    palette: PALETTE,
    metrics: METRICS,
  };
}

function paintNode(kind: GraphNodeKind, color: number) {
  const { context, calls } = canvasRecorder();
  drawGraphNode(context, nodePaint(kind, color), 10, 14);
  return calls;
}

describe('simbología del grafo de Terminal', () => {
  it.each(Array.from({ length: 16 }, (_, index) => index + 1))(
    'el commit del índice de rama %i conserva el círculo hueco al recorrer y repetir la paleta',
    (color) => {
      const calls = paintNode('commit', color);
      const arcs = calls.filter(({ name }) => name === 'arc');
      expect(arcs).toHaveLength(2);
      expect(arcs[0]?.args).toEqual([10, 14, METRICS.nodeRadius, 0, Math.PI * 2]);
      expect(arcs[1]?.args.slice(0, 2)).toEqual([10, 14]);
      expect(arcs[1]?.args[2]).toBeGreaterThan(0);
      expect(arcs[1]?.args[2]).toBeLessThan(METRICS.nodeRadius);
      expect(calls.filter(({ name }) => name === 'clip')).toHaveLength(1);
      expect(calls.filter(({ name }) => name === 'clearRect')).toHaveLength(1);
      expect(calls.some(({ name }) => name === 'fillRect')).toBe(false);
    },
  );

  it.each([1, 2, 3, 6, 9])('WIP conserva su círculo sólido neutro en la rama %i', (color) => {
    const calls = paintNode('wip', color);
    const arcs = calls.filter(({ name }) => name === 'arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.args[2]).toBeGreaterThan(METRICS.nodeRadius);
    expect(calls.find(({ name }) => name === 'fill')?.ink).toBe('monochrome-ink');
    expect(calls.some(({ name }) => ['clip', 'clearRect', 'fillRect'].includes(name))).toBe(false);
  });

  it.each([1, 2, 3, 6, 9])('stash conserva su cuadrado sólido en la rama %i', (color) => {
    const calls = paintNode('stash', color);
    const rectangles = calls.filter(({ name }) => name === 'fillRect');
    expect(rectangles).toHaveLength(1);
    expect(rectangles[0]?.args[2]).toBeGreaterThan(METRICS.nodeRadius * 2);
    expect(calls.find(({ name }) => name === 'rotate')?.args).toEqual([0]);
    expect(['success-ink', 'info-ink', 'secondary-ink']).toContain(rectangles[0]?.ink);
    expect(calls.some(({ name }) => ['arc', 'clip', 'clearRect'].includes(name))).toBe(false);
  });

  it('conserva los tonos y patrones de las calles sin cambiar la figura de sus commits', () => {
    const strokes = Array.from({ length: 8 }, (_, index) => {
      const color = index + 1;
      const { context, calls } = canvasRecorder();
      drawGraphRow(context, {
        ...nodePaint('commit', color),
        passes: [{ lane: 1, color }],
      });
      return calls.find(({ name }) => name === 'stroke')!;
    });
    expect(new Set(strokes.map(({ ink }) => ink))).toEqual(
      new Set(['success-ink', 'info-ink', 'secondary-ink']),
    );
    expect(strokes.some(({ dash }) => dash.length === 0)).toBe(true);
    expect(strokes.some(({ dash }) => dash.length > 0)).toBe(true);
    expect(new Set(strokes.map(({ ink, dash }) => `${ink}:${dash.join(',')}`)).size).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';

import type { Commit } from '@core/domain/commit';
import type { RefsSnapshot, Stash } from '@core/domain/refs';
import type { WorkingStatus } from '@core/domain/status';
import { buildCommitRows } from '@features/working/commits';
import { buildGraph, type GraphNodeKind } from '@features/working/graph';
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
  width: number;
}

function canvasRecorder() {
  const calls: CanvasCall[] = [];
  const state = { fillStyle: '', strokeStyle: '', dash: [] as number[], lineWidth: 0 };
  const record =
    (name: string) =>
    (...args: number[]) => {
      calls.push({
        name,
        args,
        ink: name === 'stroke' ? state.strokeStyle : state.fillStyle,
        dash: [...state.dash],
        width: state.lineWidth,
      });
    };
  const context = {
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
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
    arcTo: record('arcTo'),
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

function commit(sha: string, parents: readonly string[], committedAt: number): Commit {
  const author = { name: 'Alex Rivera', email: 'alex@example.org' };
  return {
    sha,
    parents,
    summary: sha,
    body: '',
    author,
    authoredAt: committedAt,
    committer: author,
    committedAt,
  };
}

function branchedGraph(head: string) {
  const tips = Array.from({ length: 10 }, (_, index) => `tip-${index}`);
  const commits = [
    commit('merge', tips, 100),
    ...tips.map((tip, index) => commit(tip, ['base'], 90 - index)),
    commit('base', ['root'], 10),
    commit('root', [], 0),
  ];
  const stashes: Stash[] = ['tip-7', 'base'].map((base, index) => ({
    index,
    sha: `stash-${index}`,
    base,
    branch: 'feature',
    message: `Guardado ${index}`,
    createdAt: 110 + index,
    fileCount: 1,
  }));
  const refs: RefsSnapshot = {
    head: { branch: 'feature', sha: head, detached: false },
    branches: tips.map((tip) => ({
      id: `refs/heads/${tip}`,
      name: tip,
      tip,
      kind: 'local',
      ahead: 0,
      behind: 0,
      isHead: tip === head,
    })),
    tags: [],
    stashes,
    worktrees: [],
    remotes: [],
  };
  const status: WorkingStatus = {
    staged: [],
    unstaged: [{ path: 'file.ts', change: 'modified', binary: false, insertions: 1, deletions: 0 }],
    conflicted: [],
    clean: false,
  };
  const rows = buildCommitRows(commits, status, stashes);
  return { rows, layout: buildGraph(rows, refs), stashes };
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

  it('conserva los tres tonos con trazos continuos en cada índice y su repetición', () => {
    const strokes = Array.from({ length: 16 }, (_, index) => {
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
    expect(strokes.every(({ dash }) => dash.length === 0)).toBe(true);
    expect(strokes.every(({ width }) => width === METRICS.lineWidth)).toBe(true);
  });

  it.each(['merge', 'tip-4', 'tip-8'])(
    'mantiene los enlaces Git continuos entre WIP y stashes al cambiar HEAD a %s',
    (head) => {
      const { rows, layout, stashes } = branchedGraph(head);
      const colors = rows.flatMap((row, index) =>
        row.kind === 'commit' ? [layout.nodeAt(index).color] : [],
      );
      expect(new Set(colors).size).toBe(8);
      expect(layout.laneCount).toBeGreaterThan(8);
      let normalPassAfterLoose = false;
      let normalLinkAfterLoose = false;
      let sawWip = false;
      let sawStash = false;

      for (const [index] of rows.entries()) {
        const passes = layout.passesAt(index);
        const links = layout.linksAt(index);
        const { context, calls } = canvasRecorder();
        drawGraphRow(context, {
          ...nodePaint(layout.nodeAt(index).kind, layout.nodeAt(index).color),
          node: layout.nodeAt(index),
          passes,
          links,
        });
        const strokes = calls.filter(({ name }) => name === 'stroke');
        const segments = [...passes, ...links];
        expect(strokes).toHaveLength(segments.length);
        let sawLooseInRow = false;
        for (const [position, segment] of segments.entries()) {
          const stroke = strokes[position]!;
          if (segment.kind === 'wip' || segment.kind === 'stash') {
            expect(stroke.dash).toEqual([3, 3]);
            expect(stroke.width).toBeCloseTo(METRICS.lineWidth * 0.6);
            sawWip ||= segment.kind === 'wip';
            sawStash ||= segment.kind === 'stash';
            sawLooseInRow = true;
          } else {
            expect(stroke.dash).toEqual([]);
            expect(stroke.width).toBe(METRICS.lineWidth);
            if (sawLooseInRow) {
              normalPassAfterLoose ||= position < passes.length;
              normalLinkAfterLoose ||= position >= passes.length;
            }
          }
        }
      }
      expect(normalPassAfterLoose).toBe(true);
      expect(normalLinkAfterLoose).toBe(true);
      expect(sawWip).toBe(true);
      expect(sawStash).toBe(true);

      const headIndex = rows.findIndex((row) => row.kind === 'commit' && row.commit.sha === head);
      const headLinks = layout.linksAt(headIndex);
      expect(headLinks.some(({ direction, kind }) => direction === 'up' && kind === 'wip')).toBe(
        true,
      );
      expect(
        headLinks
          .filter(({ direction }) => direction === 'down')
          .every(({ kind }) => kind === undefined || kind === 'branch'),
      ).toBe(true);
      for (let index = headIndex + 1; index < rows.length; index++) {
        expect(
          [...layout.passesAt(index), ...layout.linksAt(index)].some(({ kind }) => kind === 'wip'),
        ).toBe(false);
      }
      for (const stash of stashes) {
        const baseIndex = rows.findIndex(
          (row) => row.kind === 'commit' && row.commit.sha === stash.base,
        );
        expect(
          layout
            .linksAt(baseIndex)
            .some(({ direction, kind }) => direction === 'up' && kind === 'stash'),
        ).toBe(true);
      }
      const lastBase = rows.findIndex((row) => row.kind === 'commit' && row.commit.sha === 'base');
      expect(
        [...layout.passesAt(lastBase + 1), ...layout.linksAt(lastBase + 1)].some(
          ({ kind }) => kind === 'stash',
        ),
      ).toBe(false);
    },
  );
});

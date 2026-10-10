import { describe, expect, it } from 'vitest';

import {
  activateTerminalPane,
  closeTerminalPane,
  initialTerminalLayout,
  renameTerminalPane,
  resizeTerminalSplit,
  splitTerminalPane,
  terminalPanes,
  updateTerminalPaneCwd,
} from './terminalLayout';

describe('layout de Terminal', () => {
  it('divide el pane activo heredando cwd y activa el proceso nuevo', () => {
    const initial = initialTerminalLayout('/repo');
    const layout = splitTerminalPane(initial, 'pane-1', 'horizontal');

    expect(terminalPanes(layout.root)).toEqual([
      { kind: 'pane', id: 'pane-1', title: null, cwd: '/repo' },
      { kind: 'pane', id: 'pane-2', title: null, cwd: '/repo' },
    ]);
    expect(layout.activePaneId).toBe('pane-2');
    expect(layout.root).toMatchObject({ kind: 'split', orientation: 'horizontal', ratio: 0.5 });
  });

  it('colapsa el split al cerrar y nunca elimina el último pane', () => {
    const split = splitTerminalPane(initialTerminalLayout('/repo'), 'pane-1', 'vertical');
    const closed = closeTerminalPane(split, 'pane-2');

    expect(closed.root).toEqual({ kind: 'pane', id: 'pane-1', title: null, cwd: '/repo' });
    expect(closed.activePaneId).toBe('pane-1');
    expect(closeTerminalPane(closed, 'pane-1')).toBe(closed);
  });

  it('conserva ids únicos al dividir, cerrar y volver a dividir', () => {
    let layout = splitTerminalPane(initialTerminalLayout('/repo'), 'pane-1', 'horizontal');
    layout = splitTerminalPane(layout, 'pane-2', 'vertical');
    layout = closeTerminalPane(layout, 'pane-2');
    layout = splitTerminalPane(layout, 'pane-1', 'vertical');

    const ids = terminalPanes(layout.root).map((pane) => pane.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renombra, enfoca y limita el reparto sin tocar procesos', () => {
    let layout = splitTerminalPane(initialTerminalLayout('/repo'), 'pane-1', 'horizontal');
    layout = renameTerminalPane(layout, 'pane-1', '  servidor  ');
    layout = activateTerminalPane(layout, 'pane-1');
    const splitId = layout.root.id;
    layout = resizeTerminalSplit(layout, splitId, 1);

    expect(terminalPanes(layout.root)[0]?.title).toBe('servidor');
    expect(layout.activePaneId).toBe('pane-1');
    expect(layout.root).toMatchObject({ ratio: 0.9 });
  });

  it('conserva el último cwd observado en el pane exacto', () => {
    const split = splitTerminalPane(initialTerminalLayout('/repo'), 'pane-1', 'horizontal');
    const layout = updateTerminalPaneCwd(split, 'pane-1', '/repo/packages/app');

    expect(terminalPanes(layout.root).map((pane) => pane.cwd)).toEqual([
      '/repo/packages/app',
      '/repo',
    ]);
    expect(updateTerminalPaneCwd(layout, 'pane-1', '/repo/packages/app')).toBe(layout);
    expect(updateTerminalPaneCwd(layout, 'missing', '/tmp')).toBe(layout);
  });
});

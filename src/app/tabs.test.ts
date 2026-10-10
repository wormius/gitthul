import { describe, expect, it } from 'vitest';

import {
  activateTab,
  activeTab,
  closeSurface,
  closeTab,
  closeTabs,
  goToRepositories,
  HOME,
  isHome,
  moveTab,
  nudgeTab,
  openSurface,
  openTerminalFrom,
  openWorking,
  stepActive,
  tabIdsToCloseForSpace,
  updateContext,
  updateTerminalLayout,
  updateWorkingResolution,
  type TabsState,
  type WorkingSurface,
} from './tabs';

const gitthul: WorkingSurface = {
  kind: 'working',
  repoId: 'gitthul',
  repoName: 'gitthul',
  repoPath: '/home/example/projects/gitthul',
  branch: 'main',
};

const kernel: WorkingSurface = {
  kind: 'working',
  repoId: 'kernel',
  repoName: 'linux',
  repoPath: '/src/linux',
  branch: 'master',
};

const ids = (state: TabsState) => state.tabs.map((tab) => tab.id);

describe('máquina de pestañas', () => {
  it('guarda y limpia el resumen de resolución en la pestaña de trabajo', () => {
    const opened = openWorking(HOME, 't1', gitthul);
    const saved = updateWorkingResolution(opened, 't1', {
      operation: 'merge:main:feature',
      paths: ['src/a.ts'],
    });

    expect(saved.tabs[0]?.surface).toMatchObject({
      resolution: { operation: 'merge:main:feature', paths: ['src/a.ts'] },
    });
    expect(saved.tabs[0]?.context.repository).toBe(saved.tabs[0]?.surface);
    expect(updateWorkingResolution(saved, 't1', null).tabs[0]?.surface).not.toHaveProperty(
      'resolution',
    );
  });

  it('arranca en el hogar y volver no toca las pestañas', () => {
    expect(isHome(HOME)).toBe(true);

    const state = goToRepositories(openWorking(HOME, 't1', gitthul));

    expect(ids(state)).toEqual(['t1']);
    expect(activeTab(state)).toBeUndefined();
  });

  it('abre una pestaña por repo y abrirlo explícitamente restaura GitWorking', () => {
    let state = openWorking(HOME, 't1', gitthul);

    state = openWorking(state, 't2', { ...gitthul, branch: 'dev' });

    expect(ids(state)).toEqual(['t1']);
    expect(activeTab(state)?.surface).toEqual({ ...gitthul, branch: 'dev' });
  });

  it('abre Terminal sin repo como superficie independiente', () => {
    const state = openSurface(HOME, 't1', { kind: 'terminal', cwd: '/home/me' });
    expect(state.tabs[0]?.context).toEqual({ repository: null, cwd: '/home/me' });
  });

  it('abre una Terminal contextual sin sustituir GitWorking', () => {
    const working = openWorking(HOME, 'w1', gitthul);
    const state = openTerminalFrom(working, 't1', 'w1');

    expect(ids(state)).toEqual(['w1', 't1']);
    expect(state.tabs[0]?.surface).toEqual(gitthul);
    expect(state.tabs[1]).toMatchObject({
      id: 't1',
      surface: { kind: 'terminal', cwd: gitthul.repoPath },
      context: { repository: gitthul, cwd: gitthul.repoPath },
    });
  });

  it('volver a abrir un repo nunca recicla su Terminal contextual', () => {
    let state = openWorking(HOME, 'w1', gitthul);
    state = openTerminalFrom(state, 't1', 'w1');
    state = closeTab(state, 'w1');
    state = openWorking(state, 'w2', { ...gitthul, branch: 'dev' });

    expect(ids(state)).toEqual(['t1', 'w2']);
    expect(state.tabs[0]?.surface).toEqual({ kind: 'terminal', cwd: gitthul.repoPath });
    expect(state.tabs[1]?.surface).toEqual({ ...gitthul, branch: 'dev' });
  });
});

describe('superficies independientes', () => {
  it('cerrar una Terminal cierra su pestaña', () => {
    const state = closeSurface(openSurface(HOME, 't1', { kind: 'terminal', cwd: '/tmp' }), 't1');

    expect(state).toEqual(HOME);
  });

  it('actualiza contexto observado sin cambiar superficie', () => {
    let state = openSurface(HOME, 't1', { kind: 'terminal', cwd: '/tmp' });

    state = updateContext(state, 't1', { repository: kernel, cwd: kernel.repoPath });

    expect(activeTab(state)?.surface.kind).toBe('terminal');
    expect(activeTab(state)?.context).toEqual({ repository: kernel, cwd: kernel.repoPath });
  });

  it('actualiza únicamente el layout de una Terminal activa', () => {
    const initial = openSurface(HOME, 't1', { kind: 'terminal', cwd: '/tmp' });
    const layout = {
      root: { kind: 'pane' as const, id: 'pane-1', title: null, cwd: '/tmp' },
      activePaneId: 'pane-1',
    };
    const state = updateTerminalLayout(initial, 't1', layout);

    expect(activeTab(state)?.surface).toEqual({ kind: 'terminal', cwd: '/tmp', layout });
    expect(updateTerminalLayout(openWorking(HOME, 'w1', gitthul), 'w1', layout)).toEqual(
      openWorking(HOME, 'w1', gitthul),
    );
  });
});

describe('cerrar, reordenar y recorrer', () => {
  const three = () => {
    let state = openWorking(HOME, 't1', gitthul);
    state = openWorking(state, 't2', kernel);
    return openSurface(state, 't3', { kind: 'terminal', cwd: '/tmp' });
  };

  it('cerrar la activa enfoca la derecha o la izquierda', () => {
    const middle = closeTab(activateTab(three(), 't2'), 't2');
    const last = closeTab(activateTab(three(), 't3'), 't3');

    expect(middle.activeId).toBe('t3');
    expect(last.activeId).toBe('t2');
  });

  it('cierra varias pestañas a la vez y enfoca la primera vecina de la derecha', () => {
    const state = closeTabs(activateTab(three(), 't2'), new Set(['t1', 't2']));

    expect(ids(state)).toEqual(['t3']);
    expect(state.activeId).toBe('t3');
  });

  it('al cerrar un espacio conserva repos compartidos que sirven a otro repo abierto', () => {
    let state = openWorking(HOME, 'gitthul-working', gitthul);
    state = openTerminalFrom(state, 'gitthul-terminal', 'gitthul-working');
    state = openWorking(state, 'kernel-working', kernel);
    state = openSurface(state, 'loose-terminal', { kind: 'terminal', cwd: '/tmp' });
    const spaces = [
      { id: 'trabajo', name: 'Trabajo', repos: ['gitthul', 'kernel'] },
      { id: 'personal', name: 'Personal', repos: ['gitthul', 'notes'] },
    ];

    expect([...tabIdsToCloseForSpace(state.tabs, spaces, 'trabajo')]).toEqual([
      'gitthul-working',
      'gitthul-terminal',
      'kernel-working',
    ]);

    const notes = { ...kernel, repoId: 'notes', repoName: 'notes', repoPath: '/src/notes' };
    state = openWorking(state, 'notes-working', notes);

    expect([...tabIdsToCloseForSpace(state.tabs, spaces, 'trabajo')]).toEqual(['kernel-working']);
  });

  it('mueve, recorta y desplaza un puesto sin cambiar la activa', () => {
    expect(ids(moveTab(three(), 't3', 0))).toEqual(['t3', 't1', 't2']);
    expect(ids(moveTab(three(), 't1', 99))).toEqual(['t2', 't3', 't1']);
    expect(ids(nudgeTab(three(), 't2', -1))).toEqual(['t2', 't1', 't3']);
    expect(moveTab(activateTab(three(), 't1'), 't1', 2).activeId).toBe('t1');
  });

  it('recorre hogar y pestañas en anillo', () => {
    let state = goToRepositories(three());

    state = stepActive(state, 1);
    expect(state.activeId).toBe('t1');

    state = stepActive(state, -1);
    expect(state.activeId).toBeNull();
  });
});

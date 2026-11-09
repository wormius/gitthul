import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeSession, type SessionSnapshot } from '@core/domain/session';

import {
  registerTerminalContextResolver,
  restoreShellSession,
  subscribeShellSession,
  useShellStore,
} from './shellStore';
import type { TabContext, WorkingSurface } from './tabs';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function terminalWithOtherFocusedRepository() {
  const first: WorkingSurface = {
    kind: 'working',
    repoId: 'first',
    repoName: 'First',
    repoPath: '/first',
    branch: 'main',
  };
  const second = { ...first, repoId: 'second', repoName: 'Second', repoPath: '/second' };
  const third = { ...first, repoId: 'third', repoName: 'Third', repoPath: '/third' };
  useShellStore.getState().openWorking(first);
  const firstId = useShellStore.getState().activeId!;
  useShellStore.getState().openWorking(second);
  const secondId = useShellStore.getState().activeId!;
  useShellStore.getState().openWorking(third);
  const thirdId = useShellStore.getState().activeId!;
  useShellStore.getState().openTerminalFrom(firstId);
  const terminalId = useShellStore.getState().activeId!;
  return { first, second, third, firstId, secondId, thirdId, terminalId };
}

afterEach(() => {
  useShellStore.getState().reset();
});

describe('sesión del shell', () => {
  it('restaura solo estado persistible y reserva los ids recuperados', () => {
    restoreShellSession(
      normalizeSession({
        tabs: [
          {
            id: 'tab-41',
            surface: { kind: 'terminal', cwd: '/tmp' },
          },
        ],
        activeId: 'tab-41',
      }),
    );

    expect(useShellStore.getState()).toMatchObject({
      activeId: 'tab-41',
      overlay: 'none',
      settingsOpen: false,
      status: null,
    });

    useShellStore.getState().openSurfaceTab({ kind: 'terminal', cwd: '/tmp' });
    expect(useShellStore.getState().activeId).toBe('tab-42');
  });

  it('persiste pestañas y actividad, pero ignora cambios efímeros', () => {
    const snapshots: SessionSnapshot[] = [];
    const write = vi.fn((snapshot: SessionSnapshot) => snapshots.push(snapshot));
    const unsubscribe = subscribeShellSession(write);

    useShellStore.getState().setOverlay('logs');
    useShellStore.getState().setStatus({ tone: 'info', key: 'working.status.copied' });
    expect(write).not.toHaveBeenCalled();

    useShellStore.getState().openSurfaceTab({ kind: 'terminal', cwd: '/tmp' });
    expect(write).toHaveBeenCalledOnce();
    expect(snapshots[0]?.version).toBe(1);
    expect(snapshots[0]?.tabs).toHaveLength(1);
    expect(snapshots[0]?.activeId).toMatch(/^tab-/);

    const tabId = snapshots[0]?.activeId;
    expect(tabId).not.toBeNull();
    useShellStore.getState().updateTerminalLayout(tabId!, {
      root: { kind: 'pane', id: 'pane-1', title: 'servidor', cwd: '/tmp' },
      activePaneId: 'pane-1',
    });
    expect(snapshots[1]?.tabs[0]?.surface).toMatchObject({
      kind: 'terminal',
      layout: { activePaneId: 'pane-1' },
    });

    unsubscribe();
  });

  it('vuelve al último repo enfocado al cerrar una terminal sin repo por las acciones del shell', async () => {
    const first = { repoId: 'first', repoName: 'First', repoPath: '/first', branch: 'main' };
    const second = { repoId: 'second', repoName: 'Second', repoPath: '/second', branch: 'main' };
    useShellStore.getState().openWorking(first);
    const firstId = useShellStore.getState().activeId!;
    useShellStore.getState().openWorking(second);
    useShellStore.getState().activateTab(firstId);
    useShellStore.getState().openSurfaceTab({ kind: 'terminal', cwd: '/tmp' });
    const terminalId = useShellStore.getState().activeId!;

    await useShellStore.getState().closeSurface(terminalId);

    expect(useShellStore.getState().activeId).toBe(firstId);
  });

  it('tras restaurar sin historial de foco usa un repo abierto hasta enfocar uno', async () => {
    restoreShellSession(
      normalizeSession({
        tabs: [
          {
            id: 'first',
            surface: {
              kind: 'working',
              repoId: 'first',
              repoName: 'First',
              repoPath: '/first',
              branch: 'main',
            },
          },
          {
            id: 'second',
            surface: {
              kind: 'working',
              repoId: 'second',
              repoName: 'Second',
              repoPath: '/second',
              branch: 'main',
            },
          },
          { id: 'terminal', surface: { kind: 'terminal', cwd: '/tmp' } },
        ],
        activeId: 'terminal',
      }),
    );

    await useShellStore.getState().closeTab('terminal');

    expect(useShellStore.getState().activeId).toBe('second');
    expect(useShellStore.getState().repositoryFocusHistory[0]).toBe('second');
  });

  it.each(['closeSurface', 'closeTab', 'closeTabs'] as const)(
    '%s espera la detección de B antes de cerrar una terminal que estaba en A',
    async (method) => {
      const { second, secondId, terminalId } = terminalWithOtherFocusedRepository();
      const pending = deferred<TabContext>();
      useShellStore
        .getState()
        .updateTerminalContext(terminalId, { cwd: '/second', repository: null }, pending.promise);

      const closed =
        method === 'closeTabs'
          ? useShellStore.getState().closeTabs(new Set([terminalId]))
          : useShellStore.getState()[method](terminalId);
      expect(useShellStore.getState().activeId).toBe(terminalId);
      expect(useShellStore.getState().tabs.some((tab) => tab.id === terminalId)).toBe(true);

      pending.resolve({ cwd: '/second', repository: second });
      await closed;

      expect(useShellStore.getState().activeId).toBe(secondId);
      expect(useShellStore.getState().tabs.some((tab) => tab.id === terminalId)).toBe(false);
    },
  );

  it('si la carpeta nueva no es repo vuelve al último repo enfocado cuando termina la lectura', async () => {
    const { thirdId, terminalId } = terminalWithOtherFocusedRepository();
    const pending = deferred<TabContext>();
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/outside', repository: null }, pending.promise);
    const closed = useShellStore.getState().closeTab(terminalId);

    pending.reject(new Error('not a repository'));
    await closed;

    expect(useShellStore.getState().activeId).toBe(thirdId);
  });

  it('espera también el cwd más reciente si cambia de nuevo durante el cierre', async () => {
    const { second, third, thirdId, terminalId } = terminalWithOtherFocusedRepository();
    const earlier = deferred<TabContext>();
    const latest = deferred<TabContext>();
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/second', repository: null }, earlier.promise);
    const closed = useShellStore.getState().closeTab(terminalId);
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/third', repository: null }, latest.promise);

    earlier.resolve({ cwd: '/second', repository: second });
    await earlier.promise;
    expect(useShellStore.getState().activeId).toBe(terminalId);
    latest.resolve({ cwd: '/third', repository: third });
    await closed;

    expect(useShellStore.getState().activeId).toBe(thirdId);
  });

  it('no roba el foco si el usuario navega a otra pestaña durante la detección', async () => {
    const { firstId, second, terminalId } = terminalWithOtherFocusedRepository();
    const pending = deferred<TabContext>();
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/second', repository: null }, pending.promise);
    const closed = useShellStore.getState().closeTab(terminalId);
    useShellStore.getState().activateTab(firstId);

    pending.resolve({ cwd: '/second', repository: second });
    await closed;

    expect(useShellStore.getState().activeId).toBe(firstId);
    expect(useShellStore.getState().tabs.some((tab) => tab.id === terminalId)).toBe(false);
  });

  it('revalida las pestañas que permanecen tras esperar el contexto', async () => {
    const { second, secondId, thirdId, terminalId } = terminalWithOtherFocusedRepository();
    const pending = deferred<TabContext>();
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/second', repository: null }, pending.promise);
    const closed = useShellStore.getState().closeTab(terminalId);
    await useShellStore.getState().closeTab(secondId);

    pending.resolve({ cwd: '/second', repository: second });
    await closed;

    expect(useShellStore.getState().activeId).toBe(thirdId);
  });

  it('no aplica un cierre pendiente a otra sesión restaurada', async () => {
    const { terminalId, second } = terminalWithOtherFocusedRepository();
    const pending = deferred<TabContext>();
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/second', repository: null }, pending.promise);
    const closed = useShellStore.getState().closeTab(terminalId);
    restoreShellSession(
      normalizeSession({
        tabs: [{ id: terminalId, surface: { kind: 'terminal', cwd: '/tmp' } }],
        activeId: terminalId,
      }),
    );

    pending.resolve({ cwd: '/second', repository: second });
    await closed;

    expect(useShellStore.getState().activeId).toBe(terminalId);
    expect(useShellStore.getState().tabs).toHaveLength(1);
  });

  it('revalida el directorio conocido aunque no haya una detección pendiente', async () => {
    const { firstId, thirdId, terminalId } = terminalWithOtherFocusedRepository();
    const pending = deferred<TabContext>();
    const resolve = vi.fn(() => pending.promise);
    const stop = registerTerminalContextResolver(terminalId, resolve);
    const closed = useShellStore.getState().closeTab(terminalId);
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledOnce();
    expect(useShellStore.getState().activeId).toBe(terminalId);
    // El repo desapareció sin cambiar el cwd: no debe volver a firstId.
    pending.resolve({ cwd: '/first', repository: null });
    await closed;

    expect(useShellStore.getState().activeId).toBe(thirdId);
    expect(useShellStore.getState().activeId).not.toBe(firstId);
    stop();
  });

  it('cerrar una terminal de fondo no espera su detección ni cambia el foco', async () => {
    const { firstId, terminalId } = terminalWithOtherFocusedRepository();
    const pending = deferred<TabContext>();
    useShellStore
      .getState()
      .updateTerminalContext(terminalId, { cwd: '/outside', repository: null }, pending.promise);
    useShellStore.getState().activateTab(firstId);

    await useShellStore.getState().closeTab(terminalId);

    expect(useShellStore.getState().activeId).toBe(firstId);
    expect(useShellStore.getState().tabs.some((tab) => tab.id === terminalId)).toBe(false);
    pending.resolve({ cwd: '/outside', repository: null });
  });
});

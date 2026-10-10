import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeSession, type SessionSnapshot } from '@core/domain/session';

import { restoreShellSession, subscribeShellSession, useShellStore } from './shellStore';

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
});

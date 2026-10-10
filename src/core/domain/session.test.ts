import { describe, expect, it } from 'vitest';

import { EMPTY_SESSION, normalizeSession } from './session';

const working = {
  kind: 'working',
  repoId: 'gitthul',
  repoName: 'GitThul',
  repoPath: '/repos/gitthul',
  branch: 'main',
} as const;

describe('snapshot ligero de sesión', () => {
  it('normaliza una sesión válida y reconstruye el contexto de GitWorking', () => {
    expect(
      normalizeSession({
        version: 99,
        tabs: [
          {
            id: 'tab-7',
            surface: working,
            history: [{ kind: 'terminal', cwd: '/tmp' }],
            companion: { kind: 'retired-companion' },
            context: { repository: null, cwd: '/equivocado' },
          },
        ],
        activeId: 'tab-7',
        overlay: 'logs',
        status: { text: 'efímero' },
      }),
    ).toEqual({
      version: 1,
      tabs: [
        {
          id: 'tab-7',
          surface: working,
          context: { repository: working, cwd: '/repos/gitthul' },
        },
      ],
      activeId: 'tab-7',
    });
  });

  it('descarta pestañas rotas, ids repetidos y una activa inexistente', () => {
    expect(
      normalizeSession({
        tabs: [
          { id: 'tab-1', surface: { kind: 'terminal', cwd: '/tmp' } },
          { id: 'tab-1', surface: { kind: 'retired-surface' } },
          { id: 'tab-2', surface: { kind: 'working', repoId: '' } },
          null,
        ],
        activeId: 'tab-404',
      }),
    ).toEqual({
      version: 1,
      tabs: [
        {
          id: 'tab-1',
          surface: { kind: 'terminal', cwd: '/tmp' },
          context: { repository: null, cwd: '/tmp' },
        },
      ],
      activeId: null,
    });
  });

  it('cae a una sesión vacía ante datos ilegibles', () => {
    expect(normalizeSession(null)).toEqual(EMPTY_SESSION);
  });

  it('conserva solo las rutas válidas de una resolución en curso', () => {
    const snapshot = normalizeSession({
      tabs: [
        {
          id: 'tab-1',
          surface: {
            ...working,
            resolution: {
              operation: 'merge:main:feature',
              paths: ['src/a.ts', ' src/con-espacios.ts ', 'src/a.ts', '', null, 'bad\0path'],
            },
          },
        },
      ],
      activeId: 'tab-1',
    });

    expect(snapshot.tabs[0]?.surface).toMatchObject({
      resolution: {
        operation: 'merge:main:feature',
        paths: ['src/a.ts', ' src/con-espacios.ts '],
      },
    });
  });

  it('recupera la última superficie válida de una transformación retirada', () => {
    expect(
      normalizeSession({
        tabs: [
          {
            id: 'tab-1',
            surface: { kind: 'retired-surface' },
            history: [working],
            context: { repository: working, cwd: working.repoPath },
          },
          { id: 'tab-2', surface: { kind: 'retired-surface' } },
        ],
        activeId: 'tab-1',
      }),
    ).toEqual({
      version: 1,
      tabs: [
        {
          id: 'tab-1',
          surface: working,
          context: { repository: working, cwd: working.repoPath },
        },
      ],
      activeId: 'tab-1',
    });
  });

  it('conserva solo layout de Terminal y descarta estado de proceso', () => {
    const snapshot = normalizeSession({
      tabs: [
        {
          id: 'tab-terminal',
          surface: {
            kind: 'terminal',
            cwd: '/repo',
            layout: {
              activePaneId: 'pane-2',
              root: {
                kind: 'split',
                id: 'split-1',
                orientation: 'horizontal',
                ratio: 0.63,
                first: { kind: 'pane', id: 'pane-1', title: 'servidor', cwd: '/repo' },
                second: {
                  kind: 'pane',
                  id: 'pane-2',
                  title: null,
                  cwd: '/repo/docs',
                  processId: 99,
                  scrollback: ['secreto'],
                },
              },
            },
          },
        },
      ],
      activeId: 'tab-terminal',
    });

    expect(snapshot.tabs[0]?.surface).toEqual({
      kind: 'terminal',
      cwd: '/repo',
      layout: {
        activePaneId: 'pane-2',
        root: {
          kind: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          ratio: 0.63,
          first: { kind: 'pane', id: 'pane-1', title: 'servidor', cwd: '/repo' },
          second: { kind: 'pane', id: 'pane-2', title: null, cwd: '/repo/docs' },
        },
      },
    });
  });
});

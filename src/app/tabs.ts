import type { TerminalLayout } from '@core/domain/terminal';
import type { Space, SpaceId } from '@core/domain/library';
import type { SessionResolution } from '@core/domain/session';

/*
 * Máquina pura de pestañas y superficies.
 *
 * Una pestaña enseña GitWorking o Terminal. El contexto viaja como foto inicial
 * y después cada superficie puede actualizar el suyo.
 */

export interface WorkingSurface {
  kind: 'working';
  repoId: string;
  repoName: string;
  repoPath: string;
  /** Rama activa del repositorio o del worktree. Nunca implícita. */
  branch: string;
  /** Nombre del repositorio padre cuando la pestaña es un worktree. */
  worktreeOf?: string;
  /** Resumen recuperable de la resolución en curso; nunca contiene archivos. */
  resolution?: SessionResolution;
}

/** Alias temporal para consumidores de GitWorking; se retira al migrar esa feature. */
export type WorkingBase = WorkingSurface;

export interface TerminalSurface {
  kind: 'terminal';
  /** Carpeta de arranque; el cwd observado podrá cambiarla después. */
  cwd: string;
  /** Geometría recuperable; ausente en snapshots anteriores a P6.2. */
  layout?: TerminalLayout;
}

export type TabSurface = WorkingSurface | TerminalSurface;

export interface TabContext {
  /** Repositorio de partida o el detectado más recientemente. */
  repository: WorkingSurface | null;
  /** Directorio de partida o el observado más recientemente. */
  cwd: string | null;
}

export interface Tab {
  id: string;
  surface: TabSurface;
  context: TabContext;
}

export interface TabsState {
  tabs: readonly Tab[];
  /** `null` es el hogar Repositorios, que no ocupa una pestaña. */
  activeId: string | null;
}

export const HOME: TabsState = { tabs: [], activeId: null };

export function isHome(state: TabsState): boolean {
  return state.activeId === null;
}

export function findTab(state: TabsState, id: string): Tab | undefined {
  return state.tabs.find((tab) => tab.id === id);
}

export function activeTab(state: TabsState): Tab | undefined {
  return state.activeId === null ? undefined : findTab(state, state.activeId);
}

export function repositoryTab(state: TabsState, repoId: string): Tab | undefined {
  return state.tabs.find(
    (tab) => tab.surface.kind === 'working' && tab.context.repository?.repoId === repoId,
  );
}

function replace(state: TabsState, id: string, patch: (tab: Tab) => Tab): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? patch(tab) : tab)) };
}

function contextFor(surface: TabSurface, inherited?: TabContext): TabContext {
  if (surface.kind === 'working') {
    return { repository: surface, cwd: surface.repoPath };
  }

  return {
    repository: inherited?.repository ?? null,
    cwd: surface.kind === 'terminal' ? surface.cwd : (inherited?.cwd ?? null),
  };
}

export function activateTab(state: TabsState, id: string): TabsState {
  return findTab(state, id) ? { ...state, activeId: id } : state;
}

export function goToRepositories(state: TabsState): TabsState {
  return { ...state, activeId: null };
}

/** Abre el repositorio o devuelve explícitamente su pestaña a GitWorking. */
export function openWorking(state: TabsState, newId: string, surface: WorkingSurface): TabsState {
  const existing = repositoryTab(state, surface.repoId);

  if (existing) {
    return activateTab(
      replace(state, existing.id, (tab) => ({
        ...tab,
        surface,
        context: contextFor(surface),
      })),
      existing.id,
    );
  }

  return {
    tabs: [...state.tabs, { id: newId, surface, context: contextFor(surface) }],
    activeId: newId,
  };
}

/** Abre una superficie sin contexto previo. */
export function openSurface(state: TabsState, newId: string, surface: TerminalSurface): TabsState {
  return {
    tabs: [...state.tabs, { id: newId, surface, context: contextFor(surface) }],
    activeId: newId,
  };
}

/** Abre una Terminal nueva con una foto del contexto de otra pestaña. */
export function openTerminalFrom(state: TabsState, newId: string, sourceId: string): TabsState {
  const source = findTab(state, sourceId);
  if (!source) return state;

  const surface: TerminalSurface = { kind: 'terminal', cwd: source.context.cwd ?? '' };

  return {
    tabs: [
      ...state.tabs,
      {
        id: newId,
        surface,
        context: contextFor(surface, source.context),
      },
    ],
    activeId: newId,
  };
}

/** Cierra una superficie independiente. */
export function closeSurface(state: TabsState, id: string): TabsState {
  return closeTab(state, id);
}

/** Actualiza contexto observado sin cambiar la superficie. */
export function updateContext(state: TabsState, id: string, context: TabContext): TabsState {
  const tab = findTab(state, id);
  if (!tab) return state;
  if (tab.context.repository === context.repository && tab.context.cwd === context.cwd)
    return state;

  return replace(state, id, (current) => ({ ...current, context }));
}

export function updateTerminalLayout(
  state: TabsState,
  id: string,
  layout: TerminalLayout,
): TabsState {
  const tab = findTab(state, id);
  if (!tab || tab.surface.kind !== 'terminal') return state;
  return replace(state, id, (current) =>
    current.surface.kind === 'terminal'
      ? { ...current, surface: { ...current.surface, layout } }
      : current,
  );
}

/** Conserva las rutas resueltas en la superficie recuperable de GitWorking. */
export function updateWorkingResolution(
  state: TabsState,
  id: string,
  resolution: SessionResolution | null,
): TabsState {
  const tab = findTab(state, id);
  if (!tab || tab.surface.kind !== 'working') return state;

  return replace(state, id, (current) => {
    if (current.surface.kind !== 'working') return current;

    const surface = { ...current.surface };
    if (resolution) surface.resolution = resolution;
    else delete surface.resolution;

    return {
      ...current,
      surface,
      context: {
        ...current.context,
        repository:
          current.context.repository?.repoId === surface.repoId
            ? surface
            : current.context.repository,
      },
    };
  });
}

function neighbourId(tabs: readonly Tab[], closedIndex: number): string | null {
  return tabs[closedIndex]?.id ?? tabs[closedIndex - 1]?.id ?? null;
}

export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;

  const tabs = state.tabs.filter((tab) => tab.id !== id);

  return {
    tabs,
    activeId: state.activeId === id ? neighbourId(tabs, index) : state.activeId,
  };
}

/**
 * Cierra un conjunto como una sola operación y conserva una vecina estable.
 *
 * La vecina se calcula respecto de la posición original de la pestaña activa:
 * primero la que queda a su derecha y, si no existe, la última de la izquierda.
 */
export function closeTabs(state: TabsState, ids: ReadonlySet<string>): TabsState {
  if (ids.size === 0) return state;

  const removed = state.tabs.filter((tab) => ids.has(tab.id));
  if (removed.length === 0) return state;

  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeId);
  const tabs = state.tabs.filter((tab) => !ids.has(tab.id));

  if (state.activeId === null || !ids.has(state.activeId)) return { ...state, tabs };

  const right = state.tabs.slice(activeIndex + 1).find((tab) => !ids.has(tab.id));
  const left = [...state.tabs.slice(0, activeIndex)].reverse().find((tab) => !ids.has(tab.id));

  return { tabs, activeId: right?.id ?? left?.id ?? null };
}

/**
 * Pestañas que deben cerrarse al cerrar un espacio.
 *
 * Un repositorio compartido se conserva cuando otro repositorio abierto
 * pertenece a cualquiera de sus otros espacios. Todas las superficies con el
 * mismo contexto Git se conservan o se cierran juntas.
 */
export function tabIdsToCloseForSpace(
  tabs: readonly Tab[],
  spaces: readonly Space[],
  spaceId: SpaceId,
): ReadonlySet<string> {
  const target = spaces.find((space) => space.id === spaceId);
  if (!target) return new Set();

  const openRepoIds = new Set(
    tabs.flatMap((tab) => (tab.context.repository ? [tab.context.repository.repoId] : [])),
  );
  const reposToClose = new Set(
    target.repos.filter((repoId) => {
      if (!openRepoIds.has(repoId)) return false;

      const sharedElsewhere = spaces
        .filter((space) => space.id !== spaceId && space.repos.includes(repoId))
        .some((space) =>
          space.repos.some((member) => member !== repoId && openRepoIds.has(member)),
        );

      return !sharedElsewhere;
    }),
  );

  return new Set(
    tabs
      .filter((tab) => {
        const repoId = tab.context.repository?.repoId;
        return repoId !== undefined && reposToClose.has(repoId);
      })
      .map((tab) => tab.id),
  );
}

export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex((tab) => tab.id === id);
  const moved = state.tabs[from];
  if (from === -1 || !moved) return state;

  const rest = state.tabs.filter((tab) => tab.id !== id);
  const to = Math.min(Math.max(toIndex, 0), rest.length);
  if (to === from) return state;

  return { ...state, tabs: [...rest.slice(0, to), moved, ...rest.slice(to)] };
}

export function nudgeTab(state: TabsState, id: string, step: 1 | -1): TabsState {
  const from = state.tabs.findIndex((tab) => tab.id === id);
  if (from === -1) return state;

  const to = from + step;
  if (to < 0 || to >= state.tabs.length) return state;

  return moveTab(state, id, to);
}

export function stepActive(state: TabsState, step: 1 | -1): TabsState {
  if (state.tabs.length === 0) return state;

  const ring: readonly (string | null)[] = [null, ...state.tabs.map((tab) => tab.id)];
  const from = ring.indexOf(state.activeId);
  if (from === -1) return state;

  return { ...state, activeId: ring[(from + step + ring.length) % ring.length] ?? null };
}

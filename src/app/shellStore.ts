import { create } from 'zustand';
import type { SearchTarget } from './overlays/searchEngine';

import type { SessionResolution, SessionSnapshot } from '@core/domain/session';
import type { TerminalLayout } from '@core/domain/terminal';
import type { MessageParams } from '@i18n/format';
import type { MessageKey } from '@i18n/messages';
import type { SettingsSectionId } from '@features/settings/sections';

import {
  activateTab,
  activeTab,
  closeSurface,
  closeTab,
  closeTabs,
  goToRepositories,
  HOME,
  moveTab,
  nudgeTab,
  openSurface,
  openTerminalFrom,
  openWorking,
  stepActive,
  updateContext,
  updateTerminalLayout,
  updateWorkingResolution,
  type TabContext,
  type Tab,
  type TabSurface,
  type TabsState,
  type TerminalSurface,
  type WorkingSurface,
} from './tabs';

/** Qué se está superponiendo a la vista. Solo una cosa a la vez. */
export type Overlay = 'none' | 'search' | 'logs' | 'notifications' | 'about';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * El mensaje de la barra inferior se guarda como clave más parámetros y no como
 * frase: cambiar de idioma en caliente tiene que retraducir también lo que ya
 * estaba escrito ahí.
 */
export interface StatusDescriptor {
  tone: StatusTone;
  key: MessageKey;
  params?: MessageParams;
  action?: {
    key: MessageKey;
    params?: MessageParams;
    onAction: () => void;
  };
}

export interface ShellState extends TabsState {
  overlay: Overlay;
  settingsOpen: boolean;
  /** Sección que debe enfocar la próxima vista de ajustes; `null` usa Apariencia. */
  settingsSection: SettingsSectionId | null;
  settingsFocus: MessageKey | null;
  searchNavigation: SearchTarget | null;
  addingProfile: boolean;
  status: StatusDescriptor | null;
}

export interface ShellActions {
  /** Vuelve al hogar. Repositorios no es una pestaña: no se abre ni se cierra. */
  goToRepositories: () => void;
  /** Abre el repositorio en su pestaña, o activa la que ya lo tiene. */
  openWorking: (repo: Omit<WorkingSurface, 'kind'>) => void;
  /** Pestaña independiente, sin contexto de origen. */
  openSurfaceTab: (surface: Exclude<TabSurface, WorkingSurface>) => void;
  /** Terminal independiente que hereda solo el contexto inicial de otra pestaña. */
  openTerminalFrom: (id: string) => void;
  /** Abre o activa la pestaña de configuraciones. Solo una a la vez. */
  openSettings: (section?: SettingsSectionId) => void;
  closeSurface: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  closeTabs: (ids: ReadonlySet<string>) => Promise<void>;
  updateTerminalLayout: (id: string, layout: TerminalLayout) => void;
  updateWorkingResolution: (id: string, resolution: SessionResolution | null) => void;
  updateTerminalContext: (id: string, context: TabContext, pending?: Promise<TabContext>) => void;
  activateTab: (id: string) => void;
  stepActive: (step: 1 | -1) => void;
  moveTab: (id: string, toIndex: number) => void;
  nudgeTab: (id: string, step: 1 | -1) => void;
  setOverlay: (overlay: Overlay) => void;
  setStatus: (status: StatusDescriptor) => void;
  clearStatus: () => void;
  /** Vuelve al estado de arranque. La usan las pruebas entre casos. */
  reset: () => void;
}

/*
 * Los identificadores de pestaña y de sesión son de la sesión de la aplicación,
 * no del dominio: un contador basta y hace las pruebas deterministas, que es
 * más de lo que daría un uuid.
 */
let counter = 0;
let sessionGeneration = 0;

/** Lecturas del cwd actual; nunca se incluyen en el snapshot persistible. */
const pendingTerminalContexts = new Map<string, Promise<TabContext>>();
const terminalContextResolvers = new Map<string, (tab: Tab) => Promise<TabContext>>();

/** La vista aporta el puerto; la tienda solo coordina el cierre y su contexto. */
export function registerTerminalContextResolver(
  id: string,
  resolve: (tab: Tab) => Promise<TabContext>,
): () => void {
  terminalContextResolvers.set(id, resolve);
  return () => {
    if (terminalContextResolvers.get(id) === resolve) terminalContextResolvers.delete(id);
  };
}

function nextId(prefix: string): string {
  counter += 1;

  return `${prefix}-${String(counter)}`;
}

function freshState(): ShellState {
  return {
    ...HOME,
    overlay: 'none',
    settingsOpen: false,
    settingsSection: null,
    settingsFocus: null,
    searchNavigation: null,
    addingProfile: false,
    status: null,
  };
}

function reserveSessionIds(snapshot: SessionSnapshot): void {
  const ids = snapshot.tabs.map((tab) => tab.id);

  for (const id of ids) {
    const match = /^(?:tab|session)-(\d+)$/.exec(id);
    if (match) counter = Math.max(counter, Number(match[1]));
  }
}

export function newTerminalSurface(cwd: string): TerminalSurface {
  return { kind: 'terminal', cwd };
}

/**
 * Estado del shell: pestañas, superposición activa y último mensaje de estado.
 *
 * Es una sola tienda porque las tres cosas cambian juntas — cerrar una pestaña
 * escribe un mensaje, abrir la búsqueda no debe convivir con Configuraciones —
 * y porque el shell es único: no hay dos barras inferiores.
 *
 * Solo `tabs` y `activeId` se persisten. El historial de foco, overlays, settings
 * y status son estado efímero de ventana y vuelven a sus valores de arranque.
 */
export const useShellStore = create<ShellState & ShellActions>((set, get) => {
  const setTerminalContext = (id: string, context: TabContext, pending?: Promise<TabContext>) => {
    if (pending) {
      const request = pending.catch(() => context);
      pendingTerminalContexts.set(id, request);
      void request.then((resolved) => {
        if (pendingTerminalContexts.get(id) !== request) return;
        pendingTerminalContexts.delete(id);
        set((state) => updateContext(state, id, resolved));
      });
    } else {
      pendingTerminalContexts.delete(id);
    }
    set((state) => updateContext(state, id, context));
  };

  const closeWithContext = (
    ids: ReadonlySet<string>,
    close: (state: TabsState) => TabsState,
  ): Promise<void> => {
    const generation = sessionGeneration;
    const checked = new Set<string>();
    const pendingForActive = () => {
      const tab = activeTab(get());
      if (tab?.surface.kind !== 'terminal' || !ids.has(tab.id)) return undefined;
      let pending = pendingTerminalContexts.get(tab.id);
      const resolve = terminalContextResolvers.get(tab.id);
      if (!pending && resolve && !checked.has(tab.id)) {
        const provisional = { ...tab.context, repository: null };
        setTerminalContext(
          tab.id,
          provisional,
          Promise.resolve().then(() => resolve(tab)),
        );
        pending = pendingTerminalContexts.get(tab.id);
      }
      checked.add(tab.id);
      return pending;
    };

    const finish = () => {
      if (sessionGeneration !== generation) return;
      set((state) => close(state));
      for (const id of ids) {
        pendingTerminalContexts.delete(id);
        terminalContextResolvers.delete(id);
      }
    };

    const pending = pendingForActive();
    if (!pending) {
      finish();
      return Promise.resolve();
    }

    return (async () => {
      let current: Promise<TabContext> | undefined = pending;
      while (current) {
        await current;
        if (sessionGeneration !== generation) return;
        // Pueden haber cambiado el cwd o la pestaña activa durante la espera.
        current = pendingForActive();
      }
      finish();
    })();
  };

  return {
    ...freshState(),

    goToRepositories: () => {
      set((state) => ({ ...goToRepositories(state), settingsOpen: false }));
    },

    openWorking: (repo) => {
      set((state) => ({
        ...openWorking(state, nextId('tab'), { kind: 'working', ...repo }),
        settingsOpen: false,
      }));
    },

    openSurfaceTab: (surface) => {
      set((state) => openSurface(state, nextId('tab'), surface));
    },

    openTerminalFrom: (id) => {
      set((state) => openTerminalFrom(state, nextId('tab'), id));
    },

    openSettings: (section) => {
      set(() => ({
        settingsOpen: true,
        settingsSection: section ?? null,
        settingsFocus: null,
        addingProfile: false,
      }));
    },

    closeSurface: (id) => {
      return closeWithContext(new Set([id]), (state) => closeSurface(state, id));
    },

    closeTab: (id) => {
      return closeWithContext(new Set([id]), (state) => closeTab(state, id));
    },

    closeTabs: (ids) => {
      const selected = new Set(ids);
      return closeWithContext(selected, (state) => closeTabs(state, selected));
    },

    updateTerminalLayout: (id, layout) => {
      set((state) => updateTerminalLayout(state, id, layout));
    },

    updateWorkingResolution: (id, resolution) => {
      set((state) => updateWorkingResolution(state, id, resolution));
    },

    updateTerminalContext: (id, context, pending) => {
      setTerminalContext(id, context, pending);
    },

    activateTab: (id) => {
      set((state) => ({ ...activateTab(state, id), settingsOpen: false }));
    },

    stepActive: (step) => {
      set((state) => stepActive(state, step));
    },

    moveTab: (id, toIndex) => {
      set((state) => moveTab(state, id, toIndex));
    },

    nudgeTab: (id, step) => {
      set((state) => nudgeTab(state, id, step));
    },

    setOverlay: (overlay) => {
      set({ overlay });
    },

    setStatus: (status) => {
      set({ status });
    },

    clearStatus: () => {
      set({ status: null });
    },

    reset: () => {
      sessionGeneration += 1;
      pendingTerminalContexts.clear();
      terminalContextResolvers.clear();
      set(freshState());
    },
  };
});

/** Se llama una vez, antes del primer render, con datos ya normalizados. */
export function restoreShellSession(snapshot: SessionSnapshot): void {
  sessionGeneration += 1;
  pendingTerminalContexts.clear();
  terminalContextResolvers.clear();
  reserveSessionIds(snapshot);
  const restored = { ...freshState(), tabs: snapshot.tabs, activeId: snapshot.activeId };
  useShellStore.setState(snapshot.activeId ? activateTab(restored, snapshot.activeId) : restored);
}

/** Escucha únicamente cambios persistibles, no overlays ni mensajes efímeros. */
export function subscribeShellSession(onChange: (snapshot: SessionSnapshot) => void): () => void {
  return useShellStore.subscribe((state, previous) => {
    if (state.tabs === previous.tabs && state.activeId === previous.activeId) return;
    onChange({ version: 1, tabs: state.tabs, activeId: state.activeId });
  });
}

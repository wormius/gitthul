import { create } from 'zustand';
import type { SearchTarget } from './overlays/searchEngine';

import type { SessionResolution, SessionSnapshot } from '@core/domain/session';
import type { TerminalLayout } from '@core/domain/terminal';
import type { MessageParams } from '@i18n/format';
import type { MessageKey } from '@i18n/messages';
import type { SettingsSectionId } from '@features/settings/sections';

import {
  activateTab,
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
  closeSurface: (id: string) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: ReadonlySet<string>) => void;
  updateTerminalLayout: (id: string, layout: TerminalLayout) => void;
  updateWorkingResolution: (id: string, resolution: SessionResolution | null) => void;
  updateTerminalContext: (id: string, context: TabContext) => void;
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
 * Solo `tabs` y `activeId` se persisten. Overlays, settings y status son estado
 * efímero de ventana y vuelven siempre a sus valores de arranque.
 */
export const useShellStore = create<ShellState & ShellActions>((set) => ({
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
    set((state) => closeSurface(state, id));
  },

  closeTab: (id) => {
    set((state) => closeTab(state, id));
  },

  closeTabs: (ids) => {
    set((state) => closeTabs(state, ids));
  },

  updateTerminalLayout: (id, layout) => {
    set((state) => updateTerminalLayout(state, id, layout));
  },

  updateWorkingResolution: (id, resolution) => {
    set((state) => updateWorkingResolution(state, id, resolution));
  },

  updateTerminalContext: (id, context) => {
    set((state) => updateContext(state, id, context));
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
    set(freshState());
  },
}));

/** Se llama una vez, antes del primer render, con datos ya normalizados. */
export function restoreShellSession(snapshot: SessionSnapshot): void {
  reserveSessionIds(snapshot);
  useShellStore.setState({ ...freshState(), tabs: snapshot.tabs, activeId: snapshot.activeId });
}

/** Escucha únicamente cambios persistibles, no overlays ni mensajes efímeros. */
export function subscribeShellSession(onChange: (snapshot: SessionSnapshot) => void): () => void {
  return useShellStore.subscribe((state, previous) => {
    if (state.tabs === previous.tabs && state.activeId === previous.activeId) return;
    onChange({ version: 1, tabs: state.tabs, activeId: state.activeId });
  });
}

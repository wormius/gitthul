import { useMemo } from 'react';

import { useTheme } from '@design/useTheme';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { FILTER_INPUT_ID } from '@features/repositories/repositoryGestures';
import { useWorkingStore } from '@features/working/workingStore';
import { useI18n } from '@i18n/useI18n';

import type { GestureDefinition } from './gestures';
import { APP_SITE_URL, APP_SUPPORT_URL } from './metadata';
import { usePorts } from './PortsContext';
import { newTerminalSurface, useShellStore } from './shellStore';
import { activeTab, isHome } from './tabs';

/**
 * Carpeta de arranque de una terminal sin repositorio debajo.
 *
 * Vacía significa «la que el sistema dé por defecto». Decidirlo aquí y no en el
 * componente evita que cada camino invente su propia respuesta.
 */
const NO_CWD = '';

/**
 * Los gestos del shell, con sus rótulos traducidos y sus atajos.
 *
 * Los atajos cubren navegación y búsqueda. Las acciones ocasionales se alcanzan
 * desde sus botones o la búsqueda global, sin exigir otra combinación.
 */
export function useShellGestureDefinitions(): readonly GestureDefinition[] {
  const { t } = useI18n();
  const { link } = usePorts();
  const { resolved, update } = useTheme();
  const store = useShellStore();

  /*
   * La terminal que se abre desde Repositorios arranca en la carpeta del
   * repositorio seleccionado, que es lo que pide CU-13. El botón que la abre
   * llama a este mismo gesto y no a una copia local —una acción, un nombre—, así
   * que la carpeta se decide aquí. Fuera del hogar no hay selección que valga:
   * ahí la terminal es la del sistema.
   */
  const home = useShellStore(isHome);
  const selected = useRepositoriesStore((state) => state.selected);
  const cwd = home && selected ? selected.path : NO_CWD;

  return useMemo<readonly GestureDefinition[]>(() => {
    const current = activeTab(store);

    return [
      {
        id: 'shell.goToRepositories',
        label: t('gesture.goToRepositories'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+H',
        allowWhileTyping: true,
        run: () => {
          store.goToRepositories();
        },
      },
      {
        id: 'shell.openTerminalTab',
        label: t('gesture.openTerminalTab'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+T',
        allowWhileTyping: true,
        run: () => {
          if (current) store.openTerminalFrom(current.id);
          else store.openSurfaceTab(newTerminalSurface(cwd));
        },
      },
      {
        id: 'shell.openContextTerminalTab',
        label: t('gesture.openContextTerminalTab'),
        triggers: ['hoverAction', 'button', 'search'],
        disabled: !current,
        run: () => {
          if (current) store.openTerminalFrom(current.id);
        },
      },
      {
        // Se conserva en el botón y la búsqueda. Cerrar por teclado comparte
        // Ctrl/Cmd+W con el resto de pestañas; Escape pertenece al control local.
        id: 'shell.closeMode',
        label: t('gesture.closeTerminal'),
        triggers: ['button', 'search'],
        disabled: !current || current.surface.kind === 'working',
        hiddenInSearch: !current || current.surface.kind === 'working',
        run: () => {
          if (current) store.closeSurface(current.id);
        },
      },
      {
        id: 'shell.closeTab',
        label: t('gesture.closeTab'),
        triggers: ['button', 'wheelClick', 'shortcut', 'search'],
        shortcut: 'Mod+W',
        allowWhileTyping: true,
        disabled: !current,
        run: () => {
          if (current) store.closeTab(current.id);
        },
      },
      {
        id: 'shell.moveTabStart',
        label: t('gesture.moveTabStart'),
        triggers: ['drag', 'search'],
        hiddenInSearch: !current,
        disabled: !current,
        run: () => {
          if (current) store.nudgeTab(current.id, -1);
        },
      },
      {
        id: 'shell.moveTabEnd',
        label: t('gesture.moveTabEnd'),
        triggers: ['drag', 'search'],
        hiddenInSearch: !current,
        disabled: !current,
        run: () => {
          if (current) store.nudgeTab(current.id, 1);
        },
      },
      {
        id: 'shell.nextTab',
        label: t('gesture.nextTab'),
        triggers: ['shortcut', 'search'],
        shortcut: 'Mod+Alt+ArrowRight',
        allowWhileTyping: true,
        run: () => {
          store.stepActive(1);
        },
      },
      {
        id: 'shell.previousTab',
        label: t('gesture.previousTab'),
        triggers: ['shortcut', 'search'],
        shortcut: 'Mod+Alt+ArrowLeft',
        allowWhileTyping: true,
        run: () => {
          store.stepActive(-1);
        },
      },
      {
        id: 'shell.openSearch',
        label: t('gesture.openSearch'),
        triggers: ['button', 'shortcut'],
        shortcut: 'Mod+P',
        allowWhileTyping: true,
        // Buscar «buscar» dentro de la propia búsqueda no lleva a ninguna parte.
        hiddenInSearch: true,
        run: () => {
          store.setOverlay('search');
        },
      },
      {
        id: 'shell.find',
        label: t('gesture.find'),
        triggers: ['shortcut', 'search'],
        shortcut: 'Mod+F',
        allowWhileTyping: true,
        // La terminal atiende este mismo combo localmente para buscar su salida.
        disabled: store.settingsOpen || current?.surface.kind === 'terminal',
        hiddenInSearch: store.settingsOpen || current?.surface.kind === 'terminal',
        run: () => {
          if (current?.surface.kind === 'working') {
            useWorkingStore.getState().requestFilterFocus();
          } else {
            document.getElementById(FILTER_INPUT_ID)?.focus();
          }
        },
      },
      {
        id: 'shell.toggleColorMode',
        label: t('gesture.toggleColorMode'),
        triggers: ['button', 'search'],
        run: () => {
          // Alternar fija el modo: seguir al sistema deja de tener sentido en
          // cuanto alguien pide explícitamente el otro.
          update({ mode: resolved.mode === 'dark' ? 'light' : 'dark' });
        },
      },
      {
        id: 'shell.openSettings',
        label: t('gesture.openSettings'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+,',
        allowWhileTyping: true,
        run: () => {
          if (useShellStore.getState().settingsOpen) {
            useShellStore.setState({ settingsOpen: false });
          } else {
            store.openSettings();
          }
        },
      },
      {
        id: 'shell.openLogs',
        label: t('gesture.openLogs'),
        triggers: ['button', 'search'],
        run: () => {
          store.setOverlay('logs');
        },
      },
      {
        id: 'shell.openNotifications',
        label: t('gesture.openNotifications'),
        triggers: ['button'],
        hiddenInSearch: true,
        run: () => {
          store.setOverlay('notifications');
        },
      },
      {
        id: 'shell.openHelp',
        label: t('gesture.openHelp'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'F1',
        run: () => {
          void link.openExternal(APP_SITE_URL);
        },
      },
      {
        id: 'shell.support',
        label: t('gesture.support'),
        triggers: ['button', 'search'],
        run: () => {
          void link.openExternal(APP_SUPPORT_URL);
        },
      },
      {
        // Sin atajo: es la superposición que menos se abre de las cuatro, y
        // gastar un combo en ella se lo quitaría a algo que se usa a diario.
        id: 'shell.openAbout',
        label: t('gesture.openAbout'),
        triggers: ['button', 'search'],
        run: () => {
          store.setOverlay('about');
        },
      },
    ];
  }, [store, t, link, resolved.mode, update, cwd]);
}

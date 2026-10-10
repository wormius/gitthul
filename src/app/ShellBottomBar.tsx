import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Library } from '@core/domain/library';
import { useTheme } from '@design/useTheme';
import { useI18n } from '@i18n/useI18n';
import { BottomBar } from '@ui/BottomBar';
import { IconButton } from '@ui/IconButton';
import { Kbd } from '@ui/Kbd';
import type { MenuEntry } from '@ui/menu';
import type { TabDescriptor } from '@ui/Tab';
import { TabStrip } from '@ui/TabStrip';
import { Tooltip } from '@ui/Tooltip';
import { useToast } from '@ui/useToast';

import { useGestures } from './GestureContext';
import { APP_VERSION } from './metadata';
import { usePorts } from './PortsContext';
import {
  BranchIcon,
  DarkModeIcon,
  HelpIcon,
  LightModeIcon,
  LogsIcon,
  NotificationsIcon,
  RepositoriesIcon,
  SearchIcon,
  SettingsIcon,
  SupportIcon,
  TerminalIcon,
} from './ShellIcons';
import { useShellStore } from './shellStore';
import { describeTab } from './tabLabels';
import { tabIdsToCloseForSpace, type Tab } from './tabs';
import styles from './ShellBottomBar.module.css';

/**
 * Botón de icono que ejecuta un gesto del registro.
 *
 * El rótulo accesible y el del tooltip salen del registro, no del componente:
 * una acción tiene un nombre, y el mismo aparece en el botón, en la búsqueda
 * global y —cuando llegue F4.1— en el editor de atajos.
 */
function GestureButton({
  id,
  icon,
  label,
  className,
  current,
}: {
  id: string;
  icon: ReactNode;
  /** Solo cuando el rótulo depende del contexto, como el modo claro u oscuro. */
  label?: string;
  className?: string;
  /** El botón es además el sitio donde se está: Repositorios y su hogar. */
  current?: boolean;
}) {
  const gestures = useGestures();
  const gesture = gestures.get(id);

  if (!gesture) return null;

  const name = label ?? gesture.label;

  return (
    <Tooltip
      content={
        <>
          {name}
          {gesture.shortcutLabel && <Kbd>{gesture.shortcutLabel}</Kbd>}
        </>
      }
    >
      <IconButton
        icon={icon}
        aria-label={name}
        className={[className, current ? styles.current : null].filter(Boolean).join(' ')}
        {...(current ? { 'aria-current': 'page' as const } : {})}
        disabled={gesture.disabled}
        onClick={() => {
          gestures.run(id);
        }}
      />
    </Tooltip>
  );
}

/** El icono dice qué superficie enseña la pestaña en este momento. */
function tabIcon(tab: Tab): ReactNode {
  if (tab.surface.kind === 'working') return <BranchIcon />;
  return <TerminalIcon />;
}

/**
 * La barra inferior del shell, con todo lo que el plan le pide.
 *
 * Los tres lanzadores van al inicio, separados de la tira por el divisor de
 * `BottomBar`; la tira ocupa el centro; la zona derecha lleva apoyo, versión,
 * búsqueda, ayuda, modo, configuración y registros. El mensaje de estado se
 * traduce en el momento de pintar — en la tienda vive como clave y parámetros —
 * así que cambiar de idioma también lo cambia a él.
 */
export function ShellBottomBar() {
  const { t } = useI18n();
  const { library: libraryPort } = usePorts();
  const { resolved } = useTheme();
  const { unread } = useToast();
  const [library, setLibrary] = useState<Library | null>(null);
  const libraryRef = useRef<Library | null>(null);
  const tabs = useShellStore((state) => state.tabs);
  const activeId = useShellStore((state) => state.activeId);
  const settingsActive = useShellStore((state) => state.settingsOpen);
  const activateTab = useShellStore((state) => state.activateTab);
  const closeTab = useShellStore((state) => state.closeTab);
  const closeTabs = useShellStore((state) => state.closeTabs);
  const moveTab = useShellStore((state) => state.moveTab);
  const setStatus = useShellStore((state) => state.setStatus);

  useEffect(() => {
    let current = true;

    void libraryPort.read().then(
      (next) => {
        if (!current) return;
        if (next.spaces.length === 0 && libraryRef.current === null) return;

        libraryRef.current = next.spaces.length === 0 ? null : next;
        setLibrary(libraryRef.current);
      },
      () => undefined,
    );

    return () => {
      current = false;
    };
  }, [activeId, libraryPort, tabs]);

  const copy = (value: string) => {
    void copyText(value).then(
      () => {
        setStatus({ tone: 'success', key: 'working.status.copied' });
      },
      () => {
        setStatus({ tone: 'danger', key: 'working.status.copyFailed' });
      },
    );
  };

  const descriptors: readonly TabDescriptor[] = tabs.map((tab) => {
    const { label } = describeTab(tab, t);
    const index = tabs.findIndex((candidate) => candidate.id === tab.id);
    const repository = tab.context.repository;
    const spaces = repository
      ? (library?.spaces.filter((space) => space.repos.includes(repository.repoId)) ?? [])
      : [];
    const items: MenuEntry[] = [
      {
        key: 'close',
        label: t('tabs.menu.close'),
        onSelect: () => {
          closeTab(tab.id);
        },
      },
      {
        key: 'close-others',
        label: t('tabs.menu.closeOthers'),
        disabled: tabs.length < 2,
        onSelect: () => {
          closeTabs(
            new Set(tabs.filter((candidate) => candidate.id !== tab.id).map(({ id }) => id)),
          );
        },
      },
      {
        key: 'close-right',
        label: t('tabs.menu.closeRight'),
        disabled: index === tabs.length - 1,
        onSelect: () => {
          closeTabs(new Set(tabs.slice(index + 1).map(({ id }) => id)));
        },
      },
    ];

    if (repository) {
      items.push(
        { kind: 'separator', key: 'repository' },
        {
          key: 'copy-repository-name',
          label: t('tabs.menu.copyRepoName'),
          onSelect: () => {
            copy(repository.repoName);
          },
        },
        {
          key: 'copy-repository-path',
          label: t('tabs.menu.copyRepoPath'),
          onSelect: () => {
            copy(repository.repoPath);
          },
        },
      );
    }

    if (library && spaces.length > 0) {
      items.push(
        { kind: 'separator', key: 'spaces' },
        ...spaces.map((space): MenuEntry => ({
          key: `close-space-${space.id}`,
          label: t('tabs.menu.closeSpace', { space: space.name }),
          onSelect: () => {
            closeTabs(tabIdsToCloseForSpace(tabs, library.spaces, space.id));
          },
        })),
      );
    }

    return {
      id: tab.id,
      label,
      closeLabel: t('tabs.close', { tab: label }),
      icon: tabIcon(tab),
      menu: {
        label: t('tabs.menu.label', { tab: label }),
        description: label,
        items,
      },
    };
  });

  return (
    <BottomBar
      label={t('bottomBar.label')}
      launchers={
        <div className={styles.group} role="group" aria-label={t('bottomBar.launchers')}>
          {/*
            Repositorios no tiene pestaña: este botón es su pestaña. Por eso se
            marca como el sitio donde se está cuando no hay ninguna activa, con
            `aria-current` para que el lector de pantalla lo diga igual que lo
            dice de la pestaña activa de la tira.
          */}
          <GestureButton
            id="shell.goToRepositories"
            icon={<RepositoriesIcon />}
            current={activeId === null}
          />
          <GestureButton id="shell.openTerminalTab" icon={<TerminalIcon />} />
        </div>
      }
      utilities={
        <div className={styles.group} role="group" aria-label={t('bottomBar.utilities')}>
          <GestureButton id="shell.support" icon={<SupportIcon />} className={styles.support} />
          <span className={styles.version}>{t('bottomBar.version', { version: APP_VERSION })}</span>
          <GestureButton id="shell.openSearch" icon={<SearchIcon />} />
          <GestureButton id="shell.openHelp" icon={<HelpIcon />} />
          <GestureButton
            id="shell.toggleColorMode"
            icon={resolved.mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            label={t(resolved.mode === 'dark' ? 'bottomBar.toLightMode' : 'bottomBar.toDarkMode')}
          />
          <GestureButton id="shell.openSettings" icon={<SettingsIcon />} current={settingsActive} />
          <GestureButton id="shell.openLogs" icon={<LogsIcon />} />
          <GestureButton
            id="shell.openNotifications"
            icon={<NotificationsIcon />}
            label={unread > 0 ? t('gesture.openNotificationsUnread', { count: unread }) : undefined}
            className={unread > 0 ? styles.unread : undefined}
          />
        </div>
      }
    >
      <TabStrip
        label={t('tabs.stripLabel')}
        tabs={descriptors}
        activeId={activeId}
        onActivate={activateTab}
        onClose={closeTab}
        onReorder={moveTab}
      />
    </BottomBar>
  );
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);

    return;
  }

  throw new Error('sin portapapeles');
}

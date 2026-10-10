import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { useGestures } from '@app/GestureContext';
import { TerminalIcon } from '@app/ShellIcons';
import { MESSAGES, type MessageKey } from '@i18n/messages';
import { useI18n } from '@i18n/useI18n';
import { BigActionButton } from '@ui/BigActionButton';
import { Menu } from '@ui/Menu';
import type { MenuEntry } from '@ui/menu';

import styles from './GitActionBar.module.css';
import {
  FetchIcon,
  PopIcon,
  PullIcon,
  PushIcon,
  RedoIcon,
  StashIcon,
  UndoIcon,
} from './WorkingIcons';
import { useWorkingStore } from './workingStore';

interface ActionDef {
  gesture: string;
  labelKey: string;
  icon: ReactNode;
  alternatives?: readonly { key: string; labelKey: string; gesture?: string; run?: () => void }[];
}

/**
 * Los nueve botones de la barra de acciones de GitWorking.
 *
 * Desde F2.9 los nueve están habilitados. El formato es `BigActionButton` —el
 * mismo cuadrado con icono grande de `RepoActionsBar`— con clic izquierdo para
 * la acción por defecto y clic derecho para un menú de alternativas.
 */
export function GitActionBar() {
  const { t } = useI18n();
  const focusRequest = useWorkingStore((state) => state.networkFocusRequest);
  const focusGesture = useWorkingStore((state) => state.networkFocusGesture);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-gesture="${focusGesture}"]`)
      ?.focus({ preventScroll: true });
  }, [focusGesture, focusRequest]);

  const actions: readonly ActionDef[] = [
    { gesture: 'working.undo', labelKey: 'working.actionBar.undo', icon: <UndoIcon /> },
    { gesture: 'working.redo', labelKey: 'working.actionBar.redo', icon: <RedoIcon /> },
    {
      gesture: 'working.fetch',
      labelKey: 'working.actionBar.fetch',
      icon: <FetchIcon />,
    },
    {
      gesture: 'working.pull',
      labelKey: 'working.actionBar.pull',
      icon: <PullIcon />,
      alternatives: [
        { key: 'rebase', labelKey: 'working.actionBar.pullRebase' },
        { key: 'merge', labelKey: 'working.actionBar.pullMerge' },
      ],
    },
    {
      gesture: 'working.push',
      labelKey: 'working.actionBar.push',
      icon: <PushIcon />,
    },
    { gesture: 'working.stash', labelKey: 'working.actionBar.stash', icon: <StashIcon /> },
    {
      gesture: 'working.pop',
      labelKey: 'working.actionBar.pop',
      icon: <PopIcon />,
      alternatives: [{ key: 'apply', labelKey: 'working.actionBar.popApply' }],
    },
    {
      gesture: 'shell.openContextTerminalTab',
      labelKey: 'working.actionBar.terminal',
      icon: <TerminalIcon />,
    },
  ];

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={styles.bar} role="toolbar" aria-label={t('working.actionBar.label')}>
        {actions.slice(0, 2).map((action) => (
          <ActionButton key={action.gesture} def={action} />
        ))}
        <span className={styles.separator} aria-hidden="true" />
        {actions.slice(2, 7).map((action) => (
          <ActionButton key={action.gesture} def={action} />
        ))}
        <span className={styles.separator} aria-hidden="true" />
        {actions.slice(7).map((action) => (
          <ActionButton key={action.gesture} def={action} />
        ))}
      </div>
    </div>
  );
}

/**
 * Cada botón grande con su menú contextual de alternativas al clic derecho.
 *
 * La acción por defecto va con el clic izquierdo normal; el clic derecho abre
 * un `Menu` — el mismo componente que usan los menús contextuales del grafo y
 * de las listas, para que teclado y posicionamiento se comporten igual.
 */
function ActionButton({ def }: { def: ActionDef }) {
  const { t, locale } = useI18n();
  const gestures = useGestures();

  const gesture = gestures.get(def.gesture);
  const context = useWorkingStore((state) => state.context);
  const recovery = def.gesture === 'working.undo' || def.gesture === 'working.redo';
  const entry = def.gesture === 'working.undo' ? context?.undoEntry : context?.redoEntry;
  const recoveryTitle = recovery
    ? `${entry && Object.hasOwn(MESSAGES[locale], entry.labelKey) ? t(entry.labelKey as MessageKey, entry.params) : t('undo.empty')} · ${t('undo.session')}`
    : undefined;
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const label = t(def.labelKey as Parameters<typeof t>[0]);

  const hasAlternatives = (def.alternatives?.length ?? 0) > 0;

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!gesture?.disabled && hasAlternatives) setOpen(true);
  };

  const items: MenuEntry[] = (def.alternatives ?? []).map((alt) => ({
    key: alt.key,
    label: t(alt.labelKey as Parameters<typeof t>[0]),
    onSelect: () => {
      gestures.run(def.gesture);
    },
  }));

  return (
    <div ref={setAnchor} onContextMenu={handleContextMenu}>
      <BigActionButton
        data-gesture={def.gesture}
        icon={def.icon}
        label={label}
        aria-label={gesture?.label ?? label}
        title={
          recoveryTitle ??
          (gesture?.shortcutLabel ? `${gesture.label} · ${gesture.shortcutLabel}` : gesture?.label)
        }
        disabled={gesture?.disabled ?? true}
        onClick={() => {
          gestures.run(def.gesture);
        }}
      />
      {open && anchor !== null && (
        <Menu
          items={items}
          label={label}
          anchor={anchor}
          align="start"
          trigger={anchor}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

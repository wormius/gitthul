import { useCallback, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { TerminalLayoutNode } from '@core/domain/terminal';
import { SplitPane } from '@ui/SplitPane';

import { TerminalPane, type TerminalPaneProps } from './TerminalPane';
import { terminalPanes } from './terminalLayout';
import styles from './TerminalPane.module.css';

interface TerminalPaneTreeProps extends Omit<
  TerminalPaneProps,
  'pane' | 'paneIndex' | 'repositoryAvailable'
> {
  node: TerminalLayoutNode;
  paneOrder: readonly string[];
  repositoryPaneId: string | null;
  dividerLabel: string;
  onResize: (splitId: string, ratio: number) => void;
}

interface PaneMount {
  slot: HTMLDivElement | null;
  host: HTMLDivElement | null;
  focused: HTMLElement | null;
}

type AttachPaneMount = (
  paneId: string,
  part: 'slot' | 'host',
  element: HTMLDivElement | null,
) => void;

/**
 * La geometría cambia de árbol al dividir o cerrar un vecino; los emuladores
 * viven en una lista estable por pane.id. Cada portal conserva su contenedor
 * y solo mueve ese contenedor al hueco nuevo, sin desmontar xterm ni su PTY.
 */
export function TerminalPaneTree({
  node,
  paneOrder,
  repositoryPaneId,
  dividerLabel,
  onResize,
  ...paneProps
}: TerminalPaneTreeProps) {
  const activePaneId = paneProps.activePaneId;
  const [mounts] = useState(() => new Map<string, PaneMount>());
  const attach = useCallback<AttachPaneMount>(
    (paneId, part, element) => {
      const mount = mounts.get(paneId) ?? { slot: null, host: null, focused: null };
      if (mount.host?.contains(document.activeElement)) {
        mount.focused = document.activeElement as HTMLElement;
      }
      mount[part] = element;
      if (!mount.slot && !mount.host) {
        mounts.delete(paneId);
        return;
      }
      mounts.set(paneId, mount);
      if (mount.slot && mount.host && mount.host.parentElement !== mount.slot) {
        mount.slot.appendChild(mount.host);
        if (paneId === activePaneId && mount.focused && mount.host.contains(mount.focused)) {
          mount.focused.focus({ preventScroll: true });
        }
        mount.focused = null;
      }
    },
    [activePaneId, mounts],
  );

  return (
    <>
      <PaneLayout node={node} dividerLabel={dividerLabel} onResize={onResize} attach={attach} />
      {terminalPanes(node).map((pane) => (
        <MountedTerminalPane
          key={pane.id}
          {...paneProps}
          pane={pane}
          paneIndex={Math.max(0, paneOrder.indexOf(pane.id))}
          repositoryAvailable={pane.id === repositoryPaneId}
          attach={attach}
        />
      ))}
    </>
  );
}

function MountedTerminalPane({
  attach,
  ...props
}: TerminalPaneProps & { attach: AttachPaneMount }) {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = styles.tree ?? '';
    return element;
  });
  const paneId = props.pane.id;
  useLayoutEffect(() => {
    attach(paneId, 'host', host);
    return () => attach(paneId, 'host', null);
  }, [attach, host, paneId]);
  useLayoutEffect(() => {
    return () => {
      // React puede reutilizar este slot para otro panel al promover un split.
      // El portal retira su contenido, pero su host se insertó manualmente:
      // dejarlo vacío conservaría una caja de alto completo delante del nuevo.
      host.remove();
    };
  }, [host]);
  return createPortal(<TerminalPane {...props} />, host);
}

interface PaneLayoutProps {
  node: TerminalLayoutNode;
  dividerLabel: string;
  onResize: (splitId: string, ratio: number) => void;
  attach: AttachPaneMount;
}

function PaneLayout({ node, dividerLabel, onResize, attach }: PaneLayoutProps) {
  if (node.kind === 'pane') return <PaneSlot paneId={node.id} attach={attach} />;

  return (
    <SplitPane
      className={styles.tree}
      orientation={node.orientation}
      label={dividerLabel}
      ratio={node.ratio}
      onRatioChange={(ratio) => onResize(node.id, ratio)}
      minFirst={160}
      minSecond={160}
      first={
        <PaneLayout
          node={node.first}
          dividerLabel={dividerLabel}
          onResize={onResize}
          attach={attach}
        />
      }
      second={
        <PaneLayout
          node={node.second}
          dividerLabel={dividerLabel}
          onResize={onResize}
          attach={attach}
        />
      }
    />
  );
}

function PaneSlot({ paneId, attach }: { paneId: string; attach: AttachPaneMount }) {
  const ref = useCallback(
    (element: HTMLDivElement | null) => attach(paneId, 'slot', element),
    [attach, paneId],
  );
  return <div className={styles.tree} ref={ref} />;
}

import type { TerminalLayoutNode } from '@core/domain/terminal';
import { SplitPane } from '@ui/SplitPane';

import { TerminalPane, type TerminalPaneProps } from './TerminalPane';
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

/** Árbol interno de Terminal; no participa en el compositor de superficies del shell. */
export function TerminalPaneTree({
  node,
  paneOrder,
  repositoryPaneId,
  dividerLabel,
  onResize,
  ...paneProps
}: TerminalPaneTreeProps) {
  if (node.kind === 'pane') {
    return (
      <TerminalPane
        {...paneProps}
        pane={node}
        paneIndex={Math.max(0, paneOrder.indexOf(node.id))}
        repositoryAvailable={node.id === repositoryPaneId}
      />
    );
  }

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
        <TerminalPaneTree
          {...paneProps}
          node={node.first}
          paneOrder={paneOrder}
          repositoryPaneId={repositoryPaneId}
          dividerLabel={dividerLabel}
          onResize={onResize}
        />
      }
      second={
        <TerminalPaneTree
          {...paneProps}
          node={node.second}
          paneOrder={paneOrder}
          repositoryPaneId={repositoryPaneId}
          dividerLabel={dividerLabel}
          onResize={onResize}
        />
      }
    />
  );
}

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import styles from './SyncScrollPane.module.css';
import { useSyncScrollRegistry } from './syncScroll';

interface SyncScrollPaneProps {
  /** Nombre accesible del panel, p. ej. «Versión de main». */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Uno de los paneles atados por `SyncScroll`. */
export function SyncScrollPane({ label, children, className }: SyncScrollPaneProps) {
  const registry = useSyncScrollRegistry();
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = paneRef.current;

    if (!pane) return;

    return registry.register(pane);
  }, [registry]);

  const onScroll = useCallback(() => {
    if (paneRef.current) registry.broadcast(paneRef.current);
  }, [registry]);

  return (
    <div
      ref={paneRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={[styles.pane, className].filter(Boolean).join(' ')}
      onScroll={onScroll}
    >
      {children}
    </div>
  );
}

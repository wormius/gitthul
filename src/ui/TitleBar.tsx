import type { MouseEvent, ReactNode } from 'react';

import { IconButton } from './IconButton';
import styles from './TitleBar.module.css';

export type WindowControl = 'minimize' | 'maximize' | 'close';

export interface WindowControlLabels {
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
}

interface TitleBarProps {
  /** Nombre accesible de la barra. */
  label: string;
  /** Qué se está mirando: la pestaña activa. */
  title: string;
  /** Segunda línea atenuada: la rama, el modo, el worktree. */
  detail?: string;
  /** Marca a la izquierda. */
  brand?: ReactNode;
  maximized: boolean;
  labels: WindowControlLabels;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  /** Arrastrar la ventana desde la zona libre de la barra. */
  onStartDrag?: () => void;
  /** macOS pone los controles al inicio; Windows y Linux, al final. */
  controlsSide?: 'start' | 'end';
  /** Orden de los tres controles, que también cambia por plataforma. */
  controlsOrder?: readonly WindowControl[];
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2.6"
        y="2.6"
        width="6.8"
        height="6.8"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1.8"
        y="3.8"
        width="6.4"
        height="6.4"
        rx="1.1"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.9 3.3V2.9c0-.6.5-1.1 1.1-1.1h4.1c.6 0 1.1.5 1.1 1.1V7c0 .6-.5 1.1-1.1 1.1h-.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DEFAULT_ORDER: readonly WindowControl[] = ['minimize', 'maximize', 'close'];

/**
 * Barra de título propia, con los controles de ventana donde los pone cada
 * plataforma.
 *
 * La zona libre arrastra la ventana y el doble clic la maximiza, que es lo que
 * hace la barra nativa que sustituye. El arrastre sale por `onStartDrag` y no
 * por un atributo de Tauri: el componente no ejecuta acciones
 * del sistema por su cuenta.
 *
 * La marca es texto y no el lockup en SVG a propósito: el Cthulhu es monocromo y
 * se invierte con el modo, y un `<img>` con colores dentro no se enteraría de
 * que el tema cambió.
 */
export function TitleBar({
  label,
  title,
  detail,
  brand,
  maximized,
  labels,
  onMinimize,
  onToggleMaximize,
  onClose,
  onStartDrag,
  controlsSide = 'end',
  controlsOrder = DEFAULT_ORDER,
}: TitleBarProps) {
  /*
   * Va en `mousedown` y no en `pointerdown` por el contador de clics: los
   * eventos de puntero lo dejan siempre en cero, así que ahí no hay forma de
   * distinguir la segunda pulsación de un doble clic.
   *
   * Y hay que distinguirla porque arrastrar entrega el puntero al gestor de
   * ventanas: en cuanto empieza el arrastre, el `dblclick` ya no vuelve a la
   * página. Maximizar con doble clic —lo que hace toda barra de título del
   * sistema— tiene que decidirse aquí, antes de arrastrar.
   */
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // Solo la zona libre arrastra: pulsar un control es pulsar el control.
    if (event.button !== 0 || event.target !== event.currentTarget) return;

    if (event.detail >= 2) onToggleMaximize();
    else onStartDrag?.();
  };

  const controls = (
    <div className={styles.controls}>
      {controlsOrder.map((control) => {
        if (control === 'minimize') {
          return (
            <IconButton
              key={control}
              size="sm"
              icon={<MinimizeIcon />}
              aria-label={labels.minimize}
              onClick={onMinimize}
            />
          );
        }

        if (control === 'maximize') {
          return (
            <IconButton
              key={control}
              size="sm"
              icon={maximized ? <RestoreIcon /> : <MaximizeIcon />}
              aria-label={maximized ? labels.restore : labels.maximize}
              onClick={onToggleMaximize}
            />
          );
        }

        return (
          <IconButton
            key={control}
            size="sm"
            className={styles.close}
            icon={<CloseIcon />}
            aria-label={labels.close}
            onClick={onClose}
          />
        );
      })}
    </div>
  );

  return (
    <header className={styles.bar} aria-label={label}>
      {controlsSide === 'start' && controls}

      {brand && <div className={styles.brand}>{brand}</div>}

      <div className={styles.drag} onMouseDown={onMouseDown} data-drag-region="true">
        <span className={styles.title}>{title}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>

      {controlsSide === 'end' && controls}
    </header>
  );
}

import { useRef, useState, type ReactNode } from 'react';

import { useI18n } from '@i18n/useI18n';
import { Floating } from '@ui/Floating';

import type { DragRef } from './integration';
import { RefLabel } from './RefLabel';
import { collapseRefLabels, type RefLabelItem } from './refs';
import styles from './RefLabelCluster.module.css';

interface RefLabelClusterProps {
  items: readonly RefLabelItem[];
  /** Cuántas se pintan antes de colapsar el resto en `+N`. */
  visible?: number;
  /** Envuelve cada etiqueta con su menú contextual. */
  wrap: (item: RefLabelItem, label: ReactNode) => ReactNode;
  /** Activa arrastre y suelta en la visible y en todas las desplegadas. */
  onReferenceDrop?: (source: DragRef, target: DragRef) => void;
  /** Doble clic en una rama visible o desplegada ejecuta su checkout tipado. */
  onReferenceActivate?: (item: RefLabelItem) => void;
}

/** Margen para que el puntero pueda cruzar de la insignia al flotante. */
const CLOSE_DELAY = 120;

/**
 * Las etiquetas de una fila del grafo, con una visible y el resto tras `+N`.
 *
 * **El despliegue es una capa flotante, no un crecimiento de la fila.** La
 * invariante 1 prohíbe que pasar el ratón mueva un solo píxel de la interfaz, y
 * una fila que se ensancha al pasar por encima movería la columna del mensaje
 * de toda la tabla. `Floating` la saca del flujo, en un portal sobre `body`.
 *
 * La insignia es un botón de verdad y no un `span` con `onMouseEnter`: el
 * teclado también tiene que poder leer lo que hay detrás del `+3`, y el foco es
 * su equivalente del hover. Durante un arrastre, entrar en la insignia abre la
 * capa para que se pueda apuntar a una referencia concreta; la insignia nunca
 * representa una suelta ambigua por sí misma.
 */
export function RefLabelCluster({
  items,
  visible = 1,
  wrap,
  onReferenceDrop,
  onReferenceActivate,
}: RefLabelClusterProps) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const { shown, hidden } = collapseRefLabels(items, visible);
  const anchorKey = shown[0]?.key;

  if (items.length === 0) return null;

  const cancelClose = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = null;
  };

  const reveal = () => {
    if (hidden.length === 0) return;

    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    timerRef.current = setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY);
  };

  const renderItem = (item: RefLabelItem) => {
    const target: DragRef = {
      kind: item.kind,
      name: item.refName,
      ref: (item.local ?? item.remote ?? item.tag)?.id,
    };
    const label =
      onReferenceDrop === undefined ? (
        <RefLabel item={item} onDoubleClick={() => onReferenceActivate?.(item)} />
      ) : (
        <RefLabel
          item={item}
          drag={target}
          onDrop={(source) => {
            onReferenceDrop(source, target);
            setOpen(false);
          }}
          onDoubleClick={() => onReferenceActivate?.(item)}
        />
      );

    return (
      <span
        key={item.key}
        ref={item.key === anchorKey ? setAnchor : null}
        className={styles.slot}
        onMouseEnter={reveal}
        onMouseLeave={scheduleClose}
        onDragEnter={reveal}
        onDragLeave={scheduleClose}
      >
        {wrap(item, label)}
      </span>
    );
  };

  return (
    <span className={styles.cluster}>
      {shown.map(renderItem)}

      {hidden.length > 0 && (
        <>
          <button
            type="button"
            className={styles.more}
            aria-expanded={open}
            aria-label={t('working.refLabel.more', { count: hidden.length })}
            onMouseEnter={reveal}
            onMouseLeave={scheduleClose}
            onFocus={reveal}
            onBlur={scheduleClose}
            onClick={() => {
              setOpen((current) => !current);
            }}
            onDragEnter={reveal}
            onDragLeave={scheduleClose}
          >
            +{hidden.length}
          </button>

          {open && anchor && (
            <Floating
              anchor={anchor}
              side="bottom"
              align="start"
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              onDragEnter={cancelClose}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;

                scheduleClose();
              }}
            >
              <span className={styles.list} role="group" aria-label={t('working.refLabel.group')}>
                {hidden.map(renderItem)}
              </span>
            </Floating>
          )}
        </>
      )}
    </span>
  );
}

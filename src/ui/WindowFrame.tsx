import type { MouseEvent } from 'react';

import styles from './WindowFrame.module.css';

/**
 * Los ocho bordes por los que se agarra una ventana, en puntos cardinales.
 *
 * Se declara aquí como vocabulario del componente: `src/ui` no
 * conoce `src/core`, y quien une las dos cosas es el shell. Son los mismos ocho
 * literales, así que el tipo encaja solo.
 */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/*
 * Los lados van antes que las esquinas, y el orden importa: las asas se solapan
 * y ganan las últimas en pintarse. Así la esquina manda en su cuadrado —que es
 * lo que hace toda ventana— sin necesidad de repartir z-index entre hermanas.
 */
const EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

interface WindowFrameProps {
  /**
   * Con la ventana maximizada las asas se van. No hay nada que redimensionar, y
   * dejarlas puestas le robaría al escritorio los clics del borde de la
   * pantalla, que es donde viven la barra de tareas y las esquinas activas.
   */
  enabled: boolean;
  onResizeStart: (edge: ResizeEdge) => void;
}

/**
 * El contorno visible y las asas de redimensión del borde de la ventana.
 *
 * Sin decoración del sistema **nadie dibuja los bordes**: el gestor de ventanas
 * ya no pone su marco, así que la única forma de agarrar la ventana con el ratón
 * es la que ponga la aplicación. Ocho asas transparentes, cuatro lados y cuatro
 * esquinas, cada una con su cursor.
 *
 * No están en el árbol de accesibilidad: redimensionar por teclado lo sigue
 * haciendo el gestor de ventanas —`Alt+F8` en Linux, `Alt+Espacio` en Windows—,
 * que lo hace mejor y ya lo sabe todo el mundo. Duplicarlo aquí solo llenaría el
 * lector de pantalla de ocho controles que no llevan a ninguna parte.
 *
 * El gesto acaba en `startResizeDragging` y ahí se termina: a partir de ese
 * momento el puntero es del gestor de ventanas y la interfaz no sigue el ratón
 * ni escucha `mousemove`. Es lo mismo que hace el arrastre de la barra de
 * título, y por el mismo motivo.
 */
export function WindowFrame({ enabled, onResizeStart }: WindowFrameProps) {
  if (!enabled) return null;

  const onMouseDown = (edge: ResizeEdge) => (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    // Sin esto, arrastrar desde una asa deja al webview seleccionando el texto
    // que haya debajo mientras el gestor de ventanas ya está redimensionando.
    event.preventDefault();
    onResizeStart(edge);
  };

  return (
    <div className={styles.frame} aria-hidden="true">
      {EDGES.map((edge) => (
        <div key={edge} className={styles.grip} data-edge={edge} onMouseDown={onMouseDown(edge)} />
      ))}
    </div>
  );
}

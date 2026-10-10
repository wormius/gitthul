import { useEffect, useRef } from 'react';

import type { GraphLayout } from './graph';
import styles from './CommitGraph.module.css';
import {
  drawGraphRow,
  graphEdgePadding,
  graphInitials,
  type GraphMetrics,
  type GraphNodeForm,
  type GraphPalette,
} from './graphPaint';

/**
 * Todo lo que la columna del grafo comparte entre sus filas.
 *
 * Se calcula una sola vez en `CommitTable` —las calles, los tokens resueltos y
 * las medidas de la densidad— y viaja entero. Si cada fila leyera los tokens
 * por su cuenta instalaría su propio observador del tema, que con la lista
 * virtualizada serían treinta observadores yendo y viniendo con el scroll.
 */
export interface GraphColumn {
  layout: GraphLayout;
  palette: GraphPalette;
  metrics: GraphMetrics;
  /** Ancho del dibujo completo: todas las calles, sin topar. */
  width: number;
  form: GraphNodeForm;
}

interface CommitGraphProps {
  column: GraphColumn;
  /** Índice de la fila dentro de la lista, el mismo que usa `graph.ts`. */
  row: number;
  /** Nombre del autor. Solo lo gasta el nodo-avatar, para sus iniciales. */
  author: string;
  /** Prolonga la etiqueta de Rama/Tag desde el borde izquierdo hasta el nodo. */
  connectFromLeft?: boolean;
}

/**
 * El canvas de la columna Grafo, una fila a la vez.
 *
 * **Un canvas por fila, y no uno solo para toda la columna.** La
 * virtualización ya la hace `VirtualList`: solo existen en el DOM las filas
 * visibles, así que solo se pinta lo visible sin que este componente tenga que
 * saber nada del scroll. Un lienzo único para toda la columna tendría que
 * seguir el desplazamiento vertical de la lista y el horizontal de la columna a
 * la vez, con dos sistemas de coordenadas que hay que mantener de acuerdo al
 * píxel; así, cada fila dibuja en su propia caja y el desplazamiento
 * horizontal lo resuelve `DataGridCell`, que ya mueve el contenido de la
 * columna con scroll propio en una sola capa.
 *
 * Cada lienzo mide lo que una fila —unos cien por veintiocho píxeles—, así que
 * el coste de crearlo y destruirlo al hacer scroll es el de una fila, no el de
 * la historia entera.
 */
export function CommitGraph({ column, row, author, connectFromLeft = false }: CommitGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { layout, palette, metrics, form, width } = column;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext('2d');

    // Un navegador sin contexto 2D —y jsdom, que devuelve null a propósito—
    // deja la columna en blanco en vez de reventar la tabla entera.
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const height = metrics.rowHeight;

    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    context.translate(graphEdgePadding(metrics), 0);
    drawGraphRow(context, {
      node: layout.nodeAt(row),
      passes: layout.passesAt(row),
      links: layout.linksAt(row),
      connectFromLeft,
      leftEdge: -graphEdgePadding(metrics),
      form,
      initials: form === 'avatar' ? graphInitials(author) : '',
      metrics,
      palette,
    });
  }, [author, connectFromLeft, form, layout, metrics, palette, row, width]);

  /*
   * El dibujo no lleva texto accesible: no dice nada que la fila no diga ya con
   * palabras —el mensaje, el autor, la fecha, el SHA y, desde F2.4, sus
   * etiquetas de rama—, y anunciar «rama 3, calle 2» en cada una de cien mil
   * filas sería ruido que estorba en vez de informar.
   */
  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      style={{ width, height: metrics.rowHeight }}
      aria-hidden="true"
    />
  );
}

/**
 * Lo que `graph.ts` calculó, traducido a órdenes de canvas.
 *
 * Es la única pieza del grafo que sabe qué es un `CanvasRenderingContext2D`, y
 * la única que sabe leer los tokens del sistema de diseño: `graph.ts` no toca
 * ni el DOM ni el CSS, y `CommitGraph` solo le da el contexto y el rango.
 *
 * **Aquí vive el `GraphNode` del inventario, y es una función, no un
 * componente.** `Avatar` ya lo dejó escrito en F0.4: «ese lo dibuja `GraphNode`
 * directamente en canvas en F2.3 […] no monta un `Avatar` de React por nodo».
 * La razón de fondo es que el nodo y los tramos que lo tocan tienen que
 * encontrarse al píxel bajo tres densidades, dos ejes de scroll y el factor de
 * pantalla; con el nodo en HTML superpuesto serían dos sistemas de coordenadas
 * que hay que mantener de acuerdo, y cien mil filas de margen para que no lo
 * estén.
 */

import { GRAPH_BRANCH_COUNT, graphBranchTokens } from '@design/tokenCatalog';
import type { Theme } from '@design/theme';

import type { GraphLineKind, GraphLink, GraphNode, GraphPass } from './graph';

const TAU = Math.PI * 2;

/**
 * Los tokens que el grafo lee en vivo.
 *
 * Va como constante de módulo porque `useCssTokens` exige un arreglo estable:
 * uno recién creado en cada pintado reinstalaría el observador del tema en cada
 * fotograma.
 */
export const GRAPH_TOKENS: readonly string[] = [
  ...Array.from({ length: GRAPH_BRANCH_COUNT }, (_, index) => {
    const { color, dash, shape } = graphBranchTokens(index + 1);

    return [color, dash, shape];
  }).flat(),
  '--graph-wip',
  '--graph-stash',
  '--graph-lane-width',
  '--graph-node-radius',
  '--graph-node-avatar',
  '--graph-line-width',
  '--graph-corner-radius',
  '--graph-wip-node',
  '--text-on-accent',
  '--font-family-ui',
];

export interface GraphMetrics {
  laneWidth: number;
  rowHeight: number;
  nodeRadius: number;
  avatarSize: number;
  lineWidth: number;
  cornerRadius: number;
}

/** Los tres portadores de significado de una rama, ya resueltos a valor. */
export interface GraphBranchStyle {
  color: string;
  /** Patrón de `setLineDash`. Vacío es línea continua. */
  dash: number[];
  /** `ring` | `ring-filled` | `diamond` | `square`, lo que diga el tema. */
  shape: string;
  /** Multiplicador del grosor normal; WIP/stash usan una línea secundaria. */
  widthScale?: number;
}

export interface GraphPalette {
  /** Índice 0 = rama 1. */
  branches: readonly GraphBranchStyle[];
  wip: string;
  stash: string;
  /** Relleno neutro del WIP: claro en modo oscuro y oscuro en modo claro. */
  wipNode: string;
  /** Tinta de las iniciales del nodo-avatar, la misma que usa `Avatar`. */
  avatarInk: string;
  avatarFont: string;
}

/**
 * Las tres formas de nodo que el subplan nombra: anillo, avatar y bolita.
 *
 * `ring` no significa «círculo hueco» sino «la forma que el tema mande para esa
 * rama» — `--graph-shape-N`, que en «Contraste» son cuatro distintas y en los
 * otros seis temas es siempre el anillo del isotipo.
 */
export type GraphNodeForm = 'ring' | 'avatar' | 'dot';

/**
 * Qué forma se usa de verdad, dada la elegida y el tema activo.
 *
 * **El nodo-avatar se deshabilita en «Contraste»** —decisión 6 del subplan—:
 * un avatar es siempre un disco, así que no puede llevar la forma que ahí
 * distingue una rama de otra, y el color por sí solo no basta en ese tema.
 * Todavía no hay dónde elegir la forma —el submenú «Nodos ▸» de la cabecera de
 * la tabla es F2.4 y el ajuste equivalente es F4.1—, así que hoy esta función
 * solo tiene un consumidor; cuando llegue el selector, **lo que tiene que
 * ocultar la opción es esta misma regla**, no una copia suya.
 */
export function graphNodeForm(preference: GraphNodeForm, theme: Theme): GraphNodeForm {
  return preference === 'avatar' && theme === 'contraste' ? 'ring' : preference;
}

function pixels(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Las medidas del grafo, leídas de la densidad activa.
 *
 * Los respaldos son los valores de «cómodo», que es la densidad que `:root`
 * declara: son los que valen cuando nadie resolvió todavía el CSS —una prueba
 * sin hoja de estilos, el primer pintado antes de que el tema se aplique— y
 * dejan el dibujo bien proporcionado en vez de colapsarlo a cero.
 *
 * `rowHeight` no sale de un token: `--row-height` es un `calc()` sobre el
 * tamaño de fuente y `getComputedStyle` devolvería la expresión sin resolver,
 * así que lo calcula `commitRowHeight` como ya hace la tabla.
 */
export function resolveGraphMetrics(
  tokens: Record<string, string>,
  rowHeight: number,
): GraphMetrics {
  return {
    rowHeight,
    laneWidth: pixels(tokens['--graph-lane-width'], 16),
    nodeRadius: pixels(tokens['--graph-node-radius'], 5),
    avatarSize: pixels(tokens['--graph-node-avatar'], 18),
    lineWidth: pixels(tokens['--graph-line-width'], 2),
    cornerRadius: pixels(tokens['--graph-corner-radius'], 6),
  };
}

/** `none` es línea continua; lo demás es la lista de tramos y huecos. */
export function dashPattern(value: string | undefined): number[] {
  if (!value || value === 'none') return [];

  return value
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
}

export function resolveGraphPalette(tokens: Record<string, string>): GraphPalette {
  const branches = Array.from({ length: GRAPH_BRANCH_COUNT }, (_, index) => {
    const names = graphBranchTokens(index + 1);

    return {
      color: tokens[names.color] ?? '',
      dash: dashPattern(tokens[names.dash]),
      shape: tokens[names.shape] || 'ring',
    };
  });

  return {
    branches,
    wip: tokens['--graph-wip'] ?? '',
    stash: tokens['--graph-stash'] ?? '',
    wipNode: tokens['--graph-wip-node'] ?? '',
    avatarInk: tokens['--text-on-accent'] ?? '',
    avatarFont: tokens['--font-family-ui'] ?? 'system-ui',
  };
}

const SOLID: number[] = [];

/**
 * El trazo de lo que no está escrito en la historia: WIP y guardados.
 *
 * Punteado a propósito. Ni el árbol de trabajo ni un stash son commits de la
 * rama —uno todavía no existe y el otro está apartado—, y con línea continua se
 * leían como un tramo más de la historia. Es la misma distinción que el trazo
 * ya carga en el tema «Contraste», aplicada aquí por significado y no por
 * accesibilidad.
 */
const LOOSE: number[] = [3, 3];

/**
 * El trazo de una línea, dado el índice de color que `graph.ts` le puso.
 *
 * El WIP y los guardados no son ramas y no gastan índice: tienen token propio y
 * trazo punteado. Un índice mayor que ocho da la vuelta, que es justo cuando el
 * trazo y la forma pasan a cargar con la distinción.
 */
export function lineStyleFor(
  palette: GraphPalette,
  color: number,
  kind: GraphLineKind = 'branch',
): GraphBranchStyle {
  const slot = (((color - 1) % GRAPH_BRANCH_COUNT) + GRAPH_BRANCH_COUNT) % GRAPH_BRANCH_COUNT;
  const branch = palette.branches[slot];

  if (kind !== 'branch') {
    return {
      color: branch?.color ?? (kind === 'wip' ? palette.wip : palette.stash),
      dash: LOOSE,
      shape: kind === 'wip' ? 'ring' : 'square',
      widthScale: 0.6,
    };
  }

  return branch ?? { color: palette.wip, dash: SOLID, shape: 'ring', widthScale: 1 };
}

/** El centro de una calle dentro del dibujo, en píxeles CSS. */
export function laneCenter(lane: number, metrics: GraphMetrics): number {
  return lane * metrics.laneWidth + metrics.laneWidth / 2;
}

export interface GraphRowPaint {
  node: GraphNode;
  passes: readonly GraphPass[];
  links: readonly GraphLink[];
  /** Continúa la referencia de la columna anterior hasta el nodo de esta fila. */
  connectFromLeft?: boolean;
  leftEdge?: number;
  form: GraphNodeForm;
  /** Iniciales del autor. Solo las usa el nodo-avatar. */
  initials: string;
  metrics: GraphMetrics;
  palette: GraphPalette;
}

/**
 * Pinta una fila entera del grafo sobre un contexto ya escalado y ya limpio.
 *
 * El orden importa: primero lo que pasa de largo, luego lo que sale del nodo, y
 * el nodo al final, encima de sus propios tramos. Al revés, el arranque de cada
 * línea se vería cruzando el nodo.
 */
export function drawGraphRow(context: CanvasRenderingContext2D, paint: GraphRowPaint): void {
  const { node, passes, links, metrics, palette } = paint;
  const middle = metrics.rowHeight / 2;

  context.lineWidth = metrics.lineWidth;
  context.lineCap = 'butt';
  context.lineJoin = 'round';

  const origin = laneCenter(node.lane, metrics);

  if (paint.connectFromLeft) {
    const style = lineStyleFor(palette, node.color);

    context.strokeStyle = style.color;
    context.lineWidth = metrics.lineWidth * 0.5;
    context.setLineDash(style.dash);
    context.beginPath();
    context.moveTo(paint.leftEdge ?? 0, middle);
    context.lineTo(origin, middle);
    context.stroke();
  }

  for (const pass of passes) {
    const style = lineStyleFor(palette, pass.color, pass.kind ?? 'branch');
    const x = laneCenter(pass.lane, metrics);

    context.strokeStyle = style.color;
    context.lineWidth = metrics.lineWidth * (style.widthScale ?? 1);
    context.setLineDash(style.dash);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, metrics.rowHeight);
    context.stroke();
  }

  for (const link of links) {
    const style = lineStyleFor(palette, link.color, link.kind ?? 'branch');
    const target = laneCenter(link.lane, metrics);
    const edge = link.direction === 'up' ? 0 : metrics.rowHeight;

    context.strokeStyle = style.color;
    context.lineWidth = metrics.lineWidth * (style.widthScale ?? 1);
    context.setLineDash(style.dash);
    context.beginPath();
    context.moveTo(origin, middle);

    if (target === origin) {
      context.lineTo(origin, edge);
    } else {
      /*
       * Nunca una diagonal: se sale del nodo en horizontal, se gira 90° con la
       * esquina redondeada y se sigue en vertical. El radio se recorta a lo que
       * de verdad hay disponible —la distancia entre las dos calles y la media
       * fila de alto—, o en compacto la curva se comería el tramo entero y el
       * quiebre dejaría de leerse como un quiebre.
       */
      const radius = Math.min(
        metrics.cornerRadius,
        Math.abs(target - origin),
        Math.abs(edge - middle),
      );

      context.arcTo(target, middle, target, edge, radius);
      context.lineTo(target, edge);
    }

    context.stroke();
  }

  context.setLineDash(SOLID);
  drawGraphNode(context, paint, origin, middle);
}

/**
 * El nodo — el `GraphNode` del inventario.
 *
 * WIP y stash comparten tamaño para formar una cabecera reconocible: círculo
 * sólido neutro para el trabajo actual y cuadrado sólido para cada guardado.
 * Sus líneas heredan el color de la rama de la que provienen.
 */
export function drawGraphNode(
  context: CanvasRenderingContext2D,
  paint: GraphRowPaint,
  x: number,
  y: number,
): void {
  const { node, form, initials, metrics, palette } = paint;
  /**
   * El tamaño de WIP y stash: un 40 % más que el nodo normal, pero sin llegar
   * al diámetro del avatar, que se desbordaba de la fila. Los dos comparten la
   * misma medida para que formen una cabecera homogénea.
   */
  const specialRadius = Math.round(metrics.nodeRadius * 1.4);

  context.setLineDash(SOLID);

  if (node.kind === 'wip') {
    fillCircle(context, x, y, specialRadius, palette.wipNode);

    return;
  }

  if (node.kind === 'stash') {
    fillPolygon(context, x, y, specialRadius, lineStyleFor(palette, node.color).color, 0);

    return;
  }

  const style = lineStyleFor(palette, node.color);

  if (form === 'avatar') {
    const radius = metrics.avatarSize / 2;

    fillCircle(context, x, y, radius, style.color);

    if (initials) {
      context.fillStyle = palette.avatarInk;
      context.font = `600 ${String(Math.round(metrics.avatarSize * 0.45))}px ${palette.avatarFont}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(initials, x, y);
    }

    return;
  }

  if (form === 'dot') {
    fillCircle(context, x, y, metrics.nodeRadius * 0.8, style.color);

    return;
  }

  if (style.shape === 'square' || style.shape === 'diamond') {
    fillPolygon(
      context,
      x,
      y,
      metrics.nodeRadius,
      style.color,
      style.shape === 'diamond' ? Math.PI / 4 : 0,
    );

    return;
  }

  fillCircle(context, x, y, metrics.nodeRadius, style.color);

  if (style.shape === 'ring-filled') return;

  /*
   * El hueco del anillo se **borra**, no se rellena con un token de fondo. La
   * fila cambia de fondo al pasar el puntero y al quedar seleccionada, así que
   * un relleno fijo se leería como un lunar desafinado justo en esos dos
   * estados; borrando, se ve el fondo real que haya debajo, sea cual sea.
   */
  const inner = Math.max(1, metrics.nodeRadius - Math.max(1.5, metrics.nodeRadius * 0.45));

  context.save();
  context.beginPath();
  context.arc(x, y, inner, 0, TAU);
  context.clip();
  context.clearRect(
    x - metrics.nodeRadius,
    y - metrics.nodeRadius,
    metrics.nodeRadius * 2,
    metrics.nodeRadius * 2,
  );
  context.restore();
}

function fillCircle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, TAU);
  context.fill();
}

/** Cuadrado, o rombo si se le gira un octavo de vuelta. */
function fillPolygon(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  rotation: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.fillStyle = color;
  context.fillRect(-radius, -radius, radius * 2, radius * 2);
  context.restore();
}

/**
 * Las iniciales que lleva el nodo-avatar.
 *
 * Repite la regla de `Avatar` en vez de importarla: aquella vive dentro de un
 * componente de `src/ui` y sacarla de ahí para un solo consumidor nuevo sería
 * promover a primitivo lo que todavía no lo pide —la regla de dos usos—, además
 * de exportar algo que no es un componente desde un archivo que sí lo es.
 */
export function graphInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '';

  const [first, second] = parts;
  const letters = second ? [first?.[0], second[0]] : [first?.[0]];

  return letters.filter(Boolean).join('').toUpperCase();
}

export function graphEdgePadding(metrics: GraphMetrics): number {
  return Math.max(4, (metrics.avatarSize - metrics.laneWidth) / 2 + 4);
}

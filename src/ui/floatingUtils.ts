/*
 * Colocación de capas flotantes contra los bordes de la ventana.
 *
 * Es aritmética pura y vive aparte del componente a propósito: el navegador da
 * los rectángulos, pero decidir a qué lado cae un menú y cuánto hay que
 * recortarlo para que no se salga es lo único que puede equivocarse, y así se
 * prueba sin necesitar layout real — que jsdom no tiene.
 */

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export type FloatingSide = 'top' | 'right' | 'bottom' | 'left';
export type FloatingAlign = 'start' | 'center' | 'end';

/** Un elemento del que colgar la capa, o un punto — el cursor, para el menú contextual. */
export type FloatingAnchor = HTMLElement | { x: number; y: number };

export interface PlacementRequest {
  anchor: FloatingRect;
  floating: FloatingSize;
  viewport: FloatingSize;
  side?: FloatingSide;
  align?: FloatingAlign;
  /** Separación entre el anclaje y la capa. */
  gap?: number;
  /** Aire mínimo que queda entre la capa y el borde de la ventana. */
  margin?: number;
}

export interface Placement {
  x: number;
  y: number;
  /** El lado en el que se colocó de verdad, que no siempre es el pedido. */
  side: FloatingSide;
  align: FloatingAlign;
}

export const OPPOSITE_SIDE: Record<FloatingSide, FloatingSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function isVertical(side: FloatingSide): boolean {
  return side === 'top' || side === 'bottom';
}

function clamp(value: number, min: number, max: number): number {
  // Si la capa no cabe entre los dos márgenes, se prefiere el borde de inicio:
  // recortada por el final es mucho más legible que recortada por el principio.
  if (max < min) return min;

  return Math.min(Math.max(value, min), max);
}

/** Rectángulo de un anclaje. Un punto es un rectángulo sin tamaño. */
export function anchorRect(anchor: FloatingAnchor): FloatingRect {
  if (anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();

    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
}

/**
 * Decide dónde se pinta la capa: voltea al lado opuesto cuando el pedido no
 * cabe y recorta contra los bordes en el otro eje.
 */
export function placeFloating({
  anchor,
  floating,
  viewport,
  side = 'bottom',
  align = 'start',
  gap = 4,
  margin = 8,
}: PlacementRequest): Placement {
  const space: Record<FloatingSide, number> = {
    top: anchor.y - margin,
    bottom: viewport.height - anchor.y - anchor.height - margin,
    left: anchor.x - margin,
    right: viewport.width - anchor.x - anchor.width - margin,
  };

  const vertical = isVertical(side);
  const needed = (vertical ? floating.height : floating.width) + gap;
  const opposite = OPPOSITE_SIDE[side];
  const resolved = space[side] < needed && space[opposite] > space[side] ? opposite : side;

  const alignOn = (start: number, length: number, size: number): number => {
    if (align === 'center') return start + (length - size) / 2;
    if (align === 'end') return start + length - size;

    return start;
  };

  let x: number;
  let y: number;

  if (isVertical(resolved)) {
    y = resolved === 'bottom' ? anchor.y + anchor.height + gap : anchor.y - floating.height - gap;
    x = alignOn(anchor.x, anchor.width, floating.width);
  } else {
    x = resolved === 'right' ? anchor.x + anchor.width + gap : anchor.x - floating.width - gap;
    y = alignOn(anchor.y, anchor.height, floating.height);
  }

  return {
    x: Math.round(clamp(x, margin, viewport.width - floating.width - margin)),
    y: Math.round(clamp(y, margin, viewport.height - floating.height - margin)),
    side: resolved,
    align,
  };
}

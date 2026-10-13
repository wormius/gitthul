/**
 * Tipos y lógica del arrastre de referencias — F2.7.
 *
 * `DragRef` es lo que viaja cuando se arrastra una rama o un tag, y
 * `integrationOffer` decide qué acciones se ofrecen al soltar. El guardián
 * `isDragRef` lo necesita `useDropTarget`, que recibe `unknown` porque el
 * primitivo `DragLayer` no sabe qué es una rama.
 */

/** Lo que viaja cuando se arrastra una referencia. */
export type DragRef = {
  kind: 'branch' | 'tag';
  name: string;
  /** Identidad completa para comparar; la integración conserva el nombre. */
  ref?: string;
};

export function isDragRef(payload: unknown): payload is DragRef {
  if (payload === null || typeof payload !== 'object') return false;

  const p = payload as Record<string, unknown>;

  return (
    (p.kind === 'branch' || p.kind === 'tag') &&
    typeof p.name === 'string' &&
    (p.ref === undefined || typeof p.ref === 'string')
  );
}

export type IntegrationOffer = 'merge-rebase-compare' | 'compare-only';

/**
 * Qué acciones ofrecer cuando se suelta `source` sobre `target`.
 *
 * Devuelve `null` cuando no tiene sentido —la misma referencia sobre sí misma—.
 * Un tag en cualquiera de los dos lados reduce la oferta a solo comparar,
 * porque no se puede fusionar ni rebasar sobre un tag.
 */
export function integrationOffer(source: DragRef, target: DragRef): IntegrationOffer | null {
  // No se puede soltar sobre sí misma.
  if (source.kind === target.kind && source.name === target.name) return null;

  // Si alguno es tag: solo comparar.
  if (source.kind === 'tag' || target.kind === 'tag') return 'compare-only';

  // Dos ramas: fusionar + rebasar + comparar.
  return 'merge-rebase-compare';
}

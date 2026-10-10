/**
 * Límites de edición y avisos del compositor. Puro, sin React.
 * Los límites se aplican también a los mensajes preexistentes al abrir amend.
 */

/** Límites de GitThul; Git recomienda 50 para el resumen, pero no lo exige. */
export const SUMMARY_LIMIT = 72;
export const BODY_LIMIT = 4500;

/** El resumen es una sola línea, también al cargar amend o restaurar un borrador. */
export function normalizeCommitSummary(summary: string): string {
  return summary.replace(/[\r\n]+$/g, '').replace(/[\r\n]+/g, ' ');
}

export type CommitWarning = 'summaryTooLong' | 'summaryHasBreak';

export function commitWarnings(summary: string): readonly CommitWarning[] {
  const warnings: CommitWarning[] = [];

  if (summary.trim().length > SUMMARY_LIMIT) warnings.push('summaryTooLong');

  /*
   * «Detalle sin línea en blanco de separación», dicho sobre dos campos.
   *
   * Con resumen y detalle en cajas distintas la línea en blanco la pone GitThul
   * al armar el mensaje, así que el caso que el subplan describe solo puede
   * llegar de una forma: que alguien escriba el mensaje entero dentro del
   * resumen. Eso es lo que se detecta —un salto de línea en la primera caja— y
   * lo que el aviso propone arreglar.
   */
  if (summary.includes('\n')) warnings.push('summaryHasBreak');

  return warnings;
}

/** Lo que se puede enviar: algo en el stage y un resumen con texto. */
export function canCommit(summary: string, stagedCount: number, amend: boolean): boolean {
  if (summary.trim() === '') return false;

  // Enmendar reescribe el commit anterior: cambiar solo el mensaje, sin nada
  // preparado, es un uso legítimo y el más frecuente de los dos.
  return amend || stagedCount > 0;
}

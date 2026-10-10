import type { ReactNode } from 'react';

/*
 * Modelo de menú compartido por `ContextMenu`, `Dropdown` y `SplitActionButton`.
 *
 * Los tres pintan lo mismo y navegan igual, así que describen sus entradas con
 * estos tipos y el recorrido con estas funciones. Que sean puras es lo que
 * permite probar la navegación por teclado sin montar nada.
 *
 * La regla de nombrar siempre las ramas vive en `label`: quien construye el
 * menú ya recibió los nombres por i18n. Aquí no se escribe texto.
 */

export interface MenuAction {
  kind?: 'action';
  key: string;
  label: string;
  icon?: ReactNode;
  /** Atajo ya formateado para el idioma activo, p. ej. «Ctrl+Z». */
  shortcut?: string;
  /** Segunda línea: lo que la acción va a hacer, cuando el rótulo no basta. */
  description?: string;
  disabled?: boolean;
  /** Acciones que pierden trabajo. Nunca sin confirmación o sin deshacer. */
  danger?: boolean;
  /** Ítem de alternar; se marca con el motivo de anillo. */
  checked?: boolean;
  onSelect: () => void;
}

export interface MenuSubmenu {
  kind: 'submenu';
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  items: readonly MenuEntry[];
}

export interface MenuSeparator {
  kind: 'separator';
  key: string;
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator;

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return entry.kind === 'separator';
}

export function isSubmenu(entry: MenuEntry): entry is MenuSubmenu {
  return entry.kind === 'submenu';
}

export function isAction(entry: MenuEntry): entry is MenuAction {
  return !isSeparator(entry) && !isSubmenu(entry);
}

/** Navegable: ni separador ni deshabilitado. */
export function isNavigable(entry: MenuEntry): boolean {
  return !isSeparator(entry) && !entry.disabled;
}

/**
 * Siguiente entrada navegable dando la vuelta al final de la lista.
 * `from` puede ser -1 para arrancar sin nada resaltado.
 */
export function stepIndex(items: readonly MenuEntry[], from: number, step: 1 | -1): number {
  if (items.length === 0) return -1;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (from + step * offset + items.length * (offset + 1)) % items.length;
    const entry = items[index];

    if (entry && isNavigable(entry)) return index;
  }

  return -1;
}

export function firstIndex(items: readonly MenuEntry[]): number {
  return stepIndex(items, -1, 1);
}

export function lastIndex(items: readonly MenuEntry[]): number {
  return stepIndex(items, items.length, -1);
}

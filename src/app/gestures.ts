import {
  formatShortcut,
  isTypingTarget,
  matchesShortcut,
  parseShortcut,
  type KeyEventLike,
  type Shortcut,
} from './keys';
import type { Platform } from './platform';

/*
 * Registro central de gestos: una acción, un nombre, los caminos que tenga.
 *
 * Existe para hacer cumplir la invariante 3 — toda acción se declara aquí y llega
 * por caminos naturales — de la única forma que funciona: haciendo que declararlo
 * sea obligatorio. Cada acción se registra una vez, con su rótulo, su combo y la
 * lista de caminos por los que se llega; el botón, el menú, la búsqueda global y
 * el teclado son consumidores del registro y no dueños de la acción.
 *
 * **No exige dos caminos.** Lo exigía, y lo que producía eran gestos que nadie
 * descubre solo, añadidos para llegar a la cuota. Un camino basta cuando el
 * segundo sería inventado; lo que sí revienta al construir el registro es un
 * identificador repetido, un atajo que ya usa otra acción, un atajo que no se
 * declara como disparador, o una acción a la que no se llega por ningún camino.
 */

/**
 * Los caminos por los que se puede alcanzar una acción.
 *
 * `activate` es la fila que se abre con doble clic o con Enter. No es `button`
 * porque una fila no es un control: la lista de repositorios, la de commits y la
 * de archivos comparten ese gesto, y llamarlo botón haría creer que hay uno.
 */
export type TriggerKind =
  'button' | 'menu' | 'shortcut' | 'search' | 'drag' | 'activate' | 'wheelClick' | 'hoverAction';

export interface GestureDefinition {
  id: string;
  /** Rótulo ya traducido; el mismo en el botón, el menú y la búsqueda. */
  label: string;
  description?: string;
  triggers: readonly TriggerKind[];
  /** Forma canónica, p. ej. `Mod+Shift+T`. Exige el disparador `shortcut`. */
  shortcut?: string;
  /** Nombre estable para aprender el atajo, sin datos de la selección actual. */
  shortcutName?: string;
  /** Permite usar el atajo desde un campo de texto; por defecto prima la edición. */
  allowWhileTyping?: boolean;
  /** Sin efecto aquí y ahora: se lista, pero no se ejecuta. */
  disabled?: boolean;
  /** Acciones que no tiene sentido buscar por nombre, como reordenar. */
  hiddenInSearch?: boolean;
  run: () => void;
}

export interface Gesture extends GestureDefinition {
  shortcutKeys: Shortcut | null;
  /** Combo listo para pintar en un menú o en la búsqueda. */
  shortcutLabel: string | null;
}

export interface GestureKeyEvent extends KeyEventLike {
  target?: EventTarget | null;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

export interface GestureRegistry {
  platform: Platform;
  list: readonly Gesture[];
  get: (id: string) => Gesture | undefined;
  /** Ejecuta si existe y está habilitado. Devuelve si de verdad corrió. */
  run: (id: string) => boolean;
  /** El gesto al que corresponde un evento de teclado, si hay alguno. */
  match: (event: GestureKeyEvent) => Gesture | undefined;
}

/** Una acción a la que no se llega por ningún camino no es una acción. */
const MIN_TRIGGERS = 1;

export function createGestureRegistry(
  definitions: readonly GestureDefinition[],
  platform: Platform,
): GestureRegistry {
  const byId = new Map<string, Gesture>();
  const combos = new Map<string, string>();

  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(`Gesto repetido: ${definition.id}`);
    }

    const triggers = new Set(definition.triggers);

    if (triggers.size < MIN_TRIGGERS) {
      throw new Error(`El gesto ${definition.id} no declara ningún disparador`);
    }

    if (definition.shortcut && !triggers.has('shortcut')) {
      throw new Error(`El gesto ${definition.id} tiene atajo pero no lo declara como disparador`);
    }

    if (!definition.shortcut && triggers.has('shortcut')) {
      throw new Error(`El gesto ${definition.id} declara atajo como disparador pero no da ninguno`);
    }

    const shortcutKeys = definition.shortcut ? parseShortcut(definition.shortcut) : null;

    if (definition.shortcut) {
      const previous = combos.get(definition.shortcut);

      if (previous) {
        throw new Error(`${definition.shortcut} ya lo usa ${previous}`);
      }

      combos.set(definition.shortcut, definition.id);
    }

    byId.set(definition.id, {
      ...definition,
      shortcutKeys,
      shortcutLabel: shortcutKeys ? formatShortcut(shortcutKeys, platform) : null,
    });
  }

  const list = [...byId.values()];

  return {
    platform,
    list,

    get: (id) => byId.get(id),

    run: (id) => {
      const gesture = byId.get(id);

      if (!gesture) throw new Error(`Gesto desconocido: ${id}`);
      if (gesture.disabled) return false;

      gesture.run();

      return true;
    },

    match: (event) => {
      if (event.defaultPrevented || event.isComposing) return undefined;
      // Los formularios modales no ejecutan acciones de la selección que queda detrás.
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) {
        return undefined;
      }

      const typing = isTypingTarget(event.target ?? null);

      return list.find((gesture) => {
        if (gesture.disabled || !gesture.shortcutKeys) return false;

        if (typing && !gesture.allowWhileTyping) return false;

        return matchesShortcut(gesture.shortcutKeys, event, platform);
      });
    },
  };
}

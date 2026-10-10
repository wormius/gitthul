import type { Platform } from './platform';

/*
 * Atajos de teclado: declaración, comparación y rótulo.
 *
 * Se escriben en una sola forma canónica, `Mod+Shift+T`, y de ahí salen las tres
 * cosas que hacen falta: comparar contra un evento, pintar el combo en un menú y
 * listarlo en los ajustes. `Mod` es Ctrl en Windows y Linux y Cmd en macOS, que
 * es la única diferencia por plataforma que de verdad importa.
 */

export interface Shortcut {
  /** Tecla en minúsculas: `t`, `,`, `escape`, `arrowleft`, `f1`. */
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const MODIFIERS = new Set(['mod', 'ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd']);

export function parseShortcut(combo: string): Shortcut {
  const parts = combo
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const shortcut: Shortcut = {
    key: '',
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };

  for (const part of parts) {
    const lower = part.toLowerCase();

    if (!MODIFIERS.has(lower)) {
      shortcut.key = lower;

      continue;
    }

    if (lower === 'mod') shortcut.mod = true;
    else if (lower === 'ctrl' || lower === 'control') shortcut.ctrl = true;
    else if (lower === 'alt' || lower === 'option') shortcut.alt = true;
    else if (lower === 'shift') shortcut.shift = true;
    else shortcut.meta = true;
  }

  if (shortcut.key === '') throw new Error(`Atajo sin tecla: «${combo}»`);

  return shortcut;
}

/** Lo mínimo que hace falta de un evento de teclado para comparar. */
export interface KeyEventLike {
  key: string;
  /** Posición física de la tecla; con Alt pulsada es lo único fiable. */
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Tecla que corresponde a la posición física.
 *
 * Con Alt pulsada, macOS entrega caracteres compuestos — Alt+T da «†» — así que
 * comparar solo `key` dejaría media tabla de atajos sin responder.
 */
function keyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Slash') return '/';

  return null;
}

export function matchesShortcut(
  shortcut: Shortcut,
  event: KeyEventLike,
  platform: Platform,
): boolean {
  const wantsCtrl = shortcut.ctrl || (shortcut.mod && platform !== 'mac');
  const wantsMeta = shortcut.meta || (shortcut.mod && platform === 'mac');

  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.metaKey !== wantsMeta) return false;
  if (event.altKey !== shortcut.alt) return false;
  if (event.shiftKey !== shortcut.shift) return false;

  return event.key.toLowerCase() === shortcut.key || keyFromCode(event.code) === shortcut.key;
}

/** Rótulos de las teclas que no son un carácter. */
const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': '␣',
  ',': ',',
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key.toUpperCase());
}

/**
 * Combo listo para pintar. En macOS son símbolos pegados, como en el resto del
 * sistema; en Windows y Linux, nombres unidos por `+`, que es lo que `Menu` y
 * `CommandPalette` parten para repartir en teclas.
 */
export function formatShortcut(shortcut: Shortcut, platform: Platform): string {
  if (platform === 'mac') {
    const symbols = [
      shortcut.ctrl && '⌃',
      shortcut.alt && '⌥',
      shortcut.shift && '⇧',
      (shortcut.mod || shortcut.meta) && '⌘',
    ].filter((symbol): symbol is string => Boolean(symbol));

    return `${symbols.join('')}${keyLabel(shortcut.key)}`;
  }

  return [
    shortcut.mod || shortcut.ctrl ? 'Ctrl' : null,
    shortcut.alt ? 'Alt' : null,
    shortcut.shift ? 'Shift' : null,
    shortcut.meta ? 'Meta' : null,
    keyLabel(shortcut.key),
  ]
    .filter((part): part is string => part !== null)
    .join('+');
}

/**
 * Si el evento nació escribiendo.
 *
 * La edición tiene prioridad, incluso con modificadores: Ctrl/Cmd+Z deshace
 * texto antes que una operación Git. Cada acción decide explícitamente si su
 * atajo puede usarse desde un campo, como buscar o enviar el mensaje de commit.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable]:not([contenteditable="false"])')) return true;

  const tag = target.tagName;

  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

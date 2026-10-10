import { describe, expect, it, vi } from 'vitest';

import { createGestureRegistry, type GestureDefinition } from './gestures';
import { formatShortcut, isTypingTarget, matchesShortcut, parseShortcut } from './keys';

function gesture(patch: Partial<GestureDefinition> = {}): GestureDefinition {
  return {
    id: 'test.action',
    label: 'Acción de prueba',
    triggers: ['button', 'search'],
    run: () => undefined,
    ...patch,
  };
}

const keyEvent = (patch: Partial<Parameters<ReturnType<typeof registry>['match']>[0]> = {}) => ({
  key: 'a',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...patch,
});

const registry = (definitions: readonly GestureDefinition[], platform: 'linux' | 'mac' = 'linux') =>
  createGestureRegistry(definitions, platform);

describe('parseShortcut', () => {
  it('reparte modificadores y tecla', () => {
    expect(parseShortcut('Mod+Shift+T')).toEqual({
      key: 't',
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it('acepta los alias de cada modificador', () => {
    expect(parseShortcut('Control+Option+,')).toMatchObject({ key: ',', ctrl: true, alt: true });
    expect(parseShortcut('Cmd+K')).toMatchObject({ key: 'k', meta: true });
  });

  it('rechaza un combo sin tecla', () => {
    expect(() => parseShortcut('Mod+Shift')).toThrow(/sin tecla/);
  });
});

describe('matchesShortcut', () => {
  const combo = parseShortcut('Mod+W');

  it('Mod es Ctrl fuera de macOS y Cmd dentro', () => {
    expect(matchesShortcut(combo, keyEvent({ key: 'w', ctrlKey: true }), 'linux')).toBe(true);
    expect(matchesShortcut(combo, keyEvent({ key: 'w', metaKey: true }), 'linux')).toBe(false);
    expect(matchesShortcut(combo, keyEvent({ key: 'w', metaKey: true }), 'mac')).toBe(true);
    expect(matchesShortcut(combo, keyEvent({ key: 'w', ctrlKey: true }), 'mac')).toBe(false);
  });

  it('exige que no haya modificadores de sobra', () => {
    expect(
      matchesShortcut(combo, keyEvent({ key: 'w', ctrlKey: true, shiftKey: true }), 'linux'),
    ).toBe(false);
  });

  // Con Alt pulsada macOS entrega «†» en vez de «t»: sin la posición física, la
  // mitad de los atajos con Alt no responderían.
  it('cae en la posición física cuando la tecla llega transformada', () => {
    const alt = parseShortcut('Alt+T');

    expect(matchesShortcut(alt, keyEvent({ key: '†', code: 'KeyT', altKey: true }), 'mac')).toBe(
      true,
    );
  });
});

describe('formatShortcut', () => {
  it('usa nombres y «+» fuera de macOS', () => {
    expect(formatShortcut(parseShortcut('Mod+Shift+T'), 'linux')).toBe('Ctrl+Shift+T');
    expect(formatShortcut(parseShortcut('Mod+,'), 'windows')).toBe('Ctrl+,');
    expect(formatShortcut(parseShortcut('Escape'), 'linux')).toBe('Esc');
  });

  it('usa símbolos pegados en macOS', () => {
    expect(formatShortcut(parseShortcut('Mod+Shift+T'), 'mac')).toBe('⇧⌘T');
    expect(formatShortcut(parseShortcut('Alt+ArrowLeft'), 'mac')).toBe('⌥←');
  });
});

describe('registro de gestos', () => {
  it('acepta un solo camino y rechaza ninguno', () => {
    // Exigir dos producía gestos que nadie descubre solo, añadidos para llegar
    // a la cuota. Lo que sigue sin tener sentido es una acción inalcanzable.
    expect(() => registry([gesture({ triggers: ['menu'] })])).not.toThrow();
    expect(() => registry([gesture()])).not.toThrow();
    expect(() => registry([gesture({ triggers: [] })])).toThrow(/ningún disparador/);
  });

  it('rechaza identificadores y combos repetidos', () => {
    expect(() => registry([gesture(), gesture()])).toThrow(/repetido/);
    expect(() =>
      registry([
        gesture({ id: 'a', triggers: ['button', 'shortcut'], shortcut: 'Mod+W' }),
        gesture({ id: 'b', triggers: ['button', 'shortcut'], shortcut: 'Mod+W' }),
      ]),
    ).toThrow(/ya lo usa a/);
  });

  it('rechaza atajo y disparador que no se corresponden', () => {
    expect(() => registry([gesture({ shortcut: 'Mod+W' })])).toThrow(/no lo declara/);
    expect(() => registry([gesture({ triggers: ['button', 'shortcut'] })])).toThrow(
      /no da ninguno/,
    );
  });

  it('ejecuta por identificador y respeta lo deshabilitado', () => {
    const run = vi.fn();
    const registered = registry([gesture({ run }), gesture({ id: 'off', disabled: true, run })]);

    expect(registered.run('test.action')).toBe(true);
    expect(registered.run('off')).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(() => registered.run('nada')).toThrow(/desconocido/);
  });

  it('encuentra el gesto de un evento de teclado', () => {
    const registered = registry([
      gesture({ id: 'close', triggers: ['button', 'shortcut'], shortcut: 'Mod+W' }),
    ]);

    expect(registered.match(keyEvent({ key: 'w', ctrlKey: true }))?.id).toBe('close');
    expect(registered.match(keyEvent({ key: 'w' }))).toBeUndefined();
  });

  it('no dispara sobre un evento que ya alguien atendió', () => {
    const registered = registry([
      gesture({ id: 'close', triggers: ['button', 'shortcut'], shortcut: 'Mod+W' }),
    ]);

    expect(
      registered.match(keyEvent({ key: 'w', ctrlKey: true, defaultPrevented: true })),
    ).toBeUndefined();
  });

  it('los atajos desde campos de texto requieren autorización explícita', () => {
    const input = document.createElement('input');
    const registered = registry([
      gesture({ id: 'escape', triggers: ['button', 'shortcut'], shortcut: 'Escape' }),
      gesture({
        id: 'close',
        triggers: ['button', 'shortcut'],
        shortcut: 'Mod+W',
        allowWhileTyping: true,
      }),
      gesture({ id: 'undo', triggers: ['button', 'shortcut'], shortcut: 'Mod+Z' }),
      gesture({ id: 'redo', triggers: ['button', 'shortcut'], shortcut: 'Mod+Shift+Z' }),
    ]);

    expect(registered.match(keyEvent({ key: 'Escape' }))?.id).toBe('escape');
    expect(registered.match(keyEvent({ key: 'Escape', target: input }))).toBeUndefined();
    expect(registered.match(keyEvent({ key: 'w', ctrlKey: true, target: input }))?.id).toBe(
      'close',
    );
    expect(registered.match(keyEvent({ key: 'z', ctrlKey: true, target: input }))).toBeUndefined();
    expect(
      registered.match(keyEvent({ key: 'z', ctrlKey: true, shiftKey: true, target: input })),
    ).toBeUndefined();
    expect(registered.match(keyEvent({ key: 'z', ctrlKey: true }))?.id).toBe('undo');
  });

  it('no ejecuta atajos durante la composición de texto', () => {
    const registered = registry([
      gesture({ triggers: ['shortcut'], shortcut: 'Mod+Enter', allowWhileTyping: true }),
    ]);
    expect(
      registered.match(keyEvent({ key: 'Enter', ctrlKey: true, isComposing: true })),
    ).toBeUndefined();
  });

  it('reconoce dónde se está escribiendo', () => {
    const editable = document.createElement('div');

    editable.contentEditable = 'true';
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);

    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(child)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
  });
});

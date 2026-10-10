import { describe, expect, it } from 'vitest';

import { applySelection, intentFrom } from './selection';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('intentFrom', () => {
  it('traduce las teclas modificadoras', () => {
    expect(intentFrom({})).toBe('replace');
    expect(intentFrom({ ctrlKey: true })).toBe('toggle');
    expect(intentFrom({ metaKey: true })).toBe('toggle');
    expect(intentFrom({ shiftKey: true })).toBe('range');
  });

  it('Mayús manda sobre Ctrl cuando se pulsan las dos', () => {
    expect(intentFrom({ ctrlKey: true, shiftKey: true })).toBe('range');
  });
});

describe('applySelection', () => {
  it('un clic sin modificadores deja solo lo pulsado', () => {
    const next = applySelection(new Set(['a', 'b']), ids, 'd', 'replace', 'a', 'multiple');

    expect([...next]).toEqual(['d']);
  });

  it('Ctrl añade y quita sin tocar el resto', () => {
    const added = applySelection(new Set(['a']), ids, 'c', 'toggle', 'a', 'multiple');

    expect([...added].sort()).toEqual(['a', 'c']);

    const removed = applySelection(added, ids, 'a', 'toggle', 'a', 'multiple');

    expect([...removed]).toEqual(['c']);
  });

  it('Mayús toma el rango entre el ancla y lo pulsado, en cualquier dirección', () => {
    const forward = applySelection(new Set(['b']), ids, 'd', 'range', 'b', 'multiple');

    expect([...forward]).toEqual(['b', 'c', 'd']);

    const backward = applySelection(new Set(['d']), ids, 'b', 'range', 'd', 'multiple');

    expect([...backward]).toEqual(['b', 'c', 'd']);
  });

  it('sin ancla, Mayús se comporta como un clic normal', () => {
    const next = applySelection(new Set(['a']), ids, 'c', 'range', null, 'multiple');

    expect([...next]).toEqual(['c']);
  });

  it('el modo simple nunca acumula, ni con Ctrl', () => {
    const next = applySelection(new Set(['a']), ids, 'c', 'toggle', 'a', 'single');

    expect([...next]).toEqual(['c']);
  });

  it('el modo sin selección devuelve lo que había', () => {
    const before = new Set(['a']);

    expect(applySelection(before, ids, 'c', 'replace', null, 'none')).toBe(before);
  });
});

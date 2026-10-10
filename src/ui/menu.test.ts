import { describe, expect, it } from 'vitest';

import {
  firstIndex,
  isAction,
  isSeparator,
  isSubmenu,
  lastIndex,
  stepIndex,
  type MenuEntry,
} from './menu';

const items: MenuEntry[] = [
  { key: 'sep-top', kind: 'separator' },
  { key: 'merge', label: 'Fusionar dev dentro de main', onSelect: () => undefined },
  { key: 'rebase', label: 'Rebasar main sobre dev', disabled: true, onSelect: () => undefined },
  { key: 'sep', kind: 'separator' },
  { key: 'more', kind: 'submenu', label: 'Comparar', items: [] },
];

describe('modelo de menú', () => {
  it('distingue las tres clases de entrada', () => {
    expect(isSeparator(items[0]!)).toBe(true);
    expect(isAction(items[1]!)).toBe(true);
    expect(isSubmenu(items[4]!)).toBe(true);
    expect(isAction(items[4]!)).toBe(false);
  });

  it('salta separadores y deshabilitados al recorrer', () => {
    expect(firstIndex(items)).toBe(1);
    expect(stepIndex(items, 1, 1)).toBe(4);
    expect(lastIndex(items)).toBe(4);
  });

  it('da la vuelta por los dos extremos', () => {
    expect(stepIndex(items, 4, 1)).toBe(1);
    expect(stepIndex(items, 1, -1)).toBe(4);
  });

  it('devuelve -1 cuando no hay nada navegable', () => {
    expect(firstIndex([])).toBe(-1);
    expect(firstIndex([{ key: 'sep', kind: 'separator' }])).toBe(-1);
  });
});

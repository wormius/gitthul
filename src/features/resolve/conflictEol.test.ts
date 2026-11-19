import { describe, expect, it } from 'vitest';

import {
  assemble,
  buildBlocks,
  conflictBlocks,
  pendingBlocks,
  type ConflictBlock,
} from './conflict';

function verify(base: string, ours: string, theirs: string) {
  const blocks = buildBlocks(base, ours, theirs);
  expect(blocks.map((block) => block.oursText).join('')).toBe(ours);
  expect(blocks.map((block) => block.theirsText).join('')).toBe(theirs);
  for (const side of ['ours', 'theirs'] as const) {
    let line = 1;
    for (const block of blocks) {
      expect(side === 'ours' ? block.oursLine : block.theirsLine).toBe(line);
      line += block[side].length;
    }
  }
  return blocks;
}

const BASE = 'cabecera\nuno\ndos\ntres\ncuatro\ncinco\nfin\n';

function choose(blocks: readonly ConflictBlock[], side: 'ours' | 'theirs') {
  return assemble(blocks, new Map(conflictBlocks(blocks).map((block) => [block.id, [side]]))).text;
}

describe('contenido y finales de línea en conflictos pequeños', () => {
  it('localiza la edición real de B frente a la conversión LF→CRLF de A', () => {
    const ours = BASE.replace('uno', 'UNO').replaceAll('\n', '\r\n');
    const theirs = BASE.replace('cinco', 'CINCO');
    const blocks = verify(BASE, ours, theirs);
    const conflicts = conflictBlocks(blocks);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.oursText).toBe('cinco\r\n');
    expect(conflicts[0]?.theirsText).toBe('CINCO\n');
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe(ours.replace('cinco\r\n', 'CINCO\n'));
  });

  it('localiza igualmente la conversión CRLF→LF de A sobre una base CRLF', () => {
    const base = BASE.replaceAll('\n', '\r\n');
    const ours = BASE.replace('uno', 'UNO');
    const theirs = base.replace('cinco', 'CINCO');
    const blocks = verify(base, ours, theirs);
    const conflicts = conflictBlocks(blocks);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.oursText).toBe('cinco\n');
    expect(conflicts[0]?.theirsText).toBe('CINCO\r\n');
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe(ours.replace('cinco\n', 'CINCO\r\n'));
  });

  it('dos conversiones iguales a CRLF conservan un conflicto de contenido localizado', () => {
    const ours = BASE.replace('tres', 'TRES A').replaceAll('\n', '\r\n');
    const theirs = BASE.replace('tres', 'TRES B').replaceAll('\n', '\r\n');
    const blocks = verify(BASE, ours, theirs);
    const conflicts = conflictBlocks(blocks);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.oursText).toBe('TRES A\r\n');
    expect(conflicts[0]?.theirsText).toBe('TRES B\r\n');
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe(theirs);
  });

  it('dos conversiones iguales a LF conservan un conflicto de contenido localizado', () => {
    const base = BASE.replaceAll('\n', '\r\n');
    const ours = BASE.replace('tres', 'TRES A');
    const theirs = BASE.replace('tres', 'TRES B');
    const blocks = verify(base, ours, theirs);
    expect(conflictBlocks(blocks)).toHaveLength(1);
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe(theirs);
  });

  it('conserva los terminadores mixtos exactos alrededor de las decisiones', () => {
    const base = 'inicio\nuno\r\ndos\ntres\r\nfin';
    const ours = 'inicio\r\nuno\ndos\r\ntres\nfin';
    const theirs = 'inicio\nUNO\r\ndos\nTRES\r\nfin';
    const blocks = verify(base, ours, theirs);
    const conflicts = conflictBlocks(blocks);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((block) => block.oursText)).toEqual(['uno\n', 'tres\n']);
    expect(conflicts.map((block) => block.theirsText)).toEqual(['UNO\r\n', 'TRES\r\n']);
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe('inicio\r\nUNO\r\ndos\r\nTRES\r\nfin');
  });

  it('la ausencia de salto final compite con otra edición de esa línea', () => {
    const base = 'inicio\nbase\nfin\n';
    const ours = 'inicio\r\nbase\r\nfin';
    const theirs = 'inicio\nbase\nFIN\n';
    const blocks = verify(base, ours, theirs);
    expect(conflictBlocks(blocks).map((block) => block.oursText)).toEqual(['fin']);
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe('inicio\r\nbase\r\nFIN\n');
  });

  it('las conversiones sin edición del otro lado se integran sin cambiar sus bytes', () => {
    const changed = BASE.replaceAll('\n', '\r\n');
    const blocks = verify(BASE, changed, BASE);
    expect(conflictBlocks(blocks)).toHaveLength(0);
    expect(blocks).toHaveLength(1);
    expect(assemble(blocks, new Map()).text).toBe(changed);
  });

  it('la coincidencia de contenido no descarta una elección entre terminadores distintos', () => {
    const blocks = verify('base\n', 'base\r\n', 'base');
    expect(pendingBlocks(blocks, new Map())).toBe(1);
    expect(choose(blocks, 'ours')).toBe('base\r\n');
    expect(choose(blocks, 'theirs')).toBe('base');
  });

  it('una inserción junto a una conversión EOL conserva ambas ediciones', () => {
    const blocks = verify('a\nb\nc\n', 'a\r\nb\r\nc\r\n', 'a\nnuevo\nb\nc\n');
    expect(conflictBlocks(blocks)).toHaveLength(0);
    expect(assemble(blocks, new Map()).text).toBe('a\r\nnuevo\nb\r\nc\r\n');
  });

  it('quitar el salto final compite con añadir contenido después de esa línea', () => {
    const blocks = verify('a\n', 'a', 'a\nb\n');
    expect(conflictBlocks(blocks)).toHaveLength(1);
    expect(choose(blocks, 'ours')).toBe('a');
    expect(choose(blocks, 'theirs')).toBe('a\nb\n');
  });

  it.each(['\n', '\r\n'])(
    'no alinea una última línea sin salto con otra repetida que sí lo tiene (%j)',
    (eol) => {
      const base = `a${eol}a${eol}c${eol}`;
      const ours = `a${eol}c${eol}`;
      const theirs = `a${eol}c${eol}c`;
      for (const [a, b] of [
        [ours, theirs],
        [theirs, ours],
      ] as const) {
        const blocks = verify(base, a, b);
        expect(conflictBlocks(blocks)).toHaveLength(0);
        expect(assemble(blocks, new Map()).text).toBe(theirs);
      }
    },
  );

  it('una eliminación que solapa una conversión EOL sigue pidiendo decisión', () => {
    const blocks = verify('a\nb\nc\n', 'a\r\nb\r\nc\r\n', 'a\nc\n');
    expect(conflictBlocks(blocks)).toHaveLength(1);
    expect(conflictBlocks(blocks)[0]?.oursText).toBe('b\r\n');
    expect(conflictBlocks(blocks)[0]?.theirsText).toBe('');
    expect(choose(blocks, 'ours')).toBe('a\r\nb\r\nc\r\n');
    expect(choose(blocks, 'theirs')).toBe('a\r\nc\r\n');
  });

  it('no une ediciones por contenido adyacentes por un cambio EOL interpuesto', () => {
    const blocks = verify('a\nb\nc\nd\n', 'A\nb\nc\nd\n', 'a\r\nB\nc\nd\n');
    expect(conflictBlocks(blocks)).toHaveLength(1);
  });

  it('conserva la reconstrucción con repeticiones y combinaciones mixtas en 1728 ternas', () => {
    const variants = [
      '',
      'a',
      'a\n',
      'a\r\n',
      'a\na\n',
      'a\r\na\r\n',
      'a\r\na\n',
      'a\na\r\n',
      'a\nb',
      'a\r\nb',
      'b\na\n',
      'b\r\na\r\n',
    ];
    for (const base of variants)
      for (const ours of variants)
        for (const theirs of variants) {
          verify(base, ours, theirs);
        }
  });
});

describe('islas compartidas nuevas dentro de un bloque solapado', () => {
  it('incluye una sola vez lo que ambas ramas escribieron igual sin base común en ese tramo', () => {
    const base = 'base0\nbase1\nbase2\nbase3\nbase4\n';
    const ours = 'A\ncomún 1\nnuestro\ncomún 2\nfin A\n';
    const theirs = 'B\ncomún 1\nsuyo\ncomún 2\nfin B\n';
    const blocks = verify(base, ours, theirs);
    expect(conflictBlocks(blocks)).toHaveLength(3);
    expect(
      blocks.filter((block) => block.kind !== 'conflict').map((block) => block.mergedText),
    ).toEqual(['común 1\n', 'común 2\n']);
    expect(choose(blocks, 'ours')).toBe(ours);
    expect(choose(blocks, 'theirs')).toBe(theirs);
  });
});

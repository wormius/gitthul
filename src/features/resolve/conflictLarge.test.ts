import { describe, expect, it } from 'vitest';

import { assemble, buildBlocks, conflictBlocks, pendingBlocks, type Choices } from './conflict';

describe('alineado de conflictos extensos en Resolver', () => {
  it('integra cambios separados sin convertir las islas comunes en conflictos', () => {
    const original = Array.from({ length: 6_000 }, (_, index) => `línea ${index}\n`);
    const ours = original.map((line, index) => (index % 5 === 0 ? `A ${index}\n` : line));
    const theirs = [...original];
    theirs[3_002] = 'cambio independiente de B\n';
    const expected = [...ours];
    expected[3_002] = theirs[3_002]!;
    const blocks = buildBlocks(original.join(''), ours.join(''), theirs.join(''));

    expect(conflictBlocks(blocks)).toHaveLength(0);
    expect(assemble(blocks, new Map()).text).toBe(expected.join(''));
    expect(blocks.map((block) => block.oursText).join('')).toBe(ours.join(''));
    expect(blocks.map((block) => block.theirsText).join('')).toBe(theirs.join(''));
  });

  it('conserva las decisiones por bloque y el contexto tras más de 2.000 ediciones', () => {
    const original = Array.from({ length: 4_400 }, (_, index) => `línea ${index}\r\n`);
    const ours = original.map((line, index) => (index % 4 === 0 ? `A ${index}\r\n` : line));
    const theirs = original.map((line, index) => (index % 4 === 0 ? `B ${index}\r\n` : line));
    const blocks = buildBlocks(original.join(''), ours.join(''), theirs.join(''));
    const conflicts = conflictBlocks(blocks);
    const choices: Choices = new Map(conflicts.map((block) => [block.id, ['ours']]));

    expect(conflicts).toHaveLength(1_100);
    expect(pendingBlocks(blocks, choices)).toBe(0);
    expect(assemble(blocks, choices).text).toBe(ours.join(''));
    expect(blocks.filter((block) => block.kind === 'context')).toHaveLength(1_100);
  });
});

describe('archivos creados en ambas ramas sin ancestro', () => {
  it('mantiene las partes idénticas y pide decisión solo sobre diferencias', () => {
    const ours = 'inicio\r\nA\r\ncomún\r\nsolo A\r\nfin';
    const theirs = 'inicio\r\nB\r\ncomún\r\nfin';
    const blocks = buildBlocks(null, ours, theirs);
    const conflicts = conflictBlocks(blocks);

    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((block) => block.oursText)).toEqual(['A\r\n', 'solo A\r\n']);
    expect(conflicts.map((block) => block.theirsText)).toEqual(['B\r\n', '']);
    expect(assemble(blocks, new Map()).text).toBe('inicio\r\ncomún\r\nfin');
    expect(pendingBlocks(blocks, new Map())).toBe(2);
    expect(blocks.map((block) => block.oursText).join('')).toBe(ours);
    expect(blocks.map((block) => block.theirsText).join('')).toBe(theirs);

    for (const [side, expected] of [
      ['ours', ours],
      ['theirs', theirs],
    ] as const) {
      const choices: Choices = new Map(conflicts.map((block) => [block.id, [side]]));
      expect(assemble(blocks, choices).text).toBe(expected);
      expect(pendingBlocks(blocks, choices)).toBe(0);
    }
  });

  it('no supone independientes las inserciones frente a una creación vacía', () => {
    const blocks = buildBlocks(null, '', 'contenido\n');
    expect(conflictBlocks(blocks)).toHaveLength(1);
    expect(pendingBlocks(blocks, new Map())).toBe(1);
    expect(assemble(blocks, new Map()).text).toBe('');
  });
});

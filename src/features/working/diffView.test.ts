import { describe, expect, it } from 'vitest';

import type { DiffLine, Hunk } from '@core/domain/diff';
import type { LineRef } from '@core/ports/GitPort';
import { interpolate } from '@i18n/format';
import { esMX } from '@i18n/messages/es-MX';

import type { Translate } from './contextMenus';
import {
  fileBlocks,
  fileRows,
  HEADER_ROWS,
  historicalRows,
  workingRows,
  hunkBlocks,
  hunkMarkers,
  newColumn,
  oldColumn,
  sourceLabel,
  splitRows,
  stageableLines,
  unifiedColumn,
} from './diffView';

const t: Translate = (key, params) => interpolate(esMX[key], params);

function line(
  kind: DiffLine['kind'],
  text: string,
  oldLine: number | null,
  newLine: number | null,
  words?: DiffLine['words'],
): DiffLine {
  return { kind, text, oldLine, newLine, ...(words === undefined ? {} : { words }) };
}

/**
 * Un hunk con una línea cambiada y contexto a los dos lados.
 *
 * Es el caso que de verdad hay que vigilar: la línea de enfrente lleva su tramo
 * de palabra, y los números de las dos versiones se separan a partir de ahí.
 */
const simple: Hunk = {
  id: 'hunk-1',
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 3,
  header: 'export function resolveTheme() {',
  lines: [
    line('context', '  const mode = settings.mode;', 10, 10),
    line('removed', '  return mode;', 11, null, [{ start: 9, end: 13 }]),
    line('added', '  return theme;', null, 11, [{ start: 9, end: 14 }]),
    line('context', '}', 12, 12),
  ],
};

/** Dos quitadas y una puesta: el hueco cae a la derecha. */
const uneven: Hunk = {
  id: 'hunk-2',
  oldStart: 40,
  oldLines: 4,
  newStart: 39,
  newLines: 3,
  header: '',
  lines: [
    line('context', 'antes', 40, 39),
    line('removed', 'uno', 41, null),
    line('removed', 'dos', 42, null),
    line('added', 'uno y dos', null, 40),
    line('context', 'después', 43, 41),
  ],
};

describe('la columna única', () => {
  const column = unifiedColumn(hunkBlocks([simple])[0]?.rows ?? []);

  it('intercala los signos delante del texto', () => {
    expect(column.text.split('\n')).toEqual([
      '   const mode = settings.mode;',
      '-  return mode;',
      '+  return theme;',
      ' }',
    ]);
  });

  it('rotula cada línea con el número de la versión que la tiene', () => {
    expect(column.labels).toEqual(['10', '11', '11', '12']);
  });

  it('tiñe solo lo que cambió', () => {
    expect(column.marks).toEqual([
      { line: 2, tone: 'removed' },
      { line: 3, tone: 'added' },
    ]);
  });

  it('corre el resaltado de palabra un carácter, que es lo que ocupa el signo', () => {
    expect(column.words).toEqual([
      { line: 2, start: 10, end: 14, tone: 'removed' },
      { line: 3, start: 10, end: 15, tone: 'added' },
    ]);
  });
});

describe('los diffs históricos', () => {
  it('consolida sus hunks con cabeceras y la misma separación de las marcas', () => {
    const rows = historicalRows(hunkBlocks([simple, uneven]));

    expect(rows.filter((row) => row.kind === 'padding')).toHaveLength(4);
    expect(rows[0]?.text).toBe('@@ -10,3 +10,3 @@ export function resolveTheme() {');
    expect(rows[simple.lines.length + HEADER_ROWS]?.text).toBe('@@ -40,4 +39,3 @@');
    expect(rows).toHaveLength(simple.lines.length + uneven.lines.length + HEADER_ROWS * 2);
  });
});

describe('las dos columnas', () => {
  it('ponen enfrente lo quitado y lo puesto', () => {
    const { left, right } = splitRows(hunkBlocks([simple])[0]?.rows ?? []);

    expect(left.map((row) => row.text)).toEqual([
      '  const mode = settings.mode;',
      '  return mode;',
      '}',
    ]);
    expect(right.map((row) => row.text)).toEqual([
      '  const mode = settings.mode;',
      '  return theme;',
      '}',
    ]);
  });

  it('rellenan el lado corto para que las dos midan lo mismo', () => {
    const { left, right } = splitRows(hunkBlocks([uneven])[0]?.rows ?? []);

    expect(left).toHaveLength(right.length);
    expect(right.map((row) => row.kind)).toEqual(['context', 'added', 'padding', 'context']);
    expect(oldColumn(left).labels).toEqual(['40', '41', '42', '43']);
    expect(newColumn(right).labels).toEqual(['39', '40', '', '41']);
  });

  it('no corren el resaltado: sin signo delante, el tramo es el del dominio', () => {
    const { left, right } = splitRows(hunkBlocks([simple])[0]?.rows ?? []);

    expect(oldColumn(left).words).toEqual([{ line: 2, start: 9, end: 13, tone: 'removed' }]);
    expect(newColumn(right).words).toEqual([{ line: 2, start: 9, end: 14, tone: 'added' }]);
  });

  it('cada lado solo tiñe lo suyo', () => {
    const { left, right } = splitRows(hunkBlocks([simple])[0]?.rows ?? []);

    expect(oldColumn(left).marks).toEqual([{ line: 2, tone: 'removed' }]);
    expect(newColumn(right).marks).toEqual([{ line: 2, tone: 'added' }]);
  });
});

/** Un archivo de catorce líneas con el hunk de arriba en su sitio. */
const fileLines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];

/** Quita dos líneas y pone una: la numeración se separa a partir de aquí. */
const shrink: Hunk = {
  id: 'hunk-3',
  oldStart: 3,
  oldLines: 3,
  newStart: 3,
  newLines: 2,
  header: '',
  lines: [
    line('context', 'c', 3, 3),
    line('removed', 'd', 4, null),
    line('removed', 'e', 5, null),
    line('added', 'de', null, 4),
  ],
};

describe('el archivo completo', () => {
  it('intercala el contexto de fuera con los hunks, sin saltarse ni repetir líneas', () => {
    const blocks = fileBlocks(fileLines, [simple]);

    expect(blocks.map((block) => block.hunk?.id ?? 'contexto')).toEqual([
      'contexto',
      'hunk-1',
      'contexto',
    ]);

    const covered = blocks.flatMap((block) =>
      block.rows.flatMap((row) => (row.newLine === null ? [] : [row.newLine])),
    );

    expect(covered).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('arrastra la diferencia entre las dos numeraciones después de un hunk', () => {
    const blocks = fileBlocks(fileLines, [shrink]);
    const last = blocks[blocks.length - 1];

    // El hunk quita una línea de más de las que pone, así que de ahí en adelante
    // la versión anterior va un número por delante.
    expect(last?.hunk).toBeNull();
    expect(last?.rows[0]).toMatchObject({ newLine: 5, oldLine: 6, text: 'e' });
  });

  it('sin hunks es un solo bloque de contexto, que es un archivo sin tocar', () => {
    const blocks = fileBlocks(fileLines, []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.hunk).toBeNull();
  });

  /*
   * La tira continua es lo que monta el visor de «archivo completo» en un solo
   * editor. Que diga exactamente lo mismo que los bloques es lo que garantiza
   * que partir o no partir sea una decisión de pintado y no dos lecturas
   * distintas del mismo archivo.
   */
  it('la tira continua es la concatenación de los bloques, fila por fila', () => {
    for (const hunks of [[simple], [shrink], [simple, uneven], []]) {
      expect(fileRows(fileLines, hunks)).toEqual(
        fileBlocks(fileLines, hunks).flatMap((block) => [...block.rows]),
      );
    }
  });

  it('recorre el archivo entero sin saltarse ni repetir una línea', () => {
    const covered = fileRows(fileLines, [simple]).flatMap((row) =>
      row.newLine === null ? [] : [row.newLine],
    );

    expect(covered).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  /*
   * Con una sola tira, una selección que empieza en un hunk y termina en otro
   * prepara los dos de una vez. Partida en bloques ni siquiera se podía marcar:
   * el arrastre se paraba en el borde de su editor.
   */
  it('una selección que cruza dos hunks prepara lo cambiado de los dos', () => {
    const rows = fileRows(fileLines, [simple, uneven]);
    const expected: LineRef[] = [];

    for (const row of rows) {
      if (row.kind === 'added' && row.newLine !== null)
        expected.push({ side: 'new', line: row.newLine });
      if (row.kind === 'removed' && row.oldLine !== null)
        expected.push({ side: 'old', line: row.oldLine });
    }

    expect(stageableLines(rows, 1, rows.length)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(1);
  });
});

describe('el stage por línea', () => {
  const rows = hunkBlocks([simple])[0]?.rows ?? [];

  it('prepara una modificación completa desde cualquiera de sus columnas', () => {
    const { left, right } = splitRows(rows);
    expect(stageableLines(right, 1, right.length, left)).toEqual([
      { side: 'old', line: 11 },
      { side: 'new', line: 11 },
    ]);
    expect(stageableLines(left, 1, left.length, right)).toEqual([
      { side: 'new', line: 11 },
      { side: 'old', line: 11 },
    ]);
  });

  it('devuelve lo añadido y lo eliminado como LineRef', () => {
    expect(stageableLines(rows, 1, 4)).toEqual([
      { side: 'old', line: 11 },
      { side: 'new', line: 11 },
    ]);
  });

  it('una selección de puro contexto no prepara nada', () => {
    expect(stageableLines(rows, 1, 1)).toEqual([]);
  });

  it('aguanta un rango del revés y uno que se sale', () => {
    expect(stageableLines(rows, 4, 1)).toEqual([
      { side: 'old', line: 11 },
      { side: 'new', line: 11 },
    ]);
    expect(stageableLines(rows, -5, 900)).toEqual([
      { side: 'old', line: 11 },
      { side: 'new', line: 11 },
    ]);
  });
});

describe('las marcas de la barra', () => {
  it('reserva sitio para cabeceras y contexto, pero solo marca las líneas modificadas', () => {
    const blocks = hunkBlocks([simple, uneven]);
    const { markers, total } = hunkMarkers(
      blocks,
      'changed',
      (block) => `Hunk ${String(block.number)}`,
    );

    expect(total).toBe(HEADER_ROWS * 2 + 4 + 5);
    expect(markers).toEqual([
      {
        id: 'hunk-1-change-1',
        from: HEADER_ROWS + 1,
        to: HEADER_ROWS + 3,
        tone: 'changed',
        label: 'Hunk 1',
      },
      {
        id: 'hunk-2-change-1',
        from: HEADER_ROWS * 2 + 5,
        to: HEADER_ROWS * 2 + 8,
        tone: 'changed',
        label: 'Hunk 2',
      },
    ]);
  });

  it('el contexto del archivo completo empuja las marcas pero no pone ninguna', () => {
    const blocks = fileBlocks(fileLines, [simple]);
    const { markers } = hunkMarkers(blocks, 'added', () => 'Hunk', false);

    expect(markers).toHaveLength(1);
    // Nueve líneas antes del hunk y una de contexto dentro de él.
    expect(markers[0]).toMatchObject({ from: 10, to: 12 });
  });

  it('permite calcular el tono de cada tramo por sus líneas modificadas', () => {
    const blocks = hunkBlocks([simple, uneven]);
    const { markers } = hunkMarkers(
      blocks,
      (_block, changedRows) => {
        const added = changedRows.some((row) => row.kind === 'added');
        const removed = changedRows.some((row) => row.kind === 'removed');

        return added && removed ? 'mixed' : added ? 'added' : 'removed';
      },
      () => 'Hunk',
    );

    expect(markers.map((marker) => marker.tone)).toEqual(['mixed', 'mixed']);
  });

  it('separa dos cambios del mismo hunk cuando hay contexto entre ellos', () => {
    const separated: Hunk = {
      ...simple,
      id: 'hunk-separated',
      lines: [
        line('added', 'primero', null, 10),
        line('context', 'sin cambios', 10, 11),
        line('removed', 'segundo', 11, null),
      ],
    };
    const { markers } = hunkMarkers(hunkBlocks([separated]), 'changed', () => 'Hunk');

    expect(markers).toEqual([
      {
        id: 'hunk-separated-change-1',
        from: HEADER_ROWS,
        to: HEADER_ROWS + 1,
        tone: 'changed',
        label: 'Hunk',
      },
      {
        id: 'hunk-separated-change-2',
        from: HEADER_ROWS + 2,
        to: HEADER_ROWS + 3,
        tone: 'changed',
        label: 'Hunk',
      },
    ]);
  });
});

describe('el rótulo del origen', () => {
  it('nombra los cuatro, y los dos que son commits los dicen con su SHA corto', () => {
    expect(sourceLabel({ kind: 'worktree' }, t)).toBe('Árbol de trabajo');
    expect(sourceLabel({ kind: 'index' }, t)).toBe('Staging');
    expect(sourceLabel({ kind: 'commit', sha: 'a1b2c3d4e5' }, t)).toBe('En el commit a1b2c3d');
    expect(sourceLabel({ kind: 'stash', sha: 'a1b2c3d4e5' }, t)).toBe('En el stash a1b2c3d');
    expect(sourceLabel({ kind: 'range', from: 'a1b2c3d4e5', to: 'f6g7h8i9j0' }, t)).toBe(
      'De a1b2c3d a f6g7h8i',
    );
    expect(sourceLabel({ kind: 'range', from: null, to: 'f6g7h8i9j0' }, t)).toBe(
      'Desde el inicio hasta f6g7h8i',
    );
    expect(sourceLabel({ kind: 'workingRange', from: 'a1b2c3d4e5' }, t)).toBe('De a1b2c3d al WIP');
  });
});

describe('documento continuo del WIP', () => {
  it('mantiene anclas por hunk en ambas columnas y excluye cabeceras del staging', () => {
    const blocks = hunkBlocks([simple, uneven]);
    const rows = workingRows(blocks);
    const anchors = new Set(rows.filter((row) => row.kind === 'padding'));
    const sides = splitRows(rows);
    expect(anchors.size).toBe(2);
    expect(sides.left.filter((row) => anchors.has(row))).toHaveLength(2);
    expect(sides.right.filter((row) => anchors.has(row))).toHaveLength(2);
    expect(stageableLines(rows, 1, rows.length)).toEqual(
      stageableLines(
        blocks.flatMap((block) => [...block.rows]),
        1,
        rows.length,
      ),
    );
  });
});

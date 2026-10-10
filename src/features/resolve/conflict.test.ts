import { describe, expect, it } from 'vitest';

import {
  assemble,
  applyEditorChange,
  editedBlockText,
  buildBlocks,
  conflictBlocks,
  diffLines,
  lineChoicesForRange,
  pendingBlocks,
  toLines,
  type Choices,
  type SideChoice,
} from './conflict';

const BASE = 'uno\ndos\ntres\ncuatro\n';

function choices(entries: Record<string, readonly SideChoice[]>): Choices {
  return new Map(Object.entries(entries));
}

describe('diff de dos vías', () => {
  it('dos textos iguales no tienen ningún cambio', () => {
    const edits = diffLines(toLines(BASE), toLines(BASE));

    expect(edits.every((edit) => edit.kind === 'same')).toBe(true);
    expect(edits).toHaveLength(4);
  });

  it('una línea cambiada sale como una fuera y una dentro', () => {
    const edits = diffLines(toLines(BASE), toLines('uno\nDOS\ntres\ncuatro\n'));

    expect(edits.filter((edit) => edit.kind === 'removed').map((edit) => edit.line)).toEqual([
      'dos',
    ]);
    expect(edits.filter((edit) => edit.kind === 'added').map((edit) => edit.line)).toEqual(['DOS']);
  });

  it('reconstruye el texto de después con lo que no quitó', () => {
    const after = 'uno\ndos y medio\ntres\ncinco\nseis\n';
    const edits = diffLines(toLines(BASE), toLines(after));
    const rebuilt = edits
      .filter((edit) => edit.kind !== 'removed')
      .map((edit) => edit.line)
      .join('\n');

    expect(`${rebuilt}\n`).toBe(after);
  });

  it('un archivo vacío contra otro con contenido es todo añadido', () => {
    expect(diffLines([], toLines(BASE)).every((edit) => edit.kind === 'added')).toBe(true);
  });
});

describe('bloques de un conflicto', () => {
  it('sin base, un solo bloque con los dos lados enteros', () => {
    const blocks = buildBlocks(null, 'nuestro\n', 'suyo\n');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conflict');
    expect(blocks[0]?.ours).toEqual(['nuestro']);
    expect(blocks[0]?.theirs).toEqual(['suyo']);
  });

  it('lo que los dos lados dejaron igual es contexto', () => {
    const blocks = buildBlocks(BASE, 'uno\nDOS\ntres\ncuatro\n', 'uno\ndos!\ntres\ncuatro\n');
    const context = blocks.filter((block) => block.kind === 'context');

    expect(context.flatMap((block) => block.ours)).toEqual(['uno', 'tres', 'cuatro']);
  });

  it('lo que cada lado tocó sale como un bloque en conflicto con sus dos versiones', () => {
    const blocks = buildBlocks(BASE, 'uno\nDOS\ntres\ncuatro\n', 'uno\ndos!\ntres\ncuatro\n');
    const conflicts = conflictBlocks(blocks);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.ours).toEqual(['DOS']);
    expect(conflicts[0]?.theirs).toEqual(['dos!']);
  });

  it('un archivo sin conflictos de verdad no pide ninguna decisión', () => {
    const blocks = buildBlocks(BASE, BASE, BASE);

    expect(conflictBlocks(blocks)).toHaveLength(0);
    expect(pendingBlocks(blocks, new Map())).toBe(0);
  });
});

describe('ensamblado del resultado', () => {
  const blocks = buildBlocks(BASE, 'uno\nDOS\ntres\ncuatro\n', 'uno\ndos!\ntres\ncuatro\n');
  const conflict = conflictBlocks(blocks)[0];
  const id = conflict?.id ?? '';

  it('sin decidir nada, el bloque en conflicto no aporta líneas', () => {
    expect(assemble(blocks, new Map()).text).toBe('uno\ntres\ncuatro\n');
    expect(pendingBlocks(blocks, new Map())).toBe(1);
  });

  it('tomar un lado mete sus líneas y las marca con su origen', () => {
    const { text, origins } = assemble(blocks, choices({ [id]: ['theirs'] }));

    expect(text).toBe('uno\ndos!\ntres\ncuatro\n');
    expect(origins).toEqual(['context', 'theirs', 'context', 'context']);
  });

  it('tomar los dos lados los deja en el orden en que se tomaron', () => {
    expect(assemble(blocks, choices({ [id]: ['theirs', 'ours'] })).text).toBe(
      'uno\ndos!\nDOS\ntres\ncuatro\n',
    );
    expect(assemble(blocks, choices({ [id]: ['ours', 'theirs'] })).text).toBe(
      'uno\nDOS\ndos!\ntres\ncuatro\n',
    );
  });

  it('«sin contenido» es una decisión: cuenta como resuelto y no pone nada', () => {
    const taken = choices({ [id]: ['none'] });

    expect(assemble(blocks, taken).text).toBe('uno\ntres\ncuatro\n');
    expect(pendingBlocks(blocks, taken)).toBe(0);
  });

  it('agrega líneas concretas de cualquiera de los dos lados sin duplicar el contexto', () => {
    const selected = choices({ [id]: ['ours:0', 'theirs:0'] });
    const { text, origins } = assemble(blocks, selected);

    expect(text).toBe('uno\nDOS\ndos!\ntres\ncuatro\n');
    expect(origins).toEqual(['context', 'ours', 'theirs', 'context', 'context']);
    expect(pendingBlocks(blocks, selected)).toBe(0);
  });
});

describe('selección de líneas conflictivas', () => {
  it('traduce solo la intersección con conflictos y conserva cada bloque', () => {
    const blocks = buildBlocks(
      'uno\ndos\ntres\ncuatro\ncinco\n',
      'uno\nDOS\ntres\nCUATRO\ncinco\n',
      'uno\ndos!\ntres\ncuatro!\ncinco\n',
    );

    expect(lineChoicesForRange(blocks, 'ours', { from: 1, to: 5 })).toEqual([
      { blockId: 'c1', choices: ['ours:0'] },
      { blockId: 'c3', choices: ['ours:0'] },
    ]);
  });

  it('una selección fuera del conflicto no agrega líneas ya presentes como contexto', () => {
    const blocks = buildBlocks(BASE, 'uno\nDOS\ntres\ncuatro\n', 'uno\ndos!\ntres\ncuatro\n');

    expect(lineChoicesForRange(blocks, 'ours', { from: 3, to: 4 })).toEqual([]);
  });
});

describe('texto manual por bloque', () => {
  const blocks = buildBlocks('inicio\nbase\nfin\n', 'inicio\nA\nfin\n', 'inicio\nB\nfin\n');
  const id = conflictBlocks(blocks)[0]!.id;

  it('activar un hueco no resuelve hasta escribir y preserva el contexto', () => {
    const drafts = new Map([[id, { text: '', resolved: false }]]);
    const result = assemble(blocks, new Map(), drafts);
    expect(result.text).toBe('inicio\n\nfin\n');
    expect(pendingBlocks(blocks, new Map(), drafts)).toBe(1);
    expect(editedBlockText(result, 'inicio\nsolución\nsegunda línea\nfin\n')).toEqual({
      id,
      text: 'solución\nsegunda línea',
    });
    expect(editedBlockText(result, 'contexto modificado\n\nfin\n')).toBeNull();
  });

  it('conserva texto manual al añadir y quitar A y B, sin resolver otros conflictos', () => {
    const drafts = new Map([[id, { text: 'solución', resolved: true }]]);
    expect(pendingBlocks(blocks, new Map(), drafts)).toBe(0);
    const other = { ...conflictBlocks(blocks)[0]!, id: 'another' };
    expect(pendingBlocks([...blocks, other], new Map(), drafts)).toBe(1);
    expect(assemble(blocks, choices({ [id]: ['ours', 'theirs'] }), drafts).text).toBe(
      'inicio\nsolución\nA\nB\nfin\n',
    );
    expect(assemble(blocks, new Map(), drafts).text).toBe('inicio\nsolución\nfin\n');
  });
});

describe('integridad de las tres versiones', () => {
  function verify(base: string, ours: string, theirs: string) {
    const blocks = buildBlocks(base, ours, theirs);
    for (const [side, original] of [
      ['ours', ours],
      ['theirs', theirs],
    ] as const) {
      const lines = toLines(original);
      expect(blocks.flatMap((block) => block[side])).toEqual(lines);
      let nextLine = 1;
      for (const block of blocks) {
        const start = side === 'ours' ? block.oursLine : block.theirsLine;
        expect(start).toBe(nextLine);
        expect(lines.slice(start - 1, start - 1 + block[side].length)).toEqual(block[side]);
        nextLine += block[side].length;
      }
      expect(
        blocks.map((block) => (side === 'ours' ? block.oursText : block.theirsText)).join(''),
      ).toBe(original);
    }
    return blocks;
  }

  it.each([
    ['', 'nuevo\n', 'otro\n'],
    ['base\n', 'antes\nbase\n', 'base\n'],
    ['base\n', 'base\ndespués\n', 'base\n'],
    ['uno\ndos\n', 'uno\ninserción\ndos\n', 'uno\ndos\n'],
    ['uno\ndos\n', '', 'uno\notro\ndos\n'],
    ['base\n', 'igual\nbase\n', 'igual\nbase\n'],
  ])('conserva inserciones y eliminaciones: %j / %j / %j', (base, ours, theirs) => {
    verify(base, ours, theirs);
  });

  it('reconstruye ambos lados y sus coordenadas con líneas repetidas en 3375 combinaciones', () => {
    const variants = [''];
    for (let length = 1; length <= 3; length++) {
      for (let mask = 0; mask < 2 ** length; mask++) {
        variants.push(
          Array.from({ length }, (_, bit) => (mask & (1 << bit) ? 'repetida' : '')).join('\n') +
            '\n',
        );
      }
    }
    for (const base of variants)
      for (const ours of variants) for (const theirs of variants) verify(base, ours, theirs);
  });

  it('conserva las 360/220 líneas del caso asimétrico con 20 funciones', () => {
    const make = (body: string[]) =>
      Array.from(
        { length: 20 },
        (_, index) =>
          [
            '',
            '############################################',
            `Función ${index + 1}`,
            '############################################',
            '',
            ...body,
            '',
          ].join('\n') + '\n',
      ).join('');
    const base = make([
      'leerConfiguracion();',
      'abrirConexion();',
      'validarCredenciales();',
      'obtenerDatos();',
      'procesarDatos();',
      'cerrarConexion();',
    ]);
    const ours = make([
      '',
      'leerConfiguracion();',
      'inicializarCache();',
      'abrirConexion();',
      'validarCredenciales();',
      'registrarAuditoria();',
      'obtenerDatos();',
      'validarRespuesta();',
      'procesarDatos();',
      'guardarMetricas();',
      'cerrarConexion();',
      '',
    ]);
    const theirs = make(['', 'abrirConexion();', 'procesarDatos();', 'cerrarConexion();', '']);
    const blocks = verify(base, ours, theirs);
    expect(toLines(ours)).toHaveLength(360);
    expect(toLines(theirs)).toHaveLength(220);
    const metrics = blocks.filter((block) => block.ours.includes('guardarMetricas();'));
    expect(metrics).toHaveLength(20);
    expect(metrics.every((block) => block.kind === 'automatic')).toBe(true);
    expect(assemble(blocks, new Map()).text.match(/guardarMetricas/g)).toHaveLength(20);
    expect(conflictBlocks(blocks)).toHaveLength(40);
  });
});

describe('combinación respecto de la base', () => {
  it.each([
    ['a\nb\nc\n', 'a\nB\nc\n', 'a\nb\nc\n', 'a\nB\nc\n'],
    ['a\nb\nc\n', 'a\nb\nc\n', 'a\nc\n', 'a\nc\n'],
    ['a\nb\nc\n', 'a\nB\nc\n', 'a\nB\nc\n', 'a\nB\nc\n'],
    ['a\nb\nc\nd\ne\n', 'a\nB\nc\nd\ne\n', 'a\nb\nc\nD\ne\n', 'a\nB\nc\nD\ne\n'],
    ['base', 'cambio', 'base', 'cambio'],
    ['base\n', 'base', 'base\n', 'base'],
    ['base', 'base\n', 'base', 'base\n'],
    ['a\r\nb\r\n', 'A\r\nb\r\n', 'a\r\nb\r\n', 'A\r\nb\r\n'],
    ['', 'nuevo', '', 'nuevo'],
    ['base\n', '', '', ''],
  ])('integra automáticamente cambios compatibles (%j, %j, %j)', (base, ours, theirs, expected) => {
    const blocks = buildBlocks(base, ours, theirs);
    expect(pendingBlocks(blocks, new Map())).toBe(0);
    expect(assemble(blocks, new Map()).text).toBe(expected);
    expect(lineChoicesForRange(blocks, 'ours', { from: 1, to: 100 })).toEqual([]);
  });

  it.each([
    ['a\nb\nc\n', 'a\nB\nc\n', 'a\nc\n'],
    ['a\n', 'a\nA\n', 'a\nB\n'],
    ['', 'A', 'B'],
    [null, '', 'B'],
    ['base', 'A', 'B'],
  ])('pide decisión ante cambios incompatibles (%j, %j, %j)', (base, ours, theirs) => {
    const blocks = buildBlocks(base, ours, theirs);
    expect(conflictBlocks(blocks)).toHaveLength(1);
    for (const [side, text] of [
      ['ours', ours],
      ['theirs', theirs],
    ] as const) {
      const selected: Choices = new Map(conflictBlocks(blocks).map((block) => [block.id, [side]]));
      expect(assemble(blocks, selected).text).toBe(text);
      expect(pendingBlocks(blocks, selected)).toBe(0);
    }
  });

  it('dos lados sin salto final no se pegan en una sola línea al elegir ambos', () => {
    const blocks = buildBlocks('base', 'A', 'B');
    expect(assemble(blocks, choices({ [blocks[0]!.id]: ['ours', 'theirs'] })).text).toBe('A\nB');
  });

  it('dos creaciones idénticas se integran una sola vez', () => {
    const blocks = buildBlocks(null, 'igual\n', 'igual\n');
    expect(pendingBlocks(blocks, new Map())).toBe(0);
    expect(assemble(blocks, new Map()).text).toBe('igual\n');
  });
});

describe('edición y terminadores originales', () => {
  it('no convierte CRLF por abrir o volver a pintar el editor', () => {
    expect(applyEditorChange('a\r\nb\r\n', 'a\nb\n')).toBe('a\r\nb\r\n');
  });
  it('mantiene los terminadores mixtos fuera del tramo editado', () => {
    expect(applyEditorChange('a\r\nb\nc', 'a\nB\nC\nc')).toBe('a\r\nB\r\nC\nc');
  });
  it('editar el último carácter no añade un salto final', () => {
    expect(applyEditorChange('a\r\nb', 'a\nB')).toBe('a\r\nB');
  });
  it('permite continuar la edición manual de un bloque CRLF', () => {
    const blocks = buildBlocks('a\r\nbase\r\nz\r\n', 'a\r\nA\r\nz\r\n', 'a\r\nB\r\nz\r\n');
    const id = conflictBlocks(blocks)[0]!.id;
    const result = assemble(blocks, new Map(), new Map([[id, { text: '', resolved: false }]]));
    const edited = applyEditorChange(result.text, 'a\nmanual\nz\n');
    expect(editedBlockText(result, edited)).toEqual({ id, text: 'manual' });
  });
});

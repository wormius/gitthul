import { describe, expect, it } from 'vitest';

import { assemble, buildBlocks, conflictBlocks, diffLines } from './conflict';

function verify(before: readonly string[], after: readonly string[]) {
  const edits = diffLines(before, after);
  expect(edits.filter((edit) => edit.kind !== 'added').map((edit) => edit.line)).toEqual(before);
  expect(edits.filter((edit) => edit.kind !== 'removed').map((edit) => edit.line)).toEqual(after);
  return edits.filter((edit) => edit.kind === 'same').map((edit) => edit.line);
}

const section = (prefix: string, length = 1200) =>
  Array.from({ length }, (_, index) => `${prefix} ${index}`);

describe('alineado de Resolver con más de 2000 ediciones', () => {
  it('conserva una sección interior idéntica entre dos reescrituras grandes', () => {
    const common = section('contenido compartido', 200);
    expect(
      verify(
        [...section('antes'), ...common, ...section('final antes')],
        [...section('después'), ...common, ...section('final después')],
      ),
    ).toEqual(common);
  });

  it('separa varios cambios grandes conservando sus islas compartidas', () => {
    const first = section('primera sección intacta', 80);
    const second = section('segunda sección intacta', 80);
    expect(
      verify(
        [...section('a'), ...first, ...section('b'), ...second, ...section('c')],
        [...section('A'), ...first, ...section('B'), ...second, ...section('C')],
      ),
    ).toEqual([...first, ...second]);
  });

  it('conserva islas repetidas aunque no exista ninguna línea única compartida', () => {
    const common = Array<string>(150).fill('texto repetido\r\n');
    expect(
      verify(
        [...Array<string>(1200).fill('antes\r\n'), ...common, 'fin anterior'],
        [...Array<string>(1200).fill('después\r\n'), ...common, 'fin nuevo'],
      ),
    ).toEqual(common);
  });

  it('conserva bloques repetidos dentro de los intervalos entre anclas únicas', () => {
    const repeated = Array.from({ length: 100 }, () => ['{\n', '\n', '}\n']).flat();
    const common = ['función compartida\n', ...repeated, 'fin de función\n'];
    expect(
      verify(
        [...section('antes'), ...common, ...section('cola antes')],
        [...section('después'), ...common, ...section('cola después')],
      ),
    ).toEqual(common);
  });

  it('alinea inserciones y borrados muy asimétricos sin perder contenido', () => {
    expect(
      verify(
        [...section('anterior', 3500), 'isla\n', 'fin anterior'],
        ['inicio nuevo', 'isla\n', ...section('nuevo', 15)],
      ),
    ).toEqual(['isla\n']);
  });

  it('respeta orden y multiplicidad al reordenar secciones con repeticiones', () => {
    const before = [...section('antes'), 'A', '', 'B', '', 'C', ...section('cola antes')];
    const after = [...section('después'), 'C', '', 'A', '', 'B', ...section('cola después')];
    expect(verify(before, after)).toContain('A');
  });

  it('no inventa igualdad entre finales LF/CRLF, BOM o el último salto', () => {
    const exact = ['\uFEFFcabecera\r\n', 'línea\n', 'sin salto'];
    expect(
      verify(
        [...section('antes'), ...exact, 'LF\n', 'final\n', ...section('cola antes')],
        [...section('después'), ...exact, 'LF\r\n', 'final', ...section('cola después')],
      ),
    ).toEqual(exact);
  });

  it('dos archivos sin coincidencias siguen siendo borrado y añadido completos', () => {
    expect(verify(section('anterior', 3000), section('nuevo', 3000))).toEqual([]);
  });

  it('no convierte una edición unilateral grande en un conflicto con la otra rama', () => {
    const common = section('intacto', 100).map((line) => `${line}\n`);
    const original = [...section('base').map((line) => `${line}\n`), ...common, 'última línea'];
    const changed = [...section('nuevo').map((line) => `${line}\n`), ...common, 'última nueva'];
    const blocks = buildBlocks(original.join(''), changed.join(''), original.join(''));
    expect(conflictBlocks(blocks)).toHaveLength(0);
    expect(assemble(blocks, new Map()).text).toBe(changed.join(''));
    expect(
      blocks.filter((block) => block.kind === 'context').flatMap((block) => block.ours),
    ).toEqual(common.map((line) => line.slice(0, -1)));
  });
});

describe('fidelidad del diff en límites pequeños', () => {
  it.each([
    [[], []],
    [[], ['a']],
    [['a'], []],
    [['a'], ['a']],
    [['a'], ['b']],
    [['a', 'b'], ['b']],
    [['a'], ['b', 'a']],
  ])('reconstruye ambos extremos %j → %j', (before, after) => {
    verify(before, after);
  });

  it('reconstruye las parejas de secuencias cortas con líneas repetidas', () => {
    const variants: string[][] = [[]];
    for (let length = 1; length <= 5; length++) {
      for (let bits = 0; bits < 2 ** length; bits++) {
        variants.push(Array.from({ length }, (_, index) => (bits & (1 << index) ? 'a' : 'b')));
      }
    }
    for (const before of variants) for (const after of variants) verify(before, after);
  });
});

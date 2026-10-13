/**
 * Todo lo que el visor de diff decide sin un DOM ni CodeMirror montado — CU-5.
 *
 * `DiffViewer` recibe un `FileDiff` del puerto y tiene que producir, para cada
 * columna, cuatro cosas alineadas entre sí: el texto, los rótulos del margen,
 * los tonos de línea y los tramos de palabra. Esa traducción es aritmética de
 * números de línea, que es justo el tipo de cosa que se rompe en silencio y que
 * probar montando un editor sería probar CodeMirror. Aquí se prueba con
 * cadenas y números, como `graph.ts` con las calles.
 */

import { shortSha } from '@core/domain/commit';
import type { DiffLine, DiffSource, Hunk, WordSpan } from '@core/domain/diff';
import type { LineRef } from '@core/ports/GitPort';
import type { CodeLineMark, CodeWordMark } from '@ui/codeSurfaceUtils';
import type { MarkerTone, ScrollMarker } from '@ui/markerScrollbarUtils';

import type { Translate } from './contextMenus';

/**
 * Cómo se nombra de dónde sale el diff que se está leyendo.
 *
 * Aquí y no en la barra por la misma razón que los catorce menús viven en
 * `contextMenus.ts`: la redacción se prueba sin montar nada, y los cuatro
 * orígenes tienen que decirse igual en la barra, en el rótulo accesible y en
 * cualquier sitio que los nombre después.
 */
export function sourceLabel(source: DiffSource, t: Translate): string {
  switch (source.kind) {
    case 'worktree':
      return t('working.diff.source.worktree');
    case 'index':
      return t('working.diff.source.index');
    case 'commit':
      return t('working.diff.source.commit', { sha: shortSha(source.sha) });
    case 'range':
      if (source.from === null) {
        return t('working.diff.source.rangeFromRoot', { to: shortSha(source.to) });
      }
      return t('working.diff.source.range', {
        from: shortSha(source.from),
        to: shortSha(source.to),
      });
    case 'workingRange':
      return t('working.diff.source.workingRange', { from: shortSha(source.from) });
  }
}

export type DiffRowKind = 'context' | 'added' | 'removed' | 'padding';

/**
 * Una fila del visor, ya sin saber en qué columna acabará.
 *
 * El relleno (`padding`) solo existe en dos columnas: es el hueco que se pone
 * enfrente de una línea que el otro lado no tiene, y sin él las dos columnas se
 * irían desalineando una línea por cada cambio.
 */
export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  words: readonly WordSpan[];
}

/**
 * Un tramo del visor: un hunk con su cabecera, o el contexto que va entre dos.
 *
 * En «solo los hunks» todos los bloques tienen hunk; en «archivo completo» se
 * intercalan los que no lo tienen, que son las partes del archivo que nadie
 * tocó y que por eso no ofrecen ni cabecera ni botón de stage.
 */
export interface DiffBlock {
  key: string;
  hunk: Hunk | null;
  /** El número de hunk que se enseña, contando desde 1. `0` si no es un hunk. */
  number: number;
  rows: readonly DiffRow[];
}

/** Lo que una columna le pasa a `CodeSurface`, todo del mismo largo. */
export interface DiffColumn {
  text: string;
  labels: readonly string[];
  marks: readonly CodeLineMark[];
  words: readonly CodeWordMark[];
  rows: readonly DiffRow[];
}

/** Con qué se marca cada tipo de línea en la columna única. */
const PREFIX: Record<DiffRowKind, string> = {
  context: ' ',
  added: '+',
  removed: '-',
  padding: '',
};

/**
 * Cuánto ocupa la cabecera de un hunk, medido en filas de código.
 *
 * Las marcas de la barra se calculan en filas y no en píxeles: en filas la
 * cuenta es pura y se prueba sin layout, y a cambio hay que declarar cuánto
 * mide lo que no es una fila. La cabecera es un renglón de texto con su aire,
 * así que cuenta como dos.
 */
export const HEADER_ROWS = 2;

function rowOf(line: DiffLine): DiffRow {
  return {
    kind: line.kind,
    text: line.text,
    oldLine: line.oldLine,
    newLine: line.newLine,
    words: line.words ?? [],
  };
}

/** Las filas de un hunk, en el orden en el que git las escribió. */
export function hunkRows(hunk: Hunk): readonly DiffRow[] {
  return hunk.lines.map(rowOf);
}

/** Un bloque por hunk: lo que se enseña con «solo los hunks». */
export function hunkBlocks(hunks: readonly Hunk[]): readonly DiffBlock[] {
  return hunks.map((hunk, index) => ({
    key: hunk.id,
    hunk,
    number: index + 1,
    rows: hunkRows(hunk),
  }));
}

/**
 * Une hunks históricos en un solo documento barato de montar.
 *
 * Los diffs de commit y rango son de solo lectura: no necesitan un editor por
 * hunk para alojar acciones de stage. Se conservan dos filas por cabecera —la
 * misma altura lógica que usa `hunkMarkers`— para que las marcas sigan cayendo
 * sobre el tramo correcto y para que hunks separados no parezcan contiguos.
 */
export function historicalRows(blocks: readonly DiffBlock[]): readonly DiffRow[] {
  return blocks.flatMap((block) => {
    const hunk = block.hunk;

    if (hunk === null) return block.rows;

    const range = `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`;
    const header: DiffRow = {
      kind: 'padding',
      text: hunk.header === '' ? range : `${range} ${hunk.header}`,
      oldLine: null,
      newLine: null,
      words: [],
    };
    const spacer: DiffRow = {
      kind: 'padding',
      text: '',
      oldLine: null,
      newLine: null,
      words: [],
    };

    return [header, spacer, ...block.rows];
  });
}

/** Una fila de anclaje por cabecera; las acciones se dibujan dentro del editor. */
export function workingRows(blocks: readonly DiffBlock[]): readonly DiffRow[] {
  return blocks.flatMap((block) => [
    { kind: 'padding' as const, text: '', oldLine: null, newLine: null, words: [] },
    ...block.rows,
  ]);
}

/**
 * El archivo entero, con sus hunks en su sitio — «archivo completo».
 *
 * Lo que el puerto da es la versión **nueva** del archivo y los hunks; lo de
 * fuera de un hunk es idéntico en las dos versiones, así que se pinta como
 * contexto y su número de línea anterior sale de la diferencia que arrastran
 * los hunks vistos hasta ahí. Reconstruir la versión anterior entera no hace
 * falta y sería inventar: dentro de cada hunk ya viene línea por línea.
 */
export function fileBlocks(
  fileLines: readonly string[],
  hunks: readonly Hunk[],
): readonly DiffBlock[] {
  const blocks: DiffBlock[] = [];

  walkFile(fileLines, hunks, {
    context: (from, rows) => {
      blocks.push({ key: `context-${String(from)}`, hunk: null, number: 0, rows });
    },
    hunk: (hunk, number, rows) => {
      blocks.push({ key: hunk.id, hunk, number, rows });
    },
  });

  return blocks;
}

/**
 * El archivo entero como **una sola tira de filas** — «archivo completo».
 *
 * Es lo mismo que `fileBlocks` recorre, sin partirlo: contexto y filas de hunk
 * seguidas, en el orden del archivo. Lo pide el visor continuo, que monta un
 * único editor para todo el archivo en vez de uno por tramo — con uno por
 * tramo la selección no puede cruzar de un tramo al siguiente, porque cada
 * editor tiene la suya y ninguno se entera de los demás.
 */
export function fileRows(fileLines: readonly string[], hunks: readonly Hunk[]): readonly DiffRow[] {
  const rows: DiffRow[] = [];

  walkFile(fileLines, hunks, {
    context: (_from, block) => rows.push(...block),
    hunk: (_hunk, _number, block) => rows.push(...block),
  });

  return rows;
}

/**
 * El recorrido que comparten las dos formas de leer el archivo completo.
 *
 * Lo que el puerto da es la versión **nueva** del archivo y los hunks; lo de
 * fuera de un hunk es idéntico en las dos versiones, así que se pinta como
 * contexto y su número de línea anterior sale de la diferencia que arrastran
 * los hunks vistos hasta ahí. Reconstruir la versión anterior entera no hace
 * falta y sería inventar: dentro de cada hunk ya viene línea por línea.
 */
function walkFile(
  fileLines: readonly string[],
  hunks: readonly Hunk[],
  visit: {
    context: (from: number, rows: readonly DiffRow[]) => void;
    hunk: (hunk: Hunk, number: number, rows: readonly DiffRow[]) => void;
  },
): void {
  const ordered = [...hunks].sort((a, b) => a.newStart - b.newStart);

  let cursor = 1;
  let delta = 0;
  let number = 0;

  const context = (from: number, to: number) => {
    if (to < from) return;

    const rows: DiffRow[] = [];

    for (let line = from; line <= to; line += 1) {
      rows.push({
        kind: 'context',
        text: fileLines[line - 1] ?? '',
        oldLine: line + delta,
        newLine: line,
        words: [],
      });
    }

    visit.context(from, rows);
  };

  for (const hunk of ordered) {
    context(cursor, hunk.newStart - 1);
    number += 1;
    visit.hunk(hunk, number, hunkRows(hunk));

    // Un archivo eliminado usa el rango nuevo `-0,0`. La siguiente posición
    // válida sigue siendo 1; dejar el cursor en 0 fabricaba una línea de
    // contexto inexistente al final del documento.
    cursor = Math.max(1, hunk.newStart + hunk.newLines);
    delta = hunk.oldStart + hunk.oldLines - cursor;
  }

  context(cursor, fileLines.length);
}

/**
 * Reparte las filas en las dos columnas, emparejando lo quitado con lo puesto.
 *
 * Un tramo de tres líneas quitadas y dos puestas deja un hueco a la derecha; al
 * revés, uno a la izquierda. Es lo que hace que la línea de enfrente sea de
 * verdad la de enfrente, que es de lo único que sirven dos columnas.
 */
export function splitRows(rows: readonly DiffRow[]): {
  left: readonly DiffRow[];
  right: readonly DiffRow[];
} {
  const left: DiffRow[] = [];
  const right: DiffRow[] = [];
  const blank: DiffRow = { kind: 'padding', text: '', oldLine: null, newLine: null, words: [] };

  let index = 0;

  while (index < rows.length) {
    const row = rows[index];

    if (!row) break;

    if (row.kind === 'context' || row.kind === 'padding') {
      left.push(row);
      right.push(row);
      index += 1;
      continue;
    }

    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];

    while (rows[index]?.kind === 'removed') {
      removed.push(rows[index] as DiffRow);
      index += 1;
    }

    while (rows[index]?.kind === 'added') {
      added.push(rows[index] as DiffRow);
      index += 1;
    }

    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      left.push(removed[pair] ?? blank);
      right.push(added[pair] ?? blank);
    }
  }

  return { left, right };
}

/**
 * Arma una columna.
 *
 * `prefixed` es la columna única, la que lleva `+` y `-` delante del texto; con
 * ella todo lo que apunte dentro de una línea —los tramos de palabra— se corre
 * un carácter, que es el error clásico de un visor de diff a una columna.
 */
function columnOf(
  rows: readonly DiffRow[],
  label: (row: DiffRow) => string,
  prefixed: boolean,
  keep: (row: DiffRow) => 'added' | 'removed' | null,
): DiffColumn {
  const marks: CodeLineMark[] = [];
  const words: CodeWordMark[] = [];
  const offset = prefixed ? 1 : 0;

  rows.forEach((row, index) => {
    const tone = keep(row);

    if (tone === null) return;

    marks.push({ line: index + 1, tone });

    for (const span of row.words) {
      words.push({ line: index + 1, start: span.start + offset, end: span.end + offset, tone });
    }
  });

  return {
    text: rows.map((row) => (prefixed ? PREFIX[row.kind] : '') + row.text).join('\n'),
    labels: rows.map(label),
    marks,
    words,
    rows,
  };
}

/** La columna única: `+` y `-` intercalados, con el número de la versión que exista. */
export function unifiedColumn(rows: readonly DiffRow[]): DiffColumn {
  return columnOf(
    rows,
    (row) => numberOf(row.newLine ?? row.oldLine),
    true,
    (row) => (row.kind === 'added' ? 'added' : row.kind === 'removed' ? 'removed' : null),
  );
}

/** La columna izquierda de dos: la versión anterior. */
export function oldColumn(rows: readonly DiffRow[]): DiffColumn {
  return columnOf(
    rows,
    (row) => numberOf(row.oldLine),
    false,
    (row) => (row.kind === 'removed' ? 'removed' : null),
  );
}

/** La columna derecha de dos: la versión nueva. */
export function newColumn(rows: readonly DiffRow[]): DiffColumn {
  return columnOf(
    rows,
    (row) => numberOf(row.newLine),
    false,
    (row) => (row.kind === 'added' ? 'added' : null),
  );
}

function numberOf(line: number | null): string {
  return line === null ? '' : String(line);
}

/**
 * Qué líneas de un rango de filas se pueden preparar.
 *
 * Devuelve una referencia por cada línea modificada de la selección: las
 * añadidas con `side: 'new'` y su `newLine`, las eliminadas con `side: 'old'`
 * y su `oldLine`. En dos columnas, una fila modificada incluye su pareja:
 * preparar la versión nueva también retira la anterior, sin duplicar texto.
 */
export function stageableLines(
  rows: readonly DiffRow[],
  from: number,
  to: number,
  counterpart?: readonly DiffRow[],
): readonly LineRef[] {
  const low = Math.max(1, Math.min(from, to));
  const high = Math.min(rows.length, Math.max(from, to));
  const lines: LineRef[] = [];

  for (let index = low; index <= high; index += 1) {
    const row = rows[index - 1];
    if (!row || (row.kind !== 'added' && row.kind !== 'removed')) continue;
    for (const selected of [counterpart?.[index - 1], row]) {
      if (selected?.kind === 'added' && selected.newLine !== null) {
        lines.push({ side: 'new', line: selected.newLine });
      }
      if (selected?.kind === 'removed' && selected.oldLine !== null) {
        lines.push({ side: 'old', line: selected.oldLine });
      }
    }
  }

  return lines;
}

export interface HunkMarkers {
  markers: readonly ScrollMarker[];
  /** Cuántas filas mide el visor entero, contando las cabeceras. */
  total: number;
}

/**
 * Una marca por cada tramo contiguo de líneas modificadas.
 *
 * Un hunk contiene también cabecera y contexto. Pintarlo entero hacía que
 * hunks cercanos se fundieran en una franja casi continua, aunque entre los
 * cambios hubiera muchas líneas intactas. Las cabeceras y el contexto sí se
 * cuentan para conservar la escala del documento, pero quedan transparentes.
 *
 * Se cuenta en filas y no en píxeles porque así la cuenta es pura: el visor
 * apila renglones de la misma altura, y una cabecera vale lo que dice
 * `HEADER_ROWS`. Un contenedor con scroll traduce después esas filas a su propio
 * alto, que es lo mismo que hace `MarkerScrollbar` con cualquier otra unidad.
 */
export function hunkMarkers(
  blocks: readonly DiffBlock[],
  tone: MarkerTone | ((block: DiffBlock, rows: readonly DiffRow[]) => MarkerTone),
  label: (block: DiffBlock, rows: readonly DiffRow[]) => string,
  /**
   * Si cada hunk lleva su cabecera delante, que ocupa `HEADER_ROWS`.
   *
   * En «archivo completo» no la lleva —el archivo se lee corrido—, y contarla
   * correría las marcas dos filas por cada hunk anterior.
   */
  headers = true,
): HunkMarkers {
  const markers: ScrollMarker[] = [];

  let offset = 0;

  for (const block of blocks) {
    if (block.hunk === null) {
      offset += block.rows.length;
      continue;
    }

    offset += headers ? HEADER_ROWS : 0;

    let change = 0;
    let row = 0;

    while (row < block.rows.length) {
      const current = block.rows[row];

      if (current?.kind !== 'added' && current?.kind !== 'removed') {
        offset += 1;
        row += 1;
        continue;
      }

      const from = offset;
      const changedRows: DiffRow[] = [];

      while (row < block.rows.length) {
        const changed = block.rows[row];

        if (changed?.kind !== 'added' && changed?.kind !== 'removed') break;

        changedRows.push(changed);
        offset += 1;
        row += 1;
      }

      change += 1;
      markers.push({
        id: `${block.key}-change-${String(change)}`,
        from,
        to: offset,
        tone: typeof tone === 'function' ? tone(block, changedRows) : tone,
        label: label(block, changedRows),
      });
    }
  }

  return { markers, total: offset };
}

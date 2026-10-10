import type { DiffLine, Hunk, WordSpan } from '@core/domain/diff';

import { createRandom, seedFrom, type Random } from '../random';

/**
 * Contenido de archivo inventado, pero coherente consigo mismo.
 *
 * La clave es que el archivo completo y su diff salgan de la misma fuente: el
 * visor de F2.6 alterna entre «ver el diff» y «ver el archivo», y si cada modo
 * inventara su texto por separado los números de línea no cuadrarían y el
 * componente parecería roto cuando el roto sería el dato. Aquí el archivo
 * anterior se genera de la ruta, la versión nueva se obtiene aplicándole unas
 * ediciones, y los hunks se deducen de esas ediciones — nunca se comparan dos
 * textos a ciegas.
 */

const IDENTIFIERS = [
  'branch',
  'commit',
  'lane',
  'node',
  'hunk',
  'stash',
  'ref',
  'tab',
  'pane',
  'row',
  'token',
  'gesture',
];

const TS_TEMPLATES = [
  'export function {name}({arg}: {Type}): {Type} {',
  '  const {name} = use{Type}();',
  '  if (!{name}) return null;',
  '  return {name}.map((item) => item.{arg});',
  '}',
  '',
  'interface {Type}Props {',
  '  {arg}: readonly {Type}[];',
  '  onSelect?: (id: string) => void;',
  '}',
  '',
  '// El registro central decide el rótulo; aquí solo se dispara.',
  'const {name} = createRegistry({ {arg} });',
];

const CSS_TEMPLATES = [
  '.{name} {',
  '  display: flex;',
  '  gap: var(--space-2);',
  '  color: var(--text-primary);',
  '  background: var(--surface-raised);',
  '  border-radius: var(--radius-sm);',
  '}',
  '',
  '.{name}:hover {',
  '  outline: 1px solid var(--border-strong);',
  '}',
];

const RUST_TEMPLATES = [
  'pub fn read_{name}(repo: &Repository) -> Result<Vec<{Type}>, GitError> {',
  '    let mut out = Vec::new();',
  '    for {name} in repo.{name}s()? {',
  '        out.push({Type}::from({name}));',
  '    }',
  '    Ok(out)',
  '}',
  '',
  '#[derive(Debug, Serialize)]',
  'pub struct {Type} {',
  '    pub id: String,',
  '}',
];

const MARKDOWN_TEMPLATES = [
  '## {Type}',
  '',
  'La vista se arma con los primitivos ya probados: nada de inventar dentro de',
  'la vista. El {name} nombra siempre su rama.',
  '',
  '- `{name}` — pendiente',
  '- `{Type}` — hecho',
  '',
];

function templatesFor(path: string): readonly string[] {
  if (path.endsWith('.css')) return CSS_TEMPLATES;
  if (path.endsWith('.rs')) return RUST_TEMPLATES;
  if (path.endsWith('.md')) return MARKDOWN_TEMPLATES;

  return TS_TEMPLATES;
}

function fill(template: string, random: Random): string {
  const name = random.pick(IDENTIFIERS);

  return template
    .replaceAll('{name}', name)
    .replaceAll('{Type}', name.charAt(0).toUpperCase() + name.slice(1))
    .replaceAll('{arg}', random.pick(IDENTIFIERS));
}

/** El archivo tal como estaba antes de los cambios que el diff cuenta. */
export function baseLines(path: string): readonly string[] {
  const random = createRandom(seedFrom(`archivo:${path}`));
  const templates = templatesFor(path);
  const total = random.int(40, 120);
  const lines: string[] = [];

  while (lines.length < total) lines.push(fill(random.pick(templates), random));

  return lines;
}

/** Un tramo del archivo reemplazado por otro. */
export interface Edit {
  /** Índice en el archivo anterior donde empieza. */
  at: number;
  /** Cuántas líneas desaparecen. Cero es una inserción pura. */
  removed: number;
  added: readonly string[];
}

export interface EditedFile {
  lines: readonly string[];
  edits: readonly Edit[];
}

/**
 * Aplica unos cuantos cambios al archivo y deja constancia de cuáles fueron.
 *
 * Las ediciones salen ordenadas y sin solaparse, que es lo que después permite
 * repartirlas en hunks sin comparar nada.
 */
export function editFile(base: readonly string[], random: Random, path: string): EditedFile {
  const templates = templatesFor(path);
  const count = random.int(1, 3);
  const edits: Edit[] = [];

  let cursor = random.int(2, Math.max(3, Math.floor(base.length / (count + 1))));

  for (let index = 0; index < count && cursor < base.length - 2; index += 1) {
    const removed = random.int(0, 3);
    const addedCount = removed === 0 ? random.int(1, 3) : random.int(0, 3);
    const added: string[] = [];

    for (let line = 0; line < addedCount; line += 1)
      added.push(fill(random.pick(templates), random));

    // Una edición que ni quita ni pone no es una edición.
    if (removed > 0 || added.length > 0) edits.push({ at: cursor, removed, added });

    cursor += removed + random.int(6, 24);
  }

  const lines: string[] = [];
  let read = 0;

  for (const edit of edits) {
    lines.push(...base.slice(read, edit.at), ...edit.added);
    read = edit.at + edit.removed;
  }

  lines.push(...base.slice(read));

  return { lines, edits };
}

/**
 * Qué tramo de dos líneas parecidas cambió de verdad.
 *
 * Prefijo y sufijo comunes, y lo de en medio se resalta. Es el resaltado por
 * palabra que pide el visor, en su forma más honesta: no adivina palabras, dice
 * exactamente dónde dejan de parecerse.
 */
export function spanBetween(before: string, after: string): [WordSpan, WordSpan] | null {
  let start = 0;

  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;

  let end = 0;

  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }

  const beforeEnd = before.length - end;
  const afterEnd = after.length - end;

  if (beforeEnd <= start && afterEnd <= start) return null;

  return [
    { start, end: beforeEnd },
    { start, end: afterEnd },
  ];
}

interface PlacedEdit extends Edit {
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

function place(edits: readonly Edit[]): readonly PlacedEdit[] {
  let delta = 0;

  return edits.map((edit) => {
    const newStart = edit.at + delta;

    delta += edit.added.length - edit.removed;

    return {
      ...edit,
      oldEnd: edit.at + edit.removed,
      newStart,
      newEnd: newStart + edit.added.length,
    };
  });
}

/** Reparte las ediciones en hunks: las que caen cerca comparten uno. */
export function hunksFromEdits(
  base: readonly string[],
  edits: readonly Edit[],
  context: number,
): readonly Hunk[] {
  const placed = place(edits);
  const groups: PlacedEdit[][] = [];

  for (const edit of placed) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];

    if (current && previous && edit.at - previous.oldEnd <= context * 2) current.push(edit);
    else groups.push([edit]);
  }

  return groups.map((group, index) => buildHunk(base, group, context, index));
}

function buildHunk(
  base: readonly string[],
  group: readonly PlacedEdit[],
  context: number,
  index: number,
): Hunk {
  const first = group[0];
  const last = group[group.length - 1];

  if (!first || !last) throw new Error('Un hunk sin ediciones no existe');

  const oldStart = Math.max(0, first.at - context);
  const oldEnd = Math.min(base.length, last.oldEnd + context);
  const newStart = Math.max(0, first.newStart - context);
  const lines: DiffLine[] = [];

  let oldIndex = oldStart;
  let newIndex = newStart;

  const contextLine = () => {
    lines.push({
      kind: 'context',
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
      text: base[oldIndex] ?? '',
    });
    oldIndex += 1;
    newIndex += 1;
  };

  for (const edit of group) {
    while (oldIndex < edit.at) contextLine();

    const removedLines = base.slice(edit.at, edit.oldEnd);

    for (const text of removedLines) {
      lines.push({ kind: 'removed', oldLine: oldIndex + 1, newLine: null, text });
      oldIndex += 1;
    }

    for (const text of edit.added) {
      lines.push({ kind: 'added', oldLine: null, newLine: newIndex + 1, text });
      newIndex += 1;
    }

    // Cuando se quitó y se puso la misma cantidad, cada par se enfrenta línea a
    // línea y el resaltado dice qué cambió dentro de ella.
    if (removedLines.length === edit.added.length) {
      const pairStart = lines.length - removedLines.length * 2;

      for (let pair = 0; pair < removedLines.length; pair += 1) {
        const before = lines[pairStart + pair];
        const after = lines[pairStart + removedLines.length + pair];

        if (!before || !after) continue;

        const spans = spanBetween(before.text, after.text);

        if (spans) {
          lines[pairStart + pair] = { ...before, words: [spans[0]] };
          lines[pairStart + removedLines.length + pair] = { ...after, words: [spans[1]] };
        }
      }
    }
  }

  while (oldIndex < oldEnd) contextLine();

  const newLines = newIndex - newStart;

  return {
    id: `hunk-${String(index + 1)}`,
    oldStart: oldStart + 1,
    oldLines: oldIndex - oldStart,
    newStart: newStart + 1,
    newLines,
    header: headerFor(base, oldStart),
    lines,
  };
}

/** El contexto que git escribe tras las arrobas: la declaración que envuelve. */
function headerFor(base: readonly string[], from: number): string {
  for (let index = from; index >= 0; index -= 1) {
    const line = base[index];

    if (line && /^(export |pub |interface |\.|#|##)/.test(line)) return line.trim();
  }

  return '';
}

/** El archivo entero, ya con los cambios aplicados. */
export function editedLines(path: string, key: string): EditedFile {
  const base = baseLines(path);

  return editFile(base, createRandom(seedFrom(`edicion:${path}:${key}`)), path);
}

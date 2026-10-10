/**
 * El cálculo de Resolver: partir un conflicto en bloques y volver a juntarlo.
 *
 * Puro y sin React, como `graph.ts` en GitWorking y por el mismo motivo: aquí
 * está todo lo que decide algo, así que aquí es donde se prueba sin montar
 * nada. El componente solo pinta lo que estas funciones dijeron.
 */

export type ResolutionSide = 'ours' | 'theirs';

/** Una línea concreta de un lado, identificada dentro de su bloque. */
export type LineChoice = `${ResolutionSide}:${number}`;

/** Un lado completo, líneas concretas o la decisión explícita de no poner nada. */
export type SideChoice = ResolutionSide | LineChoice | 'none';

export type BlockKind = 'context' | 'automatic' | 'conflict';

export interface ConflictBlock {
  id: string;
  kind: BlockKind;
  /** Las líneas de cada lado. En un bloque de contexto ambos lados son iguales. */
  ours: readonly string[];
  theirs: readonly string[];
  /** Texto exacto, incluidos CRLF y la ausencia de salto al final. */
  oursText?: string;
  theirsText?: string;
  /** Resultado compatible ya integrado; nunca requiere un checkbox. */
  mergedText?: string;
  origin?: LineOrigin;
  /** Primera línea del bloque en cada panel, contando desde 1. */
  oursLine: number;
  theirsLine: number;
}

/** Lo que la persona eligió por bloque, en el orden en que lo eligió. */
export type Choices = ReadonlyMap<string, readonly SideChoice[]>;

export interface BlockLineSelection {
  blockId: string;
  choices: readonly LineChoice[];
}

/** De dónde salió cada línea del resultado — CU-6, el color lo dice. */
export type LineOrigin = 'context' | 'ours' | 'theirs' | 'manual';

export interface BlockText {
  text: string;
  resolved: boolean;
}

export interface Assembled {
  manualRanges: ReadonlyMap<string, { from: number; to: number }>;

  text: string;
  /** Un origen por línea del resultado, en el mismo orden. */
  origins: readonly LineOrigin[];
  /** Primera línea visible de cada bloque en el resultado ensamblado. */
  blockStarts: ReadonlyMap<string, number>;
}

/**
 * Cuántas veces puede fallar el alineado antes de rendirse.
 *
 * El algoritmo de abajo es proporcional a lo que las dos versiones difieren, no
 * a lo que miden: dos archivos casi iguales se alinean en un suspiro por largos
 * que sean. Cuando difieren en más de esto —un archivo reescrito entero— deja
 * de tener sentido buscar el alineado más fino: el bloque sale entero como un
 * solo conflicto, que es exactamente lo que la persona va a decidir de todas
 * formas.
 */
const MAX_DIFFERENCE = 2000;

export type EditKind = 'same' | 'added' | 'removed';

export interface Edit {
  kind: EditKind;
  line: string;
}

/**
 * Diff de dos vías por líneas, con el algoritmo de Myers.
 *
 * Lo usan las dos pantallas de la vista: el resolutor, para saber qué tocó cada
 * lado respecto de la base, y la comprobación de F3.3, para enseñar el archivo
 * de antes contra el resultado. Por eso vive aquí y no dentro de un componente,
 * y por eso **no se le pide al puerto**: los dos textos ya están en la ventana.
 */
export function diffLines(before: readonly string[], after: readonly string[]): readonly Edit[] {
  const n = before.length;
  const m = after.length;

  // Prefijo y sufijo comunes: lo barato primero, que además es lo más frecuente.
  let start = 0;

  while (start < n && start < m && before[start] === after[start]) start += 1;

  let endBefore = n;
  let endAfter = m;

  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const head: Edit[] = before.slice(0, start).map((line) => ({ kind: 'same' as const, line }));
  const tail: Edit[] = before.slice(endBefore).map((line) => ({ kind: 'same' as const, line }));
  const middle = myers(before.slice(start, endBefore), after.slice(start, endAfter));

  return [...head, ...middle, ...tail];
}

/**
 * El núcleo de Myers sobre el tramo que de verdad difiere.
 *
 * Recorre las diagonales guardando, por cada distancia, hasta dónde llegó; al
 * encontrar el final reconstruye el camino hacia atrás. Si la distancia pasa de
 * `MAX_DIFFERENCE` se rinde y devuelve «todo fuera, todo dentro», que es la
 * respuesta correcta cuando dos versiones no se parecen en nada.
 */
function myers(before: readonly string[], after: readonly string[]): Edit[] {
  const n = before.length;
  const m = after.length;

  if (n === 0) return after.map((line) => ({ kind: 'added', line }));
  if (m === 0) return before.map((line) => ({ kind: 'removed', line }));

  const max = Math.min(n + m, MAX_DIFFERENCE);
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;

      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) return walkBack(before, after, trace, d, offset);
    }
  }

  // Demasiada diferencia: el tramo entero es un solo cambio.
  return [
    ...before.map((line): Edit => ({ kind: 'removed', line })),
    ...after.map((line): Edit => ({ kind: 'added', line })),
  ];
}

function walkBack(
  before: readonly string[],
  after: readonly string[],
  trace: readonly Int32Array[],
  d: number,
  offset: number,
): Edit[] {
  const edits: Edit[] = [];
  let x = before.length;
  let y = after.length;

  for (let step = d; step > 0; step -= 1) {
    const v = trace[step];

    if (!v) break;

    const k = x - y;
    const down = k === -step || (k !== step && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = v[offset + previousK] ?? 0;
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      const line = before[x];

      if (line !== undefined) edits.push({ kind: 'same', line });
    }

    if (down) {
      y -= 1;
      const line = after[y];

      if (line !== undefined) edits.push({ kind: 'added', line });
    } else {
      x -= 1;
      const line = before[x];

      if (line !== undefined) edits.push({ kind: 'removed', line });
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    const line = before[x];

    if (line !== undefined) edits.push({ kind: 'same', line });
  }

  return edits.reverse();
}

/** Parte un texto en líneas sin inventar una vacía al final. */
export function toLines(text: string | null): readonly string[] {
  if (text === null || text === '') return [];

  const lines = text.split('\n');

  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
}

/** Líneas completas: el terminador también forma parte del cambio de Git. */
function rawLines(text: string | null): string[] {
  return text?.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

interface Change {
  from: number;
  to: number;
  lines: string[];
  side: ResolutionSide;
}

/** Cada edición ocupa un intervalo en la base; una inserción tiene longitud cero. */
function changes(base: string[], side: string[], name: ResolutionSide): Change[] {
  const result: Change[] = [];
  let at = 0;
  let current: Change | undefined;
  for (const edit of diffLines(base, side)) {
    if (edit.kind === 'same') {
      current = undefined;
      at++;
    } else {
      if (!current) {
        current = { from: at, to: at, lines: [], side: name };
        result.push(current);
      }
      if (edit.kind === 'removed') current.to = ++at;
      else current.lines.push(edit.line);
    }
  }
  // Cuando hay líneas repetidas, desplazar la edición hacia el final del
  // tramo equivalente. No fijar un borrado a la primera línea repetida:
  // cambiaría artificialmente qué inserción del otro lado se solapa con él.
  for (let index = result.length - 1; index >= 0; index--) {
    const change = result[index]!;
    const limit = result[index + 1]?.from ?? base.length;
    let rotation = 0;
    while (change.to < limit && base[change.from] === (change.lines[rotation] ?? base[change.to])) {
      if (change.lines.length) {
        change.lines[rotation] = base[change.to]!;
        rotation = (rotation + 1) % change.lines.length;
      }
      change.from++;
      change.to++;
    }
    if (rotation)
      change.lines = [...change.lines.slice(rotation), ...change.lines.slice(0, rotation)];
  }

  return result;
}

/**
 * Combina ediciones sobre la BASE, no diferencias entre A y B. Solo los
 * intervalos tocados por ambos y con resultados distintos piden una decisión.
 * Los intervalos contiguos se agrupan de forma conservadora, como merge-file:
 * una inserción en el límite de un borrado no se supone independiente.
 */
export function buildBlocks(
  base: string | null,
  ours: string | null,
  theirs: string | null,
): readonly ConflictBlock[] {
  const original = rawLines(base);
  const a = rawLines(ours);
  const b = rawLines(theirs);
  const blocks: ConflictBlock[] = [];
  let oursAt = 1;
  let theirsAt = 1;
  const push = (o: string[], t: string[], ancestor: string[]) => {
    const oursText = o.join('');
    const theirsText = t.join('');
    const baseText = ancestor.join('');
    const equal = oursText === theirsText;
    const origin: LineOrigin | undefined = equal
      ? 'context'
      : oursText === baseText
        ? 'theirs'
        : theirsText === baseText
          ? 'ours'
          : undefined;
    const kind: BlockKind =
      origin === undefined ? 'conflict' : equal && oursText === baseText ? 'context' : 'automatic';
    // Incluso un borrado compartido necesita conservar su posición en la base,
    // pero no produce filas en ninguno de los tres paneles.
    if (!o.length && !t.length) return;
    blocks.push({
      id: `${kind === 'conflict' ? 'c' : 'x'}${blocks.length}`,
      kind,
      ours: toLines(oursText),
      theirs: toLines(theirsText),
      oursText,
      theirsText,
      oursLine: oursAt,
      theirsLine: theirsAt,
      ...(origin === undefined
        ? {}
        : {
            mergedText: origin === 'theirs' ? theirsText : oursText,
            origin,
          }),
    });
    oursAt += o.length;
    theirsAt += t.length;
  };

  // Sin ancestro, dos creaciones distintas sí compiten aunque una esté vacía.
  if (base === null) {
    push(a, b, []);
    if (ours !== theirs && blocks[0]) {
      blocks[0] = { ...blocks[0], kind: 'conflict', mergedText: undefined, origin: undefined };
    }
    return blocks;
  }

  const edits = [...changes(original, a, 'ours'), ...changes(original, b, 'theirs')].sort(
    (x, y) => x.from - y.from || x.to - y.to,
  );
  let at = 0;
  for (let index = 0; index < edits.length;) {
    const first = edits[index]!;
    if (first.from > at) {
      const context = original.slice(at, first.from);
      push(context, context, context);
    }
    let end = first.to;
    const group: Change[] = [];
    while (index < edits.length && edits[index]!.from <= end) {
      const edit = edits[index++]!;
      group.push(edit);
      end = Math.max(end, edit.to);
    }
    const apply = (side: ResolutionSide) => {
      const lines: string[] = [];
      let cursor = first.from;
      for (const edit of group.filter((change) => change.side === side)) {
        for (const line of original.slice(cursor, edit.from)) lines.push(line);
        for (const line of edit.lines) lines.push(line);
        cursor = edit.to;
      }
      for (const line of original.slice(cursor, end)) lines.push(line);
      return lines;
    };
    push(apply('ours'), apply('theirs'), original.slice(first.from, end));
    at = end;
  }
  if (at < original.length) {
    const context = original.slice(at);
    push(context, context, context);
  }
  return blocks;
}

/** Con qué se queda el resultado, según lo elegido bloque a bloque. */
export function assemble(
  blocks: readonly ConflictBlock[],
  choices: Choices,
  blockText: ReadonlyMap<string, BlockText> = new Map(),
): Assembled {
  const chunks: string[] = [];
  const origins: LineOrigin[] = [];
  const blockStarts = new Map<string, number>();
  const manualRanges = new Map<string, { from: number; to: number }>();
  let length = 0;
  let endsInNewline = true;
  const eol = blocks.some((block) => /\r\n/.test(block.oursText ?? block.theirsText ?? ''))
    ? '\r\n'
    : '\n';
  const append = (text: string, origin: LineOrigin) => {
    if (!text) return;
    // Al combinar ambos lados de un último bloque sin salto, no concatenar
    // accidentalmente sus dos últimas líneas.
    if (!endsInNewline) {
      chunks.push(eol);
      length += eol.length;
    }
    chunks.push(text);
    length += text.length;
    endsInNewline = text.endsWith('\n');
    for (const _line of rawLines(text)) origins.push(origin);
  };
  const sideText = (block: ConflictBlock, side: ResolutionSide) =>
    (side === 'ours' ? block.oursText : block.theirsText) ??
    block[side].map((line) => `${line}\n`).join('');

  for (const block of blocks) {
    blockStarts.set(block.id, origins.length + 1);
    if (block.kind !== 'conflict') {
      append(block.mergedText ?? sideText(block, 'ours'), block.origin ?? 'context');
      continue;
    }
    const manual = blockText.get(block.id);
    if (manual) {
      if (!endsInNewline) {
        chunks.push(eol);
        length += eol.length;
        endsInNewline = true;
      }
      const from = length;
      append(manual.text + eol, 'manual');
      manualRanges.set(block.id, { from, to: from + manual.text.length });
    }
    for (const choice of choices.get(block.id) ?? []) {
      if (choice === 'none') continue;
      if (choice === 'ours' || choice === 'theirs') {
        append(sideText(block, choice), choice);
      } else {
        const [side, rawIndex] = choice.split(':') as [ResolutionSide, string];
        const line = rawLines(sideText(block, side))[Number(rawIndex)];
        if (line !== undefined) append(line, side);
      }
    }
  }
  return { text: chunks.join(''), origins, blockStarts, manualRanges };
}

/**
 * Traduce una selección visible de CodeMirror a líneas conflictivas de bloques.
 * Las líneas de contexto se ignoran porque ya forman parte del resultado.
 */
export function lineChoicesForRange(
  blocks: readonly ConflictBlock[],
  side: ResolutionSide,
  range: { from: number; to: number },
): readonly BlockLineSelection[] {
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const selections: BlockLineSelection[] = [];

  for (const block of blocks) {
    if (block.kind !== 'conflict') continue;

    const first = side === 'ours' ? block.oursLine : block.theirsLine;
    const blockLines = side === 'ours' ? block.ours : block.theirs;
    const last = first + blockLines.length - 1;
    const selectedFrom = Math.max(first, from);
    const selectedTo = Math.min(last, to);

    if (selectedFrom > selectedTo) continue;

    const choices: LineChoice[] = [];

    for (let line = selectedFrom; line <= selectedTo; line += 1) {
      choices.push(`${side}:${line - first}`);
    }

    selections.push({ blockId: block.id, choices });
  }

  return selections;
}

/** Cuántos bloques siguen sin decisión. Es lo que habilita Finalizar. */
export function pendingBlocks(
  blocks: readonly ConflictBlock[],
  choices: Choices,
  blockText: ReadonlyMap<string, BlockText> = new Map(),
): number {
  return blocks.filter(
    (block) =>
      block.kind === 'conflict' && !choices.has(block.id) && !blockText.get(block.id)?.resolved,
  ).length;
}

/** Los bloques que piden decisión, en orden. Los recorre `Alt+N` y `Alt+P`. */
export function conflictBlocks(blocks: readonly ConflictBlock[]): readonly ConflictBlock[] {
  return blocks.filter((block) => block.kind === 'conflict');
}

/** Extrae una edición confinada al texto manual de un bloque, sin tocar su contexto. */
export function editedBlockText(
  result: Assembled,
  next: string,
): { id: string; text: string } | null {
  for (const [id, range] of result.manualRanges) {
    const before = result.text.slice(0, range.from);
    const after = result.text.slice(range.to);
    if (
      next.length >= before.length + after.length &&
      next.startsWith(before) &&
      next.endsWith(after)
    ) {
      return { id, text: next.slice(before.length, next.length - after.length) };
    }
  }
  return null;
}

/** El editor usa LF; al aplicar una edición conserva los bytes fuera de ella. */
export function applyEditorChange(previous: string, next: string): string {
  const normalized = previous.replace(/\r\n/g, '\n');
  if (normalized === next) return previous;
  let from = 0;
  while (from < normalized.length && from < next.length && normalized[from] === next[from]) from++;
  let oldEnd = normalized.length;
  let newEnd = next.length;
  while (oldEnd > from && newEnd > from && normalized[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  // Traducir las posiciones de CodeMirror a las del texto original con CRLF.
  const offsets: number[] = [0];
  for (let index = 0; index < previous.length; index++) {
    if (previous[index] === '\r' && previous[index + 1] === '\n') index++;
    offsets.push(index + 1);
  }
  const eol = previous.includes('\r\n') ? '\r\n' : '\n';
  return (
    previous.slice(0, offsets[from]) +
    next.slice(from, newEnd).replace(/\n/g, eol) +
    previous.slice(offsets[oldEnd])
  );
}

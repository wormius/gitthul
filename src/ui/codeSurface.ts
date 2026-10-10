/**
 * Lo que `CodeSurface` puede decidir sin un DOM ni un editor montado.
 *
 * Vive aparte porque el plegado por sangría es el trozo con reglas de verdad
 * —qué bloque abre una línea y dónde termina— y probarlo montando CodeMirror
 * sería probar CodeMirror. Aquí se prueba con cadenas y números.
 */

/**
 * Tono de una línea resaltada.
 *
 * Son los nombres de los roles de `roles.css`, no los del dominio de git: el
 * primitivo no sabe qué es un hunk ni un conflicto, solo con qué fondo hay que
 * pintar la línea. Quien traduzca «esta línea la escribió el otro lado» a
 * `theirs` es el componente de dominio que lo consuma.
 */
export type CodeLineTone = 'added' | 'removed' | 'ours' | 'theirs' | 'both' | 'resolved';

export interface CodeLineMark {
  /** Número de línea, contando desde 1 como los rótulos del margen. */
  line: number;
  tone: CodeLineTone;
}

/**
 * Tono de un tramo resaltado **dentro** de una línea.
 *
 * Son dos y no seis: el resaltado por palabra existe para decir qué cambió de
 * una línea a la de enfrente, y eso solo tiene dos sentidos. Un conflicto se
 * marca por líneas enteras, que es como git lo escribe.
 */
export type CodeWordTone = 'added' | 'removed';

/**
 * Un tramo de una línea con fondo propio — el diff por palabra.
 *
 * Los índices son de carácter dentro de la línea, contando desde 0, que es la
 * forma en la que `WordSpan` del dominio los trae. Quien los calcule es el
 * componente de dominio; el primitivo solo los pinta, y recorta los que se
 * salen en vez de reventar.
 */
export interface CodeWordMark {
  /** Número de línea, contando desde 1. */
  line: number;
  start: number;
  end: number;
  tone: CodeWordTone;
}

export type SyntaxLanguage =
  | 'script'
  | 'style'
  | 'markup'
  | 'data'
  | 'markdown'
  | 'shell'
  | 'rust'
  | 'python'
  | 'compiled'
  | 'sql';
export type SyntaxTone =
  'keyword' | 'string' | 'comment' | 'number' | 'type' | 'function' | 'property' | 'annotation';

export interface SyntaxSpan {
  from: number;
  to: number;
  tone: SyntaxTone;
}

export function syntaxLanguageForPath(path: string): SyntaxLanguage | null {
  const extension = path.toLowerCase().split('.').pop() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)) return 'script';
  if (['css', 'scss', 'less'].includes(extension)) return 'style';
  if (['html', 'htm', 'xml', 'svg', 'vue'].includes(extension)) return 'markup';
  if (['json', 'jsonc', 'yaml', 'yml', 'toml'].includes(extension)) return 'data';
  if (['md', 'mdx'].includes(extension)) return 'markdown';
  if (['sh', 'bash', 'zsh', 'fish'].includes(extension)) return 'shell';
  if (extension === 'rs') return 'rust';
  if (['py', 'pyw', 'rb'].includes(extension)) return 'python';
  if (
    ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'java', 'kt', 'kts', 'go', 'cs', 'swift', 'php'].includes(
      extension,
    )
  )
    return 'compiled';
  if (['sql', 'psql'].includes(extension)) return 'sql';
  return null;
}

/** Resaltado ligero y seguro: solo produce rangos; nunca interpreta el texto. */
export function syntaxSpans(value: string, language: SyntaxLanguage): readonly SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  const occupied: Array<{ from: number; to: number }> = [];
  const add = (pattern: RegExp, tone: SyntaxTone) => {
    for (const match of value.matchAll(pattern)) {
      const from = match.index;
      const text = match[0];
      if (from === undefined || text === '') continue;
      const to = from + text.length;
      if (occupied.some((range) => from < range.to && to > range.from)) continue;
      occupied.push({ from, to });
      spans.push({ from, to, tone });
    }
  };

  // Una sola pasada respeta el orden léxico: las comillas de un comentario
  // no abren cadenas y los delimitadores dentro de cadenas no abren comentarios.
  const strings = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/.source;
  const comments =
    language === 'shell' || language === 'data' || language === 'python'
      ? /(?:^|[ \t])#[^\n]*/.source
      : language === 'markup'
        ? /<!--[\s\S]*?-->/.source
        : language === 'sql'
          ? /--[^\n]*|\/\*[\s\S]*?\*\//.source
          : ['script', 'style', 'rust', 'compiled'].includes(language)
            ? /\/\*[\s\S]*?\*\/|\/\/[^\n]*/.source
            : null;
  const lexical = new RegExp(comments ? `(${comments})|${strings}` : strings, 'gm');
  for (const match of value.matchAll(lexical)) {
    const from = match.index;
    const to = from + match[0].length;
    occupied.push({ from, to });
    spans.push({ from, to, tone: comments && match[1] !== undefined ? 'comment' : 'string' });
  }
  add(/\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi, 'number');

  const words =
    language === 'rust'
      ? 'as|async|await|break|const|continue|crate|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|static|struct|super|trait|true|type|unsafe|use|where|while'
      : language === 'python'
        ? 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield'
        : language === 'compiled'
          ? 'abstract|as|async|await|bool|break|case|catch|char|class|const|continue|default|defer|do|double|else|enum|extends|false|final|finally|float|for|func|if|implements|import|in|int|interface|long|namespace|new|null|override|package|private|protected|public|return|short|static|string|struct|super|switch|this|throw|true|try|type|using|var|void|while'
          : language === 'sql'
            ? 'ADD|ALTER|AND|AS|ASC|BEGIN|BY|CASE|CREATE|DELETE|DESC|DISTINCT|DROP|ELSE|END|FROM|FULL|GROUP|HAVING|INNER|INSERT|INTO|JOIN|LEFT|LIMIT|NOT|NULL|ON|OR|ORDER|OUTER|PRIMARY|REFERENCES|RIGHT|SELECT|SET|TABLE|THEN|UNION|UNIQUE|UPDATE|VALUES|WHEN|WHERE|WITH'
            : language === 'style'
              ? 'important|inherit|initial|none|transparent|var'
              : language === 'shell'
                ? 'case|do|done|elif|else|esac|export|fi|for|function|if|in|local|then|while'
                : 'async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|interface|let|new|null|of|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield';
  if (language !== 'markup' && language !== 'data' && language !== 'markdown') {
    add(new RegExp(`\\b(?:${words})\\b`, language === 'sql' ? 'gi' : 'g'), 'keyword');
  }

  if (['script', 'compiled', 'python', 'rust'].includes(language)) {
    add(/@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g, 'annotation');
    add(/\b[A-Z][\w$]*\b/g, 'type');
    add(/\b[a-z_$][\w$]*(?=\s*\()/g, 'function');
    add(/(?<=\.)[a-z_$][\w$]*\b|\b[a-z_$][\w$]*(?=\s*:(?!:))/g, 'property');
  }
  if (language === 'style') {
    add(/--[\w-]+|\b[a-z-]+(?=\s*:)/g, 'property');
    add(/#[\da-f]{3,8}\b/gi, 'number');
  }

  if (language === 'markup') {
    add(/<\/?[A-Za-z][\w:-]*/g, 'keyword');
    add(/[A-Za-z_:][\w:.-]*(?=\s*=)/g, 'property');
  }
  if (language === 'markdown') add(/^#{1,6}[^\n]*|\*\*[^\n*]+\*\*/gm, 'keyword');

  return spans.sort((left, right) => left.from - right.from);
}

/** Ordena los tramos como `RangeSetBuilder` los exige: de arriba abajo. */
export function sortWordMarks(marks: readonly CodeWordMark[]): readonly CodeWordMark[] {
  return [...marks].sort((a, b) => a.line - b.line || a.start - b.start);
}

/** Ancho de un tabulador al medir la sangría. */
const TAB_WIDTH = 4;

/** Columna en la que empieza el texto de una línea; `null` si está en blanco. */
export function indentWidth(text: string): number | null {
  let width = 0;

  for (const character of text) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += TAB_WIDTH - (width % TAB_WIDTH);
    else return width;
  }

  // Una línea de solo espacios no abre ni cierra nada: es un hueco.
  return null;
}

export interface FoldRange {
  /** Primera línea plegada, contando desde 1. Nunca es la de la flecha. */
  from: number;
  /** Última línea plegada, inclusive. */
  to: number;
}

/**
 * Un documento del que solo se piden las líneas que hagan falta.
 *
 * Tiene la forma del `Text` de CodeMirror a propósito: el margen de plegado
 * pregunta por cada línea que asoma, y volcar el documento entero a un arreglo
 * en cada pregunta convertiría un archivo grande en cuarenta copias por cuadro.
 */
export interface LineReader {
  /** Cuántas líneas hay. */
  lines: number;
  /** Texto de una línea, contando desde 1. */
  line: (number: number) => string;
}

/** Envuelve un arreglo de líneas ya leídas. */
export function readLines(lines: readonly string[]): LineReader {
  return { lines: lines.length, line: (number) => lines[number - 1] ?? '' };
}

/**
 * Qué plegaría la flecha de la línea `line`, mirando solo la sangría.
 *
 * Sin lenguaje declarado no hay árbol sintáctico, y sin árbol sintáctico
 * CodeMirror no sabe plegar nada. La sangría es el único criterio que funciona
 * igual en un diff, en un archivo de configuración y en un lenguaje que todavía
 * no sabemos cuál será: un bloque es lo que viene debajo y más adentro.
 *
 * Las líneas en blanco intermedias entran en el bloque —separan párrafos dentro
 * de una función— pero las del final no, o plegar dejaría el hueco de después
 * pegado al bloque anterior.
 */
export function foldRangeAt(doc: LineReader, line: number): FoldRange | null {
  if (line < 1 || line > doc.lines) return null;

  const base = indentWidth(doc.line(line));

  if (base === null) return null;

  let last = line;

  for (let scan = line + 1; scan <= doc.lines; scan += 1) {
    const width = indentWidth(doc.line(scan));

    if (width === null) continue;
    if (width <= base) break;

    last = scan;
  }

  return last === line ? null : { from: line + 1, to: last };
}

/** Limit only the displayed text; retain line count for diff selections and gutters. */
export const MAX_DISPLAY_LINE_LENGTH = 10000;
export function truncateDisplayLines(value: string, message: string): string {
  return value
    .split('\n')
    .map((line) =>
      line.length > MAX_DISPLAY_LINE_LENGTH
        ? `${line.slice(0, MAX_DISPLAY_LINE_LENGTH)} … [${message}]`
        : line,
    )
    .join('\n');
}

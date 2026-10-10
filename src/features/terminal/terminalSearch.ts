export interface TerminalSearchMatch {
  /** Coordenadas base cero dentro del búfer de xterm. */
  row: number;
  column: number;
  length: number;
}

/** Encuentra coincidencias literales, sin distinguir mayúsculas, en todo el historial visible. */
export function findTerminalMatches(
  lines: readonly string[],
  query: string,
): TerminalSearchMatch[] {
  const needle = query.toLocaleLowerCase();
  if (needle.length === 0) return [];

  const matches: TerminalSearchMatch[] = [];
  lines.forEach((line, row) => {
    const haystack = line.toLocaleLowerCase();
    let column = 0;
    while (column <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, column);
      if (found === -1) break;
      matches.push({ row, column: found, length: query.length });
      column = found + Math.max(1, needle.length);
    }
  });

  return matches;
}

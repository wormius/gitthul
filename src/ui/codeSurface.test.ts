import { describe, expect, it } from 'vitest';

import {
  foldRangeAt,
  truncateDisplayLines,
  MAX_DISPLAY_LINE_LENGTH,
  indentWidth,
  readLines,
  syntaxLanguageForPath,
  syntaxSpans,
} from './codeSurface';

describe('resaltado de sintaxis', () => {
  it('elige el lenguaje por la ruta y deja desconocidos sin colorear', () => {
    expect(syntaxLanguageForPath('src/app.tsx')).toBe('script');
    expect(syntaxLanguageForPath('styles/theme.css')).toBe('style');
    expect(syntaxLanguageForPath('LICENSE')).toBeNull();
  });

  it('distingue comentario, palabra reservada, cadena y número sin solaparlos', () => {
    const value = '// const oculto = 9\nconst visible = "texto" + 42;';
    const spans = syntaxSpans(value, 'script');

    expect(spans.map((span) => [value.slice(span.from, span.to), span.tone])).toEqual([
      ['// const oculto = 9', 'comment'],
      ['const', 'keyword'],
      ['"texto"', 'string'],
      ['42', 'number'],
    ]);
  });

  it('mantiene las cadenas citadas dentro de comentarios y las palabras SQL sin solaparse', () => {
    for (const [language, value] of [
      ['compiled', '// @Pattern(message = "texto") public String getName()'],
      ['sql', '-- SELECT "name" FROM users'],
    ] as const) {
      expect(syntaxSpans(value, language)).toEqual([
        { from: 0, to: value.length, tone: 'comment' },
      ]);
    }
  });

  it('distingue anotaciones, tipos, métodos y propiedades de Java', () => {
    const value = '@Override public String getName() { return this.name; }';
    const spans = syntaxSpans(value, 'compiled');
    expect(spans.map((span) => [value.slice(span.from, span.to), span.tone])).toEqual([
      ['@Override', 'annotation'],
      ['public', 'keyword'],
      ['String', 'type'],
      ['getName', 'function'],
      ['return', 'keyword'],
      ['this', 'keyword'],
      ['name', 'property'],
    ]);
  });

  it('colorea etiquetas con atributos aunque contengan cadenas', () => {
    const value = '<button class="primary">';
    expect(
      syntaxSpans(value, 'markup').map((span) => [value.slice(span.from, span.to), span.tone]),
    ).toEqual([
      ['<button', 'keyword'],
      ['class', 'property'],
      ['"primary"', 'string'],
    ]);
  });

  it('no confunde un # dentro de una cadena de datos con un comentario', () => {
    const hash = String.fromCharCode(35);
    const value = `color = "${hash}fff" ${hash} comentario`;
    const spans = syntaxSpans(value, 'data');

    expect(spans.filter((span) => span.tone === 'string')).toEqual([
      { from: 8, to: 14, tone: 'string' },
    ]);
    expect(spans.filter((span) => span.tone === 'comment')).toEqual([
      { from: 14, to: value.length, tone: 'comment' },
    ]);
  });
});

describe('indentWidth', () => {
  it('cuenta espacios', () => {
    expect(indentWidth('    const x = 1;')).toBe(4);
  });

  it('lleva el tabulador a la siguiente parada de cuatro', () => {
    expect(indentWidth('\tconst x = 1;')).toBe(4);
    expect(indentWidth('  \tconst x = 1;')).toBe(4);
  });

  it('una línea sin sangría empieza en cero', () => {
    expect(indentWidth('const x = 1;')).toBe(0);
  });

  it('una línea en blanco no tiene sangría que medir', () => {
    expect(indentWidth('')).toBeNull();
    expect(indentWidth('   ')).toBeNull();
  });
});

describe('foldRangeAt', () => {
  const doc = readLines([
    'function resolveTheme(settings) {',
    '  const mode = settings.mode;',
    '',
    '  if (mode === "auto") {',
    '    return system.mode;',
    '  }',
    '',
    '  return mode;',
    '}',
    '',
    'const x = 1;',
  ]);

  it('pliega todo lo que viene debajo y más adentro', () => {
    expect(foldRangeAt(doc, 1)).toEqual({ from: 2, to: 8 });
  });

  it('un bloque anidado pliega solo lo suyo', () => {
    expect(foldRangeAt(doc, 4)).toEqual({ from: 5, to: 5 });
  });

  it('deja fuera las líneas en blanco del final', () => {
    expect(foldRangeAt(readLines(['a', '  b', '', '']), 1)).toEqual({ from: 2, to: 2 });
  });

  it('se traga las líneas en blanco de en medio', () => {
    expect(foldRangeAt(readLines(['a', '  b', '', '  c']), 1)).toEqual({ from: 2, to: 4 });
  });

  it('una línea sin nada debajo no pliega', () => {
    expect(foldRangeAt(doc, 8)).toBeNull();
    expect(foldRangeAt(doc, 11)).toBeNull();
  });

  it('una línea en blanco nunca pliega', () => {
    expect(foldRangeAt(doc, 3)).toBeNull();
  });

  it('una línea que no existe no pliega', () => {
    expect(foldRangeAt(doc, 0)).toBeNull();
    expect(foldRangeAt(doc, 99)).toBeNull();
  });
});

describe('long display lines', () => {
  it('limits a 1.5 MB line without losing following line numbers or modifying the source', () => {
    const huge = 'x'.repeat(1_500_000);
    const source = `first\n${huge}\nlast`;
    const shown = truncateDisplayLines(source, 'Enable word wrap');
    expect(shown.split('\n')).toEqual([
      'first',
      `${'x'.repeat(MAX_DISPLAY_LINE_LENGTH)} … [Enable word wrap]`,
      'last',
    ]);
    expect(source.split('\n')[1]).toHaveLength(1_500_000);
  });
  it('keeps ordinary lines unchanged, including empty lines', () => {
    expect(truncateDisplayLines('a\n\nb\n', 'wrap')).toBe('a\n\nb\n');
  });
});

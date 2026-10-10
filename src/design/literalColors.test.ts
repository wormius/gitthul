import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Ningún color literal fuera de src/design.
 *
 * Es la regla que impide que un componente improvisado a mitad de una vista
 * rompa los siete temas: un hexadecimal escrito a mano se ve bien en el tema en
 * el que se escribió y mal en los otros once. Como el fallo no se nota hasta
 * que alguien cambia de tema, hace falta que lo detecte la suite.
 */

// Sin `new URL('…', import.meta.url)`: en su forma literal Vite la reescribe a
// una URL de activo y deja de apuntar al disco.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// `src/app` entra con F0.7: el shell tiene CSS propio — barras, marca, iconos —
// y la regla vale igual para él que para un primitivo o una vista.
const SCANNED = ['src/ui', 'src/features', 'src/app'];

const HEX = /#[0-9a-f]{3,8}\b/i;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** No es la lista completa de nombres CSS: son los que alguien escribiría. */
const NAMED = [
  'aqua',
  'black',
  'blue',
  'brown',
  'crimson',
  'cyan',
  'fuchsia',
  'gold',
  'gray',
  'grey',
  'green',
  'indigo',
  'lime',
  'magenta',
  'maroon',
  'navy',
  'olive',
  'orange',
  'pink',
  'purple',
  'red',
  'salmon',
  'silver',
  'teal',
  'tomato',
  'violet',
  'white',
  'yellow',
];
const NAMED_VALUE = new RegExp(`:\\s*(?:${NAMED.join('|')})\\s*(?:;|$|!)`, 'i');

function filesUnder(directory: string): string[] {
  const absolute = join(ROOT, directory);
  const found: string[] = [];

  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);

      if (statSync(child).isDirectory()) walk(child);
      // Los tests usan colores sintéticos para verificar el transporte de paletas.
      // La regla se aplica al código de interfaz que llega al producto.
      else if (/\.(css|ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(child);
    }
  };

  walk(absolute);

  return found;
}

function violations(file: string): string[] {
  const isStyle = file.endsWith('.css');
  const found: string[] = [];

  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const where = `${file.slice(ROOT.length)}:${String(index + 1)}`;

      if (HEX.test(line)) found.push(`${where} hexadecimal — ${line.trim()}`);
      if (COLOR_FUNCTION.test(line)) found.push(`${where} función de color — ${line.trim()}`);
      if (isStyle && NAMED_VALUE.test(line)) found.push(`${where} nombre CSS — ${line.trim()}`);
    });

  return found;
}

describe('colores literales', () => {
  it.each(SCANNED)('%s no escribe ningún color a mano', (directory) => {
    const found = filesUnder(directory).flatMap(violations);

    expect(found).toEqual([]);
  });

  it('detecta lo que busca', () => {
    expect(HEX.test('  color: #c24bd6;')).toBe(true);
    expect(HEX.test('  color: var(--text-accent);')).toBe(false);
    expect(COLOR_FUNCTION.test('  background: rgb(0 0 0 / 40%);')).toBe(true);
    expect(NAMED_VALUE.test('  border-color: red;')).toBe(true);
    expect(NAMED_VALUE.test('  color: var(--text-primary);')).toBe(false);
  });
});

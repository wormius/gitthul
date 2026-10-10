import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Cero peticiones de red no provocadas por el usuario.
 *
 * Las fuentes son el punto por donde una aplicación de escritorio se vuelve
 * dependiente de internet sin que nadie lo decida: basta un @import a un CDN
 * para que la ventana tarde en pintar sin conexión y para que cada arranque
 * avise a un tercero. Por eso esta prueba sigue cada @import de fonts.css hasta
 * el CSS real del paquete y comprueba que sus url() son locales.
 */

// Sin `new URL('…', import.meta.url)`: en su forma literal Vite la reescribe a
// una URL de activo y deja de apuntar al disco.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const REMOTE_URL = /url\(\s*['"]?(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const REMOTE_ATTRIBUTE = /(?:src|href)\s*=\s*['"](?:[a-z][a-z0-9+.-]*:)?\/\//i;

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

function cssFilesUnder(directory: string): string[] {
  const found: string[] = [];

  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);

      if (statSync(child).isDirectory()) walk(child);
      else if (entry.endsWith('.css')) found.push(child);
    }
  };

  walk(join(ROOT, directory));

  return found;
}

const fontsCss = read('src/design/fonts.css');
const fontFiles = [...fontsCss.matchAll(/url\(['"]([^'"]+)['"]\)/g)].map((match) => match[1] ?? '');

describe('activos empaquetados', () => {
  it('empaqueta las nueve familias del plan', () => {
    const families = new Set(fontFiles.map((path) => path.split('/')[1]));

    expect([...families].sort()).toEqual([
      'atkinson-hyperlegible',
      'cascadia-code',
      'fira-code',
      'ibm-plex-mono',
      'ibm-plex-sans',
      'inter',
      'jetbrains-mono',
      'source-sans-3',
      'space-grotesk',
    ]);
  });

  it('declara los pesos y subconjuntos que el sistema de diseño usa', () => {
    expect(fontFiles).toHaveLength(44);
    expect(fontFiles.filter((path) => path.includes('-latin-'))).not.toHaveLength(0);
    expect(fontFiles.filter((path) => path.includes('-latin-ext-'))).not.toHaveLength(0);
  });

  it.each(fontFiles)('%s existe en node_modules y es woff2', (specifier) => {
    expect(specifier.endsWith('.woff2'), `${specifier} no es woff2`).toBe(true);
    expect(existsSync(join(ROOT, 'node_modules', specifier)), `${specifier} falta`).toBe(true);
  });

  it('ningún CSS del proyecto pide un activo remoto', () => {
    const offenders = cssFilesUnder('src').filter((file) =>
      REMOTE_URL.test(readFileSync(file, 'utf8')),
    );

    expect(offenders.map((file) => file.slice(ROOT.length))).toEqual([]);
  });

  it('index.html no carga nada de fuera', () => {
    expect(REMOTE_ATTRIBUTE.test(read('index.html'))).toBe(false);
  });

  it('detecta lo que busca', () => {
    expect(REMOTE_URL.test("@import url('https://fonts.googleapis.com/css2');")).toBe(true);
    expect(REMOTE_URL.test("src: url('./files/inter-latin-400.woff2');")).toBe(false);
    expect(REMOTE_ATTRIBUTE.test('<script src="https://cdn.example/x.js">')).toBe(true);
    expect(REMOTE_ATTRIBUTE.test('<script type="module" src="/src/main.tsx">')).toBe(false);
  });
});

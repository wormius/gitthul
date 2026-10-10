import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { alphaOf, contrastRatio, over, parseHexColor, relativeLuminance } from './color';
import { CONTRAST_PAIRS, minimumFor } from './contrastPairs';
import {
  COLOR_TOKENS,
  GRAPH_BRANCH_COUNT,
  graphBranchTokens,
  HEAT_LEVELS,
  heatToken,
  MEASURE_TOKENS,
} from './tokenCatalog';
import { CODE_FONTS, DENSITIES, MODES, THEMES, THEME_VARIANTS, UI_FONTS } from './theme';

/*
 * Las pruebas del sistema de diseño miden el CSS que se publica, no una copia
 * de sus valores: leen los archivos, resuelven la cadena rol → paleta → literal
 * igual que lo hará el navegador, y sobre eso comprueban el contraste. Así, si
 * alguien retoca un color a mano en palette.css y baja del mínimo, la suite lo
 * dice — que es justamente lo que evita que un tema se degrade sin que nadie se
 * entere.
 */

type Declarations = Map<string, string>;

interface Block {
  selector: string;
  declarations: Declarations;
}

// Sin `new URL('…', import.meta.url)`: en su forma literal Vite la reescribe a
// una URL de activo y deja de apuntar al disco.
const DESIGN_DIR = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return readFileSync(join(DESIGN_DIR, file), 'utf8');
}

function parseDeclarations(body: string): Declarations {
  const declarations: Declarations = new Map();

  for (const piece of body.split(';')) {
    const separator = piece.indexOf(':');

    if (separator === -1) continue;

    const name = piece.slice(0, separator).trim();
    const value = piece
      .slice(separator + 1)
      .replace(/\s+/g, ' ')
      .trim();

    if (name.startsWith('--')) declarations.set(name, value);
  }

  return declarations;
}

/** Solo recoge bloques de primer nivel: lo anidado en @media no participa. */
function parseBlocks(source: string): Block[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: Block[] = [];
  const stack: string[] = [];
  let buffer = '';

  for (const character of css) {
    if (character === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (character === '}') {
      const selector = stack.pop() ?? '';

      if (stack.length === 0 && !selector.startsWith('@')) {
        blocks.push({ selector, declarations: parseDeclarations(buffer) });
      }

      buffer = '';
    } else {
      buffer += character;
    }
  }

  return blocks;
}

function blocksOf(file: string): Map<string, Declarations> {
  const map = new Map<string, Declarations>();

  for (const block of parseBlocks(read(file))) {
    for (const selector of block.selector.split(',')) {
      const key = selector.replace(/\s+/g, ' ').trim();
      const existing = map.get(key) ?? new Map<string, string>();

      for (const [name, value] of block.declarations) existing.set(name, value);

      map.set(key, existing);
    }
  }

  return map;
}

const palette = blocksOf('./palette.css');
const variants = blocksOf('./variants.css');
const terminalPalette = blocksOf('./terminalPalette.css');
const roles = blocksOf('./roles.css');
const density = blocksOf('./density.css');
const typography = blocksOf('./typography.css');

const VAR_REFERENCE = /^var\((--[a-z0-9-]+)\)$/;

/** Las variables efectivas de un tema y un modo, con la cadena var() resuelta. */
function tokensFor(theme: string, mode: string, variant = 'classic'): Map<string, string> {
  // Los roles de un tema pueden además afinarse por modo —la escala de calor de
  // «Contraste» lo hace— y ahí manda el bloque más específico, igual que en el
  // navegador.
  const layers = [
    roles.get(':root'),
    theme === 'contraste' ? roles.get(`[data-theme='${theme}']`) : undefined,
    theme === 'contraste' ? roles.get(`[data-theme='${theme}'][data-mode='${mode}']`) : undefined,
    typography.get(':root'),
    density.get(':root'),
  ];

  const declared = new Map<string, string>();
  const literals = palette.get(`[data-theme='${theme}'][data-mode='${mode}']`);

  expect(literals, `falta la paleta de ${theme}/${mode}`).toBeDefined();

  for (const [name, value] of literals ?? []) declared.set(name, value);
  for (const [name, value] of terminalPalette.get(`[data-theme='${theme}'][data-mode='${mode}']`) ??
    []) {
    declared.set(name, value);
  }
  for (const [name, value] of variants.get(
    `[data-theme='${theme}'][data-mode='${mode}'][data-theme-variant='${variant}']`,
  ) ?? []) {
    declared.set(name, value);
  }
  for (const layer of layers) {
    for (const [name, value] of layer ?? []) declared.set(name, value);
  }

  const resolved = new Map<string, string>();

  for (const [name, value] of declared) {
    const reference = VAR_REFERENCE.exec(value);
    const target = reference?.[1];

    resolved.set(name, target ? (declared.get(target) ?? value) : value);
  }

  return resolved;
}

const BASE_COMBINATIONS = THEMES.flatMap((theme) => MODES.map((mode) => ({ theme, mode })));
const COMBINATIONS = BASE_COMBINATIONS.flatMap(({ theme, mode }) =>
  THEME_VARIANTS.map((variant) => ({ theme, mode, variant })),
);

/**
 * Lo mínimo que se distinguen dos escalones seguidos del mapa de calor.
 *
 * No es un mínimo de accesibilidad de texto: es lo que hace falta para que dos
 * cuadros vecinos no se lean como el mismo. Con el filete interior que todos
 * llevan puesto, 1,25:1 ya se ve.
 */
const MINIMUM_HEAT_STEP = 1.25;

describe('paleta', () => {
  it('define los siete temas en sus dos modos', () => {
    for (const { theme, mode } of BASE_COMBINATIONS) {
      expect(palette.has(`[data-theme='${theme}'][data-mode='${mode}']`)).toBe(true);
    }
  });

  it('define exactamente las mismas variables en todas las combinaciones', () => {
    const reference = [
      ...(palette.get(`[data-theme='thul'][data-mode='dark']`) ?? new Map()).keys(),
    ].sort();

    expect(reference.length).toBeGreaterThan(40);

    for (const { theme, mode } of BASE_COMBINATIONS) {
      const names = [
        ...(palette.get(`[data-theme='${theme}'][data-mode='${mode}']`) ?? new Map()).keys(),
      ].sort();

      expect(names, `${theme}/${mode}`).toEqual(reference);
    }
  });

  it('solo contiene literales hexadecimales', () => {
    for (const { theme, mode } of BASE_COMBINATIONS) {
      for (const [name, value] of palette.get(`[data-theme='${theme}'][data-mode='${mode}']`) ??
        []) {
        expect(parseHexColor(value), `${theme}/${mode} ${name} = ${value}`).not.toBeNull();
      }
    }
  });
});

describe('familias y variantes', () => {
  it.each(COMBINATIONS.filter(({ mode }) => mode === 'light'))(
    '$theme/$variant conserva fondos gráficos y de consola casi blancos',
    ({ theme, mode, variant }) => {
      const tokens = tokensFor(theme, mode, variant);

      for (const name of [
        '--surface-app',
        '--surface-panel',
        '--surface-raised',
        '--surface-sunken',
        '--editor-bg',
        '--editor-gutter',
        '--terminal-bg',
      ]) {
        const color = parseHexColor(tokens.get(name) ?? '');
        expect(color, `${theme}/${variant} ${name}`).not.toBeNull();
        expect(relativeLuminance(color!), `${theme}/${variant} ${name}`).toBeGreaterThanOrEqual(
          0.88,
        );
      }
    },
  );

  it.each(MODES)('%s distingue las familias por sus superficies y su acento', (mode) => {
    const signature = (theme: string, names: string[]) => {
      const tokens = tokensFor(theme, mode);
      return names.map((name) => tokens.get(name)).join('|');
    };

    expect(
      new Set(THEMES.map((theme) => signature(theme, ['--surface-app', '--surface-panel']))).size,
    ).toBe(THEMES.length);
    expect(
      new Set(THEMES.map((theme) => signature(theme, ['--accent', '--accent-secondary']))).size,
    ).toBe(THEMES.length);
  });

  it('conserva el magenta y morado de Thul', () => {
    expect(tokensFor('thul', 'dark').get('--accent')).toBe('#c24bd6');
    expect(tokensFor('thul', 'dark').get('--accent-secondary')).toBe('#7b5be0');
    expect(tokensFor('thul', 'light').get('--accent')).toBe('#8a0c9c');
    expect(tokensFor('thul', 'light').get('--accent-secondary')).toBe('#5b3fd9');
  });

  it.each(BASE_COMBINATIONS)(
    '$theme/$mode declara y distingue sus tres variantes',
    ({ theme, mode }) => {
      const signatures = new Set<string>();
      const base = tokensFor(theme, mode);
      const semanticNames = [...base.keys()].filter((name) =>
        /^--palette-(?:success|warning|danger|info|diff|conflict)(?:-|$)/.test(name),
      );

      for (const variant of THEME_VARIANTS) {
        if (variant !== 'classic') {
          const declarations = variants.get(
            `[data-theme='${theme}'][data-mode='${mode}'][data-theme-variant='${variant}']`,
          );
          expect(declarations, `${theme}/${mode}/${variant}`).toBeDefined();
          expect(declarations?.size ?? 0).toBeGreaterThan(3);

          for (const [name, value] of declarations ?? []) {
            expect(base.has(name), `${theme}/${mode}/${variant} ${name}`).toBe(true);
            expect(
              parseHexColor(value),
              `${theme}/${mode}/${variant} ${name} = ${value}`,
            ).not.toBeNull();
          }
        }

        const tokens = tokensFor(theme, mode, variant);
        signatures.add(
          ['--surface-app', '--surface-panel', '--surface-selected', '--accent']
            .map((name) => tokens.get(name))
            .join('|'),
        );
        for (const name of semanticNames) {
          expect(tokens.get(name), `${theme}/${mode}/${variant} ${name}`).toBe(base.get(name));
        }
      }

      expect(signatures.size).toBe(THEME_VARIANTS.length);
    },
  );
});

describe('roles', () => {
  it('resuelve todos los tokens de color del catálogo en todos los temas', () => {
    const names = COLOR_TOKENS.flatMap((group) => group.tokens);

    for (const { theme, mode, variant } of COMBINATIONS) {
      const tokens = tokensFor(theme, mode, variant);

      for (const name of names) {
        const value = tokens.get(name);

        expect(
          parseHexColor(value ?? ''),
          `${theme}/${mode}/${variant} ${name} = ${String(value)}`,
        ).not.toBeNull();
      }
    }
  });

  it('resuelve todos los tokens de medida del catálogo', () => {
    const tokens = tokensFor('thul', 'dark');

    for (const name of MEASURE_TOKENS.flatMap((group) => group.tokens)) {
      expect(tokens.get(name), name).toBeDefined();
    }
  });
});

describe('mapa de calor', () => {
  /** Los cinco escalones ya resueltos a literal, del vacío al máximo. */
  function heatRamp(theme: string, mode: string, variant = 'classic'): string[] {
    const tokens = tokensFor(theme, mode, variant);

    return Array.from({ length: HEAT_LEVELS }, (_, level) => tokens.get(heatToken(level)) ?? '');
  }

  it.each(COMBINATIONS)(
    '$theme/$mode/$variant da cinco escalones distintos',
    ({ theme, mode, variant }) => {
      const values = new Set(heatRamp(theme, mode, variant).map((value) => value.toLowerCase()));

      expect(values.size).toBe(HEAT_LEVELS);
    },
  );

  /*
   * En «Contraste», el nivel de un día no se puede leer solo por color.
   *
   * La regla del tema es que ningún significado viaje únicamente en el tono, y
   * un mapa de calor codifica su único dato en el relleno de un cuadro. Así que
   * la escala tiene que separarse por luminancia: cada escalón, más lejos del
   * día vacío que el anterior. Sin esto, dos niveles pueden acabar igual de
   * claros con tonos distintos y el relieve desaparece en escala de grises.
   */
  it.each(COMBINATIONS.filter(({ theme }) => theme === 'contraste'))(
    'contraste/$mode/$variant sube de luminancia en cada escalón',
    ({ mode, variant }) => {
      const ramp = heatRamp('contraste', mode, variant).map((value) => parseHexColor(value));
      const empty = ramp[0];

      expect(empty).not.toBeNull();

      const distances = ramp.map((color) =>
        color && empty ? contrastRatio(color, empty) : Number.NaN,
      );

      for (let level = 1; level < HEAT_LEVELS; level += 1) {
        const previous = distances[level - 1] ?? Number.NaN;
        const current = distances[level] ?? Number.NaN;

        expect(current, `--heat-${String(level)} sobre el día vacío`).toBeGreaterThan(previous);
      }

      // Y ningún par consecutivo tan parecido que se confundan entre sí.
      for (let level = 1; level < HEAT_LEVELS; level += 1) {
        const previous = ramp[level - 1];
        const current = ramp[level];

        expect(
          previous && current ? contrastRatio(previous, current) : 0,
          `--heat-${String(level - 1)} contra --heat-${String(level)}`,
        ).toBeGreaterThanOrEqual(MINIMUM_HEAT_STEP);
      }
    },
  );
});

describe('contraste', () => {
  it.each(COMBINATIONS)(
    '$theme/$mode/$variant cumple el mínimo en cada par',
    ({ theme, mode, variant }) => {
      const tokens = tokensFor(theme, mode, variant);
      const failures: string[] = [];

      /*
       * Los fondos translúcidos se miden ya compuestos sobre la superficie que
       * tienen detrás, que es lo que el ojo ve de verdad. Los del diff son
       * translúcidos a propósito —así se ve la selección por debajo—, y medir el
       * literal a secas daría un contraste que nadie llega a mirar.
       */
      const behind = parseHexColor(tokens.get('--surface-sunken') ?? '');

      for (const pair of CONTRAST_PAIRS) {
        const foreground = parseHexColor(tokens.get(pair.foreground) ?? '');
        const declared = parseHexColor(tokens.get(pair.background) ?? '');

        expect(foreground, `${pair.foreground} en ${theme}/${mode}/${variant}`).not.toBeNull();
        expect(declared, `${pair.background} en ${theme}/${mode}/${variant}`).not.toBeNull();
        expect(behind, `--surface-sunken en ${theme}/${mode}/${variant}`).not.toBeNull();

        if (!foreground || !declared || !behind) continue;

        const background = alphaOf(declared) < 1 ? over(declared, behind) : declared;
        const ratio = contrastRatio(foreground, background);
        const minimum = minimumFor(pair.kind, theme);

        if (ratio < minimum) {
          failures.push(
            `${pair.foreground} sobre ${pair.background}: ${ratio.toFixed(2)} < ${minimum.toFixed(1)}`,
          );
        }
      }

      expect(failures).toEqual([]);
    },
  );
});

describe('sintaxis sobre el editor real', () => {
  it.each(COMBINATIONS)(
    '$theme/$mode/$variant conserva contraste sobre líneas y palabras superpuestas',
    ({ theme, mode, variant }) => {
      const tokens = tokensFor(theme, mode, variant);
      const color = (name: string) => {
        const parsed = parseHexColor(tokens.get(name) ?? '');
        if (!parsed) throw new Error(`Falta ${name}`);
        return parsed;
      };
      const editor = color('--editor-bg');
      const backgrounds = [editor, color('--surface-hover')];
      for (const tone of ['added', 'removed']) {
        const line = over(color(`--diff-${tone}-bg`), editor);
        backgrounds.push(line, over(color(`--diff-word-${tone}-bg`), line));
      }
      for (const tone of ['ours', 'theirs', 'both', 'auto']) {
        backgrounds.push(over(color(`--conflict-${tone}-bg`), editor));
      }
      const syntax = [
        'keyword',
        'string',
        'function',
        'number',
        'type',
        'annotation',
        'property',
        'comment',
      ];
      expect(new Set(syntax.map((tone) => tokens.get(`--syntax-${tone}`))).size).toBe(
        syntax.length,
      );
      for (const tone of syntax) {
        for (const background of backgrounds) {
          expect(contrastRatio(color(`--syntax-${tone}`), background), tone).toBeGreaterThanOrEqual(
            minimumFor('text', theme),
          );
        }
      }
    },
  );
});

describe('tema Contraste', () => {
  it('distingue las ocho ramas sin recurrir al color', () => {
    const tokens = tokensFor('contraste', 'dark');
    const signatures = new Set<string>();

    for (let branch = 1; branch <= GRAPH_BRANCH_COUNT; branch += 1) {
      const { color, dash, shape } = graphBranchTokens(branch);

      signatures.add(
        `${tokens.get(dash) ?? ''}|${tokens.get(shape) ?? ''}|${tokens.get(color) ?? ''}`,
      );
    }

    expect(signatures.size).toBe(GRAPH_BRANCH_COUNT);
  });

  it('no atenúa por alfa ni usa sombras como jerarquía', () => {
    const tokens = tokensFor('contraste', 'dark');

    expect(tokens.get('--disabled-opacity')).toBe('1');
    expect(tokens.get('--blocked-surface-opacity')).toBe('1');
    expect(tokensFor('thul', 'dark').get('--blocked-surface-opacity')).toBe('0.25');
    expect(tokens.get('--disabled-pattern')).not.toBe('none');
    expect(tokens.get('--shadow-raised')).toBe('none');
    expect(tokens.get('--shadow-overlay')).toBe('none');
  });

  it('sube el anillo de foco a 3 px', () => {
    expect(tokensFor('contraste', 'dark').get('--focus-ring-width')).toBe('3px');
    expect(tokensFor('thul', 'dark').get('--focus-ring-width')).toBe('2px');
  });

  /*
   * Las vistas previas de Apariencia se pintan poniendo `data-theme` a un
   * subárbol. Eso solo funciona si la capa de roles se declara también ahí: un
   * rol se calcula donde se declara, así que con la capa solo en `:root` el
   * subárbol heredaría los colores del tema activo y la vista previa enseñaría
   * el tema equivocado sin avisar de nada. Si esta prueba se pone roja, las
   * vistas previas se apagaron.
   */
  it('declara la capa entera también para cualquier elemento con data-theme', () => {
    const root = roles.get(':root');
    const scoped = roles.get('[data-theme]');

    expect([...(scoped ?? new Map()).keys()].sort()).toEqual(
      [...(root ?? new Map()).keys()].sort(),
    );

    for (const [name, value] of root ?? []) expect(scoped?.get(name), name).toBe(value);
  });
});

describe('densidad', () => {
  it('define las tres densidades con el mismo juego de variables', () => {
    const reference = [...(density.get(`[data-density='compact']`) ?? new Map()).keys()].sort();

    expect(reference.length).toBeGreaterThan(15);

    for (const value of DENSITIES) {
      const selector = value === 'cozy' ? ':root' : `[data-density='${value}']`;

      expect([...(density.get(selector) ?? new Map()).keys()].sort(), value).toEqual(reference);
    }
  });
});

describe('tipografía', () => {
  /*
   * Por atributo y no solo en `:root`, porque las fichas de espécimen de
   * Apariencia se pintan cada una en su familia poniéndose el atributo: si la
   * de fábrica solo viviera en `:root`, su ficha saldría con la fuente activa y
   * el espécimen mentiría.
   */
  it('da una familia a cada opción de interfaz y de visores, seleccionable por atributo', () => {
    for (const font of UI_FONTS) {
      expect(
        typography.get(`[data-font-ui='${font}']`)?.get('--font-family-ui'),
        font,
      ).toBeDefined();
    }

    for (const font of CODE_FONTS) {
      expect(
        typography.get(`[data-font-code='${font}']`)?.get('--font-family-code'),
        font,
      ).toBeDefined();
    }
  });

  it('deriva las dos escalas de su propio ajuste, sin mezclarlas', () => {
    const root = typography.get(':root');

    expect(root?.get('--font-size-ui')).toBeDefined();
    expect(root?.get('--font-size-code')).toBeDefined();

    for (const [name, value] of root ?? []) {
      if (name.startsWith('--text-')) expect(value, name).toContain('--font-size-ui');
      if (name.startsWith('--code-size-')) expect(value, name).toContain('--font-size-code');
    }
  });

  /*
   * La maqueta de Apariencia fija su propio tamaño y necesita que la escala se
   * recalcule ahí; con la escala solo en `:root` heredaría la ya resuelta y la
   * vista previa no movería una letra. Si esta prueba se pone roja, la maqueta
   * dejó de enseñar el tamaño.
   */
  it('declara la escala también para cualquier elemento con data-type-scale', () => {
    const root = typography.get(':root') ?? new Map<string, string>();
    const scoped = typography.get('[data-type-scale]') ?? new Map<string, string>();
    const derived = [...root.keys()].filter(
      (name) => name.startsWith('--text-') || name.startsWith('--code-size-'),
    );

    expect(derived.length).toBeGreaterThan(5);

    for (const name of derived) expect(scoped.get(name), name).toBe(root.get(name));
  });
});

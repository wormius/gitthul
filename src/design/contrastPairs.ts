/**
 * Los pares texto/fondo que todo tema debe cumplir.
 *
 * Se escriben con roles, no con literales, para que valgan igual en los seis
 * temas. `tokens.test.ts` los mide sobre el CSS de verdad y la galería los
 * muestra en vivo; la lista es la misma en los dos sitios a propósito.
 *
 * Mínimos: 4.5:1 en texto y 3:1 en elementos gráficos, salvo en «Contraste»,
 * donde el plan sube a 7:1 el texto y a 4.5:1 los bordes e iconos.
 */

export interface ContrastPair {
  foreground: string;
  background: string;
  kind: 'text' | 'graphic';
}

export const CONTRAST_MINIMUMS = {
  text: 4.5,
  graphic: 3,
  contrasteText: 7,
  contrasteGraphic: 4.5,
} as const;

export function minimumFor(kind: ContrastPair['kind'], theme: string): number {
  if (theme === 'contraste') {
    return kind === 'text' ? CONTRAST_MINIMUMS.contrasteText : CONTRAST_MINIMUMS.contrasteGraphic;
  }

  return kind === 'text' ? CONTRAST_MINIMUMS.text : CONTRAST_MINIMUMS.graphic;
}

const SURFACES = [
  '--surface-app',
  '--surface-panel',
  '--surface-raised',
  '--surface-sunken',
] as const;

const ROW_SURFACES = [...SURFACES, '--surface-hover', '--surface-active', '--surface-selected'];

const TINTED_SURFACES = [
  '--accent-wash',
  '--surface-success',
  '--surface-warning',
  '--surface-danger',
  '--surface-info',
  '--diff-added-bg',
  '--diff-removed-bg',
  '--diff-word-added-bg',
  '--diff-word-removed-bg',
  '--conflict-ours-bg',
  '--conflict-theirs-bg',
  '--conflict-both-bg',
  '--conflict-auto-bg',
];

function pairs(
  foreground: string,
  backgrounds: readonly string[],
  kind: ContrastPair['kind'] = 'text',
): ContrastPair[] {
  return backgrounds.map((background) => ({ foreground, background, kind }));
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...[
    'foreground',
    'muted',
    'prompt',
    'info',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'bright-black',
    'bright-red',
    'bright-green',
    'bright-yellow',
    'bright-blue',
    'bright-magenta',
    'bright-cyan',
    'bright-white',
  ].flatMap((tone) => pairs(`--terminal-${tone}`, ['--terminal-bg'])),
  ...['foreground', 'muted', 'prompt', 'info'].flatMap((tone) =>
    pairs(`--terminal-${tone}`, ['--terminal-selection']),
  ),
  ...[
    'keyword',
    'string',
    'function',
    'number',
    'annotation',
    'type',
    'property',
    'comment',
  ].flatMap((tone) =>
    pairs(`--syntax-${tone}`, [
      '--editor-bg',
      '--surface-hover',
      ...TINTED_SURFACES.filter(
        (surface) => surface.startsWith('--diff-') || surface.startsWith('--conflict-'),
      ),
    ]),
  ),
  ...pairs('--text-primary', ['--editor-bg']),
  ...pairs('--text-muted', ['--editor-gutter']),
  ...pairs('--text-primary', [...ROW_SURFACES, ...TINTED_SURFACES]),
  ...pairs('--text-secondary', ROW_SURFACES),
  ...pairs('--text-muted', SURFACES),
  ...pairs('--text-accent', [...SURFACES, '--accent-wash']),
  ...pairs('--text-on-accent', ['--accent', '--accent-hover', '--accent-active']),
  ...pairs('--text-success', ['--surface-app', '--surface-panel', '--surface-success']),
  ...pairs('--text-warning', ['--surface-app', '--surface-panel', '--surface-warning']),
  ...pairs('--text-danger', ['--surface-app', '--surface-panel', '--surface-danger']),
  ...pairs('--text-info', ['--surface-app', '--surface-panel', '--surface-info']),
  ...pairs('--diff-added-ink', ['--diff-added-bg']),
  ...pairs('--diff-removed-ink', ['--diff-removed-bg']),

  ...pairs('--border-strong', ['--surface-app', '--surface-panel', '--surface-raised'], 'graphic'),
  ...pairs('--accent', ['--surface-app', '--surface-panel'], 'graphic'),
  ...pairs('--focus-ring-color', ['--surface-app', '--surface-panel'], 'graphic'),
  ...pairs('--graph-wip-node', ['--surface-app', '--surface-panel'], 'graphic'),
  ...Array.from({ length: 8 }, (_, i) =>
    pairs(`--graph-branch-${String(i + 1)}`, ['--surface-app', '--surface-panel'], 'graphic'),
  ).flat(),
  ...Array.from({ length: 16 }, (_, i) =>
    pairs('--text-on-accent', [`--avatar-tone-${String(i + 1)}`]),
  ).flat(),
];

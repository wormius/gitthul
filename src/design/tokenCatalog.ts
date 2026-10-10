/**
 * Catálogo de la capa 2: todos los roles que un componente puede usar.
 *
 * Es la superficie pública del sistema de diseño. La galería lo recorre para
 * pintarse sola y la prueba de tokens lo recorre para exigir que cada rol
 * resuelva en los siete temas: añadir un rol a `roles.css` y olvidarlo aquí lo
 * deja invisible, y añadirlo aquí sin definirlo rompe la prueba.
 */

export interface TokenGroup {
  title: string;
  /** `color` se pinta como muestra; `value` se enseña como texto. */
  kind: 'color' | 'value';
  tokens: readonly string[];
}

export const COLOR_TOKENS: readonly TokenGroup[] = [
  {
    title: 'Terminal',
    kind: 'color',
    tokens: [
      '--terminal-bg',
      '--terminal-foreground',
      '--terminal-prompt',
      '--terminal-muted',
      '--terminal-info',
      '--terminal-selection',
      '--terminal-black',
      '--terminal-red',
      '--terminal-green',
      '--terminal-yellow',
      '--terminal-blue',
      '--terminal-magenta',
      '--terminal-cyan',
      '--terminal-white',
      '--terminal-bright-black',
      '--terminal-bright-red',
      '--terminal-bright-green',
      '--terminal-bright-yellow',
      '--terminal-bright-blue',
      '--terminal-bright-magenta',
      '--terminal-bright-cyan',
      '--terminal-bright-white',
    ],
  },
  {
    title: 'Editor y sintaxis',
    kind: 'color',
    tokens: [
      '--editor-bg',
      '--editor-gutter',
      '--syntax-keyword',
      '--syntax-string',
      '--syntax-function',
      '--syntax-number',
      '--syntax-annotation',
      '--syntax-type',
      '--syntax-property',
      '--syntax-comment',
    ],
  },
  {
    title: 'Superficies',
    kind: 'color',
    tokens: [
      '--surface-app',
      '--surface-panel',
      '--surface-raised',
      '--surface-sunken',
      '--surface-hover',
      '--surface-active',
      '--surface-selected',
    ],
  },
  {
    title: 'Texto',
    kind: 'color',
    tokens: [
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--text-disabled',
      '--text-accent',
      '--text-on-accent',
      '--text-success',
      '--text-warning',
      '--text-danger',
      '--text-info',
    ],
  },
  {
    title: 'Bordes',
    kind: 'color',
    tokens: [
      '--border-subtle',
      '--border-strong',
      '--border-accent',
      '--border-success',
      '--border-warning',
      '--border-danger',
      '--border-info',
    ],
  },
  {
    title: 'Acento',
    kind: 'color',
    tokens: [
      '--accent',
      '--accent-hover',
      '--accent-active',
      '--accent-wash',
      '--accent-secondary',
    ],
  },
  {
    title: 'Fondos de estado',
    kind: 'color',
    tokens: ['--surface-success', '--surface-warning', '--surface-danger', '--surface-info'],
  },
  {
    title: 'Ramas del grafo',
    kind: 'color',
    tokens: [
      '--graph-branch-1',
      '--graph-branch-2',
      '--graph-branch-3',
      '--graph-branch-4',
      '--graph-branch-5',
      '--graph-branch-6',
      '--graph-branch-7',
      '--graph-branch-8',
      '--graph-wip',
      '--graph-wip-node',
      '--graph-stash',
    ],
  },
  {
    title: 'Tonos de avatar',
    kind: 'color',
    tokens: [
      '--avatar-tone-1',
      '--avatar-tone-2',
      '--avatar-tone-3',
      '--avatar-tone-4',
      '--avatar-tone-5',
      '--avatar-tone-6',
      '--avatar-tone-7',
      '--avatar-tone-8',
      '--avatar-tone-9',
      '--avatar-tone-10',
      '--avatar-tone-11',
      '--avatar-tone-12',
      '--avatar-tone-13',
      '--avatar-tone-14',
      '--avatar-tone-15',
      '--avatar-tone-16',
    ],
  },
  {
    title: 'Actividad',
    kind: 'color',
    tokens: ['--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4'],
  },
  {
    title: 'Diff y conflictos',
    kind: 'color',
    tokens: [
      '--diff-added-bg',
      '--diff-removed-bg',
      '--diff-added-ink',
      '--diff-removed-ink',
      '--diff-word-added-bg',
      '--diff-word-removed-bg',
      '--conflict-ours-ink',
      '--conflict-theirs-ink',
      '--conflict-ours-bg',
      '--conflict-theirs-bg',
      '--conflict-both-bg',
      '--conflict-auto-bg',
    ],
  },
];

export const MEASURE_TOKENS: readonly TokenGroup[] = [
  {
    title: 'Espaciado',
    kind: 'value',
    tokens: [
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-7',
    ],
  },
  {
    title: 'Altos',
    kind: 'value',
    tokens: [
      '--control-height-sm',
      '--control-height-md',
      '--control-height-lg',
      '--row-height',
      '--row-height-lg',
    ],
  },
  {
    title: 'Iconos y radios',
    kind: 'value',
    tokens: [
      '--icon-sm',
      '--icon-md',
      '--icon-lg',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-pill',
    ],
  },
  {
    title: 'Grafo',
    kind: 'value',
    tokens: [
      '--graph-lane-width',
      '--graph-node-radius',
      // El nodo-avatar no es el doble del radio: un avatar de diez píxeles no se
      // ve. Cabe dentro de `--row-height` sin hacerla crecer — sección 4.3.
      '--graph-node-avatar',
      '--graph-line-width',
      '--graph-corner-radius',
    ],
  },
  {
    title: 'Estructura y actividad',
    kind: 'value',
    tokens: [
      '--divider-thickness',
      '--heat-cell-size',
      '--heat-cell-gap',
      // Las asas del borde de la ventana: sin decoración del sistema, el único
      // sitio por el que se redimensiona.
      '--window-grip',
      '--window-grip-corner',
    ],
  },
  {
    title: 'Capas',
    kind: 'value',
    tokens: ['--z-raised', '--z-modal', '--z-toast', '--z-overlay', '--z-tooltip'],
  },
  {
    title: 'Foco y movimiento',
    kind: 'value',
    tokens: [
      '--focus-ring-width',
      '--focus-ring-offset',
      '--duration-instant',
      '--duration-fast',
      '--duration-slow',
    ],
  },
];

/** Escalones del mapa de calor, del vacío al máximo. */
export const HEAT_LEVELS = 5;

export function heatToken(level: number): string {
  return `--heat-${String(level)}`;
}

/** Trazo y forma del nodo: los otros dos portadores de significado del grafo. */
export const GRAPH_BRANCH_COUNT = 8;

export function graphBranchTokens(index: number): {
  color: string;
  dash: string;
  shape: string;
} {
  return {
    color: `--graph-branch-${String(index)}`,
    dash: `--graph-dash-${String(index)}`,
    shape: `--graph-shape-${String(index)}`,
  };
}

/** Cuántos tonos de avatar independientes hay. */
export const AVATAR_TONE_COUNT = 16;

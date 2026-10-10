import type { HeatmapDay } from '../heatmap';
import type { TreeNode } from '../tree';

/**
 * Datos de mentira para la galería de F0.6.
 *
 * Nada de esto pretende parecerse al adaptador falso que llega en F0.8: aquí
 * solo hace falta volumen suficiente para que la virtualización tenga algo que
 * virtualizar y para que las formas de cada primitivo se vean.
 */

export interface DemoCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
  lane: number;
}

const SUBJECTS = [
  'F0.6: primitivos de estructura y datos',
  'fix: la cabecera ya no se despega al hacer scroll',
  'docs: nota sobre la expansión encadenada',
  'F0.5: primitivos de superposición y navegación',
  'chore: subir @tanstack/react-virtual',
  'fix: el divisor respeta los mínimos de ambos paneles',
  'F0.4: primitivos de controles',
];

const AUTHORS = ['alex', 'ada', 'grace', 'linus'];

export function demoCommits(count: number): DemoCommit[] {
  const commits: DemoCommit[] = [];
  const start = Date.UTC(2026, 6, 26);

  for (let index = 0; index < count; index += 1) {
    commits.push({
      // 7919 es impar, así que multiplicarlo y quedarse con siete dígitos
      // hexadecimales no repite ningún SHA en los primeros 2^28 commits.
      sha: ((0x1000000 + index * 7919) % 0x10000000).toString(16).padStart(7, '0'),
      subject: SUBJECTS[index % SUBJECTS.length] ?? '',
      author: AUTHORS[index % AUTHORS.length] ?? '',
      date: new Date(start - index * 3600_000).toISOString().slice(0, 10),
      lane: index % 5,
    });
  }

  return commits;
}

/** Cadena de carpetas de hijo único a propósito, para ver la fusión de filas. */
export const demoTree: readonly TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    children: [
      {
        id: 'src/ui',
        label: 'ui',
        children: [
          { id: 'src/ui/SplitPane.tsx', label: 'SplitPane.tsx' },
          { id: 'src/ui/DataGrid.tsx', label: 'DataGrid.tsx' },
          {
            id: 'src/ui/gallery',
            label: 'gallery',
            children: [
              { id: 'src/ui/gallery/StructureGallery.tsx', label: 'StructureGallery.tsx' },
            ],
          },
        ],
      },
      {
        id: 'src/core',
        label: 'core',
        children: [
          {
            id: 'src/core/adapters',
            label: 'adapters',
            children: [
              {
                id: 'src/core/adapters/mock',
                label: 'mock',
                children: [{ id: 'src/core/adapters/mock/repo.ts', label: 'repo.ts' }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'docs',
    label: 'docs',
    children: [
      { id: 'docs/plan.md', label: 'plan.md' },
      { id: 'docs/inventario.md', label: 'inventario.md' },
    ],
  },
  { id: 'CLAUDE.md', label: 'CLAUDE.md' },
];

/** Un año de actividad con rachas y huecos, que es lo que enseña el relieve. */
export function demoActivity(): HeatmapDay[] {
  const days: HeatmapDay[] = [];
  const end = Date.UTC(2026, 6, 26);

  for (let back = 380; back >= 0; back -= 1) {
    const date = new Date(end - back * 86_400_000);
    const weekday = date.getUTCDay();
    const wave = Math.sin(back / 23) + Math.sin(back / 7);
    const weekend = weekday === 0 || weekday === 6;
    const value = Math.max(0, Math.round((wave + 1.2) * (weekend ? 1.5 : 5)));

    days.push({ date: date.toISOString().slice(0, 10), value });
  }

  return days;
}

export const OURS_LINES = [
  'export function merge(base, ours, theirs) {',
  '  const result = [];',
  '',
  '  for (const hunk of hunks(base, ours)) {',
  '    result.push(resolve(hunk));',
  '  }',
  '',
  '  return result;',
  '}',
];

export const THEIRS_LINES = [
  'export function merge(base, ours, theirs) {',
  '  const result = [];',
  '',
  '  for (const hunk of hunks(base, theirs)) {',
  '    if (hunk.trivial) continue;',
  '    result.push(resolve(hunk));',
  '  }',
  '',
  '  return result;',
  '}',
];

import { describe, expect, it } from 'vitest';

import { countLeaves, flattenTree, type TreeNode } from './tree';

const nodes: readonly TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    children: [
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
                children: [
                  { id: 'src/core/adapters/mock/repo.ts', label: 'repo.ts' },
                  { id: 'src/core/adapters/mock/latency.ts', label: 'latency.ts' },
                ],
              },
            ],
          },
        ],
      },
      { id: 'src/main.tsx', label: 'main.tsx' },
    ],
  },
  { id: 'CLAUDE.md', label: 'CLAUDE.md' },
];

const labels = (rows: { label: string }[]) => rows.map((row) => row.label);

describe('flattenTree', () => {
  it('con todo plegado enseña solo la raíz', () => {
    const rows = flattenTree(nodes, new Set());

    expect(labels(rows)).toEqual(['src', 'CLAUDE.md']);
    expect(rows[0]?.hasChildren).toBe(true);
    expect(rows[1]?.hasChildren).toBe(false);
  });

  it('funde la cadena de carpetas de hijo único en una sola fila', () => {
    const rows = flattenTree(nodes, new Set(['src']));

    // `core`, `adapters` y `mock` no aportan nada por separado: una sola fila.
    expect(labels(rows)).toEqual(['src', 'core/adapters/mock', 'main.tsx', 'CLAUDE.md']);
  });

  it('la fila fusionada se expande por el identificador de la carpeta más profunda', () => {
    const rows = flattenTree(nodes, new Set(['src', 'src/core/adapters/mock']));

    expect(labels(rows)).toEqual([
      'src',
      'core/adapters/mock',
      'repo.ts',
      'latency.ts',
      'main.tsx',
      'CLAUDE.md',
    ]);
    expect(rows[2]?.depth).toBe(2);
  });

  it('sin encadenar, cada carpeta ocupa su propia fila', () => {
    const rows = flattenTree(nodes, new Set(['src', 'src/core']), { chainSingleChild: false });

    expect(labels(rows)).toEqual(['src', 'core', 'adapters', 'main.tsx', 'CLAUDE.md']);
  });

  it('cuenta las hojas de cada carpeta para poder enseñarlo al plegar', () => {
    const rows = flattenTree(nodes, new Set());

    expect(rows[0]?.leafCount).toBe(3);
    expect(countLeaves({ id: 'vacía', label: 'vacía', children: [] })).toBe(0);
  });

  it('numera los hermanos para el lector de pantalla', () => {
    const rows = flattenTree(nodes, new Set());

    expect(rows.map((row) => `${String(row.posInSet)}/${String(row.setSize)}`)).toEqual([
      '1/2',
      '2/2',
    ]);
  });

  it('una carpeta con un único hijo que es archivo no se funde con él', () => {
    const single: TreeNode[] = [
      { id: 'docs', label: 'docs', children: [{ id: 'docs/plan.md', label: 'plan.md' }] },
    ];

    expect(labels(flattenTree(single, new Set(['docs'])))).toEqual(['docs', 'plan.md']);
  });
});

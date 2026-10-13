import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { useVirtualViewport } from '../test/virtualViewport';
import { Tree } from './Tree';
import type { TreeNode } from './treeUtils';

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
            id: 'src/core/ports',
            label: 'ports',
            children: [{ id: 'src/core/ports/GitPort.ts', label: 'GitPort.ts' }],
          },
        ],
      },
      { id: 'src/main.tsx', label: 'main.tsx' },
    ],
  },
  { id: 'CLAUDE.md', label: 'CLAUDE.md' },
];

function Harness({
  initialExpanded = [],
  initialSelected = [],
  ...rest
}: { initialExpanded?: string[]; initialSelected?: string[] } & Partial<
  Parameters<typeof Tree>[0]
>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialSelected));

  return (
    <Tree
      nodes={nodes}
      label="Archivos cambiados"
      expanded={expanded}
      onExpandedChange={setExpanded}
      selectionMode="multiple"
      selected={selected}
      onSelectedChange={setSelected}
      {...rest}
    />
  );
}

const tree = () => screen.getByRole('tree', { name: 'Archivos cambiados' });

describe('Tree', () => {
  useVirtualViewport();

  it('arranca plegado y anuncia qué filas se pueden abrir', () => {
    render(<Harness />);

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('treeitem', { name: 'CLAUDE.md' })).not.toHaveAttribute(
      'aria-expanded',
    );
  });

  it('el triángulo abre la carpeta sin cambiar la selección', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('treeitem', { name: /^src/ }).firstElementChild!);

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('treeitem').every((row) => row.ariaSelected !== 'true')).toBe(true);
  });

  it('un clic sobre la fila alterna una carpeta abierta o cerrada', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const folder = screen.getByRole('treeitem', { name: /^src/ });

    await user.click(folder);
    expect(folder).toHaveAttribute('aria-expanded', 'true');

    await user.click(folder);
    expect(folder).toHaveAttribute('aria-expanded', 'false');
  });

  it('el nombre de la carpeta pliega igual que la flecha, sin cambiar la selección', async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();

    render(
      <Harness
        initialExpanded={['src', 'src/core/ports']}
        initialSelected={['CLAUDE.md']}
        onSelectedChange={onSelectedChange}
      />,
    );

    await user.click(screen.getByText('core/ports'));

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'core/ports' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('treeitem', { name: 'CLAUDE.md' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(onSelectedChange).not.toHaveBeenCalled();

    await user.click(screen.getByText('core/ports'));

    expect(screen.getByRole('treeitem', { name: 'core/ports' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: 'GitPort.ts' })).toBeInTheDocument();
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it('funde la cadena de carpetas de hijo único en una fila', () => {
    render(<Harness initialExpanded={['src']} />);

    expect(screen.getByRole('treeitem', { name: /core\/ports/ })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: /^ports/ })).not.toBeInTheDocument();
  });

  it('sin encadenar, cada carpeta ocupa su fila', () => {
    render(<Harness initialExpanded={['src']} chainSingleChild={false} />);

    expect(screen.getByRole('treeitem', { name: /^core/ })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: /core\/ports/ })).not.toBeInTheDocument();
  });

  it('anuncia el nivel de cada fila para el lector de pantalla', () => {
    render(<Harness initialExpanded={['src']} />);

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute('aria-level', '1');
    expect(screen.getByRole('treeitem', { name: 'main.tsx' })).toHaveAttribute('aria-level', '2');
  });

  it('las flechas laterales abren, cierran y suben al padre', () => {
    render(<Harness />);

    fireEvent.keyDown(tree(), { key: 'ArrowRight' });

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });

    // En una hoja o en una carpeta cerrada, la izquierda sube al padre.
    const active = tree().getAttribute('aria-activedescendant');

    expect(document.getElementById(active ?? '')).toHaveAttribute('aria-level', '1');
  });

  it('recorre varias filas seguidas y continúa después de plegar', () => {
    render(<Harness initialExpanded={['src']} />);

    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    fireEvent.keyDown(tree(), { key: 'ArrowUp' });
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });

    const active = tree().getAttribute('aria-activedescendant');

    expect(document.getElementById(active ?? '')).toHaveTextContent('CLAUDE.md');
  });

  it('sube y baja desde la fila que ya estaba seleccionada', () => {
    render(<Harness initialExpanded={['src']} initialSelected={['src/main.tsx']} />);

    fireEvent.keyDown(tree(), { key: 'ArrowUp' });

    const active = tree().getAttribute('aria-activedescendant');

    expect(document.getElementById(active ?? '')).toHaveTextContent('core/ports');
  });

  it('atraviesa carpetas aunque el consumidor solo conserve hojas seleccionadas', () => {
    const mixed: readonly TreeNode[] = [
      { id: 'before', label: 'before' },
      {
        id: 'folder',
        label: 'folder',
        children: [{ id: 'inside', label: 'inside' }],
      },
      { id: 'after', label: 'after' },
    ];

    function LeavesOnly() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(['before']));

      return (
        <Tree
          nodes={mixed}
          label="Ramas"
          expanded={new Set(['folder'])}
          onExpandedChange={() => {}}
          selectionMode="single"
          selected={selected}
          onSelectedChange={(next) => {
            const id = [...next][0];

            if (id !== 'folder') setSelected(next);
          }}
        />
      );
    }

    render(<LeavesOnly />);
    const branches = screen.getByRole('tree', { name: 'Ramas' });

    fireEvent.keyDown(branches, { key: 'ArrowDown' });
    fireEvent.keyDown(branches, { key: 'ArrowDown' });

    const active = branches.getAttribute('aria-activedescendant');

    expect(document.getElementById(active ?? '')).toHaveTextContent('inside');
    expect(screen.getByRole('treeitem', { name: 'inside' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Enter abre la carpeta y activa el archivo', () => {
    const onActivate = vi.fn();

    render(<Harness initialExpanded={['src']} onActivate={onActivate} />);

    fireEvent.keyDown(tree(), { key: 'Enter' });

    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.keyDown(tree(), { key: 'End' });
    fireEvent.keyDown(tree(), { key: 'Enter' });

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('Ctrl y Mayús seleccionan igual que en la lista', () => {
    render(<Harness initialExpanded={['src']} />);

    fireEvent.mouseDown(screen.getByRole('treeitem', { name: 'main.tsx' }));
    fireEvent.mouseDown(screen.getByRole('treeitem', { name: 'CLAUDE.md' }), { ctrlKey: true });

    expect(screen.getByRole('treeitem', { name: 'main.tsx' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: 'CLAUDE.md' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('deja pintar la fila a quien lo consume, con su conteo al plegar', () => {
    render(
      <Harness
        renderNode={(row) => (
          <span>
            {row.label}
            {row.hasChildren && !row.expanded ? ` (${String(row.leafCount)})` : ''}
          </span>
        )}
      />,
    );

    expect(screen.getByRole('treeitem', { name: 'src (2)' })).toBeInTheDocument();
  });

  it('sin nodos pinta el estado vacío', () => {
    render(<Harness nodes={[]} empty={<p>Sin archivos en conflicto</p>} />);

    expect(screen.getByText('Sin archivos en conflicto')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Harness />);

    expectNoHoverShift(tree());
  });
});

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { useVirtualViewport } from '../test/virtualViewport';
import type { DataGridColumn } from './dataGridUtils';
import { DataGrid } from './DataGrid';
import { DataGridCell } from './DataGridCell';
import { DataGridRow } from './DataGridRow';
import { PaneStorageContext, type PaneSizeStore } from './paneStorage';
import { VirtualList } from './VirtualList';

interface Commit {
  sha: string;
  subject: string;
}

const commits: Commit[] = Array.from({ length: 40 }, (_, index) => ({
  sha: `sha-${String(index)}`,
  subject: `Commit número ${String(index)}`,
}));

const columns: readonly DataGridColumn[] = [
  {
    key: 'graph',
    header: 'Grafo',
    name: 'Grafo',
    width: 120,
    hideable: false,
    contentWidth: 400,
    resizeLabel: 'Ancho de la columna del grafo',
  },
  {
    key: 'subject',
    header: 'Mensaje',
    name: 'Mensaje',
    width: 200,
    resizeLabel: 'Ancho de la columna del mensaje',
  },
  { key: 'sha', header: 'SHA', name: 'SHA', width: 90, resizeLabel: 'Ancho de la columna del SHA' },
];

function Grid(props: Partial<Parameters<typeof DataGrid>[0]> = {}) {
  return (
    <DataGrid
      columns={columns}
      label="Commits de gitthul"
      rowCount={commits.length}
      columnsMenuLabel="Columnas de la tabla de commits"
      columnScrollLabel="Desplazamiento horizontal del grafo"
      {...props}
    >
      <VirtualList<Commit>
        items={commits}
        getKey={(commit) => commit.sha}
        label="Commits de gitthul"
        semantics="rowgroup"
        renderRow={(commit, context) => (
          <DataGridRow index={context.index}>
            <DataGridCell columnKey="graph">
              <span>calles</span>
            </DataGridCell>
            <DataGridCell columnKey="subject">{commit.subject}</DataGridCell>
            <DataGridCell columnKey="sha">{commit.sha}</DataGridCell>
          </DataGridRow>
        )}
      />
    </DataGrid>
  );
}

const grid = () => screen.getByRole('grid', { name: 'Commits de gitthul' });

describe('DataGrid', () => {
  useVirtualViewport();

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('publica sus columnas y el total de filas, no solo las montadas', () => {
    render(<Grid />);

    expect(grid()).toHaveAttribute('aria-colcount', '3');
    // Cuarenta commits más la fila de cabecera.
    expect(grid()).toHaveAttribute('aria-rowcount', '41');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('la cabecera vive fuera del contenedor que hace scroll', () => {
    render(<Grid />);

    const header = screen.getByRole('columnheader', { name: /Mensaje/ });
    const [headerGroup, bodyGroup] = screen.getAllByRole('rowgroup');

    expect(headerGroup).toContainElement(header);
    expect(bodyGroup).not.toContainElement(header);
    expect(bodyGroup).toContainElement(screen.getAllByRole('row').at(-1) ?? null);
  });

  it('las celdas se alinean con la cabecera por la misma rejilla', () => {
    render(<Grid />);

    const headerRow = screen.getByRole('columnheader', { name: /Mensaje/ }).parentElement;
    const firstRow = screen.getAllByRole('row').at(-1);

    expect(headerRow?.style.gridTemplateColumns).toBe(firstRow?.style.gridTemplateColumns);
  });

  it('las flechas cambian el ancho de una columna sin ratón', () => {
    render(<Grid />);

    const resizer = screen.getByRole('separator', { name: 'Ancho de la columna del mensaje' });

    expect(resizer).toHaveAttribute('aria-valuenow', '200');

    fireEvent.keyDown(resizer, { key: 'ArrowRight' });

    expect(resizer).toHaveAttribute('aria-valuenow', '208');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });

    expect(resizer).toHaveAttribute('aria-valuenow', '192');
  });

  it('el ancho nunca baja del mínimo de la columna', () => {
    render(
      <Grid columns={[{ key: 'sha', header: 'SHA', name: 'SHA', width: 90, minWidth: 80 }]} />,
    );

    const resizer = screen.getByRole('separator', { name: 'SHA' });

    for (let step = 0; step < 10; step += 1) fireEvent.keyDown(resizer, { key: 'ArrowLeft' });

    expect(resizer).toHaveAttribute('aria-valuenow', '80');
  });

  const flexibleColumns: readonly DataGridColumn[] = [
    columns[0]!,
    { ...columns[1]!, grow: true },
    { key: 'author', header: 'Autor', name: 'Autor', width: 110 },
    { key: 'date', header: 'Fecha', name: 'Fecha', width: 150 },
    columns[2]!,
  ];

  it('se ajusta al panel cuando cambia su tamaño y mantiene el borde exterior fijo', () => {
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          callbacks.set(element, this.callback);
        }
        unobserve(element: Element) {
          callbacks.delete(element);
        }
        disconnect() {}
      },
    );
    try {
      render(<Grid columns={flexibleColumns} />);
      const header = screen.getByRole('columnheader', { name: /Mensaje/ }).parentElement!;
      const changeWidth = (width: number) =>
        act(() => {
          callbacks.get(header)!(
            [
              {
                target: header,
                contentRect: { width } as DOMRectReadOnly,
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            {} as ResizeObserver,
          );
        });
      changeWidth(970);
      expect(header.style.gridTemplateColumns).toBe('120px 500px 110px 150px 90px');
      expect(
        screen.queryByRole('separator', { name: 'Ancho de la columna del SHA' }),
      ).not.toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('separator', { name: 'Fecha' }), { key: 'ArrowRight' });
      changeWidth(600);
      const sum = header.style.gridTemplateColumns
        .split(' ')
        .reduce((total, value) => total + parseFloat(value), 0);
      expect(sum).toBeCloseTo(600);
      expect(screen.getAllByRole('row').at(-1)?.style.gridTemplateColumns).toBe(
        header.style.gridTemplateColumns,
      );
      changeWidth(1000);
      expect(header.style.gridTemplateColumns).toBe('120px 530px 110px 158px 82px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['Mensaje', 'Ancho de la columna del mensaje', '120px 540px 70px 150px 90px'],
    ['Autor', 'Autor', '120px 500px 150px 110px 90px'],
    ['Fecha', 'Fecha', '120px 500px 110px 190px 50px'],
  ])('arrastra el borde derecho de %s manteniendo su borde izquierdo', (_name, label, template) => {
    render(<Grid columns={flexibleColumns} />);
    const subject = screen.getByRole('columnheader', { name: /Mensaje/ });
    vi.spyOn(subject, 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect);
    const headerRow = subject.parentElement!;
    Object.defineProperty(headerRow, 'clientWidth', { get: () => 970 });
    expect(headerRow.style.gridTemplateColumns).toBe('120px minmax(0, 1fr) 110px 150px 90px');

    const resizer = screen.getByRole('separator', { name: label });
    Object.assign(resizer, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { clientX, button: 0, pointerId: 1 });
      fireEvent(resizer, event);
    };
    pointer('pointerdown', 800);
    pointer('pointermove', 840);
    pointer('pointerup', 840);

    expect(headerRow.style.gridTemplateColumns).toBe(template);
    expect(screen.getAllByRole('row').at(-1)?.style.gridTemplateColumns).toBe(template);
    expect(grid().style.minWidth).toBe('');
    pointer('pointermove', 900);
    expect(headerRow.style.gridTemplateColumns).toBe(template);
  });

  it('ajusta Mensaje con el teclado desde su ancho visible y restaura el reparto flexible', async () => {
    const user = userEvent.setup();
    render(<Grid columns={flexibleColumns} resetWidthsLabel="Restaurar anchos" />);
    const subject = screen.getByRole('columnheader', { name: /Mensaje/ });
    vi.spyOn(subject, 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect);
    Object.defineProperty(subject.parentElement!, 'clientWidth', { get: () => 970 });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Ancho de la columna del mensaje' }), {
      key: 'ArrowRight',
    });
    expect(subject.parentElement?.style.gridTemplateColumns).toBe('120px 508px 102px 150px 90px');
    fireEvent.contextMenu(subject);
    await user.click(screen.getByRole('menuitem', { name: 'Restaurar anchos' }));
    expect(subject.parentElement?.style.gridTemplateColumns).toBe('120px 500px 110px 150px 90px');
  });

  it('recuerda el ancho fijado de Mensaje y conserva el modo automático tras restaurarlo', async () => {
    const user = userEvent.setup();
    const values = new Map<string, number>();
    const store: PaneSizeStore = {
      read: (id) => values.get(id) ?? null,
      write: (id, value) => {
        values.set(id, value);
      },
    };
    const mount = () =>
      render(
        <PaneStorageContext value={store}>
          <Grid
            columns={flexibleColumns}
            storageId="flexible"
            resetWidthsLabel="Restaurar anchos"
          />
        </PaneStorageContext>,
      );
    let view = mount();
    vi.spyOn(
      screen.getByRole('columnheader', { name: /Mensaje/ }),
      'getBoundingClientRect',
    ).mockReturnValue({ width: 500 } as DOMRect);
    Object.defineProperty(
      screen.getByRole('columnheader', { name: /Mensaje/ }).parentElement!,
      'clientWidth',
      { get: () => 970 },
    );
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Fecha' }), { key: 'ArrowRight' });
    view.unmount();
    view = mount();
    const subject = screen.getByRole('columnheader', { name: /Mensaje/ });
    expect(subject.parentElement?.style.gridTemplateColumns).toBe('120px 500px 110px 158px 82px');
    fireEvent.contextMenu(subject);
    await user.click(screen.getByRole('menuitem', { name: 'Restaurar anchos' }));
    view.unmount();
    mount();
    expect(
      screen.getByRole('columnheader', { name: /Mensaje/ }).parentElement?.style
        .gridTemplateColumns,
    ).toBe('120px minmax(0, 1fr) 110px 150px 90px');
  });

  it('recuerda los anchos entre montajes cuando tiene identidad', () => {
    const values = new Map<string, number>();
    const store: PaneSizeStore = {
      read: (id) => values.get(id) ?? null,
      write: (id, value) => {
        values.set(id, value);
      },
    };

    const mount = () =>
      render(
        <PaneStorageContext value={store}>
          <Grid storageId="prueba.commits" />
        </PaneStorageContext>,
      );

    const { unmount } = mount();

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Ancho de la columna del SHA' }), {
      key: 'ArrowRight',
    });

    unmount();
    mount();

    expect(screen.getByRole('separator', { name: 'Ancho de la columna del SHA' })).toHaveAttribute(
      'aria-valuenow',
      '98',
    );
  });

  it('el menú contextual de la cabecera esconde y devuelve columnas', async () => {
    const user = userEvent.setup();

    render(<Grid />);

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Mensaje/ }), {
      clientX: 40,
      clientY: 10,
    });

    const menu = screen.getByRole('menu', { name: 'Columnas de la tabla de commits' });

    // El grafo no se puede ocultar: sin él la tabla deja de contar la historia.
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Grafo' })).not.toBeInTheDocument();

    const entry = within(menu).getByRole('menuitemcheckbox', { name: 'Mensaje' });

    expect(entry).toHaveAttribute('aria-checked', 'true');

    await user.click(entry);

    expect(screen.queryByRole('columnheader', { name: /Mensaje/ })).not.toBeInTheDocument();
    expect(grid()).toHaveAttribute('aria-colcount', '2');
  });

  it('avisa del cambio de columnas visibles hacia fuera', async () => {
    const onHiddenChange = vi.fn<(next: ReadonlySet<string>) => void>();
    const user = userEvent.setup();

    render(<Grid onHiddenChange={onHiddenChange} />);

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /SHA/ }), {
      clientX: 40,
      clientY: 10,
    });
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'SHA' }));

    expect([...(onHiddenChange.mock.lastCall?.[0] ?? [])]).toEqual(['sha']);
  });

  it('la columna del grafo tiene su propio scroll horizontal', () => {
    const onColumnScrollChange = vi.fn();

    render(<Grid onColumnScrollChange={onColumnScrollChange} />);

    const scroller = screen.getByRole('region', {
      name: 'Desplazamiento horizontal del grafo',
    });

    Object.defineProperty(scroller, 'scrollLeft', { value: 64, configurable: true });
    fireEvent.scroll(scroller);

    expect(onColumnScrollChange).toHaveBeenCalledWith(64);
  });

  it('sin columna que se desborde no aparece scroll horizontal alguno', () => {
    render(<Grid columns={[{ key: 'sha', header: 'SHA', name: 'SHA', width: 90 }]} />);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Grid />);

    expectNoHoverShift(screen.getByRole('columnheader', { name: /Mensaje/ }));
  });
});

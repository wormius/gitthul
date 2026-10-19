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
      columnOverflowIndicator="sawtooth"
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

const graphScroller = () =>
  screen.getByRole('scrollbar', { name: 'Desplazamiento horizontal del grafo' });

const cells = (key: string) => [
  ...grid().querySelectorAll<HTMLElement>(`[role="gridcell"][data-column-key="${key}"]`),
];

function expectGraphOffset(offset: number) {
  const graphCells = cells('graph');
  expect(graphCells.length).toBeGreaterThan(0);
  for (const cell of graphCells) {
    expect((cell.firstElementChild as HTMLElement).style.transform).toBe(
      `translateX(${String(-offset)}px)`,
    );
  }
}

function expectOverflowEdges(...edges: string[]) {
  const actual = [
    ...grid().parentElement!.querySelectorAll<SVGElement>('svg[data-overflow-edge]'),
  ].map((edge) => edge.dataset.overflowEdge);
  expect(actual.sort()).toEqual(edges.sort());
}

function scrollGraph(offset: number) {
  const scroller = graphScroller();
  const maximum = Number(scroller.getAttribute('aria-valuemax'));
  const target = Math.min(maximum, Math.max(0, offset));
  const fromStart = target <= maximum / 2;
  let remaining = fromStart ? target : target - maximum;
  fireEvent.keyDown(scroller, { key: fromStart ? 'Home' : 'End' });
  while (remaining !== 0) {
    const step = Math.sign(remaining) * Math.min(8, Math.abs(remaining));
    wheel(scroller, { deltaX: step });
    remaining -= step;
  }
}

function wheel(target: Element, options: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
  fireEvent(target, event);
  return event;
}

function scrollbarPointer(
  target: HTMLElement,
  type: string,
  clientX: number,
  options: { button?: number; pointerId?: number } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX, button: 0, pointerId: 1, ...options });
  fireEvent(target, event);
  return event;
}

function prepareScrollbarPointer() {
  const scroller = graphScroller();
  const setPointerCapture = vi.fn<(pointerId: number) => void>();
  const releasePointerCapture = vi.fn<(pointerId: number) => void>();
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    width: 116,
  } as DOMRect);
  Object.assign(scroller, {
    setPointerCapture,
    hasPointerCapture: () => true,
    releasePointerCapture,
  });
  return { scroller, setPointerCapture, releasePointerCapture };
}

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

  it('desplaza todas las filas del grafo y señala sólo los lados con contenido oculto', () => {
    const onColumnScrollChange = vi.fn();
    render(<Grid onColumnScrollChange={onColumnScrollChange} />);
    const template = screen.getByRole('columnheader', { name: /Mensaje/ }).parentElement!.style
      .gridTemplateColumns;
    const subjects = cells('subject').map((cell) => cell.textContent);

    expectGraphOffset(0);
    expectOverflowEdges('end');
    scrollGraph(64);
    expect(onColumnScrollChange).toHaveBeenLastCalledWith(64);
    expectGraphOffset(64);
    expectOverflowEdges('start', 'end');

    // El dibujo mide 400 px y la columna 120: el máximo es 280 px.
    scrollGraph(999);
    expect(onColumnScrollChange).toHaveBeenLastCalledWith(280);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '280');
    expectGraphOffset(280);
    expectOverflowEdges('start');

    scrollGraph(-10);
    expect(onColumnScrollChange).toHaveBeenLastCalledWith(0);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '0');
    expectGraphOffset(0);
    expectOverflowEdges('end');
    expect(cells('subject').map((cell) => cell.textContent)).toEqual(subjects);
    expect(cells('subject').every((cell) => cell.style.transform === '')).toBe(true);
    expect(
      screen.getByRole('columnheader', { name: /Mensaje/ }).parentElement!.style
        .gridTemplateColumns,
    ).toBe(template);
  });

  it('ampliar la columna hasta mostrar todo el grafo elimina el desplazamiento anterior', () => {
    render(<Grid />);
    scrollGraph(280);
    expectGraphOffset(280);
    const resizer = screen.getByRole('separator', { name: 'Ancho de la columna del grafo' });

    for (let step = 0; step < 35; step += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    }

    expect(resizer).toHaveAttribute('aria-valuenow', '400');
    expectGraphOffset(0);
    expect(screen.queryByRole('scrollbar')).not.toBeInTheDocument();
    expectOverflowEdges();
  });

  it('ajusta el scroll cuando un grafo nuevo tiene menos carriles o cabe completo', () => {
    const view = render(<Grid />);
    scrollGraph(280);
    const graphColumns = (contentWidth: number) =>
      columns.map((column) => (column.key === 'graph' ? { ...column, contentWidth } : column));

    view.rerender(<Grid columns={graphColumns(200)} />);
    expectGraphOffset(80);
    expect(graphScroller()).toHaveAttribute('aria-valuemax', '80');
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '80');
    expectOverflowEdges('start');

    view.rerender(<Grid columns={graphColumns(100)} />);
    expectGraphOffset(0);
    expect(screen.queryByRole('scrollbar')).not.toBeInTheDocument();
    expectOverflowEdges();
  });

  it('sincroniza el control horizontal con el offset controlado sin adelantar las celdas', () => {
    const onColumnScrollChange = vi.fn();
    const view = render(<Grid columnScroll={64} onColumnScrollChange={onColumnScrollChange} />);
    expectGraphOffset(64);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '64');
    expectOverflowEdges('start', 'end');

    fireEvent.keyDown(graphScroller(), { key: 'ArrowRight' });
    expect(onColumnScrollChange).toHaveBeenLastCalledWith(104);
    expectGraphOffset(64);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '64');

    view.rerender(<Grid columnScroll={104} onColumnScrollChange={onColumnScrollChange} />);
    expectGraphOffset(104);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '104');

    view.rerender(<Grid columnScroll={999} onColumnScrollChange={onColumnScrollChange} />);
    expectGraphOffset(280);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '280');
    expectOverflowEdges('start');
  });

  it('la rueda horizontal actúa sólo sobre el grafo y deja pasar los gestos sin desplazamiento', () => {
    render(<Grid />);
    const graph = cells('graph')[0]!.querySelector('span')!;
    const subject = cells('subject')[0]!;

    expect(wheel(graph, { deltaX: 30 }).defaultPrevented).toBe(true);
    expectGraphOffset(24);
    expect(wheel(graph, { deltaY: 40, shiftKey: true }).defaultPrevented).toBe(true);
    expectGraphOffset(48);
    expect(wheel(graph, { deltaY: 40 }).defaultPrevented).toBe(false);
    expect(wheel(graph, { deltaX: 40, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(graph, { deltaX: 40, metaKey: true }).defaultPrevented).toBe(false);
    expect(wheel(subject, { deltaX: 40 }).defaultPrevented).toBe(false);
    expectGraphOffset(48);

    scrollGraph(280);
    expect(wheel(graph, { deltaX: 40 }).defaultPrevented).toBe(false);
    expectGraphOffset(280);
    expect(wheel(graph, { deltaX: -40 }).defaultPrevented).toBe(true);
    expectGraphOffset(256);

    scrollGraph(0);
    expect(wheel(graph, { deltaY: -40, shiftKey: true }).defaultPrevented).toBe(false);
    expectGraphOffset(0);
  });

  it('normaliza líneas y páginas con pasos cortos y conserva los píxeles pequeños', () => {
    render(<Grid />);
    const graph = cells('graph')[0]!;

    wheel(graph, { deltaX: 3.5 });
    expectGraphOffset(3.5);
    wheel(graph, { deltaX: 1, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expectGraphOffset(19.5);
    wheel(graph, { deltaX: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expectGraphOffset(43.5);
    wheel(graph, { deltaX: 120 });
    expectGraphOffset(67.5);
    wheel(graph, { deltaX: -120 });
    expectGraphOffset(43.5);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '43.5');
  });

  it.each([
    [40, 10],
    [2, 1],
  ])('en una columna de %s px limita cada evento a %s px', (width, step) => {
    render(
      <Grid
        columns={columns.map((column) =>
          column.key === 'graph' ? { ...column, width, minWidth: 1 } : column,
        )}
      />,
    );
    const graph = cells('graph')[0]!;

    expect(wheel(graph, { deltaX: 1000 }).defaultPrevented).toBe(true);
    expectGraphOffset(step);
    wheel(graph, { deltaX: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expectGraphOffset(step * 2);
  });

  it('acumula una ráfaga y sus fracciones antes de renderizar y permite invertirla enseguida', () => {
    const onColumnScrollChange = vi.fn<(offset: number) => void>();
    render(<Grid onColumnScrollChange={onColumnScrollChange} />);
    const graph = cells('graph')[0]!;
    const burst = (deltas: number[]) => {
      const events = deltas.map(
        (deltaX) => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX }),
      );
      // dispatchEvent evita que cada evento reciba el flush de fireEvent:
      // todos los listeners deben acumular desde el último offset aplicado.
      act(() => {
        for (const event of events) graph.dispatchEvent(event);
      });
      expect(events.every((event) => event.defaultPrevented)).toBe(true);
    };

    burst([5, 5, 5, 0.25, 0.25]);
    expectGraphOffset(15.5);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '15.5');
    burst([-4, -4, -0.25]);
    expectGraphOffset(7.25);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '7.25');
    expect(onColumnScrollChange.mock.calls.map(([offset]) => offset)).toEqual([
      5, 10, 15, 15.25, 15.5, 11.5, 7.5, 7.25,
    ]);
  });

  it('la barra horizontal anuncia su rango y controla sólo el cuerpo de la tabla', () => {
    render(<Grid />);
    const scroller = graphScroller();
    const body = document.getElementById(scroller.getAttribute('aria-controls')!);

    expect(scroller).toHaveAttribute('aria-orientation', 'horizontal');
    expect(scroller).toHaveAttribute('aria-valuemin', '0');
    expect(scroller).toHaveAttribute('aria-valuemax', '280');
    expect(scroller).toHaveAttribute('aria-valuenow', '0');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(body).toContainElement(scroller);
    expect(body).toContainElement(screen.getAllByRole('rowgroup')[1]!);
    expect(body).not.toContainElement(screen.getByRole('columnheader', { name: /Mensaje/ }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('arrastra el indicador desde el punto agarrado sin saltar y limita ambos extremos', () => {
    render(<Grid />);
    const { scroller, setPointerCapture, releasePointerCapture } = prepareScrollbarPointer();

    // La pista empieza en 100; agarrar dentro del indicador no lo recentra.
    scrollbarPointer(scroller, 'pointerdown', 112);
    expectGraphOffset(0);
    expect(scroller).toHaveFocus();
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    scrollbarPointer(scroller, 'pointerdown', 152.6, { pointerId: 2 });
    scrollbarPointer(scroller, 'pointermove', 152.6, { pointerId: 2 });
    expectGraphOffset(0);
    scrollbarPointer(scroller, 'pointermove', 152.6);
    expect(Number(scroller.getAttribute('aria-valuenow'))).toBeCloseTo(140);
    expectGraphOffset(Number(scroller.getAttribute('aria-valuenow')));

    scrollbarPointer(scroller, 'pointermove', 500);
    expectGraphOffset(280);
    scrollbarPointer(scroller, 'pointermove', 0);
    expectGraphOffset(0);
    scrollbarPointer(scroller, 'pointerup', 0);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    scrollbarPointer(scroller, 'pointermove', 500);
    expectGraphOffset(0);
  });

  it('pulsar la pista centra el indicador y rechaza botones distintos del principal', () => {
    const onColumnScrollChange = vi.fn<(offset: number) => void>();
    render(<Grid onColumnScrollChange={onColumnScrollChange} />);
    const { scroller } = prepareScrollbarPointer();

    scrollbarPointer(scroller, 'pointerdown', 158, { button: 2 });
    scrollbarPointer(scroller, 'pointermove', 200);
    expectGraphOffset(0);
    expect(onColumnScrollChange).not.toHaveBeenCalled();
    scrollbarPointer(scroller, 'pointerdown', 158);
    expect(Number(scroller.getAttribute('aria-valuenow'))).toBeCloseTo(140);
    expectGraphOffset(Number(scroller.getAttribute('aria-valuenow')));
    expect(onColumnScrollChange).toHaveBeenCalledOnce();
  });

  it.each(['pointercancel', 'lostpointercapture'])('%s detiene el arrastre horizontal', (stop) => {
    render(<Grid />);
    const { scroller } = prepareScrollbarPointer();
    scrollbarPointer(scroller, 'pointerdown', 112);
    scrollbarPointer(scroller, 'pointermove', 152.6);
    const before = Number(scroller.getAttribute('aria-valuenow'));
    expect(before).toBeCloseTo(140);

    scrollbarPointer(scroller, stop, 152.6);
    scrollbarPointer(scroller, 'pointermove', 500);
    expectGraphOffset(before);
  });

  it('la barra superpuesta consume una sola vez la rueda incluso sin Mayús', () => {
    const view = render(<Grid />);
    const scroller = graphScroller();
    const thumb = scroller.firstElementChild!;

    expect(wheel(thumb, { deltaY: 120 }).defaultPrevented).toBe(true);
    expectGraphOffset(24);
    wheel(scroller, { deltaX: 0.5 });
    expectGraphOffset(24.5);
    wheel(scroller, { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expectGraphOffset(8.5);
    expect(wheel(scroller, { deltaY: 120, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(scroller, { deltaX: 120, metaKey: true }).defaultPrevented).toBe(false);

    act(() => {
      for (let index = 0; index < 2; index += 1) {
        scroller.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 2 }),
        );
      }
    });
    expectGraphOffset(12.5);
    expect(scroller).toHaveAttribute('aria-valuenow', '12.5');

    scrollGraph(280);
    expect(wheel(scroller, { deltaY: 120 }).defaultPrevented).toBe(false);
    expectGraphOffset(280);
    view.rerender(
      <Grid
        columns={columns.map((column) =>
          column.key === 'graph' ? { ...column, contentWidth: 100 } : column,
        )}
      />,
    );
    expect(screen.queryByRole('scrollbar')).not.toBeInTheDocument();
    expect(wheel(cells('graph')[0]!, { deltaX: 120 }).defaultPrevented).toBe(false);
    expectGraphOffset(0);
  });

  it('la rueda controlada pide el nuevo offset sin adelantar la prop vigente', () => {
    const onColumnScrollChange = vi.fn();
    const view = render(<Grid columnScroll={64} onColumnScrollChange={onColumnScrollChange} />);
    const graph = cells('graph')[0]!;

    expect(wheel(graph, { deltaX: 10 }).defaultPrevented).toBe(true);
    expect(onColumnScrollChange).toHaveBeenLastCalledWith(74);
    expectGraphOffset(64);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '64');
    view.rerender(<Grid columnScroll={74} onColumnScrollChange={onColumnScrollChange} />);
    expectGraphOffset(74);
    expect(graphScroller()).toHaveAttribute('aria-valuenow', '74');
  });

  it('el control del grafo admite flechas, Inicio y Fin sin capturar otras teclas', () => {
    render(<Grid />);
    const scroller = graphScroller();
    const key = (value: string) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value });
      fireEvent(scroller, event);
      return event;
    };

    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expectGraphOffset(40);
    key('ArrowLeft');
    expectGraphOffset(0);
    key('End');
    expectGraphOffset(280);
    expectOverflowEdges('start');
    key('Home');
    expectGraphOffset(0);
    expectOverflowEdges('end');
    key('PageDown');
    expectGraphOffset(120);
    key('PageUp');
    expectGraphOffset(0);
    expect(key('ArrowDown').defaultPrevented).toBe(false);
    expect(key('a').defaultPrevented).toBe(false);
    expectGraphOffset(0);
  });

  it('sin columna que se desborde no aparece scroll horizontal alguno', () => {
    render(<Grid columns={[{ key: 'sha', header: 'SHA', name: 'SHA', width: 90 }]} />);

    expect(screen.queryByRole('scrollbar')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Grid />);

    expectNoHoverShift(screen.getByRole('columnheader', { name: /Mensaje/ }));
  });
});

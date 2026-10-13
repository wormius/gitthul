import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RepoSummary } from '@core/domain/repository';
import { I18nProvider } from '@i18n/I18nProvider';

import { expectNoHoverShift } from '../../test/noShift';
import { RepoRow } from './RepoRow';
import { repoRowHeight } from './rowHeight';

const repo: RepoSummary = {
  id: 'gitthul',
  name: 'gitthul',
  path: '/repos/gitthul',
  head: 'main',
  lastOpenedAt: 1,
};

function renderRow(selected = false, props: Partial<ComponentProps<typeof RepoRow>> = {}) {
  const onOpen = vi.fn();
  const onSelect = vi.fn();
  const onClickSelect = vi.fn();
  const onActivate = vi.fn();
  const onParentMouseDown = vi.fn();
  const onParentDragStart = vi.fn();
  render(
    <I18nProvider initialLocale="es-MX">
      <div
        onDoubleClick={onActivate}
        onMouseDown={onParentMouseDown}
        onDragStart={onParentDragStart}
      >
        <RepoRow
          repo={repo}
          avatar={null}
          selected={selected}
          when="hace 2 días"
          menu={[]}
          onOpen={onOpen}
          onSelect={onSelect}
          onClickSelect={onClickSelect}
          {...props}
        />
      </div>
    </I18nProvider>,
  );
  const row = screen.getByText('/repos/gitthul').closest('div') as HTMLElement;
  return { row, onOpen, onSelect, onClickSelect, onActivate, onParentMouseDown, onParentDragStart };
}

describe('RepoRow', () => {
  it('enseña identidad y última apertura sin controles de espacios', () => {
    const { row } = renderRow();
    expect(screen.getByText('gitthul')).toBeInTheDocument();
    expect(screen.getByText('/repos/gitthul')).toBeInTheDocument();
    expect(screen.getByText('hace 2 días')).toBeInTheDocument();
    expect(row).not.toHaveAttribute('draggable');
  });

  it('abre solo al pulsar de nuevo una fila ya seleccionada', () => {
    const { row, onOpen } = renderRow(true);
    fireEvent.mouseDown(row, { button: 0, detail: 1 });
    fireEvent.click(row, { button: 0, detail: 1 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey'] as const)(
    '%s no abre una fila ya seleccionada',
    (modifier) => {
      const { row, onOpen, onActivate } = renderRow(true);

      fireEvent.mouseDown(row, { button: 0, [modifier]: true });
      fireEvent.click(row, { button: 0, detail: 1, [modifier]: true });
      fireEvent.doubleClick(row, { button: 0, [modifier]: true });

      expect(onOpen).not.toHaveBeenCalled();
      expect(onActivate).not.toHaveBeenCalled();
    },
  );

  it('no abre un miembro de la selección múltiple al reducirla con un clic', () => {
    const { row, onOpen, onClickSelect, onParentMouseDown } = renderRow(true, {
      canOpenOnClick: false,
    });

    fireEvent.mouseDown(row, { button: 0 });
    fireEvent.click(row, { button: 0, detail: 1 });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onParentMouseDown).not.toHaveBeenCalled();
    expect(onClickSelect).toHaveBeenCalledOnce();
  });

  it('iniciar un arrastre de lote conserva la selección y descarta el clic posterior', () => {
    const onDragStart = vi.fn();
    const { row, onOpen, onClickSelect, onParentMouseDown, onParentDragStart } = renderRow(true, {
      canOpenOnClick: false,
      dragCount: 3,
      onDragStart,
    });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };

    fireEvent.mouseDown(row, { button: 0 });
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragEnd(row);
    fireEvent.click(row, { button: 0, detail: 1 });

    expect(onParentMouseDown).not.toHaveBeenCalled();
    expect(onParentDragStart).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', repo.id);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(onClickSelect).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    const [preview] = dataTransfer.setDragImage.mock.calls[0] as [HTMLElement];
    expect(preview).toHaveAttribute('data-name', '3 repositorios');

    fireEvent.mouseDown(row, { button: 0 });
    fireEvent.click(row, { button: 0, detail: 1 });

    expect(onClickSelect).toHaveBeenCalledOnce();
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey'] as const)(
    '%s conserva el gesto de selección del padre incluso dentro de un lote',
    (modifier) => {
      const { row, onClickSelect, onParentMouseDown } = renderRow(true, {
        canOpenOnClick: false,
      });

      fireEvent.mouseDown(row, { button: 0, [modifier]: true });
      fireEvent.click(row, { button: 0, detail: 1, [modifier]: true });

      expect(onParentMouseDown).toHaveBeenCalledOnce();
      expect(onParentMouseDown.mock.calls[0]?.[0]).toHaveProperty(modifier, true);
      expect(onClickSelect).not.toHaveBeenCalled();
    },
  );

  it('una fila externa al lote conserva la selección inmediata del padre', () => {
    const { row, onParentMouseDown } = renderRow(false, { canOpenOnClick: false });

    fireEvent.mouseDown(row, { button: 0 });

    expect(onParentMouseDown).toHaveBeenCalledOnce();
  });

  it('prepara la selección contextual antes de abrir el menú desde el teclado', () => {
    const { row, onSelect } = renderRow(false, {
      menu: [{ key: 'open', label: 'Abrir', onSelect: vi.fn() }],
    });

    fireEvent.keyDown(row, { key: 'ContextMenu' });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitem', { name: 'Abrir' })).toBeInTheDocument();
  });

  it('el hover no desplaza la fila', () => {
    expectNoHoverShift(renderRow().row);
  });

  it('usa como fantasma de arrastre únicamente avatar y nombre', () => {
    const setDragImage = vi.fn();
    const onDragStart = vi.fn();
    render(
      <I18nProvider initialLocale="es-MX">
        <RepoRow
          repo={repo}
          avatar={null}
          selected={false}
          menu={[]}
          onOpen={vi.fn()}
          onSelect={vi.fn()}
          onDragStart={onDragStart}
        />
      </I18nProvider>,
    );

    const row = screen.getByText('/repos/gitthul').closest('div') as HTMLElement;
    const dataTransfer = { setData: vi.fn(), setDragImage, effectAllowed: '' };
    fireEvent.dragStart(row, {
      clientX: 10,
      clientY: 10,
      dataTransfer,
    });

    expect(onDragStart).toHaveBeenCalledOnce();
    expect(setDragImage).toHaveBeenCalledOnce();
    expect(dataTransfer.effectAllowed).toBe('move');
    const [preview] = setDragImage.mock.calls[0] as [HTMLElement];
    expect(preview).toHaveAttribute('data-name', 'gitthul');
    expect(preview).not.toHaveTextContent('/repos/gitthul');
  });
});

describe('repoRowHeight', () => {
  it('crece con la densidad y con el tamaño de interfaz', () => {
    expect(repoRowHeight('compact', 13)).toBeLessThan(repoRowHeight('cozy', 13));
    expect(repoRowHeight('cozy', 13)).toBeLessThan(repoRowHeight('spacious', 13));
    expect(repoRowHeight('cozy', 13)).toBeLessThan(repoRowHeight('cozy', 18));
  });
});

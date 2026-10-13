import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RepoSummary } from '@core/domain/repository';
import { I18nProvider } from '@i18n/I18nProvider';

import { expectNoHoverShift } from '../../test/noShift';
import { RepoCard } from './RepoCard';

const REPOSITORY: RepoSummary = {
  id: 'gitthul',
  name: 'gitthul',
  path: '/repos/gitthul',
  head: 'main',
  lastOpenedAt: 1,
};

function renderCard(selected: boolean, props: Partial<ComponentProps<typeof RepoCard>> = {}) {
  const onOpen = vi.fn();
  const onSelect = vi.fn();
  const onContextSelect = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();

  render(
    <I18nProvider initialLocale="es-MX">
      <RepoCard
        repo={REPOSITORY}
        avatar={null}
        selected={selected}
        menu={[]}
        onOpen={onOpen}
        onSelect={onSelect}
        onContextSelect={onContextSelect}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        {...props}
      />
    </I18nProvider>,
  );

  return {
    card: screen.getByRole('option'),
    onOpen,
    onSelect,
    onContextSelect,
    onDragStart,
    onDragEnd,
  };
}

describe('RepoCard', () => {
  it('el hover no desplaza la tarjeta', () => {
    expectNoHoverShift(renderCard(false).card);
  });

  it('Enter abre una tarjeta seleccionada', () => {
    const { card, onOpen, onSelect } = renderCard(true);

    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter selecciona antes de abrir cuando la tarjeta aún no está seleccionada', () => {
    const { card, onOpen, onSelect } = renderCard(false);

    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('el segundo clic sin modificadores abre una selección singular', () => {
    const { card, onOpen, onSelect } = renderCard(true);

    fireEvent.mouseDown(card, { button: 0 });
    fireEvent.click(card, { button: 0, detail: 1 });

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey'] as const)(
    '%s modifica la selección sin abrir una tarjeta ya seleccionada',
    (modifier) => {
      const { card, onOpen, onSelect } = renderCard(true);

      fireEvent.mouseDown(card, { button: 0, [modifier]: true });
      fireEvent.click(card, { button: 0, detail: 1, [modifier]: true });

      expect(onOpen).not.toHaveBeenCalled();
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.calls[0]?.[0]).toHaveProperty(modifier, true);
    },
  );

  it('un clic sobre un miembro de una selección múltiple selecciona sin abrir', () => {
    const { card, onOpen, onSelect } = renderCard(true, { canOpenOnClick: false });

    fireEvent.mouseDown(card, { button: 0 });
    fireEvent.click(card, { button: 0, detail: 1 });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it.each([
    { count: 1, effect: 'move', label: 'gitthul' },
    { count: 3, effect: 'copy', label: '3 repositorios' },
  ])(
    'el arrastre de $count repositorios conserva la selección y anuncia el lote',
    ({ count, effect, label }) => {
      const { card, onOpen, onSelect, onDragStart, onDragEnd } = renderCard(true, {
        dragCount: count,
        canOpenOnClick: count === 1,
      });
      const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };

      fireEvent.mouseDown(card, { button: 0 });
      fireEvent.dragStart(card, { dataTransfer });
      fireEvent.dragEnd(card);
      fireEvent.click(card, { button: 0, detail: 1 });

      expect(onDragStart).toHaveBeenCalledOnce();
      expect(onDragEnd).toHaveBeenCalledOnce();
      expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', REPOSITORY.id);
      expect(dataTransfer.effectAllowed).toBe(effect);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
      const [preview] = dataTransfer.setDragImage.mock.calls[0] as [HTMLElement];
      expect(preview).toHaveAttribute('data-name', label);
      expect(preview).not.toHaveTextContent(REPOSITORY.path);

      fireEvent.mouseDown(card, { button: 0 });
      fireEvent.click(card, { button: 0, detail: 1 });

      if (count === 1) expect(onOpen).toHaveBeenCalledOnce();
      else expect(onSelect).toHaveBeenCalledOnce();
    },
  );

  it('Espacio modifica la selección y conserva los modificadores sin abrir', () => {
    const { card, onOpen, onSelect } = renderCard(true);

    fireEvent.keyDown(card, { key: ' ', ctrlKey: true });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]?.[0]).toHaveProperty('ctrlKey', true);
  });

  it('el clic derecho dentro de la tarjeta prepara la selección antes de mostrar su menú', () => {
    const { onSelect, onContextSelect } = renderCard(true, {
      menu: [{ key: 'open', label: 'Abrir', onSelect: vi.fn() }],
    });

    fireEvent.contextMenu(screen.getByText('/repos/gitthul'));

    expect(onContextSelect).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Abrir' })).toBeInTheDocument();
  });

  it('el menú contextual por teclado prepara la selección de la tarjeta', () => {
    const { card, onSelect, onContextSelect } = renderCard(false, {
      menu: [{ key: 'open', label: 'Abrir', onSelect: vi.fn() }],
    });

    fireEvent.keyDown(card, { key: 'F10', shiftKey: true });

    expect(onContextSelect).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Abrir' })).toBeInTheDocument();
  });
});

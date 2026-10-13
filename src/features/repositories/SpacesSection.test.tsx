import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RepoId, RepoSummary } from '@core/domain/repository';
import { I18nProvider } from '@i18n/I18nProvider';

import { SpacesSection } from './SpacesSection';

const REPOSITORIES: readonly RepoSummary[] = ['one', 'two', 'three', 'hidden'].map((id) => ({
  id,
  name: id,
  path: `/repos/${id}`,
  head: 'main',
  lastOpenedAt: 1,
}));

function renderSpaces(props: Partial<ComponentProps<typeof SpacesSection>> = {}) {
  const onOpen = vi.fn();
  const onSelectedChange = vi.fn();
  const onSelectSpace = vi.fn();
  const onContextSelect = vi.fn();

  function Harness() {
    const [selected, setSelected] = useState<ReadonlySet<RepoId>>(new Set());
    return (
      <SpacesSection
        spaces={[
          { id: 'a', name: 'Uno', repos: ['one', 'two'] },
          { id: 'b', name: 'Dos', repos: ['one', 'three'] },
          { id: 'c', name: 'Plegado', repos: ['hidden'], collapsed: true },
        ]}
        repositories={REPOSITORIES}
        avatarOf={() => null}
        selected={selected}
        menuFor={() => []}
        onSelectedChange={(next, space) => {
          onSelectedChange(next, space);
          setSelected(next);
        }}
        onContextSelect={onContextSelect}
        onOpen={onOpen}
        onOpenAll={vi.fn()}
        onToggleCollapsed={vi.fn()}
        currentSpace={null}
        renaming={null}
        spaceMenu={() => []}
        onSelectSpace={onSelectSpace}
        onRename={vi.fn()}
        onRenameCancel={vi.fn()}
        onDelete={vi.fn()}
        onCreate={vi.fn()}
        dragging={null}
        dragOver={null}
        onSpaceDragStart={vi.fn()}
        onRepoDragStart={vi.fn()}
        onDragOver={vi.fn()}
        onDragEnd={vi.fn()}
        onDrop={vi.fn()}
        {...props}
      />
    );
  }

  render(
    <I18nProvider initialLocale="es-MX">
      <Harness />
    </I18nProvider>,
  );

  const lists = screen.getAllByRole('listbox');
  const first = within(lists[0]!).getAllByRole('option');
  const second = within(lists[1]!).getAllByRole('option');
  return { first, second, lists, onOpen, onSelectedChange, onSelectSpace, onContextSelect };
}

function click(card: HTMLElement, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  fireEvent.mouseDown(card, { button: 0, ...modifiers });
  fireEvent.click(card, { button: 0, detail: 1, ...modifiers });
}

describe('SpacesSection selection', () => {
  it('selecciona por identidad y marca las tarjetas del mismo repositorio en otros espacios', () => {
    const { first, second, lists, onOpen, onSelectSpace } = renderSpaces();

    click(first[0]!);
    click(first[1]!, { ctrlKey: true });

    expect(first[0]).toHaveAttribute('aria-selected', 'true');
    expect(first[1]).toHaveAttribute('aria-selected', 'true');
    expect(second[0]).toHaveAttribute('aria-selected', 'true');
    expect(lists[0]).toHaveAttribute('aria-multiselectable', 'true');
    expect(onOpen).not.toHaveBeenCalled();
    expect(onSelectSpace).not.toHaveBeenCalled();

    click(second[0]!, { ctrlKey: true });

    expect(first[0]).toHaveAttribute('aria-selected', 'false');
    expect(second[0]).toHaveAttribute('aria-selected', 'false');
    expect(first[1]).toHaveAttribute('aria-selected', 'true');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('Mayús selecciona el rango visible entre espacios sin incluir los plegados', () => {
    const { first, second, onSelectedChange, onOpen } = renderSpaces();

    click(first[0]!);
    click(second[1]!, { shiftKey: true });

    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(['one', 'two', 'three']), 'b');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('Ctrl+A selecciona solo los repositorios únicos de los espacios expandidos', () => {
    const { first, onSelectedChange } = renderSpaces();

    fireEvent.keyDown(first[0]!, { key: 'a', ctrlKey: true });

    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(['one', 'two', 'three']), 'a');
  });

  it('Mayús+flechas extiende el rango desde la primera tarjeta y desplaza el foco', () => {
    const { first, second, onSelectedChange } = renderSpaces();

    click(first[0]!);
    fireEvent.keyDown(first[0]!, { key: 'ArrowDown', shiftKey: true });

    expect(first[1]).toHaveFocus();
    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(['one', 'two']), 'a');

    fireEvent.keyDown(first[1]!, { key: 'End', shiftKey: true });

    expect(second[1]).toHaveFocus();
    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(['one', 'two', 'three']), 'b');
  });

  it('Ctrl+Espacio alterna una tarjeta seleccionada sin abrir', () => {
    const { first, onSelectedChange, onOpen } = renderSpaces();

    click(first[0]!);
    fireEvent.keyDown(first[0]!, { key: ' ', ctrlKey: true });

    expect(onSelectedChange).toHaveBeenLastCalledWith(new Set(), 'a');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('los atajos de selección no interceptan el campo de renombrar un espacio', () => {
    const { onSelectedChange } = renderSpaces({ renaming: 'a' });
    const field = screen.getByRole('textbox');

    expect(fireEvent.keyDown(field, { key: 'a', ctrlKey: true })).toBe(true);
    expect(onSelectedChange).not.toHaveBeenCalled();
  });
});

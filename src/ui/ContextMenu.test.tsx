import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { ContextMenu } from './ContextMenu';
import type { MenuEntry } from './menu';

function entries(onCherryPick = vi.fn(), onRevert = vi.fn()): MenuEntry[] {
  return [
    { key: 'cherry', label: 'Cherry-pick de 3 commits sobre main', onSelect: onCherryPick },
    { key: 'sep', kind: 'separator' },
    {
      key: 'branch',
      kind: 'submenu',
      label: 'Crear desde a1b2c3d',
      items: [{ key: 'tag', label: 'Crear tag en a1b2c3d', onSelect: onRevert }],
    },
    { key: 'reset', label: 'Revertir main a a1b2c3d', danger: true, onSelect: vi.fn() },
  ];
}

function renderMenu(items: MenuEntry[], description?: string) {
  return render(
    <ContextMenu items={items} label="Acciones del commit" description={description}>
      <button type="button">Fila del commit a1b2c3d</button>
    </ContextMenu>,
  );
}

const region = () => screen.getByRole('button', { name: /Fila del commit/ }).parentElement!;

describe('ContextMenu', () => {
  it('abre el menú con el botón derecho y ejecuta la acción', async () => {
    const onCherryPick = vi.fn();
    const user = userEvent.setup();

    renderMenu(entries(onCherryPick));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(region(), { clientX: 120, clientY: 80 });

    expect(screen.getByRole('menu', { name: 'Acciones del commit' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Cherry-pick de 3 commits sobre main' }));

    expect(onCherryPick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('el clic de una opción no alcanza al contenedor que abrió el menú', async () => {
    const user = userEvent.setup();
    const onMouseDown = vi.fn();
    const onClick = vi.fn();

    render(
      <div onMouseDown={onMouseDown} onClick={onClick}>
        <ContextMenu items={entries()} label="Acciones del commit">
          <button type="button">Fila del commit a1b2c3d</button>
        </ContextMenu>
      </div>,
    );

    fireEvent.contextMenu(region());
    await user.click(screen.getByRole('menuitem', { name: 'Cherry-pick de 3 commits sobre main' }));

    expect(onMouseDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('también abre con la tecla de menú contextual: el clic derecho no existe en teclado', () => {
    renderMenu(entries());

    fireEvent.keyDown(screen.getByRole('button', { name: /Fila del commit/ }), {
      key: 'ContextMenu',
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('dice sobre qué opera cuando hay selección múltiple', () => {
    renderMenu(entries(), '3 commits seleccionados');

    fireEvent.contextMenu(region());

    expect(screen.getByText('3 commits seleccionados')).toBeInTheDocument();
  });

  it('resalta la primera entrada y recorre con las flechas saltando separadores', async () => {
    const user = userEvent.setup();

    renderMenu(entries());
    fireEvent.contextMenu(region());

    expect(
      screen.getByRole('menuitem', { name: 'Cherry-pick de 3 commits sobre main' }),
    ).toHaveFocus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitem', { name: 'Crear desde a1b2c3d' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitem', { name: 'Revertir main a a1b2c3d' })).toHaveFocus();
  });

  it('abre el submenú con la flecha derecha y lo cierra con la izquierda', async () => {
    const user = userEvent.setup();

    renderMenu(entries());
    fireEvent.contextMenu(region());

    await user.keyboard('{ArrowDown}{ArrowRight}');

    expect(screen.getByRole('menuitem', { name: 'Crear tag en a1b2c3d' })).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');

    expect(
      screen.queryByRole('menuitem', { name: 'Crear tag en a1b2c3d' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Acciones del commit' })).toBeInTheDocument();
  });

  it('cierra con Escape y al pulsar fuera', async () => {
    const user = userEvent.setup();

    renderMenu(entries());

    fireEvent.contextMenu(region());
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(region());

    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    renderMenu(entries());

    expectNoHoverShift(screen.getByRole('button', { name: /Fila del commit/ }));
  });

  /*
   * Las regiones se anidan a propósito: la tarjeta dentro de su zona, la zona
   * dentro del panel, y cada una ofrece lo suyo. El que abre es el de dentro,
   * que es el que habla de lo que hay bajo el puntero; sin esto se pintaban los
   * tres encimados y el de arriba era el menos específico de todos.
   */
  it('solo abre el menú de la región más interna', () => {
    render(
      <ContextMenu
        items={[{ key: 'outer', label: 'Crear un espacio', onSelect: vi.fn() }]}
        label="Menú del panel"
      >
        <ContextMenu
          items={[{ key: 'inner', label: 'Olvidar gitthul en GitThul', onSelect: vi.fn() }]}
          label="Menú de gitthul"
        >
          <button type="button">gitthul</button>
        </ContextMenu>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'gitthul' }));

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menu', { name: 'Menú de gitthul' })).toBeInTheDocument();
  });
});

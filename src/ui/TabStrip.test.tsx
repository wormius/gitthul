import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import type { TabDescriptor } from './Tab';
import { TabStrip } from './TabStrip';

const tabs: readonly TabDescriptor[] = [
  { id: 't1', label: 'Repositorios', closeLabel: 'Cerrar la pestaña Repositorios' },
  {
    id: 't2',
    label: 'gitthul',
    hint: 'rama main',
    closeLabel: 'Cerrar la pestaña gitthul',
  },
  { id: 't3', label: 'linux', hint: 'rama master', closeLabel: 'Cerrar la pestaña linux' },
];

function setup(props: Partial<Parameters<typeof TabStrip>[0]> = {}) {
  const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() };

  render(<TabStrip label="Pestañas abiertas" tabs={tabs} activeId="t1" {...handlers} {...props} />);

  return handlers;
}

function setupRename(onSave = vi.fn<(value: string) => Promise<void>>().mockResolvedValue()) {
  const editableTabs = tabs.map((tab) =>
    tab.id === 't2'
      ? {
          ...tab,
          menu: {
            label: 'Opciones de gitthul',
            items: [{ key: 'example', label: 'Acción de pestaña', onSelect: vi.fn() }],
          },
          rename: {
            value: 'gitthul',
            placeholder: 'gitthul',
            label: 'Alias del repositorio',
            hint: 'Enter guarda; Escape cancela.',
            errorLabel: 'No se pudo guardar. Pulsa Enter para reintentar.',
            onSave,
          },
        }
      : tab,
  );
  const handlers = setup({ tabs: editableTabs });

  return { ...handlers, onSave };
}

describe('TabStrip', () => {
  it('lista las pestañas y marca la activa', () => {
    setup();

    expect(screen.getByRole('list', { name: 'Pestañas abiertas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'gitthul rama main' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('activa al pulsar el rótulo', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'linux rama master' }));

    expect(handlers.onActivate).toHaveBeenCalledWith('t3');
  });

  it('cierra con la × y con el clic de la rueda', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Cerrar la pestaña gitthul' }));
    expect(handlers.onClose).toHaveBeenCalledWith('t2');

    const tab = screen.getByRole('button', { name: 'linux rama master' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    await user.pointer({ keys: '[MouseMiddle]', target: tab });
    expect(handlers.onClose).toHaveBeenCalledWith('t3');
  });

  it('reordena soltando sobre otra pestaña', () => {
    const handlers = setup();
    const source = screen.getByRole('button', { name: 'linux rama master' }).closest('li');
    const target = screen.getByRole('button', { name: 'Repositorios' }).closest('li');

    if (!source || !target) throw new Error('Faltan las pestañas');

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(handlers.onReorder).toHaveBeenCalledWith('t3', 0);
  });

  it('la pestaña arrastrada se queda fantasmal en su hueco', async () => {
    setup();

    const tab = screen.getByRole('button', { name: 'linux rama master' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    fireEvent.dragStart(tab);

    // Un cuadro más tarde: durante el manejador, la foto del arrastre aún no está
    // tomada y atenuar aquí atenuaría también lo que viaja con el puntero.
    expect(tab).toHaveAttribute('data-dragging', 'false');
    await waitFor(() => {
      expect(tab).toHaveAttribute('data-dragging', 'true');
    });

    const style = window.getComputedStyle(tab);

    expect(Number(style.opacity)).toBeLessThan(1);
    expect(style.borderStyle).toBe('dashed');

    fireEvent.dragEnd(tab);
    expect(tab).toHaveAttribute('data-dragging', 'false');
  });

  it('soltar sobre sí misma no reordena', () => {
    const handlers = setup();
    const tab = screen.getByRole('button', { name: 'linux rama master' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    fireEvent.dragStart(tab);
    fireEvent.drop(tab);

    expect(handlers.onReorder).not.toHaveBeenCalled();
  });

  it('las flechas recorren la tira sin activar nada', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'gitthul rama main' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'linux rama master' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();

    expect(handlers.onActivate).not.toHaveBeenCalled();
  });

  it('solo monta activación y cierre visibles dentro de cada pestaña', () => {
    setup();

    const tab = screen.getByRole('button', { name: 'gitthul rama main' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    expect(tab).toHaveTextContent('gitthulrama main');
    expect(within(tab).getAllByRole('button')).toHaveLength(2);
  });

  it('el hover no desplaza la caja de la pestaña', () => {
    setup();

    const tab = screen.getByRole('button', { name: 'gitthul rama main' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    expectNoHoverShift(tab);
  });

  it('edita con doble clic, selecciona el nombre y conserva el cierre visible', async () => {
    const user = userEvent.setup();
    setupRename();

    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));

    const editor = screen.getByRole('textbox', { name: 'Alias del repositorio' });
    expect(editor).toHaveValue('gitthul');
    expect(editor).toHaveFocus();
    expect(editor).toHaveAccessibleDescription('Enter guarda; Escape cancela.');
    expect((editor as HTMLInputElement).selectionStart).toBe(0);
    expect((editor as HTMLInputElement).selectionEnd).toBe(7);
    expect(editor.closest('button')).toBeNull();
    expect(editor.closest('li')).toHaveAttribute('draggable', 'false');
    expect(screen.getByRole('button', { name: 'Cerrar la pestaña gitthul' })).toBeVisible();
  });

  it('las pestañas sin edición y el doble clic derecho no crean un campo', () => {
    setupRename();

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Repositorios' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'gitthul rama main' }), {
      button: 2,
    });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('guarda con Enter una sola vez y devuelve el foco a la pestaña', async () => {
    const user = userEvent.setup();
    const { onSave } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('Producto{Enter}');

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Producto');
    expect(screen.getByRole('button', { name: 'gitthul rama main' })).toHaveFocus();
  });

  it('guarda al salir sin robar el foco del destino', async () => {
    const user = userEvent.setup();
    const { onSave } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('Producto');
    await user.click(screen.getByRole('button', { name: 'Repositorios' }));

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Producto');
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();
  });

  it('Escape descarta el borrador y vuelve al botón, incluso al perder foco', async () => {
    const user = userEvent.setup();
    const { onSave } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('Descartar{Escape}');
    await user.click(screen.getByRole('button', { name: 'Repositorios' }));

    expect(onSave).not.toHaveBeenCalled();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    expect(screen.getByRole('textbox')).toHaveValue('gitthul');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'gitthul rama main' })).toHaveFocus();
  });

  it('no escribe un valor intacto y permite guardar un alias vacío', async () => {
    const user = userEvent.setup();
    const { onSave } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();

    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('{Backspace}{Enter}');
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(''));
  });

  it('mantiene el borrador tras un fallo y permite reintentar con Enter', async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Disco ocupado'))
      .mockResolvedValueOnce();
    setupRename(onSave);
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('Producto{Enter}');

    const editor = screen.getByRole('textbox');
    await waitFor(() => expect(editor).toHaveAttribute('aria-invalid', 'true'));
    expect(editor).toHaveValue('Producto');
    expect(editor).toHaveFocus();
    expect(editor).toHaveAccessibleDescription('No se pudo guardar. Pulsa Enter para reintentar.');
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('Producto');
  });

  it('conserva un error de guardado al salir sin quitar foco del control siguiente', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('Disco'));
    setupRename(onSave);
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('Borrador');
    await user.click(screen.getByRole('button', { name: 'Repositorios' }));

    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByRole('textbox')).toHaveValue('Borrador');
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Borrador');
  });

  it('no duplica Enter y blur durante un guardado ni roba foco al finalizar', async () => {
    const user = userEvent.setup();
    let complete!: () => void;
    const onSave = vi.fn<(value: string) => Promise<void>>(
      () => new Promise<void>((resolve) => (complete = resolve)),
    );
    setupRename(onSave);
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    await user.keyboard('Producto{Enter}{Enter}');
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Repositorios' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Producto');

    await act(async () => {
      complete();
      await Promise.resolve();
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();
  });

  it('no guarda ni cancela al confirmar composición IME y espera al final si pierde foco', async () => {
    const user = userEvent.setup();
    const { onSave } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    const editor = screen.getByRole('textbox');

    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '開発' } });
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(editor, { key: 'Escape', isComposing: true });
    expect(editor).toHaveValue('開発');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(editor);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.compositionEnd(editor);
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('開発'));
  });

  it('conserva navegación y atajos de edición de texto dentro del campo', async () => {
    const user = userEvent.setup();
    const { onSave } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    const editor = screen.getByRole('textbox');

    await user.keyboard('{ArrowLeft}{ArrowRight}{Home}{End}{Control>}a{/Control}');
    expect(editor).toHaveFocus();
    expect((editor as HTMLInputElement).selectionStart).toBe(0);
    expect((editor as HTMLInputElement).selectionEnd).toBe(7);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('mantiene el destino original del borrador si cambia el contexto de la pestaña', async () => {
    const user = userEvent.setup();
    const saveOriginal = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    const saveNext = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    const original: TabDescriptor = {
      id: 'terminal',
      label: 'Primero',
      closeLabel: 'Cerrar',
      rename: {
        value: 'Primero',
        label: 'Alias',
        hint: 'Enter guarda',
        errorLabel: 'No se pudo guardar',
        onSave: saveOriginal,
      },
    };
    const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() };
    const { rerender } = render(
      <TabStrip label="Pestañas" tabs={[original]} activeId="terminal" {...handlers} />,
    );
    await user.dblClick(screen.getByRole('button', { name: 'Primero' }));
    await user.keyboard('Alias primero');
    rerender(
      <TabStrip
        label="Pestañas"
        tabs={[
          {
            ...original,
            label: 'Segundo',
            rename: { ...original.rename!, value: 'Segundo', onSave: saveNext },
          },
        ]}
        activeId="terminal"
        {...handlers}
      />,
    );
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(saveOriginal).toHaveBeenCalledExactlyOnceWith('Alias primero');
    expect(saveNext).not.toHaveBeenCalled();
  });

  it('descarta borradores al cambiar el destino y aísla guardados pendientes del nuevo editor', async () => {
    const user = userEvent.setup();
    const saveFirst = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    let complete!: () => void;
    const saveSecond = vi.fn<(value: string) => Promise<void>>(
      () => new Promise<void>((resolve) => (complete = resolve)),
    );
    const saveThird = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    const makeTab = (
      identity: string,
      onSave: (value: string) => Promise<void>,
    ): TabDescriptor => ({
      id: 'terminal',
      label: identity,
      closeLabel: 'Cerrar',
      rename: {
        identityKey: identity,
        value: identity,
        label: 'Alias',
        hint: 'Enter guarda',
        errorLabel: 'No se pudo guardar',
        onSave,
      },
    });
    const first = makeTab('Primero', saveFirst);
    const second = makeTab('Segundo', saveSecond);
    const third = makeTab('Tercero', saveThird);
    const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() };
    const view = (tab: TabDescriptor) => (
      <TabStrip label="Pestañas" tabs={[tab]} activeId="terminal" {...handlers} />
    );
    const { rerender } = render(view(first));

    await user.dblClick(screen.getByRole('button', { name: 'Primero' }));
    await user.keyboard('Descartar');
    rerender(view(second));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(saveFirst).not.toHaveBeenCalled();
    expect(saveSecond).not.toHaveBeenCalled();

    await user.dblClick(screen.getByRole('button', { name: 'Segundo' }));
    await user.keyboard('Guardar segundo{Enter}');
    expect(saveSecond).toHaveBeenCalledExactlyOnceWith('Guardar segundo');
    rerender(view(third));
    await user.dblClick(screen.getByRole('button', { name: 'Tercero' }));
    await user.keyboard('Borrador tercero');
    await act(async () => {
      complete();
      await Promise.resolve();
    });
    expect(screen.getByRole('textbox')).toHaveValue('Borrador tercero');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(saveThird).not.toHaveBeenCalled();

    rerender(view({ ...third, rename: undefined }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(saveThird).not.toHaveBeenCalled();

    // Si el blur se aplazó hasta acabar una composición, tampoco puede escribir
    // después de que la pestaña haya cambiado de destino.
    rerender(view(first));
    await user.dblClick(screen.getByRole('button', { name: 'Primero' }));
    const editor = screen.getByRole('textbox');
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '開発' } });
    fireEvent.blur(editor);
    act(() => {
      fireEvent.compositionEnd(editor);
      rerender(view(third));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveFirst).not.toHaveBeenCalled();
  });

  it('impide arrastrar o cerrar con rueda al editar y deja el menú de texto nativo', async () => {
    const user = userEvent.setup();
    const { onReorder, onClose } = setupRename();
    await user.dblClick(screen.getByRole('button', { name: 'gitthul rama main' }));
    const editor = screen.getByRole('textbox');
    const tab = editor.closest('li');
    const target = screen.getByRole('button', { name: 'Repositorios' }).closest('li');
    if (!tab || !target) throw new Error('Faltan las pestañas');

    expect(fireEvent.dragStart(tab)).toBe(false);
    fireEvent.drop(target);
    await user.pointer({ keys: '[MouseMiddle]', target: editor });
    expect(onReorder).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(editor)).toBe(true);
    fireEvent.keyDown(editor, { key: 'ContextMenu' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

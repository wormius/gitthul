import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { PaneStorageContext, type PaneSizeStore } from './paneStorage';
import { SplitPane } from './SplitPane';

function renderSplit(props: Partial<Parameters<typeof SplitPane>[0]> = {}) {
  return render(
    <SplitPane
      label="Ancho del panel de ramas"
      first={<p>Ramas de gitthul</p>}
      second={<p>Commits de gitthul</p>}
      {...props}
    />,
  );
}

const divider = () => screen.getByRole('separator', { name: 'Ancho del panel de ramas' });

/** Un almacén que sí recuerda, como el que la aplicación monta sobre SettingsPort. */
function mapStore(initial: Iterable<[string, number]> = []): PaneSizeStore {
  const values = new Map(initial);

  return {
    read: (id) => values.get(id) ?? null,
    write: (id, value) => {
      values.set(id, value);
    },
  };
}

describe('SplitPane', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('pinta los dos paneles y un divisor con su valor', () => {
    renderSplit({ defaultRatio: 0.3 });

    expect(screen.getByText('Ramas de gitthul')).toBeInTheDocument();
    expect(screen.getByText('Commits de gitthul')).toBeInTheDocument();
    expect(divider()).toHaveAttribute('aria-valuenow', '30');
    expect(divider()).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('el divisor de un reparto vertical se anuncia horizontal', () => {
    renderSplit({ orientation: 'vertical' });

    expect(divider()).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('las flechas mueven el reparto sin necesidad de ratón', () => {
    renderSplit({ defaultRatio: 0.5 });

    fireEvent.keyDown(divider(), { key: 'ArrowRight' });

    expect(divider()).toHaveAttribute('aria-valuenow', '52');

    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });

    expect(divider()).toHaveAttribute('aria-valuenow', '48');
  });

  it('Inicio y Fin llevan el reparto a los extremos', () => {
    renderSplit({ defaultRatio: 0.5 });

    fireEvent.keyDown(divider(), { key: 'End' });

    expect(divider()).toHaveAttribute('aria-valuenow', '95');

    fireEvent.keyDown(divider(), { key: 'Home' });

    expect(divider()).toHaveAttribute('aria-valuenow', '5');
  });

  it('avisa del reparto hacia fuera cuando lo controla otro', () => {
    const onRatioChange = vi.fn();

    renderSplit({ ratio: 0.4, onRatioChange });

    fireEvent.keyDown(divider(), { key: 'ArrowRight' });

    expect(onRatioChange.mock.calls[0]?.[0]).toBeCloseTo(0.42);
    // Controlado desde fuera: sin que nadie mueva la prop, el valor no cambia.
    expect(divider()).toHaveAttribute('aria-valuenow', '40');
  });

  it('respeta ambos mínimos con el teclado y descuenta el divisor', () => {
    renderSplit({ orientation: 'vertical', minFirst: 120, minSecond: 280 });
    const separator = divider();
    const container = separator.parentElement;
    if (!container) throw new Error('Falta el contenedor');
    Object.defineProperty(container, 'clientHeight', { value: 606 });
    Object.defineProperty(separator, 'offsetHeight', { value: 6 });
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '53');
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(separator).toHaveAttribute('aria-valuenow', '53');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '20');
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(separator).toHaveAttribute('aria-valuenow', '20');
  });

  it('pliega y despliega con doble clic y con Enter: el divisor se alcanza sin ratón', () => {
    const onCollapsedChange = vi.fn();

    const { rerender } = render(
      <SplitPane
        label="Ancho del panel de ramas"
        collapsible="first"
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        first={<p>Ramas de gitthul</p>}
        second={<p>Commits de gitthul</p>}
      />,
    );

    fireEvent.doubleClick(divider());

    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(divider(), { key: 'Enter' });

    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <SplitPane
        label="Ancho del panel de ramas"
        collapsible="first"
        collapsed
        onCollapsedChange={onCollapsedChange}
        first={<p>Ramas de gitthul</p>}
        second={<p>Commits de gitthul</p>}
      />,
    );

    fireEvent.keyDown(divider(), { key: 'Enter' });

    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it('el panel plegado queda fuera del alcance del teclado', () => {
    renderSplit({
      collapsible: 'first',
      collapsed: true,
      first: <button type="button">Nueva rama</button>,
      second: <p>Commits de gitthul</p>,
    });

    expect(screen.getByRole('button', { name: 'Nueva rama' }).closest('[inert]')).not.toBeNull();
  });

  it('plegado al ancho del contenido, el panel sigue siendo usable', () => {
    renderSplit({
      collapsible: 'first',
      collapsed: true,
      collapsedSize: 'content',
      first: <button type="button">Locales</button>,
      second: <p>Commits de gitthul</p>,
    });

    const boton = screen.getByRole('button', { name: 'Locales' });

    // A diferencia del plegado a cero, este conserva su tira de iconos: es el
    // panel que se reduce a un rail, no el que desaparece.
    expect(boton.closest('[inert]')).toBeNull();
    expect(boton).toBeVisible();
  });

  it('recuerda el reparto entre montajes cuando tiene identidad', () => {
    const store = mapStore();
    const mount = () =>
      render(
        <PaneStorageContext value={store}>
          <SplitPane
            label="Ancho del panel de ramas"
            storageId="prueba.ramas"
            defaultRatio={0.5}
            first={<p>Ramas</p>}
            second={<p>Commits</p>}
          />
        </PaneStorageContext>,
      );

    const { unmount } = mount();

    fireEvent.keyDown(divider(), { key: 'ArrowRight' });

    expect(divider()).toHaveAttribute('aria-valuenow', '52');

    unmount();
    mount();

    expect(divider()).toHaveAttribute('aria-valuenow', '52');
  });

  it('sin identidad, cada montaje arranca de cero', () => {
    const { unmount } = renderSplit({ defaultRatio: 0.5 });

    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    unmount();
    renderSplit({ defaultRatio: 0.5 });

    expect(divider()).toHaveAttribute('aria-valuenow', '50');
  });

  it('usa el almacén que le den, que es por donde entrará SettingsPort', () => {
    const store = mapStore([['prueba.ramas', 0.7]]);

    render(
      <PaneStorageContext value={store}>
        <SplitPane
          label="Ancho del panel de ramas"
          storageId="prueba.ramas"
          first={<p>Ramas</p>}
          second={<p>Commits</p>}
        />
      </PaneStorageContext>,
    );

    expect(divider()).toHaveAttribute('aria-valuenow', '70');

    fireEvent.keyDown(divider(), { key: 'ArrowLeft' });

    expect(store.read('prueba.ramas')).toBeCloseTo(0.68);
  });

  /*
   * Por defecto el almacén es el de memoria: la galería y las pruebas no
   * escriben en ningún lado, y la aplicación es quien envuelve el árbol con el
   * que habla con `SettingsPort`.
   */
  it('sin almacén de verdad el tamaño sigue funcionando, solo que no se recuerda', () => {
    renderSplit({ storageId: 'prueba.ramas' });

    fireEvent.keyDown(divider(), { key: 'ArrowRight' });

    expect(divider()).toHaveAttribute('aria-valuenow', '52');
  });

  it('el hover no desplaza la caja', () => {
    renderSplit();

    expectNoHoverShift(divider());
  });
});

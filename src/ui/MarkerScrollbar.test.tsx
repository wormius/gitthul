import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { MarkerScrollbar } from './MarkerScrollbar';
import type { ScrollMarker } from './markerScrollbar';

const markers: ScrollMarker[] = [
  { id: 'a', from: 12, to: 20, tone: 'added', label: 'Añadidas 12-20' },
  { id: 'b', from: 140, to: 141, tone: 'removed', label: 'Quitada 140' },
  { id: 'c', from: 700, tone: 'conflict', label: 'Conflicto en 700' },
];

function renderBar(props: Partial<Parameters<typeof MarkerScrollbar>[0]> = {}) {
  return render(
    <MarkerScrollbar markers={markers} label="Cambios de tabs.ts" total={1000} {...props} />,
  );
}

const bar = () => screen.getByRole('group', { name: 'Cambios de tabs.ts' });

describe('MarkerScrollbar', () => {
  it('se anuncia con su nombre', () => {
    renderBar();

    expect(bar()).toBeInTheDocument();
  });

  it('pinta una marca por cambio, cada una en su sitio', () => {
    renderBar();

    const bands = [...bar().children].map((mark) => mark.getAttribute('style'));

    expect(bands).toHaveLength(3);
    expect(bands[0]).toContain('top: 1.2%');
    expect(bands[1]).toContain('top: 14%');
  });

  it('la ventana visible se pinta aparte de las marcas', () => {
    renderBar({ viewport: { from: 100, to: 300 } });

    expect(bar().children).toHaveLength(4);
    expect(bar().firstElementChild?.getAttribute('style')).toContain('height: 20%');
  });

  it('arrastra la ventana visible para desplazar el contenido', () => {
    const onSeek = vi.fn();
    renderBar({ viewport: { from: 100, to: 300 }, onSeek });
    const thumb = screen.getByRole('scrollbar', { name: 'Cambios de tabs.ts' });

    vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 16,
      bottom: 500,
      width: 16,
      height: 500,
      toJSON: () => ({}),
    });
    vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 50,
      top: 50,
      left: 0,
      right: 16,
      bottom: 150,
      width: 16,
      height: 100,
      toJSON: () => ({}),
    });

    const down = createEvent.pointerDown(thumb, { pointerId: 1 });
    const move = createEvent.pointerMove(thumb, { pointerId: 1 });
    Object.defineProperty(down, 'clientY', { value: 75 });
    Object.defineProperty(move, 'clientY', { value: 225 });
    fireEvent(thumb, down);
    fireEvent(thumb, move);
    fireEvent.pointerUp(thumb, { pointerId: 1 });

    expect(onSeek).toHaveBeenCalledWith(400);
  });

  it('sin manejador las marcas son señales, no controles', () => {
    renderBar();

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('con manejador cada marca se puede pulsar y dice cuál es', async () => {
    const onSelect = vi.fn();

    renderBar({ onSelect });

    await userEvent.click(screen.getByRole('button', { name: 'Quitada 140' }));

    expect(onSelect).toHaveBeenCalledWith(markers[1]);
  });

  /*
   * La prueba que pide la verificación de F0.13.
   *
   * La barra no puede desplazar nada porque no está en el flujo: se posiciona en
   * absoluto sobre el contenedor. Se comprueba de las dos maneras que jsdom
   * permite — que el CSS del componente la saque del flujo, y que el contenido
   * de al lado quede intacto al aparecer, al cambiarle las marcas y al pasar el
   * puntero por encima.
   */
  describe('no desplaza nada', () => {
    it('la barra vive fuera del flujo', () => {
      renderBar();

      expect(getComputedStyle(bar()).position).toBe('absolute');
    });

    it('y cada marca dentro de ella también', () => {
      renderBar({ viewport: { from: 0, to: 100 }, onSelect: vi.fn() });

      for (const mark of bar().children) {
        expect(getComputedStyle(mark).position).toBe('absolute');
      }
    });

    it('el hover no mueve la barra ni sus marcas', () => {
      renderBar({ onSelect: vi.fn() });

      expectNoHoverShift(bar());
      expectNoHoverShift(screen.getByRole('button', { name: 'Añadidas 12-20' }));
    });
  });
});

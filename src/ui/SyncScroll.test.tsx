import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { SyncScroll } from './SyncScroll';
import { mirroredOffset } from './syncScroll';
import { SyncScrollPane } from './SyncScrollPane';

/**
 * jsdom no tiene diseño, así que `scrollTop` no se mueve solo: se define como
 * propiedad del elemento para poder leerla y escribirla igual que haría el
 * navegador, y el evento se lanza a mano.
 */
function withScroll(element: HTMLElement, values: Record<string, number>) {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(element, name, { value, writable: true, configurable: true });
  }
}

/** Como `withScroll`, pero redondeando al asignar: es lo que hace el navegador. */
function withRoundedScroll(element: HTMLElement, values: Record<string, number>) {
  for (const [name, value] of Object.entries(values)) {
    let current = value;

    Object.defineProperty(element, name, {
      configurable: true,
      get: () => current,
      set: (next: number) => {
        current = Math.round(next);
      },
    });
  }
}

function renderPanes(props: Partial<Parameters<typeof SyncScroll>[0]> = {}) {
  render(
    <SyncScroll {...props}>
      <SyncScrollPane label="Versión de main">
        <p>ours</p>
      </SyncScrollPane>
      <SyncScrollPane label="Versión de dev">
        <p>theirs</p>
      </SyncScrollPane>
      <SyncScrollPane label="Resultado">
        <p>merged</p>
      </SyncScrollPane>
    </SyncScroll>,
  );

  return {
    ours: screen.getByRole('region', { name: 'Versión de main' }),
    theirs: screen.getByRole('region', { name: 'Versión de dev' }),
    merged: screen.getByRole('region', { name: 'Resultado' }),
  };
}

describe('mirroredOffset', () => {
  it('en modo absoluto copia el desplazamiento tal cual', () => {
    const offset = mirroredOffset(
      { scroll: 120, scrollSize: 1000, clientSize: 300 },
      { scrollSize: 4000, clientSize: 300 },
      'absolute',
    );

    expect(offset).toBe(120);
  });

  it('en modo proporcional copia la fracción recorrida', () => {
    const offset = mirroredOffset(
      { scroll: 350, scrollSize: 1000, clientSize: 300 },
      { scrollSize: 2400, clientSize: 400 },
      'proportional',
    );

    // A mitad del recorrido de origen, a mitad del recorrido de destino.
    expect(offset).toBe(1000);
  });

  it('sin recorrido posible no mueve nada', () => {
    const offset = mirroredOffset(
      { scroll: 40, scrollSize: 300, clientSize: 300 },
      { scrollSize: 900, clientSize: 300 },
      'proportional',
    );

    expect(offset).toBe(0);
  });
});

describe('SyncScroll', () => {
  it('mover un panel arrastra a todos los demás', () => {
    const { ours, theirs, merged } = renderPanes();

    withScroll(ours, { scrollTop: 240, scrollHeight: 1000, clientHeight: 300 });
    withScroll(theirs, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 });
    withScroll(merged, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 });

    fireEvent.scroll(ours);

    expect(theirs.scrollTop).toBe(240);
    expect(merged.scrollTop).toBe(240);
  });

  it('el eje horizontal solo se propaga si se pide', () => {
    const { ours, theirs } = renderPanes({ axis: 'vertical' });

    withScroll(ours, { scrollLeft: 90, scrollWidth: 800, clientWidth: 300 });
    withScroll(theirs, { scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });

    fireEvent.scroll(ours);

    expect(theirs.scrollLeft).toBe(0);
  });

  it('con ambos ejes propaga las dos direcciones', () => {
    const { ours, theirs } = renderPanes({ axis: 'both' });

    withScroll(ours, { scrollTop: 12, scrollLeft: 90 });
    withScroll(theirs, { scrollTop: 0, scrollLeft: 0 });

    fireEvent.scroll(ours);

    expect(theirs.scrollTop).toBe(12);
    expect(theirs.scrollLeft).toBe(90);
  });

  it('no se persiguen entre ellos: el eco no vuelve al origen', () => {
    const { ours, theirs } = renderPanes();

    withScroll(ours, { scrollTop: 200 });
    withScroll(theirs, { scrollTop: 0 });

    fireEvent.scroll(ours);
    // El navegador dispararía el scroll del panel recién movido; su eco no debe
    // devolver al primero a la posición del segundo.
    fireEvent.scroll(theirs);

    expect(ours.scrollTop).toBe(200);
    expect(theirs.scrollTop).toBe(200);
  });

  it('un panel que se desmonta deja de recibir', () => {
    const { rerender } = render(
      <SyncScroll>
        <SyncScrollPane label="Versión de main">
          <p>ours</p>
        </SyncScrollPane>
        <SyncScrollPane label="Versión de dev">
          <p>theirs</p>
        </SyncScrollPane>
      </SyncScroll>,
    );

    const ours = screen.getByRole('region', { name: 'Versión de main' });
    const theirs = screen.getByRole('region', { name: 'Versión de dev' });

    withScroll(ours, { scrollTop: 55 });
    withScroll(theirs, { scrollTop: 0 });

    rerender(
      <SyncScroll>
        <SyncScrollPane label="Versión de main">
          <p>ours</p>
        </SyncScrollPane>
      </SyncScroll>,
    );

    fireEvent.scroll(ours);

    expect(theirs.scrollTop).toBe(0);
  });

  it('cada panel es alcanzable con el teclado y lleva su nombre', () => {
    const { ours, theirs } = renderPanes();

    expect(ours).toHaveAttribute('tabindex', '0');
    expect(theirs).toHaveAccessibleName('Versión de dev');
  });

  it('el hover no desplaza la caja', () => {
    const { ours } = renderPanes();

    expectNoHoverShift(ours);
  });
  /*
   * La rueda del ratón dispara varios eventos por fotograma. La versión que
   * soltaba la bandera de reentrada con `requestAnimationFrame` se tragaba los
   * que llegaban dentro del mismo cuadro —el scroll avanzaba a tirones— y
   * dejaba pasar el eco cuando la bandera ya había bajado, lo que devolvía el
   * panel casi a donde estaba. Estas dos pruebas fijan que ni una cosa ni la
   * otra dependan del reloj.
   */
  it('una ráfaga de eventos no se pierde: el cuadro acaba donde acabó la rueda', async () => {
    const { ours, theirs } = renderPanes();

    withScroll(ours, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 });
    withScroll(theirs, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 });

    for (const top of [40, 80, 120, 160]) {
      ours.scrollTop = top;
      fireEvent.scroll(ours);
      // El navegador dispara además el scroll del panel movido por código.
      fireEvent.scroll(theirs);
    }

    // El primero del cuadro se atiende en el acto: un desplazamiento suelto no
    // espera a nada.
    expect(theirs.scrollTop).toBe(40);

    await new Promise(requestAnimationFrame);

    // Y al cerrar el cuadro se aplica donde quedó la rueda, no las posiciones
    // intermedias: lo que importa es la última.
    expect(theirs.scrollTop).toBe(160);
    expect(ours.scrollTop).toBe(160);
  });

  it('el eco no arrastra al origen aunque llegue tarde', () => {
    const { ours, theirs } = renderPanes({ mode: 'proportional' });

    // Alturas distintas: en proporcional el eco vuelve con otra cifra, que es
    // justo lo que hacía temblar los dos paneles.
    withScroll(ours, { scrollTop: 350, scrollHeight: 1000, clientHeight: 300 });
    withScroll(theirs, { scrollTop: 0, scrollHeight: 2400, clientHeight: 400 });

    fireEvent.scroll(ours);

    const mirrored = theirs.scrollTop;

    // El eco del panel movido llega después de todo lo demás, como en el
    // navegador: no debe mover al origen ni un píxel.
    fireEvent.scroll(theirs);

    expect(theirs.scrollTop).toBe(mirrored);
    expect(ours.scrollTop).toBe(350);
  });
  it('el eco repetido tampoco arrastra: la rueda rápida mueve el origen dos veces', () => {
    const { ours, theirs } = renderPanes({ mode: 'proportional' });

    /*
     * Con redondeo, como el navegador. Sin él, el viaje de ida y vuelta en modo
     * proporcional sale exacto y esta prueba no distinguiría nada: **el píxel
     * que salta es justo el que se pierde al redondear**, y por eso las dos
     * alturas de abajo dan una proporción que no cierra.
     */
    withRoundedScroll(ours, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 });
    withRoundedScroll(theirs, { scrollTop: 0, scrollHeight: 631, clientHeight: 300 });

    // Dos vueltas de rueda seguidas, antes de que lleguen los ecos.
    ours.scrollTop = 100;
    fireEvent.scroll(ours);
    ours.scrollTop = 200;
    fireEvent.scroll(ours);

    const mirrored = theirs.scrollTop;

    // Los dos ecos del panel movido llegan ahora, los dos con la misma cifra.
    fireEvent.scroll(theirs);
    fireEvent.scroll(theirs);

    expect(ours.scrollTop).toBe(200);
    expect(theirs.scrollTop).toBe(mirrored);
  });
});

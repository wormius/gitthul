import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { installMatchMedia, resetMediaQueries } from './matchMedia';

// Permite completar debounce y cargas de datos sin depender de la velocidad del host.
configure({ asyncUtilTimeout: 5_000 });

installMatchMedia();

/*
 * jsdom no dibuja: su getContext lanza un aviso por cada intento. Devolver null
 * es lo que haría un navegador sin contexto 2D disponible, así que además de
 * quitar el ruido ejercita el camino en el que el grafo no puede pintarse.
 */
(HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;

/*
 * jsdom tampoco implementa los rectángulos de un Range, y CodeMirror los pide
 * para colocar el cursor y la selección. Sin esto el fallo no rompe una prueba
 * concreta: sale como excepción suelta desde el cuadro de animación en el que
 * el editor se mide, que es lo peor de los dos mundos.
 *
 * Se devuelve la lista vacía, que es exactamente lo que jsdom ya devuelve para
 * cualquier elemento: no se finge un diseño que no hay, solo se le da a
 * CodeMirror la misma respuesta que recibe del resto del DOM falso.
 */
const noRects = { getClientRects: () => [] as unknown as DOMRectList };

Object.assign(Range.prototype, noRects);

beforeEach(() => {
  resetMediaQueries();
});

afterEach(() => {
  cleanup();
});

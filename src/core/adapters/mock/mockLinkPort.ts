import type { LinkPort } from '@core/ports/LinkPort';

export interface MockLinkPort extends LinkPort {
  /** Lo que se habría abierto, en orden. Cero peticiones de red de verdad. */
  readonly opened: readonly string[];
}

/**
 * No abre nada: anota.
 *
 * Sirve al desarrollo en el navegador, donde `window.open` abriría una pestaña
 * que estorba, y a las pruebas, donde salir a la red sería inaceptable.
 */
export function createMockLinkPort(): MockLinkPort {
  const opened: string[] = [];

  return {
    opened,
    checkRelease: () => Promise.resolve({ status: 'current' }),

    openExternal: (url) => {
      opened.push(url);

      return Promise.resolve();
    },
  };
}

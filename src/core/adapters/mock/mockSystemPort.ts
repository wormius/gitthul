import type { LogPort } from '@core/ports/LogPort';
import type { SystemPort } from '@core/ports/SystemPort';

import { MOCK_DIRECTORIES } from './fixture/directories';

export interface MockSystemPortOptions {
  /** Dónde anotar lo que se habría revelado. */
  log?: LogPort;
  /** Las carpetas que el selector recorre, en orden. */
  directories?: readonly string[];
}

export interface MockSystemPort extends SystemPort {
  /**
   * Lo que devolverá el próximo `pickDirectory`, una sola vez.
   *
   * `null` finge que se canceló el diálogo. Es lo que permite que una prueba
   * pida «abre esta carpeta» o «el usuario se arrepintió» sin trucos.
   */
  answerWith: (path: string | null) => void;
  /** Las rutas que se habrían abierto en el explorador, en orden. */
  readonly revealed: readonly string[];
}

/**
 * El selector de carpetas y el explorador, fingidos.
 *
 * No abre ninguna ventana del sistema: devuelve rutas inventadas de una lista
 * fija y anota lo que se habría revelado. Se usa en navegador, galería y
 * pruebas; la ventana Tauri selecciona el adaptador nativo del mismo contrato.
 */
export function createMockSystemPort(options: MockSystemPortOptions = {}): MockSystemPort {
  const directories = options.directories ?? MOCK_DIRECTORIES.map((entry) => entry.path);
  const revealed: string[] = [];
  const answers: (string | null)[] = [];

  let cursor = 0;
  let clipboard = '';

  return {
    revealed,
    pickFile: () => Promise.resolve(answers.shift() ?? null),

    answerWith: (path) => {
      answers.push(path);
    },

    pickDirectory: () => {
      if (answers.length > 0) return Promise.resolve(answers.shift() ?? null);

      const path = directories[cursor % directories.length] ?? null;

      cursor += 1;

      return Promise.resolve(path);
    },

    revealPath: (path) => {
      revealed.push(path);
      options.log?.write('info', 'system', `abrir ${path} en el explorador`);

      return Promise.resolve();
    },

    resolveChildPath: (parent, child) =>
      Promise.resolve(`${parent.replace(/[\\/]+$/, '')}/${child}`),
    writeClipboardText: (text) => {
      clipboard = text;
      return Promise.resolve();
    },
    readClipboardText: () => Promise.resolve(clipboard),
  };
}

/**
 * Dónde escriben los adaptadores falsos que tienen que recordar algo.
 *
 * Va detrás de una interfaz mínima porque tiene dos usos distintos: en el
 * navegador de desarrollo escribe en el almacenamiento local, para que cambiar
 * de tema o elegir un avatar no se pierda al recargar, y en las pruebas escribe
 * en memoria, para que un caso no le herede el estado al siguiente.
 *
 * Nació con los ajustes y se generalizó al llegar el segundo consumidor, la
 * biblioteca: la misma regla de dos usos que gobierna los componentes.
 */
export interface JsonStorage {
  read: () => string | null;
  write: (raw: string) => void;
}

export function memoryStorage(initial?: string): JsonStorage {
  let value = initial ?? null;

  return {
    read: () => value,
    write: (raw) => {
      value = raw;
    },
  };
}

/**
 * Almacenamiento local del webview.
 *
 * Todo va envuelto porque puede estar deshabilitado o lleno: perder el ancho de
 * una columna nunca justifica que la ventana no abra.
 */
export function browserStorage(key: string): JsonStorage {
  return {
    read: () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },

    write: (raw) => {
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // Sin almacenamiento, lo guardado vive solo en esta sesión.
      }
    },
  };
}

/** Lo ilegible se trata como si no hubiera nada: el normalizador hace el resto. */
export function parseJson(raw: string | null): unknown {
  if (raw === null) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

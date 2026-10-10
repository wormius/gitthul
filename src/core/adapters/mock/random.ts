/**
 * Azar reproducible.
 *
 * El repositorio ficticio tiene que salir idéntico en cada arranque: si el
 * grafo cambiara de forma entre recargas no habría manera de comparar dos
 * capturas de pantalla, y una prueba que afirma «el commit 40 es una fusión»
 * fallaría un día de cada tres. Con una semilla fija, el mismo generador da
 * siempre la misma historia, y sigue pareciendo orgánica.
 *
 * `mulberry32` cabe en cinco líneas, no arrastra dependencia y reparte bien de
 * sobra para lo que aquí se pide, que es elegir mensajes y contar líneas.
 */
export interface Random {
  /** Coma flotante en [0, 1). */
  next: () => number;
  /** Entero en [min, max], ambos incluidos. */
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  /** `true` con la probabilidad dada. */
  chance: (probability: number) => boolean;
  /** Cadena hexadecimal de la longitud pedida; así se fabrican los SHA. */
  hex: (length: number) => string;
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,

    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)];

      if (item === undefined) throw new Error('No se puede elegir de una lista vacía');

      return item;
    },

    chance: (probability) => next() < probability,

    hex: (length) => {
      let out = '';

      while (out.length < length)
        out += Math.floor(next() * 0x10000)
          .toString(16)
          .padStart(4, '0');

      return out.slice(0, length);
    },
  };
}

/** Semilla estable a partir de un texto, para derivar azar de una ruta o un SHA. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

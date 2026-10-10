/**
 * `window.matchMedia` para jsdom, que no lo trae.
 *
 * No es solo un relleno: el sistema de diseño resuelve el modo claro/oscuro y
 * el alto contraste a partir de consultas de medios, así que las pruebas
 * necesitan poder responderlas y, sobre todo, cambiarlas en caliente para
 * comprobar que la interfaz reacciona.
 */

const answers = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

/** Fija la respuesta a una consulta y avisa a quien la esté siguiendo. */
export function setMediaQuery(query: string, matches: boolean): void {
  answers.set(query, matches);

  for (const listener of listeners.get(query) ?? []) listener();
}

export function resetMediaQueries(): void {
  answers.clear();
  listeners.clear();
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string) => {
    const list = {
      media: query,
      get matches() {
        return answers.get(query) ?? false;
      },
      onchange: null,
      addEventListener(_type: string, listener: () => void) {
        const set = listeners.get(query) ?? new Set<() => void>();

        set.add(listener);
        listeners.set(query, set);
      },
      removeEventListener(_type: string, listener: () => void) {
        listeners.get(query)?.delete(listener);
      },
      addListener(listener: () => void) {
        this.addEventListener('change', listener);
      },
      removeListener(listener: () => void) {
        this.removeEventListener('change', listener);
      },
      dispatchEvent: () => false,
    };

    return list as unknown as MediaQueryList;
  };
}

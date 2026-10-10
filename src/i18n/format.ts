/** Lo que se puede meter en un hueco `{...}` de una cadena traducida. */
export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Sustituye los huecos `{nombre}` de una plantilla.
 *
 * Un hueco sin valor se deja tal cual en vez de convertirse en `undefined`: si
 * alguien olvida pasar el nombre de la rama, que se vea el hueco en la interfaz
 * es infinitamente más fácil de encontrar que una frase silenciosamente rota.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;

  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];

    return value === undefined ? match : String(value);
  });
}

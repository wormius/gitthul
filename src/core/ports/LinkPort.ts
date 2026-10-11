/**
 * Consultar disponibilidad de publicaciones y abrir una dirección en el navegador del sistema.
 *
 * Ayuda, Apoyar y los enlaces confirmados de Terminal pasan por este puerto para
 * que se vea en una sola frontera dónde puede salir la aplicación a la red.
 */
export interface LinkPort {
  openExternal: (url: string) => Promise<void>;
  /** Consulta versiones estables publicadas; no descarga ni instala paquetes. */
  checkRelease: () => Promise<ReleaseCheck>;
}

export type ReleaseCheck =
  | { status: 'available'; version: string; url: string }
  | { status: 'current' }
  | { status: 'empty' };

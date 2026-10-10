/**
 * Consultar disponibilidad de publicaciones y abrir una dirección en el navegador del sistema.
 *
 * Ayuda, Apoyar y los enlaces confirmados de Terminal pasan por este puerto para
 * que se vea en una sola frontera dónde puede salir la aplicación a la red.
 */
/** La consulta se reactivará cuando se confirme el repositorio público de GitThul. */
export const RELEASE_CHECK_CONFIGURED = false;

export interface LinkPort {
  openExternal: (url: string) => Promise<void>;
  /** Sin origen público configurado, devuelve notConfigured sin consultar la red. */
  checkRelease: (channel: 'stable' | 'beta') => Promise<ReleaseCheck>;
}

export type ReleaseCheck =
  | { status: 'notConfigured' }
  | { status: 'available'; version: string; url: string }
  | { status: 'current' }
  | { status: 'empty' };

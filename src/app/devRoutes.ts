/**
 * Rutas internas de desarrollo.
 *
 * La galería es la única pantalla que no es la aplicación y no se ofrece al
 * usuario desde ninguna parte de la interfaz final.
 */

export const TOKENS_GALLERY_PATH = '/dev/tokens';

export function isTokensGalleryPath(pathname: string): boolean {
  return pathname === TOKENS_GALLERY_PATH || pathname === `${TOKENS_GALLERY_PATH}/`;
}

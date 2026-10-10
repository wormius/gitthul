/** Las tres plataformas que empaqueta el proyecto. */
export type Platform = 'mac' | 'windows' | 'linux';

/**
 * Plataforma según el motor del webview.
 *
 * No pasa por Tauri: `navigator` responde dentro de la ventana nativa y del
 * navegador de desarrollo. Se usa para adaptar los atajos de la interfaz.
 */
export function detectPlatform(userAgent: string = navigator.userAgent): Platform {
  if (/mac|iphone|ipad|ipod/i.test(userAgent)) return 'mac';
  if (/win/i.test(userAgent)) return 'windows';

  return 'linux';
}

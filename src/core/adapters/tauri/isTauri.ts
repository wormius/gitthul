/**
 * Si la ventana la sirve Tauri o un navegador.
 *
 * `__TAURI_INTERNALS__` es lo que el runtime inyecta antes de cargar la página;
 * mirarlo es más honesto que probar un `invoke` y esperar el fallo. Con esto, el
 * mismo build corre en `npm run dev` contra los adaptadores falsos y en
 * `npm run tauri dev` contra los reales.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

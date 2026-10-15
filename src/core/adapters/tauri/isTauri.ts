/**
 * Si la ventana la sirve Tauri o un navegador.
 *
 * `__TAURI_INTERNALS__` es lo que el runtime inyecta antes de cargar la página;
 * comprobarlo evita probar un `invoke` para decidir el entorno. La ausencia del
 * runtime requiere el modo simulado explícito de desarrollo o produce un error
 * de arranque; un fallo de IPC nunca habilita adaptadores falsos.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

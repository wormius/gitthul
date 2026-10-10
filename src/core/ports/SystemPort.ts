/**
 * Lo que GitThul le pide al sistema operativo fuera de git.
 *
 * Va en un puerto propio y no dentro de `LinkPort` porque `LinkPort` promete, en
 * ser la frontera para consultar publicaciones y abrir enlaces externos.
 * Un selector de carpetas no sale a ninguna parte, y diluirlo ahí costaría esa
 * garantía —que se pueda auditar en una sola línea de código dónde hay
 * conexión— a cambio de un archivo menos.
 *
 * La ventana Tauri usa `dialog`, `opener` y `clipboard-manager`; navegador, pruebas y
 * galería conservan el adaptador falso del mismo contrato.
 */
export interface SystemPort {
  /**
   * La carpeta elegida, o `null` si se canceló el diálogo.
   *
   * Cancelar **no es un fallo**: no rechaza, no lanza y no pinta nada. Quien
   * abre un selector y cambia de idea no ha roto nada.
   */
  pickDirectory: (options?: { title?: string; startAt?: string }) => Promise<string | null>;

  pickFile: (options?: { title?: string }) => Promise<string | null>;

  /** Abre la carpeta en el explorador de archivos del sistema. */
  revealPath: (path: string) => Promise<void>;

  /** Resuelve un hijo contra la ruta canónica del padre según el SO anfitrión. */
  resolveChildPath: (parent: string, child: string) => Promise<string>;

  /** Portapapeles de texto; se accede solo al copiar o pegar explícitamente. */
  writeClipboardText: (text: string) => Promise<void>;
  readClipboardText: () => Promise<string>;
}

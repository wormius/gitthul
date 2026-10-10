import { useEffect } from 'react';

/**
 * Apaga el menú contextual del navegador, que en la ventana no pinta nada.
 *
 * GitThul trae sus propios menús —`ContextMenu`, declarados en
 * `contextMenus.ts`—, y donde no hay uno declarado la respuesta correcta es que
 * no salga nada: el menú de WebKit ofrece «Recargar» o «Inspeccionar», que en
 * una aplicación de escritorio no son acciones del producto.
 *
 * **Los campos de texto se quedan con el suyo.** Ahí el menú nativo sí es el
 * del sistema —copiar, pegar, el diccionario— y sustituirlo obligaría a
 * reimplementar el portapapeles para no ganar nada.
 *
 * No hace falta excluir las regiones que sí tienen menú propio: `ContextMenu`
 * detiene la propagación y ya llama a `preventDefault`, así que este oyente ni
 * se entera. La comprobación de `defaultPrevented` es el cinturón por si algún
 * día alguien monta uno sin detenerla.
 */
export function useNativeMenu(): void {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target;
      const editable =
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');

      if (editable) return;

      event.preventDefault();
    };

    document.addEventListener('contextmenu', onContextMenu);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}

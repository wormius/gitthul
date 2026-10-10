import type { Settings } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';
import type { PaneSizeStore } from '@ui/paneStorage';

/**
 * El almacén de tamaños de panel, sobre el puerto de ajustes.
 *
 * Aquí se juntan los dos lados: los primitivos piden y escriben tamaños de
 * forma síncrona —están a mitad de un arrastre, no pueden esperar a nadie— y el
 * puerto guarda de forma asíncrona. La solución es la única razonable: la foto
 * que se leyó al arrancar se conserva en memoria y responde al instante, y cada
 * escritura se manda al puerto sin esperarla.
 *
 * Un fallo al guardar no se propaga. Quien arrastra un divisor no quiere un
 * diálogo de error, y el tamaño sigue funcionando en esta sesión aunque el
 * disco esté lleno.
 */
export function createPaneSettingsStore(
  port: SettingsPort,
  initial: Settings,
  onError?: (error: unknown) => void,
): PaneSizeStore {
  const sizes = new Map(Object.entries(initial.panes));

  return {
    read: (id) => sizes.get(id) ?? null,

    write: (id, value) => {
      sizes.set(id, value);

      void port.patch({ panes: { [id]: value } }).catch(onError);
    },
  };
}

import type { Settings } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';
import type { SectionCollapseStore } from '@ui/sectionStorage';

/**
 * El almacén de plegados con nombre, sobre el puerto de ajustes.
 *
 * Calco exacto de `createPaneSettingsStore`: la foto que se leyó al arrancar
 * vive en memoria y responde al instante, y cada escritura viaja al puerto sin
 * esperarla. Hoy solo lo usa el acordeón de `RefPanel` —el plegado de cada
 * sección es global y no por repositorio, CU-3 del subplan de GitWorking—, pero
 * el mecanismo no sabe nada de referencias de git: es genérico como su plantilla.
 */
export function createSectionSettingsStore(
  port: SettingsPort,
  initial: Settings,
  onError?: (error: unknown) => void,
): SectionCollapseStore {
  const collapsed = new Map(Object.entries(initial.workingSections));

  return {
    read: (id) => collapsed.get(id) ?? null,

    write: (id, value) => {
      collapsed.set(id, value);

      void port.patch({ workingSections: { [id]: value } }).catch(onError);
    },
  };
}

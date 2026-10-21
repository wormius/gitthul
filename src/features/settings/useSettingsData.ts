import { useCallback, useSyncExternalStore } from 'react';

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsPatch,
} from '@core/domain/settings';
import { usePorts } from '@app/PortsContext';
import type { SettingsPatchOptions, SettingsPort } from '@core/ports/SettingsPort';

/**
 * Lee los ajustes actuales y da una función `patch` que escribe por parche.
 *
 * Como los ajustes se leen una vez al arrancar y luego se mutan en memoria, el
 * estado se comparte en memoria. Los cambios del límite de respaldos esperan a
 * la persistencia para no anunciar una política que puede rechazar el almacén.
 * El estado local se almacena en un módulo-singleton para que todos los
 * consumidores compartan la referencia sin crear una suscripción por componente.
 */

// Estado compartido dentro del módulo
let currentSettings: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Estado actual para volver a comprobar preferencias después de una espera. */
export function getSettingsSnapshot(): Settings {
  return currentSettings;
}

/** Inicializa el estado con los valores reales leídos del disco. */
export function initSettingsData(initial: Settings): void {
  currentSettings = initial;
  for (const listener of listeners) listener();
}

/** Aplica un parche al estado y lo persiste a disco. */
async function applyPatch(
  port: Pick<SettingsPort, 'patch' | 'flush'>,
  patch: SettingsPatch,
  options?: SettingsPatchOptions,
) {
  // El límite puede rechazar un plan o retirar puntos. No publicar una política
  // que todavía no se confirmó, ni arrastrarla a otros parches concurrentes.
  if (patch.backup?.maxMiB !== undefined) {
    if (options) await port.patch(patch, options);
    else await port.patch(patch);
    // patch(maxMiB) ya espera a su escritura durable. flush podría esperar a un
    // parche ajeno posterior y atribuir su fallo a este límite ya guardado.
    currentSettings = mergeSettings(currentSettings, patch);
    for (const listener of listeners) listener();
    return;
  }
  const previous = currentSettings;
  currentSettings = mergeSettings(currentSettings, patch);
  for (const listener of listeners) listener();
  const next = currentSettings;
  try {
    if (options) await port.patch(patch, options);
    else await port.patch(patch);
    if (patch.git || patch.logging || patch.updates || patch.recovery || patch.backup)
      await port.flush();
  } catch (error) {
    if (currentSettings === next) {
      currentSettings = previous;
      for (const listener of listeners) listener();
    }
    throw error;
  }
}

export function useSettingsData(): {
  settings: Settings;
  patch: (p: SettingsPatch, options?: SettingsPatchOptions) => Promise<void>;
} {
  const ports = usePorts();
  const settings = useSyncExternalStore(subscribe, getSettingsSnapshot);

  const patch = useCallback(
    (p: SettingsPatch, options?: SettingsPatchOptions) => {
      const pending = applyPatch(ports.settings, p, options);
      void pending.catch((error: unknown) =>
        ports.log.write('error', 'settings', 'No se pudo guardar el ajuste', String(error)),
      );
      return pending;
    },
    [ports.settings, ports.log],
  );

  return { settings, patch };
}

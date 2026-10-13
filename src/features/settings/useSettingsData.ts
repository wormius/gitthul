import { useCallback, useSyncExternalStore } from 'react';

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
  type SettingsPatch,
} from '@core/domain/settings';
import { usePorts } from '@app/PortsContext';

/**
 * Lee los ajustes actuales y da una función `patch` que escribe por parche.
 *
 * Como los ajustes se leen una vez al arrancar y luego se mutan en memoria, el
 * valor en pantalla es la verdad; el puerto solo persiste los cambios al disco.
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
  port: { patch: (p: SettingsPatch) => Promise<void>; flush: () => Promise<void> },
  patch: SettingsPatch,
) {
  const previous = currentSettings;
  currentSettings = mergeSettings(currentSettings, patch);
  for (const listener of listeners) listener();
  const next = currentSettings;
  try {
    await port.patch(patch);
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
  patch: (p: SettingsPatch) => Promise<void>;
} {
  const ports = usePorts();
  const settings = useSyncExternalStore(subscribe, getSettingsSnapshot);

  const patch = useCallback(
    (p: SettingsPatch) => {
      const pending = applyPatch(ports.settings, p);
      void pending.catch((error: unknown) =>
        ports.log.write('error', 'settings', 'No se pudo guardar el ajuste', String(error)),
      );
      return pending;
    },
    [ports.settings, ports.log],
  );

  return { settings, patch };
}

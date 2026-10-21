import {
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings,
  type Settings,
  type SettingsPatch,
} from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

/**
 * Los ajustes, en un archivo de la carpeta de configuración del sistema.
 *
 * No van al almacenamiento local del webview a propósito: eso es caché del
 * navegador incrustado, y limpiarla —o cambiar de motor al actualizar el
 * sistema— se llevaría por delante el tema, el idioma y el reparto de todos los
 * paneles. Un archivo de texto en la carpeta de siempre se puede además copiar,
 * versionar y editar a mano.
 *
 * El módulo de Tauri se carga al invocarlo, como en los demás adaptadores.
 */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');

  return call<T>(command, args);
}

type SettingsCall = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createTauriSettingsPort(
  onReadError: (error: unknown) => void,
  call: SettingsCall = invoke,
): SettingsPort {
  let current: Settings | null = null;
  // `settings_write` reemplaza el archivo entero. Dos parches disparados muy
  // cerca (por ejemplo renombrar WIP y plegar un panel) no pueden escribir en
  // paralelo: si el primero terminara al final restauraría una foto obsoleta.
  let writes: Promise<void> = Promise.resolve();

  const load = async (): Promise<Settings> => {
    if (current !== null) return current;
    try {
      const saved = await call('settings_read');
      current ??= normalizeSettings(saved);
    } catch (error) {
      // Conserva una base editable si el archivo no se puede leer. No volver a
      // cargar el mismo archivo fallido en cada parche: la persona necesita
      // poder guardar ajustes válidos. La recuperación nativa mantiene su aviso
      // y la depuración y los respaldos suspendidos hasta que esa escritura se
      // confirme. El observador conserva el fallo original en el diagnóstico.
      current ??= normalizeSettings({
        ...DEFAULT_SETTINGS,
        recovery: { ...DEFAULT_SETTINGS.recovery, autoCleanup: false },
        backup: { ...DEFAULT_SETTINGS.backup, enabled: false },
      });
      onReadError(error);
    }

    return current;
  };

  return {
    read: load,

    patch: (patch: SettingsPatch, options) => {
      const change = structuredClone(patch);
      const token = options?.backupLimitToken;
      const write = writes
        .catch(() => undefined)
        .then(async () => {
          // Rebase only when this write starts. A rejected earlier limit must
          // never leak into an unrelated patch waiting behind it.
          const next = mergeSettings(await load(), change);
          await call('settings_write', {
            settings: next,
            ...(token !== undefined ? { backupLimitToken: token } : {}),
          });
          current = next;
        });
      writes = write;
      return write;
    },

    // La escritura ya espera a que Rust confirme, así que no queda nada
    // pendiente que vaciar: quien agrupa los parches es el envoltorio de arriba.
    flush: () => writes,
  };
}

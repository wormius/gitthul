import { mergeSettings, type SettingsPatch } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

export interface CoalesceOptions {
  /** Milisegundos de espera antes de escribir. */
  delay?: number;
  onError?: (error: unknown) => void;
}

const DEFAULT_DELAY = 300;

/**
 * Agrupa las escrituras de ajustes.
 *
 * Arrastrar el divisor de un panel produce un cambio por cuadro: sin agrupar,
 * eso serían sesenta viajes por segundo al disco para guardar un número que va
 * a cambiar otra vez en dieciséis milisegundos. El envoltorio funde los parches
 * pendientes y escribe uno solo cuando la mano se detiene.
 *
 * Se vacía también al ocultarse la página, que es el último momento en que se
 * puede escribir antes de que la ventana se cierre.
 */
export function coalesceSettingsWrites(
  port: SettingsPort,
  options: CoalesceOptions = {},
): SettingsPort {
  const delay = options.delay ?? DEFAULT_DELAY;

  let pending: SettingsPatch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    const patch = pending;

    pending = null;

    if (patch) await port.patch(patch);

    await port.flush();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      void flush().catch(options.onError);
    });
  }

  return {
    read: async () => {
      const current = await port.read();
      return pending ? mergeSettings(current, pending) : current;
    },

    patch: (patch) => {
      pending = pending ? mergePatch(pending, patch) : patch;

      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          void flush().catch(options.onError);
        }, delay);
      }

      return Promise.resolve();
    },

    flush,
  };
}

/** Solo se acumula lo que alguien tocó: un parche vacío no es un cambio. */
function mergePatch(current: SettingsPatch, next: SettingsPatch): SettingsPatch {
  const merged: SettingsPatch = { ...current };

  if (next.appearance) merged.appearance = { ...current.appearance, ...next.appearance };
  if (next.locale !== undefined) merged.locale = next.locale;
  if (next.panes) merged.panes = { ...current.panes, ...next.panes };
  if (next.workingSections) {
    merged.workingSections = { ...current.workingSections, ...next.workingSections };
  }
  if (next.git) merged.git = { ...current.git, ...next.git };
  if (next.logging) merged.logging = { ...current.logging, ...next.logging };
  if (next.updates) merged.updates = { ...current.updates, ...next.updates };
  if (next.recovery) merged.recovery = { ...current.recovery, ...next.recovery };
  if (next.backup) merged.backup = { ...current.backup, ...next.backup };

  return merged;
}

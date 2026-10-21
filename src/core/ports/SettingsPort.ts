import type { Settings, SettingsPatch } from '@core/domain/settings';

export interface SettingsPatchOptions {
  /** Authorizes only the exact backup space plan returned by previewLimit. */
  backupLimitToken?: string;
}

/**
 * Dónde sobreviven los ajustes entre arranques.
 *
 * Se lee **una vez, antes de pintar**: el tema y el idioma tienen que estar
 * puestos en el primer cuadro o la ventana parpadea de claro a oscuro delante
 * del usuario. Por eso `read` devuelve los ajustes enteros y no hay una lectura
 * por clave.
 *
 * Se escribe por parches, y quien escribe no espera: arrastrar el divisor de un
 * panel dispara decenas de cambios por segundo y ninguno merece un viaje a
 * disco. El adaptador agrupa y `flush` fuerza el vaciado cuando la ventana se
 * va a cerrar.
 */
export interface SettingsPort {
  read: () => Promise<Settings>;
  /**
   * Funde el parche con lo confirmado. Los cambios maxMiB o con backupLimitToken
   * esperan su propia persistencia y no requieren flush; los demás pueden agruparse.
   */
  patch: (patch: SettingsPatch, options?: SettingsPatchOptions) => Promise<void>;
  /** Escribe ya lo que quede pendiente. */
  flush: () => Promise<void>;
}

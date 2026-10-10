import { OperationCancelledError } from '@core/domain/errors';

/**
 * La espera que el adaptador falso finge.
 *
 * Sin ella toda respuesta llegaría en el mismo cuadro y los estados de carga
 * —esqueletos, indicadores, botones deshabilitados— serían código que nadie
 * puede ver ni probar. Con git de verdad nada es instantáneo, así que el falso
 * tampoco.
 */
export interface LatencyRange {
  min: number;
  max: number;
}

/** Lo bastante para que se vea el esqueleto, lo bastante poco para no estorbar. */
export const DEFAULT_LATENCY: LatencyRange = { min: 40, max: 180 };

/** Las pruebas no esperan: medir tiempos reales las volvería lentas y frágiles. */
export const NO_LATENCY: LatencyRange = { min: 0, max: 0 };

/**
 * Espera, y aborta si la señal lo pide.
 *
 * Cancelar rechaza con `OperationCancelledError` y no con un error del
 * catálogo: cambiar de pestaña a mitad de una consulta no es un fallo que haya
 * que explicarle a nadie.
 */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new OperationCancelledError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new OperationCancelledError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

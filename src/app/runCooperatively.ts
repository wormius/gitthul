import { OperationCancelledError } from '@core/domain/errors';

/** Ejecuta trabajo por bloques sin retener el hilo de la interfaz mientras carga. */
export async function runCooperatively<T>(
  steps: Generator<void, T>,
  signal?: AbortSignal,
): Promise<T> {
  // Un microtask no permite pintar: hace falta devolver el control al navegador.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw new OperationCancelledError();
  let deadline = performance.now() + 8;
  let result = steps.next();
  while (!result.done) {
    if (signal?.aborted) throw new OperationCancelledError();
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new OperationCancelledError();
      deadline = performance.now() + 8;
    }
    result = steps.next();
  }
  return result.value;
}

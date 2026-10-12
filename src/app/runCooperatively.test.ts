import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationCancelledError } from '@core/domain/errors';
import { runCooperatively } from './runCooperatively';

describe('runCooperatively', () => {
  afterEach(() => vi.restoreAllMocks());

  it('permite pintar antes de empezar y atender eventos entre bloques largos', async () => {
    const events: string[] = [];
    // Cada bloque representa más que el presupuesto de un frame.
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (elapsed += 10));
    function* work(): Generator<void, number> {
      events.push('first');
      setTimeout(() => events.push('input'), 0);
      yield;
      events.push('second');
      return 42;
    }
    const task = runCooperatively(work());
    expect(events).toEqual([]);
    await expect(task).resolves.toBe(42);
    expect(events).toEqual(['first', 'input', 'second']);
  });

  it('no continúa el grafo de un repositorio que se dejó de observar', async () => {
    const controller = new AbortController();
    let continued = false;
    function* work(): Generator<void, number> {
      controller.abort();
      yield;
      continued = true;
      return 1;
    }
    await expect(runCooperatively(work(), controller.signal)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(continued).toBe(false);
  });
});

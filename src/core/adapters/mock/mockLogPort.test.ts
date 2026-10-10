import { describe, expect, it, vi } from 'vitest';

import { createMockLogPort } from './mockLogPort';

describe('createMockLogPort', () => {
  it('guarda lo escrito y lo devuelve en orden', async () => {
    const log = createMockLogPort();

    log.write('info', 'git.read', 'recorriendo commits');
    log.write('error', 'git.write', 'push rechazado', 'error: failed to push some refs');

    const entries = await log.read();

    expect(entries.map((entry) => entry.message)).toEqual([
      'recorriendo commits',
      'push rechazado',
    ]);
    expect(entries[1]?.detail).toBe('error: failed to push some refs');
    expect(entries[0]?.id).toBeLessThan(entries[1]?.id ?? 0);
  });

  it('filtra por nivel mínimo y por ámbito', async () => {
    const log = createMockLogPort();

    log.setDebugEnabled(true);
    log.write('debug', 'git.read', 'uno');
    log.write('warn', 'git.read', 'dos');
    log.write('error', 'settings', 'tres');

    expect(await log.read({ minLevel: 'warn' })).toHaveLength(2);
    expect(await log.read({ scope: 'git.read' })).toHaveLength(2);
    expect(await log.read({ minLevel: 'warn', scope: 'settings' })).toHaveLength(1);
  });

  /*
   * Una sesión con el modo de depuración encendido produce decenas de miles de
   * líneas; quedarse sin memoria por guardarlas todas sería absurdo.
   */
  it('tira las viejas al llegar al tope', async () => {
    const log = createMockLogPort({ capacity: 3 });

    for (const message of ['uno', 'dos', 'tres', 'cuatro']) log.write('info', 'app', message);

    expect((await log.read()).map((entry) => entry.message)).toEqual(['dos', 'tres', 'cuatro']);
  });

  it('avisa a quien escuche hasta que deja de escuchar', () => {
    const log = createMockLogPort();
    const listener = vi.fn();
    const stop = log.subscribe(listener);

    log.write('info', 'app', 'arrancó');

    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    log.write('info', 'app', 'y siguió');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('se puede vaciar', async () => {
    const log = createMockLogPort();

    log.write('info', 'app', 'algo');
    await log.clear();

    expect(await log.read()).toEqual([]);
  });
});

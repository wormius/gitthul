import { beforeEach, describe, expect, it } from 'vitest';
import { selectPorts } from './selectPorts';

describe('diagnostic settings wiring', () => {
  beforeEach(() => localStorage.clear());
  it('migra a normal, cambia en caliente, persiste y restaura debug al reiniciar', async () => {
    const ports = selectPorts();
    expect((await ports.settings.read()).logging.debugEnabled).toBe(false);
    ports.log.write('debug', 'test', 'hidden');
    expect(await ports.log.read()).toEqual([]);
    await ports.settings.patch({ logging: { debugEnabled: true } });
    ports.log.write('debug', 'test', 'enabled');
    expect((await ports.log.read()).some((entry) => entry.message === 'enabled')).toBe(true);
    const restarted = selectPorts();
    expect((await restarted.settings.read()).logging.debugEnabled).toBe(true);
    restarted.log.write('debug', 'test', 'after restart');
    expect((await restarted.log.read()).some((entry) => entry.message === 'after restart')).toBe(
      true,
    );
    await restarted.settings.patch({ logging: { debugEnabled: false } });
    restarted.log.write('debug', 'test', 'disabled');
    expect((await restarted.log.read()).some((entry) => entry.message === 'disabled')).toBe(false);
    expect((await restarted.log.read()).some((entry) => entry.message === 'after restart')).toBe(
      true,
    );
  });
});

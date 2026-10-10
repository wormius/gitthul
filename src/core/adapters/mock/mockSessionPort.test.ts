import { describe, expect, it } from 'vitest';

import { memoryStorage } from './storage';
import { createMockSessionPort } from './mockSessionPort';

describe('createMockSessionPort', () => {
  it('normaliza al leer y persiste únicamente el snapshot ligero', async () => {
    const storage = memoryStorage(
      JSON.stringify({
        tabs: [{ id: 't1', surface: { kind: 'terminal', cwd: '/tmp' } }],
        activeId: 't1',
        overlay: 'logs',
      }),
    );
    const port = createMockSessionPort({ storage });
    const session = await port.read();

    expect(session.activeId).toBe('t1');
    await port.write(session);
    expect(storage.read()).not.toContain('overlay');
    expect(JSON.parse(storage.read() ?? '{}')).toEqual(session);
    expect(await createMockSessionPort({ storage }).read()).toEqual(session);
  });
});

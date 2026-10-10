import { describe, expect, it } from 'vitest';

import { memoryStorage } from './storage';
import { createMockLibraryPort } from './mockLibraryPort';

describe('createMockLibraryPort', () => {
  it('migra un workspace previo y persiste sus espacios en la biblioteca', async () => {
    const storage = memoryStorage(
      JSON.stringify({
        spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['gitthul'] }],
        sort: 'name',
        usage: {},
      }),
    );
    const port = createMockLibraryPort({ storage });

    expect(await port.read()).toMatchObject({
      spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['gitthul'] }],
      sort: 'name',
    });
    await port.setAvatar('gitthul', { glyph: 'ship', tone: 2 });
    await port.createSpace('Personal');
    await port.addToSpace('space-2', 'gitthul');

    expect(storage.read()).toContain('Personal');
    expect((await port.read()).spaces[1]?.repos).toEqual(['gitthul']);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LIBRARY } from '@core/domain/library';

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

  it('persiste una sola vez todos los miembros y la navegación del destino', async () => {
    const storage = memoryStorage(
      JSON.stringify({
        ...DEFAULT_LIBRARY,
        spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['uno'], collapsed: true }],
      }),
    );
    const write = vi.spyOn(storage, 'write');
    const port = createMockLibraryPort({ storage });
    await port.addManyToSpace('space-1', ['uno', 'dos', 'tres', 'dos'], true);

    expect(write).toHaveBeenCalledOnce();
    expect((await createMockLibraryPort({ storage }).read()).spaces).toEqual([
      { id: 'space-1', name: 'Trabajo', repos: ['uno', 'dos', 'tres'] },
    ]);
    expect(await port.read()).toMatchObject({ layout: 'spaces', view: { id: 'space-1' } });
    await port.addManyToSpace('space-1', ['uno', 'dos', 'tres'], true);
    expect(write).toHaveBeenCalledOnce();
  });

  it('crea un espacio con la selección completa en una sola escritura', async () => {
    const storage = memoryStorage();
    const write = vi.spyOn(storage, 'write');
    const port = createMockLibraryPort({ storage });
    await port.createSpaceAndAddMany('Trabajo', ['uno', 'dos', 'uno']);

    expect(write).toHaveBeenCalledOnce();
    expect(await port.read()).toMatchObject({
      spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['uno', 'dos'] }],
      layout: 'spaces',
      view: { kind: 'space', id: 'space-1' },
    });
  });

  it('una escritura fallida no cambia la caché y permite reintentar la misma selección', async () => {
    const storage = memoryStorage(
      JSON.stringify({
        ...DEFAULT_LIBRARY,
        spaces: [{ id: 'space-1', name: 'Trabajo', repos: [] }],
      }),
    );
    const originalWrite = storage.write;
    const write = vi.spyOn(storage, 'write').mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    const port = createMockLibraryPort({ storage });

    await expect(port.addManyToSpace('space-1', ['uno', 'dos'])).rejects.toThrow(
      'Storage unavailable',
    );
    expect((await port.read()).spaces[0]?.repos).toEqual([]);
    write.mockImplementation(originalWrite);
    await port.addManyToSpace('space-1', ['uno', 'dos']);
    expect(write).toHaveBeenCalledTimes(2);
    expect((await createMockLibraryPort({ storage }).read()).spaces[0]?.repos).toEqual([
      'uno',
      'dos',
    ]);
  });

  it.each([
    { scope: ['space-1'], remaining: ['uno', 'dos', 'tres'] },
    { scope: undefined, remaining: ['tres'] },
  ])('quita las pertenencias de $scope con una sola escritura', async ({ scope, remaining }) => {
    const storage = memoryStorage(
      JSON.stringify({
        ...DEFAULT_LIBRARY,
        spaces: [
          { id: 'space-1', name: 'Uno', repos: ['uno', 'dos'] },
          { id: 'space-2', name: 'Dos', repos: ['uno', 'dos', 'tres'] },
        ],
      }),
    );
    const write = vi.spyOn(storage, 'write');
    const port = createMockLibraryPort({ storage });
    await port.removeManyFromSpaces(['uno', 'dos', 'uno'], scope);

    expect(write).toHaveBeenCalledOnce();
    expect((await createMockLibraryPort({ storage }).read()).spaces).toEqual([
      { id: 'space-1', name: 'Uno', repos: [] },
      { id: 'space-2', name: 'Dos', repos: remaining },
    ]);
    await port.removeManyFromSpaces(['uno', 'dos'], scope);
    expect(write).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LIBRARY, type Library } from '@core/domain/library';

import { createTauriLibraryPort } from './tauriLibraryPort';

const INITIAL: Library = {
  ...DEFAULT_LIBRARY,
  spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['uno'], collapsed: true }],
};

describe('createTauriLibraryPort', () => {
  it('guarda miembros, expansión y navegación en una sola escritura nativa confirmada', async () => {
    let disk = structuredClone(INITIAL);
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'library_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['library']) as Library;
      return Promise.resolve(undefined);
    });
    const port = createTauriLibraryPort(call);
    await port.addManyToSpace('space-1', ['uno', 'dos', 'tres', 'dos'], true);

    expect(call.mock.calls.filter(([command]) => command === 'library_write')).toHaveLength(1);
    expect(await createTauriLibraryPort(call).read()).toMatchObject({
      spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['uno', 'dos', 'tres'] }],
      layout: 'spaces',
      view: { kind: 'space', id: 'space-1' },
    });
  });

  it('crea y guarda el espacio y todos sus miembros en una sola escritura', async () => {
    let disk = structuredClone(DEFAULT_LIBRARY);
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'library_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['library']) as Library;
      return Promise.resolve(undefined);
    });
    const port = createTauriLibraryPort(call);
    await port.createSpaceAndAddMany('Entrega', ['uno', 'dos', 'uno']);

    expect(call.mock.calls.filter(([command]) => command === 'library_write')).toHaveLength(1);
    expect(disk).toMatchObject({
      spaces: [{ id: 'space-1', name: 'Entrega', repos: ['uno', 'dos'] }],
      layout: 'spaces',
      view: { kind: 'space', id: 'space-1' },
    });
  });

  it('una escritura rechazada conserva la caché anterior y reintenta de verdad el mismo lote', async () => {
    let disk = structuredClone(INITIAL);
    let attempts = 0;
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'library_read') return Promise.resolve(structuredClone(disk));
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('Permission denied'));
      disk = structuredClone(args?.['library']) as Library;
      return Promise.resolve(undefined);
    });
    const port = createTauriLibraryPort(call);
    const previous = await port.read();

    await expect(port.addManyToSpace('space-1', ['dos', 'tres'], true)).rejects.toThrow(
      'Permission denied',
    );
    await expect(port.flush()).rejects.toThrow('Permission denied');
    expect(await port.read()).toBe(previous);
    expect(disk).toEqual(INITIAL);
    await port.addManyToSpace('space-1', ['dos', 'tres'], true);
    await port.flush();
    expect(attempts).toBe(2);
    expect(disk.spaces[0]?.repos).toEqual(['uno', 'dos', 'tres']);
    expect(await port.read()).toEqual(disk);
  });

  it('serializa una selección y un cambio de orden sin perder ninguno ni publicar caché pendiente', async () => {
    let disk = structuredClone(INITIAL);
    let release!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const call = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'library_read') return structuredClone(disk);
      writes += 1;
      if (writes === 1) await firstWrite;
      disk = structuredClone(args?.['library']) as Library;
      return undefined;
    });
    const port = createTauriLibraryPort(call);
    await port.read();
    const added = port.addManyToSpace('space-1', ['dos', 'tres']);
    const sorted = port.setSort('name');
    let readingFinished = false;
    const reading = port.read().then((library) => {
      readingFinished = true;
      return library;
    });

    await vi.waitFor(() => expect(writes).toBe(1));
    expect(readingFinished).toBe(false);
    expect(disk).toEqual(INITIAL);
    release();
    await Promise.all([added, sorted]);
    expect(await reading).toMatchObject({
      sort: 'name',
      spaces: [{ repos: ['uno', 'dos', 'tres'] }],
    });
    expect(disk.sort).toBe('name');
    expect(writes).toBe(2);
    expect(disk.spaces[0]?.repos).toEqual(['uno', 'dos', 'tres']);
  });

  it('una mutación posterior parte de la última escritura exitosa cuando la primera falla', async () => {
    let disk = structuredClone(INITIAL);
    let writes = 0;
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'library_read') return Promise.resolve(structuredClone(disk));
      writes += 1;
      if (writes === 1) return Promise.reject(new Error('Write failed'));
      disk = structuredClone(args?.['library']) as Library;
      return Promise.resolve(undefined);
    });
    const port = createTauriLibraryPort(call);
    const failed = port.addManyToSpace('space-1', ['dos']);
    const renamed = port.renameSpace('space-1', 'Entrega');

    await expect(failed).rejects.toThrow('Write failed');
    await renamed;
    expect(disk.spaces[0]).toEqual({
      id: 'space-1',
      name: 'Entrega',
      repos: ['uno'],
      collapsed: true,
    });
    await port.addManyToSpace('space-1', ['dos']);
    expect(disk.spaces[0]?.repos).toEqual(['uno', 'dos']);
  });

  it.each([
    { scope: ['space-1'], remaining: ['uno', 'dos', 'tres'] },
    { scope: undefined, remaining: ['tres'] },
  ])(
    'quita de $scope en una escritura confirmada y permite reintentar un fallo',
    async ({ scope, remaining }) => {
      const initial: Library = {
        ...DEFAULT_LIBRARY,
        spaces: [
          { id: 'space-1', name: 'Uno', repos: ['uno', 'dos'] },
          { id: 'space-2', name: 'Dos', repos: ['uno', 'dos', 'tres'] },
        ],
        avatars: { uno: { glyph: 'ship', tone: 2 } },
      };
      let disk = structuredClone(initial);
      let writes = 0;
      const call = vi.fn((command: string, args?: Record<string, unknown>) => {
        if (command === 'library_read') return Promise.resolve(structuredClone(disk));
        writes += 1;
        if (writes === 1) return Promise.reject(new Error('Permission denied'));
        disk = structuredClone(args?.['library']) as Library;
        return Promise.resolve(undefined);
      });
      const port = createTauriLibraryPort(call);
      const previous = await port.read();

      await expect(port.removeManyFromSpaces(['uno', 'dos', 'uno'], scope)).rejects.toThrow(
        'Permission denied',
      );
      expect(disk).toEqual(initial);
      expect(await port.read()).toBe(previous);
      await port.removeManyFromSpaces(['uno', 'dos', 'uno'], scope);
      expect(writes).toBe(2);
      expect(disk.spaces).toEqual([
        { id: 'space-1', name: 'Uno', repos: [] },
        { id: 'space-2', name: 'Dos', repos: remaining },
      ]);
      expect(disk.avatars).toEqual(initial.avatars);
      expect(await createTauriLibraryPort(call).read()).toEqual(disk);
      await port.removeManyFromSpaces(['uno', 'dos'], scope);
      expect(writes).toBe(2);
    },
  );
});

it('persists aliases through native JSON and preserves the old name when a write fails', async () => {
  let disk = structuredClone(INITIAL);
  let fail = false;
  const call = vi.fn((command: string, args?: Record<string, unknown>) => {
    if (command === 'library_read') return Promise.resolve(structuredClone(disk));
    if (fail) return Promise.reject(new Error('Permission denied'));
    disk = structuredClone(args?.['library']) as Library;
    return Promise.resolve(undefined);
  });
  const port = createTauriLibraryPort(call);
  await port.setAlias('uno', ' Delivery ');
  expect((await createTauriLibraryPort(call).read()).aliases).toEqual({ uno: 'Delivery' });
  fail = true;
  await expect(port.setAlias('uno', 'Replacement')).rejects.toThrow('Permission denied');
  expect((await port.read()).aliases).toEqual({ uno: 'Delivery' });
  fail = false;
  await Promise.all([port.setAlias('uno', null), port.setAlias('dos', 'Second')]);
  expect((await createTauriLibraryPort(call).read()).aliases).toEqual({ dos: 'Second' });
  expect(disk.spaces).toEqual(INITIAL.spaces);
});

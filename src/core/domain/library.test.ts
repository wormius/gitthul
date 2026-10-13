import { describe, expect, it } from 'vitest';

import {
  addToSpace,
  addManyToSpace,
  createSpace,
  createSpaceAndAddMany,
  DEFAULT_LIBRARY,
  deleteSpace,
  moveSpace,
  normalizeLibrary,
  recordOpening,
  removeFromSpace,
  renameSpace,
  setAvatar,
  setLayout,
  setSort,
  setSpaceCollapsed,
  setView,
} from './library';

describe('biblioteca local', () => {
  it('migra preferencias y espacios de un workspace antiguo', () => {
    expect(
      normalizeLibrary(
        {
          spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['gitthul'] }],
          layout: 'spaces',
          view: { kind: 'space', id: 'space-1' },
          sort: 'name',
          avatars: { gitthul: { glyph: 'ship', tone: 2 } },
          usage: { '2026-08-20': 3 },
        },
        new Date('2026-08-21T12:00:00').getTime(),
      ),
    ).toEqual({
      spaces: [{ id: 'space-1', name: 'Trabajo', repos: ['gitthul'] }],
      view: { kind: 'space', id: 'space-1' },
      sort: 'name',
      layout: 'spaces',
      avatars: { gitthul: { glyph: 'ship', tone: 2 } },
      usage: { '2026-08-20': 3 },
    });
  });

  it('muta sort, avatar y uso sin registrar qué repo se abrió', () => {
    let library = setSort(DEFAULT_LIBRARY, 'name');
    library = setAvatar(library, 'gitthul', { glyph: 'ship', tone: 2 });
    library = recordOpening(library, new Date('2026-08-21T12:00:00').getTime());

    expect(library).toEqual({
      spaces: [],
      view: { kind: 'recent' },
      sort: 'name',
      layout: 'list',
      avatars: { gitthul: { glyph: 'ship', tone: 2 } },
      usage: { '2026-08-21': 1 },
    });
  });

  it('normaliza y conserva únicamente colores libres hexadecimales seguros', () => {
    const normalized = normalizeLibrary({
      avatars: {
        gitthul: { glyph: 'ship', tone: 2, color: '#A1B2C3' },
        inseguro: { glyph: 'ghost', tone: 4, color: 'url(secret)' },
      },
    });

    expect(normalized.avatars).toEqual({
      gitthul: { glyph: 'ship', tone: 2, color: '#a1b2c3' },
      inseguro: { glyph: 'ghost', tone: 4 },
    });
  });

  it('administra espacios y pertenencias sin guardar estado Git', () => {
    let library = createSpace(DEFAULT_LIBRARY, 'Trabajo');
    library = createSpace(library, 'Personal');
    library = addToSpace(library, 'space-1', 'gitthul');
    library = addToSpace(library, 'space-1', 'gitthul');
    library = setSpaceCollapsed(library, 'space-1', true);
    library = renameSpace(library, 'space-2', 'Código abierto');
    library = moveSpace(library, 'space-2', 0);
    library = setView(library, { kind: 'space', id: 'space-1' });
    library = setLayout(library, 'spaces');

    expect(library.spaces).toEqual([
      { id: 'space-2', name: 'Código abierto', repos: [] },
      { id: 'space-1', name: 'Trabajo', repos: ['gitthul'], collapsed: true },
    ]);
    expect(library.view).toEqual({ kind: 'space', id: 'space-1' });
    expect(library.layout).toBe('spaces');

    library = removeFromSpace(library, 'space-1', 'gitthul');
    library = deleteSpace(library, 'space-1');
    expect(library.spaces).toEqual([{ id: 'space-2', name: 'Código abierto', repos: [] }]);
    expect(library.view).toEqual({ kind: 'recent' });
  });

  it('normaliza entradas corruptas sin perder miembros de repositorios ausentes', () => {
    expect(
      normalizeLibrary({
        spaces: [
          {
            id: 'space-4',
            name: ' Trabajo ',
            repos: ['gitthul', 'gitthul', 'ausente', 4],
            collapsed: true,
          },
          { id: 'space-4', name: 'Duplicado', repos: [] },
          { id: 'space-5', name: 'Trabajo', repos: [] },
        ],
        view: { kind: 'space', id: 'desconocido' },
        layout: 'incorrecto',
      }),
    ).toMatchObject({
      spaces: [
        {
          id: 'space-4',
          name: 'Trabajo',
          repos: ['gitthul', 'ausente'],
          collapsed: true,
        },
      ],
      view: { kind: 'recent' },
      layout: 'list',
    });
  });

  it('agrega una selección deduplicada sin retirarla de sus espacios originales', () => {
    const original = {
      ...DEFAULT_LIBRARY,
      spaces: [
        { id: 'space-1', name: 'Origen', repos: ['uno', 'dos'] },
        { id: 'space-2', name: 'Destino', repos: ['dos'], collapsed: true },
      ],
    };
    const added = addManyToSpace(original, 'space-2', ['uno', 'dos', 'uno', 'tres'], true);

    expect(added.spaces).toEqual([
      original.spaces[0],
      { id: 'space-2', name: 'Destino', repos: ['dos', 'uno', 'tres'] },
    ]);
    expect(added.spaces[0]).toBe(original.spaces[0]);
    expect(original.spaces[1]?.repos).toEqual(['dos']);
    expect(added.layout).toBe('spaces');
    expect(added.view).toEqual({ kind: 'space', id: 'space-2' });
    expect(addManyToSpace(added, 'space-2', ['uno', 'dos', 'tres'])).toBe(added);
    expect(addManyToSpace(original, 'ausente', ['uno'], true)).toBe(original);
  });

  it('crea el espacio, agrega todos sus miembros y lo revela como una sola transformación', () => {
    const initial = createSpace(DEFAULT_LIBRARY, 'Origen');
    const created = createSpaceAndAddMany(initial, '  Destino  ', ['uno', 'dos', 'uno']);

    expect(created.spaces).toEqual([
      initial.spaces[0],
      { id: 'space-2', name: 'Destino', repos: ['uno', 'dos'] },
    ]);
    expect(created.layout).toBe('spaces');
    expect(created.view).toEqual({ kind: 'space', id: 'space-2' });
    expect(createSpaceAndAddMany(created, 'Destino', ['tres'])).toBe(created);
    expect(createSpaceAndAddMany(created, ' ', ['tres'])).toBe(created);
  });
});

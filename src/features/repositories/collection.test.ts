import { describe, expect, it } from 'vitest';

import type { RepoSummary } from '@core/domain/repository';

import {
  filterRepositories,
  nextSelection,
  recentRepositories,
  sortRepositories,
  spacesOf,
  validateSpaceName,
  visibleRepositories,
} from './collection';

const collator = new Intl.Collator('es-MX', { numeric: true });
const repo = (name: string, lastOpenedAt: number | null = null): RepoSummary => ({
  id: name,
  name,
  path: `/repos/${name}`,
  head: 'main',
  lastOpenedAt,
});
const repos = [repo('ñandu', 300), repo('bitácora', 100), repo('dotfiles'), repo('ábaco', 50)];

describe('colección de repositorios', () => {
  it('filtra nombre y ruta sin distinguir tildes ni caja', () => {
    expect(filterRepositories(repos, 'BITACORA').map((item) => item.name)).toEqual(['bitácora']);
    expect(filterRepositories(repos, 'repos/dot').map((item) => item.name)).toEqual(['dotfiles']);
  });

  it('ordena con el idioma o por última apertura sin mutar la entrada', () => {
    const original = [...repos];
    expect(sortRepositories(repos, 'name', collator).map((item) => item.name)).toEqual([
      'ábaco',
      'bitácora',
      'dotfiles',
      'ñandu',
    ]);
    expect(sortRepositories(repos, 'lastOpened', collator).map((item) => item.name)).toEqual([
      'ñandu',
      'bitácora',
      'ábaco',
      'dotfiles',
    ]);
    expect(repos).toEqual(original);
  });

  it('limita recientes a cinco y excluye los nunca abiertos', () => {
    const many = Array.from({ length: 8 }, (_, index) => repo(`repo-${index}`, index));
    expect(recentRepositories([...many, repo('nuevo')]).map((item) => item.name)).toEqual([
      'repo-7',
      'repo-6',
      'repo-5',
      'repo-4',
      'repo-3',
    ]);
  });

  it('compone filtro y orden para Todos', () => {
    expect(
      visibleRepositories({ repositories: repos, sort: 'name', filter: 'a', collator }).map(
        (item) => item.name,
      ),
    ).toEqual(['ábaco', 'bitácora', 'ñandu']);
  });

  it('mueve la selección a la siguiente o a la anterior al olvidar', () => {
    expect(nextSelection(repos, 'bitácora')?.name).toBe('dotfiles');
    expect(nextSelection(repos, 'ábaco')?.name).toBe('dotfiles');
    expect(nextSelection([repo('solo')], 'solo')).toBeNull();
  });

  it('valida nombres de espacio con la misma regla del dominio', () => {
    const spaces = [{ id: 'space-1', name: 'Trabajo', repos: [] }];
    expect(validateSpaceName(spaces, '   ')).toBe('empty');
    expect(validateSpaceName(spaces, 'Trabajo')).toBe('taken');
    expect(validateSpaceName(spaces, 'Trabajo', 'space-1')).toBeNull();
    expect(validateSpaceName(spaces, 'Personal')).toBeNull();
  });

  it('encuentra todas las pertenencias de un repositorio', () => {
    const spaces = [
      { id: 'space-1', name: 'Trabajo', repos: ['bitácora'] },
      { id: 'space-2', name: 'Personal', repos: ['bitácora', 'dotfiles'] },
    ];
    expect(spacesOf(spaces, 'bitácora').map((space) => space.name)).toEqual([
      'Trabajo',
      'Personal',
    ]);
  });
});

it('filters and sorts by aliases while retaining original names, paths and objects', () => {
  const original = [repo('alpha'), repo('beta')];
  const aliases = { alpha: 'Zulu', beta: 'Árbol' };
  const visible = visibleRepositories({
    repositories: original,
    sort: 'name',
    filter: '',
    collator: new Intl.Collator('es-MX'),
    aliases,
  });
  expect(visible).toEqual([original[1], original[0]]);
  expect(filterRepositories(original, 'arbol', aliases)).toEqual([original[1]]);
  expect(filterRepositories(original, 'alpha', aliases)).toEqual([original[0]]);
  expect(original[0]?.name).toBe('alpha');
});

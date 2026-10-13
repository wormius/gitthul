import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGestureRegistry } from '@app/gestures';
import { useShellStore } from '@app/shellStore';
import { DEFAULT_LIBRARY, type Library } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';
import { I18nProvider } from '@i18n/I18nProvider';

import { useRepositoriesStore } from './repositoriesStore';
import { useRepositoryGestureDefinitions } from './repositoryGestures';

const { removeManyFromSpace } = vi.hoisted(() => ({ removeManyFromSpace: vi.fn() }));
vi.mock('./useRepositoryActions', () => ({
  useRepositoryActions: () => ({ removeManyFromSpace }),
}));

const REPOSITORIES: readonly RepoSummary[] = ['alpha', 'beta', 'gamma', 'free'].map((id) => ({
  id,
  name: id,
  path: `/repos/${id}`,
  head: 'main',
  lastOpenedAt: 1,
}));
const LIBRARY: Library = {
  ...DEFAULT_LIBRARY,
  view: { kind: 'space', id: 'b' },
  spaces: [
    { id: 'a', name: 'Uno', repos: ['alpha', 'beta'] },
    { id: 'b', name: 'Dos', repos: ['beta', 'gamma'] },
  ],
};

function definitions() {
  return renderHook(useRepositoryGestureDefinitions, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider initialLocale="es-MX">{children}</I18nProvider>
    ),
  }).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  useShellStore.getState().reset();
  useRepositoriesStore.getState().reset();
  useRepositoriesStore.getState().loaded(REPOSITORIES, LIBRARY);
});

describe('repository space removal gestures', () => {
  it('el gesto singular usa el espacio de la selección aunque la vista indique otro', () => {
    useRepositoriesStore.getState().select(REPOSITORIES[0]!, 'space:a');
    const registry = createGestureRegistry(definitions(), 'linux');
    const gesture = registry.get('repos.removeFromSpace');

    expect(gesture?.label).toContain('alpha');
    expect(gesture?.label).toContain('Uno');
    expect(gesture?.label).not.toContain('Dos');
    expect(gesture?.hiddenInSearch).toBe(false);
    expect(registry.run('repos.removeFromSpace')).toBe(true);
    expect(removeManyFromSpace).toHaveBeenCalledWith(LIBRARY.spaces[0], [REPOSITORIES[0]]);
  });

  it('el gesto múltiple cuenta y retira únicamente miembros del espacio de origen', () => {
    useRepositoriesStore.getState().selectMany(new Set(['alpha', 'beta', 'gamma']), 'space:a');
    const registry = createGestureRegistry(definitions(), 'linux');
    const gesture = registry.get('repos.removeFromSpace');

    expect(gesture?.label).toBe('Quitar 2 repositorios de Uno');
    expect(gesture?.triggers).toEqual(['menu', 'search']);
    expect(registry.run('repos.removeFromSpace')).toBe(true);
    expect(removeManyFromSpace).toHaveBeenCalledWith(LIBRARY.spaces[0], REPOSITORIES.slice(0, 2));
  });

  it('una selección múltiple con un solo miembro afectado conserva el nombre singular correcto', () => {
    useRepositoriesStore.getState().selectMany(new Set(['beta', 'gamma']), 'space:a');
    const registry = createGestureRegistry(definitions(), 'linux');
    const gesture = registry.get('repos.removeFromSpace');

    expect(gesture?.label).toContain('beta');
    expect(gesture?.label).toContain('Uno');
    expect(registry.run('repos.removeFromSpace')).toBe(true);
    expect(removeManyFromSpace).toHaveBeenCalledWith(LIBRARY.spaces[0], [REPOSITORIES[1]]);
  });

  it.each(['all', 'recent'] as const)(
    'la selección desde %s no hereda un espacio de la vista actual',
    (origin) => {
      useRepositoriesStore.getState().select(REPOSITORIES[1]!, origin);
      const registry = createGestureRegistry(definitions(), 'linux');

      expect(registry.get('repos.removeFromSpace')).toMatchObject({
        disabled: true,
        hiddenInSearch: true,
      });
      expect(registry.run('repos.removeFromSpace')).toBe(false);
      expect(removeManyFromSpace).not.toHaveBeenCalled();
      expect(registry.run('repos.removeFromAllSpaces')).toBe(true);
      expect(removeManyFromSpace).toHaveBeenCalledWith(null, [REPOSITORIES[1]]);
    },
  );

  it('el gesto de todos los espacios excluye repositorios sin membresías y cuenta IDs únicos', () => {
    useRepositoriesStore.getState().selectMany(new Set(['alpha', 'beta', 'gamma', 'free']), 'all');
    const registry = createGestureRegistry(definitions(), 'linux');
    const gesture = registry.get('repos.removeFromAllSpaces');

    expect(gesture?.label).toBe('Quitar 3 repositorios de todos los espacios');
    expect(gesture?.triggers).toEqual(['menu', 'search']);
    expect(gesture?.hiddenInSearch).toBe(false);
    expect(registry.run('repos.removeFromAllSpaces')).toBe(true);
    expect(removeManyFromSpace).toHaveBeenCalledWith(null, REPOSITORIES.slice(0, 3));
  });

  it('todos los espacios nombra el único afectado de una selección múltiple', () => {
    useRepositoriesStore.getState().selectMany(new Set(['beta', 'free']), 'all');
    const registry = createGestureRegistry(definitions(), 'linux');

    expect(registry.get('repos.removeFromAllSpaces')?.label).toBe(
      'Quitar beta de todos los espacios',
    );
    expect(registry.run('repos.removeFromAllSpaces')).toBe(true);
    expect(removeManyFromSpace).toHaveBeenCalledWith(null, [REPOSITORIES[1]]);
  });

  it('un espacio de origen eliminado no redirige el gesto a otro espacio', () => {
    useRepositoriesStore.getState().setLibrary({ ...LIBRARY, spaces: [LIBRARY.spaces[1]!] });
    useRepositoriesStore.getState().select(REPOSITORIES[1]!, 'space:a');
    const registry = createGestureRegistry(definitions(), 'linux');

    expect(registry.get('repos.removeFromSpace')).toMatchObject({
      disabled: true,
      hiddenInSearch: true,
    });
    expect(registry.run('repos.removeFromSpace')).toBe(false);
    expect(removeManyFromSpace).not.toHaveBeenCalled();
  });

  it.each(['empty', 'withoutMembership', 'busy', 'settings', 'away'] as const)(
    '%s deshabilita la retirada y la oculta en búsqueda cuando no corresponde',
    (scenario) => {
      if (scenario !== 'empty') {
        useRepositoriesStore
          .getState()
          .select(
            scenario === 'withoutMembership' ? REPOSITORIES[3]! : REPOSITORIES[0]!,
            'space:a',
          );
      }
      if (scenario === 'busy') useRepositoriesStore.getState().setBatchBusy(true);
      if (scenario === 'settings') useShellStore.getState().openSettings();
      if (scenario === 'away') {
        useShellStore.getState().openWorking({
          repoId: 'alpha',
          repoName: 'alpha',
          repoPath: '/repos/alpha',
          branch: 'main',
        });
      }
      const registry = createGestureRegistry(definitions(), 'linux');

      for (const id of ['repos.removeFromSpace', 'repos.removeFromAllSpaces']) {
        expect(registry.get(id)).toMatchObject({ disabled: true, hiddenInSearch: true });
        expect(registry.run(id)).toBe(false);
      }
      expect(removeManyFromSpace).not.toHaveBeenCalled();
    },
  );
});

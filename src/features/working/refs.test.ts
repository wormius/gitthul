import { describe, expect, it } from 'vitest';

import type { Branch, RefsSnapshot, Remote } from '@core/domain/refs';

import { collapseRefLabels, refLabelsAt, remoteBranchLeafName, remoteGroups } from './refs';

function branch(partial: Partial<Branch> & Pick<Branch, 'id' | 'name'>): Branch {
  return {
    kind: 'remote',
    tip: 'a1b2c3',
    ahead: 0,
    behind: 0,
    isHead: false,
    ...partial,
  };
}

const origin: Remote = {
  name: 'origin',
  fetchUrl: 'https://ejemplo.org/origin.git',
  pushUrl: 'https://ejemplo.org/origin.git',
};

const upstream: Remote = {
  name: 'upstream',
  fetchUrl: 'https://ejemplo.org/upstream.git',
  pushUrl: 'https://ejemplo.org/upstream.git',
};

describe('remoteGroups', () => {
  it('agrupa las ramas remotas por su remoto, en el orden de `remotes`', () => {
    const snapshot: RefsSnapshot = {
      head: { branch: 'main', sha: 'a1b2c3', detached: false },
      branches: [
        branch({ id: 'refs/heads/main', name: 'main', kind: 'local' }),
        branch({ id: 'refs/remotes/origin/main', name: 'origin/main', remote: 'origin' }),
        branch({ id: 'refs/remotes/origin/dev', name: 'origin/dev', remote: 'origin' }),
        branch({ id: 'refs/remotes/upstream/main', name: 'upstream/main', remote: 'upstream' }),
      ],
      tags: [],
      stashes: [],
      worktrees: [],
      remotes: [origin, upstream],
    };

    const groups = remoteGroups(snapshot);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.remote.name).toBe('origin');
    expect(groups[0]?.branches.map((b) => b.name)).toEqual(['origin/main', 'origin/dev']);
    expect(groups[1]?.remote.name).toBe('upstream');
    expect(groups[1]?.branches.map((b) => b.name)).toEqual(['upstream/main']);
  });

  it('un remoto sin ramas es un árbol vacío, no desaparece', () => {
    const snapshot: RefsSnapshot = {
      head: { branch: 'main', sha: 'a1b2c3', detached: false },
      branches: [],
      tags: [],
      stashes: [],
      worktrees: [],
      remotes: [origin],
    };

    expect(remoteGroups(snapshot)).toEqual([{ remote: origin, branches: [] }]);
  });
});

describe('remoteBranchLeafName', () => {
  it('quita el prefijo del remoto', () => {
    const dev = branch({ id: 'refs/remotes/origin/dev', name: 'origin/dev', remote: 'origin' });

    expect(remoteBranchLeafName(dev, origin)).toBe('dev');
  });

  it('deja el nombre igual si por lo que sea no lleva el prefijo', () => {
    const weird = branch({ id: 'refs/remotes/origin/x', name: 'dev', remote: 'origin' });

    expect(remoteBranchLeafName(weird, origin)).toBe('dev');
  });
});

describe('refLabelsAt', () => {
  const snapshot: RefsSnapshot = {
    head: { branch: 'main', sha: 'aaa', detached: false },
    branches: [
      branch({
        id: 'refs/heads/main',
        name: 'main',
        kind: 'local',
        tip: 'aaa',
        isHead: true,
        upstream: 'origin/main',
      }),
      branch({ id: 'refs/remotes/origin/main', name: 'origin/main', remote: 'origin', tip: 'aaa' }),
      branch({
        id: 'refs/heads/dev',
        name: 'dev',
        kind: 'local',
        tip: 'aaa',
        checkedOutIn: '/tmp/wt',
      }),
      branch({ id: 'refs/remotes/origin/otra', name: 'origin/otra', remote: 'origin', tip: 'aaa' }),
    ],
    tags: [{ id: 'refs/tags/v1', name: 'v1', target: 'aaa', annotated: false }],
    stashes: [],
    worktrees: [],
    remotes: [origin],
  };

  it('funde la local con su remota cuando el seguimiento coincide en el mismo commit', () => {
    const labels = refLabelsAt(snapshot, 'aaa');
    const main = labels.find((item) => item.name === 'main');

    expect(main?.refName).toBe('main');
    expect(main?.isHead).toBe(true);
    expect(main?.local?.name).toBe('main');
    expect(main?.remote?.name).toBe('origin/main');
  });

  it('la remota sola enseña el nombre corto pero opera con su nombre completo', () => {
    const labels = refLabelsAt(snapshot, 'aaa');
    const otra = labels.find((item) => item.name === 'otra');

    expect(otra?.refName).toBe('origin/otra');
    expect(otra?.local).toBeUndefined();
    expect(otra?.remote?.name).toBe('origin/otra');
  });

  it('no funde una local con su remota si apuntan a commits distintos', () => {
    const separated: RefsSnapshot = {
      ...snapshot,
      branches: [
        branch({
          id: 'refs/heads/release',
          name: 'release',
          kind: 'local',
          tip: 'aaa',
          upstream: 'origin/release',
        }),
        branch({
          id: 'refs/remotes/origin/release',
          name: 'origin/release',
          remote: 'origin',
          tip: 'bbb',
        }),
      ],
      tags: [],
    };

    const local = refLabelsAt(separated, 'aaa')[0];
    const remote = refLabelsAt(separated, 'bbb')[0];

    expect(local).toMatchObject({ name: 'release', refName: 'release' });
    expect(local?.remote).toBeUndefined();
    expect(remote).toMatchObject({ name: 'release', refName: 'origin/release' });
    expect(remote?.local).toBeUndefined();
  });

  it('ordena la activa, locales, remotas y tags contando ramas lógicas', () => {
    const labels = refLabelsAt(snapshot, 'aaa');

    expect(labels.map((item) => item.name)).toEqual(['main', 'dev', 'otra', 'v1']);
    expect(labels).toHaveLength(4);
    expect(labels[3]?.kind).toBe('tag');
  });

  it('un commit sin referencias no tiene etiquetas', () => {
    expect(refLabelsAt(snapshot, 'zzz')).toEqual([]);
  });
});

describe('collapseRefLabels', () => {
  const labels = refLabelsAt(
    {
      head: { branch: 'main', sha: 'aaa', detached: false },
      branches: [
        branch({ id: 'refs/heads/main', name: 'main', kind: 'local', tip: 'aaa', isHead: true }),
        branch({ id: 'refs/heads/dev', name: 'dev', kind: 'local', tip: 'aaa' }),
        branch({ id: 'refs/heads/otra', name: 'otra', kind: 'local', tip: 'aaa' }),
      ],
      tags: [],
      stashes: [],
      worktrees: [],
      remotes: [],
    },
    'aaa',
  );

  it('deja a la vista las primeras y esconde el resto detrás del `+N`', () => {
    const { shown, hidden } = collapseRefLabels(labels, 1);

    expect(shown.map((item) => item.name)).toEqual(['main']);
    expect(hidden).toHaveLength(2);
  });

  it('sin exceso no esconde nada', () => {
    expect(collapseRefLabels(labels, 5).hidden).toEqual([]);
  });
});

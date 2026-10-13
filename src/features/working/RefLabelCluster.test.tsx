import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Branch, RefsSnapshot, Tag } from '@core/domain/refs';
import { I18nProvider } from '@i18n/I18nProvider';
import { DragLayer } from '@ui/DragLayer';

import { expectNoHoverShift } from '../../test/noShift';
import type { DragRef } from './integration';
import { RefLabel } from './RefLabel';
import { RefLabelCluster } from './RefLabelCluster';
import { refLabelsAt } from './refs';

function local(name: string, isHead = false, upstream?: string): Branch {
  return {
    id: `refs/heads/${name}`,
    name,
    kind: 'local',
    tip: 'aaa',
    ahead: 0,
    behind: 0,
    isHead,
    ...(upstream === undefined ? {} : { upstream }),
  };
}

function remote(name: string): Branch {
  return {
    id: `refs/remotes/origin/${name}`,
    name: `origin/${name}`,
    kind: 'remote',
    remote: 'origin',
    tip: 'aaa',
    ahead: 0,
    behind: 0,
    isHead: false,
  };
}

const tag: Tag = { id: 'refs/tags/v1', name: 'v1', target: 'aaa', annotated: false };

const snapshot: RefsSnapshot = {
  head: { branch: 'main', sha: 'aaa', detached: false },
  branches: [
    local('main', true, 'origin/main'),
    remote('main'),
    local('dev', false, 'origin/dev'),
    remote('dev'),
    local('otra'),
    remote('release'),
  ],
  tags: [tag],
  stashes: [],
  worktrees: [],
  remotes: [],
};

const labels = refLabelsAt(snapshot, 'aaa');

function labelNamed(name: string) {
  const item = labels.find((candidate) => candidate.name === name);

  if (!item) throw new Error(`No existe la etiqueta ${name}`);

  return item;
}

function renderCluster(
  onReferenceDrop?: (source: DragRef, target: DragRef) => void,
  onReferenceActivate?: (item: (typeof labels)[number]) => void,
) {
  return render(
    <I18nProvider initialLocale="es-MX">
      <DragLayer>
        <RefLabelCluster
          items={labels}
          wrap={(_item, label) => label}
          {...(onReferenceDrop === undefined ? {} : { onReferenceDrop })}
          {...(onReferenceActivate === undefined ? {} : { onReferenceActivate })}
        />
      </DragLayer>
    </I18nProvider>,
  );
}

describe('RefLabel', () => {
  it('nombra los chips como activa, local+remota, remota o tag según sus iconos', () => {
    render(
      <I18nProvider initialLocale="es-MX">
        <RefLabel item={labelNamed('main')} />
        <RefLabel item={labelNamed('dev')} />
        <RefLabel item={labelNamed('release')} />
        <RefLabel item={labelNamed('v1')} />
      </I18nProvider>,
    );

    expect(screen.getByTitle('Rama activa main')).toBeInTheDocument();
    expect(
      screen.getByTitle('Rama dev, la local y la remota en el mismo commit'),
    ).toBeInTheDocument();
    expect(screen.getByTitle('Rama remota release')).toBeInTheDocument();
    expect(screen.getByTitle('Tag v1')).toBeInTheDocument();
    expect(screen.queryByText('origin/release')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(
      <I18nProvider initialLocale="es-MX">
        <RefLabel item={labelNamed('main')} />
      </I18nProvider>,
    );

    expectNoHoverShift(screen.getByTitle('Rama activa main'));
  });
});

describe('RefLabelCluster', () => {
  it('cuenta ramas lógicas: una local y su remota coincidentes ocupan un chip', () => {
    renderCluster();

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.queryByText('dev')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ver las otras 4 referencias de este commit' }),
    ).toBeInTheDocument();
  });

  it('el hover en `+N` despliega las escondidas en una capa aparte', async () => {
    const user = userEvent.setup();

    renderCluster();

    await user.hover(
      screen.getByRole('button', { name: 'Ver las otras 4 referencias de este commit' }),
    );

    const group = await screen.findByRole('group', { name: 'Otras referencias de este commit' });

    expect(within(group).getByText('dev')).toBeInTheDocument();
    expect(within(group).getByText('otra')).toBeInTheDocument();
    expect(within(group).getByText('release')).toBeInTheDocument();
    expect(within(group).getByText('v1')).toBeInTheDocument();
  });

  it('el hover en el chip visible abre el mismo despliegue', async () => {
    const user = userEvent.setup();

    renderCluster();

    await user.hover(screen.getByTitle('Rama activa main'));

    expect(
      await screen.findByRole('group', { name: 'Otras referencias de este commit' }),
    ).toBeInTheDocument();
  });

  it('activa con doble clic una rama visible y una rama desplegada', () => {
    const onReferenceActivate = vi.fn();

    renderCluster(undefined, onReferenceActivate);

    fireEvent.doubleClick(screen.getByTitle('Rama activa main'));
    fireEvent.mouseEnter(
      screen.getByRole('button', { name: 'Ver las otras 4 referencias de este commit' }),
    );
    fireEvent.doubleClick(screen.getByTitle('Rama dev, la local y la remota en el mismo commit'));

    expect(onReferenceActivate).toHaveBeenNthCalledWith(1, labelNamed('main'));
    expect(onReferenceActivate).toHaveBeenNthCalledWith(2, labelNamed('dev'));
  });

  it('una etiqueta desplegada puede arrastrarse hasta la visible', () => {
    const onReferenceDrop = vi.fn();

    renderCluster(onReferenceDrop);

    fireEvent.mouseEnter(
      screen.getByRole('button', { name: 'Ver las otras 4 referencias de este commit' }),
    );

    fireEvent.dragStart(screen.getByTitle('Rama dev, la local y la remota en el mismo commit'));
    fireEvent.dragOver(screen.getByTitle('Rama activa main'));
    fireEvent.drop(screen.getByTitle('Rama activa main'));

    expect(onReferenceDrop).toHaveBeenCalledWith(
      { kind: 'branch', name: 'dev', ref: 'refs/heads/dev' },
      { kind: 'branch', name: 'main', ref: 'refs/heads/main' },
    );
  });

  it('entrar arrastrando en `+N` abre las ocultas y conserva la identidad remota', () => {
    const onReferenceDrop = vi.fn();

    renderCluster(onReferenceDrop);

    const source = screen.getByTitle('Rama activa main');
    const badge = screen.getByRole('button', {
      name: 'Ver las otras 4 referencias de este commit',
    });

    fireEvent.dragStart(source);
    fireEvent.dragEnter(badge);
    fireEvent.dragOver(badge);

    const target = screen.getByTitle('Rama remota release');

    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(onReferenceDrop).toHaveBeenCalledWith(
      { kind: 'branch', name: 'main', ref: 'refs/heads/main' },
      { kind: 'branch', name: 'origin/release', ref: 'refs/remotes/origin/release' },
    );
  });

  it('el despliegue sale fuera de la fila, así que el hover no la mueve', () => {
    renderCluster();

    const badge = screen.getByRole('button', {
      name: 'Ver las otras 4 referencias de este commit',
    });

    expectNoHoverShift(badge);

    // La capa vive en un portal sobre `body`, no dentro del `+N`: es lo que
    // impide que crecer la despliegue empujando la columna del mensaje.
    fireEvent.mouseEnter(badge);

    expect(badge.contains(screen.getByRole('group'))).toBe(false);
  });
});

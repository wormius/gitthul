import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RepoSummary } from '@core/domain/repository';
import { I18nProvider } from '@i18n/I18nProvider';

import { expectNoHoverShift } from '../../test/noShift';
import { RepoCard } from './RepoCard';

const REPOSITORY: RepoSummary = {
  id: 'gitthul',
  name: 'gitthul',
  path: '/repos/gitthul',
  head: 'main',
  lastOpenedAt: 1,
};

function renderCard(selected: boolean) {
  const onOpen = vi.fn();
  const onSelect = vi.fn();

  render(
    <I18nProvider initialLocale="es-MX">
      <RepoCard
        repo={REPOSITORY}
        avatar={null}
        selected={selected}
        menu={[]}
        onOpen={onOpen}
        onSelect={onSelect}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    </I18nProvider>,
  );

  return { card: screen.getByRole('option'), onOpen, onSelect };
}

describe('RepoCard', () => {
  it('el hover no desplaza la tarjeta', () => {
    expectNoHoverShift(renderCard(false).card);
  });

  it('Enter abre una tarjeta seleccionada', () => {
    const { card, onOpen, onSelect } = renderCard(true);

    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter selecciona antes de abrir cuando la tarjeta aún no está seleccionada', () => {
    const { card, onOpen, onSelect } = renderCard(false);

    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

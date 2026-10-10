import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RepoAvatar } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';
import { DEFAULT_USER_COLOR } from '@design/userColor';
import { I18nProvider } from '@i18n/I18nProvider';

import { RepoAvatarDialog } from './RepoAvatarDialog';

const CUSTOM_COLOR = DEFAULT_USER_COLOR.replaceAll('8', '7');

const repo: RepoSummary = {
  id: 'test-repo',
  name: 'Jardín',
  path: '/tmp/avatar-test-repo',
  head: 'main',
  lastOpenedAt: null,
};

function renderDialog(current: RepoAvatar | null = { glyph: 'dog', tone: 3 }) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider initialLocale="es-MX">
      <RepoAvatarDialog repo={repo} current={current} onConfirm={onConfirm} onCancel={onCancel} />
    </I18nProvider>,
  );
  return { onConfirm, onCancel };
}

describe('RepoAvatarDialog', () => {
  it('saves a new catalog drawing and its color after browsing other categories', async () => {
    const handlers = renderDialog();
    const user = userEvent.setup();
    expect(screen.getByRole('tab', { name: 'Animales' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Color 12' }));
    fireEvent.change(screen.getByLabelText('Color personalizado'), {
      target: { value: CUSTOM_COLOR },
    });
    await user.click(screen.getByRole('tab', { name: 'Plantas' }));
    await user.click(screen.getByRole('button', { name: 'Cactus' }));
    await user.click(screen.getByRole('tab', { name: 'Festividades' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(handlers.onConfirm).toHaveBeenCalledExactlyOnceWith({
      glyph: 'cactus',
      tone: 12,
      color: CUSTOM_COLOR,
    });
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('discards draft changes on cancellation', async () => {
    const handlers = renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Plantas' }));
    await user.click(screen.getByRole('button', { name: 'Cactus' }));
    await user.click(screen.getByRole('button', { name: 'Color 6' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it('saves null when returning an existing custom avatar to initials from another category', async () => {
    const handlers = renderDialog({ glyph: 'ghost', tone: 9, color: DEFAULT_USER_COLOR });
    const user = userEvent.setup();
    expect(screen.getByRole('tab', { name: 'Festividades' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: 'Abstractos' }));
    await user.click(screen.getByRole('button', { name: 'Iniciales' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(handlers.onConfirm).toHaveBeenCalledExactlyOnceWith(null);
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@i18n/I18nProvider';

import { PublishBranchDialog } from './PublishBranchDialog';

function renderDialog(remotes: readonly string[] = ['origin', 'backup']) {
  const onConfirm = vi.fn();
  render(
    <I18nProvider initialLocale="es-MX">
      <PublishBranchDialog
        branch="feature/login"
        remotes={remotes}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    </I18nProvider>,
  );
  return onConfirm;
}

describe('PublishBranchDialog', () => {
  it('nombra la rama y publica solo en el remoto elegido', async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    expect(screen.getByRole('dialog')).toHaveAccessibleName(/feature\/login/);
    await user.selectOptions(screen.getByLabelText('Remoto'), 'backup');
    await user.click(screen.getByRole('button', { name: 'Publicar feature/login' }));

    expect(onConfirm).toHaveBeenCalledWith('backup');
  });

  it('explica la ausencia de remotos y no permite confirmar', () => {
    renderDialog([]);

    expect(screen.getByText(/no tiene remotos configurados/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar feature/login' })).toBeDisabled();
  });
});

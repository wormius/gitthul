import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@i18n/I18nProvider';

import { RemoteDialog } from './RemoteDialog';

function renderDialog(props: Partial<Parameters<typeof RemoteDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <I18nProvider initialLocale="es-MX">
      <RemoteDialog taken={[]} onConfirm={onConfirm} onCancel={() => undefined} {...props} />
    </I18nProvider>,
  );
  return onConfirm;
}

describe('RemoteDialog', () => {
  it('reutiliza fetch para push hasta que la persona lo edita', async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), 'origin');
    await user.type(screen.getByLabelText('Dirección para fetch'), 'https://example.test/repo.git');
    expect(screen.getByLabelText('Dirección para push')).toHaveValue(
      'https://example.test/repo.git',
    );
    await user.click(screen.getByRole('button', { name: 'Agregar remoto' }));

    expect(onConfirm).toHaveBeenCalledWith(
      {
        name: 'origin',
        fetchUrl: 'https://example.test/repo.git',
        pushUrl: 'https://example.test/repo.git',
      },
      undefined,
    );
  });

  it('conserva el remoto observado al editar y rechaza nombres repetidos', async () => {
    const user = userEvent.setup();
    const remote = {
      name: 'origin',
      fetchUrl: 'https://example.test/read.git',
      pushUrl: 'ssh://example.test/write.git',
    };
    renderDialog({ remote, taken: ['origin', 'backup'] });

    const name = screen.getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'backup');

    expect(screen.getByText('Ya existe un remoto llamado backup')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Guardar remoto' })).toBeDisabled();
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '@i18n/I18nProvider';
import { ResetDialog } from './ResetDialog';

it('muestra el modo suave, confirmar antes de cancelar y bloquea el diálogo mientras trabaja', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const show = (busy: boolean) => (
    <I18nProvider initialLocale="es-MX">
      <ResetDialog
        branch="main"
        sha="123456789"
        initialMode="soft"
        dirtyFiles={3}
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </I18nProvider>
  );
  const { rerender } = render(show(false));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('radio', { name: '--soft' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const buttons = within(dialog).getAllByRole('button');
  expect(buttons.slice(-2).map((button) => button.textContent)).toEqual([
    'Hacer reset',
    'Cancelar',
  ]);
  const modes = within(dialog).getByRole('radiogroup', { name: 'Modo de reset' });
  const description = within(dialog).getByText(/El staging y el árbol de trabajo/);
  expect(
    modes.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await user.click(within(dialog).getByRole('radio', { name: '--mixed' }));
  await user.click(within(dialog).getByRole('button', { name: 'Hacer reset' }));
  expect(onConfirm).toHaveBeenCalledWith('123456789', 'mixed');
  rerender(show(true));
  expect(within(dialog).getByRole('status', { name: 'Procesando operación…' })).toBeVisible();
  expect(within(dialog).getByRole('radio', { name: '--hard' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(onCancel).not.toHaveBeenCalled();
});

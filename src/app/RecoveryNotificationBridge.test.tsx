import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { selectPorts } from '@core/adapters/selectPorts';
import { createMockRecoveryPort } from '@core/adapters/mock/mockRecoveryPort';
import { I18nProvider } from '@i18n/I18nProvider';
import { ToastProvider } from '@ui/ToastProvider';
import { PortsContext } from './PortsContext';
import { RecoveryNotificationBridge } from './RecoveryNotificationBridge';
import { useShellStore } from './shellStore';

beforeEach(() => {
  useShellStore.getState().reset();
});

it('al reiniciar informa de puntos pendientes o importados y permite revisarlos sin restaurar', async () => {
  const user = userEvent.setup();
  const ports = selectPorts();
  ports.recovery = createMockRecoveryPort({
    directory: '/mock/recovery',
    totalBytes: 0,
    checkpoints: [
      {
        id: 'old',
        repository: '/repos/example',
        createdAt: 1728000000000,
        label: '',
        status: 'legacy',
        fileCount: 0,
        bytes: 0,
        active: false,
      },
    ],
  });
  const restore = vi.spyOn(ports.recovery, 'restore');
  render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar aviso">
          <RecoveryNotificationBridge />
        </ToastProvider>
      </I18nProvider>
    </PortsContext>,
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Puntos por revisar: 1.');
  await user.click(screen.getByRole('button', { name: 'Revisar recuperación' }));
  expect(useShellStore.getState().settingsOpen).toBe(true);
  expect(useShellStore.getState().settingsSection).toBe('recovery');
  expect(restore).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

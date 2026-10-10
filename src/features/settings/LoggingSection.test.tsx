import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { selectPorts } from '@core/adapters/selectPorts';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { I18nProvider } from '@i18n/I18nProvider';
import { LoggingSection } from './LoggingSection';
import { initSettingsData } from './useSettingsData';

function setup() {
  const ports = selectPorts();
  render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <LoggingSection />
      </I18nProvider>
    </PortsContext>,
  );
  return ports;
}

describe('LoggingSection', () => {
  beforeEach(() => {
    localStorage.clear();
    initSettingsData(DEFAULT_SETTINGS);
    useShellStore.getState().reset();
  });
  it('guarda el modo, cambia la captura y abre el visor', async () => {
    const user = userEvent.setup();
    const ports = setup();
    const toggle = screen.getByRole('switch', { name: 'Registrar datos de debug' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect((await ports.settings.read()).logging.debugEnabled).toBe(true);
    ports.log.write('debug', 'test', 'captured');
    expect((await ports.log.read()).some((entry) => entry.message === 'captured')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Ver registros' }));
    expect(useShellStore.getState().overlay).toBe('logs');
  });

  it('si el disco falla restaura el switch y muestra el fallo', async () => {
    const user = userEvent.setup();
    const ports = setup();
    vi.spyOn(ports.settings, 'patch').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('switch', { name: 'Registrar datos de debug' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('switch')).not.toBeChecked();
    ports.log.write('debug', 'test', 'hidden');
    expect((await ports.log.read()).some((entry) => entry.message === 'hidden')).toBe(false);
  });
});

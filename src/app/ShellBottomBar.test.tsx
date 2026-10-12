import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectPorts } from '@core/adapters/selectPorts';
import { DEFAULT_SETTINGS, LOCALES, type Locale } from '@core/domain/settings';
import type { ReleaseCheck } from '@core/ports/LinkPort';
import { ThemeProvider } from '@design/ThemeProvider';
import { useReleaseStore } from '@features/settings/releaseStore';
import { SettingsView } from '@features/settings/SettingsView';
import { initSettingsData } from '@features/settings/useSettingsData';
import { I18nProvider } from '@i18n/I18nProvider';
import { MESSAGES } from '@i18n/messages';
import { ToastProvider } from '@ui/ToastProvider';

import { GestureContext } from './GestureContext';
import { createGestureRegistry } from './gestures';
import { APP_VERSION } from './metadata';
import { PortsContext } from './PortsContext';
import { ReleaseNotificationBridge } from './ReleaseNotificationBridge';
import { ShellBottomBar } from './ShellBottomBar';
import { useShellGestureDefinitions } from './shellGestures';
import { useShellStore } from './shellStore';

const available: ReleaseCheck = {
  status: 'available',
  version: '1.1.0',
  url: 'https://github.com/wormius/gitthul/releases/tag/v1.1.0',
};

function UpdatesHarness() {
  const definitions = useShellGestureDefinitions();
  const settingsOpen = useShellStore((state) => state.settingsOpen);

  return (
    <GestureContext value={createGestureRegistry(definitions, 'linux')}>
      <ReleaseNotificationBridge />
      {settingsOpen && <SettingsView />}
      <ShellBottomBar />
    </GestureContext>
  );
}

function mount(locale: Locale = 'es-MX') {
  const ports = selectPorts();
  const link = {
    checkRelease: vi.fn(() => Promise.resolve(available)),
    openExternal: vi.fn(() => Promise.resolve()),
  };

  render(
    <PortsContext value={{ ...ports, link }}>
      <ThemeProvider>
        <I18nProvider initialLocale={locale}>
          <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar aviso">
            <UpdatesHarness />
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );

  return link;
}

beforeEach(() => {
  initSettingsData(DEFAULT_SETTINGS);
  useShellStore.getState().reset();
  useReleaseStore.setState({ check: { status: 'idle' }, availableRelease: null });
});

describe('actualizaciones en la barra inferior', () => {
  it.each(LOCALES)('la versión abre Actualizaciones con clic y teclado en %s', async (locale) => {
    const user = userEvent.setup();
    const link = mount(locale);
    const messages = MESSAGES[locale];
    const name = `GitThul ${APP_VERSION}. ${messages['bottomBar.openUpdates']}`;

    await user.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('tab', { name: messages['settings.section.updates'] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(link.checkRelease).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: messages['settings.section.language'] }));
    act(() => screen.getByRole('button', { name }).focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: messages['settings.section.updates'] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(link.checkRelease).not.toHaveBeenCalled();
    expect(link.openExternal).not.toHaveBeenCalled();
  });

  it('conserva el indicador tras cerrar el aviso y volver de Configuraciones', async () => {
    const user = userEvent.setup();
    const link = mount();
    await user.click(
      screen.getByRole('button', { name: `GitThul ${APP_VERSION}. Abrir Actualizaciones` }),
    );
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));

    const name = `GitThul ${APP_VERSION}. Abrir Actualizaciones. Actualización disponible: 1.1.0`;
    const version = await screen.findByRole('button', { name });
    expect(version.querySelector('svg')).toBeInTheDocument();
    expect(link.checkRelease).toHaveBeenCalledTimes(1);
    await user.click(
      within(screen.getByRole('region', { name: 'Avisos' })).getByRole('button', {
        name: 'Cerrar aviso',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Regresar' }));
    expect(screen.getByRole('button', { name })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('tab', { name: 'Actualizaciones' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(link.checkRelease).toHaveBeenCalledTimes(1);
    expect(link.openExternal).not.toHaveBeenCalled();
  });

  it('muestra también la versión detectada por la consulta opcional al iniciar', async () => {
    initSettingsData({ ...DEFAULT_SETTINGS, updates: { checkOnStartup: true } });
    const link = mount();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /GitThul.*Actualización disponible: 1\.1\.0/ }),
      ).toBeInTheDocument(),
    );
    expect(link.checkRelease).toHaveBeenCalledTimes(1);
    expect(link.openExternal).not.toHaveBeenCalled();
  });
});

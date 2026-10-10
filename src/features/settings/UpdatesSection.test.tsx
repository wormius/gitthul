import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type Locale } from '@core/domain/settings';
import type { ReleaseCheck } from '@core/ports/LinkPort';
import { selectPorts } from '@core/adapters/selectPorts';
import { APP_VERSION } from '@app/metadata';
import { PortsContext } from '@app/PortsContext';
import { ReleaseNotificationBridge } from '@app/ReleaseNotificationBridge';
import { I18nProvider } from '@i18n/I18nProvider';
import { MESSAGES } from '@i18n/messages';
import { ToastProvider } from '@ui/ToastProvider';
import { UpdatesSection } from './UpdatesSection';
import { initSettingsData } from './useSettingsData';
import { useReleaseStore } from './releaseStore';

function mount(locale: Locale = 'es-MX') {
  const checkRelease = vi.fn(() =>
    Promise.resolve<ReleaseCheck>({
      status: 'available',
      version: '0.2.0',
      url: 'https://example.invalid/releases/v0.2.0',
    }),
  );
  const openExternal = vi.fn(() => Promise.resolve());
  const link = { checkRelease, openExternal };
  render(
    <StrictMode>
      <PortsContext value={{ ...selectPorts(), link }}>
        <I18nProvider initialLocale={locale}>
          <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar">
            <ReleaseNotificationBridge />
            <UpdatesSection />
          </ToastProvider>
        </I18nProvider>
      </PortsContext>
    </StrictMode>,
  );
  return link;
}

beforeEach(() => {
  initSettingsData(DEFAULT_SETTINGS);
  useReleaseStore.setState({ check: { status: 'notConfigured', channel: 'stable' } });
});

const unavailableMessages: readonly [Locale, string][] = [
  [
    'es-MX',
    'La consulta de actualizaciones no está disponible hasta configurar el repositorio público de GitThul.',
  ],
  [
    'es-ES',
    'La consulta de actualizaciones no está disponible hasta configurar el repositorio público de GitThul.',
  ],
  ['en', 'Update checks are unavailable until the public GitThul repository is configured.'],
  [
    'de',
    'Die Aktualisierungssuche ist erst verfügbar, wenn das öffentliche GitThul-Repository eingerichtet ist.',
  ],
  [
    'fr',
    'La recherche de mises à jour sera disponible une fois le dépôt public de GitThul configuré.',
  ],
];

describe('unconfigured release checks', () => {
  it.each(unavailableMessages)(
    'explains disabled controls in %s without using a persisted startup preference',
    async (locale, message) => {
      initSettingsData({ ...DEFAULT_SETTINGS, updates: { channel: 'beta', checkOnStartup: true } });
      const user = userEvent.setup();
      const link = mount(locale);
      const messages = MESSAGES[locale];

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
      const search = screen.getByRole('button', { name: messages['settings.updates.checkNow'] });
      expect(search).toBeDisabled();
      const startup = screen.getByRole('switch');
      expect(startup).toBeDisabled();
      expect(startup).toBeChecked();
      for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
      expect(
        screen.getByRole('radio', { name: messages['settings.updates.channel.beta'] }),
      ).toBeChecked();

      await user.click(search);
      await user.click(startup);
      expect(link.checkRelease).not.toHaveBeenCalled();
      expect(link.openExternal).not.toHaveBeenCalled();
      expect(screen.queryByText(messages['settings.updates.current'])).not.toBeInTheDocument();
      expect(screen.queryByText(messages['settings.updates.empty'])).not.toBeInTheDocument();
      expect(screen.queryByText(messages['settings.updates.failed'])).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: messages['settings.updates.download'] }),
      ).not.toBeInTheDocument();
    },
  );

  it('blocks direct store requests without invoking an injected checker', async () => {
    const link = mount();
    await act(() => useReleaseStore.getState().checkNow(link, 'beta'));
    expect(useReleaseStore.getState().check).toEqual({ status: 'notConfigured', channel: 'beta' });
    expect(link.checkRelease).not.toHaveBeenCalled();
    expect(link.openExternal).not.toHaveBeenCalled();
  });

  it('suppresses stale available results and their download notification', () => {
    useReleaseStore.setState({
      check: {
        status: 'available',
        channel: 'stable',
        version: '0.2.0',
        url: 'https://example.invalid/releases/v0.2.0',
      },
    });
    const link = mount();
    expect(screen.queryByText('Hay una nueva versión de GitThul: 0.2.0.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir descargas' })).not.toBeInTheDocument();
    expect(link.checkRelease).not.toHaveBeenCalled();
    expect(link.openExternal).not.toHaveBeenCalled();
  });
});

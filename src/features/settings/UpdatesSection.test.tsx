import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  LOCALES,
  type Locale,
} from '@core/domain/settings';
import type { ReleaseCheck } from '@core/ports/LinkPort';
import { selectPorts } from '@core/adapters/selectPorts';
import { APP_VERSION } from '@app/metadata';
import { PortsContext } from '@app/PortsContext';
import { ReleaseNotificationBridge } from '@app/ReleaseNotificationBridge';
import { I18nProvider } from '@i18n/I18nProvider';
import { MESSAGES } from '@i18n/messages';
import { ToastProvider } from '@ui/ToastProvider';
import { UpdatesSection } from './UpdatesSection';
import { getSettingsSnapshot, initSettingsData } from './useSettingsData';
import { useReleaseStore } from './releaseStore';

const available: ReleaseCheck = {
  status: 'available',
  version: '1.1.0',
  url: 'https://github.com/wormius/gitthul/releases/tag/v1.1.0',
};

function mount(
  locale: Locale = 'es-MX',
  checkRelease = vi.fn(() => Promise.resolve<ReleaseCheck>(available)),
) {
  const openExternal = vi.fn(() => Promise.resolve());
  const ports = selectPorts();
  const patch = vi.spyOn(ports.settings, 'patch');
  const flush = vi.spyOn(ports.settings, 'flush');
  const link = { checkRelease, openExternal };
  render(
    <StrictMode>
      <PortsContext value={{ ...ports, link }}>
        <I18nProvider initialLocale={locale}>
          <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar">
            <ReleaseNotificationBridge />
            <UpdatesSection />
          </ToastProvider>
        </I18nProvider>
      </PortsContext>
    </StrictMode>,
  );
  return { ...link, patch, flush, readSettings: ports.settings.read };
}

beforeEach(() => {
  localStorage.clear();
  initSettingsData(DEFAULT_SETTINGS);
  useReleaseStore.setState({ check: { status: 'idle' }, availableRelease: null });
});

describe('stable release checks', () => {
  it.each(LOCALES)(
    'permite buscar manualmente en %s sin canal beta ni consulta por defecto',
    async (locale) => {
      const user = userEvent.setup();
      const link = mount(locale);
      const messages = MESSAGES[locale];
      expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
      expect(screen.getByText(messages['settings.updates.description'])).toBeInTheDocument();
      expect(screen.getByRole('switch')).toBeEnabled();
      expect(screen.getByRole('switch')).not.toBeChecked();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(link.checkRelease).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: messages['settings.updates.checkNow'] }));
      const text = messages['settings.updates.available'].replace('{version}', '1.1.0');
      expect(await screen.findAllByText(text)).toHaveLength(2);
      expect(link.checkRelease).toHaveBeenCalledExactlyOnceWith();
      expect(link.openExternal).not.toHaveBeenCalled();
      expect(
        screen.getAllByRole('button', { name: messages['settings.updates.download'] }),
      ).toHaveLength(2);
    },
  );

  it('consulta una sola vez al arrancar con una preferencia explícita, incluso con StrictMode', async () => {
    initSettingsData({
      ...DEFAULT_SETTINGS,
      updates: { ...DEFAULT_UPDATE_SETTINGS, checkOnStartup: true },
    });
    const link = mount();
    await waitFor(() =>
      expect(screen.getAllByText('Hay una nueva versión de GitThul: 1.1.0.')).toHaveLength(2),
    );
    expect(link.checkRelease).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch')).toBeChecked();
    expect(link.openExternal).not.toHaveBeenCalled();
  });

  it('persiste la consulta opcional y restablece su valor predeterminado', async () => {
    const user = userEvent.setup();
    const link = mount(
      'es-MX',
      vi.fn(() => Promise.resolve<ReleaseCheck>({ status: 'current' })),
    );
    await user.click(screen.getByRole('switch'));
    expect(await screen.findByText('No hay una versión estable más reciente.')).toBeInTheDocument();
    expect(link.patch).toHaveBeenCalledWith({ updates: { checkOnStartup: true } });
    expect(link.flush).toHaveBeenCalledOnce();
    expect(link.checkRelease).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: MESSAGES['es-MX']['settings.reset'] }));
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(link.patch).toHaveBeenLastCalledWith({
      updates: { checkOnStartup: false, promptDismissed: true, nextPromptAt: 0 },
    });
    expect((await link.readSettings()).updates).toEqual({
      checkOnStartup: false,
      promptDismissed: true,
      nextPromptAt: 0,
    });
    await user.click(screen.getByRole('switch'));
    expect(link.checkRelease).toHaveBeenCalledTimes(1);
  });

  it('desactivar manualmente la consulta también suprime los avisos futuros y vacía su fecha', async () => {
    const updates = {
      ...DEFAULT_UPDATE_SETTINGS,
      checkOnStartup: true,
      nextPromptAt: 1_797_120_000_000,
    };
    const initial = { ...DEFAULT_SETTINGS, updates };
    initSettingsData(initial);
    localStorage.setItem('gitthul.settings', JSON.stringify(initial));
    const link = mount(
      'es-MX',
      vi.fn(() => Promise.resolve<ReleaseCheck>({ status: 'current' })),
    );
    await userEvent.setup().click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(link.patch).toHaveBeenCalledExactlyOnceWith({
      updates: { checkOnStartup: false, promptDismissed: true, nextPromptAt: 0 },
    });
    expect(link.flush).toHaveBeenCalledOnce();
    expect((await link.readSettings()).updates).toEqual({
      checkOnStartup: false,
      promptDismissed: true,
      nextPromptAt: 0,
    });
  });

  it('activar la consulta conserva la elección y fecha del aviso que ya estaban guardadas', async () => {
    const updates = {
      ...DEFAULT_UPDATE_SETTINGS,
      promptDismissed: true,
      nextPromptAt: 1_797_120_000_000,
    };
    const initial = { ...DEFAULT_SETTINGS, updates };
    initSettingsData(initial);
    localStorage.setItem('gitthul.settings', JSON.stringify(initial));
    const link = mount(
      'es-MX',
      vi.fn(() => Promise.resolve<ReleaseCheck>({ status: 'current' })),
    );
    await userEvent.setup().click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toBeChecked();
    expect(link.patch).toHaveBeenCalledExactlyOnceWith({ updates: { checkOnStartup: true } });
    expect(link.flush).toHaveBeenCalledOnce();
    expect((await link.readSettings()).updates).toEqual({ ...updates, checkOnStartup: true });
  });

  it.each(['switch', 'reset'] as const)(
    'un fallo al guardar %s restaura la consulta anterior',
    async (action) => {
      initSettingsData({
        ...DEFAULT_SETTINGS,
        updates: {
          ...DEFAULT_UPDATE_SETTINGS,
          checkOnStartup: true,
          nextPromptAt: 1_797_120_000_000,
        },
      });
      const ports = selectPorts();
      const patch = vi.fn(() => Promise.resolve());
      const flush = vi.fn(() => Promise.reject(new Error('disk full')));
      ports.settings = { read: () => Promise.resolve(DEFAULT_SETTINGS), patch, flush };
      render(
        <PortsContext value={ports}>
          <I18nProvider initialLocale="es-MX">
            <UpdatesSection />
          </I18nProvider>
        </PortsContext>,
      );
      const user = userEvent.setup();
      await user.click(
        action === 'switch'
          ? screen.getByRole('switch')
          : screen.getByRole('button', { name: MESSAGES['es-MX']['settings.reset'] }),
      );
      await waitFor(() => {
        expect(flush).toHaveBeenCalledOnce();
        expect(screen.getByRole('switch')).toBeChecked();
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        MESSAGES['es-MX']['settings.updates.prompt.saveFailed'],
      );
      expect(screen.getByRole('switch')).toBeEnabled();
      expect(getSettingsSnapshot().updates).toEqual({
        ...DEFAULT_UPDATE_SETTINGS,
        checkOnStartup: true,
        nextPromptAt: 1_797_120_000_000,
      });
      expect(patch).toHaveBeenCalledExactlyOnceWith({
        updates: { checkOnStartup: false, promptDismissed: true, nextPromptAt: 0 },
      });
    },
  );

  it('espera el guardado confirmado antes de permitir otra elección o restablecimiento', async () => {
    let finish!: () => void;
    const ports = selectPorts();
    const patch = vi.fn(() => Promise.resolve());
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    ports.settings = { read: () => Promise.resolve(DEFAULT_SETTINGS), patch, flush };
    render(
      <PortsContext value={ports}>
        <I18nProvider initialLocale="es-MX">
          <UpdatesSection />
        </I18nProvider>
      </PortsContext>,
    );
    await userEvent.setup().click(screen.getByRole('switch'));
    await waitFor(() => expect(flush).toHaveBeenCalledOnce());
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: MESSAGES['es-MX']['settings.reset'] }),
    ).toBeDisabled();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByRole('button', { name: MESSAGES['es-MX']['settings.reset'] })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('comparte una consulta en curso y desactiva el botón hasta que termine', async () => {
    let resolve!: (value: ReleaseCheck) => void;
    const checkRelease = vi.fn(
      () =>
        new Promise<ReleaseCheck>((done) => {
          resolve = done;
        }),
    );
    const link = mount('es-MX', checkRelease);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = useReleaseStore.getState().checkNow(link);
      second = useReleaseStore.getState().checkNow(link);
      await Promise.resolve();
    });
    expect(second).toBe(first);
    expect(screen.getByRole('button', { name: 'Buscando versiones…' })).toBeDisabled();
    expect(checkRelease).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ status: 'current' });
      await first;
    });
    expect(screen.getByRole('button', { name: 'Buscar ahora' })).toBeEnabled();
    expect(screen.getByText('No hay una versión estable más reciente.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Avisos' })).queryByRole('status'),
    ).not.toBeInTheDocument();
  });

  it('muestra los errores de red sin afirmar que está actualizado y permite reintentar', async () => {
    const user = userEvent.setup();
    const checkRelease = vi
      .fn(() => Promise.resolve<ReleaseCheck>({ status: 'current' }))
      .mockRejectedValueOnce(new Error('HTTP 429'));
    const link = mount('es-MX', checkRelease);
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
    expect(
      await screen.findByText(MESSAGES['es-MX']['settings.updates.failed']),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(MESSAGES['es-MX']['settings.updates.current']),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir descargas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
    expect(
      await screen.findByText(MESSAGES['es-MX']['settings.updates.current']),
    ).toBeInTheDocument();
    expect(checkRelease).toHaveBeenCalledTimes(2);
    expect(link.openExternal).not.toHaveBeenCalled();
  });

  it('recupera también un fallo síncrono del puerto', async () => {
    const checkRelease = vi
      .fn(() => Promise.resolve<ReleaseCheck>({ status: 'current' }))
      .mockImplementationOnce(() => {
        throw new Error('IPC unavailable');
      });
    const link = mount('es-MX', checkRelease);
    await act(() => useReleaseStore.getState().checkNow(link));
    expect(useReleaseStore.getState().check).toEqual({ status: 'error' });
    await act(() => useReleaseStore.getState().checkNow(link));
    expect(useReleaseStore.getState().check).toEqual({ status: 'current' });
  });

  it('distingue una lista sin publicaciones estables de una versión actual', async () => {
    const user = userEvent.setup();
    mount(
      'es-MX',
      vi.fn(() => Promise.resolve<ReleaseCheck>({ status: 'empty' })),
    );
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
    expect(
      await screen.findByText('Todavía no hay versiones estables publicadas.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(MESSAGES['es-MX']['settings.updates.current']),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir descargas' })).not.toBeInTheDocument();
  });

  it('abre la página oficial solo al pulsar el enlace en ajustes o en el aviso y no duplica avisos', async () => {
    const user = userEvent.setup();
    const link = mount();
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
    expect(await screen.findAllByText('Hay una nueva versión de GitThul: 1.1.0.')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
    expect(screen.getAllByText('Hay una nueva versión de GitThul: 1.1.0.')).toHaveLength(2);
    expect(link.openExternal).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('region', { name: 'Actualizaciones' })).getByRole('button', {
        name: 'Abrir descargas',
      }),
    );
    expect(link.openExternal).toHaveBeenCalledExactlyOnceWith(available.url);
    await user.click(
      within(screen.getByRole('region', { name: 'Avisos' })).getByRole('button', {
        name: 'Abrir descargas',
      }),
    );
    expect(link.openExternal).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
    expect(screen.getAllByText('Hay una nueva versión de GitThul: 1.1.0.')).toHaveLength(1);
  });

  it.each(['settings', 'toast'])(
    'informa si no puede abrir el navegador desde %s',
    async (source) => {
      const user = userEvent.setup();
      const link = mount();
      link.openExternal.mockRejectedValueOnce(new Error('browser unavailable'));
      await user.click(screen.getByRole('button', { name: 'Buscar ahora' }));
      await screen.findAllByText('Hay una nueva versión de GitThul: 1.1.0.');
      const region = screen.getByRole('region', {
        name: source === 'settings' ? 'Actualizaciones' : 'Avisos',
      });
      await user.click(within(region).getByRole('button', { name: 'Abrir descargas' }));
      await waitFor(() =>
        expect(
          screen.getByText(MESSAGES['es-MX']['settings.updates.openFailed']),
        ).toBeInTheDocument(),
      );
    },
  );
});

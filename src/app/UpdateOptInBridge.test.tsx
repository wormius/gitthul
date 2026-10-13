import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSettingsPort } from '@core/adapters/mock/mockSettingsPort';
import { memoryStorage, type JsonStorage } from '@core/adapters/mock/storage';
import { coalesceSettingsWrites } from '@core/adapters/coalesceSettings';
import { selectPorts } from '@core/adapters/selectPorts';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { UPDATE_PROMPT_DELAY, UPDATE_PROMPT_INTERVAL } from '@core/domain/updatePrompt';
import type { ReleaseCheck } from '@core/ports/LinkPort';
import { useReleaseStore } from '@features/settings/releaseStore';
import { UpdatesSection } from '@features/settings/UpdatesSection';
import { getSettingsSnapshot, initSettingsData } from '@features/settings/useSettingsData';
import { I18nProvider } from '@i18n/I18nProvider';
import { ToastProvider } from '@ui/ToastProvider';
import { useToast } from '@ui/useToast';

import { PortsContext } from './PortsContext';
import { ReleaseNotificationBridge } from './ReleaseNotificationBridge';
import { UpdateOptInBridge } from './UpdateOptInBridge';

const message = '¿Quieres recibir avisos de nuevas versiones de GitThul?';
const enabled = 'Se activó la búsqueda de actualizaciones al arrancar.';
const failure = 'No se pudo guardar tu elección. Inténtalo de nuevo.';
const startedAt = Date.UTC(2026, 9, 13, 12);

function HistoryCount() {
  const { history } = useToast();
  return <output aria-label="Historial de avisos">{history.length}</output>;
}

function fixture(storage: JsonStorage = memoryStorage(JSON.stringify(getSettingsSnapshot()))) {
  const settings = coalesceSettingsWrites(createMockSettingsPort({ storage }));
  const patch = vi.spyOn(settings, 'patch');
  const flush = vi.spyOn(settings, 'flush');
  const checkRelease = vi.fn(() => Promise.resolve<ReleaseCheck>({ status: 'current' }));
  const openExternal = vi.fn(() => Promise.resolve());
  const ports = { ...selectPorts(), settings, link: { checkRelease, openExternal } };
  const mount = (showSettings = false) =>
    render(
      <StrictMode>
        <PortsContext value={ports}>
          <I18nProvider initialLocale="es-MX">
            <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar">
              <input aria-label="Trabajo" />
              <HistoryCount />
              <ReleaseNotificationBridge />
              <UpdateOptInBridge />
              {showSettings && <UpdatesSection />}
            </ToastProvider>
          </I18nProvider>
        </PortsContext>
      </StrictMode>,
    );
  const reopen = async () => {
    cleanup();
    initSettingsData(await createMockSettingsPort({ storage }).read());
    return mount();
  };
  return { mount, reopen, patch, flush, checkRelease, openExternal, settings, storage };
}

async function advance(ms = UPDATE_PROMPT_DELAY) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

async function choose(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  localStorage.clear();
  initSettingsData(DEFAULT_SETTINGS);
  useReleaseStore.setState({ check: { status: 'idle' }, availableRelease: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('update check opt-in notice', () => {
  it('waits for startup, persists a deadline and offers three choices once without querying or stealing focus', async () => {
    const app = fixture();
    app.mount();
    const work = screen.getByRole('textbox', { name: 'Trabajo' });
    work.focus();
    await advance(UPDATE_PROMPT_DELAY - 1);
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    await advance(1);
    const notice = screen.getByText(new RegExp(message)).closest('[role="status"]')!;
    expect(within(notice as HTMLElement).getAllByRole('button')).toHaveLength(4);
    expect(work).toHaveFocus();
    expect(app.checkRelease).not.toHaveBeenCalled();
    expect(app.openExternal).not.toHaveBeenCalled();
    expect((await app.settings.read()).updates.nextPromptAt).toBe(
      startedAt + UPDATE_PROMPT_DELAY + UPDATE_PROMPT_INTERVAL,
    );
    expect(app.flush).toHaveBeenCalledOnce();
    expect(screen.getByRole('status', { name: 'Historial de avisos' })).toHaveTextContent('1');
    await advance(UPDATE_PROMPT_INTERVAL * 2);
    expect(screen.getAllByText(new RegExp(message))).toHaveLength(1);
    expect(app.patch).toHaveBeenCalledOnce();
  });

  it.each([
    { checkOnStartup: true },
    { promptDismissed: true },
    { nextPromptAt: startedAt + UPDATE_PROMPT_INTERVAL },
  ])('does not offer when the saved preference is %j', async (updates) => {
    initSettingsData({ ...DEFAULT_SETTINGS, updates: { ...DEFAULT_SETTINGS.updates, ...updates } });
    const app = fixture();
    app.mount();
    await advance();
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(app.patch).not.toHaveBeenCalled();
    expect(app.checkRelease).toHaveBeenCalledTimes(updates.checkOnStartup ? 1 : 0);
  });

  it('does not display the offer until its deadline has finished saving', async () => {
    const app = fixture();
    let saved!: () => void;
    app.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    app.mount();
    await advance();
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    act(() => saved());
    await advance(0);
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    expect(app.checkRelease).not.toHaveBeenCalled();
  });

  it.each(['Recordarme en una semana', 'Cerrar'])(
    'persists a fresh week on %s and waits for a later launch',
    async (choice) => {
      const app = fixture();
      app.mount();
      await advance();
      await advance(60 * 60 * 1000);
      const clickedAt = Date.now();
      await choose(choice);
      expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
      expect((await app.settings.read()).updates).toEqual({
        ...DEFAULT_SETTINGS.updates,
        nextPromptAt: clickedAt + UPDATE_PROMPT_INTERVAL,
      });
      expect(app.checkRelease).not.toHaveBeenCalled();
      await app.reopen();
      await advance(UPDATE_PROMPT_DELAY);
      expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
      vi.setSystemTime(clickedAt + UPDATE_PROMPT_INTERVAL);
      await app.reopen();
      await advance();
      expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
      expect(app.checkRelease).not.toHaveBeenCalled();
    },
  );

  it('also defers another launch when the entire application closes without a choice', async () => {
    const app = fixture();
    app.mount();
    await advance();
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    await app.reopen();
    await advance();
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(app.patch).toHaveBeenCalledOnce();
  });

  it('suppresses future offers without enabling network checks', async () => {
    const app = fixture();
    app.mount();
    await advance();
    await choose('No volver a sugerirlo');
    expect((await app.settings.read()).updates).toEqual({
      ...DEFAULT_SETTINGS.updates,
      promptDismissed: true,
    });
    await app.reopen();
    await advance(UPDATE_PROMPT_INTERVAL * 2);
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(app.checkRelease).not.toHaveBeenCalled();
  });

  it('enables and persists startup checks, queries exactly once and opens no download automatically', async () => {
    const app = fixture();
    app.mount();
    await advance();
    expect(app.checkRelease).not.toHaveBeenCalled();
    await choose('Activar');
    expect((await app.settings.read()).updates).toEqual({
      checkOnStartup: true,
      promptDismissed: true,
      nextPromptAt: 0,
    });
    expect(screen.getByText(enabled)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(app.checkRelease).toHaveBeenCalledExactlyOnceWith();
    expect(app.openExternal).not.toHaveBeenCalled();
    await app.reopen();
    await advance();
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(app.checkRelease).toHaveBeenCalledTimes(2);
  });

  it('removes a visible offer when another settings view suppresses it without postponing again', async () => {
    const app = fixture();
    app.mount();
    await advance();
    act(() =>
      initSettingsData({
        ...getSettingsSnapshot(),
        updates: { ...DEFAULT_SETTINGS.updates, promptDismissed: true },
      }),
    );
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(app.patch).toHaveBeenCalledOnce();
    expect(app.checkRelease).not.toHaveBeenCalled();
  });

  it('keeps the choices available after a rejected save and can retry without reporting false success', async () => {
    const app = fixture();
    app.mount();
    await advance();
    app.patch.mockRejectedValueOnce(new Error('Permission denied'));
    await choose('Activar');
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.getByText(failure)).toBeInTheDocument();
    expect(screen.queryByText(enabled)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar' })).toBeEnabled();
    expect(getSettingsSnapshot().updates.checkOnStartup).toBe(false);
    expect((await app.settings.read()).updates.checkOnStartup).toBe(false);
    await choose('Activar');
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(screen.getByText(enabled)).toBeInTheDocument();
    expect((await app.settings.read()).updates.checkOnStartup).toBe(true);
  });

  it('keeps the offer while a choice saves and prevents double submission or closing', async () => {
    const app = fixture();
    app.mount();
    await advance();
    let saved!: () => void;
    app.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    await choose('No volver a sugerirlo');
    const notice = screen.getByText(new RegExp(message)).closest('[role="status"]')!;
    for (const button of within(notice as HTMLElement).getAllByRole('button'))
      expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'No volver a sugerirlo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(app.patch).toHaveBeenCalledTimes(2);
    act(() => saved());
    await advance(0);
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
  });

  it('reports an initial save failure once and never displays an offer with an unsaved deadline', async () => {
    const app = fixture();
    app.patch.mockRejectedValueOnce(new Error('Read-only settings'));
    app.mount();
    await advance();
    expect(screen.getByText(failure)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(getSettingsSnapshot().updates.nextPromptAt).toBe(0);
    expect(app.checkRelease).not.toHaveBeenCalled();
    await advance(UPDATE_PROMPT_DELAY * 2);
    expect(app.patch).toHaveBeenCalledOnce();
  });

  it('respects a manual reset that completes while another choice is failing', async () => {
    const app = fixture();
    app.mount(true);
    await advance();
    let failed!: (error: Error) => void;
    app.patch.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failed = reject;
        }),
    );
    await choose('Activar');
    expect(screen.getByRole('switch')).toBeChecked();
    await choose('Restablecer sección');
    expect(screen.getByRole('switch')).not.toBeChecked();
    act(() => failed(new Error('Permission denied')));
    await advance(0);
    expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
    expect(screen.queryByText(enabled)).not.toBeInTheDocument();
    expect((await app.settings.read()).updates).toEqual({
      ...DEFAULT_SETTINGS.updates,
      promptDismissed: true,
    });
  });

  it.each(['unmount', 'suppress'] as const)(
    'does not show stale choices if %s occurs during the initial save',
    async (change) => {
      const app = fixture();
      let saved!: () => void;
      app.flush.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            saved = resolve;
          }),
      );
      const view = app.mount();
      await advance();
      if (change === 'unmount') view.unmount();
      else
        act(() =>
          initSettingsData({
            ...getSettingsSnapshot(),
            updates: { ...DEFAULT_SETTINGS.updates, promptDismissed: true },
          }),
        );
      act(() => saved());
      await advance(0);
      expect(screen.queryByText(new RegExp(message))).not.toBeInTheDocument();
      expect(app.checkRelease).not.toHaveBeenCalled();
    },
  );
});

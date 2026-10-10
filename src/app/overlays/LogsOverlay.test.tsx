import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { createMockLogPort } from '@core/adapters/mock/mockLogPort';
import { selectPorts } from '@core/adapters/selectPorts';
import { I18nProvider } from '@i18n/I18nProvider';

import { LogsOverlay } from './LogsOverlay';

describe('LogsOverlay', () => {
  beforeEach(() => useShellStore.getState().reset());

  it('lee la corriente existente, sigue entradas nuevas y permite vaciarla', async () => {
    const user = userEvent.setup();
    const log = createMockLogPort();
    log.write('info', 'app', 'arrancó');
    useShellStore.getState().setOverlay('logs');
    render(
      <PortsContext value={{ ...selectPorts(), log }}>
        <I18nProvider initialLocale="es-MX">
          <LogsOverlay />
        </I18nProvider>
      </PortsContext>,
    );

    expect(await screen.findByText('arrancó')).toBeInTheDocument();
    act(() => {
      log.write('error', 'git.write', 'falló', 'detalle');
    });
    expect(await screen.findByText('falló')).toBeInTheDocument();
    expect(screen.getAllByText('ERROR')[0]).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar registros' }));
    await waitFor(() =>
      expect(screen.getByText('Todavía no hay entradas de registro.')).toBeVisible(),
    );
    expect(await log.read()).toEqual([]);
  });
  it('limita la vista a 100 entradas descendentes y exporta por separado todo o errores', async () => {
    const user = userEvent.setup();
    const log = createMockLogPort();
    for (let index = 0; index < 125; index++) log.write('info', 'app', `entrada-${index}`);
    const exportLogs = vi.spyOn(log, 'export').mockResolvedValue(true);
    useShellStore.getState().setOverlay('logs');
    render(
      <PortsContext value={{ ...selectPorts(), log }}>
        <I18nProvider initialLocale="es-MX">
          <LogsOverlay />
        </I18nProvider>
      </PortsContext>,
    );
    await screen.findByText('entrada-124');
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('entrada-124');
    expect(screen.queryByText('entrada-24')).not.toBeInTheDocument();
    act(() => log.write('error', 'app', 'error nuevo'));
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('error nuevo');
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: 'Exportar todos' }));
    expect(exportLogs).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Exportar avisos y errores' }));
    expect(exportLogs).toHaveBeenLastCalledWith(true);
    expect(await log.read()).toHaveLength(126);
  });
});

it('filtra por nivel, ámbito y búsqueda sin recortar el journal', async () => {
  useShellStore.getState().reset();
  const user = userEvent.setup();
  const log = createMockLogPort({ debugEnabled: true });
  log.write('debug', 'git.read', 'routine');
  log.write('warn', 'git.read', 'missing repository');
  log.write('error', 'settings', 'disk full');
  useShellStore.getState().setOverlay('logs');
  render(
    <PortsContext value={{ ...selectPorts(), log }}>
      <I18nProvider initialLocale="es-MX">
        <LogsOverlay />
      </I18nProvider>
    </PortsContext>,
  );
  await screen.findByText('routine');
  await user.selectOptions(screen.getByLabelText('Nivel mínimo'), 'warn');
  expect(screen.queryByText('routine')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Todos los ámbitos'), 'git.read');
  expect(screen.getByText('missing repository')).toBeVisible();
  expect(screen.queryByText('disk full')).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), 'unmatched');
  expect(screen.getByText('Todavía no hay entradas de registro.')).toBeVisible();
  expect(await log.read()).toHaveLength(3);
});

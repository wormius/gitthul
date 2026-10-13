import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsContext } from '../PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { I18nProvider } from '@i18n/I18nProvider';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { useShellStore } from '../shellStore';
import { GlobalSearch } from './GlobalSearch';

function renderSearch() {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const ports = { ...selectPorts(), git, library: createMockLibraryPort() };
  render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <GlobalSearch />
      </I18nProvider>
    </PortsContext>,
  );
  return git;
}
const items = () => within(screen.getByRole('dialog')).queryAllByRole('option');
beforeEach(() => {
  useShellStore.getState().reset();
  useRepositoriesStore.getState().reset();
});

describe('GlobalSearch', () => {
  it.each([
    ['caché', 'Limpiar caché…', 'settings.storage.cleanup'],
    ['respaldos automáticos', 'Respaldos automáticos', 'settings.backup.enabled'],
    ['límite global', 'Límite global de espacio (MiB)', 'settings.backup.maxMiB'],
  ])('finds the current backup and cache control for %s', async (query, label, focus) => {
    useShellStore.getState().openSettings();
    useShellStore.getState().setOverlay('search');
    renderSearch();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: query } });
    const option = await screen.findByRole('option', {
      name: `${label} Opciones de configuración · Respaldos y caché`,
    });
    fireEvent.click(option);
    expect(useShellStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsSection: 'recovery',
      settingsFocus: focus,
      overlay: 'none',
    });
  });

  it('abre las variantes del tema desde la búsqueda de ajustes', async () => {
    useShellStore.getState().openSettings();
    useShellStore.getState().setOverlay('search');
    renderSearch();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'variantes' } });
    const option = await screen.findByRole('option', {
      name: 'Variantes Opciones de configuración · Apariencia',
    });
    fireEvent.click(option);

    expect(useShellStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsSection: 'appearance',
      settingsFocus: 'settings.appearance.variants',
      overlay: 'none',
    });
  });

  it('previews multiple categories and expands only the chosen category', async () => {
    useShellStore
      .getState()
      .openWorking({ repoId: 'gitthul', repoName: 'gitthul', repoPath: '/repo', branch: 'main' });
    useShellStore.getState().setOverlay('search');
    const git = renderSearch();
    await waitFor(() => expect(useRepositoriesStore.getState().repositories).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Esta vista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fix' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ver Mensajes de commits' })).toBeEnabled(),
    );
    expect(items().length).toBeLessThanOrEqual(10);
    expect(items().some((item) => item.textContent?.includes('fix/push-rechazado'))).toBe(true);
    const tree = vi.spyOn(git, 'readTree');
    fireEvent.click(screen.getByRole('button', { name: 'Ver Mensajes de commits' }));
    await waitFor(() => expect(items()).toHaveLength(10));
    expect(items().every((item) => item.textContent?.includes('Mensajes de commits'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 10 resultados más' }));
    await waitFor(() => expect(items()).toHaveLength(20));
    expect(new Set(items().map((item) => item.id)).size).toBe(20);
    expect(tree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a mejores coincidencias' }));
    await waitFor(() => expect(items()).toHaveLength(10));
    expect(screen.getByRole('button', { name: 'Esta vista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('discards stale results and loading when closing during a search', async () => {
    useShellStore.getState().setOverlay('search');
    const git = renderSearch();
    await waitFor(() => expect(useRepositoriesStore.getState().repositories).not.toBeNull());
    const spy = vi.spyOn(git, 'readRefs');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'main' } });
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
  it('sends a navigation request for a matching branch instead of changing HEAD', async () => {
    useShellStore
      .getState()
      .openWorking({ repoId: 'gitthul', repoName: 'gitthul', repoPath: '/repo', branch: 'main' });
    useShellStore.getState().setOverlay('search');
    const git = renderSearch();
    await waitFor(() => expect(useRepositoriesStore.getState().repositories).not.toBeNull());
    const checkout = vi.spyOn(git, 'checkout');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fix/push-rechazado' } });
    const options = await screen.findAllByRole('option', {
      name: /^fix\/push-rechazado Ramas · gitthul$/,
    });
    const option = options[0]!;
    fireEvent.click(option);
    await waitFor(() => expect(useShellStore.getState().searchNavigation?.kind).toBe('ref'));
    expect(checkout).not.toHaveBeenCalled();
    expect(useShellStore.getState().overlay).toBe('none');
  });
});

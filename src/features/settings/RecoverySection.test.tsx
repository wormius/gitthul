import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import {
  RecoveryOperationError,
  type RecoveryPreview,
  type RecoverySnapshot,
} from '@core/domain/recovery';
import type { RecoveryPort } from '@core/ports/RecoveryPort';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { I18nProvider } from '@i18n/I18nProvider';
import { RecoverySection } from './RecoverySection';
import { initSettingsData } from './useSettingsData';

const snapshot: RecoverySnapshot = {
  directory: '/mock/data/recovery',
  totalBytes: 1048576,
  checkpoints: [
    {
      id: 'point-1',
      repository: '/repos/example',
      createdAt: 1728000000000,
      label: 'undo.reset',
      status: 'pending',
      fileCount: 2,
      bytes: 1048576,
      active: false,
    },
  ],
};
const preview: RecoveryPreview = {
  token: 'confirmed-state',
  repository: '/repos/example',
  fileCount: 2,
  paths: ['src/file.ts', 'untracked.txt'],
  includesGitState: true,
};

function setup(overrides: Partial<RecoveryPort> = {}) {
  const ports = selectPorts();
  const recovery = {
    read: vi.fn(() => Promise.resolve(structuredClone(snapshot))),
    cleanup: vi.fn(() => Promise.resolve({ removed: 0, freedBytes: 0 })),
    importLegacy: vi.fn(() => Promise.resolve(0)),
    remove: vi.fn((_id: string) => Promise.resolve()),
    preview: vi.fn((_id: string) => Promise.resolve(preview)),
    restore: vi.fn((_token: string) => Promise.resolve()),
    cancelPreview: vi.fn((_token: string) => Promise.resolve()),
    export: vi.fn((_id: string) => Promise.resolve(true)),
    openDirectory: vi.fn(() => Promise.resolve()),
    ...overrides,
  } satisfies RecoveryPort;
  ports.recovery = recovery;
  const view = render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <RecoverySection />
      </I18nProvider>
    </PortsContext>,
  );
  return { ports, recovery, ...view };
}

beforeEach(() => {
  localStorage.clear();
  initSettingsData(DEFAULT_SETTINGS);
});

describe('RecoverySection', () => {
  it('muestra la depuración suspendida por configuración inválida y la reactiva al guardar ajustes válidos', async () => {
    const user = userEvent.setup();
    const read = vi.fn(() =>
      Promise.resolve({ ...snapshot, configurationWarning: true } as RecoverySnapshot),
    );
    const { ports } = setup({ read });
    expect(await screen.findByText(/depuración automática está suspendida/)).toBeVisible();
    const toggle = screen.getByRole('switch', { name: 'Depuración automática' });
    expect(toggle).not.toBeChecked();
    read.mockResolvedValueOnce({ ...snapshot, configurationWarning: false });
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.queryByText(/depuración automática está suspendida/)).not.toBeInTheDocument();
    expect((await ports.settings.read()).recovery.autoCleanup).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('descubre las copias persistidas y su aviso pendiente cada vez que se monta', async () => {
    const first = setup();
    expect(await screen.findByText('/repos/example')).toBeVisible();
    expect(screen.getByText('Puntos por revisar: 1.')).toBeVisible();
    expect(screen.getByText('/mock/data/recovery')).toBeVisible();
    expect(screen.getByText('Hacer reset')).toBeVisible();
    first.unmount();
    const next = setup();
    await screen.findByText('/repos/example');
    expect(next.recovery.read).toHaveBeenCalledOnce();
  });

  it('solo restaura después de mostrar el alcance y confirmar el token inspeccionado', async () => {
    const user = userEvent.setup();
    const { recovery } = setup();
    await user.click(await screen.findByRole('button', { name: 'Restaurar…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('índice de staging y las referencias Git');
    expect(dialog).toHaveTextContent('src/file.ts');
    expect(dialog).toHaveTextContent('punto de recuperación del estado actual');
    expect(recovery.restore).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Crear respaldo y restaurar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(recovery.preview).toHaveBeenCalledWith('point-1');
    expect(recovery.restore).toHaveBeenCalledWith('confirmed-state');
    expect(recovery.cancelPreview).toHaveBeenCalledWith('confirmed-state');
    expect(recovery.read).toHaveBeenCalledTimes(2);
  });

  it('cancelar libera la vista previa sin restaurar y devuelve el foco', async () => {
    const user = userEvent.setup();
    const { recovery } = setup();
    const button = await screen.findByRole('button', { name: 'Restaurar…' });
    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(recovery.cancelPreview).toHaveBeenCalledWith('confirmed-state');
    expect(recovery.restore).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('abandonar la sección libera una vista previa pendiente de respuesta', async () => {
    let resolve!: (value: RecoveryPreview) => void;
    const pending = new Promise<RecoveryPreview>((complete) => {
      resolve = complete;
    });
    const { recovery, unmount } = setup({ preview: vi.fn(() => pending) });
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar…' }));
    await waitFor(() => expect(recovery.preview).toHaveBeenCalledOnce());
    unmount();
    await act(async () => {
      resolve(preview);
      await pending;
    });
    expect(recovery.cancelPreview).toHaveBeenCalledWith('confirmed-state');
    expect(recovery.restore).not.toHaveBeenCalled();
  });

  it('muestra un estado cambiado en vez de afirmar éxito y exige otra vista previa', async () => {
    const user = userEvent.setup();
    const failure = new RecoveryOperationError('recovery.stale', 'HEAD changed after preview');
    const { recovery } = setup({ restore: vi.fn(() => Promise.reject(failure)) });
    await user.click(await screen.findByRole('button', { name: 'Restaurar…' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Crear respaldo y restaurar',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'vuelve a revisar antes de restaurar',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByText('Ver detalles técnicos'));
    expect(screen.getByText('HEAD changed after preview')).toBeVisible();
    expect(recovery.read).toHaveBeenCalledOnce();
  });

  it('exporta sin restaurar; cerrar el selector no produce un error', async () => {
    const user = userEvent.setup();
    const { recovery } = setup({ export: vi.fn(() => Promise.resolve(false)) });
    await user.click(await screen.findByRole('button', { name: 'Exportar archivos…' }));
    await waitFor(() => expect(recovery.export).toHaveBeenCalledWith('point-1'));
    expect(recovery.restore).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('guarda los límites y la limpieza automática sin perder otros ajustes', async () => {
    const user = userEvent.setup();
    const { ports } = setup();
    const limit = screen.getByRole('spinbutton', { name: 'Máximo de puntos por repositorio' });
    await user.clear(limit);
    await user.type(limit, '25');
    await user.tab();
    await waitFor(async () =>
      expect((await ports.settings.read()).recovery.maxCheckpoints).toBe(25),
    );
    await user.click(screen.getByRole('switch', { name: 'Depuración automática' }));
    await waitFor(async () =>
      expect((await ports.settings.read()).recovery.autoCleanup).toBe(false),
    );
    expect((await ports.settings.read()).recovery.maxAgeDays).toBe(30);
    expect((await ports.settings.read()).appearance).toEqual(DEFAULT_SETTINGS.appearance);
  });

  it('rechaza límites inválidos y un fallo de disco revierte el cambio', async () => {
    const user = userEvent.setup();
    const { ports } = setup();
    const limit = screen.getByRole('spinbutton', { name: 'Antigüedad máxima (días)' });
    await user.clear(limit);
    await user.type(limit, '0');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 y 3650');
    expect((await ports.settings.read()).recovery.maxAgeDays).toBe(30);
    vi.spyOn(ports.settings, 'patch').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('switch', { name: 'Depuración automática' }));
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
    expect(screen.getByText('No se pudo completar la acción de recuperación.')).toBeVisible();
  });

  it('limpia solo después de confirmar y descubre los resultados actualizados', async () => {
    const user = userEvent.setup();
    const { recovery } = setup();
    await screen.findByText('/repos/example');
    await user.click(screen.getByRole('button', { name: 'Depurar ahora' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Se conservarán los puntos pendientes');
    expect(recovery.cleanup).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Depurar ahora' }));
    await waitFor(() => expect(recovery.read).toHaveBeenCalledTimes(2));
    expect(recovery.cleanup).toHaveBeenCalledOnce();
  });

  it('eliminar una copia pide confirmación y los puntos activos mantienen exportación disponible', async () => {
    const user = userEvent.setup();
    const { recovery } = setup();
    await user.click(await screen.findByRole('button', { name: 'Eliminar copia…' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('No se modificarán los archivos ni el estado Git');
    expect(recovery.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar copia…' }));
    await waitFor(() => expect(recovery.remove).toHaveBeenCalledWith('point-1'));
  });

  it('explica los puntos protegidos y las copias incompletas sin borrarlas', async () => {
    const active: RecoverySnapshot = {
      ...snapshot,
      overBudget: true,
      protectedCount: 1,
      uncertainBuckets: 2,
      checkpoints: snapshot.checkpoints.map((point) => ({
        ...point,
        active: true,
        status: 'legacy',
      })),
    };
    const { recovery } = setup({ read: vi.fn(() => Promise.resolve(active)) });
    await screen.findByText('/repos/example');
    expect(screen.getByRole('button', { name: 'Eliminar copia…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Exportar archivos…' })).toBeEnabled();
    expect(screen.getByText(/límites siguen excedidos/)).toBeVisible();
    expect(screen.getByText(/grupos de respaldos incompletos/)).toBeVisible();
    expect(screen.getByText('Puntos por revisar: 1.')).toBeVisible();
    expect(recovery.cleanup).not.toHaveBeenCalled();
  });

  it('un rechazo al eliminar mantiene la confirmación y explica el fallo dentro del diálogo', async () => {
    const user = userEvent.setup();
    setup({
      remove: vi.fn(() => Promise.reject(new RecoveryOperationError('recovery.protected'))),
    });
    await user.click(await screen.findByRole('button', { name: 'Eliminar copia…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar copia…' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('historial activo');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('importa solo tras la acción explícita y conserva el detalle de permisos', async () => {
    const user = userEvent.setup();
    const failure = new RecoveryOperationError('recovery.unavailable', 'Permission denied');
    const { recovery } = setup();
    expect(recovery.importLegacy).not.toHaveBeenCalled();
    recovery.importLegacy = vi.fn(() => Promise.reject(failure));
    await user.click(screen.getByRole('button', { name: 'Importar puntos existentes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permisos');
    await user.click(screen.getByText('Ver detalles técnicos'));
    expect(screen.getByText('Permission denied')).toBeVisible();
  });
});

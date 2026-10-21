import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import { createMockSettingsPort } from '@core/adapters/mock/mockSettingsPort';
import {
  BackupOperationError,
  type BackupLimitPlan,
  type BackupSnapshot,
} from '@core/domain/backup';
import { RecoveryOperationError, type RecoverySnapshot } from '@core/domain/recovery';
import type { BackupPort } from '@core/ports/BackupPort';
import type { RecoveryPort } from '@core/ports/RecoveryPort';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { I18nProvider } from '@i18n/I18nProvider';
import { RecoverySection } from './RecoverySection';
import { getSettingsSnapshot, initSettingsData } from './useSettingsData';

const cache: RecoverySnapshot = {
  directory: '/mock/data/recovery',
  totalBytes: 1048576,
  protectedCount: 1,
  checkpoints: [
    {
      id: 'internal-point',
      repository: '/private/internal-repo',
      createdAt: 1728000000000,
      label: 'undo.reset',
      status: 'pending',
      fileCount: 2,
      bytes: 1048576,
      active: true,
    },
  ],
};
const catalog: BackupSnapshot = {
  directory: '/mock/data/backups',
  totalBytes: 2097152,
  maxBytes: 1073741824,
  enabled: true,
  scanning: false,
  corruptPoints: 0,
  repositories: [
    {
      id: 'example',
      name: 'example',
      repository: '/deleted/example',
      status: 'completed',
      lastCompletedAt: 1728000000000,
      points: [{ id: 'complete-point', createdAt: 1728000000000, bytes: 2097152, fileCount: 10 }],
    },
  ],
};

const olderCatalog: BackupSnapshot = {
  ...catalog,
  // El almacenamiento compartido no equivale a sumar los tamaños de los puntos.
  totalBytes: 3 * 1048576,
  repositories: catalog.repositories.map((repository) => ({
    ...repository,
    points: [
      { id: 'older-point', createdAt: 1727000000000, bytes: 5 * 1048576, fileCount: 20 },
      ...repository.points,
    ],
  })),
};

function limitPlan(maxMiB: number, overrides: Partial<BackupLimitPlan> = {}): BackupLimitPlan {
  return {
    maxMiB,
    currentBytes: catalog.totalBytes,
    projectedBytes: catalog.totalBytes,
    minimumBytes: catalog.totalBytes,
    deleteCount: 0,
    feasible: maxMiB * 1048576 >= catalog.totalBytes,
    token: `reviewed-limit-${maxMiB}`,
    ...overrides,
  };
}

function olderDeleteButton() {
  const date = new Date(1727000000000).toLocaleString('es-MX');
  const row = screen.getByText(date).closest('li');
  if (!row) throw new Error('Falta el respaldo anterior');
  return within(row).getByRole('button', { name: 'Eliminar…' });
}

function setup({
  recovery: recoveryOverrides = {},
  backup: backupOverrides = {},
}: {
  recovery?: Partial<RecoveryPort>;
  backup?: Partial<BackupPort>;
} = {}) {
  const ports = selectPorts();
  const recovery = {
    read: vi.fn(() => Promise.resolve(structuredClone(cache))),
    cleanup: vi.fn(() => Promise.resolve({ removed: 1, freedBytes: 1048576 })),
    ...recoveryOverrides,
  } satisfies RecoveryPort;
  const backup = {
    read: vi.fn(() => Promise.resolve(structuredClone(catalog))),
    previewLimit: vi.fn((maxMiB: number) => Promise.resolve(limitPlan(maxMiB))),
    schedule: vi.fn((_repository: string) => Promise.resolve()),
    restore: vi.fn((_id: string) => Promise.resolve({ path: '/restored/example' })),
    delete: vi.fn((_id: string) => Promise.resolve(structuredClone(catalog))),
    prune: vi.fn(() => Promise.resolve(structuredClone(catalog))),
    ...backupOverrides,
  } satisfies BackupPort;
  ports.recovery = recovery;
  ports.backup = backup;
  // This view fixture owns its catalog; avoid validating its plans against the
  // unrelated hidden catalog in selectPorts' complete mock application.
  ports.settings = createMockSettingsPort();
  const view = render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <RecoverySection />
      </I18nProvider>
    </PortsContext>,
  );
  return { ports, recovery, backup, ...view };
}

beforeEach(() => {
  localStorage.clear();
  initSettingsData(DEFAULT_SETTINGS);
});

describe('Backups and cache', () => {
  it('shows complete repository backups and cache usage without exposing internal snapshots', async () => {
    setup();
    expect(await screen.findByText('/deleted/example')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Archivos temporales' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Respaldos de emergencia' })).toBeVisible();
    expect(screen.getByText(/Último respaldo terminado:/)).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Límite global de espacio (MiB)' })).toHaveValue(
      1024,
    );
    expect(screen.getByRole('switch', { name: 'Respaldos automáticos' })).toBeChecked();
    expect(screen.queryByText('/private/internal-repo')).not.toBeInTheDocument();
    expect(screen.queryByText('Hacer reset')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Importar|Exportar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeDisabled();
    expect(
      screen.getByText('Se conserva el respaldo válido más reciente de este repositorio.'),
    ).toBeVisible();
    expect(screen.queryByRole('switch', { name: 'Depuración automática' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  });

  it('clears unused cache only after confirmation and keeps emergency backups restorable', async () => {
    const user = userEvent.setup();
    const { recovery, backup } = setup();
    await user.click(await screen.findByRole('button', { name: 'Limpiar caché…' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Se conservarán los datos de recuperación activos y los respaldos de emergencia',
    );
    expect(recovery.cleanup).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar caché' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(recovery.cleanup).toHaveBeenCalledOnce();
    expect(backup.restore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
    expect(await screen.findByText('Se liberaron 1 MiB.')).toBeVisible();
  });

  it('a cache cleanup refusal keeps the confirmation open and describes the protected data', async () => {
    const user = userEvent.setup();
    setup({
      recovery: {
        cleanup: vi.fn(() => Promise.reject(new RecoveryOperationError('recovery.protected'))),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Limpiar caché…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar caché' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/operación|historial/);
    expect(dialog).toBeVisible();
  });

  it('only restores the selected complete point after reviewing date and new folder requirement', async () => {
    const user = userEvent.setup();
    const { backup, recovery } = setup();
    await user.click(
      await screen.findByRole('button', { name: 'Restaurar en una carpeta nueva…' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('example');
    expect(dialog).toHaveTextContent('en una carpeta nueva');
    expect(dialog).toHaveTextContent('El repositorio original se conservará');
    expect(backup.restore).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Elegir carpeta y restaurar' }));
    await waitFor(() => expect(backup.restore).toHaveBeenCalledWith('complete-point'));
    expect(await screen.findByText('Repositorio restaurado en /restored/example.')).toBeVisible();
    expect(recovery.cleanup).not.toHaveBeenCalled();
  });

  it('canceling review does not restore and returns focus to the selected point', async () => {
    const user = userEvent.setup();
    const { backup } = setup();
    const button = await screen.findByRole('button', { name: 'Restaurar en una carpeta nueva…' });
    await user.click(button);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(backup.restore).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('canceling the native folder selector is not reported as an error or successful restore', async () => {
    const user = userEvent.setup();
    setup({ backup: { restore: vi.fn(() => Promise.resolve(null)) } });
    await user.click(
      await screen.findByRole('button', { name: 'Restaurar en una carpeta nueva…' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Elegir carpeta y restaurar',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Repositorio restaurado en/)).not.toBeInTheDocument();
  });

  it('an invalid destination keeps the confirmation and displays native error detail without claiming success', async () => {
    const user = userEvent.setup();
    setup({
      backup: {
        restore: vi.fn(() =>
          Promise.reject(new BackupOperationError('backup.destination', 'Destination exists')),
        ),
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Restaurar en una carpeta nueva…' }),
    );
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Elegir carpeta y restaurar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se pueden sobrescribir archivos existentes',
    );
    await user.click(within(dialog).getByText('Detalles técnicos'));
    expect(within(dialog).getByText('Destination exists')).toBeVisible();
    expect(screen.queryByText(/Repositorio restaurado en/)).not.toBeInTheDocument();
  });

  it('failed backup with no completed point never exposes a restore action', async () => {
    setup({
      backup: {
        read: vi.fn(() =>
          Promise.resolve({
            ...catalog,
            repositories: catalog.repositories.map((repo) => ({
              ...repo,
              status: 'overBudget' as const,
              lastCompletedAt: null,
              points: [],
            })),
          }),
        ),
      },
    });
    expect(
      await screen.findByText('Sin nuevo respaldo: se alcanzó el límite global de espacio'),
    ).toBeVisible();
    expect(
      screen.getByText('Este repositorio todavía no tiene un respaldo terminado.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Restaurar en una carpeta nueva…' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Último respaldo terminado:/)).not.toBeInTheDocument();
  });

  it('saving the global budget preserves other preferences and stopping automatic copies keeps existing points', async () => {
    const user = userEvent.setup();
    const { ports } = setup();
    await screen.findByText('/deleted/example');
    const limit = screen.getByRole('spinbutton', { name: 'Límite global de espacio (MiB)' });
    await user.clear(limit);
    await user.type(limit, '512');
    await user.tab();
    await waitFor(async () => expect((await ports.settings.read()).backup.maxMiB).toBe(512));
    await user.click(screen.getByRole('switch', { name: 'Respaldos automáticos' }));
    await waitFor(async () => expect((await ports.settings.read()).backup.enabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
    const settings = await ports.settings.read();
    expect(settings.recovery).toEqual(DEFAULT_SETTINGS.recovery);
    expect(settings.appearance).toEqual(DEFAULT_SETTINGS.appearance);
  });

  it('rejects an invalid budget and rolls back an enable preference if persistence fails', async () => {
    const user = userEvent.setup();
    const { ports } = setup();
    await screen.findByText('/deleted/example');
    const limit = screen.getByRole('spinbutton', { name: 'Límite global de espacio (MiB)' });
    await user.clear(limit);
    await user.type(limit, '0');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 y 1048576');
    expect((await ports.settings.read()).backup.maxMiB).toBe(1024);
    vi.spyOn(ports.settings, 'patch').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('switch', { name: 'Respaldos automáticos' }));
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
    expect(screen.getByText('No se pudo completar la acción de respaldo.')).toBeVisible();
  });

  it('does not discard saved settings if only rereading backup status fails', async () => {
    const user = userEvent.setup();
    const read = vi.fn(() => Promise.resolve(catalog));
    const { ports } = setup({ backup: { read } });
    await screen.findByText('/deleted/example');
    read.mockRejectedValueOnce(new Error('read failed'));
    await user.click(screen.getByRole('switch', { name: 'Respaldos automáticos' }));
    expect(await screen.findByText('No se pudo completar la acción de respaldo.')).toBeVisible();
    expect((await ports.settings.read()).backup.enabled).toBe(false);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('ignores a late initial read after leaving the section', async () => {
    let resolve!: (value: BackupSnapshot) => void;
    const pending = new Promise<BackupSnapshot>((complete) => {
      resolve = complete;
    });
    const { unmount } = setup({ backup: { read: vi.fn(() => pending) } });
    unmount();
    await act(async () => {
      resolve(catalog);
      await pending;
    });
    expect(screen.queryByText('/deleted/example')).not.toBeInTheDocument();
  });

  it('explains unreadable settings and uncertain cache without presenting internal restore points', async () => {
    setup({
      recovery: {
        read: vi.fn(() =>
          Promise.resolve({ ...cache, configurationWarning: true, uncertainBuckets: 1 }),
        ),
      },
    });
    expect(await screen.findByText(/depuración automática está suspendida/)).toBeVisible();
    expect(screen.getByText(/no pudieron verificarse|no se pudieron verificar/i)).toBeVisible();
    expect(screen.queryByText('/private/internal-repo')).not.toBeInTheDocument();
  });

  it('refreshing storage does not schedule backups or restore anything', async () => {
    const { backup } = setup();
    await screen.findByText('/deleted/example');
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(backup.read).toHaveBeenCalledTimes(2));
    expect(backup.schedule).not.toHaveBeenCalled();
    expect(backup.restore).not.toHaveBeenCalled();
  });

  it('an unavailable backup store is not mislabeled as an empty catalog and cache remains independent', async () => {
    const user = userEvent.setup();
    const { recovery } = setup({
      backup: {
        read: vi.fn(() => Promise.reject(new BackupOperationError('backup.unavailable'))),
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El almacenamiento de respaldos no está disponible o está ocupado.',
    );
    expect(screen.queryByText('Todavía no hay respaldos terminados.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpiar caché…' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Limpiar caché' }),
    );
    await waitFor(() => expect(recovery.cleanup).toHaveBeenCalledOnce());
    expect(await screen.findByText('Se liberaron 1 MiB.')).toBeVisible();
  });

  it('queued background work updates completed restore points without any restore or scheduling action', async () => {
    vi.useFakeTimers();
    try {
      const queued: BackupSnapshot = {
        ...catalog,
        repositories: catalog.repositories.map((repo) => ({
          ...repo,
          status: 'queued',
          points: [],
          lastCompletedAt: null,
        })),
      };
      const read = vi.fn().mockResolvedValueOnce(queued).mockResolvedValue(catalog);
      const { backup } = setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText('Respaldo en cola')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Restaurar en una carpeta nueva…' }),
      ).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText('Respaldo terminado')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
      expect(backup.schedule).not.toHaveBeenCalled();
      expect(backup.restore).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late polling response cannot replace the catalog read after changing backup preferences', async () => {
    vi.useFakeTimers();
    try {
      const queued: BackupSnapshot = {
        ...catalog,
        repositories: catalog.repositories.map((repo) => ({ ...repo, status: 'queued' })),
      };
      let resolve!: (value: BackupSnapshot) => void;
      const delayed = new Promise<BackupSnapshot>((complete) => {
        resolve = complete;
      });
      const read = vi
        .fn()
        .mockResolvedValueOnce(queued)
        .mockResolvedValueOnce(delayed)
        .mockResolvedValue(catalog);
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      fireEvent.click(screen.getByRole('switch', { name: 'Respaldos automáticos' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText('Respaldo terminado')).toBeVisible();
      await act(async () => {
        resolve(queued);
        await delayed;
      });
      expect(screen.queryByText('Respaldo en cola')).not.toBeInTheDocument();
      expect(screen.getByText('Respaldo terminado')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['idle', 'tooSoon'] as const)(
    'observes a scheduled native job from %s while the section stays open',
    async (status) => {
      vi.useFakeTimers();
      try {
        const idle: BackupSnapshot = {
          ...catalog,
          repositories: catalog.repositories.map((repo) => ({ ...repo, status })),
        };
        const running: BackupSnapshot = {
          ...catalog,
          repositories: catalog.repositories.map((repo) => ({ ...repo, status: 'running' })),
        };
        const read = vi
          .fn()
          .mockResolvedValueOnce(idle)
          .mockResolvedValueOnce(running)
          .mockResolvedValue(catalog);
        const { backup } = setup({ backup: { read } });
        await act(async () => {
          await Promise.resolve();
        });
        expect(read).toHaveBeenCalledOnce();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(29999);
        });
        expect(read).toHaveBeenCalledOnce();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(screen.getByText('Guardando respaldo…')).toBeVisible();
        expect(read).toHaveBeenCalledTimes(2);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4999);
        });
        expect(read).toHaveBeenCalledTimes(2);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(screen.getByText('Respaldo terminado')).toBeVisible();
        expect(read).toHaveBeenCalledTimes(3);
        expect(backup.schedule).not.toHaveBeenCalled();
        expect(backup.restore).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('stops idle polling when automatic backups are disabled or the section is closed', async () => {
    vi.useFakeTimers();
    try {
      initSettingsData({
        ...DEFAULT_SETTINGS,
        backup: { ...DEFAULT_SETTINGS.backup, enabled: false },
      });
      const { backup, unmount } = setup();
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(backup.read).toHaveBeenCalledOnce();
      act(() => {
        initSettingsData(DEFAULT_SETTINGS);
      });
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(backup.read).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a limit below protected usage without saving it or deleting copies', async () => {
    const user = userEvent.setup();
    const read = vi.fn(() => Promise.resolve(catalog));
    const { backup, ports } = setup({ backup: { read } });
    await screen.findByText('/deleted/example');
    expect(screen.queryByText(/respaldos guardados superan/i)).not.toBeInTheDocument();
    const patch = vi.spyOn(ports.settings, 'patch');
    const limit = screen.getByRole('spinbutton', { name: 'Límite global de espacio (MiB)' });
    await user.clear(limit);
    await user.type(limit, '1');
    await user.tab();
    const dialog = await screen.findByRole('dialog', { name: 'Revisar límite de respaldos' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('al menos 2 MiB');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('no garantiza espacio');
    expect(dialog).toHaveTextContent(
      'No se puede aplicar el límite de 1 MiB. Se conservará el límite actual.',
    );
    expect(within(dialog).queryByText('Respaldos que se eliminarán')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Espacio después de aplicar')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Aplicar límite' }),
    ).not.toBeInTheDocument();
    expect((await ports.settings.read()).backup.maxMiB).toBe(1024);
    expect(patch).not.toHaveBeenCalled();
    expect(backup.delete).not.toHaveBeenCalled();
    expect(backup.prune).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(limit).toHaveValue(1024);
    expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
    expect(backup.restore).not.toHaveBeenCalled();
    expect(backup.schedule).not.toHaveBeenCalled();
  });

  it('warns about damaged points and paused automatic captures while healthy points stay restorable', async () => {
    const user = userEvent.setup();
    const { backup } = setup({
      backup: {
        read: vi.fn(() => Promise.resolve({ ...catalog, corruptPoints: 2 })),
      },
    });
    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Se detectaron datos de respaldo dañados.');
    expect(warning).toHaveTextContent('Los puntos sanos siguen disponibles para restaurar.');
    expect(warning).toHaveTextContent('suspendidas');
    expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Elegir carpeta y restaurar',
      }),
    );
    await waitFor(() => expect(backup.restore).toHaveBeenCalledWith('complete-point'));
  });

  it('protects every point tied for newest, independent of catalog order', async () => {
    const newest = catalog.repositories[0]!.points[0]!;
    setup({
      backup: {
        read: vi.fn(() =>
          Promise.resolve({
            ...olderCatalog,
            repositories: olderCatalog.repositories.map((repository) => ({
              ...repository,
              points: [{ ...newest, id: 'newest-tie' }, ...repository.points],
            })),
          }),
        ),
      },
    });
    await screen.findByText('/deleted/example');
    const buttons = screen.getAllByRole('button', { name: 'Eliminar…' });
    expect(buttons).toHaveLength(3);
    expect(buttons.filter((button) => button.hasAttribute('disabled'))).toHaveLength(2);
    expect(olderDeleteButton()).toBeEnabled();
    expect(
      screen.getAllByText('Se conserva el respaldo válido más reciente de este repositorio.'),
    ).toHaveLength(2);
  });

  it('deletes only the selected older copy after confirmation and uses the returned catalog', async () => {
    const user = userEvent.setup();
    const { backup, recovery } = setup({
      backup: { read: vi.fn(() => Promise.resolve(olderCatalog)) },
    });
    await screen.findByText('/deleted/example');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(3 * 1048576));
    await user.click(olderDeleteButton());
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('example');
    expect(dialog).toHaveTextContent(new Date(1727000000000).toLocaleString('es-MX'));
    expect(dialog).toHaveTextContent(/permanente/);
    expect(dialog).toHaveTextContent(/original/);
    expect(dialog).toHaveTextContent(/más reciente/);
    expect(backup.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Eliminar respaldo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(backup.delete).toHaveBeenCalledExactlyOnceWith('older-point');
    expect(backup.read).toHaveBeenCalledOnce();
    expect(backup.restore).not.toHaveBeenCalled();
    expect(recovery.cleanup).not.toHaveBeenCalled();
    expect(screen.getByText('Respaldo eliminado.')).toBeVisible();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(catalog.totalBytes));
    expect(screen.getAllByRole('button', { name: 'Eliminar…' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Eliminar…' })).toBeDisabled();
  });

  it('canceling deletion preserves the copy and returns focus without writing', async () => {
    const user = userEvent.setup();
    const { backup } = setup({ backup: { read: vi.fn(() => Promise.resolve(olderCatalog)) } });
    await screen.findByText('/deleted/example');
    const button = olderDeleteButton();
    await user.click(button);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(backup.delete).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(3 * 1048576));
  });

  it('keeps a failed deletion open with its error and retries the same selected copy', async () => {
    const user = userEvent.setup();
    const remove = vi
      .fn<BackupPort['delete']>()
      .mockRejectedValueOnce(new BackupOperationError('backup.unavailable', 'Store is locked'))
      .mockResolvedValueOnce(catalog);
    setup({
      backup: { read: vi.fn(() => Promise.resolve(olderCatalog)), delete: remove },
    });
    await screen.findByText('/deleted/example');
    await user.click(olderDeleteButton());
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar respaldo' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'El almacenamiento de respaldos no está disponible o está ocupado.',
    );
    expect(within(dialog).getByRole('button', { name: 'Eliminar respaldo' })).toBeEnabled();
    expect(screen.queryByText('Respaldo eliminado.')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar respaldo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, 'older-point');
    expect(remove).toHaveBeenNthCalledWith(2, 'older-point');
  });

  it.each([
    { status: 'running' as const, corruptPoints: 0, disabled: false },
    { status: 'completed' as const, corruptPoints: 1, disabled: true },
    { status: 'queued' as const, corruptPoints: 0, disabled: false },
    { status: 'busy' as const, corruptPoints: 0, disabled: false },
  ])('respects store state before deletion: %j', async ({ status, corruptPoints, disabled }) => {
    setup({
      backup: {
        read: vi.fn(() =>
          Promise.resolve({
            ...olderCatalog,
            corruptPoints,
            repositories: olderCatalog.repositories.map((repository) => ({
              ...repository,
              status,
            })),
          }),
        ),
      },
    });
    await screen.findByText('/deleted/example');
    if (disabled) expect(olderDeleteButton()).toBeDisabled();
    else expect(olderDeleteButton()).toBeEnabled();
    if (disabled) expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeDisabled();
    else expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeEnabled();
  });

  it('does not duplicate a pending deletion and ignores an older polling result afterward', async () => {
    vi.useFakeTimers();
    try {
      let resolveRead!: (value: BackupSnapshot) => void;
      const pendingRead = new Promise<BackupSnapshot>((resolve) => (resolveRead = resolve));
      let resolveDelete!: (value: BackupSnapshot) => void;
      const pendingDelete = new Promise<BackupSnapshot>((resolve) => (resolveDelete = resolve));
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockReturnValue(pendingRead);
      const remove = vi.fn<BackupPort['delete']>().mockReturnValue(pendingDelete);
      setup({ backup: { read, delete: remove } });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(read).toHaveBeenCalledTimes(2);
      fireEvent.click(olderDeleteButton());
      const confirm = within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Eliminar respaldo',
      });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(remove).toHaveBeenCalledExactlyOnceWith('older-point');
      expect(
        within(screen.getByRole('dialog')).getByRole('progressbar', {
          name: /Verificando y eliminando/,
        }),
      ).not.toHaveAttribute('aria-valuenow');
      expect(confirm).toBeDisabled();
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
      ).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(read).toHaveBeenCalledTimes(2);
      await act(async () => {
        resolveDelete(catalog);
        await pendingDelete;
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await act(async () => {
        resolveRead(olderCatalog);
        await pendingRead;
      });
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(catalog.totalBytes),
      );
      expect(screen.getAllByRole('button', { name: 'Eliminar…' })).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechecks protection when polling makes the selected point the newest before confirmation', async () => {
    vi.useFakeTimers();
    try {
      const protectedCatalog: BackupSnapshot = {
        ...olderCatalog,
        repositories: olderCatalog.repositories.map((repository) => ({
          ...repository,
          points: repository.points.filter((point) => point.id === 'older-point'),
        })),
      };
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockResolvedValue(protectedCatalog);
      const { backup } = setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(olderDeleteButton());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar respaldo' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'El respaldo válido más reciente de cada repositorio está protegido y no se puede eliminar.',
      );
      expect(backup.delete).not.toHaveBeenCalled();
      expect(dialog).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report late deletion results after leaving the section', async () => {
    const user = userEvent.setup();
    let resolveDelete!: (value: BackupSnapshot) => void;
    const pendingDelete = new Promise<BackupSnapshot>((resolve) => (resolveDelete = resolve));
    const { unmount } = setup({
      backup: {
        read: vi.fn(() => Promise.resolve(olderCatalog)),
        delete: vi.fn(() => pendingDelete),
      },
    });
    await screen.findByText('/deleted/example');
    await user.click(olderDeleteButton());
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar respaldo' }),
    );
    unmount();
    await act(async () => {
      resolveDelete(catalog);
      await pendingDelete;
    });
    expect(screen.queryByText('Respaldo eliminado.')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it.each([0, 0.5, 1, 1.75])(
    'shows actual shared usage at %s of the configured limit and bounds the visual meter',
    async (ratio) => {
      initSettingsData({ ...DEFAULT_SETTINGS, backup: { ...DEFAULT_SETTINGS.backup, maxMiB: 4 } });
      const limit = 4 * 1048576;
      const totalBytes = ratio * limit;
      setup({ backup: { read: vi.fn(() => Promise.resolve({ ...catalog, totalBytes })) } });
      await screen.findByText('/deleted/example');
      const meter = screen.getByRole('meter', { name: 'Espacio ocupado por respaldos' });
      const percent = new Intl.NumberFormat('es-MX', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(ratio);
      expect(meter).toHaveAttribute('aria-valuemin', '0');
      expect(meter).toHaveAttribute('aria-valuemax', String(limit));
      expect(meter).toHaveAttribute('aria-valuenow', String(Math.min(totalBytes, limit)));
      expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining(percent));
      expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining(`${ratio * 4} MiB`));
      expect(screen.getByText(`${percent} usado`)).toBeVisible();
      expect(meter.firstElementChild).toHaveStyle({ inlineSize: `${Math.min(ratio, 1) * 100}%` });
      if (ratio > 1) expect(screen.getByText(/respaldos guardados superan/i)).toBeVisible();
      else expect(screen.queryByText(/respaldos guardados superan/i)).not.toBeInTheDocument();

      act(() => initSettingsData(DEFAULT_SETTINGS));
      expect(meter).toHaveAttribute('aria-valuemax', String(1024 * 1048576));
      expect(meter).toHaveAttribute('aria-valuenow', String(totalBytes));
      expect(screen.queryByText(/respaldos guardados superan/i)).not.toBeInTheDocument();
    },
  );

  it('shows initial review progress until the native catalog finishes, even with automatic backups disabled', async () => {
    vi.useFakeTimers();
    try {
      initSettingsData({
        ...DEFAULT_SETTINGS,
        backup: { ...DEFAULT_SETTINGS.backup, enabled: false },
      });
      let complete!: (value: BackupSnapshot) => void;
      const delayed = new Promise<BackupSnapshot>((resolve) => (complete = resolve));
      const read = vi
        .fn<BackupPort['read']>()
        .mockReturnValueOnce(delayed)
        .mockResolvedValue(catalog);
      setup({ backup: { read } });
      expect(
        screen.getByRole('progressbar', { name: 'Revisando respaldos disponibles…' }),
      ).not.toHaveAttribute('aria-valuenow');
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(screen.queryByText('Todavía no hay respaldos terminados.')).not.toBeInTheDocument();
      await act(async () => {
        complete({ ...catalog, scanning: true, totalBytes: 0, repositories: [] });
        await delayed;
      });
      expect(
        screen.getByRole('progressbar', { name: 'Revisando respaldos disponibles…' }),
      ).toBeVisible();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(screen.queryByText('Todavía no hay respaldos terminados.')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(999);
      });
      expect(read).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(catalog.totalBytes),
      );
      expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not present empty repositories as final while scanning and shows an empty catalog only after success', async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce({
          ...catalog,
          scanning: true,
          totalBytes: 0,
          repositories: catalog.repositories.map((repository) => ({
            ...repository,
            points: [],
            lastCompletedAt: null,
          })),
        })
        .mockResolvedValue({ ...catalog, repositories: [], totalBytes: 0 });
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.queryByText('Este repositorio todavía no tiene un respaldo terminado.'),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByText('Todavía no hay respaldos terminados.')).toBeVisible();
      expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends failed initial scanning without claiming that the provisional empty catalog is complete', async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce({ ...catalog, scanning: true, totalBytes: 0, repositories: [] })
        .mockRejectedValue(new BackupOperationError('backup.unavailable', 'Unreadable catalog'));
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'El almacenamiento de respaldos no está disponible o está ocupado.',
      );
      expect(screen.queryByText('Todavía no hay respaldos terminados.')).not.toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides a previous empty result while an explicit refresh is pending', async () => {
    const user = userEvent.setup();
    const empty: BackupSnapshot = { ...catalog, totalBytes: 0, repositories: [] };
    let complete!: (value: BackupSnapshot) => void;
    const pending = new Promise<BackupSnapshot>((resolve) => (complete = resolve));
    const read = vi.fn<BackupPort['read']>().mockResolvedValueOnce(empty).mockReturnValue(pending);
    setup({ backup: { read } });
    expect(await screen.findByText('Todavía no hay respaldos terminados.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(
      screen.getByRole('progressbar', { name: 'Revisando respaldos disponibles…' }),
    ).toBeVisible();
    expect(screen.queryByText('Todavía no hay respaldos terminados.')).not.toBeInTheDocument();
    await act(async () => {
      complete(empty);
      await pending;
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Todavía no hay respaldos terminados.')).toBeVisible();
  });

  it('keeps idle polls silent without hiding useful data or disabling controls, including on failure', async () => {
    vi.useFakeTimers();
    try {
      let rejectRead!: (reason: unknown) => void;
      const pending = new Promise<BackupSnapshot>((_resolve, reject) => (rejectRead = reject));
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockReturnValue(pending);
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(olderCatalog.totalBytes),
      );
      expect(olderDeleteButton()).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeEnabled();
      expect(screen.getByRole('switch', { name: 'Respaldos automáticos' })).toBeEnabled();
      expect(
        screen
          .getAllByRole('button', { name: 'Restaurar en una carpeta nueva…' })
          .every((button) => !button.hasAttribute('disabled')),
      ).toBe(true);
      await act(async () => {
        rejectRead(new BackupOperationError('backup.unavailable'));
        await pending.catch(() => undefined);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeVisible();
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(olderCatalog.totalBytes),
      );
      expect(olderDeleteButton()).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows explicit refresh progress without blocking a confirmed catalog during its native scan', async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockResolvedValueOnce({ ...olderCatalog, scanning: true })
        .mockRejectedValue(new BackupOperationError('backup.unavailable'));
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.getByRole('progressbar', { name: 'Revisando respaldos disponibles…' }),
      ).toBeVisible();
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(olderCatalog.totalBytes),
      );
      expect(olderDeleteButton()).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeEnabled();
      expect(
        screen
          .getAllByRole('button', { name: 'Restaurar en una carpeta nueva…' })
          .every((button) => !button.hasAttribute('disabled')),
      ).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeVisible();
      expect(olderDeleteButton()).toBeEnabled();
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(olderCatalog.totalBytes),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('prunes only after reviewing the global unprotected count, preserving tied latest points', async () => {
    const user = userEvent.setup();
    const latest = catalog.repositories[0]!.points[0]!;
    const multiple: BackupSnapshot = {
      ...olderCatalog,
      repositories: [
        ...olderCatalog.repositories,
        {
          ...olderCatalog.repositories[0]!,
          id: 'second',
          name: 'second',
          repository: '/deleted/second',
          points: [
            { ...latest, id: 'second-latest' },
            { ...latest, id: 'second-tie' },
            { ...latest, id: 'second-old', createdAt: latest.createdAt - 1 },
          ],
        },
      ],
    };
    const pruned: BackupSnapshot = {
      ...multiple,
      totalBytes: catalog.totalBytes,
      repositories: multiple.repositories.map((repository) => ({
        ...repository,
        points: repository.points.filter((point) => point.createdAt === latest.createdAt),
      })),
    };
    const { backup, recovery } = setup({
      backup: {
        read: vi.fn(() => Promise.resolve(multiple)),
        prune: vi.fn(() => Promise.resolve(pruned)),
      },
    });
    await screen.findByText('/deleted/second');
    await user.click(screen.getByRole('button', { name: 'Depurar respaldos…' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('2 respaldos no protegidos');
    expect(dialog).toHaveTextContent('más reciente de cada repositorio');
    expect(backup.prune).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar los no protegidos' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(backup.prune).toHaveBeenCalledExactlyOnceWith();
    expect(backup.delete).not.toHaveBeenCalled();
    expect(backup.restore).not.toHaveBeenCalled();
    expect(recovery.cleanup).not.toHaveBeenCalled();
    expect(backup.read).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button', { name: 'Eliminar…' })).toHaveLength(3);
    expect(
      screen
        .getAllByRole('button', { name: 'Eliminar…' })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeDisabled();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(pruned.totalBytes));
    expect(
      screen.getByText('Depuración terminada. Se conservaron los respaldos protegidos.'),
    ).toBeVisible();
  });

  it('canceling a prune does not write and a failed prune remains open for retry', async () => {
    const user = userEvent.setup();
    const prune = vi
      .fn<BackupPort['prune']>()
      .mockRejectedValueOnce(new BackupOperationError('backup.unavailable'))
      .mockResolvedValue(catalog);
    setup({ backup: { read: vi.fn(() => Promise.resolve(olderCatalog)), prune } });
    await screen.findByText('/deleted/example');
    const button = screen.getByRole('button', { name: 'Depurar respaldos…' });
    await user.click(button);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(prune).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    await user.click(button);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar los no protegidos' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'El almacenamiento de respaldos no está disponible o está ocupado.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar los no protegidos' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it('shows prune progress, prevents duplicate writes, and ignores stale polls after the authoritative result', async () => {
    vi.useFakeTimers();
    try {
      let resolveRead!: (value: BackupSnapshot) => void;
      const pendingRead = new Promise<BackupSnapshot>((resolve) => (resolveRead = resolve));
      let resolvePrune!: (value: BackupSnapshot) => void;
      const pendingPrune = new Promise<BackupSnapshot>((resolve) => (resolvePrune = resolve));
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockReturnValue(pendingRead);
      const prune = vi.fn<BackupPort['prune']>().mockReturnValue(pendingPrune);
      setup({ backup: { read, prune } });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Depurar respaldos…' }));
      const dialog = screen.getByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: 'Eliminar los no protegidos' });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(prune).toHaveBeenCalledOnce();
      expect(
        within(dialog).getByRole('progressbar', { name: /Verificando y depurando/ }),
      ).not.toHaveAttribute('aria-valuenow');
      expect(
        screen.queryByRole('progressbar', { name: 'Revisando respaldos disponibles…' }),
      ).not.toBeInTheDocument();
      expect(confirm).toBeDisabled();
      await act(async () => {
        resolvePrune(catalog);
        await pendingPrune;
      });
      await act(async () => {
        resolveRead(olderCatalog);
        await pendingRead;
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeDisabled();
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(catalog.totalBytes),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechecks the prune count when only protected points remain before confirmation', async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockResolvedValue(catalog);
      const { backup } = setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Depurar respaldos…' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('1 respaldos no protegidos');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(dialog).toHaveTextContent('0 respaldos no protegidos');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar los no protegidos' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'El respaldo válido más reciente de cada repositorio está protegido y no se puede eliminar.',
      );
      expect(backup.prune).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['prune', 'delete', 'restore'] as const)(
    'allows a confirmed %s operation while a background scan is refreshing a valid catalog',
    async (operation) => {
      vi.useFakeTimers();
      try {
        const read = vi
          .fn<BackupPort['read']>()
          .mockResolvedValueOnce(olderCatalog)
          .mockResolvedValue({ ...olderCatalog, scanning: true });
        const { backup } = setup({ backup: { read } });
        await act(async () => {
          await Promise.resolve();
        });
        if (operation === 'prune')
          fireEvent.click(screen.getByRole('button', { name: 'Depurar respaldos…' }));
        else if (operation === 'delete') fireEvent.click(olderDeleteButton());
        else
          fireEvent.click(
            screen.getAllByRole('button', { name: 'Restaurar en una carpeta nueva…' })[0]!,
          );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30000);
        });
        const dialog = screen.getByRole('dialog');
        fireEvent.click(
          within(dialog).getByRole('button', {
            name:
              operation === 'prune'
                ? 'Eliminar los no protegidos'
                : operation === 'delete'
                  ? 'Eliminar respaldo'
                  : 'Elegir carpeta y restaurar',
          }),
        );
        expect(backup[operation]).toHaveBeenCalledOnce();
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('keeps individual deletion and pruning available across running repositories and repeated background scans', async () => {
    vi.useFakeTimers();
    try {
      const repositoryA = {
        ...catalog.repositories[0]!,
        id: 'active-repository',
        name: 'Active repository',
        repository: '/active/repository',
        status: 'running' as const,
        points: [{ ...catalog.repositories[0]!.points[0]!, id: 'active-previous' }],
      };
      const ready: BackupSnapshot = {
        ...olderCatalog,
        repositories: [repositoryA, ...olderCatalog.repositories],
      };
      const scanning: BackupSnapshot = {
        ...ready,
        scanning: true,
        totalBytes: 4 * 1048576,
        repositories: [
          {
            ...repositoryA,
            status: 'completed',
            points: [
              ...repositoryA.points,
              { ...repositoryA.points[0]!, id: 'newly-published', createdAt: 1729000000000 },
            ],
          },
          ...olderCatalog.repositories,
        ],
      };
      let resolveRead!: (value: BackupSnapshot) => void;
      const pending = new Promise<BackupSnapshot>((resolve) => (resolveRead = resolve));
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(ready)
        .mockReturnValueOnce(pending)
        .mockResolvedValueOnce(scanning)
        .mockResolvedValue({ ...scanning, scanning: false });
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      const expectAvailable = (unprotected: number) => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(olderDeleteButton()).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeEnabled();
        expect(
          screen
            .getAllByRole('button', { name: 'Eliminar…' })
            .filter((button) => !button.hasAttribute('disabled')),
        ).toHaveLength(unprotected);
      };
      expectAvailable(1);
      expect(screen.getByText('Guardando respaldo…')).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(read).toHaveBeenCalledTimes(2);
      expectAvailable(1);
      await act(async () => {
        resolveRead(scanning);
        await pending;
      });
      expectAvailable(2);
      expect(screen.queryByText('Guardando respaldo…')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Eliminar…' })).toHaveLength(4);
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(scanning.totalBytes),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(read).toHaveBeenCalledTimes(3);
      expectAvailable(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(read).toHaveBeenCalledTimes(4);
      expectAvailable(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles a pending poll after an external policy change without leaking its pending request', async () => {
    vi.useFakeTimers();
    try {
      let resolveRead!: (value: BackupSnapshot) => void;
      const pending = new Promise<BackupSnapshot>((resolve) => (resolveRead = resolve));
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce(olderCatalog)
        .mockReturnValueOnce(pending)
        .mockResolvedValue(catalog);
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(read).toHaveBeenCalledTimes(2);
      act(() =>
        initSettingsData({
          ...DEFAULT_SETTINGS,
          backup: { ...DEFAULT_SETTINGS.backup, enabled: false },
        }),
      );
      await act(async () => {
        resolveRead({ ...olderCatalog, scanning: true, totalBytes: 4 * 1048576 });
        await pending;
      });
      expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(4 * 1048576));
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(olderDeleteButton()).toBeEnabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(read).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuenow',
        String(catalog.totalBytes),
      );
      act(() => initSettingsData(DEFAULT_SETTINGS));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(read).toHaveBeenCalledTimes(4);
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the first completed catalog before enabling actions even when a scanning snapshot contains points', async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn<BackupPort['read']>()
        .mockResolvedValueOnce({ ...olderCatalog, scanning: true })
        .mockResolvedValue(olderCatalog);
      setup({ backup: { read } });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.getByRole('progressbar', { name: 'Revisando respaldos disponibles…' }),
      ).toBeVisible();
      expect(olderDeleteButton()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeDisabled();
      expect(
        screen
          .getAllByRole('button', { name: 'Restaurar en una carpeta nueva…' })
          .every((button) => button.hasAttribute('disabled')),
      ).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(olderDeleteButton()).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Depurar respaldos…' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Backup space limit review', () => {
  async function changeLimit(value: number, keyboard = false) {
    const user = userEvent.setup();
    const input = screen.getByRole('spinbutton', { name: 'Límite global de espacio (MiB)' });
    await user.clear(input);
    await user.type(input, String(value));
    if (keyboard) await user.keyboard('{Enter}');
    else await user.tab();
    return { user, input };
  }

  it('reviews exact shared usage and cancellation keeps the original policy and every point', async () => {
    const plan = limitPlan(2, { currentBytes: olderCatalog.totalBytes, deleteCount: 1 });
    const { ports, backup } = setup({
      backup: {
        read: vi.fn(() => Promise.resolve(olderCatalog)),
        previewLimit: vi.fn(() => Promise.resolve(plan)),
      },
    });
    const patch = vi.spyOn(ports.settings, 'patch');
    await screen.findByText('/deleted/example');
    const { user, input } = await changeLimit(2, true);
    const dialog = await screen.findByRole('dialog', { name: 'Revisar límite de respaldos' });
    expect(dialog).toHaveTextContent('Nuevo límite: 2 MiB');
    expect(dialog).toHaveTextContent('Espacio ocupado3 MiB');
    expect(dialog).toHaveTextContent('Respaldos que se eliminarán1');
    expect(dialog).toHaveTextContent('Espacio después de aplicar2 MiB');
    expect(dialog).toHaveTextContent('últimas copias válidas de cada repositorio');
    expect(backup.previewLimit).toHaveBeenCalledExactlyOnceWith(2);
    expect(patch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(input).toHaveValue(1024);
    expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
    expect(backup.delete).not.toHaveBeenCalled();
    expect(backup.prune).not.toHaveBeenCalled();
    expect(olderDeleteButton()).toBeEnabled();
  });

  it('applies only the confirmed token and refreshes usage from the current catalog', async () => {
    const read = vi
      .fn<BackupPort['read']>()
      .mockResolvedValueOnce(olderCatalog)
      .mockResolvedValue(catalog);
    const plan = limitPlan(2, {
      currentBytes: olderCatalog.totalBytes,
      deleteCount: 1,
      token: 'exact-reviewed-token',
    });
    const { ports, backup } = setup({
      backup: { read, previewLimit: vi.fn(() => Promise.resolve(plan)) },
    });
    const patch = vi.spyOn(ports.settings, 'patch');
    await screen.findByText('/deleted/example');
    const { user, input } = await changeLimit(2);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenCalledExactlyOnceWith(
      { backup: { maxMiB: 2 } },
      { backupLimitToken: 'exact-reviewed-token' },
    );
    expect(backup.read).toHaveBeenCalledTimes(2);
    expect(backup.delete).not.toHaveBeenCalled();
    expect(backup.prune).not.toHaveBeenCalled();
    expect(input).toHaveValue(2);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', String(catalog.totalBytes));
    expect(screen.getAllByRole('button', { name: 'Eliminar…' })).toHaveLength(1);
    expect(await screen.findByText('Límite de respaldos actualizado.')).toBeVisible();
  });

  it('shows progress while preview is pending and Enter plus blur cannot preview or write twice', async () => {
    let resolve!: (value: BackupLimitPlan) => void;
    const previewLimit = vi.fn<BackupPort['previewLimit']>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { ports } = setup({ backup: { previewLimit } });
    const patch = vi.spyOn(ports.settings, 'patch');
    await screen.findByText('/deleted/example');
    const { input } = await changeLimit(512, true);
    expect(screen.getByRole('progressbar', { name: 'Calculando el nuevo límite…' })).toBeVisible();
    expect(input).toBeDisabled();
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(previewLimit).toHaveBeenCalledOnce();
    expect(patch).not.toHaveBeenCalled();
    expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
    await act(async () => {
      resolve(limitPlan(512));
      await Promise.resolve();
    });
    await waitFor(() => expect(input).toHaveValue(512));
    expect(patch).toHaveBeenCalledExactlyOnceWith(
      { backup: { maxMiB: 512 } },
      { backupLimitToken: 'reviewed-limit-512' },
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows applying progress and ignores a second confirmation while persistence is pending', async () => {
    let finish!: () => void;
    const { ports } = setup({
      backup: {
        previewLimit: vi.fn(() => Promise.resolve(limitPlan(2, { deleteCount: 1 }))),
      },
    });
    const patch = vi.spyOn(ports.settings, 'patch').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await screen.findByText('/deleted/example');
    const { user } = await changeLimit(2);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Aplicar límite' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(
      within(dialog).getByRole('progressbar', { name: 'Aplicando el límite de respaldos…' }),
    ).toBeVisible();
    fireEvent.click(confirm);
    expect(patch).toHaveBeenCalledOnce();
    expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getSettingsSnapshot().backup.maxMiB).toBe(2);
  });

  it('recalculates a changed plan and requires a fresh confirmation even if no deletion remains', async () => {
    const previewLimit = vi
      .fn<BackupPort['previewLimit']>()
      .mockResolvedValueOnce(limitPlan(2, { deleteCount: 1, token: 'old' }))
      .mockResolvedValue(limitPlan(2, { deleteCount: 0, token: 'new' }));
    const { ports, backup } = setup({ backup: { previewLimit } });
    const patch = vi
      .spyOn(ports.settings, 'patch')
      .mockRejectedValueOnce(new BackupOperationError('backup.limitChanged'));
    await screen.findByText('/deleted/example');
    const { user, input } = await changeLimit(2);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    await waitFor(() => expect(previewLimit).toHaveBeenCalledTimes(2));
    expect(dialog).toHaveTextContent('Los respaldos cambiaron desde la revisión');
    expect(dialog).toHaveTextContent('Respaldos que se eliminarán0');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(1024);
    expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
    expect(backup.read).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenNthCalledWith(
      2,
      { backup: { maxMiB: 2 } },
      { backupLimitToken: 'new' },
    );
  });

  it('refreshes partial cleanup after a persistence failure and retries only with a new reviewed token', async () => {
    const read = vi
      .fn<BackupPort['read']>()
      .mockResolvedValueOnce(olderCatalog)
      .mockResolvedValue(catalog);
    const previewLimit = vi
      .fn<BackupPort['previewLimit']>()
      .mockResolvedValueOnce(limitPlan(2, { deleteCount: 1, token: 'before-failure' }))
      .mockResolvedValue(limitPlan(2, { token: 'after-failure' }));
    const { ports } = setup({ backup: { read, previewLimit } });
    const patch = vi.spyOn(ports.settings, 'patch').mockRejectedValueOnce(new Error('disk full'));
    await screen.findByText('/deleted/example');
    const { user, input } = await changeLimit(2);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    await waitFor(() => expect(previewLimit).toHaveBeenCalledTimes(2));
    expect(dialog).toHaveTextContent('No se pudo completar la acción de respaldo.');
    expect(screen.getByRole('meter', { hidden: true })).toHaveAttribute(
      'aria-valuenow',
      String(catalog.totalBytes),
    );
    expect(input).toHaveValue(1024);
    expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
    expect(patch).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenNthCalledWith(
      2,
      { backup: { maxMiB: 2 } },
      { backupLimitToken: 'after-failure' },
    );
  });

  it('keeps a failed replan open without reusing its old token', async () => {
    const previewLimit = vi
      .fn<BackupPort['previewLimit']>()
      .mockResolvedValueOnce(limitPlan(2, { deleteCount: 1, token: 'old' }))
      .mockRejectedValueOnce(new BackupOperationError('backup.unavailable'))
      .mockResolvedValue(limitPlan(2, { deleteCount: 1, token: 'refreshed' }));
    const { ports } = setup({ backup: { previewLimit } });
    const patch = vi
      .spyOn(ports.settings, 'patch')
      .mockRejectedValueOnce(new BackupOperationError('backup.limitChanged'));
    await screen.findByText('/deleted/example');
    const { user } = await changeLimit(2);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    const retry = await within(dialog).findByRole('button', { name: 'Volver a revisar' });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    expect(await within(dialog).findByRole('button', { name: 'Aplicar límite' })).toBeEnabled();
    expect(previewLimit).toHaveBeenCalledTimes(3);
    expect(patch).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar límite' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenLastCalledWith(
      { backup: { maxMiB: 2 } },
      { backupLimitToken: 'refreshed' },
    );
  });

  it('does not save a reduction when preview fails and restores the editable value', async () => {
    const { ports } = setup({
      backup: {
        previewLimit: vi.fn(() => Promise.reject(new BackupOperationError('backup.invalid'))),
      },
    });
    const patch = vi.spyOn(ports.settings, 'patch');
    await screen.findByText('/deleted/example');
    const { input } = await changeLimit(512);
    await waitFor(() => expect(input).toHaveValue(1024));
    expect(input).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron verificar');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it.each(['corrupt', 'unavailable'])(
    'can increase the limit with a %s catalog without previewing or deleting',
    async (state) => {
      const read =
        state === 'corrupt'
          ? vi.fn(() => Promise.resolve({ ...catalog, corruptPoints: 2 }))
          : vi.fn(() => Promise.reject(new BackupOperationError('backup.unavailable')));
      const { ports, backup } = setup({ backup: { read } });
      const patch = vi.spyOn(ports.settings, 'patch');
      await waitFor(() => expect(screen.getByRole('spinbutton')).toBeEnabled());
      const { input } = await changeLimit(2048, true);
      await waitFor(() => expect(getSettingsSnapshot().backup.maxMiB).toBe(2048));
      expect(input).toHaveValue(2048);
      expect(backup.previewLimit).not.toHaveBeenCalled();
      expect(patch).toHaveBeenCalledExactlyOnceWith({ backup: { maxMiB: 2048 } });
      expect(backup.delete).not.toHaveBeenCalled();
      expect(backup.prune).not.toHaveBeenCalled();
    },
  );

  it('Escape discards a draft and composed Enter cannot start a review', async () => {
    const { ports, backup } = setup();
    const patch = vi.spyOn(ports.settings, 'patch');
    const user = userEvent.setup();
    await screen.findByText('/deleted/example');
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '512');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(input).toHaveFocus();
    expect(backup.previewLimit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(input).toHaveValue(1024);
    expect(backup.previewLimit).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    await user.click(input);
    await user.tab();
    expect(backup.previewLimit).not.toHaveBeenCalled();
  });

  it('shows the last automatic cleanup without claiming the following backup succeeded', async () => {
    setup({
      backup: {
        read: vi.fn(() =>
          Promise.resolve({
            ...catalog,
            lastAutoPrune: { id: 'automatic-cleanup-1', removedCount: 2, freedBytes: 3 * 1048576 },
            repositories: catalog.repositories.map((repository) => ({
              ...repository,
              status: 'failed' as const,
            })),
          }),
        ),
      },
    });
    expect(
      await screen.findByText(
        'Se liberaron 3 MiB eliminando 2 versiones anteriores para preparar un respaldo. Las últimas copias se conservaron.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Falló el respaldo; el punto anterior se conserva')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restaurar en una carpeta nueva…' })).toBeEnabled();
  });
});

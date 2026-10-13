import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import { BackupOperationError, type BackupSnapshot } from '@core/domain/backup';
import { RecoveryOperationError, type RecoverySnapshot } from '@core/domain/recovery';
import type { BackupPort } from '@core/ports/BackupPort';
import type { RecoveryPort } from '@core/ports/RecoveryPort';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { I18nProvider } from '@i18n/I18nProvider';
import { RecoverySection } from './RecoverySection';
import { initSettingsData } from './useSettingsData';

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
    schedule: vi.fn((_repository: string) => Promise.resolve()),
    restore: vi.fn((_id: string) => Promise.resolve({ path: '/restored/example' })),
    ...backupOverrides,
  } satisfies BackupPort;
  ports.recovery = recovery;
  ports.backup = backup;
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
    expect(
      screen.queryByRole('button', { name: /Importar|Exportar|Eliminar copia/ }),
    ).not.toBeInTheDocument();
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
      'No se pudo acceder al almacenamiento de respaldos',
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

  it('warns when reducing the global budget below protected backup usage and preserves restoration', async () => {
    const user = userEvent.setup();
    const read = vi.fn(() => Promise.resolve(catalog));
    const { backup, ports } = setup({ backup: { read } });
    await screen.findByText('/deleted/example');
    expect(screen.queryByText(/respaldos guardados superan/i)).not.toBeInTheDocument();
    read.mockResolvedValueOnce({ ...catalog, maxBytes: 1048576 });
    const limit = screen.getByRole('spinbutton', { name: 'Límite global de espacio (MiB)' });
    await user.clear(limit);
    await user.type(limit, '1');
    await user.tab();
    expect(await screen.findByText(/respaldos guardados superan/i)).toHaveTextContent(
      /último respaldo válido/i,
    );
    expect((await ports.settings.read()).backup.maxMiB).toBe(1);
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
});

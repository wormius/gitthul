import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

import { getSettingsSnapshot, initSettingsData, useSettingsData } from './useSettingsData';

function mount(flush = vi.fn<SettingsPort['flush']>(() => Promise.resolve())) {
  const ports = selectPorts();
  const patch = vi.fn<SettingsPort['patch']>(() => Promise.resolve());
  ports.settings = { read: () => Promise.resolve(DEFAULT_SETTINGS), patch, flush };
  const log = vi.spyOn(ports.log, 'write');
  const hook = renderHook(() => useSettingsData(), {
    wrapper: ({ children }: PropsWithChildren) => (
      <PortsContext value={ports}>{children}</PortsContext>
    ),
  });
  return { ...hook, patch, flush, log };
}

beforeEach(() => initSettingsData(DEFAULT_SETTINGS));

it('un parche del aviso espera a que su fecha se guarde de inmediato', async () => {
  let finish!: () => void;
  const flush = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const hook = mount(flush);
  let pending!: Promise<void>;
  let settled = false;
  act(() => {
    pending = hook.result.current.patch({ updates: { nextPromptAt: 1_797_120_000_000 } });
    expect(getSettingsSnapshot().updates.nextPromptAt).toBe(1_797_120_000_000);
  });
  void pending.then(() => {
    settled = true;
  });
  await waitFor(() => expect(flush).toHaveBeenCalledOnce());
  expect(settled).toBe(false);
  expect(hook.result.current.settings.updates.nextPromptAt).toBe(1_797_120_000_000);
  expect(hook.patch.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0]!);
  await act(async () => {
    finish();
    await pending;
  });
  expect(settled).toBe(true);
});

it('si falla el vaciado conserva la elección anterior y permite volver a guardarla', async () => {
  const failure = new Error('disk full');
  const flush = vi
    .fn<SettingsPort['flush']>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(undefined);
  const hook = mount(flush);
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.patch({ updates: { promptDismissed: true } });
  });
  await act(async () => {
    await expect(pending).rejects.toBe(failure);
  });
  expect(hook.result.current.settings.updates).toEqual(DEFAULT_SETTINGS.updates);
  expect(getSettingsSnapshot().updates).toEqual(DEFAULT_SETTINGS.updates);
  expect(hook.log).toHaveBeenCalledWith(
    'error',
    'settings',
    'No se pudo guardar el ajuste',
    String(failure),
  );
  await act(async () => {
    await hook.result.current.patch({ updates: { promptDismissed: true, nextPromptAt: 0 } });
  });
  expect(flush).toHaveBeenCalledTimes(2);
  expect(hook.result.current.settings.updates).toEqual({
    ...DEFAULT_SETTINGS.updates,
    promptDismissed: true,
  });
});

it('un fallo del parche no vacía ni conserva una preferencia que no pudo guardarse', async () => {
  const failure = new Error('port unavailable');
  const hook = mount();
  hook.patch.mockRejectedValueOnce(failure);
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.patch({ updates: { promptDismissed: true } });
  });
  await act(async () => {
    await expect(pending).rejects.toBe(failure);
  });
  expect(hook.flush).not.toHaveBeenCalled();
  expect(hook.result.current.settings.updates).toEqual(DEFAULT_SETTINGS.updates);
});

it('los cambios de apariencia conservan su escritura agrupada y la elección del aviso', async () => {
  const initial = {
    ...DEFAULT_SETTINGS,
    updates: {
      ...DEFAULT_SETTINGS.updates,
      promptDismissed: true,
      nextPromptAt: 1_797_120_000_000,
    },
  };
  initSettingsData(initial);
  const hook = mount();
  await act(async () => {
    await hook.result.current.patch({ appearance: { density: 'compact' } });
  });
  expect(hook.flush).not.toHaveBeenCalled();
  expect(hook.result.current.settings.updates).toEqual(initial.updates);
});

it('el límite espera a su persistencia sin sobrescribir otro ajuste concurrente', async () => {
  let finishPatch!: () => void;
  const hook = mount();
  hook.patch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishPatch = resolve;
      }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.patch(
      { backup: { maxMiB: 512 } },
      { backupLimitToken: 'reviewed' },
    );
  });
  expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
  expect(hook.patch).toHaveBeenCalledWith(
    { backup: { maxMiB: 512 } },
    { backupLimitToken: 'reviewed' },
  );
  await act(async () => {
    await hook.result.current.patch({ appearance: { density: 'compact' } });
    finishPatch();
    await pending;
  });
  expect(hook.flush).not.toHaveBeenCalled();
  expect(getSettingsSnapshot().backup.maxMiB).toBe(512);
  expect(getSettingsSnapshot().appearance.density).toBe('compact');
});

it('un límite rechazado no queda en memoria aunque otro ajuste cambie durante la escritura', async () => {
  const failure = new Error('backup.limitChanged');
  let rejectPatch!: (error: Error) => void;
  const hook = mount();
  hook.patch.mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        rejectPatch = reject;
      }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.patch({ backup: { maxMiB: 512 } }, { backupLimitToken: 'old' });
  });
  await act(async () => {
    await hook.result.current.patch({ appearance: { density: 'compact' } });
    rejectPatch(failure);
    await expect(pending).rejects.toBe(failure);
  });
  expect(getSettingsSnapshot().backup.maxMiB).toBe(1024);
  expect(getSettingsSnapshot().appearance.density).toBe('compact');
  expect(hook.flush).not.toHaveBeenCalled();
  expect(hook.patch.mock.calls[1]).toEqual([{ appearance: { density: 'compact' } }]);
});

it('un fallo ajeno posterior no convierte un límite ya guardado en un fallo', async () => {
  const failure = new Error('disk full');
  const hook = mount(vi.fn(() => Promise.reject(failure)));
  await act(async () => {
    await hook.result.current.patch({ backup: { maxMiB: 2048 } });
  });
  expect(hook.flush).not.toHaveBeenCalled();
  expect(hook.log).not.toHaveBeenCalled();
  expect(getSettingsSnapshot().backup.maxMiB).toBe(2048);
  await act(async () => {
    await expect(hook.result.current.patch({ updates: { promptDismissed: true } })).rejects.toBe(
      failure,
    );
  });
  expect(getSettingsSnapshot().backup.maxMiB).toBe(2048);
  expect(getSettingsSnapshot().updates).toEqual(DEFAULT_SETTINGS.updates);
  expect(hook.patch).toHaveBeenCalledWith({ backup: { maxMiB: 2048 } });
});

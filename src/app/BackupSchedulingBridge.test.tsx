import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { selectPorts } from '@core/adapters/selectPorts';

import { BackupSchedulingBridge } from './BackupSchedulingBridge';
import { PortsContext } from './PortsContext';
import { useShellStore } from './shellStore';

beforeEach(() => useShellStore.getState().reset());

it('schedules restored and newly opened repositories once without waiting for the backup', async () => {
  const ports = selectPorts();
  const schedule = vi
    .spyOn(ports.backup, 'schedule')
    .mockImplementation(() => new Promise(() => {}));
  const repository = {
    repoId: 'repo',
    repoName: 'repo',
    repoPath: '/fixture/repo',
    branch: 'main',
  };
  useShellStore.getState().openWorking(repository);
  render(
    <StrictMode>
      <PortsContext value={ports}>
        <BackupSchedulingBridge />
      </PortsContext>
    </StrictMode>,
  );
  await waitFor(() => expect(schedule).toHaveBeenCalledExactlyOnceWith('/fixture/repo'));
  act(() => {
    useShellStore.getState().openTerminalFrom(useShellStore.getState().tabs[0]!.id);
    useShellStore.getState().openWorking(repository);
    useShellStore
      .getState()
      .openWorking({ ...repository, repoId: 'other', repoPath: '/fixture/other' });
  });
  await waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));
  expect(schedule).toHaveBeenLastCalledWith('/fixture/other');
  expect(useShellStore.getState().tabs.length).toBeGreaterThan(1);
});

it('an unavailable backup service leaves the opened repository usable', async () => {
  const ports = selectPorts();
  const schedule = vi.spyOn(ports.backup, 'schedule').mockRejectedValue(new Error('unavailable'));
  render(
    <PortsContext value={ports}>
      <BackupSchedulingBridge />
    </PortsContext>,
  );
  act(() =>
    useShellStore.getState().openWorking({
      repoId: 'repo',
      repoName: 'repo',
      repoPath: '/fixture/repo',
      branch: 'main',
    }),
  );
  await waitFor(() => expect(schedule).toHaveBeenCalledOnce());
  expect(useShellStore.getState().tabs[0]?.context.repository?.repoId).toBe('repo');
});

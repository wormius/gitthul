import { useEffect, useRef } from 'react';

import { usePorts } from './PortsContext';
import { useShellStore } from './shellStore';

/** Opening a tab schedules a check; the native worker owns cadence and copying. */
export function BackupSchedulingBridge() {
  const { backup } = usePorts();
  const tabs = useShellStore((state) => state.tabs);
  const scheduled = useRef({ port: backup, repositories: new Set<string>() });

  useEffect(() => {
    if (scheduled.current.port !== backup) {
      scheduled.current = { port: backup, repositories: new Set<string>() };
    }
    const current = scheduled.current;
    for (const tab of tabs) {
      const repository = tab.context.repository;
      if (!repository || current.repositories.has(repository.repoPath)) continue;
      current.repositories.add(repository.repoPath);
      // A failed schedule must never prevent navigation or terminal startup.
      void backup.schedule(repository.repoPath).catch(() => {
        current.repositories.delete(repository.repoPath);
      });
    }
  }, [backup, tabs]);

  return null;
}

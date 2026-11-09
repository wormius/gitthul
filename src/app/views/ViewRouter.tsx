import { useEffect } from 'react';

import { RepositoriesView } from '@features/repositories/RepositoriesView';
import { SettingsView } from '@features/settings/SettingsView';
import { TerminalView } from '@features/terminal/TerminalView';
import { WorkingView } from '@features/working/WorkingView';
import type { RepoSummary } from '@core/domain/repository';
import { terminalPanes } from '@features/terminal/terminalLayout';

import { registerTerminalContextResolver, useShellStore } from '../shellStore';
import { usePorts } from '../PortsContext';
import { activeTab, type Tab, type TabContext } from '../tabs';

function terminalContext(cwd: string, repository: RepoSummary | null): TabContext {
  return {
    cwd,
    repository: repository
      ? {
          kind: 'working',
          repoId: repository.id,
          repoName: repository.name,
          repoPath: repository.path,
          branch: repository.head,
          ...(repository.worktreeOf ? { worktreeOf: repository.worktreeOf } : {}),
        }
      : null,
  };
}

/** Monta la superficie de la pestaña activa o el hogar. */
export function ViewRouter() {
  const tab = useShellStore(activeTab);
  const settingsOpen = useShellStore((state) => state.settingsOpen);

  if (settingsOpen) return <SettingsView />;
  if (!tab) return <RepositoriesView />;

  return <MainSurface tab={tab} />;
}

function MainSurface({ tab }: { tab: Tab }) {
  if (tab.surface.kind === 'terminal') return <TerminalSurfaceView key={tab.id} tab={tab} />;
  return <WorkingView key={tab.surface.repoId} base={tab.surface} />;
}

function TerminalSurfaceView({ tab }: { tab: Tab }) {
  const { git } = usePorts();
  const updateLayout = useShellStore((state) => state.updateTerminalLayout);
  const updateContext = useShellStore((state) => state.updateTerminalContext);
  const openWorking = useShellStore((state) => state.openWorking);
  const closeTab = useShellStore((state) => state.closeTab);
  useEffect(
    () =>
      registerTerminalContextResolver(tab.id, async (current) => {
        if (current.surface.kind !== 'terminal') return current.context;
        const layout = current.surface.layout;
        const cwd =
          (layout &&
            terminalPanes(layout.root).find((pane) => pane.id === layout.activePaneId)?.cwd) ??
          current.context.cwd ??
          current.surface.cwd;
        const repository = await git.readRepository(cwd).catch(() => null);
        return terminalContext(cwd, repository);
      }),
    [git, tab.id],
  );
  if (tab.surface.kind !== 'terminal') return null;
  const repository = tab.context.repository;

  return (
    <TerminalView
      sessionId={tab.id}
      cwd={tab.surface.cwd}
      repoId={tab.context.repository?.repoId ?? null}
      layout={tab.surface.layout}
      onClose={() => {
        void closeTab(tab.id);
      }}
      onOpenWorking={
        repository
          ? () => {
              openWorking({
                repoId: repository.repoId,
                repoName: repository.repoName,
                repoPath: repository.repoPath,
                branch: repository.branch,
                ...(repository.worktreeOf ? { worktreeOf: repository.worktreeOf } : {}),
              });
            }
          : undefined
      }
      onLayoutChange={(layout) => updateLayout(tab.id, layout)}
      onContextChange={(cwd, repository, pending) =>
        updateContext(
          tab.id,
          terminalContext(cwd, repository),
          pending?.then((resolved) => terminalContext(cwd, resolved)),
        )
      }
    />
  );
}

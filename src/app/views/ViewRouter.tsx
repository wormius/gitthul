import { RepositoriesView } from '@features/repositories/RepositoriesView';
import { SettingsView } from '@features/settings/SettingsView';
import { TerminalView } from '@features/terminal/TerminalView';
import { WorkingView } from '@features/working/WorkingView';

import { useShellStore } from '../shellStore';
import { activeTab, type Tab } from '../tabs';

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
  const updateLayout = useShellStore((state) => state.updateTerminalLayout);
  const updateContext = useShellStore((state) => state.updateTerminalContext);
  const openWorking = useShellStore((state) => state.openWorking);
  const closeTab = useShellStore((state) => state.closeTab);
  if (tab.surface.kind !== 'terminal') return null;
  const repository = tab.context.repository;

  return (
    <TerminalView
      sessionId={tab.id}
      cwd={tab.surface.cwd}
      repoId={tab.context.repository?.repoId ?? null}
      layout={tab.surface.layout}
      onClose={() => closeTab(tab.id)}
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
      onContextChange={(cwd, repository) =>
        updateContext(tab.id, {
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
        })
      }
    />
  );
}

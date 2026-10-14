import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { selectPorts } from '@core/adapters/selectPorts';
import { I18nProvider } from '@i18n/I18nProvider';

import { RepoStatsPanel } from './RepoStatsPanel';

describe('RepoStatsPanel', () => {
  it.each([false, true])(
    'distingue los conteos del upstream ausente (ausente: %s)',
    async (missing) => {
      const git = createMockGitPort({ latency: NO_LATENCY });
      const repo = (await git.listRepositories()).find((entry) => entry.id === 'gitthul');
      if (!repo) throw new Error('Falta el repositorio del fixture');
      const refs = await git.readRefs(repo.id);
      vi.spyOn(git, 'readRefs').mockResolvedValue({
        ...refs,
        branches: refs.branches.map((branch) =>
          branch.kind === 'local' && branch.isHead
            ? { ...branch, upstream: 'origin/main', upstreamMissing: missing, ahead: 9, behind: 3 }
            : branch,
        ),
      });
      render(
        <PortsContext value={{ ...selectPorts(), git }}>
          <I18nProvider initialLocale="es-MX">
            <RepoStatsPanel repo={repo} />
          </I18nProvider>
        </PortsContext>,
      );

      if (missing) {
        expect(
          await screen.findByText('El upstream origin/main ya no existe.'),
        ).toBeInTheDocument();
        expect(
          screen.queryByText('9 commits pendientes de push a origin/main'),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText('3 commits pendientes de pull desde origin/main'),
        ).not.toBeInTheDocument();
      } else {
        expect(
          await screen.findByText('9 commits pendientes de push a origin/main'),
        ).toBeInTheDocument();
        expect(
          screen.getByText('3 commits pendientes de pull desde origin/main'),
        ).toBeInTheDocument();
        expect(screen.queryByText('El upstream origin/main ya no existe.')).not.toBeInTheDocument();
      }
    },
  );
});

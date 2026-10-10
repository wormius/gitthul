import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { selectPorts } from '@core/adapters/selectPorts';
import type { Commit, CommitDetails } from '@core/domain/commit';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';

import { CommitSequenceDialog } from './CommitSequenceDialog';

const AUTHOR = { name: 'Ariadna', email: 'ariadna@example.test' };

function commit(sha: string, summary: string, parents: readonly string[]): Commit {
  return {
    sha,
    parents,
    summary,
    body: '',
    author: AUTHOR,
    authoredAt: 1,
    committer: AUTHOR,
    committedAt: 1,
  };
}

function renderDialog(
  commits: readonly Commit[],
  shas: readonly string[] = [commits[0]?.sha ?? ''],
  kind: 'cherryPick' | 'revert' = 'cherryPick',
) {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const bySha = new Map(commits.map((item) => [item.sha, item]));
  vi.spyOn(git, 'readCommit').mockImplementation((_repoId, sha) => {
    const found = bySha.get(sha);
    if (!found) return Promise.reject(new Error(`Commit de prueba ausente: ${sha}`));
    return Promise.resolve({ commit: found, files: [], refs: [] } satisfies CommitDetails);
  });
  const onConfirm = vi.fn();
  const ports = { ...selectPorts(), git };

  const view = render(
    <PortsContext value={ports}>
      <ThemeProvider>
        <I18nProvider initialLocale="es-MX">
          <CommitSequenceDialog
            kind={kind}
            repoId="gitthul"
            branch="main"
            shas={shas}
            contiguous
            precondition={{ targetRef: 'main', targetOid: 'f'.repeat(40) }}
            onConfirm={onConfirm}
            onCancel={() => undefined}
          />
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );

  return { ...view, onConfirm };
}

describe('CommitSequenceDialog', () => {
  it('exige y transporta la línea principal de un commit de merge', async () => {
    const user = userEvent.setup();
    const first = commit('a'.repeat(40), 'Línea principal actual', ['0'.repeat(40)]);
    const second = commit('b'.repeat(40), 'Trabajo incorporado', ['1'.repeat(40)]);
    const merge = commit('c'.repeat(40), 'Fusiona el trabajo', [first.sha, second.sha]);
    const { onConfirm } = renderDialog([merge, first, second]);
    const dialog = screen.getByRole('dialog', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });

    expect(confirm).toBeDisabled();
    const parent = await within(dialog).findByRole('radio', {
      name: 'Padre 2 · bbbbbbb · Trabajo incorporado',
    });
    expect(confirm).toBeDisabled();

    await user.click(parent);
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(
      [merge.sha],
      { targetRef: 'main', targetOid: 'f'.repeat(40) },
      2,
    );
  });

  it('mantiene disponible una secuencia ordinaria sin inventar línea principal', async () => {
    const user = userEvent.setup();
    const ordinary = commit('d'.repeat(40), 'Cambio ordinario', ['c'.repeat(40)]);
    const { onConfirm } = renderDialog([ordinary]);
    const confirm = screen.getByRole('button', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });

    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(
      [ordinary.sha],
      { targetRef: 'main', targetOid: 'f'.repeat(40) },
      undefined,
    );
  });

  it('explica y bloquea una selección múltiple que contiene un merge', async () => {
    const first = commit('a'.repeat(40), 'Primero', ['0'.repeat(40)]);
    const second = commit('b'.repeat(40), 'Segundo', ['1'.repeat(40)]);
    const merge = commit('c'.repeat(40), 'Fusión', [first.sha, second.sha]);
    const ordinary = commit('d'.repeat(40), 'Después', [merge.sha]);
    renderDialog([merge, first, second, ordinary], [merge.sha, ordinary.sha], 'revert');

    expect(await screen.findByText('La selección incluye un commit de merge')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revertir 2 commits en main' })).toBeDisabled();
  });
});

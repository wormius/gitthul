import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import type { Commit } from '@core/domain/commit';
import type { RefsSnapshot } from '@core/domain/refs';
import { I18nProvider } from '@i18n/I18nProvider';
import { DataGrid } from '@ui/DataGrid';

import { CommitRow } from './CommitRow';
import { buildGraph } from './graph';
import { resolveGraphMetrics, resolveGraphPalette } from './graphPaint';

it('mantiene SHA, autor y ambas fechas asociados al commit aunque difieran las fechas de Git', () => {
  const commits: Commit[] = [
    {
      sha: '53192f9f70d61078fdbf57cfc16300bebe5c51d7',
      parents: ['6367e1b5df92f7ccb52f6ecff948cc6bc0fe4bfc'],
      summary: 'Sonar fixes',
      body: '',
      author: { name: 'Luis Angel Cozatl Sanchez', email: 'autor@example.com' },
      committer: { name: 'Luis Angel Cozatl Sanchez', email: 'autor@example.com' },
      authoredAt: Date.parse('2023-11-07T12:53:54-06:00'),
      committedAt: Date.parse('2023-11-08T09:16:19-06:00'),
    },
    {
      sha: '6bdb5e3e978baea2d9acd93acc2a84189767cd86',
      parents: [],
      summary: 'Se agrega cambio del nombrado de log en elastic',
      body: '',
      author: { name: 'Misael Martin Lopez', email: 'otro@example.com' },
      committer: { name: 'Misael Martin Lopez', email: 'otro@example.com' },
      authoredAt: Date.parse('2023-11-07T12:53:45-06:00'),
      committedAt: Date.parse('2023-11-07T12:53:45-06:00'),
    },
  ];
  const rows = commits.map((commit) => ({ kind: 'commit' as const, key: commit.sha, commit }));
  const refs: RefsSnapshot = {
    head: { sha: commits[0]!.sha, branch: 'main', detached: false },
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    worktrees: [],
  };
  const graph = {
    layout: buildGraph(rows, refs),
    metrics: resolveGraphMetrics({}, 28),
    palette: resolveGraphPalette({}),
    width: 64,
    form: 'ring' as const,
  };
  const dateFormat = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  render(
    <I18nProvider initialLocale="es-MX">
      <DataGrid
        columns={['refs', 'graph', 'subject', 'author', 'date', 'sha'].map((key) => ({
          key,
          header: key,
          name: key,
          width: 160,
        }))}
        label="Historial"
        rowCount={rows.length}
      >
        {rows.map((row, index) => (
          <CommitRow
            key={row.key}
            row={row}
            index={index}
            selected={index === 0}
            dateFormat={dateFormat}
            graph={graph}
            labels={[]}
            menu={{ items: [], label: row.commit.summary }}
            labelMenu={() => ({ items: [], label: '' })}
            onReferenceDrop={() => {}}
            onReferenceActivate={() => {}}
          />
        ))}
      </DataGrid>
    </I18nProvider>,
  );
  for (const commit of commits) {
    const row = screen.getByText(commit.summary).closest<HTMLElement>('[role="row"]')!;
    expect(within(row).getByText(commit.author.name)).toBeInTheDocument();
    expect(within(row).getByText(commit.sha.slice(0, 7))).toHaveAttribute('title', commit.sha);
    const date = within(row).getByText(dateFormat.format(commit.committedAt));
    expect(date).toHaveAttribute(
      'title',
      `Fecha de autoría: ${dateFormat.format(commit.authoredAt)}\nFecha de commit: ${dateFormat.format(commit.committedAt)}`,
    );
  }
});

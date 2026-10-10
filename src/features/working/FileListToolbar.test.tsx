import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '@i18n/I18nProvider';

import { FileListToolbar } from './FileListToolbar';
import type { FileView } from './staging';

function Harness() {
  const [view, setView] = useState<FileView>('flat');
  const [expanded, setExpanded] = useState(true);

  return (
    <I18nProvider initialLocale="es-MX">
      <FileListToolbar
        filter=""
        onFilterChange={() => {}}
        sort="path"
        onSortChange={() => {}}
        view={view}
        onViewChange={setView}
        matches={3}
        treeExpanded={expanded}
        onTreeExpandedChange={setExpanded}
      />
    </I18nProvider>
  );
}

describe('FileListToolbar', () => {
  it('un clic en la vista activa alterna Lista/Árbol y permite plegar todo', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const list = screen.getByRole('radio', { name: 'Lista' });
    await user.click(list);

    expect(screen.getByRole('radio', { name: 'Árbol' })).toHaveAttribute('aria-checked', 'true');

    const collapse = screen.getByRole('button', { name: 'Colapsar todo' });
    await user.click(collapse);
    expect(screen.getByRole('button', { name: 'Expandir todo' })).toBeVisible();

    await user.click(screen.getByRole('radio', { name: 'Árbol' }));
    expect(list).toHaveAttribute('aria-checked', 'true');
  });
});

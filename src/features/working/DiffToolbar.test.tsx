import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '@i18n/I18nProvider';

import { DiffToolbar } from './DiffToolbar';
import type { DiffOptions } from './workingStore';

const INITIAL: DiffOptions = {
  content: 'diff',
  columns: 'unified',
  scope: 'hunks',
  ignoreWhitespace: false,
  encoding: 'utf-8',
};

function Harness() {
  const [options, setOptions] = useState(INITIAL);

  return (
    <I18nProvider initialLocale="es-MX">
      <DiffToolbar
        path="src/app.ts"
        source={{ kind: 'worktree' }}
        options={options}
        onOptionsChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
        reportedEncoding="utf-8"
        textual
        onClose={() => {}}
      />
    </I18nProvider>
  );
}

describe('DiffToolbar', () => {
  it('offers automatic detection and the wider encoding collection', async () => {
    render(<Harness />);
    const select = screen.getByRole('combobox', { name: 'Codificación' });
    expect(screen.getAllByRole('option')).toHaveLength(43);
    await userEvent.selectOptions(select, 'shift_jis');
    expect(select).toHaveValue('shift_jis');
    await userEvent.selectOptions(select, 'auto');
    expect(select).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Automático (UTF-8)' })).toBeInTheDocument();
  });

  it('cada opción activa alterna con su pareja', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Una' }));
    expect(screen.getByRole('radio', { name: 'Dos' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Dos' }));
    expect(screen.getByRole('radio', { name: 'Una' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Hunks' }));
    expect(screen.getByRole('radio', { name: 'Archivo completo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('radio', { name: 'Archivo completo' }));
    expect(screen.getByRole('radio', { name: 'Hunks' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Diff' }));
    expect(screen.getByRole('radio', { name: 'Archivo' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Archivo' }));
    expect(screen.getByRole('radio', { name: 'Diff' })).toHaveAttribute('aria-checked', 'true');
  });
});

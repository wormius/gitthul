import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConflictContents } from '@core/domain/status';
import { I18nProvider } from '@i18n/I18nProvider';

import { WholeFileCard } from './WholeFileCard';

describe('WholeFileCard', () => {
  it('explica un binario como binario aunque sus textos no crucen el puerto', () => {
    const conflict: ConflictContents = {
      path: 'assets/logo.bin',
      kind: 'bothModified',
      base: null,
      ours: null,
      theirs: null,
      oursLabel: 'main',
      theirsLabel: 'tema',
      sizes: { ours: { bytes: 2, lines: 1 }, theirs: { bytes: 2, lines: 1 } },
      binary: true,
      tooLarge: false,
    };

    render(
      <I18nProvider initialLocale="es-MX">
        <WholeFileCard
          conflict={conflict}
          onKeepSide={() => undefined}
          onCancel={() => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Es un archivo binario: no hay líneas que comparar.')).toBeVisible();
    expect(screen.queryByText(/Lo borraste/)).not.toBeInTheDocument();
  });
});

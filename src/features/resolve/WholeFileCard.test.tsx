import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConflictContents } from '@core/domain/status';
import { GitOperationError } from '@core/domain/errors';
import { I18nProvider } from '@i18n/I18nProvider';

import { WholeFileCard } from './WholeFileCard';

const BINARY: ConflictContents = {
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

describe('WholeFileCard', () => {
  it.each(['symbolicLink', 'submodule'] as const)(
    'explica %s y ofrece solo las acciones compatibles',
    async (wholeFileOnly) => {
      const onKeepSide = vi.fn();
      const onCancel = vi.fn();
      const conflict: ConflictContents = {
        path: 'ruta',
        kind: 'bothModified',
        base: 'destino anterior',
        ours: 'destino A',
        theirs: 'destino B',
        oursLabel: 'main',
        theirsLabel: 'tema',
        sizes: { ours: { bytes: 9, lines: 1 }, theirs: { bytes: 9, lines: 1 } },
        binary: false,
        tooLarge: false,
        wholeFileOnly,
      };
      render(
        <I18nProvider initialLocale="es-MX">
          <WholeFileCard conflict={conflict} onKeepSide={onKeepSide} onCancel={onCancel} />
        </I18nProvider>,
      );

      if (wholeFileOnly === 'symbolicLink') {
        expect(screen.getByText(/El conflicto incluye un enlace simbólico/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /main/ }));
        expect(onKeepSide).toHaveBeenCalledWith('ours');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled());
      } else {
        expect(screen.getByText(/Resuelve el conflicto del submódulo/)).toBeVisible();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByText(/borraste/)).not.toBeInTheDocument();
      }
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(onCancel).toHaveBeenCalledOnce();
    },
  );

  it('explica un binario como binario aunque sus textos no crucen el puerto', () => {
    render(
      <I18nProvider initialLocale="es-MX">
        <WholeFileCard conflict={BINARY} onKeepSide={() => undefined} onCancel={() => undefined} />
      </I18nProvider>,
    );

    expect(screen.getByText('Es un archivo binario: no hay líneas que comparar.')).toBeVisible();
    expect(screen.queryByText(/Lo borraste/)).not.toBeInTheDocument();
  });

  it('muestra el fallo conservando la tarjeta y permite reintentar', async () => {
    const onKeepSide = vi
      .fn<(side: 'ours' | 'theirs') => Promise<void>>()
      .mockRejectedValueOnce(new GitOperationError('write.stale', { path: BINARY.path }))
      .mockResolvedValueOnce(undefined);
    render(
      <I18nProvider initialLocale="es-MX">
        <WholeFileCard conflict={BINARY} onKeepSide={onKeepSide} onCancel={() => undefined} />
      </I18nProvider>,
    );
    const keepOurs = screen.getByRole('button', { name: /main/ });
    fireEvent.click(keepOurs);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('heading', { name: BINARY.path })).toBeVisible();
    expect(keepOurs).toBeEnabled();
    fireEvent.click(keepOurs);
    await waitFor(() => expect(keepOurs).toBeEnabled());
    expect(onKeepSide).toHaveBeenCalledTimes(2);
    expect(onKeepSide).toHaveBeenNthCalledWith(2, 'ours');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('espera la acción y bloquea duplicados, el otro lado y cancelar hasta terminar', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const onKeepSide = vi.fn(() => pending);
    const onCancel = vi.fn();
    render(
      <I18nProvider initialLocale="es-MX">
        <WholeFileCard conflict={BINARY} onKeepSide={onKeepSide} onCancel={onCancel} />
      </I18nProvider>,
    );
    const keepOurs = screen.getByRole('button', { name: /main/ });
    const keepTheirs = screen.getByRole('button', { name: /tema/ });
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    act(() => {
      keepOurs.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      keepOurs.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onKeepSide).toHaveBeenCalledOnce();
    expect(keepOurs).toBeDisabled();
    expect(keepTheirs).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.click(keepTheirs);
    fireEvent.click(cancel);
    expect(onKeepSide).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => {
      complete();
      await pending;
    });
    expect(keepOurs).toBeEnabled();
    expect(keepTheirs).toBeEnabled();
    expect(cancel).toBeEnabled();
  });
});

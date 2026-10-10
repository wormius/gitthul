import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCssTokens } from './useCssTokens';

const TOKENS = ['--surface-panel'] as const;

function Probe() {
  const tokens = useCssTokens(TOKENS);

  return <output>{tokens['--surface-panel']}</output>;
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme-variant');
  vi.restoreAllMocks();
});

describe('useCssTokens', () => {
  it('refresca los colores de canvas al cambiar únicamente la variante', async () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: () =>
            document.documentElement.dataset['themeVariant'] === 'dense' ? '#203040' : '#102030',
        }) as unknown as CSSStyleDeclaration,
    );

    const { unmount } = render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('#102030');

    await act(async () => {
      document.documentElement.dataset['themeVariant'] = 'dense';
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('#203040');
    unmount();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@i18n/I18nProvider';
import { ResolvedResult } from './ResolvedResult';

describe('ResolvedResult', () => {
  it('identifica ramas y texto propio sin letras ambiguas, y cierra con la X', async () => {
    const close = vi.fn();
    render(
      <I18nProvider initialLocale="es-MX">
        <ResolvedResult
          path="file.ts"
          result={'contexto\nA\nB\npropio\n'}
          origins={['context', 'ours', 'theirs', 'manual']}
          sources={{ ours: 'main', theirs: 'feature' }}
          onClose={close}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Bloque 1 · main')).toBeVisible();
    expect(screen.getByText('Bloque 2 · feature')).toBeVisible();
    expect(screen.getByText('Bloque 3 · Nuevo cambio')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar resultado' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('conserva un viewport desplazable sin reconfigurar el editor durante el scroll', () => {
    const origins = Array.from({ length: 80 }, (_, index) =>
      index % 2 === 0 ? ('ours' as const) : ('theirs' as const),
    );
    render(
      <I18nProvider initialLocale="es-MX">
        <ResolvedResult
          path="large.ts"
          result={origins.map((_, index) => `línea ${String(index + 1)}`).join('\n')}
          origins={origins}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );

    const editor = screen.getByRole('textbox', { name: 'Resultado final resuelto' });
    const scroller = editor.closest<HTMLElement>('.cm-scroller');
    const codeMirror = editor.closest<HTMLElement>('.cm-editor');

    expect(scroller).not.toBeNull();
    expect(codeMirror).not.toBeNull();
    expect(getComputedStyle(codeMirror!).minHeight).toBe('0');

    Object.defineProperty(scroller!, 'scrollTop', {
      value: 240,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scroller!);

    expect(scroller).toHaveProperty('scrollTop', 240);
    expect(scroller).not.toHaveAttribute('data-preserving-scroll');
  });
});

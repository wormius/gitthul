import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setMediaQuery } from '../test/matchMedia';
import { ThemeProvider } from './ThemeProvider';
import { CODE_FONT_SIZE, DEFAULT_THEME_SETTINGS, UI_FONT_SIZE } from './theme';
import { useTheme } from './useTheme';

const root = () => document.documentElement;

function Probe() {
  const { settings, resolved, update } = useTheme();

  return (
    <div>
      <p>
        resuelto: {resolved.theme}/{resolved.mode}
      </p>
      <button
        type="button"
        onClick={() => {
          update({ themeVariant: 'dense' });
        }}
      >
        variante dense
      </button>
      <button
        type="button"
        onClick={() => {
          update(DEFAULT_THEME_SETTINGS);
        }}
      >
        restablecer
      </button>
      <button
        type="button"
        onClick={() => {
          update({ density: 'compact', uiFontSize: 17 });
        }}
      >
        compactar
      </button>
      <button
        type="button"
        onClick={() => {
          update({ uiFontSize: 99, codeFontSize: 2 });
        }}
      >
        exagerar
      </button>
      <p>ui: {settings.uiFontSize}</p>
      <p>code: {settings.codeFontSize}</p>
      <p>variante: {resolved.themeVariant}</p>
    </div>
  );
}

afterEach(() => {
  for (const attribute of ['theme', 'theme-variant', 'mode', 'density', 'font-ui', 'font-code']) {
    root().removeAttribute(`data-${attribute}`);
  }
  root().removeAttribute('style');
});

describe('ThemeProvider', () => {
  it('escribe las perillas en el elemento raíz', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(root().dataset['theme']).toBe('thul');
    expect(root().dataset['themeVariant']).toBe('classic');
    expect(root().dataset['mode']).toBe('dark');
    expect(root().dataset['density']).toBe('cozy');
    expect(root().dataset['fontUi']).toBe('space-grotesk');
    expect(root().dataset['fontCode']).toBe('jetbrains-mono');
    expect(root().style.getPropertyValue('--font-size-ui')).toBe('13px');
    expect(root().style.getPropertyValue('--font-size-code')).toBe('13px');
  });

  it('sigue el modo del sistema mientras el usuario no fije uno', () => {
    setMediaQuery('(prefers-color-scheme: light)', true);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText('resuelto: thul/light')).toBeInTheDocument();

    act(() => {
      setMediaQuery('(prefers-color-scheme: light)', false);
    });

    expect(screen.getByText('resuelto: thul/dark')).toBeInTheDocument();
    expect(root().dataset['mode']).toBe('dark');
  });

  it('elige «Contraste» cuando el sistema pide más contraste', () => {
    setMediaQuery('(prefers-contrast: more)', true);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(root().dataset['theme']).toBe('contraste');
  });

  it('no deja que el sistema pise un tema elegido a mano', () => {
    setMediaQuery('(prefers-contrast: more)', true);

    render(
      <ThemeProvider initialSettings={{ theme: 'grimorio', mode: 'light' }}>
        <Probe />
      </ThemeProvider>,
    );

    expect(root().dataset['theme']).toBe('grimorio');
    expect(root().dataset['mode']).toBe('light');
  });

  it('aplica los cambios sin volver a montar nada', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'compactar' }));

    expect(root().dataset['density']).toBe('compact');
    expect(root().style.getPropertyValue('--font-size-ui')).toBe('17px');
    expect(root().style.getPropertyValue('--font-size-code')).toBe('13px');
  });

  it('recorta los tamaños a su rango', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'exagerar' }));

    expect(screen.getByText(`ui: ${String(UI_FONT_SIZE.max)}`)).toBeInTheDocument();
    expect(screen.getByText(`code: ${String(CODE_FONT_SIZE.min)}`)).toBeInTheDocument();
  });

  it('aplica y guarda la variante sin cambiar el tema ni la densidad', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ThemeProvider
        initialSettings={{ theme: 'grimorio', themeVariant: 'minimalist', density: 'spacious' }}
        onChange={onChange}
      >
        <Probe />
      </ThemeProvider>,
    );

    expect(root().dataset['themeVariant']).toBe('minimalist');
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'variante dense' }));

    expect(root().dataset['theme']).toBe('grimorio');
    expect(root().dataset['themeVariant']).toBe('dense');
    expect(root().dataset['density']).toBe('spacious');
    expect(screen.getByText('variante: dense')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'grimorio', themeVariant: 'dense', density: 'spacious' }),
    );

    await user.click(screen.getByRole('button', { name: 'restablecer' }));

    expect(root().dataset['theme']).toBe('thul');
    expect(root().dataset['themeVariant']).toBe('classic');
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_THEME_SETTINGS);
  });
});

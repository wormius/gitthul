import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';

import { App } from './App';
import { TOKENS_GALLERY_PATH } from './devRoutes';
import { useShellStore } from './shellStore';

function renderApp() {
  return render(
    <ThemeProvider initialSettings={{ theme: 'thul', mode: 'dark' }}>
      <I18nProvider initialLocale="es-MX">
        <App />
      </I18nProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  useShellStore.getState().reset();
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('abre en el shell sin duplicar la decoración nativa', () => {
    renderApp();

    expect(screen.queryByRole('banner', { name: 'Barra de título' })).not.toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Barra inferior' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pestañas abiertas' })).toBeInTheDocument();
  });

  it('muestra la versión de la aplicación en la barra inferior', () => {
    renderApp();

    // La pantalla de inicio también la dice, bajo el logotipo: aquí se busca la
    // de la barra, que es la que tiene que estar mire lo que mire la ventana.
    const bar = screen.getByRole('contentinfo', { name: 'Barra inferior' });

    expect(within(bar).getByText(/^GitThul \d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  // La galería es superficie interna: no pasa por i18n y no monta el shell.
  it('en la ruta interna abre la galería en vez del shell', () => {
    window.history.pushState({}, '', TOKENS_GALLERY_PATH);

    renderApp();

    expect(screen.getByRole('heading', { name: /Tokens/ })).toBeInTheDocument();
    // La galería tiene su propia barra de ejemplo; la del shell no está.
    expect(screen.queryByRole('contentinfo', { name: 'Barra inferior' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pestañas abiertas' })).not.toBeInTheDocument();
  });
});

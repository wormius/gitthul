import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';

import { TokensGallery } from './TokensGallery';

/*
 * La verificación de F0.3: tema, modo, densidad y las dos escalas de fuente se
 * cambian en vivo desde la galería. Se comprueba sobre el elemento raíz porque
 * es donde el sistema de diseño aplica de verdad — los flotantes y los modales
 * salen por portales y solo heredan tokens si viven ahí.
 */

const root = () => document.documentElement;

function renderGallery() {
  return render(
    <ThemeProvider>
      <I18nProvider initialLocale="es-MX">
        <TokensGallery />
      </I18nProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  for (const attribute of ['theme', 'theme-variant', 'mode', 'density', 'font-ui', 'font-code']) {
    root().removeAttribute(`data-${attribute}`);
  }
  root().removeAttribute('style');
});

describe('galería de tokens', () => {
  it('recorre el catálogo del sistema de diseño', () => {
    renderGallery();

    expect(screen.getByRole('heading', { name: /Tokens/ })).toBeInTheDocument();

    for (const section of [
      'Superficies y estados',
      'Ramas del grafo',
      'Tipografía',
      'Controles',
      'Superposición y navegación',
      'Arrastre',
      'Medidas',
      'Contraste',
    ]) {
      expect(screen.getByRole('heading', { name: section, level: 2 })).toBeInTheDocument();
    }

    expect(screen.getByText('--surface-panel')).toBeInTheDocument();
    expect(screen.getByText('--graph-branch-8')).toBeInTheDocument();
  });

  it('cambia el tema en vivo', async () => {
    const user = userEvent.setup();

    renderGallery();

    await user.selectOptions(screen.getByLabelText('Tema'), 'grimorio');

    expect(root().dataset['theme']).toBe('grimorio');
  });

  it('cambia el modo en vivo', async () => {
    const user = userEvent.setup();

    renderGallery();

    await user.selectOptions(screen.getByLabelText('Modo'), 'light');

    expect(root().dataset['mode']).toBe('light');
  });

  it('cambia la variante conservando el tema y la densidad', async () => {
    const user = userEvent.setup();

    renderGallery();

    await user.selectOptions(screen.getByLabelText('Tema'), 'grimorio');
    await user.selectOptions(screen.getByLabelText('Variante'), 'dense');

    expect(root().dataset['theme']).toBe('grimorio');
    expect(root().dataset['themeVariant']).toBe('dense');
    expect(root().dataset['density']).toBe('cozy');
  });

  it('cambia la densidad en vivo', async () => {
    const user = userEvent.setup();

    renderGallery();

    await user.selectOptions(screen.getByLabelText('Densidad'), 'spacious');

    expect(root().dataset['density']).toBe('spacious');
  });

  it('cambia las dos familias de fuente en vivo', async () => {
    const user = userEvent.setup();

    renderGallery();

    await user.selectOptions(screen.getByLabelText('Fuente de interfaz'), 'atkinson-hyperlegible');
    await user.selectOptions(screen.getByLabelText('Fuente de visores'), 'fira-code');

    expect(root().dataset['fontUi']).toBe('atkinson-hyperlegible');
    expect(root().dataset['fontCode']).toBe('fira-code');
  });

  it('mueve las dos escalas de tamaño por separado', () => {
    renderGallery();

    fireEvent.change(screen.getByLabelText('Tamaño de interfaz'), { target: { value: '18' } });

    expect(root().style.getPropertyValue('--font-size-ui')).toBe('18px');
    expect(root().style.getPropertyValue('--font-size-code')).toBe('13px');

    fireEvent.change(screen.getByLabelText('Tamaño de visores'), { target: { value: '21' } });

    expect(root().style.getPropertyValue('--font-size-ui')).toBe('18px');
    expect(root().style.getPropertyValue('--font-size-code')).toBe('21px');
  });

  it('saca los flotantes fuera del flujo de la vista', () => {
    renderGallery();

    fireEvent.contextMenu(screen.getByRole('button', { name: /Clic derecho/ }));

    const menu = screen.getByRole('menu', { name: 'Acciones del commit a1b2c3d' });

    // La capa cuelga de body: por eso abrirla no puede desplazar ni un píxel
    // de lo que hay debajo, que es la invariante 1.
    expect(menu.closest('main')).toBeNull();
    expect(document.body).toContainElement(menu);
  });

  it('enseña el trazo y la forma de cada rama, que en «Contraste» son los que distinguen', async () => {
    const user = userEvent.setup();

    renderGallery();

    expect(screen.getAllByRole('img', { name: /^Rama \d$/ })).toHaveLength(8);

    await user.selectOptions(screen.getByLabelText('Tema'), 'contraste');

    expect(root().dataset['theme']).toBe('contraste');
  });
});

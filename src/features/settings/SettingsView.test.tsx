import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, DEFAULT_THEME_SETTINGS } from '@core/domain/settings';
import { ThemeContext, type ThemeContextValue } from '@design/ThemeContext';
import { I18nContext, type I18nContextValue } from '@i18n/I18nContext';
import { esMX } from '@i18n/messages/es-MX';
import { interpolate } from '@i18n/format';
import { GestureContext } from '@app/GestureContext';
import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import { createGestureRegistry, type GestureDefinition } from '@app/gestures';
import { expectNoHoverShift } from '../../test/noShift';

import { SettingsView } from './SettingsView';
import { initSettingsData } from './useSettingsData';

/*
 * Montaje auxiliar que envuelve la vista con los proveedores mínimos: i18n,
 * tema, puertos y el registro de gestos. Es lo mínimo para que los componentes
 * que leen de `useI18n`, `useTheme`, `usePorts` y `useGestures` no revienten.
 */

const mockPorts = selectPorts();

function makeMockTheme(overrides?: Partial<ThemeContextValue>): ThemeContextValue {
  return {
    settings: DEFAULT_THEME_SETTINGS,
    resolved: {
      theme: 'thul',
      mode: 'dark',
      themeVariant: 'classic',
    },
    update: vi.fn(),
    ...overrides,
  };
}

function makeMockI18n(): I18nContextValue {
  return {
    locale: 'es-MX',
    setLocale: vi.fn(),
    t: (key, params) => interpolate(esMX[key], params),
  };
}

function makeMockGestures(): GestureDefinition[] {
  return [
    {
      id: 'shell.openSettings',
      label: 'Abrir Configuraciones',
      triggers: ['button', 'shortcut', 'search'],
      shortcut: 'Mod+,',
      run: vi.fn(),
    },
    {
      id: 'shell.openHelp',
      label: 'Abrir la ayuda en el navegador',
      triggers: ['button', 'shortcut', 'search'],
      shortcut: 'F1',
      run: vi.fn(),
    },
    {
      id: 'working.createBranch',
      label: 'Crear una rama desde una-rama-de-prueba',
      shortcutName: 'Crear una rama',
      triggers: ['menu', 'shortcut', 'search'],
      shortcut: 'Mod+B',
      disabled: true,
      run: vi.fn(),
    },
    {
      id: 'shell.support',
      label: 'Apoyar a GitThul',
      triggers: ['button', 'search'],
      run: vi.fn(),
    },
  ];
}

function renderSettings(overrides?: { theme?: ThemeContextValue }) {
  const theme = overrides?.theme ?? makeMockTheme();
  const i18n = makeMockI18n();
  const gestures = createGestureRegistry(makeMockGestures(), 'linux');

  return render(
    <I18nContext.Provider value={i18n}>
      <ThemeContext.Provider value={theme}>
        <PortsContext.Provider value={mockPorts}>
          <GestureContext.Provider value={gestures}>
            <SettingsView />
          </GestureContext.Provider>
        </PortsContext.Provider>
      </ThemeContext.Provider>
    </I18nContext.Provider>,
  );
}

beforeEach(() => {
  initSettingsData(DEFAULT_SETTINGS);
});

describe('SettingsView', () => {
  it('muestra las ocho secciones en las tabs', () => {
    renderSettings();

    const nav = screen.getByRole('navigation', { name: 'Secciones de configuraciones' });
    const tabs = within(nav).getAllByRole('tab');

    expect(tabs).toHaveLength(8);
    expect(tabs[0]).toHaveTextContent('Apariencia');
    expect(tabs[1]).toHaveTextContent('Idioma');
    expect(tabs[2]).toHaveTextContent('Git');
    expect(tabs[3]).toHaveTextContent('Atajos');
    expect(tabs[4]).toHaveTextContent('Actualizaciones');
    expect(tabs[5]).toHaveTextContent('Recuperación');
    expect(tabs[6]).toHaveTextContent('Registros y diagnóstico');
    expect(tabs[7]).toHaveTextContent('Acerca de');
  });

  it('la primera sección activa es Apariencia y tiene un título visible', () => {
    renderSettings();

    const nav = screen.getByRole('navigation', { name: 'Secciones de configuraciones' });
    const tabs = within(nav).getAllByRole('tab');

    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 1, name: 'Apariencia' })).toBeInTheDocument();
  });

  it('al navegar cambia también el título visible de la sección', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('tab', { name: 'Idioma' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Idioma' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Apariencia' })).not.toBeInTheDocument();
  });

  /*
   * Apariencia dejó de tener desplegables y radios: cada elección se enseña. Lo
   * que estas pruebas fijan es el contrato accesible —radiogrupos con sus
   * opciones y un parche por elección—, no el dibujo de cada ficha.
   */
  it('previsualiza cada esquina sin acumular avisos y permite repetir y cerrar la muestra', async () => {
    const update = vi.fn();
    renderSettings({ theme: makeMockTheme({ update }) });
    const user = userEvent.setup();
    const group = screen.getByRole('radiogroup', { name: 'Posición de las notificaciones' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    for (const [label, position] of [
      ['Arriba a la izquierda', 'top-start'],
      ['Arriba a la derecha', 'top-end'],
      ['Abajo a la izquierda', 'bottom-start'],
      ['Abajo a la derecha', 'bottom-end'],
    ]) {
      await user.click(within(group).getByRole('radio', { name: label }));
      expect(update).toHaveBeenLastCalledWith({ toastPosition: position });
      const region = screen.getByRole('region', { name: 'Mostrar vista previa' });
      expect(region).toHaveAttribute('data-position', position);
      expect(within(region).getAllByRole('status')).toHaveLength(1);
      expect(region).toHaveTextContent('Así aparecerán las notificaciones en esta posición.');
    }
    await user.click(screen.getByRole('button', { name: 'Mostrar vista previa' }));
    const region = screen.getByRole('region', { name: 'Mostrar vista previa' });
    expect(region).toHaveAttribute('data-position', DEFAULT_THEME_SETTINGS.toastPosition);
    await user.click(within(region).getByRole('button'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retira automáticamente la vista previa después de cuatro segundos', async () => {
    vi.useFakeTimers();
    try {
      const view = renderSettings();
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar vista previa' }));
      expect(screen.getByRole('status')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('el tema se elige en un radiogrupo de ocho chips, y pulsar uno dispara update', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    const group = screen.getByRole('radiogroup', { name: 'Tema' });
    const chips = within(group).getAllByRole('radio');

    expect(chips).toHaveLength(8);
    expect(chips[0]).toHaveAccessibleName(/Automático/);

    await user.click(within(group).getByRole('radio', { name: /^Thul / }));

    expect(update).toHaveBeenCalledWith({ theme: 'thul' });
  });

  it('las variantes pertenecen al tema activo y conservan la densidad', async () => {
    const update = vi.fn();
    const user = userEvent.setup();
    renderSettings({
      theme: makeMockTheme({
        settings: { ...DEFAULT_THEME_SETTINGS, theme: 'grimorio', density: 'spacious' },
        resolved: { theme: 'grimorio', mode: 'light', themeVariant: 'classic' },
        update,
      }),
    });
    const group = screen.getByRole('radiogroup', { name: 'Variantes' });
    expect(screen.getByRole('radio', { name: 'Automático Thul' })).toHaveAttribute(
      'data-theme',
      'thul',
    );
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    const minimalist = within(group).getByRole('radio', { name: /Grimorio Minimalist/ });
    await user.hover(minimalist);
    const preview = screen.getByRole('img', { name: /Grimorio Minimalist/ });
    expect(preview).toHaveAttribute('data-theme-variant', 'minimalist');
    expect(preview).toHaveAttribute('data-mode', 'light');
    expect(preview).toHaveAttribute('data-density', 'spacious');
    expect(update).not.toHaveBeenCalled();
    await user.click(minimalist);
    expect(update).toHaveBeenCalledWith({ themeVariant: 'minimalist' });
    await user.unhover(minimalist);
    await user.tab();
    expect(screen.getByRole('img', { name: /Grimorio Original/ })).toHaveAttribute(
      'data-theme-variant',
      'classic',
    );
  });

  it('se puede elegir variantes con las flechas y restablecer solo la variante', async () => {
    const update = vi.fn();
    const user = userEvent.setup();
    renderSettings({
      theme: makeMockTheme({
        settings: { ...DEFAULT_THEME_SETTINGS, themeVariant: 'dense' },
        update,
      }),
    });
    const group = screen.getByRole('radiogroup', { name: 'Variantes' });
    const dense = within(group).getByRole('radio', { name: /Dense/ });
    act(() => dense.focus());
    await user.keyboard('{ArrowLeft}');
    expect(update).toHaveBeenCalledWith({ themeVariant: 'minimalist' });
    await user.click(screen.getByRole('button', { name: 'Restablecer Variantes' }));
    expect(update).toHaveBeenLastCalledWith({ themeVariant: 'classic' });
  });

  it('modo es el primer radiogrupo de la sección, con sus tres opciones', () => {
    renderSettings();

    const groups = screen.getAllByRole('radiogroup');

    expect(groups[0]).toHaveAccessibleName('Modo');
    expect(within(groups[0] as HTMLElement).getAllByRole('radio')).toHaveLength(3);
  });

  it('cambiar el modo dispara update', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    const group = screen.getByRole('radiogroup', { name: 'Modo' });
    await user.click(within(group).getByRole('radio', { name: 'Claro' }));

    expect(update).toHaveBeenCalledWith({ mode: 'light' });
  });

  it('la densidad son tres tarjetas y elegir una dispara update', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    const group = screen.getByRole('radiogroup', { name: 'Densidad' });

    expect(within(group).getAllByRole('radio')).toHaveLength(3);

    await user.click(within(group).getByRole('radio', { name: 'Compacto' }));

    expect(update).toHaveBeenCalledWith({ density: 'compact' });
  });

  it('las dos fuentes se eligen en fichas, cada una con su familia', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    const ui = screen.getByRole('radiogroup', { name: 'Fuente de interfaz' });
    const code = screen.getByRole('radiogroup', { name: 'Fuente de código' });

    expect(within(ui).getAllByRole('radio')).toHaveLength(5);
    expect(within(code).getAllByRole('radio')).toHaveLength(4);

    await user.click(within(ui).getByRole('radio', { name: 'Inter' }));
    expect(update).toHaveBeenCalledWith({ uiFont: 'inter' });

    await user.click(within(code).getByRole('radio', { name: 'Fira Code' }));
    expect(update).toHaveBeenCalledWith({ codeFont: 'fira-code' });
  });

  it('Apariencia omite el selector y la maqueta de controles de ventana', () => {
    const { container } = renderSettings();

    expect(
      screen.queryByRole('radiogroup', { name: 'Lado de los controles de ventana' }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('[data-control]')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Densidad' })).toBeInTheDocument();
  });

  it('pasar el puntero por un chip enseña ese tema en la maqueta sin aplicarlo', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    expect(screen.getByRole('img', { name: /Thul/ })).toBeInTheDocument();

    const group = screen.getByRole('radiogroup', { name: 'Tema' });
    await user.hover(within(group).getByRole('radio', { name: /Grimorio/ }));

    expect(screen.getByRole('img', { name: /Grimorio/ })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    await user.unhover(within(group).getByRole('radio', { name: /Grimorio/ }));

    expect(screen.getByRole('img', { name: /Thul/ })).toBeInTheDocument();
  });

  it('ninguna ficha de Apariencia desplaza la interfaz al pasar el puntero', () => {
    renderSettings();

    for (const name of ['Tema', 'Densidad', 'Fuente de interfaz'] as const) {
      const group = screen.getByRole('radiogroup', { name });

      for (const option of within(group).getAllByRole('radio')) {
        expectNoHoverShift(option);
      }
    }
  });

  /*
   * CU-4 del subplan: el tamaño se escribe al soltar. Es lo que evita que arrastrar
   * el deslizador re-maquete la sección que lo contiene y el control se vaya de
   * debajo del cursor. **Ni siquiera con una pausa larga a mitad del arrastre**: el
   * rebote es para el campo numérico, no para el arrastre.
   */
  it('el deslizador de tamaño no escribe mientras se arrastra, sino al soltar', () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });

    renderSettings({ theme });

    const slider = screen.getByRole('slider', { name: 'Tamaño de interfaz' });

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '17' } });
    fireEvent.change(slider, { target: { value: '18' } });

    expect(update).not.toHaveBeenCalled();
    expect(slider).toHaveValue('18');

    fireEvent.pointerUp(window);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ uiFontSize: 18 });
  });

  it('soltar el arrastre fuera del deslizador también lo escribe', () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });

    renderSettings({ theme });

    const slider = screen.getByRole('slider', { name: 'Tamaño de código' });

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '20' } });
    // El botón se suelta con el puntero ya fuera del control.
    fireEvent.pointerUp(document.body);

    expect(update).toHaveBeenCalledWith({ codeFontSize: 20 });
  });

  it('un tamaño predefinido se aplica en el acto', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    const [uiPresets] = screen.getAllByRole('radiogroup', { name: 'Tamaños predefinidos' });
    await user.click(within(uiPresets as HTMLElement).getByRole('radio', { name: '16 px' }));

    expect(update).toHaveBeenCalledWith({ uiFontSize: 16 });
  });

  it('cada bloque restablece solo lo suyo, y se apaga si ya está de fábrica', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({
      settings: { ...DEFAULT_THEME_SETTINGS, theme: 'thul' },
      update,
    });
    const user = userEvent.setup();

    renderSettings({ theme });

    // El tema está cambiado: su botón puede restablecerlo y toca un solo campo.
    await user.click(screen.getByRole('button', { name: 'Restablecer Tema' }));
    expect(update).toHaveBeenCalledWith({ theme: DEFAULT_THEME_SETTINGS.theme });

    // La densidad no está cambiada, así que no hay nada que restablecer.
    expect(screen.getByRole('button', { name: 'Restablecer Densidad' })).toBeDisabled();
  });

  it('la fuente y su tamaño se restablecen por separado', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({
      settings: { ...DEFAULT_THEME_SETTINGS, uiFont: 'inter', uiFontSize: 18 },
      update,
    });
    const user = userEvent.setup();

    renderSettings({ theme });

    await user.click(screen.getByRole('button', { name: 'Restablecer Fuente de interfaz' }));
    expect(update).toHaveBeenCalledWith({ uiFont: DEFAULT_THEME_SETTINGS.uiFont });

    await user.click(screen.getByRole('button', { name: 'Restablecer Tamaño de interfaz' }));
    expect(update).toHaveBeenCalledWith({ uiFontSize: DEFAULT_THEME_SETTINGS.uiFontSize });
  });

  it('cada sección del rail lleva su icono', () => {
    renderSettings();

    const nav = screen.getByRole('navigation', { name: 'Secciones de configuraciones' });

    for (const tab of within(nav).getAllByRole('tab')) {
      expect(tab.querySelector('svg')).not.toBeNull();
    }
  });

  it('restablecer la sección de apariencia llama update con los valores de fábrica', async () => {
    const update = vi.fn();
    const theme = makeMockTheme({ update });
    const user = userEvent.setup();

    renderSettings({ theme });

    await user.click(screen.getByRole('button', { name: 'Restablecer sección' }));

    expect(update).toHaveBeenCalledWith(DEFAULT_THEME_SETTINGS);
  });

  it('navegar a Git muestra la sección de perfiles', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('tab', { name: 'Git, perfiles y llaves' }));

    expect(screen.getByRole('button', { name: 'Agregar perfil' })).toBeInTheDocument();
  });

  it('añadir un perfil crea una entrada editable', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('tab', { name: 'Git, perfiles y llaves' }));
    await user.click(screen.getByRole('button', { name: 'Agregar perfil' }));

    // Hay un campo de nombre visible para editar
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toBeInTheDocument();
  });

  it('la tabla de atajos se alimenta del registro de gestos', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('tab', { name: 'Atajos' }));

    const table = screen.getByRole('table', { name: 'Tabla de atajos de teclado' });
    expect(table).toBeInTheDocument();
    expect(within(table).getByText('Generales')).toBeInTheDocument();
    expect(within(table).getByText('En GitWorking')).toBeInTheDocument();
    expect(within(table).getByText('Crear una rama')).toBeInTheDocument();
    expect(within(table).queryByText(/una-rama-de-prueba/)).not.toBeInTheDocument();
    expect(within(table).queryByText('Apoyar a GitThul')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });
});

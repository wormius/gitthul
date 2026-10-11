import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';

import { APP_SITE_URL } from '../metadata';
import { PortsContext } from '../PortsContext';
import { useShellStore } from '../shellStore';
import { AboutPanel } from './AboutPanel';

/** Un `LinkPort` que anota a dónde se habría salido, sin salir a ninguna parte. */
function makePorts(): AppPorts & { opened: string[] } {
  const opened: string[] = [];

  return {
    ...selectPorts(),
    opened,
    link: {
      checkRelease: () => Promise.resolve({ status: 'current' }),
      openExternal: (url) => {
        opened.push(url);

        return Promise.resolve();
      },
    },
  };
}

function renderAbout(ports: AppPorts) {
  return render(
    <PortsContext value={ports}>
      <ThemeProvider initialSettings={{ theme: 'thul', mode: 'dark' }}>
        <I18nProvider initialLocale="es-MX">
          <AboutPanel />
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );
}

beforeEach(() => {
  useShellStore.getState().reset();
});

describe('AboutPanel', () => {
  it('no se ve mientras la superposición no sea la suya', () => {
    renderAbout(makePorts());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dice la versión, la licencia y el aviso de marca no registrada', async () => {
    useShellStore.getState().setOverlay('about');
    renderAbout(makePorts());

    const dialog = await screen.findByRole('dialog', { name: 'Acerca de GitThul' });

    expect(within(dialog).getByText(/^GitThul™ \d+\.\d+\.\d+/)).toBeInTheDocument();
    expect(within(dialog).getByText('Licencia MIT')).toBeInTheDocument();
    expect(
      within(dialog).getByText('GitThul y su logotipo se usan como marcas no registradas (™).'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Cliente gráfico de Git, tentacular, arcano y de código abierto.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Logotipo de GitThul' })).toBeInTheDocument();
  });

  /*
   * El sitio solo se abre por LinkPort después de una acción explícita.
   */
  it('abre el sitio solo al pulsarlo y no ofrece un repositorio público supuesto', async () => {
    const user = userEvent.setup();
    const ports = makePorts();

    useShellStore.getState().setOverlay('about');
    renderAbout(ports);

    const dialog = await screen.findByRole('dialog', { name: 'Acerca de GitThul' });

    expect(ports.opened).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Sitio del proyecto' }));
    expect(within(dialog).queryByRole('button', { name: 'Código fuente' })).not.toBeInTheDocument();

    expect(ports.opened).toEqual([APP_SITE_URL]);
  });

  it('se cierra y deja la superposición donde estaba', async () => {
    const user = userEvent.setup();

    useShellStore.getState().setOverlay('about');
    renderAbout(makePorts());

    await user.click(await screen.findByRole('button', { name: 'Cerrar «Acerca de»' }));

    expect(useShellStore.getState().overlay).toBe('none');
  });
});

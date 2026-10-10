import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { CollapsibleRail, type RailSection } from './CollapsibleRail';

function DotIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" />;
}

const sections: readonly RailSection[] = [
  { key: 'local', label: 'Locales', icon: <DotIcon />, children: <p>main y dev</p> },
  { key: 'tags', label: 'Tags', icon: <DotIcon />, children: <p>v0.1.0</p> },
];

function Harness({ initial = false }: { initial?: boolean }) {
  const [collapsed, setCollapsed] = useState(initial);

  return (
    <CollapsibleRail
      label="Referencias de gitthul"
      sections={sections}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      collapseLabel="Colapsar el panel de referencias"
      expandLabel="Desplegar el panel de referencias"
    />
  );
}

describe('CollapsibleRail', () => {
  it('desplegado enseña todas las secciones a la vez', () => {
    render(<Harness />);

    expect(screen.getByRole('region', { name: 'Referencias de gitthul' })).toBeInTheDocument();
    expect(screen.getByText('main y dev')).toBeInTheDocument();
    expect(screen.getByText('v0.1.0')).toBeInTheDocument();
  });

  it('plegado deja una tira de iconos y esconde el contenido', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Colapsar el panel de referencias' }));

    expect(screen.getByRole('toolbar', { name: 'Referencias de gitthul' })).toBeInTheDocument();
    expect(screen.queryByText('main y dev')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Locales' })).toBeInTheDocument();
  });

  it('plegado, cada sección se abre en flotante sin ensanchar la tira', async () => {
    const user = userEvent.setup();

    render(<Harness initial />);

    const rail = screen.getByRole('toolbar', { name: 'Referencias de gitthul' });
    const before = rail.getBoundingClientRect();

    await user.click(screen.getByRole('button', { name: 'Locales' }));

    const flyout = screen.getByRole('dialog', { name: 'Locales' });

    expect(flyout).toHaveTextContent('main y dev');
    // El flotante vive en un portal sobre `body`, no dentro de la tira.
    expect(rail).not.toContainElement(flyout);
    expect(rail.getBoundingClientRect().width).toBe(before.width);
  });

  it('solo hay un desplegable abierto a la vez', async () => {
    const user = userEvent.setup();

    render(<Harness initial />);

    await user.click(screen.getByRole('button', { name: 'Locales' }));
    await user.click(screen.getByRole('button', { name: 'Tags' }));

    expect(screen.queryByRole('dialog', { name: 'Locales' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Tags' })).toBeInTheDocument();
  });

  it('el icono anuncia si su desplegable está abierto', async () => {
    const user = userEvent.setup();

    render(<Harness initial />);

    const trigger = screen.getByRole('button', { name: 'Locales' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(screen.getByRole('button', { name: 'Locales' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('desplegar cierra lo que estuviera flotando', async () => {
    const user = userEvent.setup();

    render(<Harness initial />);

    await user.click(screen.getByRole('button', { name: 'Locales' }));
    await user.click(screen.getByRole('button', { name: 'Desplegar el panel de referencias' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('main y dev')).toBeInTheDocument();
  });

  it('avisa del cambio de estado hacia fuera', async () => {
    const onCollapsedChange = vi.fn();
    const user = userEvent.setup();

    render(
      <CollapsibleRail
        label="Referencias de gitthul"
        sections={sections}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        collapseLabel="Colapsar el panel de referencias"
        expandLabel="Desplegar el panel de referencias"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Colapsar el panel de referencias' }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('puede integrar el control de plegado en el contenido de cabecera', () => {
    render(
      <CollapsibleRail
        label="Referencias de gitthul"
        sections={sections}
        collapsed={false}
        onCollapsedChange={() => {}}
        collapseLabel="Colapsar el panel de referencias"
        expandLabel="Desplegar el panel de referencias"
        header={<div>Card de gitthul</div>}
        collapseControlInHeader
      />,
    );

    const region = screen.getByRole('region', { name: 'Referencias de gitthul' });

    expect(within(region).queryByRole('heading', { name: 'Referencias de gitthul' })).toBeNull();
    expect(within(region).getByText('Card de gitthul')).toBeInTheDocument();
    expect(
      within(region).getByRole('button', { name: 'Colapsar el panel de referencias' }),
    ).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Harness />);

    expectNoHoverShift(screen.getByRole('region', { name: 'Referencias de gitthul' }));
  });

  describe('secciones colapsables', () => {
    function CollapsibleHarness() {
      const [localCollapsed, setLocalCollapsed] = useState(false);
      const [tagsCollapsed, setTagsCollapsed] = useState(true);

      const collapsibleSections: RailSection[] = [
        {
          key: 'local',
          label: 'Locales',
          icon: <DotIcon />,
          count: 3,
          collapsed: localCollapsed,
          onToggleCollapsed: () => {
            setLocalCollapsed((c) => !c);
          },
          collapseLabel: 'Plegar Locales',
          expandLabel: 'Desplegar Locales',
          children: <p>main y dev</p>,
        },
        {
          key: 'tags',
          label: 'Tags',
          icon: <DotIcon />,
          count: 1,
          collapsed: tagsCollapsed,
          onToggleCollapsed: () => {
            setTagsCollapsed((c) => !c);
          },
          collapseLabel: 'Plegar Tags',
          expandLabel: 'Desplegar Tags',
          children: <p>v0.1.0</p>,
        },
      ];

      return (
        <CollapsibleRail
          label="Referencias"
          sections={collapsibleSections}
          collapsed={false}
          onCollapsedChange={() => {}}
          collapseLabel="Colapsar"
          expandLabel="Desplegar"
        />
      );
    }

    it('muestra el contador en la cabecera de sección', () => {
      render(<CollapsibleHarness />);

      const btn = screen.getByRole('button', { name: 'Plegar Locales' });

      expect(btn.textContent).toContain('3');
    });

    it('una sección colapsada oculta su contenido', () => {
      render(<CollapsibleHarness />);

      // Tags arranca colapsado
      expect(screen.queryByText('v0.1.0')).not.toBeInTheDocument();
      // Locales arranca desplegado
      expect(screen.getByText('main y dev')).toBeInTheDocument();
    });

    it('clic en la cabecera alterna el colapsado', async () => {
      const user = userEvent.setup();

      render(<CollapsibleHarness />);

      // Plegar Locales
      await user.click(screen.getByRole('button', { name: 'Plegar Locales' }));

      expect(screen.queryByText('main y dev')).not.toBeInTheDocument();
      // El botón ahora dice desplegar
      expect(screen.getByRole('button', { name: 'Desplegar Locales' })).toBeInTheDocument();
    });

    it('aria-expanded refleja el estado', () => {
      render(<CollapsibleHarness />);

      expect(screen.getByRole('button', { name: 'Plegar Locales' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Desplegar Tags' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('el hover no desplaza la cabecera colapsable', () => {
      render(<CollapsibleHarness />);

      const region = screen.getByRole('region', { name: 'Referencias' });

      expectNoHoverShift(region);
    });
  });
});

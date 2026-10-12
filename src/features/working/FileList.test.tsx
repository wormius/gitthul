import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { FileChange } from '@core/domain/status';
import { I18nProvider } from '@i18n/I18nProvider';
import { useVirtualViewport } from '../../test/virtualViewport';

import { FileList } from './FileList';

const file: FileChange = {
  path: 'src/design/roles.css',
  change: 'modified',
  binary: false,
  insertions: 2,
  deletions: 1,
};

function renderList(view: 'flat' | 'tree') {
  return render(
    <I18nProvider initialLocale="es-MX">
      <FileList
        label="Archivos"
        files={[file]}
        view={view}
        sort="path"
        filter=""
        selected={new Set()}
        onSelectedChange={() => {}}
        menuFor={() => ({ items: [], label: 'Archivo' })}
        empty="Sin archivos"
      />
    </I18nProvider>,
  );
}

function renderFiles(files: readonly FileChange[]) {
  return render(
    <I18nProvider initialLocale="es-MX">
      <FileList
        label="Archivos"
        files={files}
        view="flat"
        sort="path"
        filter=""
        selected={new Set()}
        onSelectedChange={() => {}}
        menuFor={() => ({ items: [], label: 'Archivo' })}
        empty="Sin archivos"
      />
    </I18nProvider>,
  );
}

function ExpansionHarness({ initialExpanded = false }: { initialExpanded?: boolean }) {
  const [treeExpanded, setTreeExpanded] = useState(initialExpanded);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [, setRevision] = useState(0);

  return (
    <I18nProvider initialLocale="es-MX">
      <button onClick={() => setTreeExpanded((current) => !current)}>Alternar todo</button>
      <button onClick={() => setRevision((current) => current + 1)}>Actualizar archivos</button>
      <FileList
        label="Archivos"
        files={[
          { ...file, path: 'src/app/main.ts' },
          { ...file, path: 'src/core/git.ts' },
          { ...file, path: 'docs/ayuda.md' },
        ]}
        view="tree"
        sort="path"
        filter=""
        selected={selected}
        onSelectedChange={setSelected}
        menuFor={() => ({ items: [], label: 'Archivo' })}
        empty="Sin archivos"
        treeExpanded={treeExpanded}
      />
    </I18nProvider>
  );
}

describe('FileList', () => {
  useVirtualViewport();

  it('en árbol enseña solo el basename porque las carpetas ya expresan la ruta', () => {
    renderList('tree');

    expect(screen.getByText('roles.css')).toBeInTheDocument();
    expect(screen.queryByText('src/design/')).not.toBeInTheDocument();
  });

  it('en lista plana conserva el directorio para distinguir rutas repetidas', () => {
    renderList('flat');

    expect(screen.getByText('src/design/')).toBeInTheDocument();
    expect(screen.getByText('roles.css')).toBeInTheDocument();
  });

  it('el nombre alterna solo su carpeta y conserva las demás expansiones al actualizar archivos', async () => {
    const user = userEvent.setup();
    render(<ExpansionHarness />);

    await user.click(screen.getByRole('treeitem', { name: /^src/ }).firstElementChild!);
    await user.click(screen.getByRole('treeitem', { name: /^app/ }).firstElementChild!);
    await user.click(screen.getByRole('treeitem', { name: /^core/ }).firstElementChild!);

    await user.click(screen.getByText('app'));

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /^app/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('treeitem', { name: /^core/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
    expect(screen.getByText('git.ts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actualizar archivos' }));
    await user.click(screen.getByText('git.ts'));

    expect(screen.getByRole('treeitem', { name: /^src/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /^app/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('treeitem', { name: /^core/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(screen.getByText('app'));
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('git.ts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Alternar todo' }));
    expect(screen.getByText('ayuda.md')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Alternar todo' }));
    expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('git.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('ayuda.md')).not.toBeInTheDocument();
  });

  it('con todo abierto conserva los plegados locales al seleccionar y refrescar', async () => {
    const user = userEvent.setup();
    render(<ExpansionHarness initialExpanded />);

    await user.click(screen.getByText('app'));
    await user.click(screen.getByText('git.ts'));
    await user.click(screen.getByRole('button', { name: 'Actualizar archivos' }));

    expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
    expect(screen.getByText('git.ts')).toBeInTheDocument();
    expect(screen.getByText('ayuda.md')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /^app/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('no pinta +0 −0 en los archivos sin cambios de «Ver todos»', () => {
    renderFiles([
      {
        path: 'README.md',
        change: 'unmodified',
        binary: false,
        insertions: 0,
        deletions: 0,
      },
    ]);

    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.queryByText('−0')).not.toBeInTheDocument();
  });

  it('omite la cifra imposible en archivos añadidos y borrados', () => {
    renderFiles([
      { path: 'nuevo.ts', change: 'added', binary: false, insertions: 8, deletions: 0 },
      { path: 'viejo.ts', change: 'deleted', binary: false, insertions: 0, deletions: 5 },
    ]);

    expect(screen.getByText('+8')).toBeInTheDocument();
    expect(screen.getByText('−5')).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.queryByText('−0')).not.toBeInTheDocument();
  });
});

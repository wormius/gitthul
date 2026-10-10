import { render, screen } from '@testing-library/react';
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

import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockSystemPort } from '@core/adapters/mock/mockSystemPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { selectPorts } from '@core/adapters/selectPorts';
import { I18nProvider } from '@i18n/I18nProvider';

import { ResolutionReview } from './ResolutionReview';
import { ResolvedResult } from './ResolvedResult';

describe('Portapapeles de las vistas de resultado de Resolver', () => {
  it.each(['resuelto', 'revisión'] as const)(
    '%s copia selección y todo el documento sin incluir marcas ni títulos',
    async (panel) => {
      const user = userEvent.setup();
      const ports = {
        ...selectPorts(),
        git: createMockGitPort({ latency: NO_LATENCY }),
        system: createMockSystemPort(),
      };
      const copy = vi.spyOn(ports.system, 'writeClipboardText');
      vi.spyOn(ports.git, 'readConflict').mockResolvedValue({
        path: 'file.ts',
        kind: 'bothModified',
        base: 'inicio\nantes',
        ours: 'inicio\nantes',
        theirs: 'inicio\ndespués',
        oursLabel: 'main',
        theirsLabel: 'feature',
        sizes: { ours: { bytes: 12, lines: 2 }, theirs: { bytes: 15, lines: 2 } },
        binary: false,
        tooLarge: false,
      });
      const text = panel === 'resuelto' ? 'inicio\r\ndespués\t中' : 'inicio\ndespués\t中';
      render(
        <PortsContext value={ports}>
          <I18nProvider initialLocale="es-MX">
            {panel === 'resuelto' ? (
              <ResolvedResult
                path="file.ts"
                result={text}
                origins={['context', 'ours']}
                sources={{ ours: 'main', theirs: 'feature' }}
                onClose={() => undefined}
              />
            ) : (
              <ResolutionReview
                repoId="bitacora"
                path="file.ts"
                result={text}
                onBack={() => undefined}
                onMarkResolved={() => undefined}
              />
            )}
          </I18nProvider>
        </PortsContext>,
      );
      const editor = await screen.findByRole('textbox');
      const view = EditorView.findFromDOM(editor)!;
      act(() => view.dispatch({ selection: { anchor: 0, head: 6 } }));
      fireEvent.contextMenu(editor);
      await user.click(screen.getByRole('menuitem', { name: /Copiar selección/ }));
      expect(copy).toHaveBeenLastCalledWith('inicio');
      expect(editor).toHaveFocus();
      fireEvent.contextMenu(editor);
      await user.click(screen.getByRole('menuitem', { name: /Seleccionar todo/ }));
      fireEvent.keyDown(editor, { key: 'c', ctrlKey: true });
      const expected = panel === 'resuelto' ? text : 'inicio\nantes\ndespués\t中';
      expect(copy).toHaveBeenLastCalledWith(expected);
      expect(view.state.selection.main.to).toBe(view.state.doc.length);
      fireEvent.copy(editor);
      expect(copy).toHaveBeenLastCalledWith(expected);
      expect(copy).toHaveBeenCalledTimes(3);
    },
  );
});

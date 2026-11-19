import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GestureContext } from '@app/GestureContext';
import { createGestureRegistry } from '@app/gestures';
import { PortsContext } from '@app/PortsContext';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { selectPorts } from '@core/adapters/selectPorts';
import type { ConflictContents } from '@core/domain/status';
import { I18nProvider } from '@i18n/I18nProvider';

import { ThreeWayResolver } from './ThreeWayResolver';
import { useResolveStore } from './resolveStore';

const PATH = 'file.ts';
const CONFLICT: ConflictContents = {
  path: PATH,
  kind: 'bothModified',
  base: 'before 1\ncontext\nbefore 2\n',
  ours: 'ours 1\ncontext\nours 2\n',
  theirs: 'theirs 1\ncontext\ntheirs 2\n',
  oursLabel: 'main',
  theirsLabel: 'feature',
  sizes: { ours: { bytes: 22, lines: 3 }, theirs: { bytes: 26, lines: 3 } },
  binary: false,
  tooLarge: false,
  revision: 'original',
};

beforeEach(() => {
  useResolveStore.getState().unload();
  useResolveStore.getState().openFile(PATH);
});

function mountResolver(conflict: ConflictContents, onFinish = vi.fn()) {
  const ports = { ...selectPorts(), git: createMockGitPort({ latency: NO_LATENCY }) };
  vi.spyOn(ports.git, 'readConflict').mockResolvedValue(conflict);
  return render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <GestureContext value={createGestureRegistry([], 'linux')}>
          <ThreeWayResolver
            repoId="bitacora"
            path={PATH}
            onFinish={onFinish}
            onCancel={() => useResolveStore.getState().closeFile()}
            onKeepSide={() => undefined}
          />
        </GestureContext>
      </I18nProvider>
    </PortsContext>,
  );
}

describe('borradores del resolutor', () => {
  it('resuelve un archivo pequeño de Windows por su línea conflictiva y conserva bytes al guardar', async () => {
    const base = 'cabecera\nuno\ndos\ntres\ncuatro\ncinco\nfin\n';
    const ours = base.replace('uno', 'UNO').replaceAll('\n', '\r\n');
    const theirs = base.replace('cinco', 'CINCO');
    const onFinish = vi.fn();
    mountResolver({ ...CONFLICT, base, ours, theirs }, onFinish);
    await screen.findByRole('textbox', { name: 'Resultado' });
    expect(screen.getByText('Bloque 1 de 1')).toBeVisible();
    expect(screen.getAllByLabelText(/Agregar la línea/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: '1 conflictos por resolver' })).toBeDisabled();

    const controls = screen.getAllByRole('checkbox', { name: 'Agregar el bloque 1 completo' });
    fireEvent.click(controls[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resuelto' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish.mock.calls[0]?.[0]).toBe(ours.replace('cinco\r\n', 'CINCO\n'));
    expect(onFinish.mock.calls[0]?.[3]).toBe(CONFLICT.revision);
  });

  it('reabrir conserva texto por bloque y posición incluso durante la nueva lectura', async () => {
    const first = mountResolver(CONFLICT);
    await screen.findByRole('textbox', { name: 'Resultado' });
    act(() => {
      const state = useResolveStore.getState();
      state.setBlockSide('ours', state.blockIds[0]!, true);
      state.setBlockText(state.blockIds[1]!, 'mi solución');
      state.setBlockIndex(1);
      state.closeFile();
    });
    first.unmount();
    act(() => useResolveStore.getState().openFile(PATH));
    mountResolver(CONFLICT);
    await screen.findByRole('textbox', { name: 'Resultado' });
    expect(screen.getByText('Bloque 2 de 2')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Resultado' })).toHaveTextContent('mi solución');
    expect(useResolveStore.getState().choices.size).toBe(1);
  });

  it('releer otra revisión retira el borrador antes de ofrecer marcarlo como resuelto', async () => {
    const first = mountResolver(CONFLICT);
    await screen.findByRole('textbox', { name: 'Resultado' });
    act(() => {
      useResolveStore.getState().setManual(PATH, 'resolución antigua');
      useResolveStore.getState().closeFile();
    });
    first.unmount();
    act(() => useResolveStore.getState().openFile(PATH));
    mountResolver({ ...CONFLICT, revision: 'changed', ours: 'new ours\ncontext\nours 2\n' });
    await screen.findByRole('textbox', { name: 'Resultado' });
    await waitFor(() => expect(useResolveStore.getState().manual.has(PATH)).toBe(false));
    expect(screen.getByRole('button', { name: /conflictos por resolver$/ })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Resultado' })).not.toHaveTextContent(
      'resolución antigua',
    );
  });
});

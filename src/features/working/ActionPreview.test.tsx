import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@i18n/I18nProvider';
import { DragLayer } from '@ui/DragLayer';

import { ActionPreview } from './ActionPreview';
import type { ActionPreviewState } from './workingStore';
import { useWorkingStore } from './workingStore';

/**
 * Un envolvente mínimo para que `ActionPreview` encuentre su contexto.
 *
 * No se prueban los puertos de verdad: `useAsyncData` va a fallar sin un
 * provider de puertos real, y eso está bien — lo que se comprueba aquí es la
 * lógica del componente: qué botones salen según la oferta y que "Comparar"
 * abre la comparación.
 */

vi.mock('@app/PortsContext', () => {
  const git = {
    integrationWritesAvailable: true,
    previewIntegration: vi.fn().mockResolvedValue({
      kind: 'merge',
      source: 'feature',
      target: 'main',
      commits: [{ sha: 'abc', summary: 'uno' }],
      fastForward: false,
      conflicts: null,
      precondition: {
        sourceRef: 'feature',
        targetRef: 'main',
        sourceOid: 'a'.repeat(40),
        targetOid: 'b'.repeat(40),
      },
    }),
  };
  return { usePorts: () => ({ git }) };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider initialLocale="es-MX">
      <DragLayer>{children}</DragLayer>
    </I18nProvider>
  );
}

const fullState: ActionPreviewState = {
  kind: 'merge',
  source: { kind: 'branch', name: 'feature' },
  target: { kind: 'branch', name: 'main' },
  headBranch: 'main',
};

const compareOnlyState: ActionPreviewState = {
  kind: 'merge',
  source: { kind: 'tag', name: 'v1.0.0' },
  target: { kind: 'branch', name: 'main' },
  headBranch: 'main',
};

const nonHeadTargetState: ActionPreviewState = {
  kind: 'merge',
  source: { kind: 'branch', name: 'main', ref: 'refs/heads/main' },
  target: { kind: 'branch', name: 'origin/dev', ref: 'refs/remotes/origin/dev' },
  headBranch: 'main',
};

describe('ActionPreview', () => {
  it('habilita merge y rebase solo después de cargar la precondición real', async () => {
    const onMerge = vi.fn();
    render(
      <ActionPreview state={fullState} repoId="repo-1" onMerge={onMerge} onRebase={vi.fn()} />,
      { wrapper },
    );

    // El botón de fusionar tiene el texto con los nombres de las ramas.
    expect(screen.getByText(/Hacer merge de feature en main/)).toBeInTheDocument();
    expect(screen.getByText(/Hacer rebase de main sobre feature/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Hacer merge/ })).toBeEnabled());
    expect(screen.getByRole('button', { name: /Hacer rebase/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Hacer merge/ }));
    expect(onMerge).toHaveBeenCalledWith('feature', 'main', {
      sourceRef: 'feature',
      targetRef: 'main',
      sourceOid: 'a'.repeat(40),
      targetOid: 'b'.repeat(40),
    });
    expect(screen.getByText('Comparar')).toBeInTheDocument();
    expect(screen.getByText('Cancelar')).toBeInTheDocument();
  });

  it('solo muestra Comparar y Cancelar cuando la oferta es compare-only', () => {
    render(
      <ActionPreview
        state={compareOnlyState}
        repoId="repo-1"
        onMerge={vi.fn()}
        onRebase={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.queryByText(/Hacer merge/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hacer rebase/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comparar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('un destino que no es HEAD solo ofrece comparar aunque ambas refs sean ramas', () => {
    render(
      <ActionPreview
        state={nonHeadTargetState}
        repoId="repo-1"
        onMerge={vi.fn()}
        onRebase={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.queryByRole('button', { name: /Hacer merge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hacer rebase/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Comparar' })).toBeInTheDocument();
  });

  it('conserva rebase como operación solicitada en el título', () => {
    render(
      <ActionPreview
        state={{ ...fullState, kind: 'rebase' }}
        repoId="repo-1"
        onMerge={vi.fn()}
        onRebase={vi.fn()}
      />,
      { wrapper },
    );

    expect(
      screen.getByRole('dialog', { name: 'Rebase de main sobre feature' }),
    ).toBeInTheDocument();
  });

  it('Comparar abre la comparación en el store y cierra el panel', () => {
    render(
      <ActionPreview state={fullState} repoId="repo-1" onMerge={vi.fn()} onRebase={vi.fn()} />,
      { wrapper },
    );

    fireEvent.click(screen.getByText('Comparar'));

    const state = useWorkingStore.getState();

    expect(state.compare).toEqual({
      kind: 'refs',
      source: { ref: 'refs/heads/feature', label: 'feature' },
      target: { ref: 'refs/heads/main', label: 'main' },
    });
    expect(state.actionPreview).toBe(null);
  });

  it('al comparar una rama remota conserva su identidad completa', () => {
    render(
      <ActionPreview
        state={nonHeadTargetState}
        repoId="repo-1"
        onMerge={vi.fn()}
        onRebase={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(useWorkingStore.getState().compare).toEqual({
      kind: 'refs',
      source: { ref: 'refs/heads/main', label: 'main' },
      target: { ref: 'refs/remotes/origin/dev', label: 'origin/dev' },
    });
  });

  it('distingue un tag y una rama con el mismo nombre en la comparación', () => {
    render(
      <ActionPreview
        state={{
          ...compareOnlyState,
          source: { kind: 'tag', name: 'main' },
        }}
        repoId="repo-1"
        onMerge={vi.fn()}
        onRebase={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(useWorkingStore.getState().compare).toEqual({
      kind: 'refs',
      source: { ref: 'refs/tags/main', label: 'main' },
      target: { ref: 'refs/heads/main', label: 'main' },
    });
  });

  it('Cancelar cierra el panel', () => {
    useWorkingStore.getState().openActionPreview(fullState);
    render(
      <ActionPreview state={fullState} repoId="repo-1" onMerge={vi.fn()} onRebase={vi.fn()} />,
      { wrapper },
    );

    fireEvent.click(screen.getByText('Cancelar'));

    expect(useWorkingStore.getState().actionPreview).toBe(null);
  });
});

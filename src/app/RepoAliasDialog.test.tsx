import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { selectPorts } from '@core/adapters/selectPorts';
import { DEFAULT_LIBRARY } from '@core/domain/library';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { useRepositoryName } from '@features/repositories/useRepositoryName';
import { I18nProvider } from '@i18n/I18nProvider';

import { PortsContext } from './PortsContext';
import { RepoAliasDialog } from './RepoAliasDialog';

const repo = { id: 'repo', name: 'original' };
function Label() {
  return <output>{useRepositoryName(repo.id, repo.name)}</output>;
}
function setup(current: string | null = null) {
  const library = createMockLibraryPort();
  const save = vi.spyOn(library, 'setAlias');
  const onClose = vi.fn();
  const view = render(
    <PortsContext value={{ ...selectPorts(), library }}>
      <I18nProvider initialLocale="en">
        <Label />
        <RepoAliasDialog repo={repo} current={current} onClose={onClose} />
      </I18nProvider>
    </PortsContext>,
  );
  return { ...view, save, onClose, library };
}

beforeEach(() => useRepositoriesStore.getState().reset());

describe('RepoAliasDialog', () => {
  it('publishes the new label only after persistence and blocks duplicate saves', async () => {
    const { save, onClose } = setup();
    let finish!: (value: typeof DEFAULT_LIBRARY) => void;
    save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('original');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ...DEFAULT_LIBRARY, aliases: { repo: 'Project' } });
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Project');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps a failed draft editable and allows retrying without changing the current label', async () => {
    const user = userEvent.setup();
    const { save, onClose } = setup();
    save.mockRejectedValueOnce(new Error('Permission denied'));
    await user.type(screen.getByRole('textbox'), 'Project');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the alias');
    expect(screen.getByRole('status')).toHaveTextContent('original');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Project');
  });

  it('clears the alias with an empty draft', async () => {
    const user = userEvent.setup();
    useRepositoriesStore
      .getState()
      .setLibrary({ ...DEFAULT_LIBRARY, aliases: { repo: 'Project' } });
    const { library, onClose } = setup('Project');
    await library.setAlias(repo.id, 'Project');
    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect((await library.read()).aliases).toEqual({});
    expect(screen.getByRole('status')).toHaveTextContent('original');
  });

  it('does not save an unconfirmed draft or submit during IME composition', async () => {
    const user = userEvent.setup();
    const { save, onClose } = setup();
    await user.type(screen.getByRole('textbox'), 'Draft');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
});

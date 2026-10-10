import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import type { CommitPage } from '@core/domain/commit';
import type { GitPort } from '@core/ports/GitPort';
import { useCommitPages } from './useCommitPages';

describe('useCommitPages', () => {
  it('no consulta sin repositorio y cancela páginas antiguas al refrescar', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const page = await git.readCommits('gitthul', { limit: 2 });
    let finishOldPage: ((page: CommitPage) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const readCommits = vi.fn<GitPort['readCommits']>((_id, request, query) => {
      if (request?.skip) {
        oldSignal = query?.signal;
        return new Promise((resolve) => {
          finishOldPage = resolve;
        });
      }
      return Promise.resolve({ ...page, hasMore: true });
    });
    const ports = { ...selectPorts(), git: { ...git, readCommits } };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PortsContext value={ports}>{children}</PortsContext>
    );
    const { result, rerender } = renderHook<
      ReturnType<typeof useCommitPages>,
      { id: string | null }
    >(({ id }) => useCommitPages(id), {
      wrapper,
      initialProps: { id: null },
    });
    expect(readCommits).not.toHaveBeenCalled();
    rerender({ id: 'gitthul' });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => result.current.loadMore());
    expect(oldSignal?.aborted).toBe(false);
    act(() => result.current.reload({ retain: true }));
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    await act(async () => {
      finishOldPage?.({ ...page, hasMore: false });
      await Promise.resolve();
    });
    expect(result.current.state.status === 'ready' && result.current.state.commits).toEqual(
      page.commits,
    );
    act(() => result.current.loadMore());
    const last = readCommits.mock.calls.at(-1);
    expect(last?.[0]).toBe('gitthul');
    expect(last?.[1]).toEqual({ skip: page.commits.length, limit: 500 });
    expect(last?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });
});

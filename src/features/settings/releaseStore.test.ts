import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkPort, ReleaseCheck } from '@core/ports/LinkPort';

import { useReleaseStore } from './releaseStore';

const available: ReleaseCheck = {
  status: 'available',
  version: '1.1.0',
  url: 'https://github.com/wormius/gitthul/releases/tag/v1.1.0',
};

beforeEach(() => {
  useReleaseStore.setState({ check: { status: 'idle' }, availableRelease: null });
});

describe('disponibilidad de publicaciones', () => {
  it('mantiene la publicación conocida mientras consulta y si falla la red', async () => {
    let reject!: (error: Error) => void;
    const link: LinkPort = {
      openExternal: vi.fn(),
      checkRelease: vi.fn(() => Promise.resolve(available)),
    };
    await useReleaseStore.getState().checkNow(link);
    expect(useReleaseStore.getState().availableRelease).toEqual(available);

    link.checkRelease = vi.fn(
      () =>
        new Promise<ReleaseCheck>((_, fail) => {
          reject = fail;
        }),
    );
    const pending = useReleaseStore.getState().checkNow(link);
    expect(useReleaseStore.getState().check.status).toBe('checking');
    expect(useReleaseStore.getState().availableRelease).toEqual(available);
    await Promise.resolve();
    reject(new Error('HTTP 503'));
    await pending;
    expect(useReleaseStore.getState().check.status).toBe('error');
    expect(useReleaseStore.getState().availableRelease).toEqual(available);
  });

  it.each(['current', 'empty'] as const)(
    'retira el indicador tras un resultado válido %s',
    async (status) => {
      const checkRelease = vi.fn(() => Promise.resolve<ReleaseCheck>(available));
      const link: LinkPort = { checkRelease, openExternal: vi.fn() };
      await useReleaseStore.getState().checkNow(link);
      checkRelease.mockResolvedValueOnce({ status });
      await useReleaseStore.getState().checkNow(link);

      expect(useReleaseStore.getState().check).toEqual({ status });
      expect(useReleaseStore.getState().availableRelease).toBeNull();
    },
  );
});

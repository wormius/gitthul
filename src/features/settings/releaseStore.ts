import { create } from 'zustand';

import type { UpdateChannel } from '@core/domain/settings';
import { RELEASE_CHECK_CONFIGURED, type LinkPort, type ReleaseCheck } from '@core/ports/LinkPort';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking'; channel: UpdateChannel }
  | { status: 'error'; channel: UpdateChannel }
  | (ReleaseCheck & { channel: UpdateChannel });

interface ReleaseState {
  check: CheckState;
  checkNow: (link: LinkPort, channel: UpdateChannel) => Promise<void>;
}

/** Comparte el resultado entre ajustes y el aviso; descarta respuestas de otro canal. */
export const useReleaseStore = create<ReleaseState>((set, get) => {
  let revision = 0;
  let pending: Promise<void> | undefined;
  return {
    check: { status: 'notConfigured', channel: 'stable' },
    checkNow: (link, channel) => {
      if (!RELEASE_CHECK_CONFIGURED) {
        set({ check: { status: 'notConfigured', channel } });
        return Promise.resolve();
      }
      const check = get().check;
      if (check.status === 'checking' && check.channel === channel && pending) return pending;
      const request = ++revision;
      set({ check: { status: 'checking', channel } });
      pending = link.checkRelease(channel).then(
        (result) => {
          if (request === revision) set({ check: { ...result, channel } });
        },
        () => {
          if (request === revision) set({ check: { status: 'error', channel } });
        },
      );
      return pending;
    },
  };
});

import { create } from 'zustand';

import type { LinkPort, ReleaseCheck } from '@core/ports/LinkPort';

type CheckState = { status: 'idle' } | { status: 'checking' } | { status: 'error' } | ReleaseCheck;

interface ReleaseState {
  check: CheckState;
  checkNow: (link: LinkPort) => Promise<void>;
}

/** Comparte el resultado y una única consulta en curso entre ajustes y el aviso. */
export const useReleaseStore = create<ReleaseState>((set) => {
  let pending: Promise<void> | undefined;
  return {
    check: { status: 'idle' },
    checkNow: (link) => {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(() => link.checkRelease())
        .then(
          (check) => set({ check }),
          () => set({ check: { status: 'error' } }),
        )
        .finally(() => {
          pending = undefined;
        });
      set({ check: { status: 'checking' } });
      return pending;
    },
  };
});

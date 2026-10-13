import { create } from 'zustand';

import type { LinkPort, ReleaseCheck } from '@core/ports/LinkPort';

type CheckState = { status: 'idle' } | { status: 'checking' } | { status: 'error' } | ReleaseCheck;

interface ReleaseState {
  check: CheckState;
  /** Última publicación disponible; una consulta o error de red no la invalidan. */
  availableRelease: Extract<ReleaseCheck, { status: 'available' }> | null;
  checkNow: (link: LinkPort) => Promise<void>;
}

/** Comparte una única consulta y su resultado entre ajustes, aviso y barra inferior. */
export const useReleaseStore = create<ReleaseState>((set) => {
  let pending: Promise<void> | undefined;
  return {
    check: { status: 'idle' },
    availableRelease: null,
    checkNow: (link) => {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(() => link.checkRelease())
        .then(
          (check) => set({ check, availableRelease: check.status === 'available' ? check : null }),
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

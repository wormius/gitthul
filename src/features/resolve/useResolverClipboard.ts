import { useCallback } from 'react';

import { usePorts } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { useI18n } from '@i18n/useI18n';
import type { CodeSurface } from '@ui/CodeSurface';

/** Todos los editores de Resolver comparten el portapapeles nativo y sus avisos. */
export function useResolverClipboard(): NonNullable<
  Parameters<typeof CodeSurface>[0]['clipboard']
> {
  const { system } = usePorts();
  const { t } = useI18n();
  const copy = useCallback(
    (text: string) => {
      void system.writeClipboardText(text).then(
        () => useShellStore.getState().setStatus({ tone: 'success', key: 'working.status.copied' }),
        () =>
          useShellStore.getState().setStatus({ tone: 'warning', key: 'working.status.copyFailed' }),
      );
    },
    [system],
  );

  return {
    copy,
    copyLabel: t('working.diff.copySelection'),
    selectAllLabel: t('working.diff.selectAll'),
  };
}

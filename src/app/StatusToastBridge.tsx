import { useEffect } from 'react';

import type { StatusTone } from './shellStore';
import { useShellStore } from './shellStore';
import { useI18n } from '@i18n/useI18n';
import { useToast } from '@ui/useToast';
import type { ToastVariant } from '@ui/toastContext';

const VARIANT: Record<StatusTone, ToastVariant> = {
  neutral: 'info',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** Migra cada llamada existente a `setStatus` hacia la infraestructura central de avisos. */
export function StatusToastBridge() {
  const { t } = useI18n();
  const show = useToast().show;

  useEffect(
    () =>
      useShellStore.subscribe((state, previous) => {
        if (state.status === null || state.status === previous.status) return;
        show({
          message: t(state.status.key, state.status.params),
          variant: VARIANT[state.status.tone],
          ...(state.status.action
            ? {
                action: {
                  label: t(state.status.action.key, state.status.action.params),
                  onAction: state.status.action.onAction,
                },
              }
            : {}),
        });
        useShellStore.getState().clearStatus();
      }),
    [show, t],
  );

  return null;
}

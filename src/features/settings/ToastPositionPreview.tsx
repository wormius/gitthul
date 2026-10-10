import { useEffect } from 'react';

import type { ToastPosition } from '@design/theme';
import { useI18n } from '@i18n/useI18n';
import { ToastProvider } from '@ui/ToastProvider';
import { useToast } from '@ui/useToast';

function PreviewNotice() {
  const { t } = useI18n();
  const { show, dismiss } = useToast();
  const message = t('settings.appearance.toastPreviewMessage');

  useEffect(() => {
    const id = show({ message, duration: 4000 });
    return () => dismiss(id);
  }, [dismiss, message, show]);

  return null;
}

/** Usa el toast real en una región independiente del historial de operaciones. */
export function ToastPositionPreview({ position }: { position: ToastPosition }) {
  const { t } = useI18n();
  return (
    <ToastProvider
      position={position}
      regionLabel={t('settings.appearance.toastPreview')}
      dismissLabel={t('toast.dismiss')}
    >
      <PreviewNotice />
    </ToastProvider>
  );
}

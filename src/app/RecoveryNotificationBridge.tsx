import { useEffect, useRef } from 'react';
import { useI18n } from '@i18n/useI18n';
import { useToast } from '@ui/useToast';
import { usePorts } from './PortsContext';
import { useShellStore } from './shellStore';

/** Solo informa de puntos pendientes; recuperar siempre requiere revisión explícita. */
export function RecoveryNotificationBridge() {
  const { recovery } = usePorts();
  const { t } = useI18n();
  const { show } = useToast();
  const notified = useRef('');
  useEffect(() => {
    let alive = true;
    void recovery
      .read()
      .then((snapshot) => {
        if (!alive) return;
        const pending = snapshot.checkpoints.filter(
          (point) => point.status === 'pending' || point.status === 'legacy',
        );
        const key = pending
          .map((point) => point.id)
          .sort()
          .join(',');
        if (!key || key === notified.current) return;
        notified.current = key;
        show({
          message: t('settings.recovery.pendingNotice', { count: pending.length }),
          duration: 0,
          action: {
            label: t('settings.recovery.review'),
            onAction: () => useShellStore.getState().openSettings('recovery'),
          },
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [recovery, show, t]);
  return null;
}

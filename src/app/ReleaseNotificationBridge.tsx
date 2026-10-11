import { useEffect, useRef } from 'react';

import { useSettingsData } from '@features/settings/useSettingsData';
import { useReleaseStore } from '@features/settings/releaseStore';
import { useI18n } from '@i18n/useI18n';
import { useToast } from '@ui/useToast';

import { usePorts } from './PortsContext';

/** Consulta opcional al iniciar y aviso compartido con la búsqueda manual. */
export function ReleaseNotificationBridge() {
  const { link } = usePorts();
  const { settings } = useSettingsData();
  const { t } = useI18n();
  const { show } = useToast();
  const check = useReleaseStore((state) => state.check);
  const checkNow = useReleaseStore((state) => state.checkNow);
  const searched = useRef(false);
  const notified = useRef(new Set<string>());
  const { checkOnStartup } = settings.updates;

  useEffect(() => {
    if (!checkOnStartup || searched.current) return;
    searched.current = true;
    void checkNow(link);
  }, [checkOnStartup, checkNow, link]);

  useEffect(() => {
    if (check.status !== 'available' || notified.current.has(check.version)) return;
    notified.current.add(check.version);
    show({
      message: t('settings.updates.available', { version: check.version }),
      duration: 0,
      action: {
        label: t('settings.updates.download'),
        onAction: () => {
          void link.openExternal(check.url).catch(() => {
            show({ message: t('settings.updates.openFailed'), variant: 'danger' });
          });
        },
      },
    });
  }, [check, show, t, link]);

  return null;
}

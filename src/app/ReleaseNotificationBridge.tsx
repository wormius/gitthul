import { useEffect, useRef } from 'react';

import { useSettingsData } from '@features/settings/useSettingsData';
import { useReleaseStore } from '@features/settings/releaseStore';
import { RELEASE_CHECK_CONFIGURED } from '@core/ports/LinkPort';
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
  const searched = useRef(new Set<string>());
  const notified = useRef(new Set<string>());
  const { channel, checkOnStartup } = settings.updates;

  useEffect(() => {
    if (!RELEASE_CHECK_CONFIGURED || !checkOnStartup || searched.current.has(channel)) return;
    searched.current.add(channel);
    void checkNow(link, channel);
  }, [checkOnStartup, channel, checkNow, link]);

  useEffect(() => {
    if (
      !RELEASE_CHECK_CONFIGURED ||
      check.status !== 'available' ||
      check.channel !== channel ||
      notified.current.has(check.version)
    )
      return;
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
  }, [check, channel, show, t, link]);

  return null;
}

import { DEFAULT_UPDATE_SETTINGS } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Switch } from '@ui/Switch';

import { APP_VERSION } from '@app/metadata';
import { usePorts } from '@app/PortsContext';
import { useState } from 'react';

import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';
import { useReleaseStore } from './releaseStore';

/** Búsqueda de versiones estables y consulta opcional al arrancar. */
export function UpdatesSection() {
  const { t } = useI18n();
  const { settings, patch } = useSettingsData();
  const updates = settings.updates;
  const { link } = usePorts();
  const check = useReleaseStore((state) => state.check);
  const checkNow = useReleaseStore((state) => state.checkNow);
  const [openFailed, setOpenFailed] = useState(false);

  function reset() {
    void patch({ updates: DEFAULT_UPDATE_SETTINGS });
  }

  return (
    <SettingsSection
      title={t('settings.section.updates')}
      actions={
        <>
          <Button
            disabled={check.status === 'checking'}
            onClick={() => {
              setOpenFailed(false);
              void checkNow(link);
            }}
          >
            {t(
              check.status === 'checking'
                ? 'settings.updates.checking'
                : 'settings.updates.checkNow',
            )}
          </Button>
          <Button variant="ghost" onClick={reset}>
            {t('settings.reset')}
          </Button>
        </>
      }
    >
      <p>{t('settings.updates.description')}</p>
      <SettingRow label={t('settings.updates.checkOnStartup')}>
        <Switch
          label={t('settings.updates.checkOnStartup')}
          checked={updates.checkOnStartup}
          onChange={(e) => {
            void patch({ updates: { checkOnStartup: e.target.checked } });
          }}
        />
      </SettingRow>

      <SettingRow label={t('settings.updates.currentVersion')}>
        <span>{APP_VERSION}</span>
      </SettingRow>
      <div role="status" aria-live="polite">
        {check.status === 'checking' && <p>{t('settings.updates.checking')}</p>}
        {check.status === 'current' && <p>{t('settings.updates.current')}</p>}
        {check.status === 'empty' && <p>{t('settings.updates.empty')}</p>}
        {check.status === 'error' && <p>{t('settings.updates.failed')}</p>}
        {check.status === 'available' && (
          <>
            <p>{t('settings.updates.available', { version: check.version })}</p>
            <Button
              onClick={() => {
                setOpenFailed(false);
                void link.openExternal(check.url).catch(() => setOpenFailed(true));
              }}
            >
              {t('settings.updates.download')}
            </Button>
          </>
        )}
        {openFailed && <p>{t('settings.updates.openFailed')}</p>}
      </div>
    </SettingsSection>
  );
}

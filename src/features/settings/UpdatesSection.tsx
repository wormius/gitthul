import { DEFAULT_UPDATE_SETTINGS, UPDATE_CHANNELS } from '@core/domain/settings';
import { RELEASE_CHECK_CONFIGURED } from '@core/ports/LinkPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Radio } from '@ui/Radio';
import { Switch } from '@ui/Switch';

import { APP_VERSION } from '@app/metadata';
import { usePorts } from '@app/PortsContext';
import { useState } from 'react';

import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';
import { useReleaseStore } from './releaseStore';
import styles from './UpdatesSection.module.css';

/** Sección de actualizaciones: switch de buscar al arrancar, radio de canal, versión actual. */
export function UpdatesSection() {
  const { t } = useI18n();
  const { settings, patch } = useSettingsData();
  const updates = settings.updates;
  const { link } = usePorts();
  const storedCheck = useReleaseStore((state) => state.check);
  const checkNow = useReleaseStore((state) => state.checkNow);
  const check = !RELEASE_CHECK_CONFIGURED
    ? { status: 'notConfigured' as const }
    : storedCheck.status !== 'idle' && storedCheck.channel === updates.channel
      ? storedCheck
      : { status: 'idle' as const };
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
            disabled={!RELEASE_CHECK_CONFIGURED || check.status === 'checking'}
            onClick={() => {
              setOpenFailed(false);
              void checkNow(link, updates.channel);
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
      <p>
        {t(
          RELEASE_CHECK_CONFIGURED
            ? 'settings.updates.description'
            : 'settings.updates.notConfigured',
        )}
      </p>
      <SettingRow label={t('settings.updates.checkOnStartup')}>
        <Switch
          label={t('settings.updates.checkOnStartup')}
          disabled={!RELEASE_CHECK_CONFIGURED}
          checked={updates.checkOnStartup}
          onChange={(e) => {
            void patch({ updates: { checkOnStartup: e.target.checked } });
          }}
        />
      </SettingRow>

      <SettingRow label={t('settings.updates.channel')}>
        <div
          className={styles.channels}
          role="radiogroup"
          aria-label={t('settings.updates.channel')}
        >
          {UPDATE_CHANNELS.map((value) => (
            <Radio
              key={value}
              name="settings-update-channel"
              label={t(`settings.updates.channel.${value}`)}
              value={value}
              disabled={!RELEASE_CHECK_CONFIGURED}
              checked={updates.channel === value}
              onChange={() => {
                void patch({ updates: { channel: value } });
              }}
            />
          ))}
        </div>
      </SettingRow>

      <SettingRow label={t('settings.updates.currentVersion')}>
        <span>{APP_VERSION}</span>
      </SettingRow>
      <div role="status" aria-live="polite">
        {RELEASE_CHECK_CONFIGURED && check.status === 'notConfigured' && (
          <p>{t('settings.updates.notConfigured')}</p>
        )}
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

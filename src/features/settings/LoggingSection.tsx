import { useState } from 'react';
import { usePorts } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Switch } from '@ui/Switch';
import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';

export function LoggingSection() {
  const { t } = useI18n();
  const { settings, patch } = useSettingsData();
  const { log } = usePorts();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  async function change(enabled: boolean) {
    setSaving(true);
    setFailed(false);
    try {
      await patch({ logging: { debugEnabled: enabled } });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <SettingsSection
      title={t('settings.section.logging')}
      actions={
        <>
          <Button onClick={() => useShellStore.getState().setOverlay('logs')}>
            {t('settings.logging.open')}
          </Button>
          <Button onClick={() => void log.openDirectory().catch(() => setFailed(true))}>
            {t('logs.openFolder')}
          </Button>
        </>
      }
    >
      <SettingRow label={t('settings.logging.debug')}>
        <Switch
          aria-label={t('settings.logging.debug')}
          label={t(settings.logging.debugEnabled ? 'logs.debug' : 'logs.normal')}
          checked={settings.logging.debugEnabled}
          disabled={saving}
          onChange={(event) => void change(event.target.checked)}
        />
      </SettingRow>
      <p>{t('settings.logging.normal')}</p>
      <p>{t('settings.logging.rich')}</p>
      <p>{t('settings.logging.privacy')}</p>
      {failed && <p role="alert">{t('settings.logging.failed')}</p>}
    </SettingsSection>
  );
}

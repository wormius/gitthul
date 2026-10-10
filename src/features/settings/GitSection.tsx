import { DEFAULT_GIT_SETTINGS, PULL_STRATEGIES, type CommitProfile } from '@core/domain/settings';
import { useEffect } from 'react';
import { usePorts } from '@app/PortsContext';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';
import { Radio } from '@ui/Radio';

import { ProfileList } from './ProfileList';
import { SshKeysSection } from './SshKeysSection';
import { useShellStore } from '@app/shellStore';
import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';

/** Sección de git: ruta del ejecutable, estrategia de pull y perfiles de commit. */
export function GitSection() {
  const { t } = useI18n();
  const { settings, patch } = useSettingsData();
  const git = settings.git;
  const addingProfile = useShellStore((state) => state.addingProfile);
  useEffect(() => {
    if (addingProfile) useShellStore.setState({ addingProfile: false });
  }, [addingProfile]);
  const { settings: settingsPort } = usePorts();

  function reset() {
    // Restablecer preferencias conserva el catálogo de perfiles y los metadatos heredados.
    void patch({
      git: {
        ...DEFAULT_GIT_SETTINGS,
        profiles: git.profiles,
        credentialAccounts: git.credentialAccounts,
      },
    });
  }

  async function handleProfilesUpdate(profiles: readonly CommitProfile[]) {
    await patch({ git: { profiles } });
    await settingsPort.flush();
  }

  return (
    <SettingsSection
      title={t('settings.section.git')}
      actions={
        <Button variant="ghost" onClick={reset}>
          {t('settings.reset')}
        </Button>
      }
    >
      <SettingRow label={t('settings.git.executablePath')}>
        <Input
          label={t('settings.git.executablePath')}
          hideLabel
          value={git.executablePath}
          placeholder="git"
          onChange={(e) => {
            void patch({ git: { executablePath: e.target.value } });
          }}
        />
      </SettingRow>

      <SettingRow label={t('settings.git.pullStrategy')}>
        <div role="radiogroup" aria-label={t('settings.git.pullStrategy')}>
          {PULL_STRATEGIES.map((value) => (
            <Radio
              key={value}
              name="settings-pull-strategy"
              label={t(`settings.git.pullStrategy.${value}`)}
              value={value}
              checked={git.pullStrategy === value}
              onChange={() => {
                void patch({ git: { pullStrategy: value } });
              }}
            />
          ))}
        </div>
      </SettingRow>

      <h2>{t('settings.git.profiles')}</h2>
      <ProfileList
        profiles={git.profiles}
        onUpdate={handleProfilesUpdate}
        startAdding={addingProfile}
      />

      <SshKeysSection />
    </SettingsSection>
  );
}

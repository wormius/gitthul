import { AppLogo } from '@app/AppLogo';
import { useGestures } from '@app/GestureContext';
import { APP_LICENSE, APP_VERSION } from '@app/metadata';
import { HelpIcon, SupportIcon } from '@app/ShellIcons';
import { useI18n } from '@i18n/useI18n';
import { BigActionButton } from '@ui/BigActionButton';

import { SettingsSection } from './SettingsSection';
import styles from './AboutSection.module.css';

/** Sección «Acerca de»: logo, versión, licencia y los botones de apoyo y ayuda. */
export function AboutSection() {
  const { t } = useI18n();
  const gestures = useGestures();

  return (
    <SettingsSection title={t('settings.section.about')}>
      <div className={styles.content}>
        <div className={styles.logoWrap}>
          <AppLogo title={t('about.logo')} className={styles.logo} />
        </div>
        <p className={styles.version}>{t('about.version', { version: APP_VERSION })}</p>
        <p className={styles.license}>{t('about.license', { license: APP_LICENSE })}</p>
        <p className={styles.trademark}>{t('about.trademark')}</p>
        <p className={styles.tagline}>{t('about.tagline')}</p>
        <div className={styles.actions}>
          <BigActionButton
            icon={<SupportIcon />}
            label={t('gesture.support')}
            onClick={() => {
              gestures.run('shell.support');
            }}
          />
          <BigActionButton
            icon={<HelpIcon />}
            label={t('gesture.openHelp')}
            onClick={() => {
              gestures.run('shell.openHelp');
            }}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

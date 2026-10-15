import { useI18n } from '@i18n/useI18n';

import styles from './StartupError.module.css';

export function StartupError({ desktopUnavailable }: { desktopUnavailable: boolean }) {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <section role="alert" className={styles.message}>
        <h1>{t('startup.failed')}</h1>
        <p>{t(desktopUnavailable ? 'startup.desktopUnavailable' : 'startup.retry')}</p>
      </section>
    </main>
  );
}

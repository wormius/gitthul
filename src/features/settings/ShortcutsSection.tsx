import { useI18n } from '@i18n/useI18n';
import { Kbd } from '@ui/Kbd';

import { useGestures } from '@app/GestureContext';

import { SettingsSection } from './SettingsSection';
import styles from './ShortcutsSection.module.css';

const GROUPS = ['shell', 'repos', 'working', 'resolve'] as const;

/** Sección de atajos de teclado: tabla de solo lectura alimentada del registro de gestos. */
export function ShortcutsSection() {
  const { t } = useI18n();
  const gestures = useGestures();

  const visibleGestures = gestures.list.filter((g) => g.shortcutLabel);

  return (
    <SettingsSection title={t('settings.section.shortcuts')}>
      <p className={styles.hint}>{t('settings.shortcuts.hint')}</p>
      <table className={styles.table} aria-label={t('settings.shortcuts.table')}>
        <thead>
          <tr>
            <th>{t('settings.shortcuts.action')}</th>
            <th>{t('settings.shortcuts.shortcut')}</th>
          </tr>
        </thead>
        {GROUPS.map((group) => {
          const entries = visibleGestures.filter((gesture) => gesture.id.startsWith(`${group}.`));
          if (entries.length === 0) return null;

          return (
            <tbody key={group}>
              <tr>
                <th className={styles.group} colSpan={2} scope="rowgroup">
                  {t(`settings.shortcuts.group.${group}`)}
                </th>
              </tr>
              {entries.map((gesture) => (
                <tr key={gesture.id}>
                  <td>{gesture.shortcutName ?? gesture.label}</td>
                  <td>
                    <Kbd>{gesture.shortcutLabel}</Kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </SettingsSection>
  );
}

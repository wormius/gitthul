import type { ReactNode } from 'react';

import { useI18n } from '@i18n/useI18n';

import type { SettingsSection } from './sections';
import {
  AboutIcon,
  AppearanceIcon,
  GitIcon,
  LanguageIcon,
  LoggingIcon,
  RecoveryIcon,
  ShortcutsIcon,
  UpdatesIcon,
} from './SettingsIcons';
import styles from './SettingsTabs.module.css';

/*
 * El icono va aquí y no en `sections.ts` porque ese módulo es datos —
 * identificador y clave de i18n— y no debe arrastrar JSX. Quien pinta el rail es
 * quien decide con qué dibujo se reconoce cada sección.
 */
const ICONS: Record<string, ReactNode> = {
  appearance: <AppearanceIcon />,
  language: <LanguageIcon />,
  git: <GitIcon />,
  shortcuts: <ShortcutsIcon />,
  updates: <UpdatesIcon />,
  logging: <LoggingIcon />,
  recovery: <RecoveryIcon />,
  about: <AboutIcon />,
};

interface SettingsTabsProps {
  sections: readonly SettingsSection[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Barra vertical fija de secciones del centro de configuraciones. */
export function SettingsTabs({ sections, activeId, onSelect }: SettingsTabsProps) {
  const { t } = useI18n();

  return (
    <nav className={styles.rail} aria-label={t('settings.nav')}>
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={section.id === activeId}
          onClick={() => {
            onSelect(section.id);
          }}
        >
          <span className={styles.icon} aria-hidden="true">
            {ICONS[section.id]}
          </span>
          {t(section.labelKey)}
        </button>
      ))}
    </nav>
  );
}

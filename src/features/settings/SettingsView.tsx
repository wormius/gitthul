import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@i18n/useI18n';

import { useShellStore } from '@app/shellStore';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { GitSection } from './GitSection';
import { LoggingSection } from './LoggingSection';
import { RecoverySection } from './RecoverySection';
import { LanguageSection } from './LanguageSection';
import { SETTINGS_SECTIONS } from './sections';
import { BackIcon } from './SettingsIcons';
import { SettingsTabs } from './SettingsTabs';
import { ShortcutsSection } from './ShortcutsSection';
import { UpdatesSection } from './UpdatesSection';
import styles from './SettingsView.module.css';

function SectionContent({ id }: { id: string }) {
  switch (id) {
    case 'appearance':
      return <AppearanceSection />;
    case 'language':
      return <LanguageSection />;
    case 'git':
      return <GitSection />;
    case 'shortcuts':
      return <ShortcutsSection />;
    case 'updates':
      return <UpdatesSection />;
    case 'logging':
      return <LoggingSection />;
    case 'recovery':
      return <RecoverySection />;
    case 'about':
      return <AboutSection />;
    default:
      return null;
  }
}

/**
 * Vista completa de configuraciones.
 *
 * Ocupa la pantalla entera (entre barras de título e inferior) con tabs
 * verticales a la izquierda y el contenido de la sección activa a la derecha.
 * Los cambios se aplican en caliente sin botón de guardar.
 */
export function SettingsView() {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const requestedFocus = useShellStore((state) => state.settingsFocus);
  const requestedSection = useShellStore((state) => state.settingsSection);
  const [activeSection, setActiveSectionState] = useState(requestedSection ?? 'appearance');
  if (requestedSection !== null && requestedSection !== activeSection) {
    setActiveSectionState(requestedSection);
  }

  useEffect(() => {
    if (requestedSection === null) return;
    // La petición es de navegación, no una preferencia persistente. Consumirla
    // permite que la próxima apertura normal vuelva a Apariencia.
    useShellStore.setState({ settingsSection: null });
  }, [requestedSection]);

  useEffect(() => {
    if (!requestedFocus || requestedSection !== null) return;
    const text = t(requestedFocus);
    const labelled = [
      ...(contentRef.current?.querySelectorAll<HTMLElement>('[aria-label]') ?? []),
    ].find((element) => element.getAttribute('aria-label') === text);
    const label =
      labelled ??
      [...(contentRef.current?.querySelectorAll<HTMLElement>('h2, h3, label, span') ?? [])].find(
        (element) => element.textContent === text,
      );
    if (!label) return;
    label.scrollIntoView?.({ block: 'center' });
    const control = labelled?.matches('input, select, button')
      ? labelled
      : (labelled?.querySelector<HTMLElement>('input, select, button') ??
        label.closest('section')?.querySelector<HTMLElement>('input, select, button'));
    control?.focus({ preventScroll: true });
    useShellStore.setState({ settingsFocus: null });
  }, [requestedFocus, requestedSection, activeSection, t]);

  const setActiveSection = (id: string) => {
    const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
    if (section) setActiveSectionState(section.id);
  };

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <button
          type="button"
          className={styles.back}
          onClick={() => useShellStore.setState({ settingsOpen: false })}
        >
          <span className={styles.backIcon} aria-hidden="true">
            <BackIcon />
          </span>
          {t('settings.back')}
        </button>
        <SettingsTabs
          sections={SETTINGS_SECTIONS}
          activeId={activeSection}
          onSelect={setActiveSection}
        />
      </aside>
      <div className={styles.content}>
        <div ref={contentRef} className={styles.section}>
          <SectionContent id={activeSection} />
        </div>
      </div>
    </div>
  );
}

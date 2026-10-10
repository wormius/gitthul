import { LOCALES, type Locale } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';

import { ChosenIcon, LanguageIcon } from './SettingsIcons';
import { SettingsSection } from './SettingsSection';
import styles from './LanguageSection.module.css';

/**
 * Los rótulos nativos de cada idioma — se muestran **en su propio idioma**, no
 * en el de la interfaz. Es lo que permite reconocer el tuyo aunque la interfaz
 * esté en otro.
 */
const NATIVE_LABELS: Record<Locale, { name: string; greeting: string }> = {
  'es-MX': { name: 'Español (México)', greeting: '¡Hola, mundo!' },
  'es-ES': { name: 'Español (España)', greeting: '¡Hola, mundo!' },
  en: { name: 'English', greeting: 'Hello, world!' },
  de: { name: 'Deutsch', greeting: 'Hallo, Welt!' },
  fr: { name: 'Français', greeting: 'Bonjour, le monde !' },
};

/**
 * El idioma se elige a vista: cada tarjeta se escribe en su propio idioma.
 *
 * Es el mismo principio que los chips de tema —lo que se ofrece se enseña tal cual
 * es—, aplicado a las letras en vez de a los colores. El desplegable mostraba los
 * cinco nombres en la fuente de la interfaz, y eso funciona cuando todos comparten
 * el alfabeto; pero lo que de verdad necesita quien busca su idioma es leerlo
 * **como suena**, así que cada ficha lo dice en sí mismo.
 *
 * **¿Por qué cinco filas y no una rejilla?** Los nombres de idioma tienen largos
 * distintos y llevan un saludo a la derecha que hace de espécimen; una rejilla de
 * dos o tres columnas los truncaría o los desalinearía. En columna cada uno tiene
 * su renglón, y la sección sigue siendo breve — cinco filas caben sin scroll.
 */
export function LanguageSection() {
  const { t, locale, setLocale } = useI18n();

  return (
    <SettingsSection title={t('settings.section.language')}>
      <div className={styles.list} role="radiogroup" aria-label={t('settings.language')}>
        {LOCALES.map((code) => {
          const native = NATIVE_LABELS[code];
          const selected = locale === code;

          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              className={styles.card}
              data-selected={selected || undefined}
              onClick={() => {
                setLocale(code);
              }}
            >
              <span className={styles.icon} aria-hidden="true">
                <LanguageIcon />
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{native.name}</span>
                <span className={styles.code}>{code}</span>
              </span>
              <span className={styles.greeting} aria-hidden="true">
                {native.greeting}
              </span>
              <span className={styles.check} aria-hidden="true">
                <ChosenIcon />
              </span>
            </button>
          );
        })}
      </div>

      <p className={styles.note}>{t('settings.language.note')}</p>
    </SettingsSection>
  );
}

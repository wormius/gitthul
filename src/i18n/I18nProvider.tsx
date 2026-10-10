import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { interpolate, type MessageParams } from './format';
import { I18nContext, type I18nContextValue } from './I18nContext';
import { detectLocale, navigatorLocales, type Locale } from './locales';
import { MESSAGES, type MessageKey } from './messages';

interface I18nProviderProps {
  children: ReactNode;
  /** Punto de partida; sin él se detecta el idioma del sistema. */
  initialLocale?: Locale;
  /** Qué hacer con la elección. La aplicación la guarda; las pruebas no. */
  onChange?: (locale: Locale) => void;
}

/**
 * Idioma activo y la función que traduce.
 *
 * El idioma se detecta del sistema operativo la primera vez y se puede cambiar
 * en caliente: todo el texto de la aplicación pasa por `t`, así que basta con
 * volver a renderizar. Por eso ningún estado guarda cadenas ya traducidas — los
 * mensajes de la barra inferior, por ejemplo, viajan como clave más parámetros.
 *
 * Igual que el tema, no conoce el puerto de ajustes: recibe con qué arrancar y
 * avisa de cada cambio. Quien no pasa `onChange` se queda con un idioma que
 * vive solo en esta sesión, que es lo que quieren las pruebas.
 */
export function I18nProvider({ children, initialLocale, onChange }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? detectLocale(navigatorLocales()),
  );

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onChange?.(next);
    },
    [onChange],
  );

  // El atributo `lang` decide la partición de palabras y la voz del lector de
  // pantalla, así que tiene que seguir al idioma activo y no al del index.html.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => interpolate(MESSAGES[locale][key], params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

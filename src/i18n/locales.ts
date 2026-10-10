/**
 * Los cinco idiomas de GitThul y cómo se elige uno a partir del sistema.
 *
 * `es-MX` es la base: es el catálogo del que sale el tipo `MessageKey`, así que
 * cualquier clave que falte en otro idioma es un error de compilación y no una
 * cadena en blanco descubierta en producción.
 *
 * La lista vive en `@core/domain/settings` porque el idioma elegido es un
 * ajuste que se guarda y se valida al arrancar; aquí se reexporta y se le añade
 * lo único que es de traducción y no de dominio: cómo se elige uno a partir de
 * lo que pide el sistema operativo.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from '@core/domain/settings';

export { DEFAULT_LOCALE, LOCALES } from '@core/domain/settings';
export type { Locale } from '@core/domain/settings';

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Idioma más parecido a lo que pide el sistema operativo.
 *
 * Recorre las preferencias en orden y se queda con la primera que encaje, de
 * forma exacta o por lengua. El español es el único caso con dos variantes: solo
 * `es-ES` y las etiquetas de España devuelven la peninsular; el resto del
 * castellano, incluido el `es` a secas, cae en `es-MX`, que es la base.
 */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const normalized = tag.trim();

    if (normalized === '') continue;

    const exact = LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());

    if (exact) return exact;

    const [language = '', region = ''] = normalized.toLowerCase().split('-');

    if (language === 'es') return region === 'es' ? 'es-ES' : 'es-MX';
    if (isLocale(language)) return language;
  }

  return DEFAULT_LOCALE;
}

/** Lo que el navegador dice que prefiere el usuario, en orden. */
export function navigatorLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];

  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

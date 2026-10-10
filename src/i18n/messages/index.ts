import type { Locale } from '../locales';

import { de } from './de';
import { en } from './en';
import { esES } from './es-ES';
import { esMX, type Messages } from './es-MX';
import { fr } from './fr';

export type { MessageKey, Messages } from './es-MX';

/**
 * Los cinco catálogos, cargados de una vez.
 *
 * Sin carga diferida a propósito: son unos kilobytes cada uno, van dentro del
 * binario y cambiar de idioma tiene que repintar en el mismo cuadro. Traer un
 * catálogo por red sería, además, exactamente la petición que el proyecto no
 * hace.
 */
export const MESSAGES: Record<Locale, Messages> = {
  'es-MX': esMX,
  'es-ES': esES,
  en,
  de,
  fr,
};

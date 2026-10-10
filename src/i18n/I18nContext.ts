import { createContext } from 'react';

import type { MessageParams } from './format';
import type { Locale } from './locales';
import type { MessageKey } from './messages';

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Traduce y rellena los huecos. La clave es el contrato: no existe respaldo. */
  t: (key: MessageKey, params?: MessageParams) => string;
}

/**
 * Sin valor por defecto: un componente que se pinta fuera del proveedor es un
 * error de montaje, y devolver la clave en crudo lo escondería hasta que alguien
 * viera «bottomBar.search» en la ventana.
 */
export const I18nContext = createContext<I18nContextValue | null>(null);

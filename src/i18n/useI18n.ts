import { useContext } from 'react';

import { I18nContext, type I18nContextValue } from './I18nContext';

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);

  if (!value) throw new Error('useI18n necesita un I18nProvider por encima');

  return value;
}

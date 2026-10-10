import { useContext } from 'react';

import { ToastContext, type ToastApi } from './toastContext';

/** Los avisos de la aplicación. Exige tener `ToastProvider` por encima. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);

  if (!api) throw new Error('useToast necesita un ToastProvider por encima');

  return api;
}

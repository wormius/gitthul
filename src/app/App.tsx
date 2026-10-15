import { AuthenticationDialogs } from '../features/auth/AuthenticationDialogs';
import { lazy, Suspense, useEffect } from 'react';
import { useTheme } from '@design/useTheme';

import { useI18n } from '@i18n/useI18n';
import { DragLayer } from '@ui/DragLayer';
import { ToastProvider } from '@ui/ToastProvider';

import { GestureProvider } from './GestureProvider';
import { usePorts } from './PortsContext';
import { Shell } from './Shell';
import { StatusToastBridge } from './StatusToastBridge';
import { ReleaseNotificationBridge } from './ReleaseNotificationBridge';
import { UpdateOptInBridge } from './UpdateOptInBridge';
import { BackupSchedulingBridge } from './BackupSchedulingBridge';
import { subscribeShellSession } from './shellStore';
import { isTokensGalleryPath } from './devRoutes';
import { useNativeMenu } from './useNativeMenu';

const TokensGallery = import.meta.env.DEV
  ? lazy(async () => {
      const { TokensGallery } = await import('@ui/gallery/TokensGallery');
      return { default: TokensGallery };
    })
  : null;

/**
 * La aplicación: la galería interna o el shell.
 *
 * `ToastProvider` y `GestureProvider` se montan aquí, alrededor del shell, y no
 * en `main.tsx`: los dos necesitan el idioma activo, y el registro de gestos
 * necesita además la tienda del shell. La galería queda fuera de ambos a
 * propósito — es superficie interna, monta sus propios proveedores y es lo único
 * que no pasa por i18n.
 */
export function App() {
  if (import.meta.env.DEV && TokensGallery && isTokensGalleryPath(window.location.pathname)) {
    return (
      <Suspense fallback={null}>
        <TokensGallery />
      </Suspense>
    );
  }

  return <ShellApp />;
}

function ShellApp() {
  const { t } = useI18n();
  const { session } = usePorts();
  const { settings } = useTheme();

  useNativeMenu();

  useEffect(
    () =>
      subscribeShellSession((snapshot) => {
        // The instrumented port records the failure with its operation context.
        void session.write(snapshot).catch(() => undefined);
      }),
    [session],
  );

  return (
    <ToastProvider
      regionLabel={t('toast.region')}
      dismissLabel={t('toast.dismiss')}
      position={settings.toastPosition}
    >
      <StatusToastBridge />
      <ReleaseNotificationBridge />
      <UpdateOptInBridge />
      <BackupSchedulingBridge />
      <AuthenticationDialogs />
      <DragLayer>
        <GestureProvider>
          <Shell />
        </GestureProvider>
      </DragLayer>
    </ToastProvider>
  );
}

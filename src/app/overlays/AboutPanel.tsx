import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';

import { AppLogo } from '../AppLogo';
import { APP_LICENSE, APP_SITE_URL, APP_VERSION } from '../metadata';
import { usePorts } from '../PortsContext';
import { useShellStore } from '../shellStore';
import styles from './AboutPanel.module.css';

/**
 * «Acerca de», superpuesta.
 *
 * Vive en `src/app/overlays/` y no en Repositorios porque es del shell: la abre
 * el logotipo de la pantalla de inicio, pero también la búsqueda global desde
 * cualquier pestaña. El enlace se abre en el navegador del sistema mediante
 * `LinkPort` cuando la persona lo pulsa.
 */
export function AboutPanel() {
  const { t } = useI18n();
  const { link } = usePorts();
  const overlay = useShellStore((state) => state.overlay);
  const setOverlay = useShellStore((state) => state.setOverlay);

  return (
    <Dialog
      open={overlay === 'about'}
      onClose={() => {
        setOverlay('none');
      }}
      title={t('about.title')}
      closeLabel={t('about.close')}
      size="sm"
    >
      <div className={styles.about}>
        <AppLogo className={styles.logo} title={t('about.logo')} />

        <p className={styles.version}>{t('about.version', { version: APP_VERSION })}</p>
        <p className={styles.license}>{t('about.license', { license: APP_LICENSE })}</p>
        <p className={styles.trademark}>{t('about.trademark')}</p>
        <p className={styles.tagline}>{t('about.tagline')}</p>

        <div className={styles.links}>
          <Button
            onClick={() => {
              void link.openExternal(APP_SITE_URL);
            }}
          >
            {t('about.site')}
          </Button>
        </div>

        <p className={styles.offline}>{t('about.offline')}</p>
      </div>
    </Dialog>
  );
}

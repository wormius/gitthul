import type { RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';

interface ForgetRepoDialogProps {
  /** `null` con el diálogo cerrado: no hay nada que nombrar. */
  repo: RepoSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * La confirmación de olvidar, que dice exactamente qué se pierde.
 *
 * La invariante 2 no admite «¿seguro?»: el diálogo nombra el repositorio, dice
 * de qué espacios sale —uno por uno— y deja claro lo que **no** pasa, que es lo
 * que de verdad preocupa a quien pulsa el botón: ni la carpeta ni la historia se
 * tocan. Los dos botones también nombran su objeto, así que leer solo el pie
 * basta para saber qué se está a punto de hacer.
 */
export function ForgetRepoDialog({ repo, onConfirm, onCancel }: ForgetRepoDialogProps) {
  const { t } = useI18n();

  if (!repo) return null;

  const named = { repo: repo.name };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('gesture.repos.forget', named)}
      description={t('repositories.forget.description', { repo: repo.name, path: repo.path })}
      closeLabel={t('repositories.forget.close', named)}
      footer={
        <>
          <Button onClick={onCancel}>{t('repositories.forget.cancel', named)}</Button>
          <Button variant="primary" onClick={onConfirm}>
            {t('repositories.forget.confirm', named)}
          </Button>
        </>
      }
    />
  );
}

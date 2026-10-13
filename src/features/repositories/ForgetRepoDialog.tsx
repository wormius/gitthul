import type { RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';

import styles from './ForgetRepoDialog.module.css';

interface ForgetRepoDialogProps {
  /** `null` con el diálogo cerrado: no hay nada que nombrar. */
  repo?: RepoSummary | null;
  repos?: readonly RepoSummary[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * La confirmación nombra cada repositorio que se retirará del catálogo y explica
 * que sus carpetas y su historial de Git se conservan.
 */
export function ForgetRepoDialog({ repo, repos, onConfirm, onCancel }: ForgetRepoDialogProps) {
  const { t } = useI18n();

  if (repos && repos.length > 0) {
    const unique = [...new Map(repos.map((item) => [item.id, item])).values()];
    const counted = { count: unique.length };

    return (
      <Dialog
        open
        onClose={onCancel}
        size="md"
        title={t('repositories.forgetMany.title', counted)}
        description={t('repositories.forgetMany.description', counted)}
        closeLabel={t('repositories.forgetMany.close', counted)}
        footer={
          <>
            <Button onClick={onCancel}>{t('repositories.forgetMany.cancel', counted)}</Button>
            <Button variant="primary" onClick={onConfirm}>
              {t('repositories.forgetMany.confirm', counted)}
            </Button>
          </>
        }
      >
        <ul
          className={styles.repositories}
          aria-label={t('repositories.forgetMany.list')}
          tabIndex={0}
        >
          {unique.map((item) => (
            <li key={item.id} className={styles.repository}>
              <strong>{item.name}</strong>
              <span className={styles.path}>{item.path}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    );
  }

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

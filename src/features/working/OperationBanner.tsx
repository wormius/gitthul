import type { RepoOperation } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Banner } from '@ui/Banner';
import { Button } from '@ui/Button';

import styles from './OperationBanner.module.css';

interface OperationBannerProps {
  operation: RepoOperation;
  hasConflicts?: boolean;
  onContinue: () => void;
  onAbort: () => void;
  onMarkAllResolved?: () => void;
}

/**
 * Aviso persistente que se muestra cuando hay una operación de git a medias.
 *
 * Dice qué se quedó a medias —fusión, rebase, cherry-pick o revert— y entre
 * qué ramas. Sin conflictos ofrece «Continuar» y «Abortar»; con conflictos
 * conserva «Abortar» en el aviso para que la salida de la operación permanezca
 * junto a la explicación de lo que está ocurriendo.
 */
export function OperationBanner({
  operation,
  hasConflicts = false,
  onContinue,
  onAbort,
  onMarkAllResolved,
}: OperationBannerProps) {
  const { t } = useI18n();

  if (operation.kind === 'none' || operation.kind === 'bisect') return null;

  const titleKey = {
    merge: 'working.operationBanner.merge',
    rebase: 'working.operationBanner.rebase',
    cherryPick: 'working.operationBanner.cherryPick',
    revert: 'working.operationBanner.revert',
  }[operation.kind] as
    | 'working.operationBanner.merge'
    | 'working.operationBanner.rebase'
    | 'working.operationBanner.cherryPick'
    | 'working.operationBanner.revert';

  const operationName = t(`working.operationBanner.kind.${operation.kind}` as const);
  const title = hasConflicts
    ? t('working.operationBanner.conflictGenerated', { operation: operationName })
    : operation.kind === 'merge'
      ? t('working.operationBanner.mergeReady')
      : t(titleKey, { source: operation.source, target: operation.target });

  return (
    <Banner
      layout="stacked"
      variant={hasConflicts ? 'warning' : 'info'}
      title={title}
      actions={
        <div className={styles.actions}>
          {!hasConflicts && (
            <Button size="sm" variant="primary" onClick={onContinue}>
              {t(
                operation.kind === 'merge'
                  ? 'working.operationBanner.commitMerge'
                  : 'working.operationBanner.continue',
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" className={styles.dangerAction} onClick={onAbort}>
            {t('working.operationBanner.abortKind', { operation: operationName })}
          </Button>
          {hasConflicts && onMarkAllResolved && (
            <Button size="sm" variant="primary" onClick={onMarkAllResolved}>
              {t('resolve.mark.all')}
            </Button>
          )}
        </div>
      }
    />
  );
}

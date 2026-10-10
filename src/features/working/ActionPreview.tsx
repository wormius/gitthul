import { useCallback, useEffect } from 'react';

import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { IntegrationPrecondition, IntegrationPreview } from '@core/domain/refs';
import type { GitQuery } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';

import { integrationOffer } from './integration';
import styles from './ActionPreview.module.css';
import { useWorkingStore, type ActionPreviewState } from './workingStore';

interface ActionPreviewProps {
  state: ActionPreviewState;
  repoId: string;
  onMerge: (source: string, target: string, precondition: IntegrationPrecondition) => void;
  onRebase: (source: string, target: string, precondition: IntegrationPrecondition) => void;
}

/**
 * Panel modal que se abre al soltar una referencia sobre otra — F2.7.
 *
 * Muestra la vista previa de la integración —cuántos commits se traerían,
 * cuántos conflictos se prevén— y ofrece los botones según lo que
 * `integrationOffer` decida: fusionar, rebasar y comparar, o solo comparar.
 *
 * Los botones de fusionar y rebasar solo se habilitan cuando el adaptador posee
 * esas escrituras y la vista previa ya entregó sus puntas exactas.
 */
export function ActionPreview({ state, repoId, onMerge, onRebase }: ActionPreviewProps) {
  const { t } = useI18n();
  const { git } = usePorts();
  const closeActionPreview = useWorkingStore((s) => s.closeActionPreview);
  const openCompare = useWorkingStore((s) => s.openCompare);

  const offer = integrationOffer(state.source, state.target);

  const load = useCallback(
    async (query: GitQuery): Promise<IntegrationPreview | null> => {
      if (offer === null) return null;

      return git.previewIntegration(
        repoId,
        state.kind,
        state.source.name,
        state.target.name,
        query,
      );
    },
    [git, repoId, state.kind, state.source.name, state.target.name, offer],
  );

  const preview = useAsyncData(load);

  const close = useCallback(() => {
    closeActionPreview();
  }, [closeActionPreview]);

  const handleMerge = useCallback(() => {
    if (preview.status !== 'ready' || preview.data === null) return;
    onMerge(state.source.name, state.target.name, preview.data.precondition);
  }, [onMerge, state.source.name, state.target.name, preview]);

  const handleRebase = useCallback(() => {
    if (preview.status !== 'ready' || preview.data === null) return;
    onRebase(state.source.name, state.target.name, preview.data.precondition);
  }, [onRebase, state.source.name, state.target.name, preview]);

  const handleCompare = useCallback(() => {
    openCompare({
      kind: 'refs',
      source: { ref: state.source.name, label: state.source.name },
      target: { ref: state.target.name, label: state.target.name },
    });
    close();
  }, [openCompare, state.source.name, state.target.name, close]);

  // Cerrar con Escape.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close]);

  if (offer === null) {
    // No debería pasar, pero por seguridad.
    close();

    return null;
  }

  const loaded = preview.status === 'ready' ? preview.data : null;
  const isFullOffer = offer === 'merge-rebase-compare' && state.target.name === state.headBranch;
  const canWriteIntegration = git.integrationWritesAvailable && loaded !== null;
  const title = isFullOffer
    ? t(`working.actionPreview.title.${state.kind}`, {
        source: state.source.name,
        target: state.target.name,
      })
    : t('working.actionPreview.compare');

  return (
    <div className={styles.backdrop} onClick={close} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 className={styles.title}>{title}</h2>

        {preview.status === 'loading' && (
          <p className={styles.loading}>{t('working.actionPreview.loading')}</p>
        )}

        {loaded !== null && loaded !== undefined && (
          <div className={styles.stats}>
            <span className={styles.stat}>
              {t('working.actionPreview.commits', { count: loaded.commits.length })}
            </span>
            {loaded.conflicts !== null && loaded.conflicts.length > 0 && (
              <span className={styles.stat}>
                {t('working.actionPreview.conflicts', { count: loaded.conflicts.length })}
              </span>
            )}
          </div>
        )}

        {isFullOffer && !git.integrationWritesAvailable && (
          <p className={styles.loading}>{t('working.actionPreview.writesUnavailable')}</p>
        )}

        <div className={styles.buttons}>
          {isFullOffer && (
            <>
              <Button variant="primary" onClick={handleMerge} disabled={!canWriteIntegration}>
                {t('working.actionPreview.merge', {
                  source: state.source.name,
                  target: state.target.name,
                })}
              </Button>
              <Button onClick={handleRebase} disabled={!canWriteIntegration}>
                {t('working.actionPreview.rebase', {
                  source: state.source.name,
                  target: state.target.name,
                })}
              </Button>
            </>
          )}
          <Button onClick={handleCompare} autoFocus>
            {t('working.actionPreview.compare')}
          </Button>
          <Button variant="ghost" onClick={close}>
            {t('working.actionPreview.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}

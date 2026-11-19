import { useRef, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { toGitOperationError, type GitOperationError } from '@core/domain/errors';
import type { ConflictContents } from '@core/domain/status';
import { CONFLICT_TEXT_LIMIT } from '@core/domain/status';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';

interface WholeFileCardProps {
  conflict: ConflictContents;
  onKeepSide: (side: 'ours' | 'theirs') => void | Promise<void>;
  onCancel: () => void;
}

import styles from './WholeFileCard.module.css';

/**
 * La ficha de las dos versiones — CU-10 y CU-11.
 *
 * Es el camino de lo que no tiene tres paneles que enseñar: un binario, un
 * archivo que un lado borró, o uno que pasa del tope del resolutor. Dos botones
 * que **nombran las ramas**, nunca «el nuestro» y «el suyo», y el porqué escrito
 * con la cifra de verdad cuando la razón es el tamaño.
 *
 * Elegir resuelve el archivo ahí mismo, sin pasar por la comprobación: un diff
 * entre dos binarios, o entre un archivo y su ausencia, no comprueba nada.
 */
export function WholeFileCard({ conflict, onKeepSide, onCancel }: WholeFileCardProps) {
  const { t } = useI18n();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<GitOperationError>();

  const keepSide = async (side: 'ours' | 'theirs') => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onKeepSide(side);
    } catch (error) {
      setSaveError(toGitOperationError(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reason = conflict.wholeFileOnly
    ? t(`resolve.card.${conflict.wholeFileOnly}`)
    : conflict.binary
      ? t('resolve.card.binary')
      : conflict.tooLarge
        ? t('resolve.card.tooLarge', {
            lines: conflict.sizes.ours.lines || conflict.sizes.theirs.lines,
            limit: CONFLICT_TEXT_LIMIT.lines,
          })
        : conflict.ours === null
          ? t('resolve.card.deletedByUs', { ours: conflict.oursLabel })
          : conflict.theirs === null
            ? t('resolve.card.deletedByThem', { theirs: conflict.theirsLabel })
            : t('resolve.card.binary');

  return (
    <div className={styles.card} aria-busy={saving}>
      <h2 className={styles.title}>{conflict.path}</h2>
      <p className={styles.reason}>{reason}</p>
      {saveError && <GitErrorPanel error={saveError} />}

      {conflict.wholeFileOnly !== 'submodule' && (
        <dl className={styles.sides}>
          <div className={styles.side}>
            <dt>{conflict.oursLabel}</dt>
            <dd>{describe(conflict.ours, conflict.sizes.ours.lines, t)}</dd>
          </div>
          <div className={styles.side}>
            <dt>{conflict.theirsLabel}</dt>
            <dd>{describe(conflict.theirs, conflict.sizes.theirs.lines, t)}</dd>
          </div>
        </dl>
      )}

      <div className={styles.actions}>
        {conflict.wholeFileOnly !== 'submodule' && (
          <>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => {
                void keepSide('ours');
              }}
            >
              {t('resolve.card.keep', { branch: conflict.oursLabel })}
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => {
                void keepSide('theirs');
              }}
            >
              {t('resolve.card.keep', { branch: conflict.theirsLabel })}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {t('resolve.resolver.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Qué hizo ese lado con el archivo: borrarlo, o dejarlo con N líneas. */
function describe(
  text: string | null,
  lines: number,
  t: (key: 'resolve.card.deleted' | 'resolve.card.lines', params?: { lines: number }) => string,
): string {
  return text === null && lines === 0
    ? t('resolve.card.deleted')
    : t('resolve.card.lines', { lines });
}

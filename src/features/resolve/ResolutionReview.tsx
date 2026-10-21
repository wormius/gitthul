import { useCallback, useMemo } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { RepoId } from '@core/domain/repository';
import type { ConflictContents } from '@core/domain/status';
import type { GitQuery } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { CodeSurface } from '@ui/CodeSurface';
import { syntaxLanguageForPath, type CodeLineMark } from '@ui/codeSurfaceUtils';
import { Skeleton } from '@ui/Skeleton';

import { useResolveStore } from './resolveStore';
import { useResolverClipboard } from './useResolverClipboard';
import { diffLines, toLines } from './conflict';
import styles from './ResolutionReview.module.css';

interface ResolutionReviewProps {
  repoId: RepoId;
  path: string;
  /** Lo que quedó tras resolver, que es lo que se va a escribir. */
  result: string;
  onBack: () => void;
  onMarkResolved: () => void;
}

/**
 * El paso 3: la comprobación antes de marcar como resuelto — CU-8.
 *
 * Enseña **el archivo como estaba antes de la operación contra cómo queda**, que
 * es la pregunta que uno se hace al terminar: «¿qué le hizo esto a mi archivo?».
 * No se compara contra la base —el antepasado común—, que puede no parecerse a
 * ninguno de los dos lados y contestaría otra pregunta.
 *
 * **El diff no se le pide al puerto.** Los dos textos ya están aquí: uno vino de
 * `readConflict` y el otro lo acaba de armar el resolutor. `diffLines` de
 * `conflict.ts` es el mismo que reparte los bloques, así que no hay dos formas
 * de comparar dos textos en esta vista.
 */
export function ResolutionReview({
  repoId,
  path,
  result,
  onBack,
  onMarkResolved,
}: ResolutionReviewProps) {
  const { t } = useI18n();
  const { git } = usePorts();
  const clipboard = useResolverClipboard();

  const encoding = useResolveStore((state) => state.encodings.get(path) ?? 'auto');
  const load = useCallback(
    (query: GitQuery): Promise<ConflictContents> =>
      git.readConflict(repoId, path, { ...query, encoding }),
    [git, encoding, path, repoId],
  );

  const data = useAsyncData(load);
  const conflict = data.status === 'ready' ? data.data : null;

  const diff = useMemo(() => {
    if (conflict === null) return null;

    return diffLines(toLines(conflict.ours), toLines(result));
  }, [conflict, result]);

  if (data.status === 'failed') {
    return (
      <div className={styles.overlay} role="region" aria-label={path}>
        <GitErrorPanel error={data.error} />
      </div>
    );
  }

  if (conflict === null || diff === null) {
    return (
      <div className={styles.overlay} role="region" aria-label={path}>
        <Skeleton />
      </div>
    );
  }

  const text = diff.map((edit) => edit.line).join('\n');
  const marks: readonly CodeLineMark[] = diff.flatMap((edit, index) =>
    edit.kind === 'same' ? [] : [{ line: index + 1, tone: edit.kind }],
  );
  const changed = diff.filter((edit) => edit.kind !== 'same').length;

  /*
   * El margen no numera de corrido: una línea es de antes, la siguiente de
   * después, y una numeración seguida describiría un archivo que no existe. Es
   * el mismo motivo por el que `CodeSurface` acepta rótulos por línea desde
   * F2.6.
   */
  const labels = diff.map((edit) =>
    edit.kind === 'added' ? '+' : edit.kind === 'removed' ? '−' : '',
  );

  return (
    <div className={styles.overlay} role="region" aria-label={path}>
      <header className={styles.header}>
        <span className={styles.path}>{path}</span>
        <span className={styles.sides}>
          {t('resolve.review.title', { branch: conflict.oursLabel })}
        </span>
      </header>

      <div className={styles.body}>
        <CodeSurface
          clipboard={clipboard}
          encoding={conflict.encoding ?? 'utf-8'}
          value={text}
          label={t('resolve.review.title', { branch: conflict.oursLabel })}
          lineNumberLabels={labels}
          showLineNumbers
          marks={marks}
          language={syntaxLanguageForPath(path) ?? undefined}
        />
      </div>

      <footer className={styles.footer}>
        <span className={styles.summary}>
          {changed === 0
            ? t('resolve.review.identical')
            : t('resolve.review.changes', { count: changed })}
        </span>
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={onBack}>
          {t('resolve.review.back')}
        </Button>
        <Button size="sm" onClick={onMarkResolved}>
          {t('resolve.review.markResolved')}
        </Button>
      </footer>
    </div>
  );
}

import { useCallback, useMemo, useRef, useState } from 'react';

import { useI18n } from '@i18n/useI18n';
import { IconButton } from '@ui/IconButton';
import { MarkerScrollbar } from '@ui/MarkerScrollbar';
import { CodeSurface, type CodeBlockControl } from '@ui/CodeSurface';
import { syntaxLanguageForPath, type CodeLineMark } from '@ui/codeSurfaceUtils';

import type { LineOrigin } from './conflict';
import { useResolverClipboard } from './useResolverClipboard';
import styles from './ResolutionReview.module.css';
import resultStyles from './ResolvedResult.module.css';

interface ResolvedResultProps {
  path: string;
  encoding?: string;
  result: string;
  origins: readonly LineOrigin[];
  onClose: () => void;
  sources?: { ours: string; theirs: string };
}

/** Resultado ya preparado, con la procedencia que se conservó al ensamblarlo. */
export function ResolvedResult({
  path,
  encoding,
  result,
  origins,
  sources,
  onClose,
}: ResolvedResultProps) {
  const { t } = useI18n();
  const clipboard = useResolverClipboard();
  const scroller = useRef<HTMLElement | null>(null);
  const attachScroller = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);
  const [scrollMap, setScrollMap] = useState<
    Parameters<NonNullable<Parameters<typeof CodeSurface>[0]['onScrollMap']>>[0]
  >({ total: 1, from: 0, to: 1, blocks: [] });
  const marks = useMemo<readonly CodeLineMark[]>(
    () =>
      origins.flatMap((origin, index) =>
        origin === 'context' || origin === 'manual' ? [] : [{ line: index + 1, tone: origin }],
      ),
    [origins],
  );
  const blocks = useMemo<readonly CodeBlockControl[]>(() => {
    const resultBlocks: CodeBlockControl[] = [];
    let previous: LineOrigin | undefined;

    origins.forEach((origin, index) => {
      if (origin === previous) {
        if (origin !== 'context' && resultBlocks.length)
          resultBlocks[resultBlocks.length - 1]!.afterLine = index + 1;
        return;
      }

      previous = origin;
      if (origin === 'context') return;

      resultBlocks.push({
        id: `resolved-${index}`,
        afterLine: index + 1,
        line: index + 1,
        label: t('resolve.resolved.sourceBlock', {
          number: resultBlocks.length + 1,
          source:
            origin === 'manual'
              ? t('resolve.resolved.newChange')
              : sources?.[origin] || t('resolve.resolved.newChange'),
        }),
        tone: origin === 'manual' ? 'resolved' : origin,
      });
    });

    return resultBlocks;
  }, [origins, sources, t]);

  return (
    <div
      className={resultStyles.panel}
      role="region"
      aria-label={path}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className={styles.header}>
        <span className={styles.path}>{path}</span>
        <span className={styles.sides}>{t('resolve.resolved.title')}</span>
        <span className={styles.spacer} />
        <IconButton
          aria-label={t('resolve.resolved.close')}
          onClick={onClose}
          icon={
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 4 8 8m0-8-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      </header>
      <div className={resultStyles.body}>
        <CodeSurface
          clipboard={clipboard}
          className={resultStyles.editor}
          value={result}
          encoding={encoding}
          scrollerRef={attachScroller}
          onScrollMap={setScrollMap}
          label={t('resolve.resolved.title')}
          showLineNumbers
          marks={marks}
          blockControls={blocks}
          language={syntaxLanguageForPath(path) ?? undefined}
        />
        <MarkerScrollbar
          label={t('resolve.resolved.navigation')}
          total={scrollMap.total}
          viewport={{ from: scrollMap.from, to: scrollMap.to }}
          markers={scrollMap.blocks.flatMap((range) => {
            // La medición puede pertenecer al render anterior mientras cambia
            // el documento. Una marca vieja no debe tumbar el visor nuevo.
            const block = blocks.find((block) => block.id === range.id);
            if (!block) return [];

            return {
              ...range,
              tone:
                block.tone === 'ours'
                  ? ('ours' as const)
                  : block.tone === 'theirs'
                    ? ('theirs' as const)
                    : ('neutral' as const),
              label: block.label,
            };
          })}
          onSeek={(position) => {
            if (scroller.current) scroller.current.scrollTop = position;
          }}
          onSelect={(marker) => {
            if (scroller.current) scroller.current.scrollTop = marker.from;
          }}
        />
      </div>
    </div>
  );
}

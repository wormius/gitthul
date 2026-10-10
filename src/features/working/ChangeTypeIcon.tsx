import type { ChangeType } from '@core/domain/status';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';

import styles from './ChangeTypeIcon.module.css';

interface ChangeTypeIconProps {
  change: ChangeType;
  className?: string;
}

const TITLES: Record<ChangeType, MessageKey> = {
  added: 'working.changeType.added',
  modified: 'working.changeType.modified',
  deleted: 'working.changeType.deleted',
  renamed: 'working.changeType.renamed',
  copied: 'working.changeType.copied',
  untracked: 'working.changeType.untracked',
  typeChanged: 'working.changeType.typeChanged',
  conflicted: 'working.changeType.conflicted',
  unmodified: 'working.changeType.unmodified',
};

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Pictogramas de estado: la forma comunica incluso sin leer el color. */
function ChangeGlyph({ change }: { change: ChangeType }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {change === 'added' && <path d="M8 3v10M3 8h10" {...STROKE} />}
      {change === 'modified' && (
        <>
          <path d="m4 11.8.5-2.7 6.4-6.4 2.4 2.4-6.4 6.4z" {...STROKE} />
          <path d="m9.8 3.8 2.4 2.4M3.5 13h9" {...STROKE} />
        </>
      )}
      {change === 'deleted' && <path d="M3 8h10" {...STROKE} />}
      {change === 'renamed' && <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" {...STROKE} />}
      {change === 'copied' && (
        <>
          <rect x="5" y="5" width="8" height="8" rx="1" {...STROKE} />
          <path d="M10.5 3H4a1 1 0 0 0-1 1v6.5" {...STROKE} />
        </>
      )}
      {change === 'untracked' && (
        <>
          <path d="M5.4 5.5A2.7 2.7 0 0 1 8 3.5c1.7 0 3 1 3 2.5 0 2-3 2-3 4" {...STROKE} />
          <circle cx="8" cy="12.5" r=".8" fill="currentColor" />
        </>
      )}
      {change === 'typeChanged' && (
        <>
          <path d="M3 5h9M9.5 2.5 12 5 9.5 7.5" {...STROKE} />
          <path d="M13 11H4M6.5 8.5 4 11l2.5 2.5" {...STROKE} />
        </>
      )}
      {change === 'conflicted' && (
        <>
          <path d="M4 3v2.5c0 1.5 1 2.5 2.5 2.5h3M4 13v-2.5C4 9 5 8 6.5 8" {...STROKE} />
          <path d="m8.5 5.5 3 2.5-3 2.5" {...STROKE} />
        </>
      )}
      {change === 'unmodified' && <circle cx="8" cy="8" r="2" {...STROKE} />}
    </svg>
  );
}

export function ChangeTypeIcon({ change, className }: ChangeTypeIconProps) {
  const { t } = useI18n();
  const title = t(TITLES[change]);

  return (
    <span
      className={[styles.badge, styles[change], className].filter(Boolean).join(' ')}
      role="img"
      aria-label={title}
      title={title}
    >
      <ChangeGlyph change={change} />
    </span>
  );
}

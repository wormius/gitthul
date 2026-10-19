import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { DiffSource } from '@core/domain/diff';
import { useI18n } from '@i18n/useI18n';
import { IconButton } from '@ui/IconButton';
import { SegmentedControl, type SegmentedOption } from '@ui/SegmentedControl';
import { EncodingSelect } from '@ui/EncodingSelect';
import { Toolbar } from '@ui/Toolbar';

import { sourceLabel } from './diffView';
import styles from './DiffToolbar.module.css';
import type { DiffColumns, DiffContent, DiffOptions, DiffScope } from './workingStore';

interface DiffToolbarProps {
  path: string;
  source: DiffSource;
  options: DiffOptions;
  onOptionsChange: (patch: Partial<DiffOptions>) => void;
  /** La codificación con la que el puerto dice haber leído, para ofrecerla. */
  reportedEncoding: string | null;
  decodingErrors?: boolean;
  /** Con un binario no hay columnas, ni hunks, ni espacios que ignorar. */
  textual: boolean;
  /** Un archivo heredado del commit sólo ofrece lectura, sin comparación. */
  fileOnly?: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onClose: () => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/*
 * Los seis iconos de la barra, dibujados aquí y no en `src/ui`: describen lo
 * que este visor ofrece —marcas de diff, columnas, tramos— y no hay una segunda
 * vista que los pida. La regla de dos usos los promovería el día que la haya.
 */
const STROKE = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' } as const;

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

/** Diff: los signos menos y más nombran las dos clases de cambio. */
function DiffIcon() {
  return (
    <Frame>
      <path d="M2.5 4.5h3M8 4.5h5.5M2.5 11h3M4 9.5v3M8 11h5.5" {...STROKE} />
    </Frame>
  );
}

/** Archivo: la hoja tal cual, sin marcas. */
function FileIcon() {
  return (
    <Frame>
      <path d="M4 2.5h5l3 3v8H4z" {...STROKE} strokeLinejoin="round" />
      <path d="M9 2.5v3h3" {...STROKE} strokeLinejoin="round" />
    </Frame>
  );
}

/** Una columna: las versiones anterior y nueva se apilan en el mismo visor. */
function OneColumnIcon() {
  return (
    <Frame>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" {...STROKE} />
      <path d="M4 5.5h1.5M7.5 5.5h4M4 10.5h1.5M4.75 9.75v1.5M7.5 10.5h4" {...STROKE} />
    </Frame>
  );
}

/** Dos columnas: la versión anterior y la nueva ocupan visores distintos. */
function TwoColumnsIcon() {
  return (
    <Frame>
      <rect x="2" y="2.5" width="12" height="11" rx="1" {...STROKE} />
      <path d="M8 2.5v11M4 5.5h2M10 5.5h2M11 4.5v2M4 10h2M10 10h2" {...STROKE} />
    </Frame>
  );
}

/** Hunks: dos bloques completos separados por una elipsis que hace visible el salto. */
function HunksIcon() {
  return (
    <Frame>
      <rect x="2.5" y="1.5" width="11" height="4" rx="0.75" {...STROKE} />
      <path d="M4.5 3.5h7" {...STROKE} />
      <circle cx="5" cy="8" r="0.75" fill="currentColor" />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" />
      <circle cx="11" cy="8" r="0.75" fill="currentColor" />
      <rect x="2.5" y="10.5" width="11" height="4" rx="0.75" {...STROKE} />
      <path d="M4.5 12.5h7" {...STROKE} />
    </Frame>
  );
}

/** El calderón: la marca de párrafo con la que se enseñan los espacios. */
function PilcrowIcon() {
  return (
    <Frame>
      <path d="M9 3v10M12 3v10" {...STROKE} />
      <path d="M9 3H6.75a2.75 2.75 0 0 0 0 5.5H9" {...STROKE} strokeLinejoin="round" />
    </Frame>
  );
}

/** Archivo completo: un solo bloque con todos los renglones continuos. */
function WholeFileIcon() {
  return (
    <Frame>
      <rect x="2.5" y="1.5" width="11" height="13" rx="0.75" {...STROKE} />
      <path d="M4.5 4h7M4.5 6.7h7M4.5 9.4h7M4.5 12.1h5" {...STROKE} />
    </Frame>
  );
}

function HistoryIcon() {
  return (
    <Frame>
      <path d="M2 6.5a6 6 0 1 1 .5 5M2 3v3.5h3.5M8 4.5V8l2.5 1.5" {...STROKE} />
    </Frame>
  );
}

/**
 * La barra del visor: qué se enseña, cómo y con qué se leyó — CU-5.
 *
 */
export function DiffToolbar({
  path,
  source,
  options,
  onOptionsChange,
  reportedEncoding,
  decodingErrors,
  textual,
  fileOnly = false,
  historyOpen,
  onToggleHistory,
  onClose,
}: DiffToolbarProps) {
  const { t } = useI18n();
  const barRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<HTMLHeadingElement>(null);
  const sourceRef = useRef<HTMLSpanElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);
  const [arrangement, setArrangement] = useState({
    layout: 'inline',
    closeWidth: 0,
    controlsHeight: 0,
  });
  const origin = sourceLabel(source, t);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const path = pathRef.current;
    const source = sourceRef.current;
    const items = itemsRef.current;
    const close = closeRef.current;
    if (!bar || !path || !source || !items || !close) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const barStyle = getComputedStyle(bar);
      const available =
        bar.clientWidth - parseFloat(barStyle.paddingLeft) - parseFloat(barStyle.paddingRight);
      if (available <= 0) return;
      const gap = parseFloat(barStyle.columnGap);
      const controls =
        items.offsetWidth + close.offsetWidth + parseFloat(getComputedStyle(items).gap);
      const minimumPath = parseFloat(getComputedStyle(path).flexBasis);
      const identityGap = parseFloat(getComputedStyle(source.parentElement!).gap);
      const compactWidth = minimumPath + gap + controls;
      const layout =
        available >= compactWidth + identityGap + source.offsetWidth
          ? 'inline'
          : available >= compactWidth
            ? 'compact'
            : 'stacked';
      setArrangement((current) =>
        current.layout === layout &&
        current.closeWidth === close.offsetWidth &&
        current.controlsHeight === items.offsetHeight
          ? current
          : { layout, closeWidth: close.offsetWidth, controlsHeight: items.offsetHeight },
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const element of [bar, items, source, close]) observer?.observe(element);
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [textual, options.content, options.encoding, reportedEncoding, decodingErrors, origin]);

  const columns: readonly SegmentedOption<DiffColumns>[] = [
    { value: 'unified', label: t('working.diff.columnsOne'), icon: <OneColumnIcon /> },
    { value: 'split', label: t('working.diff.columnsTwo'), icon: <TwoColumnsIcon /> },
  ];

  const scopes: readonly SegmentedOption<DiffScope>[] = [
    { value: 'hunks', label: t('working.diff.scopeHunks'), icon: <HunksIcon /> },
    { value: 'file', label: t('working.diff.scopeFile'), icon: <WholeFileIcon /> },
  ];

  const contents: readonly SegmentedOption<DiffContent>[] = [
    { value: 'diff', label: t('working.diff.contentDiff'), icon: <DiffIcon /> },
    { value: 'file', label: t('working.diff.contentFile'), icon: <FileIcon /> },
  ];

  return (
    <div
      ref={barRef}
      className={[styles.bar, styles[arrangement.layout]].filter(Boolean).join(' ')}
      data-layout={arrangement.layout}
      style={
        arrangement.closeWidth
          ? ({
              '--diff-close-width': `${arrangement.closeWidth}px`,
              '--diff-controls-height': `${arrangement.controlsHeight}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <header className={styles.identity}>
        <h2 ref={pathRef} className={styles.path} title={path}>
          {path}
        </h2>
        <span
          ref={sourceRef}
          className={styles.source}
          aria-hidden={arrangement.layout === 'compact'}
        >
          {origin}
        </span>
      </header>

      <Toolbar className={styles.controls} label={t('working.diff.toolbar', { path })}>
        <div className={styles.controlGroup}>
          <div ref={itemsRef} className={styles.controlItems}>
            <IconButton
              icon={<HistoryIcon />}
              pressed={historyOpen}
              aria-label={
                historyOpen
                  ? t('working.fileHistory.close', { path })
                  : t('gesture.working.viewFileHistory', { path })
              }
              title={
                historyOpen
                  ? t('working.fileHistory.close', { path })
                  : t('gesture.working.viewFileHistory', { path })
              }
              onClick={onToggleHistory}
            />
            {!fileOnly && (
              <SegmentedControl
                label={t('working.diff.content')}
                hideLabels
                value={options.content}
                onChange={(content) => {
                  onOptionsChange({
                    content:
                      content === options.content
                        ? options.content === 'diff'
                          ? 'file'
                          : 'diff'
                        : content,
                  });
                }}
                options={contents}
              />
            )}

            {!fileOnly && textual && options.content === 'diff' && (
              <>
                <SegmentedControl
                  label={t('working.diff.columns')}
                  hideLabels
                  value={options.columns}
                  onChange={(value) => {
                    onOptionsChange({
                      columns:
                        value === options.columns
                          ? options.columns === 'unified'
                            ? 'split'
                            : 'unified'
                          : value,
                    });
                  }}
                  options={columns}
                />
                <SegmentedControl
                  label={t('working.diff.scope')}
                  hideLabels
                  value={options.scope}
                  onChange={(scope) => {
                    onOptionsChange({
                      scope:
                        scope === options.scope
                          ? options.scope === 'hunks'
                            ? 'file'
                            : 'hunks'
                          : scope,
                    });
                  }}
                  options={scopes}
                />
                {/* Alternar, no marcar: en una barra de iconos una casilla con su
                texto era lo único que quedaba escrito. El calderón es la marca
                con la que se enseñan los espacios en cualquier editor. */}
                <IconButton
                  icon={<PilcrowIcon />}
                  variant="ghost"
                  pressed={options.ignoreWhitespace}
                  aria-label={t('working.diff.ignoreWhitespace')}
                  title={t('working.diff.ignoreWhitespace')}
                  onClick={() => {
                    onOptionsChange({ ignoreWhitespace: !options.ignoreWhitespace });
                  }}
                />
              </>
            )}

            {textual && (
              <IconButton
                icon={
                  <Frame>
                    <path d="M3 4h10M3 8h8a2 2 0 0 1 0 4H8m2-2-2 2 2 2" {...STROKE} />
                  </Frame>
                }
                variant="ghost"
                pressed={options.wrap ?? false}
                aria-label={t('working.diff.wrap')}
                title={t('working.diff.wrap')}
                onClick={() => onOptionsChange({ wrap: !options.wrap })}
              />
            )}
            {textual && (
              <EncodingSelect
                value={options.encoding}
                detected={reportedEncoding}
                decodingErrors={decodingErrors}
                onChange={(encoding) => onOptionsChange({ encoding })}
              />
            )}
          </div>
        </div>
        <div ref={closeRef} className={styles.closeSlot}>
          <IconButton
            icon={<CloseIcon />}
            className={styles.close}
            aria-label={t('working.diff.close', { path })}
            onClick={onClose}
          />
        </div>
      </Toolbar>
    </div>
  );
}

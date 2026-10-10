import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGestures } from '@app/GestureContext';
import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import { toGitOperationError, type GitOperationError } from '@core/domain/errors';
import type { ConflictContents } from '@core/domain/status';
import type { RepoId } from '@core/domain/repository';
import type { GitQuery } from '@core/ports/GitPort';
import { encodingLabel } from '@core/domain/encoding';
import { ConfirmDialog } from '@features/working/ConfirmDialog';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { CodeSurface, type CodeBlockControl, type CodeLineControl } from '@ui/CodeSurface';
import { syntaxLanguageForPath, type CodeLineMark } from '@ui/codeSurface';
import { EncodingSelect } from '@ui/EncodingSelect';
import { IconButton } from '@ui/IconButton';
import { Skeleton } from '@ui/Skeleton';
import { SplitPane } from '@ui/SplitPane';
import { SyncScroll } from '@ui/SyncScroll';
import { useSyncScrollRegistry } from '@ui/syncScroll';
import { useDirectWheel } from '@ui/wheelScroll';

import {
  assemble,
  applyEditorChange,
  editedBlockText,
  buildBlocks,
  conflictBlocks,
  pendingBlocks,
  toLines,
  type LineOrigin,
  type ResolutionSide,
  type SideChoice,
} from './conflict';
import { useResolveStore } from './resolveStore';
import styles from './ThreeWayResolver.module.css';
import { WholeFileCard } from './WholeFileCard';

interface ThreeWayResolverProps {
  repoId: RepoId;
  path: string;
  /** Resuelve el archivo con el texto que quedó. */
  onFinish: (
    text: string,
    origins: readonly LineOrigin[],
    sources: { ours: string; theirs: string },
    revision?: string,
    encoding?: string,
  ) => void | Promise<void>;
  /** Se queda con un lado entero: binarios y lo que pasa del tope. */
  onKeepSide: (side: 'ours' | 'theirs') => void;
  onCancel: () => void;
}

/**
 * El paso 2: los dos lados arriba, el resultado abajo, cubriendo la ventana.
 *
 * Cubre **la ventana entera**, panel izquierdo incluido —decisión 5 del
 * subplan—, al revés que el visor de diff, que solo tapa la columna central:
 * resolver un conflicto es una tarea de pantalla completa y leer un diff es
 * consultar algo sin salir de donde estabas. La barra de título y la barra
 * inferior se quedan, que es por donde se llega a la terminal.
 *
 * La cabecera navega entre conflictos; cada lado permite agregar las líneas
 * seleccionadas o tomar completo el bloque actual. Los mismos bloques se
 * recorren con `Alt+N` y `Alt+P` para conservar el flujo por teclado.
 */
export function ThreeWayResolver({
  repoId,
  path,
  onFinish,
  onKeepSide,
  onCancel,
}: ThreeWayResolverProps) {
  const { t } = useI18n();
  const { git } = usePorts();
  const gestures = useGestures();

  const encoding = useResolveStore((state) => state.encodings.get(path) ?? 'auto');
  const restartWithEncoding = useResolveStore((state) => state.restartWithEncoding);
  const [requestedEncoding, setRequestedEncoding] = useState<string>();
  const choices = useResolveStore((state) => state.choices);
  const blockIndex = useResolveStore((state) => state.blockIndex);
  const setBlockIds = useResolveStore((state) => state.setBlockIds);
  const setLine = useResolveStore((state) => state.setLine);
  const blockText = useResolveStore((state) => state.blockText);
  const setBlockText = useResolveStore((state) => state.setBlockText);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<GitOperationError>();
  const [focusLine, setFocusLine] = useState<{ line: number; request: number }>();
  const setBlockSide = useResolveStore((state) => state.setBlockSide);
  const setAllSide = useResolveStore((state) => state.setAllSide);
  const manual = useResolveStore((state) => state.manual.get(path));
  const setManual = useResolveStore((state) => state.setManual);
  const clearManual = useResolveStore((state) => state.clearManual);

  const load = useCallback(
    (query: GitQuery): Promise<ConflictContents> =>
      git.readConflict(repoId, path, { ...query, encoding }),
    [git, encoding, path, repoId],
  );

  const data = useAsyncData(load);
  const conflict = data.status === 'ready' ? data.data : null;

  const blocks = useMemo(
    () =>
      conflict === null || conflict.tooLarge
        ? []
        : buildBlocks(conflict.base, conflict.ours, conflict.theirs),
    [conflict],
  );

  const conflicts = useMemo(() => conflictBlocks(blocks), [blocks]);

  useEffect(() => {
    setBlockIds(conflicts.map((block) => block.id));
  }, [conflicts, setBlockIds]);

  const result = useMemo(() => assemble(blocks, choices, blockText), [blocks, choices, blockText]);
  /*
   * En modo manual manda lo escrito — CU-6. Los tres controles de toma se
   * apagan mientras dure: reensamblar desde los bloques borraría lo que alguien
   * acaba de escribir, y hacerlo por sorpresa es justo lo que la invariante 2
   * prohíbe. La vuelta atrás existe y dice lo que descarta.
   */
  const editing = manual !== undefined;
  const shown = manual ?? result.text;
  const invalidResult = conflict?.decodingErrors === true && shown.includes('\uFFFD');
  const pending = editing ? 0 : pendingBlocks(blocks, choices, blockText);
  const current = editing ? undefined : conflicts[blockIndex];

  /** Todos los conflictos permanecen visibles, no solo el que tiene el foco. */
  const marksFor = (side: 'ours' | 'theirs'): readonly CodeLineMark[] => {
    return conflicts.flatMap((block) => {
      const from = side === 'ours' ? block.oursLine : block.theirsLine;
      const lines = side === 'ours' ? block.ours : block.theirs;

      return lines.map((_, index) => ({ line: from + index, tone: side }));
    });
  };

  const sideControls = (side: ResolutionSide) => {
    const lineControls: CodeLineControl[] = [];
    const blockControls: CodeBlockControl[] = [];

    blocks
      .filter((block) => block.kind !== 'context')
      .forEach((block) => {
        const blockOffset = conflicts.indexOf(block);
        const automatic = block.kind === 'automatic';
        const lines = side === 'ours' ? block.ours : block.theirs;
        const first = side === 'ours' ? block.oursLine : block.theirsLine;
        const selected = choices.get(block.id) ?? [];
        const sideResultLineCount = resultLineCount(block, selected, blockText.get(block.id)?.text);
        const alignedRows = Math.max(
          block.ours.length,
          block.theirs.length,
          sideResultLineCount,
          1,
        );
        const whole = selected.includes(side);
        const allLinesSelected =
          lines.length > 0 && lines.every((_, index) => selected.includes(`${side}:${index}`));

        blockControls.push({
          id: block.id,
          line: first,
          afterLine: first + Math.max(0, lines.length - 1),
          spacerRows: alignedRows - lines.length,
          spacerBeforeLine: lines.length === 0,
          label: automatic ? '' : t('resolve.take.blockNumber', { number: blockOffset + 1 }),
          anchorOnly: automatic,
          pressed: whole || allLinesSelected,
          disabled: editing,
          tone: side,
          onToggle: automatic
            ? undefined
            : (checked) => {
                setBlockSide(side, block.id, checked);
              },
        });

        if (automatic) return;
        lines.forEach((_, index) => {
          lineControls.push({
            line: first + index,
            checked: whole || selected.includes(`${side}:${index}`),
            disabled: editing,
            label: t('resolve.take.lineFrom', {
              line: first + index,
              branch:
                side === 'ours' ? (conflict?.oursLabel ?? 'A') : (conflict?.theirsLabel ?? 'B'),
            }),
            onToggle: (checked) => {
              setLine(side, block.id, index, checked, lines.length);
            },
          });
        });
      });

    return { lineControls, blockControls };
  };

  const oursControls = sideControls('ours');
  const theirsControls = sideControls('theirs');
  const resultBlocks: readonly CodeBlockControl[] = blocks
    .filter((block) => block.kind !== 'context')
    .map((block) => ({
      id: block.id,
      anchorOnly: true,
      line: result.blockStarts.get(block.id) ?? 1,
      afterLine:
        (result.blockStarts.get(block.id) ?? 1) +
        Math.max(
          0,
          resultLineCount(block, choices.get(block.id), blockText.get(block.id)?.text) - 1,
        ),
      spacerRows:
        Math.max(
          block.ours.length,
          block.theirs.length,
          resultLineCount(block, choices.get(block.id), blockText.get(block.id)?.text),
          1,
        ) - resultLineCount(block, choices.get(block.id), blockText.get(block.id)?.text),
      spacerBeforeLine:
        resultLineCount(block, choices.get(block.id), blockText.get(block.id)?.text) === 0,
      label:
        block.kind === 'automatic'
          ? ''
          : t('resolve.resolver.resultBlock', {
              number: conflicts.indexOf(block) + 1,
              source:
                [
                  ...(blockText.get(block.id)?.resolved ? [t('resolve.resolver.custom')] : []),
                  ...(choices.get(block.id) ?? []).map((choice) =>
                    choice === 'ours' || choice.startsWith('ours:')
                      ? 'A'
                      : choice === 'theirs' || choice.startsWith('theirs:')
                        ? 'B'
                        : t('resolve.take.empty'),
                  ),
                ]
                  .filter((source, sourceIndex, sources) => sources.indexOf(source) === sourceIndex)
                  .join(' + ') || t('resolve.resolver.unresolved'),
            }),
      tone: 'resolved',
      onActivateEmpty:
        block.kind === 'conflict' && !editing && !choices.has(block.id) && !blockText.has(block.id)
          ? () => {
              setBlockText(block.id, '', false);
              setFocusLine((previous) => ({
                line: result.blockStarts.get(block.id) ?? 1,
                request: (previous?.request ?? 0) + 1,
              }));
            }
          : undefined,
    }));

  // Lo escrito a mano no lleva color: de dónde vino cada línea ya no lo sabe
  // nadie, y pintarlo con el origen que tenía antes sería mentir.
  const resultMarks: readonly CodeLineMark[] = editing
    ? []
    : result.origins.flatMap((origin, index) =>
        origin === 'context' || origin === 'manual' ? [] : [{ line: index + 1, tone: origin }],
      );

  if (data.status === 'failed') {
    return (
      <div
        className={styles.overlay}
        role="region"
        aria-label={path}
        onContextMenu={(event) => event.preventDefault()}
      >
        <GitErrorPanel error={data.error} />
      </div>
    );
  }

  if (conflict === null) {
    return (
      <div
        className={styles.overlay}
        role="region"
        aria-label={path}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Skeleton />
      </div>
    );
  }

  /*
   * Lo que no tiene tres paneles que enseñar — CU-10 y CU-11. Un binario, un
   * borrado contra modificado o un archivo por encima del tope se resuelven
   * quedándose con un lado entero, y no pasan por la comprobación.
   */
  if (conflict.tooLarge || conflict.ours === null || conflict.theirs === null) {
    return (
      <div
        className={styles.overlay}
        role="region"
        aria-label={path}
        onContextMenu={(event) => event.preventDefault()}
      >
        <WholeFileCard conflict={conflict} onKeepSide={onKeepSide} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div
      className={styles.overlay}
      role="region"
      aria-label={path}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className={styles.header}>
        <span className={styles.path}>{path}</span>
        <span className={styles.kind}>
          {editing
            ? t('resolve.resolver.manual')
            : t(`resolve.kind.${conflict.kind}`, {
                ours: conflict.oursLabel,
                theirs: conflict.theirsLabel,
              })}
        </span>
        <span className={styles.spacer} />
        <EncodingSelect
          value={encoding}
          detected={conflict.detectedEncoding ?? conflict.encoding ?? 'utf-8'}
          decodingErrors={conflict.decodingErrors}
          disabled={saving}
          onChange={(next) => {
            if (next === encoding) return;
            if (editing || choices.size > 0 || blockText.size > 0) {
              setRequestedEncoding(next);
            } else {
              setSaveError(undefined);
              restartWithEncoding(path, next);
            }
          }}
        />
        <div className={styles.blockNavigation}>
          <IconButton
            icon={<PreviousConflictIcon />}
            aria-label={t('gesture.resolve.previousBlock')}
            size="sm"
            disabled={saving || editing || blockIndex === 0 || conflicts.length === 0}
            onClick={() => {
              gestures.run('resolve.previousBlock');
            }}
          />
          <span className={styles.blockPosition}>
            {t('resolve.resolver.blockPosition', {
              current: conflicts.length === 0 ? 0 : blockIndex + 1,
              total: conflicts.length,
            })}
          </span>
          <IconButton
            icon={<NextConflictIcon />}
            aria-label={t('gesture.resolve.nextBlock')}
            size="sm"
            disabled={saving || editing || blockIndex >= conflicts.length - 1}
            onClick={() => {
              gestures.run('resolve.nextBlock');
            }}
          />
        </div>
        {editing && (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => clearManual(path)}>
            {t('resolve.resolver.backToBlocks')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={styles.cancelAction}
          disabled={saving}
          onClick={onCancel}
        >
          {t('resolve.resolver.cancel')}
        </Button>
        <Button
          size="sm"
          className={styles.finishAction}
          disabled={pending > 0 || saving || invalidResult}
          title={invalidResult ? t('resolve.encoding.invalidResult') : undefined}
          onClick={() => {
            void (async () => {
              if (savingRef.current || pending > 0 || invalidResult) return;
              savingRef.current = true;
              setSaving(true);
              setSaveError(undefined);
              try {
                await onFinish(
                  shown,
                  editing ? toLines(shown).map(() => 'manual' as const) : result.origins,
                  { ours: conflict.oursLabel, theirs: conflict.theirsLabel },
                  conflict.revision,
                  conflict.encoding ?? (encoding === 'auto' ? 'utf-8' : encoding),
                );
              } catch (error) {
                setSaveError(toGitOperationError(error));
              } finally {
                savingRef.current = false;
                setSaving(false);
              }
            })();
          }}
        >
          {pending > 0
            ? t('resolve.resolver.remaining', { count: pending })
            : t('resolve.review.markResolved')}
        </Button>
      </header>

      {invalidResult && (
        <p className={styles.encodingError} role="status">
          {t('resolve.encoding.invalidResult')}
        </p>
      )}
      {requestedEncoding && (
        <ConfirmDialog
          title={t('resolve.encoding.changeTitle', {
            encoding:
              requestedEncoding === 'auto' ? t('encoding.auto') : encodingLabel(requestedEncoding),
          })}
          description={t('resolve.encoding.changeDescription')}
          confirmLabel={t('resolve.encoding.changeConfirm')}
          onCancel={() => setRequestedEncoding(undefined)}
          onConfirm={() => {
            setSaveError(undefined);
            restartWithEncoding(path, requestedEncoding);
            setRequestedEncoding(undefined);
          }}
        />
      )}
      {saveError && <GitErrorPanel error={saveError} />}
      <div className={styles.body} inert={saving}>
        <SyncScroll mode="absolute">
          <SplitPane
            orientation="vertical"
            label={t('resolve.resolver.split')}
            storageId="resolve.split"
            defaultRatio={0.55}
            minFirst={160}
            minSecond={160}
            first={
              <SplitPane
                label={t('resolve.resolver.sides')}
                storageId="resolve.sides"
                defaultRatio={0.5}
                minFirst={240}
                minSecond={240}
                first={
                  <SyncedSide
                    encoding={conflict.encoding ?? 'utf-8'}
                    letter="A"
                    title={conflict.oursLabel}
                    value={(conflict.ours.endsWith('\n')
                      ? conflict.ours
                      : `${conflict.ours}\n`
                    ).replace(/\r\n/g, '\n')}
                    marks={marksFor('ours')}
                    disabled={editing}
                    allSelected={
                      conflicts.length > 0 &&
                      conflicts.every((block) => (choices.get(block.id) ?? []).includes('ours'))
                    }
                    onToggleAll={(checked) => setAllSide('ours', checked)}
                    lineControls={oursControls.lineControls}
                    blockControls={oursControls.blockControls}
                    scrollToBlock={current?.id}
                    language={syntaxLanguageForPath(path) ?? undefined}
                  />
                }
                second={
                  <SyncedSide
                    encoding={conflict.encoding ?? 'utf-8'}
                    letter="B"
                    title={conflict.theirsLabel}
                    value={(conflict.theirs.endsWith('\n')
                      ? conflict.theirs
                      : `${conflict.theirs}\n`
                    ).replace(/\r\n/g, '\n')}
                    marks={marksFor('theirs')}
                    disabled={editing}
                    allSelected={
                      conflicts.length > 0 &&
                      conflicts.every((block) => (choices.get(block.id) ?? []).includes('theirs'))
                    }
                    onToggleAll={(checked) => setAllSide('theirs', checked)}
                    lineControls={theirsControls.lineControls}
                    blockControls={theirsControls.blockControls}
                    scrollToBlock={current?.id}
                    language={syntaxLanguageForPath(path) ?? undefined}
                  />
                }
              />
            }
            second={
              <SyncedResult
                encoding={conflict.encoding ?? 'utf-8'}
                value={shown.replace(/\r\n/g, '\n')}
                focusLine={focusLine}
                label={t('resolve.resolver.result')}
                onChange={(editorText) => {
                  const next = applyEditorChange(shown, editorText);
                  /*
                   * Solo es edición a mano lo que se aparta de lo que arman los
                   * bloques. `CodeSurface` avisa de **cualquier** cambio del
                   * documento, incluido el que provoca cambiar su `value`: sin
                   * esta comparación, volver a los bloques reescribiría el
                   * texto, eso llegaría aquí como si alguien hubiera escrito, y
                   * el archivo no saldría nunca del modo manual.
                   */
                  if (next === result.text) {
                    if (editing) clearManual(path);
                    return;
                  }
                  const edit = !editing ? editedBlockText(result, next) : null;
                  if (edit) setBlockText(edit.id, edit.text);
                  else setManual(path, next);
                }}
                marks={resultMarks}
                blockControls={
                  shown !== '' && !shown.endsWith('\n')
                    ? [
                        ...resultBlocks,
                        {
                          id: 'terminal-padding',
                          anchorOnly: true,
                          label: '',
                          line: toLines(shown).length,
                          spacerRows: 1,
                        },
                      ]
                    : resultBlocks
                }
                scrollToBlock={current?.id}
                language={syntaxLanguageForPath(path) ?? undefined}
              />
            }
          />
        </SyncScroll>
      </div>
    </div>
  );
}

/**
 * Un lado del resolutor: su rótulo y su visor, con el scroll atado al del otro.
 *
 * **Quien scrollea es el editor**, no un contenedor de fuera. Envolverlo en uno
 * —lo que hacía `fitContent` con `SyncScrollPane`— obliga a CodeMirror a
 * suscribirse al scroll ajeno y a remedir su ventana en **cada** evento; con una
 * rueda inercial eso son cien mediciones por segundo y por panel, y el
 * desplazamiento se arrastra justo cuando más rápido se gira. Midiéndolo:
 * 1,4 ms por evento así, contra 0,35 de un contenedor sin nada dentro.
 */
function SyncedSide({
  letter,
  title,
  value,
  encoding,
  marks,
  disabled,
  allSelected,
  onToggleAll,
  lineControls,
  blockControls,
  scrollToBlock,
  language,
}: {
  encoding: string;
  letter: 'A' | 'B';
  title: string;
  value: string;
  marks: readonly CodeLineMark[];
  disabled: boolean;
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  lineControls: readonly CodeLineControl[];
  blockControls: readonly CodeBlockControl[];
  scrollToBlock?: string;
  language?: Parameters<typeof CodeSurface>[0]['language'];
}) {
  const { t } = useI18n();
  const attach = useSyncedScroller();

  return (
    <div className={styles.side}>
      <header className={styles.sideTitle}>
        <label className={styles.sideChoice} data-side={letter}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={disabled}
            aria-label={t('resolve.take.allFrom', { side: letter, branch: title })}
            onChange={(event) => onToggleAll(event.currentTarget.checked)}
          />
          <strong className={styles.sideBadge} data-side={letter}>
            {letter}
          </strong>
          <span className={styles.sideTitleLabel}>{title}</span>
        </label>
      </header>
      <CodeSurface
        value={value}
        encoding={encoding}
        label={`${letter} · ${title}`}
        showLineNumbers
        scrollerRef={attach}
        marks={marks}
        lineControls={lineControls}
        blockControls={blockControls}
        scrollToBlock={scrollToBlock}
        language={language}
        className={styles.pane}
      />
    </div>
  );
}

function SyncedResult({
  value,
  encoding,
  label,
  onChange,
  focusLine,
  marks,
  blockControls,
  scrollToBlock,
  language,
}: {
  value: string;
  encoding: string;
  label: string;
  onChange: (value: string) => void;
  focusLine?: { line: number; request: number };
  marks: readonly CodeLineMark[];
  blockControls: readonly CodeBlockControl[];
  scrollToBlock?: string;
  language?: Parameters<typeof CodeSurface>[0]['language'];
}) {
  const attach = useSyncedScroller();

  return (
    <section className={styles.side} aria-label={label}>
      <header className={styles.sideTitle}>{label}</header>
      <CodeSurface
        value={value}
        encoding={encoding}
        label={label}
        showLineNumbers
        readOnly={false}
        onChange={onChange}
        focusLine={focusLine}
        scrollerRef={attach}
        marks={marks}
        blockControls={blockControls}
        scrollToBlock={scrollToBlock}
        language={language}
        className={styles.pane}
      />
    </section>
  );
}

/** Registra el elemento que realmente desplaza cada CodeMirror. */
function useSyncedScroller() {
  const registry = useSyncScrollRegistry();
  const unregisterRef = useRef<(() => void) | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  // La rueda no se le deja al navegador — ver `useDirectWheel`: el WebKit de la
  // ventana la anima por su cuenta y una rueda inercial acaba avanzando menos
  // cuanto más rápido gira.
  useDirectWheel(scroller);

  const attach = useCallback(
    (next: HTMLElement | null) => {
      unregisterRef.current?.();
      unregisterRef.current = null;
      setScroller(next);

      if (!next) return;

      const onScroll = () => {
        if (next.dataset.preservingScroll) return;
        registry.broadcast(next);
      };

      const unregister = registry.register(next);

      next.addEventListener('scroll', onScroll, { passive: true });

      unregisterRef.current = () => {
        next.removeEventListener('scroll', onScroll);
        unregister();
      };
    },
    [registry],
  );

  useEffect(() => () => unregisterRef.current?.(), []);

  return attach;
}

function resultLineCount(
  block: ReturnType<typeof conflictBlocks>[number],
  selected: readonly SideChoice[] | undefined,
  manualText?: string,
): number {
  if (block.kind !== 'conflict') return toLines(block.mergedText ?? '').length;
  return (selected ?? []).reduce(
    (count, choice) => {
      if (choice === 'ours') return count + block.ours.length;
      if (choice === 'theirs') return count + block.theirs.length;
      if (choice === 'none') return count;

      return count + 1;
    },
    manualText === undefined ? 0 : manualText.split('\n').length,
  );
}

function PreviousConflictIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 3 14 11H2L8 3Z" />
    </svg>
  );
}

function NextConflictIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 13 2 5h12L8 13Z" />
    </svg>
  );
}

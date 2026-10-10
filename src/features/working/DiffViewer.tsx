import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type {
  BinaryDiff,
  DiffPrecondition,
  DiffSource,
  FileContents,
  FileDiff,
  Hunk,
} from '@core/domain/diff';
import type { RepoId } from '@core/domain/repository';
import type { WorkingStatus } from '@core/domain/status';
import type { GitQuery, LineRef } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { CodeSurface } from '@ui/CodeSurface';
import { syntaxLanguageForPath } from '@ui/codeSurface';
import { ContextMenu } from '@ui/ContextMenu';
import { EmptyState } from '@ui/EmptyState';
import { MarkerScrollbar } from '@ui/MarkerScrollbar';
import { ProgressBar } from '@ui/ProgressBar';
import { Skeleton } from '@ui/Skeleton';
import { SyncScroll } from '@ui/SyncScroll';
import { SyncScrollPane } from '@ui/SyncScrollPane';
import { useSyncScrollRegistry } from '@ui/syncScroll';
import type { CodeBlockControl, CodeLineControl, CodeSurfaceFoldLabels } from '@ui/CodeSurface';
import type { MarkerTone } from '@ui/markerScrollbar';
import type { MenuEntry } from '@ui/menu';

import {
  fileBlocks,
  fileRows,
  hunkBlocks,
  hunkMarkers,
  historicalRows,
  workingRows,
  newColumn,
  oldColumn,
  splitRows,
  stageableLines,
  unifiedColumn,
  type DiffBlock,
  type DiffColumn,
  type DiffRow,
} from './diffView';
import styles from './DiffViewer.module.css';
import { DiffToolbar } from './DiffToolbar';
import type { StageDirection, WorkingActions } from './useWorkingActions';
import {
  useWorkingStore,
  type DiffOptions,
  type DiffScope,
  type WorkingDiff,
} from './workingStore';

interface DiffViewerProps {
  repoId: RepoId;
  diff: WorkingDiff;
  actions: WorkingActions;
  /**
   * El estado del árbol, solo para saber cuándo volver a pedir el diff.
   *
   * Preparar un hunk cambia qué queda de este lado, así que el diff que se está
   * leyendo caducó. `GitPort` devuelve el `WorkingStatus` nuevo en cada
   * escritura y `WorkingView` lo deja puesto; ese objeto nuevo es la señal.
   */
  status: WorkingStatus | null;
  onClose: () => void;
}

interface DiffData {
  file: FileDiff;
  /** El archivo entero, solo cuando hace falta enseñarlo. */
  contents: FileContents | null;
}

/** Un añadido o borrado contiene el archivo completo en sus líneas cambiadas. */
function oneSidedContents(file: FileDiff): FileContents | null {
  if (file.content.kind !== 'text') return null;
  const kind = file.change === 'deleted' ? 'removed' : 'added';
  if (file.change !== 'deleted' && file.change !== 'added' && file.change !== 'untracked') {
    return null;
  }
  const text = file.content.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === kind)
    .map((line) => line.text)
    .join('\n');
  return {
    path: file.path,
    text,
    binary: false,
    size: new TextEncoder().encode(text).length,
    mediaType: 'text/plain',
    encoding: file.content.encoding,
  };
}

/** Se compara al recibir una consulta, nunca al mover el puntero o hacer scroll. */
function sameDiffData(previous: DiffData, next: DiffData): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

const SKELETON_ROWS = 12;

/** A qué revisión pertenece el archivo completo de este origen. */
function revisionOf(source: DiffSource): string | undefined {
  if (source.kind === 'commit') return source.sha;
  if (source.kind === 'range') return source.to;
  if (source.kind === 'workingRange') return undefined;

  return undefined;
}

/** Solo el árbol de trabajo y el índice se pueden preparar; lo demás ya está escrito. */
function stageDirectionOf(source: DiffSource): StageDirection | null {
  if (source.kind === 'worktree') return 'stage';
  if (source.kind === 'index') return 'unstage';

  return null;
}

/**
 * De qué tono es un tramo modificado en la barra de posición.
 *
 * **No hay «parcialmente preparado» por hunk, y no es una simplificación.** El
 * diff del árbol de trabajo es, por definición, lo que **no** está en el índice,
 * y el del índice lo que sí. Preparar la mitad de un hunk no deja un hunk a
 * medias: deja un hunk más chico en un lado y otro en el otro, que es como git
 * lo cuenta y lo que hace que un archivo salga a la vez en Seguimiento y en
 * Stage.
 */
function markerToneOfRows(rows: readonly DiffRow[]): MarkerTone {
  const added = rows.some((row) => row.kind === 'added');
  const removed = rows.some((row) => row.kind === 'removed');

  if (added && removed) return 'mixed';
  if (added) return 'added';
  if (removed) return 'removed';
  return 'neutral';
}

function markerToneLabel(tone: MarkerTone, t: ReturnType<typeof useI18n>['t']): string {
  if (tone === 'added') return t('working.diff.marker.added');
  if (tone === 'removed') return t('working.diff.marker.removed');
  if (tone === 'mixed') return t('working.diff.marker.mixed');
  return t('working.diff.marker.neutral');
}

function diffMarkerTone(_block: DiffBlock, rows: readonly DiffRow[]): MarkerTone {
  return markerToneOfRows(rows);
}

/** Qué líneas de la nueva versión hay marcadas dentro de un bloque. */
interface LineSelection {
  block: string;
  lines: readonly LineRef[];
}

/**
 * El visor de diff — CU-5.
 *
 * Se superpone **a la tabla y no a la barra de acciones** —decisión 2 del
 * subplan—: cubre la caja que `WorkingView` reserva para eso, así que los dos
 * paneles laterales y los nueve botones siguen vivos mientras se lee. Cuando
 * nace desde el historial de un archivo, este permanece operable en el panel
 * derecho para cambiar de versión sin cerrar el diff — CU-19.
 *
 * **Cada hunk es su propio `CodeSurface`.** El primitivo sabe pintar líneas con
 * tono y ahora también tramos de palabra, pero no sabe qué es un hunk ni qué son
 * dos columnas; eso se construye por encima apilando visores que crecen con su
 * contenido —`fitContent`— dentro de un solo contenedor con scroll. Es lo que
 * deja poner una cabecera con su botón de stage entre hunk y hunk, y lo que hace
 * que las dos columnas se muevan juntas sin sincronizar dos barras. Los hunks
 * numerosos del WIP se consolidan en un documento estable por columna.
 */
export function DiffViewer({ repoId, diff, actions, status, onClose }: DiffViewerProps) {
  const { t } = useI18n();
  const { git } = usePorts();

  const options = useWorkingStore((state) => state.diffOptions);
  const setOptions = useWorkingStore((state) => state.setDiffOptions);

  const { path, source } = diff;
  const { columns, scope, content, encoding, ignoreWhitespace } = options;

  const scrollRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [viewport, setViewport] = useState<{ from: number; to: number } | null>(null);

  // El archivo completo hace falta en los dos modos que lo enseñan: «archivo
  // completo» rellena el contexto entre hunks, y «archivo» lo enseña tal cual.
  const wholeFile = scope === 'file' || content === 'file';
  const liveStatus =
    source.kind === 'worktree' || source.kind === 'index' || source.kind === 'workingRange'
      ? status
      : null;

  const load = useCallback(
    async (query: GitQuery): Promise<DiffData> => {
      const file = await git.readDiff(repoId, { path, source, ignoreWhitespace, encoding }, query);

      if (!wholeFile || file.content.kind === 'binary') return { file, contents: null };

      const oneSided = oneSidedContents(file);
      if (oneSided !== null) return { file, contents: oneSided };

      return {
        file,
        contents: await git.readFile(repoId, path, revisionOf(source), {
          ...query,
          encoding,
          ...(source.kind === 'index' && file.precondition.after !== null
            ? { blob: file.precondition.after.oid }
            : {}),
        }),
      };
    },
    // Solo las fuentes vivas dependen de `status`: un commit o rango identifica
    // árboles inmutables y no debe recargarse por la ráfaga del watcher que
    // sigue a un merge. En Worktree, índice y WIP, en cambio, un estado nuevo sí
    // significa que el diff visible quedó obsoleto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [git, encoding, ignoreWhitespace, liveStatus, path, repoId, source, wholeFile],
  );

  // Status es una señal de invalidación de todo el repo, no la identidad del
  // archivo. Consultarlo de nuevo no debe sustituir sus editores por skeletons.
  const resourceKey = JSON.stringify([repoId, path, source, encoding, ignoreWhitespace, wholeFile]);
  const data = useAsyncData(load, { resourceKey, isEqual: sameDiffData });

  /*
   * `Esc` cierra el visor, y lo cierra **antes** que nadie — decisión 8.
   *
   * La escucha es del propio visor y dura lo que dura el visor: nace al abrirlo
   * y se va al cerrarlo, así que no hay nada que declarar en el registro central
   * ni un atajo que pueda quedarse colgado. Va en `document` y no en la región
   * porque el foco puede haberse ido a la lista de archivos o al panel derecho
   * mientras el diff sigue abierto, y ahí `Esc` tiene que seguir significando
   * «cierra esto». Detener la propagación es lo que impide que llegue a la
   * escucha del shell, que en `window` tiene `Esc` como «cerrar el modo»: es la
   * misma prioridad que `keys.ts` ya le da a un campo de texto sobre el shell, y
   * lo que un diálogo abierto encima ya habrá parado antes.
   */
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      event.stopPropagation();
      onClose();
    };

    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('keydown', onEscape);
    };
  }, [onClose]);

  /*
   * Cambiar de archivo, de origen o de modo suelta la selección de líneas.
   *
   * Los números marcados eran de otro documento, y quedarse con ellos prepararía
   * líneas que no son las que se ven. Se ajusta durante el render y no en un
   * efecto —el patrón que ya usan `useAsyncData` y el parche de `WorkingView`—
   * porque si no el cuadro que ya se pintó ofrecería «pasar 3 líneas al stage»
   * sobre un archivo que no las tiene.
   */
  const documentKey = `${resourceKey}|${columns}|${scope}|${content}`;
  const [seenDocument, setSeenDocument] = useState(documentKey);
  const currentFile = data.status === 'ready' ? data.data.file : null;
  const [seenFile, setSeenFile] = useState(currentFile);

  if (seenDocument !== documentKey || seenFile !== currentFile) {
    setSeenDocument(documentKey);
    setSeenFile(currentFile);
    setSelection(null);
  }

  const textual = data.status !== 'ready' || data.data.file.content.kind === 'text';
  const reportedEncoding =
    data.status === 'ready' && data.data.file.content.kind === 'text'
      ? (data.data.file.content.detectedEncoding ?? data.data.file.content.encoding)
      : null;

  const toolbar = (
    <DiffToolbar
      path={path}
      source={source}
      options={options}
      onOptionsChange={setOptions}
      reportedEncoding={reportedEncoding}
      decodingErrors={
        data.status === 'ready' &&
        data.data.file.content.kind === 'text' &&
        data.data.file.content.decodingErrors
      }
      textual={textual}
      onClose={onClose}
    />
  );

  return (
    <section
      data-diff-viewer=""
      className={styles.viewer}
      tabIndex={-1}
      aria-label={t('working.diff.label', { path })}
    >
      {toolbar}

      {data.status === 'loading' && (
        <div
          className={styles.padded}
          role="status"
          aria-label={t('working.diff.loading', { path })}
        >
          <ProgressBar label={t('working.diff.loading', { path })} />
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} variant="text" />
          ))}
        </div>
      )}

      {data.status === 'failed' && (
        <div className={styles.padded}>
          {/* Dentro del visor y sin cerrarlo: la sección 3 del subplan lo pide
              así, porque cerrar en un fallo se lee como que no había nada. */}
          <GitErrorPanel error={data.error} fixes={{ retry: data.reload }} />
        </div>
      )}

      {data.status === 'ready' && (
        <DiffBody
          data={data.data}
          options={options}
          path={path}
          source={source}
          encoding={
            data.data.file.content.kind === 'text' ? data.data.file.content.encoding : encoding
          }
          direction={
            data.data.file.content.kind === 'text' &&
            data.data.file.content.supportsPartial === false
              ? null
              : stageDirectionOf(source)
          }
          tone={diffMarkerTone}
          selection={selection}
          onSelection={setSelection}
          viewport={viewport}
          onViewport={setViewport}
          scrollRef={scrollRef}
          actions={actions}
        />
      )}
    </section>
  );
}

interface DiffBodyProps {
  data: DiffData;
  options: DiffOptions;
  path: string;
  source: DiffSource;
  encoding: string;
  direction: StageDirection | null;
  tone: (block: DiffBlock, rows: readonly DiffRow[]) => MarkerTone;
  selection: LineSelection | null;
  onSelection: (selection: LineSelection | null) => void;
  viewport: { from: number; to: number } | null;
  onViewport: (viewport: { from: number; to: number }) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  actions: WorkingActions;
}

/** Lo que se ve debajo de la barra cuando el puerto ya contestó. */
function DiffBody({
  data,
  options,
  path,
  source,
  encoding,
  direction,
  tone,
  selection,
  onSelection,
  viewport,
  onViewport,
  scrollRef,
  actions,
}: DiffBodyProps) {
  const { t } = useI18n();
  const focusedDocument = useRef<string | null>(null);

  const { file, contents } = data;

  const folding = useMemo<CodeSurfaceFoldLabels>(
    () => ({
      fold: t('working.diff.fold'),
      unfold: t('working.diff.unfold'),
      folded: t('working.diff.folded'),
    }),
    [t],
  );

  const hunks = file.content.kind === 'text' ? file.content.hunks : NO_HUNKS;
  const fileLines = useMemo(() => (contents?.text ?? '').split('\n'), [contents]);
  // Para un borrado `oneSidedContents` reconstruye la versión anterior, que se
  // necesita en el modo Archivo. El diff debe recorrer una versión nueva vacía;
  // usar aquí la anterior repetía todo el texto como contexto sin sombrear.
  const diffFileLines = file.change === 'deleted' ? NO_FILE_LINES : fileLines;

  const whole = options.scope === 'file';
  const splitOwnsScroll =
    whole &&
    options.columns === 'split' &&
    file.change !== 'added' &&
    file.change !== 'untracked' &&
    file.change !== 'deleted';

  const blocks = useMemo(
    () => (whole ? fileBlocks(diffFileLines, hunks) : hunkBlocks(hunks)),
    [diffFileLines, hunks, whole],
  );

  /*
   * En «archivo completo» el archivo entero es **un solo bloque**.
   *
   * Cada bloque monta su propio editor, y un editor no comparte selección con
   * los de al lado: partido en tramos, marcar con el ratón se paraba en el
   * borde del tramo y lo marcado en el anterior se quedaba encendido. Los
   * bloques de arriba siguen calculándose, pero ya solo para las marcas de la
   * barra de posición, que sí se cuentan por hunk.
   */
  const continuous = useMemo<DiffBlock | null>(
    () =>
      whole ? { key: 'file', hunk: null, number: 0, rows: fileRows(diffFileLines, hunks) } : null,
    [diffFileLines, hunks, whole],
  );

  // Un commit de merge puede producir decenas de hunks por archivo. Montar un
  // CodeMirror por hunk hacía 20–40 editores por selección y congelaba la UI al
  // recorrer archivos. Las fuentes históricas no tienen acciones de stage, así
  // que se leen en un único documento por columna, con sus cabeceras incluidas.
  const historical = useMemo<DiffBlock | null>(
    () =>
      !whole && direction === null
        ? {
            key: 'historical',
            hunk: null,
            number: 0,
            rows: historicalRows(blocks),
          }
        : null,
    [blocks, direction, whole],
  );
  const working = useMemo<DiffBlock | null>(
    () =>
      !whole && direction !== null && blocks.length > 8
        ? { key: 'working', hunk: null, number: 0, rows: workingRows(blocks) }
        : null,
    [blocks, direction, whole],
  );
  const consolidated = continuous ?? historical ?? working;
  const renderedBlocks = consolidated === null ? blocks : [consolidated];

  const firstChangedRange = useMemo(() => {
    const rows = consolidated?.rows ?? blocks[0]?.rows ?? [];
    const columns = options.columns === 'split' ? Object.values(splitRows(rows)) : [rows];
    const changed = (index: number) =>
      columns.some((column) => {
        const kind = column[index]?.kind;
        return kind === 'added' || kind === 'removed';
      });
    const from = columns[0]?.findIndex((_row, index) => changed(index)) ?? -1;
    if (from < 0) return undefined;
    let to = from;
    while (changed(to + 1)) to += 1;
    return { from: from + 1, to: to + 1 };
  }, [blocks, consolidated, options.columns]);

  const markers = useMemo(
    () =>
      hunkMarkers(
        blocks,
        tone,
        (block, rows) =>
          t('working.diff.marker', {
            number: block.number,
            from: block.hunk?.newStart ?? 0,
            to: (block.hunk?.newStart ?? 0) + (block.hunk?.newLines ?? 0),
            change: markerToneLabel(markerToneOfRows(rows), t),
          }),
        !whole,
      ),
    [blocks, t, tone, whole],
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const first = hunks[0];
    if (!element || !first) return;

    const documentKey = JSON.stringify([path, source, options.content, options.scope]);
    if (focusedDocument.current === documentKey) return;

    let measuredFrame: number | undefined;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      // CodeMirror conoce el alto real de cada línea, incluso con wrap. Su
      // efecto desplaza el viewport propio o el contenedor externo según el modo.
      const editor =
        element.closest<HTMLElement>('.cm-editor') ??
        element.querySelector<HTMLElement>('.cm-editor');
      const view = editor ? EditorView.findFromDOM(editor) : null;
      if (!view) return;

      let range = firstChangedRange;
      if (options.content === 'file') {
        const line = Math.max(1, first.newStart || first.oldStart);
        range = { from: line, to: line + Math.max(1, first.newLines) - 1 };
      }
      if (!range) return;

      const start = view.state.doc.line(Math.min(range.from, view.state.doc.lines));
      const end = view.state.doc.line(Math.min(range.to, view.state.doc.lines));
      const blockHeight = view.lineBlockAt(end.to).bottom - view.lineBlockAt(start.from).top;
      // La cabeza queda al inicio para que un bloque más alto que el viewport
      // enseñe sus primeras líneas. El navegador limita el scroll en los bordes.
      focusedDocument.current = documentKey;
      view.dispatch({
        effects: EditorView.scrollIntoView(EditorSelection.range(end.to, start.from), {
          y: blockHeight > element.clientHeight ? 'start' : 'center',
          yMargin: 28,
        }),
      });
      // La primera navegación puede usar alturas estimadas fuera del viewport.
      // Después de pintar el destino, afina el centro con los rectángulos reales.
      let measurements = 0;
      const refine = () => {
        if (cancelled) return;
        measurements += 1;
        view.requestMeasure({
          read: () => {
            const firstLine = view.coordsAtPos(start.from);
            const lastLine = view.coordsAtPos(end.to);
            if (!firstLine || !lastLine) return null;
            const box = element.getBoundingClientRect();
            const height = lastLine.bottom - firstLine.top;
            return height > element.clientHeight
              ? firstLine.top - box.top - 28
              : (firstLine.top + lastLine.bottom) / 2 - box.top - element.clientHeight / 2;
          },
          write: (offset) => {
            if (cancelled) return;
            if (offset !== null) element.scrollTop += offset;
            if (measurements < 3) {
              measuredFrame = requestAnimationFrame(refine);
            }
          },
        });
      };
      measuredFrame = requestAnimationFrame(refine);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (measuredFrame !== undefined) cancelAnimationFrame(measuredFrame);
    };
  }, [
    contents?.text,
    file,
    firstChangedRange,
    hunks,
    options.content,
    options.scope,
    path,
    scrollRef,
    source,
  ]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;

    if (!element || element.scrollHeight <= 0) return;

    // De píxeles a filas, que es la unidad en la que se contaron las marcas.
    const rows = markers.total / element.scrollHeight;

    onViewport({
      from: element.scrollTop * rows,
      to: (element.scrollTop + element.clientHeight) * rows,
    });
  }, [markers.total, onViewport, scrollRef]);

  const attachPrimaryScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element;
      if (element) onScroll();
    },
    [onScroll, scrollRef],
  );

  const onSeek = useCallback(
    (position: number) => {
      const element = scrollRef.current;

      if (!element || markers.total <= 0) return;

      element.scrollTop = (position / markers.total) * element.scrollHeight;
    },
    [markers.total, scrollRef],
  );

  if (file.content.kind === 'binary') {
    return <BinaryCard content={file.content} />;
  }

  // El archivo tal cual quedó, sin una sola marca: es la otra mitad de la
  // alternancia diff/archivo, y su gracia es justamente leerlo limpio.
  if (options.content === 'file') {
    return (
      <div className={styles.body}>
        <div className={styles.scroll} ref={scrollRef}>
          {contents?.text === null || contents === null ? (
            <div className={styles.padded}>
              <EmptyState
                size="sm"
                title={t('working.diff.noContents.title', { path })}
                description={t('working.diff.noContents.description')}
              />
            </div>
          ) : (
            <CodeSurface
              className={styles.surface}
              value={contents.text}
              label={t('working.diff.file', { path })}
              encoding={encoding}
              wrap={options.wrap ?? false}
              longLineLabel={t('working.diff.longLine')}
              folding={folding}
              language={syntaxLanguageForPath(path) ?? undefined}
              fitContent
            />
          )}
        </div>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className={styles.padded}>
        <EmptyState
          size="sm"
          title={t('working.diff.empty.title', { path })}
          description={t('working.diff.empty.description')}
        />
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <SyncScroll axis={splitOwnsScroll ? 'both' : 'horizontal'} mode="absolute">
        <div
          className={`${styles.scroll} ${styles.diffScroll} ${splitOwnsScroll ? styles.ownedDiffScroll : ''}`}
          ref={splitOwnsScroll ? undefined : scrollRef}
          onScroll={splitOwnsScroll ? undefined : onScroll}
        >
          {file.content.truncated && (
            <p className={styles.truncated} role="status">
              {t('working.diff.truncated')}
            </p>
          )}
          {renderedBlocks.map((block) => (
            <DiffBlockView
              key={block.key}
              block={block}
              actionBlocks={working === null ? undefined : blocks}
              path={path}
              encoding={encoding}
              split={
                options.columns === 'split' &&
                file.change !== 'added' &&
                file.change !== 'untracked' &&
                file.change !== 'deleted'
              }
              ownScroll={splitOwnsScroll}
              wrap={options.wrap ?? false}
              onPrimaryScroller={attachPrimaryScroller}
              onPrimaryScroll={onScroll}
              scope={options.scope}
              direction={direction}
              precondition={file.precondition}
              ignoreWhitespace={options.ignoreWhitespace}
              selection={selection?.block === block.key ? selection.lines : NO_LINES}
              onSelection={onSelection}
              actions={actions}
            />
          ))}
        </div>
      </SyncScroll>

      <MarkerScrollbar
        markers={markers.markers}
        label={t('working.diff.markers', { path })}
        total={markers.total}
        {...(viewport === null ? {} : { viewport })}
        onSeek={onSeek}
        onSelect={(marker) => {
          onSeek(marker.from);
        }}
      />
    </div>
  );
}

const NO_HUNKS: readonly Hunk[] = [];
const NO_LINES: readonly LineRef[] = [];
const NO_FILE_LINES: readonly string[] = [];

interface DiffBlockViewProps {
  block: DiffBlock;
  actionBlocks?: readonly DiffBlock[];
  path: string;
  encoding: string;
  split: boolean;
  ownScroll: boolean;
  wrap: boolean;
  onPrimaryScroller: (element: HTMLDivElement | null) => void;
  onPrimaryScroll: () => void;
  scope: DiffScope;
  direction: StageDirection | null;
  precondition: DiffPrecondition;
  ignoreWhitespace: boolean;
  selection: readonly LineRef[];
  onSelection: (selection: LineSelection | null) => void;
  actions: WorkingActions;
}

/**
 * Un hunk con su cabecera, o el contexto entre dos hunks.
 *
 * Es un componente aparte y no un trozo del cuerpo porque cada bloque tiene que
 * poder darle a su `CodeSurface` una función de selección **estable**: si se
 * armara en el padre, cada repintado reconfiguraría todos los editores de la
 * pantalla en vez de ninguno.
 */
function DiffBlockView({
  block,
  actionBlocks,
  path,
  encoding,
  split,
  ownScroll,
  wrap,
  onPrimaryScroller,
  onPrimaryScroll,
  scope,
  direction,
  precondition,
  ignoreWhitespace,
  selection,
  onSelection,
  actions,
}: DiffBlockViewProps) {
  const { t } = useI18n();
  const pendingWrites = useWorkingStore((state) => state.pendingWrites);
  const attachLeftScroller = useSyncedScroller(onPrimaryScroller, onPrimaryScroll);
  const attachRightScroller = useSyncedScroller();

  const sides = useMemo(() => (split ? splitRows(block.rows) : null), [block.rows, split]);

  const unified = useMemo(
    () => (sides === null ? unifiedColumn(block.rows) : null),
    [block.rows, sides],
  );

  const left = useMemo(() => (sides === null ? null : oldColumn(sides.left)), [sides]);
  const right = useMemo(() => (sides === null ? null : newColumn(sides.right)), [sides]);

  /*
   * De qué columna sale la selección de líneas.
   *
   * Una modificación alineada en dos columnas incluye la eliminación y la
   * adición de esa fila. En la vista unificada se pueden seleccionar ambas
   * partes de manera independiente, como aparecen en el parche de Git.
   */
  const onSelectedLinesRight = useCallback(
    (range: { from: number; to: number }) => {
      const target = right ?? unified;

      if (target === null) return;

      const lines = stageableLines(target.rows, range.from, range.to, left?.rows);

      onSelection(lines.length === 0 ? null : { block: block.key, lines });
    },
    [block.key, left, onSelection, right, unified],
  );

  const onSelectedLinesLeft = useCallback(
    (range: { from: number; to: number }) => {
      if (left === null) return;

      const lines = stageableLines(left.rows, range.from, range.to, right?.rows);

      onSelection(lines.length === 0 ? null : { block: block.key, lines });
    },
    [block.key, onSelection, left, right],
  );

  const selectionCount = useMemo(() => {
    if (!sides) return selection.length;
    const selected = new Set(selection.map((line) => `${line.side}:${line.line}`));
    return sides.left.reduce((count, row, index) => {
      const other = sides.right[index];
      return (
        count +
        Number(
          (row.kind === 'removed' && selected.has(`old:${row.oldLine}`)) ||
            (other?.kind === 'added' && selected.has(`new:${other.newLine}`)),
        )
      );
    }, 0);
  }, [selection, sides]);

  const anchors = useMemo(
    () => new Set(block.rows.filter((row) => row.kind === 'padding')),
    [block.rows],
  );
  const selectedHunk = useMemo(() => {
    const selected = new Set(selection.map((line) => `${line.side}:${line.line}`));
    return actionBlocks?.find((source) =>
      source.rows.some(
        (row) =>
          (row.kind === 'added' && selected.has(`new:${row.newLine}`)) ||
          (row.kind === 'removed' && selected.has(`old:${row.oldLine}`)),
      ),
    )?.key;
  }, [actionBlocks, selection]);
  const controlsFor = useCallback(
    (column: DiffColumn | null): readonly CodeBlockControl[] | undefined => {
      if (!column || !actionBlocks || direction === null) return undefined;
      let index = 0;
      return column.rows.flatMap((row, line) => {
        if (row.kind !== 'padding' || row.oldLine !== null || row.newLine !== null) return [];
        // Solo las filas de anclaje pertenecen a block.rows. El relleno de la
        // vista dividida lo introduce splitRows y no debe convertirse en cabecera.
        if (!anchors.has(row)) return [];
        const source = actionBlocks[index++];
        if (!source?.hunk) return [];
        const hunk = source.hunk;
        return [
          {
            id: hunk.id,
            line: line + 1,
            label: `${t('working.diff.hunkRange', { from: hunk.newStart, to: hunk.newStart + hunk.newLines })} ${hunk.header}`,
            actions: [
              ...(source.key === selectedHunk
                ? [
                    {
                      label: t(
                        direction === 'stage'
                          ? 'working.diff.stageLines'
                          : 'working.diff.unstageLines',
                        { count: selectionCount },
                      ),
                      onSelect: () => {
                        actions.stageLines(
                          path,
                          selection,
                          direction,
                          precondition,
                          ignoreWhitespace,
                        );
                        onSelection(null);
                      },
                    },
                  ]
                : []),
              {
                label: t(
                  direction === 'stage' ? 'working.diff.stageHunk' : 'working.diff.unstageHunk',
                  { number: source.number },
                ),
                onSelect: () =>
                  actions.stageHunk(path, hunk.id, direction, precondition, ignoreWhitespace),
              },
            ],
          },
        ];
      });
    },
    [
      actionBlocks,
      actions,
      anchors,
      direction,
      ignoreWhitespace,
      onSelection,
      path,
      precondition,
      selectedHunk,
      selection,
      selectionCount,
      t,
    ],
  );
  const unifiedControls = useMemo(() => controlsFor(unified), [controlsFor, unified]);
  const leftControls = useMemo(() => controlsFor(left), [controlsFor, left]);
  const rightControls = useMemo(() => controlsFor(right), [controlsFor, right]);

  const lineControlsFor = useCallback(
    (column: DiffColumn): readonly CodeLineControl[] | undefined => {
      if (direction === null) return undefined;
      return column.rows.flatMap((row, index) => {
        const counterpart = column === right ? left : column === left ? right : null;
        const lines = stageableLines(column.rows, index + 1, index + 1, counterpart?.rows);
        const line =
          row.kind === 'added'
            ? lines.find((ref) => ref.side === 'new')
            : lines.find((ref) => ref.side === 'old');
        if (!line) return [];
        return [
          {
            line: index + 1,
            checked: false,
            disabled: pendingWrites > 0,
            symbol: direction === 'stage' ? ('+' as const) : ('−' as const),
            label: t(
              direction === 'stage' ? 'working.diff.stageLine' : 'working.diff.unstageLine',
              { line: line.line },
            ),
            onToggle: () => {
              actions.stageLines(path, lines, direction, precondition, ignoreWhitespace);
              onSelection(null);
            },
          },
        ];
      });
    },
    [
      actions,
      direction,
      ignoreWhitespace,
      left,
      onSelection,
      path,
      pendingWrites,
      precondition,
      right,
      t,
    ],
  );
  const unifiedLineControls = useMemo(
    () => unified && lineControlsFor(unified),
    [lineControlsFor, unified],
  );
  const leftLineControls = useMemo(() => left && lineControlsFor(left), [left, lineControlsFor]);
  const rightLineControls = useMemo(
    () => right && lineControlsFor(right),
    [lineControlsFor, right],
  );

  const { hunk } = block;

  /*
   * Cada visor se rotula con la línea en la que empieza su bloque.
   *
   * Sin eso, un archivo con tres hunks tendría tres editores llamados igual, y
   * un nombre accesible que se repite tres veces no nombra nada: quien recorra
   * la pantalla con el teclado no sabría en cuál de los tres está.
   */
  const first = block.rows[0];
  const from = first?.newLine ?? first?.oldLine ?? 1;

  const surface = (
    column: DiffColumn,
    label: string,
    onLines: ((range: { from: number; to: number }) => void) | null,
    attachScroller?: (element: HTMLElement | null) => void,
  ) => {
    const editor = (
      <CodeSurface
        className={`${styles.surface} ${ownScroll ? styles.ownedSurface : ''}`}
        value={column.text}
        wrap={wrap}
        longLineLabel={t('working.diff.longLine')}
        label={label}
        encoding={encoding}
        lineNumberLabels={column.labels}
        lineControls={
          (column === left
            ? leftLineControls
            : column === right
              ? rightLineControls
              : unifiedLineControls) ?? undefined
        }
        blockControls={
          column === left ? leftControls : column === right ? rightControls : unifiedControls
        }
        marks={column.marks}
        words={column.words}
        language={syntaxLanguageForPath(path) ?? undefined}
        activeLine={false}
        {...(ownScroll ? { scrollerRef: attachScroller } : { fitContent: true })}
        {...(onLines !== null ? { onSelectedLines: onLines } : {})}
      />
    );

    if (ownScroll) {
      return (
        <div
          className={styles.ownedPane}
          role="region"
          aria-label={t('working.diff.horizontalScroll', { label })}
        >
          {editor}
        </div>
      );
    }

    return (
      <SyncScrollPane
        label={t('working.diff.horizontalScroll', { label })}
        className={`${styles.horizontalPane} ${wrap ? styles.wrappedPane : ''}`}
      >
        {editor}
      </SyncScrollPane>
    );
  };

  const body =
    left !== null && right !== null ? (
      <div className={styles.sides}>
        {surface(
          left,
          t('working.diff.old', { path, from }),
          onSelectedLinesLeft,
          attachLeftScroller,
        )}
        {surface(
          right,
          t('working.diff.new', { path, from }),
          onSelectedLinesRight,
          attachRightScroller,
        )}
      </div>
    ) : unified === null ? null : (
      surface(unified, t('working.diff.unified', { path, from }), onSelectedLinesRight)
    );

  /*
   * En «archivo completo» esto no es un hunk: es el archivo entero, de una
   * pieza. El margen ya cuenta la línea, así que no hay cabeceras que repitan
   * «Lines X to Y», y el stage de lo marcado se pide por menú contextual —un
   * botón fijo no tendría dónde ir cuando la selección puede cruzar el archivo.
   */
  if (scope === 'file' || actionBlocks !== undefined) {
    const items: MenuEntry[] =
      direction !== null && selection.length > 0
        ? [
            {
              key: 'stage-selection',
              label: t(
                direction === 'stage' ? 'working.diff.stageLines' : 'working.diff.unstageLines',
                { count: selectionCount },
              ),
              onSelect: () => {
                actions.stageLines(path, selection, direction, precondition, ignoreWhitespace);
                onSelection(null);
              },
            },
            // Descartar solo tiene sentido del lado del árbol de trabajo: lo
            // reversible del índice ya es quitar del stage, arriba.
            ...(direction === 'stage'
              ? [
                  {
                    key: 'discard-selection',
                    label: t('working.diff.discardLines', { count: selectionCount }),
                    danger: true,
                    onSelect: () => {
                      actions.discardLines(path, selection, precondition, ignoreWhitespace);
                      onSelection(null);
                    },
                  } satisfies MenuEntry,
                ]
              : []),
          ]
        : [];

    return (
      <ContextMenu
        items={items}
        label={t('working.diff.label', { path })}
        className={`${styles.context} ${ownScroll ? styles.ownedContext : ''}`}
      >
        <div className={styles.context}>{body}</div>
      </ContextMenu>
    );
  }

  if (hunk === null) {
    return <div className={styles.context}>{body}</div>;
  }

  return (
    <section
      className={styles.block}
      aria-label={t('working.diff.hunk', { number: block.number, path })}
    >
      <header className={styles.hunkHeader}>
        <span className={styles.hunkRange}>
          {t('working.diff.hunkRange', {
            from: hunk.newStart,
            to: hunk.newStart + hunk.newLines,
          })}
        </span>
        {hunk.header !== '' && <span className={styles.hunkContext}>{hunk.header}</span>}
        <span className={styles.spacer} />

        {direction !== null && selection.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              actions.stageLines(path, selection, direction, precondition, ignoreWhitespace);
              onSelection(null);
            }}
          >
            {t(direction === 'stage' ? 'working.diff.stageLines' : 'working.diff.unstageLines', {
              count: selectionCount,
            })}
          </Button>
        )}

        {direction !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              actions.stageHunk(path, hunk.id, direction, precondition, ignoreWhitespace);
            }}
          >
            {t(direction === 'stage' ? 'working.diff.stageHunk' : 'working.diff.unstageHunk', {
              number: block.number,
            })}
          </Button>
        )}
      </header>

      {body}
    </section>
  );
}

/** Registra el scroll real de CodeMirror, sin un ancestro virtualizado. */
function useSyncedScroller(
  onAttach?: (element: HTMLDivElement | null) => void,
  onMove?: () => void,
) {
  const registry = useSyncScrollRegistry();
  const unregisterRef = useRef<(() => void) | null>(null);
  const onMoveRef = useRef(onMove);

  useLayoutEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  const attach = useCallback(
    (next: HTMLElement | null) => {
      unregisterRef.current?.();
      unregisterRef.current = null;
      onAttach?.(next as HTMLDivElement | null);

      if (!next) return;

      const onScroll = () => {
        onMoveRef.current?.();
        if (!next.dataset.preservingScroll) registry.broadcast(next);
      };
      const unregister = registry.register(next);
      next.addEventListener('scroll', onScroll, { passive: true });
      unregisterRef.current = () => {
        next.removeEventListener('scroll', onScroll);
        unregister();
      };
    },
    [onAttach, registry],
  );

  useEffect(() => () => unregisterRef.current?.(), []);

  return attach;
}

/**
 * La ficha de un binario — CU-5: «no enseña líneas».
 *
 * Tipo y tamaño antes y después, y con esas palabras. Inventarle un texto a un
 * `.png` sería enseñar basura con números de línea al lado.
 */
function BinaryCard({ content }: { content: BinaryDiff }) {
  const { t, locale } = useI18n();

  const format = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const size = (bytes: number | null | undefined) =>
    typeof bytes !== 'number' || !Number.isFinite(bytes)
      ? t('working.diff.binary.missing')
      : t('working.diff.binary.bytes', {
          count: format.format(bytes),
        });

  return (
    <div className={styles.padded}>
      <EmptyState
        size="sm"
        title={t('working.diff.binary.title')}
        description={t('working.diff.binary.description', {
          mediaType: content.mediaType || 'application/octet-stream',
          before: size(content.oldSize),
          after: size(content.newSize),
        })}
      />
    </div>
  );
}

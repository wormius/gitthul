import { standardKeymap } from '@codemirror/commands';
import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import {
  Annotation,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  BlockType,
  type BlockInfo,
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  gutter,
  GutterMarker,
  keymap,
  lineNumbers,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  foldRangeAt,
  truncateDisplayLines,
  MAX_DISPLAY_LINE_LENGTH,
  sortWordMarks,
  syntaxSpans,
  type CodeLineMark,
  type CodeLineTone,
  type CodeWordMark,
  type CodeWordTone,
  type SyntaxLanguage,
  type SyntaxTone,
} from './codeSurfaceUtils';
import styles from './CodeSurface.module.css';

/**
 * Los rótulos del margen de plegado, ya traducidos.
 *
 * Pasarlos es lo que enciende el plegado: sin ellos CodeMirror pintaría sus
 * propias frases en inglés dentro de una aplicación que existe en cinco idiomas.
 * Un booleano aparte dejaría esa puerta abierta, así que no lo hay.
 */
export interface CodeSurfaceFoldLabels {
  fold: string;
  unfold: string;
  /** Lo que sustituye al bloque plegado, p. ej. «…». */
  folded: string;
}

interface CodeSurfaceProps {
  /** Texto **ya decodificado**. El primitivo no lee bytes ni adivina juegos. */
  value: string;
  /** Nombre accesible del visor, p. ej. «src/app/tabs.ts». */
  label: string;
  /**
   * Con qué codificación se decodificó `value`. Aquí solo se declara —viaja al
   * DOM como `data-encoding`— para que la barra que lo envuelva la muestre y la
   * deje cambiar sin que el visor tenga que saber de juegos de caracteres.
   */
  encoding?: string;
  /** Por defecto sí: el visor se lee y se selecciona, no se escribe. */
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onScrollMap?: (map: {
    total: number;
    from: number;
    to: number;
    blocks: { id: string; from: number; to: number }[];
  }) => void;
  focusLine?: { line: number; request: number };
  showLineNumbers?: boolean;
  /** Primer número del margen. Un hunk suelto no empieza en 1. */
  firstLineNumber?: number;
  /**
   * Un rótulo por línea del documento, en vez de una numeración corrida.
   *
   * Lo pide el diff y solo el diff: en un documento donde una línea es de la
   * versión nueva, la siguiente de la anterior y la de más allá es un hueco de
   * relleno, «primera línea más uno» no describe nada. Cadenas y no números
   * porque un hueco no lleva rótulo — se rotula con la cadena vacía— y porque el
   * margen es texto. Manda sobre `firstLineNumber` cuando viene.
   */
  lineNumberLabels?: readonly string[];
  folding?: CodeSurfaceFoldLabels;
  activeLine?: boolean;
  wrap?: boolean;
  longLineLabel?: string;
  /**
   * Recibe el elemento que de verdad hace scroll dentro del editor.
   *
   * Sirve para atarlo a otro —el resolutor sincroniza sus dos versiones— sin
   * envolver el visor en un contenedor con scroll propio: hacerlo obliga a
   * CodeMirror a suscribirse al scroll de fuera y a **volver a medir su ventana
   * en cada evento**, que con una rueda inercial es lo que frena el
   * desplazamiento. Con su scroll propio, el editor solo trabaja cuando la
   * ventana se mueve de verdad.
   *
   * No se pasa con `fitContent`: ahí el visor no scrollea, por definición.
   */
  scrollerRef?: (element: HTMLElement | null) => void;
  /** Líneas con fondo propio: añadidas, quitadas, en conflicto. */
  marks?: readonly CodeLineMark[];
  /** Tramos resaltados dentro de una línea: el diff por palabra. */
  words?: readonly CodeWordMark[];
  /** Lenguaje conocido para resaltar sintaxis sin ejecutar el contenido. */
  language?: SyntaxLanguage;
  /**
   * El visor crece con su contenido en vez de scrollear por dentro.
   *
   * Sirve para apilar varios visores dentro de un mismo contenedor con scroll —
   * los hunks de un diff, o sus dos columnas— y que todos se muevan juntos con
   * una sola barra. Sin esto cada visor tendría la suya y las dos columnas de un
   * diff se irían desincronizando en cuanto una tuviera una línea de más.
   */
  fitContent?: boolean;
  /**
   * Qué líneas abarca la selección, cada vez que cambia.
   *
   * Es lo que deja preparar líneas sueltas de un hunk: se marcan con el ratón o
   * con el teclado y quien envuelve al visor traduce ese rango a números de
   * línea del archivo. Se informa en líneas y no en posiciones de carácter
   * porque git no sabe preparar media línea.
   */
  onSelectedLines?: (range: { from: number; to: number }) => void;
  /** Casillas interactivas que aparecen junto al número de una línea. */
  lineControls?: readonly CodeLineControl[];
  /** Renglones virtuales que anuncian el inicio de bloques de código. */
  blockControls?: readonly CodeBlockControl[];
  /** Lleva esta línea al inicio visible cuando cambia. */
  scrollToLine?: number;
  /** Lleva la cabecera virtual de este bloque al inicio visible cuando cambia. */
  scrollToBlock?: string;
  /** Fuerza a realinear el mismo bloque cuando cambia su geometría virtual. */
  scrollToBlockRevision?: string;
  className?: string;
}

export interface CodeLineControl {
  line: number;
  checked: boolean;
  disabled?: boolean;
  label: string;
  /** Acción inmediata del diff; el resolver conserva +/✓ para su selección. */
  symbol?: '+' | '−';
  onToggle: (checked: boolean) => void;
}

export interface CodeBlockControl {
  id?: string;
  line: number;
  /** Última línea real del bloque; permite rellenar lados más cortos. */
  afterLine?: number;
  /** Renglones visuales que alinean el siguiente bloque con los otros paneles. */
  spacerRows?: number;
  /** El bloque no tiene líneas reales: el relleno va antes de la línea de contexto usada como ancla. */
  spacerBeforeLine?: boolean;
  onActivateEmpty?: () => void;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  tone?: 'ours' | 'theirs' | 'resolved';
  onToggle?: (checked: boolean) => void;
  /** Solo conserva el ancla de sincronización; no ocupa un renglón visual. */
  anchorOnly?: boolean;
  /** Acciones de la cabecera, sin semántica de casilla de selección. */
  actions?: readonly { label: string; onSelect: () => void }[];
}

class BlockSpacerWidget extends WidgetType {
  constructor(
    private readonly rows: number,
    private readonly control?: CodeBlockControl,
    private readonly lineHeight = 20,
  ) {
    super();
  }

  override get estimatedHeight(): number {
    return this.rows * this.lineHeight;
  }

  override toDOM(): HTMLElement {
    const spacer = document.createElement('div');

    spacer.className = 'gitthul-block-spacer';
    if (this.control?.id) spacer.dataset.spacerBlockId = this.control.id;
    spacer.style.setProperty('--gitthul-block-spacer-rows', String(this.rows));
    spacer.style.height = `${this.estimatedHeight}px`;
    if (this.control?.onActivateEmpty) {
      spacer.classList.add('gitthul-editable-spacer');
      spacer.setAttribute('aria-label', this.control.label);
      spacer.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.control?.onActivateEmpty?.();
      });
    }

    return spacer;
  }
}

class ChoiceControlMarker extends GutterMarker {
  constructor(
    private readonly lineControl?: CodeLineControl,
    private readonly blockControl?: CodeBlockControl,
    private readonly currentLineControl?: () => CodeLineControl | undefined,
  ) {
    super();
  }

  // El estado se actualiza en el nodo existente; su identidad conserva clic y foco.
  override eq(other: ChoiceControlMarker): boolean {
    return (
      this.lineControl?.line === other.lineControl?.line &&
      this.blockControl?.id === other.blockControl?.id
    );
  }

  override toDOM(): HTMLElement {
    const controls = document.createElement('span');

    controls.className = 'gitthul-choice-controls';
    if (this.blockControl?.id) controls.dataset.blockId = this.blockControl.id;

    if (this.lineControl) {
      const line = document.createElement('button');

      line.type = 'button';
      line.disabled = this.lineControl.disabled ?? false;
      line.textContent = this.lineControl.symbol ?? (this.lineControl.checked ? '✓' : '+');
      line.className = 'gitthul-line-choice';
      line.dataset.choiceLine = String(this.lineControl.line);
      line.setAttribute('aria-label', this.lineControl.label);
      line.title = this.lineControl.label;
      if (!this.lineControl.symbol)
        line.setAttribute('aria-pressed', String(this.lineControl.checked));
      line.addEventListener('mousedown', (event) => event.stopPropagation());
      line.addEventListener('click', (event) => {
        event.stopPropagation();
        const control = this.currentLineControl ? this.currentLineControl() : this.lineControl;
        if (control && !control.disabled) control.onToggle(!control.checked);
      });
      controls.append(line);
    }

    return controls;
  }
}

class BlockControlWidget extends WidgetType {
  override get estimatedHeight(): number {
    return this.control.actions ? this.lineHeight * 2 : -1;
  }

  constructor(
    private readonly control: CodeBlockControl,
    private readonly lineHeight = 20,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const row = document.createElement('div');

    row.className = 'gitthul-block-control';
    if (this.control.actions) {
      // La misma altura en el DOM y en el mapa virtual evita reajustes al
      // descubrir nuevas cabeceras durante el desplazamiento.
      row.style.height = row.style.minHeight = row.style.maxHeight = `${this.estimatedHeight}px`;
      row.style.overflow = 'hidden';
    }
    if (this.control.tone) row.dataset.tone = this.control.tone;
    if (this.control.id) row.dataset.blockId = this.control.id;

    if (this.control.onToggle) {
      const button = document.createElement('button');

      button.type = 'button';
      button.disabled = this.control.disabled ?? false;
      button.textContent = this.control.label;
      button.setAttribute('aria-pressed', String(this.control.pressed ?? false));
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.control.onToggle?.(!(this.control.pressed ?? false));
      });
      row.append(button);

      return row;
    }

    const label = document.createElement('span');

    label.textContent = this.control.label;
    row.append(label);
    for (const action of this.control.actions ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action.onSelect();
      });
      row.append(button);
    }

    return row;
  }
}

class BlockAnchorWidget extends WidgetType {
  constructor(private readonly id?: string) {
    super();
  }

  override toDOM(): HTMLElement {
    const anchor = document.createElement('span');

    anchor.className = 'gitthul-block-anchor';
    if (this.id) anchor.dataset.blockId = this.id;

    return anchor;
  }
}

function blockDecorations(
  state: EditorState,
  controls: readonly CodeBlockControl[],
  lineHeight: number,
): DecorationSet {
  const ranges: ReturnType<Decoration['range']>[] = [];

  for (const control of controls) {
    const line = state.doc.line(Math.max(1, Math.min(control.line, state.doc.lines)));

    if (control.anchorOnly) {
      ranges.push(
        Decoration.widget({ widget: new BlockAnchorWidget(control.id), side: -2 }).range(line.from),
      );
    } else if (!control.onToggle) {
      ranges.push(
        Decoration.widget({
          widget: new BlockControlWidget(control, lineHeight),
          block: true,
          side: -2,
        }).range(line.from),
      );
    }

    if ((control.spacerRows ?? 0) > 0) {
      const after = state.doc.line(
        Math.max(1, Math.min(control.afterLine ?? control.line, state.doc.lines)),
      );
      const position = control.spacerBeforeLine ? line.from : after.to;

      ranges.push(
        Decoration.widget({
          widget: new BlockSpacerWidget(control.spacerRows ?? 0, control, lineHeight),
          block: true,
          side: control.spacerBeforeLine ? -1 : 1,
        }).range(position),
      );
    }
  }

  return Decoration.set(ranges, true);
}

const TONE_CLASS: Record<CodeLineTone, string> = {
  added: styles.added ?? '',
  removed: styles.removed ?? '',
  ours: styles.ours ?? '',
  theirs: styles.theirs ?? '',
  both: styles.both ?? '',
  resolved: styles.resolved ?? '',
};

const WORD_CLASS: Record<CodeWordTone, string> = {
  added: styles.wordAdded ?? '',
  removed: styles.wordRemoved ?? '',
};

const SYNTAX_CLASS: Record<SyntaxTone, string> = {
  keyword: styles.syntaxKeyword ?? '',
  function: styles.syntaxFunction ?? '',
  type: styles.syntaxType ?? '',
  property: styles.syntaxProperty ?? '',
  annotation: styles.syntaxAnnotation ?? '',

  string: styles.syntaxString ?? '',
  comment: styles.syntaxComment ?? '',
  number: styles.syntaxNumber ?? '',
};

/** Calcula una vez por documento, nunca por movimiento de la ventana visible. */
function documentDecorations(build: (state: EditorState) => DecorationSet): Extension {
  return StateField.define<DecorationSet>({
    create: build,
    update: (decorations, transaction) =>
      transaction.docChanged ? build(transaction.state) : decorations,
    provide: (field) => EditorView.decorations.from(field),
  });
}

function syntaxDecorations(state: EditorState, language: SyntaxLanguage): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Very long lines are readable without spending time tokenizing megabytes.
  const text = state.doc.toString();
  if (text.split('\n').some((line) => line.length > MAX_DISPLAY_LINE_LENGTH))
    return builder.finish();
  for (const span of syntaxSpans(text, language)) {
    builder.add(span.from, span.to, Decoration.mark({ class: SYNTAX_CLASS[span.tone] }));
  }
  return builder.finish();
}

/** Atributos que el sistema de diseño escribe en `<html>` y CodeMirror no oye. */
const THEME_ATTRIBUTES = [
  'style',
  'data-theme',
  'data-theme-variant',
  'data-mode',
  'data-density',
  'data-font-code',
];
const EXTERNAL_VALUE = Annotation.define<boolean>();

function lineDecorations(state: EditorState, marks: readonly CodeLineMark[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // `RangeSetBuilder` exige orden creciente y revienta si no lo recibe; el orden
  // de la lista es cosa de quien la arma, así que se ordena aquí.
  const sorted = [...marks].sort((a, b) => a.line - b.line);

  for (const mark of sorted) {
    if (mark.line < 1 || mark.line > state.doc.lines) continue;

    const line = state.doc.line(mark.line);

    builder.add(line.from, line.from, Decoration.line({ class: TONE_CLASS[mark.tone] }));
  }

  return builder.finish();
}

/**
 * Los tramos de palabra, recortados a lo que la línea de verdad mide.
 *
 * Un tramo que se sale no es un error de quien llama: el texto puede haber
 * cambiado un cuadro antes que las marcas, y `Decoration.mark` con un extremo
 * fuera del documento sí revienta. Se recorta y se sigue.
 */
function wordDecorations(state: EditorState, words: readonly CodeWordMark[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const word of sortWordMarks(words)) {
    if (word.line < 1 || word.line > state.doc.lines) continue;

    const line = state.doc.line(word.line);
    const length = line.to - line.from;
    const start = Math.max(0, Math.min(word.start, length));
    const end = Math.max(start, Math.min(word.end, length));

    if (end === start) continue;

    builder.add(
      line.from + start,
      line.from + end,
      Decoration.mark({ class: WORD_CLASS[word.tone] }),
    );
  }

  return builder.finish();
}

function replacementDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = state.doc.toString();
  for (let index = text.indexOf('�'); index >= 0; index = text.indexOf('�', index + 1)) {
    builder.add(
      index,
      index + 1,
      Decoration.mark({ class: styles.invalidCharacter, attributes: { title: 'U+FFFD · �' } }),
    );
  }
  return builder.finish();
}

/** Los controles válidos se distinguen de los reemplazos por bytes inválidos. */
function renderControlCharacter(code: number): HTMLElement {
  const marker = document.createElement('span');
  const point = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  const description = code === 0 ? `${point} · NUL` : point;
  marker.className = `cm-specialChar ${styles.controlCharacter}`;
  marker.textContent = '·';
  marker.title = description;
  marker.setAttribute('aria-label', description);
  return marker;
}

/**
 * El visor de código: CodeMirror 6 envuelto en el sistema de diseño.
 *
 * **El tema no se traduce a JavaScript.** CodeMirror trae su propia forma de
 * temear —objetos de estilo que se inyectan al montar—, y usarla obligaría a
 * volver a montar o a reconfigurar el editor cada vez que alguien cambia de tema
 * en «Configuraciones». Aquí el estilo es un CSS Module normal que apunta a las
 * clases `.cm-*` con las variables de la capa 2: como los tokens se resuelven en
 * `<html>`, cambiar de tema, de modo o de densidad repinta el visor sin que este
 * archivo se entere de nada. Es también lo que mantiene el invariante de que
 * ningún color literal viva fuera de `src/design/`.
 *
 * Lo que sí hay que avisarle es que sus medidas caducaron: CodeMirror cachea el
 * alto de línea y el ancho de carácter, y el ajuste de fuente de los visores
 * cambia ambos desde fuera de su árbol. De ahí el observador sobre `<html>`.
 *
 * **Sin lenguaje declarado y sin resaltado de sintaxis.** Qué lenguaje tiene un
 * archivo lo decide quien lo abre, no el primitivo, y el resaltado necesitaría
 * una familia de roles que el sistema de diseño todavía no tiene. El plegado, en
 * cambio, no espera a eso: se calcula por sangría, que funciona igual en
 * cualquier archivo.
 */
export function CodeSurface({
  value: originalValue,
  label,
  encoding = 'UTF-8',
  readOnly = true,
  onChange,
  onScrollMap,
  focusLine,
  showLineNumbers = true,
  firstLineNumber = 1,
  lineNumberLabels,
  scrollerRef,
  folding,
  activeLine = true,
  wrap = false,
  longLineLabel,
  marks,
  words,
  language,
  fitContent = false,
  onSelectedLines,
  lineControls,
  blockControls,
  scrollToLine,
  scrollToBlock,
  scrollToBlockRevision,
  className,
}: CodeSurfaceProps) {
  const value = useMemo(
    () =>
      readOnly && !wrap && longLineLabel
        ? truncateDisplayLines(originalValue, longLineLabel)
        : originalValue,
    [originalValue, readOnly, wrap, longLineLabel],
  );
  const [lineHeight, setLineHeight] = useState(20);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastScrolledBlockRef = useRef<string | undefined>(undefined);
  const configuredRef = useRef(false);
  const preservedScrollRef = useRef<{ top: number; left: number } | null>(null);
  const choiceControlsRef = useRef({
    lines: new Map<number, CodeLineControl>(),
    blocks: new Map<number, CodeBlockControl>(),
  });
  const blockColumnRef = useRef<{
    column: HTMLElement;
    ranges: Map<
      string,
      { control: CodeBlockControl; range: HTMLElement; checkbox: HTMLInputElement }
    >;
    measure: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    choiceControlsRef.current = {
      lines: new Map(lineControls?.map((control) => [control.line, control]) ?? []),
      blocks: new Map(
        blockControls
          ?.filter((control) => control.onToggle)
          .map((control) => [control.line, control]) ?? [],
      ),
    };
  }, [lineControls, blockControls]);

  // Medir los espacios no debe reemplazar el checkbox entre presionarlo y soltarlo.
  const hasChoiceControls =
    !!lineControls?.length || !!blockControls?.some((control) => control.onToggle);
  const choiceGutter = useMemo(() => {
    if (!hasChoiceControls) return null;
    // gutter registra estos callbacks; CodeMirror los invoca al actualizar la vista,
    // después del render de React y del efecto que publica los controles vigentes.
    // eslint-disable-next-line react-hooks/refs
    return gutter({
      class: 'cm-choiceGutter',
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(StateEffect.reconfigure)),
        ),
      lineMarker: (view, line) => {
        const number = view.state.doc.lineAt(line.from).number;
        const lineControl = choiceControlsRef.current.lines.get(number);
        const blockControl = choiceControlsRef.current.blocks.get(number);
        return lineControl || blockControl
          ? new ChoiceControlMarker(lineControl, blockControl, () =>
              choiceControlsRef.current.lines.get(number),
            )
          : null;
      },
    });
  }, [hasChoiceControls]);
  // Si cambia la configuración de un gutter, CodeMirror retira y reinserta todos.
  // Mantener sus facetas evita que un repintado ajeno a los controles les quite el foco.
  const numberGutter = useMemo(
    () =>
      lineNumbers({
        formatNumber: (number) =>
          lineNumberLabels
            ? (lineNumberLabels[number - 1] ?? '')
            : String(number + firstLineNumber - 1),
      }),
    [lineNumberLabels, firstLineNumber],
  );
  const foldingGutter = useMemo(() => foldGutter(), []);

  /*
   * Toda la configuración se rearma junta y viaja en una transacción de
   * reconfiguración. Es barato aunque el padre pase objetos nuevos en cada
   * repintado: `StateEffect.reconfigure` es una transacción normal, así que el
   * documento, la selección y lo que estuviera plegado siguen donde estaban.
   */
  const extensions = useMemo<Extension[]>(() => {
    const list: Extension[] = [
      keymap.of(standardKeymap),
      drawSelection(),
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      EditorView.contentAttributes.of({ 'aria-label': label }),
      EditorView.updateListener.of((update) => {
        if (
          update.geometryChanged &&
          blockControls?.some((control) => (control.spacerRows ?? 0) > 0 || control.actions)
        ) {
          update.view.requestMeasure({
            key: setLineHeight,
            read: (view) => view.defaultLineHeight,
            write: (height) => {
              if (height > 0) setLineHeight(height);
            },
          });
        }
        const externallyApplied = update.transactions.some(
          (transaction) => transaction.annotation(EXTERNAL_VALUE) === true,
        );

        if (update.docChanged && !externallyApplied) {
          onChange?.(update.state.doc.toString());
        }

        if (onSelectedLines && (update.selectionSet || update.docChanged)) {
          const range = update.state.selection.main;

          onSelectedLines({
            from: update.state.doc.lineAt(range.from).number,
            // El inicio del renglón siguiente es el extremo exclusivo de una
            // selección completa; no debe preparar una línea extra.
            to: update.state.doc.lineAt(range.empty ? range.to : range.to - 1).number,
          });
        }
      }),
    ];

    if (showLineNumbers) {
      list.push(numberGutter);
    }

    if (choiceGutter) list.push(choiceGutter);

    if (lineControls?.some((control) => control.checked)) {
      list.push(
        EditorView.decorations.of((view) =>
          Decoration.set(
            lineControls
              .filter(
                (control) =>
                  control.checked && control.line <= view.state.doc.lines && control.line > 0,
              )
              .map((control) =>
                Decoration.line({ class: styles.chosenLine }).range(
                  view.state.doc.line(control.line).from,
                ),
              ),
            true,
          ),
        ),
      );
    }

    if (blockControls && blockControls.length > 0) {
      list.push(
        EditorView.decorations.of(
          blockDecorations(EditorState.create({ doc: value }), blockControls, lineHeight),
        ),
      );
    }

    if (activeLine) list.push(highlightActiveLine(), highlightActiveLineGutter());
    if (wrap) list.push(EditorView.lineWrapping);

    if (folding) {
      list.push(
        codeFolding({ placeholderText: folding.folded }),
        foldingGutter,
        // El plegado por teclado es local al visor, como el `Esc` que lo cierra:
        // no es una acción de la aplicación y no pasa por el registro de gestos.
        keymap.of(foldKeymap),
        foldService.of((state, from) => {
          const line = state.doc.lineAt(from);
          const range = foldRangeAt(
            { lines: state.doc.lines, line: (number) => state.doc.line(number).text },
            line.number,
          );

          if (!range) return null;

          // CodeMirror pliega desde el final de la línea de la flecha: así el
          // encabezado del bloque se queda a la vista, que es de lo que sirve.
          return { from: line.to, to: state.doc.line(range.to).to };
        }),
        EditorState.phrases.of({
          'Fold line': folding.fold,
          'Unfold line': folding.unfold,
          'folded code': folding.folded,
          unfold: folding.unfold,
        }),
      );
    }

    if (marks && marks.length > 0) {
      list.push(documentDecorations((state) => lineDecorations(state, marks)));
    }

    // En facetas separadas y no en un `RangeSet` compartido: el constructor de
    // rangos exige orden creciente, y el tono de línea y el de palabra empiezan
    // los dos en el arranque de la línea. Mezclarlos obligaría a intercalarlos a
    // mano para nada, porque CodeMirror ya sabe sumar decoraciones de dos
    // fuentes.
    list.push(
      highlightSpecialChars({ render: renderControlCharacter }),
      documentDecorations(replacementDecorations),
    );
    if (words && words.length > 0) {
      list.push(documentDecorations((state) => wordDecorations(state, words)));
    }

    if (language) {
      list.push(documentDecorations((state) => syntaxDecorations(state, language)));
    }

    return list;
  }, [
    activeLine,
    choiceGutter,
    folding,
    foldingGutter,
    label,
    lineControls,
    numberGutter,
    language,
    marks,
    onChange,
    onSelectedLines,
    blockControls,
    lineHeight,
    readOnly,
    showLineNumbers,
    words,
    wrap,
    value,
  ]);

  // Los tres efectos van en capa de diseño y en este orden: montar, configurar y
  // volcar el texto ocurren dentro del mismo cuadro, así que nunca se ve un
  // editor vacío ni sin tema entre uno y otro.
  useLayoutEffect(() => {
    const host = hostRef.current;

    if (!host) return;

    const view = new EditorView({ parent: host, doc: value });

    viewRef.current = view;
    if (blockControls?.some((control) => (control.spacerRows ?? 0) > 0 || control.actions)) {
      view.requestMeasure({
        key: setLineHeight,
        read: (measured) => measured.defaultLineHeight,
        write: (height) => {
          if (height > 0) setLineHeight(height);
        },
      });
    }
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El consumidor puede alternar entre un editor que crece con su contenido y
  // otro que desplaza su propio viewport sin remontar CodeMirror. El registro
  // del scroller sigue ese cambio de modo, no solo el montaje inicial.
  useLayoutEffect(() => {
    const scroller = viewRef.current?.scrollDOM;

    if (!scroller || !scrollerRef) return;

    scrollerRef(scroller);

    return () => scrollerRef(null);
  }, [scrollerRef]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const current = view?.state.doc.toString();

    // Comparar antes de escribir es lo que deja escribir en el visor editable:
    // sin esta guarda, el texto que sube por `onChange` volvería a bajar como
    // una transacción nueva y se llevaría por delante el cursor.
    if (!view || current === undefined || current === value) return;

    // Solo se reemplaza el tramo que cambió. Reemplazar el documento entero
    // hacía que CodeMirror regresara el resultado al inicio al elegir un bloque;
    // como los tres scrolls están sincronizados, ese salto arrastraba también A
    // y B. Conservar prefijo y sufijo mantiene estable el ancla visible.
    let from = 0;

    while (from < current.length && from < value.length && current[from] === value[from]) from += 1;

    let currentTo = current.length;
    let valueTo = value.length;

    while (currentTo > from && valueTo > from && current[currentTo - 1] === value[valueTo - 1]) {
      currentTo -= 1;
      valueTo -= 1;
    }

    const scrollTop = view.scrollDOM.scrollTop;
    const scrollLeft = view.scrollDOM.scrollLeft;

    preservedScrollRef.current = { top: scrollTop, left: scrollLeft };

    view.dispatch({
      changes: { from, to: currentTo, insert: value.slice(from, valueTo) },
      annotations: EXTERNAL_VALUE.of(true),
    });

    view.scrollDOM.scrollTop = scrollTop;
    view.scrollDOM.scrollLeft = scrollLeft;
    view.requestMeasure({
      read: () => null,
      write(_measurement, measuredView) {
        measuredView.scrollDOM.scrollTop = scrollTop;
        measuredView.scrollDOM.scrollLeft = scrollLeft;
      },
    });
  }, [value]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const preserved = preservedScrollRef.current;
    const scrollTop = preserved?.top ?? view?.scrollDOM.scrollTop ?? 0;
    const scrollLeft = preserved?.left ?? view?.scrollDOM.scrollLeft ?? 0;
    const navigationPending =
      scrollToBlock !== undefined &&
      lastScrolledBlockRef.current !== `${scrollToBlock}:${scrollToBlockRevision ?? ''}`;
    const preserveScroll = configuredRef.current && !navigationPending;

    configuredRef.current = true;

    if (view && preserveScroll) view.scrollDOM.dataset.preservingScroll = 'true';
    view?.dispatch({ effects: StateEffect.reconfigure.of(extensions) });
    if (
      (lineControls && lineControls.length > 0) ||
      blockControls?.some((control) => control.onToggle)
    ) {
      view?.scrollDOM.querySelector('.cm-gutters')?.removeAttribute('aria-hidden');
    }
    if (view && preserveScroll) {
      view.scrollDOM.scrollTop = scrollTop;
      view.scrollDOM.scrollLeft = scrollLeft;
      view.requestMeasure({
        read: () => null,
        write(_measurement, measuredView) {
          measuredView.scrollDOM.scrollTop = scrollTop;
          measuredView.scrollDOM.scrollLeft = scrollLeft;
        },
      });

      let finalFrame: number | undefined;
      const restore = () => {
        if (viewRef.current !== view) return;
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
      };
      const frame = requestAnimationFrame(() => {
        restore();
        // CodeMirror ajusta su ancla después de medir. La segunda pasada conserva
        // los píxeles visibles, también cuando el resultado pierde líneas.
        finalFrame = requestAnimationFrame(() => {
          restore();
          delete view.scrollDOM.dataset.preservingScroll;
          if (preservedScrollRef.current === preserved) preservedScrollRef.current = null;
        });
      });

      return () => {
        cancelAnimationFrame(frame);
        if (finalFrame !== undefined) cancelAnimationFrame(finalFrame);
        delete view.scrollDOM.dataset.preservingScroll;
      };
    }
  }, [extensions, lineControls, blockControls, scrollToBlock, scrollToBlockRevision]);

  useLayoutEffect(() => {
    const buttons =
      viewRef.current?.scrollDOM.querySelectorAll<HTMLButtonElement>('.gitthul-line-choice');
    buttons?.forEach((button) => {
      const control = choiceControlsRef.current.lines.get(Number(button.dataset.choiceLine));
      if (!control) return;
      button.disabled = control.disabled ?? false;
      button.textContent = control.symbol ?? (control.checked ? '✓' : '+');
      button.setAttribute('aria-label', control.label);
      button.title = control.label;
      if (control.symbol) button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', String(control.checked));
    });
  }, [extensions, lineControls]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !onScrollMap) return;
    const measure = () =>
      view.requestMeasure({
        key: onScrollMap,
        read: () => {
          const offset =
            view.documentTop -
            view.scrollDOM.getBoundingClientRect().top +
            view.scrollDOM.scrollTop;
          return {
            total: view.scrollDOM.scrollHeight,
            from: view.scrollDOM.scrollTop,
            to: view.scrollDOM.scrollTop + view.scrollDOM.clientHeight,
            blocks: (blockControls ?? [])
              .filter((block) => block.id)
              .map((block) => {
                const first = view.lineBlockAt(
                  view.state.doc.line(Math.min(Math.max(1, block.line), view.state.doc.lines)).from,
                );
                const last = view.lineBlockAt(
                  view.state.doc.line(
                    Math.min(Math.max(1, block.afterLine ?? block.line), view.state.doc.lines),
                  ).from,
                );
                return { id: block.id!, from: offset + first.top, to: offset + last.bottom };
              }),
          };
        },
        write: onScrollMap,
      });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(view.scrollDOM);
    observer?.observe(view.contentDOM);
    view.scrollDOM.addEventListener('scroll', measure);
    measure();
    return () => {
      observer?.disconnect();
      view.scrollDOM.removeEventListener('scroll', measure);
    };
  }, [onScrollMap, blockControls, value]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !focusLine) return;
    const line = view.state.doc.line(Math.min(Math.max(focusLine.line, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from } });
    view.contentDOM.focus({ preventScroll: true });
  }, [focusLine]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const gutterElement = view?.scrollDOM.querySelector<HTMLElement>('.cm-choiceGutter');
    if (!view || !gutterElement || !choiceGutter) return;

    const column = document.createElement('div');
    column.className = 'gitthul-block-column';
    const ranges: NonNullable<typeof blockColumnRef.current>['ranges'] = new Map();
    gutterElement.append(column);
    const measure = () =>
      view.requestMeasure({
        key: column,
        read: (measuredView) => {
          const gutterTop = gutterElement.getBoundingClientRect().top;
          const docTop = measuredView.documentTop;
          const textPart = (block: BlockInfo): BlockInfo => {
            const parts = block.type;
            return typeof parts === 'number'
              ? block
              : (parts.find((part) => part.type === BlockType.Text) ?? block);
          };
          const spacerBoxes = new Map(
            [
              ...measuredView.contentDOM.querySelectorAll<HTMLElement>('[data-spacer-block-id]'),
            ].map(
              (element) =>
                [element.dataset.spacerBlockId, element.getBoundingClientRect()] as const,
            ),
          );
          return [...ranges.values()].map(({ control, range }) => {
            const first = textPart(
              measuredView.lineBlockAt(
                measuredView.state.doc.line(
                  Math.min(Math.max(control.line, 1), measuredView.state.doc.lines),
                ).from,
              ),
            );
            const last = textPart(
              measuredView.lineBlockAt(
                measuredView.state.doc.line(
                  Math.min(
                    Math.max(control.afterLine ?? control.line, 1),
                    measuredView.state.doc.lines,
                  ),
                ).from,
              ),
            );
            const spacerBox = control.id ? spacerBoxes.get(control.id) : undefined;
            if (spacerBox) {
              const top = control.spacerBeforeLine ? spacerBox.top : docTop + first.top;
              return { range, top: top - gutterTop, height: spacerBox.bottom - top };
            }
            const spacer = (control.spacerRows ?? 0) * measuredView.defaultLineHeight;
            return {
              range,
              top: docTop - gutterTop + first.top - (control.spacerBeforeLine ? spacer : 0),
              height: control.spacerBeforeLine ? spacer : last.bottom - first.top + spacer,
            };
          });
        },
        write: (boxes) =>
          boxes.forEach(({ range, top, height }) => {
            range.style.top = `${top}px`;
            range.style.height = `${height}px`;
          }),
      });
    blockColumnRef.current = { column, ranges, measure };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(view.contentDOM);
    window.addEventListener('resize', measure);
    view.scrollDOM.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      blockColumnRef.current = null;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      view.scrollDOM.removeEventListener('scroll', measure);
      column.remove();
    };
  }, [choiceGutter]);

  // Reconciliar por bloque conserva el nodo que recibió mousedown hasta click,
  // incluso si el padre refresca sus props mientras el mouse sigue presionado.
  useLayoutEffect(() => {
    const current = blockColumnRef.current;
    if (!current) return;
    const controls = blockControls?.filter((control) => control.onToggle) ?? [];
    const ids = new Set<string>();
    controls.forEach((control, index) => {
      const id = control.id ?? `line:${control.line}:${index}`;
      ids.add(id);
      let entry = current.ranges.get(id);
      if (!entry) {
        const range = document.createElement('label');
        range.className = 'gitthul-block-range';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'gitthul-block-choice';
        range.append(checkbox);
        const created = { control, range, checkbox };
        checkbox.addEventListener('change', () => {
          if (!created.control.disabled) created.control.onToggle?.(checkbox.checked);
        });
        range.addEventListener('mousedown', (event) => event.stopPropagation());
        range.addEventListener('click', (event) => event.stopPropagation());
        current.column.append(range);
        current.ranges.set(id, created);
        entry = created;
      }
      entry.control = control;
      entry.range.dataset.tone = control.tone;
      entry.range.dataset.selected = String(control.pressed ?? false);
      if (control.id) entry.range.dataset.blockId = control.id;
      entry.checkbox.checked = control.pressed ?? false;
      entry.checkbox.disabled = control.disabled ?? false;
      entry.checkbox.setAttribute('aria-label', control.label);
    });
    for (const [id, entry] of current.ranges) {
      if (!ids.has(id)) {
        entry.range.remove();
        current.ranges.delete(id);
      }
    }
    const gutterElement = current.column.parentElement;
    if (gutterElement) gutterElement.dataset.choiceTone = controls[0]?.tone;
    current.measure();
  }, [choiceGutter, blockControls]);

  useLayoutEffect(() => {
    const view = viewRef.current;

    if (!view || scrollToBlock === undefined) return;

    const scrollRequest = `${scrollToBlock}:${scrollToBlockRevision ?? ''}`;

    if (lastScrolledBlockRef.current === scrollRequest) return;

    lastScrolledBlockRef.current = scrollRequest;

    const align = () => {
      const block = [...view.scrollDOM.querySelectorAll<HTMLElement>('[data-block-id]')].find(
        (element) => element.dataset.blockId === scrollToBlock,
      );

      if (!block) return;

      const scrollerBox = view.scrollDOM.getBoundingClientRect();
      const blockBox = block.getBoundingClientRect();

      view.scrollDOM.scrollTop += blockBox.top - scrollerBox.top - 28;
    };

    align();
    const frame = requestAnimationFrame(align);

    return () => cancelAnimationFrame(frame);
  }, [extensions, scrollToBlock, scrollToBlockRevision]);

  useLayoutEffect(() => {
    const view = viewRef.current;

    if (!view || scrollToBlock !== undefined || scrollToLine === undefined) return;

    const line = view.state.doc.line(Math.max(1, Math.min(scrollToLine, view.state.doc.lines)));

    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 28 }) });
  }, [scrollToBlock, scrollToLine, value]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      viewRef.current?.requestMeasure();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: THEME_ATTRIBUTES,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * En los diffs `fitContent` suelta el scroll interno de CodeMirror y desplaza
   * un ancestro común. CodeMirror no recibe ese evento como propio; después de
   * su medida diferida podía decidir que una de las dos columnas estaba fuera
   * del viewport y dejarla vacía hasta el siguiente movimiento de rueda.
   *
   * `requestMeasure` no basta para ese caso: el scroll real también pasa por el
   * observador interno de CodeMirror, que vuelve a calcular el viewport de su
   * ancestro. Reproducimos esa señal sobre el propio editor cuando ya está
   * visible, cada vez que cambia de documento y cuando las fuentes terminan de
   * cargar. El cambio de documento importa especialmente en el diff: al elegir
   * otro archivo React conserva los dos `CodeSurface`, por lo que no vuelven a
   * montarse aunque CodeMirror tenga que sustituir todas sus líneas.
   */
  useLayoutEffect(() => {
    const host = hostRef.current;
    const view = viewRef.current;

    if (!host || !view || !fitContent) return;

    const measure = () => view.requestMeasure();
    const refreshViewport = () => {
      if (viewRef.current !== view) return;
      // `lineBlockAtHeight` es una lectura pública de geometría. Si hay una
      // medición pendiente, CodeMirror la resuelve de forma síncrona antes de
      // contestar; así las líneas quedan materializadas dentro de este mismo
      // cuadro y no dependen de que llegue un scroll real más tarde.
      view.requestMeasure();
      view.lineBlockAtHeight(0);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    document.addEventListener('scroll', measure, true);

    const visibilityObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            requestAnimationFrame(refreshViewport);
          });
    visibilityObserver?.observe(host);

    let finalFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      measure();
      finalFrame = requestAnimationFrame(refreshViewport);
    });

    let fontsFrame: number | undefined;
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (cancelled || viewRef.current !== view) return;
      fontsFrame = requestAnimationFrame(refreshViewport);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      visibilityObserver?.disconnect();
      document.removeEventListener('scroll', measure, true);
      cancelAnimationFrame(frame);
      if (finalFrame !== undefined) cancelAnimationFrame(finalFrame);
      if (fontsFrame !== undefined) cancelAnimationFrame(fontsFrame);
    };
  }, [fitContent, label, value]);

  return (
    <div
      ref={hostRef}
      className={[styles.surface, fitContent && styles.fit, className].filter(Boolean).join(' ')}
      data-encoding={encoding}
    />
  );
}

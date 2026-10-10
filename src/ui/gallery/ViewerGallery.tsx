import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { type TEXT_ENCODINGS, encodingLabel } from '@core/domain/encoding';
import { decodePreview } from '@core/adapters/mock/textDecoding';
import { EncodingSelect } from '../EncodingSelect';
import { CodeSurface } from '../CodeSurface';
import type { CodeLineMark } from '../codeSurface';
import { MarkerScrollbar } from '../MarkerScrollbar';
import type { ScrollMarker } from '../markerScrollbar';
import { Switch } from '../Switch';
import styles from './ViewerGallery.module.css';

const SAMPLE = `/*
 * resolveTheme: de lo que el usuario eligió a lo que el CSS necesita.
 *
 * «auto» no es un tema: es una pregunta al sistema. Resolverlo aquí y no en
 * cada componente es lo que permite que el resto del árbol lea un valor
 * concreto y no vuelva a preguntar.
 */
export function resolveTheme(settings, system) {
  const theme = settings.theme === 'auto' ? preferredTheme(system) : settings.theme;
  const mode = settings.mode === 'auto' ? system.mode : settings.mode;

  if (system.prefersContrast) {
    return { theme: 'contraste', mode };
  }

  return { theme, mode };
}

function preferredTheme(system) {
  // Thul es el tema principal y el que resuelve «auto» mientras el sistema
  // no pida más contraste.
  return system.prefersContrast ? 'contraste' : 'thul';
}

export function clampFontSize(size, range) {
  return Math.min(Math.max(size, range.min), range.max);
}
`;

/** Las líneas que el visor pinta como cambiadas, contando desde 1. */
const MARKS: readonly CodeLineMark[] = [
  { line: 9, tone: 'added' },
  { line: 10, tone: 'added' },
  { line: 12, tone: 'removed' },
  { line: 13, tone: 'removed' },
  { line: 14, tone: 'removed' },
  { line: 20, tone: 'ours' },
  { line: 21, tone: 'theirs' },
  { line: 22, tone: 'resolved' },
];

const FOLD_LABELS = { fold: 'Plegar', unfold: 'Desplegar', folded: '⋯' };

/**
 * Los mismos bytes, dos lecturas.
 *
 * El primitivo recibe texto ya decodificado, así que la demo tiene que
 * decodificar antes de dárselo. Un acento escrito en UTF-8 y leído como
 * Latin-1 sale partido en dos, que es exactamente el síntoma que la barra del
 * visor de F2.6 permitirá corregir.
 */
type Encoding = (typeof TEXT_ENCODINGS)[number] | 'auto';

const SAMPLE_BYTES = new TextEncoder().encode(SAMPLE);

/** Filas de mentira, suficientes para que la barra tenga sobre qué marcar. */
const ROW_COUNT = 600;

const SCROLL_MARKERS: readonly ScrollMarker[] = [
  { id: 'h1', from: 12, to: 31, tone: 'added', label: 'Añadidas 12–31' },
  { id: 'h2', from: 94, to: 96, tone: 'removed', label: 'Quitadas 94–96' },
  { id: 'h3', from: 210, to: 268, tone: 'changed', label: 'Cambiadas 210–268' },
  { id: 'h4', from: 377, tone: 'conflict', label: 'Conflicto en 377' },
  { id: 'h5', from: 401, to: 404, tone: 'added', label: 'Añadidas 401–404' },
  { id: 'h6', from: 588, to: 599, tone: 'neutral', label: 'Sin cambios 588–599' },
];

const ROWS = Array.from({ length: ROW_COUNT }, (_, index) => index + 1);

/** De píxeles de scroll a números de fila, que es la unidad de las marcas. */
function viewportOf(element: HTMLElement): { from: number; to: number } {
  const rowHeight = element.scrollHeight / ROW_COUNT;

  return {
    from: element.scrollTop / rowHeight,
    to: (element.scrollTop + element.clientHeight) / rowHeight,
  };
}

function CodeSurfaceDemo() {
  const [encoding, setEncoding] = useState<Encoding>('utf-8');
  const [wrap, setWrap] = useState(false);

  const text = useMemo(
    () => decodePreview(SAMPLE_BYTES, encoding === 'auto' ? 'utf-8' : encoding).text,
    [encoding],
  );

  return (
    <div className={styles.column}>
      <h3 className={styles.columnTitle}>
        CodeSurface
        <span className={styles.hint}>números de línea, plegado por sangría y tonos de diff</span>
      </h3>

      <div className={styles.toolbar}>
        <EncodingSelect
          detected="utf-8"
          value={encoding}
          onChange={(encoding) => setEncoding(encoding as Encoding)}
        />
        <Switch
          label="Partir líneas largas"
          checked={wrap}
          onChange={(event) => {
            setWrap(event.target.checked);
          }}
        />
      </div>

      <CodeSurface
        className={styles.code}
        value={text}
        language="script"
        label="src/design/theme.ts"
        encoding={encoding}
        folding={FOLD_LABELS}
        marks={MARKS}
        wrap={wrap}
      />

      <p className={styles.caption}>
        Leído como <strong>{encodingLabel(encoding === 'auto' ? 'utf-8' : encoding)}</strong>. El
        tema, la fuente de visores y la densidad de arriba lo repintan sin remontarlo.
      </p>
    </div>
  );
}

function MarkerScrollbarDemo() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ from: 0, to: 1 });
  const [last, setLast] = useState<string | null>(null);

  // La ventana se mide también al montar: si esperara al primer scroll, el
  // pulgar arrancaría del tamaño de una marca y no del de la ventana.
  useLayoutEffect(() => {
    if (scrollRef.current) setViewport(viewportOf(scrollRef.current));
  }, []);

  const scrollToRow = (row: number) => {
    const element = scrollRef.current;

    if (!element) return;

    element.scrollTop = (row / ROW_COUNT) * element.scrollHeight;
  };

  return (
    <div className={styles.column}>
      <h3 className={styles.columnTitle}>
        MarkerScrollbar
        <span className={styles.hint}>seiscientas filas, seis marcas, cero desplazamiento</span>
      </h3>

      <div className={styles.scrollHost}>
        <div
          className={styles.scroller}
          ref={scrollRef}
          onScroll={(event) => {
            setViewport(viewportOf(event.currentTarget));
          }}
        >
          {ROWS.map((row) => (
            <div className={styles.row} key={row}>
              <span className={styles.rowNumber}>{row}</span>
              <span className={styles.rowText}>fila {row} del contenido largo</span>
            </div>
          ))}
        </div>

        <MarkerScrollbar
          markers={SCROLL_MARKERS}
          label="Cambios del archivo"
          total={ROW_COUNT}
          viewport={viewport}
          onSelect={(marker) => {
            setLast(`Se pulsó «${marker.label ?? marker.id}»`);
            scrollToRow(marker.from);
          }}
          onSeek={(position) => {
            setLast(`Se saltó a la fila ${String(Math.round(position))}`);
            scrollToRow(position);
          }}
        />
      </div>

      {/* Siempre en pantalla: si naciera al pulsar, empujaría lo de abajo. */}
      <p className={styles.caption} data-empty={last === null ? '' : undefined}>
        {last ?? 'Pulsa una marca para ir a ella, o la pista para saltar'}
      </p>
    </div>
  );
}

/**
 * Demo de los dos primitivos de F0.13.
 *
 * Van juntos porque juntos los usa F2.6: el visor de diff es un `CodeSurface`
 * con un `MarkerScrollbar` encima. Aquí siguen sin conocerse —el primitivo de
 * la barra no sabe nada del editor, y al revés—, así que cada uno trae su
 * propio contenido y la demo enseña lo que cada uno promete por separado.
 */
export function ViewerGallery() {
  return (
    <div className={styles.stage}>
      <CodeSurfaceDemo />
      <MarkerScrollbarDemo />
    </div>
  );
}

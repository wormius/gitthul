import { useRef, type PointerEvent } from 'react';

import { markerBand, seekPosition, viewportBand, type ScrollMarker } from './markerScrollbarUtils';
import styles from './MarkerScrollbar.module.css';

interface MarkerScrollbarProps {
  markers: readonly ScrollMarker[];
  /** Nombre accesible del conjunto, p. ej. «Cambios de src/app/tabs.ts». */
  label: string;
  /**
   * Unidad en la que vienen las marcas: líneas, píxeles, elementos. Por defecto
   * `1`, con lo que `from` y `to` se leen como fracciones de 0 a 1.
   *
   * Que sea el total del documento y no el alto del contenido es lo que hace
   * que la barra sirva sobre una lista virtualizada, donde el alto real del DOM
   * no tiene nada que ver con cuánto hay.
   */
  total?: number;
  /** La parte que se está viendo, en la misma unidad. */
  viewport?: { from: number; to: number };
  /** Pulsar una marca. Sin esto las marcas son solo señales, no controles. */
  onSelect?: (marker: ScrollMarker) => void;
  /** Pulsar la pista, con la posición ya traducida a la unidad de `total`. */
  onSeek?: (position: number) => void;
  className?: string;
}

/**
 * Barra de posición con las marcas de los cambios.
 *
 * **No desplaza nada, y no puede hacerlo**: se coloca fuera del flujo sobre el
 * borde del contenedor que scrollea, así que ni montarla, ni quitarla, ni
 * cambiarle las marcas mueve un píxel de lo que hay debajo. Es la invariante 1
 * resuelta por construcción y no por disciplina de CSS, que es lo que conviene
 * en algo cuyo contenido cambia con cada archivo que se abre. El contenedor que
 * la aloja tiene que estar posicionado; lo demás lo pone ella.
 *
 * No scrollea por su cuenta ni sustituye a la barra del navegador: la del
 * sistema sigue ahí, y esta se le superpone. Traducir un clic en un salto es
 * cosa de quien la usa, porque en una lista virtualizada «ir a la línea 4 000»
 * no es asignar un `scrollTop`.
 */
export function MarkerScrollbar({
  markers,
  label,
  total = 1,
  viewport,
  onSelect,
  onSeek,
  className,
}: MarkerScrollbarProps) {
  const visible = viewport ? viewportBand(viewport.from, viewport.to, total) : null;
  const dragOffset = useRef<number | null>(null);

  const seek = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;

    const rail = event.currentTarget.getBoundingClientRect();

    onSeek(
      seekPosition(
        event.clientY - rail.top,
        rail.height,
        total,
        viewport ? viewport.to - viewport.from : 0,
      ),
    );
  };

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek || dragOffset.current === null || !viewport) return;

    const rail = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rail || rail.height <= 0) return;

    const windowSize = viewport.to - viewport.from;
    const top = event.clientY - rail.top - dragOffset.current;
    const position = (Math.min(Math.max(top, 0), rail.height) / rail.height) * total;

    onSeek(Math.min(position, Math.max(total - windowSize, 0)));
  };

  return (
    <div
      className={[styles.scrollbar, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
      data-seekable={onSeek ? '' : undefined}
      onPointerDown={seek}
    >
      {visible && (
        <div
          className={styles.viewport}
          role="scrollbar"
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={Math.max(total - (viewport?.to ?? 0) + (viewport?.from ?? 0), 0)}
          aria-valuenow={viewport?.from ?? 0}
          style={{ top: `${String(visible.top)}%`, height: `${String(visible.height)}%` }}
          onPointerDown={(event) => {
            event.stopPropagation();
            dragOffset.current = event.clientY - event.currentTarget.getBoundingClientRect().top;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={drag}
          onPointerUp={(event) => {
            dragOffset.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }}
          onPointerCancel={() => {
            dragOffset.current = null;
          }}
        />
      )}

      {markers.map((marker) => {
        const band = markerBand(marker, total);
        const style = { top: `${String(band.top)}%`, height: `${String(band.height)}%` };

        return onSelect ? (
          <button
            key={marker.id}
            type="button"
            className={styles.marker}
            data-tone={marker.tone}
            style={style}
            aria-label={marker.label ?? label}
            title={marker.label}
            onPointerDown={(event) => {
              // La pista lleva su propio salto; sin esto, pulsar una marca
              // dispararía además el `onSeek` del fondo.
              event.stopPropagation();
            }}
            onClick={() => {
              onSelect(marker);
            }}
          />
        ) : (
          <span
            key={marker.id}
            className={styles.marker}
            data-tone={marker.tone}
            style={style}
            title={marker.label}
          />
        );
      })}
    </div>
  );
}

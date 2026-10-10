import { createContext, useContext, useId, type DragEvent, type RefObject } from 'react';

import { previewDrag } from './dragPreview';
import styles from './DragLayer.module.css';

/**
 * El contrato de un arrastre, sin saber qué se arrastra.
 *
 * `DragLayer` reparte una sola sesión de arrastre entre un origen y los destinos
 * que quieran mirarla. Lo que viaja es `unknown` a propósito: un primitivo de
 * `src/ui/` no sabe qué es una rama, así que quien pone la carga es quien la
 * reconoce al recibirla, con su propio guardián. Es la misma disciplina que el
 * resto del repositorio: `unknown` y un guardián antes que un tipo inventado.
 */

/** Qué pasaría si lo que viaja se soltara aquí. `null` = esto no es destino. */
export type DropVerdict = 'valid' | 'invalid';

/** El efecto que anuncia el sistema mientras el puntero está encima. */
export type DragEffect = 'move' | 'copy' | 'link';

export interface DragSession {
  /** Lo que se agarró. La capa lo guarda y lo entrega; no lo mira. */
  readonly payload: unknown;
  /** Identidad interna del origen: es lo que permite atenuar solo el que se agarró. */
  readonly source: string;
  /**
   * Si el arrastre ya se puede pintar.
   *
   * Falso hasta el primer `dragover`, y de ahí cuelgan las dos cosas que se
   * ven: el hueco fantasmal del origen y el aviso del destino bajo el puntero. El navegador
   * saca la foto que viaja con el puntero justo después del `dragstart`, así que
   * atenuar en el acto atenuaría también esa foto; y montar o mover algo en ese
   * instante provoca un reflujo que en el WebKit de la ventana **cancela el
   * arrastre**. Lo que ese bucle de eventos sí reparte sin parar es `dragover`
   * —ni `requestAnimationFrame` ni `setTimeout` llegan ahí dentro—, y para
   * cuando llega el primero la foto ya está tomada.
   */
  readonly revealed: boolean;
}

export interface DragLayerApi {
  session: DragSession | null;
  /** El destino que tiene el puntero encima, por su identidad interna. */
  over: string | null;
  begin: (source: string, payload: unknown) => void;
  end: () => void;
  hover: (target: string) => void;
  /** Apaga el resalte solo si el que sale es el que estaba encendido. */
  unhover: (target: string) => void;
}

export const DragLayerContext = createContext<DragLayerApi | null>(null);

export function useDragLayer(): DragLayerApi {
  const layer = useContext(DragLayerContext);

  if (!layer) throw new Error('El arrastre solo funciona dentro de un DragLayer');

  return layer;
}

export interface DragSourceOptions {
  /** Lo que viaja. Quien lo pone es quien lo reconoce al recibirlo. */
  payload: unknown;
  /**
   * Qué se retrata, si no es el propio elemento que se agarró.
   *
   * Una zona con doce tarjetas dentro sería una foto de media pantalla: se pasa
   * su cabecera y viaja solo eso.
   */
  preview?: RefObject<HTMLElement | null>;
  /** Texto plano para quien reciba la suelta fuera de la aplicación. */
  text?: string;
  effect?: DragEffect;
  className?: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export interface DragSourceProps {
  draggable: true;
  className: string;
  'data-ghost': '' | undefined;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: (event: DragEvent<HTMLElement>) => void;
}

/**
 * Convierte un elemento en origen de arrastre.
 *
 * Devuelve las propiedades tal cual para repartirlas sobre el elemento; el
 * `className` propio se pasa por opciones y sale ya mezclado, porque el
 * elemento es del consumidor y la clase del fantasma es de la capa.
 */
export function useDragSource(options: DragSourceOptions): DragSourceProps {
  const layer = useDragLayer();
  const id = useId();
  const session = layer.session;
  const ghost = session !== null && session.source === id && session.revealed;

  return {
    draggable: true,
    className: [styles.source, options.className].filter(Boolean).join(' '),
    'data-ghost': ghost ? '' : undefined,

    onDragStart(event) {
      const transfer = event.dataTransfer;

      if (transfer) {
        transfer.effectAllowed = options.effect ?? 'move';

        if (options.text !== undefined) transfer.setData('text/plain', options.text);
      }

      // La copia, nunca el original: en el WebKit de la ventana la foto no se
      // congela, así que atenuar el origen borraría también lo que viaja.
      previewDrag(event, options.preview?.current);

      layer.begin(id, options.payload);
      options.onDragStart?.();
    },

    onDragEnd() {
      layer.end();
      options.onDragEnd?.();
    },
  };
}

export interface DropTargetOptions {
  /**
   * Qué pasaría si lo que viaja se soltara aquí, mirado en cada repintado.
   *
   * Devolver `null` es decir «esto no es destino de esto»: no se resalta, no
   * recibe y el sistema pinta el «no se puede» de siempre. Devolver `'invalid'`
   * es distinto: sí es un destino, y por eso se marca como inválido en vez de
   * dejar que no pase nada.
   */
  accepts: (payload: unknown) => DropVerdict | null;
  onDrop: (payload: unknown) => void;
  className?: string;
  effect?: DragEffect;
}

export interface DropTargetProps {
  className: string;
  'data-drop': DropVerdict | undefined;
  'data-over': '' | undefined;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

/**
 * Convierte un elemento en destino de arrastre, válido o inválido.
 *
 * El veredicto se recalcula en cada repintado a partir de lo que viaja, pero
 * solo se expone visualmente en el destino que está bajo el puntero. Solo el
 * válido acepta la suelta: sin `preventDefault` en el `dragover`
 * el sistema enseña el cursor de rechazo y el `drop` no llega nunca.
 */
export function useDropTarget(options: DropTargetOptions): DropTargetProps {
  const layer = useDragLayer();
  const id = useId();
  const session = layer.session;
  const verdict = session !== null && session.revealed ? options.accepts(session.payload) : null;
  const over = verdict !== null && layer.over === id;

  return {
    className: [styles.target, options.className].filter(Boolean).join(' '),
    'data-drop': over ? verdict : undefined,
    'data-over': over ? '' : undefined,

    onDragEnter() {
      if (session === null) return;

      layer.hover(id);
    },

    onDragOver(event) {
      if (session === null) return;

      /*
       * Se anota quién tiene el puntero encima aunque todavía no haya veredicto:
       * el primer `dragover` de un arrastre es el que revela la sesión, y en él
       * el veredicto de este repintado sigue siendo `null`. Sin esto, apuntar a
       * un destino sin mover más el ratón no lo encendería hasta el siguiente.
       *
       * También aquí y no solo en el `dragenter`: entrar en un hijo dispara un
       * `dragleave` del padre que apagaría el resalte sin haber salido.
       */
      layer.hover(id);

      if (verdict === null) return;

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = verdict === 'valid' ? (options.effect ?? 'move') : 'none';
      }

      if (verdict === 'valid') event.preventDefault();
    },

    onDragLeave(event) {
      // Pasar a un hijo también dispara `dragleave`: solo cuenta salir del todo.
      if (session === null || event.currentTarget.contains(event.relatedTarget as Node)) return;

      layer.unhover(id);
    },

    onDrop(event) {
      if (verdict !== 'valid' || session === null) return;

      event.preventDefault();
      options.onDrop(session.payload);
      layer.end();
    },
  };
}

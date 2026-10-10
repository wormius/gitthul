import type { DragEvent } from 'react';

/**
 * La imagen que viaja con el puntero, dibujada de una copia y no del original.
 *
 * El navegador, si nadie le dice otra cosa, la saca del propio elemento que se
 * arrastra. En el WebKit de la ventana nativa esa foto **no se congela**: la
 * superficie que va bajo el puntero sigue atada al elemento vivo, así que
 * atenuar el origen para dejar su hueco fantasmal atenuaba también lo que se
 * lleva la mano, y desaparecía. Las dos cosas que se quieren —ver de dónde salió
 * y ver qué se lleva— se estorbaban por estar pintadas del mismo sitio.
 *
 * Con una copia, cada una va por su lado: el original se atenúa en su hueco y la
 * copia viaja entera. La copia nace fuera de la pantalla, no la ve ningún lector
 * —está `aria-hidden`— y se retira en el `dragend`, que es el único aviso seguro
 * de que aquello terminó: dentro del arrastre no corren ni relojes ni cuadros.
 *
 * El desplazamiento es el del propio puntero dentro del elemento, así que la
 * copia queda exactamente donde estaba lo que se agarró y no salta al empezar.
 * Se acota a la caja porque el sitio por el que se agarra no siempre es el que
 * se pinta: una zona de espacio se agarra por su hueco libre y lo que viaja es
 * su cabecera, que puede quedar bastante más arriba del puntero.
 *
 * Nació en `features/repositories/` con la vista que lo descubrió y vive aquí
 * desde `F0.12`: `DragLayer` es su segundo consumidor, y un primitivo de
 * `src/ui/` no puede importar de una vista. Lo de arriba son las lecciones que
 * costaron una sesión cada una; los ejemplos siguen citando de dónde salieron
 * porque el porqué se entiende mejor con el caso que lo destapó.
 */
/** Deja el punto de agarre dentro de la caja de lo que viaja. */
function within(offset: number, size: number): number {
  return Math.min(Math.max(offset, 0), size);
}

/**
 * Compensa el doble escalado de la superficie nativa de arrastre en WebKitGTK.
 *
 * WebKit ya rasteriza la copia a píxeles físicos y GTK vuelve a interpretar esa
 * superficie con el factor del monitor. Chromium y el WebKit de macOS no pasan
 * por esa costura, así que reducir allí haría pequeña una imagen correcta.
 */
export function getDragPreviewScale(userAgent: string, pixelRatio: number): number {
  const isLinux = /\b(?:Linux|X11)\b/i.test(userAgent);
  const isWebKit = /\bAppleWebKit\//i.test(userAgent);
  const isChromium = /\b(?:Chrome|Chromium|Edg|OPR)\//i.test(userAgent);

  if (!isLinux || !isWebKit || isChromium || !Number.isFinite(pixelRatio) || pixelRatio <= 1) {
    return 1;
  }

  return 1 / pixelRatio;
}

export function previewDrag(event: DragEvent<HTMLElement>, node?: HTMLElement | null): void {
  const transfer = event.dataTransfer;
  const source = node ?? event.currentTarget;

  if (!transfer || typeof transfer.setDragImage !== 'function') return;

  const rect = source.getBoundingClientRect();
  const copy = source.cloneNode(true);

  if (!(copy instanceof HTMLElement)) return;

  copy.setAttribute('aria-hidden', 'true');
  copy.style.position = 'fixed';
  copy.style.top = '0';
  copy.style.left = '-10000px';
  copy.style.pointerEvents = 'none';
  // Entera aunque su original se atenúe: es justo lo que se venía perdiendo.
  copy.style.opacity = '1';

  /*
   * La caja se fija a lo que medía el original, las dos medidas y no solo el
   * ancho. Una fila de la lista virtual vive con `height: 100%` dentro del hueco
   * que le reserva el virtualizador; sacada de ahí, ese 100 % pasa a ser el del
   * cuerpo del documento y la copia salía tan alta como la ventana. Con
   * `border-box`, además, el relleno cabe dentro de la medida en vez de sumarse.
   */
  copy.style.boxSizing = 'border-box';
  copy.style.width = `${String(rect.width)}px`;
  copy.style.height = `${String(rect.height)}px`;
  copy.style.maxWidth = 'none';
  copy.style.maxHeight = 'none';

  const scale = getDragPreviewScale(navigator.userAgent, window.devicePixelRatio);

  if (scale !== 1) {
    copy.style.transformOrigin = 'top left';
    copy.style.transform = `scale(${String(scale)})`;
  }

  document.body.append(copy);
  transfer.setDragImage(
    copy,
    within(event.clientX - rect.left, rect.width),
    within(event.clientY - rect.top, rect.height),
  );

  window.addEventListener(
    'dragend',
    () => {
      copy.remove();
    },
    { once: true, capture: true },
  );
}

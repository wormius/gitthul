import { describe, expect, it, vi } from 'vitest';

import { getDragPreviewScale, previewDrag } from './dragPreview';

/** Lo mínimo de `DataTransfer` que la copia necesita, con la llamada espiada. */
function transfer() {
  return { setDragImage: vi.fn() };
}

/** Un `dragstart` de mentira sobre un elemento de verdad, que sí mide y clona. */
function dragEvent(source: HTMLElement, data: ReturnType<typeof transfer> | null) {
  return {
    currentTarget: source,
    dataTransfer: data,
    clientX: 30,
    clientY: 12,
  } as unknown as Parameters<typeof previewDrag>[0];
}

function sourceElement(box = { width: 0, height: 0 }): HTMLElement {
  const node = document.createElement('div');

  node.textContent = 'gitthul';
  node.dataset['ghost'] = '';
  // jsdom no calcula diseño, así que la medida se dicta: lo que importa aquí es
  // que la copia se quede con la caja del original, venga de donde venga.
  node.getBoundingClientRect = () =>
    ({ ...box, top: 0, left: 0, right: box.width, bottom: box.height, x: 0, y: 0 }) as DOMRect;
  document.body.append(node);

  return node;
}

describe('getDragPreviewScale', () => {
  it('compensa el factor físico únicamente en WebKitGTK', () => {
    const webkitGtk = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)';

    expect(getDragPreviewScale(webkitGtk, 2.5)).toBe(0.4);
    expect(getDragPreviewScale(webkitGtk, 1)).toBe(1);
  });

  it('no reduce las imágenes que otros motores ya escalan correctamente', () => {
    const chromeLinux =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
    const safariMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

    expect(getDragPreviewScale(chromeLinux, 2.5)).toBe(1);
    expect(getDragPreviewScale(safariMac, 2.5)).toBe(1);
  });
});

describe('previewDrag', () => {
  /*
   * La copia es lo único que hace que el fantasma del origen y la imagen que
   * viaja con el puntero puedan verse a la vez: atada al original, atenuar uno
   * atenuaba la otra.
   */
  it('entrega una copia del elemento, fuera de la pantalla y opaca', () => {
    const data = transfer();
    const source = sourceElement();

    previewDrag(dragEvent(source, data));

    expect(data.setDragImage).toHaveBeenCalledOnce();

    const [copy] = data.setDragImage.mock.calls[0] as [HTMLElement, number, number];

    expect(copy).not.toBe(source);
    expect(copy).toHaveTextContent('gitthul');
    expect(copy.isConnected).toBe(true);
    expect(copy.style.opacity).toBe('1');
    expect(copy.style.left).toBe('-10000px');
    expect(copy).toHaveAttribute('aria-hidden', 'true');
  });

  /*
   * Una fila de la lista virtual vive con `height: 100%` dentro del hueco que le
   * reserva el virtualizador. Fuera de ese hueco, ese 100 % es el del documento:
   * la copia salía tan alta como la ventana entera.
   */
  it('la copia se queda con la caja que medía el original', () => {
    const data = transfer();

    previewDrag(dragEvent(sourceElement({ width: 525, height: 28 }), data));

    const [copy] = data.setDragImage.mock.calls[0] as [HTMLElement, number, number];

    expect(copy.style.width).toBe('525px');
    expect(copy.style.height).toBe('28px');
    expect(copy.style.boxSizing).toBe('border-box');
  });

  /*
   * Una zona de espacio se agarra por su hueco libre y lo que viaja es su
   * cabecera: sin acotar, el punto de agarre caía fuera de la copia y la imagen
   * se iba a pastar lejos del puntero.
   */
  it('el punto de agarre no se sale de lo que viaja', () => {
    const data = transfer();
    const source = sourceElement();

    // jsdom no mide: la caja es de cero, así que todo desplazamiento sobra.
    previewDrag(dragEvent(source, data));

    const [, x, y] = data.setDragImage.mock.calls[0] as [HTMLElement, number, number];

    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  /* Y se retira sola: durante un arrastre no corre ningún reloj que la limpie. */
  it('la copia se va con el `dragend`', () => {
    const data = transfer();

    previewDrag(dragEvent(sourceElement(), data));

    const [copy] = data.setDragImage.mock.calls[0] as [HTMLElement, number, number];

    expect(copy.isConnected).toBe(true);

    window.dispatchEvent(new Event('dragend'));

    expect(copy.isConnected).toBe(false);
  });

  /* Sin `dataTransfer` no hay arrastre que valga, y tampoco copia que limpiar. */
  it('sin transporte no ensucia el documento', () => {
    const before = document.body.childElementCount;

    previewDrag(dragEvent(sourceElement(), null));

    expect(document.body.childElementCount).toBe(before + 1);
  });
});

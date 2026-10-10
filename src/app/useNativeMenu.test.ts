import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useNativeMenu } from './useNativeMenu';

/** Si el menú nativo saliera, el usuario vería «Recargar» dentro de la ventana. */
function rightClick(target: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event.defaultPrevented;
}

describe('useNativeMenu', () => {
  it('apaga el menú del navegador en cualquier sitio', () => {
    renderHook(() => {
      useNativeMenu();
    });

    expect(rightClick(document.body)).toBe(true);
  });

  it('se lo deja a los campos de texto, que ahí es el del sistema', () => {
    renderHook(() => {
      useNativeMenu();
    });

    const input = document.createElement('input');
    const area = document.createElement('textarea');

    document.body.append(input, area);

    expect(rightClick(input)).toBe(false);
    expect(rightClick(area)).toBe(false);

    input.remove();
    area.remove();
  });

  it('deja de escuchar al desmontarse', () => {
    const { unmount } = renderHook(() => {
      useNativeMenu();
    });

    unmount();

    expect(rightClick(document.body)).toBe(false);
  });
});

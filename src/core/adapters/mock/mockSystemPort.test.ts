import { describe, expect, it } from 'vitest';

import { MOCK_DIRECTORIES } from './fixture/directories';
import { createMockLogPort } from './mockLogPort';
import { createMockSystemPort } from './mockSystemPort';

describe('createMockSystemPort', () => {
  it('conserva texto de portapapeles por instancia sin registrarlo en el log', async () => {
    const log = createMockLogPort();
    const first = createMockSystemPort({ log });
    const second = createMockSystemPort();
    await first.writeClipboardText('texto privado\ncon acentos: canción');
    await expect(first.readClipboardText()).resolves.toBe('texto privado\ncon acentos: canción');
    await expect(second.readClipboardText()).resolves.toBe('');
    expect(await log.read()).toHaveLength(0);
  });

  it('recorre las carpetas de la lista y vuelve al principio', async () => {
    const port = createMockSystemPort();
    const paths = MOCK_DIRECTORIES.map((entry) => entry.path);

    for (const path of paths) {
      expect(await port.pickDirectory()).toBe(path);
    }

    expect(await port.pickDirectory()).toBe(paths[0]);
  });

  it('devuelve lo que se le encarga, una vez por encargo', async () => {
    const port = createMockSystemPort();

    port.answerWith('/home/example/inventado');

    expect(await port.pickDirectory()).toBe('/home/example/inventado');
    expect(await port.pickDirectory()).toBe(MOCK_DIRECTORIES[0]?.path);
  });

  // Cancelar el selector no es un fallo: devuelve `null` y no rechaza.
  it('finge la cancelación sin rechazar', async () => {
    const port = createMockSystemPort();

    port.answerWith(null);

    await expect(port.pickDirectory()).resolves.toBeNull();
  });

  it('anota lo que se habría abierto en el explorador', async () => {
    const log = createMockLogPort();
    const port = createMockSystemPort({ log });

    await port.revealPath('/home/example/projects/gitthul');

    expect(port.revealed).toEqual(['/home/example/projects/gitthul']);
    expect((await log.read()).at(-1)?.message).toContain('/home/example/projects/gitthul');
  });
});

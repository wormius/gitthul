import { describe, expect, it } from 'vitest';

import { isCancelled } from '@core/domain/errors';
import type { TerminalOutputLine } from '@core/domain/terminal';

import { createMockTerminalPort } from './mockTerminalPort';

/** Recoge todas las líneas de un iterable asíncrono. */
async function collect(iter: AsyncIterable<TerminalOutputLine>): Promise<TerminalOutputLine[]> {
  const lines: TerminalOutputLine[] = [];

  for await (const line of iter) lines.push(line);

  return lines;
}

describe('createMockTerminalPort', () => {
  it('ejecuta un comando conocido y devuelve su salida fija', async () => {
    const port = createMockTerminalPort();
    const lines = await collect(port.execute('s1', 'git status'));

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.stream).toBe('stdout');
    expect(lines[0]!.text).toBe('On branch main');
  });

  it('echo repite sus argumentos', async () => {
    const port = createMockTerminalPort();
    const lines = await collect(port.execute('s1', 'echo hola mundo'));

    expect(lines).toEqual([{ stream: 'stdout', text: 'hola mundo' }]);
  });

  it('un comando desconocido da command not found', async () => {
    const port = createMockTerminalPort();
    const lines = await collect(port.execute('s1', 'foo --bar'));

    expect(lines).toEqual([{ stream: 'stderr', text: 'command not found: foo' }]);
  });

  it('clear emite la marca especial', async () => {
    const port = createMockTerminalPort();
    const lines = await collect(port.execute('s1', 'clear'));

    expect(lines).toEqual([{ stream: 'stdout', text: '\x1b[clear]' }]);
  });

  it('acumula el historial por sesión', async () => {
    const port = createMockTerminalPort();

    await collect(port.execute('s1', 'echo uno'));
    await collect(port.execute('s1', 'echo dos'));
    await collect(port.execute('s2', 'echo tres'));

    expect(await port.getHistory('s1')).toEqual(['echo uno', 'echo dos']);
    expect(await port.getHistory('s2')).toEqual(['echo tres']);
    expect(await port.getHistory('s3')).toEqual([]);
  });

  it('cancelar detiene la emisión sin error de catálogo', async () => {
    const port = createMockTerminalPort({ lineDelay: { min: 50, max: 50 } });
    const controller = new AbortController();
    const lines: TerminalOutputLine[] = [];

    try {
      for await (const line of port.execute('s1', 'git log --oneline', controller.signal)) {
        lines.push(line);
        // Cancelamos después de la primera línea.
        controller.abort();
      }
    } catch (error: unknown) {
      expect(isCancelled(error)).toBe(true);
    }

    // Debe haber recibido como máximo una línea antes de cancelar.
    expect(lines.length).toBeLessThanOrEqual(1);
  });

  it('recorta espacios del comando antes de resolver', async () => {
    const port = createMockTerminalPort();
    const lines = await collect(port.execute('s1', '  git branch  '));

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.text).toBe('* main');
  });
});

import { describe, expect, it } from 'vitest';

import { findTerminalHttpLinks } from './terminalLinks';

describe('findTerminalHttpLinks', () => {
  it('extrae HTTP(S), conserva paréntesis equilibrados y separa la puntuación final', () => {
    expect(
      findTerminalHttpLinks('Mira https://example.test/a_(b), o http://docs.example.test/path.'),
    ).toEqual([
      {
        href: 'https://example.test/a_(b)',
        domain: 'example.test',
        start: 5,
        length: 26,
      },
      {
        href: 'http://docs.example.test/path',
        domain: 'docs.example.test',
        start: 35,
        length: 29,
      },
    ]);
  });

  it('rechaza otros protocolos, credenciales y coincidencias incrustadas en otra palabra', () => {
    const line =
      'javascript:alert(1) ftp://example.test https://user:secret@example.test xhttps://bad.test';
    expect(findTerminalHttpLinks(line)).toEqual([]);
  });
});

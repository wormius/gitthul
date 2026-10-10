import { describe, expect, it } from 'vitest';

import { assemble, buildBlocks, conflictBlocks } from './conflict';
import cases from './fixtures/git-merge-file.json';

// Resultados de Git 2.53.0: git merge-file -p ours base theirs, sin modificar
// el repositorio. Guardados como fixtures para no requerir Git en el navegador.
// Incluyen todas las parejas de inserción/borrado/reemplazo en cinco posiciones,
// además de CRLF, ausencia de salto final, texto repetido y archivos vacíos.
describe('contraste con Git merge-file', () => {
  it.each(cases.map((entry, index) => ({ ...entry, index })))(
    'caso $index',
    ({ base, ours, theirs, clean, result }) => {
      const blocks = buildBlocks(base, ours, theirs);
      expect(conflictBlocks(blocks).length === 0).toBe(clean);
      if (clean) expect(assemble(blocks, new Map()).text).toBe(result);
    },
  );
});

import { describe, expect, it } from 'vitest';

import { findTerminalMatches } from './terminalSearch';

describe('findTerminalMatches', () => {
  it('encuentra todas las coincidencias literales del historial sin distinguir mayúsculas', () => {
    expect(findTerminalMatches(['Needle x needle', 'sin resultado', 'NEEDLE'], 'needle')).toEqual([
      { row: 0, column: 0, length: 6 },
      { row: 0, column: 9, length: 6 },
      { row: 2, column: 0, length: 6 },
    ]);
  });

  it('no interpreta expresiones regulares ni devuelve resultados para una consulta vacía', () => {
    expect(findTerminalMatches(['a.b aab'], 'a.b')).toEqual([{ row: 0, column: 0, length: 3 }]);
    expect(findTerminalMatches(['texto'], '')).toEqual([]);
  });
});

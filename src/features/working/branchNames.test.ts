import { describe, expect, it } from 'vitest';

import { suggestedWorktreePath, validateRefName } from './branchNames';

describe('validateRefName', () => {
  it('acepta lo que git acepta', () => {
    expect(validateRefName('dev', [])).toBeNull();
    expect(validateRefName('fix/push-rechazado', [])).toBeNull();
    expect(validateRefName('v1.2.0', [])).toBeNull();
  });

  it('vacío es el estado de arranque, no un error que reprocharle a nadie', () => {
    expect(validateRefName('   ', [])).toBe('empty');
  });

  it('rechaza lo que `git check-ref-format` rechaza', () => {
    expect(validateRefName('con espacio', [])).toBe('invalid');
    expect(validateRefName('dos..puntos', [])).toBe('invalid');
    expect(validateRefName('rama.lock', [])).toBe('invalid');
    expect(validateRefName('/inicial', [])).toBe('invalid');
    expect(validateRefName('final/', [])).toBe('invalid');
    expect(validateRefName('a//b', [])).toBe('invalid');
    expect(validateRefName('con~virgulilla', [])).toBe('invalid');
  });

  it('el nombre repetido se explica mientras se escribe', () => {
    expect(validateRefName('dev', ['main', 'dev'])).toBe('taken');
  });

  it('renombrar admite que el nombre siga siendo el suyo', () => {
    expect(validateRefName('dev', ['main', 'dev'], 'dev')).toBeNull();
  });
});

describe('suggestedWorktreePath', () => {
  it('propone la carpeta hermana `../<repo>-<rama>`', () => {
    expect(suggestedWorktreePath('/home/x/Espacios/gitthul', 'gitthul', 'dev')).toBe(
      '/home/x/Espacios/gitthul-dev',
    );
  });

  it('aplana las barras de la rama: una carpeta con barras sería otra carpeta', () => {
    expect(suggestedWorktreePath('/home/x/gitthul', 'gitthul', 'fix/push')).toBe(
      '/home/x/gitthul-fix-push',
    );
  });

  it('sin rama todavía elegida propone la carpeta a secas', () => {
    expect(suggestedWorktreePath('/home/x/gitthul', 'gitthul', '')).toBe('/home/x/gitthul');
  });
});

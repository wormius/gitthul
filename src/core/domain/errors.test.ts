import { describe, expect, it } from 'vitest';

import { LOCALES } from '@i18n/locales';
import { MESSAGES } from '@i18n/messages';

import {
  describeError,
  GIT_ERROR_CODES,
  GIT_ERRORS,
  GitOperationError,
  isCancelled,
  isGitOperationError,
  OperationCancelledError,
  toGitOperationError,
  type GitErrorCode,
} from './errors';

const holes = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);

describe('catálogo de errores', () => {
  it.each(GIT_ERROR_CODES)('%s tiene uno o dos arreglos', (code) => {
    const { fixes } = GIT_ERRORS[code];

    expect(fixes.length).toBeGreaterThanOrEqual(1);
    expect(fixes.length).toBeLessThanOrEqual(2);
    expect(new Set(fixes).size).toBe(fixes.length);
  });

  /*
   * La invariante 5 en su forma más práctica: si la frase promete un nombre de
   * rama, el error tiene que exigirlo. Una plantilla con un hueco que su código
   * no declara sale a la ventana como «{branch}» literal.
   */
  it.each(LOCALES)('en %s ninguna plantilla usa un hueco que su error no declare', (locale) => {
    const messages = MESSAGES[locale];
    const offenders: string[] = [];

    for (const code of GIT_ERROR_CODES) {
      const entry = GIT_ERRORS[code];
      const declared = new Set<string>(entry.params);

      const templates = [
        messages[`error.${code}.title`],
        messages[`error.${code}.cause`],
        ...entry.fixes.map((fix) => messages[`errorFix.${fix}`]),
      ];

      for (const template of templates) {
        for (const hole of holes(template)) {
          if (hole !== undefined && !declared.has(hole)) offenders.push(`${code}: {${hole}}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it.each(LOCALES)('%s redacta cada error con frase y causa', (locale) => {
    const messages = MESSAGES[locale];

    for (const code of GIT_ERROR_CODES) {
      expect(messages[`error.${code}.title`].trim()).not.toBe('');
      expect(messages[`error.${code}.cause`].trim()).not.toBe('');
    }
  });
});

describe('describeError', () => {
  it('devuelve claves, parámetros y arreglos, con el primero como principal', () => {
    const error = new GitOperationError(
      'push.rejected',
      { branch: 'main', remote: 'origin', count: 3 },
      { output: 'error: failed to push some refs' },
    );

    const described = describeError(error);

    expect(described.titleKey).toBe('error.push.rejected.title');
    expect(described.causeKey).toBe('error.push.rejected.cause');
    expect(described.params).toEqual({ branch: 'main', remote: 'origin', count: 3 });
    expect(described.output).toBe('error: failed to push some refs');
    expect(described.fixes).toEqual([
      { id: 'fetchAndRetry', labelKey: 'errorFix.fetchAndRetry', primary: true },
      { id: 'forcePush', labelKey: 'errorFix.forcePush', primary: false },
    ]);
  });

  it('sin salida de git no inventa ninguna', () => {
    const described = describeError(new GitOperationError('branch.exists', { branch: 'dev' }));

    expect(described.output).toBeUndefined();
  });
});

describe('toGitOperationError', () => {
  it('deja pasar lo que ya está en el catálogo', () => {
    const error = new GitOperationError('repo.locked', { repo: 'gitthul' });

    expect(toGitOperationError(error)).toBe(error);
  });

  it('convierte cualquier otra cosa en un fallo desconocido con su salida', () => {
    const converted = toGitOperationError(new Error('fatal: algo raro'));

    expect(converted.code satisfies GitErrorCode).toBe('unknown');
    expect(converted.output).toBe('fatal: algo raro');
    expect(isGitOperationError(converted)).toBe(true);
  });
});

describe('cancelación', () => {
  it('no es un fallo del catálogo', () => {
    const cancelled = new OperationCancelledError();

    expect(isCancelled(cancelled)).toBe(true);
    expect(isGitOperationError(cancelled)).toBe(false);
    expect(isCancelled(new GitOperationError('unknown', {}))).toBe(false);
  });
});

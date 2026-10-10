import { expect, it } from 'vitest';
import { recoveryFailure, RecoveryOperationError } from './recovery';

it('preserva códigos nativos y evidencia para traducirlos sin mostrar objetos opacos', () => {
  expect(
    recoveryFailure({ code: 'recovery.unavailable', params: {}, output: 'Permission denied' }),
  ).toEqual({ code: 'recovery.unavailable', output: 'Permission denied' });
  expect(recoveryFailure(new RecoveryOperationError('recovery.stale'))).toEqual({
    code: 'recovery.stale',
  });
  expect(recoveryFailure({ code: 'recovery.cancelled', params: {} }).code).toBe(
    'recovery.cancelled',
  );
  expect(recoveryFailure(new Error('disk full'))).toEqual({ output: 'disk full' });
});

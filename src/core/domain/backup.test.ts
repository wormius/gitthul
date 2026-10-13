import { expect, it } from 'vitest';
import { BackupOperationError, backupFailure } from './backup';

it('recognizes native structured failures and keeps useful diagnostic output', () => {
  expect(
    backupFailure(new Error(JSON.stringify({ code: 'backup.destination', output: 'exists' }))),
  ).toEqual({ code: 'backup.destination', output: 'exists' });
  expect(backupFailure(new BackupOperationError('backup.stale'))).toEqual({ code: 'backup.stale' });
  expect(backupFailure(new Error('disk full'))).toEqual({ output: 'disk full' });
});

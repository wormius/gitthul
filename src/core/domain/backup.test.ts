import { expect, it } from 'vitest';
import {
  BackupOperationError,
  backupFailure,
  isBackupPointProtected,
  type BackupRepository,
} from './backup';

it('recognizes native structured failures and keeps useful diagnostic output', () => {
  expect(
    backupFailure(new Error(JSON.stringify({ code: 'backup.destination', output: 'exists' }))),
  ).toEqual({ code: 'backup.destination', output: 'exists' });
  expect(backupFailure(new BackupOperationError('backup.stale'))).toEqual({ code: 'backup.stale' });
  expect(backupFailure(new Error('disk full'))).toEqual({ output: 'disk full' });
});

it('recognizes protected-backup errors from native and domain sources', () => {
  const failure = { code: 'backup.protected', output: 'Keep the latest valid point' };
  expect(backupFailure(new Error(JSON.stringify(failure)))).toEqual(failure);
  expect(backupFailure(new BackupOperationError('backup.protected'))).toEqual({
    code: 'backup.protected',
  });
});

it.each(['backup.limitChanged', 'backup.limitTooSmall'] as const)(
  'recognizes %s from native JSON strings, Error messages and domain errors',
  (code) => {
    const failure = { code, output: 'Review the new space plan' };
    expect(backupFailure(JSON.stringify(failure))).toEqual(failure);
    expect(backupFailure(new Error(JSON.stringify(failure)))).toEqual(failure);
    expect(backupFailure(new BackupOperationError(code))).toEqual({ code });
    expect(backupFailure(' {broken JSON')).toEqual({ output: ' {broken JSON' });
  },
);

it('protects the newest points per repository, including every timestamp tie', () => {
  const repository: BackupRepository = {
    id: 'one',
    name: 'one',
    repository: '/fixtures/one',
    status: 'failed',
    reason: 'io',
    lastCompletedAt: 1,
    points: [
      { id: 'latest-a', createdAt: 30, bytes: 100, fileCount: 1 },
      { id: 'old', createdAt: 10, bytes: 100, fileCount: 1 },
      { id: 'latest-b', createdAt: 30, bytes: 100, fileCount: 1 },
    ],
  };
  expect(repository.points.map((point) => isBackupPointProtected(repository, point))).toEqual([
    true,
    false,
    true,
  ]);
  const other: BackupRepository = {
    ...repository,
    id: 'two',
    points: [{ id: 'only', createdAt: 5, bytes: 10, fileCount: 1 }],
  };
  expect(isBackupPointProtected(other, other.points[0]!)).toBe(true);
});

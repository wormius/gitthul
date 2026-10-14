import { describe, expect, it } from 'vitest';
import { logEntryFactory } from './logEntry';

describe('logEntryFactory', () => {
  it('redacta los campos estructurados y mantiene el contexto técnico en la entrada capturada', () => {
    const entry = logEntryFactory()('error', 'git.read', 'falló leer refs', false, undefined, {
      operationId: 'operation-1',
      error: {
        name: 'GitOperationError',
        code: 'unknown',
        params: { token: 'private-credential' },
        diagnostic: {
          stage: 'read_refs',
          command: { program: 'git', args: ['fetch', 'https://name:password@host/repo'] },
          stderr: 'fatal: Authorization: Bearer hidden-token',
        },
      },
    });
    expect(entry.schemaVersion).toBe(3);
    expect(entry.context?.error).toMatchObject({
      code: 'unknown',
      params: { token: '[redacted]' },
      diagnostic: { stage: 'read_refs', command: { program: 'git' } },
    });
    for (const secret of ['private-credential', 'name:password', 'hidden-token'])
      expect(JSON.stringify(entry)).not.toContain(secret);
  });

  it('comparte la sesión y separa los IDs sin depender de valores del usuario', () => {
    const make = logEntryFactory();
    const first = make('info', 'app', 'arrancó', false);
    const second = make('error', 'runtime', 'falló', false);
    expect(first.sessionId).toBe(second.sessionId);
    expect(second.id).toBeGreaterThan(first.id);
  });
});

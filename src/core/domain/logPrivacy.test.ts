import { expect, it } from 'vitest';
import { boundLogText, redactKnownLogValues, redactLogText, redactLogValue } from './logPrivacy';

it('redacta credenciales sin ocultar la ruta ni el error de Git', () => {
  const text = redactLogText(
    'fatal https://name:password@host/repo?token=secret Authorization: Bearer eyJsecret password=word {"api_key":"key123"}',
  );
  expect(text).toContain('host/repo');
  for (const secret of ['name:password', 'eyJsecret', 'password=word', 'key123', 'token=secret'])
    expect(text).not.toContain(secret);
});

it('retira todo el userinfo de URLs con arrobas sin escapar conservando host y ruta', () => {
  const text = redactLogText(
    'fatal: https://person@private.invalid:private-password@host.invalid/repo',
  );
  expect(text).toBe('fatal: https://[redacted]@host.invalid/repo');
  for (const privateText of ['person', 'private.invalid', 'private-password'])
    expect(text).not.toContain(privateText);
  expect(redactLogText('https://person@private.invalid:word@with@signs@host.invalid/repo')).toBe(
    'https://[redacted]@host.invalid/repo',
  );
});
it('retira bloques de claves privadas', () => {
  expect(
    redactLogText(
      'failed: -----BEGIN OPENSSH PRIVATE KEY-----\nprivate\n-----END OPENSSH PRIVATE KEY-----',
    ),
  ).toBe('failed: [redacted private key]');
});

it('redacta valores entre comillas con espacios y bloques privados incompletos', () => {
  const text = redactLogText(
    'password="two secret words" token=plain -----BEGIN PRIVATE KEY-----\nprivate',
  );
  expect(text).not.toContain('two secret words');
  expect(text).not.toContain('token=plain');
  expect(text).not.toContain('\nprivate');
});

it('redacta secretos multilínea en JSON anidado y causas serializadas conservando la evidencia', () => {
  const text = redactLogText(
    JSON.stringify({
      code: 'EACCES',
      diagnostic: {
        token: 'private token with spaces\nsecond line',
        command: { program: 'git', args: ['fetch', 'https://name:word@host/repo'] },
      },
      cause: JSON.stringify({ passphrase: 'private passphrase', stage: 'keyring' }),
    }),
  );
  for (const secret of ['private token', 'second line', 'name:word', 'private passphrase'])
    expect(text).not.toContain(secret);
  expect(text).toContain('EACCES');
  expect(text).toContain('keyring');
  expect(text).toContain('host/repo');
});

it('redacta propiedades privadas recursivamente antes de notificar o persistir metadatos', () => {
  const value = redactLogValue({
    request: {
      client_secret: { text: 'private data' },
      authorization: 'custom arbitrary header',
      fileContents: 'private document',
      url: 'https://name:word@host/repo',
    },
    diagnostic: { stage: 'read_repository', exitCode: 128 },
  });
  expect(value).toMatchObject({
    request: {
      client_secret: '[redacted]',
      authorization: '[redacted]',
      fileContents: '[redacted]',
    },
    diagnostic: { stage: 'read_repository', exitCode: 128 },
  });
  expect(JSON.stringify(value)).not.toContain('private');
  expect(JSON.stringify(value)).not.toContain('custom arbitrary');
});

it('mantiene evidencia válida aunque haya ciclos, getters que fallan o datos enormes', () => {
  const cyclic: Record<string, unknown> = { stage: 'read_refs' };
  cyclic['cause'] = cyclic;
  Object.defineProperty(cyclic, 'broken', {
    enumerable: true,
    get: () => {
      throw new Error('unreadable');
    },
  });
  const value = redactLogValue({ cyclic, output: 'x'.repeat(15000) });
  expect(value).toMatchObject({
    cyclic: { stage: 'read_refs', cause: '[circular reference]', broken: '[unreadable property]' },
  });
  expect(JSON.stringify(value)).toContain('truncated');
  expect(JSON.stringify(value).length).toBeLessThan(14000);
});

it('el texto libre repetido por una API se elimina también de su representación escapada', () => {
  const privateText = 'confidential line\nwith "quotes"';
  const text = redactKnownLogValues(`failure ${privateText} ${JSON.stringify(privateText)}`, [
    privateText,
  ]);
  expect(text).not.toContain('confidential');
  expect(text).toContain('[redacted]');
});

it('marca los cortes sin quitar la evidencia anterior', () => {
  expect(boundLogText('fatal: missing object', 6)).toBe(
    'fatal:\n[truncated: 15 characters omitted]',
  );
});

it('limita bytes JSON serializados con Unicode y controles sin perder el error prioritario', () => {
  const requestData = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`field-${index}`, '\u0000\t\r\n🦑'.repeat(6000)]),
  );
  const safe = redactLogValue({
    requestData,
    error: {
      code: 'unknown',
      message: 'missing object',
      diagnostic: { stage: 'read_refs', stderr: 'fatal: object is corrupt' },
    },
  });
  expect(safe).toMatchObject({
    error: {
      message: 'missing object',
      diagnostic: { stage: 'read_refs', stderr: 'fatal: object is corrupt' },
    },
  });
  expect(new TextEncoder().encode(JSON.stringify(safe)).length).toBeLessThan(65536);
  expect(JSON.stringify(safe)).toContain('truncated');
});

it('limita el número de nodos de metadatos muy anidados y mantiene JSON válido', () => {
  const branch = () =>
    Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `n${index}`,
        Array.from({ length: 30 }, () => ({ count: 1, ok: true })),
      ]),
    );
  const safe = redactLogValue({
    requestData: { first: branch(), second: branch() },
    error: { code: 'unknown', message: 'I/O unavailable' },
  });
  const text = JSON.stringify(safe);
  expect(text).toContain('node limit');
  expect(new TextEncoder().encode(text).length).toBeLessThan(65536);
  expect(JSON.parse(text)).toMatchObject({ error: { message: 'I/O unavailable' } });
});

it('conserva correlación y paso nativo antes de errores enormes con parámetros y causas repetidas', () => {
  const correlation = {
    operationId: 'frontend:42',
    nativeOperationId: 'native-99',
    method: 'readRefs',
    phase: 'failure',
    startedAt: 1234,
    durationMs: 222,
    repository: '/repos/affected',
    errorCode: 'unknown',
  };
  const repeatedCause = { message: '\u0000\n🦑'.repeat(20000), code: 'EIO' };
  const safe = redactLogValue({
    error: {
      code: 'unknown',
      message: 'read failed',
      diagnostic: {
        stage: 'read_refs',
        stderr: '🦑'.repeat(12000),
        causes: [repeatedCause, repeatedCause],
      },
      params: { first: '\u0000'.repeat(20000), second: '\n'.repeat(20000) },
      cause: repeatedCause,
    },
    ...correlation,
  });
  expect(safe).toMatchObject({ ...correlation, error: { diagnostic: { stage: 'read_refs' } } });
  const text = JSON.stringify(safe);
  expect(new TextEncoder().encode(text).length).toBeLessThan(65536);
  expect(text).toContain('truncated');
});

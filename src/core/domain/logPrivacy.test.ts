import { expect, it } from 'vitest';
import { redactLogText } from './logPrivacy';

it('redacta credenciales sin ocultar la ruta ni el error de Git', () => {
  const text = redactLogText(
    'fatal https://name:password@host/repo?token=secret Authorization: Bearer eyJsecret password=word {"api_key":"key123"}',
  );
  expect(text).toContain('host/repo');
  for (const secret of ['name:password', 'eyJsecret', 'password=word', 'key123', 'token=secret'])
    expect(text).not.toContain(secret);
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

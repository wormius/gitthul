import { describe, expect, it } from 'vitest';

import { decodePreview } from './textDecoding';

describe('encoding previews', () => {
  it('distinguishes true Latin-1 and ASCII from the browser Windows-1252 aliases', () => {
    const bytes = Uint8Array.of(0x80, 0xe9);
    expect(decodePreview(bytes, 'iso-8859-1')).toEqual({ text: '\u0080é', errors: false });
    expect(decodePreview(bytes, 'windows-1252')).toEqual({ text: '€é', errors: false });
    expect(decodePreview(bytes, 'us-ascii')).toEqual({ text: '��', errors: true });
    expect(decodePreview(bytes, 'utf-8')).toEqual({ text: '��', errors: true });
  });

  it('decodes UTF-32 surrogate errors and truncated code points visibly', () => {
    expect(decodePreview(Uint8Array.of(0x41, 0, 0, 0, 0, 0xd8, 0, 0, 0xff), 'utf-32le')).toEqual({
      text: 'A��',
      errors: true,
    });
    expect(decodePreview(Uint8Array.of(0, 0, 0, 0x41), 'utf-32be')).toEqual({
      text: 'A',
      errors: false,
    });
  });
});

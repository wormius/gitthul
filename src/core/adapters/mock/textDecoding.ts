/** Byte previews for the mock adapter and gallery; native reads use encoding_rs. */
export function decodePreview(bytes: Uint8Array, name: string): { text: string; errors: boolean } {
  name = name.toLowerCase();
  if (name === 'windows-1252') {
    // Keep previews consistent even in Node builds that decode C1 bytes as Latin-1.
    const c1 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
    return {
      text: Array.from(bytes, (byte) =>
        byte >= 0x80 && byte <= 0x9f ? c1[byte - 0x80]! : String.fromCharCode(byte),
      ).join(''),
      errors: false,
    };
  }
  if (name === 'iso-8859-1' || name === 'us-ascii' || name === 'iso-8859-16') {
    const table =
      '\x80\x81\x82\x83\x84\x85\x86\x87\x88\x89\x8a\x8b\x8c\x8d\x8e\x8f\x90\x91\x92\x93\x94\x95\x96\x97\x98\x99\x9a\x9b\x9c\x9d\x9e\x9f\xa0ĄąŁ€„Š§š©Ș«Ź\xadźŻ°±ČłŽ”¶·žčș»ŒœŸżÀÁÂĂÄĆÆÇÈÉÊËÌÍÎÏĐŃÒÓÔŐÖŚŰÙÚÛÜĘȚßàáâăäćæçèéêëìíîïđńòóôőöśűùúûüęțÿ';
    return {
      text: Array.from(bytes, (byte) =>
        name === 'us-ascii' && byte > 127
          ? '�'
          : name === 'iso-8859-16' && byte > 127
            ? table[byte - 128]!
            : String.fromCharCode(byte),
      ).join(''),
      errors: name === 'us-ascii' && bytes.some((byte) => byte > 127),
    };
  }
  if (name === 'utf-32le' || name === 'utf-32be') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let text = '';
    let errors = false;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const code =
        offset + 4 <= bytes.length ? view.getUint32(offset, name === 'utf-32le') : 0xffffffff;
      const invalid = code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
      errors ||= invalid;
      text += invalid ? '�' : String.fromCodePoint(code);
    }
    return { text: text.replace(/^\uFEFF/, ''), errors };
  }
  let errors = false;
  try {
    new TextDecoder(name, { fatal: true }).decode(bytes);
  } catch {
    errors = true;
  }
  return { text: new TextDecoder(name).decode(bytes), errors };
}

export function reinterpretPreview(
  text: string,
  encoding?: string,
): { text: string; encoding: string; decodingErrors: boolean } {
  const name = !encoding || encoding === 'auto' ? 'utf-8' : encoding;
  const decoded = decodePreview(new TextEncoder().encode(text), name);
  return { text: decoded.text, encoding: name, decodingErrors: decoded.errors };
}

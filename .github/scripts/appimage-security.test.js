import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  libraries,
  noticePath,
  pin,
  sha256,
  squashfsOffset,
  verifyBrotli,
  verifyGlibcVersions,
  verifySource,
} from './appimage-security.js';

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitthul-brotli-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const app = path.join(temp, 'app');
  const prepared = path.join(temp, 'prepared');
  fs.mkdirSync(path.join(app, 'usr/lib'), { recursive: true });
  fs.mkdirSync(path.join(app, noticePath), { recursive: true });
  fs.mkdirSync(path.join(prepared, 'lib'), { recursive: true });
  const hashes = {};
  for (const name of libraries) {
    const bytes = Buffer.from(`fixed-library-${name}`);
    fs.writeFileSync(path.join(prepared, 'lib', name), bytes);
    fs.writeFileSync(path.join(app, 'usr/lib', name), bytes);
    hashes[name] = sha256(bytes);
  }
  // Exact upstream MIT notice, so this fixture also exercises the license pin.
  const license =
    'Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.\n';
  fs.writeFileSync(path.join(app, noticePath, 'LICENSE'), license);
  const manifest = {
    schemaVersion: 1,
    name: 'brotli',
    version: pin.version,
    runtimeVersion: pin.version,
    target: 'x86_64-unknown-linux-gnu',
    sourceUrl: pin.url,
    sourceSha256: pin.sha256,
    licenseSha256: pin.licenseSha256,
    libraries: hashes,
  };
  const save = () => {
    fs.writeFileSync(path.join(prepared, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(app, noticePath, 'manifest.json'), JSON.stringify(manifest));
  };
  save();
  return { app, prepared, manifest, save };
}

test('rejects substituted source bytes before extraction or build', () => {
  assert.throws(
    () => verifySource(Buffer.from('untrusted archive')),
    /source archive SHA-256 mismatch/,
  );
});

test('accepts exact built bytes and rejects an old library with the expected SONAME', (t) => {
  const f = fixture(t);
  assert.equal(verifyBrotli(f.app, f.prepared).version, pin.version);
  fs.writeFileSync(path.join(f.app, 'usr/lib/libbrotlidec.so.1'), 'old distro decoder');
  assert.throws(() => verifyBrotli(f.app, f.prepared), /Bundled Brotli bytes changed/);
});

test('rejects stale version or changed source even when manifests match', (t) => {
  const f = fixture(t);
  f.manifest.version = '1.0.9';
  f.save();
  assert.throws(() => verifyBrotli(f.app, f.prepared), /Unexpected Brotli version/);
  f.manifest.version = pin.version;
  f.manifest.sourceSha256 = '0'.repeat(64);
  f.save();
  assert.throws(() => verifyBrotli(f.app, f.prepared), /Unexpected Brotli source SHA-256/);
});

test('rejects a second decoder that could shadow the fixed library', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.app, 'usr/lib/other'));
  fs.writeFileSync(path.join(f.app, 'usr/lib/other/libbrotlidec.so.1'), 'old distro decoder');
  assert.throws(() => verifyBrotli(f.app, f.prepared), /Unexpected duplicate Brotli library/);
});

test('rejects a changed license or a symlink to an external decoder', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.app, noticePath, 'LICENSE'), 'wrong license');
  assert.throws(() => verifyBrotli(f.app, f.prepared));
  const g = fixture(t);
  const decoder = path.join(g.app, 'usr/lib/libbrotlidec.so.1');
  fs.unlinkSync(decoder);
  fs.symlinkSync(path.join(g.prepared, 'lib/libbrotlidec.so.1'), decoder);
  assert.throws(() => verifyBrotli(g.app, g.prepared), /must be a regular file/);
});

test('requires Ubuntu 22.04 GLIBC compatibility', () => {
  verifyGlibcVersions('GLIBC_2.2.5 GLIBC_2.34 GLIBC_2.35', 'fixture');
  assert.throws(() => verifyGlibcVersions('GLIBC_2.36', 'fixture'), /newer than GLIBC_2.35/);
  assert.throws(() => verifyGlibcVersions('GLIBC_2.35.1', 'fixture'), /newer than GLIBC_2.35/);
});

test('finds SquashFS after false magic and rejects truncated files', () => {
  const bytes = Buffer.alloc(256);
  bytes.write('hsqs', 8);
  bytes.write('hsqs', 128);
  bytes.writeUInt32LE(131072, 140);
  bytes.writeUInt16LE(4, 156);
  bytes.writeBigUInt64LE(128n, 168);
  assert.equal(squashfsOffset(bytes), 128);
  assert.throws(() => squashfsOffset(bytes.subarray(0, 240)), /Missing valid SquashFS/);
});

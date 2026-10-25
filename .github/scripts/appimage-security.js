import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const pin = JSON.parse(
  fs.readFileSync(path.join(root, '.github/appimage-brotli.json'), 'utf8'),
);
export const prefix = path.join(root, 'src-tauri/target/appimage-brotli');
export const libraries = ['libbrotlicommon.so.1', 'libbrotlidec.so.1', 'libbrotlienc.so.1'];
export const noticePath = 'usr/share/gitthul/brotli';

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function verifySource(bytes) {
  assert.equal(sha256(bytes), pin.sha256, 'Brotli source archive SHA-256 mismatch');
}

export function verifyManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, 'brotli');
  assert.equal(manifest.version, pin.version, 'Unexpected Brotli version');
  assert.equal(manifest.runtimeVersion, pin.version, 'Brotli runtime version was not verified');
  assert.equal(manifest.target, 'x86_64-unknown-linux-gnu', 'Unexpected Brotli target');
  assert.equal(manifest.sourceUrl, pin.url, 'Unexpected Brotli source');
  assert.equal(manifest.sourceSha256, pin.sha256, 'Unexpected Brotli source SHA-256');
  assert.equal(manifest.licenseSha256, pin.licenseSha256, 'Unexpected Brotli license');
  assert.deepEqual(Object.keys(manifest.libraries).sort(), [...libraries].sort());
  for (const digest of Object.values(manifest.libraries)) assert.match(digest, /^[a-f0-9]{64}$/);
}

export function verifyBrotli(appDir, expectedDir = prefix) {
  const expected = JSON.parse(fs.readFileSync(path.join(expectedDir, 'manifest.json'), 'utf8'));
  verifyManifest(expected);
  const bundled = JSON.parse(
    fs.readFileSync(path.join(appDir, noticePath, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(bundled, expected, 'Bundled Brotli provenance differs from this build');
  assert.equal(
    sha256(fs.readFileSync(path.join(appDir, noticePath, 'LICENSE'))),
    pin.licenseSha256,
  );
  for (const name of libraries) {
    const file = path.join(appDir, 'usr/lib', name);
    assert.ok(fs.lstatSync(file).isFile(), `Brotli library must be a regular file: ${name}`);
    assert.equal(
      sha256(fs.readFileSync(file)),
      expected.libraries[name],
      `Bundled Brotli bytes changed: ${name}`,
    );
    assert.equal(
      sha256(fs.readFileSync(path.join(expectedDir, 'lib', name))),
      expected.libraries[name],
      `Prepared Brotli bytes changed: ${name}`,
    );
  }
  for (const file of fs.readdirSync(appDir, { recursive: true })) {
    if (/^libbrotli(?:common|dec|enc)\.so(?:\.\d+)*$/.test(path.basename(file))) {
      assert.ok(
        libraries.some((name) => file === path.join('usr/lib', name)),
        `Unexpected duplicate Brotli library: ${file}`,
      );
    }
  }
  return expected;
}

export function verifyGlibcVersions(output, label) {
  for (const match of output.matchAll(/\bGLIBC_(\d+)\.(\d+)(?:\.(\d+))?\b/g)) {
    const [major, minor, patch = '0'] = match.slice(1);
    assert.ok(
      Number(major) < 2 ||
        (Number(major) === 2 &&
          (Number(minor) < 35 || (Number(minor) === 35 && Number(patch) === 0))),
      `${label} requires ${match[0]}, newer than GLIBC_2.35`,
    );
  }
}

export function verifyElfGlibc(file) {
  verifyGlibcVersions(
    execFileSync('readelf', ['--version-info', file], { encoding: 'utf8' }),
    file,
  );
}

// AppImage type 2 contains an ELF runtime followed by a SquashFS filesystem.
// Read the superblock instead of executing the application to extract it.
export function squashfsOffset(bytes, totalSize = bytes.length) {
  for (
    let offset = bytes.indexOf('hsqs');
    offset !== -1;
    offset = bytes.indexOf('hsqs', offset + 1)
  ) {
    if (offset + 96 > bytes.length) continue;
    const block = bytes.readUInt32LE(offset + 12);
    const used = Number(bytes.readBigUInt64LE(offset + 40));
    if (
      bytes.readUInt16LE(offset + 28) === 4 &&
      bytes.readUInt16LE(offset + 30) === 0 &&
      block >= 4096 &&
      block <= 1048576 &&
      (block & (block - 1)) === 0 &&
      used >= 96 &&
      offset + used <= totalSize
    )
      return offset;
  }
  throw new Error('Missing valid SquashFS 4.0 superblock in AppImage');
}

export function extractAppImage(image, destination) {
  const fd = fs.openSync(image, 'r');
  let offset;
  try {
    const bytes = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 4 * 1024 * 1024));
    fs.readSync(fd, bytes);
    offset = squashfsOffset(bytes, fs.fstatSync(fd).size);
  } finally {
    fs.closeSync(fd);
  }
  execFileSync(
    'unsquashfs',
    ['-no-progress', '-processors', '2', '-o', String(offset), '-d', destination, image],
    {
      stdio: 'pipe',
    },
  );
}

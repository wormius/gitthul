import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  libraries,
  pin,
  prefix,
  root,
  sha256,
  verifyElfGlibc,
  verifySource,
} from './appimage-security.js';

// Tauri invokes this hook on all platforms. Only AppImage needs private copies;
// DEB/RPM continue using the distribution's libraries and package updates.
if ((process.env.TAURI_ENV_PLATFORM || process.platform) === 'linux') {
  assert.equal(process.platform, 'linux', 'AppImage Brotli must be built on Linux');
  const target =
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    `${os.arch() === 'x64' ? 'x86_64' : os.arch()}-unknown-linux-gnu`;
  assert.equal(
    target,
    'x86_64-unknown-linux-gnu',
    'Only the supported Linux x64 target is certified for AppImage',
  );
  assert.equal(os.arch(), 'x64', 'Build Linux x64 AppImages on a Linux x64 host');
  const run = (command, args, options = {}) =>
    execFileSync(command, args, { stdio: 'inherit', ...options });
  const cache = path.join(path.dirname(prefix), 'appimage-brotli-cache');
  fs.mkdirSync(cache, { recursive: true });
  const archive =
    process.env.GITTHUL_BROTLI_ARCHIVE || path.join(cache, `brotli-${pin.version}.tar.gz`);
  if (!fs.existsSync(archive)) {
    assert.ok(!process.env.GITTHUL_BROTLI_ARCHIVE, 'GITTHUL_BROTLI_ARCHIVE does not exist');
    const download = `${archive}.download`;
    try {
      run('curl', [
        '--fail',
        '--location',
        '--proto',
        '=https',
        '--tlsv1.2',
        '--connect-timeout',
        '20',
        '--max-time',
        '180',
        pin.url,
        '--output',
        download,
      ]);
      verifySource(fs.readFileSync(download));
      fs.renameSync(download, archive);
    } finally {
      fs.rmSync(download, { force: true });
    }
  }
  verifySource(fs.readFileSync(archive));
  const work = fs.mkdtempSync(path.join(path.dirname(prefix), 'appimage-brotli-build-'));
  try {
    const source = path.join(work, 'source');
    const build = path.join(work, 'build');
    const ready = path.join(work, 'ready');
    const lib = path.join(ready, 'lib');
    fs.mkdirSync(source);
    fs.mkdirSync(lib, { recursive: true });
    run('tar', ['-xzf', path.resolve(archive), '--strip-components=1', '-C', source]);
    assert.equal(sha256(fs.readFileSync(path.join(source, 'LICENSE'))), pin.licenseSha256);
    run('cmake', [
      '-S',
      source,
      '-B',
      build,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_C_FLAGS_RELEASE=-O2 -DNDEBUG -fstack-protector-strong -D_FORTIFY_SOURCE=2',
      '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,relro,-z,now',
      '-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON',
      '-DCMAKE_INSTALL_RPATH=$ORIGIN',
    ]);
    run('cmake', [
      '--build',
      build,
      '--parallel',
      '2',
      '--target',
      'brotlicommon',
      'brotlidec',
      'brotlienc',
    ]);
    const hashes = {};
    for (const name of libraries) {
      const file = path.join(lib, name);
      fs.copyFileSync(fs.realpathSync(path.join(build, name)), file);
      run('strip', ['--strip-unneeded', file]);
      // linuxdeploy retains existing files and skips strip for $ORIGIN RPATHs.
      // Its repeated --set-rpath is a no-op; inventory verifies every byte.
      run('patchelf', ['--set-rpath', '$ORIGIN', file]);
      verifyElfGlibc(file);
      hashes[name] = sha256(fs.readFileSync(file));
    }
    const probe = path.join(ready, 'probe');
    const probeSource = path.join(root, '.github/scripts/brotli-probe.c');
    run('cc', [
      probeSource,
      '-I',
      path.join(source, 'c/include'),
      '-L',
      lib,
      '-Wl,-rpath,$ORIGIN/lib',
      '-o',
      probe,
      '-l:libbrotlienc.so.1',
      '-l:libbrotlidec.so.1',
      '-l:libbrotlicommon.so.1',
    ]);
    const env = { ...process.env, LD_LIBRARY_PATH: lib };
    delete env.LD_PRELOAD;
    const runtimeVersion = execFileSync(probe, [], { encoding: 'utf8', env }).trim();
    assert.equal(runtimeVersion, pin.version, 'Unexpected linked Brotli runtime version');
    fs.copyFileSync(path.join(source, 'LICENSE'), path.join(ready, 'LICENSE'));
    const manifest = {
      schemaVersion: 1,
      name: 'brotli',
      version: pin.version,
      runtimeVersion,
      target,
      sourceUrl: pin.url,
      sourceSha256: pin.sha256,
      licenseSha256: pin.licenseSha256,
      libraries: hashes,
    };
    fs.writeFileSync(path.join(ready, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.rmSync(prefix, { recursive: true, force: true });
    fs.renameSync(ready, prefix);
    console.log(
      `Prepared Brotli ${pin.version}: verified source, shared-library version, round trip and GLIBC <= 2.35.`,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

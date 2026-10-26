import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  extractAppImage,
  libraries,
  noticePath,
  pin,
  root,
  sha256,
  verifyBrotli,
  verifyElfGlibc,
} from './appimage-security.js';

const image = path.resolve(process.argv[2] || '');
assert.ok(
  process.argv[2] && image.endsWith('.AppImage'),
  'Usage: node .github/scripts/inventory-appimage.js path/to/GitThul.AppImage',
);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitthul-appimage-'));
try {
  const appDir = path.join(temp, 'appdir');
  const noticeDir = path.join(temp, 'system-notices');
  fs.mkdirSync(noticeDir);
  extractAppImage(image, appDir);
  const brotli = verifyBrotli(appDir);
  const installed = new Map(
    execFileSync(
      'dpkg-query',
      ['-W', '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n'],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .map((line) => {
        const [name, version, source, sourceVersion] = line.split('\t');
        return [name, { name, version, source, sourceVersion }];
      }),
  );
  const report = {
    image: path.basename(image),
    sha256: sha256(fs.readFileSync(image)),
    libraries: [],
    packages: [],
    sourceBuilds: [brotli],
    unmapped: [],
    reviewRequired: true,
  };
  const packages = new Set();
  let elfCount = 0;
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) {
        const fd = fs.openSync(file, 'r');
        const magic = Buffer.alloc(4);
        try {
          fs.readSync(fd, magic);
        } finally {
          fs.closeSync(fd);
        }
        if (magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
          verifyElfGlibc(file);
          elfCount++;
        }
        if (!/\.so(?:\.\d+)*$/.test(item.name)) continue;
        const relative = path.relative(appDir, file);
        // These are built from the pinned upstream archive, never the distro's
        // libbrotli1 package even though both export the same SONAME.
        if (libraries.includes(item.name)) {
          report.libraries.push({
            path: relative,
            packages: [],
            sourceBuild: `brotli@${pin.version}`,
            sha256: brotli.libraries[item.name],
          });
          continue;
        }
        let owners = [];
        try {
          const matches = execFileSync('dpkg-query', ['-S', `*/${item.name}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          owners = [
            ...new Set(
              matches
                .trim()
                .split('\n')
                .flatMap((line) => line.split(': /')[0].split(', '))
                .filter((name) => installed.has(name)),
            ),
          ];
        } catch {
          /* Unmapped files remain explicit for release review. */
        }
        report.libraries.push({ path: relative, packages: owners });
        if (!owners.length) report.unmapped.push(relative);
        for (const owner of owners) packages.add(owner);
      }
    }
  }
  walk(appDir);
  const files = fs.readdirSync(appDir, { recursive: true });
  assert.ok(
    !files.some((file) => /(?:^|\/)libwayland-client\.so(?:\.\d+)*$/.test(file)),
    'Bundled Wayland client breaks EGL on newer Mesa',
  );
  const gtkHook = fs.readFileSync(
    path.join(appDir, 'apprun-hooks/linuxdeploy-plugin-gtk.sh'),
    'utf8',
  );
  assert.doesNotMatch(
    gtkHook,
    /^\s*export\s+GDK_BACKEND=/m,
    'AppImage must respect the session display backend',
  );
  const gioPath = gtkHook.match(/^\s*export\s+GIO_MODULE_DIR="\$APPDIR\/([^"]+)"/m)?.[1];
  assert.ok(gioPath, 'AppImage must isolate its GIO modules from host GLib');
  const gioDir = path.join(appDir, gioPath.replace(/^\/+/, ''));
  assert.ok(
    fs.readdirSync(gioDir).some((name) => name.endsWith('.so')),
    'Missing bundled GIO modules',
  );
  assert.ok(
    fs.statSync(path.join(appDir, 'usr/lib/gtk-3.0/modules/libcanberra-gtk-module.so')).isFile(),
    'Missing GTK sound module',
  );
  for (const name of [...packages].sort()) {
    assert.ok(
      !name.startsWith('libbrotli'),
      'Pinned Brotli cannot be attributed to an Ubuntu package',
    );
    const pkg = installed.get(name);
    const copyright = path.join('/usr/share/doc', name.split(':')[0], 'copyright');
    const target = path.join(noticeDir, name.replaceAll(':', '_'));
    fs.mkdirSync(target);
    if (fs.existsSync(copyright)) fs.copyFileSync(copyright, path.join(target, 'copyright.txt'));
    else report.unmapped.push(`Missing copyright: ${name}`);
    report.packages.push({
      ...pkg,
      sourceUrl: `https://launchpad.net/ubuntu/+source/${pkg.source}/${pkg.sourceVersion}`,
    });
  }
  fs.cpSync(path.join(appDir, noticePath), path.join(noticeDir, `brotli-${pin.version}`), {
    recursive: true,
  });
  fs.cpSync('/usr/share/common-licenses', path.join(noticeDir, 'common-licenses'), {
    recursive: true,
    dereference: true,
  });
  fs.writeFileSync(path.join(noticeDir, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(
    path.join(noticeDir, 'README.txt'),
    'Notices for libraries in this AppImage. sourceBuilds records pinned upstream sources and exact library SHA-256 values verified against this build; these entries are not distribution packages. Other libraries are mapped to the build runner packages. Review unmapped entries and source availability before publishing. This inventory does not include every possible bundled executable or static component.\n',
  );
  const archive = path.join(
    path.dirname(image),
    `GitThul_${version}_linux-x64-system-notices.tar.gz`,
  );
  execFileSync('tar', ['-czf', archive, '-C', temp, 'system-notices']);
  const summary = `AppImage: Brotli ${pin.version} bytes and provenance verified; ${elfCount} ELF files require GLIBC <= 2.35; ${report.libraries.length} library files; ${report.packages.length} system packages; ${report.unmapped.length} entries require review. Notices: ${path.basename(archive)}.\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const { version } = createRequire(import.meta.url)('./package.json') as { version: string };

// El puerto es fijo porque `tauri dev` apunta a él desde tauri.conf.json.
const DEV_PORT = 5183;

const WOFF_FALLBACK = /,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g;

/**
 * Quita el respaldo .woff de las fuentes empaquetadas.
 *
 * @fontsource declara woff2 y woff; los tres motores que usa Tauri 2 —
 * WebKitGTK, WKWebView y WebView2 — soportan woff2 desde hace años, así que el
 * respaldo es un megabyte de archivos que nadie va a pedir nunca. Va como plugin
 * de PostCSS y no de Vite porque los @import de fonts.css se incorporan dentro
 * de la cadena de PostCSS: un `transform` de Vite nunca llega a verlos.
 */
const woff2Only = {
  postcssPlugin: 'gitthul:woff2-only',
  Declaration: {
    src: (declaration: { value: string }) => {
      declaration.value = declaration.value.replace(WOFF_FALLBACK, '');
    },
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  css: {
    postcss: { plugins: [woff2Only] },
  },

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  resolve: {
    alias: {
      '@app': resolvePath('./src/app'),
      '@design': resolvePath('./src/design'),
      '@ui': resolvePath('./src/ui'),
      '@features': resolvePath('./src/features'),
      '@core': resolvePath('./src/core'),
      '@i18n': resolvePath('./src/i18n'),
    },
  },

  // Tauri espera un servidor fijo y falla ruidosamente en vez de cambiar de puerto.
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: process.env['TAURI_DEV_HOST'] ?? false,
    hmr: process.env['TAURI_DEV_HOST']
      ? { protocol: 'ws', host: process.env['TAURI_DEV_HOST'], port: DEV_PORT + 1 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },

  // Tauri 2 usa WebKit en Linux/macOS y WebView2 en Windows.
  build: {
    target: process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari15',
    minify: process.env['TAURI_ENV_DEBUG'] ? false : 'esbuild',
    sourcemap: Boolean(process.env['TAURI_ENV_DEBUG']),
  },

  test: {
    // Los recorridos de App incluyen varias interacciones y un DOM virtualizado.
    testTimeout: 15_000,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
    },
  },
});

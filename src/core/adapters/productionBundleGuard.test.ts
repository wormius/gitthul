import type { OutputBundle, PluginContext } from 'rollup';
import { describe, expect, it } from 'vitest';

import { productionBundleGuard } from './productionBundleGuard';

async function inspect(modules: Record<string, { renderedLength: number }>) {
  const hook = productionBundleGuard().generateBundle;
  if (typeof hook !== 'function') throw new Error('Expected a generateBundle function');
  const context = {
    error(message: string) {
      throw new Error(message);
    },
  } as PluginContext;
  const bundle = {
    'lazy.js': { type: 'chunk', modules },
    'image.svg': { type: 'asset' },
  } as unknown as OutputBundle;
  await hook.call(context, {} as never, bundle, false);
}

describe('production module graph guard', () => {
  it.each([
    '/repo/src/core/adapters/mock/mockGitPort.ts',
    'C:\\repo\\src\\ui\\gallery\\TokensGallery.tsx',
  ])('rejects rendered development code even inside a separate chunk: %s', async (module) => {
    await expect(inspect({ [module]: { renderedLength: 1 } })).rejects.toThrow(module);
  });

  it('allows native modules and development imports completely removed by tree shaking', async () => {
    await expect(
      inspect({
        '/repo/src/core/adapters/tauri/tauriGitPort.ts': { renderedLength: 500 },
        '/repo/src/core/adapters/mock/mockGitPort.ts': { renderedLength: 0 },
      }),
    ).resolves.toBeUndefined();
  });
});

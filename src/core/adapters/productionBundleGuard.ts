import type { Plugin } from 'vite';

/** Check Rollup's rendered module graph, rather than matching minified text. */
export function productionBundleGuard(): Plugin {
  return {
    name: 'gitthul:production-adapters',
    apply: 'build',
    generateBundle(_options, bundle) {
      const forbidden = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(output.modules)) {
          if (
            module.renderedLength > 0 &&
            /\/src\/(?:core\/adapters\/mock|ui\/gallery)\//.test(id.replaceAll('\\', '/'))
          ) {
            forbidden.add(id);
          }
        }
      }
      if (forbidden.size > 0) {
        this.error(
          `Development modules reached the production bundle:\n${[...forbidden].join('\n')}`,
        );
      }
    },
  };
}

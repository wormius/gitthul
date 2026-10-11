import type { LinkPort, ReleaseCheck } from '@core/ports/LinkPort';

type OpenUrl = (url: string) => Promise<void>;

const tauriOpenUrl: OpenUrl = async (url) => {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
};

function safeExternalUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Dirección externa no permitida');
  }
  return url.href;
}

/** Abre HTTP(S) en el navegador del sistema; la ventana de GitThul nunca navega. */
export function createTauriLinkPort(
  openUrl: OpenUrl = tauriOpenUrl,
  call: (command: string, args: Record<string, unknown>) => Promise<unknown> = async (
    command,
    args,
  ) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  },
): LinkPort {
  return {
    openExternal: async (url) => openUrl(safeExternalUrl(url)),
    checkRelease: async () => {
      return (await call('releases_check', {})) as ReleaseCheck;
    },
  };
}

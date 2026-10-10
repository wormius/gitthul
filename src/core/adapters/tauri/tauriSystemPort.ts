import { open } from '@tauri-apps/plugin-dialog';

import type { SystemPort } from '@core/ports/SystemPort';

interface DirectoryDialogOptions {
  title?: string;
  defaultPath?: string;
  directory: true;
  multiple: false;
}

type PickDirectory = (
  options: DirectoryDialogOptions,
) => Promise<string | readonly string[] | null>;
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriPickDirectory: PickDirectory = (options) => open(options);

async function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

/** Acceso nativo a carpetas y portapapeles, aislado de React detrás de `SystemPort`. */
export function createTauriSystemPort(
  pick: PickDirectory = tauriPickDirectory,
  call: Invoke = tauriInvoke,
): SystemPort {
  return {
    pickFile: async (options) => {
      const selected = await open({
        directory: false,
        multiple: false,
        ...(options?.title ? { title: options.title } : {}),
      });
      return typeof selected === 'string' ? selected : null;
    },
    pickDirectory: async (options) => {
      const selected = await pick({
        directory: true,
        multiple: false,
        ...(options?.title === undefined ? {} : { title: options.title }),
        ...(options?.startAt === undefined ? {} : { defaultPath: options.startAt }),
      });

      if (selected === null || typeof selected === 'string') return selected;

      return selected[0] ?? null;
    },
    revealPath: async (path) => {
      await call('system_open_directory', { path });
    },
    resolveChildPath: async (parent, child) =>
      (await call('system_resolve_child_path', { parent, child })) as string,
    writeClipboardText: async (text) => {
      await call('plugin:clipboard-manager|write_text', { text });
    },
    readClipboardText: async () => (await call('plugin:clipboard-manager|read_text')) as string,
  };
}

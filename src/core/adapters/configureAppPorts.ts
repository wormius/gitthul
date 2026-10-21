import type { SettingsPort } from '@core/ports/SettingsPort';

import type { AppPorts } from './appPorts';
import { coalesceSettingsWrites } from './coalesceSettings';
import { instrumentAppPort } from './instrumentAppPort';
import { instrumentGitPort } from './instrumentGitPort';

/** Common settings serialization and diagnostics for an explicit set of adapters. */
export function configureAppPorts(raw: AppPorts): AppPorts {
  const { log } = raw;
  const settings = coalesceSettingsWrites(raw.settings, {
    onError: (error) => {
      log.write('error', 'settings', 'no se pudieron guardar los ajustes', String(error));
    },
  });
  const settingsPort: SettingsPort = {
    read: async () => {
      const value = await settings.read();
      log.setDebugEnabled(value.logging.debugEnabled);
      return value;
    },
    patch: async (patch, options) => {
      await settings.patch(patch, options);
      if (patch.logging) {
        await settings.flush();
        const enabled = (await settings.read()).logging.debugEnabled;
        log.setDebugEnabled(enabled);
        log.write('info', 'logging', enabled ? 'Modo debug activado' : 'Modo normal activado');
      }
    },
    flush: settings.flush,
  };

  return {
    ...raw,
    git: instrumentGitPort(raw.git, log),
    auth: instrumentAppPort(raw.auth, 'auth', log),
    keyring: instrumentAppPort(raw.keyring, 'keyring', log),
    session: instrumentAppPort(raw.session, 'session', log),
    recovery: instrumentAppPort(raw.recovery, 'recovery', log),
    backup: instrumentAppPort(raw.backup, 'backup', log),
    settings: instrumentAppPort(settingsPort, 'settings', log),
    library: instrumentAppPort(raw.library, 'library', log),
    system: instrumentAppPort(raw.system, 'system', log),
    link: instrumentAppPort(raw.link, 'link', log),
    terminal: instrumentAppPort(raw.terminal, 'terminal', log),
  };
}

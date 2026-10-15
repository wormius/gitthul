import type { AppPorts } from '../appPorts';
import { configureAppPorts } from '../configureAppPorts';
import { errorDetail, errorDiagnostic } from '../logOperation';

import { createTauriAuthPort } from './tauriAuthPort';
import { createTauriBackupPort } from './tauriBackupPort';
import { createTauriGitPort } from './tauriGitPort';
import { createTauriKeyringPort } from './tauriKeyringPort';
import { createTauriLibraryPort } from './tauriLibraryPort';
import { createTauriLinkPort } from './tauriLinkPort';
import { createTauriLogPort } from './tauriLogPort';
import { createTauriRecoveryPort } from './tauriRecoveryPort';
import { createTauriSessionPort } from './tauriSessionPort';
import { createTauriSettingsPort } from './tauriSettingsPort';
import { createTauriSystemPort } from './tauriSystemPort';
import { createTauriTerminalPort } from './tauriTerminalPort';

export function createTauriAppPorts(): AppPorts {
  const log = createTauriLogPort();
  return configureAppPorts({
    auth: createTauriAuthPort(),
    backup: createTauriBackupPort(),
    git: createTauriGitPort(),
    keyring: createTauriKeyringPort(),
    library: createTauriLibraryPort(),
    link: createTauriLinkPort(),
    log,
    recovery: createTauriRecoveryPort(),
    session: createTauriSessionPort(),
    settings: createTauriSettingsPort((error) => {
      log.write(
        'error',
        'settings',
        'No se pudieron leer los ajustes; se arranca con una configuración segura',
        errorDetail(error),
        {
          method: 'settings.read',
          phase: 'failure',
          error: errorDiagnostic(error),
          resultData: { defaults: true, recoveryCleanup: false, backups: false },
        },
      );
    }),
    system: createTauriSystemPort(),
    terminal: createTauriTerminalPort(),
  });
}

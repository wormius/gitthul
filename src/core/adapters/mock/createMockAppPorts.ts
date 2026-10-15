import type { AppPorts } from '../appPorts';
import { configureAppPorts } from '../configureAppPorts';

import { createMockAuthPort } from './mockAuthPort';
import { createMockBackupPort } from './mockBackupPort';
import { createMockGitPort } from './mockGitPort';
import { createMockKeyringPort } from './mockKeyringPort';
import { createMockLibraryPort, localLibraryStorage } from './mockLibraryPort';
import { createMockLinkPort } from './mockLinkPort';
import { createMockLogPort } from './mockLogPort';
import { createMockRecoveryPort } from './mockRecoveryPort';
import { createMockSessionPort, localSessionStorage } from './mockSessionPort';
import { createMockSettingsPort, localSettingsStorage } from './mockSettingsPort';
import { createMockSystemPort } from './mockSystemPort';
import { createMockTerminalPort } from './mockTerminalPort';

/** Development and test adapters; this module is excluded from production builds. */
export function createMockAppPorts(): AppPorts {
  return configureAppPorts({
    auth: createMockAuthPort(),
    backup: createMockBackupPort(),
    git: createMockGitPort(),
    keyring: createMockKeyringPort(),
    library: createMockLibraryPort({ storage: localLibraryStorage() }),
    link: createMockLinkPort(),
    log: createMockLogPort(),
    recovery: createMockRecoveryPort(),
    session: createMockSessionPort({ storage: localSessionStorage() }),
    settings: createMockSettingsPort({ storage: localSettingsStorage() }),
    system: createMockSystemPort(),
    terminal: createMockTerminalPort({ lineDelay: { min: 30, max: 80 } }),
  });
}

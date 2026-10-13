import type { AuthPort } from '@core/ports/AuthPort';
import { createTauriAuthPort } from './tauri/tauriAuthPort';
import { createMockAuthPort } from './mock/mockAuthPort';
import type { GitPort } from '@core/ports/GitPort';
import type { KeyringPort } from '@core/ports/KeyringPort';
import type { LibraryPort } from '@core/ports/LibraryPort';
import type { LinkPort } from '@core/ports/LinkPort';
import type { LogPort } from '@core/ports/LogPort';
import type { SettingsPort } from '@core/ports/SettingsPort';
import type { SessionPort } from '@core/ports/SessionPort';
import type { RecoveryPort } from '@core/ports/RecoveryPort';
import type { BackupPort } from '@core/ports/BackupPort';
import type { SystemPort } from '@core/ports/SystemPort';
import type { TerminalPort } from '@core/ports/TerminalPort';

import { coalesceSettingsWrites } from './coalesceSettings';
import { instrumentAppPort } from './instrumentAppPort';
import { instrumentGitPort } from './instrumentGitPort';
import { createMockGitPort } from './mock/mockGitPort';
import { createMockKeyringPort } from './mock/mockKeyringPort';
import { createMockLibraryPort, localLibraryStorage } from './mock/mockLibraryPort';
import { createMockLinkPort } from './mock/mockLinkPort';
import { createMockLogPort } from './mock/mockLogPort';
import { createMockSettingsPort, localSettingsStorage } from './mock/mockSettingsPort';
import { createMockSessionPort, localSessionStorage } from './mock/mockSessionPort';
import { createMockRecoveryPort } from './mock/mockRecoveryPort';
import { createMockBackupPort } from './mock/mockBackupPort';
import { createMockSystemPort } from './mock/mockSystemPort';
import { createMockTerminalPort } from './mock/mockTerminalPort';
import { isTauri } from './tauri/isTauri';
import { createTauriGitPort } from './tauri/tauriGitPort';
import { createTauriKeyringPort } from './tauri/tauriKeyringPort';
import { createTauriLinkPort } from './tauri/tauriLinkPort';
import { createTauriLibraryPort } from './tauri/tauriLibraryPort';
import { createTauriLogPort } from './tauri/tauriLogPort';
import { createTauriSettingsPort } from './tauri/tauriSettingsPort';
import { createTauriSessionPort } from './tauri/tauriSessionPort';
import { createTauriRecoveryPort } from './tauri/tauriRecoveryPort';
import { createTauriBackupPort } from './tauri/tauriBackupPort';
import { createTauriSystemPort } from './tauri/tauriSystemPort';
import { createTauriTerminalPort } from './tauri/tauriTerminalPort';

/**
 * Los puertos de la aplicación, resueltos según dónde corre la ventana.
 *
 * Es el único sitio del proyecto que decide entre lo falso y lo real. La
 * interfaz recibe siempre la interfaz del puerto y nunca sabe cuál le tocó, que
 * es lo que permite que el bloque 2 sustituya cada adaptador sin tocar un solo
 * componente.
 */
export interface AppPorts {
  auth: AuthPort;
  link: LinkPort;
  settings: SettingsPort;
  session: SessionPort;
  recovery: RecoveryPort;
  backup: BackupPort;
  keyring: KeyringPort;
  log: LogPort;
  git: GitPort;
  system: SystemPort;
  library: LibraryPort;
  terminal: TerminalPort;
}

export function selectPorts(): AppPorts {
  const tauri = isTauri();
  const log = tauri ? createTauriLogPort() : createMockLogPort();
  const mockGit = createMockGitPort();

  const settings = coalesceSettingsWrites(
    tauri ? createTauriSettingsPort() : createMockSettingsPort({ storage: localSettingsStorage() }),
    {
      onError: (error) => {
        log.write('error', 'settings', 'no se pudieron guardar los ajustes', String(error));
      },
    },
  );

  /*
   * El adaptador Git nativo ya posee el ciclo de vida de los repositorios. P2
   * sustituirá sus lecturas de contenido; hasta entonces esas operaciones se
   * conservan en el mock sin que ninguna vista conozca la transición.
   */
  const git = instrumentGitPort(tauri ? createTauriGitPort(mockGit) : mockGit, log);

  const settingsPort: SettingsPort = {
    read: async () => {
      const value = await settings.read();
      log.setDebugEnabled(value.logging.debugEnabled);
      return value;
    },
    patch: async (patch) => {
      await settings.patch(patch);
      if (patch.logging) {
        await settings.flush();
        const enabled = (await settings.read()).logging.debugEnabled;
        log.setDebugEnabled(enabled);
        log.write('info', 'logging', enabled ? 'Modo debug activado' : 'Modo normal activado');
      }
    },
    flush: settings.flush,
  };

  const ports: AppPorts = {
    auth: tauri ? createTauriAuthPort() : createMockAuthPort(),
    log,
    settings: settingsPort,
    session: tauri
      ? createTauriSessionPort()
      : createMockSessionPort({ storage: localSessionStorage() }),
    recovery: tauri ? createTauriRecoveryPort() : createMockRecoveryPort(),
    backup: tauri ? createTauriBackupPort() : createMockBackupPort(),
    keyring: tauri ? createTauriKeyringPort() : createMockKeyringPort(),
    git,
    system: tauri ? createTauriSystemPort() : createMockSystemPort(),
    terminal: tauri
      ? createTauriTerminalPort()
      : createMockTerminalPort({ lineDelay: { min: 30, max: 80 } }),
    library: tauri
      ? createTauriLibraryPort()
      : createMockLibraryPort({ storage: localLibraryStorage() }),
    link: tauri ? createTauriLinkPort() : createMockLinkPort(),
  };
  return {
    ...ports,
    auth: instrumentAppPort(ports.auth, 'auth', log),
    keyring: instrumentAppPort(ports.keyring, 'keyring', log),
    session: instrumentAppPort(ports.session, 'session', log),
    recovery: instrumentAppPort(ports.recovery, 'recovery', log),
    backup: instrumentAppPort(ports.backup, 'backup', log),
    settings: instrumentAppPort(ports.settings, 'settings', log),
    library: instrumentAppPort(ports.library, 'library', log),
    system: instrumentAppPort(ports.system, 'system', log),
    link: instrumentAppPort(ports.link, 'link', log),
    terminal: instrumentAppPort(ports.terminal, 'terminal', log),
  };
}

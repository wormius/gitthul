import type { AuthPort } from '@core/ports/AuthPort';
import type { BackupPort } from '@core/ports/BackupPort';
import type { GitPort } from '@core/ports/GitPort';
import type { KeyringPort } from '@core/ports/KeyringPort';
import type { LibraryPort } from '@core/ports/LibraryPort';
import type { LinkPort } from '@core/ports/LinkPort';
import type { LogPort } from '@core/ports/LogPort';
import type { RecoveryPort } from '@core/ports/RecoveryPort';
import type { SessionPort } from '@core/ports/SessionPort';
import type { SettingsPort } from '@core/ports/SettingsPort';
import type { SystemPort } from '@core/ports/SystemPort';
import type { TerminalPort } from '@core/ports/TerminalPort';

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

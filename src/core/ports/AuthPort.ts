import type { RepoId } from '@core/domain/repository';

export interface SshKey {
  id: string;
  alias: string;
  path: string;
  publicKey: string;
}
export interface RemoteAccess {
  url: string;
  method: 'system' | 'https' | 'ssh';
  username: string;
  keyId: string;
}
export interface AuthChallenge {
  id: string;
  operationId: string;
  repository: string;
  url: string;
  kind: 'https' | 'ssh' | 'passphrase' | 'host';
  prompt: string;
  username: string;
}
export interface AuthAnswer {
  username: string;
  secret: string;
  remember: boolean;
}
export interface AuthPort {
  subscribe: (
    listener: (request: AuthChallenge | { dismiss: string } | { storageError: true }) => void,
  ) => Promise<() => void>;
  answer: (id: string, answer: AuthAnswer | null) => Promise<void>;
  listKeys: () => Promise<readonly SshKey[]>;
  importKey: (alias: string, path: string) => Promise<SshKey>;
  generateKey: (alias: string, passphrase: string) => Promise<SshKey>;
  removeKey: (id: string) => Promise<void>;
  readAccess: (repository: RepoId, url: string) => Promise<RemoteAccess>;
  saveAccess: (repository: RepoId, access: RemoteAccess, secret?: string) => Promise<void>;
  forgetAccess: (repository: RepoId, url: string) => Promise<void>;
}

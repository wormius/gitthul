import type { AuthPort, RemoteAccess, SshKey } from '@core/ports/AuthPort';

export function createMockAuthPort(): AuthPort {
  let keys: SshKey[] = [];
  const accesses = new Map<string, RemoteAccess>();
  return {
    subscribe: () => Promise.resolve(() => undefined),
    answer: () => Promise.resolve(),
    listKeys: () => Promise.resolve(keys),
    importKey: (alias, path) => {
      const key = { id: crypto.randomUUID(), alias, path, publicKey: 'ssh-ed25519 MOCK GitThul' };
      keys = [...keys, key];
      return Promise.resolve(key);
    },
    generateKey: (alias) => {
      const key = {
        id: crypto.randomUUID(),
        alias,
        path: `/mock/ssh/${alias}`,
        publicKey: 'ssh-ed25519 MOCK GitThul',
      };
      keys = [...keys, key];
      return Promise.resolve(key);
    },
    removeKey: (id) => {
      keys = keys.filter((key) => key.id !== id);
      return Promise.resolve();
    },
    readAccess: (repo, url) =>
      Promise.resolve(
        accesses.get(`${repo}\0${url}`) ?? { url, method: 'system', username: '', keyId: '' },
      ),
    saveAccess: (repo, access) => {
      accesses.set(`${repo}\0${access.url}`, access);
      return Promise.resolve();
    },
    forgetAccess: (repo, url) => {
      accesses.delete(`${repo}\0${url}`);
      return Promise.resolve();
    },
  };
}

import { useEffect, useState } from 'react';
import { usePorts } from '@app/PortsContext';
import type { RepoId } from '@core/domain/repository';
import type { RemoteAccess, SshKey } from '@core/ports/AuthPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';
import { Select } from '@ui/Select';
import styles from '../settings/CredentialAccounts.module.css';

export function RemoteAccessPanel({ repoId, url }: { repoId: RepoId; url: string }) {
  const { auth, keyring } = usePorts();
  const { t } = useI18n();
  const [access, setAccess] = useState<RemoteAccess | null>(null);
  const [keys, setKeys] = useState<readonly SshKey[]>([]);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [canRemember, setCanRemember] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([auth.readAccess(repoId, url), auth.listKeys(), keyring.isAvailable()]).then(
      ([access, keys, available]) => {
        if (active) {
          setAccess(access);
          setKeys(keys);
          setCanRemember(available);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [auth, keyring, repoId, url]);
  const https = url.startsWith('https://');
  const ssh = url.startsWith('ssh://') || /^[^/@\s]+@[^/:\s]+:/.test(url);
  const save = async (forget = false) => {
    if (!access || busy) return;
    setBusy(true);
    setFailed(false);
    setSaved(false);
    try {
      if (forget || access.method === 'system') await auth.forgetAccess(repoId, url);
      else await auth.saveAccess(repoId, { ...access, url }, secret || undefined);
      setAccess(await auth.readAccess(repoId, url));
      setSecret('');
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (!https && !ssh) return null;
  return (
    <section className={styles.form} aria-label={`${t('access.title')}: ${url}`}>
      <strong>{t('access.title')}</strong>
      <span className={styles.cardBody}>{url}</span>
      {access && (
        <>
          <Select
            label={t('access.method')}
            value={access.method}
            disabled={busy}
            onChange={(e) => {
              setAccess({ ...access, method: e.target.value as RemoteAccess['method'] });
              setSaved(false);
            }}
            options={[
              { value: 'system', label: t('access.system') },
              ...(https ? [{ value: 'https', label: t('access.https') }] : []),
              ...(ssh ? [{ value: 'ssh', label: t('access.ssh') }] : []),
            ]}
          />
          {access.method === 'https' && (
            <>
              <Input
                label={t('access.username')}
                value={access.username}
                disabled={busy}
                onChange={(e) => {
                  setAccess({ ...access, username: e.target.value });
                  setSaved(false);
                }}
              />
              <Input
                type="password"
                autoComplete="new-password"
                label={t('access.token')}
                hint={t('access.replaceHint')}
                value={secret}
                disabled={busy}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setSaved(false);
                }}
              />
              {!canRemember && <p>{t('access.noKeyring')}</p>}
            </>
          )}
          {access.method === 'ssh' && (
            <Select
              label={t('access.key')}
              value={access.keyId}
              disabled={busy}
              onChange={(e) => {
                setAccess({ ...access, keyId: e.target.value });
                setSaved(false);
              }}
              options={[
                { value: '', label: t('access.chooseKey') },
                ...keys.map((key) => ({ value: key.id, label: key.alias })),
              ]}
            />
          )}
          <div className={styles.actions}>
            <Button
              disabled={
                busy ||
                (access.method === 'https' && (!canRemember || !access.username.trim())) ||
                (access.method === 'ssh' && !access.keyId)
              }
              onClick={() => {
                void save();
              }}
            >
              {t('access.save')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void save(true);
              }}
            >
              {t('access.forget')}
            </Button>
          </div>
          {saved && <p role="status">{t('access.saved')}</p>}
        </>
      )}
      {failed && <p role="alert">{t('access.error')}</p>}
    </section>
  );
}

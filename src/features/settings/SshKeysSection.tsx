import { useEffect, useState } from 'react';
import { usePorts } from '@app/PortsContext';
import type { SshKey } from '@core/ports/AuthPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';
import { Checkbox } from '@ui/Checkbox';
import styles from './CredentialAccounts.module.css';

export function SshKeysSection({ onCreated }: { onCreated?: (key: SshKey) => void }) {
  const { auth, system } = usePorts();
  const { t } = useI18n();
  const [keys, setKeys] = useState<readonly SshKey[]>([]);
  const [alias, setAlias] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [unprotected, setUnprotected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void auth.listKeys().then(
      (data) => {
        if (active) setKeys(data);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [auth]);
  const create = async (generate: boolean) => {
    if (!alias.trim() || busy || (generate && !passphrase && !unprotected)) return;
    setBusy(true);
    setFailed(false);
    try {
      const path = generate ? null : await system.pickFile({ title: t('access.keys.privateFile') });
      if (!generate && path === null) return;
      const key = generate
        ? await auth.generateKey(alias.trim(), passphrase)
        : await auth.importKey(alias.trim(), path!);
      setKeys(await auth.listKeys());
      setShown(key.id);
      setAlias('');
      setPassphrase('');
      setUnprotected(false);
      onCreated?.(key);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setFailed(false);
    try {
      await auth.removeKey(id);
      setKeys(await auth.listKeys());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.root} aria-label={t('access.keys.title')}>
      <h2>{t('access.keys.title')}</h2>
      <p className={styles.description}>{t('access.keys.description')}</p>
      {keys.map((key) => (
        <div key={key.id} className={styles.card}>
          <div className={styles.cardBody}>
            <strong>{key.alias}</strong>
            <span>{key.path}</span>
            {shown === key.id && (
              <>
                <p>{t('access.keys.register')}</p>
                <textarea
                  readOnly
                  aria-label={t('access.keys.public')}
                  value={key.publicKey}
                  rows={3}
                />
              </>
            )}
          </div>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => setShown(shown === key.id ? null : key.id)}>
              {t('access.keys.public')}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                void remove(key.id);
              }}
            >
              {t('access.keys.remove')}
            </Button>
          </div>
        </div>
      ))}
      <div className={styles.form}>
        <Input
          label={t('access.keys.alias')}
          value={alias}
          disabled={busy}
          onChange={(e) => setAlias(e.target.value)}
        />
        <Input
          type="password"
          autoComplete="new-password"
          label={t('access.keys.passphrase')}
          value={passphrase}
          disabled={busy || unprotected}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        <Checkbox
          label={t('access.keys.unprotected')}
          checked={unprotected}
          disabled={busy}
          onChange={(e) => {
            setUnprotected(e.target.checked);
            setPassphrase('');
          }}
        />
        <div className={styles.actions}>
          <Button
            disabled={busy || !alias.trim()}
            onClick={() => {
              void create(false);
            }}
          >
            {t('access.keys.import')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !alias.trim() || (!passphrase && !unprotected)}
            onClick={() => {
              void create(true);
            }}
          >
            {t('access.keys.generate')}
          </Button>
        </div>
      </div>
      {failed && <p role="alert">{t('access.keys.error')}</p>}
    </section>
  );
}

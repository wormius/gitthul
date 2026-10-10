import { useEffect, useState } from 'react';

import { usePorts } from '@app/PortsContext';
import type { RemoteCredentialAccount } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';

import styles from './CredentialAccounts.module.css';

interface CredentialAccountsProps {
  accounts: readonly RemoteCredentialAccount[];
  onUpdate: (accounts: readonly RemoteCredentialAccount[]) => void;
}

interface Draft {
  id: string;
  existing: boolean;
  label: string;
  host: string;
  username: string;
  remotePattern: string;
  secret: string;
}

let fallbackId = 0;

function nextId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `credential-${String(Date.now())}-${String(fallbackId)}`;
}

function reference(id: string) {
  return { kind: 'remote', id } as const;
}

/** Administrador de cuentas: metadatos en settings, secretos solo en KeyringPort. */
export function CredentialAccounts({ accounts, onUpdate }: CredentialAccountsProps) {
  const { t } = useI18n();
  const { keyring } = usePorts();
  const [availability, setAvailability] = useState<'checking' | 'available' | 'unavailable'>(
    'checking',
  );
  const [presence, setPresence] = useState<Readonly<Record<string, boolean>>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RemoteCredentialAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    void keyring
      .isAvailable()
      .then(async (available) => {
        if (!current) return;
        setAvailability(available ? 'available' : 'unavailable');
        if (!available) return;
        const entries = await Promise.all(
          accounts.map(async (account) => ({
            id: account.id,
            present: await keyring.has(reference(account.id)),
          })),
        );
        const next: Record<string, boolean> = {};
        for (const item of entries) next[item.id] = item.present;
        if (current) setPresence(next);
      })
      .catch(() => {
        if (current) setAvailability('unavailable');
      });

    return () => {
      current = false;
    };
  }, [accounts, keyring]);

  const valid =
    draft !== null &&
    draft.label.trim() !== '' &&
    draft.host.trim() !== '' &&
    draft.username.trim() !== '' &&
    (draft.existing || draft.secret !== '');

  const beginAdd = () => {
    setError(false);
    setDraft({
      id: nextId(),
      existing: false,
      label: '',
      host: '',
      username: '',
      remotePattern: '',
      secret: '',
    });
  };

  const beginEdit = (account: RemoteCredentialAccount) => {
    setError(false);
    setDraft({ ...account, existing: true, secret: '' });
  };

  const save = async () => {
    if (!draft || !valid) return;
    setBusy(true);
    setError(false);
    try {
      if (draft.secret !== '') await keyring.set(reference(draft.id), draft.secret);
      const account: RemoteCredentialAccount = {
        id: draft.id,
        label: draft.label.trim(),
        host: draft.host.trim(),
        username: draft.username.trim(),
        remotePattern: draft.remotePattern.trim(),
      };
      onUpdate(
        draft.existing
          ? accounts.map((current) => (current.id === account.id ? account : current))
          : [...accounts, account],
      );
      if (draft.secret !== '') setPresence((current) => ({ ...current, [draft.id]: true }));
      setDraft(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError(false);
    try {
      await keyring.delete(reference(pendingDelete.id));
      onUpdate(accounts.filter((account) => account.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      setError(true);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root}>
      <p className={styles.description}>{t('settings.git.credentials.description')}</p>

      {availability === 'checking' && (
        <p className={styles.status} role="status">
          {t('settings.git.credentials.checking')}
        </p>
      )}
      {availability === 'unavailable' && (
        <p className={styles.warning} role="status">
          {t('settings.git.credentials.unavailable')}
        </p>
      )}
      {error && (
        <p className={styles.warning} role="alert">
          {t('settings.git.credentials.error')}
        </p>
      )}

      {accounts.length === 0 && draft === null && (
        <p className={styles.empty}>{t('settings.git.credentials.empty')}</p>
      )}

      {accounts.map((account) => (
        <div className={styles.card} key={account.id} role="group" aria-label={account.label}>
          <div className={styles.cardBody}>
            <strong>{account.label}</strong>
            <span>{account.username}</span>
            <span>{account.host}</span>
            {account.remotePattern && <span>{account.remotePattern}</span>}
            <span>
              {presence[account.id] === true
                ? t('settings.git.credentials.stored')
                : t('settings.git.credentials.missing')}
            </span>
          </div>
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={() => beginEdit(account)} disabled={busy}>
              {t('settings.git.credentials.edit')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingDelete(account)}
              disabled={busy || availability !== 'available'}
            >
              {t('settings.git.credentials.delete')}
            </Button>
          </div>
        </div>
      ))}

      {draft && (
        <div className={styles.form} role="group" aria-label={t('settings.git.credentials.form')}>
          <Input
            autoFocus
            label={t('settings.git.credentials.label')}
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
          <Input
            label={t('settings.git.credentials.host')}
            value={draft.host}
            onChange={(event) => setDraft({ ...draft, host: event.target.value })}
          />
          <Input
            label={t('settings.git.credentials.username')}
            value={draft.username}
            onChange={(event) => setDraft({ ...draft, username: event.target.value })}
          />
          <Input
            label={t('settings.git.credentials.remotePattern')}
            value={draft.remotePattern}
            onChange={(event) => setDraft({ ...draft, remotePattern: event.target.value })}
          />
          <Input
            type="password"
            autoComplete="new-password"
            label={t('settings.git.credentials.secret')}
            value={draft.secret}
            hint={t(
              draft.existing
                ? 'settings.git.credentials.secretEditHint'
                : 'settings.git.credentials.secretNewHint',
            )}
            onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
          />
          <div className={styles.actions}>
            <Button onClick={() => setDraft(null)} disabled={busy}>
              {t('settings.git.credentials.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!valid || busy}>
              {t('settings.git.credentials.save')}
            </Button>
          </div>
        </div>
      )}

      {draft === null && (
        <Button
          className={styles.add}
          onClick={beginAdd}
          disabled={availability !== 'available' || busy}
        >
          {t('settings.git.credentials.add')}
        </Button>
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title={t('settings.git.credentials.deleteTitle', {
          account: pendingDelete?.label ?? '',
        })}
        description={t('settings.git.credentials.deleteDescription', {
          account: pendingDelete?.label ?? '',
        })}
        closeLabel={t('settings.git.credentials.close')}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)} disabled={busy}>
              {t('settings.git.credentials.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void remove()} disabled={busy}>
              {t('settings.git.credentials.delete')}
            </Button>
          </>
        }
      />
    </div>
  );
}

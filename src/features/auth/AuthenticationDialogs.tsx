import { useEffect, useState } from 'react';
import { usePorts } from '@app/PortsContext';
import type { AuthChallenge, SshKey } from '@core/ports/AuthPort';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Checkbox } from '@ui/Checkbox';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';
import { Select } from '@ui/Select';
import { useToast } from '@ui/useToast';
import { SshKeysSection } from '../settings/SshKeysSection';
import styles from '../settings/CredentialAccounts.module.css';

export function AuthenticationDialog({
  request,
  onDone,
}: {
  request: AuthChallenge;
  onDone: () => void;
}) {
  const { auth, keyring } = usePorts();
  const { t } = useI18n();
  const [username, setUsername] = useState(request.username);
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [keys, setKeys] = useState<readonly SshKey[]>([]);
  const [keyId, setKeyId] = useState('');
  const [adding, setAdding] = useState(false);
  const [useHttps, setUseHttps] = useState(false);
  const [httpsUrl, setHttpsUrl] = useState('');
  useEffect(() => {
    let active = true;
    void keyring.isAvailable().then(
      (value) => {
        if (active) setAvailable(value);
      },
      () => undefined,
    );
    void auth.listKeys().then(
      (keys) => {
        if (active) setKeys(keys);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [auth, keyring]);
  const finish = async (cancel = false) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await auth.answer(
        request.id,
        cancel
          ? null
          : {
              username,
              secret:
                request.kind === 'host'
                  ? 'yes'
                  : request.kind === 'ssh'
                    ? useHttps
                      ? httpsUrl.trim()
                      : `ssh-key:${keyId}`
                    : secret,
              remember: request.kind === 'https' && available && remember,
            },
      );
      setSecret('');
      onDone();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  const invalid =
    request.kind === 'https'
      ? !username.trim() || !secret
      : request.kind === 'ssh'
        ? useHttps
          ? !/^https:\/\/[^@\s/]+\/\S+$/.test(httpsUrl.trim())
          : !keyId
        : request.kind === 'passphrase'
          ? !secret
          : false;
  return (
    <Dialog
      open
      onClose={() => {
        void finish(true);
      }}
      title={t(request.kind === 'host' ? 'access.hostTitle' : 'access.title')}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button
            disabled={busy}
            onClick={() => {
              void finish(true);
            }}
          >
            {t('working.dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || invalid}
            onClick={() => {
              void finish();
            }}
          >
            {t(request.kind === 'host' ? 'access.trust' : 'access.continue')}
          </Button>
        </>
      }
    >
      <div className={styles.root}>
        <p className={styles.cardBody}>
          {request.repository}
          <br />
          {request.url}
        </p>
        {request.kind === 'https' && (
          <>
            <Input
              autoFocus
              label={t('access.username')}
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              type="password"
              autoComplete="off"
              label={t('access.token')}
              value={secret}
              disabled={busy}
              onChange={(e) => setSecret(e.target.value)}
            />
            <Checkbox
              label={t('access.remember')}
              checked={remember}
              disabled={busy || !available}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {!available && <p>{t('access.noKeyring')}</p>}
          </>
        )}
        {request.kind === 'passphrase' && (
          <>
            <p className={styles.cardBody}>{request.prompt}</p>
            <Input
              autoFocus
              type="password"
              autoComplete="off"
              label={t('access.keys.passphrase')}
              value={secret}
              disabled={busy}
              onChange={(e) => setSecret(e.target.value)}
            />
          </>
        )}
        {request.kind === 'host' && <p className={styles.cardBody}>{request.prompt}</p>}
        {request.kind === 'ssh' && (
          <>
            <p>{t('access.sshRequired')}</p>
            <Checkbox
              label={t('access.switchHttps')}
              checked={useHttps}
              disabled={busy}
              onChange={(e) => setUseHttps(e.target.checked)}
            />
            {useHttps ? (
              <>
                <Input
                  label={t('access.httpsUrl')}
                  value={httpsUrl}
                  disabled={busy}
                  onChange={(e) => setHttpsUrl(e.target.value)}
                />
                <p>{t('access.switchHint')}</p>
              </>
            ) : (
              <>
                <Select
                  label={t('access.key')}
                  value={keyId}
                  disabled={busy}
                  onChange={(e) => setKeyId(e.target.value)}
                  options={[
                    { value: '', label: t('access.chooseKey') },
                    ...keys.map((key) => ({ value: key.id, label: key.alias })),
                  ]}
                />
                <Button disabled={busy} onClick={() => setAdding(!adding)}>
                  {t('access.keys.add')}
                </Button>
                {adding && (
                  <SshKeysSection
                    onCreated={(key) => {
                      setKeys((keys) => [...keys, key]);
                      setKeyId(key.id);
                    }}
                  />
                )}
              </>
            )}
          </>
        )}
        {failed && <p role="alert">{t('access.error')}</p>}
      </div>
    </Dialog>
  );
}

export function AuthenticationDialogs() {
  const { auth } = usePorts();
  const { t } = useI18n();
  const { show } = useToast();
  const [queue, setQueue] = useState<readonly AuthChallenge[]>([]);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void auth
      .subscribe((event) => {
        if (!active) return;
        if ('storageError' in event) {
          show({ variant: 'danger', message: t('access.storageError') });
          return;
        }
        if ('dismiss' in event) {
          setQueue((queue) => queue.filter((request) => request.id !== event.dismiss));
          return;
        }
        setQueue((queue) =>
          queue.some((request) => request.id === event.id) ? queue : [...queue, event],
        );
      })
      .then(
        (unsubscribe) => {
          if (active) stop = unsubscribe;
          else unsubscribe();
        },
        () => {
          if (active) show({ variant: 'danger', message: t('access.error') });
        },
      );
    return () => {
      active = false;
      stop?.();
    };
  }, [auth, t, show]);
  const request = queue[0];
  return request ? (
    <AuthenticationDialog
      key={request.id}
      request={request}
      onDone={() => setQueue((queue) => queue.filter((candidate) => candidate.id !== request.id))}
    />
  ) : null;
}

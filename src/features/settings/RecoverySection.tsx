import { useEffect, useId, useRef, useState } from 'react';
import { usePorts } from '@app/PortsContext';
import {
  backupFailure,
  type BackupPoint,
  type BackupRepository,
  type BackupSnapshot,
} from '@core/domain/backup';
import { recoveryFailure, type RecoverySnapshot } from '@core/domain/recovery';
import { BACKUP_LIMITS, type BackupSettings } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';
import { Switch } from '@ui/Switch';
import { ConfirmDialog } from '@features/working/ConfirmDialog';
import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';
import styles from './RecoverySection.module.css';

function SpaceLimit({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (value: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  const [sourceValue, setSourceValue] = useState(value);
  const [invalid, setInvalid] = useState(false);
  if (sourceValue !== value) {
    setSourceValue(value);
    setDraft(String(value));
  }
  async function save() {
    const next = Number(draft);
    if (
      !draft.trim() ||
      !Number.isInteger(next) ||
      next < BACKUP_LIMITS.min ||
      next > BACKUP_LIMITS.max
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) {
      try {
        await onSave(next);
      } catch {
        setDraft(String(value));
      }
    }
  }
  return (
    <Input
      label={t('settings.backup.maxMiB')}
      hideLabel
      type="number"
      min={BACKUP_LIMITS.min}
      max={BACKUP_LIMITS.max}
      step={1}
      disabled={disabled}
      value={draft}
      {...(invalid ? { error: t('settings.backup.invalidLimit', BACKUP_LIMITS) } : {})}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

type Failure =
  | { scope: 'cache'; value: ReturnType<typeof recoveryFailure> }
  | { scope: 'backup'; value: ReturnType<typeof backupFailure> };

/** Caché interno y puntos completos de emergencia tienen ciclos de vida separados. */
export function RecoverySection() {
  const { recovery, backup } = usePorts();
  const { settings, patch } = useSettingsData();
  const { t, locale } = useI18n();
  const [cache, setCache] = useState<RecoverySnapshot | null>(null);
  const [catalog, setCatalog] = useState<BackupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<{
    repository: BackupRepository;
    point: BackupPoint;
  } | null>(null);
  const generation = useRef(0);
  const catalogRequest = useRef(0);
  const cacheHeadingId = useId();
  const backupHeadingId = useId();
  const busyGuard = useRef(false);

  useEffect(() => {
    const request = ++generation.current;
    const catalogRead = ++catalogRequest.current;
    let alive = true;
    void Promise.allSettled([recovery.read(), backup.read()]).then(([temporary, backups]) => {
      if (!alive) return;
      if (temporary.status === 'fulfilled') setCache(temporary.value);
      else setFailure({ scope: 'cache', value: recoveryFailure(temporary.reason) });
      if (backups.status === 'fulfilled') {
        if (catalogRead === catalogRequest.current) setCatalog(backups.value);
      } else setFailure({ scope: 'backup', value: backupFailure(backups.reason) });
      setLoading(false);
    });
    return () => {
      alive = false;
      generation.current = request + 1;
    };
  }, [recovery, backup]);

  // Read the lightweight native catalog slowly while idle and faster during a backup.
  useEffect(() => {
    const active = catalog?.repositories.some((repository) =>
      /^(queued|running)$/.test(repository.status),
    );
    const delay = active ? 5000 : settings.backup.enabled ? 30000 : null;
    if (delay === null) return;
    const request = generation.current;
    let alive = true;
    const timer = window.setInterval(() => {
      if (busyGuard.current) return;
      const catalogRead = ++catalogRequest.current;
      void backup.read().then(
        (next) => {
          if (alive && request === generation.current && catalogRead === catalogRequest.current)
            setCatalog(next);
        },
        () => undefined,
      );
    }, delay);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [backup, catalog, settings.backup.enabled]);

  async function run(
    scope: Failure['scope'],
    action: () => Promise<void>,
    propagateFailure = false,
  ) {
    if (busyGuard.current) return;
    busyGuard.current = true;
    ++catalogRequest.current;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    const request = generation.current;
    try {
      await action();
    } catch (error) {
      if (request === generation.current)
        setFailure(
          scope === 'cache'
            ? { scope, value: recoveryFailure(error) }
            : { scope, value: backupFailure(error) },
        );
      if (propagateFailure) throw error;
    } finally {
      busyGuard.current = false;
      if (request === generation.current) setBusy(false);
    }
  }

  async function refresh() {
    const request = generation.current;
    const catalogRead = ++catalogRequest.current;
    const [temporary, backups] = await Promise.allSettled([recovery.read(), backup.read()]);
    if (request !== generation.current) return;
    if (temporary.status === 'fulfilled') setCache(temporary.value);
    else setFailure({ scope: 'cache', value: recoveryFailure(temporary.reason) });
    if (catalogRead !== catalogRequest.current) return;
    if (backups.status === 'fulfilled') setCatalog(backups.value);
    else setFailure({ scope: 'backup', value: backupFailure(backups.reason) });
  }

  async function save(change: Partial<BackupSettings>) {
    const request = generation.current;
    try {
      await patch({ backup: change });
    } catch (error) {
      if (request === generation.current)
        setFailure({ scope: 'backup', value: backupFailure(error) });
      throw error;
    }
    // A read failure must not revert settings that were already persisted.
    try {
      const catalogRead = ++catalogRequest.current;
      const next = await backup.read();
      if (request === generation.current && catalogRead === catalogRequest.current)
        setCatalog(next);
    } catch (error) {
      if (request === generation.current)
        setFailure({ scope: 'backup', value: backupFailure(error) });
    }
  }

  function bytes(value: number) {
    return t('settings.backup.sizeMiB', {
      size: (value / 1048576).toLocaleString(locale, { maximumFractionDigits: 2 }),
    });
  }

  const cacheErrorKeys = {
    'recovery.stale': 'settings.recovery.error.stale',
    'recovery.invalid': 'settings.recovery.error.invalid',
    'recovery.protected': 'settings.recovery.error.protected',
    'recovery.unavailable': 'settings.recovery.error.unavailable',
    'recovery.cancelled': 'settings.recovery.error.cancelled',
  } as const;
  const backupErrorKeys = {
    'backup.invalid': 'settings.backup.error.invalid',
    'backup.unavailable': 'settings.backup.error.unavailable',
    'backup.destination': 'settings.backup.error.destination',
    'backup.stale': 'settings.backup.error.stale',
  } as const;
  const failureKey = failure
    ? failure.scope === 'cache'
      ? failure.value.code
        ? cacheErrorKeys[failure.value.code]
        : 'settings.recovery.error.unknown'
      : failure.value.code
        ? backupErrorKeys[failure.value.code]
        : 'settings.backup.error.unknown'
    : null;
  const failureNotice = failure && failureKey && (
    <div className={styles.failure} role="alert">
      <p>{t(failureKey)}</p>
      {failure.value.output && (
        <details>
          <summary>{t('settings.backup.error.details')}</summary>
          <pre>{failure.value.output}</pre>
        </details>
      )}
    </div>
  );

  return (
    <SettingsSection
      title={t('settings.section.recovery')}
      actions={
        <Button disabled={busy || loading} onClick={() => void run('backup', refresh)}>
          {t('settings.backup.refresh')}
        </Button>
      }
    >
      <section className={styles.group} aria-labelledby={cacheHeadingId}>
        <h2 id={cacheHeadingId}>{t('settings.storage.title')}</h2>
        <p>{t('settings.storage.description')}</p>
        {cache && (
          <div className={styles.storage}>
            <span>{t('settings.storage.total', { size: bytes(cache.totalBytes) })}</span>
            <code>{cache.directory}</code>
          </div>
        )}
        <p className={styles.hint}>{t('settings.storage.protected')}</p>
        {!!cache?.protectedCount && (
          <p className={styles.hint}>
            {t('settings.storage.protectedCount', { count: cache.protectedCount })}
          </p>
        )}
        {!!cache?.uncertainBuckets && (
          <p className={styles.pending} role="status">
            {t('settings.storage.uncertain')}
          </p>
        )}
        {cache?.configurationWarning && (
          <p className={styles.pending} role="status">
            {t('settings.storage.configurationWarning')}
          </p>
        )}
        <Button
          disabled={busy || loading || !cache}
          onClick={() => {
            setFailure(null);
            setNotice(null);
            setCleanupConfirm(true);
          }}
        >
          {t('settings.storage.cleanup')}
        </Button>
      </section>
      <section className={styles.group} aria-labelledby={backupHeadingId}>
        <h2 id={backupHeadingId}>{t('settings.backup.title')}</h2>
        <p>{t('settings.backup.description')}</p>
        <div className={styles.preferences}>
          <SettingRow label={t('settings.backup.enabled')}>
            <Switch
              label={t('settings.backup.enabled')}
              checked={settings.backup.enabled}
              disabled={busy || loading}
              onChange={(event) => {
                const enabled = event.target.checked;
                void run('backup', () => save({ enabled }));
              }}
            />
          </SettingRow>
          <SettingRow label={t('settings.backup.maxMiB')}>
            <SpaceLimit
              value={settings.backup.maxMiB}
              disabled={busy || loading}
              onSave={(maxMiB) => run('backup', () => save({ maxMiB }), true)}
            />
          </SettingRow>
        </div>
        <p className={styles.hint}>{t('settings.backup.retention')}</p>
        {catalog && (
          <div className={styles.storage}>
            <span>
              {t('settings.backup.total', {
                size: bytes(catalog.totalBytes),
                limit: bytes(settings.backup.maxMiB * 1048576),
              })}
            </span>
            <code>{catalog.directory}</code>
          </div>
        )}
        {catalog && catalog.totalBytes > catalog.maxBytes && (
          <p className={styles.pending} role="status">
            {t('settings.backup.overBudget')}
          </p>
        )}
        {catalog && catalog.corruptPoints > 0 && (
          <p className={styles.pending} role="alert">
            {t('settings.backup.corruptNotice')}
          </p>
        )}
        {!loading && catalog?.repositories.length === 0 && <p>{t('settings.backup.empty')}</p>}
        <ul className={styles.points} aria-label={t('settings.backup.points')}>
          {catalog?.repositories.map((repository) => (
            <li key={repository.id} className={styles.repository}>
              <div className={styles.metadata}>
                <strong>{repository.name}</strong>
                <code>{repository.repository}</code>
                <p className={styles.summary} role="status">
                  {t(`settings.backup.status.${repository.status}`)}
                </p>
                {repository.reason && (
                  <p className={styles.hint}>{t(`settings.backup.reason.${repository.reason}`)}</p>
                )}
                {repository.lastCompletedAt !== null && (
                  <span>
                    {t('settings.backup.lastCompleted', {
                      date: new Date(repository.lastCompletedAt).toLocaleString(locale),
                    })}
                  </span>
                )}
              </div>
              {!repository.points.length && <p>{t('settings.backup.noPoints')}</p>}
              <ul className={styles.points}>
                {repository.points.map((point) => (
                  <li key={point.id} className={styles.point}>
                    <div className={styles.metadata}>
                      <time dateTime={new Date(point.createdAt).toISOString()}>
                        {new Date(point.createdAt).toLocaleString(locale)}
                      </time>
                      <span>
                        {t('settings.backup.pointSize', {
                          count: point.fileCount,
                          size: bytes(point.bytes),
                        })}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setFailure(null);
                        setNotice(null);
                        setRestoreConfirm({ repository, point });
                      }}
                    >
                      {t('settings.backup.restore')}
                    </Button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      {loading && <p role="status">{t('settings.storage.loading')}</p>}
      {notice && <p role="status">{notice}</p>}
      {!cleanupConfirm && !restoreConfirm && failureNotice}
      {cleanupConfirm && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.storage.cleanupTitle')}
          description={t('settings.storage.cleanupDescription')}
          confirmLabel={t('settings.storage.confirmCleanup')}
          onCancel={() => setCleanupConfirm(false)}
          onConfirm={() => {
            void run('cache', async () => {
              const result = await recovery.cleanup();
              setCleanupConfirm(false);
              await refresh();
              setNotice(t('settings.storage.cleaned', { size: bytes(result.freedBytes) }));
            });
          }}
        >
          {failureNotice}
        </ConfirmDialog>
      )}
      {restoreConfirm && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.backup.restoreTitle')}
          description={t('settings.backup.restoreDescription', {
            repository: restoreConfirm.repository.name,
            date: new Date(restoreConfirm.point.createdAt).toLocaleString(locale),
          })}
          confirmLabel={t('settings.backup.confirmRestore')}
          onCancel={() => setRestoreConfirm(null)}
          onConfirm={() => {
            const id = restoreConfirm.point.id;
            void run('backup', async () => {
              const result = await backup.restore(id);
              setRestoreConfirm(null);
              if (result) setNotice(t('settings.backup.restored', { path: result.path }));
            });
          }}
        >
          {failureNotice}
        </ConfirmDialog>
      )}
    </SettingsSection>
  );
}

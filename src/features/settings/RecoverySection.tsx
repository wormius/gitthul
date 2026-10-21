import { useEffect, useId, useRef, useState } from 'react';
import { usePorts } from '@app/PortsContext';
import {
  backupFailure,
  isBackupPointProtected,
  type BackupLimitPlan,
  type BackupPoint,
  type BackupRepository,
  type BackupSnapshot,
} from '@core/domain/backup';
import { recoveryFailure, type RecoverySnapshot } from '@core/domain/recovery';
import { BACKUP_LIMITS, type BackupSettings } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';
import { ProgressBar } from '@ui/ProgressBar';
import { Switch } from '@ui/Switch';
import { ConfirmDialog } from '@features/working/ConfirmDialog';
import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';
import styles from './RecoverySection.module.css';

function SpaceLimit({
  value,
  disabled,
  resetVersion,
  onSave,
}: {
  value: number;
  disabled: boolean;
  resetVersion: number;
  onSave: (value: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  const [source, setSource] = useState({ value, resetVersion });
  const [invalid, setInvalid] = useState(false);
  const pending = useRef(false);
  const skipBlur = useRef(false);
  if (source.value !== value || source.resetVersion !== resetVersion) {
    setSource({ value, resetVersion });
    setDraft(String(value));
  }
  async function save() {
    if (pending.current || disabled) return;
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
      pending.current = true;
      try {
        await onSave(next);
      } catch {
        setDraft(String(value));
      } finally {
        pending.current = false;
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
        if (skipBlur.current) {
          skipBlur.current = false;
          return;
        }
        void save();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          skipBlur.current = true;
          setDraft(String(value));
          setInvalid(false);
          event.currentTarget.blur();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
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
  const [catalogConfirmed, setCatalogConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [foregroundReview, setForegroundReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [backupOperation, setBackupOperation] = useState<'delete' | 'prune' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<{
    repository: BackupRepository;
    point: BackupPoint;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    repository: BackupRepository;
    point: BackupPoint;
  } | null>(null);
  const [pruneConfirm, setPruneConfirm] = useState(false);
  const [limitReview, setLimitReview] = useState<{
    maxMiB: number;
    plan: BackupLimitPlan | null;
    changed: boolean;
  } | null>(null);
  const [limitStage, setLimitStage] = useState<'preview' | 'apply' | null>(null);
  const [limitResetVersion, setLimitResetVersion] = useState(0);
  const generation = useRef(0);
  const catalogRequest = useRef(0);
  const pendingCatalogRead = useRef<number | null>(null);
  const cacheHeadingId = useId();
  const backupHeadingId = useId();
  const busyGuard = useRef(false);

  useEffect(() => {
    const request = ++generation.current;
    const catalogRead = ++catalogRequest.current;
    pendingCatalogRead.current = catalogRead;
    let alive = true;
    void Promise.allSettled([recovery.read(), backup.read()]).then(([temporary, backups]) => {
      if (!alive) return;
      if (temporary.status === 'fulfilled') setCache(temporary.value);
      else setFailure({ scope: 'cache', value: recoveryFailure(temporary.reason) });
      if (catalogRead === catalogRequest.current) {
        pendingCatalogRead.current = null;
        setForegroundReview(false);
        if (backups.status === 'fulfilled') {
          setCatalog(backups.value);
          if (!backups.value.scanning) setCatalogConfirmed(true);
        } else {
          setCatalog((previous) => (previous ? { ...previous, scanning: false } : null));
          setFailure({ scope: 'backup', value: backupFailure(backups.reason) });
        }
      }
      setLoading(false);
    });
    return () => {
      alive = false;
      generation.current = request + 1;
    };
  }, [recovery, backup]);

  // Read the lightweight native catalog slowly while idle and faster during a backup.
  useEffect(() => {
    if (loading) return;
    const active = catalog?.repositories.some((repository) =>
      /^(queued|running)$/.test(repository.status),
    );
    const delay = catalog?.scanning ? 1000 : active ? 5000 : settings.backup.enabled ? 30000 : null;
    if (delay === null) return;
    const request = generation.current;
    const timer = window.setInterval(() => {
      if (
        request !== generation.current ||
        busyGuard.current ||
        pendingCatalogRead.current !== null
      )
        return;
      const catalogRead = ++catalogRequest.current;
      pendingCatalogRead.current = catalogRead;
      void backup.read().then(
        (next) => {
          if (request === generation.current && catalogRead === catalogRequest.current) {
            pendingCatalogRead.current = null;
            setCatalog(next);
            if (!next.scanning) {
              setCatalogConfirmed(true);
              setForegroundReview(false);
            }
          }
        },
        (error: unknown) => {
          if (request === generation.current && catalogRead === catalogRequest.current) {
            pendingCatalogRead.current = null;
            setForegroundReview(false);
            setCatalog((previous) => (previous ? { ...previous, scanning: false } : null));
            setFailure({ scope: 'backup', value: backupFailure(error) });
          }
        },
      );
    }, delay);
    return () => {
      // Una consulta pendiente sigue siendo válida al cambiar la frecuencia o
      // la política. La generación y el número de petición descartan las obsoletas.
      window.clearInterval(timer);
    };
  }, [backup, catalog, loading, settings.backup.enabled]);

  async function run(
    scope: Failure['scope'],
    action: () => Promise<void>,
    propagateFailure = false,
  ) {
    if (busyGuard.current) return;
    busyGuard.current = true;
    ++catalogRequest.current;
    pendingCatalogRead.current = null;
    setForegroundReview(false);
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
      if (request === generation.current) {
        setBusy(false);
        setBackupOperation(null);
        setLimitStage(null);
      }
    }
  }

  async function refresh() {
    const request = generation.current;
    const catalogRead = ++catalogRequest.current;
    pendingCatalogRead.current = catalogRead;
    setForegroundReview(true);
    const [temporary, backups] = await Promise.allSettled([recovery.read(), backup.read()]);
    if (request !== generation.current) return;
    if (temporary.status === 'fulfilled') setCache(temporary.value);
    else setFailure({ scope: 'cache', value: recoveryFailure(temporary.reason) });
    if (catalogRead !== catalogRequest.current) return;
    pendingCatalogRead.current = null;
    if (backups.status === 'fulfilled') {
      setCatalog(backups.value);
      setForegroundReview(backups.value.scanning);
      if (!backups.value.scanning) setCatalogConfirmed(true);
    } else {
      setForegroundReview(false);
      setCatalog((previous) => (previous ? { ...previous, scanning: false } : null));
      setFailure({ scope: 'backup', value: backupFailure(backups.reason) });
    }
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
    const catalogRead = ++catalogRequest.current;
    pendingCatalogRead.current = catalogRead;
    try {
      const next = await backup.read();
      if (request === generation.current && catalogRead === catalogRequest.current) {
        setCatalog(next);
        if (!next.scanning) setCatalogConfirmed(true);
      }
    } catch (error) {
      if (request === generation.current && catalogRead === catalogRequest.current) {
        setCatalog((previous) => (previous ? { ...previous, scanning: false } : null));
        setFailure({ scope: 'backup', value: backupFailure(error) });
      }
    } finally {
      if (request === generation.current && catalogRead === catalogRequest.current) {
        pendingCatalogRead.current = null;
      }
    }
  }

  async function readAfterLimit(request: number, preserveFailure = false) {
    const read = ++catalogRequest.current;
    try {
      const next = await backup.read();
      if (request !== generation.current || read !== catalogRequest.current) return;
      setCatalog(next);
      if (!next.scanning) setCatalogConfirmed(true);
    } catch (error) {
      if (request === generation.current && read === catalogRequest.current && !preserveFailure)
        setFailure({ scope: 'backup', value: backupFailure(error) });
    }
  }

  async function applyLimit(plan: BackupLimitPlan, request: number) {
    setLimitStage('apply');
    try {
      await patch({ backup: { maxMiB: plan.maxMiB } }, { backupLimitToken: plan.token });
    } catch (error) {
      if (request !== generation.current) return;
      const value = backupFailure(error);
      const changed = value.code === 'backup.limitChanged';
      setFailure({ scope: 'backup', value });
      setLimitReview({ maxMiB: plan.maxMiB, plan: null, changed });
      setLimitResetVersion((version) => version + 1);
      // Una depuración puede haber retirado parte de los extras antes de un fallo.
      // Recuperar el catálogo real y nunca reutilizar automáticamente el token.
      await readAfterLimit(request, true);
      if (request !== generation.current) return;
      setLimitStage('preview');
      try {
        const updated = await backup.previewLimit(plan.maxMiB);
        if (request === generation.current)
          setLimitReview({ maxMiB: plan.maxMiB, plan: updated, changed });
      } catch {
        // El fallo original sigue visible; el diálogo ofrece revisar de nuevo.
      }
      return;
    }
    if (request !== generation.current) return;
    await readAfterLimit(request);
    if (request !== generation.current) return;
    setLimitReview(null);
    setLimitResetVersion((version) => version + 1);
    setNotice(t('settings.backup.limitSaved'));
  }

  async function reviewLimit(maxMiB: number, requireConfirmation = false) {
    if (busyGuard.current) return;
    const request = generation.current;
    await run(
      'backup',
      async () => {
        if (!requireConfirmation && maxMiB >= settings.backup.maxMiB) {
          setLimitStage('apply');
          await save({ maxMiB });
          if (request === generation.current) setNotice(t('settings.backup.limitSaved'));
          return;
        }
        setLimitStage('preview');
        const plan = await backup.previewLimit(maxMiB);
        if (request !== generation.current) return;
        if (!plan.feasible || plan.deleteCount > 0 || requireConfirmation) {
          setLimitReview({ maxMiB, plan, changed: requireConfirmation });
          if (!plan.feasible) setLimitResetVersion((version) => version + 1);
          return;
        }
        await applyLimit(plan, request);
      },
      true,
    );
  }

  function confirmLimit() {
    if (!limitReview || busyGuard.current) return;
    if (!limitReview.plan?.feasible) {
      void reviewLimit(limitReview.maxMiB, true).catch(() => undefined);
      return;
    }
    const request = generation.current;
    const plan = limitReview.plan;
    void run('backup', () => applyLimit(plan, request));
  }

  function bytes(value: number) {
    return t('settings.backup.sizeMiB', {
      size: (value / 1048576).toLocaleString(locale, { maximumFractionDigits: 2 }),
    });
  }

  const limitBytes = settings.backup.maxMiB * 1048576;
  const usageRatio = (catalog?.totalBytes ?? 0) / limitBytes;
  const usagePercent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(usageRatio);
  const overBudget = (catalog?.totalBytes ?? 0) > limitBytes;
  const reviewingCatalog = foregroundReview || (!catalogConfirmed && catalog?.scanning);
  const showUsage =
    catalog &&
    (catalogConfirmed ||
      catalog.totalBytes > 0 ||
      catalog.repositories.some((repository) => repository.points.length));
  const pruneCount =
    catalog?.repositories.reduce(
      (count, repository) =>
        count +
        repository.points.filter((point) => !isBackupPointProtected(repository, point)).length,
      0,
    ) ?? 0;

  function deletePoint() {
    if (!deleteConfirm || busyGuard.current || loading) return;

    // El sondeo puede haber cambiado la protección desde que se abrió el diálogo.
    const currentRepository = catalog?.repositories.find(
      (repository) => repository.id === deleteConfirm.repository.id,
    );
    const currentPoint = currentRepository?.points.find(
      (point) => point.id === deleteConfirm.point.id,
    );
    if (!currentRepository || !currentPoint) {
      setFailure({ scope: 'backup', value: { code: 'backup.stale' } });
      return;
    }
    if (isBackupPointProtected(currentRepository, currentPoint)) {
      setFailure({ scope: 'backup', value: { code: 'backup.protected' } });
      return;
    }
    if (!catalog || !catalogConfirmed || catalog.corruptPoints > 0) {
      setFailure({ scope: 'backup', value: { code: 'backup.unavailable' } });
      return;
    }

    const request = generation.current;
    void run('backup', async () => {
      setBackupOperation('delete');
      const next = await backup.delete(currentPoint.id);
      if (request !== generation.current) return;
      // El catálogo devuelto ya incluye el espacio físico compartido actualizado.
      setCatalog(next);
      if (!next.scanning) setCatalogConfirmed(true);
      setDeleteConfirm(null);
      setNotice(t('settings.backup.deleted'));
    });
  }

  function pruneBackups() {
    if (!pruneConfirm || busyGuard.current || loading) return;
    if (!catalog || !catalogConfirmed || catalog.corruptPoints > 0) {
      setFailure({ scope: 'backup', value: { code: 'backup.unavailable' } });
      return;
    }
    if (pruneCount === 0) {
      setFailure({ scope: 'backup', value: { code: 'backup.protected' } });
      return;
    }
    const request = generation.current;
    void run('backup', async () => {
      setBackupOperation('prune');
      const next = await backup.prune();
      if (request !== generation.current) return;
      setCatalog(next);
      if (!next.scanning) setCatalogConfirmed(true);
      setPruneConfirm(false);
      setNotice(t('settings.backup.pruned'));
    });
  }

  const operationLabel =
    backupOperation === 'delete'
      ? t('settings.backup.deleting')
      : backupOperation === 'prune'
        ? t('settings.backup.pruning')
        : null;
  const operationProgress = operationLabel && (
    <div className={styles.operationProgress}>
      <p role="status">{operationLabel}</p>
      <ProgressBar label={operationLabel} />
    </div>
  );

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
    'backup.protected': 'settings.backup.error.protected',
    'backup.limitChanged': 'settings.backup.error.limitChanged',
    'backup.limitTooSmall': 'settings.backup.error.limitTooSmall',
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
        {reviewingCatalog && (
          <div className={styles.operationProgress}>
            <p role="status">{t('settings.backup.scanning')}</p>
            <ProgressBar label={t('settings.backup.scanning')} />
          </div>
        )}
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
              disabled={busy || loading || limitReview !== null}
              resetVersion={limitResetVersion}
              onSave={reviewLimit}
            />
          </SettingRow>
        </div>
        <p className={styles.hint}>{t('settings.backup.limitHint')}</p>
        {limitStage && !limitReview && (
          <div className={styles.operationProgress}>
            <p role="status">
              {t(
                limitStage === 'preview'
                  ? 'settings.backup.limitReviewing'
                  : 'settings.backup.limitApplying',
              )}
            </p>
            <ProgressBar
              label={t(
                limitStage === 'preview'
                  ? 'settings.backup.limitReviewing'
                  : 'settings.backup.limitApplying',
              )}
            />
          </div>
        )}
        <p className={styles.hint}>{t('settings.backup.retention')}</p>
        {catalog?.lastAutoPrune && (
          <p className={styles.pending} role="status">
            {t('settings.backup.autoPruned', {
              size: bytes(catalog.lastAutoPrune.freedBytes),
              count: catalog.lastAutoPrune.removedCount,
            })}
          </p>
        )}
        {catalog && showUsage && (
          <div className={styles.storage}>
            <span>
              {t('settings.backup.total', {
                size: bytes(catalog.totalBytes),
                limit: bytes(limitBytes),
              })}
            </span>
            <div className={styles.usage} data-over-budget={overBudget}>
              <div className={styles.usageSummary}>
                <span>{t('settings.backup.usage')}</span>
                <span>{t('settings.backup.usagePercent', { percent: usagePercent })}</span>
              </div>
              <div
                className={styles.usageMeter}
                role="meter"
                aria-label={t('settings.backup.usage')}
                aria-valuemin={0}
                aria-valuemax={limitBytes}
                aria-valuenow={Math.max(0, Math.min(catalog.totalBytes, limitBytes))}
                aria-valuetext={t('settings.backup.usageDescription', {
                  size: bytes(catalog.totalBytes),
                  limit: bytes(limitBytes),
                  percent: usagePercent,
                })}
              >
                <span
                  className={styles.usageFill}
                  style={{ inlineSize: `${Math.max(0, Math.min(usageRatio, 1)) * 100}%` }}
                />
              </div>
            </div>
            <code>{catalog.directory}</code>
          </div>
        )}
        {catalog && overBudget && (
          <p className={styles.pending} role="status">
            {t('settings.backup.overBudget')}
          </p>
        )}
        {catalog && catalog.corruptPoints > 0 && (
          <p className={styles.pending} role="alert">
            {t('settings.backup.corruptNotice')}
          </p>
        )}
        <Button
          className={styles.delete}
          disabled={
            busy ||
            loading ||
            !catalog ||
            !catalogConfirmed ||
            catalog.corruptPoints > 0 ||
            pruneCount === 0
          }
          onClick={() => {
            setFailure(null);
            setNotice(null);
            setPruneConfirm(true);
          }}
        >
          {t('settings.backup.prune')}
        </Button>
        {!loading &&
          catalogConfirmed &&
          !reviewingCatalog &&
          catalog?.repositories.length === 0 && <p>{t('settings.backup.empty')}</p>}
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
              {catalogConfirmed && !reviewingCatalog && !repository.points.length && (
                <p>{t('settings.backup.noPoints')}</p>
              )}
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
                      {isBackupPointProtected(repository, point) && (
                        <p className={styles.hint}>{t('settings.backup.deleteProtected')}</p>
                      )}
                    </div>
                    <div className={styles.pointActions}>
                      <Button
                        size="sm"
                        disabled={busy || loading || !catalogConfirmed}
                        onClick={() => {
                          setFailure(null);
                          setNotice(null);
                          setRestoreConfirm({ repository, point });
                        }}
                      >
                        {t('settings.backup.restore')}
                      </Button>
                      <Button
                        size="sm"
                        className={styles.delete}
                        disabled={
                          busy ||
                          loading ||
                          !catalogConfirmed ||
                          catalog.corruptPoints > 0 ||
                          isBackupPointProtected(repository, point)
                        }
                        onClick={() => {
                          setFailure(null);
                          setNotice(null);
                          setDeleteConfirm({ repository, point });
                        }}
                      >
                        {t('settings.backup.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      {loading && <p role="status">{t('settings.storage.loading')}</p>}
      {notice && <p role="status">{notice}</p>}
      {!cleanupConfirm &&
        !restoreConfirm &&
        !deleteConfirm &&
        !pruneConfirm &&
        !limitReview &&
        failureNotice}
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
            if (busyGuard.current || loading) return;
            if (!catalog || !catalogConfirmed) {
              setFailure({ scope: 'backup', value: { code: 'backup.unavailable' } });
              return;
            }
            const id = restoreConfirm.point.id;
            const request = generation.current;
            void run('backup', async () => {
              const result = await backup.restore(id);
              if (request !== generation.current) return;
              setRestoreConfirm(null);
              if (result) setNotice(t('settings.backup.restored', { path: result.path }));
            });
          }}
        >
          {failureNotice}
        </ConfirmDialog>
      )}
      {pruneConfirm && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.backup.pruneTitle')}
          description={t('settings.backup.pruneDescription', { count: pruneCount })}
          confirmLabel={t('settings.backup.confirmPrune')}
          onCancel={() => setPruneConfirm(false)}
          onConfirm={pruneBackups}
        >
          {operationProgress}
          {failureNotice}
        </ConfirmDialog>
      )}
      {deleteConfirm && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.backup.deleteTitle')}
          description={t('settings.backup.deleteDescription', {
            repository: deleteConfirm.repository.name,
            date: new Date(deleteConfirm.point.createdAt).toLocaleString(locale),
          })}
          confirmLabel={t('settings.backup.confirmDelete')}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={deletePoint}
        >
          {operationProgress}
          {failureNotice}
        </ConfirmDialog>
      )}
      {limitReview && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.backup.limitTitle')}
          description={t(
            limitReview.plan && !limitReview.plan.feasible
              ? 'settings.backup.limitImpossibleDescription'
              : 'settings.backup.limitDescription',
            {
              limit: bytes(limitReview.maxMiB * 1048576),
            },
          )}
          confirmLabel={t(
            limitReview.plan?.feasible
              ? 'settings.backup.confirmLimit'
              : 'settings.backup.reviewLimit',
          )}
          onCancel={() => {
            setLimitReview(null);
            setLimitResetVersion((version) => version + 1);
          }}
          onConfirm={confirmLimit}
        >
          {limitReview.plan && (
            <>
              <dl className={styles.limitPlan}>
                <dt>{t('settings.backup.limitCurrent')}</dt>
                <dd>{bytes(limitReview.plan.currentBytes)}</dd>
                {limitReview.plan.feasible && (
                  <>
                    <dt>{t('settings.backup.limitDeleteCount')}</dt>
                    <dd>{limitReview.plan.deleteCount.toLocaleString(locale)}</dd>
                    <dt>{t('settings.backup.limitProjected')}</dt>
                    <dd>{bytes(limitReview.plan.projectedBytes)}</dd>
                  </>
                )}
              </dl>
              {!limitReview.plan.feasible && (
                <p className={styles.failure} role="alert">
                  {t('settings.backup.limitMinimum', {
                    minimum: Math.ceil(limitReview.plan.minimumBytes / 1048576).toLocaleString(
                      locale,
                    ),
                  })}
                </p>
              )}
              <p>{t('settings.backup.limitProtected')}</p>
            </>
          )}
          {limitReview.changed && (
            <p className={styles.pending} role="status">
              {t('settings.backup.limitChangedReview')}
            </p>
          )}
          {limitStage && (
            <div className={styles.operationProgress}>
              <p role="status">
                {t(
                  limitStage === 'preview'
                    ? 'settings.backup.limitReviewing'
                    : 'settings.backup.limitApplying',
                )}
              </p>
              <ProgressBar
                label={t(
                  limitStage === 'preview'
                    ? 'settings.backup.limitReviewing'
                    : 'settings.backup.limitApplying',
                )}
              />
            </div>
          )}
          {failureNotice}
        </ConfirmDialog>
      )}
    </SettingsSection>
  );
}

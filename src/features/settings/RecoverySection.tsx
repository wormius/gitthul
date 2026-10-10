import { useEffect, useRef, useState } from 'react';
import { usePorts } from '@app/PortsContext';
import {
  recoveryFailure,
  type RecoveryPoint,
  type RecoveryPreview,
  type RecoverySnapshot,
} from '@core/domain/recovery';
import { RECOVERY_LIMITS, type RecoverySettings } from '@core/domain/settings';
import { MESSAGES, type MessageKey } from '@i18n/messages';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';
import { Switch } from '@ui/Switch';
import { ConfirmDialog } from '@features/working/ConfirmDialog';
import { SettingRow } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import { useSettingsData } from './useSettingsData';
import styles from './RecoverySection.module.css';

type Limit = Exclude<keyof RecoverySettings, 'autoCleanup'>;

function LimitInput({
  field,
  value,
  disabled,
  onSave,
}: {
  field: Limit;
  value: number;
  disabled: boolean;
  onSave: (value: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  const [sourceValue, setSourceValue] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const range = RECOVERY_LIMITS[field];
  if (sourceValue !== value) {
    setSourceValue(value);
    setDraft(String(value));
  }
  async function save() {
    const next = Number(draft);
    if (!draft.trim() || !Number.isInteger(next) || next < range.min || next > range.max) {
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
      label={t(`settings.recovery.${field}`)}
      hideLabel
      type="number"
      min={range.min}
      max={range.max}
      step={1}
      disabled={disabled}
      value={draft}
      {...(invalid
        ? { error: t('settings.recovery.invalidLimit', { min: range.min, max: range.max }) }
        : {})}
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

/** Descubre los respaldos persistidos cada vez que se abre la sección. */
export function RecoverySection() {
  const { recovery, settings: settingsPort } = usePorts();
  const { settings, patch } = useSettingsData();
  const { t, locale } = useI18n();
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof recoveryFailure> | null>(null);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<RecoveryPoint | null>(null);
  const previewToken = useRef<string | null>(null);
  const generation = useRef(0);
  const busyGuard = useRef(false);

  function report(error: unknown) {
    const next = recoveryFailure(error);
    if (next.code !== 'recovery.cancelled') setFailure(next);
  }

  useEffect(() => {
    const request = ++generation.current;
    let alive = true;
    void recovery.read().then(
      (value) => {
        if (alive) {
          setSnapshot(value);
          setLoading(false);
        }
      },
      (error: unknown) => {
        if (alive) {
          setFailure(recoveryFailure(error));
          setLoading(false);
        }
      },
    );
    return () => {
      alive = false;
      generation.current = request + 1;
      const token = previewToken.current;
      previewToken.current = null;
      if (token) void recovery.cancelPreview(token).catch(() => undefined);
    };
  }, [recovery]);

  async function run(action: () => Promise<void>) {
    if (busyGuard.current) return;
    busyGuard.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      busyGuard.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    setSnapshot(await recovery.read());
  }

  async function save(change: Partial<RecoverySettings>) {
    setFailure(null);
    try {
      await patch({ recovery: change });
      await settingsPort.flush();
    } catch (error) {
      report(error);
      throw error;
    }
    // El ajuste ya está persistido. Un fallo al releer el estado no debe revertirlo.
    try {
      await refresh();
    } catch (error) {
      report(error);
    }
  }

  function startPreview(point: RecoveryPoint) {
    void run(async () => {
      const request = generation.current;
      const result = await recovery.preview(point.id);
      if (request !== generation.current) {
        await recovery.cancelPreview(result.token);
        return;
      }
      previewToken.current = result.token;
      setPreview(result);
    });
  }

  function cancelPreview() {
    const token = previewToken.current;
    if (!token || busyGuard.current) return;
    void run(async () => {
      await recovery.cancelPreview(token);
      previewToken.current = null;
      setPreview(null);
    });
  }

  function restore() {
    const token = previewToken.current;
    if (!token) return;
    void run(async () => {
      try {
        await recovery.restore(token);
      } finally {
        previewToken.current = null;
        setPreview(null);
        await recovery.cancelPreview(token).catch(() => undefined);
      }
      await refresh();
    });
  }

  function operationLabel(label: string) {
    return label in MESSAGES[locale]
      ? t(label as MessageKey)
      : label || t('settings.recovery.savedState');
  }

  function bytes(value: number) {
    return t('settings.recovery.sizeMiB', {
      size: (value / 1048576).toLocaleString(locale, { maximumFractionDigits: 2 }),
    });
  }

  const pending =
    snapshot?.checkpoints.filter((point) => point.status === 'pending' || point.status === 'legacy')
      .length ?? 0;
  const errorKeys = {
    'recovery.stale': 'settings.recovery.error.stale',
    'recovery.invalid': 'settings.recovery.error.invalid',
    'recovery.protected': 'settings.recovery.error.protected',
    'recovery.unavailable': 'settings.recovery.error.unavailable',
    'recovery.cancelled': 'settings.recovery.error.cancelled',
  } as const;
  const failureNotice = failure && (
    <div className={styles.failure} role="alert">
      <p>{t(failure.code ? errorKeys[failure.code] : 'settings.recovery.error.unknown')}</p>
      {failure.output && (
        <details>
          <summary>{t('settings.recovery.error.details')}</summary>
          <pre>{failure.output}</pre>
        </details>
      )}
    </div>
  );

  return (
    <SettingsSection
      title={t('settings.section.recovery')}
      actions={
        <>
          <Button
            disabled={busy || loading}
            onClick={() => {
              void run(refresh);
            }}
          >
            {t('settings.recovery.refresh')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await recovery.importLegacy();
                await refresh();
              });
            }}
          >
            {t('settings.recovery.import')}
          </Button>
          <Button
            disabled={busy || loading}
            onClick={() => {
              void run(() => recovery.openDirectory());
            }}
          >
            {t('settings.recovery.openDirectory')}
          </Button>
          <Button
            disabled={busy || loading}
            onClick={() => {
              setFailure(null);
              setCleanupConfirm(true);
            }}
          >
            {t('settings.recovery.cleanup')}
          </Button>
        </>
      }
    >
      <p>{t('settings.recovery.description')}</p>
      <p className={styles.hint}>{t('settings.recovery.retentionHint')}</p>
      <SettingRow label={t('settings.recovery.autoCleanup')}>
        <Switch
          label={t('settings.recovery.autoCleanup')}
          checked={settings.recovery.autoCleanup && !snapshot?.configurationWarning}
          disabled={busy || loading}
          onChange={(event) => {
            void run(() => save({ autoCleanup: event.target.checked }));
          }}
        />
      </SettingRow>
      {(['maxCheckpoints', 'maxAgeDays', 'maxMiB'] as const).map((field) => (
        <SettingRow key={field} label={t(`settings.recovery.${field}`)}>
          <LimitInput
            field={field}
            value={settings.recovery[field]}
            disabled={busy}
            onSave={(value) => save({ [field]: value })}
          />
        </SettingRow>
      ))}
      {snapshot && (
        <div className={styles.storage}>
          <span>{t('settings.recovery.directory')}</span>
          <code>{snapshot.directory}</code>
          <span>
            {t('settings.recovery.total', {
              count: snapshot.checkpoints.length,
              size: bytes(snapshot.totalBytes),
            })}
          </span>
        </div>
      )}
      {pending > 0 && (
        <p className={styles.pending} role="status">
          {t('settings.recovery.pendingNotice', { count: pending })}
        </p>
      )}
      {snapshot?.configurationWarning && (
        <p className={styles.pending} role="status">
          {t('settings.recovery.configurationWarning')}
        </p>
      )}
      {!!snapshot?.uncertainBuckets && (
        <p className={styles.pending} role="status">
          {t('settings.recovery.uncertain', { count: snapshot.uncertainBuckets })}
        </p>
      )}
      {snapshot?.overBudget && (
        <p className={styles.pending} role="status">
          {t('settings.recovery.overBudget', { count: snapshot.protectedCount ?? 0 })}
        </p>
      )}
      {!preview && !cleanupConfirm && !removeConfirm && failureNotice}
      {loading && <p role="status">{t('settings.recovery.loading')}</p>}
      {!loading && snapshot?.checkpoints.length === 0 && <p>{t('settings.recovery.empty')}</p>}
      <ul className={styles.points} aria-label={t('settings.recovery.points')}>
        {snapshot?.checkpoints.map((point) => (
          <li key={point.id} className={styles.point}>
            <div className={styles.metadata}>
              <strong>{operationLabel(point.label)}</strong>
              <code>{point.repository}</code>
              <div className={styles.summary}>
                <time dateTime={new Date(point.createdAt).toISOString()}>
                  {new Date(point.createdAt).toLocaleString(locale)}
                </time>
                <span>{t(`settings.recovery.status.${point.status}`)}</span>
                {point.active && <span>{t('settings.recovery.active')}</span>}
              </div>
              <span>
                {t('settings.recovery.pointSize', {
                  count: point.fileCount,
                  size: bytes(point.bytes),
                })}
              </span>
            </div>
            <div className={styles.pointActions}>
              <Button size="sm" disabled={busy} onClick={() => startPreview(point)}>
                {t('settings.recovery.restore')}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await recovery.export(point.id);
                  });
                }}
              >
                {t('settings.recovery.export')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || point.active}
                onClick={() => {
                  setFailure(null);
                  setRemoveConfirm(point);
                }}
              >
                {t('settings.recovery.remove')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {preview && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.recovery.restoreTitle')}
          description={t(
            preview.includesGitState
              ? 'settings.recovery.restoreGitDescription'
              : 'settings.recovery.restoreFilesDescription',
            { repository: preview.repository, count: preview.fileCount },
          )}
          confirmLabel={t('settings.recovery.confirmRestore')}
          onConfirm={restore}
          onCancel={cancelPreview}
        >
          <p>{t('settings.recovery.backupFirst')}</p>
          <p>{t('settings.recovery.previewPaths', { count: preview.fileCount })}</p>
          <ul className={styles.previewPaths}>
            {preview.paths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          {preview.fileCount > preview.paths.length && (
            <p>
              {t('settings.recovery.morePaths', {
                count: preview.fileCount - preview.paths.length,
              })}
            </p>
          )}
          {failureNotice}
        </ConfirmDialog>
      )}
      {cleanupConfirm && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.recovery.cleanup')}
          description={t('settings.recovery.cleanupDescription')}
          confirmLabel={t('settings.recovery.cleanup')}
          onCancel={() => setCleanupConfirm(false)}
          onConfirm={() => {
            void run(async () => {
              await settingsPort.flush();
              await recovery.cleanup();
              setCleanupConfirm(false);
              await refresh();
            });
          }}
        >
          {failureNotice}
        </ConfirmDialog>
      )}
      {removeConfirm && (
        <ConfirmDialog
          busy={busy}
          title={t('settings.recovery.removeTitle')}
          description={t('settings.recovery.removeDescription', {
            repository: removeConfirm.repository,
          })}
          confirmLabel={t('settings.recovery.remove')}
          onCancel={() => setRemoveConfirm(null)}
          onConfirm={() => {
            const id = removeConfirm.id;
            void run(async () => {
              await recovery.remove(id);
              setRemoveConfirm(null);
              await refresh();
            });
          }}
        >
          {failureNotice}
        </ConfirmDialog>
      )}
    </SettingsSection>
  );
}

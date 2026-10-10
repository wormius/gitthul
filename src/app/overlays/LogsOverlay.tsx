import { useEffect, useMemo, useRef, useState } from 'react';

import { atLeast, LOG_LEVELS, type LogLevel, type LogEntry } from '@core/domain/logs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Spinner } from '@ui/Spinner';
import { useSettingsData } from '@features/settings/useSettingsData';
import { Dialog } from '@ui/Dialog';

import { usePorts } from '../PortsContext';
import { useShellStore } from '../shellStore';
import styles from './LogsOverlay.module.css';

const identity = (entry: LogEntry) =>
  `${entry.sessionId ?? 'legacy'}:${entry.origin ?? 'legacy'}:${entry.id}:${entry.at}`;

/** Visor vivo de la corriente única de registros de GitThul. */
export function LogsOverlay() {
  const { t, locale } = useI18n();
  const { log } = usePorts();
  const overlay = useShellStore((state) => state.overlay);
  const setOverlay = useShellStore((state) => state.setOverlay);
  const { settings } = useSettingsData();
  const [minimum, setMinimum] = useState<LogLevel>('debug');
  const [scope, setScope] = useState('');
  const [query, setQuery] = useState('');
  const readGeneration = useRef(0);
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const exportLogs = async (errorsOnly: boolean) => {
    setExporting(true);
    setActionFailed(false);
    try {
      await log.export(errorsOnly);
    } catch {
      setActionFailed(true);
    } finally {
      setExporting(false);
    }
  };
  const open = overlay === 'logs';
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setLoading(true);
      setEntries([]);
      setFailed(false);
      setActionFailed(false);
    }
  }
  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }),
    [locale],
  );

  useEffect(() => {
    if (!open) return;
    let current = true;
    const refresh = () => {
      const generation = readGeneration.current;
      void log
        .read({ limit: 4000 })
        .then((found) => {
          if (current && generation === readGeneration.current) {
            setFailed(false);
            setEntries((known) => {
              const fromDisk = new Set(found.map(identity));
              return [...found, ...known.filter((entry) => !fromDisk.has(identity(entry)))]
                .sort((left, right) => right.at - left.at || right.id - left.id)
                .slice(0, 4000);
            });
          }
        })
        .catch(() => {
          if (current) setFailed(true);
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    const stop = log.subscribe((entry) => {
      setEntries((known) =>
        [entry, ...known.filter((item) => identity(item) !== identity(entry))]
          .sort((left, right) => right.at - left.at || right.id - left.id)
          .slice(0, 4000),
      );
    });
    return () => {
      current = false;
      clearInterval(timer);
      stop();
    };
  }, [log, open]);

  const visible = entries
    .filter(
      (entry) =>
        atLeast(entry.level, minimum) &&
        (!scope || entry.scope === scope) &&
        (!query || JSON.stringify(entry).toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    )
    .slice(0, 100);
  const scopes = [...new Set(entries.map((entry) => entry.scope))].sort();

  return (
    <Dialog
      open={open}
      onClose={() => setOverlay('none')}
      title={t('logs.title')}
      description={t('logs.description')}
      closeLabel={t('logs.close')}
      size="lg"
      footer={
        <>
          <Button disabled={exporting} onClick={() => void exportLogs(false)}>
            {t('logs.exportAll')}
          </Button>
          <Button disabled={exporting} onClick={() => void exportLogs(true)}>
            {t('logs.exportErrors')}
          </Button>
          <Button
            onClick={() => {
              void log.openDirectory().catch(() => setActionFailed(true));
            }}
          >
            {t('logs.openFolder')}
          </Button>
          <Button
            disabled={loading || exporting || entries.length === 0}
            onClick={() => {
              readGeneration.current += 1;
              void log
                .clear()
                .then(() => setEntries([]))
                .catch(() => setActionFailed(true));
            }}
          >
            {t('logs.clear')}
          </Button>
        </>
      }
    >
      <div className={styles.filters}>
        <span>{t(settings.logging.debugEnabled ? 'logs.debug' : 'logs.normal')}</span>
        <label>
          {t('logs.minLevel')}
          <select value={minimum} onChange={(event) => setMinimum(event.target.value as LogLevel)}>
            {LOG_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label={t('logs.allScopes')}
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="">{t('logs.allScopes')}</option>
          {scopes.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label={t('logs.search')}
          placeholder={t('logs.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="ghost"
          onClick={() =>
            useShellStore.setState({
              overlay: 'none',
              settingsOpen: true,
              settingsSection: 'logging',
            })
          }
        >
          {t('logs.configure')}
        </Button>
      </div>
      {actionFailed && <p role="alert">{t('logs.actionFailed')}</p>}
      {exporting && <Spinner label={t('logs.exporting')} />}
      {loading ? (
        <Spinner label={t('logs.loading')} />
      ) : failed ? (
        <p className={styles.state}>{t('logs.failed')}</p>
      ) : visible.length === 0 ? (
        <p className={styles.state}>{t('logs.empty')}</p>
      ) : (
        <ol className={styles.entries} aria-label={t('logs.list')}>
          {visible.map((entry) => (
            <li className={styles.entry} key={identity(entry)}>
              <time className={styles.time} dateTime={new Date(entry.at).toISOString()}>
                {dates.format(entry.at)}
              </time>
              <span className={styles.level} data-level={entry.level}>
                {entry.level.toUpperCase()}
              </span>
              <span className={styles.scope}>{entry.scope}</span>
              <span className={styles.message}>
                {entry.message}
                {entry.context && (
                  <span className={styles.summary}>
                    {[
                      entry.context.repository?.split(/[\\/]/).at(-1),
                      entry.context.result === 'completado' ? undefined : entry.context.result,
                      entry.context.durationMs === undefined
                        ? undefined
                        : `${entry.context.durationMs} ms`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </span>
              {(entry.context || entry.detail || entry.sessionId) && (
                <details className={styles.detail}>
                  <summary>
                    {t('logs.technical')}
                    {entry.context?.durationMs !== undefined && ` · ${entry.context.durationMs} ms`}
                    {entry.context?.errorCode && ` · ${entry.context.errorCode}`}
                  </summary>
                  <pre>
                    {JSON.stringify(
                      {
                        sessionId: entry.sessionId,
                        appVersion: entry.appVersion,
                        platform: entry.platform,
                        gitVersion: entry.gitVersion,
                        origin: entry.origin,
                        debugEnabled: entry.debugEnabled,
                        ...entry.context,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  {entry.detail && <pre>{entry.detail}</pre>}
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

import { useMemo, useState } from 'react';

import { AppLogo } from '@app/AppLogo';
import { useGestures } from '@app/GestureContext';
import { APP_VERSION } from '@app/metadata';
import { HelpIcon, SupportIcon } from '@app/ShellIcons';
import { isoDay, type Library } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { BigActionButton } from '@ui/BigActionButton';
import type { HeatmapCell } from '@ui/heatmap';

import { ActivityHeatmap } from './ActivityHeatmap';
import { statsSince, STATS_MONTHS, usageDays } from './stats';
import styles from './HomePanel.module.css';

const now = () => Date.now();

interface HomePanelProps {
  repositories: readonly RepoSummary[] | null;
  library: Library | null;
}

/** Identidad y actividad general cuando no hay un repositorio seleccionado. */
export function HomePanel({ library }: HomePanelProps) {
  const { t, locale } = useI18n();
  const gestures = useGestures();
  const dates = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [at] = useState(now);
  const days = useMemo(
    () => usageDays(library?.usage ?? {}, isoDay(statsSince(at))),
    [at, library],
  );
  const activeDays = days.filter((day) => day.value > 0).length;
  const describeDay = (cell: HeatmapCell) =>
    t('repositories.home.usageDay', {
      count: cell.value,
      date: dates.format(new Date(`${cell.date}T00:00:00`)),
    });

  return (
    <div className={styles.home}>
      <div className={styles.content}>
        <header className={styles.identity}>
          <button
            type="button"
            className={styles.logoButton}
            aria-label={t('gesture.openAbout')}
            title={t('gesture.openAbout')}
            onClick={() => gestures.run('shell.openAbout')}
          >
            <AppLogo className={styles.logo} />
          </button>
          <p className={styles.version}>{t('about.version', { version: APP_VERSION })}</p>
          <p className={styles.tagline}>{t('about.tagline')}</p>
        </header>

        <ActivityHeatmap
          days={days}
          end={isoDay(at)}
          label={t('repositories.home.usageLabel')}
          total={t(
            activeDays === 1 ? 'repositories.home.usageTotalOne' : 'repositories.home.usageTotal',
            { count: numbers.format(activeDays), months: STATS_MONTHS },
          )}
          describeDay={describeDay}
        />

        <footer className={styles.footer}>
          <BigActionButton
            icon={<SupportIcon />}
            label={t('repositories.home.supportLabel')}
            aria-label={t('gesture.support')}
            title={t('gesture.support')}
            onClick={() => gestures.run('shell.support')}
          />
          <BigActionButton
            icon={<HelpIcon />}
            label={t('repositories.home.helpLabel')}
            aria-label={t('gesture.openHelp')}
            title={t('gesture.openHelp')}
            onClick={() => gestures.run('shell.openHelp')}
          />
        </footer>
      </div>
    </div>
  );
}

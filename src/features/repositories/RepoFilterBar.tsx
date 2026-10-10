import { useGestures } from '@app/GestureContext';
import type { LibraryLayout, RepoSort } from '@core/domain/library';
import type { MessageKey } from '@i18n/messages';
import { useI18n } from '@i18n/useI18n';
import { SearchInput } from '@ui/SearchInput';
import { SegmentedControl } from '@ui/SegmentedControl';

import { FILTER_INPUT_ID } from './repositoryGestures';
import { ListIcon, SortByDateIcon, SortByNameIcon, SpaceIcon } from './RepositoryIcons';
import styles from './RepoFilterBar.module.css';

/**
 * Los dos repartos del panel, en el orden en que se ofrecen.
 *
 * El interruptor enseña **los dos a la vez** en vez de un botón que se hunde:
 * un solo botón obligaba a leer su rótulo para saber si lo que se ve ahora son
 * los recientes o las zonas, y con dos segmentos el que está encendido lo dice
 * sin leer nada.
 */
const LAYOUTS = [
  { value: 'list', label: 'repositories.layout.list' },
  { value: 'spaces', label: 'repositories.layout.spaces' },
] as const satisfies readonly { value: string; label: MessageKey }[];

/** Los dos criterios de ordenación, en el orden en que se ofrecen. */
const SORTS = [
  { value: 'name', label: 'repositories.sort.name' },
  { value: 'lastOpened', label: 'repositories.sort.lastOpened' },
] as const satisfies readonly { value: string; label: MessageKey }[];

interface RepoFilterBarProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  sort: RepoSort;
  onSortChange: (sort: RepoSort) => void;
  layout: LibraryLayout;
  onLayoutChange: (layout: LibraryLayout) => void;
  shown: number;
  total: number;
}

/**
 * El filtro, el orden y el interruptor de reparto, en la misma barra.
 *
 * El conteo va dentro del propio campo —«3 de 12»— porque es una propiedad de lo
 * que se acaba de escribir, no un dato aparte, y porque así ocupa su sitio desde
 * el primer momento y la barra no cambia de alto al aparecer.
 *
 * El interruptor de reparto vive aquí y no en la cabecera de su sección porque es
 * lo que decide **qué** hay debajo, igual que el orden: los dos son mandos del
 * panel entero. Enseña las dos casillas a la vez —lista simple y espacios— y la
 * encendida dice en cuál se está sin que haya que leer ningún rótulo.
 */
export function RepoFilterBar({
  filter,
  onFilterChange,
  sort,
  onSortChange,
  layout,
  onLayoutChange,
  shown,
  total,
}: RepoFilterBarProps) {
  const { t } = useI18n();
  const gestures = useGestures();
  const cycle = gestures.get('repos.cycleSort');

  return (
    <div className={styles.bar}>
      <SearchInput
        id={FILTER_INPUT_ID}
        className={styles.search}
        label={t('repositories.filter.label')}
        placeholder={t('repositories.filter.placeholder')}
        clearLabel={t('repositories.filter.clear')}
        resultsLabel={t('repositories.filter.count', { shown, total })}
        value={filter}
        onChange={onFilterChange}
      />

      <span className={styles.control}>
        <SegmentedControl
          label={t('repositories.layout.label')}
          hideLabels
          value={layout}
          options={LAYOUTS.map((option) => ({
            ...option,
            label: t(option.label),
            icon: option.value === 'spaces' ? <SpaceIcon /> : <ListIcon />,
          }))}
          onChange={(next) => {
            onLayoutChange(next === layout ? (layout === 'list' ? 'spaces' : 'list') : next);
          }}
        />
      </span>

      {cycle && (
        <span className={styles.control}>
          <SegmentedControl
            label={t('repositories.sort.label')}
            hideLabels
            value={sort}
            options={SORTS.map((option) => ({
              ...option,
              label: t(option.label),
              icon: option.value === 'name' ? <SortByNameIcon /> : <SortByDateIcon />,
            }))}
            onChange={(next) => {
              onSortChange(next === sort ? (sort === 'name' ? 'lastOpened' : 'name') : next);
            }}
          />
        </span>
      )}
    </div>
  );
}

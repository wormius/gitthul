import { useEffect, useRef, type ReactNode } from 'react';

import { useI18n } from '@i18n/useI18n';
import { Checkbox } from '@ui/Checkbox';
import { Dropdown } from '@ui/Dropdown';
import { SearchInput } from '@ui/SearchInput';
import { SegmentedControl } from '@ui/SegmentedControl';
import type { MenuEntry } from '@ui/menu';

import styles from './FileListToolbar.module.css';
import type { FileSort, FileView } from './staging';

interface FileListToolbarProps {
  actions?: ReactNode;
  filter: string;
  onFilterChange: (filter: string) => void;
  sort: FileSort;
  onSortChange: (sort: FileSort) => void;
  view: FileView;
  onViewChange: (view: FileView) => void;
  /** Cuántos archivos quedan tras filtrar, ya sumados de todas las listas. */
  matches: number;
  /**
   * Cambia cuando alguien pide el foco del filtro — `working.focusFilter`.
   *
   * Va como número y no como bandera por lo mismo que `goTo` de la tabla:
   * pedirlo dos veces seguidas tiene que traer el foco dos veces, aunque nadie
   * lo haya movido en medio.
   */
  focusRequest?: number;
  treeExpanded?: boolean;
  onTreeExpandedChange?: (expanded: boolean) => void;
  showAllFiles?: boolean;
  onShowAllFilesChange?: (show: boolean) => void;
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 4.5h10M3 8h10M3 11.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 2.6h3l.9 1.2h3.1v3.4h-7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.2 7.2v4.7h2.1M4.2 9.3h2.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="7.4"
        y="7.7"
        width="5.9"
        height="3"
        rx=".7"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect
        x="7.4"
        y="11.4"
        width="5.9"
        height="3"
        rx=".7"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 3.5v9M4 12.5 2 10.5M4 12.5l2-2M9 4.5h5M9 8h4M9 11.5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Filtro, orden y lista/árbol: los tres controles que gobiernan **todas** las
 * listas de archivos del panel derecho a la vez.
 *
 * Son uno solo y no uno por lista porque los tres estados viven en el store: el
 * panel derecho enseña una cosa a la vez —Seguimiento y Stage, o los archivos de
 * un commit, o una comparación—, así que tener tres filtros distintos que nunca
 * se ven juntos solo serviría para olvidar cuál estaba escrito dónde.
 */
export function FileListToolbar({
  actions,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  matches,
  focusRequest,
  treeExpanded,
  onTreeExpandedChange,
  showAllFiles,
  onShowAllFilesChange,
}: FileListToolbarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const seen = useRef(focusRequest);

  useEffect(() => {
    if (focusRequest === undefined || seen.current === focusRequest) return;

    seen.current = focusRequest;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const sorts: readonly { key: FileSort; label: string }[] = [
    { key: 'path', label: t('working.fileList.sort.path') },
    { key: 'name', label: t('working.fileList.sort.name') },
    { key: 'change', label: t('working.fileList.sort.change') },
  ];

  const items: readonly MenuEntry[] = sorts.map((option) => ({
    key: option.key,
    label: option.label,
    checked: option.key === sort,
    onSelect: () => {
      onSortChange(option.key);
    },
  }));

  return (
    <div className={styles.toolbar}>
      <div className={styles.primary}>
        {actions}
        <SearchInput
          ref={inputRef}
          className={styles.filter}
          label={t('working.fileList.filter')}
          placeholder={t('working.fileList.filterPlaceholder')}
          clearLabel={t('working.fileList.clearFilter')}
          resultsLabel={
            filter.trim() === '' ? undefined : t('working.fileList.matches', { count: matches })
          }
          value={filter}
          onChange={onFilterChange}
        />

        <Dropdown
          label={t('working.fileList.sortBy')}
          menuLabel={t('working.fileList.sortBy')}
          icon={<SortIcon />}
          hideLabel
          size="sm"
          variant="ghost"
          align="end"
          items={items}
        />

        <SegmentedControl<FileView>
          label={t('working.fileList.view')}
          value={view}
          onChange={(next) => {
            onViewChange(next === view ? (view === 'flat' ? 'tree' : 'flat') : next);
          }}
          hideLabels
          options={[
            { value: 'flat', label: t('working.fileList.viewFlat'), icon: <ListIcon /> },
            { value: 'tree', label: t('working.fileList.viewTree'), icon: <TreeIcon /> },
          ]}
        />
      </div>

      {view === 'tree' &&
        ((treeExpanded !== undefined && onTreeExpandedChange) ||
          (showAllFiles !== undefined && onShowAllFilesChange)) && (
          <div className={styles.treeActions}>
            {treeExpanded !== undefined && onTreeExpandedChange && (
              <button
                type="button"
                className={styles.treeAction}
                onClick={() => {
                  onTreeExpandedChange(!treeExpanded);
                }}
              >
                {t(treeExpanded ? 'working.fileList.collapseAll' : 'working.fileList.expandAll')}
              </button>
            )}
            {showAllFiles !== undefined && onShowAllFilesChange && (
              <Checkbox
                className={styles.allFiles}
                label={t('working.staging.showAll')}
                checked={showAllFiles}
                onChange={(event) => onShowAllFilesChange(event.target.checked)}
              />
            )}
          </div>
        )}
    </div>
  );
}

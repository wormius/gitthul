import { useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { useRepositoryActions } from '@features/repositories/useRepositoryActions';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@features/settings/sections';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';
import { describeError } from '@core/domain/errors';
import { CommandPalette, type CommandGroup } from '@ui/CommandPalette';
import { Button } from '@ui/Button';
import { ProgressBar } from '@ui/ProgressBar';

import styles from './GlobalSearch.module.css';
import { SearchResultIcon } from './SearchResultIcon';
import { usePorts } from '../PortsContext';
import { GestureContext } from '../GestureContext';
import { newTerminalSurface, useShellStore } from '../shellStore';
import { activeTab } from '../tabs';
import {
  createSearchSession,
  rankResults,
  searchKinds,
  type SearchKind,
  type SearchBatch,
  type SearchResult,
  type SearchScope,
  type SearchTarget,
  type SearchView,
} from './searchEngine';

const OPTIONS: readonly [SettingsSectionId, MessageKey][] = [
  ['recovery', 'settings.storage.cleanup'],
  ['recovery', 'settings.backup.title'],
  ['recovery', 'settings.backup.enabled'],
  ['recovery', 'settings.backup.maxMiB'],
  ['appearance', 'settings.appearance.fonts'],
  ['appearance', 'settings.appearance.mode'],
  ['appearance', 'settings.appearance.theme'],
  ['appearance', 'settings.appearance.variants'],
  ['appearance', 'settings.appearance.density'],
  ['appearance', 'settings.appearance.uiFont'],
  ['appearance', 'settings.appearance.uiFontSize'],
  ['appearance', 'settings.appearance.codeFont'],
  ['appearance', 'settings.appearance.codeFontSize'],
  ['appearance', 'settings.appearance.toastPosition'],
  ['git', 'settings.git.executablePath'],
  ['git', 'settings.git.pullStrategy'],
  ['git', 'settings.git.profiles'],
  ['updates', 'settings.updates.checkOnStartup'],
  ['updates', 'settings.updates.checkNow'],
  ['updates', 'settings.updates.currentVersion'],
  ['logging', 'settings.logging.debug'],
];

export function GlobalSearch() {
  const { t } = useI18n();
  const { git } = usePorts();
  const actions = useRepositoryActions();
  const gestures = useContext(GestureContext);
  const repositoriesShortcut = gestures?.get('shell.goToRepositories')?.shortcutLabel ?? undefined;
  const settingsShortcut = gestures?.get('shell.openSettings')?.shortcutLabel ?? undefined;
  const terminalShortcut = gestures?.get('shell.openTerminalTab')?.shortcutLabel ?? undefined;
  const repositories = useRepositoriesStore((state) => state.repositories);
  const library = useRepositoriesStore((state) => state.library);
  const listError = useRepositoriesStore((state) => state.listError);
  const shell = useShellStore();
  const tab = activeTab(shell);
  const view: SearchView = shell.settingsOpen
    ? 'settings'
    : tab?.surface.kind === 'working'
      ? 'working'
      : tab?.surface.kind === 'terminal'
        ? 'terminal'
        : 'repositories';
  const activeRepo =
    tab?.surface.kind === 'working'
      ? tab.surface.repoId
      : view === 'terminal'
        ? tab?.context.repository?.repoId
        : undefined;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('view');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [moreKinds, setMoreKinds] = useState<Partial<Record<SearchKind, boolean>>>({});
  const [category, setCategory] = useState<SearchKind | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  const [failures, setFailures] = useState<string[]>([]);
  const session = useRef<{
    controller: AbortController;
    search: ReturnType<typeof createSearchSession>;
    loading: boolean;
  } | null>(null);
  const open = shell.overlay === 'search';
  const loading = busy || ((repositories === null || library === null) && listError === null);
  const libraryFailure = listError ? describeError(listError) : null;

  useEffect(() => {
    if (!open || (repositories !== null && library !== null)) return;
    const controller = new AbortController();
    void actions.load(controller.signal);
    return () => controller.abort();
  }, [open, repositories, library, actions]);

  const app = useMemo<SearchResult[]>(
    () => [
      ...(library?.spaces ?? []).map((space): SearchResult => ({
        key: `space:${space.id}`,
        kind: 'spaces',
        label: space.name,
        onSelect: () => actions.openSpace(space.id),
      })),
      {
        key: 'mode:repositories',
        kind: 'modes',
        label: t('gesture.goToRepositories'),
        matchTexts: [t('search.group.repositories')],
        ...(repositoriesShortcut ? { shortcut: repositoriesShortcut } : {}),
        onSelect: () => useShellStore.getState().goToRepositories(),
      },
      {
        key: 'mode:settings',
        kind: 'modes',
        label: t('gesture.openSettings'),
        matchTexts: [t('search.context.settings')],
        ...(settingsShortcut ? { shortcut: settingsShortcut } : {}),
        onSelect: () => useShellStore.getState().openSettings(),
      },
      {
        key: 'mode:terminal',
        kind: 'modes',
        label: t('gesture.openTerminalTab'),
        matchTexts: [t('view.terminal.title')],
        ...(terminalShortcut ? { shortcut: terminalShortcut } : {}),
        onSelect: () => {
          const state = useShellStore.getState();
          const terminal = state.tabs.find((candidate) => candidate.surface.kind === 'terminal');
          if (terminal) state.activateTab(terminal.id);
          else state.openSurfaceTab(newTerminalSurface(''));
        },
      },
      ...SETTINGS_SECTIONS.map((section): SearchResult => ({
        key: `settings:${section.id}`,
        kind: 'settings',
        label: t(section.labelKey),
        onSelect: () => useShellStore.getState().openSettings(section.id),
      })),
      {
        key: 'option:fontSize',
        kind: 'options',
        label: t('search.fontSize'),
        description: t('settings.section.appearance'),
        onSelect: () => {
          useShellStore.getState().openSettings('appearance');
          useShellStore.setState({ settingsFocus: 'settings.appearance.uiFontSize' });
        },
      },
      ...OPTIONS.map(([section, key]): SearchResult => ({
        key: `option:${key}`,
        kind: 'options',
        label: t(key),
        description: t(SETTINGS_SECTIONS.find((candidate) => candidate.id === section)!.labelKey),
        onSelect: () => {
          useShellStore.getState().openSettings(section);
          useShellStore.setState({ settingsFocus: key });
        },
      })),
      ...(gestures?.list ?? [])
        .filter(
          (gesture) =>
            !gesture.hiddenInSearch &&
            !gesture.disabled &&
            !['shell.goToRepositories', 'shell.openSettings', 'shell.openTerminalTab'].includes(
              gesture.id,
            ),
        )
        .map((gesture): SearchResult => ({
          key: `action:${gesture.id}`,
          kind: 'actions',
          label: gesture.label,
          ...(gesture.shortcutLabel ? { shortcut: gesture.shortcutLabel } : {}),
          onSelect: gesture.run,
        })),
    ],
    [actions, library, t, repositoriesShortcut, settingsShortcut, terminalShortcut, gestures],
  );

  function acceptBatch(batch: SearchBatch) {
    setResults((previous) => {
      const unique = new Map(previous.map((result) => [result.key, result]));
      for (const result of batch.items) unique.set(result.key, result);
      return [...unique.values()];
    });
    setMoreKinds((previous) => ({ ...previous, [batch.kind]: batch.hasMore }));
  }
  async function expand(kind: SearchKind, count = 10) {
    const current = session.current;
    if (!current || current.loading || current.controller.signal.aborted) return;
    current.loading = true;
    setBusy(true);
    try {
      const batch = await current.search.next(kind, count);
      if (session.current === current && !current.controller.signal.aborted) acceptBatch(batch);
    } finally {
      current.loading = false;
      if (session.current === current && !current.controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const navigate = (target: SearchTarget) => useShellStore.setState({ searchNavigation: target });
    const search = createSearchSession({
      view,
      scope,
      query,
      ...(activeRepo ? { activeRepo } : {}),
      repositories: repositories ?? [],
      app,
      git,
      signal: controller.signal,
      open: (repo, target) => {
        actions.open(repo, target ? () => navigate(target) : undefined);
      },
      openWorktree: (path) => {
        const known = repositories?.find((repo) => repo.path === path);
        if (known) {
          actions.open(known);
          return;
        }
        void git
          .openRepository(path)
          .then((repo) => {
            actions.open(repo);
          })
          .catch(() => {
            useShellStore.getState().setStatus({ tone: 'danger', key: 'search.openFailed' });
          });
      },
      onError: (repo) => {
        if (!controller.signal.aborted)
          setFailures((previous) =>
            previous.includes(repo.name) ? previous : [...previous, repo.name],
          );
      },
    });
    const current = { controller, search, loading: true };
    session.current = current;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setResults([]);
      setMoreKinds({});
      setCategory(null);
      setVisibleCount(10);
      setFailures([]);
      setBusy(true);
    });
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            for await (const batch of search.preview()) {
              if (controller.signal.aborted || session.current !== current) return;
              acceptBatch(batch);
            }
          } finally {
            current.loading = false;
            if (!controller.signal.aborted && session.current === current) setBusy(false);
          }
        })();
      },
      query.trim() ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();

      if (session.current === current) session.current = null;
    };
  }, [open, query, scope, view, activeRepo, repositories, app, git, actions]);

  const ranked = rankResults(
    category ? results.filter((result) => result.kind === category) : results,
    query,
    view,
  );
  const visible = ranked.slice(0, visibleCount);
  const groups: CommandGroup[] = visible.length
    ? [
        {
          key: category ?? 'best',
          label: category ? t(`search.group.${category}`) : t('search.best'),
          items: visible.map((result) => ({
            ...result,
            icon: <SearchResultIcon kind={result.kind} />,
            description: [t(`search.group.${result.kind}`), result.description]
              .filter(Boolean)
              .join(' · '),
          })),
        },
      ]
    : [];
  const remaining = ranked.length > visibleCount;
  const deferred = category ? Boolean(moreKinds[category]) : Object.values(moreKinds).some(Boolean);
  const chooseCategory = (kind: SearchKind | null) => {
    setCategory(kind);
    setVisibleCount(10);
    if (kind && results.filter((result) => result.kind === kind).length < 10 && moreKinds[kind])
      void expand(kind, 10 - results.filter((result) => result.kind === kind).length);
  };
  const resetResults = () => {
    session.current?.controller.abort();
    setResults([]);
    setMoreKinds({});
    setCategory(null);
    setVisibleCount(10);
    setFailures([]);
    setBusy(true);
  };
  const close = () => {
    session.current?.controller.abort();
    shell.setOverlay('none');
    setQuery('');
    setScope('view');
    setCategory(null);
    setResults([]);
    setMoreKinds({});
    setVisibleCount(10);
    setFailures([]);
    setBusy(false);
  };
  return (
    <CommandPalette
      key={`${scope}:${category ?? 'best'}`}
      open={open}
      onClose={close}
      label={t('search.label')}
      searchLabel={t('search.field')}
      placeholder={t('search.placeholder')}
      query={query}
      onQueryChange={(value) => {
        resetResults();
        setQuery(value);
      }}
      groups={groups}
      emptyLabel={
        loading
          ? t('search.loading')
          : deferred
            ? t('search.previewEmpty')
            : t('search.empty.title')
      }
      emptyDescription={loading ? undefined : t('search.empty.description')}
      toolbar={
        <>
          {(['view', 'all'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              aria-pressed={scope === value}
              onClick={() => {
                if (scope !== value) {
                  resetResults();
                  setScope(value);
                }
              }}
            >
              {t(value === 'view' ? 'search.scope.view' : 'search.scope.everything')}
            </Button>
          ))}
          <span className={styles.context}>
            {scope === 'view' && activeRepo && view !== 'settings'
              ? shell.tabs.find((candidate) => candidate.context.repository?.repoId === activeRepo)
                  ?.context.repository?.repoName
              : t(`search.context.${scope === 'all' ? 'all' : view}`)}
          </span>
        </>
      }
      status={
        <>
          {loading && <ProgressBar label={t('search.loading')} />}
          {libraryFailure && (
            <p role="alert">{t(libraryFailure.titleKey, libraryFailure.params)}</p>
          )}
          {failures.length > 0 && (
            <p role="status">{t('search.partial', { repos: failures.join(', ') })}</p>
          )}
        </>
      }
      footer={
        <div className={styles.footer}>
          {category && (
            <Button onClick={() => chooseCategory(null)}>{t('search.backToBest')}</Button>
          )}
          {(remaining || (category && moreKinds[category])) && (
            <Button
              disabled={busy}
              onClick={() => {
                const nextCount = visibleCount + 10;
                setVisibleCount(nextCount);
                if (category && moreKinds[category] && ranked.length < nextCount)
                  void expand(category, nextCount - ranked.length);
              }}
            >
              {t('search.more')}
            </Button>
          )}
          <div className={styles.categories}>
            {!category &&
              query.trim() &&
              searchKinds(view)
                .filter((kind) => moreKinds[kind] || results.some((result) => result.kind === kind))
                .map((kind) => (
                  <Button key={kind} size="sm" disabled={busy} onClick={() => chooseCategory(kind)}>
                    {t('search.category', { kind: t(`search.group.${kind}`) })}
                  </Button>
                ))}
          </div>
          {deferred && <p>{t('search.previewNote')}</p>}
        </div>
      }
    />
  );
}

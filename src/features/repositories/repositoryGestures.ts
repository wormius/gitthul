import { useMemo } from 'react';

import type { GestureDefinition } from '@app/gestures';
import { useShellStore } from '@app/shellStore';
import { isHome } from '@app/tabs';
import { useI18n } from '@i18n/useI18n';

import { useRepositoriesStore } from './repositoriesStore';
import { useRepositoryActions } from './useRepositoryActions';

export const FILTER_INPUT_ID = 'repositories-filter';
export const RECENT_SECTION_ID = 'repositories-recent';
export const ALL_SECTION_ID = 'repositories-all';

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

export function useRepositoryGestureDefinitions(): readonly GestureDefinition[] {
  const { t } = useI18n();
  const actions = useRepositoryActions();
  const home = useShellStore(isHome);
  const settingsOpen = useShellStore((state) => state.settingsOpen);
  const selected = useRepositoriesStore((state) => state.selected);
  const selectedIds = useRepositoriesStore((state) => state.selectedIds);
  const batchBusy = useRepositoriesStore((state) => state.batchBusy);
  const library = useRepositoriesStore((state) => state.library);
  const repositories = useRepositoriesStore((state) => state.repositories);
  const setRenaming = useRepositoriesStore((state) => state.setRenaming);
  const openDialog = useRepositoriesStore((state) => state.openDialog);

  return useMemo<readonly GestureDefinition[]>(() => {
    const away = !home || settingsOpen || batchBusy;
    const repo = selected;
    const chosen = (repositories ?? []).filter((candidate) => selectedIds.has(candidate.id));
    const multiple = chosen.length > 1;
    const counted = { count: chosen.length };
    const named = { repo: repo?.name ?? '' };
    const spaces = library?.spaces ?? [];
    const showingSpaces = library?.layout === 'spaces';
    const view = library?.view;
    const current =
      view?.kind === 'space' ? spaces.find((space) => space.id === view.id) : undefined;
    const index = current ? spaces.findIndex((space) => space.id === current.id) : -1;
    const inSpace = { space: current?.name ?? '' };
    const inCurrent = Boolean(repo && current?.repos.includes(repo.id));
    const bothNamed = { repo: repo?.name ?? '', space: current?.name ?? '' };
    const currentMembers = current
      ? (repositories ?? []).filter((candidate) => current.repos.includes(candidate.id))
      : [];

    return [
      {
        id: 'repos.openFolder',
        label: t('gesture.repos.openFolder'),
        triggers: ['button', 'menu', 'shortcut', 'search'],
        shortcut: 'Mod+O',
        allowWhileTyping: true,
        disabled: away,
        hiddenInSearch: away,
        run: actions.openFolder,
      },
      {
        id: 'repos.create',
        label: t('gesture.repos.create'),
        triggers: ['button', 'menu', 'shortcut', 'search'],
        shortcut: 'Mod+N',
        allowWhileTyping: true,
        disabled: away,
        hiddenInSearch: away,
        run: () => openDialog({ kind: 'create' }),
      },
      {
        id: 'repos.clone',
        label: t('gesture.repos.clone'),
        triggers: ['button', 'menu', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+C',
        allowWhileTyping: true,
        disabled: away,
        hiddenInSearch: away,
        run: () => openDialog({ kind: 'clone' }),
      },
      {
        id: 'repos.open',
        label: multiple
          ? t('repositories.menu.openSelected', counted)
          : repo
            ? t('gesture.repos.open', named)
            : t('gesture.repos.openNone'),
        triggers: ['activate', 'menu', 'search'],
        disabled: away || chosen.length === 0,
        hiddenInSearch: away || chosen.length === 0,
        run: () => {
          if (multiple) actions.openMany(chosen);
          else if (repo) actions.open(repo);
        },
      },
      {
        id: 'repos.forget',
        label: multiple
          ? t('repositories.menu.forgetSelected', counted)
          : repo
            ? t('gesture.repos.forget', named)
            : t('gesture.repos.forgetNone'),
        triggers: ['menu', 'search'],
        disabled: away || chosen.length === 0,
        hiddenInSearch: away || chosen.length === 0,
        run: () => {
          if (multiple) openDialog({ kind: 'forgetMany', repos: chosen });
          else if (repo) openDialog({ kind: 'forget', repo });
        },
      },
      {
        id: 'repos.reveal',
        label: repo ? t('gesture.repos.reveal', named) : t('gesture.repos.revealNone'),
        triggers: ['button', 'menu', 'search'],
        disabled: away || !repo,
        hiddenInSearch: away || !repo,
        run: () => {
          if (repo) actions.reveal(repo);
        },
      },
      {
        id: 'repos.locate',
        label: repo ? t('gesture.repos.locate', named) : t('gesture.repos.locateNone'),
        triggers: ['button', 'menu', 'search'],
        disabled: away || !repo,
        hiddenInSearch: away || !repo,
        run: () => {
          if (repo) actions.locate(repo);
        },
      },
      {
        id: 'repos.focusFilter',
        label: t('gesture.repos.focusFilter'),
        triggers: ['menu', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => document.getElementById(FILTER_INPUT_ID)?.focus(),
      },
      {
        id: 'repos.cycleSort',
        label: t('gesture.repos.cycleSort'),
        triggers: ['button', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: actions.cycleSort,
      },
      {
        id: 'repos.viewRecent',
        label: t('gesture.repos.viewRecent'),
        triggers: ['menu', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => {
          actions.setView({ kind: 'recent' });
          scrollTo(RECENT_SECTION_ID);
        },
      },
      {
        id: 'repos.viewAll',
        label: t('gesture.repos.viewAll'),
        triggers: ['menu', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => {
          actions.setView({ kind: 'all' });
          scrollTo(ALL_SECTION_ID);
        },
      },
      {
        id: 'repos.toggleSpaces',
        label: t(showingSpaces ? 'gesture.repos.showList' : 'gesture.repos.showSpaces'),
        triggers: ['button', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => actions.setLayout(showingSpaces ? 'list' : 'spaces'),
      },
      {
        id: 'repos.chooseAvatar',
        label: repo ? t('gesture.repos.chooseAvatar', named) : t('gesture.repos.chooseAvatarNone'),
        triggers: ['menu', 'search'],
        disabled: away || !repo,
        hiddenInSearch: away || !repo,
        run: () => {
          if (repo) openDialog({ kind: 'avatar', repo });
        },
      },
      {
        id: 'repos.createSpace',
        label: t('gesture.repos.createSpace'),
        triggers: ['button', 'menu', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => openDialog({ kind: 'createSpace' }),
      },
      {
        id: 'repos.renameSpace',
        label: t(current ? 'gesture.repos.renameSpace' : 'gesture.repos.renameSpaceNone', inSpace),
        triggers: ['menu', 'search'],
        disabled: away || !current,
        hiddenInSearch: away || !current,
        run: () => {
          if (current) setRenaming(current.id);
        },
      },
      {
        id: 'repos.openAllSpace',
        label: t(
          current ? 'gesture.repos.openAllSpace' : 'gesture.repos.openAllSpaceNone',
          inSpace,
        ),
        triggers: ['button', 'menu', 'search'],
        disabled: away || !current || currentMembers.length === 0,
        hiddenInSearch: away || !current,
        run: () => {
          if (current) actions.openAll(current, currentMembers);
        },
      },
      {
        id: 'repos.deleteSpace',
        label: t(current ? 'gesture.repos.deleteSpace' : 'gesture.repos.deleteSpaceNone', inSpace),
        triggers: ['button', 'menu', 'search'],
        disabled: away || !current,
        hiddenInSearch: away || !current,
        run: () => {
          if (current) openDialog({ kind: 'deleteSpace', space: current });
        },
      },
      {
        id: 'repos.moveSpaceUp',
        label: t(current ? 'gesture.repos.moveSpaceUp' : 'gesture.repos.moveSpaceUpNone', inSpace),
        triggers: ['drag', 'menu'],
        disabled: away || !current || index <= 0,
        hiddenInSearch: true,
        run: () => {
          if (current) actions.moveSpace(current, index - 1);
        },
      },
      {
        id: 'repos.moveSpaceDown',
        label: t(
          current ? 'gesture.repos.moveSpaceDown' : 'gesture.repos.moveSpaceDownNone',
          inSpace,
        ),
        triggers: ['drag', 'menu'],
        disabled: away || !current || index < 0 || index >= spaces.length - 1,
        hiddenInSearch: true,
        run: () => {
          if (current) actions.moveSpace(current, index + 1);
        },
      },
      {
        id: 'repos.addToSpace',
        label: t(
          repo && current ? 'gesture.repos.addToSpace' : 'gesture.repos.addToSpaceNone',
          bothNamed,
        ),
        triggers: ['drag', 'menu'],
        disabled: away || !repo || !current || inCurrent,
        hiddenInSearch: true,
        run: () => {
          if (repo && current) actions.addToSpace(current, repo);
        },
      },
      {
        id: 'repos.removeFromSpace',
        label: t(
          repo && current ? 'gesture.repos.removeFromSpace' : 'gesture.repos.removeFromSpaceNone',
          bothNamed,
        ),
        triggers: ['drag', 'menu'],
        disabled: away || !repo || !current || !inCurrent,
        hiddenInSearch: true,
        run: () => {
          if (repo && current) actions.removeFromSpace(current, repo);
        },
      },
    ];
  }, [
    actions,
    home,
    settingsOpen,
    batchBusy,
    library,
    openDialog,
    repositories,
    selected,
    selectedIds,
    setRenaming,
    t,
  ]);
}

import { BranchIcon, SettingsIcon, WorktreeIcon } from '../ShellIcons';
import { RepoIcon, SpaceIcon } from '@features/repositories/RepositoryIcons';
import { RefIcon } from '@features/working/RefIcon';
import type { SearchKind } from './searchEngine';

/** Usa los mismos símbolos que los destinos de la aplicación. */
export function SearchResultIcon({ kind }: { kind: SearchKind }) {
  if (kind === 'branches') return <BranchIcon />;
  if (kind === 'worktrees') return <WorktreeIcon />;
  if (kind === 'repositories') return <RepoIcon />;
  if (kind === 'spaces') return <SpaceIcon />;
  if (kind === 'settings' || kind === 'options') return <SettingsIcon />;
  if (kind === 'tags') return <RefIcon kind="tag" />;
  if (kind === 'stashes') return <RefIcon kind="stash" />;
  const path =
    kind === 'actions'
      ? 'M9 1 3 9h4l-1 6 7-9H9z'
      : kind === 'authors'
        ? 'M3 14v-1a5 5 0 0 1 10 0v1M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
        : kind === 'wip' || kind === 'files'
          ? 'M9 2H3v12h10V6L9 2v4h4M5 9h6M5 11h4'
          : kind === 'modes'
            ? 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z'
            : 'M2 8h3M11 8h3M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

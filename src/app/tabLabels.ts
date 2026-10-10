import type { I18nContextValue } from '@i18n/I18nContext';

import type { Tab, WorkingSurface } from './tabs';

export interface TabDescription {
  label: string;
  hint?: string;
}

/** Un solo nombre para tira, barra de título y mensajes. */
export function describeTab(tab: Tab, t: I18nContextValue['t']): TabDescription {
  const repository = tab.context.repository;

  if (!repository) {
    return { label: t('tab.terminal') };
  }

  const repositoryHint = describeRepository(repository, t);
  const surfaceHint = tab.surface.kind === 'terminal' ? t('tab.terminalHint') : undefined;

  return {
    label: repository.repoName,
    hint: surfaceHint ? `${repositoryHint} · ${surfaceHint}` : repositoryHint,
  };
}

function describeRepository(repository: WorkingSurface, t: I18nContextValue['t']): string {
  return repository.worktreeOf
    ? t('tab.worktreeHint', { repo: repository.worktreeOf, branch: repository.branch })
    : t('tab.branchHint', { branch: repository.branch });
}

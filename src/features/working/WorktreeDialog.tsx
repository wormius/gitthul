import { useState } from 'react';

import type { Branch, RefTarget } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';
import { Select } from '@ui/Select';

import { suggestedWorktreePath, validateRefName } from './branchNames';

interface WorktreeDialogProps {
  repoName: string;
  repoPath: string;
  branches: readonly Branch[];
  /** Rama ya elegida: el menú de una rama la trae puesta. */
  initialBranch: string | null;
  onConfirm: (path: string, branch: RefTarget) => void;
  onCancel: () => void;
}

const NEW_BRANCH = '';

/**
 * El asistente de worktree — CU-9.
 *
 * Dos decisiones y una sugerencia: rama —existente o nueva— y carpeta, con la
 * hermana `../<repo>-<rama>` propuesta. La sugerencia se recalcula al cambiar
 * de rama **solo mientras nadie haya tocado la carpeta a mano**: sobrescribir
 * una ruta escrita por alguien porque cambió de rama sería perderle el trabajo.
 */
export function WorktreeDialog({
  repoName,
  repoPath,
  branches,
  initialBranch,
  onConfirm,
  onCancel,
}: WorktreeDialogProps) {
  const { t } = useI18n();
  const locals = branches.filter((branch) => branch.kind === 'local');
  const [branch, setBranch] = useState(initialBranch ?? locals[0]?.name ?? NEW_BRANCH);
  const [newName, setNewName] = useState('');
  const [path, setPath] = useState(() =>
    suggestedWorktreePath(repoPath, repoName, initialBranch ?? locals[0]?.name ?? ''),
  );
  const [touched, setTouched] = useState(false);

  const creatingBranch = branch === NEW_BRANCH;
  const effectiveBranch = creatingBranch ? newName.trim() : branch;
  const nameProblem = creatingBranch
    ? validateRefName(
        newName,
        branches.map((candidate) => candidate.name),
      )
    : null;
  const invalid = nameProblem !== null || path.trim() === '';

  const chooseBranch = (next: string) => {
    setBranch(next);

    if (!touched) {
      setPath(suggestedWorktreePath(repoPath, repoName, next === NEW_BRANCH ? '' : next));
    }
  };

  const nameError =
    nameProblem === 'taken'
      ? t('working.dialog.branch.taken', { branch: newName.trim() })
      : nameProblem === 'invalid'
        ? t('working.dialog.branch.invalid')
        : undefined;

  const options = [
    ...locals.map((candidate) => ({ value: candidate.name, label: candidate.name })),
    { value: NEW_BRANCH, label: t('working.dialog.worktree.newBranch') },
  ];

  return (
    <Dialog
      open
      onClose={onCancel}
      size="md"
      title={t('working.dialog.worktree.title', { repo: repoName })}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button
            variant="primary"
            disabled={invalid}
            onClick={() => {
              if (invalid) return;

              onConfirm(
                path.trim(),
                creatingBranch
                  ? { kind: 'branch', name: effectiveBranch }
                  : { kind: 'branch', name: branch },
              );
            }}
          >
            {t('working.dialog.worktree.confirm', { branch: effectiveBranch })}
          </Button>
        </>
      }
    >
      <Select
        label={t('working.dialog.worktree.branchLabel')}
        value={branch}
        options={options}
        onChange={(event) => {
          chooseBranch(event.target.value);
        }}
      />
      {creatingBranch && (
        <Input
          autoFocus
          label={t('working.dialog.worktree.newBranchLabel')}
          value={newName}
          error={nameError}
          onChange={(event) => {
            setNewName(event.target.value);

            if (!touched) setPath(suggestedWorktreePath(repoPath, repoName, event.target.value));
          }}
        />
      )}
      <Input
        label={t('working.dialog.worktree.pathLabel')}
        value={path}
        onChange={(event) => {
          setTouched(true);
          setPath(event.target.value);
        }}
      />
    </Dialog>
  );
}

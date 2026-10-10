import { useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import {
  toGitOperationError,
  type GitErrorParams,
  type GitOperationError,
} from '@core/domain/errors';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';

import type { RepositoryActions } from './useRepositoryActions';
import styles from './CreateRepoDialog.module.css';

interface CreateRepoDialogProps {
  /** El fallo `repo.notARepository` de CU-5 propone esta carpeta ya elegida. */
  parentPath?: string;
  actions: RepositoryActions;
  onClose: () => void;
}

const PATH_SEPARATOR = /[/\\]/;

function targetPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, '')}/${name}`;
}

/**
 * CU-6: crear un repositorio nuevo.
 *
 * La validación de formulario —vacío, separadores de ruta— deshabilita el
 * botón de confirmar y no es un `GitErrorPanel`; los fallos que dependen del
 * disco o de las reglas de Git se pintan dentro, sobre los campos que ya se
 * habían escrito.
 */
export function CreateRepoDialog({
  parentPath: initialParentPath,
  actions,
  onClose,
}: CreateRepoDialogProps) {
  const { t } = useI18n();

  const [parentPath, setParentPath] = useState(initialParentPath ?? '');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<GitOperationError | null>(null);

  const trimmedPath = parentPath.trim();
  const trimmedName = name.trim();
  const trimmedBranch = branch.trim();
  const nameHasSeparator = trimmedName !== '' && PATH_SEPARATOR.test(trimmedName);
  const valid =
    trimmedPath !== '' && trimmedName !== '' && !nameHasSeparator && trimmedBranch !== '';

  const submit = async () => {
    if (!valid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await actions.createRepository(trimmedPath, {
        name: trimmedName,
        initialBranch: trimmedBranch,
      });
      // Éxito: la acción ya seleccionó el repositorio creado y cerró el diálogo.
    } catch (caught) {
      setError(toGitOperationError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const choosePath = async () => {
    const path = await actions.pickFolder();

    // Cancelar el selector no es un fallo y no cambia nada.
    if (path !== null) {
      setParentPath(path);
      setError(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={t('repositories.create.title')}
      closeLabel={t('repositories.create.close')}
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            {t('repositories.create.cancel')}
          </Button>
          <Button variant="primary" disabled={!valid || submitting} onClick={() => void submit()}>
            {t('repositories.create.confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.pathRow}>
          <Input
            label={t('repositories.create.pathLabel')}
            value={parentPath}
            readOnly
            className={styles.pathInput}
          />
          <Button onClick={() => void choosePath()} disabled={submitting}>
            {t('repositories.create.browse')}
          </Button>
        </div>

        <Input
          label={t('repositories.create.nameLabel')}
          value={name}
          disabled={submitting}
          error={nameHasSeparator ? t('repositories.create.nameInvalid') : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />

        <Input
          label={t('repositories.create.branchLabel')}
          value={branch}
          disabled={submitting}
          onChange={(event) => {
            setBranch(event.target.value);
            setError(null);
          }}
        />

        {trimmedPath !== '' && trimmedName !== '' && !nameHasSeparator && (
          <p className={styles.preview}>
            {t('repositories.create.preview', { path: targetPath(trimmedPath, trimmedName) })}
          </p>
        )}

        {error && (
          <GitErrorPanel
            error={error}
            fixes={{
              chooseAnotherFolder: () => {
                void choosePath();
              },
              selectExisting: () => {
                const params = error.params as GitErrorParams['repo.alreadyExists'];

                actions.selectByPath(params.path);
              },
              retry: () => {
                void submit();
              },
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

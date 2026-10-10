import { useEffect, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { isCancelled, toGitOperationError, type GitOperationError } from '@core/domain/errors';
import type { CloneProgress } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';
import { ProgressBar } from '@ui/ProgressBar';

import type { RepositoryActions } from './useRepositoryActions';
import styles from './CloneRepoDialog.module.css';

interface CloneRepoDialogProps {
  actions: RepositoryActions;
  onClose: () => void;
}

type CloneState =
  | { kind: 'idle' }
  | { kind: 'cloning'; progress: CloneProgress | null; controller: AbortController }
  | { kind: 'error'; error: GitOperationError };

const PATH_SEPARATOR = /[/\\]/;

const PHASE_KEY: Record<CloneProgress['phase'], MessageKey> = {
  counting: 'clone.phase.counting',
  receiving: 'clone.phase.receiving',
  resolving: 'clone.phase.resolving',
  checkout: 'clone.phase.checkout',
};

/** El nombre local se propone desde la URL, y se puede cambiar a mano. */
function suggestName(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const segments = trimmed.split(/[/:]/).filter(Boolean);

  return segments[segments.length - 1] ?? '';
}

/**
 * CU-7: clonar un repositorio.
 *
 * Cancelable de verdad: el botón de cancelar aborta la señal y el rechazo es
 * `OperationCancelledError`, que no pinta ningún panel — vuelve al formulario
 * tal como estaba. Los fallos del catálogo se pintan dentro, sobre los campos
 * ya escritos. Reintentar vuelve a ejecutar el flujo de autenticación nativo.
 */
export function CloneRepoDialog({ actions, onClose }: CloneRepoDialogProps) {
  const { t } = useI18n();

  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [state, setState] = useState<CloneState>({ kind: 'idle' });
  const [targetPath, setTargetPath] = useState<string | null>(null);

  const trimmedUrl = url.trim();
  const trimmedPath = path.trim();
  const trimmedName = name.trim();
  const nameHasSeparator = trimmedName !== '' && PATH_SEPARATOR.test(trimmedName);
  const valid = trimmedUrl !== '' && trimmedPath !== '' && trimmedName !== '' && !nameHasSeparator;
  const cloning = state.kind === 'cloning';

  useEffect(() => {
    if (trimmedPath === '' || trimmedName === '' || nameHasSeparator) {
      return;
    }
    let current = true;
    void actions
      .resolveChildPath(trimmedPath, trimmedName)
      .then((resolved) => {
        if (current) setTargetPath(resolved);
      })
      .catch(() => {
        if (current) setTargetPath(null);
      });
    return () => {
      current = false;
    };
  }, [actions, nameHasSeparator, trimmedName, trimmedPath]);

  const resetIfErrored = () => {
    if (state.kind === 'error') setState({ kind: 'idle' });
  };

  const submit = async () => {
    if (!valid || cloning) return;

    const controller = new AbortController();

    setState({ kind: 'cloning', progress: null, controller });

    try {
      await actions.cloneRepository(
        {
          url: trimmedUrl,
          path: trimmedPath,
          name: trimmedName,
          onProgress: (progress) => {
            setState((prev) => (prev.kind === 'cloning' ? { ...prev, progress } : prev));
          },
        },
        { signal: controller.signal },
      );
      // Éxito: la acción ya seleccionó el repositorio clonado y cerró el diálogo.
    } catch (caught) {
      if (isCancelled(caught)) {
        setState({ kind: 'idle' });

        return;
      }

      setState({ kind: 'error', error: toGitOperationError(caught) });
    }
  };

  const choosePath = async () => {
    const chosen = await actions.pickFolder();

    if (chosen !== null) {
      setPath(chosen);
      resetIfErrored();
    }
  };

  const error = state.kind === 'error' ? state.error : null;
  const progress = state.kind === 'cloning' ? state.progress : null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={t('repositories.clone.title')}
      closeLabel={t('repositories.clone.close')}
      footer={
        cloning ? (
          <Button
            variant="primary"
            onClick={() => {
              state.controller.abort();
            }}
          >
            {t('repositories.clone.abort', { url: trimmedUrl })}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('repositories.clone.cancel')}</Button>
            <Button variant="primary" disabled={!valid} onClick={() => void submit()}>
              {t('repositories.clone.confirm')}
            </Button>
          </>
        )
      }
    >
      <div className={styles.form}>
        <Input
          label={t('repositories.clone.urlLabel')}
          value={url}
          disabled={cloning}
          onChange={(event) => {
            const value = event.target.value;

            setUrl(value);
            if (!nameTouched) setName(suggestName(value));
            resetIfErrored();
          }}
        />

        <div className={styles.pathRow}>
          <Input
            label={t('repositories.clone.pathLabel')}
            value={path}
            readOnly
            className={styles.pathInput}
          />
          <Button onClick={() => void choosePath()} disabled={cloning}>
            {t('repositories.clone.browse')}
          </Button>
        </div>

        <Input
          label={t('repositories.clone.nameLabel')}
          value={name}
          disabled={cloning}
          error={nameHasSeparator ? t('repositories.clone.nameInvalid') : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
            resetIfErrored();
          }}
        />

        {valid && targetPath !== null && (
          <p className={styles.preview}>{t('repositories.clone.preview', { path: targetPath })}</p>
        )}

        {cloning && (
          <ProgressBar
            label={progress ? t(PHASE_KEY[progress.phase]) : t('repositories.clone.starting')}
            value={
              progress && progress.total !== null
                ? (progress.received / progress.total) * 100
                : undefined
            }
          />
        )}

        {error && (
          <GitErrorPanel
            error={error}
            fixes={{
              editUrl: () => {
                setState({ kind: 'idle' });
              },
              chooseAnotherFolder: () => {
                void choosePath();
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

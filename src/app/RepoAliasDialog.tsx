import { useRef, useState } from 'react';

import type { RepoSummary } from '@core/domain/repository';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';

import { usePorts } from './PortsContext';

interface RepoAliasDialogProps {
  repo: Pick<RepoSummary, 'id' | 'name'>;
  current: string | null;
  onClose: () => void;
}

/** The draft stays open on failed persistence; only a confirmed write changes labels. */
export function RepoAliasDialog({ repo, current, onClose }: RepoAliasDialogProps) {
  const { t } = useI18n();
  const { library } = usePorts();
  const [alias, setAlias] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const close = () => {
    if (!saving.current) onClose();
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const next = await library.setAlias(repo.id, alias);
      useRepositoriesStore.getState().setLibrary(next);
      onClose();
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="sm"
      title={t('repositories.alias.title', { repo: repo.name })}
      closeLabel={t('repositories.alias.close')}
      onClose={close}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            {t('repositories.alias.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t('repositories.alias.save')}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        label={t('repositories.alias.label')}
        value={alias}
        placeholder={repo.name}
        disabled={busy}
        hint={t('repositories.alias.hint')}
        error={failed ? t('repositories.alias.failed') : undefined}
        onChange={(event) => setAlias(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void save();
        }}
      />
    </Dialog>
  );
}

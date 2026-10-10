import type { Branch, RefTarget } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';

interface RemoteBranchAheadDialogProps {
  local: Branch;
  remote: Branch;
  onReset: () => void;
  onCreateBranch: (from: RefTarget, fromLabel: string) => void;
  onCancel: () => void;
}

/**
 * La local contiene commits que no están en la remota: avanzar ya no es seguro.
 *
 * Las tres salidas son explícitas porque dos escriben referencias diferentes y
 * la tercera no escribe nada. En particular, «Crear otra rama» no inventa un
 * nombre: abre el diálogo normal de ramas apuntando a la punta remota.
 */
export function RemoteBranchAheadDialog({
  local,
  remote,
  onReset,
  onCreateBranch,
  onCancel,
}: RemoteBranchAheadDialogProps) {
  const { t } = useI18n();
  const remoteName = remote.remote ?? remote.name.split('/')[0] ?? '';
  const target: RefTarget = { kind: 'remoteBranch', name: remote.name, remote: remoteName };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('working.dialog.remoteBranchAhead.title', { branch: local.name })}
      description={t('working.dialog.remoteBranchAhead.description', {
        local: local.name,
        remote: remote.name,
        ahead: local.ahead,
        behind: local.behind,
      })}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.remoteBranchAhead.nothing')}</Button>
          <Button
            onClick={() => {
              onCreateBranch(target, remote.name);
            }}
          >
            {t('working.dialog.remoteBranchAhead.create')}
          </Button>
          <Button variant="primary" onClick={onReset}>
            {t('working.dialog.remoteBranchAhead.reset', { branch: local.name })}
          </Button>
        </>
      }
    />
  );
}

import type { Remote } from '@core/domain/refs';
import type { RepoId } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Dialog } from '@ui/Dialog';
import { RemoteAccessPanel } from '../auth/RemoteAccessPanel';

export function RemoteCredentialsDialog({
  repoId,
  remote,
  onCancel,
}: {
  repoId: RepoId;
  remote: Remote;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      title={t('working.menu.remote.credentials', { remote: remote.name })}
      closeLabel={t('working.dialog.close')}
    >
      {[...new Set([remote.fetchUrl, remote.pushUrl])].map((url) => (
        <RemoteAccessPanel key={url} repoId={repoId} url={url} />
      ))}
    </Dialog>
  );
}

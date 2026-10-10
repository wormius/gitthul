import type { Space } from '@core/domain/library';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';

interface DeleteSpaceDialogProps {
  space: Space;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteSpaceDialog({ space, count, onConfirm, onCancel }: DeleteSpaceDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('gesture.repos.deleteSpace', { space: space.name })}
      description={t('repositories.spaces.delete.description', { space: space.name, count })}
      closeLabel={t('repositories.spaces.delete.close', { space: space.name })}
      footer={
        <>
          <Button onClick={onCancel}>{t('repositories.spaces.delete.cancel')}</Button>
          <Button variant="primary" onClick={onConfirm}>
            {t('repositories.spaces.delete.confirm')}
          </Button>
        </>
      }
    >
      <p>{t('repositories.spaces.delete.keeps')}</p>
    </Dialog>
  );
}

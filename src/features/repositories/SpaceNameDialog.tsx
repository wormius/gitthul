import { useState } from 'react';

import type { Space } from '@core/domain/library';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';

import { validateSpaceName } from './collection';

interface SpaceNameDialogProps {
  spaces: readonly Space[];
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function SpaceNameDialog({ spaces, onConfirm, onCancel }: SpaceNameDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const problem = validateSpaceName(spaces, name);

  const confirm = () => {
    if (problem === null) onConfirm(name);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('repositories.spaces.create.title')}
      closeLabel={t('repositories.spaces.create.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('repositories.spaces.create.cancel')}</Button>
          <Button variant="primary" disabled={problem !== null} onClick={confirm}>
            {t('repositories.spaces.create.confirm')}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        label={t('repositories.spaces.create.nameLabel')}
        value={name}
        error={problem === 'taken' ? t('repositories.spaces.name.taken') : undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          confirm();
        }}
      />
    </Dialog>
  );
}

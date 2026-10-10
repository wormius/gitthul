import { useState } from 'react';

import type { RefTarget } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';
import { Textarea } from '@ui/Textarea';

import { validateRefName } from './branchNames';

interface TagNameDialogProps {
  at: RefTarget;
  /** Cómo se llama el punto de partida en la frase del título. */
  atLabel: string;
  taken: readonly string[];
  onConfirm: (name: string, at: RefTarget, message: string) => void;
  onCancel: () => void;
}

/**
 * Crear un tag — CU-9.
 *
 * **Un solo diálogo para ligero y anotado**, y el mensaje es lo que decide cuál
 * es: vacío deja un puntero, con texto deja un objeto de tag. Ofrecer dos
 * entradas de menú para eso obligaría a saber la diferencia antes de escribir
 * nada, y la diferencia es justamente si hay algo que escribir.
 */
export function TagNameDialog({ at, atLabel, taken, onConfirm, onCancel }: TagNameDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const problem = validateRefName(name, taken);
  const error =
    problem === 'taken'
      ? t('working.dialog.tag.taken', { tag: name.trim() })
      : problem === 'invalid'
        ? t('working.dialog.tag.invalid')
        : undefined;

  const confirm = () => {
    if (problem === null) onConfirm(name.trim(), at, message);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('working.dialog.tag.title', { at: atLabel })}
      description={t('working.dialog.tag.messageHint')}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button variant="primary" disabled={problem !== null} onClick={confirm}>
            {t('working.dialog.tag.confirm')}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        label={t('working.dialog.tag.nameLabel')}
        value={name}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;

          event.preventDefault();
          confirm();
        }}
      />
      <Textarea
        label={t('working.dialog.tag.messageLabel')}
        minRows={3}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
      />
    </Dialog>
  );
}

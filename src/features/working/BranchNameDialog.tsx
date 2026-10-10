import { useState } from 'react';

import type { RefTarget } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Checkbox } from '@ui/Checkbox';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';

import { validateRefName } from './branchNames';

interface BranchNameDialogProps {
  /** Crear nombra su punto de partida; renombrar nombra la rama que cambia. */
  mode: { kind: 'create'; from: RefTarget; fromLabel: string } | { kind: 'rename'; branch: string };
  /** Los nombres que ya existen, para que el campo rechace el repetido. */
  taken: readonly string[];
  onCreate: (name: string, from: RefTarget, checkout: boolean) => void;
  onRename: (from: string, to: string) => void;
  onCancel: () => void;
}

/**
 * Crear y renombrar una rama — CU-9.
 *
 * Los dos en el mismo diálogo, y no por ahorrar un archivo: comparten campo,
 * validación y mensaje de error, y lo único que cambia es el título, el punto
 * de partida y la casilla de cambiarse a ella. Separarlos habría duplicado
 * `validateRefName` en dos sitios, que es lo que la regla de un hecho un
 * archivo evita.
 *
 * **La casilla de «cambiar a ella al crearla» viene marcada** — CU-9 lo pide
 * así: crear una rama para no usarla es el caso raro.
 */
export function BranchNameDialog({
  mode,
  taken,
  onCreate,
  onRename,
  onCancel,
}: BranchNameDialogProps) {
  const { t } = useI18n();
  const creating = mode.kind === 'create';
  const [name, setName] = useState(creating ? '' : mode.branch);
  const [checkout, setCheckout] = useState(true);

  const problem = validateRefName(name, taken, creating ? undefined : mode.branch);
  const message =
    problem === 'taken'
      ? t('working.dialog.branch.taken', { branch: name.trim() })
      : problem === 'invalid'
        ? t('working.dialog.branch.invalid')
        : undefined;

  const confirm = () => {
    if (problem !== null) return;
    if (creating) onCreate(name.trim(), mode.from, checkout);
    else onRename(mode.branch, name.trim());
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={
        creating
          ? t('working.dialog.branch.createTitle', { from: mode.fromLabel })
          : t('working.dialog.branch.renameTitle', { branch: mode.branch })
      }
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button variant="primary" disabled={problem !== null} onClick={confirm}>
            {creating
              ? t('working.dialog.branch.createConfirm')
              : t('working.dialog.branch.renameConfirm')}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        label={t('working.dialog.branch.nameLabel')}
        value={name}
        error={message}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;

          event.preventDefault();
          confirm();
        }}
      />
      {creating && (
        <Checkbox
          label={t('working.dialog.branch.checkout')}
          checked={checkout}
          onChange={(event) => {
            setCheckout(event.target.checked);
          }}
        />
      )}
    </Dialog>
  );
}

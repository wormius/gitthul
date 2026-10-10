import type { ReactNode } from 'react';

import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Spinner } from '@ui/Spinner';
import { Dialog } from '@ui/Dialog';

interface ConfirmDialogProps {
  /** La frase, con sus ramas nombradas. */
  busy?: boolean;
  title: string;
  /** Qué se pierde exactamente. Obligatorio en lo destructivo — invariante 2. */
  description?: string;
  confirmLabel: string;
  /** Casillas o avisos propios de esta confirmación. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * La confirmación de las acciones que no se deshacen solas.
 *
 * Un único componente para borrar una rama, borrar un tag, quitar un worktree,
 * descartar cambios y las vistas previas de cherry-pick y revertir: lo que
 * cambia entre ellas es el texto, y el texto ya viene traducido y con los
 * nombres puestos desde quien la abre. Lo que **no** cambia es la regla de la
 * invariante 2 —el diálogo dice exactamente qué se pierde—, y por eso
 * `description` está aquí y no repartida por seis componentes.
 */
export function ConfirmDialog({
  busy = false,
  title,
  description,
  confirmLabel,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onCancel();
      }}
      size="sm"
      title={title}
      {...(description === undefined ? {} : { description })}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel}>
            {t('working.dialog.cancel')}
          </Button>
          <Button disabled={busy} variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {busy && <Spinner label={t('working.busy')} />}
      {children}
    </Dialog>
  );
}

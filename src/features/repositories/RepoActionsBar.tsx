import type { ReactNode } from 'react';

import { useGestures } from '@app/GestureContext';
import { TerminalIcon } from '@app/ShellIcons';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';
import { BigActionButton } from '@ui/BigActionButton';

import { CloneIcon, NewRepoIcon, OpenFolderIcon } from './RepositoryIcons';
import styles from './RepoActionsBar.module.css';

interface Action {
  gesture: string;
  /** La palabra que se lee bajo el icono; el nombre completo lo da el gesto. */
  labelKey: MessageKey;
  icon: ReactNode;
}

/**
 * Los cuatro caminos con los que empieza todo.
 *
 * Terminal **reutiliza el gesto del shell**, no una copia local: una acción, un
 * nombre, y arranca en la carpeta del repositorio
 * seleccionado porque eso lo decide el gesto, no este botón.
 */
const ACTIONS: readonly Action[] = [
  {
    gesture: 'repos.openFolder',
    labelKey: 'repositories.action.openFolder',
    icon: <OpenFolderIcon />,
  },
  { gesture: 'repos.create', labelKey: 'repositories.action.create', icon: <NewRepoIcon /> },
  { gesture: 'repos.clone', labelKey: 'repositories.action.clone', icon: <CloneIcon /> },
  {
    gesture: 'shell.openTerminalTab',
    labelKey: 'repositories.action.terminal',
    icon: <TerminalIcon />,
  },
];

/**
 * La fila de acciones del panel izquierdo.
 *
 * **No desplaza nunca.** Es una fila centrada que envuelve, así que al estrechar
 * el panel pasa de cinco columnas a tres y a dos, pero los cinco botones siguen
 * ahí: un `BigActionButton` que se sale del área visible es un camino perdido.
 * Todos miden lo mismo y son cuadrados — el ancho lo fija el icono, no la
 * palabra— porque cinco cajas de anchos distintos no se leen como una fila.
 *
 * El rótulo visible es una palabra y el nombre accesible es el del gesto —«Abrir
 * una carpeta como repositorio»—, que es el mismo que sale en el menú y en la
 * búsqueda global. Un botón cuadrado no tiene sitio para la frase entera, pero
 * la frase entera es la que nombra la acción.
 */
export function RepoActionsBar() {
  const { t } = useI18n();
  const gestures = useGestures();

  return (
    <div className={styles.bar} role="toolbar" aria-label={t('repositories.actions')}>
      {ACTIONS.map((action) => {
        const gesture = gestures.get(action.gesture);

        if (!gesture) return null;

        return (
          <BigActionButton
            key={action.gesture}
            className={styles.action}
            icon={action.icon}
            label={t(action.labelKey)}
            aria-label={gesture.label}
            title={
              gesture.shortcutLabel ? `${gesture.label} · ${gesture.shortcutLabel}` : gesture.label
            }
            disabled={gesture.disabled}
            onClick={() => {
              gestures.run(action.gesture);
            }}
          />
        );
      })}
    </div>
  );
}

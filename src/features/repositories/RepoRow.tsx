import { useRef, type DragEvent, type MouseEvent } from 'react';

import { WorktreeIcon } from '@app/ShellIcons';
import type { RepoSummary } from '@core/domain/repository';
import type { RepoAvatar, Space } from '@core/domain/library';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { Chip } from '@ui/Chip';
import { ContextMenu } from '@ui/ContextMenu';
import { previewDrag } from '@ui/dragPreview';
import type { MenuEntry } from '@ui/menuUtils';

import { RepoDragPreview } from './RepoDragPreview';
import { RepoIcon } from './RepositoryIcons';
import styles from './RepoRow.module.css';

interface RepoRowProps {
  repo: RepoSummary;
  /** Avatar elegido por el usuario, o `null` para mostrar las iniciales. */
  avatar: RepoAvatar | null;
  /** Lo que la fila ya era **antes** de este clic; de ahí sale la doble selección. */
  selected: boolean;
  canOpenOnClick?: boolean;
  dragCount?: number;
  spaces?: readonly Space[];
  /**
   * Los espacios a los que pertenece, cuando toca enseñarlos.
   *
   * Solo mientras hay filtro: es lo que hace útil el filtro global —encontrar el
   * repositorio *y* enterarse de dónde estaba guardado— y fuera de él sería
   * ruido en cada fila de una lista que ya tiene a los espacios más arriba.
   */
  /**
   * Cuánto hace que se abrió, ya redactado.
   *
   * Llega hecho y no se calcula aquí para que todas las filas hablen del mismo
   * instante: un «ahora» por fila daría dos respuestas distintas en la misma
   * lista si el reloj cruza un minuto mientras se pinta.
   */
  when?: string;
  menu: readonly MenuEntry[];
  onOpen: () => void;
  /** El clic derecho también selecciona: el menú y el panel hablan de lo mismo. */
  onSelect: () => void;
  /** Un clic sin arrastre sobre una selección múltiple vuelve a elegir esta fila. */
  onClickSelect?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * Una fila de la lista de repositorios: una sola línea y nada más.
 *
 * Avatar en miniatura a la izquierda —el glifo elegido o las iniciales—, nombre,
 * carpeta atenuada y cuánto hace que se abrió. El avatar da una pista visual
 * instantánea que permite localizar el repositorio sin leer: el ojo recorre
 * colores y formas más rápido que palabras. La marca de worktree sí se queda,
 * porque sin ella dos filas con el mismo nombre solo se diferenciarían leyendo
 * la ruta entera.
 *
 * Nada aparece ni desaparece al pasar por encima —solo cambia el fondo— así que
 * la fila no se mueve ni un píxel, que es la invariante 1.
 *
 * **La doble selección vive aquí.** El primer clic selecciona y el segundo, ya
 * sobre la fila seleccionada, abre. Lo que la fila era antes del clic se anota en
 * `mousedown`, porque para cuando llegue el `click` la lista ya habrá movido la
 * selección y toda fila parecería «la que ya estaba»; abrir, en cambio, se hace
 * en el `click`, y esa es la mitad que deja convivir la doble selección con
 * arrastrar la fila hasta un espacio: **si hubo arrastre no hay `click`**, así
 * que arrastrar una fila seleccionada ya no la abre de paso. `detail` descarta el
 * segundo golpe de un doble clic, que llega por su propio camino: si no, abrir
 * con doble clic contaría dos aperturas en el heatmap de uso.
 */
export function RepoRow({
  repo,
  avatar,
  selected,
  canOpenOnClick = true,
  dragCount = 1,
  spaces = [],
  when,
  menu,
  onOpen,
  onSelect,
  onClickSelect,
  onDragStart,
  onDragEnd,
}: RepoRowProps) {
  const { t } = useI18n();
  const wasSelected = useRef(false);
  const pendingClickSelection = useRef(false);
  const dragged = useRef(false);
  const dragPreview = useRef<HTMLDivElement>(null);

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    dragged.current = false;
    const plainLeftClick =
      event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    pendingClickSelection.current = plainLeftClick && selected && !canOpenOnClick;
    if (pendingClickSelection.current) event.stopPropagation();
    wasSelected.current = plainLeftClick && selected && canOpenOnClick;
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const selectOnClick = pendingClickSelection.current;
    const openOnClick = wasSelected.current;
    pendingClickSelection.current = false;
    wasSelected.current = false;
    if (dragged.current || event.detail !== 1 || event.ctrlKey || event.metaKey || event.shiftKey)
      return;

    if (selectOnClick) onClickSelect?.();
    else if (openOnClick) onOpen();
  };

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    pendingClickSelection.current = false;
    wasSelected.current = false;
    dragged.current = true;
    event.dataTransfer?.setData('text/plain', repo.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = dragCount > 1 ? 'copy' : 'move';
    previewDrag(event, dragPreview.current);
    onDragStart?.();
  };

  return (
    <ContextMenu
      items={menu}
      label={t('repositories.list.menu', { repo: repo.name })}
      className={styles.region}
    >
      <div
        className={styles.row}
        data-selected={selected ? '' : undefined}
        draggable={onDragStart === undefined ? undefined : true}
        onDragStart={startDrag}
        onDragEnd={onDragEnd}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onDoubleClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey) event.stopPropagation();
        }}
        onContextMenu={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) onSelect();
        }}
      >
        <RepoDragPreview ref={dragPreview} repo={repo} avatar={avatar} count={dragCount} />
        {avatar ? (
          <Avatar
            name={repo.name}
            glyph={avatar.glyph}
            tone={avatar.tone}
            color={avatar.color}
            size="xs"
            className={styles.avatar}
          />
        ) : (
          <RepoIcon className={styles.repoIcon} />
        )}
        <span className={styles.name}>{repo.name}</span>
        <span className={styles.path}>{repo.path}</span>

        {repo.worktreeOf !== undefined && (
          <span className={styles.tag}>
            <WorktreeIcon className={styles.icon} />
            {t('repositories.row.worktree', { repo: repo.worktreeOf })}
          </span>
        )}

        {spaces.length > 0 && (
          <span className={styles.spaces}>
            {spaces.map((space) => (
              <Chip key={space.id}>{space.name}</Chip>
            ))}
          </span>
        )}

        {when !== undefined && (
          <span className={styles.when} title={t('repositories.row.lastOpened', { when })}>
            {when}
          </span>
        )}
      </div>
    </ContextMenu>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { ContextMenu } from './ContextMenu';
import { IconButton } from './IconButton';
import type { MenuEntry } from './menuUtils';
import styles from './Tab.module.css';

export interface TabDescriptor {
  id: string;
  label: string;
  /** Texto atenuado detrás del rótulo: la rama, el worktree, el modo. */
  hint?: string;
  icon?: ReactNode;
  /** Etiqueta accesible del cierre; nombra la pestaña. */
  closeLabel: string;
  /** Menú contextual específico de esta pestaña. */
  menu?: {
    label: string;
    description?: string;
    items: readonly MenuEntry[];
  };
  /** Edición local del rótulo mediante doble clic. */
  rename?: {
    /** Cambiar el destino descarta una edición que todavía no se guardó. */
    identityKey?: string;
    value: string;
    placeholder?: string;
    label: string;
    hint: string;
    errorLabel: string;
    onSave: (value: string) => Promise<void>;
  };
}

interface TabProps {
  tab: TabDescriptor;
  active: boolean;
  /** Es la pestaña que se está arrastrando: se queda fantasmal en su hueco. */
  dragging?: boolean;
  /** Se va a soltar aquí lo que se está arrastrando. */
  dropTarget?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLLIElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.4 3.4 8.6 8.6M8.6 3.4 3.4 8.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Una pestaña de la tira.
 *
 * La `×` está siempre visible. Las transformaciones de superficie viven en
 * los accesos generales y atajos del shell, no como botones efímeros dentro de
 * cada pestaña.
 *
 * El clic con la rueda cierra, como en cualquier navegador, y es el segundo
 * gesto de cerrar que pide la invariante 3 junto a la `×` y al atajo.
 */
export function Tab(props: TabProps) {
  // Una pestaña de terminal puede cambiar de repositorio sin cambiar de id.
  // El editor se desmonta con su destino: no hereda borradores ni peticiones.
  const editKey = props.tab.rename
    ? `rename:${props.tab.rename.identityKey ?? props.tab.id}`
    : 'static';

  return <TabContent key={editKey} {...props} />;
}

function TabContent({
  tab,
  active,
  dragging,
  dropTarget,
  onActivate,
  onClose,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onKeyDown,
  ref,
}: TabProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const activateRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const composing = useRef(false);
  const pendingBlur = useRef(false);
  const initialValue = useRef('');
  const saveRename = useRef<TabDescriptor['rename']>(undefined);
  const draftRef = useRef('');
  const session = useRef(0);
  const restoreFocus = useRef(false);
  const descriptionId = useId();
  const setActivateRef = useCallback(
    (node: HTMLButtonElement | null) => {
      activateRef.current = node;
      if (typeof ref === 'function') return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      activateRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  useEffect(
    () => () => {
      session.current += 1;
      editingRef.current = false;
      pendingBlur.current = false;
    },
    [],
  );

  const finishEditing = (focusButton: boolean) => {
    editingRef.current = false;
    composing.current = false;
    pendingBlur.current = false;
    restoreFocus.current = focusButton;
    session.current += 1;
    setEditing(false);
  };

  const save = async (focusButton: boolean) => {
    if (!saveRename.current || !editingRef.current || savingRef.current || composing.current) {
      return;
    }

    if (draftRef.current === initialValue.current) {
      finishEditing(focusButton);
      return;
    }

    const currentSession = session.current;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);

    try {
      // El borrador pertenece al destino con el que comenzó la edición, aunque
      // el contexto de una pestaña de terminal cambie antes de terminarla.
      await saveRename.current.onSave(draftRef.current);
    } catch {
      if (session.current !== currentSession) return;
      savingRef.current = false;
      setSaving(false);
      setSaveError(true);
      return;
    }

    if (session.current !== currentSession) return;
    savingRef.current = false;
    setSaving(false);
    // Una petición lenta no debe quitar el foco de otro control al terminar.
    finishEditing(focusButton && document.activeElement === inputRef.current);
  };

  const beginEditing = (event: MouseEvent<HTMLButtonElement>) => {
    if (!tab.rename || event.button !== 0 || editingRef.current) return;

    event.preventDefault();
    initialValue.current = tab.rename.value;
    saveRename.current = tab.rename;
    draftRef.current = tab.rename.value;
    editingRef.current = true;
    session.current += 1;
    setDraft(tab.rename.value);
    setSaveError(false);
    setEditing(true);
  };

  const editorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;

    event.preventDefault();
    if (savingRef.current) return;
    if (event.key === 'Escape') finishEditing(true);
    else void save(true);
  };

  const startDrag = (event: DragEvent<HTMLLIElement>) => {
    if (editingRef.current) {
      event.preventDefault();
      return;
    }
    // El identificador viaja también en el evento para que el navegador muestre
    // el arrastre; quien reordena lo lee del estado de la tira.
    event.dataTransfer?.setData('text/plain', tab.id);

    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';

    onDragStart();
  };

  const dragOver = (event: DragEvent<HTMLLIElement>) => {
    // Sin esto el navegador rechaza el soltar y no hay reordenación posible.
    event.preventDefault();

    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    onDragOver();
  };

  const drop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    onDrop();
  };

  const auxClick = (event: MouseEvent<HTMLLIElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.button !== 1) return;

    event.preventDefault();
    onClose();
  };

  return (
    <li
      className={styles.tab}
      data-active={active}
      data-dragging={dragging === true}
      data-drop-target={dropTarget === true}
      data-editing={editing}
      draggable={!editing}
      onDragStart={startDrag}
      onDragOver={dragOver}
      onDragEnd={onDragEnd}
      onDrop={drop}
      onAuxClick={auxClick}
      onKeyDown={onKeyDown}
    >
      <ContextMenu
        items={tab.menu?.items ?? []}
        label={tab.menu?.label ?? tab.label}
        description={tab.menu?.description}
        className={styles.menuRegion}
      >
        <div className={styles.activationRegion}>
          <button
            ref={setActivateRef}
            type="button"
            className={styles.activate}
            aria-current={active ? 'page' : undefined}
            aria-hidden={editing || undefined}
            tabIndex={editing ? -1 : undefined}
            onClick={onActivate}
            onDoubleClick={beginEditing}
          >
            {tab.icon && (
              <span className={styles.icon} aria-hidden="true">
                {tab.icon}
              </span>
            )}
            <span className={styles.label}>{tab.label}</span>
            {tab.hint && <span className={styles.hint}>{tab.hint}</span>}
          </button>
          {editing && tab.rename && (
            <div className={styles.editorRegion}>
              {tab.icon && (
                <span className={styles.icon} aria-hidden="true">
                  {tab.icon}
                </span>
              )}
              <input
                ref={inputRef}
                className={styles.editor}
                value={draft}
                placeholder={tab.rename.placeholder}
                aria-label={tab.rename.label}
                aria-describedby={descriptionId}
                aria-invalid={saveError || undefined}
                aria-busy={saving || undefined}
                title={saveError ? tab.rename.errorLabel : tab.rename.hint}
                readOnly={saving}
                onChange={(event) => {
                  draftRef.current = event.currentTarget.value;
                  setDraft(event.currentTarget.value);
                  setSaveError(false);
                }}
                onKeyDown={editorKeyDown}
                onKeyUp={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                onBlur={() => {
                  if (composing.current) pendingBlur.current = true;
                  else void save(false);
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                  if (pendingBlur.current) {
                    pendingBlur.current = false;
                    queueMicrotask(() => void save(false));
                  }
                }}
              />
              {tab.hint && <span className={styles.hint}>{tab.hint}</span>}
              <span
                id={descriptionId}
                className={styles.editorDescription}
                role={saveError ? 'alert' : undefined}
              >
                {saveError ? tab.rename.errorLabel : tab.rename.hint}
              </span>
            </div>
          )}
        </div>

        <IconButton
          size="sm"
          className={styles.close}
          icon={<CloseIcon />}
          aria-label={tab.closeLabel}
          onClick={onClose}
        />
      </ContextMenu>
    </li>
  );
}

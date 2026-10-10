import { useState, type MouseEvent, type ReactNode } from 'react';

import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import type { MenuEntry } from './menuUtils';
import styles from './SplitActionButton.module.css';

export interface SplitActionAlternative {
  key: string;
  label: string;
  onSelect: () => void;
}

interface SplitActionButtonProps {
  label: string;
  icon?: ReactNode;
  onAction: () => void;
  alternatives: readonly SplitActionAlternative[];
  /** Etiqueta accesible del botón que despliega las alternativas, p. ej. «Más opciones de Push». */
  moreLabel: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}

function CaretIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 4.5 6 7.5 9 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Acción por defecto con clic izquierdo, alternativas con clic derecho.
 *
 * Las alternativas salen por `Menu`, el mismo que usan el menú contextual y el
 * desplegable: teclado, colocación contra los bordes y cierre se comportan
 * igual en los tres, que es la única forma de que el clic derecho sea un gesto
 * y no tres comportamientos parecidos.
 */
export function SplitActionButton({
  label,
  icon,
  onAction,
  alternatives,
  moreLabel,
  variant = 'secondary',
  size = 'md',
  disabled,
}: SplitActionButtonProps) {
  // En estado y no en refs: el menú se ancla al grupo durante el render.
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const [caret, setCaret] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const items: MenuEntry[] = alternatives.map((alternative) => ({
    key: alternative.key,
    label: alternative.label,
    onSelect: alternative.onSelect,
  }));

  const close = () => {
    setOpen(false);
    caret?.focus();
  };

  const openViaContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!disabled) setOpen(true);
  };

  return (
    <div className={styles.group} ref={setGroup} onContextMenu={openViaContextMenu}>
      <Button
        variant={variant}
        size={size}
        iconStart={icon}
        onClick={onAction}
        disabled={disabled}
        className={styles.primary}
      >
        {label}
      </Button>
      <IconButton
        ref={setCaret}
        icon={<CaretIcon />}
        aria-label={moreLabel}
        variant={variant}
        size={size}
        disabled={disabled}
        className={styles.caret}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      />
      {open && (
        <Menu
          items={items}
          label={moreLabel}
          anchor={caret ?? group ?? { x: 0, y: 0 }}
          align="end"
          trigger={group}
          onClose={close}
        />
      )}
    </div>
  );
}

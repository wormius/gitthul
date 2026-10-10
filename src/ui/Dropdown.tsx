import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button, type ButtonSize, type ButtonVariant } from './Button';
import type { FloatingAlign, FloatingSide } from './floating';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import type { MenuEntry } from './menu';
import styles from './Dropdown.module.css';

interface DropdownProps {
  /** Rótulo del disparador y, salvo que se diga otra cosa, del menú. */
  label: string;
  items: readonly MenuEntry[];
  icon?: ReactNode;
  /** Deja el disparador como solo icono. Exige `icon`; la etiqueta sigue siendo accesible. */
  hideLabel?: boolean;
  /** Nombre accesible del menú, si conviene distinguirlo del rótulo del botón. */
  menuLabel?: string;
  /** Sobre qué opera el menú: «3 commits seleccionados». */
  description?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  side?: FloatingSide;
  align?: FloatingAlign;
  /** El menú ocupa el mismo ancho que el botón que lo abre. */
  matchTriggerWidth?: boolean;
  className?: string;
}

function CaretDownIcon() {
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
 * Botón que despliega un menú.
 *
 * Al cerrarse devuelve el foco al disparador: sin eso, el teclado se queda
 * huérfano en `body` y hay que volver a tabular desde el principio de la vista.
 */
export function Dropdown({
  label,
  items,
  icon,
  hideLabel,
  menuLabel,
  description,
  variant = 'secondary',
  size = 'md',
  disabled,
  side = 'bottom',
  align = 'start',
  matchTriggerWidth = false,
  className,
}: DropdownProps) {
  // El disparador vive en estado y no en una ref porque el flotante se ancla a
  // él durante el render: una ref todavía no está escrita la primera vez.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    trigger?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const triggerNode =
    hideLabel && icon ? (
      <IconButton
        ref={setTrigger}
        icon={icon}
        aria-label={label}
        variant={variant}
        size={size}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onKeyDown}
        onClick={() => {
          setOpen((value) => !value);
        }}
      />
    ) : (
      <Button
        ref={setTrigger}
        variant={variant}
        size={size}
        iconStart={icon}
        iconEnd={<CaretDownIcon />}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onKeyDown}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {label}
      </Button>
    );

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {triggerNode}
      {open && (
        <Menu
          items={items}
          label={menuLabel ?? label}
          description={description}
          anchor={trigger ?? { x: 0, y: 0 }}
          side={side}
          align={align}
          matchAnchorWidth={matchTriggerWidth}
          trigger={trigger}
          onClose={close}
        />
      )}
    </div>
  );
}

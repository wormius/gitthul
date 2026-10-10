import {
  Children,
  cloneElement,
  useEffect,
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import type { FloatingAlign, FloatingSide } from './floating';
import { Floating } from './Floating';
import styles from './Tooltip.module.css';

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  'aria-describedby'?: string;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

interface TooltipProps {
  content: ReactNode;
  /** Retardo del puntero en milisegundos. Con el teclado sale al instante. */
  delay?: number;
  side?: FloatingSide;
  align?: FloatingAlign;
  /** Un único hijo, que además recibe el `aria-describedby`. */
  children: ReactElement;
}

/**
 * Descripción breve que sale del puntero tras un retardo, o del foco al
 * instante — quien navega con teclado ya declaró su intención al llegar.
 *
 * El retardo es un efecto y no un temporizador guardado a mano: entrar y salir
 * del disparador solo cambia estado, y limpiar el reloj pendiente es la
 * limpieza del efecto. Así no queda ningún temporizador vivo al desmontar.
 *
 * Nunca lleva acciones ni información que no esté en otro sitio: sale por
 * hover, y quien navega con teclado o con lector de pantalla no tiene hover.
 */
export function Tooltip({
  content,
  delay = 500,
  side = 'top',
  align = 'center',
  children,
}: TooltipProps) {
  // El disparador en estado: el flotante se ancla a él durante el render.
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!pending) return;

    const timer = setTimeout(() => {
      setOpen(true);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [pending, delay]);

  const close = () => {
    setPending(false);
    setOpen(false);
  };

  const child = Children.only(children) as ReactElement<TriggerProps>;
  const describedBy = [child.props['aria-describedby'], open ? id : undefined]
    .filter(Boolean)
    .join(' ');

  const clone = cloneElement(child, {
    ref: setTrigger,
    'aria-describedby': describedBy || undefined,
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      child.props.onMouseEnter?.(event);
      setPending(true);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      child.props.onMouseLeave?.(event);
      close();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      child.props.onFocus?.(event);
      setPending(false);
      setOpen(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      child.props.onBlur?.(event);
      close();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      child.props.onKeyDown?.(event);

      if (event.key === 'Escape') close();
    },
  });

  return (
    <>
      {clone}
      {open && trigger && (
        <Floating
          anchor={trigger}
          side={side}
          align={align}
          className={styles.tip}
          role="tooltip"
          id={id}
        >
          {content}
        </Floating>
      )}
    </>
  );
}

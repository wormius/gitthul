import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

import styles from './Textarea.module.css';
import hiddenStyles from './visuallyHidden.module.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hideLabel?: boolean;
  minRows?: number;
  maxRows?: number;
  /** Desactiva el autoajuste cuando el contenedor reparte el alto del campo. */
  autoResize?: boolean;
  /** Clase para la caja del campo cuando el consumidor necesita repartir su alto. */
  fieldClassName?: string;
  /** Referencia al elemento nativo cuando el consumidor necesita moverle el foco. */
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/**
 * Autoajustable: crece con el contenido hasta `maxRows`, luego hace scroll.
 *
 * Se usa el `scrollHeight` real del navegador en vez de contar líneas a mano,
 * porque el ajuste de tamaño de fuente y la densidad cambian cuánto ocupa cada
 * línea; contar caracteres o saltos de línea no lo reflejaría.
 */
export function Textarea({
  label,
  hideLabel,
  minRows = 2,
  maxRows,
  autoResize = true,
  fieldClassName,
  textareaRef,
  id,
  className,
  value,
  onChange,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const ref = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(textareaRef, () => ref.current as HTMLTextAreaElement);

  useEffect(() => {
    const node = ref.current;

    if (!node || !autoResize) return;

    node.style.height = 'auto';
    node.style.height = `${String(node.scrollHeight)}px`;
  }, [autoResize, value]);

  return (
    <div className={[styles.field, fieldClassName].filter(Boolean).join(' ')}>
      <label
        className={[styles.label, hideLabel && hiddenStyles.hidden].filter(Boolean).join(' ')}
        htmlFor={textareaId}
      >
        {label}
      </label>
      <textarea
        ref={ref}
        id={textareaId}
        className={[styles.textarea, className].filter(Boolean).join(' ')}
        rows={minRows}
        value={value}
        onChange={onChange}
        style={
          maxRows
            ? {
                maxHeight: `calc(var(--line-height-ui) * var(--font-size-ui) * ${String(maxRows)})`,
              }
            : undefined
        }
        {...rest}
      />
    </div>
  );
}

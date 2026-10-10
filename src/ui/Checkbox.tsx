import { useId, type InputHTMLAttributes } from 'react';

import styles from './Checkbox.module.css';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

/**
 * Marcada se rellena y saca su palomita, como cualquier casilla.
 *
 * Nació con el motivo de anillo del logotipo —el mismo del nodo activo del
 * grafo—, y **al usarla no comunicaba**: engordar el anillo se leía como un
 * foco, no como «esto está puesto». El lenguaje de la marca se queda donde sí
 * funciona, que es el grafo.
 */
export function Checkbox({ label, id, className, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;

  return (
    <label className={[styles.wrapper, className].filter(Boolean).join(' ')} htmlFor={checkboxId}>
      <input type="checkbox" id={checkboxId} className={styles.input} {...rest} />
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </label>
  );
}

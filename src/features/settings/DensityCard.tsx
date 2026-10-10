import type { Density } from '@design/theme';

import { ChosenIcon } from './SettingsIcons';
import styles from './DensityCard.module.css';

interface DensityCardProps {
  density: Density;
  label: string;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Una densidad, dibujada con la densidad que ofrece.
 *
 * La tarjeta lleva `data-density`, así que sus tres filas de mentira se separan
 * con el espaciado de esa densidad y miden lo que ahí mide una fila. La
 * diferencia entre compacto y amplio no se explica con palabras: se ve al lado.
 *
 * No lleva el alto de fila en píxeles a propósito. Sería un número calculado en
 * JavaScript a partir de lo que `density.css` decide, y entonces habría dos
 * verdades sobre lo mismo — la segunda quedándose atrás en cuanto alguien
 * retoque la hoja.
 */
export function DensityCard({ density, label, selected, onSelect }: DensityCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={styles.card}
      data-density={density}
      data-selected={selected || undefined}
      onClick={onSelect}
    >
      <span className={styles.rows} aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <span key={row} className={styles.row}>
            <span className={styles.box} data-checked={row === 0 ? 'true' : undefined} />
            <span className={styles.dot} />
            <span className={styles.bar} data-width={row} />
          </span>
        ))}
      </span>
      <span className={styles.foot}>
        <span className={styles.label}>{label}</span>
        <span className={styles.check} aria-hidden="true">
          <ChosenIcon />
        </span>
      </span>
    </button>
  );
}

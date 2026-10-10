import type { Mode, Theme, ThemeVariant } from '@design/theme';

import { ChosenIcon } from './SettingsIcons';
import styles from './ThemeChip.module.css';

interface ThemeChipProps {
  /** El tema con el que se pinta el chip. Para `auto` es el que resuelve hoy. */
  theme: Theme;
  mode: Mode;
  themeVariant?: ThemeVariant;
  label: string;
  /** Segunda línea: en `auto`, a qué tema resuelve ahora mismo. */
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  /** Mostrar este tema en la maqueta sin aplicarlo; se suelta al salir. */
  onPeek: () => void;
  onPeekEnd: () => void;
}

/**
 * Una ficha de tema, pintada **en el tema que ofrece**.
 *
 * Lleva `data-theme` y `data-mode`, así que resuelve su propia capa de roles
 * (ver la cabecera de `roles.css`) y todo lo que enseña —fondo, borde, rótulo,
 * acento y terminal— sale del tema en cuestión. De ahí
 * que el contraste del rótulo esté garantizado por la misma prueba que cuida los
 * combinaciones de tema, modo y variante.
 *
 * El anillo de lo elegido es `outline` y la palomita reserva su caja desde el
 * principio: la invariante 1 prohíbe que señalar algo mueva la caja.
 */
export function ThemeChip({
  theme,
  mode,
  themeVariant = 'classic',
  label,
  hint,
  selected,
  onSelect,
  onPeek,
  onPeekEnd,
}: ThemeChipProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={styles.chip}
      data-theme={theme}
      data-mode={mode}
      data-theme-variant={themeVariant}
      data-selected={selected || undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onMouseEnter={onPeek}
      onFocus={onPeek}
      onMouseLeave={onPeekEnd}
      onBlur={onPeekEnd}
    >
      <span className={styles.swatches} aria-hidden="true">
        <span className={styles.miniRail} />
        <span className={styles.miniMain}>
          <span className={styles.accent} />
          <span className={styles.miniRow} />
          <span className={styles.miniRow} />
          <span className={styles.miniTerminal}>❯ _</span>
        </span>
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <span className={styles.check} aria-hidden="true">
        <ChosenIcon />
      </span>
    </button>
  );
}

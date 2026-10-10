/*
 * Iconos de Configuraciones.
 *
 * Mismas reglas que `ShellIcons`: viewBox de 16, `currentColor` y sin relleno
 * propio, para que hereden el color del control que los lleva y sirvan igual en
 * los siete temas.
 */

interface IconProps {
  className?: string;
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Regresar: una flecha más marcada para reconocer la salida de configuraciones. */
export function BackIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 3 2 8l5 5M2 8h12" {...STROKE} strokeWidth={1.8} />
    </svg>
  );
}

/** Modo automático: el monitor, que es «lo que diga el sistema». */
export function ModeSystemIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.6" y="2.6" width="12.8" height="8.8" rx="1.4" {...STROKE} />
      <path d="M5.6 13.9h4.8M8 11.4v2.5" {...STROKE} />
    </svg>
  );
}

/** Modo claro: el sol. */
export function ModeLightIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3.1" {...STROKE} />
      <path
        d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"
        {...STROKE}
      />
    </svg>
  );
}

/** Modo oscuro: la luna. */
export function ModeDarkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.2 10.1A5.9 5.9 0 0 1 5.9 2.8a5.9 5.9 0 1 0 7.3 7.3Z" {...STROKE} />
    </svg>
  );
}

/** La palomita de lo elegido, en chips y tarjetas. */
export function ChosenIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.4 8.6 6.4 11.6l6.2-7.2" {...STROKE} strokeWidth={1.6} />
    </svg>
  );
}

/*
 * Los siete iconos del rail de secciones. Uno por sección, y todos del mismo
 * peso: el rail se recorre con el ojo, así que lo que tiene que distinguirlos es
 * la silueta, no el detalle.
 */

/** Apariencia: la paleta. */
export function AppearanceIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1.8a6.2 6.2 0 0 0 0 12.4c1 0 1.5-.6 1.5-1.3 0-.8-.6-1.2-.6-1.9 0-.6.5-1.1 1.2-1.1h1.3a2.9 2.9 0 0 0 2.8-2.9C14.2 4.2 11.4 1.8 8 1.8Z"
        {...STROKE}
      />
      <circle cx="5" cy="6.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="4.8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="9.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Idioma: el globo con sus paralelos. */
export function LanguageIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.1" {...STROKE} />
      <path
        d="M1.9 8h12.2M8 1.9c1.7 1.7 2.6 3.8 2.6 6.1S9.7 12.4 8 14.1C6.3 12.4 5.4 10.3 5.4 8S6.3 3.6 8 1.9Z"
        {...STROKE}
      />
    </svg>
  );
}

/** Git: la rama, la misma silueta que en el shell. */
export function GitIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="3.6" r="1.9" {...STROKE} />
      <circle cx="5" cy="12.4" r="1.9" {...STROKE} />
      <circle cx="11.4" cy="7.4" r="1.9" {...STROKE} />
      <path d="M5 5.5v4.9M9.5 7.4H7.6A2.6 2.6 0 0 1 5 4.8" {...STROKE} />
    </svg>
  );
}

/** Atajos: el teclado. */
export function ShortcutsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.4" y="4" width="13.2" height="8" rx="1.4" {...STROKE} />
      <path d="M4 6.6h.01M6.6 6.6h.01M9.4 6.6h.01M12 6.6h.01M5 9.4h6" {...STROKE} />
    </svg>
  );
}

/** Registros: eventos en una hoja. */
export function LoggingIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.2" {...STROKE} />
      <path d="M5 5h6M5 8h6M5 11h4" {...STROKE} />
    </svg>
  );
}

/** Recuperación: un reloj que vuelve al estado anterior. */
export function RecoveryIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.6 5.7A5.8 5.8 0 1 1 2.4 10M2.6 2.3v3.6h3.6M8 4.7V8l2.3 1.5" {...STROKE} />
    </svg>
  );
}

/** Actualizaciones: la flecha que baja a su bandeja. */
export function UpdatesIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1.9v7.4M5.2 6.6 8 9.4l2.8-2.8M2.4 11.4v1.4a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4v-1.4"
        {...STROKE}
      />
    </svg>
  );
}

/** Acerca de: la i de información. */
export function AboutIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.1" {...STROKE} />
      <path d="M8 7.2v3.6" {...STROKE} />
      <circle cx="8" cy="5.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

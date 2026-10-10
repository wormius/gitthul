/*
 * Iconos de `GitActionBar`.
 *
 * Mismas reglas que `RepositoryIcons`: viewBox de 16, `currentColor` y sin
 * relleno propio. Terminal reutiliza `TerminalIcon` de `ShellIcons` — una
 * acción, un icono, no una copia — así que no está aquí.
 */

interface IconProps {
  className?: string;
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Deshacer: flecha que se curva hacia la izquierda. */
export function UndoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 3.8 3 6.8l3 3" {...STROKE} />
      <path d="M3 6.8h6.2a3.5 3.5 0 0 1 0 7H7" {...STROKE} />
    </svg>
  );
}

/** Rehacer: el mismo trazo, en espejo. */
export function RedoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3.8 13 6.8l-3 3" {...STROKE} />
      <path d="M13 6.8H6.8a3.5 3.5 0 0 0 0 7H9" {...STROKE} />
    </svg>
  );
}

/** Fetch: flecha hacia abajo, hacia una bandeja abierta. */
export function FetchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2.3v6.7M5.2 6.2 8 9l2.8-2.8" {...STROKE} />
      <path d="M2.5 10.8v1.7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.7" {...STROKE} />
    </svg>
  );
}

/** Pull: flecha hacia abajo que llega a la rama local, marcada con un punto. */
export function PullIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2.3v6.3M5.2 5.8 8 8.6l2.8-2.8" {...STROKE} />
      <circle cx="8" cy="12" r="1.7" {...STROKE} />
    </svg>
  );
}

/** Push: flecha hacia arriba, saliendo de la rama local hacia la bandeja. */
export function PushIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 13.7V7.4M5.2 10.2 8 7.4l2.8 2.8" {...STROKE} />
      <circle cx="8" cy="4" r="1.7" {...STROKE} />
    </svg>
  );
}

/** Stash: caja cerrada con el tirador marcado. */
export function StashIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.4" y="5.2" width="11.2" height="8.2" rx="1.2" {...STROKE} />
      <path d="M2.4 8.4h11.2" {...STROKE} />
      <path d="M6.6 8.4v1.5M9.4 8.4v1.5" {...STROKE} />
    </svg>
  );
}

/** Pop: la misma caja, con la flecha de lo que sale de vuelta al árbol. */
export function PopIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.4" y="8.2" width="11.2" height="5.2" rx="1.2" {...STROKE} />
      <path d="M8 8V2.3M5.3 4.8 8 2.3l2.7 2.5" {...STROKE} />
    </svg>
  );
}

/** Stage: signo `+`, el archivo pasa al stage. */
export function StageIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3.5v9M3.5 8h9" {...STROKE} />
    </svg>
  );
}

/** Unstage: signo `−`, el archivo sale del stage. */
export function UnstageIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 8h9" {...STROKE} />
    </svg>
  );
}

/** Árbol completo del proyecto, además de los archivos modificados. */
export function AllFilesIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 3h5l1 1.5H14v9H2V3Z" {...STROKE} />
      <path d="M5 8h6M5 10.5h4" {...STROKE} />
    </svg>
  );
}

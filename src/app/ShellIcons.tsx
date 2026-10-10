/*
 * Iconos del shell.
 *
 * Todos en un viewBox de 16, con `currentColor` y sin relleno propio, para que
 * hereden el color del control que los lleva y sirvan igual en los siete temas.
 * El motivo de anillo del logotipo se repite donde tiene sentido: el nodo del
 * repositorio y el punto de la terminal.
 */

interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Repositorios: la casita que lleva al inicio. */
export function RepositoriesIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {/* casa sólida con puerta */}
      <path
        d="M8 2 1.6 7.4v6a.6.6 0 0 0 .6.6h3.6v-3.6a.4.4 0 0 1 .4-.4h3.6a.4.4 0 0 1 .4.4V14h3.6a.6.6 0 0 0 .6-.6v-6L8 2Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Rama activa: el icono de una pestaña de GitWorking. */
export function BranchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="3.6" r="1.9" {...STROKE} />
      <circle cx="5" cy="12.4" r="1.9" {...STROKE} />
      <circle cx="11.4" cy="7.4" r="1.9" {...STROKE} />
      <path d="M5 5.5v4.9M9.5 7.4H7.6A2.6 2.6 0 0 1 5 4.8" {...STROKE} />
    </svg>
  );
}

/** Worktree: una carpeta de trabajo adicional vinculada al repositorio. */
export function WorktreeIcon({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4.2" cy="3.6" r="1.8" {...STROKE} />
      <rect x="8.6" y="9.4" width="6" height="4.4" rx="1.2" {...STROKE} />
      <path d="M4.2 5.4v4.4a1.8 1.8 0 0 0 1.8 1.8h2.6" {...STROKE} />
    </svg>
  );
}

/** Terminal: lucide-terminal adaptado — prompt diagonal y línea de cursor. */
export function TerminalIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {/* línea horizontal (guion bajo / cursor) */}
      <path d="M7.8 13h5.8" {...STROKE} />
      {/* prompt > en chevron */}
      <path d="M2.4 11.6 6.8 8 2.4 4.4" {...STROKE} />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="4.2" {...STROKE} />
      <path d="M10.2 10.2 13.5 13.5" {...STROKE} />
    </svg>
  );
}

export function HelpIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="5.8" {...STROKE} />
      <path d="M6.4 6.3a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2" {...STROKE} />
      <path d="M8 11.4h.01" {...STROKE} />
    </svg>
  );
}

export function SupportIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 13.2 3.4 8.7a2.9 2.9 0 0 1 0-4.2 3 3 0 0 1 4.2 0l.4.4.4-.4a3 3 0 0 1 4.2 0 2.9 2.9 0 0 1 0 4.2Z"
        {...STROKE}
      />
    </svg>
  );
}

export function LightModeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3.1" {...STROKE} />
      <path
        d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"
        {...STROKE}
      />
    </svg>
  );
}

export function DarkModeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 9.9A5.6 5.6 0 0 1 6.1 3a5.7 5.7 0 1 0 6.9 6.9Z" {...STROKE} />
    </svg>
  );
}

/**
 * Configuraciones: un engrane de verdad.
 *
 * El perfil son ocho dientes calculados —punta a 6.3, valle a 4.4— y no un
 * círculo con rayas: eso se confundía con el sol del modo claro, que está tres
 * botones más allá en la misma barra.
 */
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.69 1.84 A6.3 6.3 0 0 1 9.31 1.84 L9.29 3.79 A4.4 4.4 0 0 1 10.07 4.12 L11.43 2.72 A6.3 6.3 0 0 1 13.28 4.57 L11.88 5.93 A4.4 4.4 0 0 1 12.21 6.71 L14.16 6.69 A6.3 6.3 0 0 1 14.16 9.31 L12.21 9.29 A4.4 4.4 0 0 1 11.88 10.07 L13.28 11.43 A6.3 6.3 0 0 1 11.43 13.28 L10.07 11.88 A4.4 4.4 0 0 1 9.29 12.21 L9.31 14.16 A6.3 6.3 0 0 1 6.69 14.16 L6.71 12.21 A4.4 4.4 0 0 1 5.93 11.88 L4.57 13.28 A6.3 6.3 0 0 1 2.72 11.43 L4.12 10.07 A4.4 4.4 0 0 1 3.79 9.29 L1.84 9.31 A6.3 6.3 0 0 1 1.84 6.69 L3.79 6.71 A4.4 4.4 0 0 1 4.12 5.93 L2.72 4.57 A6.3 6.3 0 0 1 4.57 2.72 L5.93 4.12 A4.4 4.4 0 0 1 6.71 3.79 Z"
        {...STROKE}
      />
      {/* El hueco central es el motivo de anillo del logotipo. */}
      <circle cx="8" cy="8" r="2.05" {...STROKE} />
    </svg>
  );
}

export function LogsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.4 2.8h9.2v10.4H3.4Z" {...STROKE} />
      <path d="M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h2.8" {...STROKE} />
    </svg>
  );
}

export function NotificationsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.2 11.7h9.6l-1.2-1.8V7a3.6 3.6 0 0 0-7.2 0v2.9Z" {...STROKE} />
      <path d="M6.6 13.1a1.5 1.5 0 0 0 2.8 0" {...STROKE} />
    </svg>
  );
}

/*
 * Iconos propios de Repositorios.
 *
 * Mismas reglas que los del shell: viewBox de 16, `currentColor` y sin relleno
 * propio, para que hereden el color del control y sirvan igual en los seis
 * temas. Los que ya existen —terminal, rama, worktree— salen de
 * `ShellIcons`; aquí solo están los que esta vista estrena.
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

/** Abrir: lucide-folder-open adaptado — carpeta abierta con boca inclinada. */
export function OpenFolderIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.6 10.2 4.7 8A1.2 1.2 0 0 1 5.8 7.4H13a1.2 1.2 0 0 1 1.16 1.5l-1.1 4.1a1.2 1.2 0 0 1-1.16.9H2.8A1.2 1.2 0 0 1 1.6 12.8V4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1 .5l.6.8a1.2 1.2 0 0 0 1 .5h4.4a1.2 1.2 0 0 1 1.2 1.2v1.6"
        {...STROKE}
      />
    </svg>
  );
}

/** Crear: carpeta cerrada con `+` centrado. */
export function NewRepoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {/* carpeta cerrada */}
      <path
        d="M1.6 13.6V5.2a1.3 1.3 0 0 1 1.3-1.3h2.5a1.3 1.3 0 0 1 1.1.6l.8 1.1a1.3 1.3 0 0 0 1.1.6h4.4a1.3 1.3 0 0 1 1.3 1.3v6.1a1.3 1.3 0 0 1-1.3 1.3H2.9a1.3 1.3 0 0 1-1.3-1.3Z"
        {...STROKE}
      />
      {/* + centrado en el cuerpo */}
      <path d="M8 8.2v3.6M6.2 10h3.6" {...STROKE} />
    </svg>
  );
}

/** Clonar: lucide-git-fork rotado 90° antihorario — grafo horizontal compacto. */
export function CloneIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {/* nodo origen (izquierda, centro) */}
      <circle cx="3" cy="8" r="1.9" {...STROKE} />
      {/* nodo destino superior */}
      <circle cx="13" cy="4.4" r="1.9" {...STROKE} />
      {/* nodo destino inferior */}
      <circle cx="13" cy="11.6" r="1.9" {...STROKE} />
      {/* tronco horizontal desde el nodo izquierdo */}
      <path d="M4.9 8h3.3" {...STROKE} />
      {/* bifurcación */}
      <path d="M8.2 8V5.6c0-.4.3-.7.7-.7h2.2M8.2 8v2.4c0 .4.3.7.7.7h2.2" {...STROKE} />
    </svg>
  );
}

/**
 * Repositorio genérico: un grafo git mínimo — tres nodos en columna con una
 * rama que sale del de en medio. Heredar `currentColor` lo alinea al texto.
 */
export function RepoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {/* tronco vertical */}
      <path d="M5.6 3.8v8.4" {...STROKE} />
      {/* rama que sale del nodo central hacia la derecha */}
      <path d="M5.6 8c1.6 0 3-.8 4.4-2.4" {...STROKE} />
      {/* nodo superior */}
      <circle cx="5.6" cy="3.2" r="1.6" {...STROKE} />
      {/* nodo central */}
      <circle cx="5.6" cy="8" r="1.6" {...STROKE} />
      {/* nodo inferior */}
      <circle cx="5.6" cy="12.8" r="1.6" {...STROKE} />
      {/* nodo de la rama */}
      <circle cx="10.4" cy="5.2" r="1.6" {...STROKE} />
    </svg>
  );
}

export function SpaceIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.3" y="2.3" width="5" height="5" rx="1.4" {...STROKE} />
      <rect x="8.7" y="2.3" width="5" height="5" rx="1.4" {...STROKE} />
      <rect x="2.3" y="8.7" width="5" height="5" rx="1.4" {...STROKE} />
      <rect x="8.7" y="8.7" width="5" height="5" rx="1.4" {...STROKE} />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.8 4.4h10.4M6.4 4.4V3.2h3.2v1.2" {...STROKE} />
      <path d="M4.2 4.4l.7 8.2h6.2l.7-8.2" {...STROKE} />
      <path d="M6.8 6.8v3.8M9.2 6.8v3.8" {...STROKE} />
    </svg>
  );
}

export function OpenAllIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      {/* Tres repositorios apilados: “todos”, no una sola ventana. */}
      <path d="M2.2 5.1V3.8c0-.7.5-1.2 1.2-1.2h6.8" {...STROKE} />
      <path d="M3.7 7V5.6c0-.7.5-1.2 1.2-1.2h6.7" {...STROKE} />
      <rect x="5.2" y="6.2" width="8.6" height="7.2" rx="1.2" {...STROKE} />
      {/* Flecha de apertura que sale del conjunto. */}
      <path d="M8 11.1 11.8 7.3M9.2 7.3h2.6v2.6" {...STROKE} />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8" {...STROKE} />
    </svg>
  );
}

/** Ordenar por nombre: la A y la Z con la flecha descendente. */
export function SortByNameIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.2 11.8 5.4 4.2l3.2 7.6" {...STROKE} />
      <path d="M3.2 9.6h4.4" {...STROKE} />
      <path d="M11.8 4.4v7.4M9.6 9.6l2.2 2.2 2.2-2.2" {...STROKE} />
    </svg>
  );
}

/** Ordenar por última apertura: el reloj con la flecha descendente. */
export function SortByDateIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6.2" cy="7.2" r="4" {...STROKE} />
      <path d="M6.2 5.2v2.2l1.4 1.2" {...STROKE} />
      <path d="M12.4 9.8v3.8M10.2 11.6l2.2 2.2 2.2-2.2" {...STROKE} />
    </svg>
  );
}

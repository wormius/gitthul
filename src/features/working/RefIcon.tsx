/*
 * Los seis iconos de fila del panel de referencias.
 *
 * Mismas reglas que `ShellIcons`/`RepositoryIcons`: viewBox de 16,
 * `currentColor`, sin relleno propio salvo el punto de la rama activa. El
 * worktree reutiliza el de `ShellIcons` en vez de inventar uno nuevo aquí.
 */
import { WorktreeIcon } from '@app/ShellIcons';

export type RefIconKind = 'local' | 'remote' | 'activeBranch' | 'tag' | 'stash' | 'worktree';

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

/** Rama local: una laptop, porque la copia vive en esta máquina. */
function LocalBranchIcon({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.1" y="3" width="9.8" height="7.6" rx="1.2" {...STROKE} />
      <path d="M1.9 12.4h12.2M6.2 12.4h3.6" {...STROKE} />
    </svg>
  );
}

/**
 * La rama activa: un punto relleno independiente del tipo local. En los chips
 * aparece junto a la laptop; en el panel sustituye el icono de la fila para que
 * la rama actual se encuentre de un vistazo.
 */
function ActiveBranchIcon({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Rama remota: una nube, porque la referencia vive fuera de esta máquina. */
function RemoteBranchIcon({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.7 12.5h6.6a2.4 2.4 0 0 0 .45-4.76A3.8 3.8 0 0 0 4.35 8.8a1.9 1.9 0 0 0 .35 3.7Z"
        {...STROKE}
      />
    </svg>
  );
}

/** Tag: la etiqueta clásica con el agujero para el hilo. */
function TagIcon({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.4 2.4h3.2a2 2 0 0 1 2 2v3.2a1.4 1.4 0 0 1-.41 1L7.4 14.4a1.4 1.4 0 0 1-2 0L2 11a1.4 1.4 0 0 1 0-2l5.8-5.8a1.4 1.4 0 0 1 .6-.4Z"
        {...STROKE}
      />
      <circle cx="10.8" cy="5.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Guardado: la pila de capas de lo que se apartó del árbol de trabajo. */
function StashIcon({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="m8 2.4 5.6 2.9L8 8.2 2.4 5.3Z" {...STROKE} />
      <path d="M2.4 8.4 8 11.3l5.6-2.9" {...STROKE} />
      <path d="M2.4 11.4 8 14.3l5.6-2.9" {...STROKE} />
    </svg>
  );
}

/** Icono de una fila de `RefPanel`, según qué tipo de referencia representa. */
export function RefIcon({
  kind,
  className,
  style,
}: {
  kind: RefIconKind;
  className?: string;
  style?: React.CSSProperties;
}) {
  switch (kind) {
    case 'activeBranch':
      return <ActiveBranchIcon className={className} style={style} />;
    case 'local':
      return <LocalBranchIcon className={className} style={style} />;
    case 'remote':
      return <RemoteBranchIcon className={className} style={style} />;
    case 'tag':
      return <TagIcon className={className} style={style} />;
    case 'stash':
      return <StashIcon className={className} style={style} />;
    case 'worktree':
      return <WorktreeIcon className={className} style={style} />;
  }
}

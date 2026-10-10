import { type CSSProperties } from 'react';

import { AVATAR_TONE_COUNT } from '@design/tokenCatalog';
import { avatarForeground } from '@design/userColor';

import { avatarGlyph, clampTone } from './avatarGlyphs';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

interface AvatarProps {
  /** Nombre completo: da las iniciales y es el texto accesible por defecto. */
  name: string;
  /** Semilla del color determinista. Sin ella se usa `name`. */
  email?: string;
  /** Foto real, del catálogo o cacheada de un remoto. Sin ella, se generan iniciales. */
  src?: string;
  /**
   * Dibujo elegido del catálogo, en vez de las iniciales.
   *
   * Un identificador que ya no esté en el catálogo se ignora y vuelven las
   * iniciales: un avatar guardado por otra versión no puede dejar un hueco.
   */
  glyph?: string;
  /** Tono elegido, de 1 a 16. Sin él, el determinista de la semilla. */
  tone?: number;
  /** Color libre validado y elegido por el usuario. */
  color?: string;
  size?: AvatarSize;
  className?: string;
}

function hashToTone(seed: string): number {
  let hash = 0;

  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;

  return (Math.abs(hash) % AVATAR_TONE_COUNT) + 1;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';

  const [first, second] = parts;
  const letters = second ? [first?.[0], second[0]] : [first?.[0]];

  return letters.filter(Boolean).join('').toUpperCase();
}

/**
 * Por defecto, un color determinista de los tonos del avatar — nunca un
 * literal ad hoc — así que el avatar generado ya respeta los siete temas.
 *
 * `glyph` y `tone` son la elección explícita: una ilustración del catálogo
 * y uno de los dieciséis tonos. Sin ellos, iniciales y
 * color de la semilla, que es lo que hace que un repositorio tenga cara desde el
 * primer día sin que nadie tenga que elegirle nada.
 *
 * `xs` es para filas densas (tabla de commits, lista de contribuidores), no
 * para el nodo del grafo: ese lo dibuja `GraphNode` directamente en canvas en
 * F2.3, a su propio tamaño (`--graph-node-radius`), por rendimiento con
 * 100 000 commits — no monta un `Avatar` de React por nodo.
 */
export function Avatar({
  name,
  email,
  src,
  glyph,
  tone,
  color,
  size = 'md',
  className,
}: AvatarProps) {
  const classes = [styles.avatar, styles[size], className].filter(Boolean).join(' ');

  if (src) {
    return <img className={classes} src={src} alt={name} />;
  }

  const branch = tone === undefined ? hashToTone(email ?? name) : clampTone(tone);
  const toneClass = styles[`tone${String(branch)}`];
  const drawing = avatarGlyph(glyph);

  return (
    <span
      className={[classes, toneClass].filter(Boolean).join(' ')}
      role="img"
      aria-label={name}
      style={
        color
          ? ({
              '--avatar-color': color,
              '--avatar-foreground': avatarForeground(color),
            } as CSSProperties)
          : undefined
      }
      data-custom-color={color ? '' : undefined}
    >
      {drawing ? (
        <svg
          className={styles.glyph}
          viewBox="0 0 24 24"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {drawing.draw()}
        </svg>
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

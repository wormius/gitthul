import stacked from '../assets/brand/logo.svg?raw';

import styles from './AppLogo.module.css';

/*
 * El lockup apilado, servido desde el maestro de marca.
 *
 * El SVG de `src/assets/brand/` se lee entero y se le sacan el `viewBox`,
 * la transformación del grupo y los trazos con id. Copiarlos a mano
 * significaría que reexportar el logotipo desde Inkscape dejaría de cambiar lo
 * que la ventana pinta, que es la forma más silenciosa de que la marca se
 * desincronice de su maestro.
 *
 * Lo que sí cambia respecto del archivo son los colores, y tiene que cambiar: el
 * maestro trae los literales del tema «Thul» y aquí manda el sistema de diseño.
 * El Cthulhu hereda `currentColor` —es monocromo y se invierte con el modo, que
 * es la regla de marca—, «Git» va en el gris neutro y «Thul» en el acento del
 * tema en curso, sea el que sea.
 */

/**
 * El valor de un atributo, exigiendo que empiece donde empieza el atributo.
 *
 * El espacio de delante no sobra: sin él, pedir `d` acertaría dentro de
 * `id="cthulhu"` y el logotipo saldría con el identificador por trazo.
 */
function attribute(source: string, name: string): string {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(source)?.[1] ?? '';
}

/** El trazo con ese `id`, tal cual está en el maestro. */
function pathOf(source: string, id: string): string {
  const tag = new RegExp(`<path[^>]*\\bid="${id}"[^>]*>`).exec(source)?.[0] ?? '';

  return attribute(tag, 'd');
}

const VIEW_BOX = attribute(/<svg[\s\S]*?>/.exec(stacked)?.[0] ?? '', 'viewBox');
const GROUP_TRANSFORM = attribute(/<g[\s\S]*?>/.exec(stacked)?.[0] ?? '', 'transform');

const CTHULHU = pathOf(stacked, 'cthulhu');
const GIT = pathOf(stacked, 'git');
const THUL = pathOf(stacked, 'thul');
const TRADEMARK = pathOf(stacked, 'trademark');

interface AppLogoProps {
  /**
   * Texto accesible. Sin él el logotipo es decorativo, que es lo correcto
   * cuando ya vive dentro de un botón que se nombra a sí mismo.
   */
  title?: string;
  className?: string;
}

/** El logotipo apilado de GitThul: Cthulhu arriba, «GitThul™» debajo. */
export function AppLogo({ title, className }: AppLogoProps) {
  return (
    <svg
      className={[styles.logo, className].filter(Boolean).join(' ')}
      viewBox={VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      <g transform={GROUP_TRANSFORM}>
        <path d={CTHULHU} className={styles.cthulhu} />
        <path d={GIT} className={styles.git} />
        <path d={THUL} className={styles.thul} />
        <path d={TRADEMARK} className={styles.git} />
      </g>
    </svg>
  );
}

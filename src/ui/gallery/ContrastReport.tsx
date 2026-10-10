import { parseHexColor, contrastRatio } from '@design/color';
import { CONTRAST_PAIRS, minimumFor } from '@design/contrastPairs';
import { useCssTokens } from '@design/useCssTokens';
import { useTheme } from '@design/useTheme';

import styles from './ContrastReport.module.css';

const TOKENS = [...new Set(CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]))];

/**
 * Mide en vivo los mismos pares que verifica `tokens.test.ts`.
 *
 * La prueba mide el CSS fuente; esto mide lo que el navegador terminó
 * resolviendo. Sirve para ver un fallo de contraste al vuelo mientras se
 * retoca un tema, sin esperar a la suite.
 */
export function ContrastReport() {
  const { resolved } = useTheme();
  const values = useCssTokens(TOKENS);

  const measured = CONTRAST_PAIRS.map((pair) => {
    const foreground = parseHexColor(values[pair.foreground] ?? '');
    const background = parseHexColor(values[pair.background] ?? '');

    if (!foreground || !background) return null;

    const ratio = contrastRatio(foreground, background);
    const minimum = minimumFor(pair.kind, resolved.theme);

    return { pair, ratio, minimum, passes: ratio >= minimum };
  }).filter((row) => row !== null);

  const failures = measured.filter((row) => !row.passes);

  if (measured.length === 0) {
    return (
      <div className={styles.report}>
        <p className={styles.empty}>
          El navegador no expuso los tokens resueltos, así que no hay nada que medir.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.report}>
      <p className={styles.summary}>
        <span className={`${styles.headline} ${failures.length === 0 ? styles.pass : styles.fail}`}>
          {failures.length === 0
            ? `${String(measured.length)} pares dentro del mínimo`
            : `${String(failures.length)} de ${String(measured.length)} pares por debajo del mínimo`}
        </span>
        <span className={styles.note}>
          {resolved.theme === 'contraste'
            ? '7:1 en texto, 4.5:1 en gráficos'
            : '4.5:1 en texto, 3:1 en gráficos'}
        </span>
      </p>

      {failures.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Texto</th>
              <th scope="col">Fondo</th>
              <th scope="col">Relación</th>
              <th scope="col">Mínimo</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((row) => (
              <tr key={`${row.pair.foreground}|${row.pair.background}`}>
                <td>{row.pair.foreground}</td>
                <td>{row.pair.background}</td>
                <td className={styles.ratio}>{row.ratio.toFixed(2)}</td>
                <td className={styles.ratio}>{row.minimum.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

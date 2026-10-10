import styles from './TypeSpecimen.module.css';

const SCALE = [
  ['--text-xs', styles.xs, 'Fecha relativa, contadores y notas al pie'],
  ['--text-sm', styles.sm, 'Ruta atenuada, autor, SHA abreviado'],
  ['--text-md', styles.md, 'Mensaje de commit y texto general'],
  ['--text-lg', styles.lg, 'Nombre del repositorio'],
  ['--text-xl', styles.xl, 'Título de sección'],
  ['--text-2xl', styles.xxl, 'Pantalla de inicio'],
] as const;

/**
 * Las dos escalas, lado a lado.
 *
 * Están juntas para que se vea lo que justifica que sean ajustes separados: la
 * de la izquierda crece con --font-size-ui y la de la derecha con
 * --font-size-code, y mover una no toca la otra.
 */
export function TypeSpecimen() {
  return (
    <div className={styles.specimen}>
      <section className={styles.column}>
        <h3 className={styles.title}>Interfaz</h3>
        <dl className={styles.rows}>
          {SCALE.map(([token, size, sample]) => (
            <div key={token} className={styles.row}>
              <dt className={styles.token}>{token}</dt>
              <dd className={`${styles.sample} ${size}`}>{sample}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.weights}>
          <span className={styles.normal}>Normal 400</span>
          <span className={styles.medium}>Medio 500</span>
          <span className={styles.bold}>Negrita 700</span>
        </p>
      </section>

      <section className={styles.column}>
        <h3 className={styles.title}>Visores</h3>
        <pre className={styles.code} data-selectable>
          <code>
            {'@@ -12,7 +12,9 @@ export function resolveTheme(\n'}
            <span className={styles.removed}>{'-  const mode = settings.mode;\n'}</span>
            <span className={styles.added}>
              {"+  const mode = settings.mode === 'auto' ? system.mode : settings.mode;\n"}
            </span>
            {'   return { theme, mode };\n'}
            {' }\n'}
            {'\n'}
            {'0123456789 · Il1 O0 · {} [] () <> ≠ → ✓\n'}
          </code>
        </pre>
      </section>
    </div>
  );
}

import type { TokenGroup } from '@design/tokenCatalog';
import { useCssTokens } from '@design/useCssTokens';

import styles from './TokenSwatchList.module.css';

interface TokenSwatchListProps {
  group: TokenGroup;
}

/** Un grupo del catálogo, con su valor resuelto en el tema y la densidad actuales. */
export function TokenSwatchList({ group }: TokenSwatchListProps) {
  const values = useCssTokens(group.tokens);

  return (
    <section className={styles.group}>
      <h3 className={styles.title}>{group.title}</h3>
      <ul className={styles.list}>
        {group.tokens.map((token) => (
          <li key={token} className={styles.item}>
            {group.kind === 'color' && (
              <span className={styles.swatch} style={{ backgroundColor: `var(${token})` }} />
            )}
            <span className={styles.text}>
              <span className={styles.name}>{token}</span>
              <span className={styles.value}>{values[token] || '—'}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { MODES, THEMES } from '@design/theme';
import { useTheme } from '@design/useTheme';
import { CodeSurface } from '../CodeSurface';

const SAMPLE = `// Validación: "número de autorización"
@Pattern(message = "Número no válido", regexp = "[0-9]+")
public String getAuthorization() {
  return this.authorization + 42;
}`;

/** Misma muestra en las catorce paletas, con la variante activa de la galería. */
export function SyntaxPaletteGallery() {
  const { settings } = useTheme();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 'var(--space-4)',
      }}
    >
      {THEMES.flatMap((theme) =>
        MODES.map((mode) => (
          <article
            key={`${theme}-${mode}`}
            data-theme={theme}
            data-theme-variant={settings.themeVariant}
            data-mode={mode}
            style={{
              padding: 'var(--space-3)',
              background: 'var(--surface-app)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <h3 style={{ margin: '0 0 var(--space-2)' }}>
              {theme} · {settings.themeVariant} · {mode}
            </h3>
            <CodeSurface
              value={SAMPLE}
              language="compiled"
              label={`Java · ${theme} · ${mode}`}
              marks={[
                { line: 2, tone: 'removed' },
                { line: 4, tone: 'added' },
              ]}
              words={[
                { line: 2, start: 20, end: 35, tone: 'removed' },
                { line: 4, start: 30, end: 32, tone: 'added' },
              ]}
              wrap
            />
          </article>
        )),
      )}
    </div>
  );
}

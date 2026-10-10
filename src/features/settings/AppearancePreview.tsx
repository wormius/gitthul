import type { CSSProperties } from 'react';

import type { CodeFont, Density, Mode, Theme, ThemeVariant, UiFont } from '@design/theme';

import styles from './AppearancePreview.module.css';

interface AppearancePreviewProps {
  theme: Theme;
  mode: Mode;
  themeVariant?: ThemeVariant;
  normalLabel?: string;
  terminalLabel?: string;
  density: Density;
  uiFont: UiFont;
  codeFont: CodeFont;
  uiFontSize: number;
  codeFontSize: number;
  /** Un asunto de commit de mentira; lo traduce quien la monta. */
  commitSubject: string;
  /** Los dos botones de la maqueta, ya traducidos: Push y Fetch. */
  actions: readonly [string, string];
  /** Nombre accesible del grupo que la contiene; la maqueta en sí es decorativa. */
  label: string;
  className?: string;
}

/**
 * El contenido de GitThul en miniatura, pintada en un tema que no es el activo.
 *
 * Es lo que hace de vista previa en Apariencia, y funciona porque la capa de
 * roles se declara también para `[data-theme]` (ver `roles.css`): poniéndole los
 * cinco atributos del sistema de diseño, este subárbol resuelve sus propias
 * superficies, textos, acentos y calles de grafo. No hay ni un color literal ni
 * una tabla de colores por tema — si mañana entra un tema nuevo, la maqueta lo
 * sabe pintar sin tocar este archivo.
 *
 * Los dos tamaños de fuente se estampan como variables locales, y con ellos
 * `data-type-scale`, que es lo que hace que `typography.css` recalcule aquí la
 * escala `--text-*` y `--code-size-*`. Sin ese atributo la maqueta heredaría la
 * escala ya resuelta de la raíz y no movería una letra al cambiar el tamaño — el
 * mismo motivo por el que la capa de roles se declara para `[data-theme]`.
 *
 * **Es decorativa.** No tiene un solo control real: cada botón es un `div`, así
 * que no hay nada que tabular ni que anunciar. El nombre accesible lo lleva el
 * grupo de opciones que la acompaña, y el árbol entero va `aria-hidden`.
 */
export function AppearancePreview({
  theme,
  mode,
  themeVariant = 'classic',
  normalLabel,
  terminalLabel,
  density,
  uiFont,
  codeFont,
  uiFontSize,
  codeFontSize,
  commitSubject,
  actions,
  label,
  className,
}: AppearancePreviewProps) {
  const style = {
    '--font-size-ui': `${String(uiFontSize)}px`,
    '--font-size-code': `${String(codeFontSize)}px`,
  } as CSSProperties;

  return (
    <div
      className={[styles.frame, className].filter(Boolean).join(' ')}
      data-theme={theme}
      data-mode={mode}
      data-theme-variant={themeVariant}
      data-density={density}
      data-font-ui={uiFont}
      data-font-code={codeFont}
      data-type-scale=""
      style={style}
      role="img"
      aria-label={label}
    >
      <div className={styles.window} aria-hidden="true">
        {normalLabel && <div className={styles.caption}>{normalLabel}</div>}
        <div className={styles.body}>
          <div className={styles.rail}>
            {['main', 'dev', 'feat/graph'].map((branch, index) => (
              <span
                key={branch}
                className={styles.railRow}
                data-current={index === 0 ? 'true' : undefined}
              >
                <span className={styles.railDot} data-lane={index + 1} />
                {branch}
              </span>
            ))}
          </div>

          <div className={styles.main}>
            <div className={styles.graph}>
              {[1, 2, 3].map((lane) => (
                <div key={lane} className={styles.commit} data-selected={lane === 1 || undefined}>
                  <span className={styles.node} data-lane={lane} />
                  <span className={styles.subject}>{commitSubject}</span>
                  <span className={styles.sha}>a1b2c3{lane}</span>
                </div>
              ))}
            </div>

            <div className={styles.diff}>
              <div className={styles.diffLine} data-kind="removed">
                <span className={styles.gutter}>−</span>
                <span>
                  <span className={styles.syntaxKeyword}>const</span> lane ={' '}
                  <span className={styles.syntaxNumber}>0</span>;
                </span>
              </div>
              <div className={styles.diffLine} data-kind="added">
                <span className={styles.gutter}>+</span>
                <span>
                  <span className={styles.syntaxKeyword}>const</span> lane = branch.
                  <span className={styles.syntaxProperty}>lane</span>;
                </span>
              </div>
            </div>

            <div className={styles.actions}>
              <span className={styles.button} data-variant="primary">
                {actions[0]}
              </span>
              <span className={styles.button} data-variant="ghost">
                {actions[1]}
              </span>
            </div>
          </div>
        </div>
        <div className={styles.terminal}>
          <div className={styles.terminalCaption}>{terminalLabel}</div>
          <div>
            <span className={styles.prompt}>❯</span> git log --oneline
          </div>
          <div>
            <span className={styles.terminalInfo}>a1b2c3d</span>{' '}
            <span className={styles.prompt}>(main)</span> {commitSubject}
          </div>
          <div>
            <span className={styles.prompt}>❯</span> git status --short
          </div>
          <div className={styles.terminalAdded}>M src/app.tsx</div>
        </div>
      </div>
    </div>
  );
}

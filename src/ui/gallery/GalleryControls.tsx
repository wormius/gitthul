import { useId } from 'react';

import {
  CODE_FONT_SIZE,
  CODE_FONTS,
  DENSITIES,
  MODES,
  THEMES,
  THEME_VARIANTS,
  UI_FONT_SIZE,
  UI_FONTS,
  type CodeFont,
  type Density,
  type Mode,
  type Theme,
  type ThemeVariant,
  type UiFont,
} from '@design/theme';
import { useTheme } from '@design/useTheme';

import styles from './GalleryControls.module.css';

/**
 * Las perillas del sistema, en vivo.
 *
 * La galería es una superficie interna de desarrollo — la ruta `/dev/tokens` no
 * se ofrece al usuario — así que sus etiquetas no pasan por i18n. La vista
 * Configuraciones de F4.1 expone estos mismos ajustes ya traducidos.
 */
export function GalleryControls() {
  const { settings, resolved, update } = useTheme();
  const id = useId();

  return (
    <div className={styles.controls}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-theme`}>
          Tema
        </label>
        <select
          id={`${id}-theme`}
          className={styles.select}
          value={settings.theme}
          onChange={(event) => {
            update({ theme: event.target.value as Theme | 'auto' });
          }}
        >
          <option value="auto">auto ({resolved.theme})</option>
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-theme-variant`}>
          Variante
        </label>
        <select
          id={`${id}-theme-variant`}
          className={styles.select}
          value={settings.themeVariant}
          onChange={(event) => {
            update({ themeVariant: event.target.value as ThemeVariant });
          }}
        >
          {THEME_VARIANTS.map((variant) => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-mode`}>
          Modo
        </label>
        <select
          id={`${id}-mode`}
          className={styles.select}
          value={settings.mode}
          onChange={(event) => {
            update({ mode: event.target.value as Mode | 'auto' });
          }}
        >
          <option value="auto">auto ({resolved.mode})</option>
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-density`}>
          Densidad
        </label>
        <select
          id={`${id}-density`}
          className={styles.select}
          value={settings.density}
          onChange={(event) => {
            update({ density: event.target.value as Density });
          }}
        >
          {DENSITIES.map((density) => (
            <option key={density} value={density}>
              {density}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-font-ui`}>
          Fuente de interfaz
        </label>
        <select
          id={`${id}-font-ui`}
          className={styles.select}
          value={settings.uiFont}
          onChange={(event) => {
            update({ uiFont: event.target.value as UiFont });
          }}
        >
          {UI_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-font-code`}>
          Fuente de visores
        </label>
        <select
          id={`${id}-font-code`}
          className={styles.select}
          value={settings.codeFont}
          onChange={(event) => {
            update({ codeFont: event.target.value as CodeFont });
          }}
        >
          {CODE_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-size-ui`}>
          Tamaño de interfaz
        </label>
        <div className={styles.slider}>
          <input
            id={`${id}-size-ui`}
            className={styles.range}
            type="range"
            min={UI_FONT_SIZE.min}
            max={UI_FONT_SIZE.max}
            step={UI_FONT_SIZE.step}
            value={settings.uiFontSize}
            onChange={(event) => {
              update({ uiFontSize: Number(event.target.value) });
            }}
          />
          <span className={styles.readout}>{settings.uiFontSize} px</span>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-size-code`}>
          Tamaño de visores
        </label>
        <div className={styles.slider}>
          <input
            id={`${id}-size-code`}
            className={styles.range}
            type="range"
            min={CODE_FONT_SIZE.min}
            max={CODE_FONT_SIZE.max}
            step={CODE_FONT_SIZE.step}
            value={settings.codeFontSize}
            onChange={(event) => {
              update({ codeFontSize: Number(event.target.value) });
            }}
          />
          <span className={styles.readout}>{settings.codeFontSize} px</span>
        </div>
      </div>
    </div>
  );
}

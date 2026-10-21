import { useState, type KeyboardEvent } from 'react';

import {
  CODE_FONTS,
  CODE_FONT_SIZE,
  DEFAULT_THEME_SETTINGS,
  DENSITIES,
  MODES,
  THEMES,
  THEME_VARIANTS,
  UI_FONTS,
  UI_FONT_SIZE,
  type CodeFont,
  type Theme,
  type ThemeVariant,
  type ToastPosition,
  type UiFont,
} from '@design/theme';
import { useTheme } from '@design/useTheme';
import { useMediaQuery } from '@design/useMediaQuery';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { SegmentedControl } from '@ui/SegmentedControl';

import { AppearancePreview } from './AppearancePreview';
import { DensityCard } from './DensityCard';
import { FontChoiceCard } from './FontChoiceCard';
import { ResetButton } from './ResetButton';
import { SettingsSection } from './SettingsSection';
import { ModeDarkIcon, ModeLightIcon, ModeSystemIcon } from './SettingsIcons';
import { ToastPositionPreview } from './ToastPositionPreview';
import { ToastPositionPicker } from './ToastPositionPicker';
import { ThemeChip } from './ThemeChip';
import styles from './AppearanceSection.module.css';

const MODE_ICONS = {
  auto: <ModeSystemIcon />,
  light: <ModeLightIcon />,
  dark: <ModeDarkIcon />,
} as const;

/**
 * Apariencia, montada como un estudio: cada elección se ve antes de aplicarse.
 *
 * El orden es deliberado. **Modo va primero** porque decide la mitad de lo que se
 * ve —claro u oscuro— y elegir tema sin haberlo fijado es elegir a ciegas.
 * Después el tema, con su maqueta debajo; después densidad, fuentes y avisos,
 * cada uno con su propia vista previa.
 *
 * Aquí no hay ni un `Select` ni un `Radio`: todo lo que se elige se enseña. Lo
 * que lo permite es que la capa de roles y las familias de tipografía se puedan
 * declarar en un subárbol (ver `roles.css` y `typography.css`), así que un chip
 * de tema se pinta en su tema y una ficha de fuente en su fuente, sin una sola
 * tabla de colores ni de familias escrita en JavaScript.
 *
 * **Cada bloque restablece lo suyo.** El «Restablecer sección» del pie devuelve
 * los ajustes de golpe, y eso es demasiado grueso cuando lo único que se
 * quiere deshacer es la fuente que se acaba de probar; los botones de bloque
 * llegan a un solo campo y se apagan cuando ese campo ya está de fábrica.
 */
export function AppearanceSection() {
  const { t } = useI18n();
  const { settings, resolved, update } = useTheme();
  const prefersContrast = useMediaQuery('(prefers-contrast: more)');
  const automaticTheme: Theme = prefersContrast ? 'contraste' : 'thul';

  /*
   * El tema que la maqueta enseña mientras el puntero está sobre un chip. No se
   * aplica: es una mirada, y al salir se suelta. Cambia color, nunca caja, así
   * que no choca con la invariante 1.
   */
  const [peekTheme, setPeekTheme] = useState<Theme | null>(null);
  const [peekVariant, setPeekVariant] = useState<ThemeVariant | null>(null);
  const previewTheme = peekTheme ?? resolved.theme;
  const previewVariant = peekVariant ?? settings.themeVariant;
  const previewName = `${t(`settings.appearance.theme.${previewTheme}`)} ${t(`settings.appearance.variant.${previewVariant}`)}`;

  function navigateChoices(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    const current = options.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (current + direction + options.length) % options.length;
    options[index]?.focus();
    options[index]?.click();
  }

  const [toastPreview, setToastPreview] = useState<{
    position: ToastPosition;
    revision: number;
  } | null>(null);

  function previewToast(position: ToastPosition) {
    setToastPreview((current) => ({ position, revision: (current?.revision ?? 0) + 1 }));
  }

  function reset() {
    update(DEFAULT_THEME_SETTINGS);
    setPeekTheme(null);
    setPeekVariant(null);
    setToastPreview(null);
  }

  return (
    <SettingsSection
      wide
      title={t('settings.section.appearance')}
      actions={
        <Button variant="ghost" onClick={reset}>
          {t('settings.reset')}
        </Button>
      }
    >
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.mode')}</h2>
          <ResetButton
            what={t('settings.appearance.mode')}
            disabled={settings.mode === DEFAULT_THEME_SETTINGS.mode}
            onReset={() => {
              update({ mode: DEFAULT_THEME_SETTINGS.mode });
            }}
          />
        </div>
        <SegmentedControl
          className={styles.modes}
          label={t('settings.appearance.mode')}
          value={settings.mode}
          options={(['auto', ...MODES] as const).map((value) => ({
            value,
            label: t(`settings.appearance.mode.${value}`),
            icon: MODE_ICONS[value],
          }))}
          onChange={(value) => {
            update({ mode: value });
          }}
        />
        <p className={styles.note}>
          {settings.mode === 'auto'
            ? t('settings.appearance.modeAutoResolved', {
                value: t(`settings.appearance.mode.${resolved.mode}`),
              })
            : t('settings.appearance.modeHint')}
        </p>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.theme')}</h2>
          <ResetButton
            what={t('settings.appearance.theme')}
            disabled={settings.theme === DEFAULT_THEME_SETTINGS.theme}
            onReset={() => {
              update({ theme: DEFAULT_THEME_SETTINGS.theme });
            }}
          />
        </div>
        <p className={styles.note}>{t('settings.appearance.themeHint')}</p>
        <div
          onKeyDown={navigateChoices}
          className={styles.themes}
          role="radiogroup"
          aria-label={t('settings.appearance.theme')}
        >
          <ThemeChip
            theme={automaticTheme}
            mode={resolved.mode}
            themeVariant={settings.themeVariant}
            label={t('settings.appearance.themeAuto')}
            hint={t(`settings.appearance.theme.${automaticTheme}`)}
            selected={settings.theme === 'auto'}
            onSelect={() => {
              update({ theme: 'auto' });
            }}
            onPeek={() => {
              setPeekTheme(automaticTheme);
            }}
            onPeekEnd={() => {
              setPeekTheme(null);
            }}
          />
          {THEMES.map((theme) => (
            <ThemeChip
              key={theme}
              theme={theme}
              mode={resolved.mode}
              themeVariant={settings.themeVariant}
              label={t(`settings.appearance.theme.${theme}`)}
              hint={t(`settings.appearance.themeDescription.${theme}`)}
              selected={settings.theme === theme}
              onSelect={() => {
                update({ theme });
              }}
              onPeek={() => {
                setPeekTheme(theme);
              }}
              onPeekEnd={() => {
                setPeekTheme(null);
              }}
            />
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.variants')}</h2>
          <ResetButton
            what={t('settings.appearance.variants')}
            disabled={settings.themeVariant === DEFAULT_THEME_SETTINGS.themeVariant}
            onReset={() => {
              update({ themeVariant: DEFAULT_THEME_SETTINGS.themeVariant });
              setPeekVariant(null);
            }}
          />
        </div>
        <h3 className={styles.variantTitle}>{t(`settings.appearance.theme.${resolved.theme}`)}</h3>
        <div
          className={styles.variants}
          role="radiogroup"
          aria-label={t('settings.appearance.variants')}
          onKeyDown={navigateChoices}
        >
          {THEME_VARIANTS.map((themeVariant) => (
            <ThemeChip
              key={themeVariant}
              theme={resolved.theme}
              mode={resolved.mode}
              themeVariant={themeVariant}
              label={`${t(`settings.appearance.theme.${resolved.theme}`)} ${t(`settings.appearance.variant.${themeVariant}`)}`}
              hint={t(`settings.appearance.variantDescription.${themeVariant}`)}
              selected={settings.themeVariant === themeVariant}
              onSelect={() => {
                update({ themeVariant });
              }}
              onPeek={() => {
                setPeekVariant(themeVariant);
              }}
              onPeekEnd={() => {
                setPeekVariant(null);
              }}
            />
          ))}
        </div>
        <p className={styles.note}>{t('settings.appearance.variantHint')}</p>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.preview')}</h2>
        </div>
        <AppearancePreview
          theme={previewTheme}
          themeVariant={previewVariant}
          normalLabel={t('settings.appearance.previewNormal')}
          terminalLabel={t('settings.appearance.previewTerminal')}
          mode={resolved.mode}
          density={settings.density}
          uiFont={settings.uiFont}
          codeFont={settings.codeFont}
          uiFontSize={settings.uiFontSize}
          codeFontSize={settings.codeFontSize}
          commitSubject={t('settings.appearance.previewCommit')}
          actions={[t('working.actionBar.push'), t('working.actionBar.fetch')]}
          label={t('settings.appearance.previewLabel', {
            theme: previewName,
          })}
        />
        <p className={styles.note}>
          {(peekTheme && peekTheme !== resolved.theme) ||
          (peekVariant && peekVariant !== settings.themeVariant)
            ? t('settings.appearance.previewPeek', {
                theme: previewName,
              })
            : t('settings.appearance.previewNote')}
        </p>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.density')}</h2>
          <ResetButton
            what={t('settings.appearance.density')}
            disabled={settings.density === DEFAULT_THEME_SETTINGS.density}
            onReset={() => {
              update({ density: DEFAULT_THEME_SETTINGS.density });
            }}
          />
        </div>
        <div
          className={styles.densities}
          role="radiogroup"
          aria-label={t('settings.appearance.density')}
        >
          {DENSITIES.map((density) => (
            <DensityCard
              key={density}
              density={density}
              label={t(`settings.appearance.density.${density}`)}
              selected={settings.density === density}
              onSelect={() => {
                update({ density });
              }}
            />
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.fonts')}</h2>
        </div>
        <div className={styles.fonts}>
          <FontChoiceCard
            kind="ui"
            title={t('settings.appearance.uiFont')}
            familyLabel={t('settings.appearance.uiFont')}
            options={UI_FONTS.map((value) => ({
              value,
              label: t(`settings.appearance.uiFont.${value}`),
            }))}
            value={settings.uiFont}
            onChange={(value) => {
              update({ uiFont: value as UiFont });
            }}
            onResetFamily={() => {
              update({ uiFont: DEFAULT_THEME_SETTINGS.uiFont });
            }}
            familyIsDefault={settings.uiFont === DEFAULT_THEME_SETTINGS.uiFont}
            sizeLabel={t('settings.appearance.uiFontSize')}
            size={settings.uiFontSize}
            min={UI_FONT_SIZE.min}
            max={UI_FONT_SIZE.max}
            step={UI_FONT_SIZE.step}
            presets={UI_FONT_SIZE.presets}
            presetsLabel={t('settings.appearance.presets')}
            onSizeChange={(uiFontSize) => {
              update({ uiFontSize });
            }}
            onResetSize={() => {
              update({ uiFontSize: DEFAULT_THEME_SETTINGS.uiFontSize });
            }}
            sizeIsDefault={settings.uiFontSize === DEFAULT_THEME_SETTINGS.uiFontSize}
            specimen={t('settings.appearance.uiSpecimen')}
          />
          <FontChoiceCard
            kind="code"
            title={t('settings.appearance.codeFont')}
            familyLabel={t('settings.appearance.codeFont')}
            options={CODE_FONTS.map((value) => ({
              value,
              label: t(`settings.appearance.codeFont.${value}`),
            }))}
            value={settings.codeFont}
            onChange={(value) => {
              update({ codeFont: value as CodeFont });
            }}
            onResetFamily={() => {
              update({ codeFont: DEFAULT_THEME_SETTINGS.codeFont });
            }}
            familyIsDefault={settings.codeFont === DEFAULT_THEME_SETTINGS.codeFont}
            sizeLabel={t('settings.appearance.codeFontSize')}
            size={settings.codeFontSize}
            min={CODE_FONT_SIZE.min}
            max={CODE_FONT_SIZE.max}
            step={CODE_FONT_SIZE.step}
            presets={CODE_FONT_SIZE.presets}
            presetsLabel={t('settings.appearance.presets')}
            onSizeChange={(codeFontSize) => {
              update({ codeFontSize });
            }}
            onResetSize={() => {
              update({ codeFontSize: DEFAULT_THEME_SETTINGS.codeFontSize });
            }}
            sizeIsDefault={settings.codeFontSize === DEFAULT_THEME_SETTINGS.codeFontSize}
            specimen="const lane = 0O1lI; // {} => []"
          />
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>{t('settings.appearance.toastPosition')}</h2>
          <ResetButton
            what={t('settings.appearance.toastPosition')}
            disabled={settings.toastPosition === DEFAULT_THEME_SETTINGS.toastPosition}
            onReset={() => {
              update({ toastPosition: DEFAULT_THEME_SETTINGS.toastPosition });
              previewToast(DEFAULT_THEME_SETTINGS.toastPosition);
            }}
          />
        </div>
        <p className={styles.note}>{t('settings.appearance.toastPositionHint')}</p>
        <ToastPositionPicker
          value={settings.toastPosition}
          onChange={(toastPosition) => {
            update({ toastPosition });
            previewToast(toastPosition);
          }}
        />
        <Button
          className={styles.toastPreviewButton}
          variant="ghost"
          onClick={() => previewToast(settings.toastPosition)}
        >
          {t('settings.appearance.toastPreview')}
        </Button>
        {toastPreview && (
          <ToastPositionPreview key={toastPreview.revision} position={toastPreview.position} />
        )}
      </div>
    </SettingsSection>
  );
}

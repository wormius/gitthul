import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { DEFAULT_USER_COLOR } from '@design/userColor';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';

import { Avatar } from './Avatar';
import {
  AVATAR_CATEGORIES,
  AVATAR_TONES,
  avatarGlyph,
  type AvatarCategoryId,
} from './avatarGlyphs';
import styles from './AvatarPicker.module.css';

interface AvatarPickerProps {
  name: string;
  seed?: string;
  glyph: string | null;
  tone: number;
  color?: string | null;
  onGlyphChange: (glyph: string | null) => void;
  onToneChange: (tone: number) => void;
  /** Los perfiles guardan tonos; los repositorios también admiten un color libre. */
  onColorChange?: (color: string | null) => void;
  disabled?: boolean;
}

/** Catálogo compartido: explorar una categoría conserva el dibujo elegido. */
export function AvatarPicker({
  name,
  seed,
  glyph,
  tone,
  color = null,
  onGlyphChange,
  onToneChange,
  onColorChange,
  disabled = false,
}: AvatarPickerProps) {
  const { t } = useI18n();
  const id = useId();
  const [category, setCategory] = useState<AvatarCategoryId>(
    () => avatarGlyph(glyph ?? undefined)?.category ?? 'symbols',
  );
  const tabs = useRef(new Map<AvatarCategoryId, HTMLButtonElement>());
  const selected = avatarGlyph(glyph ?? undefined);
  const selectedLabel = selected
    ? t(`avatar.glyph.${selected.id}` as MessageKey)
    : t('repositories.avatar.initials');
  const appearance = { tone, ...(color === null ? {} : { color }) };

  function navigateCategories(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
    const next =
      event.key === 'Home'
        ? AVATAR_CATEGORIES[0]
        : event.key === 'End'
          ? AVATAR_CATEGORIES[AVATAR_CATEGORIES.length - 1]
          : AVATAR_CATEGORIES[(index + step + AVATAR_CATEGORIES.length) % AVATAR_CATEGORIES.length];
    if (!next) return;
    event.preventDefault();
    setCategory(next.id);
    tabs.current.get(next.id)?.focus();
  }

  return (
    <div className={styles.picker}>
      <div className={styles.preview}>
        <Avatar
          name={name}
          {...(seed === undefined ? {} : { email: seed })}
          size="lg"
          className={styles.previewAvatar}
          {...(glyph === null ? {} : { glyph, ...appearance })}
        />
        <div className={styles.previewText}>
          <span className={styles.previewName}>{name}</span>
          <span className={styles.previewDrawing} aria-live="polite">
            {selectedLabel}
          </span>
        </div>
        <button
          type="button"
          className={styles.initials}
          aria-pressed={glyph === null}
          disabled={disabled}
          onClick={() => onGlyphChange(null)}
        >
          <span aria-hidden="true">
            <Avatar name={name} {...(seed === undefined ? {} : { email: seed })} size="sm" />
          </span>
          {t('repositories.avatar.initials')}
        </button>
      </div>

      <fieldset className={styles.colors} disabled={disabled}>
        <legend className={styles.legend}>{t('repositories.avatar.tones')}</legend>
        <div className={styles.tones}>
          {Array.from({ length: AVATAR_TONES }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.tone}
              style={{ '--swatch-color': `var(--avatar-tone-${String(value)})` } as CSSProperties}
              aria-label={t('repositories.avatar.tone', { tone: value })}
              aria-pressed={color === null && tone === value}
              onClick={() => {
                onToneChange(value);
                onColorChange?.(null);
              }}
            />
          ))}
          {onColorChange && (
            <label className={styles.customColor}>
              <input
                className={styles.colorInput}
                type="color"
                aria-label={t('repositories.avatar.customColor')}
                value={color ?? DEFAULT_USER_COLOR}
                onChange={(event) => onColorChange(event.target.value.toLowerCase())}
              />
              <span>{t('repositories.avatar.customColor')}</span>
            </label>
          )}
        </div>
      </fieldset>

      <div className={styles.catalog}>
        <div className={styles.tabs} role="tablist" aria-label={t('avatar.categories')}>
          {AVATAR_CATEGORIES.map((entry, index) => (
            <button
              key={entry.id}
              ref={(node) => {
                if (node) tabs.current.set(entry.id, node);
                else tabs.current.delete(entry.id);
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${entry.id}`}
              aria-controls={`${id}-panel-${entry.id}`}
              aria-selected={category === entry.id}
              tabIndex={category === entry.id ? 0 : -1}
              className={styles.tab}
              disabled={disabled}
              onClick={() => setCategory(entry.id)}
              onKeyDown={(event) => navigateCategories(event, index)}
            >
              {t(`avatar.category.${entry.id}` as MessageKey)}
            </button>
          ))}
        </div>

        {AVATAR_CATEGORIES.map((entry) => (
          <div
            key={entry.id}
            role="tabpanel"
            id={`${id}-panel-${entry.id}`}
            aria-labelledby={`${id}-tab-${entry.id}`}
            hidden={category !== entry.id}
            className={styles.panel}
          >
            {category === entry.id && (
              <div className={styles.glyphs}>
                {entry.glyphs.map((drawing) => {
                  const label = t(`avatar.glyph.${drawing.id}` as MessageKey);
                  return (
                    <button
                      key={drawing.id}
                      type="button"
                      className={styles.option}
                      aria-pressed={glyph === drawing.id}
                      disabled={disabled}
                      onClick={() => onGlyphChange(drawing.id)}
                    >
                      <span aria-hidden="true">
                        <Avatar name={label} glyph={drawing.id} {...appearance} size="lg" />
                      </span>
                      <span className={styles.optionLabel}>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

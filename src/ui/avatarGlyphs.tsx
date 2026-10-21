import type { AvatarCategoryId, AvatarGlyph } from './avatarTypes';
import { SYMBOLS } from './avatarSymbols';
import { ANIMALS } from './avatarAnimals';
import { PLANTS } from './avatarPlants';
import { FESTIVITIES } from './avatarFestivities';
import { ABSTRACT } from './avatarAbstract';

export type { AvatarCategoryId, AvatarGlyph, AvatarGlyphKind } from './avatarTypes';

/** Tonos propios del avatar, independientes del grafo. */
export const AVATAR_TONES = 16;

export function clampTone(tone: number): number {
  return Math.min(Math.max(Math.round(tone), 1), AVATAR_TONES);
}

/** Emblemas de 24 unidades: tinta, medios tonos y recortes del fondo del avatar. */
export const AVATAR_CATEGORIES: readonly {
  id: AvatarCategoryId;
  glyphs: readonly AvatarGlyph[];
}[] = (
  [
    ['symbols', SYMBOLS],
    ['animals', ANIMALS],
    ['plants', PLANTS],
    ['festivities', FESTIVITIES],
    ['abstract', ABSTRACT],
  ] as const
).map(([id, sources]) => ({
  id,
  glyphs: sources.map((glyph) => ({ ...glyph, category: id, kind: 'illustration' })),
}));

export const AVATAR_GLYPHS: readonly AvatarGlyph[] = AVATAR_CATEGORIES.flatMap(
  (category) => category.glyphs,
);

const BY_ID = new Map(AVATAR_GLYPHS.map((glyph) => [glyph.id, glyph]));

/** Un ID desconocido conserva el respaldo de iniciales del avatar. */
export function avatarGlyph(id: string | undefined): AvatarGlyph | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

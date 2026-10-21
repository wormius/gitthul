import type { ReactNode } from 'react';

/** Los IDs se persisten en repositorios y perfiles: un redibujo nunca los renombra. */
export interface AvatarGlyph {
  id: string;
  category: AvatarCategoryId;
  kind: AvatarGlyphKind;
  draw: () => ReactNode;
}

export type AvatarGlyphKind = 'illustration';
export type AvatarCategoryId = 'symbols' | 'animals' | 'plants' | 'festivities' | 'abstract';
export type GlyphSource = Pick<AvatarGlyph, 'id' | 'draw'>;

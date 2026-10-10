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

/** Tonos propios del avatar, independientes del grafo. */
export const AVATAR_TONES = 16;

export function clampTone(tone: number): number {
  return Math.min(Math.max(Math.round(tone), 1), AVATAR_TONES);
}

type GlyphSource = Pick<AvatarGlyph, 'id' | 'draw'>;

/** Los pequeños detalles sólidos dan expresión incluso en las filas de 24 px. */
function eyes(y = 11, left = 9, right = 15): ReactNode {
  return (
    <g fill="currentColor" stroke="none">
      <circle cx={left} cy={y} r=".85" />
      <circle cx={right} cy={y} r=".85" />
    </g>
  );
}

const SYMBOLS: readonly GlyphSource[] = [
  {
    id: 'terminal',
    draw: () => (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="m7 9 3 3-3 3m6 0h4" />
        <path d="M3 7h18" opacity=".35" />
      </>
    ),
  },
  {
    id: 'branch',
    draw: () => (
      <>
        <circle cx="7" cy="5" r="2" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="17" cy="5" r="2" />
        <path d="M7 7v10m10-10v2a5 5 0 0 1-5 5H7" />
      </>
    ),
  },
  {
    id: 'rocket',
    draw: () => (
      <>
        <path d="M12 2c3.5 2.8 5 6.2 5 10l-5 4-5-4c0-3.8 1.5-7.2 5-10Z" />
        <circle cx="12" cy="8" r="2" />
        <path d="m7 10-3 4v4l4-2m9-6 3 4v4l-4-2m-6 3 2 3 2-3" />
        <path d="M9 13h6" />
      </>
    ),
  },
  {
    id: 'book',
    draw: () => (
      <>
        <path d="M12 6C9 3.8 6 3.5 3 4v15c3-.5 6-.2 9 2 3-2.2 6-2.5 9-2V4c-3-.5-6-.2-9 2Zm0 0v15" />
        <path d="m6 8 3 1m-3 3 3 1m6-4 3-1m-3 5 3-1" opacity=".6" />
      </>
    ),
  },
  {
    id: 'flask',
    draw: () => (
      <>
        <path d="M9 3h6m-5 0v6L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3" />
        <path d="M7 14h10" />
        <path d="M7 17h10l1.2 2H5.8Z" fill="currentColor" stroke="none" opacity=".22" />
        <circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'gear',
    draw: () => (
      <>
        <path d="m10 3-.5 2-2 .9-1.8-1-2 3.4 1.6 1.4-.2 2.2L3 13l1 3.8 2.3-.1 1.5 1.5-.1 2.3 3.8 1 .9-2.1 2.2-.2 1.4 1.6 3.4-2-1-1.8.9-2 2-.5V10l-2-.5-.9-2 1-1.8-3.4-2-1.4 1.6-2.2-.2L11.5 3Z" />
        <circle cx="12" cy="12" r="3.2" />
      </>
    ),
  },
  {
    id: 'star',
    draw: () => (
      <>
        <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L2.8 9.7l6.4-.9Z" />
        <path d="m12 7 1.5 3.1 3.4.5" opacity=".4" />
      </>
    ),
  },
  {
    id: 'heart',
    draw: () => (
      <>
        <path d="M12 21 4.6 13.6A6.2 6.2 0 0 1 12 3.9a6.2 6.2 0 0 1 7.4 9.7Z" />
        <path d="M6.5 7.2A2.5 2.5 0 0 1 9 6" opacity=".6" />
      </>
    ),
  },
  {
    id: 'bolt',
    draw: () => (
      <>
        <path d="M13.5 2 5 14h6l-1 8 9-12h-6Z" />
        <path d="m13.5 2-2 10H17L10 22l1-8H5Z" fill="currentColor" stroke="none" opacity=".16" />
      </>
    ),
  },
  {
    id: 'cloud',
    draw: () => (
      <>
        <path d="M7 19h10a4 4 0 0 0 .7-7.9 6 6 0 0 0-11.5-2A5 5 0 0 0 7 19Z" />
        <path d="M9 8a3 3 0 0 1 5 0" opacity=".5" />
      </>
    ),
  },
  {
    id: 'globe',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18M5 6.5h14M5 17.5h14" />
      </>
    ),
  },
  {
    id: 'key',
    draw: () => (
      <>
        <circle cx="7.5" cy="16.5" r="4.5" />
        <path d="m11 13 9-9m-3 3 3 3m0-6 2 2" />
        <circle cx="6.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'lock',
    draw: () => (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
        <path d="M12 16v2" />
      </>
    ),
  },
  {
    id: 'moon',
    draw: () => (
      <>
        <path d="M20.5 14.5A9 9 0 0 1 9.5 3 9 9 0 1 0 20.5 14.5Z" />
        <path
          d="m17 3 .5 1.5L19 5l-1.5.5L17 7l-.5-1.5L15 5l1.5-.5Z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
  {
    id: 'sun',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" opacity=".22" />
      </>
    ),
  },
  {
    id: 'anchor',
    draw: () => (
      <>
        <circle cx="12" cy="4.5" r="2.5" />
        <path d="M12 7v14M7 10h10M3 14v3a9 9 0 0 0 18 0v-3m-18 0 3 2m15-2-3 2" />
      </>
    ),
  },
  {
    id: 'flame',
    draw: () => (
      <>
        <path d="M14 2c1 6-4 5-3 10 2-1 3-3 3-5 4 3 7 6 5 10a7.5 7.5 0 0 1-14-1c-1-5 3-7 4-11 0 3 1 4 2 5 0-4 2-5 3-8Z" />
        <path
          d="M12 14c-2 2-3 3-2 5a2.4 2.4 0 0 0 4 0c1-2 0-3-2-5Z"
          fill="currentColor"
          stroke="none"
          opacity=".35"
        />
      </>
    ),
  },
  {
    id: 'droplet',
    draw: () => (
      <>
        <path d="M12 2c-2.7 4.7-7.5 9-7.5 13A7.5 7.5 0 0 0 19.5 15c0-4-4.8-8.3-7.5-13Z" />
        <path d="M8 14c-.5 2 .5 3.5 2 4" opacity=".6" />
      </>
    ),
  },
  {
    id: 'mountain',
    draw: () => (
      <>
        <path d="M2 20 10 4l8 16Zm12-8 3-6 5 14h-4" />
        <path d="m7 10 3 2 3-2M2 20h20" />
      </>
    ),
  },
  {
    id: 'compass',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" />
        <path d="m16 8-4 4-1.5-1.5Z" fill="currentColor" stroke="none" />
        <path d="M12 4v1m0 14v1M4 12h1m14 0h1" />
      </>
    ),
  },
  {
    id: 'music',
    draw: () => (
      <>
        <path d="M10 17V5l10-2v12M10 9l10-2" />
        <ellipse cx="6.5" cy="18" rx="3.5" ry="2.5" />
        <ellipse cx="16.5" cy="16" rx="3.5" ry="2.5" />
      </>
    ),
  },
  {
    id: 'camera',
    draw: () => (
      <>
        <path d="M4 7h4l2-3h4l2 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
        <circle cx="12" cy="14" r="4" />
        <circle cx="19" cy="10" r=".8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'coffee',
    draw: () => (
      <>
        <path d="M4 9h13v6a6.5 6.5 0 0 1-13 0Zm13 0h2a3 3 0 0 1 0 6h-2M3 22h17M7 3v2m4-3v3m4-2v2" />
        <path d="M5 11h11v3H5Z" fill="currentColor" stroke="none" opacity=".18" />
      </>
    ),
  },
  {
    id: 'crown',
    draw: () => (
      <>
        <path d="m3 7 5 4 4-7 4 7 5-4-2 13H5Z" />
        <path d="M5 17h14" />
        <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'shield',
    draw: () => (
      <>
        <path d="m12 2 8 4v6c0 4.5-4 7.5-8 10-4-2.5-8-5.5-8-10V6Z" />
        <path d="m8 12 2.5 2.5 5-5" />
      </>
    ),
  },
  {
    id: 'alien',
    draw: () => (
      <>
        <path d="M12 3C5 3 2.5 7 4 12c1.2 4 5.8 9 8 9s6.8-5 8-9c1.5-5-1-9-8-9Z" />
        <path
          d="M6.5 9c3.5 0 4 2 4 4-3 0-4-2-4-4Zm11 0c-3.5 0-4 2-4 4 3 0 4-2 4-4Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M10.5 17h3" />
      </>
    ),
  },
  {
    id: 'robot',
    draw: () => (
      <>
        <rect x="4" y="6" width="16" height="14" rx="4" />
        <path d="M12 6V3m-8 8H2v5h2m16-5h2v5h-2M8 16h8m-6 0v2m4-2v2" />
        <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
        {eyes(11, 8.5, 15.5)}
      </>
    ),
  },
  {
    id: 'astronaut',
    draw: () => (
      <>
        <path d="M4 17v-6a8 8 0 0 1 16 0v6l-3 4H7Z" />
        <rect x="6" y="6" width="12" height="10" rx="4" />
        <path d="M8 9h4M4 13H2v4h3m15-4h2v4h-3M9 19h6" />
        <path d="m16 8 1 1" opacity=".4" />
      </>
    ),
  },
];

const ANIMALS: readonly GlyphSource[] = [
  {
    id: 'cat',
    draw: () => (
      <>
        <path d="M4 10V3l5 3a11 11 0 0 1 6 0l5-3v7c3 7-1 11-8 11S1 17 4 10Z" />
        {eyes()}
        <path d="m10 14 2 1.5 2-1.5m-2 1.5V18m-8-4-2-1m2 4-2 1m18-4 2-1m-2 4 2 1" />
        <path d="m5 5 3 2m11-2-3 2" opacity=".5" />
      </>
    ),
  },
  {
    id: 'dog',
    draw: () => (
      <>
        <path
          d="M7 6C4 3 2 5 2 8v6c0 2 2 3 4 1m11-9c3-3 5-1 5 2v6c0 2-2 3-4 1"
          fill="currentColor"
          fillOpacity=".16"
        />
        <path d="M6 10c0-5 2-7 6-7s6 2 6 7v6c0 3-2.5 5-6 5s-6-2-6-5Z" />
        {eyes(10.5)}
        <path d="M8 16c0-2 2-3 4-3s4 1 4 3c0 2-2 3-4 3s-4-1-4-3Z" />
        <path d="m10 13.5 2 2 2-2Z" fill="currentColor" stroke="none" />
        <path d="M12 15v2" />
      </>
    ),
  },
  {
    id: 'fox',
    draw: () => (
      <>
        <path d="m3 3 7 4h4l7-4-1 10-8 8-8-8Z" />
        <path d="m4 11 6 3 2 5 2-5 6-3M5 6l3 2m11-2-3 2" />
        {eyes(10, 8, 16)}
        <path d="m10.5 17 1.5 1.5 1.5-1.5Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'rabbit',
    draw: () => (
      <>
        <path d="M8 10C3-3 10-2 10 9m4 0c0-11 7-12 2 1M7 10c-5 4-4 11 5 11s10-7 5-11c-3-2-7-2-10 0Z" />
        {eyes(13)}
        <path d="m10.5 16 1.5 1 1.5-1M12 17v2m-5-4-3-1m3 3H4m13-2 3-1m-3 3h3" />
      </>
    ),
  },
  {
    id: 'bear',
    draw: () => (
      <>
        <circle cx="5.5" cy="6" r="3.5" />
        <circle cx="18.5" cy="6" r="3.5" />
        <path d="M4 12a8 8 0 0 1 16 0v2a8 7 0 0 1-16 0Z" />
        {eyes(11)}
        <ellipse cx="12" cy="16" rx="4" ry="3" />
        <path d="m10.5 14.5 1.5 1.5 1.5-1.5Z" fill="currentColor" stroke="none" />
        <path d="M12 16v1.5" />
      </>
    ),
  },
  {
    id: 'frog',
    draw: () => (
      <>
        <path d="M3 11C0 4 8 1 10 7h4c2-6 10-3 7 4 4 6-1 10-9 10S-1 17 3 11Z" />
        {eyes(7.5, 6, 18)}
        <path d="M7 15c3 3 7 3 10 0" />
        <circle cx="5" cy="14" r="1.2" fill="currentColor" stroke="none" opacity=".3" />
        <circle cx="19" cy="14" r="1.2" fill="currentColor" stroke="none" opacity=".3" />
      </>
    ),
  },
  {
    id: 'owl',
    draw: () => (
      <>
        <path d="m4 3 4 3a10 10 0 0 1 8 0l4-3v11a8 8 0 0 1-16 0Z" />
        <circle cx="8" cy="10" r="3" />
        <circle cx="16" cy="10" r="3" />
        {eyes(10, 8, 16)}
        <path d="m10.5 14 1.5 2 1.5-2M5 15l3 3m11-3-3 3m-6 3v1m4-1v1" />
      </>
    ),
  },
  {
    id: 'penguin',
    draw: () => (
      <>
        <path d="M6 12V8a6 6 0 0 1 12 0v4c4 5 2 8 0 6-1 3-11 3-12 0-2 2-4-1 0-6Z" />
        <path d="M8 12c0-3 2-4 4-3 2-1 4 0 4 3v4a4 4 0 0 1-8 0Z" />
        {eyes(8, 9.5, 14.5)}
        <path d="m10.5 11 1.5 1 1.5-1M7 21H4m13 0h3" />
      </>
    ),
  },
  {
    id: 'duck',
    draw: () => (
      <>
        <path d="M16 4a4 4 0 0 0-4 4v4H5l-3-2v5c0 4 4 6 8 6s8-3 8-7V8a4 4 0 0 0-2-4Z" />
        <path d="m18 8 4 2-4 2m-11 4c2 2 5 2 7 0" />
        <circle cx="15.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'fish',
    draw: () => (
      <>
        <path d="M4 12c4-8 11-8 15 0-4 8-11 8-15 0Zm15 0 3-4v8Zm-11-6 4-3 1 3m-5 12 4 3 1-3" />
        <path d="M8 7c3 3 3 7 0 10" />
        <circle cx="6.5" cy="11" r=".85" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'octopus',
    draw: () => (
      <>
        <path d="M6 13V8a6 6 0 0 1 12 0v5c4 2 5 6 2 7-2 1-3-1-3-2 0 5-5 5-5 0 0 5-5 5-5 0 0 1-1 3-3 2-3-1-2-5 2-7Z" />
        {eyes(10)}
        <path d="M10.5 13.5c1 1 2 1 3 0" />
      </>
    ),
  },
  {
    id: 'crab',
    draw: () => (
      <>
        <ellipse cx="12" cy="15" rx="6" ry="4" />
        <path d="M8 11V9m8 2V9M6 13 3 9m15 4 3-4M6 16l-3 2m15-2 3 2M8 19l-2 2m10-2 2 2M2 4v3a2.5 2.5 0 0 0 5 0V4L4.5 6Zm15 0v3a2.5 2.5 0 0 0 5 0V4l-2.5 2Z" />
        {eyes(8.5, 8, 16)}
      </>
    ),
  },
  {
    id: 'snail',
    draw: () => (
      <>
        <circle cx="9" cy="12" r="6" />
        <path d="M9 15a3 3 0 1 1 3-3c0 1-1 1.5-2 1.5M3 17c-2 1-1 4 2 4h11c4 0 6-3 6-6v-2a2.5 2.5 0 0 0-5 0v4h-3m4-6-1-4m4 4 1-4" />
        <path d="M18 14h.01m3 0h.01" strokeWidth="2" />
      </>
    ),
  },
  {
    id: 'dino',
    draw: () => (
      <>
        <path d="M8 13V9c0-4 3-6 7-6h4a2 2 0 0 1 2 2v5h-6v4c0 4-2 6-5 6H7v-4c-3-1-5-3-5-6 2 3 4 3 6 3Z" />
        <path d="M17 8h4m-6 5 3 1M7 20v2h3m2-3v3h3" />
        <circle cx="16" cy="6" r=".85" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'bug',
    draw: () => (
      <>
        <path d="M7 9a5 5 0 0 1 10 0v7a5 5 0 0 1-10 0Zm2-5L7 2m8 2 2-2M7 11H3m14 0h4M7 16l-3 2m13-2 3 2M12 9v12" />
        <circle cx="9.5" cy="13" r=".8" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="17" r=".8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'feather',
    draw: () => (
      <>
        <path d="M5 18C1 10 13 2 21 3c1 8-7 20-15 16M3 22 18 6M8 17l-1-5m5 1-1-5m1 5h5m-9 4h5" />
      </>
    ),
  },
  {
    id: 'lion',
    draw: () => (
      <>
        <path d="m12 2 3 2 4 .5.5 4 2 3-2 3-.5 4-4 .5-3 2-3-2-4-.5-.5-4-2-3 2-3 .5-4L9 4Z" />
        <path d="M6 9c0-3 3-2 3-1h6c0-1 3-2 3 1l-1 7c-1 3-9 3-10 0Z" />
        {eyes(11)}
        <path d="m10 14 2 1.5 2-1.5M12 15.5V18" />
      </>
    ),
  },
  {
    id: 'panda',
    draw: () => (
      <>
        <circle cx="5.5" cy="5.5" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="18.5" cy="5.5" r="3.5" fill="currentColor" stroke="none" />
        <path d="M3 13a9 9 0 0 1 18 0c0 5-3 8-9 8s-9-3-9-8Z" />
        <ellipse
          cx="8"
          cy="11"
          rx="2.7"
          ry="3.3"
          transform="rotate(28 8 11)"
          fill="currentColor"
          stroke="none"
          opacity=".35"
        />
        <ellipse
          cx="16"
          cy="11"
          rx="2.7"
          ry="3.3"
          transform="rotate(-28 16 11)"
          fill="currentColor"
          stroke="none"
          opacity=".35"
        />
        {eyes(11, 8, 16)}
        <path d="m10 15 2 1.5 2-1.5M12 16.5V18" />
      </>
    ),
  },
  {
    id: 'koala',
    draw: () => (
      <>
        <circle cx="5" cy="8" r="4" />
        <circle cx="19" cy="8" r="4" />
        <path d="M5 12a7 7 0 0 1 14 0v3c0 4-3 6-7 6s-7-2-7-6Z" />
        {eyes(11, 8, 16)}
        <ellipse cx="12" cy="14" rx="2" ry="3" fill="currentColor" stroke="none" />
        <path d="M10 18c1 1 3 1 4 0" />
      </>
    ),
  },
  {
    id: 'elephant',
    draw: () => (
      <>
        <path d="M7 7C1 1 0 17 6 18m11-11c6-6 7 10 1 11" />
        <path d="M6 10a6 6 0 0 1 12 0v6h-3v3c0 4-6 4-6 0v-4" />
        {eyes(11, 8.5, 15.5)}
        <path d="M9 7h6M6 16l-1 3m13-3 1 3M9 18h3" />
      </>
    ),
  },
  {
    id: 'turtle',
    draw: () => (
      <>
        <ellipse cx="11" cy="12" rx="7" ry="6" />
        <path d="M18 10h2a2 2 0 0 1 0 4h-2M6 7 4 4m2 13-2 3m11-13 2-3m-2 13 2 3M4 12H2m5-3 4-2 4 2v6l-4 2-4-2Z" />
        <path d="M7 9 4 10m11-1 2 1M7 15l-3-1m11 1 2-1" />
      </>
    ),
  },
  {
    id: 'whale',
    draw: () => (
      <>
        <path d="M3 13a7 7 0 0 1 14-1l3-4V5l2 2v6c0 5-5 8-11 8s-8-3-8-8Z" />
        <path d="M3 15h9m-4 0 2 3 3-3M7 6V4m0 0L5 2m2 2 2-2" />
        <circle cx="6.5" cy="12" r=".85" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'butterfly',
    draw: () => (
      <>
        <path d="M11 11C8 1 1 1 2 8c0 3 4 5 7 5-6-1-8 6-3 8 3 1 5-3 5-6m2-4c3-10 10-10 9-3 0 3-4 5-7 5 6-1 8 6 3 8-3 1-5-3-5-6M12 8v9M12 8 9 4m3 4 3-4" />
        <path d="m5 7 3 3m-1 7 2-1m10-9-3 3m1 7-2-1" opacity=".5" />
      </>
    ),
  },
];

const PLANTS: readonly GlyphSource[] = [
  {
    id: 'leaf',
    draw: () => (
      <>
        <path d="M21 3C8 2 1 10 4 16s17 4 17-13ZM3 22 18 6M8 17v-6m4 2h6" />
        <path d="M6 17c5 2 11-2 13-10L8 18Z" fill="currentColor" stroke="none" opacity=".12" />
      </>
    ),
  },
  {
    id: 'flower',
    draw: () => (
      <>
        <path d="M12 5c-3-6-8-2-6 2-6 0-5 7 0 7-3 5 3 8 6 3 3 5 9 2 6-3 5 0 6-7 0-7 2-4-3-8-6-2Z" />
        <circle cx="12" cy="11" r="3" />
        <path d="M12 18v4m0-1c2-3 4-3 6-3-1 3-3 4-6 3Z" />
      </>
    ),
  },
  {
    id: 'sunflower',
    draw: () => (
      <>
        <path d="m12 2 2 3 3-2 1 4 4 1-2 3 2 3-4 1-1 4-3-2-2 3-2-3-3 2-1-4-4-1 2-3-2-3 4-1 1-4 3 2Z" />
        <circle cx="12" cy="11" r="4" />
        <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none" />
        <path d="M12 20v2m0-1-5-2m5 2 5-2" />
      </>
    ),
  },
  {
    id: 'tulip',
    draw: () => (
      <>
        <path d="M6 3 9 6l3-4 3 4 3-3v6a6 6 0 0 1-12 0Zm6 12v7M3 14c4 0 7 2 9 7-5 0-8-2-9-7Zm18 0c-4 0-7 2-9 7 5 0 8-2 9-7Z" />
      </>
    ),
  },
  {
    id: 'rose',
    draw: () => (
      <>
        <path d="M8 3c-3 0-5 4-3 7-1 4 3 7 7 5 4 2 8-1 7-5 2-3 0-7-3-7-2-2-6-2-8 0Z" />
        <path d="M8 5c1 5 6 6 8 2M8 5c4-2 6 2 4 5M5 10c3-1 5 0 7 5m7-5c-3 0-5 2-7 5M12 15v7m0-2c-5 0-7-2-7-4 4 0 6 1 7 4Zm0-3 6-1" />
      </>
    ),
  },
  {
    id: 'cactus',
    draw: () => (
      <>
        <path d="M9 19V6a3 3 0 0 1 6 0v13M9 14H6a3 3 0 0 1-3-3V8a2 2 0 0 1 4 0v2h2m6 7h3a3 3 0 0 0 3-3v-3a2 2 0 0 0-4 0v2h-2M7 19h10l-1 3H8Z" />
        <path d="M12 6v10" opacity=".5" />
      </>
    ),
  },
  {
    id: 'sprout',
    draw: () => (
      <>
        <path d="M12 22V12C5 13 2 9 2 4c6 0 10 2 10 8Zm0 5C19 17 22 12 22 7c-6 0-10 4-10 10ZM7 22h10" />
        <path d="m6 8 6 4m6 0-6 5" opacity=".45" />
      </>
    ),
  },
  {
    id: 'tree',
    draw: () => (
      <>
        <path d="M7 17c-6 0-7-8-2-10 0-6 8-7 11-3 6-1 9 7 4 10 0 4-4 5-8 3Zm3 0v5h4v-5" />
        <path d="M12 17v-5m0 3-4-3m4 1 4-3M8 22h8" />
      </>
    ),
  },
  {
    id: 'palm',
    draw: () => (
      <>
        <path d="M12 22c2-5 2-10 0-14M6 22h13M12 8C7 9 4 11 2 15c-1-6 4-10 10-7Zm0 0c5 1 8 3 10 7 1-6-4-10-10-7Zm0 0C6 7 4 5 3 2c6 0 9 2 9 6Zm0 0c6-1 8-3 9-6-6 0-9 2-9 6Z" />
        <path d="m12 13 2 1m-2 4 1 1" />
      </>
    ),
  },
  {
    id: 'mushroom',
    draw: () => (
      <>
        <path d="M2 13C2 6 6 2 12 2s10 4 10 11H2Zm7 0L8 22h8l-1-9" />
        <circle cx="8" cy="7" r="1.5" />
        <circle cx="16" cy="8" r="2" />
        <path d="M11 17v3" opacity=".5" />
      </>
    ),
  },
  {
    id: 'clover',
    draw: () => (
      <>
        <path d="M12 11C3 9 4 2 8 2c3 0 4 4 4 9Zm0 0c2-9 9-8 9-4 0 3-4 4-9 4Zm0 0c9 2 8 9 4 9-3 0-4-4-4-9Zm0 0c-2 9-9 8-9 4 0-3 4-4 9-4Zm0 0c0 5-1 8-4 11" />
      </>
    ),
  },
  {
    id: 'fern',
    draw: () => (
      <>
        <path d="M6 22c0-10 5-18 12-20M8 16c-5 0-7-3-6-6 4 0 6 3 6 6Zm2-4c-4-1-5-4-3-6 3 1 4 3 3 6Zm4-5c-3-1-3-4-1-5 2 1 3 3 1 5Zm-6 9c3-4 6-4 9-2-2 3-5 4-9 2Zm2-4c3-3 6-3 8-1-2 2-5 3-8 1Zm4-5c2-2 5-2 7 0-2 2-5 2-7 0Z" />
      </>
    ),
  },
];

const FESTIVITIES: readonly GlyphSource[] = [
  {
    id: 'ghost',
    draw: () => (
      <>
        <path d="M4 21V10a8 8 0 0 1 16 0v11l-4-2-4 2-4-2Z" />
        {eyes(10)}
        <ellipse cx="12" cy="15" rx="1.6" ry="2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'skull',
    draw: () => (
      <>
        <path d="M8 17c-8-3-6-15 4-15s12 12 4 15v5H8Z" />
        <circle cx="8" cy="11" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="16" cy="11" r="2.5" fill="currentColor" stroke="none" />
        <path d="m12 13-1.5 3h3Z" fill="currentColor" stroke="none" />
        <path d="M10.5 19v3m3-3v3" />
      </>
    ),
  },
  {
    id: 'wizard',
    draw: () => (
      <>
        <path d="m6 11 3-9 7 2-2 1 4 6M3 11h18M6 12l2 6 4 4 4-4 2-6M8 17l4-2 4 2" />
        {eyes(13.5)}
        <path d="m10 7 1 .5-.5 1 .5-1 1-.5-1 .5Z" />
      </>
    ),
  },
  {
    id: 'pumpkin',
    draw: () => (
      <>
        <path d="M10 6c0-3 2-4 4-4m-2 4c-12-4-14 15-4 15h8c10 0 8-19-4-15Z" />
        <path d="M8 6c-3 4-3 11 0 15m8-15c3 4 3 11 0 15m-9-9 2-3 2 3Zm6 0 2-3 2 3ZM8 16l2 2 2-1 2 1 2-2" />
        <path d="m7 12 2-3 2 3Zm6 0 2-3 2 3Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'gift',
    draw: () => (
      <>
        <path d="M4 11h16v11H4ZM2 7h20v4H2Zm10 0v15M12 7C3 8 3 1 7 2c2 0 4 3 5 5Zm0 0c9 1 9-6 5-5-2 0-4 3-5 5Z" />
        <path d="M10 11h4v11h-4Z" fill="currentColor" stroke="none" opacity=".18" />
      </>
    ),
  },
  {
    id: 'cake',
    draw: () => (
      <>
        <path d="M4 21V11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10ZM2 21h20M4 13c1 3 3 3 4 0 1 3 3 3 4 0 1 3 3 3 4 0 1 3 3 3 4 0M8 9V6m4 3V5m4 4V6" />
        <path d="M8 3v.01M12 2v.01M16 3v.01" strokeWidth="2.4" />
      </>
    ),
  },
  {
    id: 'balloon',
    draw: () => (
      <>
        <ellipse cx="12" cy="9" rx="7" ry="8" />
        <path d="m12 17-2 3h4Zm0 3c4 3-4 2-2 3M8 8c0-2 1-3 2-3" />
      </>
    ),
  },
  {
    id: 'party',
    draw: () => (
      <>
        <path d="m3 21 5-16 11 11Z" />
        <path d="m7 9 8 8m-10 0 3 3M13 7c-1-3 0-4 2-4m1 7c4 0 4-3 3-4m-1 6 4 1M7 2v1m13 17h1m-2-17h1" />
        <circle cx="10" cy="13" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'santa',
    draw: () => (
      <>
        <path d="M5 9c0-5 4-7 9-6l6 3-3 3M4 9h14v4H4ZM5 13c-2 5 2 9 7 9s9-4 7-9M8 15c0 2 2 4 4 4s4-2 4-4" />
        {eyes(14.5)}
        <circle cx="20" cy="7" r="2" />
        <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'snowflake',
    draw: () => (
      <>
        <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1V5m12 9-4 1v4M4 14l4 1v4m12-9-4-1V5" />
      </>
    ),
  },
  {
    id: 'lantern',
    draw: () => (
      <>
        <path d="M8 5V3h8v2M6 5h12l2 5v6l-2 4H6l-2-4v-6ZM7 22h10M8 5c-2 5-2 10 0 15m8-15c2 5 2 10 0 15M4 11h16M4 15h16M12 5v15" />
        <path d="M11 5h2v15h-2Z" fill="currentColor" stroke="none" opacity=".15" />
      </>
    ),
  },
];

const ABSTRACT: readonly GlyphSource[] = [
  {
    id: 'cube',
    draw: () => (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5m-9 5v10" />
        <path d="m12 2 9 5-9 5-9-5Z" fill="currentColor" stroke="none" opacity=".16" />
      </>
    ),
  },
  {
    id: 'gem',
    draw: () => (
      <>
        <path d="M6 3h12l4 6-10 13L2 9Zm-4 6h20M6 3l3 6 3-6 3 6 3-6M9 9l3 13 3-13" />
        <path d="m9 9 3 13 3-13Z" fill="currentColor" stroke="none" opacity=".16" />
      </>
    ),
  },
  {
    id: 'orbit',
    draw: () => (
      <>
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(35 12 12)" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        <circle cx="19" cy="5.5" r="1.8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'spiral',
    draw: () => (
      <>
        <path d="M12 12c2-2 5 1 3 3-3 4-9 0-7-4 2-6 12-4 12 3 0 9-14 12-17 3-3-9 6-16 13-14" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'mosaic',
    draw: () => (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <circle cx="17.5" cy="6.5" r="3.5" />
        <path d="m6.5 13 4.5 8H2Z" />
        <rect
          x="14"
          y="14"
          width="7"
          height="7"
          rx="2"
          transform="rotate(15 17.5 17.5)"
          fill="currentColor"
          fillOpacity=".22"
        />
      </>
    ),
  },
  {
    id: 'prism',
    draw: () => (
      <>
        <path d="m12 2 10 18H2Zm0 0v13m-10 5 10-5 10 5" />
        <path d="m12 2 10 18-10-5Z" fill="currentColor" stroke="none" opacity=".18" />
      </>
    ),
  },
  {
    id: 'infinity',
    draw: () => (
      <>
        <path d="M12 12C3-1-4 12 3 17c5 4 9-5 9-5S21-1 23 9c1 7-4 12-8 7l-3-4Z" />
        <path d="M8 7c-2-2-4-1-5 1" opacity=".45" />
      </>
    ),
  },
  {
    id: 'waves',
    draw: () => (
      <>
        <path d="M2 7c4-6 7 6 11 0s7 5 9 0M2 12c4-6 7 6 11 0s7 5 9 0M2 17c4-6 7 6 11 0s7 5 9 0" />
      </>
    ),
  },
  {
    id: 'knot',
    draw: () => (
      <>
        <path d="M9 6C9 0 19 0 19 7c0 4-6 5-6 9 0 6-10 6-10-1 0-4 6-5 6-9ZM6 9C0 9 0 19 7 19c4 0 5-6 9-6 6 0 6-10-1-10-4 0-5 6-9 6Z" />
      </>
    ),
  },
  {
    id: 'mandala',
    draw: () => (
      <>
        <path d="M12 2c-4 4-4 7 0 10 4-3 4-6 0-10Zm0 10c-4 3-4 6 0 10 4-4 4-7 0-10Zm0 0c-3-4-6-4-10 0 4 4 7 4 10 0Zm0 0c3 4 6 4 10 0-4-4-7-4-10 0Z" />
        <circle cx="12" cy="12" r="3" />
        <path d="m5 5 2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
  },
  {
    id: 'comet',
    draw: () => (
      <>
        <circle cx="8" cy="16" r="5" />
        <path d="m7 11 8-8m-4 13L21 6m-9 14 8-8M3 8l2-2m12 15 2-2" />
        <path d="M6 15a2 2 0 0 1 2-2" opacity=".5" />
      </>
    ),
  },
];

/** Cada dibujo hereda un único color y comparte el mismo lienzo de 24 unidades. */
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

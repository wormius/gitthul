import type { GlyphSource } from './avatarTypes';

/** Siluetas propias de cada emblema, sin marcos que igualen todo el catálogo. */
export const SYMBOLS: readonly GlyphSource[] = [
  {
    id: 'terminal',
    draw: () => (
      <>
        <path
          d="M4 3h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M5 7h14v9H5Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m7 9 3 2.5L7 14m6 0h4M8 22h8m-4-3v3" />
        <circle cx="5" cy="5" r=".65" fill="var(--avatar-cutout)" stroke="none" />
      </>
    ),
  },
  {
    id: 'branch',
    draw: () => (
      <>
        <path d="M6 5v14m0-6h5a7 7 0 0 0 7-7" strokeWidth="3" />
        <g fill="currentColor" stroke="none">
          <circle cx="6" cy="5" r="3.5" />
          <circle cx="6" cy="19" r="3.5" />
          <circle cx="18" cy="5" r="3.5" />
        </g>
        <g fill="var(--avatar-cutout)" stroke="none">
          <circle cx="6" cy="5" r="1.2" />
          <circle cx="6" cy="19" r="1.2" />
          <circle cx="18" cy="5" r="1.2" />
        </g>
        <path d="m15 16 2 2 4-4" opacity=".5" />
      </>
    ),
  },
  {
    id: 'rocket',
    draw: () => (
      <>
        <path d="m7 12-4 1-1 5 6-1m4 0 1 5 5-2-1-5" fill="currentColor" opacity=".25" />
        <path d="M7 13C9 6 15 2 22 2c0 7-4 13-11 15Z" fill="currentColor" stroke="none" />
        <circle cx="16" cy="8" r="2.5" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m8 17-4 4m1-6-3 3m8 2-3 2" strokeWidth="2.3" />
        <path d="m9 12 3 3" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'book',
    draw: () => (
      <>
        <path
          d="m6 3 14-1v17L6 21a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m7 6 9-1v9l-9 1Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m6 18 11-1" stroke="var(--avatar-cutout)" />
        <path d="m11 5 2-.2v6l-1-1-1 1Z" fill="currentColor" stroke="none" />
        <path d="m7 22 15-2V5" opacity=".45" />
      </>
    ),
  },
  {
    id: 'flask',
    draw: () => (
      <>
        <path d="M9 2h6m-5 1v6L4 18a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-9V3" />
        <path d="M7 14c3-2 7 2 10 0l3 5-2 2H6l-2-2Z" fill="currentColor" stroke="none" />
        <circle cx="9" cy="17" r="1.2" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="14.5" cy="18.5" r=".8" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m17 5 2-2m0 5h2" opacity=".5" />
      </>
    ),
  },
  {
    id: 'gear',
    draw: () => (
      <>
        <path
          d="m9 2 6 0 .6 3 2 .8 2.5-1.6 2.7 4.6-2.6 1.8v2.8l2.6 1.8-2.7 4.6-2.5-1.6-2 .8L15 22H9l-.6-3-2-.8-2.5 1.6-2.7-4.6L4 13.4v-2.8L1.2 8.8l2.7-4.6 2.5 1.6 2-.8Z"
          fill="currentColor"
          stroke="none"
        />
        <circle cx="12" cy="12" r="5" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m12 9 2.6 1.5v3L12 15l-2.6-1.5v-3Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'star',
    draw: () => (
      <>
        <path
          d="m12 2 3.1 6.2 6.9 1-5 4.9 1.2 6.9-6.2-3.3L5.8 21 7 14.1l-5-4.9 6.9-1Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m12 6 1.9 4 4.3.6" stroke="var(--avatar-cutout)" />
        <path d="M2 3h2m-1-1v2m17 17h2m-1-1v2" opacity=".45" />
      </>
    ),
  },
  {
    id: 'heart',
    draw: () => (
      <>
        <path
          d="M12 21C7 17 2 13.5 2 8a5.5 5.5 0 0 1 10-3 5.5 5.5 0 0 1 10 3c0 5.5-5 9-10 13Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M5.5 8A2.5 2.5 0 0 1 8 5.5M5.5 11v.5" stroke="var(--avatar-cutout)" />
        <path d="m14 16 4-4" stroke="var(--avatar-cutout)" opacity=".45" />
      </>
    ),
  },
  {
    id: 'bolt',
    draw: () => (
      <>
        <path d="M13 1 3 14h7l-1 9L22 9h-8l2-8Z" fill="currentColor" stroke="none" />
        <path d="m12 5-5 7h6l-1 5" stroke="var(--avatar-cutout)" />
        <path d="m3 5 2 1m14 13 2 1" opacity=".5" />
      </>
    ),
  },
  {
    id: 'cloud',
    draw: () => (
      <>
        <path
          d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1-.5 11Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M7 9a4 4 0 0 1 7-2" stroke="var(--avatar-cutout)" />
        <path d="m6 21 2-1m3 2 2-1m3 0 2-1" opacity=".55" />
      </>
    ),
  },
  {
    id: 'globe',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity=".2" />
        <path
          d="m7 3 1 3 4 1 1 3-3 2 1 4-3 4-2-4-3-1m13-12-1 4 4 2 3-1m-1 7-4-2-2 2 1 4 3 1"
          fill="currentColor"
          stroke="none"
        />
        <circle cx="12" cy="12" r="9.5" />
        <path d="M16 5h1" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'key',
    draw: () => (
      <>
        <path d="m10 10 11 11m-6-6-2.5 2.5m5.5.5-2.5 2.5" strokeWidth="3.6" />
        <circle cx="7" cy="7" r="5.5" fill="currentColor" stroke="none" />
        <circle cx="7" cy="7" r="2.5" fill="var(--avatar-cutout)" stroke="none" />
      </>
    ),
  },
  {
    id: 'lock',
    draw: () => (
      <>
        <path d="M7 10V7a5 5 0 0 1 10 0v3" strokeWidth="2.6" />
        <path d="M3 10h18v7c0 3-5 5-9 6-4-1-9-3-9-6Z" fill="currentColor" stroke="none" />
        <path
          d="M12 13a2 2 0 0 0-1 3.7L10.5 19h3l-.5-2.3A2 2 0 0 0 12 13Z"
          fill="var(--avatar-cutout)"
          stroke="none"
        />
        <path d="M5.5 12.5v3" stroke="var(--avatar-cutout)" opacity=".6" />
      </>
    ),
  },
  {
    id: 'moon',
    draw: () => (
      <>
        <path d="M13 2a10 10 0 1 0 9 14C13 19 7 10 13 2Z" fill="currentColor" stroke="none" />
        <path d="M5 12c0 4 2 6 5 7" stroke="var(--avatar-cutout)" />
        <path d="m18 3 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'sun',
    draw: () => (
      <>
        <path
          d="m12 1 2 4 4-2 1 4 4 2-3 3 3 3-4 2-1 4-4-2-2 4-2-4-4 2-1-4-4-2 3-3-3-3 4-2 1-4 4 2Z"
          fill="currentColor"
          opacity=".25"
          stroke="none"
        />
        <circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" />
        <path d="M9 11v.5m6-.5v.5m-5.5 3a3.5 3.5 0 0 0 5 0" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'anchor',
    draw: () => (
      <>
        <path d="M12 7v14m-5-10h10M3 14c0 5 4 7 9 7s9-2 9-7m-18 0 3 2m15-2-3 2" strokeWidth="2.6" />
        <circle cx="12" cy="4.5" r="2.5" strokeWidth="2.2" />
        <path d="m3 12-2 5h5m15-5 2 5h-5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'flame',
    draw: () => (
      <>
        <path
          d="M14 1c3 6-2 7 0 11 2-1 3-3 3-5 4 4 6 8 3 12-3 5-13 5-16-1C1 12 7 8 8 3c1 3 1 5 3 6 0-4 1-6 3-8Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M12 12c0 3-4 4-3 7a3.2 3.2 0 0 0 6 0c1-3-2-4-3-7Z"
          fill="var(--avatar-cutout)"
          stroke="none"
        />
      </>
    ),
  },
  {
    id: 'droplet',
    draw: () => (
      <>
        <path
          d="M12 1c-2 5-8 9-8 14a8 8 0 0 0 16 0c0-5-6-9-8-14Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M7 15c0 3 2 5 5 5" stroke="var(--avatar-cutout)" strokeWidth="2" />
        <path d="m14 11 2 3" stroke="var(--avatar-cutout)" opacity=".45" />
      </>
    ),
  },
  {
    id: 'mountain',
    draw: () => (
      <>
        <circle cx="18" cy="5" r="3" fill="currentColor" opacity=".25" stroke="none" />
        <path d="m1 21 9-17 6 11 3-5 4 11Z" fill="currentColor" stroke="none" />
        <path d="m6 12 4-8 4 8-3-2-1 3-1-3Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m9 21 3-6 3 6" fill="var(--avatar-cutout)" opacity=".4" stroke="none" />
      </>
    ),
  },
  {
    id: 'compass',
    draw: () => (
      <>
        <circle cx="12" cy="13" r="9" fill="currentColor" opacity=".2" />
        <path d="M10 3V1h4v2" />
        <path d="m17 8-2 7-8 3 3-8Z" fill="currentColor" stroke="none" />
        <path d="m10 10 5 5-8 3Z" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="12" cy="13" r="9" />
      </>
    ),
  },
  {
    id: 'music',
    draw: () => (
      <>
        <path d="M9 17V5l12-3v14" strokeWidth="2.4" />
        <path d="M9 5v5l12-3V2Z" fill="currentColor" stroke="none" />
        <ellipse
          cx="5.5"
          cy="18.5"
          rx="4.5"
          ry="3.2"
          transform="rotate(-20 5.5 18.5)"
          fill="currentColor"
          stroke="none"
        />
        <ellipse
          cx="17.5"
          cy="17"
          rx="4.5"
          ry="3.2"
          transform="rotate(-20 17.5 17)"
          fill="currentColor"
          stroke="none"
        />
        <path d="m3 10 2-1M3 5v2" opacity=".45" />
      </>
    ),
  },
  {
    id: 'camera',
    draw: () => (
      <>
        <path
          d="m8 3-2 3H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-2-3Z"
          fill="currentColor"
          stroke="none"
        />
        <circle cx="12" cy="13" r="5.5" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="12" cy="13" r="3.2" fill="currentColor" stroke="none" />
        <path d="m11 11 1-.5M19 9h1" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'coffee',
    draw: () => (
      <>
        <path d="M18 9h2a3 3 0 0 1 0 6h-3" strokeWidth="2.2" />
        <path d="M3 8h15v7a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6Z" fill="currentColor" stroke="none" />
        <path d="M6 11v3m-1 8h15" />
        <path d="M8 5c-3-2 2-2 0-4m5 4c-3-2 2-2 0-4" opacity=".55" />
        <path d="M6 11v3" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'crown',
    draw: () => (
      <>
        <path d="m2 6 5 5 5-8 5 8 5-5-3 13H5Z" fill="currentColor" stroke="none" />
        <path d="M6 16h12m-12 6h12" />
        <path d="M6 16h12" stroke="var(--avatar-cutout)" />
        <path d="m12 10 2 3-2 2-2-2Z" fill="var(--avatar-cutout)" stroke="none" />
        <g fill="currentColor" stroke="none">
          <circle cx="2" cy="5" r="1.3" />
          <circle cx="12" cy="2" r="1.3" />
          <circle cx="22" cy="5" r="1.3" />
        </g>
      </>
    ),
  },
  {
    id: 'shield',
    draw: () => (
      <>
        <path d="M12 1 22 5v7c0 5-5 9-10 11C7 21 2 17 2 12V5Z" fill="currentColor" stroke="none" />
        <path
          d="M12 4 19 7v5c0 3-3 6-7 8Z"
          fill="var(--avatar-cutout)"
          opacity=".45"
          stroke="none"
        />
        <path d="m7 12 3 3 7-7" stroke="var(--avatar-cutout)" strokeWidth="2.3" />
      </>
    ),
  },
  {
    id: 'alien',
    draw: () => (
      <>
        <path
          d="M12 2C3 2 1 7 3 13c1 4 5 7 9 10 4-3 8-6 9-10 2-6 0-11-9-11Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M5 9c4-1 6 2 5 6-3 0-5-2-5-6Zm14 0c-4-1-6 2-5 6 3 0 5-2 5-6Z"
          fill="var(--avatar-cutout)"
          stroke="none"
        />
        <path d="M10.5 18h3" stroke="var(--avatar-cutout)" />
        <path d="M9 5h3" stroke="var(--avatar-cutout)" opacity=".5" />
      </>
    ),
  },
  {
    id: 'robot',
    draw: () => (
      <>
        <path d="M12 3v3M1 11v6m22-6v6" strokeWidth="2.5" />
        <circle cx="12" cy="2" r="1.5" fill="currentColor" stroke="none" />
        <rect x="3" y="6" width="18" height="16" rx="4" fill="currentColor" stroke="none" />
        <rect
          x="5.5"
          y="9"
          width="13"
          height="6"
          rx="2"
          fill="var(--avatar-cutout)"
          stroke="none"
        />
        <path d="M8 11v2m8-2v2" />
        <path d="M8 18h8m-5 0v1m3-1v1" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'astronaut',
    draw: () => (
      <>
        <path d="M5 20v-4H2V9h2a8 8 0 0 1 16 0h2v7h-3v4l-7 3Z" fill="currentColor" stroke="none" />
        <rect x="6" y="5" width="12" height="11" rx="5" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m9 10 3-2m-4 11h3m4 0h1" stroke="var(--avatar-cutout)" />
        <path d="m9 10 3-2" />
        <path d="M14 7h1" opacity=".45" />
      </>
    ),
  },
  {
    id: 'code',
    draw: () => (
      <>
        <path
          d="m8 4-7 8 7 8 3-3-4-5 4-5Zm8 0-3 3 4 5-4 5 3 3 7-8Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m13 3-2 18" opacity=".35" strokeWidth="2.5" />
      </>
    ),
  },
  {
    id: 'chip',
    draw: () => (
      <>
        <path d="M8 1v4m4-4v4m4-4v4M8 19v4m4-4v4m4-4v4M1 8h4m-4 4h4m-4 4h4m14-8h4m-4 4h4m-4 4h4" />
        <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" stroke="none" />
        <path d="M8 8h8v8H8Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m13 9-3 4h3l-1 3" />
      </>
    ),
  },
  {
    id: 'database',
    draw: () => (
      <>
        <path d="M3 6v13c0 4 18 4 18 0V6Z" fill="currentColor" stroke="none" />
        <ellipse cx="12" cy="5" rx="9" ry="3" fill="currentColor" />
        <path
          d="M4 6c3 3 13 3 16 0M4 12c3 3 13 3 16 0M4 18c3 3 13 3 16 0"
          stroke="var(--avatar-cutout)"
        />
        <path d="M7 4h6" stroke="var(--avatar-cutout)" opacity=".5" />
      </>
    ),
  },
  {
    id: 'server',
    draw: () => (
      <>
        <rect x="3" y="2" width="18" height="9" rx="2" fill="currentColor" stroke="none" />
        <rect x="3" y="13" width="18" height="9" rx="2" fill="currentColor" stroke="none" />
        <g stroke="var(--avatar-cutout)">
          <path d="M6 6.5h4m-4 11h4" />
          <path d="M16 6.5h1m-1 11h1" strokeWidth="2.6" />
        </g>
        <path d="M7 11v2m10-2v2" opacity=".4" />
      </>
    ),
  },
  {
    id: 'gamepad',
    draw: () => (
      <>
        <path
          d="M7 6h10c3 0 4 3 5 8s0 9-3 6l-3-3H8l-3 3c-3 3-4-1-3-6S4 6 7 6Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M5 12h5m-2.5-2.5v5" stroke="var(--avatar-cutout)" strokeWidth="2" />
        <g fill="var(--avatar-cutout)" stroke="none">
          <circle cx="16" cy="10" r="1.1" />
          <circle cx="18.5" cy="13" r="1.1" />
        </g>
        <path d="M10 3h4" opacity=".5" />
      </>
    ),
  },
  {
    id: 'headphones',
    draw: () => (
      <>
        <path d="M3 13V11a9 9 0 0 1 18 0v2" strokeWidth="3" />
        <path
          d="M3 11h4v10H4a3 3 0 0 1-3-3v-4a3 3 0 0 1 2-3Zm18 0h-4v10h3a3 3 0 0 0 3-3v-4a3 3 0 0 0-2-3Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M10 12v5m4-7v9" opacity=".4" strokeWidth="2" />
      </>
    ),
  },
  {
    id: 'satellite',
    draw: () => (
      <>
        <path d="m2 6 4-4 5 5-4 4Zm11 11 4-4 5 5-4 4Z" fill="currentColor" opacity=".25" />
        <path d="m10 8 6 6-5 5-6-6Z" fill="currentColor" stroke="none" />
        <path d="m13 11 4-4m-2-3 5 5M3 7l4-4m10 18 4-4M6 18l-3 3" />
        <path d="M18 2a4 4 0 0 1 4 4" opacity=".5" />
      </>
    ),
  },
  {
    id: 'telescope',
    draw: () => (
      <>
        <path d="m8 9 10-6 4 7-10 6Z" fill="currentColor" stroke="none" />
        <path d="m2 14 6-4 3 5-6 4Z" fill="currentColor" opacity=".3" />
        <path d="m16 5 4 7M12 16l-4 6m4-6 4 6" />
        <path d="M5 2v4M3 4h4" opacity=".5" />
      </>
    ),
  },
  {
    id: 'planet',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="7.5" fill="currentColor" stroke="none" />
        <path
          d="M5 8C-3 14 5 19 16 13c7-4 8-8 3-7"
          stroke="var(--avatar-cutout)"
          strokeWidth="3.5"
        />
        <path d="M5 8C-3 14 5 19 16 13c7-4 8-8 3-7" />
        <path d="m9 7 3-1" stroke="var(--avatar-cutout)" />
        <path d="M20 20h2m-1-1v2" opacity=".5" />
      </>
    ),
  },
  {
    id: 'ufo',
    draw: () => (
      <>
        <path d="M7 9a5 5 0 0 1 10 0" fill="currentColor" opacity=".25" />
        <ellipse cx="12" cy="11" rx="11" ry="4" fill="currentColor" stroke="none" />
        <path d="M7 16 4 22h16l-3-6" fill="currentColor" opacity=".2" stroke="none" />
        <path d="M7 11h1m3 1h2m3-1h1" stroke="var(--avatar-cutout)" />
        <path d="M12 17v4" opacity=".6" />
      </>
    ),
  },
  {
    id: 'sword',
    draw: () => (
      <>
        <path d="M16 2h6v6L10 18l-4-4Z" fill="currentColor" stroke="none" />
        <path d="m18 6-8 8" stroke="var(--avatar-cutout)" />
        <path d="m4 11 9 9M8 17l-4 4m-1-2 3 3" strokeWidth="2.6" />
      </>
    ),
  },
  {
    id: 'potion',
    draw: () => (
      <>
        <path d="M9 2h6v4H9Z" fill="currentColor" stroke="none" />
        <path d="M9 6v3a7 7 0 1 0 6 0V6" />
        <path d="M5.5 15c4-3 8 3 13 0a6.5 6.5 0 0 1-13 0Z" fill="currentColor" stroke="none" />
        <path d="m11 14 1-2 1 2-1 2Z" fill="currentColor" stroke="none" />
        <path d="M8 17v1" stroke="var(--avatar-cutout)" />
        <path d="m19 3 2 2m0-2-2 2" opacity=".45" />
      </>
    ),
  },
  {
    id: 'treasure',
    draw: () => (
      <>
        <path d="M2 11V8a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v3Z" fill="currentColor" opacity=".25" />
        <path d="M2 12h20v9H2Z" fill="currentColor" stroke="none" />
        <path d="M7 4v7m10-7v7" />
        <path d="M7 14v5m10-5v5" stroke="var(--avatar-cutout)" opacity=".5" />
        <path d="M10 11h4v6h-4Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="M12 13v1" />
      </>
    ),
  },
  {
    id: 'map',
    draw: () => (
      <>
        <path d="m2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3Z" fill="currentColor" opacity=".2" />
        <path d="M8 2v17m8-14v17" opacity=".6" />
        <path d="m5 14 3-4 6 3 4-4m-2-2 4 4m0-4-4 4" strokeWidth="2" />
      </>
    ),
  },
  {
    id: 'lighthouse',
    draw: () => (
      <>
        <path d="m8 9-2 13h12L16 9Z" fill="currentColor" stroke="none" />
        <path d="M8 4h8v5H8Zm-1 0 5-3 5 3" />
        <path d="m8 13 8 2m-9 2 10 2" stroke="var(--avatar-cutout)" strokeWidth="2.5" />
        <path d="m4 5-3-2m3 5L1 9m19-4 3-2m-3 5 3 1" opacity=".5" />
      </>
    ),
  },
  {
    id: 'sailboat',
    draw: () => (
      <>
        <path d="M12 2v14H2Z" fill="currentColor" stroke="none" />
        <path d="m15 6 7 10h-7Z" fill="currentColor" opacity=".3" stroke="none" />
        <path d="M2 18h20l-4 4H6Z" fill="currentColor" stroke="none" />
        <path d="M12 2v15" />
        <path d="M8 13h1" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'anchorWheel',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="7" strokeWidth="2.5" />
        <path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          r="3"
          fill="currentColor"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.5"
        />
      </>
    ),
  },
  {
    id: 'puzzle',
    draw: () => (
      <>
        <path
          d="M3 3h6a3 3 0 1 0 6 0h6v6a3 3 0 1 0 0 6v6h-6a3 3 0 1 0-6 0H3v-6a3 3 0 1 0 0-6Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M6 5H5v1m13 13h1v-1" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'diamondRing',
    draw: () => (
      <>
        <path d="m8 2-3 4 7 7 7-7-3-4Z" fill="currentColor" stroke="none" />
        <path d="m8 5 4 5 4-5M10 3l-1 3m5-3 1 3" stroke="var(--avatar-cutout)" strokeWidth="1.2" />
        <path d="M6 10a8 8 0 1 0 12 0" strokeWidth="3" />
      </>
    ),
  },
  {
    id: 'hourglass',
    draw: () => (
      <>
        <path
          d="M5 2h14M5 22h14M6 3c0 7 6 7 6 9s-6 2-6 9m12-18c0 7-6 7-6 9s6 2 6 9"
          strokeWidth="2.2"
        />
        <path d="M7 5h10l-5 6Zm5 10-5 5h10Z" fill="currentColor" stroke="none" />
        <path d="M12 12v2" opacity=".5" />
      </>
    ),
  },
];

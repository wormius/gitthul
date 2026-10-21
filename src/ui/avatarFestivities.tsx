import type { GlyphSource } from './avatarTypes';

/** Festive characters and objects, drawn as compact illustrated emblems. */
export const FESTIVITIES: readonly GlyphSource[] = [
  {
    id: 'ghost',
    draw: () => (
      <>
        <path
          d="M5 12V9a7 7 0 0 1 14 0v3l3 4-4 1v5l-4-2-3 2-3-2-4 1v-6l-2-2 1-4Z"
          fill="currentColor"
          stroke="none"
        />
        <ellipse cx="9" cy="10" rx="1.3" ry="1.8" fill="var(--avatar-cutout)" stroke="none" />
        <ellipse cx="15" cy="10" rx="1.3" ry="1.8" fill="var(--avatar-cutout)" stroke="none" />
        <path d="M10 15c0-3 4-3 4 0 0 4-4 4-4 0Z" fill="var(--avatar-cutout)" stroke="none" />
      </>
    ),
  },
  {
    id: 'skull',
    draw: () => (
      <>
        <path
          d="M6 17C1 15 1 8 5 5c3-4 11-4 14 0 4 3 4 10-1 12v4H6Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M5 10c3-2 6 0 6 2 0 4-6 4-6-2Zm14 0c-3-2-6 0-6 2 0 4 6 4 6-2Z"
          fill="var(--avatar-cutout)"
          stroke="none"
        />
        <path d="m12 14-1.6 3h3.2Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="M10 19v2m4-2v2" stroke="var(--avatar-cutout)" strokeWidth="1.5" />
      </>
    ),
  },
  {
    id: 'wizard',
    draw: () => (
      <>
        <path
          d="M5 12c-1 5 2 8 7 10 5-2 8-5 7-10Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path d="M6 10 9 3l8-1-4 4 5 4 3 2H3Z" fill="currentColor" stroke="none" />
        <path d="m10 6 1 1.5L13 8l-2 1-1-1-1 1 .3-2Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="M8 13v1m8-1v1m-7 4 3-2 3 2m-3-2v4" fill="none" />
      </>
    ),
  },
  {
    id: 'pumpkin',
    draw: () => (
      <>
        <path d="M11 6c0-2 1-3 3-3" />
        <path d="M14 6c1-4 4-4 6-3-1 3-3 4-6 3Z" fill="currentColor" stroke="none" opacity=".22" />
        <path
          d="M12 7C3 2 0 12 3 18c1 3 4 4 6 3 2 2 4 2 6 0 3 1 5-1 6-4 3-7-2-14-9-10Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m6 12 3-3 2 4Zm7 1 2-4 3 3Z" fill="var(--avatar-cutout)" stroke="none" />
        <path
          d="m7 16 3 2 2-1 2 1 3-2"
          fill="none"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.8"
        />
      </>
    ),
  },
  {
    id: 'gift',
    draw: () => (
      <>
        <path
          d="M12 8C2 8 4 1 7 3c3 1 4 3 5 5Zm0 0c10 0 8-7 5-5-3 1-4 3-5 5Z"
          fill="currentColor"
          fillOpacity=".22"
        />
        <path d="M4 10h16v11H4Z" fill="currentColor" stroke="none" />
        <rect x="2" y="7.5" width="20" height="5" rx="1.3" fill="currentColor" stroke="none" />
        <path d="M12 8v13M4 12.5h16" stroke="var(--avatar-cutout)" strokeWidth="2" />
      </>
    ),
  },
  {
    id: 'cake',
    draw: () => (
      <>
        <path d="M12 3c-3 3-2 5 0 5s3-2 0-5Z" fill="currentColor" stroke="none" />
        <path d="M12 8v3" />
        <path d="M5 10h14a2 2 0 0 1 2 2v9H3v-9a2 2 0 0 1 2-2Z" fill="currentColor" stroke="none" />
        <path
          d="M4 13c0 3 4 3 4 0 0 3 4 3 4 0 0 3 4 3 4 0 0 3 4 3 4 0M4 18h16"
          fill="none"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.8"
        />
      </>
    ),
  },
  {
    id: 'balloon',
    draw: () => (
      <>
        <path
          d="M12 17c-2-1-7-4-7-9C5 0 19 0 19 8c0 5-5 8-7 9Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M8 8c0-2 1-3 3-3" stroke="var(--avatar-cutout)" fill="none" />
        <path d="m12 16-2 3h4Z" fill="currentColor" stroke="none" />
        <path d="M12 19c3 1-3 1-1 3" fill="none" />
      </>
    ),
  },
  {
    id: 'party',
    draw: () => (
      <>
        <path d="m3 21 4-14 11 11Z" fill="currentColor" stroke="none" />
        <path d="m6 13 6 6m-7-1 2 2" stroke="var(--avatar-cutout)" strokeWidth="2" />
        <path d="M7 7c3 0 11 8 11 11" fill="none" />
        <path d="M12 7c-1-3 1-4 3-4m1 8c4-1 3-4 3-4" fill="none" />
        <path
          d="m19 2 1 1.5L22 4l-2 1-1 2-1-2-2-1 2-.5Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <circle cx="8" cy="3" r="1.2" fill="currentColor" stroke="none" />
        <path d="m20 15 1 1" />
      </>
    ),
  },
  {
    id: 'santa',
    draw: () => (
      <>
        <path d="M5 10C5 3 9 1 15 3l6 4-4 2-2-2-1 4Z" fill="currentColor" stroke="none" />
        <path
          d="M4 11c-1 4 1 6 3 6-1 3 2 5 5 5s6-2 5-5c3 0 4-4 2-6Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M7 11h10v3c0 4-10 4-10 0Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="M4 10h14" stroke="var(--avatar-cutout)" strokeWidth="2.6" />
        <circle cx="20" cy="8" r="2" fill="currentColor" stroke="none" />
        <path d="M9 13v.2m6-.2v.2" />
        <ellipse cx="12" cy="15.3" rx="1.6" ry="1.1" fill="currentColor" stroke="none" />
        <path d="M10 19h4" stroke="var(--avatar-cutout)" strokeWidth="1.4" />
      </>
    ),
  },
  {
    id: 'snowflake',
    draw: () => (
      <>
        <g fill="currentColor" stroke="none">
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <path
              key={angle}
              transform={`rotate(${angle} 12 12)`}
              d="m12 2 1.2 1.2v3l2-1.3 1 1.6-3 2V12h-2.4V8.5l-3-2 1-1.6 2 1.3v-3Z"
            />
          ))}
        </g>
        <path d="m12 9 2.6 1.5v3L12 15l-2.6-1.5v-3Z" fill="var(--avatar-cutout)" stroke="none" />
      </>
    ),
  },
  {
    id: 'lantern',
    draw: () => (
      <>
        <path d="M9 5V3h6v2M12 19v3m-3-1h6" fill="none" />
        <path d="M7 5h10c6 3 6 10 0 14H7C1 15 1 8 7 5Z" fill="currentColor" stroke="none" />
        <path
          d="M9 7c-2 3-2 7 0 10m6-10c2 3 2 7 0 10"
          fill="none"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.5"
        />
        <path d="M7 5h10M7 19h10" />
      </>
    ),
  },
  {
    id: 'mask',
    draw: () => (
      <>
        <path
          d="M4 9C1 3 7 2 8 7c1-6 7-6 6-1l-2 5Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path
          d="M3 9c4-3 6-1 9 0 3-1 5-3 9 0l-2 7c-2 3-5 2-7-1-2 3-5 4-7 1Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M6 11c2-1 4 0 4 2-2 1-4 0-4-2Zm12 0c-2-1-4 0-4 2 2 1 4 0 4-2Z"
          fill="var(--avatar-cutout)"
          stroke="none"
        />
        <path d="m17 17 3 4" />
      </>
    ),
  },
  {
    id: 'pinata',
    draw: () => (
      <>
        <path
          d="m6 8-2-5 3 1 2 4 2 3h6l2-2 3 1-2 4h-2v7h-3v-4h-5v4H7v-7H4l-2-3 3-3Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="m9 8 1-5 2 1-1 6Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="M9 13h8m-8 3h8" stroke="var(--avatar-cutout)" strokeWidth="1.6" />
        <circle cx="6.5" cy="10.5" r=".9" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m19 9 2-3" />
      </>
    ),
  },
  {
    id: 'candle',
    draw: () => (
      <>
        <path d="M12 2c-4 4-4 7 0 7 4 0 4-3 0-7Z" fill="currentColor" stroke="none" />
        <path d="M12 5v2" stroke="var(--avatar-cutout)" strokeWidth="1.4" />
        <path d="M12 9v2" />
        <path d="M7 10h10v9H7Z" fill="currentColor" stroke="none" />
        <path
          d="M8 12h2v3a1 1 0 0 0 2 0v-3h3"
          fill="none"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.5"
        />
        <path d="M3 19h18c-1 4-17 4-18 0Z" fill="currentColor" stroke="none" opacity=".22" />
        <path d="M4 19h16" />
      </>
    ),
  },
  {
    id: 'firework',
    draw: () => (
      <>
        <path
          d="m12 5 1.8 3.2 3.7.8-2.5 2.8.3 3.7-3.3-1.6-3.3 1.6.3-3.7L6.5 9l3.7-.8Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M12 2v1M5 4l1 1m12 0 1-1M3 10h1m16 0h1M5 16l1-1m12 0 1 1" strokeWidth="2" />
        <path d="M12 16v5m-4-3-2 3m10-3 2 3" fill="none" opacity=".22" />
      </>
    ),
  },
  {
    id: 'bell',
    draw: () => (
      <>
        <path
          d="M12 6C5 7 4 2 7 2c3 0 4 2 5 4Zm0 0c7 1 8-4 5-4-3 0-4 2-5 4Z"
          fill="currentColor"
          stroke="none"
          opacity=".22"
        />
        <path
          d="M6 11a6 6 0 0 1 12 0c0 4 1 5 3 7H3c2-2 3-3 3-7Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M9 11c0-2 1-3 3-3" stroke="var(--avatar-cutout)" fill="none" />
        <path d="M9 20h6c-1 3-5 3-6 0Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

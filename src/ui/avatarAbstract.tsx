import type { GlyphSource } from './avatarTypes';

export const ABSTRACT: readonly GlyphSource[] = [
  {
    id: 'cube',
    draw: () => (
      <>
        <path d="m12 1 10 6v10l-10 6-10-6V7Z" fill="currentColor" opacity=".22" stroke="none" />
        <path d="m12 1 10 6-10 6L2 7Z" fill="currentColor" stroke="none" />
        <path d="m12 13 10-6v10l-10 6Z" fill="currentColor" stroke="none" />
        <path d="m12 13 10-6" stroke="var(--avatar-cutout)" />
        <path d="m6 9 6-4 5 3" stroke="var(--avatar-cutout)" />
        <path d="M6 13v3l3 2" />
      </>
    ),
  },
  {
    id: 'gem',
    draw: () => (
      <>
        <path d="m6 3-5 6 11 13L23 9l-5-6Z" fill="currentColor" stroke="none" />
        <path
          d="m6 3 3 6 3 13 3-13 3-6M2 9h20M9 9l3-6 3 6"
          stroke="var(--avatar-cutout)"
          strokeWidth="1.4"
        />
      </>
    ),
  },
  {
    id: 'orbit',
    draw: () => (
      <>
        <ellipse cx="12" cy="12" rx="10.5" ry="4.5" transform="rotate(-35 12 12)" strokeWidth="2" />
        <ellipse cx="12" cy="12" rx="10.5" ry="4.5" transform="rotate(55 12 12)" opacity=".4" />
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        <circle cx="20" cy="6" r="2.5" fill="currentColor" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'spiral',
    draw: () => (
      <>
        <path
          d="M21 11c0-13-20-12-19 1 0 14 22 11 18 0-3-8-13-6-13 0 0 6 9 6 8 1-.4-2-3-2-3 0"
          strokeWidth="2.8"
        />
        <circle cx="21" cy="11" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'mosaic',
    draw: () => (
      <>
        <path
          d="M2 2h9v9H2Zm11 0h9v9Zm0 11h9v9h-9ZM2 13h9l-9 9Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M13 3v8h8ZM3 22h8v-8Z" fill="currentColor" opacity=".22" stroke="none" />
        <circle cx="6.5" cy="6.5" r="2" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m15 19 4-4" stroke="var(--avatar-cutout)" />
      </>
    ),
  },
  {
    id: 'prism',
    draw: () => (
      <>
        <path d="m12 2 10 19H2Z" fill="currentColor" opacity=".22" />
        <path d="m12 2 3 14 7 5H2l7-5Z" fill="currentColor" stroke="none" />
        <path d="m12 2-3 14 3 5 3-5Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m2 10 20 5" stroke="var(--avatar-cutout)" strokeWidth="3.5" />
        <path d="m2 10 20 5" />
      </>
    ),
  },
  {
    id: 'infinity',
    draw: () => (
      <>
        <path
          d="M12 12c-3-5-5-7-8-5-5 3-2 12 3 10 4-2 5-8 9-10 5-2 8 7 3 10-3 2-5 0-8-5"
          strokeWidth="4"
        />
        <path d="m10 10 4 4" stroke="var(--avatar-cutout)" strokeWidth="1.3" />
      </>
    ),
  },
  {
    id: 'waves',
    draw: () => (
      <>
        <path
          d="M1 10c5 0 4-8 10-8-3 4-1 7 3 7 3 0 4-4 8-4v5c-4 0-5 4-8 4-5 0-5-4-8-4-2 0-3 3-5 3Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M2 17c3 0 3-3 6-3s3 3 6 3 4-3 8-3m-20 7c3 0 3-3 6-3s3 3 6 3 4-3 8-3"
          strokeWidth="2"
          opacity=".5"
        />
      </>
    ),
  },
  {
    id: 'knot',
    draw: () => (
      <>
        <path
          d="M8 12C-2 4 12-2 12 8c8-10 14 4 4 4 10 8-4 14-4 4-8 10-14-4-4-4Z"
          strokeWidth="2.8"
        />
        <path d="m8 12 4 4 4-4-4-4Z" strokeWidth="2.8" />
        <path d="m10 10 4 4" stroke="var(--avatar-cutout)" strokeWidth="5.5" />
        <path d="m10 10 4 4" strokeWidth="2.8" />
      </>
    ),
  },
  {
    id: 'mandala',
    draw: () => (
      <>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <path
            key={angle}
            d="M12 1c4 3 4 6 0 9-4-3-4-6 0-9Z"
            transform={`rotate(${angle} 12 12)`}
            fill="currentColor"
            stroke="var(--avatar-cutout)"
            strokeWidth=".8"
          />
        ))}
        <circle cx="12" cy="12" r="4" fill="var(--avatar-cutout)" stroke="none" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'comet',
    draw: () => (
      <>
        <path d="m5 11 13-9-5 8 9-6-6 12-4 5Z" fill="currentColor" opacity=".25" stroke="none" />
        <path d="m8 13 12-9m-7 12 9-8" strokeWidth="2" />
        <circle cx="8" cy="16" r="6" fill="currentColor" stroke="none" />
        <path d="M5 16a3 3 0 0 1 3-3" stroke="var(--avatar-cutout)" />
        <path d="M3 4h3M4.5 2.5v3" opacity=".5" />
      </>
    ),
  },
  {
    id: 'vortex',
    draw: () => (
      <>
        {[0, 90, 180, 270].map((angle) => (
          <path
            key={angle}
            d="M12 12C3 12 0 6 6 2c-1 5 5 4 6 10Z"
            transform={`rotate(${angle} 12 12)`}
            fill="currentColor"
            stroke="none"
          />
        ))}
        <circle cx="12" cy="12" r="2" fill="var(--avatar-cutout)" stroke="none" />
      </>
    ),
  },
  {
    id: 'hexagon',
    draw: () => (
      <>
        <path d="m12 1 10 6v10l-10 6-10-6V7Z" fill="currentColor" stroke="none" />
        <path d="m12 5 6.5 4v6L12 19l-6.5-4V9Z" fill="var(--avatar-cutout)" stroke="none" />
        <path d="m12 8 3.5 2v4L12 16l-3.5-2v-4Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'aperture',
    draw: () => (
      <>
        <circle cx="12" cy="12" r="10.5" fill="currentColor" stroke="none" />
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <path
            key={angle}
            d="m10 8 4-6m0 6h-4"
            transform={`rotate(${angle} 12 12)`}
            stroke="var(--avatar-cutout)"
            strokeWidth="1.3"
          />
        ))}
        <path d="m10 8 4 0 2.3 4-2.3 4h-4l-2.3-4Z" fill="var(--avatar-cutout)" stroke="none" />
      </>
    ),
  },
  {
    id: 'kaleidoscope',
    draw: () => (
      <>
        {[0, 90, 180, 270].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 12 12)`}>
            <path d="m12 1 4 6-4 4-4-4Z" fill="currentColor" stroke="none" />
            <path d="m3 3 6 1-5 5Z" fill="currentColor" opacity=".25" stroke="none" />
          </g>
        ))}
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: 'totem',
    draw: () => (
      <>
        <path d="m3 3 9 3 9-3v8l-9 4-9-4Z" fill="currentColor" stroke="none" />
        <path d="m6 7 3 1m6 0 3-1m-6 2v3" stroke="var(--avatar-cutout)" />
        <path d="m5 14 7 3 7-3v6l-7 3-7-3Z" fill="currentColor" opacity=".25" stroke="none" />
        <path d="M9 19h6M12 2v2" />
      </>
    ),
  },
];

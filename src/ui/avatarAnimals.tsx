import type { GlyphSource } from './avatarTypes';

/** Compact silhouettes with broad cutouts that remain readable in repository rows. */
export const ANIMALS: readonly GlyphSource[] = [
  {
    id: 'cat',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M3 3.5 9 7a13 13 0 0 1 6 0l6-3.5-.8 8.5c1.8 5.5-2.4 9-8.2 9s-10-3.5-8.2-9Z" />
        <path d="m5.4 6.8 2.4 1.5-2.5 1.3Zm13.2 0-2.4 1.5 2.5 1.3Z" fill="var(--avatar-cutout)" />
        <path
          d="m6.5 12 3.3.7m4.4 0 3.3-.7M9.5 17l2.5 1.5 2.5-1.5"
          fill="none"
          stroke="var(--avatar-cutout)"
        />
        <path d="m10.3 14.5 1.7 1.8 1.7-1.8Z" fill="var(--avatar-cutout)" />
        <path d="m4 15-2-.5m18 .5 2-.5" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'dog',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M7 5C1 2 1 11 3 16l4-2Zm10 0c6-3 6 6 4 11l-4-2Z" opacity=".22" />
        <path d="M6 8c0-3 2.5-5 6-5s6 2 6 5l1 7c0 4-3 6-7 6s-7-2-7-6Z" />
        <ellipse cx="8.5" cy="10" rx="2.3" ry="3" fill="var(--avatar-cutout)" />
        <circle cx="8.7" cy="10.5" r="1" />
        <circle cx="15.5" cy="10.5" r="1" fill="var(--avatar-cutout)" />
        <path d="M8 15c0-2 8-2 8 0 0 2-2 4-4 4s-4-2-4-4Z" fill="var(--avatar-cutout)" />
        <path d="M10 14h4l-2 2Z" />
        <path d="M12 17v3" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'fox',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m3 2.5 7 5h4l7-5-1.5 12L12 22l-7.5-7.5Z" />
        <path d="m5.5 6.8 3 2-3 1Zm13 0-3 2 3 1Z" fill="var(--avatar-cutout)" />
        <path d="M4.8 12.5 10 14l2 4 2-4 5.2-1.5L12 20Z" fill="var(--avatar-cutout)" />
        <path d="m7 11 2 1m6 0 2-1" fill="none" stroke="var(--avatar-cutout)" />
        <path d="m10.5 18 1.5 1.5 1.5-1.5Z" />
      </g>
    ),
  },
  {
    id: 'rabbit',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M7.5 12C3-1 9-1 10 10Zm6-1c0-9 6-11 6-7 0 3-2 6-4 9Z" />
        <path d="M8 4.5 9 9m7-4-1.2 4" fill="none" stroke="var(--avatar-cutout)" />
        <path d="M4.5 16c0-4 3-7 7.5-7s7.5 3 7.5 7-3 6-7.5 6-7.5-2-7.5-6Z" />
        <circle cx="8.5" cy="14.5" r="1" fill="var(--avatar-cutout)" />
        <circle cx="15.5" cy="14.5" r="1" fill="var(--avatar-cutout)" />
        <path d="m10.5 17 1.5 1.5 1.5-1.5ZM10.8 19h2.4v2h-2.4Z" fill="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'bear',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <circle cx="5.5" cy="6" r="3.5" />
        <circle cx="18.5" cy="6" r="3.5" />
        <circle cx="5.5" cy="6" r="1.6" fill="var(--avatar-cutout)" />
        <circle cx="18.5" cy="6" r="1.6" fill="var(--avatar-cutout)" />
        <path d="M3.5 13c0-5 3-8 8.5-8s8.5 3 8.5 8-3 8.5-8.5 8.5S3.5 18 3.5 13Z" />
        <circle cx="8" cy="11.5" r="1" fill="var(--avatar-cutout)" />
        <circle cx="16" cy="11.5" r="1" fill="var(--avatar-cutout)" />
        <ellipse cx="12" cy="16" rx="4.5" ry="3.5" fill="var(--avatar-cutout)" />
        <path d="M10 14.5h4c0 2-4 2-4 0Z" />
        <path d="M12 16v1.5" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'frog',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M3 11C0 5 7 1 10 7h4c3-6 10-2 7 4 3 5-1 10-9 10S0 16 3 11Z" />
        <circle cx="6.5" cy="8" r="2.4" fill="var(--avatar-cutout)" />
        <circle cx="17.5" cy="8" r="2.4" fill="var(--avatar-cutout)" />
        <circle cx="7" cy="8.5" r="1.1" />
        <circle cx="17" cy="8.5" r="1.1" />
        <path d="M6 14c3 4 9 4 12 0" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'owl',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m3.5 3 5 3a13 13 0 0 1 7 0l5-3-1 6.5c3 7-1 12-7.5 12S1.5 16.5 4.5 9.5Z" />
        <circle cx="8" cy="11" r="3.5" fill="var(--avatar-cutout)" />
        <circle cx="16" cy="11" r="3.5" fill="var(--avatar-cutout)" />
        <circle cx="8.7" cy="11" r="1.4" />
        <circle cx="15.3" cy="11" r="1.4" />
        <path d="m10.5 15 1.5 2 1.5-2Z" fill="var(--avatar-cutout)" />
        <path d="m7 17 1.5 1.5m8.5-1.5-1.5 1.5" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'penguin',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path
          d="M6 12 2 17c-.5 2 2 2 5 0m11-5 4 5c.5 2-2 2-5 0M5 21l4-2 2 3H5Zm8 1 2-3 4 2v1Z"
          opacity=".22"
        />
        <path d="M5.5 14 7 7a5.2 5.2 0 0 1 10 0l1.5 7c1.5 5-1 7-6.5 7s-8-2-6.5-7Z" />
        <path
          d="M8 9c0-3 3-3 4-1 1-2 4-2 4 1v3c3 6 1 7-4 7s-7-1-4-7Z"
          fill="var(--avatar-cutout)"
        />
        <circle cx="9.5" cy="9" r=".9" />
        <circle cx="14.5" cy="9" r=".9" />
        <path d="m10 11 2 2 2-2Z" />
      </g>
    ),
  },
  {
    id: 'duck',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M18 8h4v3l-4 1Z" />
        <path d="M11 11V7a5 5 0 0 1 10 0c0 3-2 4-3 6 0 5-3 8-8 8s-8-3-8-9l5 2Z" />
        <path d="M11 4 9 2.5c3-1 6-.5 7 1.5Z" />
        <circle cx="17.5" cy="6.5" r="1" fill="var(--avatar-cutout)" />
        <path d="M6 15c2 3 5 3 8 0" fill="none" stroke="var(--avatar-cutout)" />
        <path d="M19 9.5h3" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'fish',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m8 6 5-3 1 5m-6 9 5 4 1-5" opacity=".22" />
        <path d="M2 12c4-7 11-8 16-3l4-3v12l-4-3c-5 5-12 4-16-3Z" />
        <circle cx="6.2" cy="11" r="1.2" fill="var(--avatar-cutout)" />
        <path d="M10 8.5c2 2 2 5 0 7m4-5 2 1.5-2 1.5" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'octopus',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M5 12V9a7 7 0 0 1 14 0v3c4 1 4 5 2 7-1 1-3 0-3-2 0 5-4 6-5 1-1 5-5 5-5 0-2 4-6 3-6 0 0-2 2-3 3-2Z" />
        <circle cx="8.5" cy="10" r="1.2" fill="var(--avatar-cutout)" />
        <circle cx="15.5" cy="10" r="1.2" fill="var(--avatar-cutout)" />
        <path d="M10 13c1 1.5 3 1.5 4 0" fill="none" stroke="var(--avatar-cutout)" />
        <path d="M6 5c1-1 2-1.5 3-1.5" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'crab',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path
          d="M6 14 3 12m3 5-3 2m15-5 3-2m-3 5 3 2M9 11V8m6 3V8"
          fill="none"
          stroke="currentColor"
        />
        <path d="M2 3v4c0 4 6 5 6 0V3L5 5Zm14 0v4c0 4 6 5 6 0V3l-3 2Z" />
        <path d="M5 9 7 13m12-4-2 4" fill="none" stroke="currentColor" />
        <ellipse cx="12" cy="16" rx="7" ry="5" />
        <circle cx="9" cy="8.5" r="1.5" />
        <circle cx="15" cy="8.5" r="1.5" />
        <path d="M9 16c1 2 5 2 6 0" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'snail',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M3 17h12v-5a3 3 0 0 1 6 0v4c0 4-3 5-7 5H4c-2 0-3-2-1-4Z" opacity=".22" />
        <circle cx="9" cy="12" r="7" />
        <path d="M9 16a4 4 0 1 1 4-4c0 3-4 3-4 1" fill="none" stroke="var(--avatar-cutout)" />
        <path d="M17 11 16 7m4 4 1-4M15 17h3" fill="none" stroke="currentColor" />
        <circle cx="16" cy="6.5" r="1.5" />
        <circle cx="21" cy="6.5" r="1.5" />
      </g>
    ),
  },
  {
    id: 'dino',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m8 10-3-2 3-2 2-3 2 2" opacity=".22" />
        <path d="M8 12V8c0-4 4-5 8-5h3c2 0 3 1 3 3v5h-7v3c0 3-2 5-4 5v3H7v-6c-3-1-5-4-5-7 2 2 3 3 6 3Z" />
        <circle cx="16" cy="6.5" r="1.1" fill="var(--avatar-cutout)" />
        <path d="M17 9h5" fill="none" stroke="var(--avatar-cutout)" />
        <path d="m15 13 3 1-1 2m-5 3 2 3h2" fill="none" stroke="currentColor" />
        <path d="M9.5 15v3" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'bug',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path
          d="m9 6-2-3m8 3 2-3M6 11l-3-1m3 5-3 1m5 3-3 2m13-10 3-1m-3 5 3 1m-5 3 3 2"
          fill="none"
          stroke="currentColor"
        />
        <circle cx="12" cy="7" r="4" />
        <ellipse cx="12" cy="14.5" rx="7" ry="7.5" />
        <path d="M12 9v12" fill="none" stroke="var(--avatar-cutout)" />
        <circle cx="8.5" cy="12.5" r="1.3" fill="var(--avatar-cutout)" />
        <circle cx="15.5" cy="12.5" r="1.3" fill="var(--avatar-cutout)" />
        <circle cx="8.5" cy="17" r="1.3" fill="var(--avatar-cutout)" />
        <circle cx="15.5" cy="17" r="1.3" fill="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'feather',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M5 19C1 10 10 2 21 2c1 10-6 20-15 17Z" opacity=".22" />
        <path d="M6 18C5 10 12 4 21 2c-1 5-2 8-5 10l-3 1 2 1c-2 3-5 4-9 4Z" />
        <path d="M3 22 17 7" fill="none" stroke="currentColor" />
        <path d="m11 13 4-4m-4 4h5" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'lion',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m12 2 3 2 4-.5.5 4 2.5 3-2 3 1 4-4 1-2 3-3-1-3 1-2-3-4-1 1-4-2-3 2.5-3 .5-4 4 .5Z" />
        <path
          d="M7 8c-2-3-4 1-2 3l1 5c1 3 11 3 12 0l1-5c2-2 0-6-2-3-3-2-7-2-10 0Z"
          fill="var(--avatar-cutout)"
        />
        <path d="M8 10.5h2m4 0h2" fill="none" stroke="currentColor" />
        <path d="m10 13 2 2 2-2Z" />
        <path d="M12 15v2m-2 0h4" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'panda',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <circle cx="5.5" cy="5.5" r="3.5" />
        <circle cx="18.5" cy="5.5" r="3.5" />
        <ellipse cx="12" cy="13" rx="9.5" ry="8.5" />
        <ellipse cx="12" cy="13" rx="7.5" ry="6.5" fill="var(--avatar-cutout)" />
        <ellipse cx="8" cy="11.5" rx="2.5" ry="3" transform="rotate(25 8 11.5)" />
        <ellipse cx="16" cy="11.5" rx="2.5" ry="3" transform="rotate(-25 16 11.5)" />
        <circle cx="8.5" cy="11.5" r=".9" fill="var(--avatar-cutout)" />
        <circle cx="15.5" cy="11.5" r=".9" fill="var(--avatar-cutout)" />
        <path d="m10 15 2 2 2-2Z" />
      </g>
    ),
  },
  {
    id: 'koala',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <circle cx="6" cy="8" r="4" />
        <circle cx="18" cy="8" r="4" />
        <circle cx="5.5" cy="8" r="2.1" fill="var(--avatar-cutout)" />
        <circle cx="18.5" cy="8" r="2.1" fill="var(--avatar-cutout)" />
        <path d="M5 13c0-5 2-8 7-8s7 3 7 8v2c0 4-3 6-7 6s-7-2-7-6Z" />
        <circle cx="8" cy="12" r="1" fill="var(--avatar-cutout)" />
        <circle cx="16" cy="12" r="1" fill="var(--avatar-cutout)" />
        <path d="M10 11c0-3 4-3 4 0l.5 4c0 2-5 2-5 0Z" fill="var(--avatar-cutout)" />
        <path d="M10 18c1 1 3 1 4 0" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'elephant',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M8 7C1 0 0 18 6 19l3-5Zm8 0c7-7 8 11 2 12l-3-5Z" opacity=".22" />
        <path d="M5.5 10a6.5 6.5 0 0 1 13 0v5c0 2-1 3-3 3h-1v1a3 3 0 0 1-6 0v-4c-2 0-3-2-3-5Z" />
        <circle cx="8" cy="10.5" r="1" fill="var(--avatar-cutout)" />
        <circle cx="16" cy="10.5" r="1" fill="var(--avatar-cutout)" />
        <path d="m7 14-1 4 3-2m8-2 1 4-3-2" fill="var(--avatar-cutout)" />
        <path d="M9 7h6m-4 10h2" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'turtle',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path
          d="m6 7-2-3h4l2 3m-4 9-2 4h4l2-3m4-10 2-3h3l-2 5m-3 7 2 4h3l-2-5M4 11l-2 2 3 1"
          opacity=".22"
        />
        <path d="M17 9h3a3 3 0 0 1 0 6h-3Z" />
        <ellipse cx="10.5" cy="12" rx="7.5" ry="7" />
        <path d="m10.5 8 4 2.2v3.6l-4 2.2-4-2.2v-3.6Z" fill="none" stroke="var(--avatar-cutout)" />
        <circle cx="20" cy="11.5" r=".9" fill="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'whale',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M3 13a7 6 0 0 1 13-2c1 2 3 2 3-1-3 0-4-3-3-5l4 2 2-3v7c0 7-5 10-11 10s-8-4-8-8Z" />
        <path d="M4 15c4 4 10 4 14 0" fill="none" stroke="var(--avatar-cutout)" />
        <circle cx="6.5" cy="12" r="1.1" fill="var(--avatar-cutout)" />
        <path d="m11 15 3 4 2-4Z" fill="var(--avatar-cutout)" />
        <path d="M8 5V3m0 0L6 2m2 1 2-1" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'butterfly',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M11 11C7 1 1 2 2 8c0 3 3 5 7 5-5 0-7 6-3 8 3 1 5-3 6-6 1 3 3 7 6 6 4-2 2-8-3-8 4 0 7-2 7-5 1-6-5-7-9 3Z" />
        <path
          d="M5 6c2 0 4 2 4 4-3 0-4-2-4-4Zm14 0c-2 0-4 2-4 4 3 0 4-2 4-4ZM7 16l2-1-1 3Zm10 0-2-1 1 3Z"
          fill="var(--avatar-cutout)"
        />
        <path d="M12 9v9m0-9L9 5m3 4 3-4" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'wolf',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m4 2 6 6h4l6-6-1 10 3 4-5 1-5 5-5-5-5-1 3-4Z" />
        <path d="m6 6 2.5 3-2.5 1Zm12 0-2.5 3 2.5 1Z" fill="var(--avatar-cutout)" />
        <path d="m6.5 12 3 1m5 0 3-1" fill="none" stroke="var(--avatar-cutout)" />
        <path d="m12 12-3 6 3 2 3-2Z" fill="var(--avatar-cutout)" />
        <path d="m10.5 16.5 1.5 2 1.5-2Z" />
      </g>
    ),
  },
  {
    id: 'raccoon',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M4 9C1 2 8 1 10 6h4c2-5 9-4 6 3l2 5-10 8L2 14Z" />
        <path d="M4 11c2-3 5-2 8 0 3-2 6-3 8 0l-2 6-6 3-6-3Z" fill="var(--avatar-cutout)" />
        <path d="M4 12c3-3 7-1 7 1s-4 4-6 1Zm16 0c-3-3-7-1-7 1s4 4 6 1Z" />
        <circle cx="7.5" cy="12.5" r=".9" fill="var(--avatar-cutout)" />
        <circle cx="16.5" cy="12.5" r=".9" fill="var(--avatar-cutout)" />
        <path d="m10 16 2 2 2-2Z" />
      </g>
    ),
  },
  {
    id: 'bat',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M9 10 3 5 2 15c3-2 5-1 6 2l4 5 4-5c1-3 3-4 6-2L21 5l-6 5-1-7-2 3-2-3Z" />
        <path d="m4.5 9 4 4m11-4-4 4" fill="none" stroke="var(--avatar-cutout)" />
        <circle cx="10" cy="11.5" r=".9" fill="var(--avatar-cutout)" />
        <circle cx="14" cy="11.5" r=".9" fill="var(--avatar-cutout)" />
        <path d="m10 14 2 2 2-2Z" fill="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'shark',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m10 15 3 7 2-7" opacity=".22" />
        <path d="M2 13c2-3 4-4 7-4l4-6 1 6 4 2 4-6v14l-4-4c-6 4-12 2-16-2Z" />
        <path d="m4 14 6 .5-2 2Z" fill="var(--avatar-cutout)" />
        <circle cx="6.5" cy="11.5" r="1" fill="var(--avatar-cutout)" />
        <path d="m11 11 1 3m2-3 1 3" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'dragon',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="m4 15-2-6 6 2 3-6 2 8Z" opacity=".22" />
        <path d="M3 20c6 1 10-2 10-6v-4l-3-1 3-3 1-4 3 3 4-1-1 4 2 3-4 3h-2c-1 5-5 8-10 8Z" />
        <path d="m10 17-3-3-1 4m5 2 1 2h3" fill="none" stroke="currentColor" />
        <path d="m16 8 2 .5m-.5 3 2-1" fill="none" stroke="var(--avatar-cutout)" />
        <path d="m15 4 1 3-3-1Z" fill="var(--avatar-cutout)" />
      </g>
    ),
  },
  {
    id: 'axolotl',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path
          d="m6 11-3-5m3 6-4-1m4 3-3 3m15-6 3-5m-3 6 4-1m-4 3 3 3"
          fill="none"
          stroke="currentColor"
        />
        <path d="M5 13c0-5 3-7 7-7s7 2 7 7-3 7-7 7-7-2-7-7Z" />
        <circle cx="8.5" cy="12" r="1.1" fill="var(--avatar-cutout)" />
        <circle cx="15.5" cy="12" r="1.1" fill="var(--avatar-cutout)" />
        <path d="M9.5 15c1 2 4 2 5 0" fill="none" stroke="var(--avatar-cutout)" />
        <path d="m8 19-2 3h4m6-3 2 3h-4" opacity=".22" />
      </g>
    ),
  },
  {
    id: 'bee',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M11 10C1 10 1 2 6 3c3 0 5 4 6 7 1-3 3-7 6-7 5-1 5 7-5 7Z" opacity=".22" />
        <path d="M5 13a7 7 0 0 1 14 0c0 4-4 7-7 9-3-2-7-5-7-9Z" />
        <path d="M6 14h12m-10 4h8" fill="none" stroke="var(--avatar-cutout)" />
        <circle cx="9" cy="10.5" r="1" fill="var(--avatar-cutout)" />
        <circle cx="15" cy="10.5" r="1" fill="var(--avatar-cutout)" />
        <path d="m9 7-2-3m8 3 2-3" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'capybara',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M5 9V5c0-3 5-3 5 1m4 0c0-4 5-4 5-1v4" />
        <path d="M4 11c0-4 3-6 8-6s8 2 8 6v6c0 3-3 4-8 4s-8-1-8-4Z" />
        <path d="M7 11h2m6 0h2" fill="none" stroke="var(--avatar-cutout)" />
        <path d="M6 15c0-2 12-2 12 0v3c-3 2-9 2-12 0Z" fill="var(--avatar-cutout)" />
        <path d="m10 14.5 2 1.5 2-1.5Z" />
        <path d="M12 16v1.5" fill="none" stroke="currentColor" />
      </g>
    ),
  },
  {
    id: 'hummingbird',
    draw: () => (
      <g fill="currentColor" stroke="none">
        <path d="M13 12C5 12 3 7 2 2c6 1 10 4 11 10Z" opacity=".22" />
        <path d="M12 12C5 10 5 5 6 2c5 2 8 5 8 9Z" />
        <path d="M6 22 9 15c1-2 4-3 5-6 1-3 5-2 5 0l3 2-4 .5c-1 4-3 6-7 6Z" />
        <circle cx="16.5" cy="9.5" r=".9" fill="var(--avatar-cutout)" />
        <path d="m13 13-2 2" fill="none" stroke="var(--avatar-cutout)" />
      </g>
    ),
  },
];
